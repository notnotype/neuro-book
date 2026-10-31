/**
 * 契约与依赖：跨扩展引用用对象，不用全局登记。拥有者导出契约（放在不拖实现的模块里），使用者写进 `dependsOn`；
 * 能监听的事件名与 `read` 的类型都从 `dependsOn` 里的对象推出，没写进去的读不了、监听不了。
 */

import type {DeepReadonly, Scope} from "./basics.js";
import type {EventKindOf, EventsDecl, EventSpec, KernelEventName, KernelEvents, LogEvent, EventData, EventScope} from "./events.js";

declare const ExportsBrand: unique symbol;
/** 别人能监听的事件与能读的导出。 */
export interface Contract<Id extends string = string, E extends EventsDecl = EventsDecl, X = unknown> {
    readonly id: Id;
    readonly events: E;
    readonly [ExportsBrand]?: X;
}
export type ExportsShape<X> = {readonly [ExportsBrand]?: X};

declare const OptionalBrand: unique symbol;
/** 可能没装的依赖：`read` 返回 undefined，监听它的事件照常（没装就不会来）。 */
export interface Optional<C extends Contract> {
    readonly contract: C;
    readonly [OptionalBrand]: true;
}
export type Dependency = Contract<string, any, any> | Optional<Contract<string, any, any>>;
export type DepList = readonly Dependency[];

export type ContractOf<D> = D extends Optional<infer C> ? C : D;
export type ExportsOfContract<C> = C extends {readonly [ExportsBrand]?: infer X} ? DeepReadonly<X> : never;
export type ReadResult<D> = D extends Optional<infer C> ? ExportsOfContract<C> | undefined : ExportsOfContract<D>;

type Merge<U> = (U extends unknown ? (member: U) => void : never) extends (member: infer R) => void ? {[k in keyof R]: R[k]} : never;
/** 对联合逐个展开（`D extends unknown` 让它分配），否则几个依赖的事件名会交成空集。 */
type ForeignOne<D> = D extends unknown ? (ContractOf<D> extends Contract<infer Id, infer E, any> ? {[n in keyof E & string as `${Id}/${n}`]: E[n]} : never) : never;
export type Foreign<Deps extends DepList> = Deps extends readonly [] ? {} : Merge<ForeignOne<Deps[number]>>;

/** 自己的事件不许与内核事件重名。 */
export type NoKernelNames<E> = {[n in keyof E]: n extends KernelEventName ? "与内核事件同名，换一个名字" : E[n]};

/** 一个扩展能挂的事件：内核与自己的事件用短名，依赖的用全名“依赖 id/事件名”。 */
export type EventTable<E extends EventsDecl, Deps extends DepList> = KernelEvents & Foreign<Deps> & E;
export type EventName<E extends EventsDecl, Deps extends DepList> = keyof EventTable<E, Deps> & string;
export type SpecOf<E extends EventsDecl, Deps extends DepList, N> = N extends keyof EventTable<E, Deps> ? EventTable<E, Deps>[N] : never;
export type EventOf<E extends EventsDecl, Deps extends DepList, N> = LogEvent<string, DeepReadonly<EventData<SpecOf<E, Deps, N>>>>;
export type ScopeOf<E extends EventsDecl, Deps extends DepList, N> = EventScope<SpecOf<E, Deps, N>> & Scope;
export type ConvNames<E extends EventsDecl, Deps extends DepList> = {[n in EventName<E, Deps>]: EventKindOf<SpecOf<E, Deps, n>> extends "conv" ? n : never}[EventName<E, Deps>];
export type OwnConvNames<E extends EventsDecl> = {[n in keyof E & string]: EventKindOf<E[n]> extends "conv" ? n : never}[keyof E & string];
export type ConvNamesOfDependency<D> = ContractOf<D> extends Contract<string, infer E, any> ? OwnConvNames<E> : never;

/** 声明扩展事件的工厂：`conv<D>()`、`ext<D>()`、`ext.session<D>()`。 */
export interface ConvFactory {
    <D = {text: string}>(options?: {version?: number}): EventSpec<"path", "conv", D>;
}
export interface ExtFactory {
    <D = void>(options?: {version?: number}): EventSpec<"path", "ext", D>;
    session<D = void>(options?: {version?: number}): EventSpec<"session", "ext", D>;
}
