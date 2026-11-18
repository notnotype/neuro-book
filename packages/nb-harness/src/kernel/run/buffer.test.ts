/**
 * 输入缓冲区的条目状态：就绪与留着、放行、回到空闲时留着（docs/specs/harness/runtime.md 输出 103–110）。
 * 内核是真的（日志、归约、单写者）；日志里事先写好的事件经真实的 JSONL 存储写下、再打开。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {LogEvent} from "../api/index.js";
import {defineExtension} from "../extension/define.js";
import {defineProfile} from "../extension/profile.js";
import {createJsonlStore} from "../log/jsonl-store.js";
import {closeSession} from "../session/session.js";
import {createTestSession, defaultTestProfile} from "../testing/test-session.js";

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
        expect(await late).toMatchObject({ok: true, value: {placement: "later"}});
        expect((await session.raw.waitRun(sent.value.runId)).reason).toBe("aborted");
        const ended = (await session.raw.log({afterSeq: 0})).events.filter((event) => event.type === "runEnded").at(0)!;
        expect(ended.data).toMatchObject({reason: "aborted", stoppedBy: {kind: "user"}});
        const next = (await session.raw.snapshot()).status;
        if (next.state === "idle") throw new Error("no run was opened after the stop");
        await session.raw.waitRun("runId" in next ? next.runId : "");
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
