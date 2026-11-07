/**
 * 拖动的落点（docs/specs/workbench/files-explorer.md 的“拖动”）：纯函数，输入拖动的源与指针下的落点，给出放下时要做的事。
 * 落点按地址与同层前后项表达，不按行下标：拖动中树变了，放下时按同一份规则重判，只提交与最后显示相同的动作。
 *
 * - 目录行（含根、叶子节点与收起的目录）的中段：移入该目录。
 * - 其余位置是两行之间的缝。缝可能同时属于几层（子树末尾），按指针的横向位置选层；层定了，接收目录与位置也就定了。
 *   接收目录在内容树里时调整顺序（源都在这一层）或移动并放到这个位置；接收目录是普通文件夹时移入它（没有位置）。
 * - 树里行以外的空白：移入源所在方案的根。
 * - 树外工作台给的落点：在那里打开源里能打开的项（不是文件操作）。
 * - 落在自己或自己的后代上、移入源都已在的目录、落在缺失条目上、跨方案：没有落点。
 */

import type {WorkbenchFileDrop, WorkbenchFileDropHost} from "nbook/plugins/workbench/shared/contracts";

import {isWithin, nameOf, parentAddress, resourceOf, rootAddress} from "../tree/address";
import type {EntryRow, RootRow, Row} from "../tree/rows";
import {placeNames} from "./reorder-plan";

/** 指针下的落点：一行（指针在行里的纵向比例与相对行左边的横向像素）、树里行以外的空白，或树外工作台给的落点。 */
export type DropOver =
    | {readonly kind: "row"; readonly id: string; readonly offset: number; readonly x: number}
    | {readonly kind: "blank"}
    | {readonly kind: "editor"; readonly host: WorkbenchFileDropHost; readonly drop: WorkbenchFileDrop};

/** 插入线：画在 `row` 那一行的下沿，起点缩进到第 `depth` 层。 */
export interface DropLine {
    readonly row: string;
    readonly depth: number;
}

/** 放到哪一项旁边（标签用）：缝上方同层的那一项之后，或展开目录的第一个子项之前。 */
export interface DropAnchor {
    readonly id: string;
    readonly side: "before" | "after";
}

/** 拖出树时一次最多打开这么多项，多出的不打开（标签上说明）。 */
export const OPEN_LIMIT = 10;

export type DropAction =
    | {readonly kind: "none"}
    /** 移入 `target`；`ordered` 为目标在内容树里（移入的项排在最后）。 */
    | {readonly kind: "move"; readonly target: string; readonly ordered: boolean}
    /** 内容文件夹同一层调整顺序（只改清单）：`names` 是这一层的新顺序。 */
    | {readonly kind: "reorder"; readonly parent: string; readonly names: ReadonlyArray<string>; readonly before: string | null; readonly line: DropLine; readonly anchor: DropAnchor}
    /** 移动到内容树里 `target` 这一层的指定位置：`before` 之前，`null` 为末尾。 */
    | {readonly kind: "place"; readonly target: string; readonly before: string | null; readonly line: DropLine; readonly anchor: DropAnchor}
    | {readonly kind: "open"; readonly drop: WorkbenchFileDrop; readonly addresses: ReadonlyArray<string>; readonly skipped: number};

const NONE: DropAction = {kind: "none"};

/**
 * 动作的比较键：放下时重判的动作要与最后显示过的键相同才提交，没有落点为 null。只含决定结果的字段，插入线与标签的锚点只用来
 * 画反馈，不算。
 */
export function dropKey(action: DropAction): string | null {
    switch (action.kind) {
        case "none":
            return null;
        case "move":
            return JSON.stringify(["move", action.target]);
        case "reorder":
            return JSON.stringify(["reorder", action.parent, action.before, action.names]);
        case "place":
            return JSON.stringify(["place", action.target, action.before]);
        case "open":
            return JSON.stringify(["open", action.drop.key, action.addresses]);
    }
}

/** 缩进：与 `ExplorerRow` 的行内边距一致（第 d 层的展开箭头从 8 + 12d 起，宽 16）。 */
const INDENT_PX = 12;
/** 第 d 层展开箭头的中线：指针在它右边就算第 d 层（指针在名字上时取最深的一层）。 */
const LEVEL_EDGE_PX = 16;

/** 目录行（含根）分上中下三段（各四分之一、二分之一、四分之一），中段是移入；其余行分上下两半，都是缝。 */
const middle = (offset: number): boolean => offset >= 0.25 && offset <= 0.75;

const isDirectory = (row: Row): row is RootRow | EntryRow => row.kind === "root" || (row.kind === "entry" && row.type === "directory");

/** 目标是内容树里的目录：内容文件夹本身或其中的节点目录。 */
const orderedTarget = (row: RootRow | EntryRow): boolean => row.kind === "entry" && (row.folder === "content" || row.node);

function moveInto(sources: ReadonlyArray<string>, target: RootRow | EntryRow): DropAction {
    if (target.kind === "root" && target.status.kind !== "live") return NONE;
    if (sources.some((source) => isWithin(target.address, source))) return NONE;
    if (sources.some((source) => resourceOf(source).scheme !== resourceOf(target.address).scheme)) return NONE;
    if (sources.every((source) => parentAddress(source) === target.address)) return NONE;
    return {kind: "move", target: target.address, ordered: orderedTarget(target)};
}

/**
 * 落在一行上。`order` 取内容文件夹这一层清单里的全部条目（按清单顺序）；不是内容文件夹或还没列出时给 `null`。
 */
export function resolveDrop(sources: ReadonlyArray<string>, rows: ReadonlyArray<Row>, over: {readonly id: string; readonly offset: number; readonly x: number}, order: (parent: string) => ReadonlyArray<string> | null): DropAction {
    const index = rows.findIndex((row) => row.id === over.id);
    const row = rows[index];
    if (row === undefined || sources.length === 0 || row.kind === "edit") return NONE;
    if (row.kind === "root") return moveInto(sources, row);
    if (row.type === "missing") return NONE;
    if (row.type === "directory" && middle(over.offset)) return moveInto(sources, row);
    const below = row.type === "directory" ? over.offset > 0.75 : over.offset >= 0.5;
    return resolveGap(sources, rows, below ? index : index - 1, over.x, order);
}

/** 第 `above` 行与它下一行之间的缝。 */
function resolveGap(sources: ReadonlyArray<string>, rows: ReadonlyArray<Row>, above: number, x: number, order: (parent: string) => ReadonlyArray<string> | null): DropAction {
    const upper = rows[above];
    const lower = rows[above + 1];
    if (upper === undefined || upper.kind === "edit") return NONE;
    const byId = (id: string): Row | undefined => rows.find((candidate) => candidate.id === id);

    // 展开且有子行的目录与它的第一个子项之间：只有一层，放到第一个子项之前。
    if (isDirectory(upper) && upper.expanded && lower !== undefined && lower.depth > upper.depth) {
        if (lower.kind !== "entry") return NONE;
        return placeAt(sources, upper, lower, null, {row: upper.id, depth: upper.depth + 1}, order);
    }
    // 子树末尾：可选的层从下一行的层到上一行的层，不能到根这一层。
    const lowest = Math.max(1, lower?.depth ?? 1);
    if (upper.depth < lowest) return upper.kind === "root" ? moveInto(sources, upper) : NONE;
    const depth = Math.min(upper.depth, Math.max(lowest, Math.floor((x - LEVEL_EDGE_PX) / INDENT_PX)));
    let anchor: Row | undefined = upper;
    while (anchor !== undefined && anchor.kind === "entry" && anchor.depth > depth) anchor = byId(anchor.parent);
    if (anchor === undefined || anchor.kind !== "entry") return NONE;
    const parent = byId(anchor.parent);
    if (parent === undefined || !isDirectory(parent)) return NONE;
    return placeAt(sources, parent, null, anchor, {row: upper.id, depth}, order);
}

/**
 * 放到 `parent` 这一层：`after` 之后，或（`after` 为 `null` 时）`first` 之前。接收目录不在内容树里时就是移入它。
 */
function placeAt(sources: ReadonlyArray<string>, parent: RootRow | EntryRow, first: EntryRow | null, after: EntryRow | null, line: DropLine, order: (parent: string) => ReadonlyArray<string> | null): DropAction {
    const sibling = (after ?? first) as EntryRow;
    if (parent.kind === "root" && parent.status.kind !== "live") return NONE;
    if (sources.some((source) => isWithin(parent.address, source) || resourceOf(source).scheme !== resourceOf(parent.address).scheme)) return NONE;
    const names = sibling.content ? order(parent.address) : null;
    if (names === null) return moveInto(sources, parent);
    // 位置用“之后第一个不被拖动的项”表达：被拖动的项挪走后它仍在原处。
    const moved = new Set(sources.filter((source) => parentAddress(source) === parent.address).map(nameOf));
    const from = names.indexOf(sibling.name);
    const before = from < 0 ? null : (names.slice(after === null ? from : from + 1).find((name) => !moved.has(name)) ?? null);
    const anchor: DropAnchor = after === null ? {id: sibling.id, side: "before"} : {id: after.id, side: "after"};
    if (sources.every((source) => parentAddress(source) === parent.address && names.includes(nameOf(source)))) {
        const next = placeNames(names, moved, before);
        return next === null ? NONE : {kind: "reorder", parent: parent.address, names: next, before, line, anchor};
    }
    return {kind: "place", target: parent.address, before, line, anchor};
}

/** 树里行以外的空白：移入源所在方案的根（源总在同一方案里）；根不是活的时没有落点。 */
export function resolveBlankDrop(sources: ReadonlyArray<string>, rootOf: (address: string) => Row | undefined): DropAction {
    const first = sources[0];
    if (first === undefined) return NONE;
    const root = rootOf(rootAddress(resourceOf(first).scheme));
    return root?.kind === "root" ? moveInto(sources, root) : NONE;
}

/** 编辑组：源里能打开的项（文件与有正文的节点）依次在那一组打开，目录跳过；超过上限的不打开。 */
export function resolveEditorDrop(sources: ReadonlyArray<string>, over: Extract<DropOver, {readonly kind: "editor"}>, rowOf: (address: string) => Row | undefined): DropAction {
    const opens = sources.flatMap((source) => {
        const row = rowOf(source);
        return row?.kind === "entry" && row.opens !== null ? [row.opens] : [];
    });
    if (opens.length === 0) return NONE;
    return {kind: "open", drop: over.drop, addresses: opens.slice(0, OPEN_LIMIT), skipped: Math.max(0, opens.length - OPEN_LIMIT)};
}
