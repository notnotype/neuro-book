import {describe, expect, it} from "vitest";
import type {Grid, GridAxis, GridBranchChange, GridExtent, GridGestureCommit, GridLayoutResult, GridNode} from "@notnotype/nb-ui/layout";
import {
    createShellGrid,
    projectShell,
    settleShellGesture,
    shellSettleableBranch,
    SHELL_ACTIVITY_WIDTH,
    SHELL_BODY_ID,
    SHELL_COMPACT_WIDTH,
    SHELL_CONTENT_ROW_ID,
    SHELL_EDITOR_MIN_HEIGHT,
    SHELL_MAIN_ID,
    SHELL_PANEL_COLLAPSED_HEIGHT,
    SHELL_PANEL_DEFAULT_HEIGHT,
    SHELL_PANEL_ID,
    SHELL_PANEL_STACK_ID,
    SHELL_ROOT_ID,
    SHELL_SIZE_DEFAULTS,
    SHELL_STATUSBAR_HEIGHT,
    SHELL_STATUSBAR_ID,
    SHELL_TITLEBAR_HEIGHT,
    SHELL_TITLEBAR_ID,
    type ShellProjectionInput,
} from "nbook/app/utils/workbench/layout";
import {SHELL_PANEL_ALIGNMENTS, SHELL_PANEL_POSITIONS, type ShellPanelAlignment, type ShellPanelPosition} from "nbook/app/utils/workbench/panel-state";

const VIEWPORT: GridExtent = {width: 1440, height: 900};

type Rect = {left: number; top: number; right: number; bottom: number};

function project(overrides: Partial<ShellProjectionInput> = {}) {
    const input: ShellProjectionInput = {
        extent: VIEWPORT,
        preferences: SHELL_SIZE_DEFAULTS,
        panel: {position: "bottom", alignment: "center", hidden: false, collapsed: false, maximized: false},
        hiddenParts: [],
        ...overrides,
    };
    const projection = projectShell(input);
    const grid = createShellGrid(projection);
    const layout = grid.layout(input.extent);
    return {projection, grid, layout};
}

/** 从树 + 呈现尺寸复原每个节点的绝对矩形：非重叠、在容器内这类断言只有它证得了。 */
function collectRects(node: GridNode<string>, layout: GridLayoutResult, origin: {x: number; y: number}): Record<string, Rect> {
    const size = layout.sizes[node.id] ?? {width: 0, height: 0};
    const rects: Record<string, Rect> = {
        [node.id]: {left: origin.x, top: origin.y, right: origin.x + size.width, bottom: origin.y + size.height},
    };
    if (node.kind === "branch") {
        const horizontal = node.orientation === "horizontal";
        const sash = layout.sashSizes[node.id] ?? [];
        let cursor = horizontal ? origin.x : origin.y;
        node.children.forEach((child, index) => {
            const childSize = layout.sizes[child.id] ?? {width: 0, height: 0};
            const childOrigin = horizontal ? {x: cursor, y: origin.y} : {x: origin.x, y: cursor};
            Object.assign(rects, collectRects(child, layout, childOrigin));
            cursor += (horizontal ? childSize.width : childSize.height) + (sash[index] ?? 0);
        });
    }
    return rects;
}

function rectsOf(layout: GridLayoutResult, tree: GridNode<string>): Record<string, Rect> {
    return collectRects(tree, layout, {x: 0, y: 0});
}

function leafExtent(layout: GridLayoutResult, id: string): GridExtent {
    const size = layout.sizes[id];
    if (!size) throw new Error(`呈现缺少节点：${id}`);
    return size;
}

describe("外壳几何：默认拓扑与 activity 通高", () => {
    it("默认 bottom/center：activity 与主体等高，Panel 落在 editor 的横向范围内", () => {
        const {layout, grid} = project();
        const root = grid.root();
        if (root?.kind !== "branch") throw new Error("需要根分支");
        const rects = rectsOf(layout, root);
        const activity = rects.activity!;
        const body = rects[SHELL_BODY_ID]!;
        const panel = rects[SHELL_PANEL_ID]!;
        const editor = rects.editor!;
        expect(activity.bottom).toBeCloseTo(body.bottom, 6);
        expect(activity.top).toBeCloseTo(body.top, 6);
        // Panel 与 editor 同列：左右边界一致，绝不进入 activity。
        expect(panel.left).toBeCloseTo(editor.left, 6);
        expect(panel.right).toBeCloseTo(editor.right, 6);
        expect(panel.left).toBeGreaterThanOrEqual(activity.right - 1e-6);
        expect(leafExtent(layout, SHELL_TITLEBAR_ID).height).toBe(SHELL_TITLEBAR_HEIGHT);
        expect(leafExtent(layout, SHELL_STATUSBAR_ID).height).toBe(SHELL_STATUSBAR_HEIGHT);
        expect(leafExtent(layout, SHELL_PANEL_ID).height).toBe(SHELL_PANEL_DEFAULT_HEIGHT);
    });

    it.each(SHELL_PANEL_POSITIONS.flatMap((position) => SHELL_PANEL_ALIGNMENTS.map((alignment) => ({position, alignment}))))(
        "$position/$alignment：Panel 不与 activity 交叠，也不越出容器",
        ({position, alignment}: {position: ShellPanelPosition; alignment: ShellPanelAlignment}) => {
            const {layout, grid} = project({panel: {position, alignment, hidden: false, collapsed: false, maximized: false}});
            const root = grid.root();
            if (root?.kind !== "branch") throw new Error("需要根分支");
            const rects = rectsOf(layout, root);
            const panel = rects[SHELL_PANEL_ID]!;
            const activity = rects.activity!;
            expect(panel.left).toBeGreaterThanOrEqual(activity.right - 1e-6);
            expect(panel.left).toBeGreaterThanOrEqual(0);
            expect(panel.top).toBeGreaterThanOrEqual(0);
            expect(panel.right).toBeLessThanOrEqual(VIEWPORT.width + 1e-6);
            expect(panel.bottom).toBeLessThanOrEqual(VIEWPORT.height + 1e-6);
            expect(panel.right - panel.left).toBeGreaterThan(0);
            expect(panel.bottom - panel.top).toBeGreaterThan(0);
            // 所有叶都非负。
            for (const size of Object.values(layout.sizes)) {
                expect(size.width).toBeGreaterThanOrEqual(0);
                expect(size.height).toBeGreaterThanOrEqual(0);
            }
        },
    );

    it("隐藏侧栏与 Panel 时叶消失且余量归编辑器；隐藏 activity 后 Panel 仍不越界", () => {
        const withoutSidebars = project({hiddenParts: ["left", "right"]});
        expect(withoutSidebars.grid.find("left")).toBeNull();
        expect(withoutSidebars.grid.find("right")).toBeNull();
        expect(withoutSidebars.projection.mode).toBe("split");

        const hiddenPanel = project({panel: {position: "bottom", alignment: "center", hidden: true, collapsed: false, maximized: false}});
        expect(hiddenPanel.grid.find(SHELL_PANEL_ID)).toBeNull();
        expect(hiddenPanel.grid.find("editor")).not.toBeNull();

        const hiddenActivity = project({hiddenParts: ["activity"]});
        const root = hiddenActivity.grid.root();
        if (root?.kind !== "branch") throw new Error("需要根分支");
        const rects = rectsOf(hiddenActivity.layout, root);
        expect(rects.activity).toBeUndefined();
        expect(rects[SHELL_PANEL_ID]!.left).toBeGreaterThanOrEqual(0);
    });

    it("最大化：Panel 占满编辑区所在列，侧栏与活动栏尺寸不变，editor 退到 0", () => {
        const {layout, grid} = project({panel: {position: "bottom", alignment: "center", hidden: false, collapsed: false, maximized: true}});
        const root = grid.root();
        if (root?.kind !== "branch") throw new Error("需要根分支");
        const rects = rectsOf(layout, root);
        const stack = rects[SHELL_PANEL_STACK_ID]!;
        const panel = rects[SHELL_PANEL_ID]!;
        expect(leafExtent(layout, "editor").height).toBe(0);
        expect(panel.top).toBeCloseTo(stack.top, 6);
        expect(panel.bottom).toBeCloseTo(stack.bottom, 6);
        expect(leafExtent(layout, "activity").width).toBe(SHELL_ACTIVITY_WIDTH);
        expect(rects.activity!.bottom).toBeCloseTo(rects[SHELL_BODY_ID]!.bottom, 6);
    });

    it("短高度：Panel 仅在呈现退到 32px 标题头，editor 仍拿得到最小高度", () => {
        const extent = {width: 1440, height: 260};
        const {projection, layout} = project({extent});
        expect(projection.effectivePanel.collapsed).toBe(true);
        expect(leafExtent(layout, SHELL_PANEL_ID).height).toBe(SHELL_PANEL_COLLAPSED_HEIGHT);
        const editor = leafExtent(layout, "editor").height;
        expect(editor).toBeGreaterThanOrEqual(SHELL_EDITOR_MIN_HEIGHT);
        expect(extent.height - (SHELL_TITLEBAR_HEIGHT + SHELL_STATUSBAR_HEIGHT + SHELL_PANEL_COLLAPSED_HEIGHT + editor)).toBeLessThanOrEqual(1e-6);
    });

    it("极窄容器进入紧凑呈现，不再产生可拖边界", () => {
        const extent = {width: SHELL_COMPACT_WIDTH - 10, height: 900};
        const {projection, grid, layout} = project({extent});
        expect(projection.mode).toBe("compact");
        expect(projection.effectivePanel).toMatchObject({position: "bottom", alignment: "justify", maximized: false});
        expect(Object.values(layout.sashSizes).flat().every((size) => size === 0)).toBe(true);
        const root = grid.root();
        if (root?.kind !== "branch") throw new Error("需要根分支");
        const rects = rectsOf(layout, root);
        expect(rects.activity!.bottom).toBeCloseTo(rects[SHELL_BODY_ID]!.bottom, 6);
        for (const size of Object.values(layout.sizes)) {
            expect(size.width).toBeGreaterThanOrEqual(0);
            expect(size.height).toBeGreaterThanOrEqual(0);
        }
    });
});

describe("外壳手势结算：只保存直接主动的叶", () => {
    /** 交互层随 `resize` 回传的代际键；与提交里的不一致就是跨工作面的迟到手势。 */
    const GESTURE_CONTEXT = "project:/projects/a";

    /** 分支直接子节点沿主轴（分支方向）的呈现 px：手势基线就是这份数字。 */
    function baselineOf(grid: Grid<string>, layout: GridLayoutResult, branchId: string): Record<string, number> {
        const node = grid.find(branchId);
        if (!node || node.kind !== "branch") throw new Error(`树里没有分支：${branchId}`);
        const axis: GridAxis = node.orientation === "horizontal" ? "width" : "height";
        return Object.fromEntries(node.children.map((child) => [child.id, layout.sizes[child.id]?.[axis] ?? 0]));
    }

    /** 基线的一份副本：把 `delta` 从 `from` 挪给 `to`（同一分支内总量守恒）。 */
    function shift(baseline: Readonly<Record<string, number>>, from: string, to: string, delta: number): Record<string, number> {
        return {...baseline, [from]: baseline[from]! - delta, [to]: baseline[to]! + delta};
    }

    /** 一条分支变化：`baseline` 取当前呈现 px，`extent` 是该分支求解时的预览盒。 */
    function changeOf(
        grid: Grid<string>,
        layout: GridLayoutResult,
        branchId: string,
        active: readonly string[],
        targetOf: (baseline: Record<string, number>) => Record<string, number>,
    ): GridBranchChange {
        const node = grid.find(branchId);
        if (!node || node.kind !== "branch") throw new Error(`树里没有分支：${branchId}`);
        const axis: GridAxis = node.orientation === "horizontal" ? "width" : "height";
        const baseline = baselineOf(grid, layout, branchId);
        return {
            branchId,
            axis,
            baseline,
            target: targetOf(baseline),
            extent: layout.sizes[branchId] ?? VIEWPORT,
            active,
            compensated: [],
            collapsed: {},
        };
    }

    /** 一次手势的完整提交：多根轴（交汇处）装在同一份 `changes` 里。 */
    function commitOf(changes: readonly GridBranchChange[], contextKey: string = GESTURE_CONTEXT): GridGestureCommit {
        return {sessionId: "gesture-1", contextKey, source: "pointer", revision: 3, extent: VIEWPORT, changes};
    }

    it("宽度手势只写主动侧栏；被动的兄弟补偿不落账", () => {
        const {grid, layout} = project();
        const change = changeOf(grid, layout, SHELL_BODY_ID, ["left"], (baseline) => shift(baseline, "left", SHELL_PANEL_STACK_ID, 20));
        expect(settleShellGesture({grid, contextKey: GESTURE_CONTEXT, commit: commitOf([change])}))
            .toEqual({ok: true, patch: {leftPanelWidth: change.baseline.left! - 20}});
        // 补丁真的落了账：下一次呈现里左栏就是拖动后的宽度。
        expect(grid.layout(VIEWPORT).sizes.left?.width).toBeCloseTo(change.baseline.left! - 20, 6);
    });

    it("高度手势写 Panel 高度，不写宽度", () => {
        const {grid, layout} = project();
        const change = changeOf(grid, layout, SHELL_PANEL_STACK_ID, [SHELL_PANEL_ID], (baseline) => shift(baseline, "editor", SHELL_PANEL_ID, 50));
        expect(settleShellGesture({grid, contextKey: GESTURE_CONTEXT, commit: commitOf([change])}))
            .toEqual({ok: true, patch: {panelHeight: change.baseline[SHELL_PANEL_ID]! + 50}});
        expect(grid.layout(VIEWPORT).sizes[SHELL_PANEL_ID]?.height).toBeCloseTo(change.baseline[SHELL_PANEL_ID]! + 50, 6);
    });

    it("侧向 Panel 的宽度手势写成 panelWidth，而不是高度", () => {
        const {grid, layout} = project({panel: {position: "left", alignment: "center", hidden: false, collapsed: false, maximized: false}});
        const change = changeOf(grid, layout, SHELL_PANEL_STACK_ID, [SHELL_PANEL_ID], (baseline) => shift(baseline, "editor", SHELL_PANEL_ID, 40));
        expect(settleShellGesture({grid, contextKey: GESTURE_CONTEXT, commit: commitOf([change])}))
            .toEqual({ok: true, patch: {panelWidth: change.baseline[SHELL_PANEL_ID]! + 40}});
    });

    it("交汇处两条轴一次批量落账：补丁同时含主动侧栏宽度与 Panel 高度", () => {
        const {grid, layout} = project();
        const bodyChange = changeOf(grid, layout, SHELL_BODY_ID, ["left"], (baseline) => shift(baseline, "left", SHELL_PANEL_STACK_ID, 40));
        const stackChange = changeOf(grid, layout, SHELL_PANEL_STACK_ID, [SHELL_PANEL_ID], (baseline) => shift(baseline, "editor", SHELL_PANEL_ID, 50));
        expect(settleShellGesture({grid, contextKey: GESTURE_CONTEXT, commit: commitOf([bodyChange, stackChange])})).toEqual({
            ok: true,
            patch: {
                leftPanelWidth: bodyChange.baseline.left! - 40,
                panelHeight: stackChange.baseline[SHELL_PANEL_ID]! + 50,
            },
        });
        const applied = grid.layout(VIEWPORT);
        expect(applied.sizes.left?.width).toBeCloseTo(bodyChange.baseline.left! - 40, 6);
        expect(applied.sizes[SHELL_PANEL_ID]?.height).toBeCloseTo(stackChange.baseline[SHELL_PANEL_ID]! + 50, 6);
    });

    it("整批原子：第二条变化非法时第一条也不落账", () => {
        const {grid, layout} = project();
        const bodyChange = changeOf(grid, layout, SHELL_BODY_ID, ["left"], (baseline) => shift(baseline, "left", SHELL_PANEL_STACK_ID, 40));
        // 只把 Panel 加高而 editor 不让位：目标不守恒。
        const brokenChange = changeOf(grid, layout, SHELL_PANEL_STACK_ID, [SHELL_PANEL_ID], (baseline) => ({...baseline, [SHELL_PANEL_ID]: baseline[SHELL_PANEL_ID]! + 50}));
        const settled = settleShellGesture({grid, contextKey: GESTURE_CONTEXT, commit: commitOf([bodyChange, brokenChange])});

        expect(settled.ok).toBe(false);
        expect(String(settled.ok ? "" : settled.reason)).toContain("不守恒");
        expect(grid.layout(VIEWPORT).sizes.left?.width).toBeCloseTo(bodyChange.baseline.left!, 6);
    });

    it("纯余量分支的手势不产生保存；不可结算分支被识别出来", () => {
        const {grid, layout} = project({panel: {position: "bottom", alignment: "left", hidden: false, collapsed: false, maximized: false}});
        expect(shellSettleableBranch(grid, SHELL_CONTENT_ROW_ID)).toBe(true);
        expect(shellSettleableBranch(grid, SHELL_MAIN_ID)).toBe(false);
        expect(shellSettleableBranch(grid, SHELL_ROOT_ID)).toBe(false);

        // content-row 里的 editor 只是余量：手势落账了，但没有可保存的字段。
        const change = changeOf(grid, layout, SHELL_CONTENT_ROW_ID, ["editor"], (baseline) => shift(baseline, "left", "editor", 30));
        expect(settleShellGesture({grid, contextKey: GESTURE_CONTEXT, commit: commitOf([change])})).toEqual({ok: true, patch: {}});
    });

    it("代际不匹配、空提交与不可结算分支都被拒绝，且树不变", () => {
        const {grid, layout} = project();
        const change = changeOf(grid, layout, SHELL_BODY_ID, ["left"], (baseline) => shift(baseline, "left", SHELL_PANEL_STACK_ID, 20));
        const before = grid.layout(VIEWPORT);

        expect(settleShellGesture({grid, contextKey: GESTURE_CONTEXT, commit: commitOf([change], "project:/projects/b")}))
            .toEqual({ok: false, reason: "工作面已切换，本次调整没有落账"});
        expect(settleShellGesture({grid, contextKey: GESTURE_CONTEXT, commit: commitOf([])}))
            .toEqual({ok: false, reason: "本次手势没有改变任何尺寸"});

        // 根分支只有刚性条与主体：不产生保存的分支整场拒绝，不留下半状态。
        const rootChange = changeOf(grid, layout, SHELL_ROOT_ID, ["titlebar"], (baseline) => shift(baseline, SHELL_MAIN_ID, "titlebar", 10));
        const rejected = settleShellGesture({grid, contextKey: GESTURE_CONTEXT, commit: commitOf([rootChange])});
        expect(rejected.ok).toBe(false);
        expect(String(rejected.ok ? "" : rejected.reason)).toContain("不产生保存");

        // 树里根本没有的分支同样整场拒绝。
        const ghost = settleShellGesture({grid, contextKey: GESTURE_CONTEXT, commit: commitOf([{...change, branchId: "missing"}])});
        expect(ghost.ok).toBe(false);
        expect(String(ghost.ok ? "" : ghost.reason)).toContain("missing");

        expect(grid.layout(VIEWPORT).sizes.left?.width).toBeCloseTo(before.sizes.left!.width, 6);
    });

    it("外部容器变化让面板退化后，旧基线的提交整场拒绝", () => {
        // 基线来自 900px 高的容器；提交到达时面板已经按 260px 高退到 32px 标题头。
        const tall = project();
        const short = project({extent: {width: VIEWPORT.width, height: 260}});
        const change = changeOf(tall.grid, tall.layout, SHELL_PANEL_STACK_ID, [SHELL_PANEL_ID], (baseline) => shift(baseline, "editor", SHELL_PANEL_ID, 50));
        const settled = settleShellGesture({grid: short.grid, contextKey: GESTURE_CONTEXT, commit: commitOf([change])});

        expect(settled.ok).toBe(false);
        expect(String(settled.ok ? "" : settled.reason)).toContain("基线已失效");
        expect(short.grid.layout({width: VIEWPORT.width, height: 260}).sizes[SHELL_PANEL_ID]?.height).toBe(SHELL_PANEL_COLLAPSED_HEIGHT);
    });
});
