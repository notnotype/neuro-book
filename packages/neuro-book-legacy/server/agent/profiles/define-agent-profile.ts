import type {TSchema} from "typebox";
import type {AgentProfile, AgentProfileDefinition, AgentProfileManifest, ProfilePrepareContext} from "nbook/server/agent/profiles/types";
import {compileProfileContext, validateProfileTurnPlan} from "nbook/server/agent/profiles/profile-dsl";
import {agentRuntimeBuiltins, defineAgentRuntime} from "nbook/server/agent/profiles/define-agent-runtime";
import type {ProfileTools} from "nbook/profile-sdk/contracts";
import {assertLowCodeFormDefinition, parseLowCodeFormValue, type LowCodeFormDefinition} from "nbook/server/low-code-form";
import {validateProfileRuntimeSettingsPatch} from "nbook/server/agent/profiles/profile-runtime-settings";
import type {LowCodeJsonObject} from "nbook/shared/dto/low-code-form.dto";

/**
 * 将作者 artifact 归一化为宿主可执行的 Agent Profile。
 *
 * 作者 SDK 只返回纯声明；校验、默认值、Skill 过滤、DSL 编译和 prepare 包装都
 * 集中在这个宿主 seam，避免把宿主实现冻结进每个内容寻址 artifact。
 */
export function normalizeAgentProfile<
    const TInitialSchema extends TSchema,
    const TPayloadSchema extends TSchema = TSchema,
    const TOutputSchema extends TSchema = TSchema,
    const TSettingsSchema extends TSchema | undefined = undefined,
    const TSummarizerKey extends string = string,
    const TTools extends ProfileTools = ProfileTools,
>(profile: AgentProfileDefinition<TInitialSchema, TPayloadSchema, TOutputSchema, TSettingsSchema, TSummarizerKey, TTools>): AgentProfile<TInitialSchema, TPayloadSchema, TOutputSchema, TSettingsSchema, TSummarizerKey, TTools> {
    assertProfileManifest(profile.manifest);
    assertNoLegacyToolFields(profile.manifest.key, profile);
    const rootToolKeys = assertProfileTools(profile.manifest.key, profile.tools);
    if (profile.settingsForm) assertLowCodeFormDefinition(profile.settingsForm);
    validateProfileRuntimeSettingsPatch(`profile ${profile.manifest.key} runtimeDefaults`, profile.runtimeDefaults);
    assertProfileSkills(profile.manifest.key, profile.skills);
    assertProfileToolKeys(profile.manifest.key, rootToolKeys, profile.toolKeys);
    if (profile.context && profile.prepare) {
        throw new Error(`profile ${profile.manifest.key} 不能同时定义 context 和 prepare。`);
    }
    if (!profile.context && !profile.prepare) {
        throw new Error(`profile ${profile.manifest.key} 必须定义 context 或 prepare。`);
    }
    const prepare = profile.prepare
        ? async (...args: Parameters<NonNullable<typeof profile.prepare>>) => {
            const ctx = withSkillInclude(profile, withDefaultSettings(profile, args[0]));
            const plan = await profile.prepare!(ctx as never);
            validateProfileTurnPlan(profile.manifest.key, plan);
            return plan;
        }
        : async (...args: Parameters<NonNullable<AgentProfile<TInitialSchema, TPayloadSchema, TOutputSchema, TSettingsSchema>["prepare"]>>) => {
            const ctx = withSkillInclude(profile, withDefaultSettings(profile, args[0]));
            const tree = await profile.context!(ctx);
            return compileProfileContext(profile, ctx, tree);
        };
    const runtime = profile.runtime
        ? defineAgentRuntime(profile.runtime)
        : agentRuntimeBuiltins.defaultSessionRuntime();
    return {
        ...profile,
        rootToolKeys,
        runtime,
        prepare,
    };
}

/**
 * 定义宿主内存 Profile。Source 内部调用继续直接得到可执行 Profile；作者 SDK 不调用此入口。
 */
export function defineAgentProfile<
    const TInitialSchema extends TSchema,
    const TPayloadSchema extends TSchema = TSchema,
    const TOutputSchema extends TSchema = TSchema,
    const TSettingsSchema extends TSchema | undefined = undefined,
    const TSummarizerKey extends string = string,
    const TTools extends ProfileTools = ProfileTools,
>(profile: AgentProfileDefinition<TInitialSchema, TPayloadSchema, TOutputSchema, TSettingsSchema, TSummarizerKey, TTools>): AgentProfile<TInitialSchema, TPayloadSchema, TOutputSchema, TSettingsSchema, TSummarizerKey, TTools> {
    return normalizeAgentProfile(profile);
}

/**
 * 为直接调用 profile.prepare 的路径补齐 Profile 自定义 settings defaults。
 * Harness 通用运行配置不进入 ctx.settings。
 */
function withDefaultSettings<TContext extends ProfilePrepareContext>(
    profile: {settingsForm?: LowCodeFormDefinition},
    ctx: TContext,
): TContext {
    const providedSettings = (ctx.settings ?? {}) as LowCodeJsonObject;
    const profileSettings: LowCodeJsonObject = profile.settingsForm
        ? parseLowCodeFormValue(profile.settingsForm, providedSettings) as LowCodeJsonObject
        : providedSettings;
    return {
        ...ctx,
        settings: profileSettings,
    } as TContext;
}

/**
 * 按 profile 声明的 skill 白名单过滤 prepare ctx 的可见 skill 快照。
 * 在 prepare 包装层统一过滤，SkillCatalog 与自定义 text 函数等所有消费者拿到的都是同一份过滤结果。
 * 白名单外的 key 静默丢弃；未声明 skills 时保持全量。
 */
function withSkillInclude<TContext extends ProfilePrepareContext>(
    profile: {skills?: {include: readonly string[]}},
    ctx: TContext,
): TContext {
    if (!profile.skills) {
        return ctx;
    }
    const include = new Set(profile.skills.include);
    return {
        ...ctx,
        skills: ctx.skills.filter((skill) => include.has(skill.key)),
    } as TContext;
}

/**
 * 校验 profile manifest 的最小运行时合同。
 */
export function assertProfileManifest(manifest: AgentProfileManifest): void {
    if (!manifest.key.trim()) {
        throw new Error("profile manifest.key 不能为空");
    }
    if (!manifest.name.trim()) {
        throw new Error(`profile ${manifest.key} manifest.name 不能为空`);
    }
    if (manifest.version !== undefined && (!Number.isInteger(manifest.version) || manifest.version < 1)) {
        throw new Error(`profile ${manifest.key} manifest.version 必须是正整数。`);
    }
}


/**
 * 校验 profile skill 白名单声明：include 必须是非空、去重的 skill key 数组。
 */
function assertProfileSkills(profileKey: string, skills: AgentProfileDefinition["skills"]): void {
    if (!skills) {
        return;
    }
    if (!Array.isArray(skills.include)) {
        throw new Error(`profile ${profileKey} skills.include 必须是 skill key 数组。`);
    }
    const seen = new Set<string>();
    for (const skillKey of skills.include) {
        if (typeof skillKey !== "string" || !skillKey.trim()) {
            throw new Error(`profile ${profileKey} skills.include 不能包含空 key。`);
        }
        if (seen.has(skillKey)) {
            throw new Error(`profile ${profileKey} skills.include 重复：${skillKey}`);
        }
        seen.add(skillKey);
    }
}

/**
 * 拒绝旧 profile 工具声明字段，避免 tools binding 硬切后出现双真相源。
 */
function assertNoLegacyToolFields(profileKey: string, profile: object): void {
    if ("allowedToolKeys" in profile) {
        throw new Error(`profile ${profileKey} 已移除 allowedToolKeys，请改用 tools: toolset(...)。`);
    }
    if ("mainRunAllowedToolKeys" in profile) {
        throw new Error(`profile ${profileKey} 已移除 mainRunAllowedToolKeys，请改用 toolKeys。`);
    }
    if ("mainRunToolKeys" in profile) {
        throw new Error(`profile ${profileKey} 已移除 mainRunToolKeys，请改用 toolKeys。`);
    }
}

/**
 * 校验 profile root tools 对象，并返回稳定工具 key 列表。
 */
function assertProfileTools<TTools extends ProfileTools>(profileKey: string, tools: TTools): readonly (keyof TTools & string)[] {
    if (!tools || typeof tools !== "object" || Array.isArray(tools)) {
        throw new Error(`profile ${profileKey} 必须定义 tools 对象。`);
    }
    const toolKeys = Object.keys(tools) as (keyof TTools & string)[];
    const seen = new Set<string>();
    for (const toolKey of toolKeys) {
        if (!toolKey.trim()) {
            throw new Error(`profile ${profileKey} tools 不能包含空 key。`);
        }
        if (seen.has(toolKey)) {
            throw new Error(`profile ${profileKey} tools 重复：${toolKey}`);
        }
        seen.add(toolKey);
        const binding = tools[toolKey];
        if (!binding || typeof binding !== "object") {
            throw new Error(`profile ${profileKey} tools.${toolKey} 必须是 ToolBinding。`);
        }
        if (binding.key !== toolKey) {
            throw new Error(`profile ${profileKey} tools.${toolKey} 的 binding.key 必须等于对象 key，当前为 ${binding.key}`);
        }
    }
    return toolKeys;
}

/**
 * 校验主 run 的执行工具子集必须落在 profile tools 内。
 */
function assertProfileToolKeys(profileKey: string, rootToolKeys: readonly string[], toolKeys: readonly string[] | undefined): void {
    if (!toolKeys) {
        return;
    }
    const allowed = new Set(rootToolKeys);
    for (const toolKey of toolKeys) {
        if (!allowed.has(toolKey)) {
            throw new Error(`profile ${profileKey} toolKeys 必须是 tools 子集：${toolKey}`);
        }
    }
}
