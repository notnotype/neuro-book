/**
 * 树内按键（docs/specs/workbench/files-explorer.md 的“基础文件操作”与“焦点”）：纯函数，按键加当前状态给出要做的事。
 * 焦点移动、展开收起、范围与全选、打开是高频交互，直接改状态；F2、Delete、上移下移这些具名动作给出命令 id，由控制器
 * 经命令服务执行，与菜单、工具栏、命令面板同一入口。它们不写成命令声明里的键位：宿主的键位分发是全局的，树没有焦点
 * 时 Delete 不能删文件。
 *
 * 无修饰的方向键同时移动焦点与选择；Ctrl/Meta 加方向键只移动焦点，再用 Space 切换选择。
 */

import {DELETE_COMMAND, MOVE_DOWN_COMMAND, MOVE_UP_COMMAND, RENAME_COMMAND} from "../commands";
import {parentAddress} from "./address";
import type {Row} from "./rows";
import {range, selectable, selectAll, toggleFocused} from "./selection";
import type {Selection} from "./selection";

export interface TreeKey {
    readonly key: string;
    readonly shift: boolean;
    /** Ctrl，macOS 上是 Meta。 */
    readonly toggle: boolean;
    readonly alt: boolean;
}

export type KeyEffect =
    | {readonly kind: "none"}
    | {readonly kind: "select"; readonly selection: Selection}
    | {readonly kind: "expand"; readonly address: string}
    | {readonly kind: "collapse"; readonly address: string}
    | {readonly kind: "open"; readonly address: string}
    | {readonly kind: "menu"; readonly id: string}
    | {readonly kind: "command"; readonly id: string};

const NONE: KeyEffect = {kind: "none"};

/** `page` 是一页的行数（视口能放下的行数）。 */
export function treeKey(rows: ReadonlyArray<Row>, selection: Selection, key: TreeKey, page: number): KeyEffect {
    if (key.alt) {
        if (key.shift || key.toggle) return NONE;
        if (key.key === "ArrowUp") return {kind: "command", id: MOVE_UP_COMMAND};
        if (key.key === "ArrowDown") return {kind: "command", id: MOVE_DOWN_COMMAND};
        return NONE;
    }
    const ids = rows.filter(selectable).map((row) => row.id);
    if (ids.length === 0) return NONE;
    const focusIndex = selection.focus === null ? -1 : ids.indexOf(selection.focus);
    const focused = focusIndex < 0 ? null : rows.find((row) => row.id === selection.focus) ?? null;
    const moveTo = (index: number): KeyEffect => {
        const id = ids[Math.max(0, Math.min(ids.length - 1, index))] as string;
        if (key.shift) return {kind: "select", selection: range(selection, rows, id, key.toggle)};
        if (key.toggle) return {kind: "select", selection: {...selection, focus: id}};
        return {kind: "select", selection: {selected: [id], focus: id, anchor: id}};
    };
    switch (key.key) {
        case "ArrowDown":
            return moveTo(focusIndex < 0 ? 0 : focusIndex + 1);
        case "ArrowUp":
            return moveTo(focusIndex < 0 ? 0 : focusIndex - 1);
        case "Home":
            return moveTo(0);
        case "End":
            return moveTo(ids.length - 1);
        case "PageDown":
            return moveTo(focusIndex < 0 ? 0 : focusIndex + Math.max(1, page));
        case "PageUp":
            return moveTo(focusIndex < 0 ? 0 : focusIndex - Math.max(1, page));
        case "ArrowRight": {
            if (focused === null) return moveTo(0);
            const expandable = focused.kind === "root" ? focused.status.kind !== "unbound" : focused.kind === "entry" && focused.expandable;
            if (!expandable) return NONE;
            const expanded = (focused.kind === "root" || focused.kind === "entry") && focused.expanded;
            if (!expanded) return {kind: "expand", address: focused.id};
            const next = ids[focusIndex + 1];
            return next !== undefined && parentAddress(next) === focused.id ? moveTo(focusIndex + 1) : NONE;
        }
        case "ArrowLeft": {
            if (focused === null) return moveTo(0);
            if ((focused.kind === "root" || focused.kind === "entry") && focused.expanded) return {kind: "collapse", address: focused.id};
            const parent = parentAddress(focused.id);
            return parent !== null && ids.includes(parent) ? moveTo(ids.indexOf(parent)) : NONE;
        }
        case " ":
            return key.shift || focused === null ? NONE : {kind: "select", selection: toggleFocused(selection)};
        case "Enter": {
            if (focused?.kind === "entry" && focused.opens !== null) return {kind: "open", address: focused.opens};
            if (focused?.kind === "entry" && focused.expandable) return {kind: focused.expanded ? "collapse" : "expand", address: focused.id};
            return NONE;
        }
        case "F2":
            return key.shift || key.toggle ? NONE : {kind: "command", id: RENAME_COMMAND};
        case "Delete":
            return key.shift || key.toggle ? NONE : {kind: "command", id: DELETE_COMMAND};
        case "F10":
            return key.shift && focused !== null ? {kind: "menu", id: focused.id} : NONE;
        case "a":
        case "A":
            return key.toggle && !key.shift ? {kind: "select", selection: selectAll(selection, rows)} : NONE;
        case "ContextMenu":
            return focused === null ? NONE : {kind: "menu", id: focused.id};
        default:
            return NONE;
    }
}
