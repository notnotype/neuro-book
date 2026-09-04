<script setup lang="ts">
import type {AgentProfileModelConfigDto, EnabledModelOptionDto, ThinkingLevelDto} from "nbook/shared/dto/app-settings.dto";
import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";
import NovelIdeModelSelect from "../NovelIdeModelSelect.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import {
    parseStreamSelectValue,
    streamSelectValue,
    type AgentProfileModelDraft,
} from "./agent-profile-draft";

/**
 * 继承语义模式，决定"留空"字段的占位文案和是否提供"继承"选项：
 * - globalDefaults：Global 默认参数，必须落到具体值，没有继承选项；
 * - projectDefaults：Project 默认参数，留空回落 Global；
 * - profile：单个 Profile 覆盖，留空回落所在层的默认参数。
 */
type ModelInheritMode = "globalDefaults" | "projectDefaults" | "profile";

const props = defineProps<{
    modelValue: AgentProfileModelDraft;
    /** 继承基线，用于生成"默认（xxx）"这类提示文案 */
    inherited: AgentProfileModelConfigDto;
    enabledModels: EnabledModelOptionDto[];
    validationIssues: ConfigAgentProfileSettingsDto["validationIssues"];
    inheritMode: ModelInheritMode;
}>();

const emit = defineEmits<{
    (event: "update:modelValue", value: AgentProfileModelDraft): void;
}>();

const {t} = useI18n();

const hasInheritOption = computed(() => props.inheritMode !== "globalDefaults");

const reasoningEffortBaseOptions = computed<SelectOption[]>(() => [
    {value: "off", label: t("settings.panels.profileModels.off")},
    {value: "minimal", label: t("settings.panels.profileModels.minimal")},
    {value: "low", label: t("settings.panels.profileModels.low")},
    {value: "medium", label: t("settings.panels.profileModels.medium")},
    {value: "high", label: t("settings.panels.profileModels.high")},
    {value: "xhigh", label: t("settings.panels.profileModels.xhigh")},
    {value: "max", label: t("settings.panels.profileModels.max")},
]);

function update(patch: Partial<AgentProfileModelDraft>): void {
    emit("update:modelValue", {...props.modelValue, ...patch});
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

function streamLabel(value: boolean): string {
    return value ? t("settings.panels.profileModels.enabled") : t("settings.panels.profileModels.disabled");
}

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

const reasoningEffortOptions = computed<SelectOption[]>(() => {
    if (!hasInheritOption.value) {
        return reasoningEffortBaseOptions.value;
    }
    return [
        {value: "inherit", label: inheritOptionLabel(thinkingLevelLabel(props.inherited.reasoningEffort ?? "off"))},
        ...reasoningEffortBaseOptions.value,
    ];
});

const streamOptions = computed<SelectOption[]>(() => [
    ...(hasInheritOption.value ? [{value: "inherit", label: inheritOptionLabel(streamLabel(props.inherited.stream ?? true))}] : []),
    {value: "true", label: t("settings.panels.profileModels.enabled")},
    {value: "false", label: t("settings.panels.profileModels.disabled")},
]);

/** 为历史无效 modelKey 合成只在当前字段显示的不可运行选项。 */
const modelOptions = computed<EnabledModelOptionDto[]>(() => {
    const normalized = props.modelValue.modelKey?.trim() ?? "";
    if (!normalized || props.enabledModels.some((model) => model.key === normalized)) {
        return props.enabledModels;
    }
    const separatorIndex = normalized.indexOf("/");
    const providerId = separatorIndex > 0 ? normalized.slice(0, separatorIndex) : "invalid";
    const modelId = separatorIndex > 0 ? normalized.slice(separatorIndex + 1) : normalized;
    return [{
        key: normalized,
        label: t("settings.panels.profileModels.unrunnableModel", {key: normalized}),
        providerId,
        modelId: modelId || "invalid",
        input: ["text"],
        contextWindowTokens: null,
    }, ...props.enabledModels];
});

/** 当前模型引用对应的字段级问题；非空时在字段下方提示。 */
const modelIssue = computed(() => {
    const normalized = props.modelValue.modelKey?.trim() ?? "";
    return normalized ? props.validationIssues.find((issue) => issue.modelKey === normalized) ?? null : null;
});
</script>

<template>
    <!-- Agent Profile 模型参数字段：默认参数区与单 Profile 覆盖区共用。 -->
    <div class="grid gap-3 md:grid-cols-2">
        <!-- 默认模型 -->
        <div class="space-y-1.5 md:col-span-2">
            <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.defaultModel") }}</label>
            <NovelIdeModelSelect
                :model-value="props.modelValue.modelKey"
                :models="modelOptions"
                allow-default
                :default-label="modelDefaultLabel"
                :placeholder="t('settings.panels.profileModels.selectDefaultModel')"
                @update:model-value="update({modelKey: $event})"
            />
            <p v-if="modelIssue" class="text-[11px] text-[var(--status-warning)]">{{ modelIssue.message }}</p>
        </div>

        <!-- 温度 -->
        <div class="space-y-1.5">
            <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.temperature") }}</label>
            <FormInput :model-value="props.modelValue.temperature" type="number" step="0.1" min="0" :placeholder="emptyPlaceholder" @update:model-value="update({temperature: $event})" />
        </div>

        <!-- TopK -->
        <div class="space-y-1.5">
            <label class="text-xs font-medium text-[var(--text-secondary)]">TopK</label>
            <FormInput :model-value="props.modelValue.topK" type="number" step="1" min="1" :placeholder="emptyPlaceholder" @update:model-value="update({topK: $event})" />
        </div>

        <!-- 推理强度 -->
        <div class="space-y-1.5">
            <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.reasoningEffort") }}</label>
            <FormSelect
                :model-value="props.modelValue.reasoningEffort ?? 'inherit'"
                :options="reasoningEffortOptions"
                @update:model-value="update({reasoningEffort: $event === 'inherit' ? null : $event as ThinkingLevelDto})"
            />
        </div>

        <!-- 流式 -->
        <div class="space-y-1.5">
            <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.stream") }}</label>
            <FormSelect :model-value="streamSelectValue(props.modelValue.stream)" :options="streamOptions" @update:model-value="update({stream: parseStreamSelectValue($event)})" />
        </div>
    </div>
</template>
