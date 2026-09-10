<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {DialogWindow} from "@notnotype/nb-ui/components";
import type {ProviderConfigIssue} from "@notnotype/neuro-book-contracts/provider-config";
import ModelSettingsView from "../../components/novel-ide/settings/sections/model/ModelSettingsView.vue";
import type {ModelSettingsDraft, ModelSettingsModelDraft} from "../../components/novel-ide/settings/sections/model/model-settings-draft";
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

type SceneKey = "default" | "project" | "no-provider" | "disabled-models" | "dialog-window" | "saving" | "save-error" | "loading";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["default", "project", "no-provider", "disabled-models", "dialog-window", "saving", "save-error", "loading"];
    return known.find((key) => key === props.scene) ?? "default";
});

/** 草稿问题在停用与问题场景里出现，用来核对横幅与停用清单同时渲染。 */
const draftIssues: ProviderConfigIssue[] = [
    {code: "missing_api", message: "模型 o4-mini 缺少 API 格式", path: ["providers", 0, "models", 1, "api"], modelKey: "openai/o4-mini"},
    {code: "missing_context_window", message: "模型 o4-mini 缺少上下文窗口", path: ["providers", 0, "models", 1, "contextWindowTokens"], modelKey: "openai/o4-mini"},
];

const sceneData = computed(() => sceneKey.value);
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
/** dialog-window 场景里窗口可关可重开：关掉后留一个重新打开的入口，否则这个场景只能靠刷新页面回来。 */
const windowOpen = ref(true);

const isProjectScope = computed(() => sceneKey.value === "project");
const loading = computed(() => sceneKey.value === "loading");
const saving = computed(() => sceneKey.value === "saving");
const saveError = computed(() => sceneKey.value === "save-error" ? "示例后端返回 500" : "");
const hasIssues = computed(() => sceneKey.value === "disabled-models");
const validationIssues = computed(() => hasIssues.value ? draftIssues : []);
const validationIssueDetails = computed(() => draftIssues.map((issue) => `${issue.code} ${issue.path.join(".")}`).join("\n"));
const disabledModels = computed(() => hasIssues.value ? buildDisabledModels(draft.value) : []);
const savedModelGroups = computed(() => buildSavedModelGroups(draft.value));

watch(sceneKey, (scene) => {
    draft.value = sceneDraft(scene);
    activeProviderKey.value = draft.value.providers[0]?.localKey ?? "";
    selectedTemplate.value = MODEL_PROVIDER_TEMPLATES[0]!.id;
    windowOpen.value = true;
}, {immediate: true});

watch([draft, activeProviderKey, sceneKey], () => {
    syncLabData({
        scene: sceneData.value,
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

function selectProvider(key: string): void {
    activeProviderKey.value = key;
    emitLabEvent("select-provider", {key});
}

function updateManualField(field: string, value: string): void {
    emitLabEvent("update:discoveryManualField", {field, value});
}

function toggleModelInput(model: ModelSettingsModelDraft, inputKind: string): void {
    emitLabEvent("toggle-model-input", {model: model.id, inputKind});
}

/**
 * 视图绑定只有一份：下面的场景把一个 `<ModelSettingsView>` 直接摆在画布上，
 * dialog-window 场景摆进 nb-ui `DialogWindow`（产品里它就是这样被承载的）。
 * 两处共用同一份 props / handlers，避免同一份绑定写两遍后走样。
 */
const viewBindings = computed(() => ({
    draft: draft.value,
    isProjectScope: isProjectScope.value,
    targetLabel: "C:/novels/长夜行",
    loading: loading.value,
    saving: saving.value,
    saveError: saveError.value,
    validationIssues: validationIssues.value,
    validationIssueDetails: validationIssueDetails.value,
    repairingModels: false,
    defaultModelOptions: MODEL_DEFAULT_MODEL_OPTIONS,
    savedModelGroups: savedModelGroups.value,
    disabledModels: disabledModels.value,
    activeProviderKey: activeProviderKey.value,
    activeProviderCheckingModelCount: 0,
    checkingAllModels: false,
    discoveringProviderId: "",
    providerTemplates: MODEL_PROVIDER_TEMPLATES,
    selectedTemplate: selectedTemplate.value,
    modelApiOptions: MODEL_API_OPTIONS,
    maxRetriesPlaceholder: DEFAULT_PI_MAX_RETRIES,
    validationDialogOpen: false,
    deleteProviderDialogOpen: false,
    modelEditDialogOpen: false,
    discoveryDialogOpen: false,
    modelLibraryDialogOpen: false,
    editingModel: null,
    editingLibraryModel: null,
    editingModelMissingFields: [],
    editingTransientCandidate: false,
    discoveryGroups: [],
    discoverySearchQuery: "",
    discoveryExpandedGroups: {},
    discoveryDiagnostics: null,
    discoveryManualDraft: {name: "", id: "", api: "", group: "", contextWindowTokens: "", maxTokens: ""},
    modelLibraryGroups: [],
    modelLibrarySearchQuery: "",
    modelLibraryExpandedGroups: {},
    enabledModelIds: new Set<string>(),
    "onUpdate:draft": updateDraft,
    "onUpdate:selectedTemplate": (value: string) => { selectedTemplate.value = value; },
    "onSelect-provider": selectProvider,
    "onUpdate:discoveryManualField": updateManualField,
    "onToggle-model-input": toggleModelInput,
    "onAdd-provider": () => emitLabEvent("add-provider", {template: selectedTemplate.value}),
    "onToggle-provider-enabled": () => emitLabEvent("toggle-provider-enabled", {key: activeProviderKey.value}),
    "onRename-provider-id": (nextId: string) => emitLabEvent("rename-provider-id", {nextId}),
    "onClone-provider-connection": () => emitLabEvent("clone-provider-connection", {key: activeProviderKey.value}),
    "onRequest-delete-provider": () => emitLabEvent("request-delete-provider", {key: activeProviderKey.value}),
    "onClear-provider-api-key": () => emitLabEvent("clear-provider-api-key", {key: activeProviderKey.value}),
    "onDiscover-models": () => emitLabEvent("discover-models", {key: activeProviderKey.value}),
    "onCheck-model": (model: ModelSettingsModelDraft) => emitLabEvent("check-model", {model: model.id}),
    "onCancel-model-check": (model: ModelSettingsModelDraft) => emitLabEvent("cancel-model-check", {model: model.id}),
    "onCheck-all-models": () => emitLabEvent("check-all-models"),
    "onCancel-model-checks": () => emitLabEvent("cancel-model-checks"),
    "onEdit-model": (model: ModelSettingsModelDraft) => emitLabEvent("edit-model", {model: model.id}),
    "onDisable-model": (model: ModelSettingsModelDraft) => emitLabEvent("disable-model", {model: model.id}),
    "onDelete-model": (model: ModelSettingsModelDraft) => emitLabEvent("delete-model", {model: model.id}),
    "onOpen-discovery": () => emitLabEvent("open-discovery"),
    "onOpen-library": () => emitLabEvent("open-library"),
    "onRepair": () => emitLabEvent("repair"),
    "onOpen-validation-issues": () => emitLabEvent("open-validation-issues"),
}));
</script>

<template>
    <div v-if="sceneKey === 'dialog-window'" class="flex h-full min-h-0 flex-col items-start gap-3 p-[var(--space-6)]">
        <button
            v-if="!windowOpen"
            type="button"
            class="inline-flex h-8 items-center rounded-[var(--radius-control)] border border-[var(--divider)] px-3 text-xs text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
            @click="windowOpen = true"
        >
            重新打开窗口
        </button>
        <DialogWindow v-model="windowOpen" size="lg" title="模型设置" resizable :min-width="720" :min-height="420">
            <ModelSettingsView v-bind="viewBindings" />
        </DialogWindow>
    </div>

    <div v-else class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <ModelSettingsView v-bind="viewBindings" />
    </div>
</template>
