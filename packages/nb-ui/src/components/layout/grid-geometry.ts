/**
 * 嵌套 grid 的纯几何：约束传播与两轴分配。
 *
 * 两轴各有自己的分配规则（`docs/specs/ui/nested-grid.md`）：
 * - **主轴**（分支 `orientation` 对应的那根轴）按子节点求和，并计入 `sashSize × (子节点数 − 1)`；
 * - **交叉轴**是同一分支内所有子节点的共享空间：min 取子节点里最严的（最大者），max 取最严的（最小者）。
 *
 * 本文件的函数只读树、只返回结果，不改任何节点；用户意图由 `grid.ts` 的调整入口更新。
 */
import type {GridAxis, GridBranch, GridConstraint, GridExtent, GridLayoutResult, GridNode, GridOrientation} from "./grid-types";

export const EPSILON = 1e-6;

/** 「不限」的上界。用安全整数而不是 Infinity：意图要 JSON 序列化，Infinity 会变成 null。 */
export const GRID_UNBOUNDED = Number.MAX_SAFE_INTEGER;

export const ZERO_EXTENT: GridExtent = {width: 0, height: 0};
export const UNBOUNDED_EXTENT: GridExtent = {width: GRID_UNBOUNDED, height: GRID_UNBOUNDED};
export type GridSashResolver = (branchId: string, sashIndex: number) => number;

export function axisOf(orientation: GridOrientation): GridAxis {
    return orientation === "horizontal" ? "width" : "height";
}

export function crossAxisOf(orientation: GridOrientation): GridAxis {
    return orientation === "horizontal" ? "height" : "width";
}

export function finite(value: number, fallback: number): number {
    return Number.isFinite(value) ? value : fallback;
}

/** 诊断文案里的数字：不暴露浮点尾巴。 */
export function round(value: number): number {
    return Math.round(value * 100) / 100;
}

/** 把宿主给的一对约束归一为 0 ≤ min ≤ max；缺省按 `minimumSize: 0`、`maximumSize: 不限`。 */
export function normExtent(value: GridExtent | undefined, fallback: GridExtent): GridExtent {
    return {
        width: Math.max(0, finite(value?.width ?? fallback.width, fallback.width)),
        height: Math.max(0, finite(value?.height ?? fallback.height, fallback.height)),
    };
}

/** 归一约束对：max 不低于 min，避免宿主给出反向区间后分配逻辑反复抖动。 */
export function normConstraint(minimum: GridExtent, maximum: GridExtent): {minimumSize: GridExtent; maximumSize: GridExtent} {
    return {
        minimumSize: minimum,
        maximumSize: {width: Math.max(minimum.width, maximum.width), height: Math.max(minimum.height, maximum.height)},
    };
}

export function clampAxis(value: number, low: number, high: number): number {
    const min = Math.max(0, finite(low, 0));
    const max = Math.max(min, finite(high, min));
    return Math.min(max, Math.max(min, finite(value, min)));
}

/** 只接受有限、非负的宽高；快照与宿主引用解析共用这一条外部输入口径。 */
export function readExtent(value: unknown): GridExtent | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const candidate = value as {width?: unknown; height?: unknown};
    if (typeof candidate.width !== "number" || typeof candidate.height !== "number") {
        return null;
    }
    if (!Number.isFinite(candidate.width) || !Number.isFinite(candidate.height) || candidate.width < 0 || candidate.height < 0) {
        return null;
    }
    return {width: candidate.width, height: candidate.height};
}

/** 用两根轴各自的数值装出一个 extent（`main` 与 `cross` 互补，避免到处写 if orientation）。 */
export function extentOf(axis: GridAxis, along: number, cross: number): GridExtent {
    return axis === "width" ? {width: along, height: cross} : {width: cross, height: along};
}

/** 节点沿 `axis` 的约束求值；显式上限与后代下限冲突时保留下限并返回诊断。 */
function constraintOnAxis<T>(
    node: GridNode<T>,
    axis: GridAxis,
    sashSize: number | GridSashResolver,
    issues?: string[],
    reported?: Set<string>,
): {low: number; high: number} {
    const declaredLow = Math.max(0, finite(node.minimumSize[axis], 0));
    const declaredHigh = Math.max(0, finite(node.maximumSize[axis], GRID_UNBOUNDED));
    if (node.kind === "leaf") {
        if (declaredHigh + EPSILON < declaredLow) {
            reportConstraintConflict(node.id, axis, declaredLow, declaredHigh, issues, reported);
        }
        return {low: declaredLow, high: Math.max(declaredLow, declaredHigh)};
    }
    const gap = sashTotal(node, sashSize);
    let derivedLow: number;
    let derivedHigh: number;
    if (axisOf(node.orientation) === axis) {
        derivedLow = gap;
        derivedHigh = gap;
        for (const child of node.children) {
            const bounds = constraintOnAxis(child, axis, sashSize, issues, reported);
            derivedLow += bounds.low;
            derivedHigh = Math.min(GRID_UNBOUNDED, derivedHigh + bounds.high);
        }
    } else if (node.children.length === 0) {
        derivedLow = 0;
        derivedHigh = GRID_UNBOUNDED;
    } else {
        derivedLow = 0;
        derivedHigh = GRID_UNBOUNDED;
        for (const child of node.children) {
            const bounds = constraintOnAxis(child, axis, sashSize, issues, reported);
            derivedLow = Math.max(derivedLow, bounds.low);
            derivedHigh = Math.min(derivedHigh, bounds.high);
        }
    }
    const low = Math.max(derivedLow, declaredLow);
    const requestedHigh = Math.min(derivedHigh, declaredHigh);
    if (requestedHigh + EPSILON < low) {
        reportConstraintConflict(node.id, axis, low, requestedHigh, issues, reported);
    }
    return {low, high: Math.max(low, requestedHigh)};
}

function reportConstraintConflict(
    id: string,
    axis: GridAxis,
    low: number,
    high: number,
    issues?: string[],
    reported?: Set<string>,
): void {
    const key = `${id}\u0000${axis}`;
    if (!issues || reported?.has(key)) {
        return;
    }
    reported?.add(key);
    issues.push(`节点 ${id} 的 ${axis} 约束不相容：下限 ${round(low)} 高于上限 ${round(high)}，已以下限优先降级`);
}

/** 节点沿 `axis` 的有效约束区间。 */
export function constraintsOf<T>(node: GridNode<T>, axis: GridAxis, sashSize: number | GridSashResolver): {low: number; high: number} {
    return constraintOnAxis(node, axis, sashSize);
}

function sashValues<T>(branch: GridBranch<T>, sashSize: number | GridSashResolver): number[] {
    return Array.from({length: Math.max(0, branch.children.length - 1)}, (_, index) => {
        const configured = typeof sashSize === "function" ? sashSize(branch.id, index) : sashSize;
        return Math.max(0, finite(configured, 0));
    });
}

function sashTotal<T>(branch: GridBranch<T>, sashSize: number | GridSashResolver): number {
    return sashValues(branch, sashSize).reduce((sum, value) => sum + value, 0);
}

/**
 * 有界比例分配：同时求解全部兄弟的上下界，再把剩余空间按意图权重分给尚未触界者。
 * 夹取后总量决定水位必须升还是降，只固定该方向不会解除的边界，避免过早冻结另一侧。
 */
export function shareAxis<T>(children: GridNode<T>[], axis: GridAxis, available: number, sashSize: number | GridSashResolver): number[] {
    const bounds = children.map((child) => constraintsOf(child, axis, sashSize));
    const weights = children.map((child) => Math.max(0, finite(child.size[axis], 0)));
    const assigned = new Array<number>(children.length).fill(0);
    let remaining = Math.max(0, finite(available, 0));
    let open = children.map((_, index) => index);

    while (open.length > 0) {
        const openWeight = open.reduce((sum, index) => sum + weights[index]!, 0);
        const proposed = new Array<number>(children.length).fill(0);
        for (const index of open) {
            proposed[index] = openWeight > 0
                ? remaining * weights[index]! / openWeight
                : remaining / open.length;
        }

        const below = open.filter((index) => proposed[index]! < bounds[index]!.low - EPSILON);
        const above = open.filter((index) => proposed[index]! > bounds[index]!.high + EPSILON);
        const clipped = proposed.map((value, index) => clampAxis(value, bounds[index]!.low, bounds[index]!.high));
        const clippedTotal = open.reduce((sum, index) => sum + clipped[index]!, 0);
        if (Math.abs(clippedTotal - remaining) <= EPSILON || (below.length === 0 && above.length === 0)) {
            for (const index of open) {
                assigned[index] = clipped[index]!;
            }
            break;
        }
        const fixLower = clippedTotal > remaining;
        const fixed = fixLower ? below : above;
        const fixedSet = new Set(fixed);
        for (const index of fixed) {
            const value = fixLower ? bounds[index]!.low : bounds[index]!.high;
            assigned[index] = value;
            remaining = Math.max(0, remaining - value);
        }
        open = open.filter((index) => !fixedSet.has(index));
    }
    return assigned;
}

/**
 * 布局分配：`shareAxis` 之上补一条**不可满足**规则——子节点最小尺寸合计超过可用量时，
 * 按最小值比例降级到正好用完可用量，并记录诊断。降级后总量守恒（含实际 sash），几何有限非负且不溢出容器。
 */
export function allocateAxis<T>(branch: GridBranch<T>, axis: GridAxis, available: number, sashSize: number | GridSashResolver, issues: string[]): number[] {
    const children = branch.children;
    if (children.length === 0) {
        return [];
    }
    const low = children.map((child) => constraintsOf(child, axis, sashSize).low);
    const lowTotal = low.reduce((sum, value) => sum + value, 0);
    if (lowTotal > available + EPSILON) {
        issues.push(`分支 ${branch.id} 的 ${axis} 约束不可满足：子节点最小尺寸合计 ${round(lowTotal)} 超过可用 ${round(available)}，已按最小值比例降级`);
        const ratio = lowTotal > 0 ? Math.max(0, available) / lowTotal : 0;
        return low.map((value) => value * ratio);
    }
    return shareAxis(children, axis, available, sashSize);
}

/** 位置无关的布局：返回足以渲染同一几何的尺寸、约束与实际 sash，不修改树的意图。 */
export function layoutOf<T>(root: GridNode<T> | null, container: GridExtent, sashSize: number | GridSashResolver): GridLayoutResult {
    const sizes: Record<string, GridExtent> = Object.create(null) as Record<string, GridExtent>;
    const constraints: Record<string, GridConstraint> = Object.create(null) as Record<string, GridConstraint>;
    const sashSizes: Record<string, number[]> = Object.create(null) as Record<string, number[]>;
    const issues: string[] = [];
    const reportedConstraints = new Set<string>();
    if (!root) {
        return {sizes, constraints, sashSizes, issues};
    }
    measure(root, {width: Math.max(0, finite(container.width, 0)), height: Math.max(0, finite(container.height, 0))});
    return {sizes, constraints, sashSizes, issues};

    function boundsOf(node: GridNode<T>): GridConstraint {
        const width = constraintOnAxis(node, "width", sashSize, issues, reportedConstraints);
        const height = constraintOnAxis(node, "height", sashSize, issues, reportedConstraints);
        return {
            minimumSize: {width: width.low, height: height.low},
            maximumSize: {width: width.high, height: height.high},
        };
    }

    function measure(node: GridNode<T>, space: GridExtent): GridExtent {
        const nodeBounds = boundsOf(node);
        constraints[node.id] = nodeBounds;
        if (node.kind === "leaf") {
            const extent: GridExtent = {
                width: Math.min(space.width, nodeBounds.maximumSize.width),
                height: Math.min(space.height, nodeBounds.maximumSize.height),
            };
            for (const axis of ["width", "height"] as const) {
                if (space[axis] < nodeBounds.minimumSize[axis] - EPSILON) {
                    issues.push(`节点 ${node.id} 的 ${axis} 可用空间 ${round(space[axis])} 小于约束下限 ${round(nodeBounds.minimumSize[axis])}，已按可用空间降级`);
                }
            }
            sizes[node.id] = extent;
            return extent;
        }
        const main = axisOf(node.orientation);
        const cross = crossAxisOf(node.orientation);
        const target = Math.max(0, finite(space[main], 0));
        const configuredSashes = sashValues(node, sashSize);
        const configuredGap = configuredSashes.reduce((sum, value) => sum + value, 0);
        const sashScale = configuredGap > target && configuredGap > 0 ? target / configuredGap : 1;
        const effectiveSashes = configuredSashes.map((value) => value * sashScale);
        const effectiveGap = effectiveSashes.reduce((sum, value) => sum + value, 0);
        sashSizes[node.id] = effectiveSashes;
        if (configuredGap > target + EPSILON) {
            issues.push(`分支 ${node.id} 的 sash 占用 ${round(configuredGap)} 超过可用 ${round(target)}，已压缩分隔条与子节点`);
        }
        const crossBounds = constraintOnAxis(node, cross, sashSize, issues, reportedConstraints);
        const crossSize = Math.min(space[cross], clampAxis(space[cross], crossBounds.low, crossBounds.high));
        if (crossSize < crossBounds.low - EPSILON) {
            issues.push(`分支 ${node.id} 的交叉轴可用空间 ${round(space[cross])} 小于约束下限 ${round(crossBounds.low)}，已按可用空间降级`);
        }
        const assigned = allocateAxis(node, main, Math.max(0, target - effectiveGap), sashSize, issues);
        const measured: number[] = [];
        let total = effectiveGap;
        for (const [index, child] of node.children.entries()) {
            const childSize = measure(child, extentOf(main, assigned[index]!, crossSize))[main];
            measured.push(childSize);
            total += childSize;
        }
        const panelSpace = measured.reduce((sum, value) => sum + value, 0);
        const rawBounds = node.children.map((child) => constraintOnAxis(child, main, sashSize, issues, reportedConstraints));
        for (const [index, child] of node.children.entries()) {
            const current = measured[index]!;
            const otherLow = rawBounds.reduce((sum, bounds, other) => other === index ? sum : sum + bounds.low, 0);
            const otherHigh = rawBounds.reduce((sum, bounds, other) => other === index ? sum : Math.min(GRID_UNBOUNDED, sum + bounds.high), 0);
            const low = Math.min(current, Math.max(rawBounds[index]!.low, panelSpace - otherHigh));
            const high = Math.max(current, Math.min(rawBounds[index]!.high, panelSpace - otherLow));
            const childConstraint = constraints[child.id]!;
            constraints[child.id] = {
                minimumSize: {...childConstraint.minimumSize, [main]: Math.max(0, low)},
                maximumSize: {...childConstraint.maximumSize, [main]: Math.max(0, high)},
            };
        }
        if (total < target - EPSILON) {
            issues.push(`分支 ${node.id} 的可用空间 ${round(target)} 有 ${round(target - total)} 未被任何子节点吸收`);
        }
        const extent = extentOf(main, total, crossSize);
        sizes[node.id] = extent;
        return extent;
    }
}
