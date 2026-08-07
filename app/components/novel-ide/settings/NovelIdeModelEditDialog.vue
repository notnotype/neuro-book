<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {Mode} from "vanilla-jsoneditor";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import JsonViewer from "nbook/app/components/common/JsonViewer.vue";
import {hasModelCostOverride, parseModelCostDraft, type ModelCostDraft} from "nbook/app/components/novel-ide/settings/model-cost-draft";
import {parseModelCompat, parseStringMap} from "nbook/app/components/novel-ide/settings/model-settings-draft";
import type {ModelInputKind, ModelLibraryEntryDto} from "nbook/shared/dto/app-settings.dto";

type ModelDraft = {
    localKey: string;
    name: string;
    id: string;
    group: string;
    enabled: boolean;
    api: string;
    reasoning: "inherit" | "true" | "false";
    input: string;
    maxTokens: string;
    cost: ModelCostDraft;
    compat: string;
    headers: string;
    thinkingLevelMap: string;
    contextWindowTokens: string;
};

type ProviderDraft = {
    id: string;
    name: string;
};

type ModelEditTab = "identity" | "capabilities" | "request" | "cost";
type JsonFieldKey = "compat" | "headers" | "thinkingLevelMap";
type JsonFieldState = "empty" | "valid" | "invalid";

const props = defineProps<{
    modelValue: boolean;
    editingModel: ModelDraft | null;
    activeProvider: ProviderDraft | null;
    /** 当前模型在 NeuroBook Model Library 中的标准资料；未命中时为空。 */
    libraryModel: ModelLibraryEntryDto | null;
    confirmMode?: boolean;
    missingFields: string[];
    modelApiOptions: SelectOption[];
    modelInputOptions: Array<{value: ModelInputKind; label: string; iconClass: string}>;
    deriveGroup: (modelId: string) => string;
    modelContextWindowDefaultLabel: (model: ModelDraft) => string;
    modelMaxTokensDefaultLabel: (model: ModelDraft) => string;
    modelInputDisplayLabel: (model: ModelDraft) => string;
    modelInputEnabled: (model: ModelDraft, inputKind: ModelInputKind) => boolean;
    modelReasoningDisplayLabel: (model: ModelDraft) => string;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "model-id-change"): void;
    (e: "toggle-model-input", model: ModelDraft, inputKind: ModelInputKind): void;
    (e: "reset-model-input", model: ModelDraft): void;
    (e: "reset-model-cost", model: ModelDraft): void;
    (e: "enable-model-cost", model: ModelDraft): void;
    (e: "reapply-library", model: ModelDraft): void;
    (e: "confirm"): void;
}>();

const {t} = useI18n();
const activeTab = ref<ModelEditTab>("identity");
const activeJsonFieldKey = ref<JsonFieldKey>("compat");

const tabs = computed<Array<{key: ModelEditTab; label: string; iconClass: string}>>(() => [
    {key: "identity", label: t("settings.panels.modelEdit.tabs.identity"), iconClass: "i-lucide-id-card"},
    {key: "capabilities", label: t("settings.panels.modelEdit.tabs.capabilities"), iconClass: "i-lucide-sliders-horizontal"},
    {key: "request", label: t("settings.panels.modelEdit.tabs.request"), iconClass: "i-lucide-braces"},
    {key: "cost", label: t("settings.panels.modelEdit.tabs.cost"), iconClass: "i-lucide-coins"},
]);

const jsonFields = computed<Array<{key: JsonFieldKey; label: string; description: string; iconClass: string}>>(() => [
    {key: "compat", label: t("settings.panels.modelEdit.jsonFields.compat"), description: t("settings.panels.modelEdit.jsonFields.compatDescription"), iconClass: "i-lucide-braces"},
    {key: "headers", label: t("settings.panels.modelEdit.jsonFields.headers"), description: t("settings.panels.modelEdit.jsonFields.headersDescription"), iconClass: "i-lucide-list"},
    {key: "thinkingLevelMap", label: t("settings.panels.modelEdit.jsonFields.thinking"), description: t("settings.panels.modelEdit.jsonFields.thinkingDescription"), iconClass: "i-lucide-brain"},
]);

const activeJsonField = computed(() => jsonFields.value.find((field) => field.key === activeJsonFieldKey.value) ?? jsonFields.value[0]);

const reasoningOptions = computed<SelectOption[]>(() => [
    {value: "true", label: t("settings.panels.modelEdit.supported")},
    {value: "false", label: t("settings.panels.modelEdit.unsupported")},
]);

const costFields = computed<Array<{key: keyof Pick<ModelCostDraft, "input" | "output" | "cacheRead" | "cacheWrite">; label: string; placeholder: string}>>(() => [
    {key: "input", label: t("settings.panels.modelEdit.costInput"), placeholder: "0.14"},
    {key: "output", label: t("settings.panels.modelEdit.costOutput"), placeholder: "0.28"},
    {key: "cacheRead", label: t("settings.panels.modelEdit.costCacheRead"), placeholder: "0.0028"},
    {key: "cacheWrite", label: t("settings.panels.modelEdit.costCacheWrite"), placeholder: "0"},
]);

const costValidationError = computed(() => {
    const model = props.editingModel;
    if (!model || !hasModelCostOverride(model.cost)) {
        return "";
    }
    try {
        parseModelCostDraft(model.cost);
        return "";
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
});

/** 打开新模型时从基础信息页开始，切换模型时避免残留上一次的 JSON 字段。 */
watch(() => [props.modelValue, props.editingModel?.localKey] as const, ([visible]) => {
    if (visible) {
        activeTab.value = "identity";
        activeJsonFieldKey.value = "compat";
    }
});

/** 回写 JSON 编辑器的文本或结构化结果；tree/table 模式不能静默丢弃对象更新。 */
function updateJsonField(key: JsonFieldKey, value: unknown): void {
    if (!props.editingModel) {
        return;
    }
    if (typeof value === "string") {
        props.editingModel[key] = value;
        return;
    }
    if (value === null || typeof value === "object") {
        props.editingModel[key] = value === null ? "" : JSON.stringify(value, null, 2);
    }
}

/** 在页签列表中显示 JSON 字段的即时状态，不提前修改用户正在输入的内容。 */
function jsonFieldState(key: JsonFieldKey): JsonFieldState {
    const value = props.editingModel?.[key].trim() ?? "";
    if (!value) {
        return "empty";
    }
    try {
        if (key === "compat") {
            parseModelCompat(value);
        } else {
            parseStringMap(value);
        }
        return "valid";
    } catch {
        return "invalid";
    }
}

/** 将 JSON 状态映射为可读标签，图标仍负责快速扫描。 */
function jsonFieldStateLabel(key: JsonFieldKey): string {
    return t(`settings.panels.modelEdit.jsonState.${jsonFieldState(key)}`);
}

/** 新增一档长上下文价格，默认复制基础价格以减少漏填。 */
function addCostTier(model: ModelDraft): void {
    model.cost.tiers.push({
        inputTokensAbove: "",
        input: model.cost.input,
        output: model.cost.output,
        cacheRead: model.cost.cacheRead,
        cacheWrite: model.cost.cacheWrite,
    });
}

/** 判断当前模型是否记录了价格。 */
function modelCostSourceLabel(model: ModelDraft): string {
    return hasModelCostOverride(model.cost) ? t("settings.panels.modelEdit.customOverride") : t("settings.panels.models.unknown");
}

/** 关闭模型编辑弹窗。 */
function updateOpen(value: boolean): void {
    emit("update:modelValue", value);
}
</script>

<template>
    <!-- 模型编辑 Dialog：摘要、页签和内容区各自承担单一职责。 -->
    <Dialog
        :model-value="props.modelValue"
        :title="t('settings.panels.modelEdit.title')"
        width="min(980px, calc(100vw - 24px))"
        height="min(760px, calc(100vh - 24px))"
        max-height="calc(100vh - 24px)"
        overlay-type="opaque"
        :show-footer="props.confirmMode ?? false"
        :show-cancel="props.confirmMode ?? false"
        body-class="!min-h-0 !gap-0 !overflow-hidden !p-0"
        @confirm="emit('confirm')"
        @update:model-value="updateOpen"
    >
        <div v-if="props.editingModel" class="flex min-h-0 flex-1 flex-col bg-[var(--bg-panel)]">
            <!-- 模型摘要：跨页签固定显示当前对象和来源。 -->
            <div class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border-color)] px-6 py-3">
                <div class="flex min-w-0 flex-1 items-center gap-3">
                    <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-bg)] text-[var(--accent-text)]"><span class="i-lucide-cpu h-5 w-5"></span></span>
                    <div class="min-w-0">
                        <div class="truncate text-sm font-semibold text-[var(--text-main)]">{{ props.editingModel.name || props.editingModel.id || t("settings.panels.modelEdit.untitled") }}</div>
                        <div class="truncate font-mono text-[11px] text-[var(--text-muted)]">{{ props.editingModel.id || t("settings.panels.modelEdit.modelId") }}</div>
                    </div>
                </div>
                <div class="flex max-w-full flex-wrap items-center gap-2 text-[10px]">
                    <span v-if="props.activeProvider" class="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2 py-1 text-[var(--text-secondary)]"><span class="i-lucide-plug h-3 w-3"></span><span class="truncate">{{ props.activeProvider.name }}</span></span>
                    <span class="inline-flex items-center gap-1.5 rounded-md border px-2 py-1" :class="props.missingFields.length ? 'border-[var(--status-warning-border)] text-[var(--status-warning)]' : 'border-[var(--status-success-border)] text-[var(--status-success)]'">
                        <span class="h-1.5 w-1.5 rounded-full" :class="props.missingFields.length ? 'bg-[var(--status-warning)]' : 'bg-[var(--status-success)]'"></span>
                        {{ props.missingFields.length ? t("settings.panels.modelEdit.incomplete") : t("settings.panels.modelEdit.ready") }}
                    </span>
                </div>
            </div>

            <!-- 主页签：避免将低频高级字段和基础字段同时铺开。 -->
            <nav class="shrink-0 overflow-x-auto border-b border-[var(--border-color)] px-4" aria-label="模型编辑分区">
                <div class="flex min-w-max items-center gap-1">
                    <button v-for="tab in tabs" :key="tab.key" type="button" class="inline-flex h-11 items-center gap-2 border-b-2 px-3 text-xs font-medium transition-colors" :class="activeTab === tab.key ? 'border-[var(--accent-main)] text-[var(--accent-text)]' : 'border-transparent text-[var(--text-muted)] hover:border-[var(--border-color)] hover:text-[var(--text-main)]'" @click="activeTab = tab.key">
                        <span :class="tab.iconClass" class="h-3.5 w-3.5"></span>{{ tab.label }}
                    </button>
                </div>
            </nav>

            <!-- 页签内容区 -->
            <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5 custom-scrollbar">
                <!-- 基本信息 -->
                <section v-if="activeTab === 'identity'" class="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
                    <div class="space-y-5">
                        <div>
                            <h3 class="text-base font-semibold text-[var(--text-main)]">{{ t("settings.panels.modelEdit.basicInfo") }}</h3>
                            <p class="mt-1 text-xs text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.identityDescription") }}</p>
                        </div>
                        <div class="grid gap-4 sm:grid-cols-2">
                            <div class="space-y-1.5 sm:col-span-2">
                                <label class="text-xs font-semibold text-[var(--text-secondary)]">{{ t("settings.panels.modelEdit.modelName") }}</label>
                                <FormInput v-model="props.editingModel.name" :placeholder="t('settings.panels.modelEdit.modelName')" />
                            </div>
                            <div class="space-y-1.5">
                                <label class="text-xs font-semibold text-[var(--text-secondary)]">{{ t("settings.panels.modelEdit.modelId") }}</label>
                                <FormInput v-model="props.editingModel.id" :placeholder="t('settings.panels.modelEdit.modelId')" @update:model-value="emit('model-id-change')" />
                            </div>
                            <div class="space-y-1.5">
                                <label class="text-xs font-semibold text-[var(--text-secondary)]">{{ t("settings.panels.modelEdit.group") }}</label>
                                <FormInput v-model="props.editingModel.group" :placeholder="t('settings.panels.modelEdit.defaultDerived', {group: props.deriveGroup(props.editingModel.id)})" />
                            </div>
                        </div>
                    </div>

                    <div class="space-y-5 border-t border-[var(--border-color)] pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                        <div>
                            <h3 class="text-base font-semibold text-[var(--text-main)]">{{ t("settings.panels.modelEdit.apiConfig") }}</h3>
                            <p class="mt-1 text-xs text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.apiDescription") }}</p>
                        </div>
                        <div class="space-y-2">
                            <label class="text-xs font-semibold text-[var(--text-secondary)]">{{ t("settings.panels.modelEdit.apiFormat") }}</label>
                            <FormSelect v-model="props.editingModel.api" :options="props.modelApiOptions" />
                        </div>
                        <div class="space-y-3 border-l-2 border-[var(--accent-main)] pl-3">
                            <div v-if="props.libraryModel">
                                <div class="flex items-center gap-2 text-xs font-medium text-[var(--text-main)]"><span class="i-lucide-database h-3.5 w-3.5 text-[var(--accent-text)]"></span>{{ t("settings.panels.modelEdit.libraryMatched") }}</div>
                                <p class="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">{{ props.libraryModel.source }}</p>
                                <button type="button" class="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--accent-main)] px-2.5 text-[11px] font-medium text-[var(--accent-text)] transition-colors hover:bg-[var(--accent-bg)]" @click="emit('reapply-library', props.editingModel)"><span class="i-lucide-refresh-cw h-3.5 w-3.5"></span>{{ t("settings.panels.modelEdit.reapplyLibrary") }}</button>
                            </div>
                            <div v-else class="text-xs leading-5 text-[var(--status-warning)]"><span class="i-lucide-circle-alert mr-1.5 inline-block h-3.5 w-3.5 align-text-bottom"></span>{{ t("settings.panels.modelEdit.libraryMissing") }}</div>
                            <p v-if="props.missingFields.length" class="text-[11px] leading-5 text-[var(--status-danger)]">{{ t("settings.panels.modelEdit.missingFields", {fields: props.missingFields.join(", ")}) }}</p>
                        </div>
                    </div>
                </section>

                <!-- 能力与限制 -->
                <section v-else-if="activeTab === 'capabilities'" class="space-y-8">
                    <div>
                        <h3 class="text-base font-semibold text-[var(--text-main)]">{{ t("settings.panels.modelEdit.tabs.capabilities") }}</h3>
                        <p class="mt-1 text-xs text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.capabilitiesDescription") }}</p>
                    </div>
                    <div class="grid gap-8 lg:grid-cols-2">
                        <div class="space-y-5">
                            <div class="border-b border-[var(--border-color)] pb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.limits") }}</div>
                            <div class="space-y-2">
                                <div class="flex items-center justify-between gap-3"><label class="text-xs font-semibold text-[var(--text-secondary)]">{{ t("settings.panels.modelEdit.contextWindow") }}</label><span class="text-[10px] text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.emptyLabel", {value: props.modelContextWindowDefaultLabel(props.editingModel)}) }}</span></div>
                                <FormInput v-model="props.editingModel.contextWindowTokens" type="number" :placeholder="props.modelContextWindowDefaultLabel(props.editingModel)" />
                                <p class="text-[11px] leading-5 text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.contextWindowDescription") }}</p>
                            </div>
                            <div class="space-y-2">
                                <div class="flex items-center justify-between gap-3"><label class="text-xs font-semibold text-[var(--text-secondary)]">Max Tokens</label><span class="text-[10px] text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.emptyLabel", {value: props.modelMaxTokensDefaultLabel(props.editingModel)}) }}</span></div>
                                <FormInput v-model="props.editingModel.maxTokens" type="number" :placeholder="props.modelMaxTokensDefaultLabel(props.editingModel)" />
                                <p class="text-[11px] leading-5 text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.maxTokensDescription") }}</p>
                            </div>
                        </div>

                        <div class="space-y-5 border-t border-[var(--border-color)] pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                            <div class="border-b border-[var(--border-color)] pb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.capabilities") }}</div>
                            <div class="space-y-2">
                                <div class="flex items-center justify-between gap-3"><label class="text-xs font-semibold text-[var(--text-secondary)]">{{ t("settings.panels.modelEdit.inputCapability") }}</label><span class="text-[10px] text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.currentLabel", {value: props.modelInputDisplayLabel(props.editingModel)}) }}</span></div>
                                <div class="grid grid-cols-2 gap-1 rounded-lg border border-[var(--border-color)] p-1">
                                    <button v-for="option in props.modelInputOptions" :key="option.value" type="button" class="inline-flex h-9 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors" :class="props.modelInputEnabled(props.editingModel, option.value) ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'" :title="t('settings.panels.modelEdit.inputTitle', {label: option.label})" @click="emit('toggle-model-input', props.editingModel, option.value)"><span class="h-3.5 w-3.5" :class="option.iconClass"></span>{{ option.label }}</button>
                                </div>
                            </div>
                            <div class="space-y-2">
                                <div class="flex items-center justify-between gap-3"><label class="text-xs font-semibold text-[var(--text-secondary)]">{{ t("settings.panels.modelEdit.reasoningCapability") }}</label><span class="text-[10px] text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.currentLabel", {value: props.modelReasoningDisplayLabel(props.editingModel)}) }}</span></div>
                                <FormSelect v-model="props.editingModel.reasoning" :options="reasoningOptions" />
                                <p class="text-[11px] leading-5 text-[var(--text-muted)]"><span class="i-lucide-info mr-1 inline-block h-3.5 w-3.5 align-text-bottom"></span>{{ t("settings.panels.modelEdit.reasoningDescription") }}</p>
                            </div>
                        </div>
                    </div>
                </section>

                <!-- 请求参数 JSON -->
                <section v-else-if="activeTab === 'request'" class="flex min-h-[430px] flex-col gap-5">
                    <div>
                        <h3 class="text-base font-semibold text-[var(--text-main)]">{{ t("settings.panels.modelEdit.tabs.request") }}</h3>
                        <p class="mt-1 text-xs text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.requestDescription") }}</p>
                    </div>
                    <div class="grid min-h-0 flex-1 gap-5 md:grid-cols-[210px_minmax(0,1fr)]">
                        <aside class="flex min-w-0 flex-row gap-1 overflow-x-auto md:flex-col md:border-r md:border-[var(--border-color)] md:pr-4">
                            <button v-for="field in jsonFields" :key="field.key" type="button" class="flex min-w-[170px] items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs transition-colors md:min-w-0" :class="activeJsonFieldKey === field.key ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'" @click="activeJsonFieldKey = field.key">
                                <span :class="field.iconClass" class="h-3.5 w-3.5 shrink-0"></span>
                                <span class="min-w-0 flex-1 truncate">{{ field.label }}</span>
                                <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="jsonFieldState(field.key) === 'invalid' ? 'bg-[var(--status-danger)]' : jsonFieldState(field.key) === 'valid' ? 'bg-[var(--status-success)]' : 'bg-[var(--text-muted)]'" :title="jsonFieldStateLabel(field.key)"></span>
                            </button>
                        </aside>
                        <div v-if="activeJsonField" class="flex min-h-0 min-w-0 flex-1 flex-col">
                            <div class="mb-3 flex items-start justify-between gap-3">
                                <div class="min-w-0"><h4 class="text-sm font-semibold text-[var(--text-main)]">{{ activeJsonField.label }}</h4><p class="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">{{ activeJsonField.description }}</p></div>
                                <span class="shrink-0 text-[10px]" :class="jsonFieldState(activeJsonField.key) === 'invalid' ? 'text-[var(--status-danger)]' : jsonFieldState(activeJsonField.key) === 'valid' ? 'text-[var(--status-success)]' : 'text-[var(--text-muted)]'">{{ jsonFieldStateLabel(activeJsonField.key) }}</span>
                            </div>
                            <JsonViewer :key="activeJsonField.key" class="min-h-0 min-w-0 flex-1" :value="props.editingModel[activeJsonField.key]" :mode="Mode.text" :read-only="false" :status-bar="true" :max-height="0" @update:value="updateJsonField(activeJsonField.key, $event)" />
                        </div>
                    </div>
                </section>

                <!-- 价格 -->
                <section v-else class="space-y-7">
                    <div class="flex flex-wrap items-start justify-between gap-4">
                        <div><h3 class="text-base font-semibold text-[var(--text-main)]">{{ t("settings.panels.modelEdit.modelCost") }}</h3><p class="mt-1 text-xs text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.costDescription") }}</p></div>
                        <span class="rounded-md border border-[var(--border-color)] px-2 py-1 text-[10px]" :class="hasModelCostOverride(props.editingModel.cost) ? 'text-[var(--accent-text)]' : 'text-[var(--text-muted)]'">{{ modelCostSourceLabel(props.editingModel) }}</span>
                    </div>
                    <div v-if="!hasModelCostOverride(props.editingModel.cost)" class="border-l-2 border-[var(--border-color)] pl-4">
                        <p class="text-xs leading-5 text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.noCostDescription") }}</p>
                        <button type="button" class="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--accent-main)] px-2.5 text-[11px] font-medium text-[var(--accent-text)] transition-colors hover:bg-[var(--accent-bg)]" @click="emit('enable-model-cost', props.editingModel)"><span class="i-lucide-pencil h-3.5 w-3.5"></span>{{ t("settings.panels.modelEdit.enableCostOverride") }}</button>
                    </div>
                    <template v-else>
                        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <div v-for="field in costFields" :key="field.key" class="space-y-1.5"><label class="text-xs font-medium text-[var(--text-secondary)]">{{ field.label }}</label><FormInput v-model="props.editingModel.cost[field.key]" type="number" min="0" step="0.000001" :placeholder="field.placeholder" /><span class="text-[10px] text-[var(--text-muted)]">USD / 1M tokens</span></div>
                        </div>
                        <div class="space-y-3 border-t border-[var(--border-color)] pt-5">
                            <div class="flex items-center justify-between gap-3"><h4 class="text-xs font-semibold text-[var(--text-secondary)]">{{ t("settings.panels.modelEdit.costTiers") }}</h4><button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]" @click="addCostTier(props.editingModel)"><span class="i-lucide-plus h-3.5 w-3.5"></span>{{ t("settings.panels.modelEdit.addCostTier") }}</button></div>
                            <div v-for="(tier, index) in props.editingModel.cost.tiers" :key="index" class="space-y-3 border-b border-[var(--border-color)] pb-4 last:border-b-0">
                                <div class="flex items-center justify-between gap-3"><label class="text-[11px] font-medium text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.costTierThreshold") }}</label><button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--status-danger)] transition-colors hover:bg-[var(--status-danger-bg)]" :title="t('settings.panels.modelEdit.removeCostTier')" @click="props.editingModel.cost.tiers.splice(index, 1)"><span class="i-lucide-trash-2 h-3.5 w-3.5"></span></button></div>
                                <FormInput v-model="tier.inputTokensAbove" type="number" min="0" step="1" placeholder="200000" />
                                <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div v-for="field in costFields" :key="field.key" class="space-y-1"><label class="text-[10px] text-[var(--text-muted)]">{{ field.label }}</label><FormInput v-model="tier[field.key]" type="number" min="0" step="0.000001" /></div></div>
                            </div>
                            <p v-if="costValidationError" class="text-[11px] text-[var(--status-danger)]">{{ costValidationError }}</p>
                            <div class="flex items-center justify-between gap-3 pt-1"><span class="text-[11px] leading-5 text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.costClearDescription") }}</span><button type="button" class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]" :title="t('settings.panels.modelEdit.clearCostTitle')" @click="emit('reset-model-cost', props.editingModel)"><span class="i-lucide-rotate-ccw h-3.5 w-3.5"></span>{{ t("settings.panels.modelEdit.clear") }}</button></div>
                        </div>
                    </template>
                </section>
            </div>
        </div>
    </Dialog>
</template>
