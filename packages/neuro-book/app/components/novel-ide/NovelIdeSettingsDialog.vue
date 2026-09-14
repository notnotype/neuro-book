<script setup lang="ts">
import {storeToRefs} from "pinia";
import {DialogWindow} from "@notnotype/nb-ui/components";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import NovelIdeSettingsView from "nbook/app/components/novel-ide/settings/sections/NovelIdeSettingsView.vue";
import type {SettingsScopeId, SettingsScopeOption, SettingsSectionOption} from "nbook/app/components/novel-ide/settings/sections/NovelIdeSettingsView.types";
import AgentProfileSettingsView from "nbook/app/components/novel-ide/settings/sections/agent-profile/AgentProfileSettingsView.vue";
import type {AgentProfileSettingsContext, AgentProfileSettingsPageDraft} from "nbook/app/components/novel-ide/settings/sections/agent-profile/AgentProfileSettingsView.types";
import {
    buildAgentProfileContext,
    buildAgentProfileGlobalPayload,
    buildAgentProfileProjectPayload,
    createAgentProfilePageDraft,
    shouldPollAgentProfileBuildStatus,
    validateAgentProfileRuntimeDrafts,
} from "nbook/app/components/novel-ide/settings/sections/agent-profile/agent-profile-page-draft";
import CostSettingsView from "nbook/app/components/novel-ide/settings/sections/cost/CostSettingsView.vue";
import {buildCostPayload, readCostCurrency} from "nbook/app/components/novel-ide/settings/sections/cost/cost-settings-draft";
import DesktopSettingsView from "nbook/app/components/novel-ide/settings/sections/desktop/DesktopSettingsView.vue";
import EditorSettingsView from "nbook/app/components/novel-ide/settings/sections/editor/EditorSettingsView.vue";
import EmbeddingSettingsView from "nbook/app/components/novel-ide/settings/sections/embedding/EmbeddingSettingsView.vue";
import {buildGlobalEmbeddingPayload, buildProjectEmbeddingPayload, createEmbeddingSettingsDraftFromConfig} from "nbook/app/components/novel-ide/settings/sections/embedding/embedding-settings-draft";
import ObservabilitySettingsView from "nbook/app/components/novel-ide/settings/sections/observability/ObservabilitySettingsView.vue";
import {buildObservabilityPayload, createObservabilityDraft} from "nbook/app/components/novel-ide/settings/sections/observability/observability-settings-draft";
import ProviderSettingsView from "nbook/app/components/novel-ide/settings/sections/providers/ProviderSettingsView.vue";
import SecuritySettingsView from "nbook/app/components/novel-ide/settings/sections/security/SecuritySettingsView.vue";
import FrontendSettingsView from "nbook/app/components/novel-ide/settings/sections/frontend/FrontendSettingsView.vue";
import WebSettingsView from "nbook/app/components/novel-ide/settings/sections/web/WebSettingsView.vue";
import {buildWebPayload, createWebSettingsDraftFromConfig} from "nbook/app/components/novel-ide/settings/sections/web/web-settings-draft";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useCostDisplay} from "nbook/app/composables/useCostDisplay";
import {useProviderSettingsBinding} from "nbook/app/composables/useProviderSettingsBinding";
import {useSectionDraft} from "nbook/app/composables/useSectionDraft";
import {useDelayedFlag, useSettingsSnapshot} from "nbook/app/composables/useSettingsSnapshot";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {cloneModelDraft} from "nbook/app/components/novel-ide/settings/sections/agent-profile/agent-profile-draft";
import {createProfileRuntimeSettingsDraft} from "nbook/app/components/novel-ide/settings/sections/agent-profile/profile-runtime-settings";
import type {AgentProfilePageSource} from "nbook/app/components/novel-ide/settings/sections/agent-profile/agent-profile-page-draft";
import {createEmbeddingSettingsDraft} from "nbook/app/components/novel-ide/settings/sections/embedding/embedding-settings-draft";
import type {CostDisplayCurrency} from "nbook/app/utils/cost-format";
import {useNotification} from "nbook/app/composables/useNotification";
import {useAuthSessionState} from "nbook/app/composables/useAuthSessionState";
import {useThemeSettings} from "nbook/app/composables/useThemeSettings";
import {useProductTheme} from "nbook/app/utils/theme/theme-session";
import {triggerBrowserDownload} from "nbook/app/utils/browser-download";
import {filterColorwayContractVars} from "nbook/app/utils/theme/colorway-vars";
import {buildColorwayFileJson, colorwayFileName} from "nbook/app/utils/theme/colorway-io";
import type {ColorwayDraft} from "nbook/app/components/novel-ide/settings/sections/frontend/FrontendSettingsView.types";
import type {MarkdownStudioViewMode} from "nbook/app/composables/useMarkdownStudioController";
import type {ConfigAgentProfileSettingsDto, ConfigEditorSnapshotDto, ConfigWorkspaceQueryDto, GlobalConfigDto, GlobalConfigUpdateDto, ProjectConfigDto, WebConfigDto} from "nbook/shared/dto/config.dto";
import {DEFAULT_DESKTOP_SETTINGS, type DesktopCloseBehavior, type DesktopSettings, type DesktopStatus} from "@notnotype/neuro-book-contracts/desktop";
import {DEFAULT_MARKDOWN_EDITOR_PREFERENCES, DEFAULT_MONACO_EDITOR_PREFERENCES, type MarkdownEditorPreferences, type MonacoEditorPreferences} from "nbook/shared/editor-workbench";

type SettingsSection = "security" | "frontend" | "editor" | "providers" | "embedding" | "cost" | "web-tools" | "agent-profile-models" | "observability" | "desktop";
type AppVersionKind = "release" | "tag" | "commit" | "package";

interface AppVersionDto {
    versionLabel: string;
    versionKind: AppVersionKind;
    githubUrl: string;
}


const props = defineProps<{
    modelValue: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();

const novelIdeStore = useNovelIdeStore();
const notification = useNotification();
const authSessionState = useAuthSessionState();
const theme = useProductTheme();
const themeSettings = useThemeSettings();
const {locale, setLocale, t} = useI18n();
const {
    selectedReasoning,
    viewMode,
    markdownEditorPreferences,
    monacoEditorPreferences,
} = storeToRefs(novelIdeStore);

const activeSection = ref<SettingsSection>("providers");
const activeScope = ref<SettingsScopeId>("global");
const appVersion = ref<AppVersionDto | null>(null);
const appVersionPending = ref(false);
const desktopSettings = ref<DesktopSettings>({...DEFAULT_DESKTOP_SETTINGS});
const desktopStatus = ref<DesktopStatus | null>(null);

const sectionItems = computed<SettingsSectionOption[]>(() => [
    {
        value: "providers",
        label: t("settings.section.providers.label"),
        description: t("settings.section.providers.description"),
        iconClass: "i-lucide-cpu",
        scopes: ["global"],
        // 两栏型：外壳不给内边距、也不再套一层滚动，服务商列表与连接设置各自滚动。
        layout: "fill",
    },
    {
        value: "embedding",
        label: "Embedding",
        description: t("settings.section.embedding.description"),
        iconClass: "i-lucide-binary",
        scopes: ["global"],
    },
    {
        value: "cost",
        label: t("settings.section.cost.label"),
        description: t("settings.section.cost.description"),
        iconClass: "i-lucide-circle-dollar-sign",
        scopes: ["global"],
    },
    {
        value: "web-tools",
        label: t("settings.section.webTools.label"),
        description: t("settings.section.webTools.description"),
        iconClass: "i-lucide-search-code",
        scopes: ["global"],
    },
    {
        value: "agent-profile-models",
        label: t("settings.section.agentProfileModels.label"),
        description: t("settings.section.agentProfileModels.description"),
        iconClass: "i-lucide-bot-message-square",
        scopes: ["global", "project"],
        // 两栏型：外壳不给内边距、也不再套一层滚动，由视图自己管左右两栏各自的滚动。
        layout: "fill",
    },
    {
        value: "observability",
        label: t("settings.section.observability.label"),
        description: t("settings.section.observability.description"),
        iconClass: "i-lucide-activity",
        scopes: ["global"],
    },
    {
        value: "security",
        label: t("settings.section.security.label"),
        description: t("settings.section.security.description"),
        iconClass: "i-lucide-shield-check",
        scopes: ["boot"],
    },
    {
        value: "frontend",
        label: t("settings.section.frontend.label"),
        description: t("settings.section.frontend.description"),
        iconClass: "i-lucide-monitor-cog",
        scopes: ["browser"],
    },
    {
        value: "editor",
        label: t("settings.section.editor.label"),
        description: t("settings.section.editor.description"),
        iconClass: "i-lucide-type",
        scopes: ["browser"],
    },
    {
        value: "desktop",
        label: t("settings.section.desktop.label"),
        description: t("settings.section.desktop.description"),
        iconClass: "i-lucide-panels-top-left",
        scopes: ["browser"],
    },
]);

const scopeOptions = computed<SettingsScopeOption[]>(() => [
    {
        value: "boot",
        label: t("settings.scope.boot.shortLabel"),
        description: t("settings.scope.boot.description"),
    },
    {
        value: "global",
        label: t("settings.scope.global.shortLabel"),
        description: t("settings.scope.global.description"),
    },
    {
        value: "project",
        label: t("settings.scope.project.shortLabel"),
        description: t("settings.scope.project.description"),
        disabledReason: projectScopeAvailable.value ? undefined : t("settings.scope.project.unavailable"),
    },
    {
        value: "browser",
        label: t("settings.scope.browser.shortLabel"),
        description: t("settings.scope.browser.description"),
    },
]);

const desktopBridge = computed(() => import.meta.client ? window.neuroBookDesktop : undefined);
const desktopAvailable = computed(() => Boolean(desktopBridge.value));
const projectScopeAvailable = computed(() => novelIdeStore.workspaceKind !== "user-assets"
    && Boolean(novelIdeStore.currentProjectRoot));

const bootAuthEnabled = computed(() => authSessionState.session.value?.authEnabled ?? null);



const targetQuery = computed(() => activeScope.value === "project" && novelIdeStore.currentProjectRoot
    ? {workspaceKind: "novel" as const, projectRoot: novelIdeStore.currentProjectRoot}
    : {workspaceKind: "user-assets" as const});
const settingsPanelKey = computed(() => `${activeScope.value}:${targetQuery.value.workspaceKind}:${targetQuery.value.projectRoot ?? "global"}`);
const targetLabel = computed(() => activeScope.value === "project"
    ? novelIdeStore.currentNovel?.title || novelIdeStore.currentProjectRoot || "Project Workspace"
    : activeScope.value === "boot" ? "config.yaml" : "Workspace Root");

const configApi = useConfigApi();
const costDisplay = useCostDisplay();
const costRefreshing = ref(false);
const desktopSaving = ref(false);
const desktopSaveError = ref("");

/**
 * 写回上下文：这份草稿是按哪个配置目标、以及当时未编辑的基准段构建的。
 *
 * 基准段必须一起捕获：写回体 = 基准段 + 本区段的字段，若基准段在写回时另取实时快照，
 * 切了作用域就会「基准不同 → 写回体与基线不等 → 被判成脏」并把没改过的配置写回去。
 */
type SectionWriteContext = {scope: SettingsScopeId; query: ConfigWorkspaceQueryDto};
const writeContext = (): SectionWriteContext => ({scope: activeScope.value, query: targetQuery.value});
const notifySaveFailed = (message: string): void => {
    notification.error(message);
};

/** 只有全局/项目两个作用域需要配置快照；启动与浏览器区段读的是运行时状态。 */
const snapshotEnabled = computed(() => props.modelValue && (activeScope.value === "global" || activeScope.value === "project"));
const settingsSnapshot = useSettingsSnapshot({
    enabled: () => snapshotEnabled.value,
    targetQuery: () => targetQuery.value,
    fallbackErrorMessage: t("settings.feedback.loadFailed"),
});

/** Web 工具只有全局段。 */
const webDraft = useSectionDraft({
    source: () => settingsSnapshot.snapshot.value?.global.web ?? null,
    create: (source) => createWebSettingsDraftFromConfig(source as WebConfigDto | undefined),
    toPayload: (draft) => ({web: buildWebPayload(draft)}),
    captureContext: writeContext,
    write: (payload, context) => configApi.saveGlobal(payload, context.query),
    notifyError: notifySaveFailed,
    fallbackErrorMessage: t("settings.feedback.saveFailed"),
});

/** 向量嵌入：global 与 project 共用一份草稿，写回段由草稿构建时捕获的作用域决定。 */
const embeddingDraft = useSectionDraft({
    source: () => settingsSnapshot.snapshot.value,
    create: (source) => source ? createEmbeddingSettingsDraftFromConfig(source as ConfigEditorSnapshotDto) : createEmbeddingSettingsDraft(),
    toPayload: (draft, context) => context.scope === "project"
        ? {embedding: buildProjectEmbeddingPayload(draft.project)}
        : {embedding: buildGlobalEmbeddingPayload(draft.global)},
    captureContext: writeContext,
    write: (payload, context) => context.scope === "project"
        ? configApi.saveProject(payload as ProjectConfigDto, context.query)
        : configApi.saveGlobal(payload as GlobalConfigUpdateDto, context.query),
    notifyError: notifySaveFailed,
    fallbackErrorMessage: t("settings.feedback.saveFailed"),
});

/** 费用显示：币种进配置，汇率留在本机会话。 */
const costDraft = useSectionDraft({
    source: () => settingsSnapshot.snapshot.value?.global.ui ?? null,
    create: (source) => readCostCurrency(source as GlobalConfigDto["ui"]),
    toPayload: (currency, context) => buildCostPayload(context.baseUi, currency),
    captureContext: () => ({...writeContext(), baseUi: settingsSnapshot.snapshot.value?.global.ui}),
    write: (payload, context) => configApi.saveGlobal(payload, context.query),
    notifyError: notifySaveFailed,
    fallbackErrorMessage: t("settings.feedback.saveFailed"),
});

/** 快照里的币种（含写回回声）同步到本机展示状态。 */
watch(() => readCostCurrency(settingsSnapshot.snapshot.value?.global.ui), (currency) => {
    costDisplay.setCostCurrency(currency);
    if (currency === "CNY") {
        void costDisplay.ensureExchangeRate(configApi.exchangeRate);
    }
}, {immediate: true});

const observabilityDraft = useSectionDraft({
    source: () => settingsSnapshot.snapshot.value?.global ?? null,
    create: (source) => createObservabilityDraft(source as GlobalConfigDto | undefined),
    toPayload: (draft, context) => buildObservabilityPayload(context.baseGlobal, draft),
    captureContext: () => ({...writeContext(), baseGlobal: settingsSnapshot.snapshot.value?.global}),
    write: (payload, context) => configApi.saveGlobal(payload, context.query),
    notifyError: notifySaveFailed,
    fallbackErrorMessage: t("settings.feedback.saveFailed"),
});

/** Agent Profile 的草稿依赖两个来源：配置快照 + Profile meta（另一个端点）。 */
const agentProfileMeta = shallowRef<ConfigAgentProfileSettingsDto | null>(null);
/** meta 是按哪个配置目标取的。目标一换就等新数据，不能让上一个目标的表单先渲染一帧。 */
const agentProfileMetaKey = ref("");
const agentProfileMetaLoading = ref(false);
const agentProfileLoadError = ref("");
const agentProfileActive = computed(() => activeSection.value === "agent-profile-models");
const agentProfileOptions = computed(() => ({
    workspaceSlot: novelIdeStore.workspaceKind === "user-assets" ? "userAssets" as const : "novel" as const,
}));

/** 页面草稿的来源：快照 + Profile meta 都到位才有值。 */
function agentProfileSourceValue(): AgentProfilePageSource | null {
    const snapshot = settingsSnapshot.snapshot.value;
    const settings = agentProfileMeta.value;
    if (!snapshot || !settings) {
        return null;
    }
    // 逐字段取，不把整份快照带进类型推断。
    // \`ConfigEditorSnapshotDto\` 与 \`GlobalConfigDto\` 的推断类型深度超过 TS 的实例化上限
    // （同样的值直接当参数传不会炸，一旦有显式目标类型就会），所以在装配点做一次显式断言；
    // 字段本身的类型检查都在 agent-profile-page-draft.ts 里。
    return {
        snapshot: {
            global: snapshot.global,
            project: snapshot.project,
            defaultProfileSettings: snapshot.defaultProfileSettings,
        },
        settings,
        scope: activeScope.value === "project" ? "project" : "global",
    } as unknown as AgentProfilePageSource;
}

const emptyAgentProfileDraft = (): AgentProfileSettingsPageDraft => ({
    defaultProfileKey: "",
    modelDefaults: cloneModelDraft(undefined),
    runtimeDefaults: createProfileRuntimeSettingsDraft(undefined),
    profiles: [],
});

/** 当前配置目标的标识：meta 与它不一致就说明数据还没跟上。 */
const agentProfileMetaTargetKey = (): string => `${activeScope.value === "project" ? "project" : "global"}:${JSON.stringify(targetQuery.value)}`;

async function loadAgentProfileMeta(): Promise<void> {
    const requestKey = agentProfileMetaTargetKey();
    agentProfileMetaLoading.value = true;
    agentProfileLoadError.value = "";
    try {
        const loaded = await configApi.agentProfileSettings(targetQuery.value, activeScope.value === "project" ? "project" : "global");
        agentProfileMeta.value = loaded;
        agentProfileMetaKey.value = requestKey;
    } catch (error) {
        agentProfileLoadError.value = resolveApiErrorMessage(error, t("settings.panels.profileModels.loadFailed"));
        notification.error(agentProfileLoadError.value);
    } finally {
        agentProfileMetaLoading.value = false;
    }
}

/** Profile meta 只在这个区段真的被打开时才取：没进过的区段不发请求，打开后换目标才重取。 */
watch(
    [agentProfileActive, snapshotEnabled, () => JSON.stringify(targetQuery.value)],
    ([active, enabled]) => {
        if (active && enabled) {
            void loadAgentProfileMeta();
        }
    },
    {immediate: true},
);

const agentProfileDraft = useSectionDraft({
    source: () => agentProfileSourceValue(),
    create: (source) => source ? createAgentProfilePageDraft(source as AgentProfilePageSource, agentProfileOptions.value) : emptyAgentProfileDraft(),
    toPayload: (draft, context) => {
        if (context.scope === "project") {
            return buildAgentProfileProjectPayload(draft);
        }
        // meta 还没到时没有 Global 写回体可言：返回空体，与基线相等，因此不会被写出去。
        return context.source ? buildAgentProfileGlobalPayload(context.source, draft, agentProfileOptions.value) : {};
    },
    captureContext: () => ({...writeContext(), source: agentProfileSourceValue()}),
    write: async (payload, context) => {
        const validation = validateAgentProfileRuntimeDrafts(agentProfileDraft.draft.value);
        if (!validation.ok) {
            throw new Error(t("settings.panels.profileModels.runtime.validationFailed"));
        }
        if (context.scope === "project") {
            await configApi.saveProject(payload as ProjectConfigDto, context.query);
        } else {
            await configApi.saveGlobal(payload as GlobalConfigDto, context.query);
        }
        await loadAgentProfileMeta();
    },
    notifyError: notifySaveFailed,
    fallbackErrorMessage: t("settings.feedback.saveFailed"),
});

const agentProfileReady = computed(() => agentProfileSourceValue() !== null
    && agentProfileMetaKey.value === agentProfileMetaTargetKey()
    && !agentProfileMetaLoading.value);

/** 视图需要完整上下文；来源未就绪时返回 null，由宿主渲染加载/失败占位。 */
function agentProfileContext(): AgentProfileSettingsContext | null {
    const source = agentProfileSourceValue();
    if (!source) {
        return null;
    }
    return buildAgentProfileContext(source, {...agentProfileOptions.value, descriptions: {}});
}

/** 编译中的 profile 需要轮询编译状态；状态落定后由快照重取带回最新结果。 */
let buildStatusTimer: ReturnType<typeof setTimeout> | null = null;
async function pollAgentProfileBuildStatus(): Promise<void> {
    buildStatusTimer = null;
    if (!shouldPollAgentProfileBuildStatus(agentProfileDraft.draft.value)) {
        return;
    }
    try {
        const status = await configApi.agentProfileBuildStatus();
        const byKey = new Map(status.profiles.map((profile) => [profile.profileKey, profile]));
        for (const profile of agentProfileDraft.draft.value.profiles) {
            const next = byKey.get(profile.profileKey);
            if (!next) {
                continue;
            }
            profile.loadStatus = next.loadStatus;
            profile.issue = next.issue;
            profile.buildState = next.buildState;
        }
    } catch {
        // 状态轮询只是增量刷新，失败时保持当前表单，不打断编辑。
    }
    buildStatusTimer = setTimeout(() => void pollAgentProfileBuildStatus(), 1200);
}
watch([agentProfileActive, agentProfileDraft.draft], ([active, draft]) => {
    if (buildStatusTimer !== null) {
        return;
    }
    if (!active || !shouldPollAgentProfileBuildStatus(draft)) {
        return;
    }
    buildStatusTimer = setTimeout(() => void pollAgentProfileBuildStatus(), 1200);
}, {deep: true});

/** 有没有区段正在写盘（含 Provider 会话）。 */
const anySectionSaving = computed(() => webDraft.saving.value || embeddingDraft.saving.value || costDraft.saving.value
    || observabilityDraft.saving.value || agentProfileDraft.saving.value || providerBinding.saving.value);

/** 把各区段未落盘的改动一次写完；不阻塞调用方（上下文已随草稿捕获）。 */
function flushSectionDrafts(): Promise<unknown> {
    return Promise.all([
        webDraft.flush(),
        embeddingDraft.flush(),
        costDraft.flush(),
        observabilityDraft.flush(),
        agentProfileDraft.flush(),
        providerBinding.flushSave(),
    ]);
}

/** 编辑器区段的重置按块分发（视图只发目标名）。 */
function resetEditorSettings(target: "markdown" | "monaco"): void {
    if (target === "markdown") {
        resetEditorPreferences();
        return;
    }
    resetMonacoPreferences();
}

/** 费用显示的汇率刷新：只在用户点击时访问后端。 */
async function refreshCostExchangeRate(): Promise<void> {
    if (costRefreshing.value) {
        return;
    }
    costRefreshing.value = true;
    try {
        costDisplay.setExchangeRate(await configApi.exchangeRate());
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.cost.refreshFailed")));
    } finally {
        costRefreshing.value = false;
    }
}

/** 币种改动：先落本机会话状态，再交给草稿的防抖写回。 */
function setCostCurrency(currency: CostDisplayCurrency): void {
    costDraft.draft.value = currency;
    costDisplay.setCostCurrency(currency);
    if (currency === "CNY") {
        void costDisplay.ensureExchangeRate(configApi.exchangeRate);
    }
}

/** 设置窗口的尺寸是本机偏好：与配置无关，落在 localStorage（读不到就用默认值）。 */
const SETTINGS_WINDOW_SIZE_KEY = "nbook.settingsDialog.size";
type SettingsWindowSize = {width: number; height: number};
const DEFAULT_SETTINGS_WINDOW_SIZE: SettingsWindowSize = {width: 1120, height: 640};
const MIN_SETTINGS_WINDOW_SIZE: SettingsWindowSize = {width: 720, height: 420};

function readStoredSettingsWindowSize(): SettingsWindowSize {
    if (!import.meta.client) {
        return {...DEFAULT_SETTINGS_WINDOW_SIZE};
    }
    try {
        const raw = window.localStorage.getItem(SETTINGS_WINDOW_SIZE_KEY);
        if (!raw) {
            return {...DEFAULT_SETTINGS_WINDOW_SIZE};
        }
        const parsed = JSON.parse(raw) as Partial<SettingsWindowSize>;
        const width = Math.round(Number(parsed.width));
        const height = Math.round(Number(parsed.height));
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
            return {...DEFAULT_SETTINGS_WINDOW_SIZE};
        }
        return {
            width: Math.max(width, MIN_SETTINGS_WINDOW_SIZE.width),
            height: Math.max(height, MIN_SETTINGS_WINDOW_SIZE.height),
        };
    } catch {
        return {...DEFAULT_SETTINGS_WINDOW_SIZE};
    }
}

function persistSettingsWindowSize(size: SettingsWindowSize): void {
    if (!import.meta.client) {
        return;
    }
    try {
        window.localStorage.setItem(SETTINGS_WINDOW_SIZE_KEY, JSON.stringify(size));
    } catch {
        // 本机存储不可用时静默放弃：窗口尺寸只是偏好，不影响任何功能。
    }
}

const settingsWindowSize = ref<SettingsWindowSize>(readStoredSettingsWindowSize());

function updateSettingsWindowWidth(width: number): void {
    settingsWindowSize.value = {...settingsWindowSize.value, width};
    persistSettingsWindowSize(settingsWindowSize.value);
}

function updateSettingsWindowHeight(height: number): void {
    settingsWindowSize.value = {...settingsWindowSize.value, height};
    persistSettingsWindowSize(settingsWindowSize.value);
}

const providerBinding = useProviderSettingsBinding({
    scope: () => activeScope.value === "project" ? "project" : "global",
    targetQuery: () => targetQuery.value,
    targetLabel: () => targetLabel.value,
    enabled: () => activeSection.value === "providers",
});

/**
 * 当前区段有没有数据可渲染。重区段自带一次取数（Provider 会话 / Agent Profile 元数据），
 * 这些取数折进外壳的同一块加载占位——一个区段在任何时刻只会有一个加载呈现。
 */
const activeSectionReady = computed(() => {
    if (activeSection.value === "providers") {
        // 重新读取期间也不算就绪：避免上一轮的数据先渲染一帧再被替换。
        return providerBinding.loaded.value && !providerBinding.loading.value;
    }
    if (activeSection.value === "agent-profile-models") {
        return agentProfileReady.value && !agentProfileMetaLoading.value;
    }
    return true;
});
/** 任一来源在读：交互统一按它禁用（视图不再各自维护 loading）。 */
const settingsLoading = computed(() => settingsSnapshot.loading.value || !activeSectionReady.value);
/** 加载占位只在读得慢时出现；呈现由外壳的共享状态组件负责。 */
const settingsLoaderVisible = useDelayedFlag(() => settingsLoading.value, 200);
/** 当前区段的失败原因：快照失败或该区段自带取数失败。 */
const settingsLoadError = computed(() => settingsSnapshot.loadError.value
    || (activeSection.value === "agent-profile-models" ? agentProfileLoadError.value : ""));

/** 重试：快照 + 当前区段自带的取数。 */
function reloadSettings(): void {
    void settingsSnapshot.reload();
    if (activeSection.value === "agent-profile-models") {
        void loadAgentProfileMeta();
    }
    if (activeSection.value === "providers") {
        void providerBinding.load();
    }
}

/** 桌面应用区段只在 Desktop Envelope 里出现。 */
const visibleSectionItems = computed<SettingsSectionOption[]>(() => sectionItems.value.filter((item) => item.value !== "desktop" || desktopAvailable.value));

const versionLabel = computed(() => {
    if (appVersionPending.value && !appVersion.value) {
        return t("settings.version.loading");
    }
    if (!appVersion.value) {
        return t("settings.version.unavailable");
    }
    if (appVersion.value.versionKind === "commit") {
        return t("settings.version.commit", {version: appVersion.value.versionLabel});
    }
    if (appVersion.value.versionKind === "release") {
        return t("settings.version.release", {version: appVersion.value.versionLabel});
    }
    return t("settings.version.generic", {version: appVersion.value.versionLabel});
});





/**
 * 保存进行中不允许切换/关闭：写回体还没出去，换目标会把结果落到错误的地方。
 */
function canLeaveCurrentPanel(): boolean {
    if (anySectionSaving.value) {
        notification.info(t("settings.feedback.saving"));
        return false;
    }
    return true;
}

/**
 * 切换配置作用域：立刻切，写回在后台完成。
 * 写回上下文随草稿一起捕获，因此晚到的写回仍落在原来那一档，不会写到新目标上。
 */
function selectScope(scope: SettingsScopeId): void {
    if (scope === activeScope.value) {
        return;
    }
    if (!canLeaveCurrentPanel()) {
        return;
    }
    if (scope === "project" && !projectScopeAvailable.value) {
        notification.info(t("settings.scope.project.unavailable"));
        activeScope.value = "global";
        return;
    }
    activeScope.value = scope;
    void flushSectionDrafts();
}

/** 选择配置分区；未落盘的改动会在防抖窗口里自己写完，不需要在切换时阻断。 */
function selectSection(section: string): void {
    if (section === activeSection.value) {
        return;
    }
    if (!canLeaveCurrentPanel()) {
        return;
    }
    activeSection.value = section as SettingsSection;
}

/**
 * 更新 Markdown 编辑器显示偏好。
 */
function updateEditorPreferences(patch: Partial<MarkdownEditorPreferences>): void {
    markdownEditorPreferences.value = {
        ...DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
        ...markdownEditorPreferences.value,
        ...patch,
    };
}

/**
 * 读取数值输入并限制到指定范围。
 */
function updateEditorNumber(key: keyof Pick<MarkdownEditorPreferences, "fontSize" | "lineHeight" | "contentWidth" | "paragraphIndentEm">, value: string, min: number, max: number): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return;
    }
    updateEditorPreferences({
        [key]: Math.min(Math.max(parsed, min), max),
    });
}

/**
 * 重置 Markdown 编辑器显示偏好。
 */
function resetEditorPreferences(): void {
    markdownEditorPreferences.value = {...DEFAULT_MARKDOWN_EDITOR_PREFERENCES};
}

/**
 * 更新 Monaco 源码编辑器显示偏好。
 */
function updateMonacoPreferences(patch: Partial<MonacoEditorPreferences>): void {
    monacoEditorPreferences.value = {
        ...DEFAULT_MONACO_EDITOR_PREFERENCES,
        ...monacoEditorPreferences.value,
        ...patch,
    };
}

/**
 * 读取 Monaco 数值输入并限制到指定范围。
 */
function updateMonacoNumber(key: keyof Pick<MonacoEditorPreferences, "fontSize" | "lineHeight" | "tabSize">, value: string, min: number, max: number): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return;
    }
    updateMonacoPreferences({
        [key]: Math.min(Math.max(parsed, min), max),
    });
}

/**
 * 重置 Monaco 源码编辑器显示偏好。
 */
function resetMonacoPreferences(): void {
    monacoEditorPreferences.value = {...DEFAULT_MONACO_EDITOR_PREFERENCES};
}

/**
 * 关闭设定弹窗。
 */
function closeDialog(): void {
    if (!canLeaveCurrentPanel()) {
        return;
    }
    emit("update:modelValue", false);
}

/**
 * 处理界面语言选择。
 */
function updateLocale(value: string): void {
    if (value === "zh-CN" || value === "en-US") {
        void setLocale(value);
    }
}

/** 处理推理强度选择（本地 UI 偏好，进 store）。 */
function updateReasoning(value: string): void {
    selectedReasoning.value = value as typeof selectedReasoning.value;
}

/**
 * 处理默认视图模式选择。
 */
function updateViewMode(value: string): void {
    if (value === "rich" || value === "source") {
        viewMode.value = value as MarkdownStudioViewMode;
    }
}

/**
 * 保存 / 覆盖一套用户配色（含从主题自带配色另存为一份）。
 *
 * 视图已经拦掉了取值不合法的草稿，这里返回 null 只剩两种情况：名称空、或一套合法变量都没有。
 * 两者都属于「没东西可存」，给一条提示比静默失败好。
 */
async function saveColorwayDraft(draft: ColorwayDraft): Promise<void> {
    const savedId = await themeSettings.saveUserColorway({
        id: draft.id,
        label: draft.label,
        appearance: draft.appearance,
        vars: draft.vars,
    });
    if (savedId === null) {
        notification.warning(t("settings.frontend.colorwaySaveEmptyMessage"), {title: t("settings.frontend.themeSaveFailed")});
    }
}

/**
 * 导出当前生效配色为 JSON 文件。
 *
 * 导出的是**当前这一套**（用户配色给存下来的取值，主题自带配色给契约内的全量取值），
 * 不导出整库：一次导出多套会把「哪一套是我刚调好的」这件事丢掉，而导入方也只能一次收一套。
 */
function exportActiveColorway(): void {
    const label = theme.colorwayLabel.value || t("settings.frontend.customColorwayLabel");
    const activeUserColorway = theme.userColorways.value.find((colorway) => colorway.id === theme.colorwayId.value);
    const vars = activeUserColorway === undefined
        ? filterColorwayContractVars(theme.colorwayVars.value)
        : {...activeUserColorway.vars};
    const json = buildColorwayFileJson({label, appearance: theme.appearance.value, vars});
    triggerBrowserDownload(new Blob([json], {type: "application/json"}), colorwayFileName(label));
}

/**
 * 读取设置页底部展示的应用版本信息。
 */
async function loadAppVersion(): Promise<void> {
    if (appVersion.value || appVersionPending.value) {
        return;
    }
    appVersionPending.value = true;
    try {
        appVersion.value = await $fetch<AppVersionDto>("/api/app/version");
    } catch {
        appVersion.value = null;
    } finally {
        appVersionPending.value = false;
    }
}

watch(() => props.modelValue, (open) => {
    if (!open) {
        return;
    }
    void loadAppVersion();
    if (desktopBridge.value) {
        void loadDesktopSettings();
    }
}, {immediate: true});

watch([
    () => novelIdeStore.workspaceKind,
    () => novelIdeStore.currentProjectRoot,
], ([workspaceKind, currentProjectRoot]) => {
    if ((workspaceKind === "user-assets" || !currentProjectRoot) && activeScope.value === "project") {
        activeScope.value = "global";
        activeSection.value = "providers";
    }
}, {immediate: true});


/** 读取 Desktop Envelope 的设备设置；B/S 页面不会执行。 */
async function loadDesktopSettings(): Promise<void> {
    const bridge = desktopBridge.value;
    if (!bridge) return;
    try {
        const [settings, status] = await Promise.all([bridge.settings(), bridge.status()]);
        desktopSettings.value = settings;
        desktopStatus.value = status;
    } catch {
        desktopStatus.value = null;
    }
}

/** 通过 Desktop Bridge 更新设备设置，不触碰 Product State Root。 */
/** 通过 Desktop Bridge 更新设备设置，不触碰 Product State Root。 */
async function updateDesktopSettings(patch: Partial<Pick<DesktopSettings, "zoomFactor" | "trayEnabled" | "closeBehavior">>): Promise<void> {
    const bridge = desktopBridge.value;
    if (!bridge) return;
    desktopSaving.value = true;
    desktopSaveError.value = "";
    try {
        desktopSettings.value = await bridge.updateSettings(patch);
    } catch (error) {
        desktopSaveError.value = resolveApiErrorMessage(error, t("settings.desktop.updateFailed"));
        notification.error(desktopSaveError.value);
    } finally {
        desktopSaving.value = false;
    }
}



</script>

<template>
    <DialogWindow
        :model-value="props.modelValue"
        :title="t('settings.title')"
        :width="settingsWindowSize.width"
        :height="settingsWindowSize.height"
        resizable
        :min-width="720"
        :min-height="420"
        body-class="min-h-0 overflow-hidden !p-0"
        teleport-target=".novel-ide-theme"
        @request-close="closeDialog"
        @update:width="updateSettingsWindowWidth"
        @update:height="updateSettingsWindowHeight"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <NovelIdeSettingsView
            :model-value="activeSection"
            :scope="activeScope"
            :scopes="scopeOptions"
            :sections="visibleSectionItems"
            :version-label="versionLabel"
            :github-url="appVersion?.githubUrl ?? ''"
            :loading="settingsLoaderVisible"
            :load-error="settingsLoadError"
            @update:model-value="selectSection"
            @update:scope="selectScope"
            @reload="reloadSettings"
        >
            <template #default="{section}">
                <div :key="`${settingsPanelKey}:${section?.value ?? ''}`" class="flex h-full min-h-0 flex-col">
                        <!-- 启动期安全配置：只读说明，安全边界不能热更新 -->
                        <SecuritySettingsView v-if="section?.value === 'security'" :auth-enabled="bootAuthEnabled" />

                        <!-- 前端设定：语言 / 主题两轴 / 用户配色 / 推理强度 / 视图模式，动作全部交回宿主 -->
                        <FrontendSettingsView
                            v-else-if="section?.value === 'frontend'"
                            :locale="locale"
                            :view-mode="viewMode"
                            :reasoning="selectedReasoning"
                            :reasoning-options="novelIdeStore.reasoningOptions"
                            :theme-options="theme.themeOptions"
                            :theme-id="theme.themeId.value"
                            :appearance="theme.appearance.value"
                            :colorway-id="theme.colorwayId.value"
                            :colorway-label="theme.colorwayLabel.value"
                            :colorway-vars="theme.colorwayVars.value ?? {}"
                            :colorway-is-user="theme.colorwayIsUser.value"
                            :user-colorways="theme.userColorways.value"
                            :disabled="settingsLoading"
                            @update:locale="updateLocale"
                            @update:view-mode="updateViewMode"
                            @update:reasoning="updateReasoning"
                            @select-theme="(id) => void themeSettings.saveAxes({themeId: id})"
                            @select-appearance="(appearance) => void themeSettings.saveAxes({appearance})"
                            @select-colorway="(id) => void themeSettings.saveColorway(id)"
                            @save-colorway="(draft) => void saveColorwayDraft(draft)"
                            @delete-colorway="(id) => void themeSettings.deleteUserColorway(id)"
                            @export-colorway="exportActiveColorway"
                        />

                        <!-- 编辑器显示偏好：走 store + localStorage，不写配置文件 -->
                        <EditorSettingsView
                            v-else-if="section?.value === 'editor'"
                            :markdown="markdownEditorPreferences"
                            :monaco="monacoEditorPreferences"
                            @update:markdown="updateEditorPreferences"
                            @update:monaco="updateMonacoPreferences"
                            @reset="resetEditorSettings"
                        />

                        <!-- Desktop Envelope 设备设置；B/S 页面不会显示该分区 -->
                        <DesktopSettingsView
                            v-else-if="section?.value === 'desktop'"
                            :settings="desktopSettings"
                            :status="desktopStatus"
                            :saving="desktopSaving"
                            :save-error="desktopSaveError"
                            @update:settings="updateDesktopSettings"
                        />

                        <!-- Provider 与模型清单：四个会话留在宿主，视图只消费绑定 -->
                        <ProviderSettingsView v-else-if="section?.value === 'providers'" v-bind="providerBinding.viewBindings.value" />

                        <!-- 向量嵌入 -->
                        <EmbeddingSettingsView
                            v-else-if="section?.value === 'embedding'"
                            :model-value="embeddingDraft.draft.value"
                            :scope="activeScope === 'project' ? 'project' : 'global'"
                            :disabled="settingsLoading"
                            @update:model-value="embeddingDraft.draft.value = $event"
                        />

                        <!-- 费用显示（币种进配置，汇率是本机会话状态） -->
                        <CostSettingsView
                            v-else-if="section?.value === 'cost'"
                            :currency="costDraft.draft.value"
                            :exchange-rate="costDisplay.usdToCnyRate.value"
                            :exchange-rate-stale="costDisplay.exchangeRateStale.value"
                            :exchange-rate-fetched-at="costDisplay.exchangeRateFetchedAt.value ?? ''"
                            :refreshing="costRefreshing"
                            :disabled="settingsLoading"
                            @update:currency="setCostCurrency"
                            @refresh-rate="refreshCostExchangeRate"
                        />

                        <!-- Web 工具 -->
                        <WebSettingsView
                            v-else-if="section?.value === 'web-tools'"
                            :model-value="webDraft.draft.value"
                            :disabled="settingsLoading"
                            @update:model-value="webDraft.draft.value = $event"
                        />

                        <!-- Agent Profile：页面草稿 + 只读上下文都由宿主组装；读取期由外壳的加载占位交代 -->
                        <AgentProfileSettingsView
                            v-else-if="section?.value === 'agent-profile-models' && agentProfileReady && agentProfileContext()"
                            :model-value="agentProfileDraft.draft.value"
                            :context="agentProfileContext()!"
                            :show-nav-heading="false"
                            @update:model-value="agentProfileDraft.draft.value = $event"
                        />

                        <!-- 可观测（Pi 请求 trace） -->
                        <ObservabilitySettingsView
                            v-else-if="section?.value === 'observability'"
                            :enabled="observabilityDraft.draft.value.enabled"
                            :max-records="observabilityDraft.draft.value.maxRecords"
                            :disabled="settingsLoading"
                            @update:enabled="observabilityDraft.draft.value.enabled = $event"
                            @update:max-records="observabilityDraft.draft.value.maxRecords = $event"
                        />

                </div>
            </template>
        </NovelIdeSettingsView>
    </DialogWindow>
</template>
