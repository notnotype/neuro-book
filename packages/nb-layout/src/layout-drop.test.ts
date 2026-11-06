import {describe, expect, it} from "bun:test";

import {docOf, H, tab, testPolicy, V, view} from "./layout-doc-fixtures";
import {applyLayoutDrop, enumerateDropCandidates, previewEdgeDrop, resolveLayoutDrop} from "./layout-drop";
import type {LayoutDropInput, LayoutDropPanelGeometry} from "./layout-drop";
import type {LayoutDoc, LayoutSource} from "./layout-doc";
import type {LayoutProjectionOptions} from "./layout-project";
import type {GridDropRect} from "./grid-drop";

/** 落点规则（docs/specs/ui/workbench-layout.md 输出 25 到 29）。 */

const rect = (left: number, top: number, right: number, bottom: number): GridDropRect => ({left, top, right, bottom});

/** 三块并排，每块上面 30px 是标签条。 */
const GEOMETRY: ReadonlyArray<LayoutDropPanelGeometry> = [
    {id: "a", strip: rect(0, 0, 300, 30), body: rect(0, 30, 300, 600), insertionAt: () => 1},
    {id: "b", strip: rect(301, 0, 600, 30), body: rect(301, 30, 600, 600), insertionAt: () => 0},
    {id: "ec", strip: rect(601, 0, 900, 30), body: rect(601, 30, 900, 600), insertionAt: () => 0},
];

function drop(doc: LayoutDoc, source: LayoutSource, x: number, y: number, overrides: Partial<LayoutDropInput> = {}) {
    return resolveLayoutDrop({doc, source, point: {x, y}, panels: GEOMETRY, policy: testPolicy(), ...overrides});
}

const THREE = () => docOf(H(["a", "b", "ec"], "root"), {a: {tabs: [view("a"), view("x")], active: "view:a"}});
const VIEW: LayoutSource = {kind: "tab", tab: "view:x"};
const EDITOR_TAB: LayoutSource = {kind: "tab", tab: "tab:ec"};

describe("有序规则", () => {
    it("标签条是插入位，由标签条自己量", () => {
        expect(drop(THREE(), VIEW, 400, 10)).toEqual({kind: "strip", panel: "b", index: 0});
    });

    it("正文中央添加为标签", () => {
        expect(drop(THREE(), VIEW, 450, 300)).toEqual({kind: "center", panel: "b"});
    });

    it("外缘窄带：对面有兄弟时是放到两块之间，这条边、缝、对面那块的边是同一个落点", () => {
        const fromLeftPanel = drop(THREE(), VIEW, 590, 300);
        expect(fromLeftPanel).toEqual({kind: "edge", target: {kind: "between", branch: "root", before: "b", after: "ec"}});
        expect(drop(THREE(), VIEW, 600.5, 300)).toEqual(fromLeftPanel);
        expect(drop(THREE(), VIEW, 610, 300)).toEqual(fromLeftPanel);
    });

    it("外缘窄带：对面没有兄弟时拆这一块", () => {
        expect(drop(THREE(), VIEW, 450, 40)).toEqual({kind: "edge", target: {kind: "split", panel: "b", edge: "top"}});
    });

    it("工作台外、离得远：没有落点", () => {
        expect(drop(THREE(), VIEW, 2000, 300)).toBeNull();
    });

    it("空面板整块都是中央", () => {
        const doc = docOf(H(["a", "b", "ec"]), {b: {tabs: [], active: null}, a: {tabs: [view("a"), view("x")], active: "view:a"}});
        expect(drop(doc, VIEW, 305, 40)).toEqual({kind: "center", panel: "b"});
    });

    it("来源标签已经不在了：没有落点", () => {
        expect(drop(THREE(), {kind: "tab", tab: "view:gone"}, 450, 300)).toBeNull();
    });
});

describe("接受矩阵（输出 26）", () => {
    it("工具视图进不了编辑组的标签条与中央，能拆到外缘", () => {
        expect(drop(THREE(), VIEW, 700, 10)).toBeNull();
        expect(drop(THREE(), VIEW, 750, 300)).toBeNull();
        expect(drop(THREE(), VIEW, 890, 300)).toMatchObject({kind: "edge"});
    });

    it("编辑器标签进不了工具面板的标签条与中央，能拆到外缘", () => {
        expect(drop(THREE(), EDITOR_TAB, 400, 10)).toBeNull();
        expect(drop(THREE(), EDITOR_TAB, 450, 300)).toBeNull();
        expect(drop(THREE(), EDITOR_TAB, 310, 300)).toMatchObject({kind: "edge"});
    });

    it("整个面板同它的标签", () => {
        expect(drop(THREE(), {kind: "panel", panel: "a"}, 750, 300)).toBeNull();
        expect(drop(THREE(), {kind: "panel", panel: "a"}, 450, 300)).toEqual({kind: "center", panel: "b"});
    });
});

describe("预备区（输出 29）", () => {
    const doc = () => docOf(H(["a", "b", "ec", "auxiliarybar"]), {a: {tabs: [view("a"), view("x")], active: "view:a"}, auxiliarybar: {tabs: [], active: null, hidden: true}});
    const zones = [{panel: "auxiliarybar", rect: rect(800, 0, 1200, 600)}];

    it("真实落点优先；只在预备区上时算预备区；放下一次写入显示并接收", () => {
        expect(drop(doc(), EDITOR_TAB, 850, 300, {zones})).toMatchObject({kind: "edge"});
        const action = drop(doc(), VIEW, 1000, 300, {zones});
        expect(action).toEqual({kind: "reveal", panel: "auxiliarybar"});
        if (action === null) throw new Error("没有落点");
        const result = applyLayoutDrop(doc(), VIEW, action, testPolicy());
        if (!result.ok) throw new Error(result.detail);
        expect(result.doc.panels.auxiliarybar?.hidden).toBeUndefined();
        expect(result.doc.panels.auxiliarybar?.tabs).toEqual([view("x")]);
    });

    it("接受矩阵拒绝时不算", () => {
        expect(drop(doc(), EDITOR_TAB, 1000, 300, {zones})).toBeNull();
    });
});

describe("提交", () => {
    it("放回原处返回原文档：中央落在自己所在的面板、整块面板落在自己的外缘", () => {
        const doc = THREE();
        const center = applyLayoutDrop(doc, VIEW, {kind: "center", panel: "a"}, testPolicy());
        expect(center.ok && center.doc).toBe(doc);
        const own = applyLayoutDrop(doc, {kind: "panel", panel: "b"}, {kind: "edge", target: {kind: "split", panel: "b", edge: "top"}}, testPolicy());
        expect(own.ok && own.doc).toBe(doc);
    });
});

describe("预览画真实结果", () => {
    const PROJECTION: LayoutProjectionOptions = {
        constraints: () => ({minimumSize: {width: 10, height: 10}, maximumSize: {width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY}}),
        barThickness: () => 0,
        headHeight: 32,
        collapseThreshold: 24,
        sashSize: 1,
    };

    it("拆一块：新块取一半，矩形和提交后一样", () => {
        const doc = docOf(H(["a", "ec"]));
        const preview = previewEdgeDrop(doc, {kind: "panel", panel: "a"}, {kind: "edge", target: {kind: "split", panel: "ec", edge: "bottom"}}, testPolicy(), PROJECTION, {width: 1000, height: 600}, 1);
        // 被拖的工具面板保留 300 的像素，编辑组吸收余量和缝。
        expect(preview).toEqual(rect(0, 300, 1000, 600));
    });

    it("放回原处没有预览", () => {
        const doc = docOf(H(["a", "ec"]));
        expect(previewEdgeDrop(doc, {kind: "panel", panel: "a"}, {kind: "edge", target: {kind: "split", panel: "a", edge: "top"}}, testPolicy(), PROJECTION, {width: 1000, height: 600}, 1)).toBeNull();
    });
});

describe("键盘的落点（输出 31）", () => {
    it("和指针同一套规则：拒绝的、结果和现状一样的不列；按树序", () => {
        const doc = docOf(H(["a", V(["b", "ec"])]));
        const candidates = enumerateDropCandidates({doc, source: {kind: "panel", panel: "a"}, policy: testPolicy(), stripCount: (panel) => (doc.panels[panel]?.tabs.length ?? 0) + 1});
        expect(candidates.every((candidate) => candidate.region === "b" || candidate.region === "ec")).toBe(true);
        expect(candidates.some((candidate) => candidate.action.kind === "strip" && candidate.action.panel === "ec")).toBe(false);
        expect(candidates.some((candidate) => candidate.action.kind === "edge" && candidate.region === "ec")).toBe(true);
        const keys = candidates.map((candidate) => JSON.stringify(candidate.action));
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("预备区排在可见落点之后", () => {
        const doc = docOf(H(["a", "ec", "auxiliarybar"]), {a: {tabs: [view("a"), view("x")], active: "view:a"}, auxiliarybar: {tabs: [], active: null, hidden: true}});
        const candidates = enumerateDropCandidates({doc, source: VIEW, policy: testPolicy(), stripCount: () => 1, reveal: ["auxiliarybar"]});
        expect(candidates.at(-1)).toEqual({region: "reveal:auxiliarybar", action: {kind: "reveal", panel: "auxiliarybar"}});
    });

    it("编辑器标签没有工具面板的插入位", () => {
        const doc = docOf(H(["a", "ec"]), {ec: {tabs: [tab("p"), tab("q")], active: "tab:p"}});
        const candidates = enumerateDropCandidates({doc, source: {kind: "tab", tab: "tab:q"}, policy: testPolicy(), stripCount: () => 2});
        expect(candidates.some((candidate) => candidate.action.kind === "strip" && candidate.action.panel === "a")).toBe(false);
        expect(candidates.some((candidate) => candidate.action.kind === "edge")).toBe(true);
    });
});
