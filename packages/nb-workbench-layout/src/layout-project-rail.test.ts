import {describe, expect, it} from "bun:test";

import {createGrid} from "@notnotype/nb-layout";
import type {GridExtent, GridNodeInput} from "@notnotype/nb-layout";
import {docOf, H, V} from "./layout-doc-fixtures";
import {setBarHidden, setPanelCollapsed, setPanelHidden} from "./layout-doc";
import type {LayoutDoc, LayoutResult} from "./layout-doc";
import {presentationCollapse, projectLayoutDoc, railLeafId} from "./layout-project";
import type {LayoutProjectionOptions} from "./layout-project";
import {fixedNodesOf} from "./intent-writeback";

/** 呈现里的侧轨与按预算呈现的区域（docs/specs/ui/workbench-layout.md 输出 50 的“几何”“在不在”“预算”）。 */

const OPTIONS: LayoutProjectionOptions = {
    constraints: (_id, panel) => (panel.role === "editor"
        ? {minimumSize: {width: 220, height: 120}, maximumSize: {width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY}}
        : {minimumSize: {width: 160, height: 80}, maximumSize: {width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY}}),
    barThickness: (bar) => (bar === "activitybar" ? 48 : 22),
    headHeight: 32,
    collapseThreshold: 24,
    sashSize: 1,
    rail: () => 48,
};

const RAIL = railLeafId("auxiliarybar");

function okDoc(result: LayoutResult): LayoutDoc {
    if (!result.ok) throw new Error(`操作失败：${result.code} ${result.message}`);
    return result.doc;
}

/** 侧栏的容器 A 有 s1；右栏的容器 M 有 m1、N 有 n1（N 不是当前容器）；底部面板的容器 P 有 p1。 */
const railed = (): LayoutDoc => docOf(V([H(["activitybar", V(["sidebar", "s1"], "side"), V(["ea", H(["panel", "p1"], "row")], "center"), V(["auxiliarybar", "m1", "n1"], "aux")], "body"), "statusbar"], "root"), {
    sidebar: {tabs: [], active: null, entries: ["A"], activeContainer: "A"},
    s1: {container: "A"},
    panel: {tabs: [], active: null, entries: ["P"], activeContainer: "P"},
    p1: {container: "P"},
    auxiliarybar: {tabs: [], active: null, entries: ["M", "N"], activeContainer: "M"},
    m1: {container: "M"},
    n1: {container: "N"},
});

/** 横向的 body 分支里从左到右的孩子 id。 */
function bodyOrder(input: GridNodeInput<string>): ReadonlyArray<string> {
    const body = input.kind === "branch" ? input.children.find((child) => child.kind === "branch" && child.orientation === "horizontal") : undefined;
    return body?.kind === "branch" ? body.children.map((child) => child.id) : [];
}

function solve(doc: LayoutDoc, extent: GridExtent, overrides: Partial<LayoutProjectionOptions> = {}) {
    const projection = projectLayoutDoc(doc, {...OPTIONS, ...overrides});
    return {projection, sizes: createGrid<string>(projection.input, {sashSize: projection.sashSize}).layout(extent).sizes};
}

describe("侧轨叶", () => {
    it("右栏有分节时，侧轨叶在右栏那一列外侧、固定 48、两侧没有缝；宿主不给 `rail` 时没有", () => {
        const {projection, sizes} = solve(railed(), {width: 1200, height: 700});
        // 侧栏、右栏都只显示一节：那一列在呈现里塌成那一节的叶。
        expect(bodyOrder(projection.input)).toEqual(["activitybar", "s1", "center", "m1", RAIL]);
        expect(projection.rails).toEqual([{region: "auxiliarybar", leaf: RAIL}]);
        expect(sizes[RAIL]?.width).toBe(48);
        expect([projection.sashSize("body", 3)]).toEqual([0]);
        const plain = projectLayoutDoc(railed(), {...OPTIONS, rail: undefined});
        expect(plain.rails).toEqual([]);
        expect(bodyOrder(plain.input)).not.toContain(RAIL);
    });

    it("右栏隐藏、拖到零、整列放不下收走时侧轨照样在；只隐藏了活动栏也一样", () => {
        const hidden = okDoc(setPanelHidden(railed(), "auxiliarybar", true));
        expect(solve(hidden, {width: 1200, height: 700}).sizes[RAIL]?.width).toBe(48);
        const zero = okDoc(setPanelCollapsed(railed(), "auxiliarybar", true));
        expect(solve(zero, {width: 1200, height: 700}).sizes[RAIL]?.width).toBe(48);
        const noBar = okDoc(setBarHidden(railed(), "activitybar", true));
        const removed = projectLayoutDoc(noBar, {...OPTIONS, removed: new Set(["m1"])});
        expect(bodyOrder(removed.input)).toEqual(["s1", "center", RAIL]);
    });

    it("右栏没有分节（显式打开的空区域、最后一个成员走了）时没有侧轨", () => {
        const doc = railed();
        const empty = docOf(V([H(["activitybar", V(["sidebar", "s1"], "side"), "ea", "auxiliarybar"], "body"), "statusbar"], "root"), {
            sidebar: {tabs: [], active: null, entries: ["A"], activeContainer: "A"},
            s1: {container: "A"},
            auxiliarybar: {tabs: [], active: null, entries: [], activeContainer: null},
        });
        expect(projectLayoutDoc(empty, OPTIONS).rails).toEqual([]);
        expect(projectLayoutDoc(doc, OPTIONS).rails).toHaveLength(1);
    });

    it("只缺高度时不收侧轨：窗口矮到放不下时，收走的是工具面板，侧轨叶没有最小高度", () => {
        const collapse = presentationCollapse(railed(), {width: 1200, height: 150}, {...OPTIONS, order: ["m1", "n1", "p1", "s1"]});
        const {projection} = solve(railed(), {width: 1200, height: 150}, {removed: collapse.removed});
        expect(projection.rails).toHaveLength(1);
        const rail = findLeaf(projection.input, RAIL);
        expect(rail?.minimumSize?.height ?? 0).toBe(0);
    });
});

function findLeaf(node: GridNodeInput<string>, id: string): GridNodeInput<string> | null {
    if (node.id === id) return node;
    if (node.kind === "leaf") return null;
    for (const child of node.children) {
        const found = findLeaf(child, id);
        if (found !== null) return found;
    }
    return null;
}

describe("按预算呈现的区域（输出 50 的“预算”）", () => {
    it("区域按给的宽度呈现，编辑组吸收余量；区域节点保留像素，意图回写不写它", () => {
        const {projection, sizes} = solve(railed(), {width: 1200, height: 700}, {rail: () => 260, regionWidth: {auxiliarybar: 330}});
        expect(sizes.m1?.width).toBe(330);
        expect(sizes[RAIL]?.width).toBe(260);
        expect(fixedNodesOf(projection.input).has("m1")).toBe(true);
    });
});
