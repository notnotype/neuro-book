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
    GridIssue,
    GridIssueCode,
    GridLayoutResult,
    GridNode,
    GridOrientation,
    GridSizing,
    SashCollapseState,
} from "./grid-types";
import {gridIssue, round} from "./grid-issue";

export const EPSILON = 1e-6;

/**
 * 「不限」的上界。用安全整数而不是 Infinity：意图要 JSON 序列化，Infinity 会变成 null。
 * @experimental
 */
export const GRID_UNBOUNDED = Number.MAX_SAFE_INTEGER;

export const ZERO_EXTENT: GridExtent = {width: 0, height: 0};
/** @experimental */
export const UNBOUNDED_EXTENT: GridExtent = {width: GRID_UNBOUNDED, height: GRID_UNBOUNDED};
/** @experimental */
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

/** 把宿主给的一对约束归一为 0 ≤ min ≤ max；缺省按 `minimumSize: 0`、`maximumSize: 不限`。 */
export function normExtent(value: GridExtent | undefined, fallback: GridExtent): GridExtent {
    return {
        width: Math.max(0, finite(value?.width ?? fallback.width, fallback.width)),
        height: Math.max(0, finite(value?.height ?? fallback.height, fallback.height)),
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

/**
 * 承载盒的尺寸能不能用来算布局（Spec `ui/nested-grid` 输出 145、146）：量到了、两轴有限且都大于 0。宿主发布空布局、`useGridHost`
 * 停用手势、`NestedGrid` 判定“量好了”都用这一个判据，免得一处把 `{0, 0}` 当可用、另一处当没有。
 * 返回普通的布尔值而不是类型谓词：“否”里也有 `GridExtent`（零尺寸），谓词会把它收窄成 `null`。
 */
export function usableExtent(extent: GridExtent | null): boolean {
    return extent !== null && Number.isFinite(extent.width) && Number.isFinite(extent.height) && extent.width > 0 && extent.height > 0;
}

/** 用两根轴各自的数值装出一个 extent（`main` 与 `cross` 互补，避免到处写 if orientation）。 */
export function extentOf(axis: GridAxis, along: number, cross: number): GridExtent {
    return axis === "width" ? {width: along, height: cross} : {width: cross, height: along};
}

/* -------------------------------------------------------------------------- */
/* 唯一空间分配算法                                                            */
/* -------------------------------------------------------------------------- */

/**
 * 一个待分配面板：宿主给出的意图、有效范围与运行期策略。
 * @experimental
 */
export type SashPanel = {
    id: string;
    /** 尺寸意图：`fixed` 是 px 目标，`weight` 是相对权重。 */
    size: number;
    minimum: number;
    maximum: number;
    sizing: GridSizing;
    /**
     * 刚性：范围是夹进 `[minimum, maximum]` 的 `size`，拖动的级联补偿改不了它，最小值之和放不下时最后才让。
     * 只对 `sizing: "fixed"` 起作用；网格从节点的 `rigid` 带过来，独立 `Splitter` 没有。
     */
    rigid?: true;
    /**
     * 收起策略与状态；`collapsed` 为真时沿主轴的有效范围是刚性的 collapsedSize。`restoreSize` 只有独立 `Splitter` 那条路带
     * （`SplitterCollapseState`），网格的面板没有。
     */
    collapse?: SashCollapseState & {readonly restoreSize?: number};
};

/**
 * 面板沿主轴的**有效**范围：收起时是刚性 collapsedSize；标了刚性的是夹进声明范围的意图；否则是声明的 [min, max]（max 不低于 min）。
 */
export function sashPanelBounds(panel: SashPanel): {low: number; high: number} {
    const collapsed = collapsedRigid(panel.collapse);
    if (collapsed !== null) {
        return collapsed;
    }
    const low = Math.max(0, finite(panel.minimum, 0));
    const declared = {low, high: Math.max(low, finite(panel.maximum, low))};
    return isRigid(panel) ? rigidAt(panel.size, declared) : declared;
}

/** 标了刚性且保留像素：按比例分的标了不起作用（份额不是像素，没有可以钉住的尺寸）。节点与面板共用这一条。 */
function isRigid(item: {readonly rigid?: true; readonly sizing: GridSizing}): boolean {
    return item.rigid === true && item.sizing === "fixed";
}

/** 刚性的范围：意图先夹进声明的范围，最小与最大都是它。 */
function rigidAt(size: number, declared: {low: number; high: number}): {low: number; high: number} {
    const value = clampAxis(size, declared.low, declared.high);
    return {low: value, high: value};
}

/**
 * 有界分配：`fixed` 面板先取夹取后的 px 目标，余量按 `weight` 意向比例分给其余面板。
 *
 * 顺序固定，两侧都不被无声挤死：先保住范围不可分的节点（min = max，含收起面板与标了刚性的）与展开 weight 面板的最小尺寸，
 * 再把剩余预算给 fixed；预算不足时先按 fixed 的可缩量同比缩到 min，仍不可满足才按最小值比例降级（标了刚性的最后才让）。
 * 没有 weight 节点时多余空间留白，不越权填满（fixed 面板不因容器变大而变大）。
 */
export function allocateSashPanels(panels: readonly SashPanel[], available: number): number[] {
    return allocatePanels(panels, available);
}

/** 分配降级的原因：`allocateAxis` 把它包成带分支与轴的诊断（Spec `ui/nested-grid` 输出 139）。 */
type AllocationProblem = {readonly cause: "min-total" | "fixed-overflow"; readonly available: number; readonly required: number};

/** 一块面板在分配里是不是“按比例分”的：有可分的范围、不是固定尺寸。`allocatePanels` 与 `measure` 判 `no-weight` 共用这一条。 */
function sharesByWeight(panel: SashPanel, bounds: {low: number; high: number}): boolean {
    return bounds.high - bounds.low > EPSILON && panel.sizing !== "fixed";
}

function allocatePanels(panels: readonly SashPanel[], available: number, report?: (problem: AllocationProblem) => void): number[] {
    const count = panels.length;
    if (count === 0) {
        return [];
    }
    const space = Math.max(0, finite(available, 0));
    const bounds = panels.map((panel) => sashPanelBounds(panel));
    const lowTotal = bounds.reduce((sum, value) => sum + value.low, 0);
    if (lowTotal > space + EPSILON) {
        report?.({cause: "min-total", available: space, required: lowTotal});
        return squeezeMinimums(panels, bounds, space);
    }

    const assigned = new Array<number>(count).fill(0);
    const rigid: number[] = [];
    const fixed: number[] = [];
    const weighted: number[] = [];
    panels.forEach((panel, index) => {
        const value = bounds[index]!;
        if (sharesByWeight(panel, value)) {
            weighted.push(index);
        } else if (value.high - value.low <= EPSILON) {
            rigid.push(index);
            assigned[index] = value.low;
        } else {
            fixed.push(index);
        }
    });

    const rigidTotal = rigid.reduce((sum, index) => sum + assigned[index]!, 0);
    const reservedForWeight = weighted.reduce((sum, index) => sum + bounds[index]!.low, 0);
    const budgetForFixed = Math.max(0, space - rigidTotal - reservedForWeight);
    const targets = fixed.map((index) => clampAxis(panels[index]!.size, bounds[index]!.low, bounds[index]!.high));
    let fixedTotal = targets.reduce((sum, value) => sum + value, 0);
    if (fixedTotal > budgetForFixed + EPSILON) {
        report?.({cause: "fixed-overflow", available: budgetForFixed, required: fixedTotal});
        const shrinkable = fixed.reduce((sum, index, position) => sum + Math.max(0, targets[position]! - bounds[index]!.low), 0);
        const excess = fixedTotal - budgetForFixed;
        const factor = shrinkable > EPSILON ? Math.min(1, excess / shrinkable) : 1;
        fixed.forEach((index, position) => {
            const low = bounds[index]!.low;
            const target = targets[position]!;
            targets[position] = Math.max(low, target - (target - low) * factor);
        });
        fixedTotal = targets.reduce((sum, value) => sum + value, 0);
    }
    fixed.forEach((index, position) => {
        assigned[index] = targets[position]!;
    });

    const rest = Math.max(0, space - rigidTotal - fixedTotal);
    if (weighted.length === 0) {
        // 剩余留空的诊断由 `measure` 发（`unabsorbed-space`，`no-weight`），它知道分支与祖先的收起。
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
 * 最小尺寸之和放不下时的降级：标了刚性的最后才让。刚性的取自己的最小值，其余按各自最小值的比例分剩下的；
 * 刚性的之和也放不下时，只在刚性的之间按比例压，其余都是 0。没有刚性面板时就是全体最小值按比例。
 * 只认 `rigid` 标记，不认“最小等于最大”：后者（收起的、声明的最小与最大相同的）照旧和其余一起按比例压。
 */
function squeezeMinimums(panels: readonly SashPanel[], bounds: readonly {low: number; high: number}[], space: number): number[] {
    const rigid = panels.map((panel) => isRigid(panel));
    const rigidTotal = bounds.reduce((sum, value, index) => sum + (rigid[index] ? value.low : 0), 0);
    if (rigidTotal > space + EPSILON) {
        const ratio = space / rigidTotal;
        return bounds.map((value, index) => rigid[index] ? value.low * ratio : 0);
    }
    const restTotal = bounds.reduce((sum, value, index) => sum + (rigid[index] ? 0 : value.low), 0);
    const ratio = restTotal > 0 ? Math.max(0, space - rigidTotal) / restTotal : 0;
    return bounds.map((value, index) => rigid[index] ? value.low : value.low * ratio);
}

/**
 * 水位法：只把剩余空间按权重分给 `open` 里的节点，触界者按方向固定后继续分。
 * 全 weight 输入时退化为纯按权重比例分配。
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

/**
 * 节点沿父分支主轴的**收起感知**约束：收起时是刚性 collapsedSize，不再让后代最小尺寸撑开；标了刚性的是夹进声明范围的意图。
 * 只沿父分支主轴调用（交叉轴用 `constraintOnAxis`），所以收起与刚性都不影响交叉轴。
 */
export function constraintsOf<T>(
    node: GridNode<T>,
    axis: GridAxis,
    sashSize: number | GridSashResolver,
    issues?: GridIssue<GridIssueCode>[],
    reported?: Set<string>,
): {low: number; high: number} {
    const collapsed = collapsedRigid(node.collapse);
    if (collapsed !== null) {
        return collapsed;
    }
    const declared = constraintOnAxis(node, axis, sashSize, issues, reported);
    return isRigid(node) ? rigidAt(node.size[axis], declared) : declared;
}

/** 收起面板的刚性范围；未收起返回 null。 */
function collapsedRigid(collapse: SashCollapseState | undefined): {low: number; high: number} | null {
    if (collapse?.collapsed !== true) {
        return null;
    }
    const size = collapsedSizeOf(collapse);
    return {low: size, high: size};
}

/** 收起后占的尺寸：非有限或负值按 0。 */
function collapsedSizeOf(collapse: SashCollapseState): number {
    return Math.max(0, finite(collapse.collapsedSize, 0));
}

/**
 * 收起为零的节点：没有看得见的内容，两根轴上都不该再占最小尺寸（docs/specs/ui/nested-grid.md 输出 137）。
 * 收成标题行的（`collapsedSize` 大于 0）还看得见，只在父分支主轴上是刚性的。
 */
function collapsedToZero(collapse: SashCollapseState | undefined): boolean {
    return collapse?.collapsed === true && collapsedSizeOf(collapse) === 0;
}

/**
 * 建树/恢复时归一收起状态：尺寸非有限或负值一律按 0；非法策略由调用方按诊断丢弃。只拷认得的字段：输入里多出的
 * （例如以前的 `restoreSize`、`restoreToShare`）不报错，也不进节点。
 */
export function normCollapse(value: SashCollapseState | undefined): SashCollapseState | undefined {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const collapsedSize = Math.max(0, finite(value.collapsedSize, 0));
    return {
        collapsedSize,
        collapseThreshold: Math.max(0, finite(value.collapseThreshold, 0)),
        expandThreshold: Math.max(0, finite(value.expandThreshold, 0)),
        collapsed: value.collapsed === true,
        ...(value.toggleable === false ? {toggleable: false} : {}),
        ...(value.locked === true ? {locked: true} : {}),
    };
}

/** 节点沿 `axis` 的约束求值，不看它自己的收起（`setSize` 按展开时的范围夹）；显式上限与后代下限冲突时保留下限并返回诊断。 */
export function constraintOnAxis<T>(
    node: GridNode<T>,
    axis: GridAxis,
    sashSize: number | GridSashResolver,
    issues?: GridIssue<GridIssueCode>[],
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
        // 交叉轴的上限看最大的那个子节点：放不满的子节点自己留空，不该压住兄弟。取最小值时，一列全收成标题行，上限只剩几个标题行高，整行都被压扁。
        // 下限不算收起为零的子节点：它沿父分支主轴已经是零，这根轴上的最小尺寸撑开的只会是兄弟。上限照算，它展开后的上限不变。
        derivedLow = 0;
        derivedHigh = 0;
        for (const child of node.children) {
            const bounds = constraintOnAxis(child, axis, sashSize, issues, reported);
            if (!collapsedToZero(child.collapse)) {
                derivedLow = Math.max(derivedLow, bounds.low);
            }
            derivedHigh = Math.max(derivedHigh, bounds.high);
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
    issues?: GridIssue<GridIssueCode>[],
    reported?: Set<string>,
): void {
    const key = `${id}\u0000${axis}`;
    if (!issues || reported?.has(key)) {
        return;
    }
    reported?.add(key);
    issues.push(gridIssue("conflicting-bounds", `The ${axis} bounds of ${id} conflict: minimum ${round(low)} is above maximum ${round(high)}; the minimum wins`, {
        id,
        axis,
        min: low,
        max: high,
    }));
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
 * 分配算法（`allocateSashPanels`）只经 `sashPanelBounds` 读约束，因此收起呈现不受影响。刚性同理：带上 `rigid` 标记，
 * 范围由 `sashPanelBounds` 按意图算，`minimum`/`maximum` 仍是声明的范围。
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
            ...(child.rigid === true ? {rigid: true} : {}),
            ...(child.collapse === undefined ? {} : {collapse: child.collapse}),
        };
    });
}

/**
 * 布局分配：与独立 Splitter 共用同一份分配（`allocatePanels`：`fixed` 像素目标、`weight` 余量、
 * 收起刚性、最小尺寸不可满足时按比例降级），诊断带分支与轴上下文。
 */
export function allocateAxis<T>(branch: GridBranch<T>, axis: GridAxis, available: number, sashSize: number | GridSashResolver, issues: GridIssue<GridIssueCode>[]): number[] {
    const children = branch.children;
    if (children.length === 0) {
        return [];
    }
    return allocatePanels(sashPanelsOf(children, axis, sashSize), available, ({cause, available: space, required}) => {
        const message = cause === "min-total"
            ? `Branch ${branch.id} cannot fit its minimum ${axis} (${round(required)} > ${round(space)}); scaled down from the minimums`
            : `Branch ${branch.id} cannot fit its fixed ${axis} sizes (${round(required)} > ${round(space)}); compressed toward the minimums`;
        issues.push(gridIssue("over-constrained", message, {cause, id: branch.id, axis, available: space, required}));
    });
}

/** 分支沿主轴有没有按比例分的子节点：没有时剩余空间留空的原因是 `no-weight`，有但都到了上限是 `capped`。 */
function hasWeightedChild<T>(branch: GridBranch<T>, axis: GridAxis, sashSize: number | GridSashResolver): boolean {
    return sashPanelsOf(branch.children, axis, sashSize).some((panel) => sharesByWeight(panel, sashPanelBounds(panel)));
}

/** 分支直接子节点沿主轴的分配面板（含收起策略）：拖动会话与视图共用同一份输入。 */
export function branchSashPanels<T>(branch: GridBranch<T>, sashSize: number | GridSashResolver): SashPanel[] {
    return sashPanelsOf(branch.children, axisOf(branch.orientation), sashSize);
}

const NO_AXES: ReadonlySet<GridAxis> = new Set();

/** 位置无关的布局：返回足以渲染同一几何的尺寸、约束与实际 sash，不修改树的意图。 */
export function layoutOf<T>(root: GridNode<T> | null, container: GridExtent, sashSize: number | GridSashResolver): GridLayoutResult {
    const sizes: Record<string, GridExtent> = Object.create(null) as Record<string, GridExtent>;
    const constraints: Record<string, GridConstraint> = Object.create(null) as Record<string, GridConstraint>;
    const sashSizes: Record<string, number[]> = Object.create(null) as Record<string, number[]>;
    const issues: GridIssue<GridIssueCode>[] = [];
    const reportedConstraints = new Set<string>();
    if (!root) {
        return {sizes, constraints, sashSizes, issues};
    }
    measure(root, {width: Math.max(0, finite(container.width, 0)), height: Math.max(0, finite(container.height, 0))}, null, NO_AXES);
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

    /**
     * `rigid`：祖先沿这几根轴收起着。收起的分支把 collapsedSize 原样交给里面的节点（docs/specs/ui/nested-grid.md 输出 134），
     * 所以这几根轴上“空间小于约束下限”是有意的，不报诊断；另一根轴照常。收起为零的节点两根轴都算：父分支在交叉轴上不再按它的下限留空间
     * （`constraintOnAxis`），它和它里面的节点在那根轴上分不够同样是有意的。
     */
    function measure(node: GridNode<T>, space: GridExtent, parentMain: GridAxis | null, rigid: ReadonlySet<GridAxis>): GridExtent {
        const nodeBounds = boundsOf(node, parentMain);
        constraints[node.id] = nodeBounds;
        // 收起是有意的零内容：它不该再报成“可用空间小于约束下限”。自己收起与祖先收起是同一个理由。
        const silenced: readonly GridAxis[] = node.collapse?.collapsed !== true || parentMain === null ? [] : collapsedToZero(node.collapse) ? ["width", "height"] : [parentMain];
        const quiet = silenced.every((axis) => rigid.has(axis)) ? rigid : new Set([...rigid, ...silenced]);
        if (node.kind === "leaf") {
            const extent: GridExtent = {
                width: Math.min(space.width, nodeBounds.maximumSize.width),
                height: Math.min(space.height, nodeBounds.maximumSize.height),
            };
            for (const axis of ["width", "height"] as const) {
                if (quiet.has(axis)) {
                    continue;
                }
                if (space[axis] < nodeBounds.minimumSize[axis] - EPSILON) {
                    issues.push(gridIssue("over-constrained", `Leaf ${node.id} gets ${round(space[axis])} on ${axis}, below its minimum ${round(nodeBounds.minimumSize[axis])}`, {
                        cause: "leaf-min",
                        id: node.id,
                        axis,
                        available: space[axis],
                        required: nodeBounds.minimumSize[axis],
                    }));
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
        if (configuredGap > target + EPSILON && !quiet.has(main)) {
            issues.push(gridIssue("over-constrained", `The sashes of branch ${node.id} need ${round(configuredGap)} but only ${round(target)} is available; sashes and children are compressed`, {
                cause: "sash-overflow",
                id: node.id,
                axis: main,
                available: target,
                required: configuredGap,
            }));
        }
        const crossBounds = constraintOnAxis(node, cross, sashSize, issues, reportedConstraints);
        const crossSize = Math.min(space[cross], clampAxis(space[cross], crossBounds.low, crossBounds.high));
        if (crossSize < crossBounds.low - EPSILON && !quiet.has(cross)) {
            issues.push(gridIssue("over-constrained", `Branch ${node.id} gets ${round(space[cross])} on its cross axis, below its minimum ${round(crossBounds.low)}`, {
                cause: "cross-min",
                id: node.id,
                axis: cross,
                available: space[cross],
                required: crossBounds.low,
            }));
        }
        // 主轴被祖先收起时，这里分不够是有意的：分配照做，诊断不收。
        const assigned = allocateAxis(node, main, Math.max(0, target - effectiveGap), sashSize, quiet.has(main) ? [] : issues);
        const measured: number[] = [];
        let total = effectiveGap;
        for (const [index, child] of node.children.entries()) {
            const childSize = measure(child, extentOf(main, assigned[index]!, crossSize), main, quiet)[main];
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
        // 祖先沿主轴收起时留空是有意的（同上面分配的 `quiet`）；全部子节点收起时留空也是有意的。
        if (total < target - EPSILON && !quiet.has(main) && !node.children.every((child) => child.collapse?.collapsed === true)) {
            const cause = hasWeightedChild(node, main, sashSize) ? "capped" : "no-weight";
            issues.push(gridIssue("unabsorbed-space", `Branch ${node.id} leaves ${round(target - total)} of ${round(target)} unabsorbed on ${main}`, {
                cause,
                id: node.id,
                axis: main,
                rest: target - total,
            }));
        }
        const extent = extentOf(main, total, crossSize);
        sizes[node.id] = extent;
        return extent;
    }
}
