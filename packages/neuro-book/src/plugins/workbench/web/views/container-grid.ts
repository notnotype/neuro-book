/**
 * 容器内部的单轴网格（docs/specs/ui/workbench-shell.md 外壳二输出 16，“副作用与数据”的视图尺寸）：每个可见视图一个叶，
 * 侧栏与右栏纵向排、Panel 横向排。纯函数，真实的 nb-ui `createGrid`。
 *
 * - 展开的视图按意图分配（`weight`），意图是记录里当前轴的尺寸，没记录过取 240；收起的视图固定 32px，相邻边界拖不动它。
 * - 手势落账后只取主动且真实变化、没有收起的叶，折成视图尺寸补丁；补偿与降级不写。
 */

import {createGrid} from "@notnotype/nb-ui/layout";
import type {Grid, GridBranchInput, GridGestureCommit, GridLeafInput} from "@notnotype/nb-ui/layout";

import {SASH_PX} from "../shell/sizes";
import {sizeFieldOf} from "./presentation";
import type {ContainerPresentation} from "./presentation";

/** 收起的视图沿当前轴只剩 32px（纵向是标题行，横向是竖条）。 */
export const VIEW_COLLAPSED_SIZE = 32;
/** 没有记录过尺寸的视图的意图。 */
export const VIEW_DEFAULT_SIZE = 240;

export function containerBranchId(containerId: string): string {
    return `container:${containerId}`;
}

/** 没有可见视图时没有树。 */
export function containerTree(container: ContainerPresentation): GridBranchInput<string> | null {
    if (container.views.length === 0) return null;
    const field = sizeFieldOf(container.axis);
    const cross = field === "width" ? "height" : "width";
    const children = container.views.map((view): GridLeafInput<string> => {
        if (view.collapsed) {
            const fixed = {[field]: VIEW_COLLAPSED_SIZE, [cross]: 0} as {width: number; height: number};
            return {kind: "leaf", id: view.id, ref: view.id, sizing: "fixed", size: fixed, minimumSize: fixed, maximumSize: {...fixed, [cross]: Number.POSITIVE_INFINITY}};
        }
        return {
            kind: "leaf",
            id: view.id,
            ref: view.id,
            size: {[field]: view.size ?? VIEW_DEFAULT_SIZE, [cross]: 0} as {width: number; height: number},
            minimumSize: {[field]: view.minSize, [cross]: 0} as {width: number; height: number},
            maximumSize: {[field]: view.maxSize, [cross]: Number.POSITIVE_INFINITY} as {width: number; height: number},
        };
    });
    return {kind: "branch", id: containerBranchId(container.id), orientation: container.axis === "horizontal" ? "horizontal" : "vertical", children};
}

export function createContainerGrid(container: ContainerPresentation): Grid<string> | null {
    const tree = containerTree(container);
    return tree === null ? null : createGrid(tree, {sashSize: SASH_PX});
}

/** 落账后的视图尺寸补丁：视图 id → 当前轴的新尺寸。 */
export function containerSizePatch(container: ContainerPresentation, commit: GridGestureCommit): Record<string, number> {
    const field = sizeFieldOf(container.axis);
    const collapsed = new Set(container.views.filter((view) => view.collapsed).map((view) => view.id));
    const patch: Record<string, number> = {};
    for (const change of commit.changes) {
        if (change.branchId !== containerBranchId(container.id) || change.axis !== field) continue;
        for (const viewId of change.active) {
            if (collapsed.has(viewId) || change.collapsed[viewId] === true) continue;
            const before = change.baseline[viewId];
            const after = change.target[viewId];
            if (before === undefined || after === undefined || Math.abs(after - before) <= 1e-6) continue;
            patch[viewId] = after;
        }
    }
    return patch;
}
