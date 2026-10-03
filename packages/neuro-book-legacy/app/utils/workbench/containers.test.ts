import {describe, expect, it} from "vitest";
import {
    SHELL_LEFT_CONTAINER,
    SHELL_PANEL_CONTAINER,
    SHELL_RIGHT_CONTAINER,
} from "nbook/app/utils/workbench/containers";
import {createWorkbenchRegistry} from "nbook/app/utils/workbench/descriptors";
import {placementCatalogOf, toolPartOfLocation} from "nbook/app/utils/workbench/view-placements";
import {productWorkbenchRegistry, SHELL_FILES_VIEW} from "nbook/app/utils/workbench/product-catalog";

/**
 * 容器声明的闭环：三个容器各占一个**可落位**的位置，默认落位与它们在界面上的 Part 一致，
 * 并且都没有被钉死（未声明 `canMoveContainer: false` → 容器移动入口可用）。
 *
 * 这里不重复 `resolveViewPresentation` 的呈现断言（那些在 `product-catalog.test.ts`）；
 * 断的是"声明本身满足容器落位与移动所需的全部前提"。
 */

const PRODUCT_CONTAINERS = [SHELL_LEFT_CONTAINER, SHELL_RIGHT_CONTAINER, SHELL_PANEL_CONTAINER];

describe("产品容器声明", () => {
    it("三个容器各有唯一 id，且默认落位都能求值到工具 Part", () => {
        expect(new Set(PRODUCT_CONTAINERS.map((container) => container.id)).size).toBe(3);
        for (const container of PRODUCT_CONTAINERS) {
            expect(container.id).toMatch(/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/);
            expect(toolPartOfLocation(container.location)).not.toBeNull();
            expect(Number.isFinite(container.order)).toBe(true);
        }
    });

    it("默认落位恰好覆盖左 / 右 / 底部各一次：每个 Part 的默认活动容器是确定的", () => {
        const parts = PRODUCT_CONTAINERS.map((container) => toolPartOfLocation(container.location));
        expect([...parts].sort()).toEqual(["left", "panel", "right"]);

        expect(SHELL_LEFT_CONTAINER.location).toBe("sidebar-left");
        expect(SHELL_RIGHT_CONTAINER.location).toBe("sidebar-right");
        expect(SHELL_PANEL_CONTAINER.location).toBe("panel");
    });

    it("文件树的默认容器是左栏容器：容器搬走它仍跟着容器（视图归属与容器落位是两件事）", () => {
        expect(SHELL_FILES_VIEW.container).toBe(SHELL_LEFT_CONTAINER.id);
    });

    it("产品注册表接受这份清单，且三个容器都按可移动处理（未声明 canMoveContainer 即允许）", () => {
        const registry = productWorkbenchRegistry();
        if (!registry.ok) {
            throw new Error(registry.reason);
        }
        const catalog = placementCatalogOf(registry.value);

        for (const container of PRODUCT_CONTAINERS) {
            expect(container.canMoveContainer).toBeUndefined();
            expect(registry.value.resolveContainer(container.id)).toEqual({ok: true, value: container});
            expect(catalog.containerDefaults[container.id]).toEqual({
                location: container.location,
                order: container.order,
                movable: true,
            });
            expect(catalog.containers).toContain(container.id);
        }
    });

    it("明确 false 的容器不被当成可移动：同一个位置求值路径下 movable=false", () => {
        const created = createWorkbenchRegistry({
            parts: [],
            containers: [{...SHELL_PANEL_CONTAINER, canMoveContainer: false}],
            views: [],
        });
        if (!created.ok) {
            throw new Error(created.reason);
        }

        expect(placementCatalogOf(created.value).containerDefaults[SHELL_PANEL_CONTAINER.id]?.movable).toBe(false);
    });
});
