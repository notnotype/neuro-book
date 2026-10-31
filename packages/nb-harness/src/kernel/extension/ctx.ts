/**
 * 各档 `ctx` 的唯一构造点。读的是哪一刻的状态由调用方交进来的快照决定（extensions.md 输出 23）：
 * 视图与模型拦截读这次请求所在的叶子，处理函数读这条事件写入之后。这里只负责把快照拼成扩展看到的形状：
 * 自己的 path 片与 session 片合在一起、设置是缺省值加覆盖、`read` 只放依赖与 `core.history`。
 */

import {jsonProblem, type AssistantCtx, type ConversationTurn, type InterceptCtx, type JsonValue, type ModelInfo, type MountCtx, type ReactCtx, type Resources, type Scope, type ToolInfo, type ToolSessionContext, type ViewCtx} from "../api/index.js";
import {committedTurns, type HistoryState} from "../state/history.js";
import type {Snapshot} from "../state/snapshot.js";
import type {Assembled, Assembly, ExtensionDefinition} from "./assemble.js";
import {coreHistory} from "./define.js";

/** 某一刻的全部状态。 */
export interface StateAt {
    readonly path: Snapshot;
    readonly session: Snapshot;
    readonly history: HistoryState;
    readonly settings: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
    /** 当前这一轮各扩展写过几条 `continued`（按路径事实计数，压缩不影响）。 */
    readonly continued: Readonly<Record<string, number>>;
}

export interface ViewEnvironment {
    readonly tools: readonly ToolInfo[];
    readonly model: ModelInfo;
    readonly now: number;
    readonly initial: unknown;
}

/** 设置的缺省值写在 schema 的各项 `default` 里（装配时检查每项都有）。 */
export function defaultSettings(definition: ExtensionDefinition): Record<string, unknown> {
    const properties = (definition.settings as {properties?: Record<string, {default?: unknown}>} | undefined)?.properties ?? {};
    return Object.fromEntries(Object.entries(properties).map(([key, schema]) => [key, schema.default]));
}

export function stateOf(state: StateAt, id: string): Record<string, unknown> {
    return {...state.path[id], ...state.session[id]};
}

export function settingsOf(state: StateAt, definition: ExtensionDefinition): Record<string, unknown> {
    return {...defaultSettings(definition), ...state.settings[definition.id]};
}

function historyExports(history: HistoryState): {input: {text: string; payload?: JsonValue} | null; current: ConversationTurn | null; turns: number; runs: number; committed: readonly ConversationTurn[]} {
    const input = history.current?.input?.data;
    return {input: input === undefined ? null : {text: input.text, ...(input.payload === undefined ? {} : {payload: input.payload as JsonValue})}, current: history.current, turns: history.turns, runs: history.runs, committed: committedTurns(history)};
}

/** 读一个依赖的导出；没装的可选依赖为 undefined。 */
export function readerFor(assembly: Assembly, item: Assembled, state: StateAt): (dependency: unknown) => unknown {
    const allowed = new Set<string>([coreHistory.id, ...(item.definition.dependsOn ?? []).map((dependency: unknown) => ((dependency as {contract?: {id: string}}).contract ?? (dependency as {id: string})).id)]);
    return (dependency) => {
        const id = ((dependency as {contract?: {id: string}}).contract ?? (dependency as {id: string})).id;
        if (!allowed.has(id)) throw new Error(`${item.definition.id} reads ${id}, which is not in its dependsOn`);
        return exportsOf(assembly, state, id);
    };
}

/** 宿主一侧（工具实现、审批钩子）读扩展的导出：它们不是扩展，没有 dependsOn，装了哪个就能读哪个，没装时 undefined。 */
export function hostReader(assembly: Assembly, state: StateAt): (contract: {readonly id: string}) => unknown {
    return (contract) => exportsOf(assembly, state, contract.id);
}

function exportsOf(assembly: Assembly, state: StateAt, id: string): unknown {
    if (id === coreHistory.id) return historyExports(state.history);
    const target = assembly.order.find((candidate) => candidate.definition.id === id);
    if (target === undefined) return undefined;
    const exports = (target.definition.exports ?? {}) as Record<string, (state: unknown, settings: unknown) => unknown>;
    const values = stateOf(state, id);
    const settings = settingsOf(state, target.definition);
    return Object.fromEntries(Object.entries(exports).map(([name, fn]) => [name, fn(values, settings)]));
}

/** 视图的 ctx。类型上是公开的 `ViewCtx`（运行时按装配结果拼，泛型参数在这里不可知）。 */
export function viewCtx(assembly: Assembly, item: Assembled, state: StateAt, environment: ViewEnvironment): ViewCtx<any, any, any, any> {
    return {
        state: stateOf(state, item.definition.id),
        settings: settingsOf(state, item.definition),
        read: readerFor(assembly, item, state),
        tools: environment.tools,
        model: environment.model,
        now: environment.now,
        initial: environment.initial,
    } as ViewCtx<any, any, any, any>;
}

// ====================================================================
// 处理函数与装上：写事件、改片
// ====================================================================

/**
 * 一次处理函数调用的输出（extensions.md 输出 13）：`emit` 与 `set` 先收集，处理函数完成时作为一个写入批写入；
 * 抛错或超时就都不写；完成之后再调用是 `emit-after-settle`，不写；同一片 `set` 多次取最后一次。
 */
export class Outputs {
    readonly emits: {name: string; data: JsonValue; key?: string}[] = [];
    readonly sets = new Map<string, unknown>();
    settled = false;
    /** 写错了的输出（没声明的事件或片、不是 JSON 的值）：整批丢弃并记 `invalid-output`。 */
    invalid: string | null = null;
    /** `continue` 的请求（只有 `assistant` 的处理函数有）。 */
    continueText: string | null = null;
}

export interface ReactParams {
    readonly assembly: Assembly;
    readonly item: Assembled;
    readonly state: StateAt;
    readonly environment: ViewEnvironment;
    readonly resources: Resources;
    readonly session: ToolSessionContext;
    readonly signal: AbortSignal;
    readonly outputs: Outputs;
    /** 完成之后又调用了 `emit`、`set`。 */
    readonly late: (call: "emit" | "set") => void;
}

function eventSpecOf(item: Assembled, name: string): {scope: Scope; kind: "conv" | "ext"; version: number} | undefined {
    return (item.definition.events as Record<string, {scope: Scope; kind: "conv" | "ext"; version: number}> | undefined)?.[name];
}

/** `emit` 与 `set` 的公共部分：处理函数收进 `Outputs`，装上时直接交给 `write`。 */
function writers(item: Assembled, onEmit: (name: string, data: JsonValue, key: string | undefined) => void, onSet: (slice: string, value: unknown) => void, invalid: (problem: string) => void) {
    return {
        emit(name: string, data?: unknown, options?: {key?: string}) {
            if (eventSpecOf(item, name) === undefined) return invalid(`${item.definition.id} emitted ${name}, which it does not declare`);
            const value = (data === undefined ? null : data) as JsonValue;
            const problem = jsonProblem(value);
            if (problem !== null) return invalid(`${item.definition.id} emitted ${name} with a value that is not JSON: ${problem}`);
            onEmit(name, value, options?.key);
        },
        set(slice: string, value: unknown) {
            if ((item.definition.state as Record<string, unknown> | undefined)?.[slice] === undefined) return invalid(`${item.definition.id} set slice ${slice}, which it does not declare`);
            const problem = jsonProblem(value);
            if (problem !== null) return invalid(`${item.definition.id} set slice ${slice} to a value that is not JSON: ${problem}`);
            onSet(slice, value);
        },
    };
}

export function reactCtx(params: ReactParams): ReactCtx<any, any, any, any, any> {
    const {outputs} = params;
    const write = writers(
        params.item,
        (name, data, key) => {
            if (outputs.settled) return params.late("emit");
            outputs.emits.push({name, data, ...(key === undefined ? {} : {key})});
        },
        (slice, value) => {
            if (outputs.settled) return params.late("set");
            outputs.sets.set(slice, value);
        },
        (problem) => {
            if (outputs.settled) return;
            outputs.invalid ??= problem;
        },
    );
    return {
        ...viewCtx(params.assembly, params.item, params.state, params.environment),
        resources: params.resources,
        session: params.session,
        signal: params.signal,
        emit: write.emit,
        set: write.set,
    } as ReactCtx<any, any, any, any, any>;
}

export function assistantCtx(params: ReactParams & {readonly reply: {readonly toolCalls: readonly unknown[]}; readonly limited: (max: number) => void}): AssistantCtx<any, any, any, any, any> {
    const ctx = reactCtx(params);
    return {
        ...ctx,
        continue(text: string, options?: {max?: number}): boolean {
            if (params.outputs.settled || params.reply.toolCalls.length > 0) return false;
            const max = options?.max ?? 3;
            if ((params.state.continued[params.item.definition.id] ?? 0) >= max) {
                params.limited(max);
                return false;
            }
            params.outputs.continueText = text;
            return true;
        },
    } as AssistantCtx<any, any, any, any, any>;
}

export interface MountParams {
    readonly assembly: Assembly;
    readonly item: Assembled;
    readonly state: () => StateAt;
    readonly environment: Omit<ViewEnvironment, "now">;
    readonly resources: Resources;
    readonly session: ToolSessionContext;
    readonly signal: AbortSignal;
    /** 装上的写入不收集：每次调用就是一个外部事实，排进队列（运行中到下一个边界）。 */
    readonly external: (write: {emit?: {name: string; data: JsonValue; key?: string}; set?: {slice: string; value: unknown}}) => void;
    readonly invalid: (problem: string) => void;
    /** 外部回调出错或摘下之后被调用。 */
    readonly callbackFailed: (error: unknown) => void;
}

export function mountCtx(params: MountParams): MountCtx<any, any, any, any, any> {
    const write = writers(params.item, (name, data, key) => params.external({emit: {name, data, ...(key === undefined ? {} : {key})}}), (slice, value) => params.external({set: {slice, value}}), params.invalid);
    const view = () => viewCtx(params.assembly, params.item, params.state(), {...params.environment, now: 0});
    return {
        get state() {
            return view().state;
        },
        get settings() {
            return view().settings;
        },
        read: (dependency: unknown) => view().read(dependency as never),
        tools: params.environment.tools,
        model: params.environment.model,
        initial: params.environment.initial,
        resources: params.resources,
        session: params.session,
        signal: params.signal,
        emit: write.emit,
        set: write.set,
        callback<A extends unknown[]>(fn: (...args: A) => void | Promise<void>) {
            return (...args: A) => {
                if (params.signal.aborted) return;
                try {
                    const result = fn(...args);
                    if (result instanceof Promise) result.catch(params.callbackFailed);
                } catch (error) {
                    params.callbackFailed(error);
                }
            };
        },
    } as MountCtx<any, any, any, any, any>;
}

// ====================================================================
// 拦截
// ====================================================================

export interface InterceptParams {
    readonly assembly: Assembly;
    readonly item: Assembled;
    /** 输入拦截：受理这一刻的叶子；模型拦截：这次请求所在的叶子；工具拦截：发出这批调用的回复所在的叶子。 */
    readonly state: StateAt;
    readonly environment: ViewEnvironment;
    readonly resources: Resources;
    readonly signal: AbortSignal;
    readonly invocation: string;
    readonly phase: "run" | "preview";
}

export function interceptCtx(params: InterceptParams): InterceptCtx<any, any, any, any> {
    return {
        ...viewCtx(params.assembly, params.item, params.state, params.environment),
        resources: params.resources,
        signal: params.signal,
        phase: params.phase,
        invocation: params.invocation,
    } as InterceptCtx<any, any, any, any>;
}
