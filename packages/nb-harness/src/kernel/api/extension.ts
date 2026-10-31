/**
 * 扩展：只做四件事（归约、反应、视图、拦截），加上装上外部事实的 `mount`。字段语义见 docs/specs/harness/extensions.md。
 */

import type {DeepReadonly, JsonValue, Rejection, UserInput} from "./basics.js";
import type {Contract, DepList, EventName, EventOf, ExportsOfContract, NoKernelNames, OwnConvNames, ScopeOf} from "./contract.js";
import type {AssistantCtx, InterceptCtx, MountCtx, ReactCtx, ViewCtx} from "./ctx.js";
import type {EventsDecl} from "./events.js";
import type {ModelCaller, ModelRequest, ModelResponse} from "./model.js";
import type {PatchIn, SlicesIn, StateDecl, StateValues} from "./state.js";
import type {ToolCall, ToolResult} from "./tool.js";
import type {Static, TObject, TSchema} from "typebox";

// ====================================================================
// 压缩（方法在 t11；内核按 Profile 的顺序依次调用，失败或不合格换下一个）
// ====================================================================

/** 一个合法的切点（docs/specs/harness/runtime.md 输出 47）：一轮的 `turnStarted`，或进行中这一轮某一步的 `assistant`。 */
export interface CompactionCut {
    readonly entryId: string;
    readonly kind: "turn" | "step";
    /** 从这里切、保留它及其后的内容时，估算保留的 token。 */
    readonly tokensKept: number;
}

export interface CompactionJob {
    readonly method: string;
    /** 为什么压缩：超过阈值、服务商报溢出、手动 `compact`。 */
    readonly reason: "threshold" | "overflow" | "manual";
    /** 压缩前的请求（`purpose: "compaction"`）。 */
    readonly request: ModelRequest;
    /** 当前路径上的合法切点，按路径顺序；结果的 `firstKeptEntryId` 必须是其中之一（或 null：什么都不保留）。 */
    readonly cuts: readonly CompactionCut[];
    /** 压缩前估算的 token。 */
    readonly tokens: number;
    /** 要求：Profile 的、`/compact` 后面的、扩展加的（t11 决定 7）。 */
    readonly require: readonly string[];
    readonly signal: AbortSignal;
    readonly model: ModelCaller;
}
/** 方法交回的结果；放回的内容由内核的公共流程写，不归方法。`{failed}` 表示这个方法失败，换下一个。 */
export type CompactionResult =
    | {
          readonly method: string;
          readonly firstKeptEntryId: string | null;
          readonly replacement: string | null;
          readonly omitted: readonly {readonly entryId: string; readonly placeholder: string}[];
          readonly tokensBefore: number;
          readonly tokensAfter: number;
          readonly details?: JsonValue;
      }
    | {readonly failed: string};
export type CompactionMethod = "shake" | "inplace" | "summary" | (string & {});
/** 压缩方法的实现：插件贡献（t11 决定 8），宿主经 `SessionEnv.compaction.methods` 交给内核。 */
export type CompactionMethodImpl = (job: CompactionJob) => Promise<CompactionResult>;

// ====================================================================
// 字段
// ====================================================================

export type SettingsSchema = TObject;
export type SettingsOf<Sc> = Sc extends TSchema ? Static<Sc> : {};
export type StaticOr<T> = T extends TSchema ? Static<T> : unknown;

export type ReduceTable<S extends StateDecl, E extends EventsDecl, Deps extends DepList> = {
    [N in EventName<E, Deps>]?: (event: EventOf<E, Deps, N>, state: SlicesIn<S, ScopeOf<E, Deps, N>>) => PatchIn<S, ScopeOf<E, Deps, N>> | undefined | void;
};
export type OnTable<S extends StateDecl, E extends EventsDecl, St, Deps extends DepList, I> = {
    [N in EventName<E, Deps>]?: (event: EventOf<E, Deps, N>, ctx: N extends "assistant" ? AssistantCtx<S, E, St, Deps, I> : ReactCtx<S, E, St, Deps, I>) => void | Promise<void>;
};
/** 输入拦截在指令受理（入队、改）时跑；`redacted` 时日志里的原文只记哈希。 */
export type Interceptors<S extends StateDecl, St, Deps extends DepList, I> = {
    /** 拒绝返回 `{reject}`；改写过、原文要脱敏时调用 `next(改写后的)` 再返回 `{redacted: true}`。 */
    input?(input: UserInput, next: (input: UserInput) => Promise<void>, ctx: InterceptCtx<S, St, Deps, I>): Promise<void | {reject: Rejection} | {redacted: true}>;
    model?(request: ModelRequest, next: (request: ModelRequest) => Promise<ModelResponse>, ctx: InterceptCtx<S, St, Deps, I>): Promise<ModelResponse>;
    tool?(call: ToolCall, next: (call: ToolCall) => Promise<ToolResult>, ctx: InterceptCtx<S, St, Deps, I>): Promise<ToolResult>;
    compaction?(job: CompactionJob, next: (job: CompactionJob) => Promise<CompactionResult>, ctx: InterceptCtx<S, St, Deps, I>): Promise<CompactionResult>;
};
export type Contributions<View> = {
    [slot: string]: {volatile?: boolean; shared?: boolean; value: (view: View) => string | null | undefined};
};
export type MountFn<Ctx> = (ctx: Ctx) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;

export interface ExtensionFields<Id extends string, S extends StateDecl, E extends EventsDecl, Sc, X, Deps extends DepList> {
    id: Id;
    /** 改了逻辑或提示词时升它：进 Profile 哈希，打开旧会话时写 `profileChanged{code-updated}`。缺省 `"0"`。 */
    version?: string;
    tags?: string[];
    /** 依赖：契约或扩展对象；决定装配顺序、能监听哪些别人的事件、能 `read` 谁。 */
    dependsOn?: Deps;
    /** 设置：TypeBox schema，缺省值写在 schema 里（每项都要有 `default`，装配时检查）。 */
    settings?: Sc;
    state?: S;
    events?: E & NoKernelNames<E>;
    reduce?: ReduceTable<NoInfer<S>, NoInfer<E>, NoInfer<Deps>>;
    on?: OnTable<NoInfer<S>, NoInfer<E>, SettingsOf<NoInfer<Sc>>, NoInfer<Deps>, unknown>;
    mount?: MountFn<MountCtx<NoInfer<S>, NoInfer<E>, SettingsOf<NoInfer<Sc>>, NoInfer<Deps>>>;
    exports?: X & {[name: string]: (state: StateValues<NoInfer<S>>, settings: DeepReadonly<SettingsOf<NoInfer<Sc>>>) => unknown};
    contribute?: Contributions<ViewCtx<NoInfer<S>, SettingsOf<NoInfer<Sc>>, NoInfer<Deps>>>;
    /** 自己的 conv 事件给模型看的文字。没写的缺省：`{text}` 取 `text`，其余包成 `<system-reminder>`。 */
    render?: {[N in OwnConvNames<NoInfer<E>>]?: (event: EventOf<NoInfer<E>, [], N>) => string | null};
    intercept?: Interceptors<NoInfer<S>, SettingsOf<NoInfer<Sc>>, NoInfer<Deps>, unknown>;
    onFailure?: {tool?: "deny" | "ignore"};
    timeoutMs?: number;
}

declare const ExtensionBrand: unique symbol;
declare const StateBrand: unique symbol;
export interface Extension<Id extends string = string, E extends EventsDecl = any, X = any, S extends StateDecl = any> extends Contract<Id, E, X> {
    readonly [ExtensionBrand]: true;
    /** 只用于类型：测试工具按它给出 `state(extension)` 的类型。 */
    readonly [StateBrand]?: StateValues<S>;
}
export type StateOfExtension<X> = X extends {readonly [StateBrand]?: infer V} ? NonNullable<V> : never;
export type AnyExtension = Extension<string, any, any>;

type ExportsTable<X, S extends StateDecl, Sc> = {[k in keyof X]: (state: StateValues<S>, settings: DeepReadonly<SettingsOf<Sc>>) => X[k]};
type ExportsReturn<Ex> = {[k in keyof Ex as string extends k ? never : k]: Ex[k] extends (...args: any[]) => infer R ? R : never};
/** 契约没有导出时不必写 `exports: {}`。 */
type ExportsField<C, S extends StateDecl, Sc> = [keyof ExportsOfContract<C>] extends [never]
    ? {exports?: ExportsTable<ExportsOfContract<C>, S, Sc>}
    : {exports: ExportsTable<ExportsOfContract<C>, S, Sc>};

/** 私有扩展：自己写 id 与 events。返回的对象本身也能当契约写进别人的 `dependsOn`。 */
export type DefineExtension = <const Id extends string, S extends StateDecl = {}, E extends EventsDecl = {}, Sc extends SettingsSchema | undefined = undefined, Ex = {}, const Deps extends DepList = []>(
    spec: ExtensionFields<Id, S, E, Sc, Ex, Deps>,
) => Extension<Id, E, ExportsReturn<Ex>, S>;

/** 有契约的扩展：id 与事件从契约来，`exports` 要与契约里的形状一致。 */
export type Implement = <C extends Contract<string, any, any>, S extends StateDecl = {}, Sc extends SettingsSchema | undefined = undefined, const Deps extends DepList = []>(
    contract: C,
    spec: Omit<ExtensionFields<C["id"], S, C["events"], Sc, {}, Deps>, "id" | "events" | "exports"> & ExportsField<C, NoInfer<S>, NoInfer<Sc>>,
) => Extension<C["id"], C["events"], ExportsOfContract<C>, S>;

/** 由宿主交给内核的扩展：所属插件随它传入，内核按它校验 id 前缀（`null` 只给内核与测试）。 */
export interface ContributedExtension {
    readonly extension: AnyExtension;
    readonly plugin: string | null;
}
