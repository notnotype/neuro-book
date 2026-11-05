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
    activityBarSurface: "--skin-activitybar-surface",
    activityBarForeground: "--skin-activitybar-foreground",
    activityBarActive: "--skin-activitybar-active",
    activityBarOrnament: "--skin-activitybar-ornament",
    activityBarOrnamentSize: "--skin-activitybar-ornament-size",
    activityBarHover: "--skin-activitybar-hover",
    fontDisplay: "--font-display",
    fontProse: "--font-prose",
} as const;
