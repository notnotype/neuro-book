/**
 * `--nb-layout-motion-layout` 的毫秒数（docs/specs/ui/nested-grid.md 输出 35、59、142）：系统减少动态效果时归零，宿主没给时按
 * 缺省时长。外框的过渡与宿主跟着过渡量几何的地方（外壳放下后的收尾）都按它算。
 */

import {layoutDurationMs} from "./layout-vars";

export function layoutMotionMs(element: Element): number {
    return layoutDurationMs(element, "--nb-layout-motion-layout");
}
