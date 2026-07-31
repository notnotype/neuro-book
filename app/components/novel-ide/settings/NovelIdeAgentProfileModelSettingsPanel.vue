<script setup lang="ts">
import type {Ref} from "vue";
import type {
    AgentProfileModelConfigDto,
    EnabledModelOptionDto,
    ThinkingLevelDto,
} from "nbook/shared/dto/app-settings.dto";
import NovelIdeModelSelect from "nbook/app/components/novel-ide/settings/NovelIdeModelSelect.vue";
import ProfileRuntimeSettingsFields from "nbook/app/components/novel-ide/settings/ProfileRuntimeSettingsFields.vue";
import AgentProfilePromptPreview from "nbook/app/components/novel-ide/settings/AgentProfilePromptPreview.vue";
import {
    buildProfileRuntimeSettingsPatch,
    createProfileRuntimeSettingsDraft,
    parseProfileRuntimeSettingsDraft,
    resolveProfileRuntimeInheritance,
    type ProfileRuntimeSettingsDraft,
    type ProfileRuntimeSettingsErrors,
    type ProfileRuntimeSettingsSources,
} from "nbook/app/components/novel-ide/settings/profile-runtime-settings";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import LowCodeForm from "nbook/app/components/common/low-code-form/LowCodeForm.vue";
import {
    cloneLowCodeObject,
    hasLowCodePath,
    lowCodeJsonEqual,
    readLowCodePath,
    setLowCodePath,
} from "nbook/app/components/common/low-code-form/low-code-form-utils";
import {useDialog} from "nbook/app/composables/useDialog";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useNotification} from "nbook/app/composables/useNotification";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {ConfigAgentProfileSettingsDto, ConfigEditorSnapshotDto, ConfigWorkspaceQueryDto, GlobalConfigDto, GlobalConfigUpdateDto, ProfileRuntimeSettingsPatchDto, ProjectConfigDto} from "nbook/shared/dto/config.dto";
import type {LowCodeFormDto, LowCodeFormIssueDto, LowCodeJsonObject, LowCodeResourceMutationDto} from "nbook/shared/dto/low-code-form.dto";

type ConfigSettingsScope = "global" | "project";

const props = withDefaults(defineProps<{
    scope?: ConfigSettingsScope;
    targetQuery?: ConfigWorkspaceQueryDto;
    targetLabel?: string;
}>(), {
    scope: "global",
    targetQuery: undefined,
    targetLabel: "",
});

type AgentProfileDraft = {
    profileKey: string;
    name: string;
    canResetHome: boolean;
    model: AgentProfileModelDraft;
    loadStatus: ConfigAgentProfileSettingsDto["agentProfiles"][number]["loadStatus"];
    hasSettingsForm: boolean;
    runtime: ProfileRuntimeSettingsDraft;
    runtimeEffective: ConfigAgentProfileSettingsDto["agentProfiles"][number]["runtime"]["effective"];
    runtimeSources: ProfileRuntimeSettingsSources;
    runtimeErrors: ProfileRuntimeSettingsErrors;
    issue: ConfigAgentProfileSettingsDto["agentProfiles"][number]["issue"];
    sourcePath: string | null;
    buildState: ConfigAgentProfileSettingsDto["agentProfiles"][number]["buildState"];
    settings: AgentProfileSettingsDraft | null;
};

type AgentProfileModelDraft = {
    modelKey: string | null;
    temperature: string;
    reasoningEffort: ThinkingLevelDto | null;
    realtimeOutput: boolean | null;
};

type AgentProfileSettingsDraft = {
    form: LowCodeFormDto;
    values: LowCodeJsonObject;
    inheritedValue: LowCodeJsonObject;
    issues: LowCodeFormIssueDto[];
    overridePaths: string[];
    resourceMutations: LowCodeResourceMutationDto[];
};

type AgentProfileConfigDraft = {
    model: Partial<AgentProfileModelConfigDto>;
    settings?: LowCodeJsonObject;
    resourceMutations?: LowCodeResourceMutationDto[];
    runtime?: ProfileRuntimeSettingsPatchDto;
};

const loading = ref(false);
const saving = ref(false);
const errorText = ref("");
const successText = ref("");
const resettingHomeProfileKey = ref("");
const enabledModels = ref<ConfigAgentProfileSettingsDto["enabledModels"]>([]);
const validationIssues = ref<ConfigAgentProfileSettingsDto["validationIssues"]>([]);
const profileModelDefaults = ref<AgentProfileModelDraft>({
    modelKey: null,
    temperature: "",
    reasoningEffort: "off",
    realtimeOutput: true,
});
const profileRuntimeDefaults = ref<ProfileRuntimeSettingsDraft>(createProfileRuntimeSettingsDraft(undefined));
const profileRuntimeDefaultsEffective = ref<ConfigAgentProfileSettingsDto["profileRuntimeDefaults"] | null>(null);
const profileRuntimeDefaultsSources = ref<ProfileRuntimeSettingsSources | null>(null);
const profileRuntimeDefaultsErrors = ref<ProfileRuntimeSettingsErrors>({});
const profiles = ref([]) as Ref<AgentProfileDraft[]>;
const defaultsExpanded = ref(false);
const expandedProfileSettings = ref<Set<string>>(new Set());
const expandedProfileRuntime = ref<Set<string>>(new Set());
const snapshotText = ref("");
let buildStatusPollTimer: ReturnType<typeof setTimeout> | null = null;
const configApi = useConfigApi();
const dialog = useDialog();
const notification = useNotification();
const novelIdeStore = useNovelIdeStore();
const {t} = useI18n();
const editorSnapshot = ref<ConfigEditorSnapshotDto | null>(null);
const selectedDefaultProfileKey = ref("");
const isProjectScope = computed(() => props.scope === "project");
const previewProjectPath = computed(() => isProjectScope.value ? props.targetQuery?.projectPath : undefined);
const globalDefaultProfileSlot = computed<"novel" | "userAssets">(() => novelIdeStore.workspaceKind === "user-assets" ? "userAssets" : "novel");
const systemDefaultProfileKey = computed(() => {
    if (isProjectScope.value) {
        return editorSnapshot.value?.defaultProfileSettings.systemDefaultProfileKey ?? "leader.default";
    }
    return globalDefaultProfileSlot.value === "userAssets" ? "leader.assets" : "leader.default";
});
const inheritedDefaultProfileKey = computed(() => {
    if (!isProjectScope.value) {
        return systemDefaultProfileKey.value;
    }
    return editorSnapshot.value?.defaultProfileSettings.globalDefaultProfileKey ?? systemDefaultProfileKey.value;
});
const effectiveDefaultProfileKey = computed(() => selectedDefaultProfileKey.value || inheritedDefaultProfileKey.value);
const reasoningEffortBaseOptions = computed<SelectOption[]>(() => [
    {value: "off", label: t("settings.panels.profileModels.off")},
    {value: "minimal", label: t("settings.panels.profileModels.minimal")},
    {value: "low", label: t("settings.panels.profileModels.low")},
    {value: "medium", label: t("settings.panels.profileModels.medium")},
    {value: "high", label: t("settings.panels.profileModels.high")},
    {value: "xhigh", label: t("settings.panels.profileModels.xhigh")},
    {value: "max", label: t("settings.panels.profileModels.max")},
]);
const defaultProfileOptions = computed<SelectOption[]>(() => {
    const options = profiles.value.map((profile) => ({
        value: profile.profileKey,
        label: profile.profileKey,
        description: profile.name,
        indicatorClass: profile.loadStatus === "loaded" ? "bg-[var(--status-success)]" : "bg-[var(--status-danger)]",
    })) ?? [];
    return [
        {
            value: "",
            label: t("settings.panels.defaultProfile.followDefault", {profile: inheritedDefaultProfileKey.value}),
            description: t("settings.panels.defaultProfile.followDefaultDescription"),
            indicatorClass: "bg-[var(--text-muted)]",
        },
        ...options,
    ];
});

/**
 * 当前 Profile 的 lowcode 表单是否可以直接编辑。
 */
function canEditProfileSettings(profile: AgentProfileDraft): boolean {
    return profile.loadStatus === "loaded" && Boolean(profile.settings);
}

/**
 * 判断指定 profile 的自定义 settings 表单是否展开。
 */
function isProfileSettingsExpanded(profileKey: string): boolean {
    return expandedProfileSettings.value.has(profileKey);
}

/**
 * 切换指定 profile 的自定义 settings 表单展开状态。
 */
function toggleProfileSettings(profileKey: string): void {
    const next = new Set(expandedProfileSettings.value);
    if (next.has(profileKey)) {
        next.delete(profileKey);
    } else {
        next.add(profileKey);
    }
    expandedProfileSettings.value = next;
}

/**
 * 将数字配置转成表单文本。
 */
function stringifyNullableNumber(value: number | null): string {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/**
 * 将表单文本解析为可空数字。
 */
function parseNullableNumber(value: string | number | null | undefined, integerOnly = false): number | null {
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

function thinkingLevelLabel(level: ThinkingLevelDto): string {
    switch (level) {
        case "off": return t("settings.panels.profileModels.off");
        case "minimal": return t("settings.panels.profileModels.minimal");
        case "low": return t("settings.panels.profileModels.low");
        case "medium": return t("settings.panels.profileModels.medium");
        case "high": return t("settings.panels.profileModels.high");
        case "xhigh": return t("settings.panels.profileModels.xhigh");
        case "max": return t("settings.panels.profileModels.max");
    }
}

function realtimeOutputLabel(value: boolean): string {
    return value ? t("settings.panels.profileModels.enabled") : t("settings.panels.profileModels.disabled");
}

function realtimeOutputSelectValue(value: boolean | null): string {
    if (value === null) {
        return "inherit";
    }
    return value ? "true" : "false";
}

function parseRealtimeOutputSelectValue(value: string): boolean | null {
    if (value === "inherit") {
        return null;
    }
    return value === "true";
}

function reasoningEffortDefaultLabel(profile: AgentProfileDraft): string {
    return t("settings.panels.profileModels.defaultValue", {value: thinkingLevelLabel(resolveProfileInheritedModel(profile).reasoningEffort ?? "off")});
}

function realtimeOutputDefaultLabel(profile: AgentProfileDraft): string {
    return t("settings.panels.profileModels.defaultValue", {value: realtimeOutputLabel(resolveProfileInheritedModel(profile).realtimeOutput ?? true)});
}

function reasoningEffortOptionsForProfile(profile: AgentProfileDraft): SelectOption[] {
    return [{value: "inherit", label: reasoningEffortDefaultLabel(profile)}, ...reasoningEffortBaseOptions.value];
}

function realtimeOutputOptionsForProfile(profile: AgentProfileDraft): SelectOption[] {
    return [
        {value: "inherit", label: realtimeOutputDefaultLabel(profile)},
        {value: "true", label: t("settings.panels.profileModels.enabled")},
        {value: "false", label: t("settings.panels.profileModels.disabled")},
    ];
}

function setDefaultReasoningEffort(value: string): void {
    profileModelDefaults.value.reasoningEffort = value === "inherit" ? null : value as ThinkingLevelDto;
}

function setProfileReasoningEffort(profile: AgentProfileDraft, value: string): void {
    profile.model.reasoningEffort = value === "inherit" ? null : value as ThinkingLevelDto;
}

function setDefaultRealtimeOutput(value: string): void {
    profileModelDefaults.value.realtimeOutput = parseRealtimeOutputSelectValue(value);
}

/** 切换单 Profile 运行策略；默认保持折叠。 */
function toggleProfileRuntime(profileKey: string): void {
    const next = new Set(expandedProfileRuntime.value);
    if (next.has(profileKey)) {
        next.delete(profileKey);
    } else {
        next.add(profileKey);
    }
    expandedProfileRuntime.value = next;
}

function setProfileRealtimeOutput(profile: AgentProfileDraft, value: string): void {
    profile.model.realtimeOutput = parseRealtimeOutputSelectValue(value);
}

/**
 * 克隆模型草稿。
 */
function cloneModelDraft(model: Partial<AgentProfileModelConfigDto> | undefined): AgentProfileModelDraft {
    return {
        modelKey: model?.modelKey ?? null,
        temperature: stringifyNullableNumber(model?.temperature ?? null),
        reasoningEffort: model?.reasoningEffort ?? null,
        realtimeOutput: typeof model?.realtimeOutput === "boolean" ? model.realtimeOutput : null,
    };
}

/**
 * 克隆 profile settings 草稿。Global 编辑完整值；Project 只编辑显式覆盖 patch。
 */
function cloneSettingsDraft(
    settings: ConfigAgentProfileSettingsDto["agentProfiles"][number]["settings"],
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
            ? settingsPaths(settings.form).filter((path) => hasLowCodePath(patch, path))
            : [],
        resourceMutations: [],
    };
}

/** 返回可保存的表单字段路径，包含不直接渲染的预设存储字段。 */
function settingsPaths(form: LowCodeFormDto): string[] {
    return [
        ...form.fields.map((field) => field.path),
        ...(form.presets ? [form.presets.storagePath, form.presets.activePath] : []),
    ];
}

/**
 * 构造 settings 保存值。Global 只保存与 profile defaults 不同的字段，Project 只保存显式覆盖字段。
 */
function buildSettingsPatch(settings: AgentProfileSettingsDraft | null): LowCodeJsonObject {
    if (!settings) {
        return {};
    }
    if (isProjectScope.value) {
        return Object.fromEntries(settingsPaths(settings.form).filter((path) => settings.overridePaths.includes(path)).map((path) => {
            const value = readLowCodePath(settings.values, path);
            if (value !== undefined) {
                return [path, value] as const;
            }
            const field = settings.form.fields.find((item) => item.path === path);
            const defaultValue = hasLowCodePath(settings.form.defaults, path)
                ? readLowCodePath(settings.form.defaults, path)
                : field?.defaultValue ?? null;
            return [path, defaultValue] as const;
        })) as LowCodeJsonObject;
    }
    return Object.fromEntries(settingsPaths(settings.form).flatMap((path) => {
        const value = readLowCodePath(settings.values, path);
        const field = settings.form.fields.find((item) => item.path === path);
        const defaultValue = hasLowCodePath(settings.form.defaults, path)
            ? readLowCodePath(settings.form.defaults, path)
            : field?.defaultValue;
        if (value === undefined || lowCodeJsonEqual(value, defaultValue)) {
            return [];
        }
        return [[path, value] as const];
    })) as LowCodeJsonObject;
}

/** 构造真实 prepare 草稿预览使用的完整有效 settings。 */
function buildPreviewSettings(profile: AgentProfileDraft): LowCodeJsonObject {
    const settings = profile.settings;
    if (!settings) return {};
    if (!isProjectScope.value) return cloneLowCodeObject(settings.values);
    let effective = cloneLowCodeObject(settings.inheritedValue);
    for (const path of settings.overridePaths) {
        const value = readLowCodePath(settings.values, path);
        if (value !== undefined) effective = setLowCodePath(effective, path, value);
    }
    return effective;
}

/**
 * 判断 JSON object 是否为空。
 */
function isEmptyObject(value: object): boolean {
    return Object.keys(value).length === 0;
}

/**
 * 构造单个 profile 的保存配置，同时保留 model 与 settings。
 */
function buildProfileConfig(profile: AgentProfileDraft): AgentProfileConfigDraft | null {
    const modelPatch = isProjectScope.value ? buildProjectModelPatch(profile.model) : buildModelPatch(profile.model);
    const settingsPatch = buildSettingsPatch(profile.settings);
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
function buildProfileConfigMap(): Record<string, AgentProfileConfigDraft> {
    const result: Record<string, AgentProfileConfigDraft> = {};
    for (const profile of profiles.value) {
        const config = buildProfileConfig(profile);
        if (config) {
            result[profile.profileKey] = config;
        }
    }
    return result;
}

/**
 * 构造 Global profile 配置，未知 profile 保留，当前可见 profile 按草稿整体替换。
 */
function buildGlobalProfileConfigMap(): Record<string, AgentProfileConfigDraft> {
    const baseProfiles = editorSnapshot.value?.global.agent?.profiles ?? {};
    const visibleProfileKeys = new Set(profiles.value.map((profile) => profile.profileKey));
    const result: Record<string, AgentProfileConfigDraft> = Object.fromEntries(
        Object.entries(baseProfiles)
            .filter(([profileKey]) => !visibleProfileKeys.has(profileKey))
            .map(([profileKey, config]) => [profileKey, {
                model: config.model ?? {},
                ...(config.settings !== undefined ? {settings: cloneLowCodeObject(config.settings)} : {}),
                ...(config.runtime !== undefined ? {runtime: config.runtime} : {}),
            } satisfies AgentProfileConfigDraft]),
    );
    for (const profile of profiles.value) {
        const config = buildProfileConfig(profile);
        if (config) {
            result[profile.profileKey] = config;
        }
    }
    return result;
}

/**
 * 构造 Global 默认 Profile 写回形态，保留另一个 workspace slot。
 */
function buildGlobalDefaultProfileKey(): NonNullable<NonNullable<GlobalConfigDto["agent"]>["defaultProfileKey"]> {
    const base = editorSnapshot.value?.global ?? {};
    const defaultProfileKey: NonNullable<NonNullable<GlobalConfigDto["agent"]>["defaultProfileKey"]> = {
        novel: base.agent?.defaultProfileKey?.novel ?? null,
        userAssets: base.agent?.defaultProfileKey?.userAssets ?? null,
    };
    return {
        novel: defaultProfileKey.novel ?? null,
        userAssets: defaultProfileKey.userAssets ?? null,
        [globalDefaultProfileSlot.value]: selectedDefaultProfileKey.value || null,
    };
}

/**
 * 构造 Global Config 写回体，统一替换 agent 默认 Profile、模型默认值和 profile 覆盖。
 */
function buildGlobalConfigPayload(): GlobalConfigUpdateDto {
    const base = editorSnapshot.value?.global ?? {};
    return {
        agent: {
            ...(base.agent ?? {}),
            defaultProfileKey: buildGlobalDefaultProfileKey(),
            profileModelDefaults: buildCompleteModelConfig(profileModelDefaults.value),
            profileRuntimeDefaults: buildProfileRuntimeSettingsPatch(profileRuntimeDefaults.value),
            profiles: buildGlobalProfileConfigMap(),
        },
    };
}

/**
 * 构造 Project Config 写回体，统一替换 agent 默认 Profile、模型默认值和 profile 覆盖。
 */
function buildProjectConfigPayload(): ProjectConfigDto {
    return {
        agent: {
            defaultProfileKey: selectedDefaultProfileKey.value || null,
            profileModelDefaults: buildModelPatch(profileModelDefaults.value),
            profileRuntimeDefaults: buildProfileRuntimeSettingsPatch(profileRuntimeDefaults.value),
            profiles: buildProfileConfigMap(),
        },
    };
}

/**
 * Project 覆盖只写用户显式填写的字段，空字段回落 Global。
 */
function buildProjectModelPatch(model: AgentProfileModelDraft): Partial<AgentProfileModelConfigDto> {
    return buildModelPatch(model);
}

function buildModelPatch(model: AgentProfileModelDraft): Partial<AgentProfileModelConfigDto> {
    const temperature = parseNullableNumber(model.temperature);
    return {
        ...(model.modelKey ? {modelKey: model.modelKey} : {}),
        ...(temperature !== null ? {temperature} : {}),
        ...(model.reasoningEffort !== null ? {reasoningEffort: model.reasoningEffort} : {}),
        ...(model.realtimeOutput !== null ? {realtimeOutput: model.realtimeOutput} : {}),
    };
}

function buildCompleteModelConfig(model: AgentProfileModelDraft): AgentProfileModelConfigDto {
    return {
        modelKey: model.modelKey,
        temperature: parseNullableNumber(model.temperature),
        reasoningEffort: model.reasoningEffort ?? "off",
        realtimeOutput: model.realtimeOutput ?? true,
    };
}

/**
 * 将接口响应应用到本地。
 */
function applySettings(settings: ConfigAgentProfileSettingsDto): void {
    selectedDefaultProfileKey.value = editorSnapshot.value?.global.agent?.defaultProfileKey?.[globalDefaultProfileSlot.value] ?? "";
    enabledModels.value = settings.enabledModels;
    validationIssues.value = settings.validationIssues;
    profileModelDefaults.value = cloneModelDraft(settings.profileModelDefaults);
    if (profileModelDefaults.value.reasoningEffort === null) {
        profileModelDefaults.value.reasoningEffort = "off";
    }
    if (profileModelDefaults.value.realtimeOutput === null) {
        profileModelDefaults.value.realtimeOutput = true;
    }
    profileRuntimeDefaults.value = createProfileRuntimeSettingsDraft(editorSnapshot.value?.global.agent?.profileRuntimeDefaults);
    const globalDefaultsInheritance = resolveProfileRuntimeInheritance(settings.harnessRuntimeDefaults, []);
    profileRuntimeDefaultsEffective.value = globalDefaultsInheritance.settings;
    profileRuntimeDefaultsSources.value = globalDefaultsInheritance.sources;
    profileRuntimeDefaultsErrors.value = {};
    profiles.value = settings.agentProfiles.map((profile) => {
        const inheritance = resolveProfileRuntimeInheritance(settings.harnessRuntimeDefaults, [
            {source: "profileDefault", patch: profile.runtime.profileDefaults},
            {source: "globalDefault", patch: profile.runtime.globalDefaultsPatch},
        ]);
        return ({
        profileKey: profile.profileKey,
        name: profile.name,
        canResetHome: profile.canResetHome,
        model: cloneModelDraft(editorSnapshot.value?.global.agent?.profiles?.[profile.profileKey]?.model),
        loadStatus: profile.loadStatus,
        hasSettingsForm: profile.hasSettingsForm,
        runtime: createProfileRuntimeSettingsDraft(editorSnapshot.value?.global.agent?.profiles?.[profile.profileKey]?.runtime),
        runtimeEffective: inheritance.settings,
        runtimeSources: inheritance.sources,
        runtimeErrors: {},
        issue: profile.issue,
        sourcePath: profile.sourcePath,
        buildState: profile.buildState,
        settings: cloneSettingsDraft(profile.settings, "global"),
        });
    });
    snapshotText.value = JSON.stringify(buildGlobalSavePayload());
    scheduleBuildStatusPolling();
}

/**
 * 将 Project Config 中的 profile 覆盖应用到本地草稿。
 */
function applyProjectSettings(settings: ConfigAgentProfileSettingsDto): void {
    selectedDefaultProfileKey.value = editorSnapshot.value?.defaultProfileSettings.projectDefaultProfileKey ?? "";
    enabledModels.value = settings.enabledModels;
    validationIssues.value = settings.validationIssues;
    profileModelDefaults.value = cloneModelDraft(editorSnapshot.value?.project?.agent?.profileModelDefaults);
    profileRuntimeDefaults.value = createProfileRuntimeSettingsDraft(editorSnapshot.value?.project?.agent?.profileRuntimeDefaults);
    const projectDefaultsInheritance = resolveProfileRuntimeInheritance(settings.harnessRuntimeDefaults, [
        {source: "globalDefault", patch: settings.globalRuntimeDefaultsPatch},
    ]);
    profileRuntimeDefaultsEffective.value = projectDefaultsInheritance.settings;
    profileRuntimeDefaultsSources.value = projectDefaultsInheritance.sources;
    profileRuntimeDefaultsErrors.value = {};
    profiles.value = settings.agentProfiles.map((profile) => {
        const override = editorSnapshot.value?.project?.agent?.profiles?.[profile.profileKey]?.model;
        const inheritance = resolveProfileRuntimeInheritance(settings.harnessRuntimeDefaults, [
            {source: "profileDefault", patch: profile.runtime.profileDefaults},
            {source: "globalDefault", patch: profile.runtime.globalDefaultsPatch},
            {source: "globalProfile", patch: profile.runtime.globalProfilePatch},
            {source: "projectDefault", patch: profile.runtime.projectDefaultsPatch},
        ]);
        return {
            profileKey: profile.profileKey,
            name: profile.name,
            canResetHome: profile.canResetHome,
            model: cloneModelDraft(override),
            loadStatus: profile.loadStatus,
            hasSettingsForm: profile.hasSettingsForm,
            runtime: createProfileRuntimeSettingsDraft(editorSnapshot.value?.project?.agent?.profiles?.[profile.profileKey]?.runtime),
            runtimeEffective: inheritance.settings,
            runtimeSources: inheritance.sources,
            runtimeErrors: {},
            issue: profile.issue,
            sourcePath: profile.sourcePath,
            buildState: profile.buildState,
            settings: cloneSettingsDraft(profile.settings, "project"),
        };
    });
    snapshotText.value = JSON.stringify(buildProjectDirtyPayload());
    scheduleBuildStatusPolling();
}

function clearBuildStatusPolling(): void {
    if (!buildStatusPollTimer) {
        return;
    }
    clearTimeout(buildStatusPollTimer);
    buildStatusPollTimer = null;
}

function shouldPollBuildStatus(): boolean {
    return profiles.value.some((profile) => profile.loadStatus === "compiling" || profile.buildState.running || profile.buildState.queued);
}

function scheduleBuildStatusPolling(): void {
    clearBuildStatusPolling();
    if (!shouldPollBuildStatus()) {
        return;
    }
    buildStatusPollTimer = setTimeout(() => {
        void refreshBuildStatus();
    }, 1200);
}

/**
 * 轮询 profile 编译状态；从 compiling/running 回到 loaded/failed 时重取 settings。
 */
async function refreshBuildStatus(): Promise<void> {
    try {
        const previousRunning = shouldPollBuildStatus();
        const status = await configApi.agentProfileBuildStatus();
        const byKey = new Map(status.profiles.map((profile) => [profile.profileKey, profile]));
        for (const profile of profiles.value) {
            const next = byKey.get(profile.profileKey);
            if (!next) {
                continue;
            }
            profile.loadStatus = next.loadStatus;
            profile.issue = next.issue;
            profile.buildState = next.buildState;
        }
        if (previousRunning && !shouldPollBuildStatus()) {
            await loadSettings();
            return;
        }
    } catch {
        // 状态轮询只是 UI 增量刷新，失败时保持当前 settings 表单，不打断用户编辑。
    } finally {
        scheduleBuildStatusPolling();
    }
}

/**
 * 读取 Project 覆盖保存形态，用于脏检查。
 */
function buildProjectSavePayload(): Record<string, {model: Partial<AgentProfileModelConfigDto>; settings?: LowCodeJsonObject}> {
    return buildProfileConfigMap();
}

function buildGlobalSavePayload(): Record<string, unknown> {
    return {
        defaultProfileKey: buildGlobalDefaultProfileKey(),
        profileModelDefaults: buildCompleteModelConfig(profileModelDefaults.value),
        profileRuntimeDefaults: buildProfileRuntimeSettingsPatch(profileRuntimeDefaults.value),
        profiles: buildGlobalProfileConfigMap(),
    };
}

function buildProjectDirtyPayload(): Record<string, unknown> {
    return {
        defaultProfileKey: selectedDefaultProfileKey.value || null,
        profileModelDefaults: buildModelPatch(profileModelDefaults.value),
        profileRuntimeDefaults: buildProfileRuntimeSettingsPatch(profileRuntimeDefaults.value),
        profiles: buildProjectSavePayload(),
    };
}

/** 校验所有 runtime 草稿，并将字段问题写回对应编辑区。 */
function validateRuntimeDrafts(): boolean {
    const defaults = parseProfileRuntimeSettingsDraft(profileRuntimeDefaults.value);
    profileRuntimeDefaultsErrors.value = defaults.errors;
    let valid = Object.keys(defaults.errors).length === 0;
    for (const profile of profiles.value) {
        const result = parseProfileRuntimeSettingsDraft(profile.runtime);
        profile.runtimeErrors = result.errors;
        valid = valid && Object.keys(result.errors).length === 0;
    }
    return valid;
}

/**
 * 读取 Agent Profile 模型设定。
 */
async function loadSettings(): Promise<void> {
    loading.value = true;
    errorText.value = "";
    successText.value = "";

    try {
        const [snapshot, settings] = await Promise.all([
            configApi.editorSnapshot(props.targetQuery),
            configApi.agentProfileSettings(props.targetQuery, isProjectScope.value ? "project" : "global"),
        ]);
        editorSnapshot.value = snapshot;
        if (isProjectScope.value) {
            applyProjectSettings(settings);
        } else {
            applySettings(settings);
        }
    } catch (error) {
        errorText.value = resolveApiErrorMessage(error, t("settings.panels.profileModels.loadFailed"));
    } finally {
        loading.value = false;
    }
}

/**
 * 重新读取已保存的 Agent Profile 模型设定，放弃当前草稿。
 */
async function restoreSettings(): Promise<void> {
    await loadSettings();
}

/**
 * 保存 Agent Profile 模型设定。
 */
async function saveSettings(): Promise<void> {
    if (!dirty.value || saving.value) {
        return;
    }
    if (!validateRuntimeDrafts()) {
        errorText.value = t("settings.panels.profileModels.runtime.validationFailed");
        return;
    }

    saving.value = true;
    errorText.value = "";
    successText.value = "";

    try {
        const snapshot = isProjectScope.value
            ? await configApi.saveProject(buildProjectConfigPayload(), props.targetQuery)
            : await configApi.saveGlobal(buildGlobalConfigPayload(), props.targetQuery);
        const settings = await configApi.agentProfileSettings(props.targetQuery, isProjectScope.value ? "project" : "global");
        editorSnapshot.value = snapshot;
        if (isProjectScope.value) {
            applyProjectSettings(settings);
            successText.value = t("settings.panels.profileModels.projectSaveSuccess");
        } else {
            applySettings(settings);
            successText.value = t("settings.panels.profileModels.globalSaveSuccess");
        }
    } catch (error) {
        const message = resolveApiErrorMessage(error, t("settings.panels.profileModels.saveFailed"));
        errorText.value = message;
        notification.error(message, {title: t("settings.panels.profileModels.saveFailed")});
    } finally {
        saving.value = false;
    }
}

/**
 * 重置 Project profile home。该操作会清空并按 profile 当前版本重建资源文件。
 */
async function resetProfileHome(profile: AgentProfileDraft): Promise<void> {
    if (!isProjectScope.value || resettingHomeProfileKey.value || saving.value) {
        return;
    }
    const confirmed = await dialog.confirm(
        t("settings.panels.profileModels.resetHomeConfirm", {profile: profile.profileKey}),
        t("settings.panels.profileModels.resetHomeTitle"),
    );
    if (!confirmed) {
        return;
    }
    resettingHomeProfileKey.value = profile.profileKey;
    errorText.value = "";
    successText.value = "";
    try {
        const snapshot = await configApi.resetProfileHome(profile.profileKey, props.targetQuery);
        const settings = await configApi.agentProfileSettings(props.targetQuery, "project");
        editorSnapshot.value = snapshot;
        applyProjectSettings(settings);
        successText.value = t("settings.panels.profileModels.resetHomeSuccess", {profile: profile.profileKey});
    } catch (error) {
        errorText.value = resolveApiErrorMessage(error, t("settings.panels.profileModels.resetHomeFailed"));
    } finally {
        resettingHomeProfileKey.value = "";
    }
}

/**
 * 重置单个 profile 到默认配置。
 */
function resetProfile(profile: AgentProfileDraft): void {
    profile.model = {
        modelKey: null,
        temperature: "",
        reasoningEffort: null,
        realtimeOutput: null,
    };
    profile.runtime = createProfileRuntimeSettingsDraft(undefined);
    if (profile.settings) {
        profile.settings.values = isProjectScope.value
            ? {}
            : cloneLowCodeObject(profile.settings.form.defaults);
        profile.settings.overridePaths = [];
        profile.settings.resourceMutations = [];
    }
}

function resetProfileDefaults(): void {
    profileModelDefaults.value = isProjectScope.value
        ? cloneModelDraft(undefined)
        : {
            modelKey: null,
            temperature: "",
            reasoningEffort: "off",
            realtimeOutput: true,
        };
    profileRuntimeDefaults.value = createProfileRuntimeSettingsDraft(undefined);
}

function globalProfileModelDefaults(): AgentProfileModelConfigDto {
    const raw = editorSnapshot.value?.global.agent?.profileModelDefaults ?? {};
    return {
        modelKey: raw.modelKey ?? null,
        temperature: raw.temperature ?? null,
        reasoningEffort: raw.reasoningEffort ?? "off",
        realtimeOutput: raw.realtimeOutput ?? true,
    };
}

function mergeModelConfig(base: AgentProfileModelConfigDto, patch: AgentProfileModelDraft): AgentProfileModelConfigDto {
    return {
        modelKey: patch.modelKey ?? base.modelKey,
        temperature: parseNullableNumber(patch.temperature) ?? base.temperature,
        reasoningEffort: patch.reasoningEffort ?? base.reasoningEffort ?? "off",
        realtimeOutput: patch.realtimeOutput ?? base.realtimeOutput ?? true,
    };
}

function resolvedProfileModelDefaults(): AgentProfileModelConfigDto {
    if (isProjectScope.value) {
        return mergeModelConfig(globalProfileModelDefaults(), profileModelDefaults.value);
    }
    return buildCompleteModelConfig(profileModelDefaults.value);
}

function resolveProfileInheritedModel(profile: AgentProfileDraft): AgentProfileModelConfigDto {
    if (isProjectScope.value) {
        return mergeModelConfig(resolvedProfileModelDefaults(), cloneModelDraft(editorSnapshot.value?.global.agent?.profiles?.[profile.profileKey]?.model));
    }
    return resolvedProfileModelDefaults();
}

function modelDefaultLabel(profile: AgentProfileDraft): string {
    const defaultKey = resolveProfileInheritedModel(profile).modelKey;
    return defaultKey ? t("settings.panels.profileModels.defaultValue", {value: defaultKey}) : t("settings.panels.profileModels.defaultGlobalModel");
}

function defaultModelSelectLabel(): string {
    if (!isProjectScope.value) {
        return t("settings.panels.profileModels.followGlobalDefaultModel");
    }
    const inherited = globalProfileModelDefaults().modelKey;
    return inherited ? t("settings.panels.profileModels.inheritGlobal", {value: inherited}) : t("settings.panels.profileModels.inheritGlobalDefaultModel");
}

/** 为历史无效 modelKey 合成只在当前字段显示的不可运行选项。 */
function modelOptions(modelKey: string | null): EnabledModelOptionDto[] {
    const normalized = modelKey?.trim() ?? "";
    if (!normalized || enabledModels.value.some((model) => model.key === normalized)) {
        return enabledModels.value;
    }
    const separatorIndex = normalized.indexOf("/");
    const providerId = separatorIndex > 0 ? normalized.slice(0, separatorIndex) : "invalid";
    const modelId = separatorIndex > 0 ? normalized.slice(separatorIndex + 1) : normalized;
    return [{
        key: normalized,
        label: t("settings.panels.profileModels.unrunnableModel", {key: normalized}),
        providerId,
        modelId: modelId || "invalid",
        contextWindowTokens: null,
    }, ...enabledModels.value];
}

/** 返回当前历史模型引用对应的字段级问题。 */
function modelIssues(modelKey: string | null): ConfigAgentProfileSettingsDto["validationIssues"] {
    const normalized = modelKey?.trim() ?? "";
    return normalized ? validationIssues.value.filter((issue) => issue.modelKey === normalized) : [];
}

function defaultReasoningOptions(): SelectOption[] {
    if (!isProjectScope.value) {
        return reasoningEffortBaseOptions.value;
    }
    return [{value: "inherit", label: t("settings.panels.profileModels.inheritGlobal", {value: thinkingLevelLabel(globalProfileModelDefaults().reasoningEffort ?? "off")})}, ...reasoningEffortBaseOptions.value];
}

function defaultRealtimeOutputOptions(): SelectOption[] {
    if (!isProjectScope.value) {
        return [
            {value: "true", label: t("settings.panels.profileModels.enabled")},
            {value: "false", label: t("settings.panels.profileModels.disabled")},
        ];
    }
    return [
        {value: "inherit", label: t("settings.panels.profileModels.inheritGlobal", {value: realtimeOutputLabel(globalProfileModelDefaults().realtimeOutput ?? true)})},
        {value: "true", label: t("settings.panels.profileModels.enabled")},
        {value: "false", label: t("settings.panels.profileModels.disabled")},
    ];
}

const dirty = computed(() => JSON.stringify(isProjectScope.value ? buildProjectDirtyPayload() : buildGlobalSavePayload()) !== snapshotText.value);

const sortedProfiles = computed(() => [...profiles.value].sort((left, right) => left.profileKey.localeCompare(right.profileKey)));

onMounted(() => {
    void loadSettings();
});

onBeforeUnmount(() => {
    clearBuildStatusPolling();
});

watch(() => [props.scope, props.targetQuery?.workspaceKind, props.targetQuery?.projectPath] as const, () => {
    void loadSettings();
});

defineExpose({
    dirty,
    loading,
    saving,
    saveSettings,
    restoreSettings,
});
</script>

<template>
    <!-- Agent Profile 模型设置 -->
    <div class="space-y-4 pt-1">
        <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="max-w-xl">
                <h3 class="text-base font-semibold text-[var(--text-main)]">{{ isProjectScope ? t("settings.panels.profileModels.projectTitle") : t("settings.panels.profileModels.globalTitle") }}</h3>
                <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? t("settings.panels.profileModels.projectDescription", {target: props.targetLabel || t("settings.panels.profileModels.currentProject")}) : t("settings.panels.profileModels.globalDescription") }}</p>
            </div>
        </div>

        <TransitionGroup
            tag="div"
            enter-active-class="transition-all duration-300 ease-out"
            enter-from-class="opacity-0 -translate-y-2 scale-[0.98]"
            enter-to-class="opacity-100 translate-y-0 scale-100"
            leave-active-class="absolute w-full transition-all duration-200 ease-in"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0 scale-[0.98]"
            class="relative flex flex-col gap-2"
        >
            <div v-if="errorText" key="error" class="flex items-start gap-3 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-4 py-3 shadow-sm backdrop-blur-md">
                <span class="i-lucide-alert-circle mt-0.5 h-4 w-4 shrink-0 text-[var(--status-danger)]"></span>
                <div class="text-sm text-[var(--status-danger)]">{{ errorText }}</div>
            </div>
            <div v-if="successText" key="success" class="flex items-start gap-3 rounded-xl border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-4 py-3 shadow-sm backdrop-blur-md">
                <span class="i-lucide-check-circle-2 mt-0.5 h-4 w-4 shrink-0 text-[var(--status-success)]"></span>
                <div class="text-sm text-[var(--status-success)]">{{ successText }}</div>
            </div>
        </TransitionGroup>

        <div v-if="loading" class="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm">
            <span class="i-lucide-loader-2 h-8 w-8 animate-spin text-[var(--text-muted)]"></span>
            <span class="text-sm text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.loading") }}</span>
        </div>

        <div v-else class="space-y-5">
            <!-- 默认 Agent Profile 设置 -->
            <section class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm">
                <div class="mb-4 border-b border-[var(--border-color)] pb-4">
                    <h4 class="text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.defaultProfile.title") }}</h4>
                    <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? t("settings.panels.defaultProfile.projectDescription") : t("settings.panels.defaultProfile.globalDescription") }}</p>
                </div>

                <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)]">
                    <div class="space-y-1.5">
                        <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.defaultProfile.title") }}</label>
                        <FormSelect v-model="selectedDefaultProfileKey" :options="defaultProfileOptions" :placeholder="t('settings.panels.defaultProfile.selectPlaceholder')" />
                    </div>
                    <div class="space-y-1.5">
                        <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.defaultProfile.currentEffective") }}</label>
                        <div class="flex h-7 w-full items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/30 px-2.5 text-[12px] select-all">
                            <span class="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--status-success)]"></span>
                            <span class="truncate font-mono text-[11px] font-semibold text-[var(--text-main)]">{{ effectiveDefaultProfileKey || "-" }}</span>
                        </div>
                    </div>
                </div>
            </section>

            <section class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm">
                <div class="flex flex-wrap items-center justify-between gap-2" :class="defaultsExpanded ? 'mb-4 border-b border-[var(--border-color)] pb-4' : ''">
                    <div>
                        <h4 class="text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.defaultParameters") }}</h4>
                        <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? t("settings.panels.profileModels.projectDefaultDescription") : t("settings.panels.profileModels.globalDefaultDescription") }}</p>
                    </div>
                    <div class="flex items-center gap-2">
                        <button v-if="defaultsExpanded" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="resetProfileDefaults">
                            <span class="i-lucide-rotate-ccw h-3 w-3"></span>{{ t("settings.panels.profileModels.resetDefault") }}
                        </button>
                        <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-[11px] text-[var(--text-secondary)]" @click="defaultsExpanded = !defaultsExpanded">
                            <span :class="defaultsExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="h-3.5 w-3.5"></span>{{ defaultsExpanded ? '收起' : '展开' }}
                        </button>
                    </div>
                </div>

                <div v-if="defaultsExpanded" class="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.7fr)]">
                    <div class="space-y-1.5">
                        <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.defaultModel") }}</label>
                        <NovelIdeModelSelect
                            :model-value="profileModelDefaults.modelKey"
                            :models="modelOptions(profileModelDefaults.modelKey)"
                            allow-default
                            :default-label="defaultModelSelectLabel()"
                            :placeholder="t('settings.panels.profileModels.selectDefaultModel')"
                            @update:model-value="profileModelDefaults.modelKey = $event"
                        />
                        <p v-if="modelIssues(profileModelDefaults.modelKey).length > 0" class="text-[11px] text-[var(--status-warning)]">{{ modelIssues(profileModelDefaults.modelKey)[0]?.message }}</p>
                    </div>
                    <div class="space-y-1.5">
                        <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.temperature") }}</label>
                        <FormInput v-model="profileModelDefaults.temperature" type="number" step="0.1" min="0" :placeholder="isProjectScope ? t('settings.panels.profileModels.inheritGlobalPlaceholder') : t('settings.panels.profileModels.emptyPlaceholder')" />
                    </div>
                    <div class="space-y-1.5">
                        <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.reasoningEffort") }}</label>
                        <FormSelect :model-value="profileModelDefaults.reasoningEffort ?? 'inherit'" :options="defaultReasoningOptions()" @update:model-value="setDefaultReasoningEffort" />
                    </div>
                    <div class="space-y-1.5">
                        <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.stream") }}</label>
                        <FormSelect :model-value="realtimeOutputSelectValue(profileModelDefaults.realtimeOutput)" :options="defaultRealtimeOutputOptions()" @update:model-value="setDefaultRealtimeOutput" />
                    </div>
                </div>
                <div v-if="defaultsExpanded && profileRuntimeDefaultsEffective && profileRuntimeDefaultsSources" class="mt-5 border-t border-[var(--border-color)] pt-5">
                    <h5 class="mb-3 text-xs font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.runtime.defaultsTitle") }}</h5>
                    <ProfileRuntimeSettingsFields v-model="profileRuntimeDefaults" :inherited="profileRuntimeDefaultsEffective" :sources="profileRuntimeDefaultsSources" :errors="profileRuntimeDefaultsErrors" />
                </div>
            </section>

            <section class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm">
                <div class="mb-4 border-b border-[var(--border-color)] pb-4">
                    <h4 class="text-sm font-semibold text-[var(--text-main)]">Agent Profiles</h4>
                    <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? t("settings.panels.profileModels.projectProfilesDescription") : t("settings.panels.profileModels.globalProfilesDescription") }}</p>
                </div>

                <div class="grid gap-3">
                    <div v-for="profile in sortedProfiles" :key="profile.profileKey" class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]/25 p-4">
                        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <div class="text-sm font-medium text-[var(--text-main)]">{{ profile.name }}</div>
                                <div class="mt-1 text-[11px] text-[var(--text-muted)]">{{ profile.profileKey }}</div>
                            </div>
                            <div class="flex flex-wrap items-center gap-2">
                                <button v-if="isProjectScope && profile.canResetHome" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 text-[11px] font-medium text-[var(--status-danger)] transition-colors hover:bg-[var(--status-danger-bg)] disabled:opacity-50" :disabled="Boolean(resettingHomeProfileKey) || saving" @click="void resetProfileHome(profile)">
                                    <span :class="resettingHomeProfileKey === profile.profileKey ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-rotate-ccw'" class="h-3 w-3"></span>
                                    {{ t("settings.panels.profileModels.resetHome") }}
                                </button>
                                <button class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="resetProfile(profile)">
                                    <span class="i-lucide-rotate-ccw h-3 w-3"></span>
                                    {{ t("settings.panels.profileModels.resetDefault") }}
                                </button>
                            </div>
                        </div>

                        <div class="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_auto]">
                            <!-- Profile 默认模型 -->
                            <div class="space-y-1.5">
                                <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.defaultModel") }}</label>
                                <NovelIdeModelSelect
                                    :model-value="profile.model.modelKey"
                                    :models="modelOptions(profile.model.modelKey)"
                                    allow-default
                                    :default-label="modelDefaultLabel(profile)"
                                    :placeholder="t('settings.panels.profileModels.selectDefaultModel')"
                                    @update:model-value="profile.model.modelKey = $event"
                                />
                                <p v-if="modelIssues(profile.model.modelKey).length > 0" class="text-[11px] text-[var(--status-warning)]">{{ modelIssues(profile.model.modelKey)[0]?.message }}</p>
                            </div>

                            <!-- 温度 -->
                            <div class="space-y-1.5">
                                <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.temperature") }}</label>
                                <FormInput v-model="profile.model.temperature" type="number" step="0.1" min="0" :placeholder="t('settings.panels.profileModels.defaultPlaceholder')" />
                            </div>

                            <!-- 推理强度 -->
                            <div class="space-y-1.5">
                                <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.reasoningEffort") }}</label>
                                <FormSelect :model-value="profile.model.reasoningEffort ?? 'inherit'" :options="reasoningEffortOptionsForProfile(profile)" @update:model-value="setProfileReasoningEffort(profile, $event)" />
                            </div>

                            <!-- 流式 -->
                            <div class="space-y-1.5">
                                <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.stream") }}</label>
                                <FormSelect :model-value="realtimeOutputSelectValue(profile.model.realtimeOutput)" :options="realtimeOutputOptionsForProfile(profile)" @update:model-value="setProfileRealtimeOutput(profile, $event)" />
                            </div>
                        </div>

                        <div class="mt-4 border-t border-[var(--border-color)] pt-4">
                            <button type="button" class="flex w-full items-center gap-2 text-left" @click="toggleProfileRuntime(profile.profileKey)">
                                <span class="i-lucide-gauge h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                                <h5 class="min-w-0 flex-1 text-xs font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.runtime.profileOverrideTitle") }}</h5>
                                <span :class="expandedProfileRuntime.has(profile.profileKey) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="h-4 w-4 text-[var(--text-muted)]"></span>
                            </button>
                            <div v-if="expandedProfileRuntime.has(profile.profileKey)" class="mt-3">
                                <ProfileRuntimeSettingsFields v-model="profile.runtime" :inherited="profile.runtimeEffective" :sources="profile.runtimeSources" :errors="profile.runtimeErrors" />
                            </div>
                        </div>

                        <!-- Profile 自定义低代码设置 -->
                        <div class="mt-4 border-t border-[var(--border-color)] pt-4">
                            <button
                                v-if="canEditProfileSettings(profile)"
                                type="button"
                                class="mb-3 flex w-full items-center gap-2 text-left"
                                :aria-expanded="isProfileSettingsExpanded(profile.profileKey)"
                                @click="toggleProfileSettings(profile.profileKey)"
                            >
                                <span class="i-lucide-sliders-horizontal h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"></span>
                                <span class="min-w-0 flex-1 text-xs font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.profilePresets") }}</span>
                                <span class="h-4 w-4 shrink-0 text-[var(--text-muted)]" :class="isProfileSettingsExpanded(profile.profileKey) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"></span>
                            </button>
                            <div v-if="profile.settings && canEditProfileSettings(profile) && isProfileSettingsExpanded(profile.profileKey)">
                                <LowCodeForm
                                    v-model="profile.settings.values"
                                    v-model:override-paths="profile.settings.overridePaths"
                                    v-model:resource-mutations="profile.settings.resourceMutations"
                                    :form="profile.settings.form"
                                    :issues="profile.settings.issues"
                                    :scope="isProjectScope ? 'project' : 'global'"
                                    :inheritance-mode="isProjectScope ? 'manual' : 'always-override'"
                                    :inherited-value="profile.settings.inheritedValue"
                                />
                                <div class="mt-3 flex justify-end border-t border-[var(--border-color)] pt-3">
                                    <AgentProfilePromptPreview :profile-key="profile.profileKey" :settings="buildPreviewSettings(profile)" :resource-mutations="profile.settings.resourceMutations" :project-path="previewProjectPath" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    </div>
</template>
