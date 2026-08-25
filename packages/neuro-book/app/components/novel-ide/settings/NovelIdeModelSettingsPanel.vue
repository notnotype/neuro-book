<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import AgentVisibleModelsEditor from "nbook/app/components/novel-ide/settings/AgentVisibleModelsEditor.vue";
import NovelIdeModelSelect from "nbook/app/components/novel-ide/settings/NovelIdeModelSelect.vue";
import NovelIdeModelEditDialog from "nbook/app/components/novel-ide/settings/NovelIdeModelEditDialog.vue";
import ModelDiscoveryDialog from "nbook/app/components/novel-ide/settings/ModelDiscoveryDialog.vue";
import ModelLibraryDialog from "nbook/app/components/novel-ide/settings/ModelLibraryDialog.vue";
import SavedModelsList from "nbook/app/components/novel-ide/settings/SavedModelsList.vue";
import {clearModelCostDraft, createModelCostDraft} from "nbook/app/components/novel-ide/settings/model-cost-draft";
import {candidateFromLibrary, requiredModelFields} from "nbook/app/components/novel-ide/settings/model-draft-factory";
import {parseDraftInteger, parseModelInput, parseModelReasoning, type ModelSettingsModelDraft, type ModelSettingsProviderDraft} from "nbook/app/components/novel-ide/settings/model-settings-draft";
import type {SavedModelGroupView} from "nbook/app/components/novel-ide/settings/model-settings-view";
import {useModelCheckSession} from "nbook/app/components/novel-ide/settings/useModelCheckSession";
import {useModelDiscoverySession} from "nbook/app/components/novel-ide/settings/useModelDiscoverySession";
import {useModelSettingsDraftSession, type ModelSettingsPanelProps, type ModelSettingsScope} from "nbook/app/components/novel-ide/settings/useModelSettingsDraftSession";
import {useProviderTemplateSession} from "nbook/app/components/novel-ide/settings/useProviderTemplateSession";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {ConfiguredModelDto, ModelInputKind, ModelLibraryDto} from "nbook/shared/dto/app-settings.dto";
import type {ConfigWorkspaceQueryDto} from "nbook/shared/dto/config.dto";
import {DEFAULT_PI_MAX_RETRIES} from "nbook/shared/dto/pi-request-options.dto";
import {deriveModelGroup} from "nbook/shared/models/model-group";

const props = withDefaults(defineProps<{
    scope?: ModelSettingsScope;
    targetQuery?: ConfigWorkspaceQueryDto;
    targetLabel?: string;
}>(), {
    scope: "global",
    targetQuery: undefined,
    targetLabel: "",
});

type ModelDraft = ModelSettingsModelDraft;
type ProviderDraft = ModelSettingsProviderDraft;

const {t} = useI18n();
const notification = useNotification();
let loadLibraries: () => Promise<ModelLibraryDto> = async () => ({models: []});
let resetChecks = (): void => undefined;
let cancelProviderChecks = (_provider: ProviderDraft, _clearBatch: boolean): void => undefined;
let cancelModelCheck = (_provider: ProviderDraft, _model: ModelDraft): void => undefined;
let resetDiscovery = (_preserveResults: boolean): void => undefined;
let renameDiscovery = (_previousId: string, _nextId: string): void => undefined;
let removeDiscovery = (_providerId: string): void => undefined;

const draftSession = useModelSettingsDraftSession({
    props: props as ModelSettingsPanelProps,
    loadLibraries: () => loadLibraries(),
    resetChecks: () => resetChecks(),
    cancelProviderChecks: (provider, clearBatch) => cancelProviderChecks(provider, clearBatch),
    cancelModelCheck: (provider, model) => cancelModelCheck(provider, model),
    resetDiscovery: (preserveResults) => resetDiscovery(preserveResults),
    renameDiscovery: (previousId, nextId) => renameDiscovery(previousId, nextId),
    removeDiscovery: (providerId) => removeDiscovery(providerId),
});

const {
    loading,
    saving,
    activeProviderKey,
    draft,
    activeProvider,
    deleteProviderDialogOpen,
    validationDialogOpen,
    repairingModels,
    isProjectScope,
    dirty,
    validationState,
    validationIssues,
    validationIssueDetails,
    defaultModelOptions,
    enabledModelGroups,
    disabledModels,
    activeProviderEnabledModelCount,
    createProviderKey,
    cloneModel,
    buildProviderRequest,
    buildModelDraft: buildModelCheckDraft,
    credentialSource,
    ensureDefaultModel: ensureDefaultModelKey,
    clearActiveProviderApiKey,
    toggleActiveProviderEnabled,
    renameActiveProviderId,
    cloneActiveProviderConnection,
    requestDeleteActiveProvider,
    confirmDeleteActiveProvider,
    enableModel,
    disableModel,
    deleteModel,
    savedModelIssues,
    displayedContextWindow: resolveDisplayedContextWindow,
    repair: repairModelSettings,
    load: loadSettings,
    save: saveSettings,
    restore: restoreSettings,
} = draftSession;

const templateSession = useProviderTemplateSession({
    draft,
    activeProviderKey,
    createProviderKey,
    cloneModel,
    ensureDefaultModel: ensureDefaultModelKey,
});
const {
    modelLibrary: modelLibraryData,
    selectedTemplate,
    templateOptions: providerTemplateOptions,
    load: loadModelLibraries,
    findModel: findLibraryModel,
    addProvider,
} = templateSession;
loadLibraries = loadModelLibraries;

const editingModel = ref<ModelDraft | null>(null);
const editingTransientCandidate = ref(false);
const modelEditDialogOpen = ref(false);
const expandedGroups = ref<Record<string, boolean>>({});
const modelApiOptions: SelectOption[] = [
    {value: "openai-completions", label: "OpenAI Completions", description: "OpenAI-compatible Chat Completions"},
    {value: "openai-responses", label: "OpenAI Responses", description: "OpenAI Responses API"},
    {value: "anthropic-messages", label: "Anthropic Messages", description: "Anthropic Claude Messages"},
    {value: "google-generative-ai", label: "Google Generative AI", description: "Gemini / Google GenAI"},
    {value: "bedrock-converse-stream", label: "Bedrock Converse", description: "AWS Bedrock Converse Stream"},
];
const modelInputOptions = computed<Array<{value: ModelInputKind; label: string; iconClass: string}>>(() => [
    {value: "text", label: t("settings.panels.models.textInput"), iconClass: "i-lucide-type"},
    {value: "image", label: t("settings.panels.models.imageInput"), iconClass: "i-lucide-image"},
]);

/** 打开已保存模型编辑器。 */
async function openModelEdit(model: ModelDraft): Promise<void> {
    editingTransientCandidate.value = false;
    editingModel.value = model;
    try {
        await loadModelLibraries();
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.models.loadModelLibraryFailed")));
    } finally {
        modelEditDialogOpen.value = true;
    }
}

/** 打开尚未进入 Provider Config 的临时候选编辑器。 */
async function openTransientCandidate(candidate: Omit<ConfiguredModelDto, "enabled">): Promise<void> {
    editingTransientCandidate.value = true;
    editingModel.value = cloneModel({...candidate, enabled: true});
    try {
        await loadModelLibraries();
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.models.loadModelLibraryFailed")));
    } finally {
        modelEditDialogOpen.value = true;
    }
}

/** 只有能力完整的临时候选才能进入 Provider Config。 */
function confirmTransientCandidate(): void {
    const model = editingModel.value;
    if (!editingTransientCandidate.value || !model) {
        return;
    }
    try {
        const candidate = buildModelCheckDraft(model);
        const missingFields = requiredModelFields(candidate);
        if (missingFields.length > 0) {
            notification.error(`模型仍缺少必填字段：${missingFields.join(", ")}`);
            return;
        }
        enableModel({...candidate, enabled: true});
    } catch (error) {
        notification.error(error instanceof Error ? error.message : String(error));
        return;
    }
    editingTransientCandidate.value = false;
    editingModel.value = null;
    modelEditDialogOpen.value = false;
    notification.success(t("settings.panels.models.manualAdded"));
}

const checkSession = useModelCheckSession({
    activeProvider,
    runnableModelKeys: computed(() => validationState.value.runnableModelKeys),
    buildProviderRequest,
    buildModelDraft: buildModelCheckDraft,
    credentialSource,
});
const {
    activeCheckingCount: activeProviderCheckingModelCount,
    checkingAll: checkingAllModels,
    runnable: modelDraftRunnable,
    result: modelCheckResult,
    isChecking: isModelChecking,
    checkModel,
    checkAll: checkAllActiveProviderModels,
    cancelActiveProvider: cancelActiveProviderChecks,
    cancelActiveModel: cancelActiveModelCheck,
} = checkSession;
resetChecks = checkSession.reset;
cancelProviderChecks = (provider, clearBatch) => checkSession.cancelProvider(provider, clearBatch);
cancelModelCheck = checkSession.cancelModel;

const discoverySession = useModelDiscoverySession({
    activeProvider,
    modelLibrary: modelLibraryData,
    loadLibraries: loadModelLibraries,
    findLibraryModel,
    buildProviderRequest,
    credentialSource,
    enableModel,
    disableModel,
    openTransientCandidate,
    ensureDefaultModel: ensureDefaultModelKey,
});
const {
    discoveringProviderId: providerDiscoveringId,
    discoveryDialogOpen: libraryDialogOpen,
    modelLibraryDialogOpen,
    discoverySearchQuery: librarySearchQuery,
    modelLibrarySearchQuery,
    discoveryExpandedGroups: libraryExpandedGroups,
    modelLibraryExpandedGroups,
    discoveryGroups: unifiedLibraryGroups,
    discoveryDiagnostics,
    modelLibraryGroups,
    enabledModelIds,
    manualDraft: getManualModelDraft,
    updateManualField: updateManualModelField,
    discover: discoverModels,
    addManualModel,
    toggleDiscoveredModel: toggleLibraryModel,
    toggleLibraryModel: toggleModelLibraryEntry,
    openModelLibrary,
} = discoverySession;
resetDiscovery = discoverySession.reset;
renameDiscovery = discoverySession.renameProvider;
removeDiscovery = discoverySession.removeProvider;

const editingLibraryModel = computed(() => editingModel.value ? findLibraryModel(editingModel.value.id) : null);
const editingModelMissingFields = computed(() => {
    const model = editingModel.value;
    if (!model) {
        return [];
    }

    // JSON 字段允许在编辑中暂时非法；缺失能力检查只解析基础字段，避免输入半截 JSON 时让弹窗抛错。
    return requiredModelFields({
        api: model.api.trim() || null,
        reasoning: parseModelReasoning(model.reasoning),
        input: parseModelInput(model.input),
        contextWindowTokens: parseDraftInteger(model.contextWindowTokens),
        maxTokens: parseDraftInteger(model.maxTokens),
    });
});

/** 用 Model Library 补齐通用能力，不覆盖 Provider 专属字段。 */
function reapplyLibraryModel(model: ModelDraft): void {
    const libraryModel = findLibraryModel(model.id);
    if (!libraryModel) {
        notification.warning(t("settings.panels.models.noLibraryMetadata"));
        return;
    }
    const completed = candidateFromLibrary(libraryModel, model.api.trim() || activeProvider.value?.modelApi.trim() || null);
    const replacement = completed.status === "complete" ? completed.model : {...completed.candidate, enabled: model.enabled};
    const libraryDraft = cloneModel(replacement);
    Object.assign(model, {
        api: libraryDraft.api,
        reasoning: libraryDraft.reasoning,
        input: libraryDraft.input,
        maxTokens: libraryDraft.maxTokens,
        thinkingLevelMap: libraryDraft.thinkingLevelMap,
        contextWindowTokens: libraryDraft.contextWindowTokens,
    });
}

/** 切换模型输入能力。 */
function toggleModelInput(model: ModelDraft, inputKind: ModelInputKind): void {
    const values = parseModelInput(model.input) ?? [];
    model.input = values.includes(inputKind) ? values.filter((item) => item !== inputKind).join(",") : [...values, inputKind].join(",");
}

function modelInputEnabled(model: ModelDraft, inputKind: ModelInputKind): boolean {
    return (parseModelInput(model.input) ?? []).includes(inputKind);
}

function resetModelCost(model: ModelDraft): void {
    clearModelCostDraft(model.cost);
}

function enableModelCostOverride(model: ModelDraft): void {
    model.cost = createModelCostDraft({input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tiers: []});
}

function toggleGroup(group: string): void {
    expandedGroups.value[group] = !expandedGroups.value[group];
}

function toggleLibraryGroup(group: string): void {
    libraryExpandedGroups.value[group] = !libraryExpandedGroups.value[group];
}

function toggleModelLibraryGroup(group: string): void {
    modelLibraryExpandedGroups.value[group] = !modelLibraryExpandedGroups.value[group];
}

function providerEnabledModelCount(provider: ProviderDraft): number {
    return provider.models.filter((model) => model.enabled).length;
}

function displayModelApi(model: ModelDraft): string {
    return model.api.trim() || t("settings.panels.models.notConfigured");
}

function displayModelApiSource(model: ModelDraft): string {
    return model.api.trim() ? t("settings.panels.models.modelApiSourceModel") : t("settings.panels.models.modelApiSourceMissing");
}

function modelApiInheritLabel(model: ModelDraft): string {
    return model.api.trim() || t("settings.panels.modelEdit.requiredForCustomModel");
}

function modelInputDisplayLabel(model: ModelDraft): string {
    return (parseModelInput(model.input) ?? []).map((item) => modelInputOptions.value.find((option) => option.value === item)?.label ?? item).join(" / ");
}

function modelReasoningDisplayLabel(model: ModelDraft): string {
    const reasoning = parseModelReasoning(model.reasoning);
    return reasoning === null ? t("settings.panels.models.unknown") : reasoning ? t("settings.panels.models.supported") : t("settings.panels.models.unsupported");
}

function formatTokenLimit(value: number | null | undefined): string {
    return typeof value === "number" && Number.isFinite(value)
        ? new Intl.NumberFormat(undefined, {maximumFractionDigits: 0}).format(value)
        : t("settings.panels.models.unknown");
}

function modelContextWindowDefaultLabel(model: ModelDraft): string {
    const value = parseDraftInteger(model.contextWindowTokens);
    return value ? `${formatTokenLimit(value)} tokens` : t("settings.panels.modelEdit.requiredForCustomModel");
}

function modelMaxTokensDefaultLabel(model: ModelDraft): string {
    const value = parseDraftInteger(model.maxTokens);
    return value ? `${formatTokenLimit(value)} tokens` : t("settings.panels.modelEdit.requiredForCustomModel");
}

const savedModelGroups = computed<SavedModelGroupView[]>(() => {
    const provider = activeProvider.value;
    if (!provider) {
        return [];
    }
    return enabledModelGroups.value.map((group) => ({
        group: group.group,
        models: group.models.map((model) => ({
            model,
            apiLabel: displayModelApi(model),
            apiSourceLabel: displayModelApiSource(model),
            contextWindowLabel: resolveDisplayedContextWindow(provider.id, model),
            issues: savedModelIssues(provider.id, model.id),
            checkResult: modelCheckResult(provider, model),
            checking: isModelChecking(provider, model),
            runnable: modelDraftRunnable(provider, model),
        })),
    }));
});

watch(modelEditDialogOpen, (open) => {
    if (!open && editingTransientCandidate.value) {
        editingTransientCandidate.value = false;
        editingModel.value = null;
    }
});
watch(() => [props.scope, props.targetQuery?.workspaceKind, props.targetQuery?.projectRoot] as const, () => void loadSettings());
onMounted(() => void loadSettings());
onBeforeUnmount(() => checkSession.reset());

defineExpose({dirty, loading, saving, saveSettings, restoreSettings});
</script>

<template>
    <!-- 模型设置主容器 -->
    <div class="space-y-4 pt-1">
        <!-- 精简版顶部栏 -->
        <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="max-w-xl">
                <h3 class="text-base font-semibold text-[var(--text-main)]">{{ isProjectScope ? t("settings.panels.models.projectTitle") : t("settings.panels.models.globalTitle") }}</h3>
                <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? t("settings.panels.models.projectDescription", {target: props.targetLabel || t("settings.panels.models.currentProject")}) : t("settings.panels.models.globalDescription") }}</p>
            </div>
        </div>

        <!-- 当前草稿问题：紧凑展示，完整内容放在 title；修复只改草稿，不自动保存。 -->
        <div v-if="validationIssues.length > 0" class="flex min-h-9 items-center gap-2 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-1.5 text-xs text-[var(--text-main)]" :title="validationIssueDetails">
            <span class="i-lucide-triangle-alert h-4 w-4 shrink-0 text-[var(--status-warning)]"></span>
            <span class="shrink-0 font-semibold">{{ t("settings.panels.models.validationIssuesTitle") }}</span>
            <span class="shrink-0 rounded bg-[var(--bg-panel)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">{{ validationIssues.length }}</span>
            <span class="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{{ validationIssues[0]?.message }}</span>
            <button class="inline-flex h-7 shrink-0 items-center justify-center rounded-md px-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="validationDialogOpen = true">{{ t("settings.panels.models.viewAllIssues") }}</button>
            <button class="inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-[var(--status-warning-border)] bg-[var(--bg-panel)] px-2.5 font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="repairingModels" @click="void repairModelSettings()">
                <span class="mr-1 h-3.5 w-3.5" :class="repairingModels ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-wand-sparkles'"></span>
                {{ t("settings.panels.models.oneClickRepair") }}
            </button>
        </div>

        <!-- 顶部默认模型与新增 Provider -->
        <div class="grid gap-4" :class="isProjectScope ? '' : 'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]'">
            <div class="group flex flex-col justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                <div class="mb-3 flex items-center gap-2">
                    <div class="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent-bg)] text-[var(--accent-text)]">
                        <span class="i-lucide-cpu h-3.5 w-3.5"></span>
                    </div>
                    <div class="text-sm font-semibold text-[var(--text-main)]">{{ isProjectScope ? t("settings.panels.models.projectDefaultTitle") : t("settings.panels.models.globalDefaultTitle") }}</div>
                </div>
                <NovelIdeModelSelect
                    :model-value="draft.defaultModelKey"
                    :models="defaultModelOptions"
                    :allow-default="isProjectScope"
                    :default-label="t('settings.panels.models.followGlobalDefault')"
                    :placeholder="t('settings.panels.models.noEnabledModels')"
                    @update:model-value="draft.defaultModelKey = $event"
                />
            </div>

            <div v-if="!isProjectScope" class="group flex flex-col justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                <div class="mb-3 flex items-center gap-2">
                    <div class="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--bg-input)] text-[var(--text-secondary)]">
                        <span class="i-lucide-network h-3.5 w-3.5"></span>
                    </div>
                    <div class="text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.models.addProvider") }}</div>
                </div>
                <div class="flex items-center gap-2">
                    <div class="min-w-0 flex-1">
                        <FormSelect :model-value="selectedTemplate" :options="providerTemplateOptions.map((item) => ({value: item.id, label: item.name}))" @update:model-value="selectedTemplate = $event" />
                    </div>
                    <button class="inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-xs font-medium text-[var(--text-main)] shadow-sm transition-colors hover:bg-[var(--bg-hover)] active:scale-95" @click="void addProvider()">
                        <span class="i-lucide-plus mr-1 h-3 w-3"></span>
                        {{ t("settings.panels.models.add") }}
                    </button>
                </div>
            </div>
        </div>

        <AgentVisibleModelsEditor v-if="!isProjectScope" v-model="draft.agentVisibleModels" :models="defaultModelOptions" :default-model-key="draft.defaultModelKey" />

        <!-- Loading State -->
        <div v-if="loading" class="flex min-h-[400px] flex-col items-center justify-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm">
            <span class="i-lucide-loader-2 h-8 w-8 animate-spin text-[var(--text-muted)]"></span>
            <span class="text-sm text-[var(--text-secondary)]">{{ t("settings.panels.models.loading") }}</span>
        </div>

        <!-- 模型设置双栏布局 -->
        <div v-else-if="!isProjectScope" class="grid min-h-[500px] items-start gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
            <!-- 左侧 Provider 列表 -->
            <aside class="sticky top-4 flex h-fit flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-2 shadow-sm">
                <div class="px-3 pb-3 pt-2">
                    <div class="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">Providers</div>
                    <div class="mt-1 text-xs text-[var(--text-secondary)] opacity-80">{{ t("settings.panels.models.providersHint") }}</div>
                </div>

                <div v-if="draft.providers.length === 0" class="m-2 rounded-xl border border-dashed border-[var(--border-color)] px-4 py-8 text-center text-xs leading-6 text-[var(--text-secondary)]">
                    {{ t("settings.panels.models.noProviders") }}<br>{{ t("settings.panels.models.addProviderFromAbove") }}
                </div>

                <div class="flex flex-col gap-1 overflow-y-auto px-1 pb-1 custom-scrollbar">
                    <button
                        v-for="provider in draft.providers"
                        :key="provider.localKey"
                        class="group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-300"
                        :class="activeProviderKey === provider.localKey ? 'bg-[var(--accent-bg)] text-[var(--accent-text)] shadow-sm' : provider.enabled ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]' : 'text-[var(--text-muted)] opacity-65 hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'"
                        @click="activeProviderKey = provider.localKey"
                    >
                        <!-- 激活状态左侧指示条 -->
                        <div
                            class="absolute left-0 top-1/2 h-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--accent-main)] transition-all duration-300"
                            :class="activeProviderKey === provider.localKey ? 'opacity-100' : 'opacity-0 scale-y-0'"
                        ></div>

                        <span class="h-4 w-4 shrink-0 transition-transform duration-300 group-hover:scale-110" :class="[provider.enabled ? 'i-lucide-server' : 'i-lucide-server-off', activeProviderKey === provider.localKey ? 'text-[var(--accent-main)]' : 'text-[var(--text-muted)]']"></span>
                        <div class="min-w-0 flex-1">
                            <div class="truncate text-[13px] font-medium" :class="activeProviderKey === provider.localKey ? 'text-[var(--accent-text)]' : 'text-[var(--text-main)]'">{{ provider.name }}</div>
                            <div class="mt-0.5 flex min-w-0 items-center gap-1 truncate text-[11px] opacity-70">
                                <span class="truncate">{{ t("settings.panels.models.modelCount", {count: provider.enabled ? providerEnabledModelCount(provider) : 0}) }}</span>
                                <span v-if="!provider.enabled" class="shrink-0 rounded border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-1 text-[10px] text-[var(--status-warning)]">{{ t("settings.panels.models.providerDisabled") }}</span>
                            </div>
                        </div>
                    </button>
                </div>
            </aside>

            <!-- 右侧 Provider 详情 -->
            <div class="relative min-w-0">
                <Transition
                    name="fade-slide"
                    mode="out-in"
                >
                    <section v-if="activeProvider" :key="activeProvider.localKey" class="space-y-5 pb-8">
                        <!-- Provider 连接表单 -->
                        <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm transition-all duration-300 hover:shadow-md">
                            <!-- Provider 操作区 -->
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <div v-if="!activeProvider.enabled" class="inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2.5 py-1 text-xs font-medium text-[var(--status-warning)]">
                                    <span class="i-lucide-server-off h-3.5 w-3.5"></span>
                                    {{ t("settings.panels.models.providerDisabledHint") }}
                                </div>

                                <div class="ml-auto flex flex-wrap items-center justify-end gap-2">
                                    <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium shadow-sm transition-all duration-200 hover:shadow active:scale-95" :class="activeProvider.enabled ? 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)] hover:bg-[var(--status-warning-bg)]' : 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)] hover:bg-[var(--status-success-bg)]'" @click="toggleActiveProviderEnabled">
                                        <span class="h-3.5 w-3.5" :class="activeProvider.enabled ? 'i-lucide-power-off' : 'i-lucide-power'"></span>
                                        {{ activeProvider.enabled ? t("settings.panels.models.disableProvider") : t("settings.panels.models.enableProvider") }}
                                    </button>
                                    <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs font-medium text-[var(--text-main)] shadow-sm transition-all duration-200 hover:bg-[var(--bg-hover)] hover:shadow active:scale-95 disabled:pointer-events-none disabled:opacity-60" :disabled="providerDiscoveringId === activeProvider.id" @click="void discoverModels()">
                                        <span v-if="providerDiscoveringId === activeProvider.id" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                                        <span v-else class="i-lucide-cloud-lightning h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                                        {{ providerDiscoveringId === activeProvider.id ? t("settings.panels.models.discovering") : t("settings.panels.models.discoverModels") }}
                                    </button>
                                    <button v-if="activeProvider.sourceIndex !== undefined" class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs font-medium text-[var(--text-main)] shadow-sm transition-all duration-200 hover:bg-[var(--bg-hover)] hover:shadow active:scale-95" @click="cloneActiveProviderConnection">
                                        <span class="i-lucide-copy-plus h-3.5 w-3.5"></span>
                                        {{ t("settings.panels.models.cloneProvider") }}
                                    </button>
                                    <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 text-xs font-medium text-[var(--status-danger)] shadow-sm transition-all duration-200 hover:bg-[var(--status-danger-bg)] hover:shadow active:scale-95" @click="requestDeleteActiveProvider">
                                        <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                                        {{ t("settings.panels.models.delete") }}
                                    </button>
                                </div>
                            </div>

                            <!-- Provider 表单 -->
                            <div class="mt-4 grid gap-4 md:grid-cols-2">
                                <div class="group space-y-1.5">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">{{ t("settings.panels.models.providerId") }}</label>
                                    <FormInput :model-value="activeProvider.id" :readonly="activeProvider.sourceIndex !== undefined" :placeholder="t('settings.panels.models.providerIdPlaceholder')" @update:model-value="renameActiveProviderId" />
                                    <p v-if="activeProvider.sourceIndex !== undefined" class="text-[11px] leading-5 text-[var(--text-muted)]">{{ t("settings.panels.models.providerIdentityHint") }}</p>
                                </div>
                                <div class="group space-y-1.5">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">{{ t("settings.panels.models.providerName") }}</label>
                                    <FormInput v-model="activeProvider.name" :placeholder="t('settings.panels.models.providerNamePlaceholder')" />
                                </div>
                                <div class="group space-y-1.5 md:col-span-2">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">API Base</label>
                                    <FormInput v-model="activeProvider.options.baseURL" :readonly="activeProvider.sourceIndex !== undefined" :placeholder="t('settings.panels.models.apiBasePlaceholder')" />
                                </div>
                                <div class="group space-y-1.5 md:col-span-2">
                                    <label class="flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]"><span>{{ t("settings.panels.models.providerModelApi") }}</span><span class="text-[var(--status-danger)]" aria-hidden="true">*</span></label>
                                    <FormSelect v-model="activeProvider.modelApi" :options="modelApiOptions" :placeholder="t('settings.panels.models.apiFormat')" />
                                    <p class="text-[11px] leading-5 text-[var(--text-muted)]">{{ t("settings.panels.models.providerModelApiHint") }}</p>
                                </div>
                                <div class="group space-y-1.5 md:col-span-2">
                                    <div class="flex items-center justify-between gap-3">
                                        <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">API Key</label>
                                        <button v-if="activeProvider.options.apiKeyConfigured" type="button" class="text-[11px] text-[var(--status-danger)] transition-colors hover:opacity-80" @click="clearActiveProviderApiKey">{{ t("settings.panels.models.clearApiKey") }}</button>
                                    </div>
                                    <FormInput v-model="activeProvider.options.apiKey" :placeholder="activeProvider.options.apiKeyConfigured ? t('settings.panels.models.configuredApiKeyPlaceholder', {value: activeProvider.options.apiKeyMaskedValue ?? ''}) : 'sk-...'" type="password" />
                                </div>
                                <div class="group space-y-1.5 md:col-span-2">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">{{ t("settings.panels.models.proxy") }}</label>
                                    <FormInput v-model="activeProvider.options.proxy" :readonly="activeProvider.sourceIndex !== undefined" placeholder="http://127.0.0.1:7890" />
                                </div>
                                <div class="group space-y-1.5">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">{{ t("settings.panels.models.requestTimeout") }}</label>
                                    <FormInput v-model="activeProvider.options.timeoutMs" :placeholder="t('settings.panels.models.defaultTimeout')" type="number" />
                                </div>
                                <div class="group space-y-1.5">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">{{ t("settings.panels.models.maxRetries") }}</label>
                                    <FormInput v-model="activeProvider.options.maxRetries" :placeholder="t('settings.panels.models.defaultMaxRetries', {value: DEFAULT_PI_MAX_RETRIES})" min="0" step="1" type="number" />
                                </div>
                                <div class="group space-y-1.5 md:col-span-2">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">{{ t("settings.panels.models.requestOptions") }}</label>
                                    <textarea v-model="activeProvider.options.requestOptions" rows="4" placeholder="{&quot;temperature&quot;:0.7}" class="w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-2 font-mono text-[12px] text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-muted)] placeholder:opacity-80 focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20"></textarea>
                                </div>
                            </div>
                        </div>

                        <SavedModelsList
                            :provider="activeProvider"
                            :groups="savedModelGroups"
                            :disabled-models="disabledModels"
                            :enabled-count="activeProviderEnabledModelCount"
                            :checking-count="activeProviderCheckingModelCount"
                            :checking-all="checkingAllModels"
                            :expanded-groups="expandedGroups"
                            @toggle-group="toggleGroup"
                            @check-all="void checkAllActiveProviderModels()"
                            @cancel-checks="cancelActiveProviderChecks"
                            @check-model="($event) => void checkModel($event)"
                            @cancel-model-check="cancelActiveModelCheck"
                            @edit-model="openModelEdit"
                            @disable-model="disableModel"
                            @delete-model="deleteModel"
                            @open-discovery="libraryDialogOpen = true"
                            @open-library="void openModelLibrary()"
                        />
                    </section>

                    <section v-else class="flex min-h-[400px] flex-col items-center justify-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-8 py-10 text-center shadow-sm">
                        <div class="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--bg-input)] shadow-inner">
                            <span class="i-lucide-server-off h-8 w-8 text-[var(--text-muted)] opacity-50"></span>
                        </div>
                        <div>
                            <div class="text-base font-medium text-[var(--text-main)]">{{ t("settings.panels.models.noProviderSelected") }}</div>
                            <div class="mt-1 text-sm text-[var(--text-secondary)]">{{ t("settings.panels.models.selectProviderHint") }}</div>
                        </div>
                    </section>
                </Transition>
            </div>
        </div>
    </div>

    <Dialog
        v-model="validationDialogOpen"
        :title="t('settings.panels.models.validationIssuesTitle')"
        width="680px"
        height="70%"
        overlay-type="opaque"
        :show-footer="false"
    >
        <!-- 完整模型配置问题列表 -->
        <div class="h-full space-y-2 overflow-y-auto pr-1 custom-scrollbar">
            <div v-for="(issue, index) in validationIssues" :key="`${issue.code}-${issue.path.join('.')}-${String(index)}`" class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2.5">
                <div class="flex flex-wrap items-center gap-2 text-xs">
                    <span class="rounded bg-[var(--status-warning-bg)] px-1.5 py-0.5 font-medium text-[var(--status-warning)]">{{ issue.code }}</span>
                    <span v-if="issue.modelKey" class="font-mono text-[var(--text-main)]">{{ issue.modelKey }}</span>
                </div>
                <p class="mt-1.5 text-sm text-[var(--text-main)]">{{ issue.message }}</p>
                <p class="mt-1 break-all font-mono text-[11px] text-[var(--text-muted)]">{{ issue.path.join(".") }}</p>
            </div>
        </div>
    </Dialog>

    <ModelDiscoveryDialog
        v-if="activeProvider"
        v-model="libraryDialogOpen"
        :provider-name="activeProvider.name"
        :groups="unifiedLibraryGroups"
        :diagnostics="discoveryDiagnostics"
        :search-query="librarySearchQuery"
        :discovering="providerDiscoveringId === activeProvider.id"
        :expanded-groups="libraryExpandedGroups"
        :manual-draft="getManualModelDraft(activeProvider.id)"
        :model-api-options="modelApiOptions"
        @update:search-query="librarySearchQuery = $event"
        @update-manual-field="updateManualModelField"
        @discover="void discoverModels()"
        @toggle-group="toggleLibraryGroup"
        @toggle-model="toggleLibraryModel"
        @add-manual="addManualModel"
    />

    <ModelLibraryDialog
        v-if="activeProvider"
        v-model="modelLibraryDialogOpen"
        :groups="modelLibraryGroups"
        :search-query="modelLibrarySearchQuery"
        :expanded-groups="modelLibraryExpandedGroups"
        :enabled-model-ids="enabledModelIds"
        @update:search-query="modelLibrarySearchQuery = $event"
        @toggle-group="toggleModelLibraryGroup"
        @toggle-model="toggleModelLibraryEntry"
    />

    <Dialog
        v-model="deleteProviderDialogOpen"
        :title="t('settings.panels.models.deleteProviderTitle')"
        width="420px"
        overlay-type="opaque"
        show-cancel
        @confirm="confirmDeleteActiveProvider"
    >
        <div v-if="activeProvider" class="space-y-3">
            <p class="text-sm text-[var(--text-secondary)]">{{ t("settings.panels.models.deleteProviderMessage", {name: activeProvider.name}) }}</p>
            <p class="rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-xs text-[var(--status-warning)]">{{ t("settings.panels.models.deleteProviderWarning") }}</p>
        </div>
    </Dialog>

    <NovelIdeModelEditDialog
        v-model="modelEditDialogOpen"
        :editing-model="editingModel"
        :active-provider="activeProvider"
        :library-model="editingLibraryModel"
        :missing-fields="editingModelMissingFields"
        :model-api-options="modelApiOptions"
        :model-input-options="modelInputOptions"
        :derive-group="deriveModelGroup"
        :model-context-window-default-label="modelContextWindowDefaultLabel"
        :model-max-tokens-default-label="modelMaxTokensDefaultLabel"
        :model-input-display-label="modelInputDisplayLabel"
        :model-input-enabled="modelInputEnabled"
        :model-reasoning-display-label="modelReasoningDisplayLabel"
        @model-id-change="ensureDefaultModelKey"
        @toggle-model-input="toggleModelInput"
        @reset-model-input="($event) => { $event.input = ''; }"
        @reset-model-cost="resetModelCost"
        @enable-model-cost="enableModelCostOverride"
        :confirm-mode="editingTransientCandidate"
        @confirm="confirmTransientCandidate"
        @reapply-library="reapplyLibraryModel"
    />
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

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>

