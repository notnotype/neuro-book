/**
 * 外壳几何（docs/specs/ui/workbench-shell.md 外壳一输出 1–7、验收 1、5）：纯函数，真实的 nb-ui `createGrid`。
 * 手势按产品的落账顺序走：`shellGestureProblem` 核对 → `grid.resizeBranches` 落账（产品里由 `useGridLayout` 调）→
 * `shellPatch` 算补丁。
 */

import {describe, expect, it} from "bun:test";

import type {Grid, GridAxis, GridBranchChange, GridExtent, GridGestureCommit, GridLayoutResult, GridNode} from "@notnotype/nb-ui/layout";

import {
    createShellGrid,
    projectShell,
    SHELL_ACTIVITYBAR_WIDTH,
    SHELL_BODY_ID,
    SHELL_COMPACT_WIDTH,
    SHELL_CONTENT_ROW_ID,
    SHELL_EDITOR_MIN_HEIGHT,
    SHELL_MAIN_ID,
    SHELL_PANEL_COLLAPSED_HEIGHT,
    SHELL_PANEL_DEFAULT_HEIGHT,
    SHELL_PANEL_STACK_ID,
    SHELL_ROOT_ID,
    SHELL_SIZE_DEFAULTS,
    SHELL_STATUSBAR_HEIGHT,
    SHELL_TITLEBAR_HEIGHT,
    shellGestureProblem,
    shellPatch,
    shellSettleableBranch,
} from "./layout";
import type {ShellProjectionInput, ShellSizePatch} from "./layout";
import {PANEL_ALIGNMENTS, PANEL_POSITIONS} from "./panel-state";
import type {PanelState} from "./panel-state";

const VIEWPORT: GridExtent = {width: 1440, height: 900};
const PANEL: PanelState = {position: "bottom", alignment: "center", hidden: false, collapsed: false, maximized: false};

interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

function project(overrides: Partial<ShellProjectionInput> = {}) {
    const input: ShellProjectionInput = {extent: VIEWPORT, preferences: SHELL_SIZE_DEFAULTS, panel: PANEL, hiddenParts: [], ...overrides};
    const projection = projectShell(input);
    const grid = createShellGrid(projection);
    return {projection, grid, layout: grid.layout(input.extent)};
}

/** 从树与呈现尺寸复原每个节点的绝对矩形：不重叠、在容器内这类断言只有它证得了。 */
function collectRects(node: GridNode<string>, layout: GridLayoutResult, origin: {x: number; y: number}): Record<string, Rect> {
    const size = layout.sizes[node.id] ?? {width: 0, height: 0};
    const rects: Record<string, Rect> = {[node.id]: {left: origin.x, top: origin.y, right: origin.x + size.width, bottom: origin.y + size.height}};
    if (node.kind === "branch") {
        const horizontal = node.orientation === "horizontal";
        const sash = layout.sashSizes[node.id] ?? [];
        let cursor = horizontal ? origin.x : origin.y;
        node.children.forEach((child, index) => {
            const childSize = layout.sizes[child.id] ?? {width: 0, height: 0};
            Object.assign(rects, collectRects(child, layout, horizontal ? {x: cursor, y: origin.y} : {x: origin.x, y: cursor}));
            cursor += (horizontal ? childSize.width : childSize.height) + (sash[index] ?? 0);
        });
    }
    return rects;
}

function rectsOf(grid: Grid<string>, layout: GridLayoutResult): Record<string, Rect> {
    const root = grid.root();
    if (root?.kind !== "branch") throw new Error("需要根分支");
    return collectRects(root, layout, {x: 0, y: 0});
}

function leafExtent(layout: GridLayoutResult, id: string): GridExtent {
    const size = layout.sizes[id];
    if (size === undefined) throw new Error(`呈现缺少节点：${id}`);
    return size;
}

describe("拓扑与 activitybar 通高", () => {
    it("默认 bottom/center：activitybar 与主体等高，面板落在 editor 的横向范围内", () => {
        const {layout, grid} = project();
        const rects = rectsOf(grid, layout);
        expect(rects.activitybar!.top).toBeCloseTo(rects[SHELL_BODY_ID]!.top, 6);
        expect(rects.activitybar!.bottom).toBeCloseTo(rects[SHELL_BODY_ID]!.bottom, 6);
        expect(rects.panel!.left).toBeCloseTo(rects.editor!.left, 6);
        expect(rects.panel!.right).toBeCloseTo(rects.editor!.right, 6);
        expect(rects.panel!.left).toBeGreaterThanOrEqual(rects.activitybar!.right - 1e-6);
        expect(leafExtent(layout, "titlebar").height).toBe(SHELL_TITLEBAR_HEIGHT);
        expect(leafExtent(layout, "statusbar").height).toBe(SHELL_STATUSBAR_HEIGHT);
        expect(leafExtent(layout, "panel").height).toBe(SHELL_PANEL_DEFAULT_HEIGHT);
        expect(leafExtent(layout, "sidebar").width).toBe(340);
        expect(leafExtent(layout, "auxiliarybar").width).toBe(400);
    });

    for (const position of PANEL_POSITIONS) {
        for (const alignment of PANEL_ALIGNMENTS) {
            it(`${position}/${alignment}：面板不与 activitybar 交叠，也不越出容器；所有叶非负`, () => {
                const {layout, grid} = project({panel: {...PANEL, position, alignment}});
                const rects = rectsOf(grid, layout);
                const panel = rects.panel!;
                expect(panel.left).toBeGreaterThanOrEqual(rects.activitybar!.right - 1e-6);
                expect(panel.top).toBeGreaterThanOrEqual(0);
                expect(panel.right).toBeLessThanOrEqual(VIEWPORT.width + 1e-6);
                expect(panel.bottom).toBeLessThanOrEqual(VIEWPORT.height + 1e-6);
                expect(panel.right - panel.left).toBeGreaterThan(0);
                expect(panel.bottom - panel.top).toBeGreaterThan(0);
                for (const size of Object.values(layout.sizes)) {
                    expect(size.width).toBeGreaterThanOrEqual(0);
                    expect(size.height).toBeGreaterThanOrEqual(0);
                }
            });
        }
    }

    it("跨度：justify 横跨左右侧栏、left 只含侧栏、right 只含右栏、center 只在 editor 下", () => {
        const span = (alignment: PanelState["alignment"]) => {
            const {layout, grid} = project({panel: {...PANEL, alignment}});
            const rects = rectsOf(grid, layout);
            return {panel: rects.panel!, sidebar: rects.sidebar!, auxiliarybar: rects.auxiliarybar!, editor: rects.editor!};
        };
        const justify = span("justify");
        expect(justify.panel.left).toBeCloseTo(justify.sidebar.left, 6);
        expect(justify.panel.right).toBeCloseTo(justify.auxiliarybar.right, 6);
        const left = span("left");
        expect(left.panel.left).toBeCloseTo(left.sidebar.left, 6);
        expect(left.panel.right).toBeCloseTo(left.editor.right, 6);
        const right = span("right");
        expect(right.panel.left).toBeCloseTo(right.editor.left, 6);
        expect(right.panel.right).toBeCloseTo(right.auxiliarybar.right, 6);
    });

    it("隐藏侧栏与面板时叶消失且余量归编辑器；隐藏 activitybar 后面板仍不越界；不认识的 Part 名被忽略", () => {
        const withoutSidebars = project({hiddenParts: ["sidebar", "auxiliarybar", "editor", "statusbar"]});
        expect(withoutSidebars.grid.find("sidebar")).toBeNull();
        expect(withoutSidebars.grid.find("auxiliarybar")).toBeNull();
        expect(withoutSidebars.grid.find("editor")).not.toBeNull();
        expect(withoutSidebars.grid.find("statusbar")).not.toBeNull();
        expect(withoutSidebars.projection.mode).toBe("split");

        const hiddenPanel = project({panel: {...PANEL, hidden: true}});
        expect(hiddenPanel.grid.find("panel")).toBeNull();

        const hiddenActivity = project({hiddenParts: ["activitybar"]});
        const rects = rectsOf(hiddenActivity.grid, hiddenActivity.layout);
        expect(rects.activitybar).toBeUndefined();
        expect(rects.panel!.left).toBeGreaterThanOrEqual(0);
    });

    it("最大化：面板占满编辑器所在列，侧栏与 activitybar 尺寸不变，editor 退到 0；不合法的组合不最大化", () => {
        const {layout, grid} = project({panel: {...PANEL, maximized: true}});
        const rects = rectsOf(grid, layout);
        expect(leafExtent(layout, "editor").height).toBe(0);
        expect(rects.panel!.top).toBeCloseTo(rects[SHELL_PANEL_STACK_ID]!.top, 6);
        expect(rects.panel!.bottom).toBeCloseTo(rects[SHELL_PANEL_STACK_ID]!.bottom, 6);
        expect(leafExtent(layout, "activitybar").width).toBe(SHELL_ACTIVITYBAR_WIDTH);
        expect(leafExtent(layout, "sidebar").width).toBe(340);
        expect(project({panel: {...PANEL, alignment: "justify", maximized: true}}).projection.effectivePanel.maximized).toBe(false);
        expect(project({panel: {...PANEL, collapsed: true, maximized: true}}).projection.effectivePanel.maximized).toBe(false);
        expect(project({panel: {...PANEL, position: "left", alignment: "justify", maximized: true}}).projection.effectivePanel.maximized).toBe(true);
    });

    it("左右位置忽略保存的收起与对齐；改回水平位置时按保存值生效", () => {
        const side = project({panel: {...PANEL, position: "right", alignment: "justify", collapsed: true}});
        expect(side.projection.effectivePanel).toMatchObject({position: "right", alignment: "center", collapsed: false});
        expect(project({panel: {...PANEL, alignment: "justify", collapsed: true}}).projection.effectivePanel).toMatchObject({alignment: "justify", collapsed: true});
    });
});

describe("降级与紧凑呈现", () => {
    it("短高度：面板仅在呈现退到 32px 标题头，editor 仍有最小高度，并给出诊断", () => {
        const extent = {width: 1440, height: 260};
        const {projection, layout} = project({extent});
        expect(projection.effectivePanel.collapsed).toBe(true);
        expect(leafExtent(layout, "panel").height).toBe(SHELL_PANEL_COLLAPSED_HEIGHT);
        const editor = leafExtent(layout, "editor").height;
        expect(editor).toBeGreaterThanOrEqual(SHELL_EDITOR_MIN_HEIGHT);
        expect(extent.height - (SHELL_TITLEBAR_HEIGHT + SHELL_STATUSBAR_HEIGHT + SHELL_PANEL_COLLAPSED_HEIGHT + editor)).toBeLessThanOrEqual(1e-6);
        expect(projection.issues.some((issue) => issue.includes("标题头"))).toBe(true);
    });

    it("极矮容器：所有叶非负、editor 取非负余量", () => {
        const {layout} = project({extent: {width: 1440, height: 80}});
        for (const size of Object.values(layout.sizes)) expect(size.height).toBeGreaterThanOrEqual(0);
    });

    it("容器宽 < 800 进入紧凑呈现：面板强制底部两端对齐、不最大化、没有可拖边界，activitybar 仍通高", () => {
        const {projection, grid, layout} = project({extent: {width: SHELL_COMPACT_WIDTH - 10, height: 900}, panel: {...PANEL, position: "left", maximized: true}});
        expect(projection.mode).toBe("compact");
        expect(projection.effectivePanel).toMatchObject({position: "bottom", alignment: "justify", maximized: false});
        expect(Object.values(layout.sashSizes).flat().every((size) => size === 0)).toBe(true);
        const rects = rectsOf(grid, layout);
        expect(rects.activitybar!.bottom).toBeCloseTo(rects[SHELL_BODY_ID]!.bottom, 6);
        for (const size of Object.values(layout.sizes)) {
            expect(size.width).toBeGreaterThanOrEqual(0);
            expect(size.height).toBeGreaterThanOrEqual(0);
        }
    });

    it("偏好装不下时按可缩空间压缩呈现、不改偏好；越界偏好只夹取", () => {
        const wide = {...SHELL_SIZE_DEFAULTS, sidebarWidth: 9000, panelHeight: -5};
        const {layout, projection} = project({preferences: wide});
        expect(leafExtent(layout, "sidebar").width).toBe(560);
        expect(leafExtent(layout, "panel").height).toBe(80);
        const narrow = project({extent: {width: 900, height: 900}, preferences: {...SHELL_SIZE_DEFAULTS, sidebarWidth: 560}});
        expect(leafExtent(narrow.layout, "sidebar").width).toBeLessThan(560);
        expect(leafExtent(narrow.layout, "sidebar").width).toBeGreaterThanOrEqual(160);
        expect(narrow.projection.issues.some((issue) => issue.includes("压缩"))).toBe(true);
        expect(projection.mode).toBe("split");
    });

    it("拖到零：内容 0px、保留 1px 边界，节点仍带展开意图；隐藏的 Part 不算拖到零", () => {
        const {layout, grid, projection} = project({dragCollapsedParts: {sidebar: true, panel: true}});
        expect(leafExtent(layout, "sidebar").width).toBe(0);
        expect(leafExtent(layout, "panel").height).toBe(0);
        expect(layout.sashSizes[SHELL_BODY_ID]![0]).toBe(1);
        const sidebar = grid.find("sidebar");
        expect(sidebar?.collapse).toMatchObject({collapsed: true, restoreSize: 340});
        expect(projection.dragCollapsed).toEqual({sidebar: true, panel: true});
        expect(project({hiddenParts: ["sidebar"], dragCollapsedParts: {sidebar: true}}).projection.dragCollapsed).toEqual({});
    });
});

describe("手势：只保存直接主动的叶", () => {
    function baselineOf(grid: Grid<string>, layout: GridLayoutResult, branchId: string): Record<string, number> {
        const node = grid.find(branchId);
        if (node === null || node.kind !== "branch") throw new Error(`树里没有分支：${branchId}`);
        const axis: GridAxis = node.orientation === "horizontal" ? "width" : "height";
        return Object.fromEntries(node.children.map((child) => [child.id, layout.sizes[child.id]?.[axis] ?? 0]));
    }

    function shift(baseline: Readonly<Record<string, number>>, from: string, to: string, delta: number): Record<string, number> {
        return {...baseline, [from]: baseline[from]! - delta, [to]: baseline[to]! + delta};
    }

    function changeOf(grid: Grid<string>, layout: GridLayoutResult, branchId: string, active: readonly string[], targetOf: (baseline: Record<string, number>) => Record<string, number>, collapsed: Record<string, boolean> = {}): GridBranchChange {
        const node = grid.find(branchId);
        if (node === null || node.kind !== "branch") throw new Error(`树里没有分支：${branchId}`);
        const baseline = baselineOf(grid, layout, branchId);
        return {branchId, axis: node.orientation === "horizontal" ? "width" : "height", baseline, target: targetOf(baseline), extent: layout.sizes[branchId] ?? VIEWPORT, active, compensated: [], collapsed};
    }

    function commitOf(changes: readonly GridBranchChange[]): GridGestureCommit {
        return {sessionId: "gesture-1", contextKey: "c", source: "pointer", revision: 3, extent: VIEWPORT, changes};
    }

    /** 产品的落账顺序：核对 → 一次 `resizeBranches` → 补丁。 */
    function settle(grid: Grid<string>, commit: GridGestureCommit): {ok: true; patch: ShellSizePatch} | {ok: false; reason: string} {
        const problem = shellGestureProblem(grid, commit);
        if (problem !== null) return {ok: false, reason: problem};
        const applied = grid.resizeBranches(commit.changes);
        if (!applied.ok) return {ok: false, reason: applied.reason};
        return {ok: true, patch: shellPatch(commit)};
    }

    it("宽度手势只写主动侧栏；被动兄弟的补偿不进补丁", () => {
        const {grid, layout} = project();
        const change = changeOf(grid, layout, SHELL_BODY_ID, ["sidebar"], (baseline) => shift(baseline, "sidebar", SHELL_PANEL_STACK_ID, 20));
        expect(settle(grid, commitOf([change]))).toEqual({ok: true, patch: {sidebarWidth: change.baseline.sidebar! - 20}});
        expect(grid.layout(VIEWPORT).sizes.sidebar?.width).toBeCloseTo(change.baseline.sidebar! - 20, 6);
    });

    it("右栏手势写 auxiliarybarWidth", () => {
        const {grid, layout} = project();
        const change = changeOf(grid, layout, SHELL_BODY_ID, ["auxiliarybar"], (baseline) => shift(baseline, "auxiliarybar", SHELL_PANEL_STACK_ID, 30));
        expect(settle(grid, commitOf([change]))).toEqual({ok: true, patch: {auxiliarybarWidth: change.baseline.auxiliarybar! - 30}});
    });

    it("高度手势写面板高度；左右面板的手势写宽度", () => {
        const bottom = project();
        const height = changeOf(bottom.grid, bottom.layout, SHELL_PANEL_STACK_ID, ["panel"], (baseline) => shift(baseline, "editor", "panel", 50));
        expect(settle(bottom.grid, commitOf([height]))).toEqual({ok: true, patch: {panelHeight: height.baseline.panel! + 50}});
        const side = project({panel: {...PANEL, position: "left"}});
        const width = changeOf(side.grid, side.layout, SHELL_PANEL_STACK_ID, ["panel"], (baseline) => shift(baseline, "editor", "panel", 40));
        expect(settle(side.grid, commitOf([width]))).toEqual({ok: true, patch: {panelWidth: width.baseline.panel! + 40}});
    });

    it("交汇处两根轴一次落账：补丁同时含侧栏宽度与面板高度", () => {
        const {grid, layout} = project();
        const body = changeOf(grid, layout, SHELL_BODY_ID, ["sidebar"], (baseline) => shift(baseline, "sidebar", SHELL_PANEL_STACK_ID, 40));
        const stack = changeOf(grid, layout, SHELL_PANEL_STACK_ID, ["panel"], (baseline) => shift(baseline, "editor", "panel", 50));
        expect(settle(grid, commitOf([body, stack]))).toEqual({ok: true, patch: {sidebarWidth: body.baseline.sidebar! - 40, panelHeight: stack.baseline.panel! + 50}});
    });

    it("整批原子：第二条变化不合法时第一条也不落账", () => {
        const {grid, layout} = project();
        const body = changeOf(grid, layout, SHELL_BODY_ID, ["sidebar"], (baseline) => shift(baseline, "sidebar", SHELL_PANEL_STACK_ID, 40));
        const broken = changeOf(grid, layout, SHELL_PANEL_STACK_ID, ["panel"], (baseline) => ({...baseline, panel: baseline.panel! + 50}));
        const settled = settle(grid, commitOf([body, broken]));
        expect(settled.ok).toBe(false);
        expect(settled.ok ? "" : settled.reason).toContain("不守恒");
        expect(grid.layout(VIEWPORT).sizes.sidebar?.width).toBeCloseTo(body.baseline.sidebar!, 6);
    });

    it("余量分支的手势不产生保存；空提交与不产生保存的分支整场拒绝，树不变", () => {
        const {grid, layout} = project({panel: {...PANEL, alignment: "left"}});
        expect(shellSettleableBranch(grid, SHELL_CONTENT_ROW_ID)).toBe(true);
        expect(shellSettleableBranch(grid, SHELL_MAIN_ID)).toBe(false);
        expect(shellSettleableBranch(grid, SHELL_ROOT_ID)).toBe(false);
        expect(shellSettleableBranch(grid, "missing")).toBe(false);
        const row = changeOf(grid, layout, SHELL_CONTENT_ROW_ID, ["editor"], (baseline) => shift(baseline, "sidebar", "editor", 30));
        expect(settle(grid, commitOf([row]))).toEqual({ok: true, patch: {}});

        const fresh = project();
        const before = fresh.grid.layout(VIEWPORT);
        expect(shellGestureProblem(fresh.grid, commitOf([]))).toBe("本次手势没有改变任何尺寸");
        const rootChange = changeOf(fresh.grid, fresh.layout, SHELL_ROOT_ID, ["titlebar"], (baseline) => shift(baseline, SHELL_MAIN_ID, "titlebar", 10));
        expect(shellGestureProblem(fresh.grid, commitOf([rootChange]))).toContain("不产生保存");
        expect(fresh.grid.layout(VIEWPORT).sizes.sidebar?.width).toBeCloseTo(before.sizes.sidebar!.width, 6);
    });

    it("拖到零：只写布尔位，尺寸保持展开意图；从零拉回写恢复尺寸", () => {
        const {grid, layout} = project();
        const collapse = changeOf(grid, layout, SHELL_BODY_ID, ["sidebar"], (baseline) => shift(baseline, "sidebar", SHELL_PANEL_STACK_ID, baseline.sidebar!), {sidebar: true});
        expect(shellPatch(commitOf([collapse]))).toEqual({dragCollapsed: {sidebar: true}});
        const restore = {...collapse, baseline: {...collapse.baseline, sidebar: 0}, target: {...collapse.baseline, sidebar: 300}, collapsed: {sidebar: false}};
        expect(shellPatch(commitOf([restore]))).toEqual({sidebarWidth: 300, dragCollapsed: {sidebar: false}});
    });

    it("外部容器变化让面板降级后，旧基线的提交整场拒绝", () => {
        const tall = project();
        const short = project({extent: {width: VIEWPORT.width, height: 260}});
        const change = changeOf(tall.grid, tall.layout, SHELL_PANEL_STACK_ID, ["panel"], (baseline) => shift(baseline, "editor", "panel", 50));
        const settled = settle(short.grid, commitOf([change]));
        expect(settled.ok).toBe(false);
        expect(short.grid.layout({width: VIEWPORT.width, height: 260}).sizes.panel?.height).toBe(SHELL_PANEL_COLLAPSED_HEIGHT);
    });
});
