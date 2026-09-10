<script setup lang="ts">
import {computed, ref, watch} from "vue";
import type {ProviderConfigIssue} from "@notnotype/neuro-book-contracts/provider-config";
import ModelSettingsView from "../../components/novel-ide/settings/views/model/ModelSettingsView.vue";
import type {ModelSettingsDraft, ModelSettingsModelDraft} from "../../components/novel-ide/settings/views/model/model-settings-draft";
import type {ManualModelDraft} from "../../components/novel-ide/settings/views/model/model-settings-view";
import type {ModelInputKind} from "nbook/shared/dto/app-settings.dto";
import {DEFAULT_PI_MAX_RETRIES} from "nbook/shared/dto/pi-request-options.dto";
import {
    DISCOVERY_DIAGNOSTICS,
    DISCOVERY_MODEL_GROUPS,
    MANUAL_MODEL_DRAFT,
    MODEL_API_OPTIONS,
    MODEL_DEFAULT_MODEL_OPTIONS,
    MODEL_LIBRARY_GROUPS,
    MODEL_PROVIDER_TEMPLATES,
    buildDisabledModelSettingsDraft,
    buildDisabledModels,
    buildModelSettingsDraft,
    buildSavedModelGroups,
} from "./model-settings-fixture-data";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

type SceneKey = "default" | "project" | "no-provider" | "disabled-models" | "validation-issues" | "delete-provider" | "edit-dialog" | "discovery-dialog" | "library-dialog" | "saving" | "save-error" | "loading";
type DialogKey = "none" | "validation" | "delete" | "edit" | "discovery" | "library";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["default", "project", "no-provider", "disabled-models", "validation-issues", "delete-provider", "edit-dialog", "discovery-dialog", "library-dialog", "saving", "save-error", "loading"];
    return known.find((key) => key === props.scene) ?? "default";
});

function sceneDialog(scene: SceneKey): DialogKey {
    switch (scene) {
        case "validation-issues": return "validation";
        case "delete-provider": return "delete";
        case "edit-dialog": return "edit";
        case "discovery-dialog": return "discovery";
        case "library-dialog": return "library";
        default: return "none";
    }
}

/** 草稿问题只在两个场景里出现，用来核对横幅与完整列表。 */
const draftIssues: ProviderConfigIssue[] = [
    {code: "missing_api", message: "模型 o4-mini 缺少 API 格式", path: ["providers", 0, "models", 1, "api"], modelKey: "openai/o4-mini"},
    {code: "missing_context_window", message: "模型 o4-mini 缺少上下文窗口", path: ["providers", 0, "models", 1, "contextWindowTokens"], modelKey: "openai/o4-mini"},
];

function sceneDraft(scene: SceneKey): ModelSettingsDraft {
    if (scene === "no-provider") {
        return {defaultModelKey: null, providers: [], agentVisibleModels: []};
    }
    if (scene === "disabled-models" || scene === "validation-issues") {
        return buildDisabledModelSettingsDraft();
    }
    return buildModelSettingsDraft();
}

const draft = ref<ModelSettingsDraft>(sceneDraft("default"));
const openDialog = ref<DialogKey>("none");
const activeProviderKey = ref("provider-openai");
const selectedTemplate = ref(MODEL_PROVIDER_TEMPLATES[0]!.id);
const discoverySearchQuery = ref("");
const modelLibrarySearchQuery = ref("");
const discoveryExpandedGroups = ref<Record<string, boolean>>({});
const modelLibraryExpandedGroups = ref<Record<string, boolean>>({});
const manualDraft = ref<ManualModelDraft>({...MANUAL_MODEL_DRAFT});
const enabledModelIds = new Set(["gpt-5.1"]);

const hasIssues = computed(() => sceneKey.value === "disabled-models" || sceneKey.value === "validation-issues");
const isProjectScope = computed(() => sceneKey.value === "project");
const loading = computed(() => sceneKey.value === "loading");
const saving = computed(() => sceneKey.value === "saving");
const saveError = computed(() => sceneKey.value === "save-error" ? "示例后端返回 500" : "");
const validationIssues = computed(() => hasIssues.value ? draftIssues : []);
const validationIssueDetails = computed(() => draftIssues.map((issue) => `${issue.code} ${issue.path.join(".")}`).join("\n"));
const disabledModels = computed(() => hasIssues.value ? buildDisabledModels(draft.value) : []);
const savedModelGroups = computed(() => buildSavedModelGroups(draft.value));
const editingModel = computed<ModelSettingsModelDraft | null>(() => openDialog.value === "edit" ? draft.value.providers[0]?.models[0] ?? null : null);

watch(sceneKey, (scene) => {
    draft.value = sceneDraft(scene);
    openDialog.value = sceneDialog(scene);
    activeProviderKey.value = draft.value.providers[0]?.localKey ?? "";
    selectedTemplate.value = MODEL_PROVIDER_TEMPLATES[0]!.id;
    discoverySearchQuery.value = "";
    modelLibrarySearchQuery.value = "";
    discoveryExpandedGroups.value = {};
    modelLibraryExpandedGroups.value = {};
    manualDraft.value = {...MANUAL_MODEL_DRAFT};
}, {immediate: true});

watch([draft, activeProviderKey, openDialog, sceneKey], () => {
    syncLabData({
        defaultModelKey: draft.value.defaultModelKey,
        providers: draft.value.providers.map((provider) => ({id: provider.id, enabled: provider.enabled, models: provider.models.length})),
        validationIssues: validationIssues.value.length,
        openDialog: openDialog.value,
    });
}, {immediate: true});

/** 就地保存：fixture 立刻接受新草稿并记录事件，不写 store、不发请求。 */
function updateDraft(value: ModelSettingsDraft): void {
    draft.value = value;
    emitLabEvent("update:draft", {
        defaultModelKey: value.defaultModelKey,
        providers: value.providers.length,
        agentVisibleModels: value.agentVisibleModels.length,
    });
}

function updateSelectedTemplate(value: string): void {
    selectedTemplate.value = value;
    emitLabEvent("update:selectedTemplate", {selectedTemplate: value});
}

function selectProvider(key: string): void {
    activeProviderKey.value = key;
    emitLabEvent("select-provider", {key});
}

function updateManualField(field: keyof ManualModelDraft, value: string): void {
    manualDraft.value = {...manualDraft.value, [field]: value};
    emitLabEvent("update:discoveryManualField", {field, value});
}

/** 模板里的 $event 只带第一个参数，多参事件统一走函数。 */
function toggleModelInput(model: ModelSettingsModelDraft, inputKind: ModelInputKind): void {
    emitLabEvent("toggle-model-input", {model: model.id, inputKind});
}
</script>

<template>
    <!-- app 公共 Dialog 的默认 teleport 目标是产品外壳的 .novel-ide-theme；Lab 里由 fixture 提供同一个宿主。 -->
    <div class="novel-ide-theme h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <ModelSettingsView
            :draft="draft"
            :is-project-scope="isProjectScope"
            target-label="C:/novels/长夜行"
            :loading="loading"
            :saving="saving"
            :save-error="saveError"
            :validation-issues="validationIssues"
            :validation-issue-details="validationIssueDetails"
            :repairing-models="false"
            :default-model-options="MODEL_DEFAULT_MODEL_OPTIONS"
            :saved-model-groups="savedModelGroups"
            :disabled-models="disabledModels"
            :active-provider-key="activeProviderKey"
            :active-provider-checking-model-count="0"
            :checking-all-models="false"
            discovering-provider-id=""
            :provider-templates="MODEL_PROVIDER_TEMPLATES"
            :selected-template="selectedTemplate"
            :model-api-options="MODEL_API_OPTIONS"
            :max-retries-placeholder="DEFAULT_PI_MAX_RETRIES"
            :validation-dialog-open="openDialog === 'validation'"
            :delete-provider-dialog-open="openDialog === 'delete'"
            :model-edit-dialog-open="openDialog === 'edit'"
            :discovery-dialog-open="openDialog === 'discovery'"
            :model-library-dialog-open="openDialog === 'library'"
            :editing-model="editingModel"
            :editing-library-model="MODEL_LIBRARY_GROUPS[0]?.models[0] ?? null"
            :editing-model-missing-fields="[]"
            :editing-transient-candidate="false"
            :discovery-groups="DISCOVERY_MODEL_GROUPS"
            :discovery-search-query="discoverySearchQuery"
            :discovery-expanded-groups="discoveryExpandedGroups"
            :discovery-diagnostics="DISCOVERY_DIAGNOSTICS"
            :discovery-manual-draft="manualDraft"
            :model-library-groups="MODEL_LIBRARY_GROUPS"
            :model-library-search-query="modelLibrarySearchQuery"
            :model-library-expanded-groups="modelLibraryExpandedGroups"
            :enabled-model-ids="enabledModelIds"
            @update:draft="updateDraft"
            @update:selected-template="updateSelectedTemplate"
            @select-provider="selectProvider"
            @add-provider="emitLabEvent('add-provider', {template: selectedTemplate})"
            @toggle-provider-enabled="emitLabEvent('toggle-provider-enabled', {key: activeProviderKey})"
            @rename-provider-id="emitLabEvent('rename-provider-id', {nextId: $event})"
            @clone-provider-connection="emitLabEvent('clone-provider-connection', {key: activeProviderKey})"
            @request-delete-provider="openDialog = 'delete'"
            @clear-provider-api-key="emitLabEvent('clear-provider-api-key', {key: activeProviderKey})"
            @discover-models="emitLabEvent('discover-models', {key: activeProviderKey})"
            @check-model="emitLabEvent('check-model', {model: $event.id})"
            @cancel-model-check="emitLabEvent('cancel-model-check', {model: $event.id})"
            @check-all-models="emitLabEvent('check-all-models')"
            @cancel-model-checks="emitLabEvent('cancel-model-checks')"
            @edit-model="openDialog = 'edit'"
            @disable-model="emitLabEvent('disable-model', {model: $event.id})"
            @delete-model="emitLabEvent('delete-model', {model: $event.id})"
            @open-discovery="openDialog = 'discovery'"
            @open-library="openDialog = 'library'"
            @repair="emitLabEvent('repair')"
            @open-validation-issues="openDialog = 'validation'"
            @update:validation-dialog-open="openDialog = $event ? 'validation' : 'none'"
            @update:delete-provider-dialog-open="openDialog = $event ? 'delete' : 'none'"
            @update:model-edit-dialog-open="openDialog = $event ? 'edit' : 'none'"
            @update:discovery-dialog-open="openDialog = $event ? 'discovery' : 'none'"
            @update:model-library-dialog-open="openDialog = $event ? 'library' : 'none'"
            @confirm-delete-provider="openDialog = 'none'; emitLabEvent('confirm-delete-provider')"
            @confirm-model-edit="openDialog = 'none'; emitLabEvent('confirm-model-edit')"
            @model-id-change="emitLabEvent('model-id-change')"
            @toggle-model-input="toggleModelInput"
            @reset-model-input="emitLabEvent('reset-model-input', {model: $event.id})"
            @reset-model-cost="emitLabEvent('reset-model-cost', {model: $event.id})"
            @enable-model-cost="emitLabEvent('enable-model-cost', {model: $event.id})"
            @reapply-library="emitLabEvent('reapply-library', {model: $event.id})"
            @update:discovery-search-query="discoverySearchQuery = $event"
            @update:model-library-search-query="modelLibrarySearchQuery = $event"
            @update:discovery-manual-field="updateManualField"
            @toggle-discovery-group="discoveryExpandedGroups = {...discoveryExpandedGroups, [$event]: discoveryExpandedGroups[$event] === false}"
            @toggle-model-library-group="modelLibraryExpandedGroups = {...modelLibraryExpandedGroups, [$event]: modelLibraryExpandedGroups[$event] === false}"
            @toggle-discovered-model="emitLabEvent('toggle-discovered-model', {model: $event.id})"
            @toggle-library-model="emitLabEvent('toggle-library-model', {model: $event.id})"
            @discover="emitLabEvent('discover')"
            @add-manual-model="emitLabEvent('add-manual-model')"
        />
    </div>
</template>
