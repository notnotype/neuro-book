/**
 * Agent Profile 区段的宿主侧页面草稿。
 *
 * 视图是受控的：`AgentProfileSettingsPageDraft` 与 `AgentProfileSettingsContext` 都由宿主组装，
 * 视图只 emit 修改。这一层负责三件事——快照+meta → 页面草稿、快照+meta → 只读 context、
 * 页面草稿 → 配置写回体——全部是纯函数，宿主只做接线与错误提示。
 *
 * 旧面板 `NovelIdeAgentProfileModelSettingsPanel.vue` 的同名逻辑是本文件的语义来源；
 * 与它不同的是这里不再有「脏值快照」：自动保存下由宿主侧的草稿键与源回声守卫负责，不需要基线串。
 */
import type {AgentProfileModelConfigDto} from "nbook/shared/dto/app-settings.dto";
import type {ConfigAgentProfileSettingsDto, ConfigDefaultProfileSettingsDto, GlobalConfigDto, GlobalConfigUpdateDto, ProjectConfigDto} from "nbook/shared/dto/config.dto";
import {
    buildCompleteModelConfig,
    buildGlobalProfileConfigMap,
    buildModelPatch,
    buildProfileConfigMap,
    cloneModelDraft,
    cloneSettingsDraft,
    type ConfigSettingsScope,
} from "./agent-profile-draft";
import {
    buildProfileRuntimeSettingsPatch,
    createProfileRuntimeSettingsDraft,
    parseProfileRuntimeSettingsDraft,
    resolveProfileRuntimeInheritance,
    type ProfileRuntimeSettingsErrors,
} from "./profile-runtime-settings";
import type {AgentProfileSettingsContext, AgentProfileSettingsPageDraft} from "./AgentProfileSettingsView.types";

/** Global 段里默认 Profile 的两个 workspace 槽位。 */
export type AgentProfileWorkspaceSlot = "novel" | "userAssets";

/**
 * 页面草稿的来源。这里刻意逐字段声明，只取用到的三个段：整份 `ConfigEditorSnapshotDto`
 * 带 `effective: Record<string, JsonValue>`（递归类型），会让泛型推断踩到 TS 的实例化深度上限。
 */
export type AgentProfilePageSource = {
    snapshot: {
        global: GlobalConfigDto;
        project: ProjectConfigDto | null;
        defaultProfileSettings: ConfigDefaultProfileSettingsDto;
    };
    settings: ConfigAgentProfileSettingsDto;
    scope: ConfigSettingsScope;
};

export type AgentProfilePageOptions = {
    /** 当前 workspace 属于哪个槽位；决定 Global 默认 Profile 读写哪一个键。 */
    workspaceSlot: AgentProfileWorkspaceSlot;
};

/**
 * 系统默认 Profile：Project scope 用后端给的值（缺省 leader.default），
 * Global scope 按 workspace 槽位分别落 leader.assets / leader.default。
 */
export function resolveSystemDefaultProfileKey(source: AgentProfilePageSource, options: AgentProfilePageOptions): string {
    if (source.scope === "project") {
        return source.snapshot.defaultProfileSettings.systemDefaultProfileKey ?? "leader.default";
    }
    return options.workspaceSlot === "userAssets" ? "leader.assets" : "leader.default";
}

/**
 * 当前作用域下的继承默认 Profile：Project 先跟随 Global 段里已保存的值。
 */
export function resolveInheritedDefaultProfileKey(source: AgentProfilePageSource, options: AgentProfilePageOptions): string {
    const systemDefaultProfileKey = resolveSystemDefaultProfileKey(source, options);
    if (source.scope !== "project") {
        return systemDefaultProfileKey;
    }
    return source.snapshot.defaultProfileSettings.globalDefaultProfileKey ?? systemDefaultProfileKey;
}

/**
 * Global 层默认模型参数，作为 Project 默认参数的继承基线。
 */
export function resolveGlobalModelDefaults(snapshot: AgentProfilePageSource["snapshot"]): AgentProfileModelConfigDto {
    const raw = snapshot.global.agent?.profileModelDefaults ?? {};
    return {
        modelKey: raw.modelKey ?? null,
        temperature: raw.temperature ?? null,
        topK: raw.topK ?? null,
        reasoningEffort: raw.reasoningEffort ?? "off",
        stream: raw.stream ?? true,
    };
}

/**
 * Global 层单 Profile 模型覆盖；仅 Project scope 叠加到继承链上。
 */
export function resolveGlobalProfileModels(snapshot: AgentProfilePageSource["snapshot"]): Record<string, Partial<AgentProfileModelConfigDto>> {
    return Object.fromEntries(
        Object.entries(snapshot.global.agent?.profiles ?? {}).map(([profileKey, config]) => [profileKey, config.model ?? {}]),
    );
}

/**
 * 配置快照 + meta → 页面草稿（宿主接线的唯一起点）。
 *
 * 两条 `null → 显式值` 兜底只出现在 Global 分支：Global 段编辑的是完整值，
 * 而运行时字段的 `null` 在草稿里表示「继承」，Global 没有上层可继承。
 */
export function createAgentProfilePageDraft(source: AgentProfilePageSource, options: AgentProfilePageOptions): AgentProfileSettingsPageDraft {
    if (source.scope === "project") {
        return {
            defaultProfileKey: source.snapshot.defaultProfileSettings.projectDefaultProfileKey ?? "",
            modelDefaults: cloneModelDraft(source.snapshot.project?.agent?.profileModelDefaults),
            runtimeDefaults: createProfileRuntimeSettingsDraft(source.snapshot.project?.agent?.profileRuntimeDefaults),
            profiles: source.settings.agentProfiles.map((profile) => {
                const inheritance = resolveProfileRuntimeInheritance(source.settings.harnessRuntimeDefaults, [
                    {source: "profileDefault", patch: profile.runtime.profileDefaults},
                    {source: "globalDefault", patch: profile.runtime.globalDefaultsPatch},
                    {source: "globalProfile", patch: profile.runtime.globalProfilePatch},
                    {source: "projectDefault", patch: profile.runtime.projectDefaultsPatch},
                ]);
                return {
                    profileKey: profile.profileKey,
                    name: profile.name,
                    canResetHome: profile.canResetHome,
                    model: cloneModelDraft(source.snapshot.project?.agent?.profiles?.[profile.profileKey]?.model),
                    loadStatus: profile.loadStatus,
                    runtime: createProfileRuntimeSettingsDraft(source.snapshot.project?.agent?.profiles?.[profile.profileKey]?.runtime),
                    runtimeEffective: inheritance.settings,
                    runtimeSources: inheritance.sources,
                    runtimeErrors: {},
                    issue: profile.issue,
                    sourcePath: profile.sourcePath,
                    buildState: profile.buildState,
                    settings: cloneSettingsDraft(profile.settings, "project"),
                };
            }),
        };
    }

    const modelDefaults = cloneModelDraft(source.settings.profileModelDefaults);
    if (modelDefaults.reasoningEffort === null) {
        modelDefaults.reasoningEffort = "off";
    }
    if (modelDefaults.stream === null) {
        modelDefaults.stream = true;
    }
    return {
        defaultProfileKey: source.snapshot.global.agent?.defaultProfileKey?.[options.workspaceSlot] ?? "",
        modelDefaults,
        runtimeDefaults: createProfileRuntimeSettingsDraft(source.snapshot.global.agent?.profileRuntimeDefaults),
        profiles: source.settings.agentProfiles.map((profile) => {
            const inheritance = resolveProfileRuntimeInheritance(source.settings.harnessRuntimeDefaults, [
                {source: "profileDefault", patch: profile.runtime.profileDefaults},
                {source: "globalDefault", patch: profile.runtime.globalDefaultsPatch},
            ]);
            return {
                profileKey: profile.profileKey,
                name: profile.name,
                canResetHome: profile.canResetHome,
                model: cloneModelDraft(source.snapshot.global.agent?.profiles?.[profile.profileKey]?.model),
                loadStatus: profile.loadStatus,
                runtime: createProfileRuntimeSettingsDraft(source.snapshot.global.agent?.profiles?.[profile.profileKey]?.runtime),
                runtimeEffective: inheritance.settings,
                runtimeSources: inheritance.sources,
                runtimeErrors: {},
                issue: profile.issue,
                sourcePath: profile.sourcePath,
                buildState: profile.buildState,
                settings: cloneSettingsDraft(profile.settings, "global"),
            };
        }),
    };
}

/**
 * 组装视图需要的只读上下文；`descriptions` 由调用方给（宿主从 i18n 取，缺省不渲染说明）。
 */
export function buildAgentProfileContext(
    source: AgentProfilePageSource,
    options: AgentProfilePageOptions & {descriptions: Record<string, string>},
): AgentProfileSettingsContext {
    return {
        scope: source.scope,
        inheritedDefaultProfileKey: resolveInheritedDefaultProfileKey(source, options),
        globalModelDefaults: resolveGlobalModelDefaults(source.snapshot),
        globalProfileModels: resolveGlobalProfileModels(source.snapshot),
        settings: source.settings,
        descriptions: options.descriptions,
    };
}

/**
 * Global 写回体：替换 agent 默认 Profile、默认模型参数、默认运行策略与 profile 覆盖，
 * 但保留 `agent` 段里其它字段（如 visibleModels）与另一个 workspace 槽位的默认 Profile。
 */
export function buildAgentProfileGlobalPayload(
    source: AgentProfilePageSource,
    draft: AgentProfileSettingsPageDraft,
    options: AgentProfilePageOptions,
): GlobalConfigUpdateDto {
    const base = source.snapshot.global;
    const baseDefaultProfileKey = base.agent?.defaultProfileKey;
    const defaultProfileKey: NonNullable<NonNullable<GlobalConfigDto["agent"]>["defaultProfileKey"]> = {
        novel: baseDefaultProfileKey?.novel ?? null,
        userAssets: baseDefaultProfileKey?.userAssets ?? null,
    };
    return {
        agent: {
            ...(base.agent ?? {}),
            defaultProfileKey: {
                novel: defaultProfileKey.novel ?? null,
                userAssets: defaultProfileKey.userAssets ?? null,
                [options.workspaceSlot]: draft.defaultProfileKey || null,
            },
            profileModelDefaults: buildCompleteModelConfig(draft.modelDefaults),
            profileRuntimeDefaults: buildProfileRuntimeSettingsPatch(draft.runtimeDefaults),
            profiles: buildGlobalProfileConfigMap(draft.profiles, base.agent?.profiles ?? {}),
            visibleModels: base.agent?.visibleModels ?? [],
        },
    };
}

/**
 * Project 写回体：只写显式覆盖（defaultProfileKey / 默认参数 patch / 默认运行策略 patch / profile 覆盖）。
 */
export function buildAgentProfileProjectPayload(draft: AgentProfileSettingsPageDraft): ProjectConfigDto {
    return {
        agent: {
            defaultProfileKey: draft.defaultProfileKey || null,
            profileModelDefaults: buildModelPatch(draft.modelDefaults),
            profileRuntimeDefaults: buildProfileRuntimeSettingsPatch(draft.runtimeDefaults),
            profiles: buildProfileConfigMap(draft.profiles, "project"),
        },
    };
}

export type AgentProfileRuntimeValidation = {
    ok: boolean;
    defaultsErrors: ProfileRuntimeSettingsErrors;
    profileErrors: Record<string, ProfileRuntimeSettingsErrors>;
};

/**
 * 写回前校验全部 runtime 草稿。宿主用它阻断非法值：自动保存也会被它拦住，
 * 错误按 profile 归位到对应编辑区。
 */
export function validateAgentProfileRuntimeDrafts(draft: AgentProfileSettingsPageDraft): AgentProfileRuntimeValidation {
    const defaults = parseProfileRuntimeSettingsDraft(draft.runtimeDefaults);
    const profileErrors: Record<string, ProfileRuntimeSettingsErrors> = {};
    let ok = Object.keys(defaults.errors).length === 0;
    for (const profile of draft.profiles) {
        const result = parseProfileRuntimeSettingsDraft(profile.runtime);
        profileErrors[profile.profileKey] = result.errors;
        ok = ok && Object.keys(result.errors).length === 0;
    }
    return {ok, defaultsErrors: defaults.errors, profileErrors};
}

/**
 * 是否还有 profile 正在编译：宿主据此决定要不要继续轮询编译状态。
 */
export function shouldPollAgentProfileBuildStatus(draft: AgentProfileSettingsPageDraft): boolean {
    return draft.profiles.some((profile) => profile.loadStatus === "compiling" || profile.buildState.running || profile.buildState.queued);
}
