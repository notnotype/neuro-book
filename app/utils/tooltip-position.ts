export type TooltipPlacement = "right" | "bottom";

export type TooltipEffectivePlacement = "right" | "left" | "bottom" | "top";

export type TooltipRect = Readonly<{
    left: number;
    top: number;
    width: number;
    height: number;
}>;

export type TooltipPosition = Readonly<{
    x: number;
    y: number;
    placement: TooltipEffectivePlacement;
}>;

/** 触发元素与 Tooltip 之间的间距（px）。 */
export const TOOLTIP_GAP = 8;

/** Tooltip 与视口边缘保持的最小间距（px）。 */
export const TOOLTIP_VIEWPORT_PADDING = 8;

/**
 * 计算 fixed 定位的 Tooltip 在视口内的坐标。
 *
 * - "right"：默认出现在触发元素右侧并垂直居中；放不下时翻转到左侧。
 * - "bottom"：默认出现在触发元素下方并水平居中；放不下时翻转到上方。
 * - 两种 placement 都会把最终坐标钳制在视口内（保留 padding）。
 * - 返回值里的 placement 是翻转后的实际朝向，供箭头定位使用。
 */
export function computeTooltipPosition(
    trigger: TooltipRect,
    tooltip: TooltipRect,
    placement: TooltipPlacement,
    viewport: TooltipRect,
): TooltipPosition {
    const viewportRight = viewport.left + viewport.width;
    const viewportBottom = viewport.top + viewport.height;

    if (placement === "right") {
        const preferredX = trigger.left + trigger.width + TOOLTIP_GAP;
        const fitsRight = preferredX + tooltip.width <= viewportRight - TOOLTIP_VIEWPORT_PADDING;
        const x = clamp(
            fitsRight ? preferredX : trigger.left - TOOLTIP_GAP - tooltip.width,
            TOOLTIP_VIEWPORT_PADDING,
            viewportRight - TOOLTIP_VIEWPORT_PADDING - tooltip.width,
        );
        const preferredY = trigger.top + (trigger.height - tooltip.height) / 2;
        const y = clamp(
            preferredY,
            TOOLTIP_VIEWPORT_PADDING,
            viewportBottom - TOOLTIP_VIEWPORT_PADDING - tooltip.height,
        );
        return {x, y, placement: fitsRight ? "right" : "left"};
    }

    const preferredX = trigger.left + (trigger.width - tooltip.width) / 2;
    const x = clamp(
        preferredX,
        TOOLTIP_VIEWPORT_PADDING,
        viewportRight - TOOLTIP_VIEWPORT_PADDING - tooltip.width,
    );
    const preferredY = trigger.top + trigger.height + TOOLTIP_GAP;
    const fitsBottom = preferredY + tooltip.height <= viewportBottom - TOOLTIP_VIEWPORT_PADDING;
    const y = clamp(
        fitsBottom ? preferredY : trigger.top - TOOLTIP_GAP - tooltip.height,
        TOOLTIP_VIEWPORT_PADDING,
        viewportBottom - TOOLTIP_VIEWPORT_PADDING - tooltip.height,
    );
    return {x, y, placement: fitsBottom ? "bottom" : "top"};
}

function clamp(value: number, min: number, max: number): number {
    if (max < min) {
        return min;
    }
    return Math.min(Math.max(value, min), max);
}
