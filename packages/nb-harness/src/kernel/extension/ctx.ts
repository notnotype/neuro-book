/**
 * 各档 `ctx` 的唯一构造点。读的是哪一刻的状态由调用方交进来的快照决定（extensions.md 输出 23）：
 * 视图与模型拦截读这次请求所在的叶子，处理函数读这条事件写入之后。这里只负责把快照拼成扩展看到的形状：
 * 自己的 path 片与 session 片合在一起、设置是缺省值加覆盖、`read` 只放依赖与 `core.history`。
 */

import type {ConversationTurn, JsonValue, ModelInfo, ToolInfo, ViewCtx} from "../api/index.js";
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
        if (id === coreHistory.id) return historyExports(state.history);
        const target = assembly.order.find((candidate) => candidate.definition.id === id);
        if (target === undefined) return undefined;
        const exports = (target.definition.exports ?? {}) as Record<string, (state: unknown, settings: unknown) => unknown>;
        const values = stateOf(state, id);
        const settings = settingsOf(state, target.definition);
        return Object.fromEntries(Object.entries(exports).map(([name, fn]) => [name, fn(values, settings)]));
    };
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
