/**
 * 面板的约束（docs/specs/ui/workbench-layout.md 输出 6、26）。
 */
import {describe, expect, it} from "bun:test";

import {barRef, GRID_SNAPSHOT_VERSION, layoutDropSectors, panelRef, resolveLayoutDrop, setPanelHidden} from "@notnotype/nb-layout";
import type {LayoutDoc, LayoutEdge, PanelName, PanelRecord} from "@notnotype/nb-layout";

import {defaultLayoutDoc} from "./default-tree";
import {createLayoutPolicy, layoutAccepts, layoutEdgeTarget, panelConstraints, toolPanelAxis} from "./layout-constraints";
import type {ViewCatalog} from "../views/registry";

const VIEW = (over: object = {}) => ({title: {"zh-CN": "甲", "en-US": "A"}, icon: "i", location: "sidebar" as const, layout: "scroll" as const, ...over});

describe("约束", () => {
    it("具名面板与编辑组按表", () => {
        expect(panelConstraints({role: "tool", name: "sidebar", tabs: [], active: null}, new Map(), 1440)).toMatchObject({minimumSize: {width: 160, height: 80}, maximumSize: {width: 560}});
        expect(panelConstraints({role: "tool", name: "auxiliarybar", tabs: [], active: null}, new Map(), 1440).maximumSize.width).toBe(648);
        expect(panelConstraints({role: "tool", name: "auxiliarybar", tabs: [], active: null}, new Map(), 400).maximumSize.width).toBe(360);
        expect(panelConstraints({role: "editor", tabs: [], active: null}, new Map(), 1440).minimumSize).toEqual({width: 220, height: 120});
    });

    it("视图声明的最小最大取所有标签的并：切标签不改布局", () => {
        const catalog: ViewCatalog = new Map([["a", VIEW({minimumSize: {width: 300}})], ["b", VIEW({minimumSize: {height: 200}, maximumSize: {width: 400}})]]);
        const result = panelConstraints({role: "tool", tabs: [{kind: "view", viewId: "a"}, {kind: "view", viewId: "b"}], active: "view:a"}, catalog, 1440);
        expect(result.minimumSize).toEqual({width: 300, height: 200});
        expect(result.maximumSize.width).toBe(400);
    });

    it("最大值不低于最小值", () => {
        const catalog: ViewCatalog = new Map([["a", VIEW({minimumSize: {width: 500}})], ["b", VIEW({maximumSize: {width: 300}})]]);
        expect(panelConstraints({role: "tool", tabs: [{kind: "view", viewId: "a"}, {kind: "view", viewId: "b"}], active: "view:a"}, catalog, 1440).maximumSize.width).toBe(500);
    });

    it("接受矩阵：工具视图只进工具面板，编辑器标签只进编辑组", () => {
        const tool = {role: "tool" as const, tabs: [], active: null};
        const editor = {role: "editor" as const, tabs: [], active: null};
        const view = {kind: "view" as const, viewId: "a"};
        const tab = {kind: "tab" as const, type: "nbook.editor", tabId: "t"};
        expect(layoutAccepts([view], tool)).toBe(true);
        expect(layoutAccepts([view], editor)).toBe(false);
        expect(layoutAccepts([tab], editor)).toBe(true);
        expect(layoutAccepts([tab], tool)).toBe(false);
    });
});

describe("哪条边是落点（输出 25、26）", () => {
    /** 默认树里拆过的：侧栏这一列 `V[sidebar, x]`，编辑区 `H[g0, g1]`，面板这一排 `H[panel, y]`。 */
    function splitDoc(): LayoutDoc {
        const leaf = (id: string) => ({kind: "leaf" as const, id, ref: panelRef(id), size: {width: 100, height: 100}});
        const branch = (id: string, orientation: "horizontal" | "vertical", children: LayoutDoc["tree"]["root"][]) => ({kind: "branch" as const, id, orientation, size: {width: 100, height: 100}, children});
        const tool = (name?: PanelName): PanelRecord => ({role: "tool", ...(name === undefined ? {} : {name}), tabs: [{kind: "view", viewId: name ?? crypto.randomUUID()}], active: null});
        return {
            version: 1,
            floats: [],
            hiddenBars: [],
            currentEditor: "g0",
            tree: {version: GRID_SNAPSHOT_VERSION, root: branch("root", "vertical", [
                branch("body", "horizontal", [
                    {kind: "leaf", id: "activitybar", ref: barRef("activitybar"), size: {width: 48, height: 100}},
                    branch("column", "vertical", [leaf("sidebar"), leaf("x")]),
                    branch("center", "vertical", [branch("area", "horizontal", [leaf("g0"), leaf("g1")]), branch("row", "horizontal", [leaf("panel"), leaf("y")])]),
                    leaf("auxiliarybar"),
                ]),
                {kind: "leaf", id: "statusbar", ref: barRef("statusbar"), size: {width: 100, height: 22}},
            ])},
            panels: {sidebar: tool("sidebar"), x: tool(), auxiliarybar: tool("auxiliarybar"), panel: tool("panel"), y: tool(), g0: {role: "editor", tabs: [], active: null}, g1: {role: "editor", tabs: [], active: null}},
        };
    }

    const target = (doc: LayoutDoc, panel: string, edge: LayoutEdge) => layoutEdgeTarget(doc, [], panel, edge);

    it("侧栏、右栏这一列只有上下两条边，左右两条算中央；无名面板看父分支", () => {
        const doc = splitDoc();
        expect(target(doc, "sidebar", "left")).toBeNull();
        expect(target(doc, "sidebar", "right")).toBeNull();
        expect(target(doc, "sidebar", "top")).toEqual({kind: "split", panel: "sidebar", edge: "top"});
        expect(target(doc, "sidebar", "bottom")).toEqual({kind: "between", branch: "column", before: "sidebar", after: "x"});
        expect(target(doc, "x", "left")).toBeNull();
        expect(target(doc, "x", "top")).toEqual({kind: "between", branch: "column", before: "sidebar", after: "x"});
        expect(target(doc, "auxiliarybar", "left")).toBeNull();
        expect(target(doc, "auxiliarybar", "bottom")).toEqual({kind: "split", panel: "auxiliarybar", edge: "bottom"});
    });

    it("面板这一排只有左右两条边，上下两条算中央", () => {
        const doc = splitDoc();
        expect(target(doc, "panel", "top")).toBeNull();
        expect(target(doc, "panel", "bottom")).toBeNull();
        expect(target(doc, "panel", "left")).toEqual({kind: "split", panel: "panel", edge: "left"});
        expect(target(doc, "panel", "right")).toEqual({kind: "between", branch: "row", before: "panel", after: "y"});
        expect(target(doc, "y", "bottom")).toBeNull();
    });

    it("编辑组四条边都是落点；两块编辑组之间是一个落点", () => {
        const doc = splitDoc();
        expect(target(doc, "g0", "right")).toEqual({kind: "between", branch: "area", before: "g0", after: "g1"});
        expect(target(doc, "g1", "left")).toEqual({kind: "between", branch: "area", before: "g0", after: "g1"});
        expect(target(doc, "g0", "left")).toEqual({kind: "split", panel: "g0", edge: "left"});
        expect(target(doc, "g1", "bottom")).toEqual({kind: "split", panel: "g1", edge: "bottom"});
    });

    it("编辑组挨着面板的那条边是拆这一组，不从面板取空间", () => {
        const doc = defaultLayoutDoc(new Map());
        expect(target(doc, "g0", "bottom")).toEqual({kind: "split", panel: "g0", edge: "bottom"});
        const shown = setPanelHidden(doc, "panel", false);
        if (!shown.ok) throw new Error(shown.detail);
        expect(target(shown.doc, "g0", "bottom")).toEqual({kind: "split", panel: "g0", edge: "bottom"});
    });

    it("工具面板的方向按名字与父分支", () => {
        const doc = splitDoc();
        expect(toolPanelAxis(doc, "sidebar")).toBe("vertical");
        expect(toolPanelAxis(doc, "panel")).toBe("horizontal");
        expect(toolPanelAxis(doc, "x")).toBe("vertical");
        expect(toolPanelAxis(doc, "y")).toBe("horizontal");
    });
});

describe("落点分区与判定一致（docs/specs/ui/workbench-layout.md“落点分区”）：工作台的策略、默认树", () => {
    const inPolygon = (points: ReadonlyArray<readonly [number, number]>, x: number, y: number): boolean => {
        let inside = false;
        for (let at = 0, previous = points.length - 1; at < points.length; previous = at, at += 1) {
            const [xi, yi] = points[at] as readonly [number, number];
            const [xj, yj] = points[previous] as readonly [number, number];
            if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    };
    const CATALOG: ViewCatalog = new Map([["a", VIEW()], ["b", VIEW({location: "auxiliarybar"})], ["c", VIEW({location: "panel"})]]);
    const editorTab = {kind: "tab" as const, type: "nbook.editor", tabId: "t"};

    /** 默认树，编辑组里有两个标签；每块面板一块 200×120 的正文，彼此隔开，指针扫到谁就是谁。 */
    function scene(): {readonly doc: LayoutDoc; readonly panels: ReadonlyArray<{readonly id: string; readonly strip: null; readonly body: {readonly left: number; readonly top: number; readonly right: number; readonly bottom: number}}>} {
        const base = defaultLayoutDoc(CATALOG);
        const editor = Object.entries(base.panels).find(([, panel]) => panel.role === "editor")?.[0] ?? "";
        const doc: LayoutDoc = {...base, panels: {...base.panels, [editor]: {...(base.panels[editor] as PanelRecord), tabs: [editorTab, {...editorTab, tabId: "u"}], active: "tab:t"}}};
        return {doc, panels: Object.keys(doc.panels).map((id, index) => ({id, strip: null, body: {left: index * 1000, top: 0, right: index * 1000 + 200, bottom: 120}}))};
    }

    for (const [name, source, expected] of [
        ["工具视图", {kind: "tab" as const, tab: "view:a"}, {sidebar: ["bottom", "center", "top"], auxiliarybar: ["bottom", "center", "top"], panel: ["center", "left", "right"]}],
        ["编辑器标签", {kind: "tab" as const, tab: "tab:u"}, {g0: ["bottom", "center", "left", "right", "top"]}],
    ] as const) {
        it(`${name}：每块面板的分区符合骨架，整数网格上判定就是点所在那一块`, () => {
            const {doc, panels} = scene();
            const policy = createLayoutPolicy();
            const base = {doc, source, panels, policy};
            const seen: Record<string, ReadonlyArray<string>> = {};
            for (const panel of panels) {
                const sectors = layoutDropSectors({...base, point: {x: 0, y: 0}}, panel);
                if (sectors === null) continue;
                seen[panel.id] = sectors.map((sector) => sector.id).sort();
                for (let y = 0; y < 120; y += 3) {
                    for (let x = 0; x < 200; x += 3) {
                        const [rx, ry] = [(x + 0.5) / 200, (y + 0.5) / 120];
                        // 对角线上两块都对：避开。
                        if (Math.abs(rx - ry) < 0.01 || Math.abs(rx + ry - 1) < 0.01) continue;
                        const owners = sectors.filter((sector) => inPolygon(sector.points, rx, ry));
                        expect(owners).toHaveLength(1);
                        expect(resolveLayoutDrop({...base, point: {x: panel.body.left + x + 0.5, y: y + 0.5}})).toEqual(owners[0]?.action ?? null);
                    }
                }
            }
            expect(seen).toEqual(expected);
        });
    }
});
