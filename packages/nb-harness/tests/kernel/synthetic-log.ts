/**
 * 测量用的合成日志：用存储直接写一份会话，以及配套的扩展、Profile 与会话环境。`measure-*.ts` 共用。
 * 每轮：受理批、一条附带的对话事件、模型请求、回复、收口（10 条）；每 `toolEvery` 轮一轮先调一次工具（调用带 200 字的参数、
 * 结果 500 字，多 4 条：toolStarted、toolResult、第二次模型请求与回复）。`unsettled` 时最后一轮停在工具执行中
 * （写了 toolStarted、没有结果、没有 runEnded），打开时要走恢复的结算。
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

export interface SyntheticOptions {
    /** 每几轮有一轮调工具；0 表示不调。缺省 3。 */
    readonly toolEvery?: number;
    readonly unsettled?: boolean;
}

export async function writeSyntheticLog(store: LogStore, id: string, turns: number, replyChars: number, options: SyntheticOptions = {}): Promise<void> {
    const toolEvery = options.toolEvery ?? 3;
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
    const query = "林舟去过的地方".repeat(29).slice(0, 200);
    const found = "第三章写到林舟在渡口等船，".repeat(39).slice(0, 500);
    let request = 0;
    const created = await store.create({format: 1, id, createdAt: 0, profile: profile.id, questions: "user"});
    if (!created.ok) throw new Error(created.code);
    await store.append(created.value, [event("sessionCreated", "ctrl", "path", {initial: {}}), event("profileChanged", "ctrl", "session", {profile: profile.id, hash: "x", from: null, reason: "created", manifest: []})]);
    for (let turn = 0; turn < turns; turn += 1) {
        const inputId = `i${turn}`;
        const turnId = `t${turn}`;
        const runId = `r${turn}`;
        const text = `第 ${turn} 句：接着写下一段。`;
        const withTool = toolEvery > 0 && turn % toolEvery === toolEvery - 1;
        const stopsInTool = options.unsettled === true && turn === turns - 1;
        const started = (): LogEvent => event("modelStarted", "ctrl", "path", {request: (request += 1), purpose: "turn", model: "test/model", hash: "0".repeat(64), now: turn, invocation: `v${turn}-${request}`, modifiedBy: []});
        const callId = `call-${turn}`;
        // 批要在用到 event() 时才建：event() 按调用顺序编 seq 与父节点。
        const batches: (() => LogEvent[])[] = [
            () => [event("inputQueued", "ctrl", "session", {id: inputId, input: {text}, mode: "followup"}), event("runStarted", "ctrl", "path", {runId, kind: "chat"}), event("inputConsumed", "ctrl", "session", {id: inputId}), event("turnStarted", "ctrl", "path", {turnId, inputId}), event("input", "conv", "path", {text, queued: inputId}, "kernel"), event("commandAccepted", "ctrl", "session", {commandId: `c${turn}`, name: "send", value: {inputId, runId}})],
            () => [event("lab.counter/note", "conv", "path", {text: "附带的提醒"}, "lab.counter")],
        ];
        if (withTool || stopsInTool) {
            batches.push(
                () => [started()],
                () => [event("assistant", "conv", "path", {request, content: [{kind: "text", text: "我查一下。"}], toolCalls: [{id: callId, tool: "lab.search", args: {query}}], stopReason: "tool", usage, model: "test/model"})],
                () => [event("toolStarted", "ctrl", "path", {callId, tool: "lab.search", args: {query}, invocation: `x${turn}`, approval: {by: "measure"}})],
            );
            if (!stopsInTool) batches.push(() => [event("toolResult", "conv", "path", {callId, tool: "lab.search", text: found, status: "ok"})]);
        }
        if (!stopsInTool) {
            batches.push(
                () => [started()],
                () => [event("assistant", "conv", "path", {request, content: [{kind: "text", text: reply}], toolCalls: [], stopReason: "stop", usage, model: "test/model"})],
                () => [event("turnEnded", "ctrl", "path", {turnId, reason: "completed"}), event("runEnded", "ctrl", "path", {runId, reason: "completed"})],
            );
        }
        for (const make of batches) {
            const batch = make();
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
