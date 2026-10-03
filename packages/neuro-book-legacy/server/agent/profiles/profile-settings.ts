import type {AgentProfile} from "nbook/server/agent/profiles/types";
import {
    parseLowCodeFormValue,
    validateLowCodeFormValue,
    type LowCodeFormResolveContext,
} from "nbook/server/low-code-form";
import type {LowCodeFormIssueDto, LowCodeJsonObject} from "nbook/shared/dto/low-code-form.dto";

export type ProfileSettingsResolution = {
    value: LowCodeJsonObject;
    issues: LowCodeFormIssueDto[];
};

/**
 * 解析 profile settings。没有 settingsForm 的 profile 始终返回空对象。
 */
export async function resolveProfileSettings(
    profile: AgentProfile,
    settingsPatch: LowCodeJsonObject | undefined,
    ctx: LowCodeFormResolveContext,
): Promise<ProfileSettingsResolution> {
    if (!profile.settingsForm) {
        return {
            value: {},
            issues: [],
        };
    }
    const result = await validateLowCodeFormValue(profile.settingsForm, settingsPatch, ctx);
    return {
        value: result.value as LowCodeJsonObject,
        issues: result.issues,
    };
}

/**
 * 解析运行时 settings；遇到损坏 stored settings 时回退 profile defaults。
 */
export async function resolveRuntimeProfileSettings(
    profile: AgentProfile,
    settingsPatch: LowCodeJsonObject | undefined,
    ctx: LowCodeFormResolveContext,
): Promise<LowCodeJsonObject> {
    if (!profile.settingsForm) {
        return {};
    }
    const result = await validateLowCodeFormValue(profile.settingsForm, settingsPatch, ctx);
    if (result.issues.some((issue) => issue.severity === "error")) {
        console.warn(`[agent] profile ${profile.manifest.key} settings invalid, fallback to defaults`, result.issues);
        return parseLowCodeFormValue(profile.settingsForm, undefined) as LowCodeJsonObject;
    }
    return result.value as LowCodeJsonObject;
}
