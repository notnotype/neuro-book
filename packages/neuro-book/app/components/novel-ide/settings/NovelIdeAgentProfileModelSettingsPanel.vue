<script setup lang="ts">
import type {Ref} from "vue";
import type {AgentProfileModelConfigDto} from "nbook/shared/dto/app-settings.dto";
import AgentProfileNavList, {type AgentProfileNavItem} from "nbook/app/components/novel-ide/settings/AgentProfileNavList.vue";
import AgentProfileDefaultsPanel from "nbook/app/components/novel-ide/settings/AgentProfileDefaultsPanel.vue";
import AgentProfileDetailPanel from "nbook/app/components/novel-ide/settings/AgentProfileDetailPanel.vue";
import {
    buildProfileRuntimeSettingsPatch,
    countProfileRuntimeOverrides,
    createProfileRuntimeSettingsDraft,
    parseProfileRuntimeSettingsDraft,
    resolveProfileRuntimeInheritance,
    type ProfileRuntimeSettingsDraft,
    type ProfileRuntimeSettingsErrors,
    type ProfileRuntimeSettingsSources,
} from "nbook/app/components/novel-ide/settings/profile-runtime-settings";
import {
    buildCompleteModelConfig,
    buildGlobalProfileConfigMap,
    buildModelPatch,
    buildProfileConfig,
    buildProfileConfigMap,
    buildSettingsPatch,
    cloneModelDraft,
    cloneSettingsDraft,
    countModelOverrides,
    mergeModelConfig,
    type AgentProfileConfigDraft,
    type AgentProfileDraft,
    type AgentProfileModelDraft,
    type AgentProfileSettingsDraft,
    type ConfigSettingsScope,
} from "nbook/app/components/novel-ide/settings/agent-profile-draft";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import {cloneLowCodeObject} from "nbook/app/components/common/low-code-form/low-code-form-utils";
import {useDialog} from "nbook/app/composables/useDialog";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {ConfigAgentProfileSettingsDto, ConfigEditorSnapshotDto, ConfigWorkspaceQueryDto, GlobalConfigDto, GlobalConfigUpdateDto, ProjectConfigDto} from "nbook/shared/dto/config.dto";

const props = withDefaults(defineProps<{
    scope?: ConfigSettingsScope;
    targetQuery?: ConfigWorkspaceQueryDto;
    targetLabel?: string;
}>(), {
    scope: "global",
    targetQuery: undefined,
    targetLabel: "",
});

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
    topK: "",
    reasoningEffort: "off",
    stream: true,
});
const profileRuntimeDefaults = ref<ProfileRuntimeSettingsDraft>(createProfileRuntimeSettingsDraft(undefined));
const profileRuntimeDefaultsEffective = ref<ConfigAgentProfileSettingsDto["profileRuntimeDefaults"] | null>(null);
const profileRuntimeDefaultsSources = ref<ProfileRuntimeSettingsSources | null>(null);
const profileRuntimeDefaultsErrors = ref<ProfileRuntimeSettingsErrors>({});
const profiles = ref([]) as Ref<AgentProfileDraft[]>;
const snapshotText = ref("");
/** 默认设置页已保存形态，用于二级导航的未保存标记 */
const defaultsSnapshot = ref("");
/** 各 profile 已保存形态，用于二级导航的未保存标记 */
const profileSnapshots = ref<Record<string, string>>({});
/** 空串表示当前停在"默认设置"页，否则是选中的 profileKey */
const activeNavKey = ref("");
const navSearch = ref("");
let buildStatusPollTimer: ReturnType<typeof setTimeout> | null = null;
const configApi = useConfigApi();
const dialog = useDialog();
const novelIdeStore = useNovelIdeStore();
const {t} = useI18n();
const editorSnapshot = ref<ConfigEditorSnapshotDto | null>(null);
const selectedDefaultProfileKey = ref("");
const isProjectScope = computed(() => props.scope === "project");
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
            profiles: buildGlobalProfileConfigMap(profiles.value, editorSnapshot.value?.global.agent?.profiles ?? {}),
            visibleModels: base.agent?.visibleModels ?? [],
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
            profiles: buildProfileConfigMap(profiles.value, props.scope),
        },
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
    if (profileModelDefaults.value.stream === null) {
        profileModelDefaults.value.stream = true;
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
    captureSnapshots();
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
    captureSnapshots();
    scheduleBuildStatusPolling();
}

/**
 * 记录当前草稿为"已保存"基线：整体用于 header 保存按钮，分片用于二级导航的未保存标记。
 */
function captureSnapshots(): void {
    snapshotText.value = JSON.stringify(isProjectScope.value ? buildProjectDirtyPayload() : buildGlobalSavePayload());
    defaultsSnapshot.value = JSON.stringify(buildDefaultsPayload());
    profileSnapshots.value = Object.fromEntries(profiles.value.map((profile) => [profile.profileKey, JSON.stringify(buildProfileConfig(profile, props.scope))]));
    if (activeNavKey.value && !profiles.value.some((profile) => profile.profileKey === activeNavKey.value)) {
        activeNavKey.value = "";
    }
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
function buildProjectSavePayload(): Record<string, AgentProfileConfigDraft> {
    return buildProfileConfigMap(profiles.value, props.scope);
}

/**
 * 默认设置页（默认 Profile + 默认模型参数 + 通用运行默认值）的保存形态。
 */
function buildDefaultsPayload(): Record<string, unknown> {
    return {
        defaultProfileKey: isProjectScope.value ? selectedDefaultProfileKey.value || null : buildGlobalDefaultProfileKey(),
        profileModelDefaults: isProjectScope.value ? buildModelPatch(profileModelDefaults.value) : buildCompleteModelConfig(profileModelDefaults.value),
        profileRuntimeDefaults: buildProfileRuntimeSettingsPatch(profileRuntimeDefaults.value),
    };
}

function buildGlobalSavePayload(): Record<string, unknown> {
    return {
        ...buildDefaultsPayload(),
        profiles: buildGlobalProfileConfigMap(profiles.value, editorSnapshot.value?.global.agent?.profiles ?? {}),
    };
}

function buildProjectDirtyPayload(): Record<string, unknown> {
    return {
        ...buildDefaultsPayload(),
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
        errorText.value = resolveApiErrorMessage(error, t("settings.panels.profileModels.saveFailed"));
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
        topK: "",
        reasoningEffort: null,
        stream: null,
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
            topK: "",
            reasoningEffort: "off",
            stream: true,
        };
    profileRuntimeDefaults.value = createProfileRuntimeSettingsDraft(undefined);
}

/** Global 层的 profile 默认模型参数，作为 Project 默认参数的继承基线。 */
const globalModelDefaults = computed<AgentProfileModelConfigDto>(() => {
    const raw = editorSnapshot.value?.global.agent?.profileModelDefaults ?? {};
    return {
        modelKey: raw.modelKey ?? null,
        temperature: raw.temperature ?? null,
        topK: raw.topK ?? null,
        reasoningEffort: raw.reasoningEffort ?? "off",
        stream: raw.stream ?? true,
    };
});

/** 当前 scope 下默认参数区的实际生效值，作为单个 profile 的继承基线。 */
const resolvedModelDefaults = computed<AgentProfileModelConfigDto>(() => {
    if (isProjectScope.value) {
        return mergeModelConfig(globalModelDefaults.value, profileModelDefaults.value);
    }
    return buildCompleteModelConfig(profileModelDefaults.value);
});

/** 单个 profile 的模型继承基线：Project scope 还要叠一层 Global profile 覆盖。 */
function resolveProfileInheritedModel(profile: AgentProfileDraft): AgentProfileModelConfigDto {
    if (isProjectScope.value) {
        return mergeModelConfig(resolvedModelDefaults.value, cloneModelDraft(editorSnapshot.value?.global.agent?.profiles?.[profile.profileKey]?.model));
    }
    return resolvedModelDefaults.value;
}

/** 该 profile 在 Profile 设置里显式覆盖的字段数（含待提交的资源变更）。 */
function countSettingsOverrides(profile: AgentProfileDraft): number {
    if (!profile.settings) {
        return 0;
    }
    return Object.keys(buildSettingsPatch(profile.settings, props.scope)).length + profile.settings.resourceMutations.length;
}

const dirty = computed(() => JSON.stringify(isProjectScope.value ? buildProjectDirtyPayload() : buildGlobalSavePayload()) !== snapshotText.value);

const defaultsDirty = computed(() => JSON.stringify(buildDefaultsPayload()) !== defaultsSnapshot.value);

const sortedProfiles = computed(() => [...profiles.value].sort((left, right) => left.profileKey.localeCompare(right.profileKey)));

/** 当前选中的 profile；空表示停在默认设置页。 */
const activeProfile = computed(() => profiles.value.find((profile) => profile.profileKey === activeNavKey.value) ?? null);

const navItems = computed<AgentProfileNavItem[]>(() => sortedProfiles.value.map((profile) => ({
    profileKey: profile.profileKey,
    name: profile.name,
    status: profile.loadStatus,
    overrideCount: countModelOverrides(profile.model) + countProfileRuntimeOverrides(profile.runtime) + countSettingsOverrides(profile),
    dirty: JSON.stringify(buildProfileConfig(profile, props.scope)) !== (profileSnapshots.value[profile.profileKey] ?? "null"),
    isDefault: profile.profileKey === effectiveDefaultProfileKey.value,
})));

/** 详情面板回传的模型草稿写回当前 profile。 */
function updateActiveModel(value: AgentProfileModelDraft): void {
    if (activeProfile.value) {
        activeProfile.value.model = value;
    }
}

/** 详情面板回传的运行策略草稿写回当前 profile。 */
function updateActiveRuntime(value: ProfileRuntimeSettingsDraft): void {
    if (activeProfile.value) {
        activeProfile.value.runtime = value;
    }
}

/** 详情面板回传的 lowcode 表单变更写回当前 profile。 */
function updateActiveSettings(patch: Partial<AgentProfileSettingsDraft>): void {
    if (!activeProfile.value?.settings) {
        return;
    }
    Object.assign(activeProfile.value.settings, patch);
}

onMounted(() => {
    void loadSettings();
});

onBeforeUnmount(() => {
    clearBuildStatusPolling();
});

watch(() => [props.scope, props.targetQuery?.workspaceKind, props.targetQuery?.projectRoot] as const, () => {
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
    <!-- xl 下面板绝对定位铺满 section 可视区（包含块 = L888 的 relative section），标题固定，双栏各自独立滚动；
         若用 h-full 百分比链，滚动容子元素的百分比高度会退化为内容高度导致约束失效。小屏（<xl）保持自然流 + 外层滚动。 -->
    <div class="space-y-4 pt-1 xl:absolute xl:inset-0 xl:flex xl:flex-col">
        <div class="flex shrink-0 flex-wrap items-center justify-between gap-4">
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

        <!-- 二级导航 + 详情双栏：xl 下两栏各自 overflow 滚动；aside 需 min-h-0 解除 grid item 自动最小尺寸，否则行高被内容撑开 -->
        <div v-else class="grid gap-5 xl:min-h-0 xl:flex-1 xl:grid-cols-[240px_minmax(0,1fr)]">
            <AgentProfileNavList
                :items="navItems"
                :active-key="activeNavKey"
                :search="navSearch"
                :defaults-dirty="defaultsDirty"
                @update:active-key="activeNavKey = $event"
                @update:search="navSearch = $event"
            />

            <div class="relative min-w-0 xl:overflow-y-auto">
                <Transition name="fade-slide" mode="out-in">
                    <!-- Transition 的直接子节点必须是元素，不能直接放子组件：子组件只要编译成 Fragment 根（模板根注释就会），out-in 的离场方拿不到 afterLeave，会永久卡在 isLeaving 只渲染空占位。包一层后子组件根是什么形状都无所谓。 -->
                    <!-- 单个 Profile 详情 -->
                    <div v-if="activeProfile" :key="activeProfile.profileKey">
                        <AgentProfileDetailPanel
                            :profile="activeProfile"
                            :inherited-model="resolveProfileInheritedModel(activeProfile)"
                            :enabled-models="enabledModels"
                            :validation-issues="validationIssues"
                            :scope="props.scope"
                            :runtime-override-count="countProfileRuntimeOverrides(activeProfile.runtime)"
                            :settings-override-count="countSettingsOverrides(activeProfile)"
                            :resetting-home="resettingHomeProfileKey === activeProfile.profileKey"
                            :reset-home-disabled="Boolean(resettingHomeProfileKey) || saving"
                            :is-default-profile="activeProfile.profileKey === effectiveDefaultProfileKey"
                            @update:model="updateActiveModel"
                            @update:runtime="updateActiveRuntime"
                            @update:settings-values="updateActiveSettings({values: $event})"
                            @update:settings-override-paths="updateActiveSettings({overridePaths: $event})"
                            @update:settings-resource-mutations="updateActiveSettings({resourceMutations: $event})"
                            @reset="resetProfile(activeProfile)"
                            @reset-home="void resetProfileHome(activeProfile)"
                        />
                    </div>

                    <!-- 默认设置页：所有 Profile 的继承基线 -->
                    <div v-else key="defaults">
                        <AgentProfileDefaultsPanel
                            :scope="props.scope"
                            :default-profile-key="selectedDefaultProfileKey"
                            :default-profile-options="defaultProfileOptions"
                            :effective-default-profile-key="effectiveDefaultProfileKey"
                            :model-defaults="profileModelDefaults"
                            :global-model-defaults="globalModelDefaults"
                            :enabled-models="enabledModels"
                            :validation-issues="validationIssues"
                            :runtime-defaults="profileRuntimeDefaults"
                            :runtime-effective="profileRuntimeDefaultsEffective"
                            :runtime-sources="profileRuntimeDefaultsSources"
                            :runtime-errors="profileRuntimeDefaultsErrors"
                            @update:default-profile-key="selectedDefaultProfileKey = $event"
                            @update:model-defaults="profileModelDefaults = $event"
                            @update:runtime-defaults="profileRuntimeDefaults = $event"
                            @reset="resetProfileDefaults"
                        />
                    </div>
                </Transition>
            </div>
        </div>
    </div>
</template>

<style scoped>
.fade-slide-enter-active,
.fade-slide-leave-active {
    transition: all 0.2s cubic-bezier(0.34, 1.15, 0.64, 1);
}
.fade-slide-enter-from {
    opacity: 0;
    transform: translateX(10px) scale(0.98);
}
.fade-slide-leave-to {
    opacity: 0;
    transform: translateX(-10px) scale(0.98);
}
</style>
