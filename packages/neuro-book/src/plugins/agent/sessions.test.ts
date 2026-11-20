/**
 * 远程合同 `nbook.agent/sessions`（docs/specs/agent/sessions.md）：窗口经真实的远程链路（JSON 编解码、可断线重连）调用服务端的
 * `nbook.agent`，模型是本机的 OpenAI 兼容端点。测试名里的编号是 sessions.md 的输出条目与验收场景。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {randomBytes} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {createJsonlStore, defineExtension, defineProfile} from "@notnotype/nb-harness/kernel";
import {IDLE_CLOSE_MS} from "@notnotype/nb-harness/kit/sessions";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {DELTA_WINDOW_MS, DIAGNOSTIC_TEXT_BYTES, EVENT_INLINE_BYTES, PAGE_BYTES} from "./backend/frames";
import {agentKey, MAIN_PROFILE} from "./shared/contracts";
import type {AgentService} from "./shared/contracts";
import {agentExtension, agentProfile, agentTool} from "./shared/points";
import {agentSessionsContract, NOTICE_SUMMARY_CHARS} from "./shared/remote";
import type {LogItem, RemoteFrame} from "./shared/remote";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld, SessionsClient} from "./testing/world";

let root = "";
let counter = 0;
let endpoint: FakeEndpoint;
const worlds: AgentWorld[] = [];
beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "sessions");
    endpoint = fakeEndpoint();
});
afterEach(async () => {
    endpoint.reset();
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    endpoint.stop();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

let commands = 0;
const cid = () => `s-${String((commands += 1))}`;
const WRITER = "test.profiles.writer";
const BIG = "test.profiles.big";

/** 一个 Profile 与一个结果很大的工具。 */
const contributor: PluginDefinition = (() => {
    const writer = agentProfile(WRITER, {name: "写手", description: "测试用", tools: {required: [], optional: [BIG]}});
    const big = agentTool(BIG, {description: "回一大段文字", parameters: {type: "object"}, version: "1", effect: "read"});
    return {id: "test.profiles", entries: [defineEntry({id: "server", location: "server", activationEvents: [writer.activationEvent, big.activationEvent], contributions: [writer.contribution, big.contribution], activate: () => ({contributions: {
        "agent.profiles": {[WRITER]: defineProfile({id: WRITER, version: "1", name: "写手", description: "测试用", system: "你是写手。"})},
        "agent.tools": {[BIG]: {create: () => ({execute: async () => "字".repeat(EVENT_INLINE_BYTES)})}},
    }})})]};
})();

async function world(extra: PluginDefinition[] = []): Promise<AgentWorld> {
    counter += 1;
    const created = await agentWorld(join(root, `w${String(counter)}`), {plugins: [contributor, ...extra], userSettings: localModelSettings(endpoint.baseUrl)});
    worlds.push(created);
    return created;
}

function ok<T>(result: {readonly ok: boolean; readonly value?: T; readonly code?: string}): T {
    if (!result.ok) throw new Error(`remote call failed: ${JSON.stringify(result)}`);
    return result.value as T;
}

/** 订阅一个会话的帧，攒在数组里；交回取消函数与 `onResync` 的次数。 */
async function collect(client: SessionsClient, sessionId: string): Promise<{readonly frames: RemoteFrame[]; readonly resyncs: {count: number}; release(): void}> {
    const frames: RemoteFrame[] = [];
    const resyncs = {count: 0};
    const subscription = ok(await client.events.frames.subscribe({sessionId}, (frame) => frames.push(frame), {onResync: () => {
        resyncs.count += 1;
    }}));
    return {frames, resyncs, release: () => subscription.release()};
}

const seqOf = (item: LogItem): number => (item.kind === "event" ? item.event.seq : item.seq);

/** 用 `log` 从 `afterSeq` 补到最新，交回全部条目。 */
async function catchUp(client: SessionsClient, sessionId: string, afterSeq = 0): Promise<LogItem[]> {
    const items: LogItem[] = [];
    let after = afterSeq;
    for (;;) {
        const page = ok(await client.log({sessionId, afterSeq: after}));
        items.push(...page.items);
        after = page.through;
        if (!page.more) return items;
    }
}

async function runOnServer(w: AgentWorld, sessionId: string, text: string): Promise<void> {
    const view = w.service.session(sessionId);
    const sent = await view.send({commandId: cid(), input: {text}});
    if (!sent.ok || sent.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
    await view.waitRun(sent.value.runId);
}

describe("远程合同", () => {
    test("场景 1、输出 7、8：窗口 A 发起运行后退订，窗口 B 订阅再用 log 补齐；增量按 100 毫秒合并、按订阅从 1 编号，日志帧之前先推出", async () => {
        const w = await world();
        const a = (await w.window("a")).client;
        const sessionId = ok(await a.create({profile: WRITER})).sessionId;
        const seen = await collect(a, sessionId);
        endpoint.script({chunks: ["你", "好", "呀"]});
        const sent = ok(await a.send({sessionId, commandId: cid(), input: {text: "问候"}}));
        await waitUntil("回复写进日志", () => seen.frames.some((frame) => frame.type === "log" && frame.item.kind === "event" && frame.item.event.type === "assistant"));
        // 合并窗口没到点前助手的回复事件已到：攒着的增量先推出、只一帧，编号从 1 起。
        const deltas = seen.frames.filter((frame) => frame.type === "delta");
        expect(deltas.map((frame) => [frame.text, frame.n])).toEqual([["你好呀", 1]]);
        const assistantAt = seen.frames.findIndex((frame) => frame.type === "log" && frame.item.kind === "event" && frame.item.event.type === "assistant");
        expect(seen.frames.findIndex((frame) => frame.type === "delta")).toBeLessThan(assistantAt);
        seen.release();
        await waitUntil("运行结束", async () => ok(await a.runResult({sessionId, runId: sent.value.runId!})) !== null);

        const b = (await w.window("b")).client;
        const later = await collect(b, sessionId);
        const items = await catchUp(b, sessionId);
        expect(items.some((item) => item.kind === "event" && item.event.type === "assistant")).toBe(true);
        expect(items.map(seqOf)).toEqual([...items.keys()].map((index) => index + 1));
        later.release();
    });

    test("输出 7：只有增量时 100 毫秒后推出一帧；两个订阅各自合并、互不影响", async () => {
        const w = await world();
        const a = (await w.window("a")).client;
        const b = (await w.window("b")).client;
        const sessionId = ok(await a.create({profile: WRITER})).sessionId;
        const one = await collect(a, sessionId);
        const two = await collect(b, sessionId);
        const hold = endpoint.hold();
        endpoint.script({chunks: ["慢", "慢", "来"]});
        const sent = ok(await a.send({sessionId, commandId: cid(), input: {text: "慢慢说"}}));
        await hold.arrived;
        hold.release();
        await waitUntil("回复写进日志", async () => ok(await a.runResult({sessionId, runId: sent.value.runId!})) !== null);
        for (const seen of [one, two]) expect(seen.frames.filter((frame) => frame.type === "delta").map((frame) => frame.n)).toEqual([1]);
        // 时钟推过合并窗口不会再多出帧。
        w.settings.clock.advance(DELTA_WINDOW_MS);
        for (const seen of [one, two]) expect(seen.frames.filter((frame) => frame.type === "delta")).toHaveLength(1);
        one.release();
        two.release();
    });

    test("场景 1、输出 8：断线期间写下的事件，重连后 onResync 再用 log 从最后收到的 seq 补齐，不漏不重", async () => {
        const w = await world();
        const {client, window} = await w.window("a");
        const sessionId = ok(await client.create({profile: WRITER})).sessionId;
        // 先订阅、再用 log 从 0 补；帧里 seq 不大于补到的就丢掉（输出 8 的接法）。
        const seen = await collect(client, sessionId);
        const base = (await catchUp(client, sessionId)).map(seqOf);
        endpoint.script("第一句");
        await runOnServer(w, sessionId, "一");
        await waitUntil("第一轮的帧到了", () => seen.frames.some((frame) => frame.type === "log" && frame.item.kind === "event" && frame.item.event.type === "runEnded"));
        const received = [...base, ...seen.frames.flatMap((frame) => (frame.type === "log" && seqOf(frame.item) > Math.max(0, ...base) ? [seqOf(frame.item)] : []))];
        const last = Math.max(...received);

        window.disconnect();
        endpoint.script("断线时说的");
        await runOnServer(w, sessionId, "二");
        expect(await window.reconnect()).toMatchObject({ok: true});
        await waitUntil("订阅重建", () => seen.resyncs.count === 1);
        const missed = await catchUp(client, sessionId, last);
        const all = [...received, ...missed.map(seqOf)];
        expect(all).toEqual([...all.keys()].map((index) => index + 1));
        expect(missed.some((item) => item.kind === "event" && item.event.type === "assistant")).toBe(true);
        seen.release();
    });

    test("场景 4、输出 9：超过 256 KiB 的事件在 log 与帧里是占位，经 eventChunk 分段读回完整的事件", async () => {
        const w = await world();
        const {client} = await w.window("a");
        const sessionId = ok(await client.create({profile: WRITER})).sessionId;
        const seen = await collect(client, sessionId);
        endpoint.script({tool: "test__profiles__big"}, "收到");
        await runOnServer(w, sessionId, "要一大段");
        const items = await catchUp(client, sessionId);
        const oversized = items.filter((item) => item.kind === "oversized");
        expect(oversized.map((item) => item.kind === "oversized" && item.type)).toEqual(["toolResult"]);
        await waitUntil("帧里也是占位", () => seen.frames.some((frame) => frame.type === "log" && frame.item.kind === "oversized"));
        const target = oversized[0] as Extract<LogItem, {kind: "oversized"}>;
        let text = "";
        for (let index = 0; ; index += 1) {
            const chunk = ok(await client.eventChunk({sessionId, seq: target.seq, index}));
            text += chunk.text;
            if (chunk.last) break;
        }
        const event = JSON.parse(text) as {seq: number; data: {text: string}};
        expect([event.seq, event.data.text.length]).toEqual([target.seq, EVENT_INLINE_BYTES]);
        expect(await client.eventChunk({sessionId, seq: target.seq, index: 99})).toMatchObject({ok: false, code: "out-of-range"});
        seen.release();
    });

    test("输出 3：业务失败码经真实链路到达调用方：打开不了的会话、指令自己的失败", async () => {
        const w = await world();
        const {client} = await w.window("a");
        expect(await client.send({sessionId: "nope", commandId: cid(), input: {text: "在吗"}})).toMatchObject({ok: false, code: "session-not-found"});
        expect(await client.snapshot({sessionId: "nope"})).toMatchObject({ok: false, code: "session-not-found"});
        const sessionId = ok(await client.create({profile: WRITER})).sessionId;
        expect(await client.setTitle({sessionId, commandId: cid(), title: ""})).toMatchObject({ok: false, code: "empty-title"});
        // 只给宿主的指令不进合同（harness/runtime.md 输出 72）：浏览器调不到它。
        expect(Object.keys(agentSessionsContract.methods)).not.toContain("setGeneratedMeta");
        expect(await client.create({profile: "test.profiles.missing"})).toMatchObject({ok: false, code: "unknown-profile"});
        expect(ok(await client.profiles({})).map((profile) => profile.key)).toContain(WRITER);
    });

    test("输出 29：合同是版本 2；快照的待发提醒只带开头与字节数、带着门；removeNotice 以用户的身份取消；notice 不在合同里；按版本 1 调用得 version-changed", async () => {
        const w = await world();
        const {client, remote} = await w.window("a");
        const sessionId = ok(await client.create({profile: WRITER})).sessionId;
        const host = w.service.session(sessionId, {asUser: false, source: {label: "日程", ref: "r-1"}});
        expect(NOTICE_SUMMARY_CHARS).toBe(200);
        // 超过摘要长度、含代理对：摘要按字符截，不切开它。
        const text = `${"提".repeat(NOTICE_SUMMARY_CHARS - 1)}😀${"醒".repeat(50)}`;
        const queued = await host.notice({commandId: cid(), text, key: "daily"});
        if (!queued.ok) throw new Error(`notice failed: ${JSON.stringify(queued)}`);
        const snapshot = ok(await client.snapshot({sessionId}));
        expect(snapshot.notices).toEqual([{
            id: queued.value.noticeId,
            by: expect.objectContaining({kind: "host", source: expect.objectContaining({label: "日程", ref: "r-1"})}),
            key: "daily",
            wake: false,
            queuedAt: expect.any(Number),
            summary: `${"提".repeat(NOTICE_SUMMARY_CHARS - 1)}😀`,
            bytes: Buffer.byteLength(text),
        }]);
        expect(snapshot.wakeGate).toEqual({open: true, cause: "created"});

        ok(await client.removeNotice({sessionId, commandId: cid(), noticeId: queued.value.noticeId}));
        expect(ok(await client.snapshot({sessionId})).notices).toEqual([]);
        const removed = (await w.service.session(sessionId).log({afterSeq: 0})).events.find((event) => event.type === "noticeRemoved");
        expect(removed?.data).toMatchObject({ids: [queued.value.noticeId], reason: "cancelled"});
        expect(await client.removeNotice({sessionId, commandId: cid(), noticeId: queued.value.noticeId})).toMatchObject({ok: false, code: "notice-not-found"});
        // 插件经 agentKey 拿到的视图能撤回自己发的。
        const own = await host.notice({commandId: cid(), text: "过时了"});
        if (!own.ok) throw new Error(`notice failed: ${JSON.stringify(own)}`);
        expect((await host.removeNotice({commandId: cid(), noticeId: own.value.noticeId})).ok).toBe(true);
        const withdrawn = (await w.service.session(sessionId).log({afterSeq: 0})).events.filter((event) => event.type === "noticeRemoved").at(-1);
        expect(withdrawn?.data).toMatchObject({ids: [own.value.noticeId], reason: "withdrawn"});

        expect(Object.keys(agentSessionsContract.methods)).not.toContain("notice");
        const v1 = defineRemoteService({...agentSessionsContract, version: 1});
        expect(await remote.use(v1).snapshot({sessionId})).toMatchObject({ok: false, code: "version-changed"});
    });

    test("输出 22、15：缓冲区条目经远程带发出者、状态、原因与输入；send 交回去向；resume、release 照内核暴露，失败码照原样；用户停止留下的话让活动列为 held", async () => {
        const w = await world();
        const {client} = await w.window("a");
        const sessionId = ok(await client.create({profile: WRITER})).sessionId;
        const changes: (readonly {readonly id: string; readonly state: string}[])[] = [];
        const watching = ok(await client.events.activityChanged.subscribe({}, (items) => void changes.push(items)));
        expect(await client.resume({sessionId, commandId: cid()})).toMatchObject({ok: false, code: "nothing-to-resume"});
        expect(await client.release({sessionId, commandId: cid(), inputIds: ["nope"]})).toMatchObject({ok: false, code: "nothing-to-release", detail: {ids: ["nope"]}});

        const hold = endpoint.hold();
        endpoint.script("第一条回复");
        const started = ok(await client.send({sessionId, commandId: cid(), input: {text: "开始"}}));
        expect(started.value).toMatchObject({placement: "taken"});
        await hold.arrived;
        ok(await client.enqueue({sessionId, commandId: cid(), input: {text: "插一句"}, mode: "steer"}));
        ok(await client.enqueue({sessionId, commandId: cid(), input: {text: "排一条"}, mode: "followup"}));
        const host = w.service.session(sessionId, {asUser: false, source: {label: "日程", ref: "r-1"}});
        expect((await host.enqueue({commandId: cid(), input: {text: "日程的"}, mode: "followup"})).ok).toBe(true);
        const ready = ok(await client.snapshot({sessionId})).buffer;
        expect(ready.map((item) => [item.input, item.mode, item.state, item.by ?? null])).toEqual([
            [{text: "插一句"}, "steer", "ready", null],
            [{text: "排一条"}, "followup", "ready", null],
            [{text: "日程的"}, "followup", "ready", expect.objectContaining({kind: "host", source: expect.objectContaining({label: "日程", ref: "r-1"})})],
        ]);

        ok(await client.abort({sessionId, commandId: cid(), keepQueue: true}));
        hold.release();
        await waitUntil("停下", async () => ok(await client.runResult({sessionId, runId: started.value.runId!})) !== null);
        const held = ok(await client.snapshot({sessionId})).buffer;
        expect(held.map((item) => [item.state, item.cause, item.heldBy])).toEqual(held.map(() => ["held", {end: "aborted"}, {kind: "user"}]));
        expect(ok(await client.activity({}))).toEqual([expect.objectContaining({id: sessionId, state: "held"})]);
        await waitUntil("推送了 held", () => changes.at(-1)?.some((item) => item.id === sessionId && item.state === "held") === true);

        // 按条放行宿主那条：开一次运行跑它，另两条还留着。
        endpoint.script("处理了日程的");
        const released = ok(await client.release({sessionId, commandId: cid(), inputIds: [held[2]!.id]}));
        expect(released.value).toMatchObject({released: [held[2]!.id]});
        await waitUntil("跑完", async () => ok(await client.runResult({sessionId, runId: (released.value as {runId: string}).runId})) !== null);
        expect(ok(await client.snapshot({sessionId})).buffer.map((item) => [item.input.text, item.state])).toEqual([["插一句", "held"], ["排一条", "held"]]);

        // 其余按排队顺序放行：插话也改成排队，各自一轮。
        endpoint.script("处理了插一句", "处理了排一条");
        const resumed = ok(await client.resume({sessionId, commandId: cid(), mode: "followups"}));
        expect(resumed.value).toMatchObject({released: [held[0]!.id, held[1]!.id]});
        await waitUntil("都跑完", async () => ok(await client.runResult({sessionId, runId: (resumed.value as {runId: string}).runId})) !== null);
        expect(ok(await client.snapshot({sessionId})).buffer).toEqual([]);
        const path = await w.service.session(sessionId).path();
        expect(path.filter((event) => event.type === "input" || event.type === "steer").map((event) => [event.type, (event.data as {text: string}).text]).slice(-2)).toEqual([["input", "插一句"], ["input", "排一条"]]);
        await waitUntil("活动里没有了", () => changes.at(-1)?.some((item) => item.id === sessionId) === false);
        // 宿主空闲时排的话留着，它自己能放行：不算等用户处理。
        expect((await host.enqueue({commandId: cid(), input: {text: "日程又排的"}, mode: "followup"})).ok).toBe(true);
        expect(ok(await client.snapshot({sessionId})).buffer.map((item) => item.state)).toEqual(["held"]);
        expect(ok(await client.activity({}))).toEqual([]);
        watching.release();
    });

    test("输出 3：从浏览器来的输入按结构校验：缺字段、类型不对、多出字段都是 invalid-input，不进日志", async () => {
        const w = await world();
        const {client} = await w.window("a");
        const sessionId = ok(await client.create({profile: WRITER})).sessionId;
        for (const input of [{}, {text: 42}, {text: "好", attachments: "wrong"}, {text: "好", extra: true}]) {
            expect(await client.enqueue({sessionId, commandId: cid(), mode: "followup", input: input as never})).toMatchObject({ok: false, code: "invalid-input"});
        }
        expect(ok(await client.snapshot({sessionId})).buffer).toEqual([]);
    });

    test("输出 9：path 按页读，每页不超过 512 KiB，拼起来是整条路径；单个结果放不下时明确失败", async () => {
        const w = await world();
        const {client} = await w.window("a");
        const sessionId = ok(await client.create({profile: WRITER})).sessionId;
        for (let round = 0; round < 8; round += 1) {
            endpoint.script("好");
            await runOnServer(w, sessionId, "长".repeat(40_000));
        }
        const pages: LogItem[][] = [];
        for (let from = 0; ;) {
            const page = ok(await client.path({sessionId, from}));
            expect(JSON.stringify(page).length).toBeLessThanOrEqual(PAGE_BYTES);
            pages.push(page.items);
            from = page.next;
            if (!page.more) break;
        }
        expect(pages.length).toBeGreaterThan(1);
        const all = pages.flat();
        const whole = await w.service.session(sessionId).path();
        expect(all.map(seqOf)).toEqual(whole.map((event) => event.seq));
        // 运行结果不分页：回复超过一页时明确失败，不让链路收到超过上限的消息。
        // 不重复的文字：重复的字符串会被模型适配器当成循环而判出错。
        endpoint.script(randomBytes(PAGE_BYTES / 2).toString("hex"));
        const sent = ok(await client.send({sessionId, commandId: cid(), input: {text: "说长一点"}}));
        await w.service.session(sessionId).waitRun(sent.value.runId!);
        expect(await client.runResult({sessionId, runId: sent.value.runId!})).toMatchObject({ok: false, code: "result-too-large"});
    });

    test("输出 9：诊断按页读、按条件筛，长文字截短，每页放得下", async () => {
        const failing = [0, 1, 2, 3].map((index) => agentExtension(`test.diag.e${String(index)}`));
        const plugin: PluginDefinition = {id: "test.diag", entries: [defineEntry({id: "server", location: "server", activationEvents: [failing[0]!.activationEvent], contributions: failing.map((item) => item.contribution), activate: () => ({contributions: {"agent.extensions": Object.fromEntries(failing.map((item) => [item.contribution.id, defineExtension({id: item.contribution.id, mount: () => {
            throw new Error("坏".repeat(160_000));
        }})]))}})})]};
        const w = await world([plugin]);
        const {client} = await w.window("a");
        const sessionId = ok(await client.create({profile: WRITER})).sessionId;
        const items = [];
        let after: string | undefined;
        for (;;) {
            const page = ok(await client.diagnostics({sessionId, ...(after === undefined ? {} : {after})}));
            expect(JSON.stringify(page).length).toBeLessThanOrEqual(PAGE_BYTES);
            items.push(...page.items);
            if (!page.more) break;
            after = page.next!;
        }
        const failed = items.filter((item) => item.extension?.startsWith("test.diag.") === true);
        expect(failed.map((item) => item.extension).sort()).toEqual(["test.diag.e0", "test.diag.e1", "test.diag.e2", "test.diag.e3"]);
        for (const item of failed) expect(Buffer.byteLength(item.cause?.message ?? item.message)).toBeLessThanOrEqual(DIAGNOSTIC_TEXT_BYTES + 3);
        expect(ok(await client.diagnostics({sessionId, extension: "test.diag.e2"})).items.map((item) => item.extension)).toEqual(["test.diag.e2"]);
    });

    test("输出 7：订阅打不开的会话时订阅失败、调用方看得到，不会“订阅成功却永远没有帧”", async () => {
        const w = await world();
        const {client} = await w.window("a");
        let ended: string | null = null;
        const subscribed = await client.events.frames.subscribe({sessionId: "missing"}, () => undefined, {onEnd: (reason) => {
            ended = reason;
        }});
        if (subscribed.ok) await waitUntil("订阅结束", () => ended);
        else expect(subscribed.code).toBe("provider-error");
    });
});

describe("有归属的会话（输出 23–27）", () => {
    const logOf = (w: AgentWorld, id: string): string => join(w.stateRoot, "agent", "sessions", id, "session.jsonl");
    async function locked(w: AgentWorld, id: string): Promise<boolean> {
        const store = createJsonlStore({root: join(w.stateRoot, "agent", "sessions")});
        const opened = await store.open(id);
        if (!opened.ok) return opened.code === "session-busy";
        await store.close(opened.value);
        return false;
    }
    const revoked = (error: unknown): boolean => error instanceof Error && error.name === "ServiceRevokedError";

    test("验收 6：插件建有归属的会话并持有：列表不列它，空闲 30 秒后仍开着；远程的 rewind、archive 与归属插件自己视图上的 switchBranch 得 owned-session、日志不变；插件停止后会话照常空闲关闭；远程 create 带 owner 得 invalid-input", async () => {
        const w = await world();
        let captured: AgentService | null = null;
        const keeper = await w.register({id: "test.keeper", entries: [defineEntry({id: "server", location: "server", activationEvents: ["onStartup"], dependencies: [{key: agentKey}], activate: (context) => {
            captured = context.services.require(agentKey);
            return {};
        }})]});
        await w.settings.hub.plugins.activate({plugin: "test.keeper", entry: "server"});
        if (captured === null) throw new Error("the keeper did not get the agent service");
        const facade: AgentService = captured;
        const created = await facade.create({profile: WRITER, owner: {id: "main"}});
        if (!created.ok) throw new Error(created.code);
        const view = created.value;
        const held = await facade.hold(view.id);
        expect(held).toMatchObject({ok: true, value: {opened: null}});
        w.settings.clock.advance(IDLE_CLOSE_MS * 2);
        expect(await locked(w, view.id)).toBe(true);

        const {client} = await w.window("a");
        expect(ok(await client.list({})).map((entry) => entry.id)).not.toContain(view.id);
        expect(ok(await client.snapshot({sessionId: view.id})).header.owner).toEqual({plugin: "test.keeper", id: "main"});
        const before = await readFile(logOf(w, view.id));
        expect(await client.rewind({sessionId: view.id, commandId: cid(), to: null})).toMatchObject({ok: false, code: "owned-session"});
        expect(await client.archive({sessionId: view.id, commandId: cid(), archived: true})).toMatchObject({ok: false, code: "owned-session"});
        expect(await view.switchBranch({commandId: cid(), node: "n"})).toMatchObject({ok: false, code: "owned-session"});
        expect(await readFile(logOf(w, view.id))).toEqual(before);
        expect(await client.create({profile: WRITER, owner: {id: "x"}} as never)).toMatchObject({ok: false, code: "invalid-input"});

        await keeper.stop();
        expect(revoked((() => {
            try {
                view.snapshot();
            } catch (error) {
                return error;
            }
            return null;
        })())).toBe(true);
        w.settings.clock.advance(IDLE_CLOSE_MS);
        await waitUntil("插件停止后空闲关闭", async () => !(await locked(w, view.id)));
    });

    test("输出 26：没打开的有归属会话（日志里有没收口的运行）被拒时不打开：日志字节不变，之后照常能打开并收口", async () => {
        const path = join(root, `cold-${String((counter += 1))}`);
        const first = await agentWorld(path, {plugins: [contributor], userSettings: localModelSettings(endpoint.baseUrl)});
        const created = await first.service.create({profile: WRITER, owner: {id: "cold"}});
        if (!created.ok) throw new Error(created.code);
        const id = created.value.id;
        const hold = endpoint.hold();
        const sent = await created.value.send({commandId: cid(), input: {text: "长一点"}});
        if (!sent.ok) throw new Error(sent.code);
        await hold.arrived;
        // 运行还没收口时的日志：留到下一个世界里，就是进程中途退出的现场。
        const crashed = await readFile(logOf(first, id));
        hold.release();
        await first.close();
        await writeFile(logOf(first, id), crashed);

        const w = await agentWorld(path, {plugins: [contributor], userSettings: localModelSettings(endpoint.baseUrl)});
        worlds.push(w);
        const {client} = await w.window("a");
        expect(await client.rewind({sessionId: id, commandId: cid(), to: null})).toMatchObject({ok: false, code: "owned-session"});
        expect(await client.archive({sessionId: id, commandId: cid(), archived: false})).toMatchObject({ok: false, code: "owned-session"});
        expect(await w.service.session(id).switchBranch({commandId: cid(), node: "n"})).toMatchObject({ok: false, code: "owned-session"});
        expect(await locked(w, id)).toBe(false);
        expect(await readFile(logOf(w, id))).toEqual(crashed);
        // 对照：打开会写下收口，说明上面确实没有打开过。
        expect(ok(await client.snapshot({sessionId: id})).status.state).toBe("idle");
        expect((await readFile(logOf(w, id))).length).toBeGreaterThan(crashed.length);
    });

    test("输出 25：有归属的后台根与它派出的子会话都不进列表，按 id 仍读得到；fork 出来的会话没有归属，照常列出", async () => {
        const w = await world();
        const created = await w.service.create({profile: MAIN_PROFILE, background: true, owner: {id: "lyra"}});
        if (!created.ok) throw new Error(created.code);
        const owned = created.value;
        endpoint.scriptFor("先读一遍", "读完了");
        endpoint.script({tool: "agent_spawn", args: {profile: "nbook.agent.adhoc", prompt: "先读一遍", initial: {role: "设定核对员"}}}, "好");
        const sent = await owned.send({commandId: cid(), input: {text: "派"}});
        if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
        await owned.waitRun(sent.value.runId);
        const spawned = (await owned.path()).find((event) => event.type === "toolResult")?.data as {details?: {sessionId?: string}} | undefined;
        const child = spawned?.details?.sessionId;
        if (child === undefined) throw new Error("no child session");
        const forked = await owned.fork({commandId: cid()});
        if (!forked.ok) throw new Error(forked.code);

        const {client} = await w.window("a");
        for (const filter of [{}, {background: true}, {archived: false, background: false}]) {
            const ids = ok(await client.list(filter)).map((entry) => entry.id);
            expect(ids).not.toContain(owned.id);
            expect(ids).not.toContain(child);
        }
        const all = await w.service.list({background: undefined, archived: undefined});
        if (!all.ok) throw new Error(all.code);
        expect(all.value.map((entry) => entry.id)).toContain(forked.value.sessionId);
        expect(all.value.find((entry) => entry.id === forked.value.sessionId)?.owner).toBeUndefined();
        const childHeader = ok(await client.snapshot({sessionId: child})).header;
        expect(childHeader.caller).toMatchObject({kind: "session", id: owned.id});
        // 子会话没有归属（sessions.md 输出 23、26）：会话头不带 owner，改写历史不被拒。
        expect(childHeader.owner).toBeUndefined();
        // 子会话的祖先路径带出根的归属：浏览器据此知道它属于谁的树（conversation.md 输出 53）。
        expect(ok(await client.ancestors({sessionId: child}))).toEqual([expect.objectContaining({id: owned.id, owner: {plugin: expect.any(String), id: "lyra"}})]);
        expect(await client.archive({sessionId: child, commandId: cid(), archived: true})).toMatchObject({ok: true});
    });

    test("输出 25：有归属的前台会话在跑时 running() 照样算它；列表不列它", async () => {
        const w = await world();
        const created = await w.service.create({profile: WRITER, owner: {id: "front"}});
        if (!created.ok) throw new Error(created.code);
        const hold = endpoint.hold();
        const sent = await created.value.send({commandId: cid(), input: {text: "长一点"}});
        if (!sent.ok) throw new Error(sent.code);
        await hold.arrived;
        expect(w.service.running()).toContain(created.value.id);
        const listed = await w.service.list();
        expect(listed.ok && listed.value.map((entry) => entry.id)).not.toContain(created.value.id);
        hold.release();
        await created.value.waitRun(sent.value.runId!);
    });

    test("输出 27：远程 send 带 settlePending: \"deny\"：挂着的审批以 deny 结算（用户发了新消息），这句话照常受理", async () => {
        const w = await world();
        const {client} = await w.window("a");
        const sessionId = ok(await client.create({profile: MAIN_PROFILE})).sessionId;
        ok(await client.changeSettings({sessionId, commandId: cid(), patch: {core: {approvalMode: "ask"}}}));
        endpoint.script({tool: "shell", args: {command: "touch a.txt"}}, "好", "收到");
        const first = ok(await client.send({sessionId, commandId: cid(), input: {text: "建个文件"}}));
        const asked = async () => ok(await client.snapshot({sessionId})).status;
        await waitUntil("停在审批上", async () => (await asked()).state === "waiting");
        const settled = ok(await client.send({sessionId, commandId: cid(), input: {text: "算了，别建了"}, settlePending: "deny"}));
        // 结算放开了审批，这句话由同一次运行接着取走。
        expect(settled.value).toMatchObject({placement: "taken", currentRunId: first.value.runId});
        await w.service.session(sessionId).waitRun(first.value.runId!);
        const events = (await w.service.session(sessionId).path()).map((event) => [event.type, event.data] as const);
        expect(events.find(([type]) => type === "interactionResolved")?.[1]).toMatchObject({decision: "deny", note: "用户发了新消息", by: {kind: "user"}});
        expect(JSON.stringify(events.filter(([type]) => type === "input"))).toContain("算了，别建了");
    });
});
