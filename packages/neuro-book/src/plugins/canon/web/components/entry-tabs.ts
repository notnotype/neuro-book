/**
 * 条目页的一个分页（docs/specs/canon/author-ui.md 输出 9）：横排的 `Tabs` 与竖排的 `EntryPageNav` 读同一份，切换排法只换外形。
 */
export interface EntryTab {
    readonly value: string;
    readonly label: string;
    /** lucide 图标的类名；设定组没声明时宿主给缺省的 `i-lucide-layers`。 */
    readonly iconClass: string;
    /** 分页名后写的条数；没有或为 0 时不写。 */
    readonly count?: number;
    /** `own`：设定组与文字（可加可去的那一段）；`view`：不对应设定组的看法（附加分页与“情节”）。 */
    readonly segment: "own" | "view";
    /** 这一页是一组设定、可以去掉（右键菜单里有“去掉这组设定”）。 */
    readonly removable?: boolean;
}

/** 设定组没声明图标时用的。 */
export const GROUP_ICON = "i-lucide-layers";
export const TEXT_ICON = "i-lucide-file-text";
export const PLOT_ICON = "i-lucide-git-commit-horizontal";
export const EXTRA_ICON = "i-lucide-panel-top";
