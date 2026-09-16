import {describe, expect, it} from "vitest";
import {createGrid, type Grid, type GridNode} from "@notnotype/nb-ui/components";
import {buildWorkbenchBranchPanels, workbenchBranchGesture} from "nbook/app/components/workbench/workbench-branch-layout";

function childrenOf(grid: Grid<string>): GridNode<string>[] {
    const root = grid.root();
    if (!root || root.kind !== "branch") {
        throw new Error("测试 grid 缺少根分支");
    }
    return root.children;
}

describe("WorkbenchBranch 几何映射", () => {
    it("不可满足窄容器使用 grid 的降级约束，不把面板夹回溢出", () => {
        const grid = createGrid<string>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [
                {kind: "leaf", id: "left", ref: "left", size: {width: 300, height: 0}, minimumSize: {width: 300, height: 0}},
                {kind: "leaf", id: "right", ref: "right", size: {width: 300, height: 0}, minimumSize: {width: 300, height: 0}},
            ],
        }, {sashSize: 1});
        const layout = grid.layout({width: 501, height: 100});
        const panels = buildWorkbenchBranchPanels(childrenOf(grid), layout, "width");

        expect(layout.sizes.left?.width).toBe(250);
        expect(layout.sizes.right?.width).toBe(250);
        expect(panels).toEqual([
            {id: "left", defaultSize: 50, minSize: 50, maxSize: 50},
            {id: "right", defaultSize: 50, minSize: 50, maxSize: 50},
        ]);
    });

    it("editor/right 手势提交全部兄弟目标，不依赖 active 中第一个 id", () => {
        const grid = createGrid<string>({
            kind: "branch",
            id: "main",
            orientation: "horizontal",
            children: [
                {kind: "leaf", id: "left", ref: "left", size: {width: 300, height: 0}},
                {kind: "leaf", id: "editor", ref: "editor", size: {width: 500, height: 0}},
                {kind: "leaf", id: "right", ref: "right", size: {width: 200, height: 0}},
            ],
        });
        const layout = grid.layout({width: 500, height: 100});
        const gesture = workbenchBranchGesture(childrenOf(grid), layout, "width", [30, 45, 25]);

        expect(gesture).toEqual({
            baseline: {left: 150, editor: 250, right: 100},
            target: {left: 150, editor: 225, right: 125},
        });
    });
});
