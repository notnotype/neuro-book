/**
 * 打开主题编辑器的两条命令（docs/specs/theme/editor.md 输出 1）：页签与浮动窗口。同一时刻只有一份模型（`ThemeEditorSession`），
 * 所以打开页签时先关浮动窗口，免得两处同时在改。
 */

import {Type} from "typebox";

import type {WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import type {CommandImplementation, CommandService} from "nbook/plugins/commands/shared/contracts";
import {OPEN_PAGE_COMMAND} from "nbook/plugins/editor/shared/contracts";

import {workbenchText} from "../../shared/text";
import type {ThemeEditorSession} from "../components/theme-editor/theme-editor-session";

export const OPEN_THEME_EDITOR_COMMAND = "nbook.settings.open-theme-editor";
export const OPEN_THEME_EDITOR_FLOATING_COMMAND = "nbook.settings.open-theme-editor-floating";
/** 编辑区页面 id：插件 id 加名字，标题取 `editorPages.theme-editor.title`。 */
export const THEME_EDITOR_PAGE_ID = "nbook.workbench.theme-editor";
export const THEME_EDITOR_OVERLAY = "nbook.workbench.theme-editor-window";

const DECLARATION = (description: string): WrittenCommandDeclaration => ({
    category: workbenchText("categories.settings"),
    description,
    args: Type.Object({}, {additionalProperties: false}),
    effect: "read",
    expose: {agent: "never"},
});

export const OPEN_THEME_EDITOR_DECLARATION = DECLARATION("Open the theme editor in an editor tab: make a theme of your own, with the real workbench changing as you edit.");
export const OPEN_THEME_EDITOR_FLOATING_DECLARATION = DECLARATION("Open the theme editor in a floating window, so the workbench stays visible beside it.");

export function themeEditorCommands(commands: CommandService, session: ThemeEditorSession): {readonly [OPEN_THEME_EDITOR_COMMAND]: CommandImplementation; readonly [OPEN_THEME_EDITOR_FLOATING_COMMAND]: CommandImplementation} {
    return {
        [OPEN_THEME_EDITOR_COMMAND]: {
            run: () => {
                session.floating.value = false;
                return commands.execute(OPEN_PAGE_COMMAND, {id: THEME_EDITOR_PAGE_ID}, {source: "user"});
            },
        },
        [OPEN_THEME_EDITOR_FLOATING_COMMAND]: {
            run: () => {
                session.floating.value = true;
                return Promise.resolve({ok: true as const, value: undefined});
            },
        },
    };
}
