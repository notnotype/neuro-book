/**
 * 等用户：审批的 ask、提问、resolve、结算（t20 第 7 片）。测试名里的编号是 docs/specs/harness/runtime.md 的输出条目与验收场景。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {AnyProfile, ApproveHook, InteractionSummary, LogEvent, LogStore, QuestionAnswer, RunStatus} from "../api/index.js";
import {defineExtension} from "../extension/define.js";
import {defineProfile} from "../extension/profile.js";
import {createTestSession, type TestSession, type TestTool} from "../testing/test-session.js";
import {closeSession} from "../session/session.js";
import {createJsonlStore} from "../log/jsonl-store.js";
import {nodeFiles} from "../log/files.js";

let root = "";
beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness", "kernel-interaction");
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

function gate() {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => {
        open = resolve;
    });
    return {promise, open};
}

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

/** 等一个 id 不是 `other` 的待处理事项。 */
function waitingForOther(session: TestSession, other: string): Promise<InteractionSummary> {
    return new Promise((resolve) => {
        const check = (status: {state: string; pending?: InteractionSummary[]}) => {
            const found = status.state === "waiting" ? status.pending!.find((item) => item.id !== other) : undefined;
            if (found === undefined) return;
            stop();
            resolve(found);
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
/** 事项的请求原文：在日志的 interactionRequested 里（运行状态不带它）。 */
const requestOf = async (session: TestSession, interaction: string) => (await session.raw.log({afterSeq: 0})).events.find((event) => event.type === "interactionRequested" && (event.data as {id: string}).id === interaction)?.data as {request: unknown} | undefined;

const writer = (toolId: string, extra: Partial<TestTool> = {}): TestTool => ({id: toolId, effect: "write", execute: () => `${toolId} 写好了`, ...extra});

describe("审批", () => {
    test("输出 79：一条回复的审批先问完再执行：都问到、一个都没开始；不用审批的也等；执行顺序不变；拒绝一个，别的照常", async () => {
        const started: string[] = [];
        const tool = (toolId: string, extra: Partial<TestTool> = {}): TestTool => ({id: toolId, effect: "write", execute: () => {
            started.push(toolId);
            return `${toolId} 好了`;
        }, ...extra});
        await using session = await createTestSession({approve: askForWrites, tools: [
            tool("lab.read", {effect: "read"}),
            tool("lab.first"),
            tool("lab.second"),
            tool("lab.third"),
        ]});
        session.model.script({tools: [{tool: "lab.read"}, {tool: "lab.first"}, {tool: "lab.second"}, {tool: "lab.third"}]}, "都处理了");
        const runId = await sendRaw(session, "改三处");
        const pending = await waitingFor(session, 3);
        const requested = dataOf<{id: string; request: {tool: string}}>(await session.events(), "interactionRequested");
        // 事项的先后就是调用的先后，向导的“第几个”靠它。
        expect(requested.map((item) => item.request.tool)).toEqual(["lab.first", "lab.second", "lab.third"]);
        expect(pending.map((item) => item.id)).toEqual(requested.map((item) => item.id));
        expect(started).toEqual([]);
        expect(dataOf(await session.events(), "toolStarted")).toEqual([]);

        // 答的先后不影响执行的先后；答到最后一个才开始。
        await session.raw.resolve({commandId: id(), id: requested[2]!.id, decision: "allow"});
        await session.raw.resolve({commandId: id(), id: requested[1]!.id, decision: "deny", note: "这段不要改"});
        expect(started).toEqual([]);
        await session.raw.resolve({commandId: id(), id: requested[0]!.id, decision: "allow"});
        expect((await session.raw.waitRun(runId)).text).toBe("都处理了");
        expect(started).toEqual(["lab.read", "lab.first", "lab.third"]);
        const results = dataOf<{tool: string; status: string; code?: string; text: string}>(await session.events(), "toolResult");
        expect(results.map((item) => [item.tool, item.status, item.code ?? null])).toEqual([["lab.read", "ok", null], ["lab.first", "ok", null], ["lab.second", "denied", "user-denied"], ["lab.third", "ok", null]]);
        expect(results[2]!.text).toContain("这段不要改");
    });

    test("输出 79：审批钩子每个调用只判定一次；被批准的调用执行时不再问", async () => {
        const judged: string[] = [];
        const approve: ApproveHook = async (call, info, ctx) => {
            judged.push(call.tool);
            return askForWrites(call, info, ctx);
        };
        await using session = await createTestSession({approve, tools: [writer("lab.a"), writer("lab.read", {effect: "read"})]});
        session.model.script({tools: [{tool: "lab.a"}, {tool: "lab.read"}]}, "好了");
        const runId = await sendRaw(session, "写");
        const [pending] = await waitingFor(session, 1);
        await session.raw.resolve({commandId: id(), id: pending!.id, decision: "allow"});
        await session.raw.waitRun(runId);
        expect(judged).toEqual(["lab.a", "lab.read"]);
        expect(dataOf(await session.events(), "interactionRequested")).toHaveLength(1);
    });

    test("输出 79：拦截改了参数：按改后的参数再问一次，用户不会批了 X 却执行 Y", async () => {
        const ran: unknown[] = [];
        const rewrite = defineExtension({id: "lab.rewrite", intercept: {tool: async (call, next) => next({...call, args: {path: "别的.md"}})}});
        await using session = await createTestSession({approve: askForWrites, extensions: [rewrite], tools: [writer("lab.write", {execute: (args) => {
            ran.push(args);
            return "写好了";
        }})]});
        session.model.script({tools: [{tool: "lab.write", args: {path: "正文.md"}}]}, "好了");
        const runId = await sendRaw(session, "写");
        const [asked] = await waitingFor(session, 1);
        expect(await requestOf(session, asked!.id)).toMatchObject({request: {args: {path: "正文.md"}}});
        await session.raw.resolve({commandId: id(), id: asked!.id, decision: "allow"});
        const again = await waitingForOther(session, asked!.id);
        expect(await requestOf(session, again.id)).toMatchObject({request: {args: {path: "别的.md"}}});
        expect(ran).toEqual([]);
        await session.raw.resolve({commandId: id(), id: again.id, decision: "allow"});
        expect((await session.raw.waitRun(runId)).text).toBe("好了");
        expect(ran).toEqual([{path: "别的.md"}]);
    });

    test("输出 79：拦截只改了键的顺序不算改了参数，不再问", async () => {
        const reorder = defineExtension({id: "lab.reorder", intercept: {tool: async (call, next) => next({...call, args: {b: 2, a: 1}})}});
        await using session = await createTestSession({approve: askForWrites, extensions: [reorder], tools: [writer("lab.write")]});
        session.model.script({tools: [{tool: "lab.write", args: {a: 1, b: 2}}]}, "好了");
        const runId = await sendRaw(session, "写");
        const [asked] = await waitingFor(session, 1);
        await session.raw.resolve({commandId: id(), id: asked!.id, decision: "allow"});
        expect((await session.raw.waitRun(runId)).text).toBe("好了");
        expect(dataOf(await session.events(), "interactionRequested")).toHaveLength(1);
    });

    test("输出 79：等一批审批时中止：都结算成 aborted，一个都没执行，调用记 denied", async () => {
        const ran: string[] = [];
        await using session = await createTestSession({approve: askForWrites, tools: [writer("lab.a", {execute: () => void ran.push("a") as never}), writer("lab.b", {execute: () => void ran.push("b") as never})]});
        session.model.script({tools: [{tool: "lab.a"}, {tool: "lab.b"}]});
        const runId = await sendRaw(session, "写两处");
        await waitingFor(session, 2);
        await session.raw.abort({commandId: id()});
        await session.raw.waitRun(runId);
        const events = await session.events();
        expect(ran).toEqual([]);
        expect(dataOf<{decision: string}>(events, "interactionResolved").map((item) => item.decision)).toEqual(["aborted", "aborted"]);
        expect(dataOf<{status: string; code: string}>(events, "toolResult").map((item) => [item.status, item.code])).toEqual([["denied", "aborted"], ["denied", "aborted"]]);
        expect((await session.raw.snapshot()).status.state).toBe("idle");
    });

    test("输出 39：判定 ask 时停下等；allow 后执行；allow-session 记住，回退与重开之后仍放行", async () => {
        await using session = await createTestSession({store: {root}, approve: askForWrites, tools: [writer("lab.write")]});
        session.model.script({tools: [{tool: "lab.write", args: {path: "正文/一.md"}}]}, "写完了", {tools: [{tool: "lab.write"}]}, "又写完了", {tools: [{tool: "lab.write"}]}, "第三次");
        const runId = await sendRaw(session, "写第一章");
        const [pending] = await waitingFor(session, 1);
        expect(pending).toMatchObject({kind: "approval"});
        expect(await requestOf(session, pending!.id)).toMatchObject({request: {tool: "lab.write", args: {path: "正文/一.md"}, effect: "write", reason: "会改文件"}});
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
        const bStarted = gate();
        const bRelease = gate();
        await using session = await createTestSession({approve: askForWrites, tools: [writer("lab.a", {concurrency: "shared"}), writer("lab.b", {concurrency: "shared", execute: async () => {
            bStarted.open();
            await bRelease.promise;
            return "lab.b 写好了";
        }})]});
        session.model.script({tools: [{tool: "lab.a"}, {tool: "lab.b"}]}, "都写了");
        const runId = await sendRaw(session, "写两处");
        const pending = await waitingFor(session, 2);
        const calls = (await session.events()).filter((event) => event.type === "assistant").flatMap((event) => (event.data as {toolCalls: {id: string}[]}).toolCalls.map((call) => call.id));
        expect(pending.map((item) => item.callId)).toEqual(calls);
        // 请求原文只在经出站过滤的 interactionRequested 里，运行状态里没有。
        expect(pending.every((item) => !("request" in item))).toBe(true);
        await session.raw.resolve({commandId: id(), id: pending[1]!.id, decision: "allow"});
        const [left] = await waitingFor(session, 1);
        expect(left!.id).toBe(pending[0]!.id);
        await session.raw.resolve({commandId: id(), id: pending[0]!.id, decision: "deny"});
        // 都应答之后、lab.b 还在执行时，运行状态回到 running。
        await bStarted.promise;
        expect((await session.raw.snapshot()).status).toMatchObject({state: "running", phase: "tools"});
        bRelease.open();
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
        expect(question).toMatchObject({kind: "question"});
        expect(await requestOf(session, question!.id)).toMatchObject({request: {question: "主角叫什么？", options: ["林舟", "沈岚"]}});
        expect(await session.raw.as({kind: "session", id: "stranger"}).resolve({commandId: id(), id: question!.id, decision: "answer", answer: {text: "x"}})).toEqual({ok: false, code: "not-allowed"});
        expect(await session.raw.as({kind: "session", id: "parent"}).resolve({commandId: id(), id: question!.id, decision: "answer", answer: {text: "林舟", data: {index: 0}}})).toMatchObject({ok: true});
        await session.raw.waitRun(runId);
        expect(answers[0]).toEqual({kind: "answer", text: "林舟", data: {index: 0}, by: {kind: "session", id: "parent"}});
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

describe("fork 之后", () => {
    test("输出 41、37：fork 带上 caller，复制过去的待处理提问仍由那个父会话应答", async () => {
        const asker: TestTool = {id: "lab.later", execute: async (_args, context) => {
            await context.ask!({question: "要几章？"}, {async: true});
            return "先写着";
        }};
        await using session = await createTestSession({store: {root}, tools: [asker], questions: "caller", caller: {kind: "session", id: "parent", callId: "c1"}});
        session.model.script({tools: [{tool: "lab.later"}]}, "好");
        const {events} = await session.say("开始");
        const question = dataOf<{id: string}>(events, "interactionRequested")[0]!;
        const forked = await session.raw.fork({commandId: id()});
        if (!forked.ok) throw new Error(forked.code);
        await using copy = await createTestSession({store: {root}, open: forked.value.sessionId, tools: [asker]});
        expect((await copy.raw.snapshot()).header.caller).toEqual({kind: "session", id: "parent", callId: "c1"});
        copy.model.script("收到");
        expect(await copy.raw.as({kind: "session", id: "parent"}).resolve({commandId: id(), id: question.id, decision: "answer", answer: {text: "三章"}})).toMatchObject({ok: true});
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

    test("输出 43：应答认领之后、受理批写下之前会话被关闭：这次等待交还给提问的调用，由它写 interrupted，日志里恰好一条结算", async () => {
        const dir = join(root, "claim-close");
        let received = "";
        const asked = gate();
        await using session = await createTestSession({store: {root: dir}, tools: [{id: "lab.ask", execute: async (_args, ctx) => {
            const answer = await ctx.ask!({question: "要继续吗？"});
            received = answer.kind === "unavailable" ? answer.code : answer.kind;
            asked.open();
            return "提问结束";
        }}]});
        const waiting = waitingFor(session, 1);
        session.model.script({tools: [{tool: "lab.ask"}]});
        await sendRaw(session, "问一下");
        const [pending] = await waiting;
        const resolving = session.raw.resolve({commandId: id(), id: pending!.id, decision: "deny"});
        // 认领在 resolve 的队列项里同步完成；紧接着的微任务里关闭，正好落在“认领了、还没写下”之间。
        const closing = Promise.resolve().then(() => closeSession(session.raw, {reason: "interrupted"}));
        expect(await resolving).toEqual({ok: false, code: "session-closed"});
        await closing;
        await asked.promise;
        // 交还之后由提问那一方结算（ctx.ask 把 interrupted 交成 unavailable）；旧做法以 aborted 叫醒、日志里没有结算。
        expect(received).not.toBe("aborted");
        await session.reopen();
        const events = await session.events();
        expect(dataOf(events, "interactionResolved").filter((data) => data.id === pending!.id)).toEqual([expect.objectContaining({decision: "interrupted", by: {kind: "kernel"}})]);
        expect(types(events).indexOf("interactionResolved")).toBeLessThan(types(events).indexOf("runEnded"));
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
        const events = await session.events();
        const resolved = dataOf<{id: string; decision: string; code: string}>(events, "interactionResolved");
        expect(resolved).toEqual([expect.objectContaining({decision: "interrupted", code: "interrupted-before-approval", by: {kind: "kernel"}})]);
        expect(dataOf(events, "toolResult").map((data) => [data.tool, data.status, data.code ?? null])).toEqual([["lab.asker", "ok", null], ["lab.gated", "denied", "interrupted-before-approval"]]);
        const asked = dataOf<{id: string; async: boolean}>(events, "interactionRequested").find((data) => data.async)!;
        session.model.script("知道主角了");
        expect(await session.raw.resolve({commandId: id(), id: asked.id, decision: "answer", answer: {text: "林舟"}})).toMatchObject({ok: true});
        const last = (await session.events()).filter((event) => event.type === "runStarted").at(-1)!;
        expect((await session.raw.waitRun((last.data as {runId: string}).runId)).text).toBe("知道主角了");
    });
});

describe("发话一并结算（runtime.md 输出 111）", () => {
    const SETTLED = {decision: "deny", by: {kind: "user"}, note: "用户发了新消息"};
    const filter = defineExtension({id: "lab.filter", intercept: {input: async (input, next) => (input.text.includes("禁词") ? {reject: {code: "banned-word"}} : next(input))}});

    /**
     * 同一条回复里两个写调用（拦截层改了参数，放行之后按改过的参数再问一次）加一个父调用里嵌套的同步提问：三个事项同时待处理。
     * 第一次审批阶段挡住所有调用开始（输出 79），所以第三个事项只能在复审时出现。
     */
    async function threePending(extra: {store?: {root: string}} = {}) {
        const nested = gate();
        let nestedReply = "";
        const rewrite = defineExtension({id: "lab.rewrite", intercept: {tool: (call, next) => next(call.tool.startsWith("lab.write") ? {...call, args: {changed: true}} : call)}});
        const session = await createTestSession({...extra, extensions: [rewrite, filter], approve: askForWrites, tools: [
            writer("lab.write1", {concurrency: "shared"}),
            writer("lab.write2", {concurrency: "shared"}),
            {id: "lab.parent", concurrency: "shared", invokes: true, execute: async (_args, ctx) => (await ctx.invoke!("lab.ask", {})).text},
            {id: "lab.ask", execute: async (_args, ctx) => {
                const reply = await ctx.ask!({question: "还继续吗？"});
                nestedReply = reply.kind === "unavailable" ? reply.code : "answer";
                nested.open();
                return "问过了";
            }},
        ]});
        session.model.script({tools: [{tool: "lab.write1"}, {tool: "lab.write2"}, {tool: "lab.parent"}]}, "知道了，不改了");
        const initial = waitingFor(session, 2);
        const runId = await sendRaw(session, "改两处");
        for (const item of await initial) expect(await session.raw.resolve({commandId: id(), id: item.id, decision: "allow"})).toMatchObject({ok: true});
        const pending = await waitingForThree(session, new Set((await initial).map((item) => item.id)));
        return {session, runId, pending, nested: nested.promise.then(() => nestedReply)};
    }

    /** 等三个、且都不是 `exclude` 里的待处理事项（复审的事项是新的 id）。 */
    function waitingForThree(session: TestSession, exclude: ReadonlySet<string>): Promise<InteractionSummary[]> {
        return new Promise((resolve) => {
            const check = (status: {state: string; pending?: InteractionSummary[]}) => {
                if (status.state !== "waiting" || status.pending!.length !== 3 || status.pending!.some((item) => exclude.has(item.id))) return;
                stop();
                resolve(status.pending!);
            };
            const stop = session.raw.subscribe((frame) => {
                if (frame.type === "status") check(frame.status);
            });
            void session.raw.snapshot().then((snapshot) => check(snapshot.status));
        });
    }

    test("验收 16：两个复审与一个嵌套提问同时待处理，用户带 settlePending 发一句：同一个受理批里三个都以 deny 结算，插话接着进这一轮", async () => {
        const {session, runId, pending, nested} = await threePending();
        await using _ = session;
        const commandId = id();
        const sent = await session.raw.send({commandId, input: {text: "别改了"}, mode: "steer", settlePending: "deny"});
        expect(sent).toMatchObject({ok: true, value: {placement: "taken"}});
        expect(await nested).toBe("declined");
        const result = await session.raw.waitRun(runId);
        expect(result.text).toBe("知道了，不改了");
        const events = await session.events();
        const log = (await session.raw.log({afterSeq: 0})).events;
        const accepted = log.findIndex((event) => event.type === "commandAccepted" && (event.data as {commandId: string}).commandId === commandId);
        // 受理批：三条结算、插话入队、commandAccepted，seq 连续。
        const batch = log.slice(accepted - 4, accepted + 1);
        expect(types(batch)).toEqual(["interactionResolved", "interactionResolved", "interactionResolved", "inputQueued", "commandAccepted"]);
        expect(batch.slice(0, 3).map((event) => event.data)).toEqual(pending.map(() => expect.objectContaining(SETTLED)));
        expect(new Set(batch.slice(0, 3).map((event) => (event.data as {id: string}).id))).toEqual(new Set(pending.map((item) => item.id)));
        expect(dataOf(events, "toolResult").filter((data) => String(data.tool).startsWith("lab.write")).map((data) => [data.status, data.code])).toEqual([["denied", "user-denied"], ["denied", "user-denied"]]);
        expect(types(events)).toContain("steer");
        const resolvedCount = dataOf(events, "interactionResolved").length;
        expect(await session.raw.send({commandId, input: {text: "别改了"}, mode: "steer", settlePending: "deny"})).toMatchObject({ok: true, replayed: true});
        expect(dataOf(await session.events(), "interactionResolved")).toHaveLength(resolvedCount);
    });

    test("第一次审批阶段的两个事项一并结算；没有待处理的事项时等于普通的 send", async () => {
        await using session = await createTestSession({approve: askForWrites, tools: [writer("lab.write1"), writer("lab.write2")]});
        session.model.script({tools: [{tool: "lab.write1"}, {tool: "lab.write2"}]}, "好，不写了", "第二句也收到了");
        const pending = waitingFor(session, 2);
        const runId = await sendRaw(session, "写两处");
        await pending;
        expect(await session.raw.send({commandId: id(), input: {text: "先别写"}, mode: "steer", settlePending: "deny"})).toMatchObject({ok: true});
        await session.raw.waitRun(runId);
        expect(dataOf(await session.events(), "interactionResolved").map((data) => data.decision)).toEqual(["deny", "deny"]);
        const sent = await session.raw.send({commandId: id(), input: {text: "没事了"}, settlePending: "deny"});
        if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
        expect((await session.raw.waitRun(sent.value.runId)).text).toBe("第二句也收到了");
    });

    test("只收用户：别的发出者得 not-allowed；空话、被拦截拒绝、replaces 过期时也不结算，事项照常等，之后应答一次就叫醒", async () => {
        const {session, runId, pending, nested} = await threePending();
        await using _ = session;
        const host = session.raw.as({kind: "host", source: {plugin: "lab.host", label: "日程"}});
        expect(await host.send({commandId: id(), input: {text: "我替用户说"}, settlePending: "deny"})).toMatchObject({ok: false, code: "not-allowed"});
        expect(await session.raw.send({commandId: id(), input: {text: "  "}, settlePending: "deny"})).toMatchObject({ok: false, code: "empty-input"});
        expect(await session.raw.send({commandId: id(), input: {text: "有禁词"}, settlePending: "deny"})).toMatchObject({ok: false, code: "input-rejected"});
        expect(await session.raw.send({commandId: id(), input: {text: "换掉"}, settlePending: "deny", replaces: [{id: "nope", edits: 0}]})).toMatchObject({ok: false, code: "input-stale"});
        expect(dataOf(await session.events(), "interactionResolved").filter((data) => pending.some((item) => item.id === data.id))).toEqual([]);
        for (const item of pending) expect(await session.raw.resolve({commandId: id(), id: item.id, decision: "deny"})).toMatchObject({ok: true});
        expect(await nested).toBe("declined");
        await session.raw.waitRun(runId);
        expect(dataOf(await session.events(), "interactionResolved").filter((data) => pending.some((item) => item.id === data.id))).toHaveLength(3);
    });

    test("同一个 commandId 用户受理过，重开会话后换成别的发出者重发：交回原来的结果，不再结算", async () => {
        const dir = join(root, "settle-replay");
        const {session, runId} = await threePending({store: {root: dir}});
        await using _ = session;
        const args = {commandId: id(), input: {text: "别改了"}, mode: "steer" as const, settlePending: "deny" as const};
        const first = await session.raw.send(args);
        expect(first).toMatchObject({ok: true});
        await session.raw.waitRun(runId);
        await session.reopen();
        const before = await session.events();
        const again = await session.raw.as({kind: "host", source: {plugin: "lab.host", label: "日程"}}).send(args);
        expect(again).toMatchObject({ok: true, replayed: true, value: first.ok ? first.value : {}});
        expect(await session.events()).toEqual(before);
    });

    test("带 settlePending 发话时会话被关闭：重开后每个同步事项恰好一条结算，没有悬空的", async () => {
        const dir = join(root, "settle-close");
        const {session} = await threePending({store: {root: dir}});
        await using _ = session;
        const sending = session.raw.send({commandId: id(), input: {text: "别改了"}, mode: "steer", settlePending: "deny"});
        await Promise.resolve();
        await session.close();
        await sending;
        await session.reopen();
        const events = await session.events();
        const requested = dataOf<{id: string; async: boolean}>(events, "interactionRequested").filter((data) => !data.async).map((data) => data.id);
        const resolved = dataOf<{id: string}>(events, "interactionResolved").map((data) => data.id);
        expect(new Set(resolved)).toEqual(new Set(requested));
        expect(resolved).toHaveLength(requested.length);
    });

    test("输出 111：只结算同步的事项：同时挂着的异步提问不动，之后照常能应答", async () => {
        const later: TestTool = {id: "lab.later", execute: async (_args, context) => {
            await context.ask!({question: "要几章？"}, {async: true});
            return "先接着做";
        }};
        await using session = await createTestSession({approve: askForWrites, tools: [later, writer("lab.write")]});
        session.model.script({tools: [{tool: "lab.later"}]}, {tools: [{tool: "lab.write"}]}, "知道了", "收到");
        const runId = await sendRaw(session, "先问后写");
        const [approval] = await waitingFor(session, 1);
        const asynchronous = dataOf<{id: string; async?: boolean}>(await session.events(), "interactionRequested").find((data) => data.async === true)!;
        expect(await session.raw.send({commandId: id(), input: {text: "别写了"}, settlePending: "deny"})).toMatchObject({ok: true});
        await session.raw.waitRun(runId);
        expect(dataOf<{id: string}>(await session.events(), "interactionResolved").map((data) => data.id)).toEqual([approval!.id]);
        expect(await session.raw.resolve({commandId: id(), id: asynchronous.id, decision: "answer", answer: {text: "三章"}})).toMatchObject({ok: true});
        expect(dataOf<{id: string; decision: string}>(await session.events(), "interactionResolved").map((data) => [data.id, data.decision])).toEqual([[approval!.id, "deny"], [asynchronous.id, "answer"]]);
    });

    test("受理批写下了、同步到盘失败（结果不确定）：发话得 log-broken，等着的提问以 aborted 收到、不再往坏了的句柄上写，重开只有一条结算", async () => {
        const dir = join(root, "settle-sync-fault");
        let failSync = false;
        const files = {...nodeFiles, async openAppend(path: string) {
            const file = await nodeFiles.openAppend(path);
            return {...file, async sync() {
                if (failSync) {
                    failSync = false;
                    throw Object.assign(new Error("injected sync fault"), {code: "EIO"});
                }
                await file.sync();
            }};
        }};
        let received = "";
        const answered = gate();
        const session = await createTestSession({wrapStore: () => createJsonlStore({root: dir, files}), tools: [{id: "lab.ask", execute: async (_args, ctx) => {
            try {
                const reply = await ctx.ask!({question: "继续吗？"});
                received = reply.kind === "unavailable" ? reply.code : reply.kind;
            } catch (error) {
                received = `threw ${(error as Error).name}`;
            }
            answered.open();
            return "问过了";
        }}]});
        await using _ = session;
        session.model.script({tools: [{tool: "lab.ask"}]}, "好");
        const waiting = waitingFor(session, 1);
        const runId = await sendRaw(session, "问一下");
        await waiting;
        failSync = true;
        expect(await session.raw.send({commandId: "settle-sync", input: {text: "不用了"}, settlePending: "deny"})).toMatchObject({ok: false, code: "log-broken"});
        await answered.promise;
        expect(received).toBe("aborted");
        // 句柄坏了的运行自己收不了口：等它交回 log-broken 再关，关之后它不再写。
        expect(await session.raw.waitRun(runId)).toMatchObject({reason: "error"});
        await session.close();
        const store = createJsonlStore({root: dir});
        const reopened = await store.open(session.id);
        if (!reopened.ok) throw new Error(reopened.code);
        const decisions = dataOf<{decision: string}>(reopened.value.events, "interactionResolved").map((data) => data.decision);
        await store.close(reopened.value);
        expect(decisions).toEqual(["deny"]);
    });
});

describe("会话之间的输入与交回的运行", () => {
    const parent = {kind: "session", id: "parent"} as const;
    /** 全部事件：`inputQueued` 是 session 事件，不在路径上。 */
    const allEvents = async (session: TestSession) => (await session.raw.log({afterSeq: 0, limit: 10_000})).events;

    test("输出 85：会话以自己的身份发的话，缓冲区与路径上的事件都记 by；用户发的不记", async () => {
        await using session = await createTestSession({caller: {kind: "session", id: "parent", callId: "c1"}});
        session.model.script("收到", "也收到");
        const sent = await session.raw.as(parent).send({commandId: id(), input: {text: "查一下第三章"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send did not start a run");
        await session.raw.waitRun(sent.value.runId);
        await session.say("我自己也说一句");
        const events = await allEvents(session);
        expect(dataOf(events, "inputQueued").map((data) => data.by)).toEqual([parent, undefined]);
        expect(dataOf(events, "input").map((data) => data.by)).toEqual([parent, undefined]);
    });

    test("输出 85、106：会话在空闲时排的话留着，用户 resume 放行后开运行，路径上的 input 仍记发出者", async () => {
        await using session = await createTestSession({caller: {kind: "session", id: "parent", callId: "c1"}});
        session.model.script("收到");
        expect(await session.raw.as(parent).enqueue({commandId: id(), input: {text: "排在后面的话"}, mode: "followup"})).toMatchObject({ok: true, value: {placement: "held"}});
        expect(await session.raw.start({commandId: id()})).toEqual({ok: false, code: "nothing-to-continue"});
        const resumed = await session.raw.resume({commandId: id()});
        if (!resumed.ok || resumed.value.runId === null) throw new Error("resume did not start a run");
        await session.raw.waitRun(resumed.value.runId);
        expect(dataOf(await session.events(), "input").map((data) => [data.text, data.by])).toEqual([["排在后面的话", parent]]);
    });

    test("输出 85、88：插进在跑的运行时交回它的 runId，插话带着 by 送达", async () => {
        const release = gate();
        const started = gate();
        const slow: TestTool = {id: "lab.slow", concurrency: "shared", execute: async () => {
            started.open();
            await release.promise;
            return "读完了";
        }};
        await using session = await createTestSession({tools: [slow]});
        session.model.script({tools: [{tool: "lab.slow"}]}, "照做了");
        const runId = await sendRaw(session, "读一下");
        await started.promise;
        const sent = await session.raw.as(parent).send({commandId: id(), input: {text: "顺便看第五章"}, mode: "steer"});
        expect(sent).toMatchObject({ok: true, value: {runId: null, currentRunId: runId}});
        const queued = await session.raw.as(parent).enqueue({commandId: id(), input: {text: "之后再说"}, mode: "followup"});
        expect(queued).toMatchObject({ok: true, value: {currentRunId: runId}});
        release.open();
        await session.raw.waitRun(runId);
        expect(dataOf(await session.events(), "steer").map((data) => [data.text, data.by])).toEqual([["顺便看第五章", parent]]);
    });

    test("输出 88：应答同步提问交回被叫醒的运行；空闲时应答异步提问交回它开的运行", async () => {
        const asker: TestTool = {id: "lab.ask", execute: async (_args, context) => {
            const answer = await context.ask!({question: "叫什么？"});
            return answer.kind === "answer" ? answer.text : "没答";
        }};
        const later: TestTool = {id: "lab.later", execute: async (_args, context) => {
            await context.ask!({question: "要几章？"}, {async: true});
            return "先接着做";
        }};
        await using session = await createTestSession({tools: [asker, later], questions: "caller", caller: {kind: "session", id: "parent", callId: "c1"}});
        session.model.script({tools: [{tool: "lab.ask"}]}, "好", {tools: [{tool: "lab.later"}]}, "先写着", "收到");
        const runId = await sendRaw(session, "问我");
        const [question] = await waitingFor(session, 1);
        expect(await session.raw.as(parent).resolve({commandId: id(), id: question!.id, decision: "answer", answer: {text: "林舟"}})).toMatchObject({ok: true, value: {runId}});
        await session.raw.waitRun(runId);

        const second = await sendRaw(session, "再来");
        await session.raw.waitRun(second);
        const asked = dataOf<{id: string}>(await session.events(), "interactionRequested").at(-1)!;
        const answered = await session.raw.as(parent).resolve({commandId: id(), id: asked.id, decision: "answer", answer: {text: "三章"}});
        if (!answered.ok || answered.value.runId === undefined) throw new Error("the answer did not start a run");
        expect(answered.value.runId).not.toBe(second);
        await session.raw.waitRun(answered.value.runId);
        expect(dataOf(await session.events(), "input").at(-1)).toMatchObject({text: "三章", by: parent});
    });
});

describe("受理批写下、反应批写失败（runtime.md 输出 119，session.md 输出 12）", () => {
    /** 只让引出 `extensionFailed` 的那一批（反应批）写失败一次：受理批照常写下。 */
    const failReactionOnce = () => {
        let failed = false;
        return (store: LogStore): LogStore => ({...store, append: async (handle, events) => {
            if (!failed && events.some((event) => event.type === "extensionFailed")) {
                failed = true;
                return {ok: false, code: "storage-failed", detail: {message: "injected reaction-batch failure"}};
            }
            return store.append(handle, events);
        }});
    };
    /** 对 `type` 事件起反应时抛错的扩展：内核把它记成一批 `extensionFailed`，这批就是要写失败的反应批。 */
    const throwsOn = (type: string) => defineExtension({id: "lab.reacts", on: {[type]: () => {
        throw new Error("reaction fails");
    }}});
    /** 记下状态帧的先后。 */
    const statusesOf = (session: TestSession) => {
        const states: RunStatus["state"][] = [];
        session.raw.subscribe((frame) => {
            if (frame.type === "status") states.push(frame.status.state);
        });
        return states;
    };
    /** 同步提问的工具：记下 `ctx.ask` 交回什么。 */
    const asker = () => {
        const answered = Promise.withResolvers<string>();
        const tool: TestTool = {id: "lab.ask", execute: async (_args, ctx) => {
            const reply = await ctx.ask!({question: "继续吗？"});
            answered.resolve(reply.kind === "unavailable" ? reply.code : reply.kind);
            return "问过了";
        }};
        return {tool, answered: answered.promise};
    };
    /** 损坏之后：状态与快照停在 broken，新指令得 log-broken。 */
    async function expectBroken(session: TestSession, states: readonly string[]): Promise<void> {
        const first = states.indexOf("broken");
        expect(first).toBeGreaterThanOrEqual(0);
        expect(states.slice(first).every((state) => state === "broken")).toBe(true);
        expect((await session.raw.snapshot()).status.state).toBe("broken");
        expect(await session.raw.setTitle({commandId: id(), title: "之后"})).toMatchObject({ok: false, code: "log-broken"});
    }

    test("resolve：回执成功，等着的工具拿到与日志一致的结算；状态停在 broken、之后的指令 log-broken；同键重发与重开后重发都成功", async () => {
        const dir = join(root, "reaction-resolve");
        const {tool, answered} = asker();
        await using session = await createTestSession({wrapStore: () => failReactionOnce()(createJsonlStore({root: dir})), extensions: [throwsOn("interactionResolved")], tools: [tool]});
        session.model.script({tools: [{tool: "lab.ask"}]}, "好");
        const waiting = waitingFor(session, 1);
        const runId = await sendRaw(session, "问一下");
        const [item] = await waiting;
        const states = statusesOf(session);
        const args = {commandId: id(), id: item!.id, decision: "deny"} as const;
        expect(await session.raw.resolve(args)).toMatchObject({ok: true, replayed: false});
        expect(await answered).toBe("declined");
        const log = (await session.raw.log({afterSeq: 0})).events;
        expect(dataOf<{decision: string}>(log, "interactionResolved").map((data) => data.decision)).toEqual(["deny"]);
        expect(await session.raw.waitRun(runId)).toMatchObject({reason: "error"});
        await expectBroken(session, states);
        expect(await session.raw.resolve(args)).toMatchObject({ok: true, replayed: true});
        await session.reopen();
        expect(await session.raw.resolve(args)).toMatchObject({ok: true, replayed: true});
    });

    test("send{settlePending}：回执成功，等着的工具拿到 deny 的结算；状态停在 broken", async () => {
        const dir = join(root, "reaction-settle");
        const {tool, answered} = asker();
        await using session = await createTestSession({wrapStore: () => failReactionOnce()(createJsonlStore({root: dir})), extensions: [throwsOn("interactionResolved")], tools: [tool]});
        session.model.script({tools: [{tool: "lab.ask"}]}, "好");
        const waiting = waitingFor(session, 1);
        await sendRaw(session, "问一下");
        await waiting;
        const states = statusesOf(session);
        expect(await session.raw.send({commandId: id(), input: {text: "不用了"}, settlePending: "deny"})).toMatchObject({ok: true, replayed: false});
        expect(await answered).toBe("declined");
        await expectBroken(session, states);
    });

    test("send 带 settlePending 却没有可结算的同步事项：等于普通发话，反应批写失败时回执 log-broken（runtime.md 输出 111）", async () => {
        const dir = join(root, "reaction-empty-settle");
        await using session = await createTestSession({wrapStore: () => failReactionOnce()(createJsonlStore({root: dir})), extensions: [throwsOn("inputQueued")]});
        expect(await session.raw.send({commandId: id(), input: {text: "没什么要拒的"}, settlePending: "deny"})).toMatchObject({ok: false, code: "log-broken"});
        expect(dataOf((await session.raw.log({afterSeq: 0})).events, "interactionResolved")).toEqual([]);
    });

    test("健康时：结算的反应还在跑，等着的工具不往下走；反应写下之后才叫醒", async () => {
        const hold = gate();
        const entered = gate();
        const slow = defineExtension({id: "lab.slow", on: {interactionResolved: async () => {
            entered.open();
            await hold.promise;
        }}});
        const {tool, answered} = asker();
        let woke = false;
        void answered.then(() => {
            woke = true;
        });
        await using session = await createTestSession({extensions: [slow], tools: [tool]});
        session.model.script({tools: [{tool: "lab.ask"}]}, "好");
        const waiting = waitingFor(session, 1);
        const runId = await sendRaw(session, "问一下");
        const [item] = await waiting;
        const resolving = session.raw.resolve({commandId: id(), id: item!.id, decision: "deny"});
        await entered.promise;
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(woke).toBe(false);
        hold.open();
        expect(await resolving).toMatchObject({ok: true});
        expect(await answered).toBe("declined");
        await session.raw.waitRun(runId);
    });

    test("空闲时回答异步提问、它的反应批写失败：回执成功，不开运行（下一轮该退役的工具没有退役、模型没收到新请求）", async () => {
        const dir = join(root, "reaction-async");
        let disposed = 0;
        let declared = true;
        const question: TestTool = {id: "lab.later", execute: async (_args, ctx) => {
            await ctx.ask!({question: "以后再说？"}, {async: true});
            return "先这样";
        }, dispose: () => {
            disposed += 1;
        }};
        // 第一轮之后不再声明这个工具：开了运行的话，第一个边界（写任何东西之前）就会退役它。
        await using session = await createTestSession({wrapStore: () => failReactionOnce()(createJsonlStore({root: dir})), extensions: [throwsOn("interactionResolved")], tools: () => (declared ? [question] : [])});
        session.model.script({tools: [{tool: "lab.later"}]}, "好");
        await session.say("问一个以后答的");
        declared = false;
        const asyncId = dataOf<{id: string; async?: boolean}>((await session.raw.log({afterSeq: 0})).events, "interactionRequested").find((data) => data.async === true)!.id;
        const requestsBefore = session.model.requests.length;
        const answered = await session.raw.resolve({commandId: id(), id: asyncId, decision: "answer", answer: {text: "现在答"}});
        if (!answered.ok || answered.value.runId === undefined) throw new Error(JSON.stringify(answered));
        expect(answered.replayed).toBe(false);
        // 等这次运行的结果作检查点：开了运行的话它在第一个边界之后才结束，退役已经发生。
        expect(await session.raw.waitRun(answered.value.runId)).toMatchObject({error: {code: "log-broken"}});
        expect(disposed).toBe(0);
        expect(session.model.requests.length).toBe(requestsBefore);
        expect((await session.raw.snapshot()).status.state).toBe("broken");
    });

    test("只读重开（原 Profile 不在了）：已提交的 resolve 同键重发交回原结果，新的应答得 read-only", async () => {
        const dir = join(root, "reaction-readonly");
        const {tool, answered} = asker();
        const own = defineProfile({id: "lab.gone", version: "1", name: "会消失的", description: "重开时解析不到"}) as AnyProfile;
        const first = await createTestSession({profile: own, wrapStore: () => failReactionOnce()(createJsonlStore({root: dir})), extensions: [throwsOn("interactionResolved")], tools: [tool]});
        first.model.script({tools: [{tool: "lab.ask"}]}, "好");
        const waiting = waitingFor(first, 1);
        await sendRaw(first, "问一下");
        const [item] = await waiting;
        const args = {commandId: id(), id: item!.id, decision: "deny"} as const;
        const accepted = await first.raw.resolve(args);
        if (!accepted.ok) throw new Error(accepted.code);
        await answered;
        await first.close();
        await using reopened = await createTestSession({store: {root: dir}, open: first.id});
        expect((await reopened.raw.snapshot()).readOnly).toEqual({code: "unknown-profile"});
        expect(await reopened.raw.resolve(args)).toEqual({...accepted, replayed: true});
        expect(await reopened.raw.resolve({commandId: id(), id: item!.id, decision: "deny"})).toEqual({ok: false, code: "read-only"});
    });

    test("changeProfile（不是应答）：回执照旧 log-broken；不卸载旧扩展、不装新 Profile 的扩展，快照仍是旧 Profile", async () => {
        let newMounts = 0;
        let oldCleanups = 0;
        const fresh = defineExtension({id: "lab.fresh", mount: () => {
            newMounts += 1;
        }});
        const other = defineProfile({id: "lab.other", version: "1", name: "另一个", description: "换过去的", extensions: [fresh]}) as AnyProfile;
        // 只对用户换 Profile 起反应时抛错：建会话时的 profileChanged 照常。
        const watcher = defineExtension({id: "lab.watcher", on: {profileChanged: (event) => {
            if ((event.data as {reason: string}).reason === "user") throw new Error("reaction fails");
        }}, mount: () => () => {
            oldCleanups += 1;
        }});
        await using session = await createTestSession({profiles: [other], extensions: [watcher], wrapStore: failReactionOnce()});
        expect(await session.raw.changeProfile({commandId: id(), profile: "lab.other"})).toMatchObject({ok: false, code: "log-broken"});
        expect((await session.raw.snapshot()).profile.id).toBe("test.profile");
        expect(newMounts).toBe(0);
        expect(oldCleanups).toBe(0);
    });
});

/** 只让对 `type` 起反应的那一批（`extensionFailed`，cause 是这条事件）写失败一次。 */
function failReactionOnceFor(type: string) {
    let failed = false;
    const causes = new Set<string>();
    return (store: LogStore): LogStore => ({...store, append: async (handle, events) => {
        for (const event of events) if (event.type === type) causes.add(event.id);
        if (!failed && events.some((event) => event.type === "extensionFailed" && event.cause !== undefined && causes.has(event.cause))) {
            failed = true;
            return {ok: false, code: "storage-failed", detail: {message: "injected reaction-batch failure"}};
        }
        return store.append(handle, events);
    }});
}

/** 记下状态帧的先后（从调用时起）。 */
function statusesOf2(session: TestSession): RunStatus["state"][] {
    const states: RunStatus["state"][] = [];
    session.raw.subscribe((frame) => {
        if (frame.type === "status") states.push(frame.status.state);
    });
    return states;
}

describe("损坏之后的等待者与停止（runtime.md 输出 13、30）", () => {
    test("句柄坏了以后新的 abort 得 log-broken，不登记；之后没有非 broken 的状态帧", async () => {
        const block = gate();
        const failNext = {on: false};
        const wrap = (store: LogStore): LogStore => ({...store, append: async (handle, events) => {
            if (failNext.on) {
                failNext.on = false;
                return {ok: false, code: "storage-failed", detail: {message: "injected"}};
            }
            return store.append(handle, events);
        }});
        await using session = await createTestSession({wrapStore: wrap, tools: [{id: "lab.block", execute: async () => {
            await block.promise;
            return "完";
        }}]});
        session.model.script({tools: [{tool: "lab.block"}]}, "好");
        const runId = await sendRaw(session, "跑");
        await new Promise((resolve) => setTimeout(resolve, 10));
        const states = statusesOf2(session);
        failNext.on = true;
        expect(await session.raw.setTitle({commandId: id(), title: "坏"})).toMatchObject({ok: false, code: "log-broken"});
        expect(await session.raw.abort({commandId: id()})).toEqual({ok: false, code: "log-broken"});
        block.open();
        expect(await session.raw.waitRun(runId)).toMatchObject({error: {code: "log-broken"}});
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(states.length).toBeGreaterThan(0);
        expect(states.every((state) => state === "broken")).toBe(true);
    });

    test("受理批写下、因反应批失败没开起来的运行：订阅到 runStarted 时登记的 waitRun 交回 log-broken，不挂住", async () => {
        const dir = join(root, "reaction-waitrun");
        await using session = await createTestSession({wrapStore: () => failReactionOnceFor("runStarted")(createJsonlStore({root: dir})), extensions: [defineExtension({id: "lab.reacts", on: {runStarted: () => {
            throw new Error("reaction fails");
        }}})]});
        let waited: Promise<unknown> | null = null;
        session.raw.subscribe((frame) => {
            if (frame.type === "log" && frame.event.type === "runStarted" && waited === null) waited = session.raw.waitRun((frame.event.data as {runId: string}).runId);
        });
        expect(await session.raw.send({commandId: id(), input: {text: "跑"}})).toMatchObject({ok: false, code: "log-broken"});
        expect(waited).not.toBeNull();
        expect(await waited).toMatchObject({error: {code: "log-broken"}});
    });

    test("回退后接着跑（复用 run id）、跑起来之后才坏：已登记的 waitRun 交回 log-broken，不拿旧分支的收口", async () => {
        const block = gate();
        const started = gate();
        const failNext = {on: false};
        const wrap = (store: LogStore): LogStore => ({...store, append: async (handle, events) => {
            if (failNext.on) {
                failNext.on = false;
                return {ok: false, code: "storage-failed", detail: {message: "injected"}};
            }
            return store.append(handle, events);
        }});
        await using session = await createTestSession({wrapStore: wrap, tools: [{id: "lab.read", execute: () => "读到了"}, {id: "lab.block", execute: async () => {
            started.open();
            await block.promise;
            return "完";
        }}]});
        session.model.script({tools: [{tool: "lab.read"}]}, "答一");
        await session.say("第一问");
        const step = (await session.raw.rewindTargets()).filter((target) => target.kind === "after-step").at(-1)!;
        await session.raw.rewind({commandId: id(), to: step.id});
        session.model.script({tools: [{tool: "lab.block"}]}, "答二");
        const resumed = await session.raw.start({commandId: id()});
        if (!resumed.ok) throw new Error(resumed.code);
        await started.promise;
        const waiting = session.raw.waitRun(resumed.value.runId);
        failNext.on = true;
        expect(await session.raw.setTitle({commandId: id(), title: "坏"})).toMatchObject({ok: false, code: "log-broken"});
        expect(await waiting).toMatchObject({reason: "error", error: {code: "log-broken"}});
        block.open();
    });

    test("runEnded 写下、它的反应批写失败：损坏前登记的与之后再来的 waitRun 交回同一个结果（日志里的那次收口）", async () => {
        const dir = join(root, "reaction-runended");
        await using session = await createTestSession({wrapStore: () => failReactionOnceFor("runEnded")(createJsonlStore({root: dir})), extensions: [defineExtension({id: "lab.reacts", on: {runEnded: () => {
            throw new Error("reaction fails");
        }}})]});
        session.model.script("好");
        const runId = await sendRaw(session, "跑");
        const early = await session.raw.waitRun(runId);
        const late = await session.raw.waitRun(runId);
        expect(early).toMatchObject({reason: "completed"});
        expect(late).toEqual(early);
        expect((await session.raw.snapshot()).status.state).toBe("broken");
    });
});
