/**
 * 面板的约束（docs/specs/ui/workbench-layout.md 输出 6、26）。
 */
import {describe, expect, it} from "bun:test";

import {barRef, findTab, GRID_SNAPSHOT_VERSION, isPanelShown, layoutDropSectors, panelRef, presentationCollapse, previewPanelRects, resolveLayoutDrop, setActiveContainer, setPanelHidden} from "@notnotype/nb-layout";
import type {LayoutDoc, LayoutEdge, PanelName, PanelRecord} from "@notnotype/nb-layout";

import {defaultLayoutDoc} from "./default-tree";
import {collapseOrder, createLayoutPolicy, layoutAccepts, layoutEdgeTarget, layoutProjectionOptions, layoutSeamAccepts, panelConstraints, toolPanelAxis} from "./layout-constraints";
import type {DropSplit} from "./layout-constraints";
import type {ViewCatalog} from "../views/registry";

const VIEW = (over: object = {}) => ({title: {"zh-CN": "甲", "en-US": "A"}, icon: "i", location: "sidebar" as const, layout: "scroll" as const, ...over});
/** 视图所在的面板。 */
const panelOf = (doc: LayoutDoc, viewId: string): string => {
    const found = findTab(doc, `view:${viewId}`);
    if (found === null) throw new Error(`文档里没有 ${viewId}`);
    return found.panel;
};

describe("约束", () => {
    const SECTION: PanelRecord = {role: "tool", tabs: [{kind: "view", viewId: "a"}], active: "view:a", container: "view:a"};

    it("分节用所在区域那一行；不在区域里的工具面板（浮动窗）与编辑组按表", () => {
        expect(panelConstraints(SECTION, "sidebar", new Map(), 1440)).toMatchObject({minimumSize: {width: 160, height: 80}, maximumSize: {width: 560}});
        expect(panelConstraints(SECTION, "auxiliarybar", new Map(), 1440).maximumSize.width).toBe(648);
        expect(panelConstraints(SECTION, "auxiliarybar", new Map(), 400).maximumSize.width).toBe(360);
        expect(panelConstraints(SECTION, "panel", new Map(), 1440)).toMatchObject({minimumSize: {width: 160, height: 80}});
        expect(panelConstraints(SECTION, "panel", new Map(), 1440).maximumSize.width).toBeGreaterThan(100000);
        expect(panelConstraints(SECTION, null, new Map(), 1440)).toMatchObject({minimumSize: {width: 160, height: 80}});
        expect(panelConstraints(SECTION, null, new Map(), 1440).maximumSize.width).toBeGreaterThan(100000);
        expect(panelConstraints({role: "editor", tabs: [], active: null}, null, new Map(), 1440).minimumSize).toEqual({width: 220, height: 120});
    });

    it("视图声明的最小最大取所有标签的并：切标签不改布局", () => {
        const catalog: ViewCatalog = new Map([["a", VIEW({minimumSize: {width: 300}})], ["b", VIEW({minimumSize: {height: 200}, maximumSize: {width: 400}})]]);
        const result = panelConstraints({role: "tool", tabs: [{kind: "view", viewId: "a"}, {kind: "view", viewId: "b"}], active: "view:a"}, null, catalog, 1440);
        expect(result.minimumSize).toEqual({width: 300, height: 200});
        expect(result.maximumSize.width).toBe(400);
    });

    it("最大值不低于最小值", () => {
        const catalog: ViewCatalog = new Map([["a", VIEW({minimumSize: {width: 500}})], ["b", VIEW({maximumSize: {width: 300}})]]);
        expect(panelConstraints({role: "tool", tabs: [{kind: "view", viewId: "a"}, {kind: "view", viewId: "b"}], active: "view:a"}, null, catalog, 1440).maximumSize.width).toBe(500);
    });

    it("区域实际的约束是区域那一行与当前容器里各视图声明的并：别的容器的声明不参与，切换容器只在呈现时夹（输出 6）", () => {
        // 甲、乙同在“项目”容器，丙是侧栏里另一个容器；侧栏的宽度意图是默认的 340。
        const containers = new Map([["acme.project", {title: {"zh-CN": "项目", "en-US": "Project"}, icon: "i", location: "sidebar" as const, order: 0}]]);
        const catalog: ViewCatalog = new Map([
            ["a", VIEW({container: "acme.project", order: 1, minimumSize: {width: 400}})],
            ["b", VIEW({container: "acme.project", order: 2})],
            ["c", VIEW({order: 3, maximumSize: {width: 200}})],
        ]);
        const doc = defaultLayoutDoc(catalog, containers);
        const widths = (of: LayoutDoc): Record<string, number> => {
            const shown = Object.keys(of.panels).filter((id) => isPanelShown(of, id));
            const rects = previewPanelRects(of, shown, layoutProjectionOptions({doc: of, catalog, viewportWidth: 1440}), {width: 1440, height: 900}, 1);
            return Object.fromEntries(Object.entries(rects).map(([id, rect]) => [id, rect.right - rect.left]));
        };
        // 当前容器是“项目”：甲要 400，同一列的乙跟着是 400；丙的上限 200 不参与。
        expect(widths(doc)).toMatchObject({[panelOf(doc, "a")]: 400, [panelOf(doc, "b")]: 400});
        expect(widths(doc)[panelOf(doc, "c")]).toBeUndefined();
        // 切到丙：按丙的上限夹到 200，意图没动，切回来还是 400。
        const switched = setActiveContainer(doc, "sidebar", "view:c");
        if (!switched.ok) throw new Error(switched.detail);
        expect(widths(switched.doc)).toMatchObject({[panelOf(doc, "c")]: 200});
        expect(switched.doc.tree).toEqual(doc.tree);
    });

    it("放不下时收走的先后：右栏、底部面板、侧栏的分节；锚与编辑组不在里面（输出 10）", () => {
        const catalog: ViewCatalog = new Map([["a", VIEW()], ["a2", VIEW({order: 2})], ["b", VIEW({location: "auxiliarybar"})], ["c", VIEW({location: "panel"})]]);
        const doc = defaultLayoutDoc(catalog);
        expect(collapseOrder(doc)).toEqual([panelOf(doc, "b"), panelOf(doc, "c"), panelOf(doc, "a"), panelOf(doc, "a2")]);
        // 窄到只放得下编辑组与一栏：先收右栏的分节，侧栏的留着。
        const narrow = {width: 520, height: 800};
        const {removed} = presentationCollapse(doc, narrow, {...layoutProjectionOptions({doc, catalog, viewportWidth: narrow.width}), order: collapseOrder(doc), focused: null});
        expect(removed.has(panelOf(doc, "b"))).toBe(true);
        expect(removed.has(panelOf(doc, "a"))).toBe(false);
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
    /** 三个区域各有分节：侧栏这一列 `V[sidebar, x, x2]`，编辑区 `H[g0, g1]`，面板这一排 `H[panel, y]`，右栏这一列 `V[auxiliarybar, z]`。具名面板是锚。 */
    function splitDoc(): LayoutDoc {
        const leaf = (id: string) => ({kind: "leaf" as const, id, ref: panelRef(id), size: {width: 100, height: 100}});
        const branch = (id: string, orientation: "horizontal" | "vertical", children: LayoutDoc["tree"]["root"][]) => ({kind: "branch" as const, id, orientation, size: {width: 100, height: 100}, children});
        const anchor = (name: PanelName, container: string): PanelRecord => ({role: "tool", name, tabs: [], active: null, entries: [container], activeContainer: container});
        const section = (id: string, container: string): PanelRecord => ({role: "tool", tabs: [{kind: "view", viewId: id}], active: `view:${id}`, container});
        return {
            version: 1,
            floats: [],
            hiddenBars: [],
            currentEditor: "g0",
            tree: {version: GRID_SNAPSHOT_VERSION, root: branch("root", "vertical", [
                branch("body", "horizontal", [
                    {kind: "leaf", id: "activitybar", ref: barRef("activitybar"), size: {width: 48, height: 100}},
                    branch("column", "vertical", [leaf("sidebar"), leaf("x"), leaf("x2")]),
                    branch("center", "vertical", [branch("area", "horizontal", [leaf("g0"), leaf("g1")]), branch("row", "horizontal", [leaf("panel"), leaf("y")])]),
                    branch("aux", "vertical", [leaf("auxiliarybar"), leaf("z")]),
                ]),
                {kind: "leaf", id: "statusbar", ref: barRef("statusbar"), size: {width: 100, height: 22}},
            ])},
            panels: {
                sidebar: anchor("sidebar", "side"), x: section("x", "side"), x2: section("x2", "side"),
                auxiliarybar: anchor("auxiliarybar", "aux"), z: section("z", "aux"),
                panel: anchor("panel", "row"), y: section("y", "row"),
                g0: {role: "editor", tabs: [], active: null}, g1: {role: "editor", tabs: [], active: null},
            },
        };
    }

    const target = (doc: LayoutDoc, panel: string, edge: LayoutEdge) => layoutEdgeTarget(doc, [], panel, edge);

    it("侧栏、右栏的分节只有上下两条边，左右两条算中央", () => {
        const doc = splitDoc();
        expect(target(doc, "x", "left")).toBeNull();
        expect(target(doc, "x", "right")).toBeNull();
        expect(target(doc, "x", "top")).toEqual({kind: "split", panel: "x", edge: "top"});
        expect(target(doc, "x", "bottom")).toEqual({kind: "split", panel: "x", edge: "bottom"});
        expect(target(doc, "z", "left")).toBeNull();
        expect(target(doc, "z", "bottom")).toEqual({kind: "split", panel: "z", edge: "bottom"});
    });

    it("底部面板的分节只有左右两条边，上下两条算中央", () => {
        const doc = splitDoc();
        expect(target(doc, "y", "top")).toBeNull();
        expect(target(doc, "y", "bottom")).toBeNull();
        expect(target(doc, "y", "left")).toEqual({kind: "split", panel: "y", edge: "left"});
        expect(target(doc, "y", "right")).toEqual({kind: "split", panel: "y", edge: "right"});
    });

    it("编辑组四条边都是落点，默认只分本窗口；设置改成一起分时是 `spread`，改设置不用重建策略", () => {
        const doc = splitDoc();
        expect(target(doc, "g0", "right")).toEqual({kind: "split", panel: "g0", edge: "right"});
        expect(target(doc, "g1", "bottom")).toEqual({kind: "split", panel: "g1", edge: "bottom"});
        let split: DropSplit = "half";
        const policy = createLayoutPolicy({dropSplit: () => split});
        expect(policy.edgeTarget?.(doc, [], "g0", "right")).toEqual({kind: "split", panel: "g0", edge: "right"});
        split = "shared";
        expect(policy.edgeTarget?.(doc, [], "g0", "right")).toEqual({kind: "spread", panel: "g0", edge: "right"});
        expect(policy.edgeTarget?.(doc, [], "x", "left")).toBeNull();
    });

    it("只有两边同类的缝是落点：骨架上的缝插不进东西", () => {
        const doc = splitDoc();
        expect(layoutSeamAccepts(doc, [], "g0", "g1")).toBe(true);
        expect(layoutSeamAccepts(doc, [], "x", "x2")).toBe(true);
        expect(layoutSeamAccepts(doc, [], "column", "center")).toBe(false);
        expect(layoutSeamAccepts(doc, [], "center", "aux")).toBe(false);
        expect(layoutSeamAccepts(doc, [], "area", "row")).toBe(false);
    });

    it("编辑组挨着面板的那条边是拆这一组，不从面板取空间", () => {
        const doc = defaultLayoutDoc(new Map());
        expect(target(doc, "g0", "bottom")).toEqual({kind: "split", panel: "g0", edge: "bottom"});
        const shown = setPanelHidden(doc, "panel", false);
        if (!shown.ok) throw new Error(shown.detail);
        expect(target(shown.doc, "g0", "bottom")).toEqual({kind: "split", panel: "g0", edge: "bottom"});
    });

    it("工具面板的方向按所在的区域：侧栏、右栏上下分，底部面板左右分；区域里只剩一个分节时也一样", () => {
        const doc = splitDoc();
        expect(toolPanelAxis(doc, "x")).toBe("vertical");
        expect(toolPanelAxis(doc, "z")).toBe("vertical");
        expect(toolPanelAxis(doc, "y")).toBe("horizontal");
        const single = defaultLayoutDoc(new Map([["a", VIEW()], ["c", VIEW({location: "panel"})]]));
        expect(toolPanelAxis(single, panelOf(single, "a"))).toBe("vertical");
        expect(toolPanelAxis(single, panelOf(single, "c"))).toBe("horizontal");
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

    /** 默认树，编辑组里有两个标签；每块显示着的面板（锚不画）一块 200×120 的正文，彼此隔开，指针扫到谁就是谁。 */
    function scene(): {readonly doc: LayoutDoc; readonly panels: ReadonlyArray<{readonly id: string; readonly strip: null; readonly body: {readonly left: number; readonly top: number; readonly right: number; readonly bottom: number}}>} {
        const base = defaultLayoutDoc(CATALOG);
        const editor = Object.entries(base.panels).find(([, panel]) => panel.role === "editor")?.[0] ?? "";
        const doc: LayoutDoc = {...base, panels: {...base.panels, [editor]: {...(base.panels[editor] as PanelRecord), tabs: [editorTab, {...editorTab, tabId: "u"}], active: "tab:t"}}};
        return {doc, panels: Object.keys(doc.panels).filter((id) => isPanelShown(doc, id)).map((id, index) => ({id, strip: null, body: {left: index * 1000, top: 0, right: index * 1000 + 200, bottom: 120}}))};
    }
    /** 期望按视图写：分节写它装的视图，编辑组写面板 id。 */
    const labelOf = (doc: LayoutDoc, id: string): string => {
        const tab = doc.panels[id]?.tabs[0];
        return tab?.kind === "view" ? tab.viewId : id;
    };

    for (const [name, source, expected] of [
        ["工具视图", {kind: "tab" as const, tab: "view:a"}, {a: ["bottom", "top"], b: ["bottom", "top"], c: ["left", "right"]}],
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
                seen[labelOf(doc, panel.id)] = sectors.map((sector) => sector.id).sort();
                for (let y = 0; y < 120; y += 3) {
                    for (let x = 0; x < 200; x += 3) {
                        const [rx, ry] = [(x + 0.5) / 200, (y + 0.5) / 120];
                        // 对角线上两块都对：避开。
                        if (Math.abs(rx - ry) < 0.01 || Math.abs(rx + ry - 1) < 0.01) continue;
                        // 不分的那两条边的窄带没有分区，那里也没有落点。
                        const owners = sectors.filter((sector) => inPolygon(sector.points, rx, ry));
                        expect(owners.length).toBeLessThanOrEqual(1);
                        expect(resolveLayoutDrop({...base, point: {x: panel.body.left + x + 0.5, y: y + 0.5}})).toEqual(owners[0]?.action ?? null);
                    }
                }
            }
            expect(seen).toEqual(expected);
        });
    }

    it("分节沿区域的方向分前后两半，靠另外两条边也按两半算，哪里都不是并入（输出 25，验收 10）；编辑组四条边都分（开发者 2026-11-09 定）", () => {
        const {doc, panels} = scene();
        const base = {doc, panels, policy: createLayoutPolicy()};
        const at = (viewOrPanel: string, rx: number, ry: number) => {
            const id = findTab(doc, `view:${viewOrPanel}`)?.panel ?? viewOrPanel;
            const body = panels.find((panel) => panel.id === id)?.body;
            if (body === undefined) throw new Error(`没有 ${id}`);
            return {x: body.left + (body.right - body.left) * rx, y: body.top + (body.bottom - body.top) * ry};
        };
        const view = {kind: "tab" as const, tab: "view:a"};
        const edgeOf = (point: {readonly x: number; readonly y: number}) => {
            const action = resolveLayoutDrop({...base, source: view, point});
            return action?.kind === "edge" && action.target.kind !== "between" ? action.target.edge : action?.kind;
        };
        expect([edgeOf(at("b", 0.05, 0.3)), edgeOf(at("b", 0.95, 0.3)), edgeOf(at("b", 0.5, 0.3))]).toEqual(["top", "top", "top"]);
        expect([edgeOf(at("b", 0.05, 0.7)), edgeOf(at("b", 0.95, 0.7)), edgeOf(at("b", 0.5, 0.7))]).toEqual(["bottom", "bottom", "bottom"]);
        expect([edgeOf(at("c", 0.3, 0.05)), edgeOf(at("c", 0.7, 0.05))]).toEqual(["left", "right"]);
        expect(resolveLayoutDrop({...base, source: {kind: "tab", tab: "tab:u"}, point: at("g0", 0.05, 0.5)})?.kind).toBe("edge");
    });
});
