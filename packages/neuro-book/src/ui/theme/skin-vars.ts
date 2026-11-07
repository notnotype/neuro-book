/**
 * 主题写到文档根、各位置读的变量名（docs/specs/theme/skins.md）。写入方用这里的常量；各位置的 CSS 写字面量，名字改了要一起改。
 */

export const SKIN_VARS = {
    scene: "--skin-scene",
    emptyPosition: "--skin-empty-position",
    /** 空状态的内容相对内容区中心往左移多少（内容区宽度的比例）；由容器的内边距实现。 */
    emptyShift: "--skin-empty-shift",
    marginLeftSize: "--skin-margin-left-size",
    marginLeftPosition: "--skin-margin-left-position",
    marginRightSize: "--skin-margin-right-size",
    marginRightPosition: "--skin-margin-right-position",
    sidebarCornerSize: "--skin-sidebar-corner-size",
    sidebarCornerPosition: "--skin-sidebar-corner-position",
    auxiliaryCornerSize: "--skin-auxiliary-corner-size",
    auxiliaryCornerPosition: "--skin-auxiliary-corner-position",
    /**
     * 加载页用的场景图（静态那张）与进度样式（docs/specs/theme/skins.md 输出 19）：由 `appearance-hint.ts` 读到、记进加载页的提示，
     * 下一次整页加载时第一帧前就用上。进度样式缺省（`bar`）时不写。
     */
    loadingScene: "--skin-loading-scene",
    loadingIndicator: "--skin-loading-indicator",
    /** 浮层画框那道细线的颜色；有它文档根才标 `data-nb-skin-frame`。 */
    frameLine: "--skin-frame-line",
    activityBarSurface: "--skin-activitybar-surface",
    activityBarForeground: "--skin-activitybar-foreground",
    activityBarActive: "--skin-activitybar-active",
    activityBarOrnament: "--skin-activitybar-ornament",
    activityBarOrnamentSize: "--skin-activitybar-ornament-size",
    activityBarOrnamentWidth: "--skin-activitybar-ornament-width",
    activityBarHover: "--skin-activitybar-hover",
    /** 只有欢迎页标题读；`--font-display` 是书架也在用的公共变量，书架只跟配色（输出 8 与“不承诺”）。 */
    fontDisplay: "--skin-font-display",
    fontProse: "--font-prose",
} as const;
