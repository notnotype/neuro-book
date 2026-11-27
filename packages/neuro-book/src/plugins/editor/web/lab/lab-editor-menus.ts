/**
 * 编辑器区夹具的菜单（docs/specs/workbench/markdown-editing.md）：Lab 不装配命令服务，动作直接交给活动控件，文字用夹具的翻译
 * 端口。命令的 `when`、贡献项的排序由真实的 `editing-menus.ts` 与它的测试负责，这里只让控件画出来。
 */

import type {TextPort} from "@notnotype/nb-ui/text-port";
import {ref} from "vue";

import type {EditorMenus} from "nbook/plugins/editor/shared/contracts";
import {EDITING_ACTIONS} from "nbook/plugins/editor/shared/editing";
import type {EditingActionInfo} from "nbook/plugins/editor/shared/editing";
import {editorText} from "nbook/plugins/editor/shared/text";
import type {EditorArea} from "nbook/plugins/editor/web/area";
import {keyEventMatches} from "nbook/plugins/editor/web/key-event";

export function createLabEditorMenus(area: EditorArea, text: TextPort, options: {readonly commentMargin?: boolean} = {}): EditorMenus {
    const editing = () => area.activeHandle.value?.editing;
    return {
        title: (action) => text.t(editorText(`commands.nbook.edit.${action}.title` as never)),
        label: (key, params) => text.t(editorText(`menus.${key}` as never, params)),
        shortcut: (action) => (EDITING_ACTIONS[action] as EditingActionInfo).keybinding?.replace("Mod", "Ctrl") ?? null,
        matches: (action, event) => {
            const keybinding = (EDITING_ACTIONS[action] as EditingActionInfo).keybinding;
            return keybinding !== undefined && keyEventMatches(keybinding, "other", event);
        },
        has: () => false,
        run: (action, args) => void editing()?.run(action, args),
        execute: (command, args) => {
            if (command === "nbook.edit.undo") area.activeHandle.value?.undo?.();
            if (command === "nbook.edit.redo") area.activeHandle.value?.redo?.();
            // Ctrl 点作品里的链接（markdown-editing.md 输出 53）：真实的命令服务把它交给编辑器区，夹具直接调。
            if (command === "nbook.editor.open" && typeof args?.address === "string") area.open(args.address, {mode: "permanent"});
        },
        contributed: () => [],
        runContributed: () => undefined,
        toolbarVisible: ref(true),
        toolbarPlacement: ref("full"),
        commentMargin: ref(options.commentMargin === true),
        keyLabel: (keybinding) => keybinding.replace("Mod", "Ctrl"),
        notify: (key, params) => area.notify(editorText(`menus.${key}` as never, params)),
        reportError: () => undefined,
    };
}
