/**
 * 反应：一个写入批落盘并归约之后，按批里事件的顺序派发给各扩展的处理函数（extensions.md 输出 11–18）。
 *
 * - 同一条事件的处理函数看同一份状态（这条事件写入之后），并发执行；全部完成后按装配序逐个写它们的输出，
 *   每个扩展的输出是一个写入批，写下之后接着派发这一批的反应（深度加一）。
 * - 抛错、超时、中止、写错了输出：整批丢弃，写 `extensionFailed`（带丢弃的条数）并留诊断。
 * - 反应链从根事件起最多写到第 3 层；再往下的处理函数不调用，写一条 `reactionLimit`。
 * - 由运行引出的反应，处理函数的信号同时挂在运行的中止上：中止时不再等它们，输出丢弃并记 `aborted`。
 *
 * 这些都在队列的同一项里完成：一项是“一个写入批连同它引出的反应”。
 */

import type {JsonValue, LogEvent, Resources, ToolSessionContext} from "../api/index.js";
import type {Assembled} from "../extension/assemble.js";
import {assistantCtx, Outputs, reactCtx, stateOf, type StateAt, type ViewEnvironment} from "../extension/ctx.js";
import {STATE_SET} from "../state/snapshot.js";
import type {EventDraft} from "../state/draft.js";
import type {SessionCore} from "./core.js";

export const REACTION_DEPTH_LIMIT = 3;
export const HANDLER_TIMEOUT_MS = 30_000;

export interface ReactHost {
    environment(): ViewEnvironment;
    readonly resources: Resources;
    session(): ToolSessionContext;
}

export interface Reacted {
    readonly events: readonly LogEvent[];
    /** `assistant` 的处理函数里 `continue` 的请求，按装配序。 */
    readonly continues: readonly {extension: string; text: string}[];
}

/** 这条事件在这个扩展的 `on` 表里的键：内核事件与自己的事件用短名，别人的事件用全名。 */
function handlerKey(item: Assembled, type: string): string {
    const prefix = `${item.definition.id}/`;
    return type.startsWith(prefix) && !type.slice(prefix.length).includes("/") ? type.slice(prefix.length) : type;
}

type Settled = {kind: "done"} | {kind: "threw"; error: unknown} | {kind: "timeout"} | {kind: "aborted"};

/** 写一个批并派发它引出的反应。只能在队列的一项里调用。 */
export async function writeAndReact(core: SessionCore, drafts: readonly EventDraft[], host: ReactHost, runSignal?: AbortSignal): Promise<Reacted> {
    const events = await core.write(drafts);
    const states = events.map((event) => core.stateAfter(event.id));
    const continues: {extension: string; text: string}[] = [];
    for (let index = 0; index < events.length; index += 1) await reactTo(core, events[index]!, states[index]!, host, runSignal, continues);
    return {events, continues};
}

async function reactTo(core: SessionCore, event: LogEvent, state: StateAt, host: ReactHost, runSignal: AbortSignal | undefined, continues: {extension: string; text: string}[]): Promise<void> {
    if (event.type.endsWith(`/${STATE_SET}`)) return;
    // settingsChanged 只派发给设置所属的扩展（KernelEvents 的注释）。
    const owner = event.type === "settingsChanged" ? (event.data as {extension: string}).extension : null;
    const handlers = core.assembly.order.filter((item) => !core.inactive(item.definition.id) && (owner === null || item.definition.id === owner) && typeof (item.definition.on as Record<string, unknown> | undefined)?.[handlerKey(item, event.type)] === "function");
    if (handlers.length === 0) return;
    const depth = (event.depth ?? 0) + 1;
    if (depth > REACTION_DEPTH_LIMIT) {
        await core.write([{type: "reactionLimit", kind: "ctrl", scope: "path", data: {root: event.id, dropped: handlers.map((item) => item.definition.id)}, cause: event.id}]);
        core.diagnostics.add({code: "reaction-depth-limit", extension: handlers[0]!.definition.id, entry: "on", event: {id: event.id, type: event.type, seq: event.seq}, params: {depth}, message: `reaction chain from ${event.type} went deeper than ${REACTION_DEPTH_LIMIT}; handlers were not called`}, core.head);
        return;
    }
    const environment = host.environment();
    const runs = handlers.map((item) => runHandler(core, item, event, state, environment, host.resources, host.session(), runSignal));
    const results = await Promise.all(runs);
    for (const {item, outputs, settled} of results) {
        const id = item.definition.id;
        const at = {id: event.id, type: event.type, seq: event.seq};
        const failure = settled.kind !== "done" ? settled.kind : outputs.invalid !== null ? "invalid-output" : null;
        if (failure !== null) {
            const code = failure === "threw" ? "threw" : failure;
            await core.write([{type: "extensionFailed", kind: "ctrl", scope: "path", data: {extension: id, entry: "on", code, dropped: {events: outputs.emits.length, sets: outputs.sets.size}}, cause: event.id}]);
            if (failure !== "aborted") {
                const diagnostic = failure === "timeout" ? "handler-timeout" : failure === "invalid-output" ? "handler-invalid-output" : "handler-threw";
                core.diagnostics.add({code: diagnostic, extension: id, entry: "on", event: at, message: outputs.invalid ?? `${id} handler for ${event.type} ${failure === "timeout" ? "timed out" : "threw"}; its output is dropped`, ...(settled.kind === "threw" ? {cause: settled.error} : {}), persisted: true}, core.head);
            }
            continue;
        }
        // 反应进行中扩展被撤回：它这次的输出丢掉，只写诊断（runtime.md 输出 57）。
        if (core.inactive(id)) {
            if (outputs.continueText !== null || outputs.emits.length > 0 || outputs.sets.size > 0) core.diagnostics.add({code: "late-result-dropped", extension: id, entry: "on", event: at, subject: "revoked", message: `${id} was revoked while its handler for ${event.type} was running; its output is dropped`}, core.head);
            continue;
        }
        if (outputs.continueText !== null) continues.push({extension: id, text: outputs.continueText});
        const drafts = outputDrafts(core, item, outputs, event, depth);
        if (drafts.length > 0) {
            const nested = await writeAndReact(core, drafts, host, runSignal);
            continues.push(...nested.continues);
        }
    }
}

async function runHandler(core: SessionCore, item: Assembled, event: LogEvent, state: StateAt, environment: ViewEnvironment, resources: Resources, session: ToolSessionContext, runSignal: AbortSignal | undefined): Promise<{item: Assembled; outputs: Outputs; settled: Settled}> {
    const outputs = new Outputs();
    const controller = new AbortController();
    const onRunAbort = () => controller.abort(runSignal?.reason);
    runSignal?.addEventListener("abort", onRunAbort, {once: true});
    const id = item.definition.id;
    const late = (call: "emit" | "set") => core.diagnostics.add({code: "emit-after-settle", extension: id, entry: "on", event: {id: event.id, type: event.type, seq: event.seq}, params: {call}, message: `${id} called ${call} after its handler for ${event.type} settled; the call is ignored`, hint: "await every promise inside the handler, or write from mount with ctx.callback"}, core.head);
    const params = {assembly: core.assembly, item, state, environment, resources, session, signal: controller.signal, outputs, late};
    const ctx = event.type === "assistant"
        ? assistantCtx({...params, reply: event.data as {toolCalls: readonly unknown[]}, limited: (max) => core.diagnostics.add({code: "continue-limit", extension: id, entry: "on", params: {max}, message: `${id} asked to continue more than ${max} times in one turn`}, core.head)})
        : reactCtx(params);
    const handler = (item.definition.on as Record<string, (event: LogEvent, ctx: unknown) => unknown>)[handlerKey(item, event.type)]!;
    const timeout = item.definition.timeoutMs ?? HANDLER_TIMEOUT_MS;
    const timer = core.clock.wait(timeout, controller.signal).then((): Settled => ({kind: "timeout"}), (): Settled => ({kind: "aborted"}));
    const work = (async (): Promise<Settled> => {
        try {
            await handler(event, ctx);
            return {kind: "done"};
        } catch (error) {
            return {kind: "threw", error};
        }
    })();
    let settled = await Promise.race([work, timer]);
    // 计时器被下面的 abort 拒绝时会落成 aborted；只有运行确实中止了才算 aborted，其余是处理函数自己先完成。
    if (settled.kind === "aborted" && runSignal?.aborted !== true) settled = await work;
    outputs.settled = true;
    if (settled.kind === "timeout") controller.abort(new Error(`handler timed out after ${timeout} ms`));
    else controller.abort();
    runSignal?.removeEventListener("abort", onRunAbort);
    return {item, outputs, settled};
}

/** 处理函数的输出变成写入批：`emit` 的事件（幂等键命中的不写）与改了值的片。 */
function outputDrafts(core: SessionCore, item: Assembled, outputs: Outputs, cause: LogEvent, depth: number): EventDraft[] {
    const id = item.definition.id;
    const declared = (item.definition.events ?? {}) as Record<string, {scope: "path" | "session"; kind: "conv" | "ext"; version: number}>;
    const drafts: EventDraft[] = [];
    for (const emitted of outputs.emits) {
        if (emitted.key !== undefined && core.hasKey(id, emitted.key)) continue;
        const spec = declared[emitted.name]!;
        drafts.push({type: `${id}/${emitted.name}`, kind: spec.kind, scope: spec.scope, version: spec.version, data: emitted.data, source: id, cause: cause.id, depth, ...(emitted.key === undefined ? {} : {key: emitted.key})});
    }
    const current = stateOf(core.stateAt(), id);
    const slices = (item.definition.state ?? {}) as Record<string, {scope: "path" | "session"}>;
    for (const [slice, value] of outputs.sets) {
        if (JSON.stringify(current[slice]) === JSON.stringify(value)) continue;
        drafts.push({type: `${id}/${STATE_SET}`, kind: "ext", scope: slices[slice]!.scope, data: {slice, value: value as JsonValue}, source: id, cause: cause.id, depth});
    }
    return drafts;
}
