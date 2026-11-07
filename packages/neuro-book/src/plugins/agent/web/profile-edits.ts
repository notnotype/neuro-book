/**
 * Profile 设置页模型、审批两行的取值与写回（docs/specs/agent/profile-settings.md 输出 5、8）：选项值与设置项之间的换算。哨兵只在页面上，不落盘。
 */

import {roleOfReference, roleReference} from "nbook/plugins/models/shared/contracts";

import type {ProfileSetting} from "../shared/settings";

/** 跟随默认：模型下拉用空串（`SearchSelect` 收空串），审批模式用哨兵（`Select` 的选项不能是空串）；都不落盘。 */
export const FOLLOW_MODEL = "";
export const FOLLOW_APPROVAL = "default";
/** 模型一行的取值：文件里 `model` 与 `role` 都写时按 `model`（models/service.md 输出 8）。 */
export function modelChoiceOf(setting: ProfileSetting | undefined): string {
    if (setting?.model !== undefined) return setting.model;
    return setting?.role === undefined ? FOLLOW_MODEL : roleReference(setting.role);
}

/** 一个 Profile 的设置写回去：空的字段删掉，都空时不留这个 key；别的 Profile 原样留着。 */
function withSetting(settings: Readonly<Record<string, ProfileSetting>>, profile: string, setting: ProfileSetting): Record<string, ProfileSetting> {
    const next: Record<string, ProfileSetting> = {...settings};
    if (Object.keys(setting).length === 0) delete next[profile];
    else next[profile] = setting;
    return next;
}

export function withModelChoice(settings: Readonly<Record<string, ProfileSetting>>, profile: string, choice: string): Record<string, ProfileSetting> {
    const {model: _model, role: _role, ...rest} = settings[profile] ?? {};
    const role = roleOfReference(choice);
    if (choice === FOLLOW_MODEL) return withSetting(settings, profile, rest);
    return withSetting(settings, profile, role === null ? {...rest, model: choice} : {...rest, role});
}

export function withApprovalChoice(settings: Readonly<Record<string, ProfileSetting>>, profile: string, choice: string): Record<string, ProfileSetting> {
    const {approvalMode: _approvalMode, ...rest} = settings[profile] ?? {};
    return withSetting(settings, profile, choice === FOLLOW_APPROVAL ? rest : {...rest, approvalMode: choice as NonNullable<ProfileSetting["approvalMode"]>});
}
