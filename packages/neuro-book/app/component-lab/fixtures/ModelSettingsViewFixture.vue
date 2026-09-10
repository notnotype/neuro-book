<script setup lang="ts">
import {computed, ref, watch} from "vue";
import type {ProviderConfigIssue} from "@notnotype/neuro-book-contracts/provider-config";
import ModelSettingsView from "../../components/novel-ide/settings/views/model/ModelSettingsView.vue";
import type {ModelSettingsDraft} from "../../components/novel-ide/settings/views/model/model-settings-draft";
import {DEFAULT_PI_MAX_RETRIES} from "nbook/shared/dto/pi-request-options.dto";
import {
    MODEL_API_OPTIONS,
    MODEL_DEFAULT_MODEL_OPTIONS,
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

type SceneKey = "default" | "project" | "no-provider" | "disabled-models" | "saving" | "save-error" | "loading";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["default", "project", "no-provider", "disabled-models", "saving", "save-error", "loading"];
    return known.find((key) => key === props.scene) ?? "default";
});

/** 草稿问题只在这一个场景里出现，用来核对横幅与停用清单同时渲染。 */
const disabledIssues: ProviderConfigIssue[] = [
    {code: "missing_api", message: "模型 o4-mini 缺少 API 格式", path: ["providers", 0, "models", 1, "api"], modelKey: "openai/o4-mini"},
    {code: "missing_context_window", message: "模型 o4-mini 缺少上下文窗口", path: ["providers", 0, "models", 1, "contextWindowTokens"], modelKey: "openai/o4-mini"},
];

function sceneDraft(scene: SceneKey): ModelSettingsDraft {
    if (scene === "no-provider") {
        return {defaultModelKey: null, providers: [], agentVisibleModels: []};
    }
    if (scene === "disabled-models") {
        return buildDisabledModelSettingsDraft();
    }
    return buildModelSettingsDraft();
}

const draft = ref<ModelSettingsDraft>(sceneDraft("default"));
const activeProviderKey = ref("provider-openai");
const selectedTemplate = ref(MODEL_PROVIDER_TEMPLATES[0]!.id);

const isProjectScope = computed(() => sceneKey.value === "project");
const loading = computed(() => sceneKey.value === "loading");
const saving = computed(() => sceneKey.value === "saving");
const saveError = computed(() => sceneKey.value === "save-error" ? "示例后端返回 500" : "");
const validationIssues = computed(() => sceneKey.value === "disabled-models" ? disabledIssues : []);
const validationIssueDetails = computed(() => disabledIssues.map((issue) => `${issue.code} ${issue.path.join(".")}`).join("\n"));
const disabledModels = computed(() => sceneKey.value === "disabled-models" ? buildDisabledModels(draft.value) : []);
const savedModelGroups = computed(() => buildSavedModelGroups(draft.value));

watch(sceneKey, (scene) => {
    draft.value = sceneDraft(scene);
    activeProviderKey.value = draft.value.providers[0]?.localKey ?? "";
    selectedTemplate.value = MODEL_PROVIDER_TEMPLATES[0]!.id;
}, {immediate: true});

watch([draft, activeProviderKey, sceneKey], () => {
    syncLabData({
        defaultModelKey: draft.value.defaultModelKey,
        providers: draft.value.providers.map((provider) => ({id: provider.id, enabled: provider.enabled, models: provider.models.length})),
        validationIssues: validationIssues.value.length,
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
</script>

<template>
    <div class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
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
            @update:draft="updateDraft"
            @update:selected-template="updateSelectedTemplate"
            @select-provider="selectProvider"
            @add-provider="emitLabEvent('add-provider', {template: selectedTemplate})"
            @toggle-provider-enabled="emitLabEvent('toggle-provider-enabled', {key: activeProviderKey})"
            @rename-provider-id="emitLabEvent('rename-provider-id', {nextId: $event})"
            @clone-provider-connection="emitLabEvent('clone-provider-connection', {key: activeProviderKey})"
            @request-delete-provider="emitLabEvent('request-delete-provider', {key: activeProviderKey})"
            @clear-provider-api-key="emitLabEvent('clear-provider-api-key', {key: activeProviderKey})"
            @discover-models="emitLabEvent('discover-models', {key: activeProviderKey})"
            @check-model="emitLabEvent('check-model', {model: $event.id})"
            @cancel-model-check="emitLabEvent('cancel-model-check', {model: $event.id})"
            @check-all-models="emitLabEvent('check-all-models')"
            @cancel-model-checks="emitLabEvent('cancel-model-checks')"
            @edit-model="emitLabEvent('edit-model', {model: $event.id})"
            @disable-model="emitLabEvent('disable-model', {model: $event.id})"
            @delete-model="emitLabEvent('delete-model', {model: $event.id})"
            @open-discovery="emitLabEvent('open-discovery')"
            @open-library="emitLabEvent('open-library')"
            @repair="emitLabEvent('repair')"
            @open-validation-issues="emitLabEvent('open-validation-issues')"
        />
    </div>
</template>
