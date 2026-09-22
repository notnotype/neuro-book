/**
 * 嵌套 grid 的纯几何：约束传播与两轴分配。
 *
 * 两轴各有自己的分配规则（`docs/specs/ui/nested-grid.md`）：
 * - **主轴**（分支 `orientation` 对应的那根轴）按子节点求和，并计入 `sashSize × (子节点数 − 1)`；
 * - **交叉轴**是同一分支内所有子节点的共享空间：min 取子节点里最严的（最大者），max 取最严的（最小者）。
 *
 * 本文件的函数只读树、只返回结果，不改任何节点；用户意图由 `grid.ts` 的调整入口更新。
 */
import type {
    GridAxis,
    GridBranch,
    GridConstraint,
    GridExtent,
    GridLayoutResult,
    GridNode,
    GridOrientation,
    GridSizing,
    SashCollapseState,
} from "./grid-types";

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

/* -------------------------------------------------------------------------- */
/* 唯一空间分配算法                                                            */
/* -------------------------------------------------------------------------- */

/** 一个待分配面板：宿主给出的意图、有效范围与运行期策略。 */
export type SashPanel = {
    id: string;
    /** 尺寸意图：`fixed` 是 px 目标，`weight` 是相对权重。 */
    size: number;
    minimum: number;
    maximum: number;
    sizing: GridSizing;
    /** 收起策略与状态；`collapsed` 为真时沿主轴的有效范围是刚性的 collapsedSize。 */
    collapse?: SashCollapseState;
};

/** 面板沿主轴的**有效**范围：收起时是刚性 collapsedSize，否则是声明的 [min, max]（max 不低于 min）。 */
export function sashPanelBounds(panel: SashPanel): {low: number; high: number} {
    if (panel.collapse?.collapsed === true) {
        const size = Math.max(0, finite(panel.collapse.collapsedSize, 0));
        return {low: size, high: size};
    }
    const low = Math.max(0, finite(panel.minimum, 0));
    return {low, high: Math.max(low, finite(panel.maximum, low))};
}

/** 收起策略是否合法：尺寸非负有限、collapsedSize 严格小于展开最小尺寸。 */
export function collapsePolicyProblem(policy: SashCollapseState, expandedMinimum: number): string | null {
    const values = [policy.collapsedSize, policy.restoreSize, policy.collapseThreshold, policy.expandThreshold];
    if (values.some((value) => !Number.isFinite(value) || value < 0)) {
        return "收起策略的尺寸与阈值必须是有限非负数";
    }
    if (policy.collapsedSize >= Math.max(0, finite(expandedMinimum, 0))) {
        return `收起尺寸 ${round(policy.collapsedSize)} 必须小于展开最小尺寸 ${round(expandedMinimum)}`;
    }
    return null;
}

/**
 * 有界分配：`fixed` 面板先取夹取后的 px 目标，余量按 `weight` 意向比例分给其余面板。
 *
 * 顺序固定，两侧都不被无声挤死：先保住刚性节点（min = max，含收起面板）与展开 weight 面板的最小尺寸，
 * 再把剩余预算给 fixed；预算不足时先按 fixed 的可缩量同比缩到 min，仍不可满足才按全体最小值比例降级。
 * 没有 weight 节点时多余空间留白，不越权填满（fixed 面板不因容器变大而变大）。
 */
export function allocateSashPanels(
    panels: readonly SashPanel[],
    available: number,
    issues?: string[],
    context = "分隔面板",
): number[] {
    const count = panels.length;
    if (count === 0) {
        return [];
    }
    const space = Math.max(0, finite(available, 0));
    const bounds = panels.map((panel) => sashPanelBounds(panel));
    const lowTotal = bounds.reduce((sum, value) => sum + value.low, 0);
    if (lowTotal > space + EPSILON) {
        issues?.push(`${context}：约束不可满足（最小尺寸合计 ${round(lowTotal)} 超过可用 ${round(space)}），已按最小值比例降级`);
        const ratio = lowTotal > 0 ? space / lowTotal : 0;
        return bounds.map((value) => value.low * ratio);
    }

    const assigned = new Array<number>(count).fill(0);
    const rigid: number[] = [];
    const fixed: number[] = [];
    const weighted: number[] = [];
    panels.forEach((panel, index) => {
        const value = bounds[index]!;
        if (value.high - value.low <= EPSILON) {
            rigid.push(index);
            assigned[index] = value.low;
        } else if (panel.sizing === "fixed") {
            fixed.push(index);
        } else {
            weighted.push(index);
        }
    });

    const rigidTotal = rigid.reduce((sum, index) => sum + assigned[index]!, 0);
    const reservedForWeight = weighted.reduce((sum, index) => sum + bounds[index]!.low, 0);
    const budgetForFixed = Math.max(0, space - rigidTotal - reservedForWeight);
    const targets = fixed.map((index) => clampAxis(panels[index]!.size, bounds[index]!.low, bounds[index]!.high));
    let fixedTotal = targets.reduce((sum, value) => sum + value, 0);
    if (fixedTotal > budgetForFixed + EPSILON) {
        const shrinkable = fixed.reduce((sum, index, position) => sum + Math.max(0, targets[position]! - bounds[index]!.low), 0);
        const excess = fixedTotal - budgetForFixed;
        const factor = shrinkable > EPSILON ? Math.min(1, excess / shrinkable) : 1;
        fixed.forEach((index, position) => {
            const low = bounds[index]!.low;
            const target = targets[position]!;
            targets[position] = Math.max(low, target - (target - low) * factor);
        });
        fixedTotal = targets.reduce((sum, value) => sum + value, 0);
        issues?.push(`${context}：可用空间 ${round(space)} 装不下固定尺寸，已按最小尺寸压缩呈现（不写回意图）`);
    }
    fixed.forEach((index, position) => {
        assigned[index] = targets[position]!;
    });

    const rest = Math.max(0, space - rigidTotal - fixedTotal);
    if (weighted.length === 0) {
        if (rest > EPSILON) {
            issues?.push(`${context}：没有按比例分配的节点，剩余 ${round(rest)} 未被吸收`);
        }
        return assigned;
    }
    const weights = panels.map((panel) => Math.max(0, finite(panel.size, 0)));
    const shared = shareWeighted(weighted, weights, bounds, rest);
    for (const index of weighted) {
        assigned[index] = shared[index]!;
    }
    return assigned;
}

/**
 * 水位法：只把剩余空间按权重分给 `open` 里的节点，触界者按方向固定后继续分。
 * 与历史 `shareAxis` 逐步等价——全 weight 输入必须给出完全相同的几何。
 */
function shareWeighted(
    indices: readonly number[],
    weights: readonly number[],
    bounds: readonly {low: number; high: number}[],
    available: number,
): number[] {
    const assigned = new Array<number>(weights.length).fill(0);
    let open = [...indices];
    let remaining = Math.max(0, finite(available, 0));
    while (open.length > 0) {
        const openWeight = open.reduce((sum, index) => sum + weights[index]!, 0);
        const proposed = new Array<number>(weights.length).fill(0);
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

/** 节点沿父分支主轴的**收起感知**约束：收起时是刚性 collapsedSize，不再让后代最小尺寸撑开。 */
export function constraintsOf<T>(
    node: GridNode<T>,
    axis: GridAxis,
    sashSize: number | GridSashResolver,
    issues?: string[],
    reported?: Set<string>,
): {low: number; high: number} {
    return collapsedRigid(node.collapse) ?? constraintOnAxis(node, axis, sashSize, issues, reported);
}

/** 收起面板的刚性范围；未收起返回 null。 */
function collapsedRigid(collapse: SashCollapseState | undefined): {low: number; high: number} | null {
    if (collapse?.collapsed !== true) {
        return null;
    }
    const size = Math.max(0, finite(collapse.collapsedSize, 0));
    return {low: size, high: size};
}

/** 建树/恢复时归一收起状态：尺寸非有限或负值一律按 0；非法策略由调用方按诊断丢弃。 */
export function normCollapse(value: SashCollapseState | undefined): SashCollapseState | undefined {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const collapsedSize = Math.max(0, finite(value.collapsedSize, 0));
    const restoreSize = Math.max(0, finite(value.restoreSize, collapsedSize));
    return {
        collapsedSize,
        restoreSize: Math.max(restoreSize, collapsedSize),
        collapseThreshold: Math.max(0, finite(value.collapseThreshold, 0)),
        expandThreshold: Math.max(0, finite(value.expandThreshold, 0)),
        collapsed: value.collapsed === true,
    };
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
            const bounds = constraintsOf(child, axis, sashSize, issues, reported);
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
 * 子节点沿父主轴的分配面板：意图、**展开声明**的约束与运行期策略都在这里转成同一份输入。
 *
 * 这里取 `constraintOnAxis`（声明的 `[min, max]`）而不是 `constraintsOf`：后者的收起刚性
 * （`collapsedSize..collapsedSize`）只是**当前呈现**的有效范围，写进 `minimum`/`maximum` 会让
 * 收起策略的形状信息丢失——求解器按面板自带的 `collapse.collapsed` 调 `sashPanelBounds` 就能
 * 拿到刚性的 0，而从收起边界恢复时又必须用同一份**展开**声明来夹取记忆尺寸与容量。
 * 分配算法（`allocateSashPanels`）只经 `sashPanelBounds` 读约束，因此收起呈现不受影响。
 */
function sashPanelsOf<T>(children: readonly GridNode<T>[], axis: GridAxis, sashSize: number | GridSashResolver): SashPanel[] {
    return children.map((child) => {
        const bounds = constraintOnAxis(child, axis, sashSize);
        return {
            id: child.id,
            size: child.size[axis],
            minimum: bounds.low,
            maximum: bounds.high,
            sizing: child.sizing,
            ...(child.collapse === undefined ? {} : {collapse: child.collapse}),
        };
    });
}

/**
 * 有界比例分配（历史入口，兄弟补偿专用）：只在纯 `weight` 树上退化为按意向比例分余量，
 * 且**永不缩到最小尺寸之下**——装不下就停在各自的最小尺寸（布局分配走 `allocateAxis`）。
 */
export function shareAxis<T>(children: GridNode<T>[], axis: GridAxis, available: number, sashSize: number | GridSashResolver): number[] {
    if (children.length === 0) {
        return [];
    }
    const panels = sashPanelsOf(children, axis, sashSize);
    const lowTotal = panels.reduce((sum, panel) => sum + sashPanelBounds(panel).low, 0);
    return allocateSashPanels(panels, Math.max(Math.max(0, finite(available, 0)), lowTotal));
}

/**
 * 布局分配：与独立 Splitter 共用 `allocateSashPanels`（`fixed` 像素目标、`weight` 余量、
 * 收起刚性、最小尺寸不可满足时按比例降级），诊断带分支与轴上下文。
 */
export function allocateAxis<T>(branch: GridBranch<T>, axis: GridAxis, available: number, sashSize: number | GridSashResolver, issues: string[]): number[] {
    const children = branch.children;
    if (children.length === 0) {
        return [];
    }
    return allocateSashPanels(sashPanelsOf(children, axis, sashSize), available, issues, `分支 ${branch.id} 的 ${axis}`);
}

/** 分支直接子节点沿主轴的分配面板（含收起策略）：拖动会话与视图共用同一份输入。 */
export function branchSashPanels<T>(branch: GridBranch<T>, sashSize: number | GridSashResolver): SashPanel[] {
    return sashPanelsOf(branch.children, axisOf(branch.orientation), sashSize);
}

/** 分支各条边界的配置 sash 占用（px；顺序对应相邻 children）。 */
export function branchSashSizes<T>(branch: GridBranch<T>, sashSize: number | GridSashResolver): number[] {
    return sashValues(branch, sashSize);
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
    measure(root, {width: Math.max(0, finite(container.width, 0)), height: Math.max(0, finite(container.height, 0))}, null);
    return {sizes, constraints, sashSizes, issues};

    /**
     * 节点自身的有效约束。`parentMain` 是该节点在父分支上的**主轴**（根节点为 null）：
     * 只有沿这根轴，节点的收起状态才把它压成刚性 collapsedSize；交叉轴不受收起影响。
     */
    function boundsOf(node: GridNode<T>, parentMain: GridAxis | null): GridConstraint {
        const width = parentMain === "width"
            ? constraintsOf(node, "width", sashSize, issues, reportedConstraints)
            : constraintOnAxis(node, "width", sashSize, issues, reportedConstraints);
        const height = parentMain === "height"
            ? constraintsOf(node, "height", sashSize, issues, reportedConstraints)
            : constraintOnAxis(node, "height", sashSize, issues, reportedConstraints);
        return {
            minimumSize: {width: width.low, height: height.low},
            maximumSize: {width: width.high, height: height.high},
        };
    }

    function measure(node: GridNode<T>, space: GridExtent, parentMain: GridAxis | null): GridExtent {
        const nodeBounds = boundsOf(node, parentMain);
        constraints[node.id] = nodeBounds;
        if (node.kind === "leaf") {
            const extent: GridExtent = {
                width: Math.min(space.width, nodeBounds.maximumSize.width),
                height: Math.min(space.height, nodeBounds.maximumSize.height),
            };
            // 收起是有意的零内容：它不该再报成“可用空间小于约束下限”。
            const collapsed = node.collapse?.collapsed === true && parentMain !== null;
            for (const axis of ["width", "height"] as const) {
                if (collapsed && axis === parentMain) {
                    continue;
                }
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
            const childSize = measure(child, extentOf(main, assigned[index]!, crossSize), main)[main];
            measured.push(childSize);
            total += childSize;
        }
        const panelSpace = measured.reduce((sum, value) => sum + value, 0);
        const rawBounds = node.children.map((child) => constraintsOf(child, main, sashSize, issues, reportedConstraints));
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
