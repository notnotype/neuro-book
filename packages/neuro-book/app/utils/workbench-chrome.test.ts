// @vitest-environment jsdom
import {describe, expect, it} from "vitest";
import {
    createWorkbenchActivityItems,
    isTitleBarFocusOwner,
    resolveActivityBarSecondaryItems,
    resolveEffectiveTitleBarEditTarget,
    resolveTitleBarEditRoute,
    resolveTitleBarEditTarget,
    resolveTitleBarMenuGroups,
    resolveTitleBarMenuPresentation,
    type TitleBarHostCapabilities,
} from "nbook/app/utils/workbench-chrome";

const browserCapabilities: TitleBarHostCapabilities = {desktop: false, surfaceActive: true, editTarget: "none"};
const desktopCapabilities: TitleBarHostCapabilities = {desktop: true, surfaceActive: true, editTarget: "none"};

function groupItems(capabilities: TitleBarHostCapabilities, label: string): {command: string; disabled: boolean}[] {
    const group = resolveTitleBarMenuGroups(capabilities).find((candidate) => candidate.label === label);
    if (!group) throw new Error(`菜单组不存在：${label}`);
    return group.items.map((item) => ({command: item.command, disabled: item.disabled}));
}

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

    it("keeps the desktop activity bar focused on project tools and moves global navigation into the title bar", () => {
        const bookshelf = createWorkbenchActivityItems({
            desktopAvailable: true,
            surfaceActive: false,
            userAssetsMode: false,
        });

        expect(bookshelf.primary.map((item) => [item.id, item.disabled])).toEqual([
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

    it("浏览器不画退出应用与桌面缩放，桌面才画", () => {
        expect(groupItems(browserCapabilities, "File").map((item) => item.command))
            .toEqual(["file.open", "file.settings"]);
        expect(groupItems(browserCapabilities, "View").map((item) => item.command))
            .toEqual(["view.reload"]);

        expect(groupItems(desktopCapabilities, "File").map((item) => item.command))
            .toEqual(["file.open", "file.settings", "file.quit"]);
        expect(groupItems(desktopCapabilities, "View").map((item) => item.command))
            .toEqual(["view.reload", "view.zoom-in", "view.zoom-out", "view.zoom-reset"]);
    });

    it("没有打开 Project 时文件动作禁用并给出原因，设置照常可点", () => {
        const items = resolveTitleBarMenuGroups({desktop: false, surfaceActive: false, editTarget: "none"})[0]!.items;

        expect(items.map((item) => [item.command, item.disabled])).toEqual([
            ["file.open", true],
            ["file.settings", false],
        ]);
        expect(items[0]!.disabledReason).toBe("请先打开一个 Project");
        expect(items[1]!.disabledReason).toBeNull();
    });

    it("编辑动作按真实焦点判断，Studio 的 undo 只属于 Studio", () => {
        const noFocus = {desktop: false, surfaceActive: true, editTarget: "none"} as const;
        expect(resolveTitleBarMenuGroups(noFocus).find((group) => group.label === "Edit")!.items
            .every((item) => item.disabled)).toBe(true);

        const nativeFocus = {desktop: true, surfaceActive: true, editTarget: "native"} as const;
        expect(resolveTitleBarEditRoute("edit.undo", nativeFocus)).toBe("native");
        expect(resolveTitleBarEditRoute("edit.undo", {...nativeFocus, editTarget: "editor"})).toBe("studio");
        expect(resolveTitleBarEditRoute("edit.paste", nativeFocus)).toBe("native");

        // 焦点在编辑器里：undo 走会话，剪贴板动作仍交给原生命令。
        const editorFocus = {desktop: false, surfaceActive: true, editTarget: "editor"} as const;
        expect(resolveTitleBarEditRoute("edit.undo", editorFocus)).toBe("studio");
        expect(resolveTitleBarEditRoute("edit.cut", editorFocus)).toBe("native");
        expect(resolveTitleBarEditRoute("edit.select-all", editorFocus)).toBe("native");
    });

    it("浏览器不冒充粘贴能力：粘贴禁用并说明改用 Ctrl+V", () => {
        const browser = {desktop: false, surfaceActive: true, editTarget: "native"} as const;

        expect(resolveTitleBarEditRoute("edit.paste", browser)).toBe("unavailable");
        const paste = resolveTitleBarMenuGroups(browser).find((group) => group.label === "Edit")!
            .items.find((item) => item.command === "edit.paste")!;
        expect(paste.disabled).toBe(true);
        expect(paste.disabledReason).toContain("Ctrl+V");

        // 同一个焦点在桌面宿主里能执行：菜单项跟着可用。
        expect(resolveTitleBarMenuGroups({...browser, desktop: true}).find((group) => group.label === "Edit")!
            .items.find((item) => item.command === "edit.paste")!.disabled).toBe(false);
    });

    it("编辑目标的分类只认真实焦点：原生控件、contenteditable 与 Studio 各归各位", () => {
        const input = document.createElement("input");
        const textarea = document.createElement("textarea");
        const select = document.createElement("select");
        const editable = document.createElement("div");
        editable.setAttribute("contenteditable", "true");
        const button = document.createElement("button");

        expect(resolveTitleBarEditTarget(input, false)).toBe("native");
        expect(resolveTitleBarEditTarget(textarea, false)).toBe("native");
        expect(resolveTitleBarEditTarget(select, false)).toBe("native");
        expect(resolveTitleBarEditTarget(editable, false)).toBe("native");
        expect(resolveTitleBarEditTarget(button, false)).toBe("none");
        expect(resolveTitleBarEditTarget(document.body, false)).toBe("none");
        expect(resolveTitleBarEditTarget(null, false)).toBe("none");

        // Studio 活跃优先于 activeElement：source 编辑器（Monaco 的 textarea）必须走会话而不是原生命令。
        expect(resolveTitleBarEditTarget(textarea, true)).toBe("editor");
        expect(resolveTitleBarEditTarget(button, true)).toBe("editor");
        expect(resolveTitleBarEditTarget(null, true)).toBe("editor");
    });

    it("焦点在标题栏里时沿用记忆的编辑目标，在页面其它地方时用此刻的真实焦点", () => {
        const inBar = document.createElement("button");
        const bar = document.createElement("div");
        bar.className = "desktop-title-bar";
        bar.append(inBar);
        const panel = document.createElement("div");
        panel.setAttribute("data-titlebar-menu-panel", "group");
        const panelItem = document.createElement("button");
        panel.append(panelItem);
        const pageButton = document.createElement("button");
        const pageBody = document.createElement("div");
        pageBody.append(pageButton);

        expect(isTitleBarFocusOwner(inBar)).toBe(true);
        expect(isTitleBarFocusOwner(panelItem)).toBe(true);
        expect(isTitleBarFocusOwner(pageButton)).toBe(false);
        expect(isTitleBarFocusOwner(document.body)).toBe(false);
        expect(isTitleBarFocusOwner(null)).toBe(false);

        // 键盘进标题栏：宿主报 none，但编辑动作要沿用记忆值。
        expect(resolveEffectiveTitleBarEditTarget({liveTarget: "none", rememberedTarget: "native", titleBarOwnsFocus: true})).toBe("native");
        expect(resolveEffectiveTitleBarEditTarget({liveTarget: "none", rememberedTarget: "editor", titleBarOwnsFocus: true})).toBe("editor");
        // 没有记忆（从没在可编辑处落过焦点）：仍然没有编辑动作。
        expect(resolveEffectiveTitleBarEditTarget({liveTarget: "none", rememberedTarget: null, titleBarOwnsFocus: true})).toBe("none");
        // 焦点在页面其它地方：不拿记忆冒充可编辑。
        expect(resolveEffectiveTitleBarEditTarget({liveTarget: "none", rememberedTarget: "native", titleBarOwnsFocus: false})).toBe("none");
        // 鼠标路径（焦点还在输入框里）：以此刻焦点为准，不被记忆值覆盖。
        expect(resolveEffectiveTitleBarEditTarget({liveTarget: "native", rememberedTarget: "editor", titleBarOwnsFocus: false})).toBe("native");

        // 沿用记忆值时的执行去处与记忆档位一致：Studio 的撤销不会跑成原生撤销。
        expect(resolveTitleBarEditRoute("edit.undo", {desktop: false, surfaceActive: true, editTarget: "editor"})).toBe("studio");
        expect(resolveTitleBarEditRoute("edit.undo", {desktop: false, surfaceActive: true, editTarget: "native"})).toBe("native");
    });
});
