/**
 * 选择与焦点（docs/specs/workbench/files-explorer.md 的“基础文件操作”）：纯函数，输入当前可见行与旧状态，给出新状态。
 * 选择是行 id（资源地址）的有序集合；焦点是键盘位置；锚点是 Shift 范围选择的起点。
 */

import {isWithin, parentAddress, rebase} from "./address";
import type {PathChanges} from "./model";
import type {Row} from "./rows";

export interface Selection {
    readonly selected: ReadonlyArray<string>;
    readonly focus: string | null;
    readonly anchor: string | null;
}

export const EMPTY_SELECTION: Selection = {selected: [], focus: null, anchor: null};

export interface Modifiers {
    /** Ctrl，macOS 上是 Meta。 */
    readonly toggle: boolean;
    readonly range: boolean;
}

/** 可以被选中的行：根与资源行；状态行与新建的输入行不是资源。 */
export function selectable(row: Row): boolean {
    return row.kind === "root" || row.kind === "entry";
}

/** Ctrl/Meta+A 选入的行：可见的资源行，不含根、缺失条目与状态行（隐藏的正文本来就不在可见行里）。 */
function bulk(row: Row): boolean {
    return row.kind === "entry" && row.type !== "missing";
}

export function click(state: Selection, rows: ReadonlyArray<Row>, id: string, modifiers: Modifiers): Selection {
    if (modifiers.range) return range(state, rows, id, modifiers.toggle);
    if (modifiers.toggle) {
        const selected = state.selected.includes(id) ? state.selected.filter((item) => item !== id) : [...state.selected, id];
        return {selected, focus: id, anchor: id};
    }
    return {selected: [id], focus: id, anchor: id};
}

/** 锚点到 `id` 的可见范围；`extend` 时并入已有选择。 */
export function range(state: Selection, rows: ReadonlyArray<Row>, id: string, extend: boolean): Selection {
    const ids = rows.filter(selectable).map((row) => row.id);
    const anchor = state.anchor !== null && ids.includes(state.anchor) ? state.anchor : id;
    const from = ids.indexOf(anchor);
    const to = ids.indexOf(id);
    if (from < 0 || to < 0) return {selected: [id], focus: id, anchor: id};
    const span = ids.slice(Math.min(from, to), Math.max(from, to) + 1);
    const selected = extend ? [...state.selected, ...span.filter((item) => !state.selected.includes(item))] : span;
    return {selected, focus: id, anchor};
}

/** 右键：已选行保留整个选择，未选行先单选它。 */
export function contextSelect(state: Selection, id: string): Selection {
    return state.selected.includes(id) ? {...state, focus: id} : {selected: [id], focus: id, anchor: id};
}

export function selectAll(state: Selection, rows: ReadonlyArray<Row>): Selection {
    return {...state, selected: rows.filter(bulk).map((row) => row.id)};
}

export function toggleFocused(state: Selection): Selection {
    if (state.focus === null) return state;
    const has = state.selected.includes(state.focus);
    return {...state, selected: has ? state.selected.filter((item) => item !== state.focus) : [...state.selected, state.focus], anchor: state.focus};
}

/** 改名与删除事件：选择、焦点与锚点跟着改写到新地址，被删除的移除。 */
export function followPaths(state: Selection, changes: PathChanges): Selection {
    const map = (id: string | null): string | null => {
        if (id === null || changes.removed.some((prefix) => isWithin(id, prefix))) return null;
        return changes.moves.reduce((current, move) => rebase(current, move.from, move.to), id);
    };
    const selected = state.selected.map(map).filter((id): id is string => id !== null);
    return {selected: [...new Set(selected)], focus: map(state.focus), anchor: map(state.anchor)};
}

/**
 * 可见行变了（刷新、折叠、隐藏）：不在可见行里的从选择中去掉；焦点行不在了时回到最近的仍可见的祖先，没有祖先时回到
 * 原位置附近的可见行（`previous` 是变化前的行）。`pending` 判断一个地址是不是还没列出来（祖先都展开、但有祖先还没有
 * 列出结果）：这样的地址不算不在了。改名后新地址的子树要等列出才出现，选择要留到那时。
 */
export function prune(state: Selection, rows: ReadonlyArray<Row>, previous: ReadonlyArray<Row>, pending: (id: string) => boolean = () => false): Selection {
    const ids = new Set(rows.filter(selectable).map((row) => row.id));
    const kept = (id: string): boolean => ids.has(id) || pending(id);
    const selected = state.selected.filter(kept);
    const anchor = state.anchor !== null && kept(state.anchor) ? state.anchor : null;
    if (state.focus === null || kept(state.focus)) return {selected, focus: state.focus, anchor};
    let ancestor = parentAddress(state.focus);
    while (ancestor !== null && !ids.has(ancestor)) ancestor = parentAddress(ancestor);
    if (ancestor !== null) return {selected, focus: ancestor, anchor};
    const before = previous.filter(selectable).map((row) => row.id);
    const at = before.indexOf(state.focus);
    const near = [...before.slice(at + 1), ...before.slice(0, Math.max(at, 0)).reverse()].find((id) => ids.has(id)) ?? null;
    return {selected, focus: near, anchor};
}
