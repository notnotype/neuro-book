/**
 * 按邻接算卡片的边（docs/specs/ui/workbench-layout.md 输出 19）：用真实的文档与呈现树。
 */
import {describe, expect, it} from "bun:test";

import {createGrid} from "@notnotype/nb-layout";
import {movePanelToEdge, projectLayoutDoc, railLeafId, regionNodeOf, regionOf, regionOfStripLeaf, regionStripLeafId} from "@notnotype/nb-workbench-layout";
import type {GridExtent, GridNodeInput} from "@notnotype/nb-layout";
import type {LayoutDoc} from "@notnotype/nb-workbench-layout";

import {viewSection} from "../state/containers";
import {defaultLayoutDoc, INITIAL_EDITOR_PANEL} from "../state/default-tree";
import {createLayoutPolicy, layoutProjectionOptions} from "../state/layout-constraints";
import type {ViewCatalog} from "../views/registry";
import {cardInset, cardInsetPx, joinedToBar, layoutCardEdges, maximizedCardEdges, sashKindOf} from "./adjacency";
import type {CardBar, CardSide} from "./adjacency";

const VIEW = (location: "sidebar" | "auxiliarybar" | "panel") => ({title: {"zh-CN": location, "en-US": location}, icon: "i", location, layout: "scroll" as const});
const CATALOG: ViewCatalog = new Map([["side", VIEW("sidebar")], ["aux", VIEW("auxiliarybar")], ["out", VIEW("panel")]]);
const EXTENT: GridExtent = {width: 1440, height: 900};

const ACTIVITY_BAR: CardBar = {leaf: "activitybar", group: "sidebar", side: "start"};
const RAIL: CardBar = {leaf: railLeafId("auxiliarybar"), group: "auxiliarybar", side: "end"};

/** `rail`：呈现里有右轨（输出 50），和外壳一样把它列进侧轨。 */
function cards(doc: LayoutDoc, sizesOverride: Readonly<Record<string, GridExtent>> = {}, rail = false) {
    const options = layoutProjectionOptions({doc, catalog: CATALOG, viewportWidth: EXTENT.width});
    const {input, sashSize} = projectLayoutDoc(doc, rail ? {...options, rail: () => 48} : options);
    const layout = createGrid<string>(input, {sashSize}).layout(EXTENT);
    return layoutCardEdges({
        root: input as GridNodeInput<string>,
        sizes: {...layout.sizes, ...sizesOverride},
        sashSizes: layout.sashSizes,
        bars: rail ? [ACTIVITY_BAR, RAIL] : [ACTIVITY_BAR],
        plain: new Set(["statusbar"]),
        groupOf: (id) => regionOfStripLeaf(id) ?? regionOf(doc, id),
    });
}

const outer: CardSide = {kind: "outer", occupied: 0};
const joined: CardSide = {kind: "joined"};
const barJoined: CardSide = {kind: "joined", bar: true};
const inner = (occupied: number): CardSide => ({kind: "inner", occupied});
const doc = (): LayoutDoc => defaultLayoutDoc(CATALOG);
/** 视图所在的分节：区域里画出来的卡片是分节，锚不进呈现树。 */
function sectionOf(source: LayoutDoc, viewId: string): string {
    const section = viewSection(source, viewId);
    if (section === null) throw new Error(`${viewId} 不在区域里`);
    return section.panel;
}
const [SIDE, AUX, OUT] = [sectionOf(doc(), "side"), sectionOf(doc(), "aux"), sectionOf(doc(), "out")];
const hide = (source: LayoutDoc, id: string): LayoutDoc => ({...source, panels: {...source.panels, [id]: {...source.panels[id] as LayoutDoc["panels"][string], hidden: true}}});

describe("卡片的边", () => {
    it("默认树：活动栏与侧栏相连，其余按挨着的留半缝，贴窗体、状态栏留整缝", () => {
        const result = cards(doc());
        expect(result.activitybar).toEqual({top: outer, right: barJoined, bottom: outer, left: outer});
        expect(result[SIDE]).toEqual({top: outer, right: inner(1), bottom: outer, left: barJoined});
        expect(result[INITIAL_EDITOR_PANEL]).toEqual({top: outer, right: inner(1), bottom: inner(1), left: inner(1)});
        // 右栏、底部面板顶上是入口条（输出 47），和下面的分节拼成一张卡片：入口条叶占卡片的上边，分节的上边相连。
        expect(result[regionStripLeafId("panel")]).toEqual({top: inner(1), right: inner(1), bottom: joined, left: inner(1)});
        expect(result[OUT]).toEqual({top: joined, right: inner(1), bottom: outer, left: inner(1)});
        expect(result[regionStripLeafId("auxiliarybar")]).toEqual({top: outer, right: outer, bottom: joined, left: inner(1)});
        expect(result[AUX]).toEqual({top: joined, right: outer, bottom: outer, left: inner(1)});
        // 锚不画卡片。
        expect(result.sidebar).toBeUndefined();
        expect(result.statusbar).toBeUndefined();
    });

    it("右轨（输出 50）：和它左边右栏的每一块相连（右栏的右边、右轨的左边），右轨自己的右边贴窗体；活动栏照旧", () => {
        const result = cards(doc(), {}, true);
        expect(result[RAIL.leaf]).toEqual({top: outer, right: outer, bottom: outer, left: barJoined});
        expect(result[AUX]?.right).toEqual(barJoined);
        expect(result[regionStripLeafId("auxiliarybar")]?.right).toEqual(barJoined);
        expect(result.activitybar?.right).toEqual(barJoined);
    });

    it("右栏隐藏、拖到零：右轨不和任何卡片相连，自己一张卡片", () => {
        const result = cards(hide(doc(), "auxiliarybar"), {}, true);
        expect(result[RAIL.leaf]?.left.kind).toBe("inner");
        expect(result[INITIAL_EDITOR_PANEL]?.right.kind).toBe("inner");
    });

    it("侧栏隐藏：同拖到零（输出 11），活动栏不和编辑组相连，留着的 1px 边界算进占用", () => {
        const result = cards(hide(doc(), "sidebar"));
        expect(result.activitybar?.right).toEqual(inner(1));
        expect(result[INITIAL_EDITOR_PANEL]?.left).toEqual(inner(1));
    });

    it("侧栏一列几节：一个容器一张卡片，两节之间相连，整列和活动栏相连", () => {
        const start = doc();
        const moved = movePanelToEdge(start, {panel: OUT, target: {kind: "split", panel: SIDE, edge: "bottom"}}, createLayoutPolicy());
        if (!moved.ok) throw new Error(moved.message);
        const result = cards(moved.doc);
        expect(result.activitybar?.right).toEqual(barJoined);
        expect(result[SIDE]).toEqual({top: outer, right: inner(1), bottom: joined, left: barJoined});
        expect(result[OUT]).toEqual({top: joined, right: inner(1), bottom: outer, left: barJoined});
    });

    it("底部面板两节左右并排：两节之间相连，但不是和活动栏相连（“角接过去”只认活动栏，输出 19）", () => {
        const moved = movePanelToEdge(doc(), {panel: AUX, target: {kind: "split", panel: OUT, edge: "right"}}, createLayoutPolicy());
        if (!moved.ok) throw new Error(moved.message);
        const result = cards(moved.doc);
        expect(result[OUT]?.right).toEqual(joined);
        expect(result[AUX]?.left).toEqual(joined);
        expect(joinedToBar(result[AUX]?.left)).toBe(false);
        expect(joinedToBar(result[SIDE]?.left)).toBe(true);
    });

    it("不同区域的卡片挨着照旧留缝：底部面板与右栏、编辑组与侧栏", () => {
        const result = cards(doc());
        expect(result[OUT]?.right).toEqual(inner(1));
        expect(result[AUX]?.left).toEqual(inner(1));
        expect(result[INITIAL_EDITOR_PANEL]?.left).toEqual(inner(1));
    });

    it("相连跟着拖动中的几何：拖到零时不相连，缝算进占用", () => {
        const result = cards(doc(), {[SIDE]: {width: 0, height: 878}});
        expect(result.activitybar?.right.kind).toBe("inner");
        expect(result[INITIAL_EDITOR_PANEL]?.left).toEqual({kind: "inner", occupied: 1});
    });

    it("面板移到别处之后仍成立：跟固定拓扑没有关系", () => {
        const start = doc();
        const sidebar = regionNodeOf(start, "sidebar")?.node.id ?? "";
        const moved = movePanelToEdge(start, {panel: AUX, target: {kind: "between", branch: "body", before: sidebar, after: "center"}}, createLayoutPolicy());
        if (!moved.ok) throw new Error(moved.message);
        const result = cards(moved.doc);
        expect(result[AUX]).toEqual({top: outer, right: inner(1), bottom: outer, left: inner(1)});
        // 右栏搬空了、自动隐藏，按拖到零画：编辑组右边贴着窗体，中间夹着它留着的 1px 边界。
        expect(result[INITIAL_EDITOR_PANEL]?.right).toEqual({kind: "outer", occupied: 1});
    });

    it("一边留多宽：贴边整缝，相邻半缝减占用的一半，相连 0", () => {
        expect(cardInset(outer)).toBe("var(--shell-gap, 0px)");
        expect(cardInset({kind: "outer", occupied: 1})).toBe("max(0px, calc(var(--shell-gap, 0px) - 1px))");
        expect(cardInset(inner(2))).toBe("max(0px, calc(var(--shell-gap, 0px) / 2 - 1px))");
        expect(cardInset(joined)).toBe("0px");
        // 按读到的缝宽算成数（交换的裁切窗），和上面的式子同一个规则；占用比缝还宽时不小于 0。
        expect([outer, {kind: "outer", occupied: 1} as const, inner(2), joined, inner(10)].map((side) => cardInsetPx(side, 4))).toEqual([4, 3, 1, 0, 0]);
    });
});

describe("最大化时的边", () => {
    it("盖住的面板贴着窗体，左边挨着活动栏；活动栏不再和底下的侧栏相连", () => {
        const cards = {
            activitybar: {top: {kind: "outer", occupied: 0}, right: {kind: "joined"}, bottom: {kind: "outer", occupied: 0}, left: {kind: "outer", occupied: 0}},
            sidebar: {top: {kind: "outer", occupied: 0}, right: {kind: "inner", occupied: 1}, bottom: {kind: "outer", occupied: 0}, left: {kind: "joined"}},
            panel: {top: {kind: "inner", occupied: 1}, right: {kind: "inner", occupied: 1}, bottom: {kind: "outer", occupied: 0}, left: {kind: "inner", occupied: 1}},
        } as const;
        const next = maximizedCardEdges(cards, "panel", [ACTIVITY_BAR, RAIL]);
        expect(next.panel).toEqual({top: {kind: "outer", occupied: 0}, right: {kind: "outer", occupied: 0}, bottom: {kind: "outer", occupied: 0}, left: {kind: "inner", occupied: 0}});
        expect(next.activitybar?.right).toEqual({kind: "inner", occupied: 0});
        expect(next.sidebar).toEqual(cards.sidebar);
    });

    it("活动栏隐藏时四边都贴窗体", () => {
        const side = {kind: "inner", occupied: 1} as const;
        const next = maximizedCardEdges({panel: {top: side, right: side, bottom: side, left: side}}, "panel", [ACTIVITY_BAR, RAIL]);
        expect(next.panel?.left).toEqual({kind: "outer", occupied: 0});
    });

    it("有右轨时盖住的面板右边挨着右轨，右轨不再和底下的右栏相连（输出 50：最大化不盖侧轨）", () => {
        const outerSide = {kind: "outer", occupied: 0} as const;
        const cards = {
            [RAIL.leaf]: {top: outerSide, right: outerSide, bottom: outerSide, left: {kind: "joined", bar: true}},
            panel: {top: {kind: "inner", occupied: 1}, right: {kind: "inner", occupied: 1}, bottom: outerSide, left: {kind: "inner", occupied: 1}},
        } as const;
        const next = maximizedCardEdges(cards, "panel", [ACTIVITY_BAR, RAIL]);
        expect(next.panel).toEqual({top: outerSide, right: {kind: "inner", occupied: 0}, bottom: outerSide, left: outerSide});
        expect(next[RAIL.leaf]?.left).toEqual({kind: "inner", occupied: 0});
    });
});

describe("分隔线的种类", () => {
    const leaf = (id: string): GridNodeInput<string> => ({kind: "leaf", id, ref: id});
    const roles: Record<string, "tool" | "editor"> = {a: "tool", b: "tool", e1: "editor", e2: "editor"};
    const roleOf = (id: string): "tool" | "editor" | null => roles[id] ?? null;
    const groups: Record<string, string> = {a: "panel", b: "panel", c: "auxiliarybar"};
    const groupOf = (id: string): string | null => groups[id] ?? null;

    it("同一张卡片里的两节、编辑组之间，或别的", () => {
        const branch = {kind: "branch" as const, id: "h", orientation: "horizontal" as const, children: [leaf("a"), leaf("b"), leaf("c"), leaf("e1"), leaf("e2")]};
        expect(sashKindOf(branch, "a", "b", roleOf, groupOf)).toBe("panes");
        // 两个区域的工具面板挨着：两张卡片，不是卡片里的线。
        expect(sashKindOf(branch, "b", "c", roleOf, groupOf)).toBe("shell");
        expect(sashKindOf(branch, "c", "e1", roleOf, groupOf)).toBe("shell");
        expect(sashKindOf(branch, "e1", "e2", roleOf, groupOf)).toBe("editors");
    });

    it("一边是分支时看它里面的全部叶", () => {
        const column = {kind: "branch" as const, id: "v", orientation: "vertical" as const, children: [leaf("e1"), leaf("a")]};
        const branch = {kind: "branch" as const, id: "h", orientation: "horizontal" as const, children: [column, leaf("e2")]};
        expect(sashKindOf(branch, "v", "e2", roleOf, groupOf)).toBe("shell");
        const pair = {kind: "branch" as const, id: "v2", orientation: "vertical" as const, children: [leaf("a"), leaf("b")]};
        expect(sashKindOf({kind: "branch" as const, id: "h2", orientation: "horizontal" as const, children: [pair, leaf("b")]}, "v2", "b", roleOf, groupOf)).toBe("panes");
    });
});
