import {describe, expect, it, vi} from "vitest";
import {DESKTOP_MENU_COMMAND_IDS} from "nbook/shared/desktop-contract";
import {dispatchDesktopMenuCommand, type DesktopMenuCommandHandlers} from "nbook/shared/desktop-menu-command";

describe("Desktop menu command dispatch", () => {
    it("每个公开命令都调用对应行为，不会静默 no-op", async () => {
        const handlers: DesktopMenuCommandHandlers = {
            open: vi.fn(),
            settings: vi.fn(),
            quit: vi.fn(),
            undo: vi.fn(),
            redo: vi.fn(),
            cut: vi.fn(),
            copy: vi.fn(),
            paste: vi.fn(),
            selectAll: vi.fn(),
            reload: vi.fn(),
            zoomIn: vi.fn(),
            zoomOut: vi.fn(),
            zoomReset: vi.fn(),
            documentation: vi.fn(),
            about: vi.fn(),
        };
        const expected = new Map([
            ["file.open", "open"],
            ["file.settings", "settings"],
            ["file.quit", "quit"],
            ["edit.undo", "undo"],
            ["edit.redo", "redo"],
            ["edit.cut", "cut"],
            ["edit.copy", "copy"],
            ["edit.paste", "paste"],
            ["edit.select-all", "selectAll"],
            ["view.reload", "reload"],
            ["view.zoom-in", "zoomIn"],
            ["view.zoom-out", "zoomOut"],
            ["view.zoom-reset", "zoomReset"],
            ["help.documentation", "documentation"],
            ["help.about", "about"],
        ]);

        for (const command of DESKTOP_MENU_COMMAND_IDS) {
            await dispatchDesktopMenuCommand(command, handlers);
            const handlerName = expected.get(command) as keyof DesktopMenuCommandHandlers;
            expect(handlers[handlerName]).toHaveBeenCalledTimes(1);
        }
    });

    it("保留异步行为的完成顺序", async () => {
        const order: string[] = [];
        const handlers: DesktopMenuCommandHandlers = {
            open: () => {},
            settings: async () => { order.push("done"); },
            quit: () => {},
            undo: () => {},
            redo: () => {},
            cut: () => {},
            copy: () => {},
            paste: () => {},
            selectAll: () => {},
            reload: () => {},
            zoomIn: () => {},
            zoomOut: () => {},
            zoomReset: () => {},
            documentation: () => {},
            about: () => {},
        };
        await dispatchDesktopMenuCommand("file.settings", handlers);
        expect(order).toEqual(["done"]);
    });

    it("拒绝宿主传来的未知运行时命令", async () => {
        const handlers: DesktopMenuCommandHandlers = {
            open: () => {},
            settings: () => {},
            quit: () => {},
            undo: () => {},
            redo: () => {},
            cut: () => {},
            copy: () => {},
            paste: () => {},
            selectAll: () => {},
            reload: () => {},
            zoomIn: () => {},
            zoomOut: () => {},
            zoomReset: () => {},
            documentation: () => {},
            about: () => {},
        };
        await expect(dispatchDesktopMenuCommand("unknown" as never, handlers)).rejects.toThrow("不受支持");
    });
});
