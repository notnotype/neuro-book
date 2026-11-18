/**
 * 一个值的来历，按页读（docs/specs/canon/author-ui.md 输出 11、14；canon.model 输出 37）。展开一个值时才建，收起时丢掉。
 * 条目页的文字分页、通用字段表与面板的流水都用它，取一页的办法由调用方给：条目页经世界客户端，专门界面经它的 `context`。
 *
 * 读取的“戳”变了（世界版本、所选位置或模式，由调用方给）时，按已经读出来的步数从头重读：游标随版本作废，从头读才不丢
 * 作者看到哪了。重读期间留着旧的行；重读失败时也留着，另外写出原因。戳在读取途中又变了，晚到的结果丢掉，按新的再读一遍。
 */

import {effectScope, onScopeDispose, shallowRef, watch} from "vue";
import type {EffectScope, ShallowRef} from "vue";

import type {CanonOutputs} from "../shared/contracts";

export type OriginsPage = CanonOutputs["origins"];

/** 取一页；失败时 reject，`Error.message` 是给作者看的说明（可以为空）。 */
export type FetchOriginsPage = (cursor?: string) => Promise<OriginsPage>;

export interface OriginPagesState {
    /** 读到的各页拼起来，最近的在前。 */
    readonly items: OriginsPage["items"];
    readonly initial: OriginsPage["initial"];
    /** 还没读的步数。 */
    readonly remaining: number;
    /** 下一页的游标；读完了没有。 */
    readonly cursor?: string;
    /** 还没读到过。 */
    readonly loading: boolean;
    readonly failed: boolean;
    /** 失败时服务给的说明；没有时为空串。 */
    readonly reason: string;
}

export interface OriginPages {
    readonly state: Readonly<ShallowRef<OriginPagesState>>;
    more(): void;
    retry(): void;
}

const EMPTY: OriginPagesState = {items: [], initial: null, remaining: 0, loading: true, failed: false, reason: ""};

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** 在当前的副作用作用域里建（组件的 setup 或 `effectScope`），作用域结束时停止。`stamp` 变了就重读。 */
export function useOriginPages(fetch: FetchOriginsPage, stamp: () => string): OriginPages {
    const state = shallowRef<OriginPagesState>(EMPTY);
    // 每次读取一个号；号对不上的结果是作废的读取（版本又变了、作用域已结束）。
    let run = 0;
    let stopped = false;

    const settle = (pages: readonly OriginsPage[]): void => {
        const last = pages.at(-1)!;
        state.value = {
            items: pages.flatMap((page) => page.items),
            initial: last.initial,
            remaining: Math.max(0, last.total - pages.reduce((sum, page) => sum + page.items.length, 0)),
            ...(last.cursor === undefined ? {} : {cursor: last.cursor}),
            loading: false,
            failed: false,
            reason: "",
        };
    };

    /** 从头读到至少 `count` 步（或读完）。 */
    const reload = async (count: number): Promise<void> => {
        const mine = ++run;
        try {
            const pages: OriginsPage[] = [await fetch()];
            while (pages.reduce((sum, page) => sum + page.items.length, 0) < count && pages.at(-1)!.cursor !== undefined) {
                pages.push(await fetch(pages.at(-1)!.cursor));
                if (mine !== run || stopped) return;
            }
            if (mine === run && !stopped) settle(pages);
        } catch (error) {
            // 原因交给界面写出来（输出 11）；读到过的行留着，不整块换成一句错误。
            if (mine === run && !stopped) state.value = {...state.value, loading: false, failed: true, reason: reasonOf(error)};
        }
    };

    const more = (): void => {
        const current = state.value;
        if (current.cursor === undefined) return;
        const mine = ++run;
        void fetch(current.cursor).then(
            (page) => {
                if (mine !== run || stopped) return;
                state.value = {
                    items: [...current.items, ...page.items],
                    initial: page.initial,
                    remaining: Math.max(0, page.total - current.items.length - page.items.length),
                    ...(page.cursor === undefined ? {} : {cursor: page.cursor}),
                    loading: false,
                    failed: false,
                    reason: "",
                };
            },
            // 翻页失败多半是游标随版本作废了（`cursor-stale`）：按要读到的步数从头重读。
            () => {
                if (mine === run && !stopped) void reload(current.items.length + 1);
            },
        );
    };

    watch(stamp, () => void reload(state.value.items.length), {immediate: true});
    onScopeDispose(() => {
        stopped = true;
    });

    return {state, more, retry: () => void reload(state.value.items.length)};
}

/**
 * 一组地址各一份来历（展开着的那个值、语义档的各个字段）：地址列表变了，新出现的开始读，不在了的停掉。键是调用方定的地址
 * 字符串，`fetchFor` 按键给取页的办法。在当前的副作用作用域里建。
 */
export function useOriginPagesMap(keys: () => readonly string[], fetchFor: (key: string) => FetchOriginsPage, stamp: () => string): Readonly<ShallowRef<ReadonlyMap<string, OriginPages>>> {
    const pages = shallowRef<ReadonlyMap<string, OriginPages>>(new Map());
    const scopes = new Map<string, EffectScope>();
    const sync = (wanted: readonly string[]): void => {
        const next = new Map<string, OriginPages>();
        for (const [key, scope] of scopes) {
            if (wanted.includes(key)) continue;
            scope.stop();
            scopes.delete(key);
        }
        for (const key of wanted) {
            let found = pages.value.get(key);
            if (found === undefined) {
                const scope = effectScope();
                found = scope.run(() => useOriginPages(fetchFor(key), stamp))!;
                scopes.set(key, scope);
            }
            next.set(key, found);
        }
        pages.value = next;
    };
    watch(() => keys().join("\u0000"), () => sync(keys()), {immediate: true});
    onScopeDispose(() => {
        for (const scope of scopes.values()) scope.stop();
        scopes.clear();
    });
    return pages;
}
