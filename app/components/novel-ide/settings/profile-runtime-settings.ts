import type {ProfileRuntimeSettingsDto, ProfileRuntimeSettingsPatchDto} from "nbook/shared/dto/config.dto";

export type ProfileRuntimeSettingsDraft = {
    summarizerEnabled: boolean | null;
    summarizerProfileKey: string;
    summarizerIntervalKind: "" | "sourceInvocation" | "dialogueContentTokens";
    summarizerIntervalValue: string;
    summarizerMaxTokens: string;
    compactionEnabled: boolean | null;
    compactionTriggerKind: "" | "autoReserve" | "percent" | "tokens";
    compactionTriggerValue: string;
    compactionReserveTokens: string;
    compactionKeepRecentKind: "" | "percent" | "tokens";
    compactionKeepRecentValue: string;
    fileChangeDiffMaxChars: string;
};

export type ProfileRuntimeSettingsField = keyof ProfileRuntimeSettingsDraft;
export type ProfileRuntimeSettingsErrors = Partial<Record<ProfileRuntimeSettingsField, string>>;
export type ProfileRuntimeSettingsParseResult = {
    patch: ProfileRuntimeSettingsPatchDto;
    errors: ProfileRuntimeSettingsErrors;
};
export type ProfileRuntimeSettingsSource = "harness" | "profileDefault" | "globalDefault" | "globalProfile" | "projectDefault" | "projectProfile";
export type ProfileRuntimeSettingsSources = Record<ProfileRuntimeSettingsField, ProfileRuntimeSettingsSource>;
export type ProfileRuntimeSettingsLayer = {source: ProfileRuntimeSettingsSource; patch: ProfileRuntimeSettingsPatchDto | undefined};

/** 按层解析继承基线，同时记录每个编辑字段的真实来源。 */
export function resolveProfileRuntimeInheritance(
    harness: ProfileRuntimeSettingsDto,
    layers: ProfileRuntimeSettingsLayer[],
): {settings: ProfileRuntimeSettingsDto; sources: ProfileRuntimeSettingsSources} {
    const settings = structuredClone(harness);
    const sources = Object.fromEntries(([
        "summarizerEnabled", "summarizerProfileKey", "summarizerIntervalKind", "summarizerIntervalValue", "summarizerMaxTokens",
        "compactionEnabled", "compactionTriggerKind", "compactionTriggerValue", "compactionReserveTokens",
        "compactionKeepRecentKind", "compactionKeepRecentValue", "fileChangeDiffMaxChars",
    ] satisfies ProfileRuntimeSettingsField[]).map((field) => [field, "harness"])) as ProfileRuntimeSettingsSources;
    for (const layer of layers) {
        const patch = layer.patch;
        if (patch?.summarizer?.enabled !== undefined) { settings.summarizer.enabled = patch.summarizer.enabled; sources.summarizerEnabled = layer.source; }
        if (patch?.summarizer?.profileKey !== undefined) { settings.summarizer.profileKey = patch.summarizer.profileKey; sources.summarizerProfileKey = layer.source; }
        if (patch?.summarizer?.interval !== undefined) {
            settings.summarizer.interval = patch.summarizer.interval;
            sources.summarizerIntervalKind = layer.source;
            sources.summarizerIntervalValue = layer.source;
        }
        if (patch?.summarizer?.maxDialogueContentTokens !== undefined) { settings.summarizer.maxDialogueContentTokens = patch.summarizer.maxDialogueContentTokens; sources.summarizerMaxTokens = layer.source; }
        if (patch?.compaction?.enabled !== undefined) { settings.compaction.enabled = patch.compaction.enabled; sources.compactionEnabled = layer.source; }
        if (patch?.compaction?.trigger !== undefined) {
            settings.compaction.trigger = patch.compaction.trigger;
            sources.compactionTriggerKind = layer.source;
            sources.compactionTriggerValue = layer.source;
        }
        if (patch?.compaction?.reserveTokens !== undefined) { settings.compaction.reserveTokens = patch.compaction.reserveTokens; sources.compactionReserveTokens = layer.source; }
        if (patch?.compaction?.keepRecent !== undefined) {
            settings.compaction.keepRecent = patch.compaction.keepRecent;
            sources.compactionKeepRecentKind = layer.source;
            sources.compactionKeepRecentValue = layer.source;
        }
        if (patch?.fileChangeNotice?.diffMaxChars !== undefined) { settings.fileChangeNotice.diffMaxChars = patch.fileChangeNotice.diffMaxChars; sources.fileChangeDiffMaxChars = layer.source; }
    }
    return {settings, sources};
}

/** 把某一配置层的显式 runtime patch 转成可编辑草稿；空值表示继承。 */
export function createProfileRuntimeSettingsDraft(patch: ProfileRuntimeSettingsPatchDto | undefined): ProfileRuntimeSettingsDraft {
    const trigger = patch?.compaction?.trigger;
    return {
        summarizerEnabled: patch?.summarizer?.enabled ?? null,
        summarizerProfileKey: patch?.summarizer?.profileKey ?? "",
        summarizerIntervalKind: patch?.summarizer?.interval?.kind ?? "",
        summarizerIntervalValue: numberText(patch?.summarizer?.interval?.value),
        summarizerMaxTokens: numberText(patch?.summarizer?.maxDialogueContentTokens),
        compactionEnabled: patch?.compaction?.enabled ?? null,
        compactionTriggerKind: trigger?.kind ?? "",
        compactionTriggerValue: trigger && "value" in trigger ? numberText(trigger.value) : "",
        compactionReserveTokens: numberText(patch?.compaction?.reserveTokens),
        compactionKeepRecentKind: patch?.compaction?.keepRecent?.kind ?? "",
        compactionKeepRecentValue: numberText(patch?.compaction?.keepRecent?.value),
        fileChangeDiffMaxChars: numberText(patch?.fileChangeNotice?.diffMaxChars),
    };
}

/** 将草稿压缩为只包含显式覆盖字段的 runtime patch。 */
export function buildProfileRuntimeSettingsPatch(draft: ProfileRuntimeSettingsDraft): ProfileRuntimeSettingsPatchDto {
    return parseProfileRuntimeSettingsDraft(draft).patch;
}

/** 严格解析运行策略草稿；空白表示继承，非空非法值必须返回字段错误。 */
export function parseProfileRuntimeSettingsDraft(draft: ProfileRuntimeSettingsDraft): ProfileRuntimeSettingsParseResult {
    const errors: ProfileRuntimeSettingsErrors = {};
    const intervalValue = parsePositiveNumber(draft.summarizerIntervalValue, false, "summarizerIntervalValue", errors);
    const maxTokens = parsePositiveNumber(draft.summarizerMaxTokens, false, "summarizerMaxTokens", errors);
    if (draft.summarizerIntervalKind && intervalValue === null) {
        errors.summarizerIntervalValue ??= "requiredPositive";
    }
    const summarizer = {
        ...(draft.summarizerEnabled !== null ? {enabled: draft.summarizerEnabled} : {}),
        ...(draft.summarizerProfileKey.trim() ? {profileKey: draft.summarizerProfileKey.trim()} : {}),
        ...(draft.summarizerIntervalKind && intervalValue !== null ? {
            interval: {kind: draft.summarizerIntervalKind, value: intervalValue},
        } : {}),
        ...(maxTokens !== null ? {maxDialogueContentTokens: maxTokens} : {}),
    };
    const triggerValue = parsePositiveNumber(draft.compactionTriggerValue, draft.compactionTriggerKind === "tokens", "compactionTriggerValue", errors);
    const keepRecentValue = parsePositiveNumber(draft.compactionKeepRecentValue, draft.compactionKeepRecentKind === "tokens", "compactionKeepRecentValue", errors);
    if ((draft.compactionTriggerKind === "percent" || draft.compactionTriggerKind === "tokens") && triggerValue === null) {
        errors.compactionTriggerValue ??= "requiredPositive";
    }
    if (draft.compactionTriggerKind === "percent" && triggerValue !== null && triggerValue > 1) {
        errors.compactionTriggerValue = "percentRange";
    }
    if (draft.compactionKeepRecentKind && keepRecentValue === null) {
        errors.compactionKeepRecentValue ??= "requiredPositive";
    }
    if (draft.compactionKeepRecentKind === "percent" && keepRecentValue !== null && keepRecentValue > 1) {
        errors.compactionKeepRecentValue = "percentRange";
    }
    const reserveTokens = parsePositiveNumber(draft.compactionReserveTokens, true, "compactionReserveTokens", errors);
    const compaction = {
        ...(draft.compactionEnabled !== null ? {enabled: draft.compactionEnabled} : {}),
        ...(draft.compactionTriggerKind === "autoReserve" ? {trigger: {kind: "autoReserve" as const}} : {}),
        ...(draft.compactionTriggerKind === "percent" && triggerValue !== null && !errors.compactionTriggerValue ? {trigger: {kind: "percent" as const, value: triggerValue}} : {}),
        ...(draft.compactionTriggerKind === "tokens" && triggerValue !== null && !errors.compactionTriggerValue ? {trigger: {kind: "tokens" as const, value: triggerValue}} : {}),
        ...(reserveTokens !== null ? {reserveTokens} : {}),
        ...(draft.compactionKeepRecentKind === "percent" && keepRecentValue !== null && !errors.compactionKeepRecentValue ? {keepRecent: {kind: "percent" as const, value: keepRecentValue}} : {}),
        ...(draft.compactionKeepRecentKind === "tokens" && keepRecentValue !== null && !errors.compactionKeepRecentValue ? {keepRecent: {kind: "tokens" as const, value: keepRecentValue}} : {}),
    };
    const diffMaxChars = parseDiffMaxChars(draft.fileChangeDiffMaxChars, errors);
    return {patch: {
        ...(Object.keys(summarizer).length > 0 ? {summarizer} : {}),
        ...(Object.keys(compaction).length > 0 ? {compaction} : {}),
        ...(diffMaxChars !== null ? {fileChangeNotice: {diffMaxChars}} : {}),
    }, errors};
}

function numberText(value: number | undefined): string {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function parsePositiveNumber(value: string, integer: boolean, field: ProfileRuntimeSettingsField, errors: ProfileRuntimeSettingsErrors): number | null {
    const parsed = Number(value.trim());
    if (!value.trim()) {
        return null;
    }
    if (!Number.isFinite(parsed) || parsed <= 0) {
        errors[field] = "requiredPositive";
        return null;
    }
    if (integer && !Number.isInteger(parsed)) {
        errors[field] = "integer";
        return null;
    }
    return parsed;
}

function parseDiffMaxChars(value: string, errors: ProfileRuntimeSettingsErrors): number | null {
    const parsed = Number(value.trim());
    if (!value.trim()) {
        return null;
    }
    if (!Number.isInteger(parsed)) {
        errors.fileChangeDiffMaxChars = "integer";
        return null;
    }
    if (parsed < 0 || parsed > 8192) {
        errors.fileChangeDiffMaxChars = "diffRange";
        return null;
    }
    return parsed;
}
