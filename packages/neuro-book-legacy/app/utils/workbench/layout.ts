/**
 * Workbench 外壳的几何：位置/对齐树形、尺寸分配与手势结算。
 *
 * 拓扑（默认 `bottom + center`；`activity` 永远在主体左侧通高，Panel 只落在 body 里）：
 *
 * ```text
 * root V[titlebar, main H[activity, body H[left, panel-stack V[editor, panel], right]], statusbar]
 * ```
 *
 * 位置/对齐改变的是 **body 的形状**，不是「给 Panel 加一个兄弟分支」：
 *
 * |位置/对齐|body（省略可选叶）|
 * |---|---|
 * |bottom/center|H[left, panel-stack V[editor, panel], right]|
 * |bottom/left|H[panel-stack V[content-row H[left, editor], panel], right]|
 * |bottom/right|H[left, panel-stack V[content-row H[editor, right], panel]]|
 * |bottom/justify|H[panel-stack V[content-row H[left, editor, right], panel]]|
 * |top/*|同 bottom，panel-stack 的 V 子节点顺序对调|
 * |left|H[left, panel-stack H[panel, editor], right]|
 * |right|H[left, panel-stack H[editor, panel], right]|
 *
 * 固定内部 id：`body`、`panel-stack`（panel 与它的内容兄弟）、`content-row`（跨度包含的侧栏与 editor）；
 * 收敛后的叶查找按 id，不依赖父链。所有位置下 activity 都在 main 的左侧通高列，Panel 绝不跨过它。
 *
 * 尺寸口径（纯函数，无 Vue / Storage）：
 * - 偏好只有四个绝对值：左/右栏宽、Panel 高、Panel 宽；编辑器永远吸收余量；
 * - 只有可调整边界占 1px：activity 相邻、titlebar/statusbar 相邻、Panel 收起或最大化时都不占；
 * - 偏好装不下时先把余量叶降到 0，再把侧栏按「偏好 − 最小值」的可缩空间同比压到容器内（不写回偏好）；
 *   连合法最小值都装不下时进入紧凑呈现（宽度轴）或把 Panel 退到 32px 标题头（高度轴），并给诊断。
 */

import {
    createGrid,
    type Grid,
    type GridAxis,
    type GridBranch,
    type GridBranchInput,
    type GridExtent,
    type GridGestureCommit,
    type GridLayoutResult,
    type GridLeafInput,
    type GridNodeInput,
} from "@notnotype/nb-ui/layout";
import {
    WORKBENCH_AGENT_PANEL_DEFAULT_WIDTH,
    WORKBENCH_LEFT_PANEL_DEFAULT_WIDTH,
} from "nbook/shared/storage/workbench-state";
import {
    isHorizontalPanelPosition,
    panelMaximizable,
    type ShellPanelAlignment,
    type ShellPanelPosition,
    type WorkbenchPanelState,
} from "nbook/app/utils/workbench/panel-state";

// ── Part 与叶 id ─────────────────────────────────────────────────────────────

/** 横向分配的四个宽叶：顺序即渲染顺序（activity 永远在最左）。 */
export const SHELL_LEAF_IDS = ["activity", "left", "editor", "right"] as const;

export type ShellLeafId = (typeof SHELL_LEAF_IDS)[number];

/** 七个 Part 叶 = 纯布局组件的插槽名，也是 Teleport 的稳定落点集合。 */
export const SHELL_PART_IDS = ["titlebar", "activity", "left", "editor", "right", "panel", "statusbar"] as const;

/** 可以经 `hiddenParts` 隐藏的 Part：Panel 走自己的 `hidden`，editor/statusbar 永远在场。 */
export const SHELL_HIDDEN_PART_IDS = ["titlebar", "activity", "left", "right"] as const;

/** 取值域成员表：静态字面量用 Record（不建 Set）。 */
const SHELL_HIDDEN_PARTS: Record<string, true> = Object.fromEntries(SHELL_HIDDEN_PART_IDS.map((id) => [id, true]));

/** 根分支 id：`root V[titlebar, main, statusbar]`（Panel 在 main 里，不再与 activity 同级）。 */
export const SHELL_ROOT_ID = "root";

/** 主体分支 id：`main H[activity, body]`。 */
export const SHELL_MAIN_ID = "main";

/** body 分支 id：承载侧栏、Panel 与编辑区的组合，形状由位置/对齐决定。 */
export const SHELL_BODY_ID = "body";

/** Panel 与其内容兄弟所在的分支 id：水平位置是 V、左右位置是 H。 */
export const SHELL_PANEL_STACK_ID = "panel-stack";

/** 跨度把侧栏与 editor 收进来时的行分支 id（center 以外的水平对齐用它）。 */
export const SHELL_CONTENT_ROW_ID = "content-row";

/** 标题栏叶 id；刚性高度叶。 */
export const SHELL_TITLEBAR_ID = "titlebar";

/** Panel 叶 id；水平位置是高度叶、左右位置是宽度叶，可见性由 `panel.hidden` 决定。 */
export const SHELL_PANEL_ID = "panel";

/** 状态栏叶 id；最外侧的刚性高度叶，不可收起、不可隐藏。 */
export const SHELL_STATUSBAR_ID = "statusbar";

/** 活动栏叶 id：卡片自带四周留白，它两侧的边界既不可拖、也不占流内空间。 */
const SHELL_ACTIVITY_ID = "activity";

// ── 产品常量 ─────────────────────────────────────────────────────────────────

/** 壳层 sash 的流内宽度：命中区由绝对定位扩展，不吃叶宽（不要沿用验证台的 8px）。 */
export const SASH_PX = 1;

/** 标题栏 36：`DesktopTitleBar.vue` 的 `.desktop-title-bar { height: 36px; flex: 0 0 36px }`。 */
export const SHELL_TITLEBAR_HEIGHT = 36;

/** 状态栏 22：`WorkbenchStatusBar.vue` 的 `calc(var(--space-7) - var(--space-1))`。 */
export const SHELL_STATUSBAR_HEIGHT = 22;

/** 水平 Panel 高度：默认 200、拖动区间 80..600、收起时只剩 32px 标题头。 */
export const SHELL_PANEL_DEFAULT_HEIGHT = 200;
export const SHELL_PANEL_MIN_HEIGHT = 80;
export const SHELL_PANEL_MAX_HEIGHT = 600;
export const SHELL_PANEL_COLLAPSED_HEIGHT = 32;

/**
 * 「拖到零」的收起阈值（CSS px）：从展开最小尺寸继续向内的距离 / 从收起边界向外的恢复距离。
 * 与 nb-ui 的默认策略同值，Shell 只是把它显式声明出来，几何算法仍然只有一份。
 */
export const SHELL_DRAG_COLLAPSE_THRESHOLD = 24;

/** 左右 Panel 宽度：默认 320、拖动区间 160..600（与高度独立记忆）。 */
export const SHELL_PANEL_DEFAULT_WIDTH = 320;
export const SHELL_PANEL_MIN_WIDTH = 160;
export const SHELL_PANEL_MAX_WIDTH = 600;

/**
 * 活动栏**卡片**的宽度：图标条本体（40px 按钮 + 两侧 4px 内边距）。
 * 卡片是浮在窗体底上的一块面，它四周的留白由**外壳**加在叶上（纯布局组件给
 * `[data-leaf="activity"]` 的内边距），组件自己不写宽度也不写 margin——48 只在这里出现一次。
 */
export const SHELL_ACTIVITY_CARD_WIDTH = 48;

/** 卡片与窗体边界、相邻叶之间的留白（四边各一份）。 */
export const SHELL_ACTIVITY_GUTTER_PX = 6;

/** 侧栏**容器卡片**四周的留白：与活动栏卡片同源、同机制（外壳喂给叶的内边距）。 */
export const SHELL_CONTAINER_GUTTER_PX = SHELL_ACTIVITY_GUTTER_PX;

/** 活动栏叶宽（刚性）：60 = 卡片 48 + 两侧留白 6；叶宽是树上唯一的逻辑尺寸。 */
export const SHELL_ACTIVITY_WIDTH = SHELL_ACTIVITY_CARD_WIDTH + SHELL_ACTIVITY_GUTTER_PX * 2;

/** 左栏 340 / 右栏 400：产品默认宽（`shared/storage/workbench-state` 的同一对常量）。 */
export const SHELL_LEFT_PANEL_DEFAULT_WIDTH = WORKBENCH_LEFT_PANEL_DEFAULT_WIDTH;
export const SHELL_RIGHT_PANEL_DEFAULT_WIDTH = WORKBENCH_AGENT_PANEL_DEFAULT_WIDTH;

/** 左栏 160..560：下限放宽让小容器可用，默认宽与上限不变。 */
export const SHELL_LEFT_PANEL_MIN_WIDTH = 160;
export const SHELL_LEFT_PANEL_MAX_WIDTH = 560;

/** 右栏下限 160：与左栏同源，默认宽与上限不变。 */
export const SHELL_RIGHT_PANEL_MIN_WIDTH = 160;

/** 右栏上限的兜底：max(360, ratio × 视口) 的 360。 */
export const SHELL_RIGHT_PANEL_MAX_FLOOR_WIDTH = 360;

/** 右栏上限比值（实体现状 `app/pages/index.vue` 是 0.45：15% 会把默认宽 400 直接夹掉）。 */
export const SHELL_RIGHT_PANEL_MAX_VIEWPORT_RATIO = 0.45;

/** 编辑器吸收余量；上限给大值而不是 Infinity：快照要 JSON 序列化，Infinity 变成 null 会破坏恢复。 */
export const SHELL_EDITOR_MAX_WIDTH = Number.MAX_SAFE_INTEGER;

/** 编辑区在退化判定里的可用最小值：宽度不足退紧凑、高度不足先把 Panel 退到 32px 头。 */
export const SHELL_EDITOR_MIN_WIDTH = 120;
export const SHELL_EDITOR_MIN_HEIGHT = 120;

/** 紧凑呈现的容器宽阈值：按**实际壳容器宽**判断，便于 Lab 缩画布验证。 */
export const SHELL_COMPACT_WIDTH = 800;

export type ShellLeafLimits = {minimumSize: number; maximumSize: number};

/** 右栏上限：max(360, ratio × 视口)；视口不是有限值时退回兜底值。 */
function rightPanelMaxWidth(viewportWidth: number): number {
    const scaled = Number.isFinite(viewportWidth) ? Math.floor(viewportWidth * SHELL_RIGHT_PANEL_MAX_VIEWPORT_RATIO) : 0;
    return Math.max(SHELL_RIGHT_PANEL_MAX_FLOOR_WIDTH, scaled);
}

/** 刚性叶：min = max，尺寸不由拖动决定。 */
function rigid(size: number): ShellLeafLimits {
    return {minimumSize: size, maximumSize: size};
}

/** 主轴固定的叶的 min/max（面板走 `shellPanelAxisLimits`：它随位置/收起/最大化变化）。 */
const SHELL_LEAF_LIMITS: Record<string, (viewportWidth: number) => ShellLeafLimits> = {
    activity: () => rigid(SHELL_ACTIVITY_WIDTH),
    left: () => ({minimumSize: SHELL_LEFT_PANEL_MIN_WIDTH, maximumSize: SHELL_LEFT_PANEL_MAX_WIDTH}),
    right: (viewportWidth) => ({minimumSize: SHELL_RIGHT_PANEL_MIN_WIDTH, maximumSize: rightPanelMaxWidth(viewportWidth)}),
    editor: () => ({minimumSize: 0, maximumSize: SHELL_EDITOR_MAX_WIDTH}),
    titlebar: () => rigid(SHELL_TITLEBAR_HEIGHT),
    statusbar: () => rigid(SHELL_STATUSBAR_HEIGHT),
};

export type ShellFixedLeafId = "activity" | "left" | "right" | "editor" | "titlebar" | "statusbar";

/** 固定叶在其**主轴**上的 min/max（产品数字的唯一来源；建树、夹取、手势校验共用）。 */
export function shellLeafLimits(leafId: ShellFixedLeafId, viewportWidth: number): ShellLeafLimits {
    return SHELL_LEAF_LIMITS[leafId]!(viewportWidth);
}

/**
 * Panel 在其主轴上的 min/max：高度轴收起时刚性 32px 标题头；最大化时上限放开（占据整列）。
 * 宽度轴没有「收起」，只有正常的 160..600 与最大化放开。
 */
export function shellPanelAxisLimits(axis: GridAxis, panel: Readonly<{collapsed: boolean; maximized: boolean}>): ShellLeafLimits {
    if (axis === "width") {
        return panel.maximized
            ? {minimumSize: SHELL_PANEL_MIN_WIDTH, maximumSize: SHELL_EDITOR_MAX_WIDTH}
            : {minimumSize: SHELL_PANEL_MIN_WIDTH, maximumSize: SHELL_PANEL_MAX_WIDTH};
    }
    if (panel.collapsed) {
        return rigid(SHELL_PANEL_COLLAPSED_HEIGHT);
    }
    return panel.maximized
        ? {minimumSize: SHELL_PANEL_MIN_HEIGHT, maximumSize: SHELL_EDITOR_MAX_WIDTH}
        : {minimumSize: SHELL_PANEL_MIN_HEIGHT, maximumSize: SHELL_PANEL_MAX_HEIGHT};
}

/** 兼容旧调用点（记录引用解析）的收起口径：展开 80..600、收起刚性 32。 */
export function shellPanelHeightLimits(collapsed: boolean): ShellLeafLimits {
    return shellPanelAxisLimits("height", {collapsed, maximized: false});
}

/**
 * 单叶夹取：口径同 `useResizablePanel.clampResizablePanelSize`（max < min 时以 min 为准）；
 * 非有限值按 min 处理，避免 NaN 顺着尺寸表传进 Splitter 的百分比换算。
 */
export function clampLeafSize(size: number, limits: ShellLeafLimits): number {
    const low = Math.max(0, limits.minimumSize);
    const high = Math.max(low, limits.maximumSize);
    return Math.min(high, Math.max(low, Number.isFinite(size) ? size : low));
}

/** 高度意图的夹取（展开区间 80..600）；非有限值回落默认高度，别把 NaN 传进分配。 */
export function clampPanelHeight(height: number): number {
    return clampLeafSize(Number.isFinite(height) ? height : SHELL_PANEL_DEFAULT_HEIGHT, shellPanelHeightLimits(false));
}

/** 宽度意图的夹取（160..600）；非有限值回落默认宽度。 */
export function clampPanelWidth(width: number): number {
    return clampLeafSize(Number.isFinite(width) ? width : SHELL_PANEL_DEFAULT_WIDTH, shellPanelAxisLimits("width", {collapsed: false, maximized: false}));
}

// ── 值类型 ───────────────────────────────────────────────────────────────────

/** 四个绝对尺寸偏好：产品与 Lab 都只交这一份，不交树也不交可见集合。 */
export type ShellSizePreferences = Readonly<{
    leftPanelWidth: number;
    agentPanelWidth: number;
    panelHeight: number;
    panelWidth: number;
}>;

/**
 * 一次有效手势产生的补丁：只含真正变化的项（可写字段：结算时逐项填充）。
 *
 * 尺寸是 px 意图；`dragCollapsed` 是「拖到零」的偏好位（布尔，独立于尺寸），
 * 两者可以同场出现——收起那一刻尺寸意图仍然保留展开值，绝不写 0。
 */
export type ShellSizePatch = {-readonly [K in keyof ShellSizePreferences]?: number} & {
    /** 「拖到零」的偏好位；由定制会话写入，`commitSizes` 只处理 px 字段。 */
    dragCollapsed?: ShellDragCollapseMap;
};

/** 无记录时的产品默认。 */
export const SHELL_SIZE_DEFAULTS: ShellSizePreferences = {
    leftPanelWidth: SHELL_LEFT_PANEL_DEFAULT_WIDTH,
    agentPanelWidth: SHELL_RIGHT_PANEL_DEFAULT_WIDTH,
    panelHeight: SHELL_PANEL_DEFAULT_HEIGHT,
    panelWidth: SHELL_PANEL_DEFAULT_WIDTH,
};

export type ShellLayoutMode = "split" | "compact";

/** 实际生效的 Panel 状态：与保存意图区分（紧凑、空间退化、瞬时最大化都会改变它）。 */
export type ShellEffectivePanel = Readonly<{
    position: ShellPanelPosition;
    alignment: ShellPanelAlignment;
    collapsed: boolean;
    maximized: boolean;
}>;

/** 可拖到零的 Part：left / right / panel。 */
export type ShellDragCollapseMap = Readonly<Partial<Record<"left" | "right" | "panel", boolean>>>;

export type ShellProjectionInput = Readonly<{
    /** 实测容器尺寸（不是 window 尺寸）。 */
    extent: GridExtent;
    preferences: ShellSizePreferences;
    panel: WorkbenchPanelState;
    hiddenParts?: readonly string[];
    /**
     * 用户拖到零的 Part：保留节点与展开尺寸意图，内容 0px、相邻保留 1px 可拖边界。
     * 与环境隐藏（移出树、不留边界）是两件事，不能互相代替。
     */
    dragCollapsedParts?: ShellDragCollapseMap;
}>;

export type ShellProjection = Readonly<{
    mode: ShellLayoutMode;
    tree: GridNodeInput<string>;
    effectivePanel: ShellEffectivePanel;
    /** 每个叶/分支在其父主轴上的目标尺寸（intent）：建树用它，测试与手势断言也读它。 */
    sizes: Record<string, number>;
    /** 每个分支各条 sash 的实际占用，顺序对应相邻 children。 */
    sashSizes: Record<string, number[]>;
    /** 生效的拖到零集合（隐藏的 Part 不在其中）。 */
    dragCollapsed: ShellDragCollapseMap;
    issues: readonly string[];
}>;

/** 纯布局组件向宿主发布的**呈现事实**（不是保存意图）：宿主据此清过期最大化、判断命令可用性。 */
export type ShellLayoutFacts = Readonly<{
    extent: {width: number; height: number};
    mode: ShellLayoutMode;
    effectivePanel: ShellEffectivePanel;
    issues: readonly string[];
}>;

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

/** 隐藏集合：只接受 `SHELL_HIDDEN_PART_IDS` 里的项，未登记项丢弃（不静默当成合法输入）。 */
function hiddenSet(hiddenParts: readonly string[] | undefined): Record<string, true> {
    const hidden: Record<string, true> = {};
    for (const id of hiddenParts ?? []) {
        if (SHELL_HIDDEN_PARTS[id]) {
            hidden[id] = true;
        }
    }
    return hidden;
}

function optional<T>(value: T | null): T[] {
    return value === null ? [] : [value];
}

/** split 呈现的树：位置/对齐决定 body 的嵌套，activity 永远在 main 的左侧。 */
function splitShellTree(effective: ShellEffectivePanel, hidden: Record<string, true>): GridNodeInput<string> {
    const leftLeaf = hidden.left ? null : shellLeaf("left");
    const rightLeaf = hidden.right ? null : shellLeaf("right");
    const editorLeaf = shellLeaf("editor");
    const panelLeaf = hidden.panel ? null : shellLeaf(SHELL_PANEL_ID);
    const lower = effective.position === "bottom";

    let body: GridBranchInput<string>;
    if (isHorizontalPanelPosition(effective.position)) {
        const insideLeft = effective.alignment === "left" || effective.alignment === "justify";
        const insideRight = effective.alignment === "right" || effective.alignment === "justify";
        const contentChildren: GridNodeInput<string>[] = [
            ...(insideLeft ? optional(leftLeaf) : []),
            editorLeaf,
            ...(insideRight ? optional(rightLeaf) : []),
        ];
        // center 的跨度只有 editor：它自己就是内容节点，不额外包一层单子分支。
        const contentNode: GridNodeInput<string> = contentChildren.length === 1
            ? contentChildren[0]!
            : shellBranch(SHELL_CONTENT_ROW_ID, "horizontal", contentChildren);
        const stackChildren: GridNodeInput<string>[] = lower ? [contentNode, ...optional(panelLeaf)] : [...optional(panelLeaf), contentNode];
        const stack = shellBranch(SHELL_PANEL_STACK_ID, "vertical", stackChildren);
        body = shellBranch(SHELL_BODY_ID, "horizontal", [
            ...(!insideLeft ? optional(leftLeaf) : []),
            stack,
            ...(!insideRight ? optional(rightLeaf) : []),
        ]);
    } else {
        const stackChildren: GridNodeInput<string>[] = effective.position === "left"
            ? [...optional(panelLeaf), editorLeaf]
            : [editorLeaf, ...optional(panelLeaf)];
        body = shellBranch(SHELL_BODY_ID, "horizontal", [
            ...optional(leftLeaf),
            shellBranch(SHELL_PANEL_STACK_ID, "horizontal", stackChildren),
            ...optional(rightLeaf),
        ]);
    }

    return shellBranch(SHELL_ROOT_ID, "vertical", [
        ...(hidden.titlebar ? [] : [shellLeaf(SHELL_TITLEBAR_ID)]),
        shellBranch(SHELL_MAIN_ID, "horizontal", [
            ...(hidden.activity ? [] : [shellLeaf(SHELL_ACTIVITY_ID)]),
            body,
        ]),
        shellLeaf(SHELL_STATUSBAR_ID),
    ]);
}

/** 紧凑呈现的树：activity 仍是主体左侧通高列，其余 Part 在它右侧纵向排布。 */
function compactShellTree(hidden: Record<string, true>): GridNodeInput<string> {
    const body = shellBranch(SHELL_BODY_ID, "vertical", [
        ...(hidden.left ? [] : [shellLeaf("left")]),
        shellLeaf("editor"),
        ...(hidden.right ? [] : [shellLeaf("right")]),
        ...(hidden.panel ? [] : [shellLeaf(SHELL_PANEL_ID)]),
    ]);
    return shellBranch(SHELL_ROOT_ID, "vertical", [
        ...(hidden.titlebar ? [] : [shellLeaf(SHELL_TITLEBAR_ID)]),
        shellBranch(SHELL_MAIN_ID, "horizontal", [
            ...(hidden.activity ? [] : [shellLeaf(SHELL_ACTIVITY_ID)]),
            body,
        ]),
        shellLeaf(SHELL_STATUSBAR_ID),
    ]);
}

// ── 尺寸分配 ─────────────────────────────────────────────────────────────────

type ChildRole =
    | {readonly kind: "fixed"; readonly size: number}
    | {readonly kind: "preference"; readonly key: keyof ShellSizePreferences; readonly limits: ShellLeafLimits; readonly size: number}
    /** 拖到零：现在占 0px，展开意图（restore）留在节点上，边界仍是 1px 可拖。 */
    | {readonly kind: "drag-collapsed"; readonly limits: ShellLeafLimits; readonly restore: number}
    | {readonly kind: "remainder"};

type SizingState = {
    readonly mode: ShellLayoutMode;
    readonly preferences: ShellSizePreferences;
    /** 生效状态：高度不足时会在分配途中把 `collapsed` 改写为 true（只影响呈现）。 */
    readonly effective: {position: ShellPanelPosition; alignment: ShellPanelAlignment; collapsed: boolean; maximized: boolean};
    readonly hidden: Record<string, true>;
    readonly dragCollapsed: ShellDragCollapseMap;
    readonly viewportWidth: number;
    sizes: Record<string, number>;
    sashSizes: Record<string, number[]>;
    issues: string[];
};

/** 相邻两个 child 之间的 sash 占用：0 表示这条边界不可拖、也不占流内空间。 */
function shellSashSize(state: SizingState, leftId: string, rightId: string): number {
    if (state.mode === "compact") {
        return 0;
    }
    if (leftId === SHELL_ACTIVITY_ID || rightId === SHELL_ACTIVITY_ID) {
        return 0;
    }
    if (leftId === SHELL_TITLEBAR_ID || rightId === SHELL_TITLEBAR_ID || leftId === SHELL_STATUSBAR_ID || rightId === SHELL_STATUSBAR_ID) {
        return 0;
    }
    if ((leftId === SHELL_PANEL_ID || rightId === SHELL_PANEL_ID) && (state.effective.collapsed || state.effective.maximized)) {
        return 0;
    }
    return SASH_PX;
}

function branchSash(state: SizingState, branch: GridBranchInput<string>): number[] {
    const sash: number[] = [];
    for (let index = 0; index < branch.children.length - 1; index += 1) {
        sash.push(shellSashSize(state, branch.children[index]!.id, branch.children[index + 1]!.id));
    }
    return sash;
}


/**
 * 把收起策略写到叶上：
 * - `sizing: "fixed"`——侧栏与 Panel 是「希望保留 px」的叶，余量归 editor；
 * - `collapse`——展开尺寸意图（restore）与 24px 阈值一起交给渲染层与拖动会话，只有它们知道怎么收起。
 *
 * 节点 `size` 永远是**展开意图**：拖到零时呈现来自收起策略（0px），不是把意图写成 0。
 */
function writeCollapseIntent(
    node: GridNodeInput<string>,
    axis: GridAxis,
    role: {readonly kind: "drag-collapsed" | "preference"; readonly limits: ShellLeafLimits; readonly restore: number},
): void {
    node.sizing = "fixed";
    if (node.kind === "leaf") {
        node.size = axis === "width" ? {width: role.restore, height: node.size!.height} : {width: node.size!.width, height: role.restore};
    }
    node.collapse = {
        collapsedSize: 0,
        restoreSize: Math.max(0, role.restore),
        collapseThreshold: SHELL_DRAG_COLLAPSE_THRESHOLD,
        expandThreshold: SHELL_DRAG_COLLAPSE_THRESHOLD,
        collapsed: role.kind === "drag-collapsed",
    };
}

/** 拖到零的叶与相邻内容之间保留 1px 可拖边界（否则无法从边界拉回）。 */
function isDragCollapsedSide(state: SizingState, id: string): boolean {
    return state.dragCollapsed[id as "left" | "right" | "panel"] === true;
}

/** child 在本分支主轴上的角色：固定值 / 用户偏好 / 拖到零 / 余量。 */
function classifyChild(child: GridNodeInput<string>, axis: GridAxis, state: SizingState, maximizedHere: boolean): ChildRole {
    const id = child.id;
    if (id === SHELL_PANEL_ID) {
        if (state.effective.maximized) {
            return {kind: "remainder"};
        }
        const limits = shellPanelAxisLimits(axis, {collapsed: false, maximized: false});
        const key: keyof ShellSizePreferences = axis === "width" ? "panelWidth" : "panelHeight";
        const restore = clampLeafSize(state.preferences[key], limits);
        if (state.dragCollapsed.panel === true) {
            return {kind: "drag-collapsed", limits, restore};
        }
        if (state.effective.collapsed) {
            return {kind: "fixed", size: SHELL_PANEL_COLLAPSED_HEIGHT};
        }
        return {kind: "preference", key, limits, size: restore};
    }
    if (id === SHELL_ACTIVITY_ID) {
        return {kind: "fixed", size: SHELL_ACTIVITY_WIDTH};
    }
    if (id === SHELL_TITLEBAR_ID) {
        return {kind: "fixed", size: SHELL_TITLEBAR_HEIGHT};
    }
    if (id === SHELL_STATUSBAR_ID) {
        return {kind: "fixed", size: SHELL_STATUSBAR_HEIGHT};
    }
    if (id === "left" || id === "right") {
        const limits = shellLeafLimits(id, state.viewportWidth);
        const key: keyof ShellSizePreferences = id === "left" ? "leftPanelWidth" : "agentPanelWidth";
        const size = clampLeafSize(state.preferences[key], limits);
        if (state.dragCollapsed[id as "left" | "right"] === true) {
            return {kind: "drag-collapsed", limits, restore: size};
        }
        return {kind: "preference", key, limits, size};
    }
    // editor 与内部结构分支都是余量；最大化时除 panel 之外的余量全部让位。
    return maximizedHere ? {kind: "fixed", size: 0} : {kind: "remainder"};
}

/**
 * 高度轴的退化：展开的 Panel 与 editor 的最小高度装不下时，**只在呈现**把 Panel 退到 32px 标题头。
 * 偏好不动，换回高容器后按原高度恢复。
 */
function preflightPanelCollapse(branch: GridBranchInput<string>, state: SizingState): void {
    if (branch.orientation !== "vertical" || state.effective.collapsed || state.effective.maximized) {
        return;
    }
    if (!isHorizontalPanelPosition(state.effective.position) || !branch.children.some((child) => child.id === SHELL_PANEL_ID)) {
        return;
    }
    const sash = branchSash(state, branch).reduce((sum, size) => sum + size, 0);
    const extent = branch.size!;
    const avail = Math.max(0, extent.height - sash);
    const desired = clampPanelHeight(state.preferences.panelHeight);
    if (avail - desired < SHELL_EDITOR_MIN_HEIGHT) {
        state.effective.collapsed = true;
        state.issues.push(`外壳高度不足 editor ≥ ${SHELL_EDITOR_MIN_HEIGHT}px 与面板 ${desired}px：面板仅在呈现退回 ${SHELL_PANEL_COLLAPSED_HEIGHT}px 标题头`);
    }
}

/** 只把尺寸/约束写到节点上，不递归（紧凑呈现按显式计划逐层调用它）。 */
function writeNode(
    node: GridNodeInput<string>,
    axis: GridAxis,
    mainSize: number,
    crossSize: number,
    limits: ShellLeafLimits | null,
    state: SizingState,
): void {
    const main = Math.max(0, Number.isFinite(mainSize) ? mainSize : 0);
    const cross = Math.max(0, Number.isFinite(crossSize) ? crossSize : 0);
    node.size = axis === "width" ? {width: main, height: cross} : {width: cross, height: main};
    const bounds = limits ?? {minimumSize: 0, maximumSize: SHELL_EDITOR_MAX_WIDTH};
    node.minimumSize = axis === "width"
        ? {width: bounds.minimumSize, height: 0}
        : {width: 0, height: bounds.minimumSize};
    node.maximumSize = axis === "width"
        ? {width: bounds.maximumSize, height: Number.MAX_SAFE_INTEGER}
        : {width: Number.MAX_SAFE_INTEGER, height: bounds.maximumSize};
    state.sizes[node.id] = main;
}

/** 写节点并继续向下分配（split 呈现的通用路径）。 */
function assignNode(
    node: GridNodeInput<string>,
    axis: GridAxis,
    mainSize: number,
    crossSize: number,
    limits: ShellLeafLimits | null,
    state: SizingState,
): void {
    writeNode(node, axis, mainSize, crossSize, limits, state);
    if (node.kind === "branch") {
        distributeBranch(node, state);
    }
}

/** 分支内部的分配：固定叶 + 偏好叶各自夹取，余量叶等分剩下的空间。 */
function distributeBranch(branch: GridBranchInput<string>, state: SizingState): void {
    const axis: GridAxis = branch.orientation === "horizontal" ? "width" : "height";
    const extent = branch.size!;
    const branchMain = axis === "width" ? extent.width : extent.height;
    const branchCross = axis === "width" ? extent.height : extent.width;

    // 收起判定必须先于 sash：退到 32px 头的 Panel 与内容之间不再有可拖边界。
    preflightPanelCollapse(branch, state);
    const sash = branchSash(state, branch);
    state.sashSizes[branch.id] = sash;
    const sashTotal = sash.reduce((sum, size) => sum + size, 0);
    const available = Math.max(0, branchMain - sashTotal);
    const maximizedHere = state.effective.maximized && branch.children.some((child) => child.id === SHELL_PANEL_ID);

    const roles = branch.children.map((child) => classifyChild(child, axis, state, maximizedHere));
    const fixedTotal = roles.reduce((sum, role) => sum + (role.kind === "fixed" ? role.size : 0), 0);
    const preferred = roles.flatMap((role, index) => role.kind === "preference" ? [{role, index}] : []);
    const remainders = roles.flatMap((role, index) => role.kind === "remainder" ? [branch.children[index]!] : []);

    // 拖到零的叶不参与预算：它与兄弟之间保留的 1px 边界已经算在 sash 里。
    const sizes: number[] = roles.map((role) => role.kind === "remainder" || role.kind === "drag-collapsed" ? 0 : role.size);
    let preferredTotal = preferred.reduce((sum, entry) => sum + entry.role.size, 0);
    const budget = Math.max(0, available - fixedTotal);
    if (preferredTotal > budget) {
        // 偏好装不下：按「偏好 − 最小值」的可缩空间同比压到容器内，不写回偏好。
        const shrinkable = preferred.reduce((sum, entry) => sum + Math.max(0, entry.role.size - entry.role.limits.minimumSize), 0);
        const factor = shrinkable > 0 ? Math.min(1, (preferredTotal - budget) / shrinkable) : 1;
        for (const entry of preferred) {
            const floor = entry.role.limits.minimumSize;
            const next = Math.max(floor, entry.role.size - (entry.role.size - floor) * factor);
            sizes[entry.index] = next;
        }
        preferredTotal = preferred.reduce((sum, entry) => sum + sizes[entry.index]!, 0);
        state.issues.push(`可用空间 ${budget}px 装不下侧栏/Panel 偏好：已按最小尺寸压缩呈现（不写回偏好）`);
    }

    const rest = Math.max(0, budget - preferredTotal);
    if (remainders.length > 0) {
        const share = rest / remainders.length;
        for (const child of remainders) {
            sizes[branch.children.indexOf(child)] = share;
        }
        if (rest <= 0 && !maximizedHere) {
            state.issues.push(`可用空间 ${budget}px 已被固定叶与偏好占满：余量叶取 0`);
        }
    } else if (rest > 0) {
        state.issues.push(`分支 ${branch.id} 没有余量叶：剩余 ${rest}px 未分配`);
    }

    branch.children.forEach((child, index) => {
        const role = roles[index]!;
        const limits = role.kind === "preference" || role.kind === "drag-collapsed" ? role.limits : null;
        assignNode(child, axis, sizes[index]!, branchCross, limits, state);
        if (role.kind === "drag-collapsed") {
            // 呈现 0px，但**意图**保留展开尺寸：恢复与「记忆尺寸」都读它，绝不写 0 覆盖偏好。
            writeCollapseIntent(child, axis, role);
            state.sizes[child.id] = 0;
        } else if (role.kind === "preference") {
            writeCollapseIntent(child, axis, {kind: "preference", limits: role.limits, restore: role.size});
        }
    });
}

/**
 * 紧凑呈现的尺寸：activity 是主体左侧的通高列，titlebar/statusbar 刚性，
 * Panel 保持高度意图（收起时 32px 头），其余可见主体叶等分剩余高度；紧凑态没有 sash。
 */
function compactSizes(root: GridBranchInput<string>, state: SizingState, extent: GridExtent): void {
    const height = Math.max(0, extent.height);
    const width = Math.max(0, extent.width);
    const titlebar = state.hidden.titlebar ? 0 : Math.min(SHELL_TITLEBAR_HEIGHT, height);
    const statusbar = Math.min(SHELL_STATUSBAR_HEIGHT, Math.max(0, height - titlebar));
    const bodyHeight = Math.max(0, height - titlebar - statusbar);
    const activity = state.hidden.activity ? 0 : SHELL_ACTIVITY_WIDTH;
    const bodyWidth = Math.max(0, width - activity);

    state.sizes = {};
    state.sashSizes = {};
    writeNode(root, "height", height, width, null, state);
    const main = root.children.find((child) => child.id === SHELL_MAIN_ID) as GridBranchInput<string>;
    writeNode(main, "width", bodyHeight, width, null, state);
    const activityLeaf = main.children.find((child) => child.id === SHELL_ACTIVITY_ID);
    if (activityLeaf) {
        writeNode(activityLeaf, "width", activity, bodyHeight, rigid(SHELL_ACTIVITY_WIDTH), state);
    }
    const body = main.children.find((child) => child.id === SHELL_BODY_ID) as GridBranchInput<string>;
    writeNode(body, "width", bodyWidth, bodyHeight, null, state);

    const panelPresent = body.children.some((child) => child.id === SHELL_PANEL_ID);
    const panelSize = panelPresent
        ? state.effective.collapsed
            ? SHELL_PANEL_COLLAPSED_HEIGHT
            : Math.min(clampPanelHeight(state.preferences.panelHeight), bodyHeight)
        : 0;
    const others = body.children.length - (panelPresent ? 1 : 0);
    const rest = Math.max(0, bodyHeight - panelSize);
    if (others > 0 && rest <= 0) {
        state.issues.push(`紧凑呈现高度 ${bodyHeight}px 不足：主体叶取 0`);
    }
    const share = others > 0 ? rest / others : 0;
    for (const child of body.children) {
        const isPanel = child.id === SHELL_PANEL_ID;
        writeNode(child, "height", isPanel ? panelSize : share, bodyWidth, isPanel ? shellPanelAxisLimits("height", state.effective) : null, state);
    }
}

// ── 投影 ─────────────────────────────────────────────────────────────────────

/**
 * 载入/读取失败或非法输入时的兜底宽度：**不缩小**整体布局，只是不让 NaN 进树。
 * 真实容器宽由调用方的实测值给出，这里只保护非有限输入。
 */
function finiteExtent(extent: GridExtent): GridExtent {
    return {
        width: Number.isFinite(extent.width) && extent.width > 0 ? extent.width : 0,
        height: Number.isFinite(extent.height) && extent.height > 0 ? extent.height : 0,
    };
}

/** split 呈现下横向最小值是否装得下：装不下就退紧凑（所有叶仍非负且在容器内）。 */
function splitRowFits(position: ShellPanelPosition, hidden: Record<string, true>, dragCollapsed: ShellDragCollapseMap, width: number): boolean {
    const activity = hidden.activity ? 0 : SHELL_ACTIVITY_WIDTH;
    const body = Math.max(0, width - activity);
    // 拖到零的 Part 不再要求自己的展开最小宽度，但保留的 1px 边界照算是流内占用。
    const sidebars = (hidden.left || dragCollapsed.left === true ? 0 : SHELL_LEFT_PANEL_MIN_WIDTH)
        + (hidden.right || dragCollapsed.right === true ? 0 : SHELL_RIGHT_PANEL_MIN_WIDTH);
    const panel = isHorizontalPanelPosition(position) ? 0 : SHELL_PANEL_MIN_WIDTH;
    // 拖到零的叶仍在树上，所以它的边界已经算在 sash 里；只有隐藏才会让边界消失。
    const leaves = (hidden.left ? 0 : 1) + 1 + (isHorizontalPanelPosition(position) ? 0 : 1) + (hidden.right ? 0 : 1);
    const sashes = Math.max(0, leaves - 1) * SASH_PX;
    return body >= sidebars + panel + SHELL_EDITOR_MIN_WIDTH + sashes;
}

/**
 * 一次投影：把偏好 + Panel 状态 + 隐藏集合 + 实测容器，算成树、尺寸与生效状态。
 * 纯函数——没有副作用，也不持有任何跨次调用的状态。
 */
export function projectShell(input: ShellProjectionInput): ShellProjection {
    const extent = finiteExtent(input.extent);
    const hidden = hiddenSet(input.hiddenParts);
    if (input.panel.hidden) {
        hidden.panel = true;
    }
    // 拖到零只在**可见**的 Part 上生效：隐藏是移出树，两者不是一回事。
    const dragCollapsed: {left?: boolean; right?: boolean; panel?: boolean} = {};
    for (const part of ["left", "right", "panel"] as const) {
        if (hidden[part] === true) {
            continue;
        }
        if (input.dragCollapsedParts?.[part] === true) {
            dragCollapsed[part] = true;
        }
    }
    const issues: string[] = [];

    // 生效的 Panel 状态：侧向位置忽略「收起」；最大化只在合法组合下成立。
    const storedHorizontal = isHorizontalPanelPosition(input.panel.position);
    let position: ShellPanelPosition = input.panel.position;
    let alignment: ShellPanelAlignment = storedHorizontal ? input.panel.alignment : "center";
    let collapsed = storedHorizontal ? input.panel.collapsed : false;
    let maximized = input.panel.maximized
        && !input.panel.hidden
        && panelMaximizable(position, alignment)
        && !collapsed;

    let mode: ShellLayoutMode = extent.width < SHELL_COMPACT_WIDTH ? "compact" : "split";
    if (mode === "split" && !isHorizontalPanelPosition(position) && !splitRowFits(position, hidden, dragCollapsed, extent.width)) {
        // 左右 Panel 放不进 body（侧栏最小值 + Panel 240 + editor 120）：临时退回底部居中呈现。
        issues.push(`容器宽 ${extent.width}px 放不下左右 Panel：已临时按底部居中呈现（不写回偏好）`);
        position = "bottom";
        alignment = "center";
        collapsed = false;
        maximized = false;
    }
    if (mode === "split" && !splitRowFits(position, hidden, dragCollapsed, extent.width)) {
        mode = "compact";
        issues.push(`容器宽 ${extent.width}px 装不下侧栏与编辑区的最小宽度：已切换紧凑呈现`);
    }
    if (mode === "compact") {
        // 紧凑呈现：Panel 强制底部两端对齐，瞬时最大化清空（不写回偏好）。
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
        for (const part of ["left", "right", "panel"] as const) {
            if (dragCollapsed[part] === true) {
                compactHidden[part] = true;
            }
        }
        const root = compactShellTree(compactHidden) as GridBranchInput<string>;
        compactSizes(root, state, extent);
        return {
            mode,
            tree: root,
            effectivePanel: {...state.effective},
            sizes: state.sizes,
            sashSizes: state.sashSizes,
            dragCollapsed,
            issues: state.issues,
        };
    }

    const root = splitShellTree(state.effective, hidden) as GridBranchInput<string>;
    assignNode(root, "height", extent.height, extent.width, null, state);
    return {
        mode,
        tree: root,
        effectivePanel: {...state.effective},
        sizes: state.sizes,
        sashSizes: state.sashSizes,
        dragCollapsed,
        issues: state.issues,
    };
}

/** 由投影建渲染树：sash 占用与尺寸分配同源，渲染器不二次判定。 */
export function createShellGrid(projection: ShellProjection): Grid<string> {
    const sash = projection.sashSizes;
    return createGrid(projection.tree, {
        sashSize: (branchId, index) => sash[branchId]?.[index] ?? 0,
    });
}

/** 渲染树里各分支的直接子 id：手势结算与诊断读它，不依赖父链。 */
function branchChildren(grid: Grid<string>, branchId: string): GridBranch<string> | null {
    const node = grid.find(branchId);
    return node && node.kind === "branch" ? node : null;
}

// ── 手势结算 ─────────────────────────────────────────────────────────────────

export type ShellGestureSettlement =
    | {readonly ok: true; readonly patch: ShellSizePatch}
    | {readonly ok: false; readonly reason: string};

/**
 * 一次完整手势的结算：整批 `changes`（含交汇处两根轴）在同一次原语落账里应用，
 * 任一项不通过则整批不落账、树保持原样。
 *
 * 补丁只映射**直接 active 且真实变化**的可保存叶（left / right / panel）：嵌套分支与 editor
 * 只是余量，不保存。分支不属于可结算集合时整场拒绝，不留半状态。
 */
export function settleShellGesture(input: Readonly<{
    grid: Grid<string>;
    contextKey: string;
    commit: GridGestureCommit;
}>): ShellGestureSettlement {
    if (input.commit.contextKey !== input.contextKey) {
        return {ok: false, reason: "工作面已切换，本次调整没有落账"};
    }
    if (input.commit.changes.length === 0) {
        return {ok: false, reason: "本次手势没有改变任何尺寸"};
    }
    for (const change of input.commit.changes) {
        if (!shellSettleableBranch(input.grid, change.branchId)) {
            return {ok: false, reason: `分支 ${change.branchId} 不产生保存，本次调整没有落账`};
        }
    }
    const applied = input.grid.resizeBranches(input.commit.changes);
    if (!applied.ok) {
        return {ok: false, reason: applied.reason};
    }
    const patch: ShellSizePatch = {};
    const dragCollapsed: {left?: boolean; right?: boolean; panel?: boolean} = {};
    for (const change of input.commit.changes) {
        for (const [childId, collapsed] of Object.entries(change.collapsed)) {
            if (childId === "left" || childId === "right" || childId === "panel") {
                dragCollapsed[childId] = collapsed;
            }
        }
        for (const childId of change.active) {
            // 本次手势收起的叶只写布尔偏好位：它的 target 是 0（呈现值），写进尺寸会把展开意图抹掉，
            // 之后从收起边界拉回来就只能得到最小尺寸。展开方向（collapsed === false）写的是恢复尺寸，照写。
            if (change.collapsed[childId] === true) {
                continue;
            }
            const before = change.baseline[childId];
            const after = change.target[childId];
            if (before === undefined || after === undefined || Math.abs(after - before) <= 1e-6) {
                continue;
            }
            applyShellSizeField(patch, childId, change.axis, after);
        }
    }
    if (Object.keys(dragCollapsed).length > 0) {
        patch.dragCollapsed = {...dragCollapsed};
    }
    return {ok: true, patch};
}

/** 可保存的叶 → 偏好字段：只有左右侧栏宽度与 Panel 两轴进记录，其它叶只是余量。 */
function applyShellSizeField(patch: ShellSizePatch, childId: string, axis: GridAxis, value: number): void {
    if (childId === "left" && axis === "width") {
        patch.leftPanelWidth = value;
    } else if (childId === "right" && axis === "width") {
        patch.agentPanelWidth = value;
    } else if (childId === SHELL_PANEL_ID) {
        if (axis === "width") {
            patch.panelWidth = value;
        } else {
            patch.panelHeight = value;
        }
    }
}

/**
 * 分支是否可结算：直接 child 里至少有一个能落账的叶（left / right / panel）。
 * 余量分支（editor 的内部结构）不产生保存，不在这里出现。
 */
export function shellSettleableBranch(grid: Grid<string>, branchId: string): boolean {
    const branch = branchChildren(grid, branchId);
    if (branch === null) {
        return false;
    }
    const axis: GridAxis = branch.orientation === "horizontal" ? "width" : "height";
    return branch.children.some((child) => {
        if (child.id === SHELL_PANEL_ID) {
            return true;
        }
        return axis === "width" && (child.id === "left" || child.id === "right");
    });
}

/** 偏好 + 补丁的合并（补丁只含真正变化的轴；非有限值不进结果）。 */
export function mergeShellSizePatch(preferences: ShellSizePreferences, patch: ShellSizePatch): ShellSizePreferences {
    // `patch.dragCollapsed` 是独立偏好位，不进尺寸偏好；这里只合并 px 字段。
    const next: ShellSizePreferences = {
        leftPanelWidth: patch.leftPanelWidth ?? preferences.leftPanelWidth,
        agentPanelWidth: patch.agentPanelWidth ?? preferences.agentPanelWidth,
        panelHeight: patch.panelHeight ?? preferences.panelHeight,
        panelWidth: patch.panelWidth ?? preferences.panelWidth,
    };
    return {
        leftPanelWidth: clampLeafSize(next.leftPanelWidth, shellLeafLimits("left", Number.MAX_SAFE_INTEGER)),
        agentPanelWidth: clampLeafSize(next.agentPanelWidth, shellLeafLimits("right", Number.MAX_SAFE_INTEGER)),
        panelHeight: clampPanelHeight(next.panelHeight),
        panelWidth: clampPanelWidth(next.panelWidth),
    };
}
