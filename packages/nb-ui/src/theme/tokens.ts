/**
 * 设计 token 名单。
 *
 * 值的事实源是 `src/tokens.css` 与 `src/theme.css`（后者装与 Tailwind 主题键同名的字体、字号、行高），
 * 这里只登记名字与分组，用途有两个：给消费方一个可枚举的契约，以及给测试一条「两个文件是否声明齐全」的兜底断言。
 *
 * 与 `colorway/colorway-contract.ts` 的分工：那边是**随配色变化的颜色**，这边是**主题可以覆盖的形状与节奏**。
 * `--elevation-*` 是唯一的交界处——它是常量公式，但公式里引用了随主题变的 `--shadow-color`。
 */

/** 排版：界面字体、字号刻度、行高、字重 */
export const nbTypographyTokens = [
    "--font-ui",
    "--font-mono",
    "--text-2xs",
    "--text-xs",
    "--text-sm",
    "--text-md",
    "--text-lg",
    "--text-xl",
    "--leading-tight",
    "--leading-ui",
    "--leading-reading",
    "--weight-normal",
    "--weight-medium",
    "--weight-strong",
] as const;

/** 间距：4 的倍数，七级刻度（控制区内边距默认 --space-4/--space-5，面板间距默认 --space-6） */
export const nbSpacingTokens = [
    "--space-1",
    "--space-2",
    "--space-3",
    "--space-4",
    "--space-5",
    "--space-6",
    "--space-7",
    "--space-8",
] as const;

/** 圆角：控件、面板、菜单、胶囊四档。阅读区用 0 或 2px，不走这四档。 */
export const nbRadiusTokens = ["--radius-control", "--radius-panel", "--radius-menu", "--radius-pill"] as const;

/** 层级：阴影只给真正浮起的元素，且必须由 --shadow-color 推导 */
/** `--elevation-menu` 是菜单与下拉的投影，缺省等于 `--elevation-popover`，主题可以单独收小。 */
export const nbElevationTokens = ["--elevation-flat", "--elevation-popover", "--elevation-menu", "--elevation-dialog"] as const;

/** 动效：prefers-reduced-motion 时时长全部降为 0 */
export const nbMotionTokens = ["--motion-fast", "--motion-base", "--motion-enter", "--motion-reveal-in", "--motion-reveal-hold", "--motion-reveal-out", "--motion-move", "--motion-layout", "--motion-dialog", "--motion-dialog-leave", "--ease-layout", "--ease-loop", "--ease-dialog-leave"] as const;

/** 滚动条：自绘滑块与原生细滚动条共用的颜色（三档）与自绘滑块的粗细 */
export const nbScrollbarTokens = ["--scrollbar-thumb-mix", "--scrollbar-thumb-hover-mix", "--scrollbar-thumb-active-mix", "--scrollbar-w"] as const;

/** 六组 token 的合集 */
export const nbDesignTokens = [
    ...nbTypographyTokens,
    ...nbSpacingTokens,
    ...nbRadiusTokens,
    ...nbElevationTokens,
    ...nbMotionTokens,
    ...nbScrollbarTokens,
] as const;

export type NbDesignToken = typeof nbDesignTokens[number];

/*
 * ── 主题层 ──────────────────────────────────────────────────────────────────
 * 上面六组是设计 token。下面三组是**主题层基线**：主题负责填的变量，
 * 默认取值同样在 src/tokens.css 的 :root 里（--font-display 在 src/theme.css），主题在 :root[data-nb-theme="<id>"] 覆盖。
 *
 * 分成两批登记而不是合成一张表，是因为它们回答的问题不同：
 * nbDesignTokens 回答「这个刻度叫什么」，nbThemeTokens 回答「主题能改什么」。
 * 加载器用后者判断一个主题的 declares 是不是在重复声明已有变量。
 */

/** 展示字体、字距、控件与容器的尺寸刻度：主题最直观的「密度」维度 */
export const nbThemeMetricTokens = [
    "--font-display",
    "--tracking-ui",
    "--control-h-sm",
    "--control-h-md",
    "--control-h-lg",
    "--control-px",
    "--menu-item-h",
    "--menu-item-font",
    "--menu-pad",
    "--panel-p",
    "--stack-gap",
    "--radius-control-lg",
    "--radius-dialog",
    "--radius-dialog-compact",
    "--radius-window",
    "--border-w",
] as const;

/** 装饰：渐变面、内阴影、抬起阴影、焦点环。全关就是「低 chrome」那一档 */
export const nbThemeDecorTokens = ["--surface-raise", "--inset-shadow", "--elevation-raised", "--focus-ring", "--focus-outline"] as const;

/**
 * 角色映射：控件的面用哪个配色变量、描边用不用色、分隔靠线还是靠底色。
 * 这是主题决策不是颜色决策——没有这一层，「低 chrome」这类主题只能靠改组件来表达。
 */
export const nbThemeRoleTokens = [
    "--control-surface",
    "--control-outline",
    "--button-surface",
    "--button-outline",
    "--panel-surface",
    "--panel-outline",
    "--sidebar-surface",
    "--toolbar-surface",
    "--overlay-surface",
    "--dialog-surface",
    "--dialog-surface-nested",
    "--overlay-blur",
    "--overlay-sheen",
    "--overlay-item-active",
    "--strip-surface",
    "--divider",
] as const;

/** 交互反馈：拖动边界的悬停线、拖放的落点高亮。主题决定线是实线还是发光、两端缩不缩、高亮多深。 */
export const nbThemeFeedbackTokens = [
    "--sash-line-color",
    "--sash-line-size",
    "--sash-line-inset",
    "--sash-line-radius",
    "--sash-line-glow",
    "--drop-area-fill",
    "--drop-area-border",
    "--layout-scrim",
    "--layout-sector-fill",
    "--layout-sector-line",
    "--layout-sector-active-fill",
    "--layout-sector-active-line",
    "--layout-live-sector-line",
    "--layout-slot-border",
    "--layout-card-radius",
    "--layout-card-shadow",
] as const;
/** 主题层基线的合集 */
export const nbThemeTokens = [...nbThemeMetricTokens, ...nbThemeDecorTokens, ...nbThemeRoleTokens, ...nbThemeFeedbackTokens] as const;

export type NbThemeToken = typeof nbThemeTokens[number];

/** 库已经占用的全部变量名（设计 token + 主题层基线）。主题的 declares 不能与它们重名。 */
export const nbReservedTokens = [...nbDesignTokens, ...nbThemeTokens] as const;
