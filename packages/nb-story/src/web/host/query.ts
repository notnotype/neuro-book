/**
 * 页面取数的两个 composable。参数里带着阅读位置与视角，参数一变就重新取：上一次还在途的请求被中止，它的结果
 * 一律丢弃，不会显示到新位置的页面上（docs/specs/story/viewer.md“状态与转换”第 3 条）。
 */

import {onScopeDispose, ref, shallowRef, watch, type Ref, type ShallowRef} from "vue";

import type {PositionInput, StoryMethod, StoryParams, StoryResult} from "../../contract/contract";
import {useBook} from "./book";
import {StoryCallError, useStoryClient} from "./client";

type Params<M extends StoryMethod> = Omit<StoryParams<M>, "book">;

export interface QueryState<M extends StoryMethod> {
    data: ShallowRef<StoryResult<M> | null>;
    error: Ref<StoryCallError | null>;
    loading: Ref<boolean>;
    reload(): void;
}

export interface QueryOptions {
    /**
     * 阅读位置往后挪、其它参数没变时，新结果回来之前留着旧结果（关系图借它连续地“长出来”，issue 268）。往前挪或参数变了
     * 照旧先清：旧位置之后的内容不能留在更早的位置上，那是剧透。
     */
    keepOnForward?: boolean;
}

/** 一章里不写段的位置是读完这一章（resolvePosition），排在这一章所有段之后。 */
const positionRank = (at: PositionInput): number => at.chapter * 1_000_000 + (at.paragraph ?? 999_999);

/**
 * 取一个方法的结果。`params` 返回 null 时不取（例如还没选中对象）。`book` 由当前书补上；`at` 默认补当前阅读位置，
 * 参数里写了 `at` 时用参数的。
 */
export function useStoryQuery<M extends StoryMethod>(method: M, params: () => NoInfer<Params<M>> | null, options: QueryOptions = {}): QueryState<M> {
    const client = useStoryClient();
    const book = useBook();
    const data = shallowRef(null) as ShallowRef<StoryResult<M> | null>;
    const error = ref<StoryCallError | null>(null);
    const loading = ref(false);
    let controller: AbortController | null = null;
    /** `data` 里的结果是按哪个阅读位置取的；`data` 为空时为 null。 */
    let shownAt: PositionInput | null = null;

    /** `keep`：旧结果留着直到新的回来（书换了新数据而位置与参数没变，或 `keepOnForward` 且位置往后挪）。 */
    async function run(next: Params<M> | null, keep = false): Promise<void> {
        controller?.abort();
        if (next === null) {
            data.value = null;
            shownAt = null;
            loading.value = false;
            return;
        }
        const current = new AbortController();
        controller = current;
        loading.value = true;
        error.value = null;
        // 参数（阅读位置、视角、筛选）一变先清掉旧结果：新数据回来之前显示“正在取”，不让旧位置的内容留在新位置的页面上。
        // 只是版本变了时位置没变、可见范围也没变，留着旧的，免得正在读的页面先空一下、滚回顶部（viewer 输出 39）。
        if (!keep) {
            data.value = null;
            shownAt = null;
        }
        const request = {at: book.at.value, ...next, book: book.bookId} as StoryParams<M>;
        try {
            const result = await client.call(method, request, {signal: current.signal});
            if (current.signal.aborted) return;
            data.value = result as StoryResult<M>;
            shownAt = (request as {at: PositionInput}).at;
        } catch (caught) {
            if (current.signal.aborted) return;
            if (!(caught instanceof StoryCallError)) {
                console.error({method, error: caught}, "查询出错");
                error.value = new StoryCallError("internal", "请求没有完成");
            } else {
                error.value = caught;
            }
            data.value = null;
            shownAt = null;
        } finally {
            if (controller === current) loading.value = false;
        }
    }

    /** 这次变化要不要留着旧结果。 */
    function keepsOld(value: {params: Params<M> | null; at: PositionInput; version: number}, old: {params: Params<M> | null; at: PositionInput; version: number} | undefined): boolean {
        if (old === undefined) return false;
        const sameParams = JSON.stringify(value.params) === JSON.stringify(old.params);
        // 只是版本变了（位置与参数都没变）：位置没变、可见范围也没变。
        if (sameParams && JSON.stringify(value.at) === JSON.stringify(old.at)) return value.version !== old.version;
        return options.keepOnForward === true && sameParams && data.value !== null && shownAt !== null && positionRank(value.at) >= positionRank(shownAt);
    }

    // 数据版本也是参数：书换成新数据（抽取又提交了一章、用户点了更新）时重取。
    const stop = watch(
        () => ({params: params(), at: book.at.value, version: book.dataVersion.value}),
        (value, old) => void run(value.params, keepsOld(value, old)),
        {immediate: true, deep: true},
    );
    onScopeDispose(() => {
        stop();
        controller?.abort();
    });
    return {data, error, loading, reload: () => void run(params())};
}

export interface PagedState<T, E = object> {
    items: ShallowRef<T[]>;
    /** 页上除了条目、总数与游标之外的字段（例如说法列表的各级条数 `tiers`）；取最近一页的，还没取到为 null。 */
    extra: ShallowRef<E | null>;
    total: Ref<number | null>;
    error: Ref<StoryCallError | null>;
    loading: Ref<boolean>;
    hasMore: Ref<boolean>;
    /** 再取一页；已在取或没有更多时什么也不做。 */
    more(): void;
    /** 出错后重试：已经取到的保留，从出错的那一页接着取；第一页就出错时从头取。 */
    reload(): void;
}

type PagedMethod = "entities.list" | "entity.knowledge" | "entity.statements" | "entity.episodes" | "questions.list" | "episodes.list" | "search" | "revisions.list" | "revisions.evidence";
type PageItem<M extends PagedMethod> = StoryResult<M>["items"][number];
type PageExtra<M extends PagedMethod> = Omit<StoryResult<M>, "items" | "total" | "next">;

/** 分页的列表：参数一变从第一页重来；滚到底由调用方调 more() 取下一页。 */
export function usePagedQuery<M extends PagedMethod>(method: M, params: () => NoInfer<Params<M>> | null, pageSize = 100): PagedState<PageItem<M>, PageExtra<M>> {
    const client = useStoryClient();
    const book = useBook();
    const items = shallowRef<PageItem<M>[]>([]);
    const extra = shallowRef<PageExtra<M> | null>(null);
    const total = ref<number | null>(null);
    const error = ref<StoryCallError | null>(null);
    const loading = ref(false);
    const hasMore = ref(false);
    let cursor: string | null = null;
    let current: Params<M> | null = null;
    let controller: AbortController | null = null;

    /** `limit`：只是版本变了时，一次取回与已显示的一样多的条目（至多 500），列表长度不缩、滚动位置不跳。 */
    async function fetchPage(reset: boolean, limit = pageSize): Promise<void> {
        if (current === null) return;
        const signalOwner = new AbortController();
        if (reset) controller?.abort();
        controller = signalOwner;
        loading.value = true;
        try {
            const result = await client.call(method, {at: book.at.value, ...current, book: book.bookId, limit, ...(reset || cursor === null ? {} : {cursor})} as StoryParams<M>, {signal: signalOwner.signal});
            if (signalOwner.signal.aborted) return;
            const page = result as unknown as {items: PageItem<M>[]; total: number; next: string | null};
            items.value = reset ? page.items : [...items.value, ...page.items];
            const {items: _items, total: _total, next: _next, ...rest} = result as unknown as {items: unknown; total: unknown; next: unknown} & PageExtra<M>;
            extra.value = rest as PageExtra<M>;
            total.value = page.total;
            cursor = page.next;
            hasMore.value = page.next !== null;
            error.value = null;
        } catch (caught) {
            if (signalOwner.signal.aborted) return;
            // 书换了新数据、游标作废（抽取又提交了一章）：换成新数据，列表从第一页重来（book.refresh 让版本变）。
            if (caught instanceof StoryCallError && caught.code === "cursor_invalid") {
                void book.refresh();
                return;
            }
            error.value = caught instanceof StoryCallError ? caught : new StoryCallError("internal", "请求没有完成");
            if (!(caught instanceof StoryCallError)) console.error({method, error: caught}, "查询出错");
        } finally {
            if (controller === signalOwner) loading.value = false;
        }
    }

    const stop = watch(
        () => ({params: params(), at: book.at.value, version: book.dataVersion.value}),
        (value, old) => {
            current = value.params;
            cursor = null;
            // 只是版本变了：旧列表留着，按已显示的条数重取第一页，回来后整体替换（见 useStoryQuery）。
            const keep = old !== undefined && value.version !== old.version && JSON.stringify([value.params, value.at]) === JSON.stringify([old.params, old.at]);
            if (current === null) {
                controller?.abort();
                items.value = [];
                extra.value = null;
                total.value = null;
                hasMore.value = false;
                return;
            }
            if (keep) {
                void fetchPage(true, Math.min(500, Math.max(pageSize, items.value.length)));
                return;
            }
            items.value = [];
            extra.value = null;
            total.value = null;
            hasMore.value = false;
            void fetchPage(true);
        },
        {immediate: true, deep: true},
    );
    onScopeDispose(() => {
        stop();
        controller?.abort();
    });
    return {
        items,
        extra,
        total,
        error,
        loading,
        hasMore,
        more() {
            if (loading.value || !hasMore.value) return;
            // 落后了：游标属于旧数据，先换成新数据（列表随版本从第一页重来），不接着翻旧的。
            if (book.behind.value) void book.refresh();
            else void fetchPage(false);
        },
        reload() {
            if (!loading.value) void fetchPage(items.value.length === 0);
        },
    };
}
