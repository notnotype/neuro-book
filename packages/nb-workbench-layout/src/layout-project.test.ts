import {describe, expect, it} from "bun:test";

import {createGrid, createGridGestureSession} from "@notnotype/nb-layout";
import {docOf, H, sizeOf, testPolicy, V} from "./layout-doc-fixtures";
import {projectLayoutDoc, presentationCollapse, regionOfStripLeaf, regionStripLeafId} from "./layout-project";
import {fixedNodesOf, rebaseIntents} from "./intent-writeback";
import type {LayoutProjectionOptions} from "./layout-project";
import type {GridAxis, GridExtent, GridNodeInput} from "@notnotype/nb-layout";
import {moveTabToEdge, setActiveContainer, setPanelCollapsed} from "./layout-doc";
import type {LayoutDoc} from "./layout-doc";

/** 呈现树（docs/specs/ui/workbench-layout.md 输出 5 到 7、10、11、13）。 */

const OPTIONS: LayoutProjectionOptions = {
    constraints: (id, panel) => (panel.role === "editor"
        ? {minimumSize: {width: 220, height: 120}, maximumSize: {width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY}}
        : {minimumSize: {width: id === "sidebar" ? 160 : 160, height: 80}, maximumSize: {width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY}}),
    barThickness: (bar) => (bar === "activitybar" ? 48 : 22),
    headHeight: 32,
    collapseThreshold: 24,
    sashSize: 1,
};

function solve(doc: LayoutDoc, extent: GridExtent = {width: 1000, height: 600}, overrides: Partial<LayoutProjectionOptions> = {}) {
    const projection = projectLayoutDoc(doc, {...OPTIONS, ...overrides});
    const grid = createGrid<string>(projection.input, {sashSize: projection.sashSize});
    return {projection, grid, layout: grid.layout(extent)};
}

const shapeOfInput = (node: GridNodeInput<string>): string => (node.kind === "leaf" ? node.id : `${node.orientation === "horizontal" ? "H" : "V"}[${node.children.map(shapeOfInput).join(",")}]`);

const DEFAULT_TREE = () => V([H(["activitybar", "sidebar", V(["ea", "panel"]), "auxiliarybar"]), "statusbar"]);

describe("谁吸收余量", () => {
    it("和编辑区并排的工具面板保留像素，编辑组吸收余量", () => {
        const doc = docOf(H(["sidebar", "ea", "auxiliarybar"]));
        const {layout} = solve({...doc, tree: {...doc.tree, root: {...doc.tree.root, children: (doc.tree.root as {children: LayoutDoc["tree"]["root"][]}).children.map((child) => ({...child, size: {...child.size, width: child.id === "ea" ? 1 : 300}}))} as LayoutDoc["tree"]["root"]}}, {width: 1602, height: 600});
        expect(layout.sizes.sidebar?.width).toBe(300);
        expect(layout.sizes.auxiliarybar?.width).toBe(300);
        expect(layout.sizes.ea?.width).toBe(1000);
    });

    it("全是工具面板的一列按比例分，不留白（开发者的场景：侧栏里视图 A、视图 B）", () => {
        const {layout} = solve(docOf(H([V(["a", "b"]), "ea"])), {width: 1000, height: 900});
        expect(layout.sizes.a?.height).toBe(layout.sizes.b?.height);
        expect((layout.sizes.a?.height ?? 0) + (layout.sizes.b?.height ?? 0) + 1).toBe(900);
        expect(layout.issues).toEqual([]);
    });

    it("只剩工具面板和条：工具面板占满", () => {
        const {layout} = solve(docOf(H(["activitybar", "a"])), {width: 500, height: 300});
        expect(layout.sizes.activitybar?.width).toBe(48);
        expect(layout.sizes.a?.width).toBe(452);
    });
});

describe("隐藏的面板不进呈现树", () => {
    const named = (hidden: string[]) => Object.fromEntries(hidden.map((id) => [id, {hidden: true}]));

    it.each<[string, ReadonlyArray<string>, string, Array<[string, number]>]>([
        ["首", ["sidebar"], "H[activitybar,ea,auxiliarybar]", [["activitybar", 0], ["ea", 1]]],
        ["尾", ["auxiliarybar"], "H[activitybar,sidebar,ea]", [["activitybar", 0], ["sidebar", 1]]],
        ["相邻两个", ["sidebar", "panel"], "H[activitybar,ea,auxiliarybar]", [["activitybar", 0], ["ea", 1]]],
    ])("隐藏在%s：可见的两块之间恰好一条可拖的缝，挨着条的是 0", (_name, hidden, shape, sashes) => {
        const doc = docOf(H(["activitybar", "sidebar", "panel", "ea", "auxiliarybar"].filter((id) => id !== "panel" || hidden.includes("panel"))), named([...hidden]));
        const {projection} = solve(doc);
        expect(shapeOfInput(projection.input)).toBe(shape);
        const root = projection.input as {id: string; children: GridNodeInput<string>[]};
        for (const [before, size] of sashes) expect(projection.sashSize(root.id, root.children.findIndex((child) => child.id === before))).toBe(size);
    });

    it("隐藏在中间：两边直接相邻，拖那条缝改的是两边", () => {
        const doc = docOf(H(["ea", "panel", "eb"]), named(["panel"]));
        const {projection, grid, layout} = solve(doc);
        expect(shapeOfInput(projection.input)).toBe("H[ea,eb]");
        const before = {ea: layout.sizes.ea?.width ?? 0, eb: layout.sizes.eb?.width ?? 0};
        const result = grid.resizeBranches([{branchId: (projection.input as {id: string}).id, axis: "width" as GridAxis, baseline: before, target: {ea: before.ea + 50, eb: before.eb - 50}}]);
        expect(result.ok).toBe(true);
    });

    it("默认树里面板隐藏：那一列塌陷成编辑组，意图写回列", () => {
        const doc = docOf(DEFAULT_TREE(), named(["panel"]));
        const {projection} = solve(doc);
        expect(shapeOfInput(projection.input)).toBe("V[H[activitybar,sidebar,ea,auxiliarybar],statusbar]");
        expect(projection.collapsedTo.size).toBe(1);
    });

    it("隐藏的条：不进呈现树", () => {
        const doc = {...docOf(DEFAULT_TREE()), hiddenBars: ["activitybar", "statusbar"] as const};
        expect(shapeOfInput(solve(doc).projection.input)).toBe("H[sidebar,V[ea,panel],auxiliarybar]");
    });
});

describe("收起", () => {
    it("纵向分支里收成标题行，横向分支里拖到零；展开尺寸就是意图", () => {
        const doc = docOf(H(["sidebar", V(["ea", "panel"])]), {panel: {collapsed: true}, sidebar: {collapsed: true}});
        const {layout} = solve(doc);
        expect(layout.sizes.panel?.height).toBe(32);
        expect(layout.sizes.sidebar?.width).toBe(0);
        expect(sizeOf(doc.tree.root, "panel").height).toBe(300);
    });

    it("一列全部收成标题行：页面大小不变，标题行排在上面，下面留空，不算问题", () => {
        const doc = docOf(V([H(["activitybar", V(["sidebar", "s2"]), V(["ea", "panel"]), "auxiliarybar"]), "statusbar"]), {sidebar: {collapsed: true}, s2: {collapsed: true}});
        const {layout} = solve(doc, {width: 1440, height: 860});
        expect(layout.sizes.sidebar?.height).toBe(32);
        expect(layout.sizes.s2?.height).toBe(32);
        expect(layout.sizes.auxiliarybar?.height).toBe(838);
        expect(layout.sizes.statusbar?.height).toBe(22);
        expect(layout.issues).toEqual([]);
    });

    it("一排全部拖到零：编辑区的宽度不被这一排压住", () => {
        const doc = docOf(H(["sidebar", V(["ea", H(["panel", "p1"])])]), {panel: {collapsed: true}, p1: {collapsed: true}});
        const {layout} = solve(doc, {width: 1440, height: 860});
        expect((layout.sizes.sidebar?.width ?? 0) + (layout.sizes.ea?.width ?? 0)).toBeGreaterThan(1430);
        expect(layout.issues).toEqual([]);
    });

    it("塌陷之后按真实的父分支算：纵向里的面板塌陷到横向分支，收起就是拖到零", () => {
        const doc = docOf(H(["ea", V(["a", "panel"])]), {panel: {hidden: true}, a: {collapsed: true}});
        const {layout} = solve(doc);
        expect(layout.sizes.a?.width).toBe(0);
    });

    it("编辑组没有收起策略", () => {
        const {projection} = solve(docOf(H(["sidebar", "ea"])));
        const children = (projection.input as {children: GridNodeInput<string>[]}).children;
        expect(children.find((child) => child.id === "ea")?.collapse).toBeUndefined();
        expect(children.find((child) => child.id === "sidebar")?.collapse?.collapsed).toBe(false);
    });
});

describe("意图只从呈现尺寸写回", () => {
    it("手势落账后：权重分配的一列也写成 px；收起再展开回到拖好的尺寸", () => {
        const start = docOf(H([V(["a", "b"], "column"), "ea"]));
        const {projection, grid, layout} = solve(start, {width: 1000, height: 900});
        const base = {a: layout.sizes.a?.height ?? 0, b: layout.sizes.b?.height ?? 0};
        expect(grid.resizeBranches([{branchId: "column", axis: "height", baseline: base, target: {a: base.a + 100, b: base.b - 100}}]).ok).toBe(true);
        const presented = grid.layout({width: 1000, height: 900}).sizes;
        const written = rebaseIntents(start, presented, projection.collapsedTo);
        expect(sizeOf(written.tree.root, "a").height).toBeCloseTo(base.a + 100);

        const collapsed = setPanelCollapsed(written, "a", true);
        if (!collapsed.ok) throw new Error(collapsed.message);
        const whileCollapsed = rebaseIntents(collapsed.doc, solve(collapsed.doc, {width: 1000, height: 900}).layout.sizes);
        expect(sizeOf(whileCollapsed.tree.root, "a").height).toBeCloseTo(base.a + 100);
        const expanded = setPanelCollapsed(whileCollapsed, "a", false);
        if (!expanded.ok) throw new Error(expanded.message);
        expect(solve(expanded.doc, {width: 1000, height: 900}).layout.sizes.a?.height).toBeCloseTo(base.a + 100);
    });

    it("呈现里塌陷掉的分支：尺寸取代表它的节点，之后放到它旁边按真实尺寸分", () => {
        const doc = docOf(H(["s", V(["ea", "panel"], "column"), "c"]), {panel: {hidden: true}});
        const {projection, layout} = solve(doc, {width: 1000, height: 600});
        const written = rebaseIntents(doc, layout.sizes, projection.collapsedTo);
        expect(sizeOf(written.tree.root, "column").width).toBeCloseTo(layout.sizes.ea?.width ?? 0);
        const result = moveTabToEdge(written, {tab: "view:s", target: {kind: "between", branch: "root", before: "column", after: "c"}}, testPolicy());
        if (!result.ok) throw new Error(result.message);
        expect(sizeOf(result.doc.tree.root, "s").width).toBeCloseTo(((layout.sizes.ea?.width ?? 0) + (layout.sizes.c?.width ?? 0)) / 3);
    });

    it("条的厚度不写回", () => {
        const doc = docOf(H(["activitybar", "ea"]));
        const {layout} = solve(doc);
        expect(sizeOf(rebaseIntents(doc, layout.sizes).tree.root, "activitybar")).toEqual(sizeOf(doc.tree.root, "activitybar"));
    });
});

describe("保留像素的节点", () => {
    it("和编辑区并排的工具面板与条是，吸收余量的不是；全是工具面板的一列按比例分，也不是", () => {
        const doc = docOf(V([H(["activitybar", V(["sidebar", "tool"]), V(["ea", "panel"]), "auxiliarybar"]), "statusbar"]));
        const fixed = fixedNodesOf(projectLayoutDoc(doc, OPTIONS).input);
        expect(fixed.has("panel")).toBe(true);
        expect(fixed.has("auxiliarybar")).toBe(true);
        expect(fixed.has("activitybar")).toBe(true);
        expect(fixed.has("ea")).toBe(false);
        expect(fixed.has("sidebar")).toBe(false);
        expect(fixed.has("tool")).toBe(false);
    });
});

describe("放不下时收走", () => {
    const ORDER = ["auxiliarybar", "panel", "sidebar"];
    const doc = (): LayoutDoc => docOf(DEFAULT_TREE());

    it.each<[string, GridExtent, ReadonlyArray<string>, boolean]>([
        ["放得下什么都不收", {width: 1000, height: 600}, [], false],
        ["窄了先收右栏", {width: 500, height: 600}, ["auxiliarybar"], false],
        ["再窄收侧栏；面板和编辑组同列，收它不省宽度，留着", {width: 400, height: 600}, ["auxiliarybar", "sidebar"], false],
        ["矮了收面板；右栏是整高的一列，收它不省高度，留着", {width: 1000, height: 200}, ["panel"], false],
        ["全收走还放不下：压编辑组；面板不占宽度，留着", {width: 200, height: 600}, ["auxiliarybar", "sidebar"], true],
    ])("%s", (_name, extent, removed, squeezed) => {
        const result = presentationCollapse(doc(), extent, {...OPTIONS, order: ORDER});
        expect([...result.removed].sort()).toEqual([...removed].sort());
        expect(result.squeezed).toBe(squeezed);
    });

    it("焦点所在的面板最后收", () => {
        const result = presentationCollapse(doc(), {width: 500, height: 600}, {...OPTIONS, order: ORDER, focused: "auxiliarybar"});
        expect(result.removed.has("auxiliarybar")).toBe(false);
        expect([...result.removed]).toEqual(["sidebar"]);
    });

    it("隐藏的面板不算：不在队列里", () => {
        const hidden = docOf(DEFAULT_TREE(), {auxiliarybar: {hidden: true}});
        expect([...presentationCollapse(hidden, {width: 500, height: 600}, {...OPTIONS, order: ORDER}).removed]).toEqual([]);
    });
});

/** 带容器的区域（docs/specs/ui/workbench-layout.md 输出 11、12、40、42；ADR 0046）。 */
describe("带容器的区域", () => {
    const ANCHORS = {
        sidebar: {tabs: [], active: null, entries: ["A", "B"], activeContainer: "A"},
        panel: {tabs: [], active: null, entries: ["P"], activeContainer: "P"},
        auxiliarybar: {tabs: [], active: null, hidden: true, entries: [], activeContainer: null},
    };
    /** 侧栏的容器 A（当前）有 s1、s2，容器 B 有 s3；底部面板的容器 P 有 p1、p2；右栏没有容器。 */
    const regions = (overrides: Record<string, object> = {}): LayoutDoc => docOf(V([H(["activitybar", V(["sidebar", "s1", "s2", "s3"], "side"), V(["ea", H(["panel", "p1", "p2"], "row")], "center"), "auxiliarybar"], "body"), "statusbar"], "root"), {
        ...ANCHORS,
        s1: {container: "A"},
        s2: {container: "A"},
        s3: {container: "B"},
        p1: {container: "P"},
        p2: {container: "P"},
        ...overrides,
    });
    const EXTENT: GridExtent = {width: 1200, height: 800};
    const okDoc = (result: ReturnType<typeof setActiveContainer>): LayoutDoc => {
        if (!result.ok) throw new Error(result.message);
        return result.doc;
    };
    const childOf = (node: GridNodeInput<string>, id: string): GridNodeInput<string> | undefined => {
        if (node.kind === "leaf") return undefined;
        for (const child of node.children) {
            if (child.id === id) return child;
            const inner = childOf(child, id);
            if (inner !== undefined) return inner;
        }
        return undefined;
    };

    it("锚与不在当前容器里的分节不进呈现树；区域的节点对到锚上；隐藏的空区域按拖到零画，锚这片叶在呈现树里、为零（输出 11）", () => {
        const {projection, layout} = solve(regions(), EXTENT);
        expect(shapeOfInput(projection.input)).toBe("V[H[activitybar,V[s1,s2],V[ea,H[p1,p2]],auxiliarybar],statusbar]");
        expect([...projection.regionAnchors]).toEqual([["side", "sidebar"], ["row", "panel"], ["auxiliarybar", "auxiliarybar"]]);
        expect(layout.sizes.s3).toBeUndefined();
        expect(layout.sizes.sidebar).toBeUndefined();
        expect(layout.sizes.auxiliarybar?.width).toBe(0);
        expect(layout.issues).toEqual([]);
    });

    it("隐藏的区域按拖到零画（输出 11）：那一列在呈现树里、为零，收起策略在区域的节点上、是收起的；记录不变；唯一的分节记录里的收起不算", () => {
        const hidden = regions({sidebar: {...ANCHORS.sidebar, hidden: true}});
        const {projection, layout} = solve(hidden, EXTENT);
        expect(shapeOfInput(projection.input)).toBe("V[H[activitybar,V[s1,s2],V[ea,H[p1,p2]],auxiliarybar],statusbar]");
        expect(projection.regionAnchors.get("side")).toBe("sidebar");
        expect(childOf(projection.input, "side")?.collapse).toMatchObject({collapsed: true, collapsedSize: 0});
        expect([layout.sizes.s1?.width, layout.sizes.s2?.width]).toEqual([0, 0]);
        expect(hidden.panels.sidebar).toMatchObject({hidden: true});
        expect(hidden.panels.sidebar?.collapsed).toBeUndefined();
        // 和拖到零画得一模一样。
        const zero = solve(regions({sidebar: {...ANCHORS.sidebar, collapsed: true}}), EXTENT);
        expect(layout.sizes).toEqual(zero.layout.sizes);

        const lone = solve(regions({sidebar: {...ANCHORS.sidebar, hidden: true}, s1: {container: "A", collapsed: true}, s2: {container: "B"}}), EXTENT);
        expect(childOf(lone.projection.input, "s1")?.collapse).toMatchObject({collapsed: true, collapsedSize: 0});
        expect(lone.projection.regionAnchors.get("s1")).toBe("sidebar");
    });

    it("空区域打开着（ADR 0050）：锚这片叶进呈现树、就是区域的节点；拖到零读锚的记录，右栏是 0 宽，空的底部面板是 0 高（不是标题行高）", () => {
        const EMPTY = {tabs: [], active: null, entries: [], activeContainer: null};
        const opened = solve(regions({auxiliarybar: EMPTY}), EXTENT);
        expect(shapeOfInput(opened.projection.input)).toBe("V[H[activitybar,V[s1,s2],V[ea,H[p1,p2]],auxiliarybar],statusbar]");
        expect(opened.projection.regionAnchors.get("auxiliarybar")).toBe("auxiliarybar");
        expect(opened.layout.sizes.auxiliarybar?.width).toBeGreaterThan(0);
        const zero = solve(regions({auxiliarybar: {...EMPTY, collapsed: true}}), EXTENT);
        expect(zero.layout.sizes.auxiliarybar?.width).toBe(0);

        const bottom = docOf(V([H(["activitybar", V(["sidebar", "s1"], "side"), V(["ea", "panel"], "center"), "auxiliarybar"], "body"), "statusbar"], "root"), {
            ...ANCHORS,
            s1: {container: "A"},
            panel: {...EMPTY, collapsed: true},
        });
        const bottomZero = solve(bottom, EXTENT);
        expect(bottomZero.projection.regionAnchors.get("panel")).toBe("panel");
        expect(bottomZero.layout.sizes.panel?.height).toBe(0);
        expect(bottomZero.layout.issues).toEqual([]);
    });

    it("区域拖到零配在那一列的分支上：整列宽度为 0，编辑区吸收，分节之间的高度照旧；分节自己只收成标题行", () => {
        const open = solve(regions(), EXTENT);
        const zero = solve(regions({sidebar: {...ANCHORS.sidebar, collapsed: true}}), EXTENT);
        expect(zero.layout.sizes.side?.width).toBe(0);
        expect([zero.layout.sizes.s1?.width, zero.layout.sizes.s2?.width]).toEqual([0, 0]);
        expect([zero.layout.sizes.s1?.height, zero.layout.sizes.s2?.height]).toEqual([open.layout.sizes.s1?.height, open.layout.sizes.s2?.height]);
        expect(zero.layout.sizes.ea?.width).toBe((open.layout.sizes.ea?.width ?? 0) + (open.layout.sizes.side?.width ?? 0));
        expect(zero.layout.issues).toEqual([]);

        const side = childOf(open.projection.input, "side");
        expect(side?.collapse).toEqual({collapsed: false, collapsedSize: 0, collapseThreshold: OPTIONS.collapseThreshold, expandThreshold: OPTIONS.collapseThreshold});
        expect(childOf(open.projection.input, "s1")?.collapse).toMatchObject({collapsed: false, collapsedSize: OPTIONS.headHeight});

        const titleRow = solve(regions({s1: {container: "A", collapsed: true}}), EXTENT);
        expect(titleRow.layout.sizes.s1?.height).toBe(OPTIONS.headHeight);
        expect(titleRow.layout.sizes.s1?.width).toBe(open.layout.sizes.s1?.width);
    });

    it("拖那一列与编辑区之间的缝越过阈值：手势报告的是区域节点收起，对到锚上；零宽的呈现尺寸不写回意图", () => {
        const doc = regions();
        const {projection, grid, layout} = solve(doc, EXTENT);
        const base = {activitybar: layout.sizes.activitybar?.width ?? 0, side: layout.sizes.side?.width ?? 0, center: layout.sizes.center?.width ?? 0, auxiliarybar: 0};
        const result = grid.resizeBranches([{branchId: "body", axis: "width", baseline: base, target: {...base, side: 0, center: base.center + base.side}, collapsed: {side: true}}]);
        if (!result.ok) throw new Error(result.message);
        expect(result.collapsed).toEqual({side: true});
        expect(projection.regionAnchors.get("side")).toBe("sidebar");

        const presented = grid.layout(EXTENT).sizes;
        expect([presented.s1?.width, presented.s2?.width]).toEqual([0, 0]);
        const collapsed = okDoc(setPanelCollapsed(doc, projection.regionAnchors.get("side") as string, true));
        const written = rebaseIntents(collapsed, presented, projection.collapsedTo);
        expect(sizeOf(written.tree.root, "side").width).toBe(sizeOf(doc.tree.root, "side").width);
        const expanded = okDoc(setPanelCollapsed(written, "sidebar", false));
        expect(solve(expanded, EXTENT).layout.sizes.side?.width).toBe(base.side);
    });

    it("只显示一个分节时那一列塌陷：区域拖到零配在这片叶上，状态读锚的；这个分节记录里的 `collapsed` 这时不算收起，再有第二个分节显示时重新收成标题行（输出 11）", () => {
        const single = (overrides: Record<string, object> = {}): LayoutDoc => regions({s2: {container: "B"}, ...overrides});
        const open = solve(single(), EXTENT);
        expect(shapeOfInput(open.projection.input)).toBe("V[H[activitybar,s1,V[ea,H[p1,p2]],auxiliarybar],statusbar]");
        expect(open.projection.regionAnchors.get("s1")).toBe("sidebar");
        expect(open.projection.collapsedTo.get("side")).toBe("s1");
        expect(childOf(open.projection.input, "s1")?.collapse).toMatchObject({collapsed: false, collapsedSize: 0});

        const zero = solve(single({sidebar: {...ANCHORS.sidebar, collapsed: true}}), EXTENT);
        expect(zero.layout.sizes.s1?.width).toBe(0);

        // 记录里带着 `collapsed` 的唯一分节：呈现树和没带时一模一样，叶上那份策略还是区域的。
        const own = solve(single({s1: {container: "A", collapsed: true}}), EXTENT);
        expect(own.projection.input).toEqual(open.projection.input);
        expect(own.layout.sizes).toEqual(open.layout.sizes);
        // 把区域拖宽，写回的宽度不丢（收起着的面板是不写回的）。
        const widened = rebaseIntents(single({s1: {container: "A", collapsed: true}}), {...own.layout.sizes, s1: {width: 300, height: own.layout.sizes.s1?.height ?? 0}}, own.projection.collapsedTo);
        expect(solve(widened, EXTENT).layout.sizes.s1?.width).toBe(300);
        // 切到两个分节都显示的状态：s1 的 `collapsed` 重新起作用。
        const both = solve({...widened, panels: {...widened.panels, s2: {...(widened.panels.s2 as LayoutDoc["panels"][string]), container: "A"}}}, EXTENT);
        expect(both.layout.sizes.s1?.height).toBe(OPTIONS.headHeight);
        expect(childOf(both.projection.input, "s1")?.collapse).toMatchObject({collapsed: true, collapsedSize: OPTIONS.headHeight});
    });

    it("底部面板是一排：区域拖到零是高度为 0；分节没有收起策略，它们之间的缝停在最小宽度", () => {
        const open = solve(regions(), EXTENT);
        expect(childOf(open.projection.input, "row")?.collapse).toMatchObject({collapsed: false, collapsedSize: 0});
        expect(childOf(open.projection.input, "p1")?.collapse).toBeUndefined();
        expect(childOf(open.projection.input, "p2")?.collapse).toBeUndefined();

        const zero = solve(regions({panel: {...ANCHORS.panel, collapsed: true}}), EXTENT);
        expect([zero.layout.sizes.p1?.height, zero.layout.sizes.p2?.height]).toEqual([0, 0]);
        expect(zero.layout.sizes.ea?.height).toBe((open.layout.sizes.ea?.height ?? 0) + (open.layout.sizes.row?.height ?? 0));
        expect(zero.layout.issues).toEqual([]);

        // 底部面板的分节不折叠（输出 20）：记录里留着 `collapsed` 也照常呈现。
        const stale = solve(regions({p1: {container: "P", collapsed: true}}), EXTENT);
        expect(stale.projection.input).toEqual(open.projection.input);
        expect(stale.layout.sizes).toEqual(open.layout.sizes);
    });

    it("区域里被拆到另一个方向的分节没有收起策略：侧栏里左右并排的、底部面板里上下叠的，边界都停在最小尺寸；区域拖到零照样整块为 0", () => {
        const doc = (overrides: Record<string, object> = {}): LayoutDoc => docOf(V([H(["activitybar", V(["sidebar", "s1", H(["s2", "s3"], "pair")], "side"), V(["ea", H(["panel", "p1", V(["p2", "p3"], "stack")], "row")], "center")], "body"), "statusbar"], "root"), {
            ...ANCHORS,
            sidebar: {...ANCHORS.sidebar, entries: ["A"]},
            ...Object.fromEntries(["s1", "s2", "s3"].map((id) => [id, {container: "A"}])),
            ...Object.fromEntries(["p1", "p2", "p3"].map((id) => [id, {container: "P"}])),
            ...overrides,
        });
        const open = solve(doc(), EXTENT);
        expect(childOf(open.projection.input, "s1")?.collapse).toMatchObject({collapsedSize: OPTIONS.headHeight});
        for (const id of ["s2", "s3", "pair", "p1", "p2", "p3", "stack"]) expect(childOf(open.projection.input, id)?.collapse).toBeUndefined();

        const zero = solve(doc({sidebar: {...ANCHORS.sidebar, entries: ["A"], collapsed: true}, panel: {...ANCHORS.panel, collapsed: true}}), EXTENT);
        expect(["s1", "s2", "s3"].map((id) => zero.layout.sizes[id]?.width)).toEqual([0, 0, 0]);
        expect(["p1", "p2", "p3"].map((id) => zero.layout.sizes[id]?.height)).toEqual([0, 0, 0]);
        expect(zero.layout.issues).toEqual([]);
    });

    it("切走再切回：两个容器各自的尺寸意图都不变（中间每次呈现都把尺寸写回文档）", () => {
        const settle = (doc: LayoutDoc): LayoutDoc => {
            const {projection, layout} = solve(doc, EXTENT);
            return rebaseIntents(doc, layout.sizes, projection.collapsedTo, fixedNodesOf(projection.input));
        };
        const start = regions();
        const dragged = solve(start, EXTENT);
        const base = {s1: dragged.layout.sizes.s1?.height ?? 0, s2: dragged.layout.sizes.s2?.height ?? 0};
        expect(dragged.grid.resizeBranches([{branchId: "side", axis: "height", baseline: base, target: {s1: base.s1 + 120, s2: base.s2 - 120}}]).ok).toBe(true);
        const inA = rebaseIntents(start, dragged.grid.layout(EXTENT).sizes, dragged.projection.collapsedTo);
        const heights = (doc: LayoutDoc): number[] => ["s1", "s2", "s3"].map((id) => sizeOf(doc.tree.root, id).height);

        const inB = settle(okDoc(setActiveContainer(inA, "sidebar", "B")));
        expect(shapeOfInput(solve(inB, EXTENT).projection.input)).toBe("V[H[activitybar,s3,V[ea,H[p1,p2]],auxiliarybar],statusbar]");
        const back = settle(okDoc(setActiveContainer(inB, "sidebar", "A")));

        heights(back).forEach((height, index) => expect(height).toBeCloseTo(heights(inA)[index] as number));
        expect(sizeOf(back.tree.root, "side").width).toBeCloseTo(sizeOf(inA.tree.root, "side").width);
        const again = solve(back, EXTENT).layout.sizes;
        expect([again.s1?.height, again.s2?.height]).toEqual([base.s1 + 120, base.s2 - 120]);
    });

    it("分节之间的边界上 Enter 收起再 Enter 展开：回到原高，和经 `setPanelCollapsed` 展开的一样（输出 12）", () => {
        // 宿主落账的走法：投影、建 grid、在边界上开键盘会话切换收起、把提交写回 grid、收起状态写到文档、呈现尺寸写回意图。
        const settle = (doc: LayoutDoc): LayoutDoc => {
            const {projection, layout} = solve(doc, EXTENT);
            return rebaseIntents(doc, layout.sizes, projection.collapsedTo, fixedNodesOf(projection.input));
        };
        const enter = (doc: LayoutDoc, branchId: string, index: number): LayoutDoc => {
            const {projection, grid, layout} = solve(doc, EXTENT);
            const session = createGridGestureSession({contextKey: "test", revision: 1, root: grid.root(), extent: EXTENT, layout, sashSize: projection.sashSize, sessionId: "enter", source: "keyboard", sashes: [{branchId, index, axis: "height"}]});
            expect(session.toggleCollapsed()).not.toBeNull();
            const commit = session.finish();
            if (commit === null) throw new Error("Enter 没有产生提交");
            const applied = grid.resizeBranches(commit.changes);
            if (!applied.ok) throw new Error(applied.message);
            let next = doc;
            for (const [id, collapsed] of Object.entries(applied.collapsed)) next = okDoc(setPanelCollapsed(next, projection.regionAnchors.get(id) ?? id, collapsed));
            return rebaseIntents(next, grid.layout(EXTENT).sizes, projection.collapsedTo, fixedNodesOf(projection.input));
        };
        const heights = (doc: LayoutDoc, ids: ReadonlyArray<string>): Array<number | undefined> => ids.map((id) => solve(doc, EXTENT).layout.sizes[id]?.height);

        // 两个分节：锚是那一列里不进呈现的兄弟，分节的意图只记彼此的比例，不是像素。
        const two = settle(regions());
        const before = heights(two, ["s1", "s2"]);
        const closed = enter(two, "side", 0);
        expect(closed.panels.s1?.collapsed).toBe(true);
        expect(heights(closed, ["s1"])).toEqual([OPTIONS.headHeight]);
        const reopened = enter(closed, "side", 0);
        expect(reopened.panels.s1?.collapsed).toBeUndefined();
        expect(heights(reopened, ["s1", "s2"])).toEqual(before);
        expect(heights(okDoc(setPanelCollapsed(closed, "s1", false)), ["s1", "s2"])).toEqual(before);
        // 再来一轮还是原高：意图没有被上一轮带偏。
        expect(heights(enter(enter(reopened, "side", 0), "side", 0), ["s1", "s2"])).toEqual(before);

        // 三个分节、高度不等：展开的那块拿回它的份额，让位的是挨着边界的那块，另一块不动。
        const three = settle(regions({sidebar: {...ANCHORS.sidebar, entries: ["A"]}, s3: {container: "A"}}));
        const uneven = solve(three, EXTENT);
        const base = {s1: uneven.layout.sizes.s1?.height ?? 0, s2: uneven.layout.sizes.s2?.height ?? 0, s3: uneven.layout.sizes.s3?.height ?? 0};
        expect(uneven.grid.resizeBranches([{branchId: "side", axis: "height", baseline: base, target: {...base, s1: base.s1 + 60, s2: base.s2 - 60}}]).ok).toBe(true);
        const start = rebaseIntents(three, uneven.grid.layout(EXTENT).sizes, uneven.projection.collapsedTo, fixedNodesOf(uneven.projection.input));
        const original = heights(start, ["s1", "s2", "s3"]);
        original.forEach((height, index) => expect(height).toBeCloseTo([base.s1 + 60, base.s2 - 60, base.s3][index] as number, 6));
        const round = heights(enter(enter(start, "side", 0), "side", 0), ["s1", "s2", "s3"]);
        round.forEach((height, index) => expect(height).toBeCloseTo(original[index] as number, 6));
    });

    it("放不下时：不在当前容器里的分节与锚不进收走的队列；拖到零的区域不占最小宽度，不引起收走", () => {
        const order = ["sidebar", "s3", "p1", "p2", "s1", "s2"];
        // 底部面板两节并排最少要 321 宽，所以 300 宽时还要收走其中一节。
        const narrow = presentationCollapse(regions(), {width: 300, height: 800}, {...OPTIONS, order});
        expect([...narrow.removed].sort()).toEqual(["p1", "s1", "s2"]);

        // 48 + 160 + 321 加两条缝放不进 400；侧栏拖到零之后放得下。
        expect([...presentationCollapse(regions(), {width: 400, height: 800}, {...OPTIONS, order}).removed].sort()).toEqual(["s1", "s2"]);
        const zero = regions({sidebar: {...ANCHORS.sidebar, collapsed: true}});
        expect(presentationCollapse(zero, {width: 400, height: 800}, {...OPTIONS, order})).toEqual({removed: new Set(), squeezed: false});
    });

    it("拖到零的区域在另一根轴上也不占最小尺寸：窗口矮得放不下它那一列分节时，不收走谁、不报诊断，和隐藏一样", () => {
        const sections = ["s1", "s2", "s3", "s4", "s5", "s6"];
        const tall = (sidebar: object = {}): LayoutDoc => docOf(V([H(["activitybar", V(["sidebar", ...sections], "side"), V(["ea", H(["panel", "p1"], "row")], "center")], "body"), "statusbar"], "root"), {
            sidebar: {tabs: [], active: null, entries: ["A"], activeContainer: "A", ...sidebar},
            ...Object.fromEntries(sections.map((id) => [id, {container: "A"}])),
            panel: {tabs: [], active: null, entries: ["P"], activeContainer: "P"},
            p1: {container: "P"},
        });
        const short: GridExtent = {width: 1000, height: 420};
        const order = ["p1", ...sections];
        // 六节各 80 高加五条缝，420 高的窗口放不下：展开着时要收走。
        expect(presentationCollapse(tall(), short, {...OPTIONS, order}).removed.size).toBeGreaterThan(0);

        const zero = tall({collapsed: true});
        expect(presentationCollapse(zero, short, {...OPTIONS, order})).toEqual(presentationCollapse(tall({hidden: true}), short, {...OPTIONS, order}));
        expect(presentationCollapse(zero, short, {...OPTIONS, order})).toEqual({removed: new Set(), squeezed: false});
        const presented = solve(zero, short);
        expect(presented.layout.issues).toEqual([]);
        expect(presented.layout.sizes.side?.width).toBe(0);
        // 展开回来它照常占最小尺寸。
        expect(presentationCollapse(okDoc(setPanelCollapsed(zero, "sidebar", false)), short, {...OPTIONS, order}).removed.size).toBeGreaterThan(0);
    });

    it("不用容器的文档照旧：没有区域节点；空着显示的具名面板还是一片叶，带自己的收起策略", () => {
        const plain = solve(docOf(V([H(["activitybar", V(["sidebar", "tool"], "side"), V(["ea", "panel"]), "auxiliarybar"]), "statusbar"]), {auxiliarybar: {tabs: [], active: null}, sidebar: {collapsed: true}}));
        expect(plain.projection.regionAnchors.size).toBe(0);
        expect(shapeOfInput(plain.projection.input)).toBe("V[H[activitybar,V[sidebar,tool],V[ea,panel],auxiliarybar],statusbar]");
        expect(childOf(plain.projection.input, "side")?.collapse).toBeUndefined();
        expect(childOf(plain.projection.input, "auxiliarybar")?.collapse).toMatchObject({collapsed: false, collapsedSize: 0});
        expect(plain.layout.sizes.sidebar?.height).toBe(OPTIONS.headHeight);
        expect(plain.layout.sizes.sidebar?.width).toBeGreaterThan(0);
    });

    describe("一列全部收成标题行时最后一节垫底（输出 11）", () => {
        it("最后一节不配收起策略、按比例分、最小高度是面板头，吸收这一列剩下的空间；前面几节照旧收成标题行；有一节展开着照常", () => {
            const all = regions({s1: {container: "A", collapsed: true}, s2: {container: "A", collapsed: true}});
            // 视图声明了最大高度也照样吸收：垫底的那一节是收起的，内容不显示，下面不留空。
            const capped: Partial<LayoutProjectionOptions> = {constraints: (id, panel) => (id === "s2" ? {minimumSize: {width: 160, height: 80}, maximumSize: {width: Number.POSITIVE_INFINITY, height: 300}} : OPTIONS.constraints(id, panel))};
            const {projection, layout} = solve(all, EXTENT, capped);
            expect([...projection.fillers]).toEqual(["s2"]);
            expect(childOf(projection.input, "s1")?.collapse).toMatchObject({collapsed: true, collapsedSize: OPTIONS.headHeight});
            const s2 = childOf(projection.input, "s2");
            expect([s2?.collapse, s2?.sizing, s2?.minimumSize?.height]).toEqual([undefined, "weight", OPTIONS.headHeight]);
            expect(layout.sizes.s1?.height).toBe(OPTIONS.headHeight);
            expect(layout.sizes.s2?.height).toBe((layout.sizes.side?.height ?? 0) - OPTIONS.headHeight - 1);
            expect(layout.issues).toEqual([]);

            const one = solve(regions({s1: {container: "A", collapsed: true}}), EXTENT);
            expect(one.projection.fillers.size).toBe(0);
            expect(childOf(one.projection.input, "s2")?.collapse).toMatchObject({collapsed: false});
        });

        it("垫底的那一节在文档里仍是收起的：意图不写回，写回前后布局一样；展开它就是普通的展开", () => {
            const all = regions({s1: {container: "A", collapsed: true}, s2: {container: "A", collapsed: true}});
            const {projection, layout} = solve(all, EXTENT);
            const written = rebaseIntents(all, layout.sizes, projection.collapsedTo, fixedNodesOf(projection.input));
            expect(sizeOf(written.tree.root, "s2")).toEqual(sizeOf(all.tree.root, "s2"));
            expect(solve(written, EXTENT).layout.sizes).toEqual(layout.sizes);
            const opened = solve(okDoc(setPanelCollapsed(all, "s2", false)), EXTENT);
            expect(opened.projection.fillers.size).toBe(0);
            expect(opened.layout.sizes.s2?.height).toBe(layout.sizes.s2?.height);
        });

        it("按呈现数：放不下收走的那一节不算，剩下的全部收起时最后呈现的那一节垫底；收得只剩一节时不垫底", () => {
            const all = docOf(V([H(["activitybar", V(["sidebar", "s1", "s2", "s3"], "side"), "ea"], "body"), "statusbar"], "root"), {
                sidebar: ANCHORS.sidebar,
                s1: {container: "A", collapsed: true},
                s2: {container: "A", collapsed: true},
                s3: {container: "A", collapsed: true},
            });
            expect([...solve(all, EXTENT, {removed: new Set(["s3"])}).projection.fillers]).toEqual(["s2"]);
            const lone = solve(all, EXTENT, {removed: new Set(["s2", "s3"])});
            expect(lone.projection.fillers.size).toBe(0);
            expect(lone.layout.issues).toEqual([]);
        });

        it("有入口条的区域（包装分支的内层）同样垫底", () => {
            const doc = docOf(V([H(["activitybar", V(["sidebar", "s1"], "side"), "ea", V(["auxiliarybar", "a1", "a2"], "aux")], "body"), "statusbar"], "root"), {
                sidebar: ANCHORS.sidebar,
                s1: {container: "A"},
                auxiliarybar: {tabs: [], active: null, entries: ["X"], activeContainer: "X"},
                a1: {container: "X", collapsed: true},
                a2: {container: "X", collapsed: true},
            });
            const {projection, layout} = solve(doc, EXTENT, {regionStrip: (region) => (region === "sidebar" ? null : {height: 32, mergeSole: true})});
            expect([...projection.fillers]).toEqual(["a2"]);
            expect(layout.sizes.a2?.height).toBe((layout.sizes["aux:sections"]?.height ?? 0) - OPTIONS.headHeight - 1);
            expect(layout.issues).toEqual([]);
        });
    });

    describe("入口条（输出 47）", () => {
        const STRIP: Partial<LayoutProjectionOptions> = {regionStrip: (region) => (region === "sidebar" ? null : {height: 32, mergeSole: true})};
        const strip = (doc: LayoutDoc, overrides: Partial<LayoutProjectionOptions> = {}) => solve(doc, EXTENT, {...STRIP, ...overrides});

        it("区域有分节时包成纵向的 [入口条叶, 内层]，id 仍是区域节点；几节时内层是原来的分支加 `:sections`，都不并；入口条固定 32、和内层之间的缝为 0；空区域、没给入口条的区域不包", () => {
            const {projection, layout} = strip(regions());
            expect(shapeOfInput(projection.input)).toBe("V[H[activitybar,V[s1,s2],V[ea,V[strip:panel,H[p1,p2]]],auxiliarybar],statusbar]");
            expect(childOf(projection.input, "row:sections")?.kind).toBe("branch");
            expect(projection.strips).toEqual([{region: "panel", leaf: "strip:panel", merged: null}]);
            expect(projection.regionAnchors.get("row")).toBe("panel");
            expect(projection.collapsedTo.has("row")).toBe(false);
            expect(projection.sashSize("row", 0)).toBe(0);
            expect(projection.sashSize("row:sections", 0)).toBe(1);
            expect(layout.sizes["strip:panel"]?.height).toBe(32);
            expect(layout.sizes.p1?.height).toBe((layout.sizes.row?.height ?? 0) - 32);
            expect(layout.issues).toEqual([]);
            expect(regionOfStripLeaf("strip:panel")).toBe("panel");
            expect(regionOfStripLeaf(regionStripLeafId("auxiliarybar"))).toBe("auxiliarybar");
            expect(regionOfStripLeaf("strip:editor")).toBeNull();
            expect(regionOfStripLeaf("p1")).toBeNull();
        });

        it("当前容器在文档里只有一节：并进入口条，那一节的最小、最大高度去掉入口条那一行（区域合计同只有一节时），不配收起策略，不登记 `collapsedTo`", () => {
            const doc = regions({p2: {container: "Q"}, panel: {...ANCHORS.panel, entries: ["P", "Q"]}});
            const limited: Partial<LayoutProjectionOptions> = {constraints: (id, panel) => (id === "p1" ? {minimumSize: {width: 160, height: 80}, maximumSize: {width: Number.POSITIVE_INFINITY, height: 300}} : (OPTIONS.constraints(id, panel)))};
            const {projection, layout} = strip(doc, limited);
            expect(shapeOfInput(projection.input)).toBe("V[H[activitybar,V[s1,s2],V[ea,V[strip:panel,p1]],auxiliarybar],statusbar]");
            expect(projection.strips).toEqual([{region: "panel", leaf: "strip:panel", merged: "p1"}]);
            const p1 = childOf(projection.input, "p1");
            expect([p1?.minimumSize?.height, p1?.maximumSize?.height]).toEqual([48, 268]);
            expect(p1?.collapse).toBeUndefined();
            expect(projection.collapsedTo.has("row")).toBe(false);
            expect(layout.issues).toEqual([]);
            // 没有入口条时同一份文档的区域最小、最大高度：包上入口条之后不变。
            const plain = solve(doc, EXTENT, limited);
            const range = (result: ReturnType<typeof solve>) => {
                const squeezed = result.grid.layout({width: EXTENT.width, height: 0});
                const tall = result.grid.layout({width: EXTENT.width, height: 4000});
                return [squeezed.sizes.row?.height ?? squeezed.sizes.p1?.height, tall.sizes.row?.height ?? tall.sizes.p1?.height];
            };
            expect(range(strip(doc, limited))).toEqual(range(plain));
        });

        it("右栏的唯一一节并进来时不收成标题行（区域只显示一节，输出 11）；几节时各节照旧有收起策略；入口条叶保留像素", () => {
            const aux = (sections: Record<string, object>): LayoutDoc => docOf(V([H(["activitybar", V(["sidebar", "s1"], "side"), "ea", V(["auxiliarybar", "a1", "a2"], "aux")], "body"), "statusbar"], "root"), {
                sidebar: ANCHORS.sidebar,
                s1: {container: "A"},
                auxiliarybar: {tabs: [], active: null, entries: ["X", "Y"], activeContainer: "X"},
                ...sections,
            });
            const sole = strip(aux({a1: {container: "X", collapsed: true}, a2: {container: "Y"}}));
            expect(sole.projection.strips).toEqual([{region: "auxiliarybar", leaf: "strip:auxiliarybar", merged: "a1"}]);
            expect(childOf(sole.projection.input, "a1")?.collapse).toBeUndefined();
            expect(childOf(sole.projection.input, "strip:auxiliarybar")?.sizing).toBe("fixed");
            expect(sole.layout.sizes.a1?.height).toBe(EXTENT.height - 22 - 32);
            const both = strip(aux({a1: {container: "X"}, a2: {container: "X"}}));
            expect(both.projection.strips).toEqual([{region: "auxiliarybar", leaf: "strip:auxiliarybar", merged: null}]);
            expect(childOf(both.projection.input, "a1")?.collapse).toMatchObject({collapsed: false, collapsedSize: OPTIONS.headHeight});
        });

        it("隐藏、拖到零时照样包着、并不并不变，入口条跟着整个区域为零；放不下收走一节时按文档数，剩下那一节不并", () => {
            const sole = regions({p2: {container: "Q"}, panel: {...ANCHORS.panel, entries: ["P", "Q"]}});
            for (const anchor of [{hidden: true}, {collapsed: true}]) {
                const {projection, layout} = strip({...sole, panels: {...sole.panels, panel: {...sole.panels.panel!, ...anchor}}});
                expect(projection.strips).toEqual([{region: "panel", leaf: "strip:panel", merged: "p1"}]);
                expect([layout.sizes["strip:panel"]?.height, layout.sizes.p1?.height]).toEqual([0, 0]);
                expect(layout.issues).toEqual([]);
            }
            const removed = strip(regions(), {removed: new Set(["p2"])});
            expect(shapeOfInput(removed.projection.input)).toContain("V[strip:panel,p1]");
            expect(removed.projection.strips).toEqual([{region: "panel", leaf: "strip:panel", merged: null}]);
            expect(childOf(removed.projection.input, "p1")?.minimumSize?.height).toBe(80);
        });

        it("意图只写回文档里的节点：区域的尺寸、各节的比例照旧，入口条叶与 `:sections` 不进文档；区域里有不显示的兄弟分节时也一样", () => {
            for (const doc of [regions(), regions({p3: {container: "Q"}})]) {
                const {projection, layout} = strip(doc);
                const written = rebaseIntents(doc, layout.sizes, projection.collapsedTo, fixedNodesOf(projection.input));
                expect(sizeOf(written.tree.root, "row")).toEqual(sizeOf(doc.tree.root, "row"));
                expect(strip(written).layout.sizes).toEqual(layout.sizes);
            }
        });
    });

});
