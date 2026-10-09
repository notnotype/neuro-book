/**
 * 资源管理器的右键菜单（docs/specs/workbench/files-explorer.md 的“新应用的插件、命令与界面”）：固定的动作，每一项执行
 * 一条命令。按右键的那一行与此刻的可用性决定有哪些项、哪些禁用；根行只有合法的根级动作（新建）。
 */

import type {DisplayLocale} from "nbook/shared/localized-text";

import {CONVERT_COMMAND, CREATE_CONTENT_COMMAND, DELETE_COMMAND, DROP_ENTRY_COMMAND, INCLUDE_COMMAND, MOVE_DOWN_COMMAND, MOVE_UP_COMMAND, NEW_FILE_COMMAND, NEW_FOLDER_COMMAND, RENAME_COMMAND, SET_DISPLAY_COMMAND} from "./commands";
import type {Availability} from "./controller";
import {explorerText} from "./messages";
import type {ExplorerMessage} from "./messages";
import type {Row} from "./tree/rows";

export const MENU_COMMANDS = {
    newFile: NEW_FILE_COMMAND,
    newFolder: NEW_FOLDER_COMMAND,
    rename: RENAME_COMMAND,
    delete: DELETE_COMMAND,
    createContent: CREATE_CONTENT_COMMAND,
    convert: CONVERT_COMMAND,
    setDisplay: SET_DISPLAY_COMMAND,
    include: INCLUDE_COMMAND,
    drop: DROP_ENTRY_COMMAND,
    moveUp: MOVE_UP_COMMAND,
    moveDown: MOVE_DOWN_COMMAND,
} as const;

/** 菜单的一项：`command` 是要执行的命令 id；分隔线没有命令。 */
export type MenuEntry =
    | {readonly kind: "item"; readonly command: string; readonly label: string; readonly disabled: boolean; readonly danger: boolean; readonly shortcut: string | null}
    | {readonly kind: "separator"};

export function menuEntries(row: Row, available: Availability, locale: DisplayLocale): MenuEntry[] {
    const item = (command: string, label: ExplorerMessage, enabled: boolean, extra: {danger?: boolean; shortcut?: string} = {}): MenuEntry => ({kind: "item", command, label: explorerText(locale, label), disabled: !enabled, danger: extra.danger ?? false, shortcut: extra.shortcut ?? null});
    const separator: MenuEntry = {kind: "separator"};
    const create = [item(MENU_COMMANDS.newFile, "newFile", available.create), item(MENU_COMMANDS.newFolder, "newFolder", available.create)];
    if (row.kind !== "entry") return create;
    const entries: MenuEntry[] = [...create, separator, item(MENU_COMMANDS.rename, "rename", available.rename, {shortcut: "F2"})];
    if (row.node && !row.body) entries.push(item(MENU_COMMANDS.createContent, "createContent", available.createContent));
    if (row.type === "directory" && !row.content && !row.binder) entries.push(item(MENU_COMMANDS.convert, row.folder === "content" ? "convertToPlain" : "convertToContent", available.convert));
    if (row.content) {
        entries.push(separator);
        if (row.listed === false) entries.push(item(MENU_COMMANDS.include, "include", available.include));
        else if (row.type === "missing") entries.push(item(MENU_COMMANDS.drop, "drop", available.drop));
        else entries.push(item(MENU_COMMANDS.setDisplay, "setDisplay", available.display));
        if (row.listed === true) entries.push(item(MENU_COMMANDS.moveUp, "moveUp", available.moveUp, {shortcut: "Alt+↑"}), item(MENU_COMMANDS.moveDown, "moveDown", available.moveDown, {shortcut: "Alt+↓"}));
    }
    entries.push(separator, item(MENU_COMMANDS.delete, "delete", available.delete, {danger: true, shortcut: "Delete"}));
    return entries;
}
