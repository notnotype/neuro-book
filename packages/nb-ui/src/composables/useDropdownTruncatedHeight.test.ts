import {describe, expect, it} from "vitest";
import {ref} from "vue";
import {
    DROPDOWN_FRACTIONAL_RATIO_DEFAULT,
    DROPDOWN_ITEM_GAP_DEFAULT,
    DROPDOWN_ITEM_HEIGHT_DEFAULT,
    DROPDOWN_ITEM_HEIGHT_SM,
    useDropdownTruncatedHeight,
} from "./useDropdownTruncatedHeight";

describe("useDropdownTruncatedHeight", () => {
    it("returns FormSelect default golden height (229px) when size is default", () => {
        const {viewportMaxHeight, resolvedItemHeight, resolvedItemGap, resolvedVisibleCount} =
            useDropdownTruncatedHeight({size: "default"});

        expect(viewportMaxHeight.value).toBe("229px");
        expect(resolvedItemHeight.value).toBe(DROPDOWN_ITEM_HEIGHT_DEFAULT);
        expect(resolvedItemGap.value).toBe(DROPDOWN_ITEM_GAP_DEFAULT);
        expect(resolvedVisibleCount.value).toBe(6);
    });

    it("returns FormSelect sm golden height (160px) when size is sm", () => {
        const {viewportMaxHeight, resolvedItemHeight, resolvedVisibleCount} =
            useDropdownTruncatedHeight({size: "sm"});

        expect(viewportMaxHeight.value).toBe("160px");
        expect(resolvedItemHeight.value).toBe(DROPDOWN_ITEM_HEIGHT_SM);
        expect(resolvedVisibleCount.value).toBe(5);
    });

    it("dynamically updates when size ref changes", () => {
        const sizeRef = ref<"default" | "sm">("default");
        const {viewportMaxHeight} = useDropdownTruncatedHeight({size: sizeRef});

        expect(viewportMaxHeight.value).toBe("229px");
        sizeRef.value = "sm";
        expect(viewportMaxHeight.value).toBe("160px");
    });

    it("respects explicitMaxHeight if provided", () => {
        const {viewportMaxHeight} = useDropdownTruncatedHeight({
            explicitMaxHeight: "210px",
        });
        expect(viewportMaxHeight.value).toBe("210px");

        const {viewportMaxHeight: numHeight} = useDropdownTruncatedHeight({
            explicitMaxHeight: 250,
        });
        expect(numHeight.value).toBe("250px");
    });

    it("calculates accurate baseline cutoff when custom visibleCount or fractionalRatio are supplied", () => {
        // 6 items * (32 + 4) + round(0.48 * 32) = 216 + 15 = 231px
        const {viewportMaxHeight} = useDropdownTruncatedHeight({
            visibleCount: 6,
            fractionalRatio: DROPDOWN_FRACTIONAL_RATIO_DEFAULT,
            itemHeight: 32,
            itemGap: 4,
        });

        expect(viewportMaxHeight.value).toBe("231px");
    });

    it("respects maxHeightLimit when calculated height exceeds it", () => {
        const {viewportMaxHeight} = useDropdownTruncatedHeight({
            visibleCount: 10,
            itemHeight: 32,
            itemGap: 4,
            maxHeightLimit: 260,
        });

        expect(viewportMaxHeight.value).toBe("260px");
    });
});
