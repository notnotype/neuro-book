import type {
    GridAxis,
    GridLayoutResult,
    GridNode,
    SplitterPanelConfig,
} from "@notnotype/nb-ui/components";

export type WorkbenchBranchGesture = {
    baseline: Record<string, number>;
    target: Record<string, number>;
};

function panelPercent(size: number, total: number): number {
    return total > 0 ? Math.max(0, Math.min(100, size * 100 / total)) : 0;
}

/** 把 grid 已结算的呈现与有效交互约束原样投影成 Splitter 百分比。 */
export function buildWorkbenchBranchPanels(
    children: readonly GridNode<unknown>[],
    layout: GridLayoutResult,
    axis: GridAxis,
): SplitterPanelConfig[] {
    const presented = children.map((child) => layout.sizes[child.id]?.[axis] ?? 0);
    const total = presented.reduce((sum, size) => sum + size, 0);
    return children.map((child, index) => {
        const bounds = layout.constraints[child.id];
        return {
            id: child.id,
            defaultSize: total > 0 ? panelPercent(presented[index]!, total) : 100 / Math.max(1, children.length),
            minSize: panelPercent(bounds?.minimumSize[axis] ?? 0, total),
            maxSize: panelPercent(bounds?.maximumSize[axis] ?? total, total),
        };
    });
}

/** Splitter 的完整百分比布局转换成同一当前容器里的完整 px 目标。 */
export function workbenchBranchGesture(
    children: readonly GridNode<unknown>[],
    layout: GridLayoutResult,
    axis: GridAxis,
    percentages: readonly number[],
): WorkbenchBranchGesture | null {
    if (percentages.length !== children.length || percentages.some((size) => !Number.isFinite(size) || size < 0)) {
        return null;
    }
    if (Math.abs(percentages.reduce((sum, size) => sum + size, 0) - 100) > 1e-6) {
        return null;
    }
    const baseline: Record<string, number> = Object.create(null) as Record<string, number>;
    const target: Record<string, number> = Object.create(null) as Record<string, number>;
    let panelSpace = 0;
    for (const child of children) {
        const size = layout.sizes[child.id]?.[axis] ?? 0;
        baseline[child.id] = size;
        panelSpace += size;
    }
    let assigned = 0;
    children.forEach((child, index) => {
        const size = index === children.length - 1
            ? Math.max(0, panelSpace - assigned)
            : percentages[index]! * panelSpace / 100;
        target[child.id] = size;
        assigned += size;
    });
    return {baseline, target};
}
