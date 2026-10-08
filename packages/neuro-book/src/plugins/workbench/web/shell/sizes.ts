/**
 * 外壳的尺寸常量、Part 词表、夹取与呈现事实的类型（docs/specs/ui/workbench-shell.md 外壳一输出 3–5）。不依赖 nb-ui：
 * 工作台 store、公开状态与命令只用到这些，几何投影（`layout.ts`，依赖 nb-ui 的网格原语）只给外壳组件用，服务端与
 * Bun 测试因此不必加载浏览器代码。
 */

import type {PanelAlignment, PanelPosition} from "./panel-state";

/** 尺寸的轴；与 nb-ui 的 `GridAxis` 同一取值。 */
export type ShellAxis = "width" | "height";

// ── Part ────────────────────────────────────────────────────────────────────

export const SHELL_PART_IDS = ["titlebar", "activitybar", "sidebar", "editor", "auxiliarybar", "panel", "statusbar"] as const;

export type ShellPartId = (typeof SHELL_PART_IDS)[number];

/** 可以隐藏的 Part：面板走自己的 `hidden`，editor 与 statusbar 始终在场。 */
export const SHELL_HIDDEN_PART_IDS = ["titlebar", "activitybar", "sidebar", "auxiliarybar"] as const;

export type ShellHideablePart = (typeof SHELL_HIDDEN_PART_IDS)[number];

/** 可以拖到零的 Part。 */
export const SHELL_DRAG_COLLAPSIBLE_IDS = ["sidebar", "auxiliarybar", "panel"] as const;

export type ShellDragCollapsiblePart = (typeof SHELL_DRAG_COLLAPSIBLE_IDS)[number];

// ── 产品常量 ─────────────────────────────────────────────────────────────────

/** 可调整边界的流内宽度：命中区由绝对定位扩展，不吃叶宽。 */
export const SASH_PX = 1;
export const SHELL_TITLEBAR_HEIGHT = 36;
export const SHELL_STATUSBAR_HEIGHT = 22;

/** 水平面板高度：默认 200、拖动区间 80..600、收起时只剩 32px 标题头。 */
export const SHELL_PANEL_DEFAULT_HEIGHT = 200;
export const SHELL_PANEL_MIN_HEIGHT = 80;
export const SHELL_PANEL_MAX_HEIGHT = 600;
export const SHELL_PANEL_COLLAPSED_HEIGHT = 32;

/** 左右面板宽度：默认 320、拖动区间 160..600（与高度分开记忆）。 */
export const SHELL_PANEL_DEFAULT_WIDTH = 320;
export const SHELL_PANEL_MIN_WIDTH = 160;
export const SHELL_PANEL_MAX_WIDTH = 600;

/** 拖到零的收起与恢复阈值（CSS px），与 nb-ui 的默认策略同值，这里只是显式声明。 */
export const SHELL_DRAG_COLLAPSE_THRESHOLD = 24;

/** ActivityBar 卡片宽（40px 按钮加两侧 4px 内边距）；卡片四周的留白由外壳加在叶上。 */
export const SHELL_ACTIVITYBAR_CARD_WIDTH = 48;
/** 卡片与窗体边界、相邻叶之间的留白；侧栏容器卡片同一份。 */
export const SHELL_GUTTER_PX = 6;
/** ActivityBar 叶宽（刚性）：卡片加两侧留白。 */
export const SHELL_ACTIVITYBAR_WIDTH = SHELL_ACTIVITYBAR_CARD_WIDTH + SHELL_GUTTER_PX * 2;

export const SHELL_SIDEBAR_DEFAULT_WIDTH = 340;
export const SHELL_SIDEBAR_MIN_WIDTH = 160;
export const SHELL_SIDEBAR_MAX_WIDTH = 560;
export const SHELL_AUXILIARYBAR_DEFAULT_WIDTH = 400;
export const SHELL_AUXILIARYBAR_MIN_WIDTH = 160;
/** 右栏上限：max(360, 视口宽 × 0.45)。 */
export const SHELL_AUXILIARYBAR_MAX_FLOOR_WIDTH = 360;
export const SHELL_AUXILIARYBAR_MAX_VIEWPORT_RATIO = 0.45;

/** 编辑器吸收余量；上限给大值而不是 Infinity：Infinity 经 JSON 变成 null。 */
export const SHELL_EDITOR_MAX_WIDTH = Number.MAX_SAFE_INTEGER;
/**
 * 编辑器在降级判定里的可用最小值：宽度不足退紧凑、高度不足先把面板退到标题头。底部与顶部的面板与编辑器同宽，宽度要
 * 放得下面板标题行：两侧内边距 16、五个框架按钮 146、间距 8、导航（容器标签带与上提的“移动到”）至少 96。
 */
export const SHELL_EDITOR_MIN_WIDTH = 272;
export const SHELL_EDITOR_MIN_HEIGHT = 120;

/** 紧凑呈现的容器宽阈值：按实测的外壳容器宽判断，不是 window 宽。 */
export const SHELL_COMPACT_WIDTH = 800;

export interface ShellLeafLimits {
    readonly minimumSize: number;
    readonly maximumSize: number;
}

function auxiliarybarMaxWidth(viewportWidth: number): number {
    const scaled = Number.isFinite(viewportWidth) ? Math.floor(viewportWidth * SHELL_AUXILIARYBAR_MAX_VIEWPORT_RATIO) : 0;
    return Math.max(SHELL_AUXILIARYBAR_MAX_FLOOR_WIDTH, scaled);
}

function rigid(size: number): ShellLeafLimits {
    return {minimumSize: size, maximumSize: size};
}

export type ShellFixedLeafId = "activitybar" | "sidebar" | "auxiliarybar" | "editor" | "titlebar" | "statusbar";

const SHELL_LEAF_LIMITS: Readonly<Record<ShellFixedLeafId, (viewportWidth: number) => ShellLeafLimits>> = {
    activitybar: () => rigid(SHELL_ACTIVITYBAR_WIDTH),
    sidebar: () => ({minimumSize: SHELL_SIDEBAR_MIN_WIDTH, maximumSize: SHELL_SIDEBAR_MAX_WIDTH}),
    auxiliarybar: (viewportWidth) => ({minimumSize: SHELL_AUXILIARYBAR_MIN_WIDTH, maximumSize: auxiliarybarMaxWidth(viewportWidth)}),
    editor: () => ({minimumSize: 0, maximumSize: SHELL_EDITOR_MAX_WIDTH}),
    titlebar: () => rigid(SHELL_TITLEBAR_HEIGHT),
    statusbar: () => rigid(SHELL_STATUSBAR_HEIGHT),
};

/** 固定叶在其主轴上的最小与最大值（建树、夹取、手势校验共用）。 */
export function shellLeafLimits(leafId: ShellFixedLeafId, viewportWidth: number): ShellLeafLimits {
    return SHELL_LEAF_LIMITS[leafId](viewportWidth);
}

/** 面板在其主轴上的最小与最大值：高度轴收起时刚性 32px；最大化时上限放开。宽度轴没有收起。 */
export function shellPanelAxisLimits(axis: ShellAxis, panel: Readonly<{collapsed: boolean; maximized: boolean}>): ShellLeafLimits {
    if (axis === "width") {
        return {minimumSize: SHELL_PANEL_MIN_WIDTH, maximumSize: panel.maximized ? SHELL_EDITOR_MAX_WIDTH : SHELL_PANEL_MAX_WIDTH};
    }
    if (panel.collapsed) return rigid(SHELL_PANEL_COLLAPSED_HEIGHT);
    return {minimumSize: SHELL_PANEL_MIN_HEIGHT, maximumSize: panel.maximized ? SHELL_EDITOR_MAX_WIDTH : SHELL_PANEL_MAX_HEIGHT};
}

/** 单叶夹取：最大值小于最小值时以最小值为准；非有限值按最小值，免得 NaN 进入分配。 */
export function clampLeafSize(size: number, limits: ShellLeafLimits): number {
    const low = Math.max(0, limits.minimumSize);
    const high = Math.max(low, limits.maximumSize);
    return Math.min(high, Math.max(low, Number.isFinite(size) ? size : low));
}

/** 面板高度意图的夹取（展开区间 80..600）；非有限值回落默认。 */
export function clampPanelHeight(height: number): number {
    return clampLeafSize(Number.isFinite(height) ? height : SHELL_PANEL_DEFAULT_HEIGHT, shellPanelAxisLimits("height", {collapsed: false, maximized: false}));
}

/** 面板宽度意图的夹取（160..600）；非有限值回落默认。 */
export function clampPanelWidth(width: number): number {
    return clampLeafSize(Number.isFinite(width) ? width : SHELL_PANEL_DEFAULT_WIDTH, shellPanelAxisLimits("width", {collapsed: false, maximized: false}));
}

// ── 值类型 ───────────────────────────────────────────────────────────────────

/** 四个绝对尺寸偏好：产品与 Lab 都只交这一份，不交树也不交可见集合。 */
export interface ShellSizePreferences {
    readonly sidebarWidth: number;
    readonly auxiliarybarWidth: number;
    readonly panelHeight: number;
    readonly panelWidth: number;
}

/** 拖到零的 Part。 */
export type ShellDragCollapseMap = Readonly<Partial<Record<ShellDragCollapsiblePart, boolean>>>;

/**
 * 一次手势产生的补丁：只含真正变化的项。尺寸是 px 意图；`dragCollapsed` 是拖到零的布尔偏好位，两者可同场出现，
 * 收起那一刻尺寸意图仍保留展开值，不写 0。
 */
export interface ShellSizePatch {
    sidebarWidth?: number;
    auxiliarybarWidth?: number;
    panelHeight?: number;
    panelWidth?: number;
    dragCollapsed?: ShellDragCollapseMap;
}

export const SHELL_SIZE_DEFAULTS: ShellSizePreferences = {
    sidebarWidth: SHELL_SIDEBAR_DEFAULT_WIDTH,
    auxiliarybarWidth: SHELL_AUXILIARYBAR_DEFAULT_WIDTH,
    panelHeight: SHELL_PANEL_DEFAULT_HEIGHT,
    panelWidth: SHELL_PANEL_DEFAULT_WIDTH,
};

export type ShellLayoutMode = "split" | "compact";

/** 实际生效的面板状态：紧凑、空间降级、瞬时最大化都会让它与保存的偏好不同。 */
export interface ShellEffectivePanel {
    readonly position: PanelPosition;
    readonly alignment: PanelAlignment;
    readonly collapsed: boolean;
    readonly maximized: boolean;
}

/** 外壳组件发布的呈现事实（不是保存意图）：工作台据此清过期的最大化、判断命令可用性。 */
export interface ShellLayoutFacts {
    readonly extent: {readonly width: number; readonly height: number};
    readonly mode: ShellLayoutMode;
    readonly effectivePanel: ShellEffectivePanel;
    readonly issues: ReadonlyArray<string>;
}

/** 偏好与补丁的合并：补丁只含真正变化的轴；结果夹取到各自的区间。拖到零的布尔位不进尺寸偏好。 */
export function mergeShellSizePatch(preferences: ShellSizePreferences, patch: ShellSizePatch): ShellSizePreferences {
    return {
        sidebarWidth: clampLeafSize(patch.sidebarWidth ?? preferences.sidebarWidth, shellLeafLimits("sidebar", Number.MAX_SAFE_INTEGER)),
        auxiliarybarWidth: clampLeafSize(patch.auxiliarybarWidth ?? preferences.auxiliarybarWidth, shellLeafLimits("auxiliarybar", Number.MAX_SAFE_INTEGER)),
        panelHeight: clampPanelHeight(patch.panelHeight ?? preferences.panelHeight),
        panelWidth: clampPanelWidth(patch.panelWidth ?? preferences.panelWidth),
    };
}
