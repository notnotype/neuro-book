import {describe, expect, it} from "vitest";
import {
    DROPDOWN_SURFACE_BACKDROP_FILTER,
    DROPDOWN_SURFACE_BOX_SHADOW,
    useDropdownSurfaceStyle,
} from "./useDropdownSurfaceStyle";
import {useDropdownFloating} from "./useDropdownFloating";

describe("useDropdownSurfaceStyle", () => {
    it("provides standard popoverClasses and itemBaseClass", () => {
        const {popoverClasses, itemBaseClass, viewportClasses, viewportBaseStyle} = useDropdownSurfaceStyle();

        expect(popoverClasses).toContain("nb-ui-popover-surface");
        expect(popoverClasses).toContain("nb-ui-menu-surface");
        expect(popoverClasses).toContain("p-1.5");
        expect(itemBaseClass).toBe("nb-ui-popover-item mb-1 last:mb-0");
        expect(viewportClasses).toBe("nb-ui-popover-scroll w-full");
        expect(viewportBaseStyle.borderRadius).toBe("var(--nb-popover-inner-radius)");
    });

    it("popoverStyle includes tuned 4-layer box-shadow and 130% saturation backdropFilter", () => {
        const {popoverStyle} = useDropdownSurfaceStyle();

        expect(popoverStyle.value.boxShadow).toBe(DROPDOWN_SURFACE_BOX_SHADOW);
        expect(popoverStyle.value.backdropFilter).toBe(DROPDOWN_SURFACE_BACKDROP_FILTER);
        expect(popoverStyle.value.WebkitBackdropFilter).toBe(DROPDOWN_SURFACE_BACKDROP_FILTER);
    });

    it("allows custom popoverStyle to extend base style", () => {
        const {popoverStyle} = useDropdownSurfaceStyle({
            popoverStyle: {minWidth: "200px"},
        });

        expect(popoverStyle.value.minWidth).toBe("200px");
        expect(popoverStyle.value.boxShadow).toBe(DROPDOWN_SURFACE_BOX_SHADOW);
    });

    it("popperProps defaults to sideOffset 7 and avoidCollisions true", () => {
        const {popperProps} = useDropdownSurfaceStyle();

        expect(popperProps.value.sideOffset).toBe(7);
        expect(popperProps.value.avoidCollisions).toBe(true);
        expect(popperProps.value.position).toBe("popper");
    });
});

describe("useDropdownFloating", () => {
    it("integrates surface, height, and scrollbar in a single bundle", () => {
        const floating = useDropdownFloating({size: "default"});

        expect(floating.viewportMaxHeight.value).toBe("229px");
        expect(floating.popoverClasses).toContain("nb-ui-popover-surface");
        expect(floating.viewportStyle.value.maxHeight).toBe("229px");
        expect(floating.viewportStyle.value.borderRadius).toBe("var(--nb-popover-inner-radius)");
        expect(floating.isScrollable.value).toBe(false);
    });

    it("supports compact size with sm truncated height (160px)", () => {
        const floating = useDropdownFloating({size: "sm"});

        expect(floating.viewportMaxHeight.value).toBe("160px");
        expect(floating.viewportStyle.value.maxHeight).toBe("160px");
    });
});
