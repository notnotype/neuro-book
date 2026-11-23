/**
 * 输入缓冲区的条目状态：就绪与留着、放行、回到空闲时留着（docs/specs/harness/runtime.md 输出 103–110）。
 * 内核是真的（日志、归约、单写者）；日志里事先写好的事件经真实的 JSONL 存储写下、再打开。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {LogEvent, LogStore} from "../api/index.js";
import {defineExtension} from "../extension/define.js";
import {defineProfile} from "../extension/profile.js";
import {createJsonlStore} from "../log/jsonl-store.js";
import {closeSession} from "../session/session.js";
import {createTestSession, defaultTestProfile, type TestTool} from "../testing/test-session.js";

let root: string;
beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness-buffer-");
});
afterAll(async () => {
    await rm(root, {recursive: true, force: true});
});

/** 在 JSONL 存储里写下一个会话：会话创建、装配，再加上给定的 session 事件。 */
async function writeSession(id: string, events: readonly {type: string; data: unknown}[]): Promise<void> {
    const store = createJsonlStore({root});
    const created = await store.create({format: 1, id, createdAt: 0, profile: defaultTestProfile.id, questions: "user"});
    if (!created.ok) throw new Error(created.code);
    const at = (seq: number, type: string, parent: string | null, scope: "path" | "session", data: unknown): LogEvent => ({id: `e${seq}`, seq, at: seq, parent, scope, kind: "ctrl", type, version: 1, source: "kernel", data: data as never});
    const head = [
        at(1, "sessionCreated", null, "path", {initial: {}}),
        at(2, "profileChanged", null, "session", {profile: defaultTestProfile.id, hash: "old", from: null, reason: "created", manifest: []}),
    ];
    const rest = events.map((event, index) => at(index + 3, event.type, null, "session", event.data));
    for (const event of [...head, ...rest]) {
        const appended = await store.append(created.value, [event]);
        if (!appended.ok) throw new Error(appended.code);
    }
    await store.close(created.value);
}

const queued = (id: string, extra: Record<string, unknown> = {}) => ({type: "inputQueued", data: {id, mode: "followup", input: {text: id}, ...extra}});

describe("缓冲区条目的状态（harness.runtime 输出 103、109）", () => {
    test("输出 103：状态只由会话级事件归约；留着带原因与停的人，放行转回就绪", async () => {
        await writeSession("states", [
            queued("a"),
            queued("b"),
            queued("c", {by: {kind: "host", source: {plugin: "nbook.schedule", label: "每周简报"}}, state: "held", cause: {queued: "idle"}}),
            queued("d", {mode: "steer"}),
            {type: "inputHeld", data: {ids: ["a", "b", "d"], cause: {end: "aborted"}, heldBy: {kind: "user"}}},
            {type: "inputReleased", data: {ids: ["b", "d"], mode: "followups"}},
        ]);
        await using session = await createTestSession({store: {root}, open: "states"});
        const buffer = (await session.raw.snapshot()).buffer;
        expect(buffer.map((item) => [item.id, item.state, item.mode])).toEqual([
            ["a", "held", "followup"],
            ["b", "ready", "followup"],
            ["c", "held", "followup"],
            ["d", "ready", "followup"],
        ]);
        expect(buffer[0]).toMatchObject({cause: {end: "aborted"}, heldBy: {kind: "user"}});
        expect(buffer[1]).not.toHaveProperty("cause");
        expect(buffer[1]).not.toHaveProperty("heldBy");
        expect(buffer[2]).toMatchObject({cause: {queued: "idle"}, by: {kind: "host", source: {plugin: "nbook.schedule"}}});
    });

    test("输出 109：已经留着的话再遇到收口不改原因与停的人", async () => {
        await writeSession("keep-cause", [
            queued("a"),
            {type: "inputHeld", data: {ids: ["a"], cause: {end: "error", code: "provider"}}},
            {type: "inputHeld", data: {ids: ["a"], cause: {end: "aborted"}, heldBy: {kind: "user"}}},
        ]);
        await using session = await createTestSession({store: {root}, open: "keep-cause"});
        const [entry] = (await session.raw.snapshot()).buffer;
        expect(entry).toMatchObject({state: "held", cause: {end: "error", code: "provider"}});
        expect(entry).not.toHaveProperty("heldBy");
    });

    test("旧日志：没有状态的条目都是就绪的，旧原因 user 的移除照样移除", async () => {
        await writeSession("legacy", [queued("a"), queued("b"), {type: "inputRemoved", data: {id: "a", reason: "user"}}]);
        await using session = await createTestSession({store: {root}, open: "legacy"});
        expect((await session.raw.snapshot()).buffer.map((item) => [item.id, item.state])).toEqual([["b", "ready"]]);
    });
});

describe("预览只投影就绪的话（harness.runtime 输出 55）", () => {
    test("空闲时就绪的第一条投影进下一次请求，留着的不投影", async () => {
        // 升级前的旧日志里空闲会话可以有就绪的话；新日志里空闲时排的都是留着的。
        await writeSession("preview", [queued("留着的", {state: "held", cause: {queued: "idle"}}), queued("下一问")]);
        await using session = await createTestSession({store: {root}, open: "preview"});
        const preview = await session.raw.preview();
        const last = preview.request.messages.at(-1)!;
        expect([last.role, (last.content[0] as {text: string}).text]).toEqual(["user", "下一问"]);
        expect(JSON.stringify(preview.request.messages)).not.toContain("留着的");
    });
});


// ---- 指令与收口（真实内核，用扩展卡住反应、用会挂起的工具造时间窗）----

let n = 0;
const nextId = () => `c-${++n}`;
const parent = {kind: "session", id: "parent"} as const;
const host = {kind: "host", source: {plugin: "nbook.schedule", label: "每周简报"}} as const;

function gate(): {promise: Promise<void>; open: () => void} {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => (open = resolve));
    return {promise, open};
}

/** 一个执行时停住、等测试放行的工具。 */
function blocking(): {tool: {id: string; execute: () => Promise<string>}; started: Promise<void>; release: () => void} {
    const started = gate();
    const released = gate();
    return {tool: {id: "lab.block", execute: async () => {
        started.open();
        await released.promise;
        return "放行了";
    }}, started: started.promise, release: released.open};
}

const inputsOf = async (session: Awaited<ReturnType<typeof createTestSession>>) => (await session.events()).filter((event) => event.type === "input").map((event) => (event.data as {text: string}).text);
const bufferOf = async (session: Awaited<ReturnType<typeof createTestSession>>) => (await session.raw.snapshot()).buffer.map((item) => [item.input.text, item.state]);

describe("回到空闲（harness.runtime 输出 7、104）", () => {
    test("验收 9：收口批的反应期间到达的话不会以就绪留在空闲的会话里", async () => {
        const entered = gate();
        const hold = gate();
        let held = false;
        const ext = defineExtension({id: "lab.end-gate", on: {runEnded: async () => {
            if (held) return;
            held = true;
            entered.open();
            await hold.promise;
        }}});
        await using session = await createTestSession({extensions: [ext]});
        session.model.script("答一", "答二");
        const sent = await session.raw.send({commandId: nextId(), input: {text: "第一句"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        await entered.promise;
        const late = session.raw.send({commandId: nextId(), input: {text: "收口之后的话"}});
        hold.open();
        const lateResult = await late;
        if (!lateResult.ok || lateResult.value.runId === null) throw new Error("the late send did not start a run");
        expect(lateResult.value.placement).toBe("taken");
        await session.raw.waitRun(lateResult.value.runId);
        expect(await inputsOf(session)).toEqual(["第一句", "收口之后的话"]);
        expect(await bufferOf(session)).toEqual([]);
    });

    test("验收 9：只压缩的运行期间用户发的话压完接着跑；会话身份排的先留着，用户的话放行全部（输出 105）", async () => {
        const entered = gate();
        const hold = gate();
        const slow = async (job: {cuts: readonly {kind: string; entryId: string}[]}) => {
            entered.open();
            await hold.promise;
            const cut = job.cuts.filter((item) => item.kind === "turn").at(-1);
            return {method: "slow", firstKeptEntryId: cut?.entryId ?? null, replacement: "摘要", omitted: [], tokensBefore: 10, tokensAfter: 5};
        };
        const profile = defineProfile({id: "lab.compact", version: "1", name: "c", description: "c", system: "s", compaction: {onThreshold: ["slow"]}});
        await using session = await createTestSession({profile, compaction: {methods: {slow}}});
        session.model.script("答一", "答二");
        await session.say("第一问");
        const compacted = await session.raw.compact({commandId: nextId()});
        if (!compacted.ok || compacted.value.runId === undefined) throw new Error("compact did not start");
        await entered.promise;
        const user = await session.raw.send({commandId: nextId(), input: {text: "压缩期间的话"}});
        const other = await session.raw.as(parent).enqueue({commandId: nextId(), input: {text: "会话排的"}, mode: "followup"});
        expect(user).toMatchObject({ok: true, value: {placement: "later", runId: null}});
        expect(other).toMatchObject({ok: true, value: {placement: "held"}});
        hold.open();
        expect((await session.raw.waitRun(compacted.value.runId)).reason).toBe("completed");
        const fate = await session.raw.inputFate({inputId: user.ok ? user.value.inputId : ""});
        if (fate === null || !("taken" in fate) || fate.taken === null) throw new Error(`the input was not taken: ${JSON.stringify(fate)}`);
        await session.raw.waitRun(fate.taken);
        expect(await inputsOf(session)).toEqual(["第一问", "压缩期间的话", "会话排的"]);
        expect(await bufferOf(session)).toEqual([]);
    });

    test("验收 10：交出结果那一轮里插的话 taken，收口后留着（原因 finished），不自动开运行", async () => {
        const entered = gate();
        const hold = gate();
        const ext = defineExtension({id: "lab.gate", on: {assistant: async () => {
            entered.open();
            await hold.promise;
        }}});
        const schema = {type: "object", properties: {title: {type: "string"}}, required: ["title"]};
        await using session = await createTestSession({extensions: [ext], result: {mode: "optional", schema}});
        session.model.script({tools: [{tool: "yield", args: {title: "雨夜"}}]});
        const sent = await session.raw.send({commandId: nextId(), input: {text: "起个标题"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        await entered.promise;
        const steer = session.raw.as(parent).send({commandId: nextId(), input: {text: "两个字以内"}, mode: "steer"});
        hold.open();
        const steered = await steer;
        expect(steered).toMatchObject({ok: true, value: {placement: "taken"}});
        expect((await session.raw.waitRun(sent.value.runId)).reason).toBe("finished");
        expect((await session.raw.snapshot()).status.state).toBe("idle");
        expect(await session.raw.inputFate({inputId: steered.ok ? steered.value.inputId : ""})).toEqual({held: {end: "finished"}});
    });
});

describe("停止（harness.runtime 输出 30）", () => {
    test("输出 120：点名停一次运行——已收口的、已是下一次运行时 aborted: false，不动缓冲区、不关门；点名在跑的那次照常停", async () => {
        const block = blocking();
        await using session = await createTestSession({tools: [block.tool]});
        session.model.script("答一");
        const first = await session.raw.send({commandId: nextId(), input: {text: "第一问"}});
        if (!first.ok || first.value.runId === null) throw new Error("send failed");
        await session.raw.waitRun(first.value.runId);
        expect(await session.raw.abort({commandId: nextId(), runId: first.value.runId})).toMatchObject({ok: true, value: {aborted: false}});

        session.model.script({tools: [{tool: "lab.block"}]}, "答二");
        const second = await session.raw.send({commandId: nextId(), input: {text: "第二问"}});
        if (!second.ok || second.value.runId === null) throw new Error("send failed");
        await block.started;
        await session.raw.enqueue({commandId: nextId(), input: {text: "排一"}, mode: "followup"});
        const head = (await session.raw.snapshot()).head;
        expect(await session.raw.abort({commandId: nextId(), runId: first.value.runId})).toMatchObject({ok: true, value: {aborted: false}});
        const untouched = await session.raw.snapshot();
        expect([untouched.head, untouched.buffer.map((item) => [item.input.text, item.state]), untouched.wakeGate.open]).toEqual([head, [["排一", "ready"]], true]);

        const stopping = session.raw.abort({commandId: nextId(), runId: second.value.runId, keepQueue: true});
        block.release();
        expect(await stopping).toMatchObject({ok: true, value: {aborted: true}});
        expect((await session.raw.waitRun(second.value.runId)).reason).toBe("aborted");
    });

    test("验收 8：停止留着、停止进行中用户又发一句：收口后先跑留着的，再跑新话；会话身份的话不取用户留着的", async () => {
        const block = blocking();
        await using session = await createTestSession({tools: [block.tool]});
        session.model.script({tools: [{tool: "lab.block"}]}, "答一", "答二", "答三");
        const sent = await session.raw.send({commandId: nextId(), input: {text: "任务"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        await block.started;
        await session.raw.enqueue({commandId: nextId(), input: {text: "排一"}, mode: "followup"});
        await session.raw.enqueue({commandId: nextId(), input: {text: "排二"}, mode: "followup"});
        const stopping = session.raw.abort({commandId: nextId(), keepQueue: true});
        const late = session.raw.send({commandId: nextId(), input: {text: "新话"}});
        block.release();
        expect(await stopping).toMatchObject({ok: true, value: {aborted: true}});
        const lateResult = await late;
        expect(lateResult).toMatchObject({ok: true, value: {placement: "later"}});
        expect((await session.raw.waitRun(sent.value.runId)).reason).toBe("aborted");
        const ended = (await session.raw.log({afterSeq: 0})).events.filter((event) => event.type === "runEnded").at(0)!;
        expect(ended.data).toMatchObject({reason: "aborted", stoppedBy: {kind: "user"}});
        // 收口批里开了下一次运行（输出 104）：它先跑留着的两条，“新话”在之后的一轮。
        const nextRun = (await session.raw.log({afterSeq: 0})).events.filter((event) => event.type === "runStarted").at(-1)!;
        expect((nextRun.data as {runId: string}).runId).not.toBe(sent.value.runId);
        await session.raw.waitRun((nextRun.data as {runId: string}).runId);
        expect(await inputsOf(session)).toEqual(["任务", "排一", "排二", "新话"]);
    });

    test("会话身份的发话不放行用户停止留下的话", async () => {
        const block = blocking();
        await using session = await createTestSession({tools: [block.tool], caller: {kind: "session", id: "parent", callId: "c"}});
        session.model.script({tools: [{tool: "lab.block"}]}, "答父会话");
        const sent = await session.raw.send({commandId: nextId(), input: {text: "任务"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        await block.started;
        await session.raw.enqueue({commandId: nextId(), input: {text: "用户排的"}, mode: "followup"});
        const stopping = session.raw.abort({commandId: nextId(), keepQueue: true});
        block.release();
        await stopping;
        await session.raw.waitRun(sent.value.runId);
        const fromParent = await session.raw.as(parent).send({commandId: nextId(), input: {text: "父会话的话"}});
        if (!fromParent.ok || fromParent.value.runId === null) throw new Error("the parent's send did not start a run");
        await session.raw.waitRun(fromParent.value.runId);
        expect(await inputsOf(session)).toEqual(["任务", "父会话的话"]);
        expect((await session.raw.snapshot()).buffer.map((item) => [item.input.text, item.state, item.heldBy])).toEqual([["用户排的", "held", {kind: "user"}]]);
        expect(await session.raw.as(parent).resume({commandId: nextId()})).toEqual({ok: false, code: "held-by-user"});
    });

    test("验收 12、13：宿主停不了用户开的运行；宿主停自己开的运行只清自己排的，用户排的留着（heldBy 是宿主）", async () => {
        const block = blocking();
        await using session = await createTestSession({tools: [block.tool]});
        session.model.script({tools: [{tool: "lab.block"}]}, {tools: [{tool: "lab.block"}]});
        const userRun = await session.raw.send({commandId: nextId(), input: {text: "用户的任务"}});
        if (!userRun.ok || userRun.value.runId === null) throw new Error("send failed");
        await block.started;
        expect(await session.raw.as(host).abort({commandId: nextId()})).toEqual({ok: false, code: "not-allowed"});
        expect((await session.raw.snapshot()).status.state).not.toBe("idle");
        const stopped = session.raw.abort({commandId: nextId()});
        block.release();
        await stopped;
        await session.raw.waitRun(userRun.value.runId);

        const block2 = blocking();
        await using second = await createTestSession({tools: [block2.tool]});
        second.model.script({tools: [{tool: "lab.block"}]});
        const hostRun = await second.raw.as(host).send({commandId: nextId(), input: {text: "日程"}});
        if (!hostRun.ok || hostRun.value.runId === null) throw new Error("host send failed");
        await block2.started;
        await second.raw.enqueue({commandId: nextId(), input: {text: "用户排的"}, mode: "followup"});
        await second.raw.as(host).enqueue({commandId: nextId(), input: {text: "宿主排的"}, mode: "followup"});
        expect(await second.raw.as(host).edit({commandId: nextId(), inputId: (await second.raw.snapshot()).buffer[0]!.id, input: {text: "改"}})).toEqual({ok: false, code: "not-allowed"});
        const stopping = second.raw.as(host).abort({commandId: nextId()});
        block2.release();
        expect(await stopping).toMatchObject({ok: true, value: {aborted: true}});
        await second.raw.waitRun(hostRun.value.runId);
        expect((await second.raw.snapshot()).buffer.map((item) => [item.input.text, item.state, item.heldBy])).toEqual([["用户排的", "held", host]]);
    });
});

describe("接着跑与放行（harness.runtime 输出 4、105–108）", () => {
    test("输出 4：出错后 start 接着跑那一轮、不取留着的；result-missing 后 nothing-to-continue", async () => {
        const block = blocking();
        await using session = await createTestSession({tools: [block.tool]});
        session.model.script({tools: [{tool: "lab.block"}]}, {fail: "network"}, "接着答");
        const sent = await session.raw.send({commandId: nextId(), input: {text: "问"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        await block.started;
        await session.raw.enqueue({commandId: nextId(), input: {text: "排着的"}, mode: "followup"});
        block.release();
        expect((await session.raw.waitRun(sent.value.runId)).reason).toBe("error");
        const started = await session.raw.start({commandId: nextId()});
        if (!started.ok) throw new Error(started.code);
        expect((await session.raw.waitRun(started.value.runId)).text).toBe("接着答");
        expect(await inputsOf(session)).toEqual(["问"]);
        expect(await bufferOf(session)).toEqual([["排着的", "held"]]);
        expect(await session.raw.start({commandId: nextId()})).toEqual({ok: false, code: "nothing-to-continue"});

        const schema = {type: "object", properties: {title: {type: "string"}}, required: ["title"]};
        await using required = await createTestSession({result: {mode: "required", schema}});
        required.model.script("没调用", "还是没调用");
        const run = await required.raw.send({commandId: nextId(), input: {text: "交结果"}});
        if (!run.ok || run.value.runId === null) throw new Error("send failed");
        expect((await required.raw.waitRun(run.value.runId)).error).toMatchObject({code: "result-missing"});
        expect(await required.raw.start({commandId: nextId()})).toEqual({ok: false, code: "nothing-to-continue"});
    });

    test("验收 15：用户停掉父会话开的运行后，父会话 start 得 not-allowed，resume 只放行它自己的", async () => {
        const block = blocking();
        await using session = await createTestSession({tools: [block.tool], caller: {kind: "session", id: "parent", callId: "c"}});
        session.model.script({tools: [{tool: "lab.block"}]}, "答");
        const sent = await session.raw.as(parent).send({commandId: nextId(), input: {text: "子任务"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        await block.started;
        const stopping = session.raw.abort({commandId: nextId(), keepQueue: true});
        block.release();
        await stopping;
        await session.raw.waitRun(sent.value.runId);
        expect(await session.raw.as(parent).start({commandId: nextId()})).toEqual({ok: false, code: "not-allowed"});
        expect(await session.raw.as(parent).resume({commandId: nextId()})).toEqual({ok: false, code: "nothing-to-resume"});
    });

    test("验收 12：replaces 的条件写入：被改过得 input-stale、替换别人的得 not-allowed；成功时依次移除、放行、写新话", async () => {
        await using session = await createTestSession();
        session.model.script("答");
        const a = await session.raw.as(parent).enqueue({commandId: nextId(), input: {text: "会话的"}, mode: "followup"});
        if (!a.ok) throw new Error("enqueue failed");
        expect(await session.raw.as(host).send({commandId: nextId(), input: {text: "宿主合并"}, replaces: [{id: a.value.inputId, edits: 0}]})).toEqual({ok: false, code: "not-allowed"});
        expect(await session.raw.send({commandId: nextId(), input: {text: "用户合并"}, replaces: [{id: a.value.inputId, edits: 1}]})).toEqual({ok: false, code: "input-stale"});
        const merged = await session.raw.send({commandId: nextId(), input: {text: "用户合并"}, replaces: [{id: a.value.inputId, edits: 0}]});
        if (!merged.ok || merged.value.runId === null) throw new Error("merge failed");
        await session.raw.waitRun(merged.value.runId);
        const types = (await session.raw.log({afterSeq: 0})).events.map((event) => event.type);
        const removedAt = types.indexOf("inputRemoved");
        expect(types.slice(removedAt, removedAt + 2)).toEqual(["inputRemoved", "inputQueued"]);
        expect(await inputsOf(session)).toEqual(["用户合并"]);
        expect(await session.raw.inputFate({inputId: a.value.inputId})).toEqual({removed: "replaced"});
        expect(await session.raw.inputFate({inputId: merged.value.inputId})).toEqual({taken: merged.value.runId});
    });

    test("验收 11：进程内中断后重开，排着的话留着；用户 resume 先接着跑中断的那一轮，再跑留着的", async () => {
        // 收到中止就交回的工具：进程内中断按宽限期等工具，测试时钟不会自己走。
        const started = gate();
        const tool = {id: "lab.block", execute: (_args: unknown, context: {signal: AbortSignal}) => new Promise<string>((resolve) => {
            started.open();
            context.signal.addEventListener("abort", () => resolve("停了"));
        })};
        const s1 = await createTestSession({store: {root}, tools: [tool]});
        s1.model.script({tools: [{tool: "lab.block"}]});
        const sent = await s1.raw.send({commandId: nextId(), input: {text: "任务"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        await started.promise;
        await s1.raw.enqueue({commandId: nextId(), input: {text: "排着的"}, mode: "followup"});
        await closeSession(s1.raw, {reason: "interrupted"});
        await using s2 = await createTestSession({store: {root}, open: s1.id, tools: [tool]});
        expect(await bufferOf(s2)).toEqual([["排着的", "held"]]);
        expect(await s2.raw.as(host).start({commandId: nextId()})).toEqual({ok: false, code: "not-allowed"});
        s2.model.script("接着做完", "答排着的");
        const resumed = await s2.raw.resume({commandId: nextId()});
        if (!resumed.ok || resumed.value.runId === null) throw new Error("resume did not run");
        expect((await s2.raw.waitRun(resumed.value.runId)).text).toBe("答排着的");
        const turns = (await s2.events()).filter((event) => event.type === "turnStarted").map((event) => (event.data as {inputId: string | null}).inputId === null);
        expect(turns.slice(-2)).toEqual([true, false]);
    });
});

// ---- 内核实现审查（第 1 轮）补的用例：时间窗、失败路径与权限的每一格 ----

/** 回复批的反应停住、队列里再排一条在拦截里停住的发话：停止受理时运行已过了循环顶部的中止检查、正在等队列。 */
function queueStaller(): {ext: ReturnType<typeof defineExtension>; replying: Promise<void>; holdReply: () => void; intercepting: Promise<void>; holdIntercept: () => void; armIntercept: () => void} {
    const replying = gate();
    const replyHold = gate();
    const intercepting = gate();
    const interceptHold = gate();
    let assistants = 0;
    let armed = false;
    const ext = defineExtension({
        id: "lab.staller",
        on: {assistant: async () => {
            assistants += 1;
            if (assistants !== 2) return;
            replying.open();
            await replyHold.promise;
        }},
        intercept: {input: async (input, next) => {
            if (armed && input.text === "占队列") {
                intercepting.open();
                await interceptHold.promise;
            }
            return next(input);
        }},
    });
    return {ext, replying: replying.promise, holdReply: replyHold.open, intercepting: intercepting.promise, holdIntercept: interceptHold.open, armIntercept: () => (armed = true)};
}

describe("停止与时间窗（内核实现审查）", () => {
    test("输出 30：停止受理之后，一轮结束那一项不再取范围里的排队，缺省清空", async () => {
        const block = blocking();
        const staller = queueStaller();
        await using session = await createTestSession({tools: [block.tool], extensions: [staller.ext]});
        session.model.script({tools: [{tool: "lab.block"}]}, "最终回复", "不该有的回复");
        const sent = await session.raw.send({commandId: nextId(), input: {text: "任务"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        await block.started;
        const queued = await session.raw.enqueue({commandId: nextId(), input: {text: "排一"}, mode: "followup"});
        if (!queued.ok) throw new Error("enqueue failed");
        block.release();
        await staller.replying;
        staller.armIntercept();
        const holder = session.raw.send({commandId: nextId(), input: {text: "占队列"}});
        staller.holdReply();
        await staller.intercepting;
        const stopping = session.raw.abort({commandId: nextId()});
        staller.holdIntercept();
        expect(await stopping).toMatchObject({ok: true, value: {aborted: true}});
        // “占队列”是停止受理之后到的用户的话：按运行不再取输入处理，停止之后由下一次运行跑（输出 104）。
        const held = await holder;
        await session.raw.waitRun(sent.value.runId);
        const fate = held.ok ? await session.raw.inputFate({inputId: held.value.inputId}) : null;
        if (fate !== null && "taken" in fate && fate.taken !== null) await session.raw.waitRun(fate.taken);
        expect(await inputsOf(session)).toEqual(["任务", "占队列"]);
        expect(await session.raw.inputFate({inputId: queued.value.inputId})).toEqual({removed: "aborted"});
    });

    test("输出 30：只压缩期间先发话、再缺省停止，这句话在停止范围里被清空，不开新运行", async () => {
        const entered = gate();
        const hold = gate();
        const slow = async (job: {cuts: readonly {kind: string; entryId: string}[]}) => {
            entered.open();
            await hold.promise;
            const cut = job.cuts.filter((item) => item.kind === "turn").at(-1);
            return {method: "slow", firstKeptEntryId: cut?.entryId ?? null, replacement: "摘要", omitted: [], tokensBefore: 10, tokensAfter: 5};
        };
        const profile = defineProfile({id: "lab.compact2", version: "1", name: "c", description: "c", system: "s", compaction: {onThreshold: ["slow"]}});
        await using session = await createTestSession({profile, compaction: {methods: {slow}}});
        session.model.script("答一", "不该有的回复");
        await session.say("第一问");
        const compacted = await session.raw.compact({commandId: nextId()});
        if (!compacted.ok || compacted.value.runId === undefined) throw new Error("compact did not start");
        await entered.promise;
        const user = await session.raw.send({commandId: nextId(), input: {text: "压缩期间的话"}});
        const stopping = session.raw.abort({commandId: nextId()});
        hold.open();
        await stopping;
        await session.raw.waitRun(compacted.value.runId);
        expect(await session.raw.inputFate({inputId: user.ok ? user.value.inputId : ""})).toEqual({removed: "aborted"});
        expect((await session.raw.snapshot()).status.state).toBe("idle");
        expect(await inputsOf(session)).toEqual(["第一问"]);
    });

    test("输出 104：输入拦截期间停止被受理，这句话按运行不再取输入处理（later），停止后由下一次运行跑", async () => {
        const block = blocking();
        const intercepting = gate();
        const interceptHold = gate();
        const slowIntercept = defineExtension({id: "lab.slow-intercept", intercept: {input: async (input, next) => {
            if (input.text === "拦截中的话") {
                intercepting.open();
                await interceptHold.promise;
            }
            return next(input);
        }}});
        await using session = await createTestSession({tools: [block.tool], extensions: [slowIntercept]});
        session.model.script({tools: [{tool: "lab.block"}]}, "答拦截中的话");
        const sent = await session.raw.send({commandId: nextId(), input: {text: "任务"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        await block.started;
        const late = session.raw.send({commandId: nextId(), input: {text: "拦截中的话"}});
        await intercepting.promise;
        const stopping = session.raw.abort({commandId: nextId(), keepQueue: true});
        interceptHold.open();
        const lateResult = await late;
        expect(lateResult).toMatchObject({ok: true, value: {placement: "later"}});
        block.release();
        await stopping;
        await session.raw.waitRun(sent.value.runId);
        const fate = await session.raw.inputFate({inputId: lateResult.ok ? lateResult.value.inputId : ""});
        if (fate === null || !("taken" in fate) || fate.taken === null) throw new Error(`the late input did not run: ${JSON.stringify(fate)}`);
        await session.raw.waitRun(fate.taken);
        expect(await inputsOf(session)).toEqual(["任务", "拦截中的话"]);
    });

    test("输出 30：停止第一次交回的 seq 与重发交回的相同，都是它自己的受理记录", async () => {
        const block = blocking();
        await using session = await createTestSession({tools: [block.tool]});
        session.model.script({tools: [{tool: "lab.block"}]}, "答新话");
        const sent = await session.raw.send({commandId: nextId(), input: {text: "任务"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        await block.started;
        const stopping = session.raw.abort({commandId: "stop", keepQueue: true});
        const late = session.raw.send({commandId: nextId(), input: {text: "新话"}});
        block.release();
        const first = await stopping;
        await late;
        const again = await session.raw.abort({commandId: "stop", keepQueue: true});
        expect(first.ok && again.ok ? [first.seq, again.seq, again.replayed] : null).toEqual([again.ok ? again.seq : -1, first.ok ? first.seq : -2, true]);
        const accepted = (await session.raw.log({afterSeq: 0})).events.find((event) => event.type === "commandAccepted" && (event.data as {commandId: string}).commandId === "stop");
        expect(first.ok ? first.seq : null).toBe(accepted!.seq);
    });

    test("句柄损坏：停止受理后、收口之前写日志失败，abort 照样交回 {aborted: true}", async () => {
        const block = blocking();
        let failed = false;
        const wrapStore = (store: LogStore): LogStore => ({...store, append: async (handle, events) => {
            if (!failed && events.some((event) => event.type === "toolResult")) {
                failed = true;
                return {ok: false, code: "storage-failed", detail: {message: "injected"}};
            }
            return store.append(handle, events);
        }});
        await using session = await createTestSession({tools: [block.tool], wrapStore});
        session.model.script({tools: [{tool: "lab.block"}]});
        const sent = await session.raw.send({commandId: nextId(), input: {text: "任务"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        await block.started;
        const stopping = session.raw.abort({commandId: nextId()});
        block.release();
        expect(await stopping).toMatchObject({ok: true, value: {aborted: true}});
        expect((await session.raw.snapshot()).status.state).toBe("broken");
    });

    test("输出 104：接着跑停在两轮之间、缓冲区空的运行，同时到达的话不会被留在空闲的会话里", async () => {
        await using session = await createTestSession();
        session.model.script("答一", "答二", "答新话");
        const first = await session.raw.send({commandId: nextId(), input: {text: "第一问"}});
        if (!first.ok || first.value.runId === null) throw new Error("send failed");
        await session.raw.enqueue({commandId: nextId(), input: {text: "第二问"}, mode: "followup"});
        await session.raw.waitRun(first.value.runId);
        const before = (await session.raw.rewindTargets()).find((target) => target.kind === "before-turn" && target.inputText === "第二问")!;
        await session.raw.rewind({commandId: nextId(), to: before.id});
        const starting = session.raw.start({commandId: nextId()});
        const sending = session.raw.send({commandId: nextId(), input: {text: "新话"}});
        const started = await starting;
        const sentNew = await sending;
        if (!started.ok || !sentNew.ok) throw new Error("start or send failed");
        await session.raw.waitRun(started.value.runId);
        const fate = await session.raw.inputFate({inputId: sentNew.value.inputId});
        if (fate !== null && "taken" in fate && fate.taken !== null && fate.taken !== started.value.runId) await session.raw.waitRun(fate.taken);
        expect(await session.raw.inputFate({inputId: sentNew.value.inputId})).toHaveProperty("taken");
    });
});

describe("权限与留着的每一格（内核实现审查）", () => {
    test("输出 105、106：父会话排的话被用户停止留下后，父会话 resume 得 held-by-user，用户 resume 放行", async () => {
        const block = blocking();
        await using session = await createTestSession({tools: [block.tool], caller: {kind: "session", id: "parent", callId: "c"}});
        session.model.script({tools: [{tool: "lab.block"}]}, "答父会话排的");
        const sent = await session.raw.send({commandId: nextId(), input: {text: "用户的任务"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        await block.started;
        await session.raw.as(parent).enqueue({commandId: nextId(), input: {text: "父会话排的"}, mode: "followup"});
        const stopping = session.raw.abort({commandId: nextId(), keepQueue: true});
        block.release();
        await stopping;
        await session.raw.waitRun(sent.value.runId);
        expect(await session.raw.as(parent).resume({commandId: nextId()})).toEqual({ok: false, code: "held-by-user"});
        const item = (await session.raw.snapshot()).buffer[0]!;
        expect(await session.raw.as(parent).release({commandId: nextId(), inputIds: [item.id]})).toEqual({ok: false, code: "held-by-user"});
        const resumed = await session.raw.resume({commandId: nextId()});
        if (!resumed.ok || resumed.value.runId === null) throw new Error("user resume did not run");
        await session.raw.waitRun(resumed.value.runId);
        expect(await inputsOf(session)).toEqual(["用户的任务", "父会话排的"]);
    });

    test("输出 106：出错之后用户 resume 不接着跑出错的那一轮，用留着的话开新运行", async () => {
        const block = blocking();
        await using session = await createTestSession({tools: [block.tool]});
        session.model.script({tools: [{tool: "lab.block"}]}, {fail: "network"}, "答排着的");
        const sent = await session.raw.send({commandId: nextId(), input: {text: "问"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        await block.started;
        await session.raw.enqueue({commandId: nextId(), input: {text: "排着的"}, mode: "followup"});
        block.release();
        expect((await session.raw.waitRun(sent.value.runId)).reason).toBe("error");
        const resumed = await session.raw.resume({commandId: nextId()});
        if (!resumed.ok || resumed.value.runId === null) throw new Error("resume did not run");
        await session.raw.waitRun(resumed.value.runId);
        const turns = (await session.events()).filter((event) => event.type === "turnStarted").map((event) => (event.data as {inputId: string | null}).inputId === null);
        expect(turns).toEqual([false, false]);
        expect(await inputsOf(session)).toEqual(["问", "排着的"]);
    });

    test("输出 107：release 只放行自己排的；空列表与不在的得 nothing-to-release", async () => {
        await using session = await createTestSession();
        session.model.script("答");
        const mine = await session.raw.as(parent).enqueue({commandId: nextId(), input: {text: "父会话的"}, mode: "followup"});
        const others = await session.raw.as(host).enqueue({commandId: nextId(), input: {text: "宿主的"}, mode: "followup"});
        if (!mine.ok || !others.ok) throw new Error("enqueue failed");
        expect(await session.raw.as(parent).release({commandId: nextId(), inputIds: []})).toEqual({ok: false, code: "nothing-to-release", detail: {ids: []}});
        expect(await session.raw.as(parent).release({commandId: nextId(), inputIds: ["nope"]})).toEqual({ok: false, code: "nothing-to-release", detail: {ids: ["nope"]}});
        expect(await session.raw.as(parent).release({commandId: nextId(), inputIds: [others.value.inputId]})).toEqual({ok: false, code: "not-allowed"});
        const released = await session.raw.as(parent).release({commandId: nextId(), inputIds: [mine.value.inputId]});
        if (!released.ok || released.value.runId === null) throw new Error("release did not run");
        await session.raw.waitRun(released.value.runId);
        expect(await inputsOf(session)).toEqual(["父会话的"]);
        expect(await bufferOf(session)).toEqual([["宿主的", "held"]]);
    });

    test("输出 36、108：别人开的暂停的运行，会话身份 send 留着（held）、resume 与 rewind{resend} 得 not-allowed，用户能接着跑", async () => {
        await using session = await createTestSession({caller: {kind: "session", id: "parent", callId: "c"}});
        session.model.script("答一", "答二", "接着答");
        const first = await session.raw.send({commandId: nextId(), input: {text: "第一问"}});
        if (!first.ok || first.value.runId === null) throw new Error("send failed");
        await session.raw.enqueue({commandId: nextId(), input: {text: "第二问"}, mode: "followup"});
        await session.raw.waitRun(first.value.runId);
        const targets = await session.raw.rewindTargets();
        const before = targets.find((target) => target.kind === "before-turn" && target.inputText === "第二问")!;
        await session.raw.rewind({commandId: nextId(), to: before.id});
        expect(await session.raw.as(parent).send({commandId: nextId(), input: {text: "父会话的话"}})).toMatchObject({ok: true, value: {placement: "held", runId: null}});
        expect(await session.raw.as(parent).resume({commandId: nextId()})).toEqual({ok: false, code: "not-allowed"});
        expect(await session.raw.as(parent).rewind({commandId: nextId(), to: before.id, resend: {text: "改写"}})).toEqual({ok: false, code: "not-allowed"});
        const resumed = await session.raw.start({commandId: nextId()});
        if (!resumed.ok) throw new Error(resumed.code);
        await session.raw.waitRun(resumed.value.runId);
        const events = (await session.raw.log({afterSeq: 0})).events;
        expect(events.filter((event) => event.type === "runResumed").map((event) => event.data)).toEqual([{runId: first.value.runId}]);
    });

    test("输出 42：异步回答在开不起运行时照样结算，回答留着带码", async () => {
        const askTool: TestTool = {id: "lab.ask", execute: async (_args, context) => {
            await context.ask!({question: "要几章？"}, {async: true});
            return "先写着";
        }};
        await using session = await createTestSession({tools: [askTool]});
        session.model.script({tools: [{tool: "lab.ask"}]}, "好");
        const {events} = await session.say("开始");
        const question = events.find((event) => event.type === "interactionRequested")!.data as {id: string};
        session.model.unavailable.set("turn", "no-credentials");
        expect(await session.raw.resolve({commandId: nextId(), id: question.id, decision: "answer", answer: {text: "三章"}})).toMatchObject({ok: true});
        expect((await session.raw.snapshot()).buffer.map((item) => [item.input.text, item.state, item.cause])).toEqual([["三章", "held", {queued: "idle", code: "no-credentials"}]]);
    });

    test("输出 104、53：不带原因关闭时就绪的话留着、原因带 session-closed；打开时恢复的运行把就绪的转成留着", async () => {
        const started = gate();
        const tool = {id: "lab.block", execute: (_args: unknown, context: {signal: AbortSignal}) => new Promise<string>((resolve) => {
            started.open();
            context.signal.addEventListener("abort", () => resolve("停了"));
        })};
        const s1 = await createTestSession({store: {root}, tools: [tool]});
        s1.model.script({tools: [{tool: "lab.block"}]});
        const sent = await s1.raw.send({commandId: nextId(), input: {text: "任务"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        await started.promise;
        await s1.raw.enqueue({commandId: nextId(), input: {text: "排着的"}, mode: "followup"});
        await closeSession(s1.raw);
        await using s2 = await createTestSession({store: {root}, open: s1.id, tools: [tool]});
        expect((await s2.raw.snapshot()).buffer.map((item) => [item.input.text, item.state, item.cause])).toEqual([["排着的", "held", {end: "aborted", code: "session-closed"}]]);
    });

    test("输出 103：留着的插话不在边界被取走", async () => {
        const block = blocking();
        await using session = await createTestSession({tools: [block.tool]});
        session.model.script({tools: [{tool: "lab.block"}]}, "答");
        // 宿主在空闲时排的插话留着；会话身份的发话只放行它自己排的，宿主那条一直留着、边界不取（输出 105）。
        await session.raw.as(host).enqueue({commandId: nextId(), input: {text: "留着的插话"}, mode: "steer"});
        const sent = await session.raw.as(parent).send({commandId: nextId(), input: {text: "父会话的任务"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        await block.started;
        block.release();
        await session.raw.waitRun(sent.value.runId);
        expect((await session.events()).some((event) => event.type === "steer")).toBe(false);
        expect(await bufferOf(session)).toEqual([["留着的插话", "held"]]);
    });
});
