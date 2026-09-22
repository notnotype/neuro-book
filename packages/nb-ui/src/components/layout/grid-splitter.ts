/**
 * 树 / 布局 → `Splitter` 面板配置的薄投影。
 *
 * 只做字段搬运：呈现 px 来自 `GridLayoutResult`（宿主已夹取并结算），约束也是布局层已经
 * 求过值的有效区间。这里不重算分配、不换算百分比、不二次夹取——数值算法只有
 * `grid-geometry.ts` 一份。
 */
import type {GridAxis, GridLayoutResult, GridNode, GridSizing} from "./grid-types";
import type {SashPanel} from "./grid-geometry";
import type {SplitterPanelConfig} from "./Splitter.vue";
import type {SashCollapseState} from "./grid-types";

/** 该分支直接子节点沿主轴的呈现 px（顺序与 children 一致）。 */
export function gridBranchSizesPx(
    children: readonly GridNode<unknown>[],
    layout: GridLayoutResult,
    axis: GridAxis,
): number[] {
    return children.map((child) => Math.max(0, layout.sizes[child.id]?.[axis] ?? 0));
}

/** 面板配置：呈现 px、有效约束、分配策略与收起状态原样交给渲染层。 */
export function buildGridBranchPanels(
    children: readonly GridNode<unknown>[],
    layout: GridLayoutResult,
    axis: GridAxis,
): SplitterPanelConfig[] {
    return children.map((child) => {
        const bounds = layout.constraints[child.id];
        return {
            id: child.id,
            defaultSizePx: Math.max(0, layout.sizes[child.id]?.[axis] ?? 0),
            minSizePx: bounds?.minimumSize[axis] ?? 0,
            maxSizePx: bounds?.maximumSize[axis],
            sizing: child.sizing,
            ...(child.collapse === undefined ? {} : {collapse: child.collapse}),
        };
    });
}

/**
 * 面板配置 → 会话输入。`sizesPx` 是当前呈现；缺省时按 `defaultSizePx` 兜底。
 * 独立 `Splitter` 与测试共用这一份换算，避免两处各写一遍默认值。
 */
export function sashPanelsOfConfig(
    panels: readonly SplitterPanelConfig[],
    sizesPx?: readonly number[],
): SashPanel[] {
    return panels.map((panel, index) => {
        const minimum = Math.max(0, panel.minSizePx ?? 0);
        const maximum = Math.max(minimum, panel.maxSizePx ?? Number.MAX_SAFE_INTEGER);
        const collapse: (SashCollapseState & {collapsed: boolean}) | undefined = panel.collapse;
        return {
            id: panel.id ?? `panel-${index}`,
            size: Math.max(0, sizesPx?.[index] ?? panel.defaultSizePx ?? 0),
            minimum,
            maximum,
            sizing: (panel.sizing ?? "weight") satisfies GridSizing,
            ...(collapse === undefined ? {} : {collapse}),
        };
    });
}
