/**
 * 等用户：审批的 ask、提问、resolve、结算（t20 第 7 片）。测试名里的编号是 docs/specs/harness/runtime.md 的输出条目与验收场景。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {ApproveHook, InteractionSummary, LogEvent, QuestionAnswer} from "../api/index.js";
import {createTestSession, type TestSession, type TestTool} from "../testing/test-session.js";

let root = "";
beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness", "kernel-interaction");
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

let commands = 0;
const id = () => `i-${(commands += 1)}`;
const types = (events: readonly LogEvent[]) => events.map((event) => event.type);
const dataOf = <T = Record<string, unknown>>(events: readonly LogEvent[], type: string) => events.filter((event) => event.type === type).map((event) => event.data as T);

/** 等运行状态进 waiting、待处理的事项有 `count` 个；交回它们。 */
function waitingFor(session: TestSession, count: number): Promise<InteractionSummary[]> {
    return new Promise((resolve) => {
        const check = (status: {state: string; pending?: InteractionSummary[]}) => {
            if (status.state === "waiting" && status.pending!.length === count) {
                stop();
                resolve(status.pending!);
            }
        };
        const stop = session.raw.subscribe((frame) => {
            if (frame.type === "status") check(frame.status);
        });
        void session.raw.snapshot().then((snapshot) => check(snapshot.status));
    });
}

async function sendRaw(session: TestSession, text: string): Promise<string> {
    const sent = await session.raw.send({commandId: id(), input: {text}});
    if (!sent.ok || sent.value.runId === null) throw new Error("send did not start a run");
    return sent.value.runId;
}

/** 写类工具要问用户，“本会话都批准”过的放行。 */
const askForWrites: ApproveHook = async (call, info) => {
    if (info.effect === "read" || info.remembered.includes(call.tool)) return {verdict: "allow", by: info.remembered.includes(call.tool) ? "remembered" : "rule:read"};
    return {verdict: "ask", reason: "会改文件"};
};
const writer = (toolId: string, extra: Partial<TestTool> = {}): TestTool => ({id: toolId, effect: "write", execute: () => `${toolId} 写好了`, ...extra});

describe("审批", () => {
    test("输出 39：判定 ask 时停下等；allow 后执行；allow-session 记住，回退与重开之后仍放行", async () => {
        await using session = await createTestSession({store: {root}, approve: askForWrites, tools: [writer("lab.write")]});
        session.model.script({tools: [{tool: "lab.write", args: {path: "正文/一.md"}}]}, "写完了", {tools: [{tool: "lab.write"}]}, "又写完了", {tools: [{tool: "lab.write"}]}, "第三次");
        const runId = await sendRaw(session, "写第一章");
        const [pending] = await waitingFor(session, 1);
        expect(pending).toMatchObject({kind: "approval", request: {tool: "lab.write", args: {path: "正文/一.md"}, effect: "write", reason: "会改文件"}});
        expect(await session.raw.resolve({commandId: id(), id: pending!.id, decision: "allow-session"})).toMatchObject({ok: true});
        expect((await session.raw.waitRun(runId)).text).toBe("写完了");
        const events = await session.events();
        expect(dataOf(events, "toolStarted")[0]).toMatchObject({approval: {by: "user"}});
        expect(dataOf(events, "interactionResolved")[0]).toMatchObject({decision: "allow-session", by: {kind: "user"}});
        expect(dataOf((await session.raw.log({afterSeq: 0})).events, "approvalRemembered")).toEqual([{tool: "lab.write", scope: "tool", by: {kind: "user"}}]);

        const second = await session.say("再写");
        expect(dataOf(second.events, "toolStarted")[0]).toMatchObject({approval: {by: "remembered"}});
        const before = (await session.raw.rewindTargets()).find((target) => target.kind === "before-turn" && target.inputText === "写第一章")!;
        await session.raw.rewind({commandId: id(), to: before.id});
        await session.reopen();
        const third = await session.say("回退之后再写");
        expect(dataOf(third.events, "toolStarted")[0]).toMatchObject({approval: {by: "remembered"}});
    });

    test("输出 39：deny 时调用得 user-denied，应答附的话给模型看", async () => {
        await using session = await createTestSession({approve: askForWrites, tools: [writer("lab.write")]});
        session.model.script({tools: [{tool: "lab.write"}]}, "好的，不写了");
        const runId = await sendRaw(session, "写");
        const [pending] = await waitingFor(session, 1);
        await session.raw.resolve({commandId: id(), id: pending!.id, decision: "deny", note: "先别动正文"});
        await session.raw.waitRun(runId);
        const result = dataOf(await session.events(), "toolResult")[0]!;
        expect(result).toMatchObject({status: "denied", code: "user-denied", by: "user"});
        expect(result.text).toContain("先别动正文");
        expect(types(await session.events())).not.toContain("toolStarted");
    });

    test("输出 44：同一条回复里两个调用同时待处理，任意顺序应答，都应答后回到运行", async () => {
        await using session = await createTestSession({approve: askForWrites, tools: [writer("lab.a", {concurrency: "shared"}), writer("lab.b", {concurrency: "shared"})]});
        session.model.script({tools: [{tool: "lab.a"}, {tool: "lab.b"}]}, "都写了");
        const runId = await sendRaw(session, "写两处");
        const pending = await waitingFor(session, 2);
        expect(pending.map((item) => (item.request as {tool: string}).tool)).toEqual(["lab.a", "lab.b"]);
        await session.raw.resolve({commandId: id(), id: pending[1]!.id, decision: "allow"});
        const [left] = await waitingFor(session, 1);
        expect(left!.id).toBe(pending[0]!.id);
        await session.raw.resolve({commandId: id(), id: pending[0]!.id, decision: "deny"});
        expect((await session.raw.waitRun(runId)).reason).toBe("completed");
        expect(dataOf(await session.events(), "toolResult").map((data) => [data.tool, data.status])).toEqual([["lab.a", "denied"], ["lab.b", "ok"]]);
    });

    test("输出 41、45：并发应答先到的生效；没有的得 unknown-interaction；审批只收用户；决定不合种类得 invalid-answer", async () => {
        await using session = await createTestSession({approve: askForWrites, tools: [writer("lab.write")]});
        session.model.script({tools: [{tool: "lab.write"}]}, "完成");
        const runId = await sendRaw(session, "写");
        const [pending] = await waitingFor(session, 1);
        expect(await session.raw.as({kind: "session", id: "parent"}).resolve({commandId: id(), id: pending!.id, decision: "allow"})).toEqual({ok: false, code: "not-allowed"});
        expect(await session.raw.resolve({commandId: id(), id: pending!.id, decision: "answer", answer: {text: "随便"}})).toEqual({ok: false, code: "invalid-answer"});
        expect(await session.raw.resolve({commandId: id(), id: "nope", decision: "allow"})).toEqual({ok: false, code: "unknown-interaction"});
        const [first, second] = await Promise.all([
            session.raw.resolve({commandId: id(), id: pending!.id, decision: "allow"}),
            session.raw.resolve({commandId: id(), id: pending!.id, decision: "deny"}),
        ]);
        expect(first).toMatchObject({ok: true});
        expect(second).toEqual({ok: false, code: "already-answered", detail: {by: "user", decision: "allow"}});
        await session.raw.waitRun(runId);
    });
});

describe("提问", () => {
    test("输出 40、41：同步提问停下等回答；会话交给调用方时父会话也能答，别的会话不行", async () => {
        const answers: QuestionAnswer[] = [];
        const asker: TestTool = {id: "lab.ask", execute: async (_args, context) => {
            const answer = await context.ask!({question: "主角叫什么？", options: ["林舟", "沈岚"]});
            answers.push(answer);
            return answer.kind === "answer" ? `主角是 ${answer.text}` : "没答";
        }};
        await using session = await createTestSession({tools: [asker], questions: "caller", caller: {kind: "session", id: "parent", callId: "c1"}});
        session.model.script({tools: [{tool: "lab.ask"}]}, "记住了", {tools: [{tool: "lab.ask"}]}, "好");
        const runId = await sendRaw(session, "问我");
        const [question] = await waitingFor(session, 1);
        expect(question).toMatchObject({kind: "question", request: {question: "主角叫什么？", options: ["林舟", "沈岚"]}});
        expect(await session.raw.as({kind: "session", id: "stranger"}).resolve({commandId: id(), id: question!.id, decision: "answer", answer: {text: "x"}})).toEqual({ok: false, code: "not-allowed"});
        expect(await session.raw.as({kind: "session", id: "parent"}).resolve({commandId: id(), id: question!.id, decision: "answer", answer: {text: "林舟", data: {index: 0}}})).toMatchObject({ok: true});
        await session.raw.waitRun(runId);
        expect(answers[0]).toEqual({kind: "answer", text: "林舟", data: {index: 0}});
        expect(dataOf(await session.events(), "interactionResolved")[0]).toMatchObject({by: {kind: "session", id: "parent"}, data: {text: "林舟", data: {index: 0}}});

        const second = await sendRaw(session, "再问");
        const [again] = await waitingFor(session, 1);
        await session.raw.resolve({commandId: id(), id: again!.id, decision: "deny"});
        await session.raw.waitRun(second);
        expect(answers[1]).toEqual({kind: "unavailable", code: "declined"});
    });

    test("输出 40、42：异步提问不停下；运行结束后仍待处理；空闲时应答开新的运行；回退掉之后得 unknown-interaction", async () => {
        const asker: TestTool = {id: "lab.later", execute: async (_args, context) => {
            const answer = await context.ask!({question: "要几章？"}, {async: true});
            return answer.kind === "unavailable" ? `先接着做（${answer.code}）` : "不该这样";
        }};
        await using session = await createTestSession({tools: [asker]});
        session.model.script({tools: [{tool: "lab.later"}]}, "先写着", "收到三章");
        const first = await session.say("开始");
        expect(first.result.reason).toBe("completed");
        expect(dataOf(first.events, "toolResult")[0]!.text).toBe("先接着做（async）");
        const question = dataOf<{id: string; async: boolean}>(first.events, "interactionRequested")[0]!;
        expect(question.async).toBe(true);
        const resolved = await session.raw.resolve({commandId: id(), id: question.id, decision: "answer", answer: {text: "三章"}});
        expect(resolved).toMatchObject({ok: true});
        const runs = (await session.events()).filter((event) => event.type === "runStarted");
        expect(runs).toHaveLength(2);
        const lastRun = (runs[1]!.data as {runId: string}).runId;
        expect((await session.raw.waitRun(lastRun)).text).toBe("收到三章");
        expect(dataOf(await session.events(), "input").map((data) => data.text)).toEqual(["开始", "三章"]);

        session.model.script({tools: [{tool: "lab.later"}]}, "再写着");
        const again = await session.say("又开始");
        const second = dataOf<{id: string}>(again.events, "interactionRequested")[0]!;
        const before = (await session.raw.rewindTargets()).find((target) => target.kind === "before-turn" && target.inputText === "又开始")!;
        await session.raw.rewind({commandId: id(), to: before.id});
        expect(await session.raw.resolve({commandId: id(), id: second.id, decision: "answer", answer: {text: "五章"}})).toEqual({ok: false, code: "unknown-interaction"});
    });
});

describe("结算", () => {
    test("输出 43：中止时等待中的审批写 aborted、调用得 denied；之后到的应答得 already-answered", async () => {
        await using session = await createTestSession({approve: askForWrites, tools: [writer("lab.write")]});
        session.model.script({tools: [{tool: "lab.write"}]});
        const runId = await sendRaw(session, "写");
        const [pending] = await waitingFor(session, 1);
        await session.raw.abort({commandId: id()});
        expect((await session.raw.waitRun(runId)).reason).toBe("aborted");
        const events = await session.events();
        expect(dataOf(events, "interactionResolved")).toEqual([{id: pending!.id, decision: "aborted", by: {kind: "kernel"}, code: "aborted"}]);
        expect(dataOf(events, "toolResult")[0]).toMatchObject({status: "denied", code: "aborted"});
        expect(await session.raw.resolve({commandId: id(), id: pending!.id, decision: "allow"})).toEqual({ok: false, code: "already-answered", detail: {by: "kernel", decision: "aborted"}});
    });

    test("输出 43：中止刚触发、结算还没写下时到的应答也得 already-answered，日志里只有一条结算", async () => {
        await using session = await createTestSession({approve: askForWrites, tools: [writer("lab.write")]});
        session.model.script({tools: [{tool: "lab.write"}]});
        const runId = await sendRaw(session, "写");
        const [pending] = await waitingFor(session, 1);
        const aborting = session.raw.abort({commandId: id()});
        const late = await session.raw.resolve({commandId: id(), id: pending!.id, decision: "allow"});
        await aborting;
        await session.raw.waitRun(runId);
        expect(late).toEqual({ok: false, code: "already-answered", detail: {by: "kernel", decision: "aborted"}});
        expect(dataOf(await session.events(), "interactionResolved")).toHaveLength(1);
    });

    test("场景 6、输出 43：等审批时被 kill -9，重开后审批 interrupted；先提的异步提问还在，应答后开新的运行", async () => {
        const dir = join(root, "waiting-approval");
        const fixture = join(import.meta.dir, "../../../tests/kernel/fixtures/crash-session.ts");
        const child = Bun.spawn(["bun", fixture, dir, "waiting-approval"], {stdout: "pipe", stderr: "inherit"});
        let sessionId = "";
        try {
            const reader = child.stdout.getReader();
            let text = "";
            while (!text.includes("\n")) {
                const {value, done} = await reader.read();
                if (done) throw new Error(`the child exited before announcing: ${text}`);
                text += new TextDecoder().decode(value);
            }
            const [what, announced] = text.trim().split(" ");
            expect(what).toBe("waiting");
            sessionId = announced!;
        } finally {
            child.kill(9);
            await child.exited;
        }
        await using session = await createTestSession({store: {root: dir}, open: sessionId, tools: [{id: "lab.asker", execute: () => "问过了"}, writer("lab.gated")]});
        // 一条回复的结果整批写：lab.asker 执行完了，但进程被杀时这批还没写，所以按开始执行过、没有结果结算。
        const events = await session.events();
        const resolved = dataOf<{id: string; decision: string; code: string}>(events, "interactionResolved");
        expect(resolved).toEqual([expect.objectContaining({decision: "interrupted", code: "interrupted-before-approval", by: {kind: "kernel"}})]);
        expect(dataOf(events, "toolResult").map((data) => [data.tool, data.status, data.code ?? null])).toEqual([["lab.asker", "unknown", "interrupted"], ["lab.gated", "denied", "interrupted-before-approval"]]);
        const asked = dataOf<{id: string; async: boolean}>(events, "interactionRequested").find((data) => data.async)!;
        session.model.script("知道主角了");
        expect(await session.raw.resolve({commandId: id(), id: asked.id, decision: "answer", answer: {text: "林舟"}})).toMatchObject({ok: true});
        const last = (await session.events()).filter((event) => event.type === "runStarted").at(-1)!;
        expect((await session.raw.waitRun((last.data as {runId: string}).runId)).text).toBe("知道主角了");
    });
});
