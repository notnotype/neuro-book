/**
 * 远程合同 `nbook.agent/sessions`（docs/specs/agent/sessions.md）：窗口经真实的远程链路（JSON 编解码、可断线重连）调用服务端的
 * `nbook.agent`，模型是本机的 OpenAI 兼容端点。测试名里的编号是 sessions.md 的输出条目与验收场景。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {defineProfile} from "@notnotype/nb-harness/kernel";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {DELTA_WINDOW_MS, EVENT_INLINE_BYTES} from "./backend/frames";
import {agentProfile, agentTool} from "./shared/points";
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

async function world(): Promise<AgentWorld> {
    counter += 1;
    const created = await agentWorld(join(root, `w${String(counter)}`), {plugins: [contributor], userSettings: localModelSettings(endpoint.baseUrl)});
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
        expect(await client.create({profile: "test.profiles.missing"})).toMatchObject({ok: false, code: "unknown-profile"});
        expect(ok(await client.profiles({})).map((profile) => profile.key)).toEqual([WRITER]);
    });
});
