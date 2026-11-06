/**
 * 按邻接算卡片的边（docs/specs/ui/workbench-layout.md 输出 19）：呈现树上每块叶四边各挨着什么。卡片还是平铺、缝多宽由主题变量决定，这里只给几何判断。
 *
 * - 贴着窗体、标题栏或状态栏的一边（outer）留整缝，中间夹着零尺寸的叶时扣掉它与缝占的像素；
 * - 挨着别的叶的一边（inner）留半缝，并扣掉两者之间占的一半，两张卡片之间合起来正好一条缝；
 * - 活动栏与相邻且等长的工具面板相连（joined）：等长就是同一个分支的兄弟，所以侧栏拆成一列时不相连。拖到零时不相连。
 *
 * 纯模块：只读呈现树与这一刻的尺寸，相连与否因此跟着拖动中的几何变。
 */

import type {GridBranchInput, GridExtent, GridNodeInput} from "@notnotype/nb-layout";

export type CardSide =
    | {readonly kind: "outer"; readonly occupied: number}
    | {readonly kind: "inner"; readonly occupied: number}
    | {readonly kind: "joined"};

export interface CardEdges {
    readonly top: CardSide;
    readonly right: CardSide;
    readonly bottom: CardSide;
    readonly left: CardSide;
}

export interface CardInput {
    readonly root: GridNodeInput<string>;
    readonly sizes: Readonly<Record<string, GridExtent>>;
    readonly sashSizes: Readonly<Record<string, ReadonlyArray<number>>>;
    readonly activitybar: string;
    /** 不是卡片的叶（状态栏）：挨着它算贴边。 */
    readonly plain: ReadonlySet<string>;
    /** 工具面板吗：活动栏只和工具面板相连。 */
    isTool(id: string): boolean;
}

type Orientation = "horizontal" | "vertical";
interface Step {
    readonly branch: GridBranchInput<string>;
    readonly index: number;
}

const axisOf = (orientation: Orientation): keyof GridExtent => (orientation === "horizontal" ? "width" : "height");

function hasSize(node: GridNodeInput<string>, axis: Orientation, input: CardInput): boolean {
    return (input.sizes[node.id]?.[axisOf(axis)] ?? 1) > 0;
}

/** 邻居是同向分支时，它靠近这一侧的零尺寸孩子与后面的缝也夹在两张卡片之间：两边算出同一个占用。垂直方向的分支沿这条边整排相接，不再往里看。 */
function nearOccupied(node: GridNodeInput<string>, axis: Orientation, direction: -1 | 1, input: CardInput): number {
    if (node.kind !== "branch" || node.orientation !== axis) return 0;
    const sashes = input.sashSizes[node.id] ?? [];
    const count = node.children.length;
    let occupied = 0;
    for (let step = 0; step < count; step += 1) {
        const at = direction < 0 ? count - 1 - step : step;
        const child = node.children[at] as GridNodeInput<string>;
        if (hasSize(child, axis, input)) return occupied + nearOccupied(child, axis, direction, input);
        occupied += sashes[direction < 0 ? at - 1 : at] ?? 0;
    }
    return occupied;
}

function sideOf(path: ReadonlyArray<Step>, axis: Orientation, direction: -1 | 1, input: CardInput): {readonly side: CardSide; readonly neighbor: string | null} {
    let occupied = 0;
    for (let level = path.length - 1; level >= 0; level -= 1) {
        const {branch, index} = path[level] as Step;
        if (branch.orientation !== axis) continue;
        const sashes = input.sashSizes[branch.id] ?? [];
        for (let at = index + direction; at >= 0 && at < branch.children.length; at += direction) {
            occupied += sashes[direction < 0 ? at : at - 1] ?? 0;
            const sibling = branch.children[at] as GridNodeInput<string>;
            if (input.plain.has(sibling.id)) return {side: {kind: "outer", occupied}, neighbor: null};
            if (hasSize(sibling, axis, input)) return {side: {kind: "inner", occupied: occupied + nearOccupied(sibling, axis, direction, input)}, neighbor: sibling.id};
        }
    }
    return {side: {kind: "outer", occupied}, neighbor: null};
}

export function layoutCardEdges(input: CardInput): Readonly<Record<string, CardEdges>> {
    const cards: Record<string, CardEdges> = {};
    const parents = new Map<string, GridBranchInput<string> | undefined>();
    const leftNeighbor = new Map<string, string | null>();
    const visit = (node: GridNodeInput<string>, path: ReadonlyArray<Step>): void => {
        if (node.kind === "branch") {
            node.children.forEach((child, index) => visit(child, [...path, {branch: node, index}]));
            return;
        }
        if (input.plain.has(node.id)) return;
        const left = sideOf(path, "horizontal", -1, input);
        cards[node.id] = {
            top: sideOf(path, "vertical", -1, input).side,
            right: sideOf(path, "horizontal", 1, input).side,
            bottom: sideOf(path, "vertical", 1, input).side,
            left: left.side,
        };
        parents.set(node.id, path.at(-1)?.branch);
        leftNeighbor.set(node.id, left.neighbor);
    };
    visit(input.root, []);

    const bar = cards[input.activitybar];
    if (bar !== undefined) {
        for (const [id, card] of Object.entries(cards)) {
            if (leftNeighbor.get(id) !== input.activitybar || !input.isTool(id) || (input.sizes[id]?.width ?? 1) <= 0) continue;
            if (parents.get(id) !== parents.get(input.activitybar)) continue;
            cards[input.activitybar] = {...bar, right: {kind: "joined"}};
            cards[id] = {...card, left: {kind: "joined"}};
        }
    }
    return cards;
}

/** 一边留多宽：贴边整缝减去占用，相邻半缝减去一半的占用（都不小于 0），相连 0。缝宽是主题变量，平铺时为 0。 */
export function cardInset(side: CardSide): string {
    switch (side.kind) {
        case "outer":
            return side.occupied === 0 ? "var(--shell-gap, 0px)" : `max(0px, calc(var(--shell-gap, 0px) - ${String(side.occupied)}px))`;
        case "joined":
            return "0px";
        case "inner":
            return `max(0px, calc(var(--shell-gap, 0px) / 2 - ${String(side.occupied / 2)}px))`;
    }
}
