/**
 * “切换主题”“切换明暗”（docs/specs/workbench/commands.md 的“命令目录（设置）”）：主题与明暗是工作台声明的配置项，
 * 只有声明者能写，所以命令由工作台贡献；内置命令的域取 `settings`，域表示功能领域，不等于插件 id。写入目标为
 * `auto`：项目层已经覆盖了这一项时写项目层，否则改了也看不到效果。
 */

import {Type} from "typebox";

import type {CommandImplementation, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {switchSetting} from "nbook/plugins/settings/shared/contracts";
import type {TextResolver} from "nbook/shared/localized-text";
import type {SettingsService} from "nbook/shared/settings";

import {appearanceSetting, themeSetting} from "../../shared/contracts";
import type {QuickPick} from "../../shared/contracts";
import {workbenchText} from "../../shared/text";
import type {ThemeCatalog} from "../themes";

export const SWITCH_THEME_COMMAND = "nbook.settings.switch-theme";
export const SWITCH_APPEARANCE_COMMAND = "nbook.settings.switch-appearance";

const APPEARANCES = ["light", "dark", "system"] as const;

export const SWITCH_THEME_DECLARATION: WrittenCommandDeclaration = {
    category: workbenchText("categories.settings"),
    description: "Change the theme. Without arguments, the user picks one; with { theme }, it is set directly to that theme id, such as nbook, macos or <publisher>.<plugin>.<name>. Plugins can add themes; an id that is not installed fails with invalid-args and the reason lists the installed ids.",
    args: Type.Object({theme: Type.Optional(Type.String({minLength: 1}))}, {additionalProperties: false}),
    effect: "write",
    expose: {agent: "auto"},
};

export const SWITCH_APPEARANCE_DECLARATION: WrittenCommandDeclaration = {
    category: workbenchText("categories.settings"),
    description: "Change between light, dark and following the system. Without arguments, the user picks one; with { appearance }, it is set directly.",
    args: Type.Object({appearance: Type.Optional(Type.Union(APPEARANCES.map((id) => Type.Literal(id))))}, {additionalProperties: false}),
    effect: "write",
    expose: {agent: "auto"},
};

/** 两条命令的实现；键写死成两个命令 id，激活产出的编译期核对才对得上声明。 */
export function themeCommands(settings: SettingsService, quickPick: QuickPick, text: TextResolver, themes: ThemeCatalog): {readonly [SWITCH_THEME_COMMAND]: CommandImplementation; readonly [SWITCH_APPEARANCE_COMMAND]: CommandImplementation} {
    return {
        [SWITCH_THEME_COMMAND]: {
            run: (args) => {
                const {theme} = args as {readonly theme?: string};
                // 字符串的 schema 拦不住错的 id，写进设置也只会退回缺省，所以这里按目录拦下。
                if (theme !== undefined && !themes.has(theme)) return Promise.resolve({ok: false, code: "invalid-args", reason: text.t(workbenchText("themeCommands.unknownTheme", {id: theme, ids: themes.list.map((entry) => entry.id).join(", ")}))});
                return switchSetting({
                    settings,
                    quickPick,
                    text,
                    setting: themeSetting,
                    value: theme,
                    choices: themes.list.map((entry) => ({id: entry.id, label: entry.declaration.title})),
                    title: workbenchText("commands.nbook.settings.switch-theme.title"),
                });
            },
        },
        [SWITCH_APPEARANCE_COMMAND]: {
            run: (args) => switchSetting({
                settings,
                quickPick,
                text,
                setting: appearanceSetting,
                value: (args as {readonly appearance?: (typeof APPEARANCES)[number]}).appearance,
                choices: [
                    {id: "light", label: workbenchText("themeCommands.appearances.light")},
                    {id: "dark", label: workbenchText("themeCommands.appearances.dark")},
                    {id: "system", label: workbenchText("themeCommands.appearances.system")},
                ],
                title: workbenchText("commands.nbook.settings.switch-appearance.title"),
            }),
        },
    };
}
