import {describe, expect, it} from "vitest";
import {createGrid, type Grid, type GridNode} from "./grid";
import {sashPanelBounds} from "./grid-geometry";
import {buildGridBranchPanels, gridBranchSizesPx, sashPanelsOfConfig} from "./grid-splitter";
import type {SashCollapseState} from "./grid-types";
import type {SplitterPanelConfig} from "./Splitter.vue";

/** 该 grid 根分支的直接子节点：投影的输入顺序必须与呈现一致。 */
function childrenOf(grid: Grid<string>): GridNode<string>[] {
    const root = grid.root();
    if (!root || root.kind !== "branch") {
        throw new Error("测试 grid 缺少根分支");
    }
    return root.children;
}

describe("grid 与 Splitter 的几何映射（px）", () => {
    it("不可满足的窄容器沿用 grid 的比例降级，不把面板夹回溢出", () => {
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
        const children = childrenOf(grid);

        const sizes = gridBranchSizesPx(children, layout, "width");
        const panels = buildGridBranchPanels(children, layout, "width");

        // 501 - 1 的可用空间按声明最小值的比例降级：合计守恒，且不是各 300 的溢出
        expect(sizes[0]! + sizes[1]!).toBeCloseTo(500, 6);
        expect(sizes[0]!).toBeCloseTo(250, 6);
        expect(sizes[1]!).toBeCloseTo(250, 6);
        expect(panels.map((panel) => panel.defaultSizePx)).toEqual(sizes);
        // 约束同样取自布局求值后的有效区间：装不下 300，呈现上限就是降级后的 250
        expect(panels[0]!.minSizePx).toBe(layout.constraints.left!.minimumSize.width);
        expect(panels[0]!.maxSizePx).toBeCloseTo(250, 6);
        expect(panels[1]!.maxSizePx).toBeCloseTo(250, 6);
    });

    it("面板配置投影布局 px、有效约束与分配策略，不重算分配", () => {
        const grid = createGrid<string>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [
                {
                    kind: "leaf",
                    id: "sidebar",
                    ref: "sidebar",
                    size: {width: 280, height: 0},
                    minimumSize: {width: 200, height: 0},
                    maximumSize: {width: 320, height: 0},
                    sizing: "fixed",
                },
                {kind: "leaf", id: "editor", ref: "editor", size: {width: 500, height: 0}},
            ],
        }, {sashSize: 1});
        const layout = grid.layout({width: 1200, height: 800});
        const panels = buildGridBranchPanels(childrenOf(grid), layout, "width");

        // fixed 侧栏保住 px 目标，余量给 weight 编辑区；面板空间不含 sash
        expect(layout.sizes.sidebar!.width).toBe(280);
        expect(layout.sizes.editor!.width).toBe(919);
        expect(panels.map((panel) => panel.defaultSizePx)).toEqual([280, 919]);
        expect(panels.map((panel) => panel.sizing)).toEqual(["fixed", "weight"]);
        // 约束是布局层的有效区间，不是照着声明再夹一遍
        expect(panels.map((panel) => panel.minSizePx)).toEqual([
            layout.constraints.sidebar!.minimumSize.width,
            layout.constraints.editor!.minimumSize.width,
        ]);
        expect(panels.map((panel) => panel.maxSizePx)).toEqual([
            layout.constraints.sidebar!.maximumSize.width,
            layout.constraints.editor!.maximumSize.width,
        ]);
        expect(panels[0]!.maxSizePx).toBe(320);
    });

    it("收起策略原样交给渲染层，收起面板按 collapsedSize 占位", () => {
        const collapse: SashCollapseState = {collapsedSize: 0, restoreSize: 280, collapseThreshold: 24, expandThreshold: 24, collapsed: true};
        const grid = createGrid<string>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [
                {kind: "leaf", id: "sidebar", ref: "sidebar", size: {width: 280, height: 0}, collapse},
                {kind: "leaf", id: "editor", ref: "editor", size: {width: 720, height: 0}},
            ],
        }, {sashSize: 1});
        const layout = grid.layout({width: 1200, height: 800});
        const panels = buildGridBranchPanels(childrenOf(grid), layout, "width");

        expect(panels[0]!.collapse).toEqual(collapse);
        // 收起 = 0px 呈现，展开意图仍留在树上（这里只看投影出的呈现与约束）
        expect(panels[0]!.defaultSizePx).toBe(0);
        expect(panels[0]!.minSizePx).toBe(0);
        expect(panels[0]!.maxSizePx).toBe(0);
        expect(panels[1]!.defaultSizePx).toBe(1199);
        expect(panels[1]!.collapse).toBeUndefined();
    });
});

describe("Splitter 配置到会话面板", () => {
    it("缺省 sizing 为 weight、缺省 max 无界、收起面板的有效范围退化为 collapsedSize", () => {
        const collapse: SashCollapseState = {collapsedSize: 32, restoreSize: 240, collapseThreshold: 24, expandThreshold: 24, collapsed: true};
        const config: SplitterPanelConfig[] = [
            {id: "sidebar", defaultSizePx: 260, minSizePx: 200, sizing: "fixed"},
            {id: "editor", defaultSizePx: 120},
            {defaultSizePx: 240, collapse},
        ];
        const panels = sashPanelsOfConfig(config, [260, 900, 32]);

        expect(panels[0]).toEqual({id: "sidebar", size: 260, minimum: 200, maximum: Number.MAX_SAFE_INTEGER, sizing: "fixed"});
        expect(panels[1]).toEqual({id: "editor", size: 900, minimum: 0, maximum: Number.MAX_SAFE_INTEGER, sizing: "weight"});
        // 未声明 id 的面板按序号兜底；收起策略原样带走
        expect(panels[2]).toMatchObject({id: "panel-2", size: 32, collapse});
        expect(sashPanelBounds(panels[2]!)).toEqual({low: 32, high: 32});

        // 没有当前呈现（独立模式首帧）时按 defaultSizePx 兜底
        expect(sashPanelsOfConfig(config).map((panel) => panel.size)).toEqual([260, 120, 240]);
    });
});
