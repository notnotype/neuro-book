/**
 * 编辑器工作区的分组模型：把领域方向词映射到 nb-ui `Grid` 的几何词汇，并把一场分栏手势
 * 的整批变化落账到树上。
 *
 * 树、内容与保存都归宿主（页面 / Lab 夹具 / 测试）：这里只提供纯函数与结构操作，
 * 不读 store、不碰 DOM、不持久化——布局记录是后续产品切片的事。
 */
import {
    createGrid,
    type Grid,
    type GridGestureCommit,
    type GridNode,
    type GridOrientation,
    type GridResult,
    type GridSplitSide,
} from "@notnotype/nb-ui/layout";
import type {EditorSplitDirection} from "nbook/app/components/editor-workbench/editor-view.types";

/**
 * 方向词 → 几何：left/top 把新组放在前，right/bottom 放在后；左右是横向分支、上下是纵向分支。
 * 这张表是产品词汇与几何词汇的唯一交界，nb-ui 只认识 orientation + side。
 */
export function editorSplitGeometry(direction: EditorSplitDirection): {orientation: GridOrientation; side: GridSplitSide} {
    return {
        orientation: direction === "left" || direction === "right" ? "horizontal" : "vertical",
        side: direction === "left" || direction === "top" ? "before" : "after",
    };
}

/** 单组：一个叶就是整棵编辑器布局树。 */
export function createEditorGrid(groupId: string): Grid<string> {
    return createGrid<string>({kind: "leaf", id: groupId, ref: groupId, size: {width: 0, height: 0}}, {sashSize: 1});
}

/** 在 targetGroupId 处分屏：新组与目标组同向并排，尺寸意图各半（原语负责守恒与上限校验）。 */
export function splitEditorGroup(
    grid: Grid<string>,
    targetGroupId: string,
    newGroupId: string,
    direction: EditorSplitDirection,
): GridResult {
    const {orientation, side} = editorSplitGeometry(direction);
    return grid.splitLeaf(targetGroupId, {
        branchId: `branch-${newGroupId}`,
        orientation,
        side,
        leaf: {kind: "leaf", id: newGroupId, ref: newGroupId},
    });
}

/** 关闭一个组：叶由原语移除，最后一个子节点塌陷由原语收口。 */
export function removeEditorGroup(grid: Grid<string>, groupId: string): GridResult {
    return grid.removeLeaf(groupId);
}

/** 树上的组 id（深度优先，与渲染顺序一致）；宿主用它做轮转、活动组回落与集合校验。 */
export function editorGroupIds(grid: Grid<string>): string[] {
    const ids: string[] = [];
    const walk = (node: GridNode<string> | null): void => {
        if (!node) {
            return;
        }
        if (node.kind === "leaf") {
            ids.push(node.id);
            return;
        }
        node.children.forEach(walk);
    };
    walk(grid.root());
    return ids;
}

/**
 * 一场分栏手势的落账：提交里的整批分支变化（含交汇处两根轴）在同一棵候选树上一次应用，
 * 任一项不通过就整批不落账、原树保持原样。
 *
 * 返回值就是宿主接纳回调的形状（`{ok: false, reason}` 由渲染层回滚预览并诊断），
 * 因此宿主可以原样把它当作手势 ack；未知分支、目标越界、基线失效都由原语给出原因。
 */
export function applyEditorGesture(
    grid: Grid<string>,
    commit: Readonly<GridGestureCommit>,
): {ok: true} | {ok: false; reason: string} {
    const applied = grid.resizeBranches(commit.changes);
    return applied.ok ? {ok: true} : {ok: false, reason: applied.reason};
}
