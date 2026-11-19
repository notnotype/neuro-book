/**
 * 唤起与门（docs/specs/harness/runtime.md 输出 28、114、116、117、118，session.md 输出 27）。真实内核、真实日志，模型是脚本；
 * 要在某次请求进行中做事时，把模型端口包一层，让那次请求等测试放行。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {AnyProfile, CompactionMethodImpl, Issuer, LogEvent, LogStore, ModelPort} from "../api/index.js";
import {defineExtension} from "../extension/define.js";
import {defineProfile} from "../extension/profile.js";
import {createTestModel} from "../testing/model.js";
import {createTestSession, type TestSession, type TestTool} from "../testing/test-session.js";

let root = "";
beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness", "kernel-wake");
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

let commands = 0;
const id = () => `w-${(commands += 1)}`;
const HOST: Issuer = {kind: "host", source: {plugin: "lab.jobs", label: "后台任务"}};

function gate() {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => {
        open = resolve;
    });
    return {promise, open};
}

function blockingTool(toolId = "lab.block") {
    const started = gate();
    const release = gate();
    const tool: TestTool = {id: toolId, execute: async () => {
        started.open();
        await release.promise;
        return "工具完成";
    }};
    return {tool, started: started.promise, release: () => release.open()};
}

const types = (events: readonly LogEvent[]) => events.map((event) => event.type);
const allEvents = async (session: TestSession) => (await session.raw.log({afterSeq: 0, limit: 2000})).events;
const runsStarted = async (session: TestSession) => (await allEvents(session)).filter((event) => event.type === "runStarted").map((event) => event.data as {runId: string; kind: string; by?: Issuer; wake?: true});

async function notice(session: TestSession, text: string, options: {key?: string; wake?: boolean} = {}): Promise<string> {
    const sent = await session.raw.as(HOST).notice({commandId: id(), text, ...(options.key === undefined ? {} : {key: options.key}), ...(options.wake === undefined ? {} : {wake: options.wake})});
    if (!sent.ok) throw new Error(`notice failed: ${sent.code}`);
    return sent.value.noticeId;
}

/** 等会话回到空闲：唤起开的运行由内核自己开，测试没有它的 runId。 */
async function settled(session: TestSession): Promise<void> {
    for (const run of await runsStarted(session)) await session.raw.waitRun(run.runId);
}

/** 第 `index` 次（从 0 起）模型请求等测试放行。 */
function gatedModel(index: number) {
    const model = createTestModel();
    const entered = gate();
    const release = gate();
    let calls = 0;
    const port: ModelPort = {
        resolve: (query) => {
            const found = model.port.resolve(query);
            if (!found.ok) return found;
            return {...found, call: async (...args) => {
                if (calls++ === index) {
                    entered.open();
                    await release.promise;
                }
                return found.call(...args);
            }};
        },
    };
    return {model, port, entered: entered.promise, release: () => release.open()};
}

describe("输出 116：唤起", () => {
    test("新会话门开着：带唤起的提醒让空闲的会话开一次运行，记成提醒的发出者开的，第一次请求带上它", async () => {
        await using session = await createTestSession();
        session.model.script("处理了后台结果");
        expect((await session.raw.snapshot()).wakeGate).toEqual({open: true, cause: "created"});
        await notice(session, "后台任务结束了", {wake: true});
        await settled(session);
        const runs = await runsStarted(session);
        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({kind: "chat", by: HOST, wake: true});
        expect(session.requests[0]!.outline().at(-1)).toBe("user: event:hostNotice");
        expect((await session.raw.snapshot()).notices).toEqual([]);
    });

    test("不带唤起的提醒不开运行，等下一次对话请求", async () => {
        await using session = await createTestSession();
        await notice(session, "只是告诉一声");
        expect(await runsStarted(session)).toEqual([]);
        expect((await session.raw.snapshot()).status.state).toBe("idle");
    });

    test("输出 28：模型给出最终回复的过程中到达的带唤起的提醒让这一轮接着请求；不带唤起的不延长这一轮", async () => {
        const gated = gatedModel(0);
        await using session = await createTestSession({models: gated.port});
        gated.model.script("第一次回复", "处理了提醒");
        const sent = await session.raw.send({commandId: id(), input: {text: "问"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send did not start a run");
        await gated.entered;
        await notice(session, "回复期间结束的后台任务", {wake: true});
        gated.release();
        await session.raw.waitRun(sent.value.runId);
        expect(gated.model.requests).toHaveLength(2);
        expect(await runsStarted(session)).toHaveLength(1);

        const passive = gatedModel(0);
        await using quiet = await createTestSession({models: passive.port});
        passive.model.script("第一次回复");
        const again = await quiet.raw.send({commandId: id(), input: {text: "问"}});
        if (!again.ok || again.value.runId === null) throw new Error("send did not start a run");
        await passive.entered;
        await notice(quiet, "不急的提醒");
        passive.release();
        await quiet.raw.waitRun(again.value.runId);
        expect(passive.model.requests).toHaveLength(1);
        expect((await quiet.raw.snapshot()).notices.map((item) => item.text)).toEqual(["不急的提醒"]);
    });

    test("只压缩的运行里用户发了话、又到了带唤起的提醒：收口只开一次运行，记成用户的，第一次请求两样都带", async () => {
        const entered = gate();
        const hold = gate();
        const slow: CompactionMethodImpl = async (job) => {
            entered.open();
            await hold.promise;
            return {method: job.method, firstKeptEntryId: null, replacement: "摘要", omitted: [], tokensBefore: job.tokens, tokensAfter: 1, details: {require: []}};
        };
        const profile = defineProfile({id: "lab.wake-compact", version: "1", name: "压缩", description: "压缩测试", system: "系统", compaction: {onThreshold: ["slow"]}}) as AnyProfile;
        await using session = await createTestSession({profile, compaction: {methods: {slow}}});
        session.model.script("答一", "答二");
        await session.say("第一问");
        const compacting = await session.raw.compact({commandId: id()});
        if (!compacting.ok || compacting.value.runId === undefined) throw new Error("compact did not start");
        await entered.promise;
        await session.raw.send({commandId: id(), input: {text: "压缩期间的话"}});
        await notice(session, "压缩期间结束的后台任务", {wake: true});
        hold.open();
        await session.raw.waitRun(compacting.value.runId);
        await settled(session);
        const chats = (await runsStarted(session)).filter((run) => run.kind === "chat");
        expect(chats).toHaveLength(2);
        expect(chats[1]!.by).toBeUndefined();
        expect(chats[1]!.wake).toBeUndefined();
        expect(session.requests.at(-1)!.outline().at(-1)).toBe("user: event:hostNotice | event:input");
    });
});

describe("输出 114：没有进行中的一轮时", () => {
    /** 受理批的反应停住：测试在它之后排的指令先于唤起开的运行的第一个队列项。 */
    function pausingOnRunStarted() {
        const reached = gate();
        const hold = gate();
        let armed = false;
        const extension = defineExtension({id: "lab.pause-run-start", on: {runStarted: async () => {
            if (!armed) return;
            armed = false;
            reached.open();
            await hold.promise;
        }}});
        return {extension, arm: () => void (armed = true), reached: reached.promise, release: () => hold.open()};
    }

    test("唤起的提醒在第一个边界之前被撤回：不发请求就收口，不带唤起的提醒留着", async () => {
        const pause = pausingOnRunStarted();
        await using session = await createTestSession({extensions: [pause.extension]});
        await notice(session, "不急的提醒");
        pause.arm();
        // 受理批停在反应里：提醒已写下（快照读得到），撤回排在唤起的运行的第一个队列项之前。
        const waking = session.raw.as(HOST).notice({commandId: id(), text: "要唤起的", wake: true});
        await pause.reached;
        const pending = (await session.raw.snapshot()).notices.find((item) => item.wake)!;
        const withdrawn = session.raw.as(HOST).removeNotice({commandId: id(), noticeId: pending.id});
        pause.release();
        expect((await waking).ok).toBe(true);
        expect((await withdrawn).ok).toBe(true);
        await settled(session);
        expect(session.model.requests).toHaveLength(0);
        const ended = (await allEvents(session)).filter((event) => event.type === "runEnded").map((event) => (event.data as {reason: string}).reason);
        expect(ended).toEqual(["completed"]);
        expect((await session.raw.snapshot()).notices.map((item) => item.text)).toEqual(["不急的提醒"]);
    });

    test("用户的继续：只有待发的提醒时开一次运行、开一轮没有输入的，并开门", async () => {
        await using session = await createTestSession();
        session.model.script({fail: "provider"}, "继续了");
        await session.say("会出错的问");
        expect((await session.raw.snapshot()).wakeGate.open).toBe(false);
        await notice(session, "等你继续的提醒", {wake: true});
        expect(await runsStarted(session)).toHaveLength(1);
        const resumed = await session.raw.resume({commandId: id()});
        if (!resumed.ok || resumed.value.runId === null) throw new Error(`resume did not start a run: ${JSON.stringify(resumed)}`);
        await session.raw.waitRun(resumed.value.runId);
        expect(session.requests.at(-1)!.outline().at(-1)).toBe("user: event:hostNotice");
        expect((await session.raw.snapshot()).wakeGate).toEqual({open: true, cause: "user"});
    });
});

describe("输出 117：门", () => {
    test("用户停止（含停止后在宽限期里收口）关门；之后带唤起的提醒不开运行，随用户下一句话进请求并开门", async () => {
        const block = blockingTool();
        await using session = await createTestSession({tools: [block.tool]});
        session.model.script({tools: [{tool: "lab.block"}]}, "收到");
        const sent = await session.raw.send({commandId: id(), input: {text: "开始"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send did not start a run");
        await block.started;
        const stopped = session.raw.abort({commandId: id(), keepQueue: true});
        block.release();
        expect((await stopped).ok).toBe(true);
        await session.raw.waitRun(sent.value.runId);
        expect((await session.raw.snapshot()).wakeGate).toEqual({open: false, cause: "stopped"});
        await notice(session, "停止后结束的后台任务", {wake: true});
        expect(await runsStarted(session)).toHaveLength(1);
        session.model.script("看到了");
        const report = await session.say("继续吧");
        expect(report.requests[0]!.outline().at(-1)).toBe("user: event:hostNotice | event:input");
        expect((await session.raw.snapshot()).wakeGate).toEqual({open: true, cause: "user"});
    });

    test("出错收口关门；只回退、换分支不开门", async () => {
        await using session = await createTestSession();
        session.model.script("答一", {fail: "provider"});
        await session.say("第一问");
        await session.say("第二问");
        expect((await session.raw.snapshot()).wakeGate).toEqual({open: false, cause: "error"});
        const targets = await session.raw.rewindTargets();
        expect((await session.raw.rewind({commandId: id(), to: targets.find((target) => target.kind === "after-turn")!.id})).ok).toBe(true);
        await notice(session, "回退之后的提醒", {wake: true});
        expect((await session.raw.snapshot()).wakeGate.open).toBe(false);
        expect(await runsStarted(session)).toHaveLength(2);
    });

    test("只压缩的运行不改门：门关着时压缩成功不开，门开着时压缩失败不关", async () => {
        const fails: CompactionMethodImpl = async () => {
            throw new Error("压缩失败");
        };
        const works: CompactionMethodImpl = async (job) => ({method: job.method, firstKeptEntryId: null, replacement: "摘要", omitted: [], tokensBefore: job.tokens, tokensAfter: 1, details: {require: []}});
        const failing = defineProfile({id: "lab.wake-compact-fail", version: "1", name: "压缩", description: "压缩测试", system: "系统", compaction: {onThreshold: ["fails"]}}) as AnyProfile;
        await using open = await createTestSession({profile: failing, compaction: {methods: {fails}}});
        open.model.script("答一");
        await open.say("第一问");
        const compactFailed = await open.raw.compact({commandId: id()});
        if (compactFailed.ok && compactFailed.value.runId !== undefined) await open.raw.waitRun(compactFailed.value.runId);
        expect((await open.raw.snapshot()).wakeGate.open).toBe(true);

        const working = defineProfile({id: "lab.wake-compact-ok", version: "1", name: "压缩", description: "压缩测试", system: "系统", compaction: {onThreshold: ["works"]}}) as AnyProfile;
        await using closed = await createTestSession({profile: working, compaction: {methods: {works}}});
        closed.model.script("答一", {fail: "provider"});
        await closed.say("第一问");
        await closed.say("出错");
        const compacted = await closed.raw.compact({commandId: id()});
        if (compacted.ok && compacted.value.runId !== undefined) await closed.raw.waitRun(compacted.value.runId);
        expect((await closed.raw.snapshot()).wakeGate.open).toBe(false);
    });

    test("压缩期间用户的话被取消、宿主的话还在：收口开的后继记成宿主的，不开门", async () => {
        const entered = gate();
        const hold = gate();
        const slow: CompactionMethodImpl = async (job) => {
            entered.open();
            await hold.promise;
            return {method: job.method, firstKeptEntryId: null, replacement: "摘要", omitted: [], tokensBefore: job.tokens, tokensAfter: 1, details: {require: []}};
        };
        const profile = defineProfile({id: "lab.wake-cancel", version: "1", name: "压缩", description: "压缩测试", system: "系统", compaction: {onThreshold: ["slow"]}}) as AnyProfile;
        await using session = await createTestSession({profile, compaction: {methods: {slow}}});
        session.model.script({fail: "provider"}, "宿主的那一轮");
        await session.say("出错的问");
        expect((await session.raw.snapshot()).wakeGate.open).toBe(false);
        const compacting = await session.raw.compact({commandId: id()});
        if (!compacting.ok || compacting.value.runId === undefined) throw new Error("compact did not start");
        await entered.promise;
        const mine = await session.raw.send({commandId: id(), input: {text: "用户的话"}});
        await session.raw.as(HOST).send({commandId: id(), input: {text: "宿主的话"}});
        if (!mine.ok) throw new Error(mine.code);
        expect((await session.raw.remove({commandId: id(), inputId: mine.value.inputId})).ok).toBe(true);
        hold.open();
        await session.raw.waitRun(compacting.value.runId);
        await settled(session);
        const chats = (await runsStarted(session)).filter((run) => run.kind === "chat");
        expect(chats.at(-1)!.by).toEqual(HOST);
        expect((await session.raw.snapshot()).wakeGate.open).toBe(false);
    });

    test("fork 出来的会话门开着、不带待发的提醒", async () => {
        await using session = await createTestSession({store: {root}});
        session.model.script("答一", {fail: "provider"});
        await session.say("第一问");
        await session.say("出错");
        await notice(session, "原会话的提醒");
        const forked = await session.raw.fork({commandId: id()});
        if (!forked.ok) throw new Error(forked.code);
        await using copy = await createTestSession({store: {root}, open: forked.value.sessionId});
        const snapshot = await copy.raw.snapshot();
        expect(snapshot.wakeGate).toEqual({open: true, cause: "created"});
        expect(snapshot.notices).toEqual([]);
    });

    test("session.md 输出 27：没有门事件的旧日志按关着算，带唤起的提醒不开运行", async () => {
        await using session = await createTestSession({store: {root}});
        const file = join(root, session.id, "session.jsonl");
        const lines = (await readFile(file, "utf8")).split("\n").filter((line) => line !== "" && !line.includes("\"wakeGate\""));
        await session.close();
        await writeFile(file, `${lines.join("\n")}\n`);
        await using old = await createTestSession({store: {root}, open: session.id});
        expect((await old.raw.snapshot()).wakeGate).toEqual({open: false, cause: null});
        await notice(old, "旧会话的提醒", {wake: true});
        expect(await runsStarted(old)).toEqual([]);
    });

    test("session.md 输出 27：回退后接着跑了暂停的运行、第一条路径事件写下之前断了，重开按中断恢复并关门", async () => {
        let resumed = false;
        let failed = false;
        const wrapStore = (store: LogStore): LogStore => ({
            ...store,
            append: async (handle, events) => {
                if (events.some((event) => event.type === "runResumed")) resumed = true;
                else if (resumed && !failed && events.some((event) => event.scope === "path")) {
                    failed = true;
                    return {ok: false, code: "storage-failed", detail: {message: "injected failure"}};
                }
                return store.append(handle, events);
            },
        });
        const readTool = {id: "lab.read", execute: () => "读到了"};
        await using session = await createTestSession({store: {root}, tools: [readTool], wrapStore});
        session.model.script({tools: [{tool: "lab.read"}]}, "答完");
        await session.say("问");
        const targets = await session.raw.rewindTargets();
        const step = targets.find((target) => target.kind === "after-step");
        expect((await session.raw.rewind({commandId: id(), to: step!.id})).ok).toBe(true);
        const started = await session.raw.start({commandId: id()});
        expect(started.ok).toBe(true);
        await session.reopen();
        const events = await allEvents(session);
        const resumedRun = (events.filter((event) => event.type === "runResumed").at(-1)!.data as {runId: string}).runId;
        expect(events.some((event) => event.type === "runEnded" && (event.data as {runId: string; reason: string}).runId === resumedRun && (event.data as {reason: string}).reason === "interrupted")).toBe(true);
        expect((await session.raw.snapshot()).wakeGate).toEqual({open: false, cause: "interrupted"});
    });
});

describe("输出 118：预览", () => {
    test("当前叶子只有待发的提醒时预览出一轮没有输入的，不写事件、不改门", async () => {
        await using session = await createTestSession();
        session.model.script("答一");
        await session.say("问");
        await notice(session, "待发的提醒");
        const before = await session.raw.snapshot();
        const preview = await session.raw.preview();
        const after = await session.raw.snapshot();
        expect(after.head).toBe(before.head);
        expect(after.wakeGate).toEqual(before.wakeGate);
        const last = preview.request.messages.at(-1)!.content.flatMap((block) => (block.kind === "text" ? [block.text] : []));
        expect(last.some((text) => text.includes("待发的提醒"))).toBe(true);
        expect(types(await session.events()).includes("hostNotice")).toBe(false);
    });
});
