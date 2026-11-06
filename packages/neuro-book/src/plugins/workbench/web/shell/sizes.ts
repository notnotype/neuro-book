/**
 * 工作台布局用到的尺寸常量与默认尺寸（docs/specs/ui/workbench-layout.md）：`state/layout-constraints.ts` 把它们交给
 * nb-layout 当约束，`state/default-tree.ts` 用它们建默认树。不依赖 nb-ui，服务端与 Bun 测试可以加载。
 */

// ── 产品常量 ─────────────────────────────────────────────────────────────────

/** 可调整边界的流内宽度：命中区由绝对定位扩展，不吃叶宽。 */
export const SASH_PX = 1;
export const SHELL_TITLEBAR_HEIGHT = 36;
export const SHELL_STATUSBAR_HEIGHT = 22;

/**
 * 水平面板高度：默认 200、最小 80、收起时只剩 32px 标题头。没有固定上限：面板能一直拖到编辑器的最小尺寸，再往前就是
 * 编辑器拖到零，即最大化。
 */
export const SHELL_PANEL_DEFAULT_HEIGHT = 200;
export const SHELL_PANEL_MIN_HEIGHT = 80;
export const SHELL_PANEL_COLLAPSED_HEIGHT = 32;

/** 左右面板宽度：最小 160，同样没有固定上限。 */
export const SHELL_PANEL_MIN_WIDTH = 160;

/** 拖到零的收起与恢复阈值（CSS px），与 nb-ui 的默认策略同值，这里只是显式声明。 */
export const SHELL_DRAG_COLLAPSE_THRESHOLD = 24;

/** ActivityBar 卡片宽（刚性）：38px 按钮加两侧余量。 */
export const SHELL_ACTIVITYBAR_WIDTH = 48;

export const SHELL_SIDEBAR_DEFAULT_WIDTH = 340;
export const SHELL_SIDEBAR_MIN_WIDTH = 160;
export const SHELL_SIDEBAR_MAX_WIDTH = 560;
export const SHELL_AUXILIARYBAR_DEFAULT_WIDTH = 400;
export const SHELL_AUXILIARYBAR_MIN_WIDTH = 160;
/** 右栏上限：max(360, 视口宽 × 0.45)。 */
export const SHELL_AUXILIARYBAR_MAX_FLOOR_WIDTH = 360;
export const SHELL_AUXILIARYBAR_MAX_VIEWPORT_RATIO = 0.45;

/** 第一次生成默认树时侧栏、右栏与面板的尺寸意图（CSS px）。 */
export const SHELL_SIZE_DEFAULTS = {
    sidebarWidth: SHELL_SIDEBAR_DEFAULT_WIDTH,
    auxiliarybarWidth: SHELL_AUXILIARYBAR_DEFAULT_WIDTH,
    panelHeight: SHELL_PANEL_DEFAULT_HEIGHT,
} as const;
