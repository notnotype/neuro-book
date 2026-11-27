/**
 * nb-layout 读的全部 CSS 变量（docs/specs/ui/nested-grid.md 输出 141、“边界与兼容”，docs/specs/theme/system.md 的“布局组件的
 * 桥接”）。这份清单是同一个来源：
 * - 源码里用到的名字与每处 `var()` 的回退必须与它一致（`theme-vars.test.ts` 扫源码）；
 * - 应用里的一致性测试拿它核对 nb-ui `tokens.css` 的桥接；
 * - JS 读变量读到空串时（宿主没给），取这里的回退，与 CSS 的回退同值；
 * - README 的变量表与主题文档的对照表照它写。
 *
 * 三类：
 * - `bridged`：主题的值。装了 nb-ui 的宿主由 nb-ui 在根元素上把 `from` 接过来（`from` 为 null 的是 nb-ui 直接写数值，例如
 *   层级）；不装时用 `fallback`。尺寸、时长、圆角与
 *   nb-ui 的缺省相同；颜色用系统色（`Canvas`、`CanvasText`、`Highlight` 一类），不装 nb-ui 的暗色宿主也不会错得离谱。
 * - `host`：宿主旋钮，主题不写，宿主直接设新名，可以设在子树上。
 * - `inline`：组件自己用 JS 写在元素的行内、再由样式读回；没写时按 `fallback`（有的话）。
 *
 * `themed` 的那一批进 README 的变量表、承诺不随意改名；其余是内部名字。
 */

/** @experimental */
export type NbLayoutVarName = `--nb-layout-${string}`;

/** @experimental */
export type NbLayoutThemeVar =
    | {readonly name: NbLayoutVarName; readonly kind: "bridged"; readonly from: `--${string}` | null; readonly fallback: string; readonly themed: boolean}
    | {readonly name: NbLayoutVarName; readonly kind: "host"; readonly fallback: string}
    | {readonly name: NbLayoutVarName; readonly kind: "inline"; readonly fallback?: string};

const bridged = (name: NbLayoutVarName, from: `--${string}` | null, fallback: string, themed = false): NbLayoutThemeVar => ({name, kind: "bridged", from, fallback, themed});

/** 分隔线、描边的系统色：前景色压淡，暗色与亮色宿主都看得见。 */
const DIVIDER = "color-mix(in srgb, CanvasText 15%, transparent)";

/** @experimental */
export const NB_LAYOUT_THEME_VARS: readonly NbLayoutThemeVar[] = [
    // 动效：时长与 nb-ui 的缺省相同；系统减少动态效果时由 `vue/global.css` 归零。
    bridged("--nb-layout-motion-fast", "--motion-fast", "120ms", true),
    bridged("--nb-layout-motion-base", "--motion-base", "180ms", true),
    bridged("--nb-layout-motion-move", "--motion-move", "280ms", true),
    bridged("--nb-layout-motion-layout", "--motion-layout", "470ms", true),
    bridged("--nb-layout-ease-layout", "--ease-layout", "cubic-bezier(0.23, 1, 0.32, 1)", true),
    bridged("--nb-layout-ease-dialog-leave", "--ease-dialog-leave", "cubic-bezier(0.4, 0, 0.8, 0.5)"),

    // 拖动边界的悬停线（theme/system 第 2 层）。
    bridged("--nb-layout-sash-line-color", "--sash-line-color", "Highlight", true),
    bridged("--nb-layout-sash-line-size", "--sash-line-size", "3px", true),
    bridged("--nb-layout-sash-line-inset", "--sash-line-inset", "0px", true),
    bridged("--nb-layout-sash-line-radius", "--sash-line-radius", "0px", true),
    bridged("--nb-layout-sash-line-glow", "--sash-line-glow", "none", true),

    // 落点：高亮、分区与浮动窗的卡片（theme/system 第 2 层）。
    bridged("--nb-layout-drop-area-fill", "--drop-area-fill", "color-mix(in srgb, Highlight 12%, transparent)", true),
    bridged("--nb-layout-drop-area-border", "--drop-area-border", "color-mix(in srgb, Highlight 70%, transparent)", true),
    bridged("--nb-layout-scrim", "--layout-scrim", "color-mix(in srgb, color-mix(in srgb, #000 30%, Canvas) 60%, transparent)", true),
    bridged("--nb-layout-sector-fill", "--layout-sector-fill", "color-mix(in srgb, Highlight 5%, transparent)", true),
    bridged("--nb-layout-sector-line", "--layout-sector-line", "color-mix(in srgb, Highlight 65%, transparent)", true),
    bridged("--nb-layout-sector-active-fill", "--layout-sector-active-fill", "color-mix(in srgb, Highlight 12%, transparent)", true),
    bridged("--nb-layout-sector-active-line", "--layout-sector-active-line", "color-mix(in srgb, Highlight 70%, transparent)", true),
    bridged("--nb-layout-card-radius", "--layout-card-radius", "10px", true),
    bridged("--nb-layout-card-shadow", "--layout-card-shadow", `0 18px 48px rgb(0 0 0 / 34%), 0 0 0 1px ${DIVIDER}`, true),

    // 焦点环（`vue/global.css` 的 `nb-layout-focus-ring`）。回退值同 nb-ui：实色 2px、外面一圈淡晕，总外扩 3.5px（对比度 3:1，nb-ui 设计语言“对比度”）。
    bridged("--nb-layout-focus-ring", "--focus-ring", "0 0 0 2px Highlight, 0 0 0 3.5px color-mix(in srgb, Highlight 18%, transparent)", true),
    bridged("--nb-layout-focus-outline", "--focus-outline", "Highlight", true),

    // 两个落点浮层的整页层级：数值与 nb-ui 的层级登记表（`NB_Z_INDEX.dropSectors`、`dropFeedback`）相同。
    bridged("--nb-layout-z-drop-sectors", null, "59"),
    bridged("--nb-layout-z-drop-feedback", null, "60"),

    // 通用令牌：面、文字、线、圆角、字体。
    bridged("--nb-layout-accent-main", "--accent-main", "Highlight"),
    bridged("--nb-layout-accent-text", "--accent-text", "LinkText"),
    bridged("--nb-layout-text-main", "--text-main", "CanvasText"),
    bridged("--nb-layout-text-muted", "--text-muted", "GrayText"),
    bridged("--nb-layout-text-secondary", "--text-secondary", "GrayText"),
    bridged("--nb-layout-bg-panel", "--bg-panel", "Canvas"),
    bridged("--nb-layout-bg-hover", "--bg-hover", "color-mix(in srgb, CanvasText 6%, transparent)"),
    bridged("--nb-layout-panel-surface", "--panel-surface", "Canvas"),
    bridged("--nb-layout-divider", "--divider", DIVIDER),
    bridged("--nb-layout-shadow-color", "--shadow-color", "#000"),
    bridged("--nb-layout-elevation-raised", "--elevation-raised", "none"),
    bridged("--nb-layout-overlay-blur", "--overlay-blur", "none"),
    bridged("--nb-layout-radius-control", "--radius-control", "6px"),
    bridged("--nb-layout-radius-pill", "--radius-pill", "999px"),
    bridged("--nb-layout-font-ui", "--font-ui", "system-ui, -apple-system, \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"),
    bridged("--nb-layout-text-xs", "--text-xs", "12px"),
    bridged("--nb-layout-leading-tight", "--leading-tight", "1.3"),
    bridged("--nb-layout-weight-medium", "--weight-medium", "500"),

    // 宿主旋钮。
    {name: "--nb-layout-sector-radius", kind: "host", fallback: "0"},
    {name: "--nb-layout-splitter-seam", kind: "host", fallback: `var(--nb-layout-divider, ${DIVIDER})`},
    {name: "--nb-layout-splitter-seam-inset", kind: "host", fallback: "0px"},
    {name: "--nb-layout-sortable-first-line", kind: "host", fallback: "1lh"},
    {name: "--nb-layout-sortable-held-shadow", kind: "host", fallback: `0 0 0 1px var(--nb-layout-divider, ${DIVIDER}), 0 4px 12px color-mix(in srgb, var(--nb-layout-shadow-color, #000) 14%, transparent)`},

    // 组件自己写在行内的几何。
    {name: "--nb-layout-grid-inset", kind: "inline"},
    {name: "--nb-layout-sash-core-size", kind: "inline", fallback: "100%"},
    {name: "--nb-layout-sash-core-start", kind: "inline", fallback: "0px"},
];

const BY_NAME = new Map(NB_LAYOUT_THEME_VARS.map((entry) => [entry.name, entry]));

/**
 * 给 JS 读变量用：宿主没给（读到空串）时的回退，与 CSS 里每处 `var()` 的回退同值。`getPropertyValue` 读不到 `var()` 的回退，
 * 只读得到变量本身，所以 JS 要自己补（docs/specs/ui/nested-grid.md 输出 142）。
 */
export function nbLayoutVarFallback(name: NbLayoutVarName): string {
    const entry = BY_NAME.get(name);
    if (entry === undefined || entry.fallback === undefined) throw new Error(`No fallback for CSS variable ${name}`);
    return entry.fallback;
}
