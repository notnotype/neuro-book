/**
 * 算一次请求的测量（t20 第 4 片的出口；第 11 片并进提案第 19 节的六项）：合成日志打开之后发两条输入，
 * 量“发出指令 → 模型端口收到请求”的用时。第一次要把全部已提交的轮各渲染一次（提交缓存冷），第二次只多渲染一轮（缓存热）。
 * 用时含受理批的一次写入。每组单独一个进程；`NODE_ENV=production` 时不做冻结与视图的开发检查。
 *
 * 用法：bun tests/kernel/measure-request.ts <轮数> [每条回复的字数]
 */

import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {heapStats} from "bun:jsc";
import {closeSession, createJsonlStore, openSession, type ModelPort, type SessionApi} from "@notnotype/nb-harness/kernel";
import {createTestModel} from "@notnotype/nb-harness/kernel/testing";
import {syntheticEnv, writeSyntheticLog} from "./synthetic-log.js";

const turns = Number(process.argv[2] ?? "2000");
const replyChars = Number(process.argv[3] ?? "1500");
const root = await mkdtemp(join(tmpdir(), "nb-kernel-request-"));
const store = createJsonlStore({root});
await writeSyntheticLog(store, "measure", turns, replyChars);

// 包一层端口：在模型收到请求的那一刻记时刻与请求的大小。
const model = createTestModel();
model.script("好", "好");
let arrived: {at: number; messages: number} | null = null;
const port: ModelPort = {
    resolve: (settings, purpose) => {
        const resolution = model.port.resolve(settings, purpose);
        if (!resolution.ok) return resolution;
        return {...resolution, call: (request, signal, onDelta) => {
            arrived = {at: performance.now(), messages: request.messages.length};
            return resolution.call(request, signal, onDelta);
        }};
    },
};
const opened = await openSession(syntheticEnv(store, port), "measure");
if (!opened.ok) throw new Error(opened.code);
const session: SessionApi = opened.value;

async function timedSend(text: string): Promise<{ms: number; messages: number}> {
    arrived = null;
    const start = performance.now();
    const sent = await session.send({commandId: text, input: {text}});
    if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
    await session.waitRun(sent.value.runId);
    const seen = arrived as {at: number; messages: number} | null;
    if (seen === null) throw new Error("the model was not called");
    return {ms: Math.round((seen.at - start) * 10) / 10, messages: seen.messages};
}

Bun.gc(true);
const heapBefore = heapStats().heapSize;
const cold = await timedSend("冷");
Bun.gc(true);
const heapAfter = heapStats().heapSize;
const warm = await timedSend("热");
const snapshot = await session.snapshot();
console.log(JSON.stringify({turns, events: snapshot.head, replyChars, production: process.env.NODE_ENV === "production", coldMs: cold.ms, warmMs: warm.ms, messages: warm.messages, commitCacheHeapMB: Math.round((heapAfter - heapBefore) / 1e6)}));
await closeSession(session);
await rm(root, {recursive: true, force: true});
