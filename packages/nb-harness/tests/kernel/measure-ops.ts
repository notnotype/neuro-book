/**
 * 宿主操作的测量（t20 第 11 片，提案第 19 节六项里除“打开与恢复”“普通请求”之外的四项）：合成日志打开之后，量
 * 单条事件的写入与归约（`enqueue` 一条，受理批两条事件）、预览下一次请求、换 Profile（重新归约）与之后第一次请求
 * （已提交的轮全部重新渲染）、一次压缩与之后第一次请求。每组单独一个进程；`NODE_ENV=production` 时不做开发检查。
 *
 * 用法：bun tests/kernel/measure-ops.ts <轮数> [每条回复的字数]
 */

import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {closeSession, createJsonlStore, defineProfile, openSession, type CompactionMethodImpl, type ModelPort, type SessionApi} from "@notnotype/nb-harness/kernel";
import {createTestModel} from "@notnotype/nb-harness/kernel/testing";
import {profile, syntheticEnv, writeSyntheticLog} from "./synthetic-log.js";

const turns = Number(process.argv[2] ?? "2000");
const replyChars = Number(process.argv[3] ?? "1500");
const root = await mkdtemp(join(tmpdir(), "nb-kernel-ops-"));
const store = createJsonlStore({root});
await writeSyntheticLog(store, "measure", turns, replyChars);

// 模型收到请求的时刻：量“发出指令 → 模型端口收到请求”。
const model = createTestModel();
let arrived = 0;
const port: ModelPort = {
    resolve: (settings, purpose) => {
        const resolution = model.port.resolve(settings, purpose);
        if (!resolution.ok) return resolution;
        return {...resolution, call: (request, signal, onDelta) => {
            arrived = performance.now();
            return resolution.call(request, signal, onDelta);
        }};
    },
};
// 压缩方法：保留最后一轮，摘要是一句固定的话（不调模型，只量内核的公共流程与之后的重新渲染）。
const keepLast: CompactionMethodImpl = async (job) => {
    const cut = job.cuts.filter((item) => item.kind === "turn").at(-1)!;
    return {method: job.method, firstKeptEntryId: cut.entryId, replacement: "之前的对话摘要。", omitted: [], tokensBefore: job.tokens, tokensAfter: cut.tokensKept};
};
// 换过去的 Profile 用 keep 压缩（超过阈值、手动压缩都按它）。
const other = defineProfile({id: "test.measure-other", version: "1", name: "m2", description: "m2", system: "另一个", compaction: {onThreshold: ["keep"]}});
const base = syntheticEnv(store, port);
const env = {...base, profiles: {resolve: (key: string) => (key === profile.id ? profile : key === other.id ? other : undefined)}, compaction: {methods: {keep: keepLast}}};

const opened = await openSession(env, "measure");
if (!opened.ok) throw new Error(opened.code);
const session: SessionApi = opened.value;
const ms = (value: number) => Math.round(value * 10) / 10;

async function requestAfter(text: string): Promise<number> {
    model.script("好");
    const start = performance.now();
    const sent = await session.send({commandId: `send-${text}`, input: {text}});
    if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
    await session.waitRun(sent.value.runId);
    return ms(arrived - start);
}

// 一、单条事件：enqueue 一条（受理批两条事件：inputQueued、commandAccepted），取 50 次的中位数。
const writes: number[] = [];
for (let index = 0; index < 50; index += 1) {
    const start = performance.now();
    await session.enqueue({commandId: `q-${index}`, input: {text: `排队 ${index}`}, mode: "steer"});
    writes.push(performance.now() - start);
}
writes.sort((a, b) => a - b);
for (const item of (await session.snapshot()).buffer) await session.remove({commandId: `r-${item.id}`, inputId: item.id});

// 二、预览：冷（提交缓存已由打开时的恢复之外没有渲染过）与热。
let start = performance.now();
await session.preview();
const previewCold = ms(performance.now() - start);
start = performance.now();
await session.preview();
const previewWarm = ms(performance.now() - start);

// 三、换 Profile（重新归约全部事件）与之后第一次请求（已提交的轮按新 Profile 全部重新渲染）。
start = performance.now();
const changed = await session.changeProfile({commandId: "change", profile: other.id});
if (!changed.ok) throw new Error(changed.code);
const changeProfile = ms(performance.now() - start);
const afterChange = await requestAfter("换了 Profile 之后");

// 四、一次压缩（只压缩的运行）与之后第一次请求。
start = performance.now();
const compacted = await session.compact({commandId: "compact"});
if (!compacted.ok || compacted.value.runId === undefined) throw new Error(compacted.ok ? "compact did not start" : compacted.code);
const compactResult = await session.waitRun(compacted.value.runId);
const compaction = ms(performance.now() - start);
const afterCompaction = await requestAfter("压缩之后");

const snapshot = await session.snapshot();
console.log(JSON.stringify({
    turns,
    events: snapshot.head,
    replyChars,
    production: process.env.NODE_ENV === "production",
    writeMedianMs: ms(writes[Math.floor(writes.length / 2)]!),
    writeP95Ms: ms(writes[Math.floor(writes.length * 0.95)]!),
    previewColdMs: previewCold,
    previewWarmMs: previewWarm,
    changeProfileMs: changeProfile,
    firstRequestAfterChangeMs: afterChange,
    compactionMs: compaction,
    compactionReason: compactResult.reason,
    firstRequestAfterCompactionMs: afterCompaction,
}));
await closeSession(session);
await rm(root, {recursive: true, force: true});
