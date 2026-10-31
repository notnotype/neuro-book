/**
 * 存储的测量（t20 第 2 片的出口，第 11 片扩成提案第 19 节的六项）：在临时目录写一份接近真实的会话日志，
 * 量写入、打开（切行、校验、读回大块内容）的耗时与打开后的常驻内存。每组在单独的进程里量，内存才不互相影响。
 *
 * 用法：bun tests/kernel/measure-store.ts <轮数> [每条回复的字数]
 */

import {mkdtemp, rm, stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {heapStats} from "bun:jsc";
import {createJsonlStore, type LogEvent, type SessionHeader} from "@notnotype/nb-harness/kernel";

const turns = Number(process.argv[2] ?? "2000");
const replyChars = Number(process.argv[3] ?? "1500");
const root = await mkdtemp(join(tmpdir(), "nb-kernel-measure-"));
const store = createJsonlStore({root});
const header: SessionHeader = {format: 1, id: "measure", createdAt: 0, profile: "builtin.measure", questions: "user"};

let seq = 0;
let leaf: string | null = null;
function event(type: string, kind: LogEvent["kind"], scope: LogEvent["scope"], data: unknown): LogEvent {
    seq += 1;
    const id = `e${seq}`;
    const made: LogEvent = {id, seq, at: seq, parent: scope === "path" ? leaf : null, scope, kind, type, version: 1, source: "kernel", data};
    if (scope === "path") leaf = id;
    return made;
}
const reply = "林舟推开门，".repeat(Math.ceil(replyChars / 6)).slice(0, replyChars);
const usage = {input: 1200, output: 400, cacheRead: 800, cacheWrite: 0, cost: null, complete: true};

const created = await store.create(header);
if (!created.ok) throw new Error(created.code);
const writeStart = performance.now();
for (let turn = 0; turn < turns; turn += 1) {
    const inputId = `i${turn}`;
    const turnId = `t${turn}`;
    const runId = `r${turn}`;
    const batches: LogEvent[][] = [
        [
            event("inputQueued", "ctrl", "session", {id: inputId, input: {text: `第 ${turn} 句：接着写下一段。`}, mode: "followup"}),
            event("runStarted", "ctrl", "path", {runId, kind: "chat"}),
            event("inputConsumed", "ctrl", "session", {id: inputId}),
            event("turnStarted", "ctrl", "path", {turnId, inputId}),
            event("input", "conv", "path", {text: `第 ${turn} 句：接着写下一段。`, queued: inputId}),
            event("commandAccepted", "ctrl", "session", {commandId: `c${turn}`, name: "send", value: {inputId, runId}}),
        ],
        [event("modelStarted", "ctrl", "path", {request: turn + 1, purpose: "turn", model: "test/model", hash: "0".repeat(64), now: turn, invocation: `v${turn}`, modifiedBy: []})],
        [event("assistant", "conv", "path", {request: turn + 1, content: [{kind: "text", text: reply}], toolCalls: [], stopReason: "stop", usage, model: "test/model"})],
        [event("turnEnded", "ctrl", "path", {turnId, reason: "completed"}), event("runEnded", "ctrl", "path", {runId, reason: "completed"})],
    ];
    for (const batch of batches) {
        const appended = await store.append(created.value, batch);
        if (!appended.ok) throw new Error(appended.code);
    }
}
const writeMs = performance.now() - writeStart;
await store.close(created.value);
const size = (await stat(join(root, "measure", "session.jsonl"))).size;

Bun.gc(true);
const before = process.memoryUsage().rss;
const heapBefore = heapStats().heapSize;
const openStart = performance.now();
const opened = await store.open("measure");
const openMs = performance.now() - openStart;
if (!opened.ok) throw new Error(opened.code);
Bun.gc(true);
const after = process.memoryUsage().rss;
const heapAfter = heapStats().heapSize;
console.log(JSON.stringify({
    turns,
    events: opened.value.events.length,
    replyChars,
    fileMB: +(size / 1e6).toFixed(1),
    writeMs: Math.round(writeMs),
    appendMsPerBatch: +(writeMs / (turns * 4)).toFixed(3),
    openMs: Math.round(openMs),
    /** 打开后堆上活着的数据。 */
    openHeapMB: Math.round((heapAfter - heapBefore) / 1e6),
    /** 打开后进程常驻的增量：含打开过程中的峰值（分配器回收后不一定还给系统）。 */
    openRssMB: Math.round((after - before) / 1e6),
}));
await store.close(opened.value);
await rm(root, {recursive: true, force: true});
