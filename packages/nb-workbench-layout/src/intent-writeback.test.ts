import {describe, expect, it} from "bun:test";

import {createGrid, createGridGestureSession} from "@notnotype/nb-layout";
import type {GridExtent} from "@notnotype/nb-layout";
import {docOf, H, V} from "./layout-doc-fixtures";
import {applyGestureCommit, rebaseForOperation} from "./intent-writeback";
import type {LayoutDoc} from "./layout-doc";
import {projectLayoutDoc} from "./layout-project";
import type {LayoutProjectionOptions} from "./layout-project";

/**
 * 意图回写的两个入口（docs/specs/ui/workbench-layout.md 输出 8、49）。呈现树、网格、手势都用真的：文档经 `projectLayoutDoc` 投影，
 * 网格落账手势，再把落账前后的布局交给入口，看写回的文档放宽后长什么样。
 */

const OPTIONS: LayoutProjectionOptions = {
    constraints: (_id, panel) => ({
        minimumSize: panel.role === "editor" ? {width: 160, height: 120} : {width: 120, height: 80},
        maximumSize: {width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY},
    }),
    barThickness: (bar) => (bar === "activitybar" ? 48 : 22),
    headHeight: 32,
    collapseThreshold: 24,
    sashSize: 4,
};

/** 侧栏、两个编辑组、右栏并排：侧栏与右栏保留像素（和编辑组并排），编辑组吸收余量。 */
function shellDoc(): LayoutDoc {
    const doc = docOf(V([H(["activitybar", "left", "ea", "eb", "right"], "body"), "statusbar"], "root"));
    const widths: Readonly<Record<string, number>> = {activitybar: 48, left: 280, ea: 380, eb: 380, right: 280};
    const resize = (node: LayoutDoc["tree"]["root"]): LayoutDoc["tree"]["root"] => node.kind === "leaf"
        ? {...node, size: {...node.size, ...(widths[node.id] === undefined ? {} : {width: widths[node.id]!})}}
        : {...node, children: node.children.map(resize)};
    return {...doc, tree: {...doc.tree, root: resize(doc.tree.root)}};
}

/** 投影、建网格、在 `extent` 下拖 body 的第 `sash` 条分隔条 `dx` 像素并落账；交回落账前后的布局与这次的收起变化。 */
function drag(doc: LayoutDoc, extent: GridExtent, sash: number, dx: number) {
    const projection = projectLayoutDoc(doc, OPTIONS);
    const grid = createGrid<string>(projection.input, {sashSize: projection.sashSize});
    const before = grid.layout(extent);
    const session = createGridGestureSession<string>({contextKey: "k", revision: 1, root: grid.root(), extent, layout: before, sashSize: projection.sashSize, sessionId: "g", source: "pointer", sashes: [{branchId: "body", index: sash, axis: "width"}]});
    session.update({x: dx, y: 0});
    const commit = session.finish();
    if (commit === null) throw new Error("拖动没有产生提交");
    const applied = grid.resizeBranches(commit.changes);
    if (!applied.ok) throw new Error(applied.message);
    return {projection, before: before.sizes, after: grid.layout(extent).sizes, collapsed: applied.collapsed};
}

/** 文档在 `extent` 下呈现出来的宽度。 */
function widthsAt(doc: LayoutDoc, extent: GridExtent, ids: readonly string[]): number[] {
    const projection = projectLayoutDoc(doc, OPTIONS);
    const sizes = createGrid<string>(projection.input, {sashSize: projection.sashSize}).layout(extent).sizes;
    return ids.map((id) => Math.round(sizes[id]?.width ?? -1));
}

const NARROW: GridExtent = {width: 700, height: 700};
const WIDE: GridExtent = {width: 1400, height: 700};

describe("applyGestureCommit", () => {
    it("窄窗口里拖编辑组之间的边界：被压缩、这次没动的保留像素节点不写，放宽后回到原宽（t26 api-03）", () => {
        const doc = shellDoc();
        expect(widthsAt(doc, WIDE, ["left", "right"])).toEqual([280, 280]);
        expect(widthsAt(doc, NARROW, ["left"])[0]).toBeLessThan(280);

        // 窄窗口里两个编辑组都在最小宽度：往右拖把右栏推开（右栏这次动了，照常写回），侧栏没动。
        const gesture = drag(doc, NARROW, 2, 20);
        expect(Math.round(gesture.after.left!.width)).toBe(Math.round(gesture.before.left!.width));
        expect(gesture.after.right!.width).toBeLessThan(gesture.before.right!.width);
        const {doc: written, rejected} = applyGestureCommit(doc, gesture.projection, gesture);
        expect(rejected).toEqual([]);
        expect(widthsAt(written, WIDE, ["left"])).toEqual([280]);
        expect(widthsAt(written, WIDE, ["right"])[0]).toBeLessThan(280);
    });

    it("拖动动到的保留像素节点照常写回：拖侧栏的边界，放宽后是拖成的宽度", () => {
        const doc = shellDoc();
        const gesture = drag(doc, WIDE, 1, 40);
        const {doc: written} = applyGestureCommit(doc, gesture.projection, gesture);
        expect(widthsAt(written, WIDE, ["left"])).toEqual([320]);
    });

    it("被文档拒绝的收起跳过、交回 `rejected`，这次的尺寸照常写回", () => {
        const doc = shellDoc();
        const gesture = drag(doc, WIDE, 1, 40);
        // 网格不会对编辑组报收起；这里直接给一个，看被拒时的去向（`setPanelCollapsed`：编辑组不收）。
        const {doc: written, rejected} = applyGestureCommit(doc, gesture.projection, {...gesture, collapsed: {ea: true, eb: true}});
        expect(rejected.map((item) => [item.id, item.failure.code])).toEqual([["ea", "rejected"], ["eb", "rejected"]]);
        expect(written.panels.ea?.collapsed).toBeUndefined();
        expect(widthsAt(written, WIDE, ["left"])).toEqual([320]);
    });

    it("区域拖到零：收起记在锚上，不记在分节上；从边界拉开隐藏的区域，隐藏一起清掉（输出 11、12）", () => {
        const anchors = {
            sidebar: {tabs: [], active: null, entries: ["A"], activeContainer: "A"},
            auxiliarybar: {tabs: [], active: null, entries: [], activeContainer: null},
        };
        const regions = (sidebar: object = {}): LayoutDoc => docOf(V([H(["activitybar", V(["sidebar", "s1"], "side"), "ea", "auxiliarybar"], "body"), "statusbar"], "root"), {
            ...anchors,
            sidebar: {...anchors.sidebar, ...sidebar},
            s1: {container: "A"},
        });
        const doc = regions();
        const projection = projectLayoutDoc(doc, OPTIONS);
        // 只显示一节时区域的节点就是这一节的叶。
        expect(projection.regionAnchors.get("s1")).toBe("sidebar");
        const collapsed = applyGestureCommit(doc, projection, {before: {}, after: {}, collapsed: {s1: true}});
        expect(collapsed.doc.panels.sidebar?.collapsed).toBe(true);
        expect(collapsed.doc.panels.s1?.collapsed).toBeUndefined();

        // 从零拉开：锚上记着的收起清掉，分节自己不变。
        const zero = regions({collapsed: true});
        const opened = applyGestureCommit(zero, projectLayoutDoc(zero, OPTIONS), {before: {}, after: {}, collapsed: {s1: false}});
        expect(opened.doc.panels.sidebar?.collapsed).toBeUndefined();
        expect(opened.doc.panels.s1?.collapsed).toBeUndefined();

        const hidden = regions({hidden: true});
        const hiddenProjection = projectLayoutDoc(hidden, OPTIONS);
        const shown = applyGestureCommit(hidden, hiddenProjection, {before: {}, after: {}, collapsed: {s1: false}});
        expect(shown.rejected).toEqual([]);
        expect(shown.doc.panels.sidebar?.hidden).toBeUndefined();
        expect(shown.doc.panels.sidebar?.collapsed).toBeUndefined();
    });
});

describe("rebaseForOperation", () => {
    it("结构操作之前写回呈现尺寸，保留像素的节点不写：窄窗口里的压缩不进文档", () => {
        const doc = shellDoc();
        const projection = projectLayoutDoc(doc, OPTIONS);
        const narrow = createGrid<string>(projection.input, {sashSize: projection.sashSize}).layout(NARROW).sizes;
        expect(Math.round(narrow.left!.width)).toBeLessThan(280);
        const written = rebaseForOperation(doc, projection, narrow);
        expect(widthsAt(written, WIDE, ["left", "right"])).toEqual([280, 280]);
    });
});
