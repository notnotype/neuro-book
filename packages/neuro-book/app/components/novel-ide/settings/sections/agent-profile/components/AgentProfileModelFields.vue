<script setup lang="ts">
import {computed} from "vue";
import {FormField, FormInput, FormSelect, type FormSelectOption} from "@notnotype/nb-ui/components";
import type {AgentProfileModelConfigDto, EnabledModelOptionDto, ThinkingLevelDto} from "nbook/shared/dto/app-settings.dto";
import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";
import {
    parseStreamSelectValue,
    streamSelectValue,
    type AgentProfileModelDraft,
    type AgentProfileModelFieldErrors,
} from "../agent-profile-draft";
/**
 * 继承语义模式，决定"留空"字段的占位文案和是否提供"继承"选项：
 * - globalDefaults：Global 默认参数，必须落到具体值，没有继承选项；
 * - projectDefaults：Project 默认参数，留空回落 Global；
 * - profile：单个 Profile 覆盖，留空回落所在层的默认参数。
 */
type ModelInheritMode = "globalDefaults" | "projectDefaults" | "profile";

const props = withDefaults(defineProps<{
    modelValue: AgentProfileModelDraft;
    inherited: AgentProfileModelConfigDto;
    enabledModels: EnabledModelOptionDto[];
    validationIssues: ConfigAgentProfileSettingsDto["validationIssues"];
    inheritMode: ModelInheritMode;
    visibleFields?: ("model" | "reasoning" | "advanced")[];
    errors?: AgentProfileModelFieldErrors;
    disabled?: boolean;
}>(), {
    visibleFields: () => ["model", "reasoning", "advanced"] as ("model" | "reasoning" | "advanced")[],
    errors: () => ({}),
    disabled: false,
});

const emit = defineEmits<{
    (event: "update:modelValue", value: AgentProfileModelDraft): void;
}>();

const {t} = useI18n();

const hasInheritOption = computed(() => props.inheritMode !== "globalDefaults");

const reasoningEffortBaseOptions = computed<FormSelectOption[]>(() => [
    {value: "off", label: t("settings.panels.profileModels.off")},
    {value: "minimal", label: t("settings.panels.profileModels.minimal")},
    {value: "low", label: t("settings.panels.profileModels.low")},
    {value: "medium", label: t("settings.panels.profileModels.medium")},
    {value: "high", label: t("settings.panels.profileModels.high")},
    {value: "xhigh", label: t("settings.panels.profileModels.xhigh")},
    {value: "max", label: t("settings.panels.profileModels.max")},
]);

/** 继承选项的文案：Project 默认参数说"继承 Global"，Profile 覆盖说"默认"。 */
function inheritOptionLabel(value: string): string {
    return props.inheritMode === "projectDefaults"
        ? t("settings.panels.profileModels.inheritGlobal", {value})
        : t("settings.panels.profileModels.defaultValue", {value});
}

/** 数值字段留空时的占位提示。 */
const emptyPlaceholder = computed(() => {
    switch (props.inheritMode) {
        case "globalDefaults": return t("settings.panels.profileModels.emptyPlaceholder");
        case "projectDefaults": return t("settings.panels.profileModels.inheritGlobalPlaceholder");
        case "profile": return t("settings.panels.profileModels.defaultPlaceholder");
    }
});

/** 模型下拉里"跟随默认"那一项的文案。 */
const modelDefaultLabel = computed(() => {
    if (props.inheritMode === "globalDefaults") {
        return t("settings.panels.profileModels.followGlobalDefaultModel");
    }
    const inheritedKey = props.inherited.modelKey;
    if (props.inheritMode === "projectDefaults") {
        return inheritedKey
            ? t("settings.panels.profileModels.inheritGlobal", {value: inheritedKey})
            : t("settings.panels.profileModels.inheritGlobalDefaultModel");
    }
    return inheritedKey
        ? t("settings.panels.profileModels.defaultValue", {value: inheritedKey})
        : t("settings.panels.profileModels.defaultGlobalModel");
});

const reasoningEffortOptions = computed<FormSelectOption[]>(() => {
    if (!hasInheritOption.value) {
        return reasoningEffortBaseOptions.value;
    }
    return [
        {value: "inherit", label: inheritOptionLabel(thinkingLevelLabel(props.inherited.reasoningEffort ?? "off"))},
        ...reasoningEffortBaseOptions.value,
    ];
});

/**
 * 下拉显示值：有继承选项时草稿 null 显示 "inherit"；
 * globalDefaults 模式没有继承选项，草稿空值按基线落定显示，否则触发器会渲染成空白。
 */
const reasoningDisplayValue = computed(() => props.modelValue.reasoningEffort
    ?? (hasInheritOption.value ? "inherit" : props.inherited.reasoningEffort ?? "off"));
const streamDisplayValue = computed(() => props.modelValue.stream !== null || hasInheritOption.value
    ? streamSelectValue(props.modelValue.stream)
    : streamSelectValue(props.inherited.stream ?? true));
const streamOptions = computed<FormSelectOption[]>(() => [
    ...(hasInheritOption.value ? [{value: "inherit", label: inheritOptionLabel(streamLabel(props.inherited.stream ?? true))}] : []),
    {value: "true", label: t("settings.panels.profileModels.enabled")},
    {value: "false", label: t("settings.panels.profileModels.disabled")},
]);

function streamLabel(value: boolean): string {
    return value ? t("settings.panels.profileModels.enabled") : t("settings.panels.profileModels.disabled");
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

const modelOptions = computed<FormSelectOption[]>(() => props.enabledModels.map((model) => ({
    value: model.key,
    label: model.label,
    description: model.providerId ? `${model.providerId} · ${model.modelId}` : model.modelId,
})));

/** 当前模型引用是否为已启用模型之外的历史值；保留原 key 显示，不悄悄替换。 */
const modelOutOfList = computed(() => {
    const normalized = props.modelValue.modelKey?.trim() ?? "";
    return Boolean(normalized) && !props.enabledModels.some((model) => model.key === normalized);
});

/** 当前模型引用对应的字段级问题；非空时在字段下方提示。 */
const modelIssue = computed(() => {
    const normalized = props.modelValue.modelKey?.trim() ?? "";
    return normalized ? props.validationIssues.find((issue) => issue.modelKey === normalized) ?? null : null;
});

function update(patch: Partial<AgentProfileModelDraft>): void {
    emit("update:modelValue", {...props.modelValue, ...patch});
}
</script>

<template>
    <div class="grid gap-3 md:grid-cols-2">
        <template v-if="props.visibleFields.includes('model')">
            <FormField class="md:col-span-2" :label="t('settings.panels.profileModels.defaultModel')" :description="modelDefaultLabel">
                <FormSelect
                    :model-value="props.modelValue.modelKey ?? ''"
                    :options="modelOptions"
                    :placeholder="t('settings.panels.profileModels.selectDefaultModel')"
                    :disabled="props.disabled"
                    @update:model-value="update({modelKey: $event || null})"
                />
            </FormField>
            <p v-if="modelOutOfList" class="text-[11px] text-[var(--status-warning)] md:col-span-2">{{ t("settings.panels.profileModels.unrunnableModel", {key: props.modelValue.modelKey ?? ""}) }}</p>
            <p v-else-if="modelIssue" class="text-[11px] text-[var(--status-warning)] md:col-span-2">{{ modelIssue.message }}</p>
            <p v-if="props.enabledModels.length === 0" class="text-[11px] text-[var(--text-muted)] md:col-span-2">{{ t("settings.panels.profileModels.settingsView.invalidModel") }}</p>
        </template>

        <FormField v-if="props.visibleFields.includes('reasoning')" :label="t('settings.panels.profileModels.reasoningEffort')">
            <FormSelect
                :model-value="reasoningDisplayValue"
                :options="reasoningEffortOptions"
                :disabled="props.disabled"
                @update:model-value="update({reasoningEffort: $event === 'inherit' ? null : $event as ThinkingLevelDto})"
            />
        </FormField>

        <template v-if="props.visibleFields.includes('advanced')">
            <FormField :label="t('settings.panels.profileModels.temperature')" :error="props.errors?.temperature">
                <FormInput :model-value="props.modelValue.temperature" type="number" step="0.1" min="0" :placeholder="emptyPlaceholder" :disabled="props.disabled" @update:model-value="update({temperature: $event})" />
            </FormField>
            <FormField label="TopK" :error="props.errors?.topK">
                <FormInput :model-value="props.modelValue.topK" type="number" step="1" min="1" :placeholder="emptyPlaceholder" :disabled="props.disabled" @update:model-value="update({topK: $event})" />
            </FormField>
            <FormField :label="t('settings.panels.profileModels.stream')">
                <FormSelect :model-value="streamDisplayValue" :options="streamOptions" :disabled="props.disabled" @update:model-value="update({stream: parseStreamSelectValue($event)})" />
            </FormField>
        </template>
    </div>
</template>
