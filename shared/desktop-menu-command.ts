import type {DesktopMenuCommandId} from "nbook/shared/desktop-contract";

/** Desktop 菜单命令的页面侧行为；宿主只负责把命令可靠地送到当前页面。 */
export type DesktopMenuCommandHandlers = {
    open: () => void | Promise<void>;
    settings: () => void | Promise<void>;
    quit: () => void | Promise<void>;
    undo: () => void | Promise<void>;
    redo: () => void | Promise<void>;
    cut: () => void | Promise<void>;
    copy: () => void | Promise<void>;
    paste: () => void | Promise<void>;
    selectAll: () => void | Promise<void>;
    reload: () => void | Promise<void>;
    zoomIn: () => void | Promise<void>;
    zoomOut: () => void | Promise<void>;
    zoomReset: () => void | Promise<void>;
    documentation: () => void | Promise<void>;
    about: () => void | Promise<void>;
};

/** 将公开命令 ID 映射到页面行为；未知运行时输入直接失败而不是静默忽略。 */
export async function dispatchDesktopMenuCommand(
    command: DesktopMenuCommandId,
    handlers: DesktopMenuCommandHandlers,
): Promise<void> {
    switch (command) {
        case "file.open": return await handlers.open();
        case "file.settings": return await handlers.settings();
        case "file.quit": return await handlers.quit();
        case "edit.undo": return await handlers.undo();
        case "edit.redo": return await handlers.redo();
        case "edit.cut": return await handlers.cut();
        case "edit.copy": return await handlers.copy();
        case "edit.paste": return await handlers.paste();
        case "edit.select-all": return await handlers.selectAll();
        case "view.reload": return await handlers.reload();
        case "view.zoom-in": return await handlers.zoomIn();
        case "view.zoom-out": return await handlers.zoomOut();
        case "view.zoom-reset": return await handlers.zoomReset();
        case "help.documentation": return await handlers.documentation();
        case "help.about": return await handlers.about();
        default: throw new Error(`Desktop Menu command 不受支持：${String(command)}`);
    }
}
