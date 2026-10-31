/**
 * 打开与归约的测量（t20 第 3 片的出口；第 11 片扩成提案第 19 节的六项）：用存储直接写一份合成日志，再经 `openSession`
 * 走完整的打开（读、校验、装配、归约、恢复、装上），量耗时、堆上活数据与常驻增量。每组单独一个进程。
 *
 * 用法：bun tests/kernel/measure-open.ts <轮数> [每条回复的字数]
 */

import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {heapStats} from "bun:jsc";
import {closeSession, conv, createJsonlStore, defineExtension, defineProfile, openSession, slice, type LogEvent, type SessionEnv} from "@notnotype/nb-harness/kernel";
import {createTestClock, createTestModel} from "@notnotype/nb-harness/kernel/testing";

const turns = Number(process.argv[2] ?? "2000");
const replyChars = Number(process.argv[3] ?? "1500");
const root = await mkdtemp(join(tmpdir(), "nb-kernel-open-"));
const store = createJsonlStore({root});

// 两个有片的扩展：一个按 path 数输入与回复字数，一个按 session 记最后一条输入；另有一个对话事件。
const counter = defineExtension({id: "lab.counter", state: {inputs: slice.path(0), chars: slice.path(0)}, events: {note: conv()}, reduce: {
    input: (_event, state) => ({inputs: state.inputs + 1}),
    assistant: (event, state) => ({chars: state.chars + event.data.content.length}),
}});
const last = defineExtension({id: "lab.last", state: {text: slice.session("")}, reduce: {inputQueued: (event) => ({text: event.data.input.text})}});
const profile = defineProfile({id: "test.measure", version: "1", name: "m", description: "m", system: "测"});

let seq = 0;
let leaf: string | null = null;
function event(type: string, kind: LogEvent["kind"], scope: LogEvent["scope"], data: unknown, source = "kernel"): LogEvent {
    seq += 1;
    const id = `e${seq}`;
    const made: LogEvent = {id, seq, at: seq, parent: scope === "path" ? leaf : null, scope, kind, type, version: 1, source, data};
    if (scope === "path") leaf = id;
    return made;
}
const reply = "林舟推开门，".repeat(Math.ceil(replyChars / 6)).slice(0, replyChars);
const usage = {input: 1200, output: 400, cacheRead: 800, cacheWrite: 0, cost: null, complete: true};
const created = await store.create({format: 1, id: "measure", createdAt: 0, profile: profile.id, questions: "user"});
if (!created.ok) throw new Error(created.code);
await store.append(created.value, [event("sessionCreated", "ctrl", "path", {initial: {}}), event("profileChanged", "ctrl", "session", {profile: profile.id, hash: "x", from: null, reason: "created", manifest: []})]);
for (let turn = 0; turn < turns; turn += 1) {
    const inputId = `i${turn}`;
    const turnId = `t${turn}`;
    const runId = `r${turn}`;
    const text = `第 ${turn} 句：接着写下一段。`;
    for (const batch of [
        [event("inputQueued", "ctrl", "session", {id: inputId, input: {text}, mode: "followup"}), event("runStarted", "ctrl", "path", {runId, kind: "chat"}), event("inputConsumed", "ctrl", "session", {id: inputId}), event("turnStarted", "ctrl", "path", {turnId, inputId}), event("input", "conv", "path", {text, queued: inputId}, "kernel"), event("commandAccepted", "ctrl", "session", {commandId: `c${turn}`, name: "send", value: {inputId, runId}})],
        [event("lab.counter/note", "conv", "path", {text: "附带的提醒"}, "lab.counter")],
        [event("modelStarted", "ctrl", "path", {request: turn + 1, purpose: "turn", model: "test/model", hash: "0".repeat(64), now: turn, invocation: `v${turn}`, modifiedBy: []})],
        [event("assistant", "conv", "path", {request: turn + 1, content: [{kind: "text", text: reply}], toolCalls: [], stopReason: "stop", usage, model: "test/model"})],
        [event("turnEnded", "ctrl", "path", {turnId, reason: "completed"}), event("runEnded", "ctrl", "path", {runId, reason: "completed"})],
    ]) {
        const appended = await store.append(created.value, batch);
        if (!appended.ok) throw new Error(appended.code);
    }
}
await store.close(created.value);

const env: SessionEnv = {
    store,
    profiles: {resolve: (key) => (key === profile.id ? profile : undefined)},
    extensions: () => [{extension: counter, plugin: null}, {extension: last, plugin: null}],
    models: createTestModel().port,
    tools: {declarations: () => [], create: () => Promise.reject(new Error("no tools"))},
    resources: () => ({read: async () => undefined, resolve: (uri) => uri}),
    sessions: {get: () => Promise.reject(new Error("no sessions"))},
    clock: createTestClock(),
    approve: async () => ({verdict: "allow", by: "measure"}),
};
Bun.gc(true);
const rssBefore = process.memoryUsage().rss;
const heapBefore = heapStats().heapSize;
const start = performance.now();
const opened = await openSession(env, "measure");
const openMs = performance.now() - start;
if (!opened.ok) throw new Error(opened.code);
Bun.gc(true);
const heapAfter = heapStats().heapSize;
const rssAfter = process.memoryUsage().rss;
const snapshot = await opened.value.snapshot();
console.log(JSON.stringify({turns, events: snapshot.head, replyChars, openMs: Math.round(openMs), openHeapMB: Math.round((heapAfter - heapBefore) / 1e6), openRssMB: Math.round((rssAfter - rssBefore) / 1e6)}));
await closeSession(opened.value);
await rm(root, {recursive: true, force: true});
