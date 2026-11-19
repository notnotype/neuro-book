/**
 * JS 读 nb-layout 的 CSS 变量（docs/specs/ui/nested-grid.md 输出 142）。`getPropertyValue` 读不到 `var()` 的回退、只读得到变量
 * 本身，宿主没给时是空串；这里补上清单（`../theme-vars.ts`）里的回退，让 JS 算出的值与 CSS 实际用的一致。
 */

import {nbLayoutVarFallback} from "../theme-vars";
import type {NbLayoutVarName} from "../theme-vars";

/** 变量在 `element` 上的计算值；空串时取清单里的回退。 */
export function readLayoutVar(element: Element, name: NbLayoutVarName): string {
    const value = getComputedStyle(element).getPropertyValue(name).trim();
    return value === "" ? nbLayoutVarFallback(name) : value;
}

/** 时长变量的毫秒数。时长要写成 `ms` 或 `s` 的字面值；解析不出的（`none`、`calc()`）当 0。 */
export function layoutDurationMs(element: Element, name: NbLayoutVarName): number {
    const value = readLayoutVar(element, name);
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return 0;
    return value.endsWith("ms") ? parsed : parsed * 1000;
}
