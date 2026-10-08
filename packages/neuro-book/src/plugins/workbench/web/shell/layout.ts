/**
 * 外壳的几何：位置与对齐决定的树形、尺寸分配与夹取、紧凑呈现、手势补丁（docs/specs/ui/workbench-shell.md 外壳一）。
 * 从旧应用已验证的外壳搬入，Part 改用 v2 的词表。纯模块：不依赖 Vue、Storage 与 store。
 *
 * 拓扑（默认 `bottom + center`；`activitybar` 永远在主体左侧通高，面板只落在 body 里）：
 *
 * ```text
 * root V[titlebar, main H[activitybar, body H[sidebar, panel-stack V[editor, panel], auxiliarybar]], statusbar]
 * ```
 *
 * 位置与对齐改变的是 **body 的形状**，不是给面板加一个兄弟分支：
 *
 * | 位置/对齐 | body（省略可选叶） |
 * |---|---|
 * | bottom/center | H[sidebar, panel-stack V[editor, panel], auxiliarybar] |
 * | bottom/left | H[panel-stack V[content-row H[sidebar, editor], panel], auxiliarybar] |
 * | bottom/right | H[sidebar, panel-stack V[content-row H[editor, auxiliarybar], panel]] |
 * | bottom/justify | H[panel-stack V[content-row H[sidebar, editor, auxiliarybar], panel]] |
 * | top/* | 同 bottom，panel-stack 的子节点顺序对调 |
 * | left | H[sidebar, panel-stack H[panel, editor], auxiliarybar] |
 * | right | H[sidebar, panel-stack H[editor, panel], auxiliarybar] |
 *
 * 固定的内部 id：`body`、`panel-stack`（面板与它的内容兄弟）、`content-row`（跨度包含的侧栏与 editor）；叶按 id 查，
 * 不依赖父链。
 *
 * 尺寸口径：
 * - 偏好只有四个绝对值：侧栏宽、右栏宽、面板高、面板宽；编辑器永远吸收余量；
 * - 只有可调整的边界占 1px：activitybar 相邻、titlebar 与 statusbar 相邻、面板收起或最大化时都不占；
 * - 偏好装不下时先把余量降到 0，再按“偏好减最小值”的可缩空间同比压到容器内（不写回偏好）；连最小值都装不下时进入
 *   紧凑呈现（宽度轴）或把面板退到 32px 标题头（高度轴），并给诊断。
 */

import {createGrid} from "@notnotype/nb-ui/layout";
import type {Grid, GridAxis, GridBranch, GridBranchInput, GridExtent, GridGestureCommit, GridLeafInput, GridNodeInput} from "@notnotype/nb-ui/layout";

import {isHorizontalPanelPosition, panelMaximizable} from "./panel-state";
import type {PanelAlignment, PanelPosition, PanelState} from "./panel-state";
import {
    clampLeafSize,
    clampPanelHeight,
    SASH_PX,
    SHELL_ACTIVITYBAR_WIDTH,
    SHELL_AUXILIARYBAR_MIN_WIDTH,
    SHELL_COMPACT_WIDTH,
    SHELL_DRAG_COLLAPSE_THRESHOLD,
    SHELL_DRAG_COLLAPSIBLE_IDS,
    SHELL_EDITOR_MAX_WIDTH,
    SHELL_EDITOR_MIN_HEIGHT,
    SHELL_EDITOR_MIN_WIDTH,
    SHELL_HIDDEN_PART_IDS,
    SHELL_PANEL_COLLAPSED_HEIGHT,
    SHELL_PANEL_MIN_WIDTH,
    SHELL_SIDEBAR_MIN_WIDTH,
    SHELL_STATUSBAR_HEIGHT,
    SHELL_TITLEBAR_HEIGHT,
    shellLeafLimits,
    shellPanelAxisLimits,
} from "./sizes";
import type {ShellDragCollapseMap, ShellDragCollapsiblePart, ShellEffectivePanel, ShellLayoutMode, ShellLeafLimits, ShellSizePatch, ShellSizePreferences} from "./sizes";

// ── 内部 id ────────────────────────────────────────────────────────────────

const SHELL_HIDDEN_PARTS: Readonly<Record<string, true>> = Object.fromEntries(SHELL_HIDDEN_PART_IDS.map((id) => [id, true]));

export const SHELL_ROOT_ID = "root";
/** `main H[activitybar, body]`。 */
export const SHELL_MAIN_ID = "main";
/** 承载侧栏、面板与编辑器的组合，形状由位置与对齐决定。 */
export const SHELL_BODY_ID = "body";
/** 面板与它的内容兄弟所在的分支：水平位置是 V，左右位置是 H。 */
export const SHELL_PANEL_STACK_ID = "panel-stack";
/** 跨度把侧栏与 editor 收进来时的行（center 以外的水平对齐用它）。 */
export const SHELL_CONTENT_ROW_ID = "content-row";

export interface ShellProjectionInput {
    /** 实测的容器尺寸（不是 window 尺寸）。 */
    readonly extent: GridExtent;
    readonly preferences: ShellSizePreferences;
    readonly panel: PanelState;
    readonly hiddenParts?: ReadonlyArray<string>;
    /** 用户拖到零的 Part：保留节点与展开尺寸意图，内容 0px、相邻保留 1px 可拖边界。与隐藏（移出树）是两件事。 */
    readonly dragCollapsedParts?: ShellDragCollapseMap;
}

export interface ShellProjection {
    readonly mode: ShellLayoutMode;
    readonly tree: GridNodeInput<string>;
    readonly effectivePanel: ShellEffectivePanel;
    /** 每个节点在其父主轴上的目标尺寸：建树用它，测试也读它。 */
    readonly sizes: Readonly<Record<string, number>>;
    /** 每个分支各条边界的实际占用，顺序对应相邻子节点。 */
    readonly sashSizes: Readonly<Record<string, ReadonlyArray<number>>>;
    /** 生效的拖到零集合（隐藏的 Part 不在其中）。 */
    readonly dragCollapsed: ShellDragCollapseMap;
    readonly issues: ReadonlyArray<string>;
}

// ── 建树 ─────────────────────────────────────────────────────────────────────

function shellLeaf(id: string): GridLeafInput<string> {
    return {
        kind: "leaf",
        id,
        ref: id,
        size: {width: 0, height: 0},
        minimumSize: {width: 0, height: 0},
        maximumSize: {width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER},
    };
}

function shellBranch(id: string, orientation: "horizontal" | "vertical", children: GridNodeInput<string>[]): GridBranchInput<string> {
    return {
        kind: "branch",
        id,
        orientation,
        size: {width: 0, height: 0},
        minimumSize: {width: 0, height: 0},
        maximumSize: {width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER},
        children,
    };
}

/** 隐藏集合：只接受可隐藏的 Part，别的丢弃。 */
function hiddenSet(hiddenParts: ReadonlyArray<string> | undefined): Record<string, true> {
    const hidden: Record<string, true> = {};
    for (const id of hiddenParts ?? []) if (SHELL_HIDDEN_PARTS[id]) hidden[id] = true;
    return hidden;
}

function optional<T>(value: T | null): T[] {
    return value === null ? [] : [value];
}

/** split 呈现的树：位置与对齐决定 body 的嵌套，activitybar 永远在 main 的左侧。 */
function splitShellTree(effective: ShellEffectivePanel, hidden: Readonly<Record<string, true>>): GridNodeInput<string> {
    const sidebar = hidden.sidebar ? null : shellLeaf("sidebar");
    const auxiliarybar = hidden.auxiliarybar ? null : shellLeaf("auxiliarybar");
    const editor = shellLeaf("editor");
    const panel = hidden.panel ? null : shellLeaf("panel");

    let body: GridBranchInput<string>;
    if (isHorizontalPanelPosition(effective.position)) {
        const insideLeft = effective.alignment === "left" || effective.alignment === "justify";
        const insideRight = effective.alignment === "right" || effective.alignment === "justify";
        const contentChildren: GridNodeInput<string>[] = [...(insideLeft ? optional(sidebar) : []), editor, ...(insideRight ? optional(auxiliarybar) : [])];
        // center 的跨度只有 editor：它自己就是内容节点，不额外包一层单子分支。
        const content = contentChildren.length === 1 ? contentChildren[0]! : shellBranch(SHELL_CONTENT_ROW_ID, "horizontal", contentChildren);
        const stackChildren = effective.position === "bottom" ? [content, ...optional(panel)] : [...optional(panel), content];
        body = shellBranch(SHELL_BODY_ID, "horizontal", [
            ...(insideLeft ? [] : optional(sidebar)),
            shellBranch(SHELL_PANEL_STACK_ID, "vertical", stackChildren),
            ...(insideRight ? [] : optional(auxiliarybar)),
        ]);
    } else {
        const stackChildren = effective.position === "left" ? [...optional(panel), editor] : [editor, ...optional(panel)];
        body = shellBranch(SHELL_BODY_ID, "horizontal", [...optional(sidebar), shellBranch(SHELL_PANEL_STACK_ID, "horizontal", stackChildren), ...optional(auxiliarybar)]);
    }

    return shellBranch(SHELL_ROOT_ID, "vertical", [
        ...(hidden.titlebar ? [] : [shellLeaf("titlebar")]),
        shellBranch(SHELL_MAIN_ID, "horizontal", [...(hidden.activitybar ? [] : [shellLeaf("activitybar")]), body]),
        shellLeaf("statusbar"),
    ]);
}

/** 紧凑呈现的树：activitybar 仍是主体左侧通高列，其余 Part 在它右侧纵向排布。 */
function compactShellTree(hidden: Readonly<Record<string, true>>): GridNodeInput<string> {
    const body = shellBranch(SHELL_BODY_ID, "vertical", [
        ...(hidden.sidebar ? [] : [shellLeaf("sidebar")]),
        shellLeaf("editor"),
        ...(hidden.auxiliarybar ? [] : [shellLeaf("auxiliarybar")]),
        ...(hidden.panel ? [] : [shellLeaf("panel")]),
    ]);
    return shellBranch(SHELL_ROOT_ID, "vertical", [
        ...(hidden.titlebar ? [] : [shellLeaf("titlebar")]),
        shellBranch(SHELL_MAIN_ID, "horizontal", [...(hidden.activitybar ? [] : [shellLeaf("activitybar")]), body]),
        shellLeaf("statusbar"),
    ]);
}

// ── 尺寸分配 ─────────────────────────────────────────────────────────────────

type PreferenceKey = keyof ShellSizePreferences;

type ChildRole =
    | {readonly kind: "fixed"; readonly size: number}
    | {readonly kind: "preference"; readonly key: PreferenceKey; readonly limits: ShellLeafLimits; readonly size: number}
    /** 拖到零：现在占 0px，展开意图（restore）留在节点上，边界仍是 1px 可拖。 */
    | {readonly kind: "drag-collapsed"; readonly limits: ShellLeafLimits; readonly restore: number}
    | {readonly kind: "remainder"};

interface SizingState {
    readonly mode: ShellLayoutMode;
    readonly preferences: ShellSizePreferences;
    /** 生效状态：高度不足时会在分配途中把 `collapsed` 改成 true（只影响呈现）。 */
    readonly effective: {position: PanelPosition; alignment: PanelAlignment; collapsed: boolean; maximized: boolean};
    readonly hidden: Readonly<Record<string, true>>;
    readonly dragCollapsed: ShellDragCollapseMap;
    readonly viewportWidth: number;
    sizes: Record<string, number>;
    sashSizes: Record<string, number[]>;
    issues: string[];
}

/** 相邻两个子节点之间的边界占用：0 表示这条边界不可拖、也不占流内空间。 */
function shellSashSize(state: SizingState, leftId: string, rightId: string): number {
    if (state.mode === "compact") return 0;
    const rigidNeighbour = (id: string): boolean => id === "activitybar" || id === "titlebar" || id === "statusbar";
    if (rigidNeighbour(leftId) || rigidNeighbour(rightId)) return 0;
    if ((leftId === "panel" || rightId === "panel") && (state.effective.collapsed || state.effective.maximized)) return 0;
    return SASH_PX;
}

function branchSash(state: SizingState, branch: GridBranchInput<string>): number[] {
    const sash: number[] = [];
    for (let index = 0; index < branch.children.length - 1; index += 1) sash.push(shellSashSize(state, branch.children[index]!.id, branch.children[index + 1]!.id));
    return sash;
}

/**
 * 把收起策略写到叶上：侧栏与面板是“希望保留 px”的叶（`sizing: "fixed"`），余量归 editor；展开意图（restore）与阈值
 * 交给渲染层与拖动会话。节点 `size` 永远是展开意图：拖到零的呈现来自收起策略（0px），不是把意图写成 0。
 */
function writeCollapseIntent(node: GridNodeInput<string>, axis: GridAxis, role: {readonly kind: "drag-collapsed" | "preference"; readonly restore: number}): void {
    node.sizing = "fixed";
    if (node.kind === "leaf") node.size = axis === "width" ? {width: role.restore, height: node.size!.height} : {width: node.size!.width, height: role.restore};
    node.collapse = {
        collapsedSize: 0,
        restoreSize: Math.max(0, role.restore),
        collapseThreshold: SHELL_DRAG_COLLAPSE_THRESHOLD,
        expandThreshold: SHELL_DRAG_COLLAPSE_THRESHOLD,
        collapsed: role.kind === "drag-collapsed",
    };
}

/** 子节点在本分支主轴上的角色：固定值、用户偏好、拖到零、余量。 */
function classifyChild(child: GridNodeInput<string>, axis: GridAxis, state: SizingState, maximizedHere: boolean): ChildRole {
    const id = child.id;
    if (id === "panel") {
        if (state.effective.maximized) return {kind: "remainder"};
        const limits = shellPanelAxisLimits(axis, {collapsed: false, maximized: false});
        const key: PreferenceKey = axis === "width" ? "panelWidth" : "panelHeight";
        const restore = clampLeafSize(state.preferences[key], limits);
        if (state.dragCollapsed.panel === true) return {kind: "drag-collapsed", limits, restore};
        if (state.effective.collapsed) return {kind: "fixed", size: SHELL_PANEL_COLLAPSED_HEIGHT};
        return {kind: "preference", key, limits, size: restore};
    }
    if (id === "activitybar") return {kind: "fixed", size: SHELL_ACTIVITYBAR_WIDTH};
    if (id === "titlebar") return {kind: "fixed", size: SHELL_TITLEBAR_HEIGHT};
    if (id === "statusbar") return {kind: "fixed", size: SHELL_STATUSBAR_HEIGHT};
    if (id === "sidebar" || id === "auxiliarybar") {
        const limits = shellLeafLimits(id, state.viewportWidth);
        const key: PreferenceKey = id === "sidebar" ? "sidebarWidth" : "auxiliarybarWidth";
        const size = clampLeafSize(state.preferences[key], limits);
        if (state.dragCollapsed[id] === true) return {kind: "drag-collapsed", limits, restore: size};
        return {kind: "preference", key, limits, size};
    }
    // editor 与内部结构分支都是余量；最大化时除面板之外的余量全部让位。
    return maximizedHere ? {kind: "fixed", size: 0} : {kind: "remainder"};
}

/** 高度轴的降级：展开的面板与 editor 的最小高度装不下时，只在呈现中把面板退到 32px 标题头，偏好不动。 */
function preflightPanelCollapse(branch: GridBranchInput<string>, state: SizingState): void {
    if (branch.orientation !== "vertical" || state.effective.collapsed || state.effective.maximized) return;
    if (!isHorizontalPanelPosition(state.effective.position) || !branch.children.some((child) => child.id === "panel")) return;
    const sash = branchSash(state, branch).reduce((sum, size) => sum + size, 0);
    const available = Math.max(0, branch.size!.height - sash);
    const desired = clampPanelHeight(state.preferences.panelHeight);
    if (available - desired < SHELL_EDITOR_MIN_HEIGHT) {
        state.effective.collapsed = true;
        state.issues.push(`外壳高度不足 editor ≥ ${String(SHELL_EDITOR_MIN_HEIGHT)}px 与面板 ${String(desired)}px：面板仅在呈现退回 ${String(SHELL_PANEL_COLLAPSED_HEIGHT)}px 标题头`);
    }
}

/** 只把尺寸与约束写到节点上，不递归（紧凑呈现按显式计划逐层调用）。 */
function writeNode(node: GridNodeInput<string>, axis: GridAxis, mainSize: number, crossSize: number, limits: ShellLeafLimits | null, state: SizingState): void {
    const main = Math.max(0, Number.isFinite(mainSize) ? mainSize : 0);
    const cross = Math.max(0, Number.isFinite(crossSize) ? crossSize : 0);
    node.size = axis === "width" ? {width: main, height: cross} : {width: cross, height: main};
    const bounds = limits ?? {minimumSize: 0, maximumSize: SHELL_EDITOR_MAX_WIDTH};
    node.minimumSize = axis === "width" ? {width: bounds.minimumSize, height: 0} : {width: 0, height: bounds.minimumSize};
    node.maximumSize = axis === "width" ? {width: bounds.maximumSize, height: Number.MAX_SAFE_INTEGER} : {width: Number.MAX_SAFE_INTEGER, height: bounds.maximumSize};
    state.sizes[node.id] = main;
}

function assignNode(node: GridNodeInput<string>, axis: GridAxis, mainSize: number, crossSize: number, limits: ShellLeafLimits | null, state: SizingState): void {
    writeNode(node, axis, mainSize, crossSize, limits, state);
    if (node.kind === "branch") distributeBranch(node, state);
}

/** 分支内部的分配：固定叶与偏好叶各自夹取，余量叶等分剩下的空间。 */
function distributeBranch(branch: GridBranchInput<string>, state: SizingState): void {
    const axis: GridAxis = branch.orientation === "horizontal" ? "width" : "height";
    const branchMain = axis === "width" ? branch.size!.width : branch.size!.height;
    const branchCross = axis === "width" ? branch.size!.height : branch.size!.width;

    // 收起判定先于边界：退到标题头的面板与内容之间不再有可拖边界。
    preflightPanelCollapse(branch, state);
    const sash = branchSash(state, branch);
    state.sashSizes[branch.id] = sash;
    const available = Math.max(0, branchMain - sash.reduce((sum, size) => sum + size, 0));
    const maximizedHere = state.effective.maximized && branch.children.some((child) => child.id === "panel");

    const roles = branch.children.map((child) => classifyChild(child, axis, state, maximizedHere));
    const fixedTotal = roles.reduce((sum, role) => sum + (role.kind === "fixed" ? role.size : 0), 0);
    const preferred = roles.flatMap((role, index) => (role.kind === "preference" ? [{role, index}] : []));
    const remainders = roles.flatMap((role, index) => (role.kind === "remainder" ? [index] : []));

    // 拖到零的叶不参与预算：它与兄弟之间保留的 1px 边界已经算在边界里。
    const sizes = roles.map((role) => (role.kind === "remainder" || role.kind === "drag-collapsed" ? 0 : role.size));
    let preferredTotal = preferred.reduce((sum, entry) => sum + entry.role.size, 0);
    const budget = Math.max(0, available - fixedTotal);
    if (preferredTotal > budget) {
        // 偏好装不下：按“偏好减最小值”的可缩空间同比压到容器内，不写回偏好。
        const shrinkable = preferred.reduce((sum, entry) => sum + Math.max(0, entry.role.size - entry.role.limits.minimumSize), 0);
        const factor = shrinkable > 0 ? Math.min(1, (preferredTotal - budget) / shrinkable) : 1;
        for (const entry of preferred) {
            const floor = entry.role.limits.minimumSize;
            sizes[entry.index] = Math.max(floor, entry.role.size - (entry.role.size - floor) * factor);
        }
        preferredTotal = preferred.reduce((sum, entry) => sum + sizes[entry.index]!, 0);
        state.issues.push(`可用空间 ${String(budget)}px 装不下侧栏与面板的偏好：已按最小尺寸压缩呈现（不写回偏好）`);
    }

    const rest = Math.max(0, budget - preferredTotal);
    if (remainders.length > 0) {
        for (const index of remainders) sizes[index] = rest / remainders.length;
        if (rest <= 0 && !maximizedHere) state.issues.push(`可用空间 ${String(budget)}px 已被固定叶与偏好占满：余量叶取 0`);
    } else if (rest > 0) {
        state.issues.push(`分支 ${branch.id} 没有余量叶：剩余 ${String(rest)}px 未分配`);
    }

    branch.children.forEach((child, index) => {
        const role = roles[index]!;
        assignNode(child, axis, sizes[index]!, branchCross, role.kind === "preference" || role.kind === "drag-collapsed" ? role.limits : null, state);
        if (role.kind === "drag-collapsed") {
            // 呈现 0px，意图保留展开尺寸：恢复与“记忆尺寸”都读它。
            writeCollapseIntent(child, axis, role);
            state.sizes[child.id] = 0;
        } else if (role.kind === "preference") {
            writeCollapseIntent(child, axis, {kind: "preference", restore: role.size});
        }
    });
}

/** 紧凑呈现的尺寸：activitybar 是主体左侧通高列，titlebar 与 statusbar 刚性，面板保持高度意图，其余可见叶等分高度。 */
function compactSizes(root: GridBranchInput<string>, state: SizingState, extent: GridExtent): void {
    const height = Math.max(0, extent.height);
    const width = Math.max(0, extent.width);
    const titlebar = state.hidden.titlebar ? 0 : Math.min(SHELL_TITLEBAR_HEIGHT, height);
    const statusbar = Math.min(SHELL_STATUSBAR_HEIGHT, Math.max(0, height - titlebar));
    const bodyHeight = Math.max(0, height - titlebar - statusbar);
    const activitybar = state.hidden.activitybar ? 0 : SHELL_ACTIVITYBAR_WIDTH;
    const bodyWidth = Math.max(0, width - activitybar);

    state.sizes = {};
    state.sashSizes = {};
    writeNode(root, "height", height, width, null, state);
    const main = root.children.find((child) => child.id === SHELL_MAIN_ID) as GridBranchInput<string>;
    writeNode(main, "width", bodyHeight, width, null, state);
    const activityLeaf = main.children.find((child) => child.id === "activitybar");
    if (activityLeaf !== undefined) writeNode(activityLeaf, "width", activitybar, bodyHeight, shellLeafLimits("activitybar", 0), state);
    const body = main.children.find((child) => child.id === SHELL_BODY_ID) as GridBranchInput<string>;
    writeNode(body, "width", bodyWidth, bodyHeight, null, state);

    const panelPresent = body.children.some((child) => child.id === "panel");
    const panelSize = panelPresent ? (state.effective.collapsed ? SHELL_PANEL_COLLAPSED_HEIGHT : Math.min(clampPanelHeight(state.preferences.panelHeight), bodyHeight)) : 0;
    const others = body.children.length - (panelPresent ? 1 : 0);
    const rest = Math.max(0, bodyHeight - panelSize);
    if (others > 0 && rest <= 0) state.issues.push(`紧凑呈现高度 ${String(bodyHeight)}px 不足：主体叶取 0`);
    const share = others > 0 ? rest / others : 0;
    for (const child of body.children) {
        const isPanel = child.id === "panel";
        writeNode(child, "height", isPanel ? panelSize : share, bodyWidth, isPanel ? shellPanelAxisLimits("height", state.effective) : null, state);
    }
}

// ── 投影 ─────────────────────────────────────────────────────────────────────

/** 非有限或非正的容器尺寸按 0 处理，只是不让 NaN 进树。 */
function finiteExtent(extent: GridExtent): GridExtent {
    return {
        width: Number.isFinite(extent.width) && extent.width > 0 ? extent.width : 0,
        height: Number.isFinite(extent.height) && extent.height > 0 ? extent.height : 0,
    };
}

/** split 呈现下横向最小值装不装得下：装不下就退紧凑。 */
function splitRowFits(position: PanelPosition, hidden: Readonly<Record<string, true>>, dragCollapsed: ShellDragCollapseMap, width: number): boolean {
    const body = Math.max(0, width - (hidden.activitybar ? 0 : SHELL_ACTIVITYBAR_WIDTH));
    // 拖到零的 Part 不再要求展开最小宽度，但保留的 1px 边界照算。
    const sidebars = (hidden.sidebar || dragCollapsed.sidebar === true ? 0 : SHELL_SIDEBAR_MIN_WIDTH) + (hidden.auxiliarybar || dragCollapsed.auxiliarybar === true ? 0 : SHELL_AUXILIARYBAR_MIN_WIDTH);
    const horizontal = isHorizontalPanelPosition(position);
    const panel = horizontal ? 0 : SHELL_PANEL_MIN_WIDTH;
    const leaves = (hidden.sidebar ? 0 : 1) + 1 + (horizontal ? 0 : 1) + (hidden.auxiliarybar ? 0 : 1);
    return body >= sidebars + panel + SHELL_EDITOR_MIN_WIDTH + Math.max(0, leaves - 1) * SASH_PX;
}

/** 一次投影：偏好、面板状态、隐藏集合与实测容器 → 树、尺寸与生效状态。纯函数，不持有跨次调用的状态。 */
export function projectShell(input: ShellProjectionInput): ShellProjection {
    const extent = finiteExtent(input.extent);
    const hidden = hiddenSet(input.hiddenParts);
    if (input.panel.hidden) hidden.panel = true;
    // 拖到零只在可见的 Part 上生效：隐藏是移出树，两者不是一回事。
    const dragCollapsed: Partial<Record<ShellDragCollapsiblePart, boolean>> = {};
    for (const part of SHELL_DRAG_COLLAPSIBLE_IDS) if (hidden[part] !== true && input.dragCollapsedParts?.[part] === true) dragCollapsed[part] = true;
    const issues: string[] = [];

    // 生效的面板状态：左右位置忽略收起与对齐；最大化只在合法组合下成立。
    const storedHorizontal = isHorizontalPanelPosition(input.panel.position);
    let position = input.panel.position;
    let alignment: PanelAlignment = storedHorizontal ? input.panel.alignment : "center";
    let collapsed = storedHorizontal ? input.panel.collapsed : false;
    let maximized = input.panel.maximized && !input.panel.hidden && panelMaximizable(position, alignment) && !collapsed;

    // 宽度 ≥ 800 时主体至少 740px，装得下两个侧栏、左右面板与编辑器的最小宽度（603px）；这里仍按实际最小值判定，
    // 常量改了也不会给出越界的几何。
    let mode: ShellLayoutMode = extent.width < SHELL_COMPACT_WIDTH ? "compact" : "split";
    if (mode === "split" && !splitRowFits(position, hidden, dragCollapsed, extent.width)) {
        mode = "compact";
        issues.push(`容器宽 ${String(extent.width)}px 装不下侧栏与编辑区的最小宽度：已切换紧凑呈现`);
    }
    if (mode === "compact") {
        // 面板强制底部两端对齐，瞬时最大化不成立（不写回偏好）。
        position = "bottom";
        alignment = "justify";
        collapsed = storedHorizontal ? input.panel.collapsed : false;
        maximized = false;
    }

    const state: SizingState = {
        mode,
        preferences: input.preferences,
        effective: {position, alignment, collapsed, maximized},
        hidden,
        dragCollapsed,
        viewportWidth: extent.width,
        sizes: {},
        sashSizes: {},
        issues,
    };

    if (mode === "compact") {
        const compactHidden: Record<string, true> = {...hidden};
        for (const part of SHELL_DRAG_COLLAPSIBLE_IDS) if (dragCollapsed[part] === true) compactHidden[part] = true;
        const root = compactShellTree(compactHidden) as GridBranchInput<string>;
        compactSizes(root, state, extent);
        return {mode, tree: root, effectivePanel: {...state.effective}, sizes: state.sizes, sashSizes: state.sashSizes, dragCollapsed, issues: state.issues};
    }

    const root = splitShellTree(state.effective, hidden) as GridBranchInput<string>;
    assignNode(root, "height", extent.height, extent.width, null, state);
    return {mode, tree: root, effectivePanel: {...state.effective}, sizes: state.sizes, sashSizes: state.sashSizes, dragCollapsed, issues: state.issues};
}

/** 由投影建渲染树：边界占用与尺寸分配同源，渲染器不二次判定。 */
export function createShellGrid(projection: ShellProjection): Grid<string> {
    const sash = projection.sashSizes;
    return createGrid(projection.tree, {sashSize: (branchId, index) => sash[branchId]?.[index] ?? 0});
}

// ── 手势 ─────────────────────────────────────────────────────────────────────

/**
 * 分支是否产生保存：直接子节点里至少有一个可保存的叶（面板，或宽度轴上的侧栏与右栏）。余量分支（editor 的内部结构）
 * 不产生保存。
 */
export function shellSettleableBranch(grid: Grid<string>, branchId: string): boolean {
    const node = grid.find(branchId);
    if (node === null || node.kind !== "branch") return false;
    const branch: GridBranch<string> = node;
    const axis: GridAxis = branch.orientation === "horizontal" ? "width" : "height";
    return branch.children.some((child) => child.id === "panel" || (axis === "width" && (child.id === "sidebar" || child.id === "auxiliarybar")));
}

/**
 * 落账前的整批核对（一次手势只经 `useGridLayout.onGestureCommit` 一个落账入口，它负责上下文、版本与容器尺寸）：
 * 空提交或含不产生保存的分支时整场拒绝，不留半状态。返回拒绝原因，可以落账时为 null。
 */
export function shellGestureProblem(grid: Grid<string>, commit: GridGestureCommit): string | null {
    if (commit.changes.length === 0) return "本次手势没有改变任何尺寸";
    for (const change of commit.changes) if (!shellSettleableBranch(grid, change.branchId)) return `分支 ${change.branchId} 不产生保存，本次调整没有落账`;
    return null;
}

/**
 * 落账后的补丁：只取直接主动且真实变化的可保存叶（侧栏、右栏宽度与面板两轴）。本次收起的叶只写布尔偏好位：它的目标
 * 是呈现值 0，写进尺寸会抹掉展开意图，之后从收起边界拉回来就只能得到最小尺寸。展开方向写的是恢复尺寸，照写。
 */
export function shellPatch(commit: GridGestureCommit): ShellSizePatch {
    const patch: ShellSizePatch = {};
    const dragCollapsed: Partial<Record<ShellDragCollapsiblePart, boolean>> = {};
    for (const change of commit.changes) {
        for (const [childId, collapsed] of Object.entries(change.collapsed)) {
            if ((SHELL_DRAG_COLLAPSIBLE_IDS as ReadonlyArray<string>).includes(childId)) dragCollapsed[childId as ShellDragCollapsiblePart] = collapsed;
        }
        for (const childId of change.active) {
            if (change.collapsed[childId] === true) continue;
            const before = change.baseline[childId];
            const after = change.target[childId];
            if (before === undefined || after === undefined || Math.abs(after - before) <= 1e-6) continue;
            if (childId === "sidebar" && change.axis === "width") patch.sidebarWidth = after;
            else if (childId === "auxiliarybar" && change.axis === "width") patch.auxiliarybarWidth = after;
            else if (childId === "panel") patch[change.axis === "width" ? "panelWidth" : "panelHeight"] = after;
        }
    }
    if (Object.keys(dragCollapsed).length > 0) patch.dragCollapsed = {...dragCollapsed};
    return patch;
}
