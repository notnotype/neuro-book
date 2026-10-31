/**
 * 运行控制：缓冲区、设置、标题与归档、恢复（t20 第 6 片）。测试名里的编号是 docs/specs/harness/runtime.md 的
 * 输出条目与验收场景，“session 场景”指 docs/specs/harness/session.md。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {Type} from "typebox";
import type {LogEvent} from "../api/index.js";
import {defineExtension} from "../extension/define.js";
import {createTestSession, type TestSession, type TestTool} from "../testing/test-session.js";

let root = "";
beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness", "kernel-control");
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

function gate<T = void>() {
    let open!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
        open = resolve;
    });
    return {promise, open};
}

const types = (events: readonly LogEvent[]) => events.map((event) => event.type);
const dataOf = <T = Record<string, unknown>>(events: readonly LogEvent[], type: string) => events.filter((event) => event.type === type).map((event) => event.data as T);
let commands = 0;
const id = () => `c-${(commands += 1)}`;

/** 一个停住的工具：测试在它执行期间发指令。 */
function blockingTool(toolId = "lab.block") {
    const started = gate();
    const release = gate();
    const tool: TestTool = {id: toolId, execute: async () => {
        started.open();
        await release.promise;
        return "放行了";
    }};
    return {tool, started: started.promise, release: () => release.open()};
}

async function sendRaw(session: TestSession, text: string): Promise<string> {
    const sent = await session.raw.send({commandId: id(), input: {text}});
    if (!sent.ok || sent.value.runId === null) throw new Error("send did not start a run");
    return sent.value.runId;
}

describe("steer 与 followup", () => {
    test("输出 28：运行中入队的 steer 在下一个边界全部取走、进当前这一轮", async () => {
        const block = blockingTool();
        await using session = await createTestSession({tools: [block.tool]});
        session.model.script({tools: [{tool: "lab.block"}]}, "收到插话");
        const runId = await sendRaw(session, "问");
        await block.started;
        await session.raw.enqueue({commandId: id(), input: {text: "插话一"}, mode: "steer"});
        await session.raw.enqueue({commandId: id(), input: {text: "插话二"}, mode: "steer"});
        block.release();
        await session.raw.waitRun(runId);
        const events = await session.events();
        const steers = events.filter((event) => event.type === "steer");
        expect(steers.map((event) => (event.data as {text: string}).text)).toEqual(["插话一", "插话二"]);
        expect(new Set(steers.map((event) => event.seq - steers[0]!.seq))).toEqual(new Set([0, 2]));
        expect(session.requests[1]!.outline().at(-1)).toBe("user: event:steer | event:steer");
        expect((await session.raw.snapshot()).buffer).toEqual([]);
        expect(dataOf(events, "turnStarted")).toHaveLength(1);
    });

    test("输出 28：最终回复时还有没取走的 steer，这一轮接着请求", async () => {
        const holding = gate();
        const replying = gate();
        let calls = 0;
        const hold = defineExtension({id: "lab.hold", intercept: {model: async (request, next) => {
            calls += 1;
            if (calls === 1) {
                replying.open();
                await holding.promise;
            }
            return next(request);
        }}});
        await using session = await createTestSession({extensions: [hold]});
        session.model.script("第一版", "按插话改过");
        const runId = await sendRaw(session, "问");
        await replying.promise;
        await session.raw.enqueue({commandId: id(), input: {text: "等一下"}, mode: "steer"});
        holding.open();
        const result = await session.raw.waitRun(runId);
        expect(result.text).toBe("按插话改过");
        const events = await session.events();
        expect(types(events).filter((type) => ["assistant", "steer", "turnEnded"].includes(type))).toEqual(["assistant", "steer", "assistant", "turnEnded"]);
    });

    test("输出 28：最终回复时扩展要 continue、缓冲区又有 steer，两者都进下一次请求", async () => {
        const holding = gate();
        const replying = gate();
        let calls = 0;
        const hold = defineExtension({id: "lab.hold", intercept: {model: async (request, next) => {
            calls += 1;
            if (calls === 1) {
                replying.open();
                await holding.promise;
            }
            return next(request);
        }}});
        let asked = false;
        const nudger = defineExtension({id: "lab.nudge", on: {assistant: (_event, ctx) => {
            if (!asked) asked = ctx.continue("再补一句");
        }}});
        await using session = await createTestSession({extensions: [hold, nudger]});
        session.model.script("第一版", "补过的");
        const runId = await sendRaw(session, "问");
        await replying.promise;
        await session.raw.enqueue({commandId: id(), input: {text: "插话"}, mode: "steer"});
        holding.open();
        await session.raw.waitRun(runId);
        expect(session.requests[1]!.outline().at(-1)).toBe("user: event:continued | event:steer");
    });

    test("输出 30：轮以 error 结束时不取 followup，缓冲区留着", async () => {
        await using session = await createTestSession();
        session.model.script({fail: "network"});
        await session.raw.enqueue({commandId: id(), input: {text: "排着的"}, mode: "followup"});
        const runId = await sendRaw(session, "问");
        expect((await session.raw.waitRun(runId)).reason).toBe("error");
        expect((await session.raw.snapshot()).buffer.map((item) => item.input.text)).toEqual(["排着的"]);
    });
});

describe("改与删", () => {
    test("输出 29、33：改与删只对缓冲区里的；已取走的得 input-consumed，没有的得 input-not-found；按 commandId 幂等", async () => {
        const reject = defineExtension({id: "lab.reject", intercept: {input: async (input, next) => (input.text.includes("禁词") ? {reject: {code: "banned"}} : next(input))}});
        await using session = await createTestSession({extensions: [reject]});
        const first = await session.raw.enqueue({commandId: id(), input: {text: "第一条"}, mode: "followup"});
        const second = await session.raw.enqueue({commandId: id(), input: {text: "第二条"}, mode: "followup"});
        if (!first.ok || !second.ok) throw new Error("enqueue failed");
        const edit = {commandId: id(), inputId: first.value.inputId, input: {text: "第一条（改）"}};
        expect(await session.raw.edit(edit)).toMatchObject({ok: true, replayed: false});
        expect(await session.raw.edit(edit)).toMatchObject({ok: true, replayed: true});
        expect(await session.raw.edit({commandId: id(), inputId: first.value.inputId, input: {text: "有禁词"}})).toMatchObject({ok: false, code: "input-rejected", detail: {code: "banned", by: "lab.reject"}});
        expect(await session.raw.remove({commandId: id(), inputId: second.value.inputId})).toMatchObject({ok: true});
        expect(await session.raw.remove({commandId: id(), inputId: second.value.inputId})).toEqual({ok: false, code: "input-consumed"});
        expect(await session.raw.edit({commandId: id(), inputId: "nope", input: {text: "x"}})).toEqual({ok: false, code: "input-not-found"});
        const snapshot = await session.raw.snapshot();
        expect(snapshot.buffer.map((item) => [item.input.text, item.edits])).toEqual([["第一条（改）", 1]]);
        expect(dataOf(await session.raw.log({afterSeq: 0}).then((page) => page.events), "inputRemoved")).toEqual([{id: second.value.inputId, reason: "user"}]);
    });
});

describe("中止", () => {
    test("输出 30：中止了运行时缺省清空缓冲区，keepQueue 保留；没有运行时不动", async () => {
        for (const keepQueue of [false, true]) {
            const block = blockingTool();
            await using session = await createTestSession({tools: [block.tool]});
            session.model.script({tools: [{tool: "lab.block"}]});
            const runId = await sendRaw(session, "问");
            await block.started;
            await session.raw.enqueue({commandId: id(), input: {text: "排着的"}, mode: "followup"});
            const aborting = session.raw.abort({commandId: id(), keepQueue});
            block.release();
            expect(await aborting).toMatchObject({ok: true, value: {aborted: true}});
            expect((await session.raw.waitRun(runId)).reason).toBe("aborted");
            const snapshot = await session.raw.snapshot();
            expect(snapshot.buffer.map((item) => item.input.text)).toEqual(keepQueue ? ["排着的"] : []);
            if (!keepQueue) expect(dataOf(await session.events().then(() => session.raw.log({afterSeq: 0})).then((page) => page.events), "inputRemoved")).toEqual([{id: expect.any(String), reason: "aborted"}]);
            expect(await session.raw.abort({commandId: id()})).toMatchObject({ok: true, value: {aborted: false}});
            expect((await session.raw.snapshot()).buffer).toHaveLength(keepQueue ? 1 : 0);
        }
    });
});

describe("设置、标题与归档", () => {
    test("输出 31：整体校验，有一项不合法就都不改", async () => {
        const configured = defineExtension({id: "lab.configured", settings: Type.Object({label: Type.String({default: "缺省"})})});
        await using session = await createTestSession({extensions: [configured]});
        expect(await session.raw.changeSettings({commandId: id(), patch: {"lab.nope": {x: 1}}})).toEqual({ok: false, code: "unknown-extension"});
        expect(await session.raw.changeSettings({commandId: id(), patch: {core: {readOnly: true}, "lab.configured": {colour: "红"}}})).toEqual({ok: false, code: "unknown-key", detail: {extension: "lab.configured", key: "colour"}});
        expect(await session.raw.changeSettings({commandId: id(), patch: {core: {approvalMode: "sometimes"}}})).toMatchObject({ok: false, code: "invalid-value", detail: {extension: "core", key: "approvalMode"}});
        expect((await session.raw.snapshot()).settings.readOnly).toBe(false);
        expect(await session.raw.changeSettings({commandId: id(), patch: {"lab.configured": {label: "缺省"}}})).toMatchObject({ok: true, value: {changed: []}});
        expect(await session.raw.changeSettings({commandId: id(), patch: {core: {readOnly: false}, "lab.configured": {label: "新标签"}}})).toMatchObject({ok: true, value: {changed: ["lab.configured"], scheduled: "now"}});
    });

    test("输出 31、18：只读模式下写与执行类工具被拒绝，等级函数出错按 exec 算；settingsChanged 只派发给设置所属的扩展", async () => {
        const seen: string[] = [];
        const listener = (name: string) => defineExtension({id: name, settings: Type.Object({level: Type.Number({default: 0})}), on: {settingsChanged: () => {
            seen.push(name);
        }}});
        const tools: TestTool[] = [
            {id: "lab.read", effect: "read", execute: () => "读到了"},
            {id: "lab.write", effect: "write", execute: () => "写了"},
            {id: "lab.shell", effect: () => {
                throw new Error("算不出等级");
            }, execute: () => "执行了"},
        ];
        await using session = await createTestSession({tools, extensions: [listener("lab.one"), listener("lab.two")]});
        await session.raw.changeSettings({commandId: id(), patch: {core: {readOnly: true}, "lab.one": {level: 2}}});
        expect(seen).toEqual(["lab.one"]);
        session.model.script({tools: [{tool: "lab.read"}, {tool: "lab.write"}, {tool: "lab.shell"}]}, "完成");
        const {events} = await session.say("问");
        expect(dataOf(events, "toolResult").map((data) => [data.tool, data.status, data.code ?? null, data.by ?? null])).toEqual([
            ["lab.read", "ok", null, null],
            ["lab.write", "denied", "read-only", "core"],
            ["lab.shell", "denied", "read-only", "core"],
        ]);
    });

    test("输出 31：运行中受理的设置立刻写下，下一次请求前生效", async () => {
        const block = blockingTool();
        const labelled = defineExtension({id: "lab.label", settings: Type.Object({label: Type.String({default: "旧"})}), contribute: {label: {volatile: true, value: ({settings}) => settings.label}}});
        await using session = await createTestSession({tools: [block.tool], extensions: [labelled]});
        session.model.script({tools: [{tool: "lab.block"}]}, "完成");
        const runId = await sendRaw(session, "问");
        await block.started;
        expect(await session.raw.changeSettings({commandId: id(), patch: {"lab.label": {label: "新"}}})).toMatchObject({ok: true, value: {scheduled: "next-boundary"}});
        block.release();
        await session.raw.waitRun(runId);
        const labels = session.requests.map((request) => request.raw.messages.at(-1)!.content.map((block) => (block as {text?: string}).text).join(""));
        expect(labels).toEqual(["旧", "新"]);
    });

    test("输出 32、33：标题与归档进快照；空标题被拒；重发只生效一次", async () => {
        await using session = await createTestSession();
        expect(await session.raw.setTitle({commandId: id(), title: "   "})).toEqual({ok: false, code: "empty-title"});
        const titled = {commandId: id(), title: " 雨夜 "};
        expect(await session.raw.setTitle(titled)).toMatchObject({ok: true, replayed: false});
        expect(await session.raw.setTitle(titled)).toMatchObject({ok: true, replayed: true});
        await session.raw.archive({commandId: id(), archived: true});
        const snapshot = await session.raw.snapshot();
        expect([snapshot.title, snapshot.archived]).toEqual(["雨夜", true]);
        const {events} = await session.raw.log({afterSeq: 0});
        expect(dataOf(events, "titleChanged")).toEqual([{title: "雨夜", by: "user"}]);
    });
});

describe("崩溃与恢复", () => {
    const fixture = join(import.meta.dir, "../../../tests/kernel/fixtures/crash-session.ts");

    /** 每种崩溃一个子目录：子进程里的会话 id 都从 test-1 起。 */
    async function crash(mode: "in-tool" | "after-accept" | "compacting"): Promise<{store: {root: string}; open: string}> {
        const dir = join(root, mode);
        const child = Bun.spawn(["bun", fixture, dir, mode], {stdout: "pipe", stderr: "inherit"});
        try {
            const reader = child.stdout.getReader();
            let text = "";
            while (!text.includes("\n")) {
                const {value, done} = await reader.read();
                if (done) throw new Error(`the child exited before announcing: ${text}`);
                text += new TextDecoder().decode(value);
            }
            const [what, sessionId] = text.trim().split(" ");
            expect(what).toBe(mode === "in-tool" ? "started" : mode === "compacting" ? "compacting" : "accepted");
            return {store: {root: dir}, open: sessionId!};
        } finally {
            child.kill(9);
            await child.exited;
        }
    }

    test("场景 5、输出 34、session 场景 4：工具执行中被 kill -9，重开后结算调用与运行，缓冲区还在", async () => {
        await using session = await createTestSession(await crash("in-tool"));
        const events = await session.events();
        expect(dataOf(events, "toolResult").map((data) => [data.tool, data.status, data.code, data.by ?? null])).toEqual([
            ["lab.block", "unknown", "interrupted", null],
            ["lab.never", "denied", "interrupted-before-approval", "core"],
        ]);
        expect(types(events).slice(-4)).toEqual(["toolResult", "toolResult", "turnEnded", "runEnded"]);
        expect(dataOf(events, "runEnded").at(-1)).toMatchObject({reason: "interrupted"});
        expect((await session.raw.snapshot()).buffer.map((item) => item.input.text)).toEqual(["排着的"]);
        session.model.script("接着来");
        const resumed = await session.raw.start({commandId: id()});
        if (!resumed.ok) throw new Error(resumed.code);
        expect((await session.raw.waitRun(resumed.value.runId)).text).toBe("接着来");
    });

    test("场景 5：受理批写下、循环开始前被杀，重开后运行 interrupted，重发同一个 commandId 得第一次的值", async () => {
        await using session = await createTestSession(await crash("after-accept"));
        const events = await session.events();
        expect(types(events).slice(-1)).toEqual(["runEnded"]);
        expect(dataOf(events, "runEnded").at(-1)).toMatchObject({reason: "interrupted"});
        const accepted = dataOf<{commandId: string; value: {runId: string}}>(await session.raw.log({afterSeq: 0}).then((page) => page.events), "commandAccepted").find((data) => data.commandId === "first")!;
        const again = await session.raw.send({commandId: "first", input: {text: "问"}});
        expect(again).toMatchObject({ok: true, replayed: true, value: accepted.value});
    });

    test("输出 34：压缩方法的模型请求发出后被 kill -9，重开后这次请求结算为 interrupted，只压缩的运行收口", async () => {
        await using session = await createTestSession(await crash("compacting"));
        const events = await session.events();
        const compactionRequest = dataOf<{request: number; purpose: string}>(events, "modelStarted").find((data) => data.purpose === "compaction")!;
        expect(dataOf(events, "modelFailed")).toContainEqual({request: compactionRequest.request, kind: "interrupted"});
        expect(dataOf(events, "runEnded").at(-1)).toMatchObject({reason: "interrupted"});
        expect(types(events)).not.toContain("compaction");
    });
});
