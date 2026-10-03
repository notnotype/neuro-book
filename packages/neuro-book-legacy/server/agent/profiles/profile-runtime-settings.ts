import type {
    ProfileRuntimeDefaults,
    ProfileRuntimeSettings,
    ProfileRuntimeSettingsPatch,
} from "nbook/shared/agent/profile-runtime-settings";
import {ProfileRuntimeSettingsPatchSchema} from "nbook/shared/agent/profile-runtime-settings";
import {DEFAULT_AGENT_DIFF_MAX_CHARS} from "nbook/shared/agent/file-change-policy";

export const COMPACTION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.`;

export const COMPACTION_SUMMARY_PREFIX = "Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:";

export const DEFAULT_PROFILE_RUNTIME_SETTINGS: ProfileRuntimeSettings = {
    summarizer: {
        enabled: false,
        profileKey: "summarizer",
        trigger: "afterInvocation",
        interval: {kind: "sourceInvocation", value: 16},
        maxDialogueContentTokens: 80_000,
    },
    compaction: {
        enabled: true,
        trigger: {kind: "autoReserve"},
        reserveTokens: 25_600,
        keepRecent: {kind: "tokens", value: 24_000},
        prompt: COMPACTION_PROMPT,
        summaryPrefix: COMPACTION_SUMMARY_PREFIX,
    },
    fileChangeNotice: {
        diffMaxChars: DEFAULT_AGENT_DIFF_MAX_CHARS,
    },
};

/** 字段级合并运行配置；判别联合对象由上层 patch 整体替换。 */
export function mergeProfileRuntimePatches(...patches: Array<ProfileRuntimeSettingsPatch | undefined>): ProfileRuntimeSettingsPatch {
    const result: ProfileRuntimeSettingsPatch = {};
    for (const patch of patches) {
        if (!patch) {
            continue;
        }
        if (patch.summarizer) {
            result.summarizer = {...result.summarizer, ...patch.summarizer};
        }
        if (patch.compaction) {
            result.compaction = {...result.compaction, ...patch.compaction};
        }
        if (patch.fileChangeNotice) {
            result.fileChangeNotice = {...result.fileChangeNotice, ...patch.fileChangeNotice};
        }
    }
    return result;
}

/** 解析 Harness 最终使用的完整运行策略。 */
export function resolveProfileRuntimeSettings(
    profileDefaults: ProfileRuntimeDefaults | undefined,
    configured: ProfileRuntimeSettingsPatch | undefined,
): ProfileRuntimeSettings {
    const merged = mergeProfileRuntimePatches(DEFAULT_PROFILE_RUNTIME_SETTINGS, profileDefaults, configured);
    const summarizer = merged.summarizer ?? {};
    const compaction = merged.compaction ?? {};
    const fileChangeNotice = merged.fileChangeNotice ?? {};
    return {
        summarizer: {
            enabled: summarizer.enabled ?? DEFAULT_PROFILE_RUNTIME_SETTINGS.summarizer.enabled,
            profileKey: summarizer.profileKey ?? DEFAULT_PROFILE_RUNTIME_SETTINGS.summarizer.profileKey,
            trigger: summarizer.trigger ?? DEFAULT_PROFILE_RUNTIME_SETTINGS.summarizer.trigger,
            interval: summarizer.interval ?? DEFAULT_PROFILE_RUNTIME_SETTINGS.summarizer.interval,
            maxDialogueContentTokens: summarizer.maxDialogueContentTokens ?? DEFAULT_PROFILE_RUNTIME_SETTINGS.summarizer.maxDialogueContentTokens,
        },
        compaction: {
            enabled: compaction.enabled ?? DEFAULT_PROFILE_RUNTIME_SETTINGS.compaction.enabled,
            trigger: compaction.trigger ?? DEFAULT_PROFILE_RUNTIME_SETTINGS.compaction.trigger,
            reserveTokens: compaction.reserveTokens ?? DEFAULT_PROFILE_RUNTIME_SETTINGS.compaction.reserveTokens,
            keepRecent: compaction.keepRecent ?? DEFAULT_PROFILE_RUNTIME_SETTINGS.compaction.keepRecent,
            prompt: compaction.prompt ?? DEFAULT_PROFILE_RUNTIME_SETTINGS.compaction.prompt,
            summaryPrefix: compaction.summaryPrefix ?? DEFAULT_PROFILE_RUNTIME_SETTINGS.compaction.summaryPrefix,
        },
        fileChangeNotice: {
            diffMaxChars: fileChangeNotice.diffMaxChars ?? DEFAULT_PROFILE_RUNTIME_SETTINGS.fileChangeNotice.diffMaxChars,
        },
    };
}

/** 校验 Profile 默认值和配置 patch 共用的运行策略合同。 */
export function validateProfileRuntimeSettingsPatch(label: string, patch: ProfileRuntimeSettingsPatch | undefined): void {
    if (!patch) {
        return;
    }
    const result = ProfileRuntimeSettingsPatchSchema.safeParse(patch);
    if (!result.success) {
        const issue = result.error.issues[0];
        const path = issue?.path.length ? `.${issue.path.join(".")}` : "";
        throw new Error(`${label}${path} 配置无效：${issue?.message ?? "未知错误"}`);
    }
}
