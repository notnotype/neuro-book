import type {ProfileRuntimeSettings} from "nbook/shared/agent/profile-runtime-settings";

/** 将最终通用运行配置转换为 hidden summarizer 调度合同。 */
export function resolveProfileSummarizer(
    settings: ProfileRuntimeSettings["summarizer"],
    force = false,
): {profileKey: string; input: Omit<ProfileRuntimeSettings["summarizer"], "enabled" | "profileKey">} | null {
    if (!force && !settings.enabled) {
        return null;
    }
    return {
        profileKey: settings.profileKey,
        input: {
            trigger: settings.trigger,
            interval: settings.interval,
            maxDialogueContentTokens: settings.maxDialogueContentTokens,
        },
    };
}
