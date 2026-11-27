/**
 * 管理面板列表页共用的取数（t10 计划 3.13；nb-ui `DataTable.md` 的“使用方的取数约定”，A 段审查第 13 条说由站点自己收口）：
 *
 * - 状态从地址来（`useListRoute`），换了页码、筛选或搜索就取一次；翻页的基准记在内存里，同一份列表沿用（`list-query.ts`）。
 * - 每次取数领一个序号，回来时不是最新的就丢掉：先发后到的旧结果不会盖掉新的。
 * - 页码超过最后一页时（`site.admin` 输出 10）改到最后一页（`replace`，后退不回到那一页空的），由地址的变化再取一次。
 * - 失败给数据表格一句原因（它画在表格区里，带重试）；统一处理接管了的（会话没了、角色刚被改）不显示，人会被带走。
 *
 * 搜索的停顿（`useSearchPause`）也在这里：输入停 300 毫秒才把搜索词写进地址。时间取注入的时钟，组件测试手动推进。
 * 都在 `setup` 里调用。
 */

import {PAGE} from "@notnotype/nb-site-identity-contract/constants";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, onBeforeUnmount, shallowRef, watch} from "vue";
import type {ComputedRef, ShallowRef} from "vue";
import {useRoute, useRouter} from "vue-router";

import type {Result} from "../../http/core";
import {failureText} from "../../http/failure-text";
import type {SiteClock} from "../../host/clock";
import {anchorFor, lastPageIfPastEnd, listKey, listQueryOf, readListState, rememberAnchor} from "./list-query";
import type {AnchorMemory, ListSchema, ListState} from "./list-query";

/** 每页条数（t09 第 12 条）。 */
export const ADMIN_PAGE_SIZE = PAGE.defaultPageSize;

/** 搜索输入停多久才取（计划 3.13）。 */
export const SEARCH_PAUSE_MS = 300;

export interface ListRoute<Field extends string> {
    /** 这一页的查询状态；路由已经不在这一页时（正在离开）是 `undefined`，取数随之停下。 */
    readonly state: ComputedRef<ListState<Field> | undefined>;
    /**
     * 换到另一个状态：翻页与换筛选用 `push`（后退回到上一个），搜索与页码越界用 `replace`（打字的每次停顿、
     * 越界的那一页不留在历史里）。
     */
    go(next: ListState<Field>, mode: "push" | "replace"): void;
}

export function useListRoute<Field extends string>(schema: ListSchema<Field>, routeName: string): ListRoute<Field> {
    const route = useRoute();
    const router = useRouter();
    // 离开这一页时路由先换、页面后卸载：中间这一下读到的是别的页的查询参数，不能当作这一页的状态去取。
    const state = computed(() => (route.name === routeName ? readListState(schema, route.query) : undefined));
    return {
        state,
        go(next, mode) {
            void router[mode]({name: routeName, query: listQueryOf(schema, next)});
        },
    };
}

/** 分页列表的回答里取数要用的那几项（`site.admin` 分页参数表之后一段）。 */
export interface ListResponse<Item, Counts> {
    readonly items: Item[];
    readonly total: number;
    readonly anchor: string;
    readonly counts?: Counts;
}

export interface AdminListOptions<Field extends string, Item, Counts> {
    readonly schema: ListSchema<Field>;
    /** 要取的状态；`undefined` 时不取，留着已有的行（离开这一页，或这份列表不是当前的页签）。 */
    readonly state: () => ListState<Field> | undefined;
    readonly fetch: (state: ListState<Field>, anchor: string | undefined) => Promise<Result<ListResponse<Item, Counts>>>;
    /** 页码超过了最后一页：改到 `page`。调用方改地址，状态变了以后这里再取一次。 */
    readonly onPastEnd: (page: number) => void;
}

export interface AdminList<Item, Counts> {
    readonly rows: Readonly<ShallowRef<Item[]>>;
    /** 符合当前筛选与搜索的总条数；第一次取回来之前是 `null`。 */
    readonly total: Readonly<ShallowRef<number | null>>;
    /** 各筛选项的条数（带筛选项的列表）；第一次取回来之前是 `undefined`。 */
    readonly counts: Readonly<ShallowRef<Counts | undefined>>;
    readonly loading: Readonly<ShallowRef<boolean>>;
    /** 给数据表格的出错原因；没出错时是 `undefined`。 */
    readonly error: Readonly<ShallowRef<string | undefined>>;
    /**
     * 照当前状态再取一次：出错后的重试，或一次处置之后（行的状态、筛选项的条数都可能变了）。缺省沿用基准；
     * `fresh` 丢掉基准、以当时为基准重来：新加了一条（发放注册码）时要这样，带着旧基准的列表里没有基准之后建的条目。
     */
    reload(options?: {readonly fresh?: boolean}): Promise<void>;
}

export function useAdminList<Field extends string, Item, Counts = never>(options: AdminListOptions<Field, Item, Counts>): AdminList<Item, Counts> {
    const port = useText();
    const rows = shallowRef<Item[]>([]);
    const total = shallowRef<number | null>(null);
    const counts = shallowRef<Counts>();
    const loading = shallowRef(false);
    const error = shallowRef<string>();

    let sequence = 0;
    let memory: AnchorMemory | undefined;
    let lastState: ListState<Field> | undefined;

    async function load(state: ListState<Field>): Promise<void> {
        const mine = ++sequence;
        lastState = state;
        loading.value = true;
        error.value = undefined;
        const key = listKey(options.schema, state);
        const result = await options.fetch(state, anchorFor(memory, key));
        if (mine !== sequence) return;
        if (!result.ok) {
            loading.value = false;
            if (result.failure.kind === "code" && result.failure.handled === true) return;
            error.value = port.t(failureText("identity", result.failure));
            return;
        }
        memory = rememberAnchor(memory, key, result.value.anchor);
        const last = lastPageIfPastEnd(result.value, state.page, ADMIN_PAGE_SIZE);
        if (last !== undefined) {
            // 还在加载：地址改到最后一页之后接着取，表格的遮罩不撤，免得先闪一下空的。
            options.onPastEnd(last);
            return;
        }
        rows.value = result.value.items;
        total.value = result.value.total;
        if (result.value.counts !== undefined) counts.value = result.value.counts;
        loading.value = false;
    }

    // 页码与“哪一份列表”合起来是一次取数的身份：两者都没变（例如别的页签的参数变了）时不重取。
    const requestKey = computed(() => {
        const state = options.state();
        return state === undefined ? undefined : `${listKey(options.schema, state)}#${state.page}`;
    });
    watch(
        requestKey,
        (key) => {
            const state = options.state();
            if (key !== undefined && state !== undefined) void load(state);
        },
        {immediate: true},
    );

    return {
        rows,
        total,
        counts,
        loading,
        error,
        async reload(reloadOptions) {
            if (reloadOptions?.fresh === true) memory = undefined;
            const state = options.state() ?? lastState;
            if (state !== undefined) await load(state);
        },
    };
}

/**
 * 输入停 `SEARCH_PAUSE_MS` 之后才 `apply`（计划 3.13）：每打一个字重新计时。`flush` 立刻做（按回车），`cancel` 丢掉还没到点的。
 * 时钟只有按间隔重复的计时，到点第一次就停掉（与 `form-feedback.ts` 的成功提示同一种做法）。卸载时停掉。
 */
export function useSearchPause(clock: SiteClock, apply: (value: string) => void): {schedule(value: string): void; flush(): void; cancel(): void} {
    let stop: (() => void) | undefined;
    let pending: string | undefined;

    function cancel(): void {
        stop?.();
        stop = undefined;
        pending = undefined;
    }

    function flush(): void {
        const value = pending;
        cancel();
        if (value !== undefined) apply(value);
    }

    onBeforeUnmount(cancel);

    return {
        schedule(value) {
            cancel();
            pending = value;
            stop = clock.every(SEARCH_PAUSE_MS, flush);
        },
        flush,
        cancel,
    };
}
