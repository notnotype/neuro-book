/**
 * 测量用的合成日志：用存储直接写一份每轮 10 条事件的会话（受理批、一条附带的对话事件、模型请求、回复、收口），
 * 以及配套的扩展、Profile 与会话环境。`measure-open.ts` 与 `measure-request.ts` 共用。
 */

import {conv, defineExtension, defineProfile, slice, type LogEvent, type LogStore, type ModelPort, type SessionEnv} from "@notnotype/nb-harness/kernel";
import {createTestClock, createTestModel} from "@notnotype/nb-harness/kernel/testing";

/** 两个有片的扩展：一个按 path 数输入与回复字数，一个按 session 记最后一条输入；另有一个对话事件。 */
export const counter = defineExtension({id: "lab.counter", state: {inputs: slice.path(0), chars: slice.path(0)}, events: {note: conv()}, reduce: {
    input: (_event, state) => ({inputs: state.inputs + 1}),
    assistant: (event, state) => ({chars: state.chars + event.data.content.length}),
}});
export const last = defineExtension({id: "lab.last", state: {text: slice.session("")}, reduce: {inputQueued: (event) => ({text: event.data.input.text})}});
export const profile = defineProfile({id: "test.measure", version: "1", name: "m", description: "m", system: "测"});

export async function writeSyntheticLog(store: LogStore, id: string, turns: number, replyChars: number): Promise<void> {
    let seq = 0;
    let leaf: string | null = null;
    const event = (type: string, kind: LogEvent["kind"], scope: LogEvent["scope"], data: unknown, source = "kernel"): LogEvent => {
        seq += 1;
        const eventId = `e${seq}`;
        const made: LogEvent = {id: eventId, seq, at: seq, parent: scope === "path" ? leaf : null, scope, kind, type, version: 1, source, data};
        if (scope === "path") leaf = eventId;
        return made;
    };
    const reply = "林舟推开门，".repeat(Math.ceil(replyChars / 6)).slice(0, replyChars);
    const usage = {input: 1200, output: 400, cacheRead: 800, cacheWrite: 0, cost: null, complete: true};
    const created = await store.create({format: 1, id, createdAt: 0, profile: profile.id, questions: "user"});
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
}

export function syntheticEnv(store: LogStore, models: ModelPort = createTestModel().port): SessionEnv {
    return {
        store,
        profiles: {resolve: (key) => (key === profile.id ? profile : undefined)},
        extensions: () => [{extension: counter, plugin: null}, {extension: last, plugin: null}],
        models,
        tools: {declarations: () => [], create: () => Promise.reject(new Error("no tools"))},
        resources: () => ({read: async () => undefined, resolve: (uri) => uri}),
        sessions: {get: () => Promise.reject(new Error("no sessions"))},
        clock: createTestClock(),
        approve: async () => ({verdict: "allow", by: "measure"}),
    };
}
