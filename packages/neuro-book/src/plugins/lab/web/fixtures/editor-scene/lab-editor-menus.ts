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

export function createLabEditorMenus(area: EditorArea, text: TextPort): EditorMenus {
    const editing = () => area.activeHandle.value?.editing;
    return {
        title: (action) => text.t(editorText(`commands.nbook.edit.${action}.title` as never)),
        label: (key) => text.t(editorText(`menus.${key}` as never)),
        shortcut: (action) => (EDITING_ACTIONS[action] as EditingActionInfo).keybinding?.replace("Mod", "Ctrl") ?? null,
        has: () => false,
        run: (action, args) => void editing()?.run(action, args),
        execute: (command) => {
            if (command === "nbook.edit.undo") area.activeHandle.value?.undo?.();
            if (command === "nbook.edit.redo") area.activeHandle.value?.redo?.();
        },
        contributed: () => [],
        runContributed: () => undefined,
        toolbarVisible: ref(true),
        keyLabel: (keybinding) => keybinding.replace("Mod", "Ctrl"),
        notify: (key) => area.notify(editorText(`menus.${key}` as never)),
        reportError: () => undefined,
    };
}
