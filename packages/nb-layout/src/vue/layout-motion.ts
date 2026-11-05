/**
 * `--motion-layout` 的毫秒数（docs/specs/ui/nested-grid.md 的“过渡”）：系统减少动态效果时令牌归零，宿主没给时也当 0。外框的过渡
 * 与宿主跟着过渡量几何的地方（外壳放下后的收尾）都按它算。
 */
export function layoutMotionMs(element: Element): number {
    const value = getComputedStyle(element).getPropertyValue("--motion-layout").trim();
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return 0;
    return value.endsWith("ms") ? parsed : parsed * 1000;
}
