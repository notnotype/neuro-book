/**
 * 外壳部件的卡片边（docs/specs/ui/workbench-shell.md 输出 38）：每个部件四边各挨着什么。卡片还是平铺、缝多宽由主题变量
 * 决定（`--shell-gap` 等，平铺时缝为 0），这里只给几何判断，样式据此决定每一边留多少：
 *
 * - 贴着窗体、标题栏或状态栏的一边（outer）留整缝，中间夹着零尺寸部件（拖到零）时扣掉它与边界占的像素；
 * - 挨着别的部件的一边（inner）留半缝，并扣掉两者之间边界与零尺寸部件占的像素的一半，两张卡片之间合起来正好一条缝；
 * - 活动栏与通高的侧栏相连（joined）：中间不留缝、相接的两角不圆，看上去是一张卡片。侧栏不通高（面板跨在侧栏下方）、
 *   拖到零或隐藏时不相连。
 *
 * 纯模块：只读投影的树、尺寸与边界占用；分割与紧凑两种呈现都适用。
 */

import type {GridBranchInput, GridNodeInput} from "@notnotype/nb-layout";

import {SHELL_BODY_ID, SHELL_MAIN_ID} from "./layout";
import type {ShellProjection} from "./layout";

/** 画成卡片的部件；标题栏与状态栏不是卡片。 */
export const SHELL_CARD_PARTS = ["activitybar", "sidebar", "editor", "auxiliarybar", "panel"] as const;

export type ShellCardPart = (typeof SHELL_CARD_PARTS)[number];

/** `occupied`：这一边与相邻部件（或窗体边缘）之间被边界（可拖边界 1px）和零尺寸部件占去的像素。 */
export type ShellCardSide =
    | {readonly kind: "outer"; readonly occupied: number}
    | {readonly kind: "inner"; readonly occupied: number}
    | {readonly kind: "joined"};

export interface ShellCardEdges {
    readonly top: ShellCardSide;
    readonly right: ShellCardSide;
    readonly bottom: ShellCardSide;
    readonly left: ShellCardSide;
}

/** 树里出现的卡片部件各自的边；不在树里（隐藏）的部件没有条目。 */
export type ShellCards = Readonly<Partial<Record<ShellCardPart, ShellCardEdges>>>;

interface Step {
    readonly branch: GridBranchInput<string>;
    readonly index: number;
}

const CARD_PART_SET: ReadonlySet<string> = new Set(SHELL_CARD_PARTS);

function isBranch(node: GridNodeInput<string>): node is GridBranchInput<string> {
    return node.kind === "branch";
}

function findMain(node: GridNodeInput<string>): GridBranchInput<string> | null {
    if (!isBranch(node)) return null;
    if (node.id === SHELL_MAIN_ID) return node;
    for (const child of node.children) {
        const found = findMain(child);
        if (found !== null) return found;
    }
    return null;
}

/**
 * 从叶往外找某一边的邻居：逐级看与这一边同轴的分支里，朝这个方向有没有尺寸大于 0 的兄弟；一路累加经过的边界占用。
 * 只在 main 之内找：main 之外是标题栏与状态栏，挨着它们算贴边。
 */
function sideOf(path: ReadonlyArray<Step>, axis: "horizontal" | "vertical", direction: -1 | 1, projection: Pick<ShellProjection, "sizes" | "sashSizes">): {side: ShellCardSide; neighbor: string | null} {
    let occupied = 0;
    for (let level = path.length - 1; level >= 0; level -= 1) {
        const {branch, index} = path[level]!;
        if (branch.orientation !== axis) continue;
        const sashes = projection.sashSizes[branch.id] ?? [];
        for (let at = index + direction; at >= 0 && at < branch.children.length; at += direction) {
            // 第 k 条边界在第 k 与第 k + 1 个子节点之间。
            occupied += sashes[direction < 0 ? at : at - 1] ?? 0;
            const sibling = branch.children[at]!;
            if (hasSize(sibling, projection)) return {side: {kind: "inner", occupied: occupied + nearOccupied(sibling, axis, direction, projection)}, neighbor: sibling.id};
        }
    }
    return {side: {kind: "outer", occupied}, neighbor: null};
}

/** 紧凑呈现只给部分节点算尺寸：没有尺寸的按有内容算。 */
function hasSize(node: GridNodeInput<string>, projection: Pick<ShellProjection, "sizes">): boolean {
    return (projection.sizes[node.id] ?? 1) > 0;
}

/**
 * 邻居是同向分支时，它靠近这一侧的零尺寸孩子（拖到零的侧栏）与它们后面的边界也夹在两张卡片之间：往里累加，两边算出
 * 同一个占用。垂直方向的分支沿这条边整排相接，不再往里看。
 */
function nearOccupied(node: GridNodeInput<string>, axis: "horizontal" | "vertical", direction: -1 | 1, projection: Pick<ShellProjection, "sizes" | "sashSizes">): number {
    if (!isBranch(node) || node.orientation !== axis) return 0;
    const sashes = projection.sashSizes[node.id] ?? [];
    const count = node.children.length;
    let occupied = 0;
    // 从靠近这一侧的一端往里走：朝左（-1）找邻居时，邻居靠近的是它的右端。
    for (let step = 0; step < count; step += 1) {
        const at = direction < 0 ? count - 1 - step : step;
        const child = node.children[at]!;
        if (hasSize(child, projection)) return occupied + nearOccupied(child, axis, direction, projection);
        occupied += sashes[direction < 0 ? at - 1 : at] ?? 0;
    }
    return occupied;
}

export function shellCards(projection: Pick<ShellProjection, "tree" | "sizes" | "sashSizes">): ShellCards {
    const main = findMain(projection.tree);
    if (main === null) return {};
    const cards: Partial<Record<ShellCardPart, ShellCardEdges>> = {};
    const parents: Partial<Record<ShellCardPart, GridBranchInput<string>>> = {};
    const leftNeighbor: Partial<Record<ShellCardPart, string | null>> = {};

    const visit = (node: GridNodeInput<string>, path: ReadonlyArray<Step>): void => {
        if (isBranch(node)) {
            node.children.forEach((child, index) => visit(child, [...path, {branch: node, index}]));
            return;
        }
        if (!CARD_PART_SET.has(node.id)) return;
        const part = node.id as ShellCardPart;
        const left = sideOf(path, "horizontal", -1, projection);
        cards[part] = {
            top: sideOf(path, "vertical", -1, projection).side,
            right: sideOf(path, "horizontal", 1, projection).side,
            bottom: sideOf(path, "vertical", 1, projection).side,
            left: left.side,
        };
        parents[part] = path.at(-1)?.branch;
        leftNeighbor[part] = left.neighbor;
    };
    main.children.forEach((child, index) => visit(child, [{branch: main, index}]));

    // 侧栏是横排 body 的直接子节点（通高）、左边挨着活动栏、自己有宽度时，两者相连。
    const sidebar = cards.sidebar;
    const activitybar = cards.activitybar;
    const body = parents.sidebar;
    if (sidebar !== undefined && activitybar !== undefined && body?.id === SHELL_BODY_ID && body.orientation === "horizontal" && leftNeighbor.sidebar === "activitybar" && (projection.sizes.sidebar ?? 0) > 0) {
        cards.activitybar = {...activitybar, right: {kind: "joined"}};
        cards.sidebar = {...sidebar, left: {kind: "joined"}};
    }
    return cards;
}

/** 一边留多宽：贴边整缝减去占用，相邻半缝减去一半的占用（都不小于 0），相连 0。缝宽是主题变量，平铺时为 0。 */
export function shellCardInset(side: ShellCardSide): string {
    switch (side.kind) {
        case "outer":
            return side.occupied === 0 ? "var(--shell-gap, 0px)" : `max(0px, calc(var(--shell-gap, 0px) - ${String(side.occupied)}px))`;
        case "joined":
            return "0px";
        case "inner":
            return `max(0px, calc(var(--shell-gap, 0px) / 2 - ${String(side.occupied / 2)}px))`;
    }
}
