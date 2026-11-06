/**
 * 编辑器贡献给标题栏菜单的条目（docs/specs/ui/workbench-shell.md 外壳四输出 29 的条目表里归编辑器的那些）：文件组的保存与关闭、
 * 编辑组的撤销与重做、视图组的拆分与换编辑器。节名是各插件共用的约定（同一输出）。
 */

import type {TitlebarMenuItemDeclaration} from "nbook/plugins/workbench/shared/contracts";

import {CLOSE_COMMAND, CLOSE_OTHERS_COMMAND, REDO_COMMAND, REOPEN_WITH_COMMAND, REVERT_COMMAND, SAVE_ALL_COMMAND, SAVE_COMMAND, SPLIT_DOWN_COMMAND, SPLIT_RIGHT_COMMAND, UNDO_COMMAND} from "./commands";

import {TOGGLE_TOOLBAR_COMMAND} from "./editing-commands";
import {editorState} from "./state";

const item = (name: string, declaration: TitlebarMenuItemDeclaration): {readonly id: string; readonly declaration: TitlebarMenuItemDeclaration} => ({id: `nbook.editor.menu.${name}`, declaration});

export const EDITOR_TITLEBAR_MENU_ITEMS: ReadonlyArray<{readonly id: string; readonly declaration: TitlebarMenuItemDeclaration}> = [
    item("save", {group: "file", section: "2_save", order: 1, command: SAVE_COMMAND}),
    item("save-all", {group: "file", section: "2_save", order: 2, command: SAVE_ALL_COMMAND}),
    item("revert", {group: "file", section: "2_save", order: 3, command: REVERT_COMMAND}),
    item("close", {group: "file", section: "3_close", order: 1, command: CLOSE_COMMAND}),
    item("close-others", {group: "file", section: "3_close", order: 2, command: CLOSE_OTHERS_COMMAND}),
    item("undo", {group: "edit", section: "1_undo", order: 1, command: UNDO_COMMAND}),
    item("redo", {group: "edit", section: "1_undo", order: 2, command: REDO_COMMAND}),
    item("split-right", {group: "view", section: "3_editor", order: 1, command: SPLIT_RIGHT_COMMAND}),
    item("toggle-toolbar", {group: "view", section: "3_editor", order: 10, command: TOGGLE_TOOLBAR_COMMAND, toggled: editorState.key("toolbarVisible")}),
    item("split-down", {group: "view", section: "3_editor", order: 2, command: SPLIT_DOWN_COMMAND}),
    item("reopen-with", {group: "view", section: "3_editor", order: 3, command: REOPEN_WITH_COMMAND}),
];
