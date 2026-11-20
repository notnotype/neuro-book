/**
 * 入口计数的写法（docs/specs/workbench/views.md 输出 17）：活动栏与区域入口条共用。超过 99 写“99+”：图标角上放不下更多位。
 */

export const entryCountText = (count: number): string => (count > 99 ? "99+" : String(count));

/** 入口的名称：标题，有计数时后面接计数（“通知 2”）；读屏名称、标题入口的字、收进“更多”的菜单项都用它。 */
export const entryTitle = (label: string, count: number | null | undefined): string => (count == null ? label : `${label} ${entryCountText(count)}`);
