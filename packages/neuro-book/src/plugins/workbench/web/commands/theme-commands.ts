/**
 * “切换主题”“切换明暗”（docs/specs/workbench/commands.md 的“命令目录（设置）”）：主题与明暗是工作台声明的配置项，
 * 只有声明者能写，所以命令由工作台贡献；内置命令的域取 `settings`，域表示功能领域，不等于插件 id。写入目标为
 * `auto`：项目层已经覆盖了这一项时写项目层，否则改了也看不到效果。
 */

import {Type} from "typebox";

import type {CommandDeclaration, CommandImplementation} from "nbook/plugins/commands/shared/contracts";
import {switchSetting} from "nbook/plugins/settings/shared/contracts";
import type {SettingsService} from "nbook/shared/settings";

import {appearanceSetting, themeSetting} from "../../shared/contracts";
import type {QuickPick} from "../../shared/contracts";

export const SWITCH_THEME_COMMAND = "nbook.settings.switch-theme";
export const SWITCH_APPEARANCE_COMMAND = "nbook.settings.switch-appearance";

const THEMES = ["nbook", "macos"] as const;
const APPEARANCES = ["light", "dark", "system"] as const;

export const SWITCH_THEME_DECLARATION: CommandDeclaration = {
    title: {"zh-CN": "切换主题", "en-US": "Change Theme"},
    category: {"zh-CN": "设置", "en-US": "Settings"},
    description: "Change the theme pack (nbook or macos). Without arguments, the user picks one; with { theme }, it is set directly.",
    args: Type.Object({theme: Type.Optional(Type.Union(THEMES.map((id) => Type.Literal(id))))}, {additionalProperties: false}),
    effect: "write",
    expose: {agent: "auto"},
};

export const SWITCH_APPEARANCE_DECLARATION: CommandDeclaration = {
    title: {"zh-CN": "切换明暗", "en-US": "Change Appearance"},
    category: {"zh-CN": "设置", "en-US": "Settings"},
    description: "Change between light, dark and following the system. Without arguments, the user picks one; with { appearance }, it is set directly.",
    args: Type.Object({appearance: Type.Optional(Type.Union(APPEARANCES.map((id) => Type.Literal(id))))}, {additionalProperties: false}),
    effect: "write",
    expose: {agent: "auto"},
};

/** 两条命令的实现；键写死成两个命令 id，激活产出的编译期核对才对得上声明。 */
export function themeCommands(settings: SettingsService, quickPick: QuickPick): {readonly [SWITCH_THEME_COMMAND]: CommandImplementation; readonly [SWITCH_APPEARANCE_COMMAND]: CommandImplementation} {
    return {
        [SWITCH_THEME_COMMAND]: {
            run: (args) => switchSetting({
                settings,
                quickPick,
                setting: themeSetting,
                value: (args as {readonly theme?: (typeof THEMES)[number]}).theme,
                choices: [{id: "nbook", label: "NeuroBook"}, {id: "macos", label: "macOS"}],
                title: SWITCH_THEME_DECLARATION.title,
            }),
        },
        [SWITCH_APPEARANCE_COMMAND]: {
            run: (args) => switchSetting({
                settings,
                quickPick,
                setting: appearanceSetting,
                value: (args as {readonly appearance?: (typeof APPEARANCES)[number]}).appearance,
                choices: [
                    {id: "light", label: {"zh-CN": "浅色", "en-US": "Light"}},
                    {id: "dark", label: {"zh-CN": "深色", "en-US": "Dark"}},
                    {id: "system", label: {"zh-CN": "跟随系统", "en-US": "Follow System"}},
                ],
                title: SWITCH_APPEARANCE_DECLARATION.title,
            }),
        },
    };
}
