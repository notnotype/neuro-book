/**
 * 分隔条拖动求解（纯函数，无 DOM / Vue / 存储）。
 *
 * 一次求解回答「按下点在主轴方向移动 `deltaPx` 后，这个分支的完整呈现应该是什么」：
 * - 边界位置始终按**相对按下基线的绝对总量**算：每帧都从冻结的 `baselinePx` 与累计位移算理想边界
 *   `baselineBoundary + deltaPx`，不逐帧累加、也不因中间吸附而重新起算——否则「记忆尺寸跳跃 − 指针位移」
 *   会作为永久偏移留在几何里；
 * - 直接相邻的两块面板是候选，装不下的位移按距分隔条由近到远向同侧兄弟传播；分配前先把每个兄弟夹进
 *   它当前的 bounds，再按两侧目标总量补偿，结果逐叶合法且全分支守恒；
 * - 兄弟之间的分配从**上一帧解出的尺寸**出发（首帧是基线）：往回拖时先动挨着分隔条的面板，已被推开的兄弟
 *   留在被推到的地方，和拖一段松手再拖一样。同一方向的位移由近到远逐段分配，分几帧到达结果都一样，
 *   所以只有掉头才让分配依赖路径；边界位置与收起状态不依赖路径；
 * - 收起判定同样只看理想尺寸：低于 `minimum − collapseThreshold` 吸附到 `collapsedSize`，反向回到
 *   `max(minimum, collapsedSize + expandThreshold)` 且容量允许时展开；展开使用理想边界，不跳回记忆尺寸；
 * - 吸附只改约束状态。
 *
 * 显式收起与展开（按钮、Enter）两家不同：网格走 `reflowSashCollapse`，翻标记后按意图重排（展开回到意图）；
 * 独立 `Splitter` 没有意图，走 `solveSashCollapse`，邻居让位、恢复到宿主给的 `restoreSize`。
 *
 * `Grid` 与独立 `Splitter` 共用拖动求解；阈值由宿主的收起策略给出。
 */
import {EPSILON, GRID_UNBOUNDED, allocateSashPanels, clampAxis, finite, sashPanelBounds, type SashPanel} from "./grid-geometry";
import {gridIssue, round} from "./grid-issue";
import type {GridAxis, GridIssue, GridIssueCode} from "./grid-types";

/** 主轴位移的正方向 = 分隔条向右（水平分支）或向下（竖直分支）移动。 */

/** 一次手势里某个分支逐帧串下去的状态：本场的收起覆盖与上一帧的尺寸；边界的锚点永远是按下基线。 */
export type SashDragSnapState = {
    /** 本场手势造成的收起状态覆盖：面板 id → 是否收起（只含与记录不同的那几项）。 */
    readonly collapsed: Readonly<Record<string, boolean>>;
    /**
     * 上一帧解出的尺寸，顺序与 `panels` 一致：兄弟之间的分配从它出发。缺省或形状对不上时从基线出发。
     * 手势中途改了尺寸的显式折叠与恢复要把它的结果写在这里，下一帧才从折叠后的样子接着分配。
     */
    readonly sizesPx?: readonly number[];
};

export type SashDragInput = {
    /** 分支的直接子节点，顺序与呈现一致；`collapse.collapsed` 是手势开始时的记录状态。 */
    panels: readonly SashPanel[];
    /** 手势按下时的完整呈现 px：主动字段判定与失败回滚都以它为准。 */
    baselinePx: readonly number[];
    /** 被拖动的分隔条下标（其左侧面板的下标）。 */
    sashIndex: number;
    /** 相对按下基线的主轴总位移（正 = 分隔条向右/向下移动）；同一场手势里不重新起算。 */
    deltaPx: number;
    /** 上一次求解返回的吸附状态；首帧缺省。 */
    snapState?: SashDragSnapState | null;
    /** 这根轴所在的分支：只用来给 `range-overflow` 诊断带上 `id` 与 `axis`（Spec `ui/nested-grid` 输出 139）。 */
    scope?: {readonly id: string; readonly axis: GridAxis};
};

export type SashDragResult = {
    readonly sizesPx: readonly number[];
    /** 本场手势真正改变的收起状态：面板 id → 是否收起（未改变的面板不出现）。 */
    readonly collapsed: Readonly<Record<string, boolean>>;
    /** 相对按下基线真正改变的直接相邻面板。 */
    readonly active: readonly string[];
    /** 相对按下基线真正改变的其它面板（被推着让出空间）。 */
    readonly compensated: readonly string[];
    readonly issues: readonly GridIssue<GridIssueCode>[];
    /** 下一次求解要带上它的状态（同一场手势内串起来）。 */
    readonly snapState: SashDragSnapState;
};

type Bounds = {low: number; high: number};

/** 面板沿主轴的**有效**范围：`override` 是本场手势的收起覆盖，缺省用记录状态。 */
function boundsWith(panel: SashPanel, override: boolean | undefined): Bounds {
    if (override === undefined || panel.collapse === undefined) {
        return sashPanelBounds(panel);
    }
    return sashPanelBounds({...panel, collapse: {...panel.collapse, collapsed: override}});
}

/**
 * 把本场手势的收起覆盖投影到面板列表：显式折叠/恢复判定兄弟范围时必须看到本场已改动的状态，
 * 否则一个已在本场收起的兄弟会带着展开范围参与容量与补偿计算。
 */
export function withCollapseOverrides(
    panels: readonly SashPanel[],
    collapsed: Readonly<Record<string, boolean>> | null | undefined,
): readonly SashPanel[] {
    if (collapsed === null || collapsed === undefined) {
        return panels;
    }
    return panels.map((panel) => {
        const value = collapsed[panel.id];
        const collapse = panel.collapse;
        return value === undefined || collapse === undefined ? panel : {...panel, collapse: {...collapse, collapsed: value}};
    });
}

/** 一侧（左侧含分隔条左面板）的面板下标。 */
function sliceIndices(count: number, sashIndex: number): {left: number[]; right: number[]} {
    const left: number[] = [];
    const right: number[] = [];
    for (let index = 0; index < count; index += 1) {
        (index <= sashIndex ? left : right).push(index);
    }
    return {left, right};
}

/** 一侧面板沿主轴的总量。 */
function sumSide(indices: readonly number[], values: readonly number[]): number {
    return indices.reduce((sum, index) => sum + values[index]!, 0);
}

/**
 * 把两侧总量按「距分隔条由近到远」传播到各面板：先把每个兄弟夹进它当前的 bounds，
 * 再按左右目标总量补偿分配。返回新尺寸；逐叶满足 bounds、每侧总量正确、全分支守恒——
 * 触界者把装不下的位移交给下一个兄弟；先夹取是因为原始基线里可能有已被本场手势改变约束的面板
 * （例如刚收起的直接相邻面板），拿越界尺寸做「差多少分多少」会让补偿提前结束、留下非零刚性叶。
 */
function settleSides(input: {
    sizes: readonly number[];
    total: number;
    sashIndex: number;
    desiredBoundary: number;
    boundsOf: (index: number) => Bounds;
}): number[] {
    const count = input.sizes.length;
    const {left, right} = sliceIndices(count, input.sashIndex);
    const lowsOf = (indices: readonly number[]): number => indices.reduce((sum, index) => sum + input.boundsOf(index).low, 0);
    const highsOf = (indices: readonly number[]): number => indices.reduce((sum, index) => sum + input.boundsOf(index).high, 0);
    const low = Math.max(lowsOf(left), input.total - highsOf(right));
    const high = Math.min(highsOf(left), input.total - lowsOf(right));
    const boundary = clampAxis(input.desiredBoundary, low, high);
    const sizes = input.sizes.map((size, index) => clampAxis(size, input.boundsOf(index).low, input.boundsOf(index).high));
    distribute(left, boundary, sizes, input.boundsOf, true);
    distribute(right, input.total - boundary, sizes, input.boundsOf, false);
    return sizes;
}

/** 目标面板能拿到的最大主轴尺寸（其它面板各自至少保住自己的下限）。 */
function capacityFor(sizes: readonly number[], total: number, index: number, boundsOf: (index: number) => Bounds): number {
    const othersLow = sizes.reduce((sum, _value, item) => item === index ? sum : sum + boundsOf(item).low, 0);
    return Math.max(0, total - othersLow);
}

/** 一侧总量变化后把目标面板放到 `target`：边界按两侧容量夹取，其余面板按距分隔条由近到远让位。 */
function relocate(input: {
    sizes: readonly number[];
    total: number;
    sashIndex: number;
    index: number;
    target: number;
    boundsOf: (index: number) => Bounds;
}): number[] {
    const {left} = sliceIndices(input.sizes.length, input.sashIndex);
    const anchorLeft = sumSide(left, input.sizes);
    const desired = input.index <= input.sashIndex
        ? anchorLeft - input.sizes[input.index]! + input.target
        : anchorLeft + input.sizes[input.index]! - input.target;
    return settleSides({sizes: input.sizes, total: input.total, sashIndex: input.sashIndex, desiredBoundary: desired, boundsOf: input.boundsOf});
}

/** 收起会让出空间，但另一侧吸收不了：拖动路径与显式折叠路径共用这一条诊断。 */
function noRoomToCollapse(panelId: string): GridIssue<"no-room-to-collapse"> {
    return gridIssue("no-room-to-collapse", `Panel ${panelId} has no boundary to absorb its space once collapsed; it stays expanded`, {id: panelId});
}

/** 展开要的空间比能腾出来的多：拖动路径与显式折叠路径共用这一条诊断。 */
function noRoomToRestore(panelId: string, capacity: number, required: number): GridIssue<"no-room-to-restore"> {
    return gridIssue("no-room-to-restore", `Panel ${panelId} has ${round(capacity)}px to restore into, below its minimum ${round(required)}; it stays collapsed`, {
        id: panelId,
        available: capacity,
        required,
    });
}

/**
 * 独立 `Splitter` 的键盘/命令式显式折叠与恢复：走与拖动同一份收起策略与容量判定，不复制阈值算法。
 * 只覆盖目标面板的收起状态，兄弟保持各自状态，隔着分隔条的邻居让位；恢复用宿主给的 `restoreSize`——这是与拖动
 * 「按指针位置展开」的分工，按钮/菜单/Enter 才回记忆尺寸。网格不用它：网格的面板有意图，走 `reflowSashCollapse`。
 * 返回 null 表示输入非法；`collapsed` 只含真正改变的收起状态。
 * @experimental
 */
export function solveSashCollapse(input: {
    panels: readonly SashPanel[];
    sizesPx: readonly number[];
    sashIndex: number;
    index: number;
    collapsed: boolean;
}): {sizesPx: readonly number[]; collapsed: Readonly<Record<string, boolean>>; issues: readonly GridIssue<GridIssueCode>[]} | null {
    const panels = input.panels;
    const count = panels.length;
    const sizes = input.sizesPx;
    if (count < 2 || input.sashIndex < 0 || input.sashIndex > count - 2 || input.index < 0 || input.index >= count) {
        return null;
    }
    if (sizes.length !== count || sizes.some((size) => !Number.isFinite(size) || size < 0)) {
        return null;
    }
    const panel = panels[input.index]!;
    const issues: GridIssue<GridIssueCode>[] = [];
    if (!panel.collapse) {
        issues.push(gridIssue("no-collapse-policy", `Panel ${panel.id} has no collapse policy and cannot collapse`, {id: panel.id}));
        return {sizesPx: [...sizes], collapsed: {}, issues};
    }
    const total = sizes.reduce((sum, size) => sum + size, 0);
    const targetBounds = boundsWith(panel, input.collapsed);
    const boundsOf = (index: number): Bounds => index === input.index ? targetBounds : sashPanelBounds(panels[index]!);
    const current = panel.collapse.collapsed === true;
    if (current === input.collapsed) {
        return {sizesPx: [...sizes], collapsed: {}, issues};
    }
    if (input.collapsed) {
        const next = relocate({sizes, total, sashIndex: input.sashIndex, index: input.index, target: targetBounds.low, boundsOf});
        // 另一侧吸收不了让出的空间（兄弟都到上限或都已收起）时，算出的尺寸和不等于总量：不收，和拖动路径同一个诊断（Spec 输出 20）。
        // 不拦的话手势会发布一个不守恒的预览，落账时 `resizeBranches` 以 `not-conserved` 拒绝。
        if (Math.abs(next.reduce((sum, size) => sum + size, 0) - total) > EPSILON) {
            issues.push(noRoomToCollapse(panel.id));
            return {sizesPx: [...sizes], collapsed: {}, issues};
        }
        return {sizesPx: next, collapsed: {[panel.id]: true}, issues};
    }
    const capacity = capacityFor(sizes, total, input.index, boundsOf);
    if (capacity < targetBounds.low - EPSILON) {
        issues.push(noRoomToRestore(panel.id, capacity, targetBounds.low));
        return {sizesPx: [...sizes], collapsed: {}, issues};
    }
    // 独立 `Splitter` 的配置类型要求给 `restoreSize`；网格的面板不带它，也不走这里。没给时按能展开的最小尺寸。
    const restored = clampAxis(panel.collapse.restoreSize ?? targetBounds.low, targetBounds.low, Math.min(targetBounds.high, capacity));
    const next = relocate({sizes, total, sashIndex: input.sashIndex, index: input.index, target: restored, boundsOf});
    return {sizesPx: next, collapsed: {[panel.id]: false}, issues};
}

/**
 * 网格的显式收起与展开（Enter、区段按钮）：把目标面板的收起标记翻过来，再按意图把这一支此刻的呈现总量重新分配一次，
 * 所以能翻时结果和 `setCollapsed` 翻这个标记后重新布局这一支相同（Spec `ui/nested-grid` 输出 20、166）。
 * 与 `setCollapsed` 只有两处不同：翻了之后最小尺寸之和放不下这个总量时不展开（`no-room-to-restore`），
 * 让出的空间没有兄弟吸收时不收起（`no-room-to-collapse`）；两种都交回原尺寸、`collapsed` 为空。
 *
 * `panels` 的 `size` 是意图（`branchSashPanels` 给的那份，已叠上本场的收起覆盖），`sizesPx` 是这一支此刻的呈现，
 * 重新分配的是它的总量而不是容器：手势提交要守恒（`resizeBranches` 的 `not-conserved`），落账时也按同一个总量复核（输出 167）。
 * 返回 null 表示输入非法；`collapsed` 只含真正改变的收起状态。
 */
export function reflowSashCollapse(input: {
    panels: readonly SashPanel[];
    sizesPx: readonly number[];
    index: number;
    collapsed: boolean;
}): {sizesPx: readonly number[]; collapsed: Readonly<Record<string, boolean>>; issues: readonly GridIssue<GridIssueCode>[]} | null {
    const panels = input.panels;
    const count = panels.length;
    const sizes = input.sizesPx;
    if (count < 2 || input.index < 0 || input.index >= count) {
        return null;
    }
    if (sizes.length !== count || sizes.some((size) => !Number.isFinite(size) || size < 0)) {
        return null;
    }
    const panel = panels[input.index]!;
    const issues: GridIssue<GridIssueCode>[] = [];
    if (!panel.collapse) {
        issues.push(gridIssue("no-collapse-policy", `Panel ${panel.id} has no collapse policy and cannot collapse`, {id: panel.id}));
        return {sizesPx: [...sizes], collapsed: {}, issues};
    }
    if ((panel.collapse.collapsed === true) === input.collapsed) {
        return {sizesPx: [...sizes], collapsed: {}, issues};
    }
    const flipped = panels.map((item, index) => index === input.index ? {...panel, collapse: {...panel.collapse!, collapsed: input.collapsed}} : item);
    const total = sizes.reduce((sum, size) => sum + size, 0);
    if (!input.collapsed) {
        // 只看最小尺寸之和：`fixed-overflow`（只压保留像素的兄弟）照常展开，和 `setCollapsed` 一样。
        const lows = flipped.map((item) => sashPanelBounds(item).low);
        const lowTotal = lows.reduce((sum, low) => sum + low, 0);
        if (lowTotal > total + EPSILON) {
            const required = lows[input.index]!;
            issues.push(noRoomToRestore(panel.id, Math.max(0, total - (lowTotal - required)), required));
            return {sizesPx: [...sizes], collapsed: {}, issues};
        }
    }
    const next = allocateSashPanels(flipped, total);
    // 收起让出的空间没人吸收（兄弟都到上限、都已收起或都保留像素）时分配之和小于总量：不收，和拖动路径同一个诊断。
    // 不拦的话手势会发布一个不守恒的预览，落账时 `resizeBranches` 以 `not-conserved` 拒绝。
    if (input.collapsed && next.reduce((sum, size) => sum + size, 0) < total - EPSILON) {
        issues.push(noRoomToCollapse(panel.id));
        return {sizesPx: [...sizes], collapsed: {}, issues};
    }
    return {sizesPx: next, collapsed: {[panel.id]: input.collapsed}, issues};
}

/** 一次拖动求解；结构或数值非法时返回 null（调用方不开始手势）。 */
export function solveSashDrag(input: SashDragInput): SashDragResult | null {
    const panels = input.panels;
    const count = panels.length;
    const baseline = input.baselinePx;
    if (count < 2 || input.sashIndex < 0 || input.sashIndex > count - 2) {
        return null;
    }
    if (baseline.length !== count || baseline.some((size) => !Number.isFinite(size) || size < 0)) {
        return null;
    }
    if (!Number.isFinite(input.deltaPx)) {
        return null;
    }
    const issues: GridIssue<GridIssueCode>[] = [];
    const total = baseline.reduce((sum, size) => sum + size, 0);
    const sashIndex = input.sashIndex;
    const overrides: Record<string, boolean> = {...(input.snapState?.collapsed ?? {})};
    const isCollapsed = (index: number): boolean => overrides[panels[index]!.id] ?? panels[index]!.collapse?.collapsed === true;
    const boundsOf = (index: number): Bounds => boundsWith(panels[index]!, overrides[panels[index]!.id]);

    const baselineBoundary = sumSide(sliceIndices(count, sashIndex).left, baseline);
    /** 直接相邻面板在理想边界下的尺寸：正位移让左侧面板变大、右侧面板变小。 */
    const idealSizeOf = (index: number): number => baseline[index]! + (index === sashIndex ? input.deltaPx : -input.deltaPx);
    /** 全部面板有效范围的下限、上限合计（`flip` 是尚未写入的收起覆盖；其余按此刻的收起覆盖算）。 */
    const boundsTotals = (flip?: {index: number; collapsed: boolean}): {lows: number; highs: number} => {
        let lows = 0;
        let highs = 0;
        for (let index = 0; index < count; index += 1) {
            const panel = panels[index]!;
            const bounds = boundsWith(panel, flip !== undefined && flip.index === index ? flip.collapsed : overrides[panel.id]);
            lows += bounds.low;
            highs += bounds.high;
        }
        return {lows, highs};
    };
    /**
     * 全部面板的有效范围能否装下这个分支的总量。
     * 两侧总量都有可落位的边界时结果才可能逐叶合法且守恒；装不下时按计划拒绝，不产出半更新。
     */
    const boundsFit = (flip?: {index: number; collapsed: boolean}): boolean => {
        const {lows, highs} = boundsTotals(flip);
        return lows <= total + EPSILON && total <= highs + EPSILON;
    };
    // 输入本身装不下总量（窄容器已降级）：不猜几何，保持基线并说明原因。
    const usable = total > 0 && boundsFit();
    if (total > 0 && !usable) {
        const {lows, highs} = boundsTotals();
        // 有面板不设上限时上限合计是哨兵值的和，不是度量：不给 `max`。
        const bounded = highs < GRID_UNBOUNDED;
        const measured = {total, min: lows, ...(bounded ? {max: highs} : {})};
        const range = bounded ? `${round(lows)} to ${round(highs)}` : `at least ${round(lows)}`;
        issues.push(gridIssue("over-constrained", `The effective range (${range}) cannot hold the branch total ${round(total)}; this drag leaves the geometry unchanged`,
            input.scope === undefined ? {cause: "range-overflow", ...measured} : {cause: "range-overflow", id: input.scope.id, axis: input.scope.axis, ...measured}));
    }

    if (usable) {
        // 收起判定只看理想尺寸与原始基线，不因中间吸附重新锚定：同一个鼠标位置永远对应同一个状态。
        // 收起先于恢复判定，同帧让出的空间才能成为恢复容量的事实。两侧都可收起时，一侧的展开可能正是另一侧收起所缺的
        // 吸收边界（面板从零拉出、同一帧把编辑器拖到零），所以两遍判定重复到不再变化：每个面板一帧里只会朝一个方向变一次，
        // 最多两轮就稳定，结果不取决于这一位移是一帧到达还是分几帧到达。
        // 两遍判定与稳定后的诊断共用这两条判据：诊断说“想变却变不了”，指的就是它们为真而 pass 里没改成。
        // 锁住的面板（Spec `ui/nested-grid` 输出 168）两种都不想：展开着的拖到最小尺寸就停，收着的照旧是刚性的收起尺寸、拉不开，
        // 位移照级联规则传给同侧的兄弟；也就没有“想变却变不了”的诊断。
        const wantsCollapse = (index: number): boolean => {
            const policy = panels[index]!.collapse;
            return policy !== undefined && policy.locked !== true && !isCollapsed(index)
                && idealSizeOf(index) < boundsOf(index).low - policy.collapseThreshold - EPSILON;
        };
        const wantsExpand = (index: number): boolean => {
            const policy = panels[index]!.collapse;
            if (policy === undefined || policy.locked === true || !isCollapsed(index)) {
                return false;
            }
            const collapsedSize = Math.max(0, finite(policy.collapsedSize, 0));
            return idealSizeOf(index) >= Math.max(boundsWith(panels[index]!, false).low, collapsedSize + policy.expandThreshold) - EPSILON;
        };
        const collapsePass = (): boolean => {
            let changed = false;
            for (const index of [sashIndex, sashIndex + 1]) {
                if (!wantsCollapse(index) || !boundsFit({index, collapsed: true})) {
                    continue;
                }
                overrides[panels[index]!.id] = true;
                changed = true;
            }
            return changed;
        };
        const expandPass = (): boolean => {
            let changed = false;
            for (const index of [sashIndex, sashIndex + 1]) {
                if (!wantsExpand(index) || capacityFor(baseline, total, index, boundsOf) < boundsWith(panels[index]!, false).low - EPSILON) {
                    continue;
                }
                overrides[panels[index]!.id] = false;
                changed = true;
            }
            return changed;
        };
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const collapsedNow = collapsePass();
            const expandedNow = expandPass();
            if (!collapsedNow && !expandedNow) {
                break;
            }
        }
        // 稳定后仍想变却变不了的，给出原因（只报一次）。
        for (const index of [sashIndex, sashIndex + 1]) {
            const panel = panels[index]!;
            if (wantsCollapse(index)) {
                issues.push(noRoomToCollapse(panel.id));
            } else if (wantsExpand(index)) {
                issues.push(noRoomToRestore(panel.id, capacityFor(baseline, total, index, boundsOf), boundsWith(panel, false).low));
            }
        }
    }

    const sizes = usable
        ? settleSides({sizes: previousSizes(input.snapState, baseline), total, sashIndex, desiredBoundary: baselineBoundary + input.deltaPx, boundsOf})
        : [...baseline];

    const collapsed: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    panels.forEach((panel) => {
        const value = overrides[panel.id];
        if (value !== undefined && value !== (panel.collapse?.collapsed === true)) {
            collapsed[panel.id] = value;
        }
    });

    const active: string[] = [];
    const compensated: string[] = [];
    panels.forEach((panel, index) => {
        if (Math.abs(sizes[index]! - baseline[index]!) <= EPSILON) {
            return;
        }
        if (index === sashIndex || index === sashIndex + 1) {
            active.push(panel.id);
        } else {
            compensated.push(panel.id);
        }
    });

    return {
        sizesPx: sizes,
        collapsed,
        active,
        compensated,
        issues,
        snapState: {collapsed: {...overrides}, sizesPx: sizes},
    };
}

/** 分配的起点：上一帧解出的尺寸；和基线不同形（个数不同、有非法值）时不是这一分支的状态，从基线出发。 */
function previousSizes(state: SashDragSnapState | null | undefined, baseline: readonly number[]): readonly number[] {
    const previous = state?.sizesPx;
    if (previous === undefined || previous.length !== baseline.length || previous.some((size) => !Number.isFinite(size) || size < 0)) {
        return baseline;
    }
    return previous;
}

/**
 * 把一侧的总量分给该侧面板：保持各面板原尺寸，增量/减量按距分隔条由近到远传播。
 * 调用方已按两侧容量夹取过总量，所以正常情况下每侧都能恰好装下。
 */
function distribute(
    indices: readonly number[],
    sideTotal: number,
    sizes: number[],
    boundsOf: (index: number) => Bounds,
    nearestIsLast: boolean,
): void {
    const order = nearestIsLast ? [...indices].reverse() : indices;
    let remaining = sideTotal - indices.reduce((sum, index) => sum + sizes[index]!, 0);
    for (const index of order) {
        if (Math.abs(remaining) <= EPSILON) {
            return;
        }
        const bound = boundsOf(index);
        if (remaining > 0) {
            const room = Math.max(0, bound.high - sizes[index]!);
            const take = Math.min(room, remaining);
            sizes[index] = sizes[index]! + take;
            remaining -= take;
        } else {
            const room = Math.max(0, sizes[index]! - bound.low);
            const take = Math.min(room, -remaining);
            sizes[index] = sizes[index]! - take;
            remaining += take;
        }
    }
}

/**
 * 当前分隔线相对按下基线的绝对位移（左侧面板之和的变化量）。
 *
 * 求解器只接受「相对按下基线的绝对位移」，而 Home / End 的目标要从**线现在的位置**出发：
 * 宿主先取本函数得到线当前对应的绝对位移，再加上 `sashEdgeDelta` 给出的相对位移。
 */
export function sashLineOffset(input: {
    baselinePx: readonly number[];
    sizesPx: readonly number[];
    sashIndex: number;
}): number {
    let offset = 0;
    for (let index = 0; index <= input.sashIndex; index += 1) {
        offset += (input.sizesPx[index] ?? 0) - (input.baselinePx[index] ?? 0);
    }
    return offset;
}

/**
 * 键盘 Home / End 的目标位移：让分隔条走到「可行两端」——前侧触到自己的最小/最大，
 * 或后侧触到自己的最小/最大，取先到的一个。落在边界上不算越过收起阈值，因此不会顺手折叠。
 */
export function sashEdgeDelta(input: {
    panels: readonly SashPanel[];
    sizesPx: readonly number[];
    sashIndex: number;
    edge: "start" | "end";
}): number {
    const before = input.sashIndex;
    const after = input.sashIndex + 1;
    if (before < 0 || after >= input.panels.length || input.sizesPx.length !== input.panels.length) {
        return 0;
    }
    const beforeBounds = sashPanelBounds(input.panels[before]!);
    const afterBounds = sashPanelBounds(input.panels[after]!);
    const beforeSize = input.sizesPx[before]!;
    const afterSize = input.sizesPx[after]!;
    if (input.edge === "start") {
        return -Math.max(0, beforeSize - beforeBounds.low);
    }
    const shrinkAfter = Math.max(0, afterSize - afterBounds.low);
    const growBefore = Math.max(0, beforeBounds.high - beforeSize);
    return Math.min(shrinkAfter, growBefore);
}
