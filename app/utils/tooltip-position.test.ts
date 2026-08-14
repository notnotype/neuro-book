import {describe, expect, it} from "vitest";
import {computeTooltipPosition, TOOLTIP_GAP, TOOLTIP_VIEWPORT_PADDING} from "nbook/app/utils/tooltip-position";

const VIEWPORT = {left: 0, top: 0, width: 1280, height: 800};

describe("computeTooltipPosition", () => {
    it("places a right tooltip to the right of the trigger, vertically centered", () => {
        const trigger = {left: 40, top: 200, width: 40, height: 40};
        const tooltip = {left: 0, top: 0, width: 120, height: 28};

        expect(computeTooltipPosition(trigger, tooltip, "right", VIEWPORT)).toEqual({
            x: trigger.left + trigger.width + TOOLTIP_GAP,
            y: 200 + (40 - 28) / 2,
            placement: "right",
        });
    });

    it("flips a right tooltip to the left when it would overflow the right edge", () => {
        const trigger = {left: 1200, top: 200, width: 40, height: 40};
        const tooltip = {left: 0, top: 0, width: 120, height: 28};

        const result = computeTooltipPosition(trigger, tooltip, "right", VIEWPORT);
        expect(result.placement).toBe("left");
        expect(result.x).toBe(trigger.left - TOOLTIP_GAP - tooltip.width);
    });

    it("clamps a right tooltip vertically into the viewport", () => {
        const tooltip = {left: 0, top: 0, width: 120, height: 28};

        const nearTop = computeTooltipPosition({left: 40, top: 0, width: 40, height: 40}, tooltip, "right", VIEWPORT);
        expect(nearTop.y).toBe(TOOLTIP_VIEWPORT_PADDING);

        const nearBottom = computeTooltipPosition({left: 40, top: 780, width: 40, height: 40}, tooltip, "right", VIEWPORT);
        expect(nearBottom.y).toBe(VIEWPORT.height - TOOLTIP_VIEWPORT_PADDING - tooltip.height);
    });

    it("places a bottom tooltip below the trigger, horizontally centered", () => {
        const trigger = {left: 200, top: 100, width: 40, height: 40};
        const tooltip = {left: 0, top: 0, width: 120, height: 28};

        expect(computeTooltipPosition(trigger, tooltip, "bottom", VIEWPORT)).toEqual({
            x: 200 + (40 - 120) / 2,
            y: trigger.top + trigger.height + TOOLTIP_GAP,
            placement: "bottom",
        });
    });

    it("flips a bottom tooltip above when it would overflow the bottom edge", () => {
        const trigger = {left: 200, top: 760, width: 40, height: 40};
        const tooltip = {left: 0, top: 0, width: 120, height: 28};

        const result = computeTooltipPosition(trigger, tooltip, "bottom", VIEWPORT);
        expect(result.placement).toBe("top");
        expect(result.y).toBe(trigger.top - TOOLTIP_GAP - tooltip.height);
    });

    it("clamps a bottom tooltip horizontally into the viewport", () => {
        const tooltip = {left: 0, top: 0, width: 120, height: 28};

        const nearLeft = computeTooltipPosition({left: 0, top: 100, width: 40, height: 40}, tooltip, "bottom", VIEWPORT);
        expect(nearLeft.x).toBe(TOOLTIP_VIEWPORT_PADDING);

        const nearRight = computeTooltipPosition({left: 1240, top: 100, width: 40, height: 40}, tooltip, "bottom", VIEWPORT);
        expect(nearRight.x).toBe(VIEWPORT.width - TOOLTIP_VIEWPORT_PADDING - tooltip.width);
    });

    it("clamps a flipped-left tooltip to the edge when the flipped side still cannot fit", () => {
        // tooltip 比视口可用宽度还宽：右侧放不下翻到左侧，左侧也放不下，最终钳到左边缘。
        const tooltip = {left: 0, top: 0, width: 1300, height: 28};

        const result = computeTooltipPosition({left: 500, top: 200, width: 40, height: 40}, tooltip, "right", VIEWPORT);
        expect(result.placement).toBe("left");
        expect(result.x).toBe(TOOLTIP_VIEWPORT_PADDING);
    });

    it("keeps the tooltip inside the viewport when the viewport is smaller than the tooltip", () => {
        const tinyViewport = {left: 0, top: 0, width: 100, height: 60};
        const tooltip = {left: 0, top: 0, width: 300, height: 120};

        const result = computeTooltipPosition({left: 0, top: 0, width: 40, height: 40}, tooltip, "right", tinyViewport);
        expect(result.x).toBe(TOOLTIP_VIEWPORT_PADDING);
        expect(result.y).toBe(TOOLTIP_VIEWPORT_PADDING);
    });
});
