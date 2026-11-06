/**
 * 按邻接算卡片的边（docs/specs/ui/workbench-layout.md 输出 19）：用真实的文档与呈现树。
 */
import {describe, expect, it} from "bun:test";

import {createGrid, movePanelToEdge, projectLayoutDoc} from "@notnotype/nb-layout";
import type {GridExtent, GridNodeInput, LayoutDoc} from "@notnotype/nb-layout";

import {defaultLayoutDoc, INITIAL_EDITOR_PANEL} from "../state/default-tree";
import {createLayoutPolicy, layoutProjectionOptions} from "../state/layout-constraints";
import type {ViewCatalog} from "../views/placement";
import {cardInset, layoutCardEdges} from "./adjacency";
import type {CardSide} from "./adjacency";

const VIEW = (location: "sidebar" | "auxiliarybar" | "panel") => ({title: {"zh-CN": location, "en-US": location}, icon: "i", location, layout: "scroll" as const});
const CATALOG: ViewCatalog = new Map([["side", VIEW("sidebar")], ["aux", VIEW("auxiliarybar")], ["out", VIEW("panel")]]);
const EXTENT: GridExtent = {width: 1440, height: 900};

function cards(doc: LayoutDoc, sizesOverride: Readonly<Record<string, GridExtent>> = {}) {
    const {input, sashSize} = projectLayoutDoc(doc, layoutProjectionOptions({catalog: CATALOG, viewportWidth: EXTENT.width}));
    const layout = createGrid<string>(input, {sashSize}).layout(EXTENT);
    return layoutCardEdges({
        root: input as GridNodeInput<string>,
        sizes: {...layout.sizes, ...sizesOverride},
        sashSizes: layout.sashSizes,
        activitybar: "activitybar",
        plain: new Set(["statusbar"]),
        isTool: (id) => doc.panels[id]?.role === "tool",
    });
}

const outer: CardSide = {kind: "outer", occupied: 0};
const joined: CardSide = {kind: "joined"};
const inner = (occupied: number): CardSide => ({kind: "inner", occupied});
const doc = (): LayoutDoc => defaultLayoutDoc(CATALOG);
const hide = (source: LayoutDoc, id: string): LayoutDoc => ({...source, panels: {...source.panels, [id]: {...source.panels[id] as LayoutDoc["panels"][string], hidden: true}}});

describe("卡片的边", () => {
    it("默认树：活动栏与侧栏相连，其余按挨着的留半缝，贴窗体、状态栏留整缝", () => {
        const result = cards(doc());
        expect(result.activitybar).toEqual({top: outer, right: joined, bottom: outer, left: outer});
        expect(result.sidebar).toEqual({top: outer, right: inner(1), bottom: outer, left: joined});
        expect(result[INITIAL_EDITOR_PANEL]).toEqual({top: outer, right: inner(1), bottom: inner(1), left: inner(1)});
        expect(result.panel).toEqual({top: inner(1), right: inner(1), bottom: outer, left: inner(1)});
        expect(result.auxiliarybar).toEqual({top: outer, right: outer, bottom: outer, left: inner(1)});
        expect(result.statusbar).toBeUndefined();
    });

    it("侧栏隐藏：活动栏不和编辑组相连，缝是 0", () => {
        const result = cards(hide(doc(), "sidebar"));
        expect(result.activitybar?.right).toEqual(inner(0));
        expect(result[INITIAL_EDITOR_PANEL]?.left).toEqual(inner(0));
    });

    it("侧栏拆成一列：不等长，不相连", () => {
        const start = doc();
        const moved = movePanelToEdge(start, {panel: "panel", target: {kind: "split", panel: "sidebar", edge: "bottom"}}, createLayoutPolicy());
        if (!moved.ok) throw new Error(moved.detail);
        const result = cards(moved.doc);
        expect(result.activitybar?.right).toEqual(inner(0));
        expect(result.sidebar?.left).toEqual(inner(0));
        expect(result.sidebar?.bottom).toEqual(inner(1));
    });

    it("相连跟着拖动中的几何：拖到零时不相连，缝算进占用", () => {
        const result = cards(doc(), {sidebar: {width: 0, height: 878}});
        expect(result.activitybar?.right.kind).toBe("inner");
        expect(result[INITIAL_EDITOR_PANEL]?.left).toEqual({kind: "inner", occupied: 1});
    });

    it("面板移到别处之后仍成立：跟固定拓扑没有关系", () => {
        const start = doc();
        const moved = movePanelToEdge(start, {panel: "auxiliarybar", target: {kind: "between", branch: "body", before: "sidebar", after: "center"}}, createLayoutPolicy());
        if (!moved.ok) throw new Error(moved.detail);
        const result = cards(moved.doc);
        expect(result.auxiliarybar).toEqual({top: outer, right: inner(1), bottom: outer, left: inner(1)});
        expect(result[INITIAL_EDITOR_PANEL]?.right).toEqual(outer);
    });

    it("一边留多宽：贴边整缝，相邻半缝减占用的一半，相连 0", () => {
        expect(cardInset(outer)).toBe("var(--shell-gap, 0px)");
        expect(cardInset({kind: "outer", occupied: 1})).toBe("max(0px, calc(var(--shell-gap, 0px) - 1px))");
        expect(cardInset(inner(2))).toBe("max(0px, calc(var(--shell-gap, 0px) / 2 - 1px))");
        expect(cardInset(joined)).toBe("0px");
    });
});
