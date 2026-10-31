/**
 * 各处共用的基础数据。行为合同见 docs/specs/harness/session.md 与 harness/extensions.md。
 */

/** path 事件挂在会话树的当前路径上，回退之后不在路径上的就不算；session 事件在树外，回退不影响。 */
export type Scope = "path" | "session";

/** 能被 JSON 如实表示的值：日志里的每个字段都要是它。 */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | {readonly [key: string]: JsonValue};

/** 递归只读：状态、事件与视图交给扩展时都是这个形状。 */
export type DeepReadonly<T> = T extends (...args: any[]) => any
    ? T
    : T extends readonly (infer U)[]
      ? readonly DeepReadonly<U>[]
      : T extends object
        ? {readonly [k in keyof T]: DeepReadonly<T[k]>}
        : T;

export interface UserInput<P = unknown> {
    readonly text: string;
    readonly payload?: P;
    readonly attachments?: readonly {readonly kind: "image" | "file"; readonly uri: string}[];
}

/** 拒绝或失败的说明：只有码与参数，没有句子；界面按“拥有者 + 码”取本地化文案（ADR 0034）。 */
export interface Rejection {
    readonly code: string;
    readonly params?: Readonly<Record<string, string | number | boolean>>;
}
/** 内核补上拒绝者（拦截器所属的扩展 id）。 */
export interface Attributed extends Rejection {
    readonly by: string;
}

/**
 * 指令的发出者。由宿主按调用来源注入（`session.as(issuer)`），不是指令参数：界面拿不到改发出者的入口。
 * `session` 是派这个会话的父会话（多 Agent，t14）。
 */
export type Issuer = {readonly kind: "user"} | {readonly kind: "session"; readonly id: string};

/** 事件里记“谁做的”：发出者，或内核自己（恢复、中止的结算）。 */
export type Actor = Issuer | {readonly kind: "kernel"};

/** 注入的时钟：内核的计时器都经它，测试不用真等，也不用假计时器。 */
export interface Clock {
    now(): number;
    /** 等 `ms` 毫秒；`signal` 触发时立即 reject（原因是 signal.reason）。 */
    wait(ms: number, signal?: AbortSignal): Promise<void>;
}
