/**
 * 插件 SDK 的 `/settings/browser`：内置插件 `nbook.settings` 只在浏览器里有意义的部分（docs/specs/settings/settings-window.md）：
 * 设置页、选项来源与设置页里排版用的组件。要 Vue，只给浏览器入口用。
 * 规则同 `index.ts`：只再导出已有实现，每一项都是兼容范围内的承诺。
 */

export {choices, settingsPage} from "./settings-browser-helpers";
export type {ChoicesHelper, SettingsPageHelper} from "./settings-browser-helpers";

export type {SettingsChoicesImplementation, SettingsPageContext, SettingsPageWriteFailure} from "nbook/plugins/settings/web/contracts";
export type {OptionSource} from "@notnotype/nb-form";

// 设置页里的排版组件：每一项用 `SettingsRow` 排，列表、操作行与保存栏同设置窗口自己的分区。
export {default as SettingsPageActions} from "nbook/ui/settings/SettingsPageActions.vue";
export {default as SettingsPageList} from "nbook/ui/settings/SettingsPageList.vue";
export {default as SettingsRow} from "nbook/ui/settings/SettingsRow.vue";
export {default as SettingsSaveBar} from "nbook/ui/settings/SettingsSaveBar.vue";
