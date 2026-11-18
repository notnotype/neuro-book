/**
 * 默认布局、后来才出现的视图与骨架（docs/specs/ui/workbench-layout.md 输出 1、4）：按声明建出什么，哪些树合骨架，以及从默认树出发，任何操作之后都合。
 */
import {describe, expect, it} from "bun:test";

import {GRID_SNAPSHOT_VERSION} from "@notnotype/nb-layout";
import {activateTab, applyLayoutDrop, barRef, enumerateDropCandidates, layoutSeamsOf, previewPanelRects, findTab, findTreeNode, insertTab, isPanelShown, moveTabToEdge, openPanelAtEdge, panelRef, removeTab, setPanelCollapsed, setPanelHidden, stripDynamicTabs, tabKey, treeLeaves, validateLayoutDoc} from "@notnotype/nb-workbench-layout";
import type {GridSnapshotNode} from "@notnotype/nb-layout";
import type {LayoutDoc, LayoutResult, PanelName, PanelRecord, TabRef} from "@notnotype/nb-workbench-layout";

import {regionContainers, sectionLanding, settleContainers, viewSection} from "./containers";
import type {ContainerCatalog} from "./containers";
import {defaultLayoutDoc, fitsSkeleton, predatesContainers, reconcileViews} from "./default-tree";
import {createLayoutPolicy, layoutProjectionOptions} from "./layout-constraints";
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

/**
 * 叶名以 `e` 开头的是编辑组；三片具名面板是锚（没有标签、带入口顺序）；其余工具面板是分节（一个标签，写着归属）。`patch` 按面板 id 换掉整条记录，用来造不合规则的。
 */
function docOf(root: Shape, patch: Readonly<Record<string, PanelRecord>> = {}): LayoutDoc {
    const tree = node(root);
    const panels: Record<string, PanelRecord> = {};
    for (const leaf of treeLeaves(tree)) {
        if (leaf.id === "activitybar" || leaf.id === "statusbar") continue;
        if (leaf.id.startsWith("e")) panels[leaf.id] = {role: "editor", tabs: [], active: null};
        else if (NAMED.has(leaf.id)) panels[leaf.id] = {role: "tool", name: leaf.id as PanelName, tabs: [], active: null, entries: ["c"], activeContainer: "c"};
        else panels[leaf.id] = {role: "tool", tabs: [{kind: "view", viewId: leaf.id}], active: `view:${leaf.id}`, container: "c"};
    }
    return {version: 1, tree: {version: GRID_SNAPSHOT_VERSION, root: tree}, panels: {...panels, ...patch}, floats: [], hiddenBars: [], currentEditor: null};
}

const body = (...children: Shape[]): Shape => ({v: [{h: ["activitybar", ...children]}, "statusbar"]});

describe("合骨架的树", () => {
    const fits: ReadonlyArray<readonly [string, Shape]> = [
        ["三个区域都只有锚", body("sidebar", {v: ["e0", "panel"]}, "auxiliarybar")],
        ["编辑区横着分", body("sidebar", {v: [{h: ["e0", "e1"]}, "panel"]}, "auxiliarybar")],
        ["编辑区竖着分，展平后和面板同在一列", body("sidebar", {v: ["e0", "e1", "panel"]}, "auxiliarybar")],
        ["编辑区里嵌套", body("sidebar", {v: [{h: [{v: ["e0", "e1"]}, "e2"]}, "panel"]}, "auxiliarybar")],
        ["底部面板这一排有分节", body("sidebar", {v: ["e0", {h: ["panel", "x"]}]}, "auxiliarybar")],
        ["底部面板的锚不在这一排的第一个", body("sidebar", {v: ["e0", {h: ["x", "panel"]}]}, "auxiliarybar")],
        ["侧栏这一列有分节", body({v: ["sidebar", "x"]}, {v: ["e0", "panel"]}, "auxiliarybar")],
        ["侧栏的锚不在这一列的第一个", body({v: ["x", "sidebar"]}, {v: ["e0", "panel"]}, {v: ["y", "auxiliarybar", "z"]})],
    ];
    for (const [name, shape] of fits) {
        it(name, () => {
            expect(fitsSkeleton(docOf(shape))).toBe(true);
            expect(predatesContainers(docOf(shape))).toBe(false);
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
            // 位置就不对的不是“有容器之前存的”：回落时不带标签（“状态与转换”）。
            expect(predatesContainers(docOf(shape))).toBe(false);
        });
    }
});

describe("位置合骨架、不合容器规则的树：有容器之前存的记录（输出 40，“状态与转换”）", () => {
    const view = (viewId: string): TabRef => ({kind: "view", viewId});
    const column = body({v: ["sidebar", "x"]}, {v: ["e0", "panel"]}, "auxiliarybar");
    const before: ReadonlyArray<readonly [string, Shape, Readonly<Record<string, PanelRecord>>]> = [
        ["锚上有标签", column, {sidebar: {role: "tool", name: "sidebar", tabs: [view("a")], active: "view:a"}}],
        ["锚没有入口顺序", column, {sidebar: {role: "tool", name: "sidebar", tabs: [], active: null}}],
        ["区域里的面板有两个标签", column, {x: {role: "tool", tabs: [view("a"), view("b")], active: "view:a", container: "c"}}],
        ["区域里的面板没有标签", column, {x: {role: "tool", tabs: [], active: null, container: "c"}}],
        ["区域里的面板没有归属", column, {x: {role: "tool", tabs: [view("a")], active: "view:a"}}],
        ["三片具名面板各装着视图（片 7c 到有容器之前的默认树）", body("sidebar", {v: ["e0", "panel"]}, "auxiliarybar"), {
            sidebar: {role: "tool", name: "sidebar", tabs: [view("a"), view("b")], active: "view:a"},
            auxiliarybar: {role: "tool", name: "auxiliarybar", tabs: [view("d")], active: "view:d"},
            panel: {role: "tool", name: "panel", tabs: [], active: null, hidden: true},
        }],
    ];
    for (const [name, shape, patch] of before) {
        it(name, () => {
            const doc = docOf(shape, patch);
            expect(validateLayoutDoc(doc).ok).toBe(true);
            expect(fitsSkeleton(doc)).toBe(false);
            expect(predatesContainers(doc)).toBe(true);
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

const VIEW = (location: PanelName, order: number, container?: string) => ({title: {"zh-CN": "视", "en-US": "V"}, icon: "i", location, layout: "scroll" as const, order, ...(container === undefined ? {} : {container})});
/** 侧栏：容器“组”装着甲、乙，丙没写容器；右栏丁、己各是自己的隐式容器；底部面板庚。 */
const GROUP = "acme.group";
const CONTAINERS: ContainerCatalog = new Map([[GROUP, {title: {"zh-CN": "组", "en-US": "Group"}, icon: "i", location: "sidebar", order: 2}]]);
const CATALOG: ViewCatalog = new Map([["a", VIEW("sidebar", 1, GROUP)], ["b", VIEW("sidebar", 2, GROUP)], ["c", VIEW("sidebar", 3)], ["d", VIEW("auxiliarybar", 1)], ["f", VIEW("auxiliarybar", 2)], ["g", VIEW("panel", 1)]]);

function must(result: LayoutResult): LayoutDoc {
    if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
    return result.doc;
}
const sizeOf = (doc: LayoutDoc, id: string): {readonly width: number; readonly height: number} => {
    const hit = findTreeNode(doc.tree.root, id);
    if (hit === null) throw new Error(`树里没有 ${id}`);
    return hit.node.size;
};
const sectionOf = (doc: LayoutDoc, viewId: string): string => {
    const section = viewSection(doc, viewId);
    if (section === null) throw new Error(`${viewId} 不在区域里`);
    return section.panel;
};
const containersIn = (doc: LayoutDoc, region: PanelName): ReadonlyArray<readonly [string, ReadonlyArray<string>]> => regionContainers(doc, region).map((container) => [container.id, container.views] as const);

describe("默认布局（输出 1、4）", () => {
    it("按声明建：锚没有标签，一个视图一个分节；入口按容器的 (order, id)，容器里按视图的 (order, id)；当前容器是第一个入口", () => {
        const doc = defaultLayoutDoc(CATALOG, CONTAINERS);
        expect(validateLayoutDoc(doc).ok).toBe(true);
        expect(fitsSkeleton(doc)).toBe(true);
        for (const name of NAMED) expect(doc.panels[name]?.tabs).toEqual([]);
        // 容器“组”的 order 是 2，排在丙的隐式容器（按丙的 order 3）前面。
        expect(containersIn(doc, "sidebar")).toEqual([[GROUP, ["a", "b"]], ["view:c", ["c"]]]);
        expect(containersIn(doc, "auxiliarybar")).toEqual([["view:d", ["d"]], ["view:f", ["f"]]]);
        expect(containersIn(doc, "panel")).toEqual([["view:g", ["g"]]]);
        expect(doc.panels.sidebar).toMatchObject({entries: [GROUP, "view:c"], activeContainer: GROUP});
        expect(doc.panels.auxiliarybar).toMatchObject({entries: ["view:d", "view:f"], activeContainer: "view:d"});
        // 显示的是每个区域当前容器的分节。
        expect(["a", "b", "c", "d", "f", "g"].filter((viewId) => isPanelShown(doc, sectionOf(doc, viewId)))).toEqual(["a", "b", "d", "g"]);
    });

    it("有容器的区域显示，没有的隐藏、没有入口也没有当前容器", () => {
        const doc = defaultLayoutDoc(new Map([["a", VIEW("sidebar", 1)]]));
        expect(doc.panels.sidebar?.hidden).toBeUndefined();
        expect(doc.panels.auxiliarybar).toMatchObject({hidden: true, entries: [], activeContainer: null});
        expect(doc.panels.panel).toMatchObject({hidden: true, entries: [], activeContainer: null});
        expect(fitsSkeleton(doc)).toBe(true);
        expect(validateLayoutDoc(doc).ok).toBe(true);
    });

    it("同一份声明算出同一棵树：分节的面板 id 由视图 id 定，与声明交进来的先后无关", () => {
        const reversed: ViewCatalog = new Map([...CATALOG].reverse());
        expect(defaultLayoutDoc(reversed, CONTAINERS)).toEqual(defaultLayoutDoc(CATALOG, CONTAINERS));
        expect(sectionOf(defaultLayoutDoc(CATALOG, CONTAINERS), "a")).toBe(sectionOf(defaultLayoutDoc(reversed, CONTAINERS), "a"));
    });

    it("每个容器的分节各自平分整列：一个区域只显示一个容器", () => {
        const doc = defaultLayoutDoc(CATALOG, CONTAINERS);
        const column = sizeOf(doc, "sidebar").height;
        expect(sizeOf(doc, sectionOf(doc, "a")).height + sizeOf(doc, sectionOf(doc, "b")).height).toBe(column);
        expect(sizeOf(doc, sectionOf(doc, "c")).height).toBe(column);
        expect(sizeOf(doc, sectionOf(doc, "a")).width).toBe(sizeOf(doc, "sidebar").width);
    });

    it("写的容器没有声明的视图：进自己的隐式容器", () => {
        const doc = defaultLayoutDoc(CATALOG, new Map());
        expect(containersIn(doc, "sidebar")).toEqual([["view:a", ["a"]], ["view:b", ["b"]], ["view:c", ["c"]]]);
    });
});

describe("后来才出现的视图（输出 4）", () => {
    const without = (...ids: string[]): ViewCatalog => new Map([...CATALOG].filter(([id]) => !ids.includes(id)));

    it("容器已经有成员：成为它最后一个分节，从前一个分节取一半，不是零尺寸", () => {
        const before = defaultLayoutDoc(without("b"), CONTAINERS);
        const whole = sizeOf(before, sectionOf(before, "a")).height;
        const after = reconcileViews(before, CATALOG, CONTAINERS);
        expect(containersIn(after, "sidebar")).toEqual([[GROUP, ["a", "b"]], ["view:c", ["c"]]]);
        expect(sizeOf(after, sectionOf(after, "b")).height).toBe(whole / 2);
        expect(sizeOf(after, sectionOf(after, "a")).height).toBe(whole / 2);
        // 别的容器的分节不动。
        expect(sizeOf(after, sectionOf(after, "c"))).toEqual(sizeOf(before, sectionOf(before, "c")));
        expect(fitsSkeleton(after)).toBe(true);
        expect(validateLayoutDoc(after).ok).toBe(true);
    });

    it("容器还没有成员：放进声明的区域，入口排在这个区域入口顺序的最后；同时出现的几个之间按 order", () => {
        const before = defaultLayoutDoc(without("a", "b", "d"), CONTAINERS);
        expect(before.panels.sidebar?.entries).toEqual(["view:c"]);
        const after = reconcileViews(before, CATALOG, CONTAINERS);
        // 第一次生成时“组”排在丙前面；后来才出现就排在最后。
        expect(containersIn(after, "sidebar")).toEqual([["view:c", ["c"]], [GROUP, ["a", "b"]]]);
        expect(after.panels.sidebar?.activeContainer).toBe("view:c");
        expect(containersIn(after, "auxiliarybar")).toEqual([["view:f", ["f"]], ["view:d", ["d"]]]);
        expect(fitsSkeleton(after)).toBe(true);
        expect(validateLayoutDoc(after).ok).toBe(true);
    });

    it("容器此刻在别的区域（用户搬过）：加在容器此刻所在的区域，不看声明的位置", () => {
        const before = defaultLayoutDoc(without("b"), CONTAINERS);
        const target = sectionLanding(before, "auxiliarybar", GROUP);
        if (target === null) throw new Error("右栏不用容器");
        const moved = settleContainers(must(moveTabToEdge(before, {tab: "view:a", target, container: GROUP}, createLayoutPolicy())));
        const after = reconcileViews(moved, CATALOG, CONTAINERS);
        expect(containersIn(after, "auxiliarybar")).toContainEqual([GROUP, ["a", "b"]]);
        expect(containersIn(after, "sidebar")).toEqual([["view:c", ["c"]]]);
    });

    it("区域隐藏着就保持隐藏，当前容器也不换", () => {
        const before = must(setPanelHidden(defaultLayoutDoc(without("a", "b"), CONTAINERS), "sidebar", true));
        const after = reconcileViews(before, CATALOG, CONTAINERS);
        expect(after.panels.sidebar).toMatchObject({hidden: true, activeContainer: "view:c", entries: ["view:c", GROUP]});
    });

    it("区域原来没有容器：它成为当前容器，区域还是隐藏着", () => {
        const before = defaultLayoutDoc(without("g"), CONTAINERS);
        expect(before.panels.panel).toMatchObject({hidden: true, activeContainer: null});
        const after = reconcileViews(before, CATALOG, CONTAINERS);
        expect(after.panels.panel).toMatchObject({hidden: true, entries: ["view:g"], activeContainer: "view:g"});
        expect(fitsSkeleton(after)).toBe(true);
        expect(validateLayoutDoc(after).ok).toBe(true);
    });

    it("没有要补的时返回原对象；同一份文档补两次结果相同", () => {
        const full = defaultLayoutDoc(CATALOG, CONTAINERS);
        expect(reconcileViews(full, CATALOG, CONTAINERS)).toBe(full);
        const before = defaultLayoutDoc(without("a", "b", "g"), CONTAINERS);
        expect(reconcileViews(before, CATALOG, CONTAINERS)).toEqual(reconcileViews(before, CATALOG, CONTAINERS));
    });

    it("声明消失的视图留在文档里，不动", () => {
        const full = defaultLayoutDoc(CATALOG, CONTAINERS);
        expect(reconcileViews(full, without("a"), CONTAINERS)).toBe(full);
    });

    it("由视图 id 定的面板 id 已经被占：换一个，原来那块不动", () => {
        const before = defaultLayoutDoc(without("b"), CONTAINERS);
        const target = sectionLanding(before, "sidebar", "view:c");
        if (target === null) throw new Error("侧栏不用容器");
        const taken = sectionOf(defaultLayoutDoc(CATALOG, CONTAINERS), "b");
        const occupied = must(openPanelAtEdge(before, {id: taken, panel: {role: "tool", tabs: [{kind: "view", viewId: "other"}], active: "view:other", container: "view:c"}, target}, createLayoutPolicy()));
        const after = reconcileViews(occupied, CATALOG, CONTAINERS);
        expect(after.panels[taken]?.tabs).toEqual([{kind: "view", viewId: "other"}]);
        expect(sectionOf(after, "b")).not.toBe(taken);
        expect(containersIn(after, "sidebar")).toEqual([[GROUP, ["a", "b"]], ["view:c", ["c", "other"]]]);
        expect(validateLayoutDoc(after).ok).toBe(true);
    });
});

describe("默认树里区域的显隐（ui/workbench-layout.md 输出 1，workbench/views.md 输出 18）", () => {
    it("有视图的区域显示、没有的隐藏；只有 revealRegion: false 的视图时区域照样有这些入口、但保持隐藏，混进一个普通视图就显示", () => {
        const quiet = {...VIEW("panel", 1), revealRegion: false};
        const onlyQuiet = defaultLayoutDoc(new Map([["a", VIEW("sidebar", 1)], ["tasks", quiet], ["notes", {...quiet, order: 2}]]));
        expect(onlyQuiet.panels.sidebar?.hidden).toBeUndefined();
        expect(onlyQuiet.panels.auxiliarybar?.hidden).toBe(true);
        expect(onlyQuiet.panels.panel?.hidden).toBe(true);
        expect(onlyQuiet.panels.panel?.entries).toEqual(["view:tasks", "view:notes"]);
        const mixed = defaultLayoutDoc(new Map([["tasks", quiet], ["g", VIEW("panel", 2)]]));
        expect(mixed.panels.panel?.hidden).toBeUndefined();
    });
});

describe("从默认树出发，任何操作之后都合骨架", () => {
    /** 两种分法都走一遍：随机切。 */
    let shared = false;
    const policy = createLayoutPolicy({dropSplit: () => (shared ? "shared" : "half")});
    /** 这一刻的缝，和拖动时一样按矩形算。 */
    function seamsOf(doc: LayoutDoc): ReturnType<typeof layoutSeamsOf> {
        const rects = previewPanelRects(doc, Object.keys(doc.panels), layoutProjectionOptions({doc, catalog: CATALOG, viewportWidth: 1440}), {width: 1440, height: 864}, 1);
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
        } else if (roll < 0.85) {
            // 放进一个区域的一个容器（“移动到”、重置位置、浮动窗回到停靠）：已有的容器，或一个新的用户容器。
            const view = pick(random, tabs.filter((tab) => tab.kind === "view"));
            const region = pick(random, ["sidebar", "auxiliarybar", "panel"] as const) ?? "sidebar";
            const container = pick(random, [...(doc.panels[region]?.entries ?? []), `custom:${String(Math.floor(random() * 3))}`]) ?? "custom:0";
            const target = sectionLanding(doc, region, container);
            if (view === undefined || target === null) return doc;
            result = moveTabToEdge(doc, {tab: tabKey(view), target, container}, policy);
        } else if (roll < 0.92) {
            // 打开、关闭编辑器标签。
            const closing = tabs.filter((tab) => tab.kind === "tab");
            if (random() < 0.5 && closing[0] !== undefined) result = removeTab(doc, tabKey(pick(random, closing) ?? closing[0]));
            else {
                const panel = pick(random, panelsOf(doc, "editor"));
                if (panel === undefined) return doc;
                result = insertTab(doc, {panel, tab: nextTab()});
            }
        } else {
            // “移动到”的新容器：和 store 的 `moveView` 同一个目标，区域里新建一个只含它的用户容器，挂在锚后面。
            const view = pick(random, tabs.filter((tab) => tab.kind === "view"));
            const region = pick(random, ["sidebar", "auxiliarybar", "panel"] as const) ?? "sidebar";
            const container = `custom:new-${String(Math.floor(random() * 1000))}`;
            const target = sectionLanding(doc, region, container);
            if (view === undefined || target === null) return doc;
            result = moveTabToEdge(doc, {tab: tabKey(view), target, container}, policy);
        }
        // 和 store 的写入出口一样：每次提交之后归整入口与当前容器。
        return result.ok ? settleContainers(result.doc) : doc;
    }

    it("随机操作：拖动的所有落点、显隐、收起、放进容器、开关标签、新容器", () => {
        for (let seed = 1; seed <= 20; seed += 1) {
            const random = randomOf(seed);
            let counter = 0;
            let doc = defaultLayoutDoc(CATALOG, CONTAINERS);
            for (let index = 0; index < 60; index += 1) {
                doc = step(doc, random, () => {
                    counter += 1;
                    return {kind: "tab", type: "nbook.editor", tabId: `t${String(counter)}`};
                });
                const context = `种子 ${String(seed)} 第 ${String(index)} 步`;
                expect([context, fitsSkeleton(doc)]).toEqual([context, true]);
                expect([context, validateLayoutDoc(doc).ok]).toEqual([context, true]);
                // 区域有容器时当前容器是其中有成员的一个；没有时没有当前容器（被拖空时隐藏，用户打开的空区域显示为空面板，ADR 0050）。
                for (const region of ["sidebar", "auxiliarybar", "panel"] as const) {
                    const present = regionContainers(doc, region).map((container) => container.id);
                    const anchor = doc.panels[region];
                    const active = anchor?.activeContainer ?? null;
                    expect([context, region, present.length === 0 ? active === null : active !== null && present.includes(active)]).toEqual([context, region, true]);
                }
            }
            // 存盘前去掉动态标签（模板、未绑定项目的窗口）之后也合。
            expect(fitsSkeleton(stripDynamicTabs(doc))).toBe(true);
            // 视图都还在：锚不见了的话视图就没地方放了。
            for (const viewId of CATALOG.keys()) expect(findTab(doc, tabKey({kind: "view", viewId}))).not.toBeNull();
        }
        // 一千多步，每步拖动都要按矩形算一遍缝：一个视图一个分节之后面板比以前多，本机空闲时三秒多，别的进程占着 CPU 时过默认的 5 秒。
    }, 30_000);
});
