/**
 * 骨架（docs/specs/ui/workbench-layout.md 输出 1）：哪些树合骨架，以及从默认树出发，任何操作之后都合。
 */
import {describe, expect, it} from "bun:test";

import {activateTab, applyLayoutDrop, barRef, enumerateDropCandidates, layoutSeamsOf, previewPanelRects, findTab, GRID_SNAPSHOT_VERSION, insertTab, moveTabToEdge, panelRef, removeTab, setPanelCollapsed, setPanelHidden, stripDynamicTabs, tabKey, treeLeaves, validateLayoutDoc} from "@notnotype/nb-layout";
import type {GridSnapshotNode, LayoutDoc, PanelName, PanelRecord, TabRef} from "@notnotype/nb-layout";

import {defaultLayoutDoc, fitsSkeleton} from "./default-tree";
import {createLayoutPolicy, layoutProjectionOptions, newPanelEdgeTarget} from "./layout-constraints";
import type {ViewCatalog} from "../views/registry";

const NAMED = new Set<string>(["sidebar", "auxiliarybar", "panel"]);
const SIZE = {width: 100, height: 100};

type Shape = string | {readonly h: ReadonlyArray<Shape>} | {readonly v: ReadonlyArray<Shape>};

let branches = 0;
function node(shape: Shape): GridSnapshotNode {
    if (typeof shape === "string") return {kind: "leaf", id: shape, ref: shape === "activitybar" || shape === "statusbar" ? barRef(shape) : panelRef(shape), size: SIZE};
    branches += 1;
    const orientation = "h" in shape ? "horizontal" : "vertical";
    return {kind: "branch", id: `b${String(branches)}`, orientation, size: SIZE, children: ("h" in shape ? shape.h : shape.v).map(node)};
}

/** 叶名以 `e` 开头的是编辑组，其余是工具面板。 */
function docOf(root: Shape): LayoutDoc {
    const tree = node(root);
    const panels: Record<string, PanelRecord> = {};
    for (const leaf of treeLeaves(tree)) {
        if (leaf.id === "activitybar" || leaf.id === "statusbar") continue;
        panels[leaf.id] = {role: leaf.id.startsWith("e") ? "editor" : "tool", ...(NAMED.has(leaf.id) ? {name: leaf.id as PanelName} : {}), tabs: [], active: null};
    }
    return {version: 1, tree: {version: GRID_SNAPSHOT_VERSION, root: tree}, panels, floats: [], hiddenBars: [], currentEditor: null};
}

const body = (...children: Shape[]): Shape => ({v: [{h: ["activitybar", ...children]}, "statusbar"]});

describe("合骨架的树", () => {
    const fits: ReadonlyArray<readonly [string, Shape]> = [
        ["默认树", body("sidebar", {v: ["e0", "panel"]}, "auxiliarybar")],
        ["编辑区横着分", body("sidebar", {v: [{h: ["e0", "e1"]}, "panel"]}, "auxiliarybar")],
        ["编辑区竖着分，展平后和面板同在一列", body("sidebar", {v: ["e0", "e1", "panel"]}, "auxiliarybar")],
        ["编辑区里嵌套", body("sidebar", {v: [{h: [{v: ["e0", "e1"]}, "e2"]}, "panel"]}, "auxiliarybar")],
        ["面板这一排左右分", body("sidebar", {v: ["e0", {h: ["panel", "x"]}]}, "auxiliarybar")],
        ["面板不在这一排的第一个", body("sidebar", {v: ["e0", {h: ["x", "panel"]}]}, "auxiliarybar")],
        ["侧栏这一列上下分", body({v: ["sidebar", "x"]}, {v: ["e0", "panel"]}, "auxiliarybar")],
        ["侧栏不在这一列的第一个", body({v: ["x", "sidebar"]}, {v: ["e0", "panel"]}, {v: ["y", "auxiliarybar", "z"]})],
    ];
    for (const [name, shape] of fits) {
        it(name, () => {
            expect(fitsSkeleton(docOf(shape))).toBe(true);
        });
    }
});

describe("不合骨架的树", () => {
    const outside: ReadonlyArray<readonly [string, Shape]> = [
        ["面板跑到编辑组旁边", body("sidebar", {h: ["e0", "panel"]}, "auxiliarybar")],
        ["工具面板夹在侧栏和编辑区之间", body("sidebar", "x", {v: ["e0", "panel"]}, "auxiliarybar")],
        ["编辑组夹在中间列和右栏之间", body("sidebar", {v: ["e0", "panel"]}, "e1", "auxiliarybar")],
        ["工具面板在编辑区里", body("sidebar", {v: [{h: ["e0", "x"]}, "panel"]}, "auxiliarybar")],
        ["面板在编辑区上面", body("sidebar", {v: ["panel", "e0"]}, "auxiliarybar")],
        ["侧栏这一列左右分", body({h: ["sidebar", "x"]}, {v: ["e0", "panel"]}, "auxiliarybar")],
        ["面板这一排上下分", body("sidebar", {v: ["e0", {v: ["panel", "x"]}]}, "auxiliarybar")],
        ["侧栏和右栏换了位置", body("auxiliarybar", {v: ["e0", "panel"]}, "sidebar")],
        ["面板进了侧栏这一列", body({v: ["sidebar", "panel"]}, {v: ["e0", "x"]}, "auxiliarybar")],
        ["条不在外层", {h: ["activitybar", {v: ["sidebar", "statusbar"]}, {v: ["e0", "panel"]}, "auxiliarybar"]}],
        ["没有编辑组", body("sidebar", {v: ["x", "panel"]}, "auxiliarybar")],
    ];
    for (const [name, shape] of outside) {
        it(name, () => {
            expect(fitsSkeleton(docOf(shape))).toBe(false);
        });
    }
});

/** 能重放的伪随机数（mulberry32）：失败时按种子复现。 */
function randomOf(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

const VIEW = (location: PanelName, order: number) => ({title: {"zh-CN": "视", "en-US": "V"}, icon: "i", location, layout: "scroll" as const, order});
const CATALOG: ViewCatalog = new Map([["a", VIEW("sidebar", 1)], ["b", VIEW("sidebar", 2)], ["c", VIEW("sidebar", 3)], ["d", VIEW("auxiliarybar", 1)], ["f", VIEW("auxiliarybar", 2)], ["g", VIEW("panel", 1)]]);

describe("从默认树出发，任何操作之后都合骨架", () => {
    /** 两种分法都走一遍：随机切。 */
    let shared = false;
    const policy = createLayoutPolicy({dropSplit: () => (shared ? "shared" : "half")});
    /** 这一刻的缝，和拖动时一样按矩形算。 */
    function seamsOf(doc: LayoutDoc): ReturnType<typeof layoutSeamsOf> {
        const rects = previewPanelRects(doc, Object.keys(doc.panels), layoutProjectionOptions({catalog: CATALOG, viewportWidth: 1440}), {width: 1440, height: 864}, 1);
        return layoutSeamsOf(doc, Object.entries(rects).flatMap(([id, body]) => (body.right > body.left && body.bottom > body.top ? [{id, strip: null, body}] : [])));
    }
    const pick = <T>(random: () => number, items: ReadonlyArray<T>): T | undefined => items[Math.floor(random() * items.length)];
    const panelsOf = (doc: LayoutDoc, role: PanelRecord["role"]): string[] => Object.entries(doc.panels).filter(([, panel]) => panel.role === role).map(([id]) => id);

    function step(doc: LayoutDoc, random: () => number, nextTab: () => TabRef): LayoutDoc {
        const roll = random();
        const tabs = Object.values(doc.panels).flatMap((panel) => panel.tabs);
        let result: ReturnType<typeof activateTab> | null = null;
        if (roll < 0.6) {
            // 拖动：取落点规则列出的任意一个候选。
            const tab = pick(random, tabs);
            if (tab === undefined) return doc;
            const source = {kind: "tab", tab: tabKey(tab)} as const;
            shared = random() < 0.5;
            const candidates = enumerateDropCandidates({doc, source, policy, stripIndexes: (panel) => (doc.panels[panel]?.tabs ?? []).map((_tab, index) => index).concat(doc.panels[panel]?.tabs.length ?? 0), seams: seamsOf(doc)});
            const candidate = pick(random, candidates);
            if (candidate === undefined) return doc;
            result = applyLayoutDrop(doc, source, candidate.action, policy);
        } else if (roll < 0.7) {
            const name = pick(random, ["sidebar", "auxiliarybar", "panel"] as const) ?? "sidebar";
            result = setPanelHidden(doc, name, random() < 0.5);
        } else if (roll < 0.8) {
            const panel = pick(random, panelsOf(doc, "tool"));
            if (panel === undefined) return doc;
            result = setPanelCollapsed(doc, panel, random() < 0.5);
        } else if (roll < 0.9) {
            // 打开、关闭编辑器标签。
            const closing = tabs.filter((tab) => tab.kind === "tab");
            if (random() < 0.5 && closing[0] !== undefined) result = removeTab(doc, tabKey(pick(random, closing) ?? closing[0]));
            else {
                const panel = pick(random, panelsOf(doc, "editor"));
                if (panel === undefined) return doc;
                result = insertTab(doc, {panel, tab: nextTab()});
            }
        } else {
            // “移动到”的新面板：和 store 的 `moveView` 同一个目标。
            const view = pick(random, tabs.filter((tab) => tab.kind === "view"));
            const beside = pick(random, panelsOf(doc, "tool").filter((panel) => doc.panels[panel]?.hidden !== true));
            if (view === undefined || beside === undefined) return doc;
            const edge = newPanelEdgeTarget(doc, beside);
            if (edge === null) return doc;
            result = moveTabToEdge(doc, {tab: tabKey(view), target: edge}, policy);
        }
        return result.ok ? result.doc : doc;
    }

    it("随机操作：拖动的所有落点、显隐、收起、开关标签、新面板", () => {
        for (let seed = 1; seed <= 20; seed += 1) {
            const random = randomOf(seed);
            let counter = 0;
            let doc = defaultLayoutDoc(CATALOG);
            for (let index = 0; index < 60; index += 1) {
                doc = step(doc, random, () => {
                    counter += 1;
                    return {kind: "tab", type: "nbook.editor", tabId: `t${String(counter)}`};
                });
                const context = `种子 ${String(seed)} 第 ${String(index)} 步`;
                expect([context, fitsSkeleton(doc)]).toEqual([context, true]);
                expect([context, validateLayoutDoc(doc).ok]).toEqual([context, true]);
            }
            // 存盘前去掉动态标签（模板、未绑定项目的窗口）之后也合。
            expect(fitsSkeleton(stripDynamicTabs(doc))).toBe(true);
            // 视图都还在：具名面板不见了的话视图就没地方放了。
            for (const viewId of CATALOG.keys()) expect(findTab(doc, tabKey({kind: "view", viewId}))).not.toBeNull();
        }
    });
});
