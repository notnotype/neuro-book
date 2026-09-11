<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {DialogWindow} from "@notnotype/nb-ui/components";
import AgentProfileSettingsView from "../../components/novel-ide/settings/sections/agent-profile/AgentProfileSettingsView.vue";
import type {AgentProfileSettingsContext, AgentProfileSettingsPageDraft} from "../../components/novel-ide/settings/sections/agent-profile/AgentProfileSettingsView.types";
import type {AgentProfileDraft} from "../../components/novel-ide/settings/sections/agent-profile/agent-profile-draft";
import {cloneModelDraft} from "../../components/novel-ide/settings/sections/agent-profile/agent-profile-draft";
import {createProfileRuntimeSettingsDraft} from "../../components/novel-ide/settings/sections/agent-profile/profile-runtime-settings";
import NovelIdeSettingsView from "../../components/novel-ide/settings/sections/NovelIdeSettingsView.vue";
import CostSettingsView from "../../components/novel-ide/settings/sections/cost/CostSettingsView.vue";
import EmbeddingSettingsView from "../../components/novel-ide/settings/sections/embedding/EmbeddingSettingsView.vue";
import {createEmbeddingSettingsDraft} from "../../components/novel-ide/settings/sections/embedding/embedding-settings-draft";
import WebSettingsView from "../../components/novel-ide/settings/sections/web/WebSettingsView.vue";
import {createWebSettingsDraft} from "../../components/novel-ide/settings/sections/web/web-settings-draft";
import ObservabilitySettingsView from "../../components/novel-ide/settings/sections/observability/ObservabilitySettingsView.vue";
import EditorSettingsView from "../../components/novel-ide/settings/sections/editor/EditorSettingsView.vue";
import DesktopSettingsView from "../../components/novel-ide/settings/sections/desktop/DesktopSettingsView.vue";
import SecuritySettingsView from "../../components/novel-ide/settings/sections/security/SecuritySettingsView.vue";
import ProviderSettingsView from "../../components/novel-ide/settings/sections/providers/ProviderSettingsView.vue";
import RolesSettingsView from "../../components/novel-ide/settings/sections/roles/RolesSettingsView.vue";
import {createRolesSettingsDraft} from "../../components/novel-ide/settings/sections/roles/roles-settings-draft";
import type {ModelSettingsDraft} from "../../components/novel-ide/settings/sections/providers/model-settings-draft";
import {DEFAULT_PI_MAX_RETRIES} from "nbook/shared/dto/pi-request-options.dto";
import {
    DISCOVERY_DIAGNOSTICS,
    DISCOVERY_MODEL_GROUPS,
    MANUAL_MODEL_DRAFT,
    MODEL_API_OPTIONS,
    MODEL_PROVIDER_TEMPLATES,
    MODEL_DEFAULT_MODEL_OPTIONS,
    buildModelSettingsDraft,
    buildSavedModelGroups,
} from "./model-settings-fixture-data";
import {
    DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
    DEFAULT_MONACO_EDITOR_PREFERENCES,
    type MarkdownEditorPreferences,
    type MonacoEditorPreferences,
} from "nbook/shared/editor-workbench";
import {
    DEFAULT_DESKTOP_SETTINGS,
    DESKTOP_BRIDGE_SCHEMA,
    type DesktopSettings,
    type DesktopSettingsPatch,
    type DesktopStatus,
} from "@notnotype/neuro-book-contracts/desktop";
import type {
    SettingsScopeId,
    SettingsScopeOption,
    SettingsSectionOption,
} from "../../components/novel-ide/settings/sections/NovelIdeSettingsView.types";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

type SceneKey = "global" | "project" | "dialog-window" | "loading" | "load-error";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["global", "project", "dialog-window", "loading", "load-error"];
    return known.find((key) => key === props.scene) ?? "global";
});

/**
 * 外壳的作用域与区段都由宿主给：全局 / 项目 / 本机 / 启动四档都能进入，
 * 每档挂的区段体见下方内容槽。
 */
const scopeOptions: SettingsScopeOption[] = [
    {value: "boot", label: "启动", description: "启动期安全配置，只读说明"},
    {value: "global", label: "全局", description: "写入全局配置文件"},
    {value: "project", label: "项目", description: "写入当前项目配置"},
    {value: "browser", label: "本机", description: "写入本机浏览器状态"},
];

const sectionOptions: SettingsSectionOption[] = [
    {
        value: "providers",
        label: "Provider",
        description: "管理 Provider 与模型清单",
        iconClass: "i-lucide-cpu",
        scopes: ["global"],
    },
    {
        value: "roles",
        label: "模型角色",
        description: "按用途把模型分配给各角色",
        iconClass: "i-lucide-shapes",
        scopes: ["global"],
    },
    {
        value: "agent-profile-models",
        label: "Agent Profile",
        description: "Profile 的模型、运行策略与专属设置",
        iconClass: "i-lucide-bot-message-square",
        scopes: ["global", "project"],
    },
    {
        value: "web-tools",
        label: "Web 工具",
        description: "搜索服务、本地抓取与兜底",
        iconClass: "i-lucide-globe",
        scopes: ["global"],
    },
    {
        value: "embedding",
        label: "向量嵌入",
        description: "向量服务与项目覆盖",
        iconClass: "i-lucide-binary",
        scopes: ["global"],
    },
    {
        value: "cost",
        label: "费用显示",
        description: "展示币种与 USD/CNY 汇率",
        iconClass: "i-lucide-circle-dollar-sign",
        scopes: ["global"],
    },
    {
        value: "observability",
        label: "可观测",
        description: "Pi 请求 trace 记录开关与保留策略",
        iconClass: "i-lucide-activity",
        scopes: ["global"],
    },
    {
        value: "security",
        label: "密码保护",
        description: "查看启动期鉴权配置和安全影响",
        iconClass: "i-lucide-shield-check",
        scopes: ["boot"],
    },
    {
        value: "editor",
        label: "编辑器",
        description: "Markdown 富文本显示偏好",
        iconClass: "i-lucide-type",
        scopes: ["browser"],
    },
    {
        value: "desktop",
        label: "桌面应用",
        description: "窗口、缩放和系统托盘行为",
        iconClass: "i-lucide-panels-top-left",
        scopes: ["browser"],
    },
];

function harnessRuntime() {
    return {
        summarizer: {
            enabled: true,
            profileKey: "summarizer.default",
            trigger: "afterInvocation" as const,
            interval: {kind: "sourceInvocation" as const, value: 20},
            maxDialogueContentTokens: 4096,
        },
        compaction: {
            enabled: true,
            trigger: {kind: "autoReserve" as const},
            reserveTokens: 16384,
            keepRecent: {kind: "percent" as const, value: 0.25},
            prompt: "请压缩以下对话内容，保留关键事实。",
            summaryPrefix: "[摘要]",
        },
        fileChangeNotice: {diffMaxChars: 2048},
    };
}

function buildSettingsMeta() {
    return {
        enabledModels: [
            {key: "openai/gpt-5.1", label: "GPT-5.1", providerId: "openai", modelId: "gpt-5.1", input: ["text" as const], contextWindowTokens: 400000},
            {key: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6", providerId: "anthropic", modelId: "claude-sonnet-4.6", input: ["text" as const], contextWindowTokens: 200000},
        ],
        validationIssues: [],
        profileModelDefaults: {modelKey: null, temperature: null, topK: null, reasoningEffort: "off" as const, stream: true},
        harnessRuntimeDefaults: harnessRuntime(),
        profileRuntimeDefaults: harnessRuntime(),
        globalRuntimeDefaultsPatch: {},
        projectRuntimeDefaultsPatch: {},
        agentProfiles: [],
    };
}

function baseProfile(profileKey: string, name: string): AgentProfileDraft {
    return {
        profileKey,
        name,
        canResetHome: true,
        model: cloneModelDraft(undefined),
        loadStatus: "loaded",
        runtime: createProfileRuntimeSettingsDraft(undefined),
        runtimeEffective: harnessRuntime(),
        runtimeSources: {
            summarizerEnabled: "harness", summarizerProfileKey: "harness", summarizerIntervalKind: "harness", summarizerIntervalValue: "harness", summarizerMaxTokens: "harness",
            compactionEnabled: "harness", compactionTriggerKind: "harness", compactionTriggerValue: "harness", compactionReserveTokens: "harness",
            compactionKeepRecentKind: "harness", compactionKeepRecentValue: "harness", compactionPrompt: "harness", compactionSummaryPrefix: "harness", fileChangeDiffMaxChars: "harness",
        },
        runtimeErrors: {},
        issue: null,
        sourcePath: `profiles/${profileKey}.profile.ts`,
        buildState: {running: false, queued: false, reason: null, updatedAt: null},
        settings: null,
    };
}

function buildContext(scope: SettingsScopeId): AgentProfileSettingsContext {
    return {
        scope: scope === "project" ? "project" : "global",
        inheritedDefaultProfileKey: "story-writer",
        globalModelDefaults: {modelKey: null, temperature: null, topK: null, reasoningEffort: "off" as const, stream: true},
        globalProfileModels: {},
        settings: buildSettingsMeta(),
        descriptions: {
            "story-writer": "负责章节初稿的连续写作。",
            "line-editor": "对成稿逐段润色语气与节奏。",
        },
    };
}

function buildDraft(): AgentProfileSettingsPageDraft {
    return {
        defaultProfileKey: "",
        modelDefaults: cloneModelDraft(undefined),
        runtimeDefaults: createProfileRuntimeSettingsDraft(undefined),
        profiles: [baseProfile("story-writer", "故事写手"), baseProfile("line-editor", "行文编辑")],
    };
}

const scope = ref<SettingsScopeId>("global");
const activeSection = ref("agent-profile-models");
/** 配置目标只在项目作用域下有值：跟着作用域走，而不是跟着场景。 */
const targetLabel = computed(() => scope.value === "project" ? "C:/novels/长夜行" : "");
const settingsDraft = ref<AgentProfileSettingsPageDraft>(buildDraft());
const traceEnabled = ref(true);
const traceMaxRecords = ref(100);
const costCurrency = ref<"USD" | "CNY">("USD");
const embeddingDraft = ref(createEmbeddingSettingsDraft());
const webDraft = ref(createWebSettingsDraft());
const exchangeRate = ref<number | null>(7.2413);
const securityAuthEnabled = ref<boolean | null>(true);
const editorMarkdown = ref<MarkdownEditorPreferences>({...DEFAULT_MARKDOWN_EDITOR_PREFERENCES});
const editorMonaco = ref<MonacoEditorPreferences>({...DEFAULT_MONACO_EDITOR_PREFERENCES});
const desktopSettings = ref<DesktopSettings>({...DEFAULT_DESKTOP_SETTINGS});
const desktopSaveError = ref("");
const desktopStatus: DesktopStatus = {
    schema: DESKTOP_BRIDGE_SCHEMA,
    envelope: "electron",
    connection: "local",
    version: "0.1.42",
    origin: "http://127.0.0.1:3000",
    insecureRemote: false,
    platform: "windows",
    menuPresentation: "renderer",
    windowControls: "overlay",
};
const dialogOpen = ref(false);
const modelDraft = ref<ModelSettingsDraft>(buildModelSettingsDraft());
const modelActiveProviderKey = ref("provider-openai");
/** 模型区段的五个对话框在外壳场景里共用一个开关；会话在宿主侧由同样的状态驱动。 */
const modelDialogOpen = ref<"none" | "validation" | "delete" | "edit" | "discovery" | "library">("none");
const modelEditingDraft = computed(() => modelDialogOpen.value === "edit" ? modelDraft.value.providers[0]?.models[0] ?? null : null);
const modelManualDraft = ref({...MANUAL_MODEL_DRAFT});
const rolesDraft = ref(createRolesSettingsDraft());
const modelSelectedTemplate = ref(MODEL_PROVIDER_TEMPLATES[0]!.id);
const modelDiscoverySearchQuery = ref("");
const modelLibrarySearchQuery = ref("");
const modelDialogExpandedGroups = ref<Record<string, boolean>>({});
const modelEnabledModelIds = new Set<string>();
/**
 * 初始尺寸完全交给 size="lg"，不在这里重复写一份数字：只有用户拖动过之后才用受控值接管，
 * 否则预设一改，场景就会悄悄停在旧数值上。
 */
const dialogWidth = ref<number | null>(null);
const dialogHeight = ref<number | null>(null);

const loading = computed(() => sceneKey.value === "loading");
const loadError = computed(() => sceneKey.value === "load-error" ? "读取设置失败：示例后端返回 500。" : "");
const isDialogScene = computed(() => sceneKey.value === "dialog-window");

watch(sceneKey, (scene) => {
    scope.value = scene === "project" ? "project" : "global";
    activeSection.value = "agent-profile-models";
    settingsDraft.value = buildDraft();
    securityAuthEnabled.value = true;
    editorMarkdown.value = {...DEFAULT_MARKDOWN_EDITOR_PREFERENCES};
    editorMonaco.value = {...DEFAULT_MONACO_EDITOR_PREFERENCES};
    desktopSettings.value = {...DEFAULT_DESKTOP_SETTINGS};
    desktopSaveError.value = "";
    modelDraft.value = buildModelSettingsDraft();
    modelActiveProviderKey.value = "provider-openai";
    rolesDraft.value = createRolesSettingsDraft();
    modelSelectedTemplate.value = MODEL_PROVIDER_TEMPLATES[0]!.id;
    modelDialogOpen.value = "none";
    modelManualDraft.value = {...MANUAL_MODEL_DRAFT};
    modelDiscoverySearchQuery.value = "";
    modelLibrarySearchQuery.value = "";
    modelDialogExpandedGroups.value = {};
    dialogOpen.value = scene === "dialog-window";
}, {immediate: true});

watch([scope, activeSection, loading, loadError], () => {
    syncLabData({
        scope: scope.value,
        activeSection: activeSection.value,
        traceEnabled: traceEnabled.value,
        traceMaxRecords: traceMaxRecords.value,
        costCurrency: costCurrency.value,
        embeddingGlobal: {...embeddingDraft.value.global},
        webOrder: [...webDraft.value.order],
        securityAuthEnabled: securityAuthEnabled.value,
        editorMarkdown: {...editorMarkdown.value},
        editorMonaco: {...editorMonaco.value},
        desktopZoom: desktopSettings.value.zoomFactor,
        modelDefaultKey: modelDraft.value.defaultModelKey,
        boundRoles: Object.values(rolesDraft.value.roles).filter(Boolean).length,
        modelProviderCount: modelDraft.value.providers.length,
        loading: loading.value,
        loadError: loadError.value,
    });
}, {immediate: true});

function emitScopeChange(value: SettingsScopeId): void {
    emitLabEvent("update:scope", {scope: value});
}

function emitSectionChange(value: string): void {
    emitLabEvent("update:modelValue", {section: value});
}

/** 桌面设置的写回在 Lab 里不存在：就地合并 patch 并记录事件。 */
function updateDesktopSettings(patch: DesktopSettingsPatch): void {
    desktopSettings.value = {...desktopSettings.value, ...patch};
    emitLabEvent("update:settings", {...patch});
}

/** 重置由宿主决定重置成什么；外壳 fixture 里就恢复两份文档化默认值。 */
function resetEditorPreferences(target: "markdown" | "monaco"): void {
    if (target === "markdown") {
        editorMarkdown.value = {...DEFAULT_MARKDOWN_EDITOR_PREFERENCES};
    } else {
        editorMonaco.value = {...DEFAULT_MONACO_EDITOR_PREFERENCES};
    }
    emitLabEvent("reset", {target});
}

/** 模型草稿在 Lab 里由 fixture 自己持有：会话与写回都在宿主，这里只接受新草稿。 */
function updateModelDraft(value: ModelSettingsDraft): void {
    modelDraft.value = value;
    emitLabEvent("update:draft", {providers: value.providers.length, defaultModelKey: value.defaultModelKey});
}

/** 角色绑定在 Lab 里也由 fixture 持有：落写规则与回落链在 roles-settings-draft。 */
function updateRolesDraft(value: typeof rolesDraft.value): void {
    rolesDraft.value = value;
    emitLabEvent("update:roles", {boundRoles: Object.values(value.roles).filter(Boolean).length});
}

function openDialog(): void {
    dialogOpen.value = true;
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <div v-if="!isDialogScene" class="min-h-0 flex-1">
            <NovelIdeSettingsView
                :scope="scope"
                :scopes="scopeOptions"
                :sections="sectionOptions"
                :model-value="activeSection"
                :target-label="targetLabel"
                version-label="v0.0.0 · Lab"
                :loading="loading"
                :load-error="loadError"
                @update:scope="scope = $event; emitScopeChange($event)"
                @update:model-value="activeSection = $event; emitSectionChange($event)"
            >
                <AgentProfileSettingsView
                    v-if="activeSection === 'agent-profile-models'"
                    v-model="settingsDraft"
                    :context="buildContext(scope)"
                    :show-nav-heading="false"
                />
                <ObservabilitySettingsView
                    v-else-if="activeSection === 'observability'"
                    :enabled="traceEnabled"
                    :max-records="traceMaxRecords"
                    @update:enabled="traceEnabled = $event"
                    @update:max-records="traceMaxRecords = $event"
                />

                <CostSettingsView
                    v-else-if="activeSection === 'cost'"
                    :currency="costCurrency"
                    :exchange-rate="exchangeRate"
                    @update:currency="costCurrency = $event"
                    @refresh-rate="exchangeRate = 7.2455"
                />

                <EmbeddingSettingsView
                    v-else-if="activeSection === 'embedding'"
                    v-model="embeddingDraft"
                    scope="global"
                />

                <WebSettingsView
                    v-else-if="activeSection === 'web-tools'"
                    v-model="webDraft"
                />

                <SecuritySettingsView
                    v-else-if="activeSection === 'security'"
                    :auth-enabled="securityAuthEnabled"
                />

                <EditorSettingsView
                    v-else-if="activeSection === 'editor'"
                    v-model:markdown="editorMarkdown"
                    v-model:monaco="editorMonaco"
                    @reset="resetEditorPreferences"
                />

                <DesktopSettingsView
                    v-else-if="activeSection === 'desktop'"
                    :settings="desktopSettings"
                    :status="desktopStatus"
                    :save-error="desktopSaveError"
                    @update:settings="updateDesktopSettings"
                />

                <ProviderSettingsView
                    v-else-if="activeSection === 'providers'"
                    :draft="modelDraft"
                    :is-project-scope="scope === 'project'"
                    :target-label="targetLabel"
                    :loading="false"
                    :validation-issues="[]"
                    validation-issue-details=""
                    :repairing-models="false"
                    :saved-model-groups="buildSavedModelGroups(modelDraft)"
                    :disabled-models="[]"
                    :active-provider-key="modelActiveProviderKey"
                    :active-provider-checking-model-count="0"
                    :checking-all-models="false"
                    discovering-provider-id=""
                    :model-api-options="MODEL_API_OPTIONS"
                    :max-retries-placeholder="DEFAULT_PI_MAX_RETRIES"
                    :provider-templates="MODEL_PROVIDER_TEMPLATES"
                    :selected-template="modelSelectedTemplate"
                    @update:selected-template="modelSelectedTemplate = $event"
                    :validation-dialog-open="modelDialogOpen === 'validation'"
                    :delete-provider-dialog-open="modelDialogOpen === 'delete'"
                    :model-edit-dialog-open="modelDialogOpen === 'edit'"
                    :discovery-dialog-open="modelDialogOpen === 'discovery'"
                    :model-library-dialog-open="modelDialogOpen === 'library'"
                    :editing-model="modelEditingDraft"
                    :editing-library-model="null"
                    :editing-model-missing-fields="[]"
                    :editing-transient-candidate="false"
                    :discovery-groups="DISCOVERY_MODEL_GROUPS"
                    :discovery-search-query="modelDiscoverySearchQuery"
                    :discovery-expanded-groups="modelDialogExpandedGroups"
                    :discovery-diagnostics="DISCOVERY_DIAGNOSTICS"
                    :discovery-manual-draft="modelManualDraft"
                    :model-library-groups="[]"
                    :model-library-search-query="modelLibrarySearchQuery"
                    :model-library-expanded-groups="modelDialogExpandedGroups"
                    :enabled-model-ids="modelEnabledModelIds"
                    @update:draft="updateModelDraft"
                    @select-provider="modelActiveProviderKey = $event"
                    @edit-model="modelDialogOpen = 'edit'"
                    @open-discovery="modelDialogOpen = 'discovery'"
                    @open-library="modelDialogOpen = 'library'"
                    @request-delete-provider="modelDialogOpen = 'delete'"
                    @open-validation-issues="modelDialogOpen = 'validation'"
                    @update:validation-dialog-open="modelDialogOpen = $event ? 'validation' : 'none'"
                    @update:delete-provider-dialog-open="modelDialogOpen = $event ? 'delete' : 'none'"
                    @update:model-edit-dialog-open="modelDialogOpen = $event ? 'edit' : 'none'"
                    @update:discovery-dialog-open="modelDialogOpen = $event ? 'discovery' : 'none'"
                    @update:model-library-dialog-open="modelDialogOpen = $event ? 'library' : 'none'"
                    @confirm-delete-provider="modelDialogOpen = 'none'"
                    @confirm-model-edit="modelDialogOpen = 'none'"
                    @update:discovery-search-query="modelDiscoverySearchQuery = $event"
                    @update:model-library-search-query="modelLibrarySearchQuery = $event"
                    @update:discovery-manual-field="(field, value) => modelManualDraft = {...modelManualDraft, [field]: value}"
                    @toggle-discovery-group="modelDialogExpandedGroups = {...modelDialogExpandedGroups, [$event]: modelDialogExpandedGroups[$event] === false}"
                    @toggle-model-library-group="modelDialogExpandedGroups = {...modelDialogExpandedGroups, [$event]: modelDialogExpandedGroups[$event] === false}"
                />

                <RolesSettingsView
                    v-else-if="activeSection === 'roles'"
                    :model-value="rolesDraft"
                    :models="MODEL_DEFAULT_MODEL_OPTIONS"
                    @update:model-value="updateRolesDraft"
                />


            </NovelIdeSettingsView>
        </div>

        <div v-else class="flex h-full min-h-0 flex-col items-start gap-3">
            <button
                v-if="!dialogOpen"
                type="button"
                class="inline-flex h-8 items-center rounded-[var(--radius-control)] border border-[var(--divider)] px-3 text-xs text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
                @click="openDialog"
            >
                打开设置窗口
            </button>
            <DialogWindow
                v-model="dialogOpen"
                size="lg"
                :width="dialogWidth ?? undefined"
                :height="dialogHeight ?? undefined"
                resizable
                :min-width="720"
                :min-height="420"
                @update:width="dialogWidth = $event"
                @update:height="dialogHeight = $event"
            >
                <template #header>
                    <span class="text-sm font-semibold text-[var(--text-main)]">设置 · 全局</span>
                </template>
                <NovelIdeSettingsView
                    :scope="scope"
                    :scopes="scopeOptions"
                    :sections="sectionOptions"
                    :model-value="activeSection"
                    :target-label="targetLabel"
                    version-label="v0.0.0 · Lab"
                    :loading="loading"
                    :load-error="loadError"
                    @update:scope="scope = $event; emitScopeChange($event)"
                    @update:model-value="activeSection = $event; emitSectionChange($event)"
                >
                    <AgentProfileSettingsView
                        v-if="activeSection === 'agent-profile-models'"
                        v-model="settingsDraft"
                        :context="buildContext(scope)"
                        :show-nav-heading="false"
                    />
                    <ObservabilitySettingsView
                        v-else-if="activeSection === 'observability'"
                        :enabled="traceEnabled"
                        :max-records="traceMaxRecords"
                        @update:enabled="traceEnabled = $event"
                        @update:max-records="traceMaxRecords = $event"
                    />

                    <CostSettingsView
                        v-else-if="activeSection === 'cost'"
                        :currency="costCurrency"
                        :exchange-rate="exchangeRate"
                        @update:currency="costCurrency = $event"
                        @refresh-rate="exchangeRate = 7.2455"
                    />

                    <EmbeddingSettingsView
                        v-else-if="activeSection === 'embedding'"
                        v-model="embeddingDraft"
                        scope="global"
                    />

                    <WebSettingsView
                        v-else-if="activeSection === 'web-tools'"
                        v-model="webDraft"
                    />

                    <SecuritySettingsView
                        v-else-if="activeSection === 'security'"
                        :auth-enabled="securityAuthEnabled"
                    />

                    <EditorSettingsView
                        v-else-if="activeSection === 'editor'"
                        v-model:markdown="editorMarkdown"
                        v-model:monaco="editorMonaco"
                        @reset="resetEditorPreferences"
                    />

                    <DesktopSettingsView
                        v-else-if="activeSection === 'desktop'"
                        :settings="desktopSettings"
                        :status="desktopStatus"
                        :save-error="desktopSaveError"
                        @update:settings="updateDesktopSettings"
                    />

                    <ProviderSettingsView
                        v-else-if="activeSection === 'providers'"
                        :draft="modelDraft"
                        :is-project-scope="scope === 'project'"
                        :target-label="targetLabel"
                        :loading="false"
                        :validation-issues="[]"
                        validation-issue-details=""
                        :repairing-models="false"
                            :saved-model-groups="buildSavedModelGroups(modelDraft)"
                        :disabled-models="[]"
                        :active-provider-key="modelActiveProviderKey"
                        :active-provider-checking-model-count="0"
                        :checking-all-models="false"
                        discovering-provider-id=""
                                :model-api-options="MODEL_API_OPTIONS"
                        :max-retries-placeholder="DEFAULT_PI_MAX_RETRIES"
                        :provider-templates="MODEL_PROVIDER_TEMPLATES"
                        :selected-template="modelSelectedTemplate"
                        @update:selected-template="modelSelectedTemplate = $event"
                        :validation-dialog-open="modelDialogOpen === 'validation'"
                        :delete-provider-dialog-open="modelDialogOpen === 'delete'"
                        :model-edit-dialog-open="modelDialogOpen === 'edit'"
                        :discovery-dialog-open="modelDialogOpen === 'discovery'"
                        :model-library-dialog-open="modelDialogOpen === 'library'"
                        :editing-model="modelEditingDraft"
                        :editing-library-model="null"
                        :editing-model-missing-fields="[]"
                        :editing-transient-candidate="false"
                        :discovery-groups="DISCOVERY_MODEL_GROUPS"
                        :discovery-search-query="modelDiscoverySearchQuery"
                        :discovery-expanded-groups="modelDialogExpandedGroups"
                        :discovery-diagnostics="DISCOVERY_DIAGNOSTICS"
                        :discovery-manual-draft="modelManualDraft"
                        :model-library-groups="[]"
                        :model-library-search-query="modelLibrarySearchQuery"
                        :model-library-expanded-groups="modelDialogExpandedGroups"
                        :enabled-model-ids="modelEnabledModelIds"
                        @update:draft="updateModelDraft"
                            @select-provider="modelActiveProviderKey = $event"
                        @edit-model="modelDialogOpen = 'edit'"
                        @open-discovery="modelDialogOpen = 'discovery'"
                        @open-library="modelDialogOpen = 'library'"
                        @request-delete-provider="modelDialogOpen = 'delete'"
                        @open-validation-issues="modelDialogOpen = 'validation'"
                        @update:validation-dialog-open="modelDialogOpen = $event ? 'validation' : 'none'"
                        @update:delete-provider-dialog-open="modelDialogOpen = $event ? 'delete' : 'none'"
                        @update:model-edit-dialog-open="modelDialogOpen = $event ? 'edit' : 'none'"
                        @update:discovery-dialog-open="modelDialogOpen = $event ? 'discovery' : 'none'"
                        @update:model-library-dialog-open="modelDialogOpen = $event ? 'library' : 'none'"
                        @confirm-delete-provider="modelDialogOpen = 'none'"
                        @confirm-model-edit="modelDialogOpen = 'none'"
                        @update:discovery-search-query="modelDiscoverySearchQuery = $event"
                        @update:model-library-search-query="modelLibrarySearchQuery = $event"
                        @update:discovery-manual-field="(field, value) => modelManualDraft = {...modelManualDraft, [field]: value}"
                        @toggle-discovery-group="modelDialogExpandedGroups = {...modelDialogExpandedGroups, [$event]: modelDialogExpandedGroups[$event] === false}"
                        @toggle-model-library-group="modelDialogExpandedGroups = {...modelDialogExpandedGroups, [$event]: modelDialogExpandedGroups[$event] === false}"
                    />

                    <RolesSettingsView
                        v-else-if="activeSection === 'roles'"
                        :model-value="rolesDraft"
                        :models="MODEL_DEFAULT_MODEL_OPTIONS"
                        @update:model-value="updateRolesDraft"
                    />


                </NovelIdeSettingsView>
            </DialogWindow>
        </div>
    </div>
</template>
