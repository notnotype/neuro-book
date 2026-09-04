import type {AgentProfileModelConfigDto, ThinkingLevelDto} from "nbook/shared/dto/app-settings.dto";
import type {ConfigAgentProfileSettingsDto, ProfileRuntimeSettingsPatchDto} from "nbook/shared/dto/config.dto";
import type {LowCodeFormDto, LowCodeFormIssueDto, LowCodeJsonObject, LowCodeResourceMutationDto} from "nbook/shared/dto/low-code-form.dto";
import {
    cloneLowCodeObject,
    hasLowCodePath,
    lowCodeJsonEqual,
    readLowCodePath,
} from "nbook/app/components/common/low-code-form/low-code-form-utils";
import {
    buildProfileRuntimeSettingsPatch,
    type ProfileRuntimeSettingsDraft,
    type ProfileRuntimeSettingsErrors,
    type ProfileRuntimeSettingsSources,
} from "./profile-runtime-settings";

type AgentProfileSettingsDto = ConfigAgentProfileSettingsDto["agentProfiles"][number];

/** 配置层：Global 编辑完整值，Project 只编辑显式覆盖。 */
export type ConfigSettingsScope = "global" | "project";

/**
 * Profile 自定义 lowcode 设置的可编辑草稿。
 */
export type AgentProfileSettingsDraft = {
    form: LowCodeFormDto;
    /** Global 编辑完整值，Project 只编辑显式覆盖 patch */
    values: LowCodeJsonObject;
    inheritedValue: LowCodeJsonObject;
    issues: LowCodeFormIssueDto[];
    /** 仅 Project scope 使用：用户显式勾选覆盖的字段路径 */
    overridePaths: string[];
    resourceMutations: LowCodeResourceMutationDto[];
};

/**
 * 单个 Agent Profile 在设置面板中的完整草稿。
 */
export type AgentProfileDraft = {
    profileKey: string;
    name: string;
    canResetHome: boolean;
    model: AgentProfileModelDraft;
    loadStatus: AgentProfileSettingsDto["loadStatus"];
    runtime: ProfileRuntimeSettingsDraft;
    /** 当前 profile 的运行策略继承基线（未叠加本层草稿） */
    runtimeEffective: AgentProfileSettingsDto["runtime"]["effective"];
    runtimeSources: ProfileRuntimeSettingsSources;
    runtimeErrors: ProfileRuntimeSettingsErrors;
    /** 非空表示该 profile 编译或加载失败，携带原因 */
    issue: AgentProfileSettingsDto["issue"];
    /** 非空表示 profile 源文件路径 */
    sourcePath: string | null;
    buildState: AgentProfileSettingsDto["buildState"];
    /** 非空表示该 profile 声明了 lowcode 设置表单 */
    settings: AgentProfileSettingsDraft | null;
};

/**
 * 单个 Profile 写回配置的形态。
 */
export type AgentProfileConfigDraft = {
    model: Partial<AgentProfileModelConfigDto>;
    settings?: LowCodeJsonObject;
    resourceMutations?: LowCodeResourceMutationDto[];
    runtime?: ProfileRuntimeSettingsPatchDto;
};

/**
 * Agent Profile 模型参数的可编辑草稿。
 *
 * 数值字段用字符串承载，空串表示"未显式覆盖，继承上层"；
 * `modelKey` / `reasoningEffort` / `stream` 用 null 表示继承。
 */
export type AgentProfileModelDraft = {
    /** null 表示跟随上层默认模型 */
    modelKey: string | null;
    /** 空串表示继承 */
    temperature: string;
    /** 空串表示继承 */
    topK: string;
    /** null 表示继承 */
    reasoningEffort: ThinkingLevelDto | null;
    /** null 表示继承 */
    stream: boolean | null;
};

/**
 * 将数字配置转成表单文本；非有限值统一落到空串（表示继承）。
 */
export function stringifyNullableNumber(value: number | null): string {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/**
 * 将表单文本解析为可空数字；空串或非法值返回 null（表示继承）。
 */
export function parseNullableNumber(value: string | number | null | undefined, integerOnly = false): number | null {
    const normalized = typeof value === "number" ? String(value) : value?.trim() ?? "";
    if (!normalized) {
        return null;
    }

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
        return null;
    }

    return integerOnly ? Math.trunc(parsed) : parsed;
}

/**
 * 把某一配置层的模型配置转成可编辑草稿。
 */
export function cloneModelDraft(model: Partial<AgentProfileModelConfigDto> | undefined): AgentProfileModelDraft {
    return {
        modelKey: model?.modelKey ?? null,
        temperature: stringifyNullableNumber(model?.temperature ?? null),
        topK: stringifyNullableNumber(model?.topK ?? null),
        reasoningEffort: model?.reasoningEffort ?? null,
        stream: typeof model?.stream === "boolean" ? model.stream : null,
    };
}

/**
 * 将草稿压缩为只包含显式覆盖字段的 patch；留空字段不写入配置。
 */
export function buildModelPatch(model: AgentProfileModelDraft): Partial<AgentProfileModelConfigDto> {
    const temperature = parseNullableNumber(model.temperature);
    const topK = parseNullableNumber(model.topK, true);
    return {
        ...(model.modelKey ? {modelKey: model.modelKey} : {}),
        ...(temperature !== null ? {temperature} : {}),
        ...(topK !== null ? {topK} : {}),
        ...(model.reasoningEffort !== null ? {reasoningEffort: model.reasoningEffort} : {}),
        ...(model.stream !== null ? {stream: model.stream} : {}),
    };
}

/**
 * 将草稿补齐为完整模型配置；Global 默认参数需要写入完整形态。
 */
export function buildCompleteModelConfig(model: AgentProfileModelDraft): AgentProfileModelConfigDto {
    return {
        modelKey: model.modelKey,
        temperature: parseNullableNumber(model.temperature),
        topK: parseNullableNumber(model.topK, true),
        reasoningEffort: model.reasoningEffort ?? "off",
        stream: model.stream ?? true,
    };
}

/**
 * 在继承基线上叠加一层草稿覆盖，得到该层的实际生效值。
 */
export function mergeModelConfig(base: AgentProfileModelConfigDto, patch: AgentProfileModelDraft): AgentProfileModelConfigDto {
    return {
        modelKey: patch.modelKey ?? base.modelKey,
        temperature: parseNullableNumber(patch.temperature) ?? base.temperature,
        topK: parseNullableNumber(patch.topK, true) ?? base.topK,
        reasoningEffort: patch.reasoningEffort ?? base.reasoningEffort ?? "off",
        stream: patch.stream ?? base.stream ?? true,
    };
}

/**
 * 统计模型草稿中显式覆盖的字段数，用于二级导航徽标。
 */
export function countModelOverrides(model: AgentProfileModelDraft): number {
    return Object.keys(buildModelPatch(model)).length;
}

/**
 * 把可空布尔转成 FormSelect 需要的字符串值；null 对应"继承"选项。
 */
export function streamSelectValue(value: boolean | null): string {
    if (value === null) {
        return "inherit";
    }
    return value ? "true" : "false";
}

/**
 * 把 FormSelect 的字符串值解析回可空布尔；"inherit" 表示继承。
 */
export function parseStreamSelectValue(value: string): boolean | null {
    if (value === "inherit") {
        return null;
    }
    return value === "true";
}

/**
 * 克隆 profile settings 草稿。Global 编辑完整值；Project 只编辑显式覆盖 patch。
 */
export function cloneSettingsDraft(
    settings: AgentProfileSettingsDto["settings"],
    scope: ConfigSettingsScope,
): AgentProfileSettingsDraft | null {
    if (!settings) {
        return null;
    }
    const patch = scope === "project" ? settings.projectPatch : settings.globalPatch;
    return {
        form: settings.form,
        values: scope === "project" ? cloneLowCodeObject(patch) : cloneLowCodeObject(settings.value),
        inheritedValue: cloneLowCodeObject(settings.inheritedValue),
        issues: settings.issues,
        overridePaths: scope === "project"
            ? settings.form.fields.filter((field) => hasLowCodePath(patch, field.path)).map((field) => field.path)
            : [],
        resourceMutations: [],
    };
}

/**
 * 构造 settings 保存值。Global 只保存与 profile defaults 不同的字段，Project 只保存显式覆盖字段。
 */
export function buildSettingsPatch(settings: AgentProfileSettingsDraft | null, scope: ConfigSettingsScope): LowCodeJsonObject {
    if (!settings) {
        return {};
    }
    if (scope === "project") {
        return Object.fromEntries(settings.form.fields.filter((field) => settings.overridePaths.includes(field.path)).map((field) => {
            const value = readLowCodePath(settings.values, field.path);
            if (value !== undefined) {
                return [field.path, value] as const;
            }
            const defaultValue = hasLowCodePath(settings.form.defaults, field.path)
                ? readLowCodePath(settings.form.defaults, field.path)
                : field.defaultValue ?? null;
            return [field.path, defaultValue] as const;
        })) as LowCodeJsonObject;
    }
    return Object.fromEntries(settings.form.fields.flatMap((field) => {
        const value = readLowCodePath(settings.values, field.path);
        const defaultValue = hasLowCodePath(settings.form.defaults, field.path)
            ? readLowCodePath(settings.form.defaults, field.path)
            : field.defaultValue;
        if (value === undefined || lowCodeJsonEqual(value, defaultValue)) {
            return [];
        }
        return [[field.path, value] as const];
    })) as LowCodeJsonObject;
}

/**
 * 判断 JSON object 是否为空。
 */
function isEmptyObject(value: object): boolean {
    return Object.keys(value).length === 0;
}

/**
 * 构造单个 profile 的保存配置，同时保留 model 与 settings；完全没有覆盖时返回 null。
 */
export function buildProfileConfig(profile: AgentProfileDraft, scope: ConfigSettingsScope): AgentProfileConfigDraft | null {
    const modelPatch = buildModelPatch(profile.model);
    const settingsPatch = buildSettingsPatch(profile.settings, scope);
    const resourceMutations = profile.settings?.resourceMutations ?? [];
    const runtimePatch = buildProfileRuntimeSettingsPatch(profile.runtime);
    if (isEmptyObject(modelPatch) && (!profile.settings || isEmptyObject(settingsPatch)) && resourceMutations.length === 0 && isEmptyObject(runtimePatch)) {
        return null;
    }
    return {
        model: modelPatch,
        ...(profile.settings && !isEmptyObject(settingsPatch) ? {settings: settingsPatch} : {}),
        ...(resourceMutations.length > 0 ? {resourceMutations} : {}),
        ...(!isEmptyObject(runtimePatch) ? {runtime: runtimePatch} : {}),
    };
}

/**
 * 构造 profile 配置 map，避免在 Vue SFC 中触发过深类型推导。
 */
export function buildProfileConfigMap(profiles: AgentProfileDraft[], scope: ConfigSettingsScope): Record<string, AgentProfileConfigDraft> {
    const result: Record<string, AgentProfileConfigDraft> = {};
    for (const profile of profiles) {
        const config = buildProfileConfig(profile, scope);
        if (config) {
            result[profile.profileKey] = config;
        }
    }
    return result;
}

/**
 * 构造 Global profile 配置：当前不可见的 profile 原样保留，可见 profile 按草稿整体替换。
 */
export function buildGlobalProfileConfigMap(
    profiles: AgentProfileDraft[],
    baseProfiles: Record<string, {model?: Partial<AgentProfileModelConfigDto>; settings?: LowCodeJsonObject; runtime?: ProfileRuntimeSettingsPatchDto}>,
): Record<string, AgentProfileConfigDraft> {
    const visibleProfileKeys = new Set(profiles.map((profile) => profile.profileKey));
    const result: Record<string, AgentProfileConfigDraft> = Object.fromEntries(
        Object.entries(baseProfiles)
            .filter(([profileKey]) => !visibleProfileKeys.has(profileKey))
            .map(([profileKey, config]) => [profileKey, {
                model: config.model ?? {},
                ...(config.settings !== undefined ? {settings: cloneLowCodeObject(config.settings)} : {}),
                ...(config.runtime !== undefined ? {runtime: config.runtime} : {}),
            } satisfies AgentProfileConfigDraft]),
    );
    for (const profile of profiles) {
        const config = buildProfileConfig(profile, "global");
        if (config) {
            result[profile.profileKey] = config;
        }
    }
    return result;
}
