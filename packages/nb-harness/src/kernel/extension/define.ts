/**
 * 定义扩展、契约与事件的构造函数。它们只把声明原样包成对象并打上标记，不做校验：
 * id 规则、依赖、设置缺省值、事件名等检查都在装配时做（`assemble.ts`），这样 JavaScript 作者与第三方插件也查得到。
 */

import type {
    Contract, ConvFactory, CoreHistory, DefineExtension, EventsDecl, EventSpec, ExportsShape, ExtFactory, Implement, Optional, Scope, Slice, SliceFactory,
} from "../api/index.js";

/** 运行时看到的扩展对象：声明本身加一个标记。 */
export const EXTENSION = Symbol.for("nb-harness.kernel.extension");

function eventSpec<S extends Scope, K extends "conv" | "ext">(scope: S, kind: K, options?: {version?: number}): EventSpec<S, K, any> {
    return {scope, kind, version: options?.version ?? 1};
}

export const conv: ConvFactory = (options) => eventSpec("path", "conv", options);
export const ext: ExtFactory = Object.assign((options?: {version?: number}) => eventSpec("path", "ext", options), {
    session: (options?: {version?: number}) => eventSpec("session", "ext", options),
});

export const slice: SliceFactory = {
    path: <T>(initial: T, options?: {resetOnCompaction?: boolean}): Slice<"path", T> => ({scope: "path", initial, resetOnCompaction: options?.resetOnCompaction ?? false}),
    session: <T>(initial: T): Slice<"session", T> => ({scope: "session", initial, resetOnCompaction: false}),
};

/** 导出的形状只写类型：`shape<{pendingChanges: string[]}>()`。 */
export function shape<X>(): ExportsShape<X> {
    return {};
}

export function defineContract<const Id extends string, E extends EventsDecl = {}, X = {}>(id: Id, declaration: {events?: E; exports?: ExportsShape<X>}): Contract<Id, E, X> {
    return {id, events: declaration.events ?? ({} as E)};
}

export function optional<C extends Contract<string, any, any>>(contract: C): Optional<C> {
    return {contract} as Optional<C>;
}

export const defineExtension: DefineExtension = (spec) => ({...spec, events: spec.events ?? {}, [EXTENSION]: true}) as never;

export const implement: Implement = (contract, spec) => ({...spec, id: contract.id, events: contract.events, [EXTENSION]: true}) as never;

/** 内置的对话记录的契约：不写进 `dependsOn` 也能 `read`。 */
export const coreHistory: CoreHistory = defineContract("core.history", {});
