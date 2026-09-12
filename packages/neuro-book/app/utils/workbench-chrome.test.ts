import {describe, expect, it} from "vitest";
import {
    createWorkbenchActivityItems,
    resolveActivityBarSecondaryItems,
    resolveTitleBarMenuPresentation,
} from "nbook/app/utils/workbench-chrome";

describe("Workbench Chrome", () => {
    it("keeps the full menu only when the title bar still has a usable drag surface", () => {
        expect(resolveTitleBarMenuPresentation({
            availableWidth: 760,
            fullMenuWidth: 244,
            titleWidth: 180,
            controlsWidth: 168,
        })).toBe("full");

        expect(resolveTitleBarMenuPresentation({
            availableWidth: 640,
            fullMenuWidth: 244,
            titleWidth: 180,
            controlsWidth: 168,
        })).toBe("compact");
    });

    it("在桌面端和 Web 端都显示书架管理入口，全局导航移至标题栏", () => {
        const bookshelf = createWorkbenchActivityItems({
            desktopAvailable: true,
            surfaceActive: false,
            userAssetsMode: false,
        });

        expect(bookshelf.primary.map((item) => [item.id, item.disabled])).toEqual([
            ["home", false],
            ["files", true],
            ["characters", true],
            ["plot", true],
            ["world", true],
        ]);
        expect(bookshelf.secondary.map((item) => [item.id, item.disabled])).toEqual([
            ["trace", true],
            ["history", true],
        ]);
        expect(bookshelf.agentPanel).toBeNull();
        expect(bookshelf.footer.map((item) => item.id)).toEqual(["account", "settings"]);

        const browserWorkspace = createWorkbenchActivityItems({
            desktopAvailable: false,
            surfaceActive: true,
            userAssetsMode: false,
        });
        expect(browserWorkspace.primary[0]).toEqual({
            id: "home",
            disabled: false,
        });
        expect(browserWorkspace.agentPanel).toEqual({
            id: "agent-panel",
            disabled: false,
        });
    });

    it("折叠次要入口时为 More 保留完整按钮位", () => {
        const items = createWorkbenchActivityItems({
            desktopAvailable: true,
            surfaceActive: true,
            userAssetsMode: false,
        }).secondary;

        expect(resolveActivityBarSecondaryItems(items, {
            availableHeight: 176,
            fixedHeight: 0,
            itemHeight: 44,
            moreButtonHeight: 44,
        })).toEqual({
            visible: items,
            overflow: [],
        });

        expect(resolveActivityBarSecondaryItems(items, {
            availableHeight: 132,
            fixedHeight: 0,
            itemHeight: 44,
            moreButtonHeight: 44,
        })).toEqual({
            visible: items.slice(0, 2),
            overflow: items.slice(2),
        });

        expect(resolveActivityBarSecondaryItems(items, {
            availableHeight: 44,
            fixedHeight: 0,
            itemHeight: 44,
            moreButtonHeight: 44,
        })).toEqual({
            visible: [],
            overflow: items,
        });
    });
});
