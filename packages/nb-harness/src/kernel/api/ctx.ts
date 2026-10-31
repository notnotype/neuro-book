/**
 * 各入口的上下文：越往后能力越多，越界是编译错误。各入口读的是哪一刻的状态见 docs/specs/harness/extensions.md。
 */

import type {DeepReadonly} from "./basics.js";
import type {DepList, ReadResult} from "./contract.js";
import type {CoreHistory} from "./conversation.js";
import type {EventData, EventsDecl} from "./events.js";
import type {ModelInfo} from "./model.js";
import type {SliceValue, StateDecl, StateValues} from "./state.js";
import type {ToolInfo} from "./tool.js";
import type {ToolSessionContext} from "./host.js";

export interface Resources {
    read(uri: string): Promise<string | undefined>;
    /** 规范化（去掉 `..`、解析别名）：拦截里判断路径前先规范化。 */
    resolve(uri: string): string;
}

/** 视图（`contribute`、`prompt`、`system`、`turn`）：全部只读，没有副作用的口子。 */
export interface ViewCtx<S extends StateDecl, St, Deps extends DepList, I = unknown> {
    readonly state: StateValues<S>;
    readonly settings: DeepReadonly<St>;
    /** 只能读 `dependsOn` 里写了的（与内置的 `core.history`）；可能没装的返回 undefined。 */
    read<D extends Deps[number] | CoreHistory>(dependency: D): ReadResult<D>;
    readonly tools: readonly ToolInfo[];
    readonly model: ModelInfo;
    readonly now: number;
    /** 调用方给的初始输入（Profile 声明了 `initial` 时有类型）。 */
    readonly initial: DeepReadonly<I>;
}

/** 没有数据的事件写 `emit(名字)`；要幂等键时写 `emit(名字, undefined, {key})`。 */
type EmitArgs<D> = [D] extends [void] ? [data?: undefined, options?: {key?: string}] : [data: D, options?: {key?: string}];

/** 写事件与改片：先收集，处理函数完成时作为一个写入批写入。 */
export interface Writes<S extends StateDecl, E extends EventsDecl> {
    emit<N extends keyof E & string>(name: N, ...args: EmitArgs<EventData<E[N]>>): void;
    set<k extends keyof S & string>(slice: k, value: SliceValue<S[k]>): void;
}

/**
 * 处理函数（`on`）：视图那些，加写事件、改片、读资源、中止信号。抛错或超时就都不写（写 `extensionFailed`）；
 * 完成之后再调用是 `emit-after-settle` 错误，不写；同一片 `set` 多次取最后一次。
 * `ctx.state` 始终是这条事件之后的值，不含自己这次 `set` 的。
 */
export interface ReactCtx<S extends StateDecl, E extends EventsDecl, St, Deps extends DepList, I = unknown> extends ViewCtx<S, St, Deps, I>, Writes<S, E> {
    readonly resources: Resources;
    readonly signal: AbortSignal;
    /** 这次装在哪个会话上（与交给宿主建资源、建工具的同一份）：扩展对象被所有会话共用，按会话取外部数据用它。 */
    readonly session: ToolSessionContext;
}

/** 对 `assistant` 的处理函数多一个 `continue`：只在最终回复（没有工具调用）时有效。 */
export interface AssistantCtx<S extends StateDecl, E extends EventsDecl, St, Deps extends DepList, I = unknown> extends ReactCtx<S, E, St, Deps, I> {
    /** 写一条 `continued` 事件并再请求一次；这一轮这个扩展超过 `max`（缺省 3）次返回 false，不写。 */
    continue(text: string, options?: {max?: number}): boolean;
}

/** 装上（`mount`）：会话打开、换 Profile 后新装上时调用；外部事实从这里进来，运行中到下一个边界写入。 */
export interface MountCtx<S extends StateDecl, E extends EventsDecl, St, Deps extends DepList, I = unknown> extends Omit<ViewCtx<S, St, Deps, I>, "now">, Writes<S, E> {
    readonly resources: Resources;
    /** 摘下时触发。 */
    readonly signal: AbortSignal;
    /** 装在哪个会话上（与交给宿主建资源、建工具的同一份）：按会话或项目订阅外部来源用它。 */
    readonly session: ToolSessionContext;
    /** 包住外部回调：出错带扩展 id 写诊断，不成为没人接的 Promise 拒绝；摘下之后不再调用。 */
    callback<A extends unknown[]>(fn: (...args: A) => void | Promise<void>): (...args: A) => void;
}

/** 拦截：视图那些，加读资源、中止信号；不写事件。`phase` 是 `preview` 时不要做有副作用的 I/O。 */
export interface InterceptCtx<S extends StateDecl, St, Deps extends DepList, I = unknown> extends ViewCtx<S, St, Deps, I> {
    readonly resources: Resources;
    readonly signal: AbortSignal;
    readonly phase: "run" | "preview";
    /** 这一层这次调用的 id，记进 `modelStarted`、`toolStarted`。 */
    readonly invocation: string;
}
