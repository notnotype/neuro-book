/**
 * 窗口读取层交给界面的东西（docs/specs/canon/author-ui.md 输出 26、35）：canon 自己的界面与经 `canonReadsKey` 读的别的浏览器入口
 * 共用这些形状。实现在 `web/world.ts` 与 `web/reads-service.ts`；这里只放类型，共用目录不引前端的实现（Vue 只引类型）。
 */

import type {ComputedRef, Ref} from "vue";

import type {CanonFailure, CanonInput, CanonMethod, CanonOutputs, CanonResult} from "./contracts";

export type WorldConnection = "connecting" | "online" | "ended" | "no-project";

export interface ReadState<T> {
    /** 最近一次读成功的结果；重读期间与重读失败后仍是它。 */
    readonly data: T | undefined;
    /** 最近一次读取的失败；读成功时清掉。 */
    readonly error: CanonFailure | null;
    /** 还没有读到过（第一次读取期间显示加载占位）。 */
    readonly loading: boolean;
    /**
     * 结果早于世界当前的版本：世界变了、重读还没读完（停放的视图回到前台、读取层里留着的结果也是这样）。还没读到过时为真。
     * 要按“现在的结果”做决定的调用方（待处理视图选第一条）等它变成假。
     */
    readonly stale: boolean;
}

/** 分页读取的状态：`data` 是最后读到的那一页（带游标），`items` 是到目前读过的各页接起来的项。 */
export interface PagedState<T, Item> extends ReadState<T> {
    readonly items: readonly Item[];
    /** 后面还有页。 */
    readonly more: boolean;
}

/** 写入方法：输入都带请求 id（`publish` 的在 `request` 里）。 */
export type WriteMethod = "publish" | "editInPlace" | "recordDelta" | "recordNote" | "revert";
/** 分页的读取方法：输入有 `cursor`、`limit`，结果有 `items` 与下一页的 `cursor`。 */
export type ListMethod = "tree" | "origins" | "changes" | "tellings" | "presence" | "pending" | "decisions" | "suggestions" | "revisions";
export type ReadMethod = Exclude<CanonMethod, WriteMethod | ListMethod>;
type ListItem<M extends ListMethod> = CanonOutputs[M]["items"][number];

/**
 * 外部读取（输出 35）：调用方自己的一次远程读取。结果里有 `version`（世界版本）时，读取层拿它与自己已知的版本比，旧了就在下一轮
 * 再读一次。失败按 `CanonResult` 交回（失败码在 `failure.code`）；取数抛错由读取层换成 `external-failed`。
 */
export type ExternalFetch<I, T> = (input: I) => Promise<CanonResult<T>>;

/** 外部列表的一页：`cursor` 没有就是最后一页；同一份读取输入的各页 `inputDigest` 相同。 */
export interface ExternalPage<Item> {
    readonly items: readonly Item[];
    readonly cursor?: string;
    readonly version?: number;
    readonly inputDigest?: string;
}
export type ExternalPageFetch<I, P extends ExternalPage<unknown>> = (input: I, cursor: string | undefined, limit: number) => Promise<CanonResult<P>>;

/** 一条可选的线（输出 34）。 */
export interface LineOption {
    readonly id: string;
    /** 线的名字；主线为 null（界面写“主线”）。 */
    readonly name: string | null;
    /** 在线的树里的深度：主线 0。 */
    readonly depth: number;
}

/**
 * 组合函数只在组件的 `setup` 或别的效果作用域里调：输入（一个返回输入的函数）变了换一个读取，旧的在新的读到（或读失败）之前
 * 接着显示；输入为 null 时不读；作用域结束时释放。窗口没有绑定项目时 `connection` 是 `no-project`，组合函数都给 null。
 */
export interface CanonReads {
    readonly connection: Readonly<Ref<WorldConnection>>;
    /** 订阅被提供方结束以后重新订阅；成功后内容按当前版本重读（输出 27）。 */
    retry(): Promise<void>;
    useRead<M extends ReadMethod>(method: M, input: () => CanonInput<M> | null): ComputedRef<ReadState<CanonOutputs[M]> | null>;
    useList<M extends ListMethod>(method: M, input: () => Omit<CanonInput<M>, "cursor" | "limit"> | null, pageSize?: number): {readonly state: ComputedRef<PagedState<CanonOutputs[M], ListItem<M>> | null>; more(): void};
    /** `method` 与输入一起决定合并的键（读取层另加调用方插件的 id）：同一个方法、同一份输入，取数必须给出同样的东西。 */
    useExternal<I, T>(method: string, input: () => I | null, fetch: ExternalFetch<I, T>): ComputedRef<ReadState<T> | null>;
    /** 外部的分页读取：一页至多 200 条；世界变了以后按已读的条数从头翻回来，各页齐了才换上。 */
    useExternalList<I, P extends ExternalPage<unknown>>(method: string, input: () => I | null, fetch: ExternalPageFetch<I, P>, pageSize?: number): {readonly state: ComputedRef<PagedState<P, P["items"][number]> | null>; more(): void};
    /** 窗口在看的线（输出 34）：线的 id，空串是跟着章。读取位置在它非空时带上它。 */
    readonly line: Readonly<Ref<string>>;
    setLine(line: string): void;
    /** 可选的线：主线在最前，其余按线的树先序。 */
    readonly lineOptions: ComputedRef<readonly LineOption[]>;
}
