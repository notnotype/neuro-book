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
import type {ModelSettingsDraft} from "../../components/novel-ide/settings/sections/providers/provider-settings-draft";
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
import type {SettingsScopeId} from "../../components/novel-ide/settings/sections/NovelIdeSettingsView.types";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const {t} = useI18n();
const subject = useLabSubject<typeof NovelIdeSettingsView>(() => props.input, ["reload"]);
const sceneKey = computed(() => props.scene);

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

const scope = computed(() => subject.bindings.value.scope);
const activeSection = computed(() => subject.bindings.value.modelValue);
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
const rolesDraft = ref(createRolesSettingsDraft(t));
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


const isDialogScene = computed(() => sceneKey.value === "dialog-window");

watch(sceneKey, (scene) => {

    settingsDraft.value = buildDraft();
    securityAuthEnabled.value = true;
    editorMarkdown.value = {...DEFAULT_MARKDOWN_EDITOR_PREFERENCES};
    editorMonaco.value = {...DEFAULT_MONACO_EDITOR_PREFERENCES};
    desktopSettings.value = {...DEFAULT_DESKTOP_SETTINGS};
    desktopSaveError.value = "";
    modelDraft.value = buildModelSettingsDraft();
    modelActiveProviderKey.value = "provider-openai";
    rolesDraft.value = createRolesSettingsDraft(t);
    modelSelectedTemplate.value = MODEL_PROVIDER_TEMPLATES[0]!.id;
    modelDialogOpen.value = "none";
    modelManualDraft.value = {...MANUAL_MODEL_DRAFT};
    modelDiscoverySearchQuery.value = "";
    modelLibrarySearchQuery.value = "";
    modelDialogExpandedGroups.value = {};
    dialogOpen.value = scene === "dialog-window";
}, {immediate: true});



function updateDesktopSettings(patch: DesktopSettingsPatch): void {
    desktopSettings.value = {...desktopSettings.value, ...patch};
}

function resetEditorPreferences(target: "markdown" | "monaco"): void {
    if (target === "markdown") editorMarkdown.value = {...DEFAULT_MARKDOWN_EDITOR_PREFERENCES};
    else editorMonaco.value = {...DEFAULT_MONACO_EDITOR_PREFERENCES};
}

function updateModelDraft(value: ModelSettingsDraft): void {
    modelDraft.value = value;
}

function updateRolesDraft(value: typeof rolesDraft.value): void {
    rolesDraft.value = value;
}

function openDialog(): void {
    dialogOpen.value = true;
}

</script>
<template>
    <div class="flex h-full min-h-0 flex-col">
        <div v-if="!isDialogScene" class="min-h-0 flex-1">
            <NovelIdeSettingsView
                v-bind="subject.bindings.value"
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
                    target-label="C:/novels/长夜行"
                    v-else-if="activeSection === 'providers'"
                    :draft="modelDraft"
                    :is-project-scope="scope === 'project'"
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
                    :teleport-target="false"
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
                body-class="min-h-0 flex-1 overflow-hidden p-0"
                @update:width="dialogWidth = $event"
                @update:height="dialogHeight = $event"
            >
                <template #header>
                    <span class="text-sm font-semibold text-[var(--text-main)]">设置 · 全局</span>
                </template>
                <NovelIdeSettingsView
                    v-bind="subject.bindings.value"
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
                        target-label="C:/novels/长夜行"
                        v-else-if="activeSection === 'providers'"
                        :draft="modelDraft"
                        :is-project-scope="scope === 'project'"
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
                        :teleport-target="false"
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
