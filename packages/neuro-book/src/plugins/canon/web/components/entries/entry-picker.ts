/**
 * 条目选择器（同名 `EntryPicker.md`）的数据形状与查找的去抖：组件是受控零件，查找由宿主经 `useEntryFind` 发起，结果经
 * `results` 传回组件。确认条、新建对话框、移动对话框、元素对话框共用这一份查找逻辑。
 */

import {onScopeDispose, shallowRef, type ShallowRef} from "vue";

import type {FoundEntry} from "../../../shared/contracts";

/** 一个候选条目。 */
export interface EntryCandidate {
    readonly id: string;
    readonly name: string;
    /** 种类（人物、知识点这类）；没有时不写。 */
    readonly kind?: string;
    /** 右侧的一句说明，例如“还没出场”“别名：小瑕”。 */
    readonly note?: string;
}

/** 查找入口：按搜索词列出候选，通常经 `findEntries` 远程方法。 */
export type EntryFind = (query: string) => Promise<{readonly ok: true; readonly items: readonly EntryCandidate[]} | {readonly ok: false; readonly reason: string}>;

/**
 * 这一次查找到哪了。`done` 记下结果是按哪个词查的：打字后到新结果回来之前，列表还是旧词的结果，组件据此判断要不要给
 * “新建”。
 */
export type EntryResults =
    | {readonly kind: "idle"}
    | {readonly kind: "searching"}
    | {readonly kind: "done"; readonly query: string; readonly items: readonly EntryCandidate[]}
    | {readonly kind: "failed"; readonly reason: string};

/** 候选右侧说明用的两句话（按显示语言给）。 */
export interface CandidateWords {
    readonly alias: (alias: string) => string;
    readonly unappeared: string;
}

/** `findEntries` 查到的一项换成候选：按别名命中的、还没出场的各有一句说明，两句都在时并排写。 */
export function foundCandidate(item: FoundEntry, words: CandidateWords): EntryCandidate {
    const notes = [...(item.matchedAlias === undefined ? [] : [words.alias(item.matchedAlias)]), ...(item.appeared ? [] : [words.unappeared])];
    return {id: item.id, name: item.name, kind: item.kind, ...(notes.length === 0 ? {} : {note: notes.join(" · ")})};
}

/** 打字停这么久再查。 */
export const ENTRY_FIND_DEBOUNCE_MS = 200;

/**
 * 接 `EntryPicker` 的 `search` 事件：空串（打开列表、删光了字）立刻查，打字时停 `ENTRY_FIND_DEBOUNCE_MS` 再查。每次查找拿
 * 一个递增的序号，结果回来时序号不是最新的就丢掉：先发的查找可能后回来，不丢就会盖住新词的结果。在组件的 setup 里调用，
 * 作用域结束时清掉计时器，之后回来的结果不再写。
 */
export function useEntryFind(find: () => EntryFind): {readonly results: ShallowRef<EntryResults>; search(query: string): void} {
    const results = shallowRef<EntryResults>({kind: "idle"});
    let sequence = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function run(query: string): Promise<void> {
        const mine = ++sequence;
        results.value = {kind: "searching"};
        const result = await find()(query).catch((error: unknown) => ({ok: false as const, reason: error instanceof Error ? error.message : String(error)}));
        if (mine !== sequence) return;
        results.value = result.ok ? {kind: "done", query, items: result.items} : {kind: "failed", reason: result.reason};
    }

    function search(query: string): void {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        if (query === "") {
            void run(query);
            return;
        }
        timer = setTimeout(() => {
            timer = undefined;
            void run(query);
        }, ENTRY_FIND_DEBOUNCE_MS);
    }

    onScopeDispose(() => {
        if (timer !== undefined) clearTimeout(timer);
        sequence++;
    });

    return {results, search};
}
