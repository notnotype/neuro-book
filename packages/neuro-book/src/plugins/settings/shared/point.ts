/**
 * 贡献点 `settings.properties` 的定义与已接受声明的查询（docs/specs/settings/configuration.md 输出 1–3）。三个位置的
 * `nbook.settings` 定义都带这个贡献点：声明写在各插件的描述里，每个实例都登记，所以每个实例都能校验与合成。
 */

import type {ContributionDeclarations, ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";

import {SETTINGS_POINT, settingDeclarationProblem} from "nbook/shared/settings";
import type {SettingDeclaration} from "nbook/shared/settings";

import type {DeclaredSetting} from "./layers";

export const settingsPoint: ContributionPointDefinition<SettingDeclaration> = {
    id: SETTINGS_POINT,
    implementation: "none",
    validate: (descriptor) => settingDeclarationProblem(descriptor.plugin, descriptor.id, descriptor.declaration),
};

/** 本实例已接受的全部声明：键 → 声明者与声明。 */
export function acceptedSettings(declarations: ContributionDeclarations): ReadonlyMap<string, DeclaredSetting> {
    return new Map(declarations.list<SettingDeclaration>(SETTINGS_POINT).map((descriptor) => [descriptor.id, {plugin: descriptor.plugin, declaration: descriptor.declaration}]));
}
