/**
 * 树内拖动的落点（docs/specs/workbench/files-explorer.md 的“拖动”）：纯函数，输入拖动的源、指针下的行与它在行里的位置，
 * 给出放下时要做的事。落点按地址与同层前后项表达，不按行下标：拖动中树变了，放下时按同一份规则重判，只提交与最后显示
 * 相同的动作。
 *
 * - 目录行（含根）的中间一段：移入该目录（批量移动）。
 * - 内容文件夹里、与源同一层的两行之间（行的上下各四分之一，非目录行的上下半）：调整顺序，只改清单。
 * - 落在自己或自己的后代上、移入源已在的目录、落在缺失条目或状态行上：没有落点。
 */

import {isWithin, parentAddress} from "../tree/address";
import type {Row} from "../tree/rows";
import {placeNames} from "./reorder-plan";

/** 指针在行里的位置。 */
export type DropZone = "before" | "inside" | "after";

export type DropAction =
    | {readonly kind: "none"}
    | {readonly kind: "move"; readonly target: string}
    | {readonly kind: "reorder"; readonly parent: string; readonly names: ReadonlyArray<string>; readonly anchor: string; readonly zone: "before" | "after"};

const NONE: DropAction = {kind: "none"};

/** 行里的位置：目录行分上中下三段（各四分之一、二分之一、四分之一），其余行分上下两半。`offset` 是指针相对行顶的比例。 */
export function zoneOf(row: Row, offset: number): DropZone {
    const directory = row.kind === "root" || (row.kind === "entry" && row.expandable);
    if (!directory) return offset < 0.5 ? "before" : "after";
    if (offset < 0.25) return "before";
    if (offset > 0.75) return "after";
    return "inside";
}

/**
 * `order` 取内容文件夹这一层清单里的全部条目（按清单顺序），只在调整顺序时用到；不是内容文件夹或还没列出时给 `null`。
 */
export function resolveDrop(sources: ReadonlyArray<string>, row: Row | undefined, zone: DropZone, order: (parent: string) => ReadonlyArray<string> | null): DropAction {
    if (row === undefined || sources.length === 0) return NONE;
    if (row.kind !== "root" && row.kind !== "entry") return NONE;
    if (sources.some((source) => isWithin(row.id, source))) return NONE;
    const moveInto = (target: string): DropAction => (sources.every((source) => parentAddress(source) === target) ? NONE : {kind: "move", target});
    if (row.kind === "root") return row.status.kind === "live" ? moveInto(row.address) : NONE;
    if (row.type === "missing") return NONE;
    if (zone === "inside") return row.expandable ? moveInto(row.address) : NONE;
    // 两行之间：只在内容文件夹里、与全部源同一层且都列在清单里时调整顺序。
    if (!row.content || row.listed !== true || !sources.every((source) => parentAddress(source) === row.parent)) return NONE;
    const names = order(row.parent);
    if (names === null) return NONE;
    const moved = new Set(sources.map((source) => source.slice(source.lastIndexOf("/") + 1)));
    if (![...moved].every((name) => names.includes(name))) return NONE;
    const at = names.indexOf(row.name);
    // “这一行之后”就是它后面第一个不被拖动的项之前。
    const before = zone === "before" ? row.name : (names.slice(at + 1).find((name) => !moved.has(name)) ?? null);
    const next = placeNames(names, moved, before);
    return next === null ? NONE : {kind: "reorder", parent: row.parent, names: next, anchor: row.id, zone};
}
