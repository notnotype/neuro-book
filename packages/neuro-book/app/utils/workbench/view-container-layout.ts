/**
 * 容器的**内部单轴布局**（产品侧纯映射）：Part → 轴、可见成员 → 单轴 Grid、一场手势 → 主轴尺寸补丁。
 *
 * 本模块只做投影，不做几何：px 分配、min/max 降级、补偿与收起求解全在 nb-ui 的 Grid 原语里
 * （`grid-geometry` / `sash-drag` / `grid.ts`）。这里回答四个问题：
 * - 一个 Part 里的容器内部是上下排还是左右排（`containerOrientation`）；
 * - 可见成员数决定哪种模板（`viewContainerModeOf`：empty / single / multiple）；
 * - 一批可见成员按哪根轴、什么意图与约束构成一棵单轴 Grid（`viewContainerGridInput`）；
 * - 一场手势里哪些叶是**主动**改变的，折成哪一轴的 `set-view-sizes` 补丁（`viewSizePatchesOf`）。
 *
 * 三条产品口径（批准计划「已确认的产品行为」）：
 * - **两轴意图都保存，只用当前轴呈现**：左右排用 `width`、上下排用 `height`；容器换 Part 换轴时
 *   **不换算**已保存的数值（缺省意图 `240 * weight` 才对两轴通用）；
 * - **single 不装收起策略**：一个可见 View 时它填满宿主，没有可拖的缝，也没有第二个标题可收；
 * - **multiple 的收起叶主轴占 32px**：与 `WorkbenchViewSection` 的标题同高，展开回到记忆尺寸。
 *
 * 本模块不 import Vue、不读 Storage、不认识 dnd-kit：输入都是宿主求值后的纯数据。
 */

import type {
    GridAxis,
    GridBranchesResizeResult,
    GridGestureCommit,
    GridExtent,
    GridLeafInput,
    GridNodeInput,
    GridOrientation,
} from "@notnotype/nb-ui/layout";
import type {ViewDescriptor} from "nbook/app/utils/workbench/descriptors";
import type {ToolPartId, ViewSizePatch} from "nbook/app/utils/workbench/view-placements";

// ── 常量 ─────────────────────────────────────────────────────────────────────

/** 没有保存尺寸时的展开意图基数：`240 * weight`（`weight` 非正有限按 1）。 */
export const VIEW_SIZE_BASE_PX = 240;

/** 展开时的默认主轴最小尺寸（CSS px）：descriptor 的 `minimumSize` 缺省时用它。 */
export const VIEW_MIN_MAIN_SIZE_PX = 64;

/** 收起叶的主轴占用（CSS px）：与 `WorkbenchViewSection` 的标题同高，只有 multiple 会收起。 */
export const VIEW_COLLAPSED_MAIN_SIZE_PX = 32;

/** 展开最小尺寸的硬下限：收起尺寸 + 1（Grid 的收起策略要求 `collapsedSize` 严格小于展开最小）。 */
export const VIEW_MIN_MAIN_FLOOR_PX = VIEW_COLLAPSED_MAIN_SIZE_PX + 1;

/** descriptor 未声明 `maximumSize` 的那个轴不设上限。 */
const UNBOUNDED = Number.MAX_SAFE_INTEGER;

/** 尺寸比较的容差（CSS px）：小于它的差异不算新的用户意图。 */
const SIZE_EPSILON = 1e-6;

// ── Part → 轴、模板 ──────────────────────────────────────────────────────────

/**
 * Part → 容器内部方向：left/right 是侧栏，内部上下排（`vertical`）；panel 内部左右排
 * （`horizontal`）。与 Panel 外壳停靠在底部还是顶部无关。
 */
export function containerOrientation(partId: ToolPartId): GridOrientation {
    return partId === "panel" ? "horizontal" : "vertical";
}

/** 方向 → 尺寸字段（与 nb-ui `axisOf` 同一条规则）：左右排分宽、上下排分高。 */
const AXIS_OF: Record<GridOrientation, GridAxis> = {horizontal: "width", vertical: "height"};

/** 容器内部的编排轴（= 尺寸记录里参与的那根轴）。 */
export function containerAxis(partId: ToolPartId): GridAxis {
    return AXIS_OF[containerOrientation(partId)];
}

/** 容器的呈现模板：由**可见**成员数求值，不是容器里的登记成员数。 */
export type ViewContainerMode = "empty" | "single" | "multiple";

/** 可见成员数 → 模板：0 个空态、1 个 single、2 个及以上 multiple（折叠与隐藏都不改可见成员数）。 */
export function viewContainerModeOf(visibleCount: number): ViewContainerMode {
    if (!Number.isFinite(visibleCount) || visibleCount < 1) {
        return "empty";
    }
    return visibleCount === 1 ? "single" : "multiple";
}

// ── 尺寸意图与约束 ───────────────────────────────────────────────────────────

/**
 * 一个轴上的**有效**展开最小尺寸：`max(33, declared ?? 64)`。
 *
 * 声明值先过注册校验（正有限、且 `maximumSize` 不低于这里的结果），所以这里只做取大；
 * 非法声明（例如测试直接塞进来的 NaN）按缺省处理，不把 NaN 带进几何。
 */
export function effectiveViewMinimumSize(declared?: number): number {
    const valid = declared !== undefined && Number.isFinite(declared) && declared > 0 ? declared : VIEW_MIN_MAIN_SIZE_PX;
    return Math.max(VIEW_MIN_MAIN_FLOOR_PX, valid);
}

/** 一个轴上的有效范围；`maximumSize` 缺省无界，声明值不能低于有效最小尺寸（注册期已挡）。 */
function axisBounds(view: ViewDescriptor, axis: GridAxis): {minimum: number; maximum: number} {
    const minimum = effectiveViewMinimumSize(view.minimumSize?.[axis]);
    const declared = view.maximumSize?.[axis];
    return {
        minimum,
        maximum: declared !== undefined && Number.isFinite(declared) && declared >= minimum ? declared : UNBOUNDED,
    };
}

/** 把主轴与交叉轴分量摆回 `GridExtent` 的宽高位置。 */
function extentOf(axis: GridAxis, main: number, cross: number): GridExtent {
    return axis === "height" ? {width: cross, height: main} : {width: main, height: cross};
}

/** `weight` 缺失或非正有限时按 1：极小的权值会让缺省意图塌成 0，那不是一个可拖的尺寸。 */
function normalizedWeight(weight: number | undefined): number {
    return weight !== undefined && Number.isFinite(weight) && weight > 0 ? weight : 1;
}

// ── 单轴 Grid 投影 ───────────────────────────────────────────────────────────

/** 一个叶的纯输入：宿主把求值后的条目 + 记录里的尺寸意图摘出来，本模块不读记录。 */
export type ViewContainerLeaf<T> = Readonly<{
    /** 渲染载荷：宿主原样从叶的 `ref` 取回（本模块不解释它）。 */
    readonly ref: T;
    readonly view: ViewDescriptor;
    /** 记录里的尺寸意图（两轴各自独立；缺省按 `240 * weight`）。 */
    readonly size?: Readonly<{readonly width?: number; readonly height?: number}>;
    /** 记录里的内容收起位；single 模式**不应用**（规则在投影里，不在宿主）。 */
    readonly collapsed?: boolean;
}>;

export type ViewContainerGridOptions<T> = Readonly<{
    readonly containerId: string;
    /** 容器生效落位所在的 Part：容器内部的轴由它决定。 */
    readonly partId: ToolPartId;
    readonly mode: ViewContainerMode;
    /** **可见**成员，已按生效顺序排好（本模块不排序、不补隐藏成员）。 */
    readonly members: readonly ViewContainerLeaf<T>[];
    /** 收起阈值（CSS px）：由 nb-ui 的 `SASH_COLLAPSE_THRESHOLD` 传入，不在这里复制一份数值。 */
    readonly collapseThreshold: number;
    /** 收起叶的主轴占用；缺省 `VIEW_COLLAPSED_MAIN_SIZE_PX`（Section 标题高）。 */
    readonly collapsedSize?: number;
}>;

/** Grid 叶 id：也是 `data-panel-id` 与落点 id 用的稳定词汇。 */
export function viewLeafId(viewId: string): string {
    return `view:${viewId}`;
}

/** 容器内部那一条分支的 id（`data-sash` 的容器段）。 */
export function viewContainerBranchId(containerId: string): string {
    return `container:${containerId}`;
}

/**
 * 意图求值只读两个事实：视图描述 + 记录里的尺寸意图；建树的叶与呈现切片都满足它。
 */
type ViewSizeIntentInput = Readonly<{
    readonly view: ViewDescriptor;
    readonly size?: Readonly<{readonly width?: number; readonly height?: number}>;
}>;

/** 叶的主轴意图：保存的那一轴优先，否则 `240 * weight`，最后夹进有效范围。 */
function intentOf(member: ViewSizeIntentInput, axis: GridAxis, bounds: {minimum: number; maximum: number}): number {
    const saved = member.size?.[axis];
    const raw = saved !== undefined && Number.isFinite(saved) && saved > 0
        ? saved
        : VIEW_SIZE_BASE_PX * normalizedWeight(member.view.weight);
    return Math.max(bounds.minimum, Math.min(raw, bounds.maximum));
}

/**
 * 一个可见成员在**当前轴**上的展开意图：记录里那一轴优先，否则 `240 * weight`，再夹进有效范围。
 *
 * 建树与呈现切片用的是同一份算法（`intentOf`）：宿主把逐视图的意图发给落点（`sizeIntents`），
 * 落点在几何量不出来时按它取相对份额，不让"不可见的容器"没有比例可用。
 */
export function viewSizeIntentOf(member: ViewSizeIntentInput, partId: ToolPartId): number {
    const axis = containerAxis(partId);
    return intentOf(member, axis, axisBounds(member.view, axis));
}

/**
 * 把一批可见成员投影成一棵**单轴** Grid；空容器返回 `null`（宿主画空态，不建树）。
 *
 * - 每个可见 View 一个叶，id 是 `view:<viewId>`；叶的 `ref` 就是宿主给的载荷；
 * - `single` 只有一个叶、不装收起策略：它填满内容区，展开意图不参与几何；
 * - `multiple` 的叶带 32px 收起策略：收起是刚性 32px，展开回到记忆尺寸；
 * - 只把**当前主轴**的意图与约束交给叶，交叉轴由宿主填满。
 */
export function viewContainerGridInput<T>(options: ViewContainerGridOptions<T>): GridNodeInput<T> | null {
    if (options.mode === "empty" || options.members.length === 0) {
        return null;
    }
    const orientation = containerOrientation(options.partId);
    const axis = AXIS_OF[orientation];
    const collapsedSize = options.collapsedSize ?? VIEW_COLLAPSED_MAIN_SIZE_PX;
    return {
        kind: "branch",
        id: viewContainerBranchId(options.containerId),
        orientation,
        children: options.members.map((member): GridLeafInput<T> => {
            const bounds = axisBounds(member.view, axis);
            const intent = intentOf(member, axis, bounds);
            return {
                kind: "leaf",
                id: viewLeafId(member.view.id),
                ref: member.ref,
                // 意图与约束只给主轴：交叉轴不设限（0..无界），由宿主分支与内容盒填满，
                // 否则一个交叉轴的 max 会把内容区压成空洞（`layout()` 也会报成 0 宽）。
                size: extentOf(axis, intent, 0),
                minimumSize: extentOf(axis, bounds.minimum, 0),
                maximumSize: extentOf(axis, bounds.maximum, UNBOUNDED),
                sizing: "weight",
                ...(options.mode === "multiple"
                    ? {
                        collapse: {
                            collapsedSize,
                            restoreSize: intent,
                            collapseThreshold: options.collapseThreshold,
                            expandThreshold: options.collapseThreshold,
                            collapsed: member.collapsed === true,
                        },
                    }
                    : {}),
            };
        }),
    };
}

// ── 一场手势 → 主轴补丁 ──────────────────────────────────────────────────────

export type ViewSizePatchSource<T> = Readonly<{
    /** 与建树同一份输入：补丁用它的轴、成员与旧意图做比较。 */
    readonly layout: ViewContainerGridOptions<T>;
    readonly commit: GridGestureCommit;
    /** 那次手势被 Grid 原子接纳的结果；失败的手势不该走到这里。 */
    readonly applied: Extract<GridBranchesResizeResult, {ok: true}>;
}>;

/**
 * 把一场手势折成 `set-view-sizes` 补丁：只认 `active` 的叶，且只写**真正变化**的那根轴。
 *
 * - 被补偿出来的邻居、降级夹取、single 填满宿主的测量值一律不写（那不是用户意图）；
 * - 补丁只带当前主轴字段（`width` 或 `height`）与收起位：另一轴的已保存意图原样留在记录里；
 * - `empty` / `single` 没有可调整的缝，返回空数组（不写测量值）。
 */
export function viewSizePatchesOf<T>(source: ViewSizePatchSource<T>): readonly ViewSizePatch[] {
    const {layout} = source;
    if (layout.mode !== "multiple") {
        return [];
    }
    const axis = containerAxis(layout.partId);
    const byLeafId: Record<string, ViewContainerLeaf<T>> = {};
    for (const member of layout.members) {
        byLeafId[viewLeafId(member.view.id)] = member;
    }
    const patches: ViewSizePatch[] = [];
    for (const change of source.commit.changes) {
        for (const nodeId of change.active) {
            const member = byLeafId[nodeId];
            if (member === undefined) {
                continue;
            }
            const bounds = axisBounds(member.view, axis);
            const nextIntent = source.applied.intents[nodeId]?.[axis];
            const nextCollapsed = source.applied.collapsed[nodeId] === true;
            const patch: {viewId: string; width?: number; height?: number; collapsed?: boolean} = {viewId: member.view.id};
            if (nextIntent !== undefined && Math.abs(nextIntent - intentOf(member, axis, bounds)) > SIZE_EPSILON) {
                patch[axis] = Math.max(bounds.minimum, Math.min(Math.round(nextIntent * 100) / 100, bounds.maximum));
            }
            if (nextCollapsed !== (member.collapsed === true)) {
                patch.collapsed = nextCollapsed;
            }
            if (patch[axis] !== undefined || patch.collapsed !== undefined) {
                patches.push(patch);
            }
        }
    }
    return patches;
}
