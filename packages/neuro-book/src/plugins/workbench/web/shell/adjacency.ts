/**
 * 按邻接算卡片的边（docs/specs/ui/workbench-layout.md 输出 19）：呈现树上每块叶四边各挨着什么。卡片还是平铺、缝多宽由主题变量决定，这里只给几何判断。
 *
 * - 贴着窗体、标题栏或状态栏的一边（outer）留整缝，中间夹着零尺寸的叶时扣掉它与缝占的像素；
 * - 挨着别的卡片的一边（inner）留半缝，并扣掉两者之间占的一半，两张卡片之间合起来正好一条缝；
 * - 相连（joined）：同一个卡片组（宿主给，工作台是区域）里相邻的两块拼成一张卡片，一个容器的几节就是一张；
 *   侧轨（`bars`：左边的活动栏、右栏外侧的右轨，输出 50）和贴着它、在它的卡片组里、宽度大于零的每一块相连（`bar`），一列几节时整列相连。拖到零时不相连。
 *
 * 纯模块：只读呈现树与这一刻的尺寸，相连与否因此跟着拖动中的几何变。
 */

import type {GridBranchInput, GridExtent, GridNodeInput} from "@notnotype/nb-layout";

export type CardSide =
    | {readonly kind: "outer"; readonly occupied: number}
    | {readonly kind: "inner"; readonly occupied: number}
    /** `bar`：这一边相连的是侧轨与它的区域之间（活动栏的右边与侧栏的左边、右栏的右边与右轨的左边）。 */
    | {readonly kind: "joined"; readonly bar?: true};

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
    /** 侧轨：和它的卡片组相连的条。 */
    readonly bars: ReadonlyArray<CardBar>;
    /** 不是卡片的叶（状态栏）：挨着它算贴边。 */
    readonly plain: ReadonlySet<string>;
    /** 叶所在的卡片组：同组、相邻的两块拼成一张卡片。null 是自成一张（编辑组、浮动窗、条、实时布局的空位）。 */
    groupOf(id: string): string | null;
}

/**
 * 一条侧轨：`leaf` 是它的叶，`group` 是和它相连的卡片组，`side` 是它在卡片组的哪一边（活动栏在侧栏前面是 `start`，右轨在右栏后面是 `end`）。
 */
export interface CardBar {
    readonly leaf: string;
    readonly group: string;
    readonly side: "start" | "end";
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

function sideOf(path: ReadonlyArray<Step>, axis: Orientation, direction: -1 | 1, input: CardInput): {readonly side: CardSide; readonly neighbor: GridNodeInput<string> | null} {
    let occupied = 0;
    for (let level = path.length - 1; level >= 0; level -= 1) {
        const {branch, index} = path[level] as Step;
        if (branch.orientation !== axis) continue;
        const sashes = input.sashSizes[branch.id] ?? [];
        for (let at = index + direction; at >= 0 && at < branch.children.length; at += direction) {
            occupied += sashes[direction < 0 ? at : at - 1] ?? 0;
            const sibling = branch.children[at] as GridNodeInput<string>;
            if (input.plain.has(sibling.id)) return {side: {kind: "outer", occupied}, neighbor: null};
            if (hasSize(sibling, axis, input)) return {side: {kind: "inner", occupied: occupied + nearOccupied(sibling, axis, direction, input)}, neighbor: sibling};
        }
    }
    return {side: {kind: "outer", occupied}, neighbor: null};
}

/** 一棵子树里的叶，按从前到后的顺序。 */
export const leafIdsOf = (node: GridNodeInput<string>): string[] => (node.kind === "leaf" ? [node.id] : node.children.flatMap(leafIdsOf));

export function layoutCardEdges(input: CardInput): Readonly<Record<string, CardEdges>> {
    const cards: Record<string, CardEdges> = {};
    const leftNeighbor = new Map<string, string | null>();
    const rightNeighbor = new Map<string, string | null>();
    const groups = new Map<string, string | null>();
    const groupOf = (id: string): string | null => {
        if (!groups.has(id)) groups.set(id, input.groupOf(id));
        return groups.get(id) ?? null;
    };
    /** 挨着的是同组的卡片（邻居是分支时看它里面的每一块）：这一边相连。 */
    const joins = (id: string, neighbor: GridNodeInput<string> | null): boolean => {
        const group = groupOf(id);
        return group !== null && neighbor !== null && leafIdsOf(neighbor).every((leaf) => groupOf(leaf) === group);
    };
    const edge = (id: string, found: ReturnType<typeof sideOf>): CardSide => (found.side.kind === "inner" && joins(id, found.neighbor) ? {kind: "joined"} : found.side);
    const visit = (node: GridNodeInput<string>, path: ReadonlyArray<Step>): void => {
        if (node.kind === "branch") {
            node.children.forEach((child, index) => visit(child, [...path, {branch: node, index}]));
            return;
        }
        if (input.plain.has(node.id)) return;
        const left = sideOf(path, "horizontal", -1, input);
        const right = sideOf(path, "horizontal", 1, input);
        cards[node.id] = {
            top: edge(node.id, sideOf(path, "vertical", -1, input)),
            right: edge(node.id, right),
            bottom: edge(node.id, sideOf(path, "vertical", 1, input)),
            left: edge(node.id, left),
        };
        leftNeighbor.set(node.id, left.neighbor?.id ?? null);
        rightNeighbor.set(node.id, right.neighbor?.id ?? null);
    };
    visit(input.root, []);

    const joined: CardSide = {kind: "joined", bar: true};
    for (const bar of input.bars) {
        if (cards[bar.leaf] === undefined) continue;
        // 卡片在侧轨的哪一边：活动栏（start）贴着它右边的块，右轨（end）贴着它左边的块。
        const beside = bar.side === "start" ? leftNeighbor : rightNeighbor;
        for (const [id, card] of Object.entries(cards)) {
            if (beside.get(id) !== bar.leaf || groupOf(id) !== bar.group || (input.sizes[id]?.width ?? 1) <= 0) continue;
            const own = cards[bar.leaf] as CardEdges;
            cards[bar.leaf] = bar.side === "start" ? {...own, right: joined} : {...own, left: joined};
            cards[id] = bar.side === "start" ? {...card, left: joined} : {...card, right: joined};
        }
    }
    return cards;
}

/** 这一边和侧轨相连（侧轨自己朝着区域的那一边，或区域的块朝着侧轨的那一边）。 */
export const joinedToBar = (side: CardSide | undefined): boolean => side?.kind === "joined" && side.bar === true;

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

/** 同 `cardInset`，按读到的缝宽（px）算成数：给只收数的地方（交换的裁切窗）。两处的规则要一起改。 */
export function cardInsetPx(side: CardSide, gap: number): number {
    switch (side.kind) {
        case "outer":
            return Math.max(0, gap - side.occupied);
        case "joined":
            return 0;
        case "inner":
            return Math.max(0, gap / 2 - side.occupied / 2);
    }
}

/**
 * 最大化的面板盖住除条与侧轨以外的全部区域（输出 13、50）：它的矩形不来自布局，四边都挨着窗体，左边有活动栏时挨着活动栏、右边有右轨时挨着右轨；
 * 被盖住的面板不动，它们的边照旧。侧轨这时不和底下的区域相连。
 */
export function maximizedCardEdges(cards: Readonly<Record<string, CardEdges>>, panel: string, bars: ReadonlyArray<CardBar>): Readonly<Record<string, CardEdges>> {
    if (cards[panel] === undefined) return cards;
    const outer: CardSide = {kind: "outer", occupied: 0};
    const inner: CardSide = {kind: "inner", occupied: 0};
    const present = bars.filter((bar) => cards[bar.leaf] !== undefined);
    const has = (side: CardBar["side"]): boolean => present.some((bar) => bar.side === side);
    const next: Record<string, CardEdges> = {...cards, [panel]: {top: outer, right: has("end") ? inner : outer, bottom: outer, left: has("start") ? inner : outer}};
    for (const bar of present) {
        const own = cards[bar.leaf] as CardEdges;
        next[bar.leaf] = bar.side === "start" ? {...own, right: inner} : {...own, left: inner};
    }
    return next;
}

export type SashKind = "panes" | "editors" | "shell";

function everyLeaf(node: GridNodeInput<string>, test: (id: string) => boolean): boolean {
    return node.kind === "leaf" ? test(node.id) : node.children.every((child) => everyLeaf(child, test));
}

/**
 * 分隔线的种类（输出 19）：同一张卡片里几节之间的线（`panes`）是开放式分割线，有自己的颜色与两端缩进；编辑组之间的线贯通整个高度；
 * 别的（不同的卡片之间）是外壳的接缝。卡片主题里后两种透明，缝就是边界。
 */
export function sashKindOf(branch: GridBranchInput<string>, before: string, after: string, roleOf: (id: string) => "tool" | "editor" | null, groupOf: (id: string) => string | null): SashKind {
    const nodes = branch.children.filter((child) => child.id === before || child.id === after);
    const group = nodes[0] === undefined ? null : groupOf(leafIdsOf(nodes[0])[0] ?? "");
    if (group !== null && nodes.every((node) => everyLeaf(node, (id) => groupOf(id) === group))) return "panes";
    if (nodes.every((node) => everyLeaf(node, (id) => roleOf(id) === "editor"))) return "editors";
    return "shell";
}
