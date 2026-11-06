/**
 * 工作台自己贡献给标题栏菜单的条目（docs/specs/ui/workbench-shell.md 外壳四输出 29 的条目表里归工作台的那些）。节名是各插件
 * 共用的约定（同一输出），别的插件的条目按节名插进同一节。
 */

import type {TitlebarMenuItemDeclaration} from "../../shared/menus";
import {workbenchText} from "../../shared/text";
import {DOCUMENTATION_COMMAND, RELOAD_COMMAND} from "../commands/app-commands";
import {OPEN_COMMANDS_ID} from "../commands/open-commands";
import {TOGGLE_PANEL_MAXIMIZED_COMMAND} from "../commands/panel-commands";
import {SET_PART_HIDDEN_COMMAND} from "../commands/part-commands";
import {SWITCH_APPEARANCE_COMMAND, SWITCH_THEME_COMMAND} from "../commands/theme-commands";
import {OPEN_THEME_EDITOR_COMMAND, OPEN_THEME_EDITOR_FLOATING_COMMAND} from "../commands/theme-editor-commands";

const WORKBENCH = "nbook.workbench";

export const WORKBENCH_TITLEBAR_MENU_ITEMS: ReadonlyArray<{readonly id: string; readonly declaration: TitlebarMenuItemDeclaration}> = [
    {id: "nbook.workbench.menu.command-palette", declaration: {group: "view", section: "1_palette", command: OPEN_COMMANDS_ID}},
    {id: "nbook.workbench.menu.sidebar", declaration: {group: "view", section: "2_layout", order: 1, command: SET_PART_HIDDEN_COMMAND, args: {part: "sidebar"}, toggled: `${WORKBENCH}/sidebarVisible`, label: workbenchText("titlebar.menuItems.sidebar")}},
    {id: "nbook.workbench.menu.auxiliarybar", declaration: {group: "view", section: "2_layout", order: 2, command: SET_PART_HIDDEN_COMMAND, args: {part: "auxiliarybar"}, toggled: `${WORKBENCH}/auxiliaryBarVisible`, label: workbenchText("titlebar.menuItems.auxiliarybar")}},
    {id: "nbook.workbench.menu.activitybar", declaration: {group: "view", section: "2_layout", order: 3, command: SET_PART_HIDDEN_COMMAND, args: {part: "activitybar"}, toggled: `${WORKBENCH}/activityBarVisible`, label: workbenchText("titlebar.menuItems.activitybar")}},
    {id: "nbook.workbench.menu.panel", declaration: {group: "view", section: "2_layout", order: 4, command: SET_PART_HIDDEN_COMMAND, args: {part: "panel"}, toggled: `${WORKBENCH}/panelVisible`, label: workbenchText("titlebar.menuItems.panel")}},
    {id: "nbook.workbench.menu.panel-maximized", declaration: {group: "view", section: "2_layout", order: 5, command: TOGGLE_PANEL_MAXIMIZED_COMMAND}},
    {id: "nbook.workbench.menu.theme", declaration: {group: "view", section: "4_appearance", order: 1, command: SWITCH_THEME_COMMAND}},
    {id: "nbook.workbench.menu.appearance", declaration: {group: "view", section: "4_appearance", order: 2, command: SWITCH_APPEARANCE_COMMAND}},
    {id: "nbook.workbench.menu.theme-editor", declaration: {group: "view", section: "4_appearance", order: 3, command: OPEN_THEME_EDITOR_COMMAND}},
    {id: "nbook.workbench.menu.theme-editor-floating", declaration: {group: "view", section: "4_appearance", order: 4, command: OPEN_THEME_EDITOR_FLOATING_COMMAND}},
    {id: "nbook.workbench.menu.reload", declaration: {group: "view", section: "5_reload", command: RELOAD_COMMAND}},
    {id: "nbook.workbench.menu.documentation", declaration: {group: "help", section: "1_help", order: 2, command: DOCUMENTATION_COMMAND}},
];
