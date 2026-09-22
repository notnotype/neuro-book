import {describe, expect, it} from "vitest";
import type {GridAxis, GridBranchChange, GridExtent, GridGestureCommit} from "@notnotype/nb-ui/layout";
import {
    applyEditorGesture,
    createEditorGrid,
    editorGroupIds,
    editorSplitGeometry,
    removeEditorGroup,
    splitEditorGroup,
} from "nbook/app/utils/editor-workbench/editor-groups";

const CONTAINER = {width: 1000, height: 600};

/** 一场手势里某个分支的变化：baseline/target 是该分支直接子节点的 px；其余字段只是提交结构。 */
function change(branchId: string, axis: GridAxis, baseline: Record<string, number>, target: Record<string, number>): GridBranchChange {
    return {branchId, axis, baseline, target, extent: CONTAINER, active: Object.keys(target), compensated: [], collapsed: {}};
}

/** 一次按下产出的提交；两根轴（若有）属于同一场手势、走同一个 `changes`。 */
function commitOf(...changes: GridBranchChange[]): GridGestureCommit {
    const extent: GridExtent = CONTAINER;
    return {sessionId: "session-1", contextKey: "test", source: "pointer", revision: 1, extent, changes};
}

describe("编辑器分组几何", () => {
    it("方向词映射到几何：左右是横向分支，left/top 在前", () => {
        expect(editorSplitGeometry("left")).toEqual({orientation: "horizontal", side: "before"});
        expect(editorSplitGeometry("right")).toEqual({orientation: "horizontal", side: "after"});
        expect(editorSplitGeometry("top")).toEqual({orientation: "vertical", side: "before"});
        expect(editorSplitGeometry("bottom")).toEqual({orientation: "vertical", side: "after"});
    });

    it("拆出一组后两组各占一半，原组仍是树上的叶", () => {
        const grid = createEditorGrid("main");

        expect(splitEditorGroup(grid, "main", "side", "right")).toEqual({ok: true});
        expect(editorGroupIds(grid)).toEqual(["main", "side"]);
        const sizes = grid.layout(CONTAINER).sizes;
        expect(sizes.main?.width).toBeCloseTo(499.5);
        expect(sizes.side?.width).toBeCloseTo(499.5);
    });

    it("重复 id 与未知来源组都失败且不改树", () => {
        const grid = createEditorGrid("main");
        const before = grid.serialize();

        expect(splitEditorGroup(grid, "main", "main", "right").ok).toBe(false);
        expect(splitEditorGroup(grid, "ghost", "side", "bottom").ok).toBe(false);
        expect(grid.serialize()).toEqual(before);
    });

    it("关闭一组后幸存者占满原分配，最后一组留在树上", () => {
        const grid = createEditorGrid("main");
        expect(splitEditorGroup(grid, "main", "side", "bottom").ok).toBe(true);
        expect(removeEditorGroup(grid, "side")).toEqual({ok: true});
        expect(editorGroupIds(grid)).toEqual(["main"]);
        expect(grid.root()?.id).toBe("main");
    });

    it("手势提交按 px 目标落账，非法批量一条都不改树", () => {
        const grid = createEditorGrid("main");
        expect(splitEditorGroup(grid, "main", "side", "right").ok).toBe(true);
        const baseline = {main: 499.5, side: 499.5};

        // 目标不守恒 / 缺直接子节点 / 未知分支 / 轴不是分支主轴：整批拒绝
        expect(applyEditorGesture(grid, commitOf(change("branch-side", "width", baseline, {main: 400, side: 500}))).ok).toBe(false);
        expect(applyEditorGesture(grid, commitOf(change("branch-side", "width", baseline, {main: 300}))).ok).toBe(false);
        expect(applyEditorGesture(grid, commitOf(change("ghost", "width", baseline, {main: 300, side: 699}))).ok).toBe(false);
        expect(applyEditorGesture(grid, commitOf(change("branch-side", "height", baseline, {main: 300, side: 699}))).ok).toBe(false);
        expect(grid.layout(CONTAINER).sizes.main?.width).toBeCloseTo(499.5);

        expect(applyEditorGesture(grid, commitOf(change("branch-side", "width", baseline, {main: 300, side: 699})))).toEqual({ok: true});
        expect(grid.layout(CONTAINER).sizes.main?.width).toBeCloseTo(300);
        expect(grid.layout(CONTAINER).sizes.side?.width).toBeCloseTo(699);
    });

    it("一场手势的整批变化一起落账：交汇的两根轴同进同退", () => {
        const grid = createEditorGrid("main");
        expect(splitEditorGroup(grid, "main", "side", "right").ok).toBe(true);
        expect(splitEditorGroup(grid, "side", "bottom", "bottom").ok).toBe(true);
        const widths = change("branch-side", "width", {main: 499.5, "branch-bottom": 499.5}, {main: 600, "branch-bottom": 399});
        const heights = change("branch-bottom", "height", {side: 299.5, bottom: 299.5}, {side: 200, bottom: 399});

        const before = grid.layout(CONTAINER).sizes;
        expect(before.main?.width).toBeCloseTo(499.5);
        expect(before.side?.height).toBeCloseTo(299.5);

        // 第二项非法：第一项也不落账，没有"半批"的中间态。
        const overflow = change("branch-bottom", "height", {side: 299.5, bottom: 299.5}, {side: 200, bottom: 400});
        expect(applyEditorGesture(grid, commitOf(widths, overflow)).ok).toBe(false);
        expect(grid.layout(CONTAINER).sizes.main?.width).toBeCloseTo(499.5);
        expect(grid.layout(CONTAINER).sizes.side?.height).toBeCloseTo(299.5);

        // 两项都合法：一次提交同时换掉两根轴。
        expect(applyEditorGesture(grid, commitOf(widths, heights))).toEqual({ok: true});
        const after = grid.layout(CONTAINER).sizes;
        expect(after.main?.width).toBeCloseTo(600);
        expect(after["branch-bottom"]?.width).toBeCloseTo(399);
        expect(after.side?.height).toBeCloseTo(200);
        expect(after.bottom?.height).toBeCloseTo(399);
    });
});
