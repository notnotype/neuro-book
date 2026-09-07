<script setup lang="ts">
import {computed} from "vue";
import {FormField, FormInput, FormSelect, FormTextarea, type FormSelectOption} from "@notnotype/nb-ui/components";
import type {ProfileRuntimeSettingsDraft, ProfileRuntimeSettingsErrors, ProfileRuntimeSettingsField, ProfileRuntimeSettingsSources} from "./profile-runtime-settings";
import type {ProfileRuntimeSettingsDto} from "nbook/shared/dto/config.dto";

const props = withDefaults(defineProps<{
    modelValue: ProfileRuntimeSettingsDraft;
    inherited: ProfileRuntimeSettingsDto;
    sources: ProfileRuntimeSettingsSources;
    errors?: ProfileRuntimeSettingsErrors;
    /** 禁用编辑（保存中/加载中/维护动作中） */
    disabled?: boolean;
}>(), {
    errors: () => ({}),
    disabled: false,
});

const emit = defineEmits<{
    (event: "update:modelValue", value: ProfileRuntimeSettingsDraft): void;
}>();

const {t} = useI18n();

const sourceLabel = (field: ProfileRuntimeSettingsField): string => t(`settings.panels.profileModels.runtime.sources.${props.sources[field]}`);
const inheritLabel = (field: ProfileRuntimeSettingsField, value: string): string => t("settings.panels.profileModels.runtime.inheritSource", {source: sourceLabel(field), value});
const errorLabel = (field: ProfileRuntimeSettingsField): string => props.errors?.[field] ? t(`settings.panels.profileModels.runtime.errors.${props.errors[field]}`) : "";

// Reka Select 禁止空串 value；草稿里的空串继承语义用非空哨兵承载。
const INHERIT = "__inherit__";
function booleanOptions(field: ProfileRuntimeSettingsField, inherited: boolean): FormSelectOption[] {
    return [
        {value: "inherit", label: inheritLabel(field, inherited ? t("settings.panels.profileModels.enabled") : t("settings.panels.profileModels.disabled"))},
        {value: "true", label: t("settings.panels.profileModels.enabled")},
        {value: "false", label: t("settings.panels.profileModels.disabled")},
    ];
}

const intervalOptions = computed<FormSelectOption[]>(() => [
    {value: INHERIT, label: inheritLabel("summarizerIntervalKind", props.inherited.summarizer.interval.kind)},
    {value: "sourceInvocation", label: t("settings.panels.profileModels.runtime.sourceInvocation")},
    {value: "dialogueContentTokens", label: t("settings.panels.profileModels.runtime.dialogueContentTokens")},
]);
const triggerOptions = computed<FormSelectOption[]>(() => [
    {value: INHERIT, label: inheritLabel("compactionTriggerKind", props.inherited.compaction.trigger.kind)},
    {value: "autoReserve", label: t("settings.panels.profileModels.runtime.autoReserve")},
    {value: "percent", label: t("settings.panels.profileModels.runtime.percent")},
    {value: "tokens", label: t("settings.panels.profileModels.runtime.tokens")},
]);

const keepRecentOptions = computed<FormSelectOption[]>(() => [
    {value: INHERIT, label: inheritLabel("compactionKeepRecentKind", props.inherited.compaction.keepRecent.kind)},
    {value: "percent", label: t("settings.panels.profileModels.runtime.percent")},
    {value: "tokens", label: t("settings.panels.profileModels.runtime.tokens")},
]);

function update(patch: Partial<ProfileRuntimeSettingsDraft>): void {
    emit("update:modelValue", {...props.modelValue, ...patch});
}

function booleanValue(value: boolean | null): string {
    return value === null ? "inherit" : String(value);
}

function inheritKind(value: string): string {
    return value === INHERIT ? "" : value;
}
function kindInherit(value: string): string {
    return value === "" ? INHERIT : value;
}

function parseBoolean(value: string): boolean | null {
    return value === "inherit" ? null : value === "true";
}
</script>

<template>
    <!-- Profile 通用运行策略字段：Global 默认和单 Profile 覆盖共用，按摘要 / 压缩 / 文件通知三组呈现。 -->
    <div class="space-y-4">
        <!-- 自动摘要 -->
        <section>
            <h6 class="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{{ t("settings.panels.profileModels.runtime.groups.summarizer") }}</h6>
            <div class="grid gap-3 md:grid-cols-2">
                <FormField :label="t('settings.panels.profileModels.runtime.summarizerEnabled')">
                    <FormSelect :model-value="booleanValue(props.modelValue.summarizerEnabled)" :options="booleanOptions('summarizerEnabled', props.inherited.summarizer.enabled)" :disabled="props.disabled" @update:model-value="update({summarizerEnabled: parseBoolean($event)})" />
                </FormField>
                <FormField :label="t('settings.panels.profileModels.runtime.summarizerProfile')" :description="inheritLabel('summarizerProfileKey', props.inherited.summarizer.profileKey)">
                    <FormInput :model-value="props.modelValue.summarizerProfileKey" :placeholder="props.inherited.summarizer.profileKey" :disabled="props.disabled" @update:model-value="update({summarizerProfileKey: $event})" />
                </FormField>
                <FormField :label="t('settings.panels.profileModels.runtime.summarizerIntervalKind')">
                    <FormSelect :model-value="kindInherit(props.modelValue.summarizerIntervalKind)" :options="intervalOptions" :disabled="props.disabled" @update:model-value="update({summarizerIntervalKind: inheritKind($event) as ProfileRuntimeSettingsDraft['summarizerIntervalKind']})" />
                </FormField>
                <FormField :label="t('settings.panels.profileModels.runtime.summarizerIntervalValue')" :error="errorLabel('summarizerIntervalValue')" :description="errorLabel('summarizerIntervalValue') ? '' : inheritLabel('summarizerIntervalValue', String(props.inherited.summarizer.interval.value))">
                    <FormInput :model-value="props.modelValue.summarizerIntervalValue" type="number" min="1" :placeholder="String(props.inherited.summarizer.interval.value)" :disabled="props.disabled" @update:model-value="update({summarizerIntervalValue: $event})" />
                </FormField>
                <FormField :label="t('settings.panels.profileModels.runtime.summarizerMaxTokens')" :error="errorLabel('summarizerMaxTokens')" :description="errorLabel('summarizerMaxTokens') ? '' : inheritLabel('summarizerMaxTokens', String(props.inherited.summarizer.maxDialogueContentTokens))">
                    <FormInput :model-value="props.modelValue.summarizerMaxTokens" type="number" min="1" :placeholder="String(props.inherited.summarizer.maxDialogueContentTokens)" :disabled="props.disabled" @update:model-value="update({summarizerMaxTokens: $event})" />
                </FormField>
            </div>
        </section>

        <!-- 上下文压缩 -->
        <section class="border-t border-[var(--divider)] pt-4">
            <h6 class="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{{ t("settings.panels.profileModels.runtime.groups.compaction") }}</h6>
            <div class="grid gap-3 md:grid-cols-2">
                <FormField :label="t('settings.panels.profileModels.runtime.compactionEnabled')">
                    <FormSelect :model-value="booleanValue(props.modelValue.compactionEnabled)" :options="booleanOptions('compactionEnabled', props.inherited.compaction.enabled)" :disabled="props.disabled" @update:model-value="update({compactionEnabled: parseBoolean($event)})" />
                </FormField>
                <FormField :label="t('settings.panels.profileModels.runtime.compactionTrigger')">
                    <FormSelect :model-value="kindInherit(props.modelValue.compactionTriggerKind)" :options="triggerOptions" :disabled="props.disabled" @update:model-value="update({compactionTriggerKind: inheritKind($event) as ProfileRuntimeSettingsDraft['compactionTriggerKind']})" />
                </FormField>
                <FormField v-if="props.modelValue.compactionTriggerKind === 'percent' || props.modelValue.compactionTriggerKind === 'tokens'" :label="t('settings.panels.profileModels.runtime.compactionTriggerValue')" :error="errorLabel('compactionTriggerValue')">
                    <FormInput :model-value="props.modelValue.compactionTriggerValue" type="number" min="0" :step="props.modelValue.compactionTriggerKind === 'percent' ? '0.05' : '1'" :disabled="props.disabled" @update:model-value="update({compactionTriggerValue: $event})" />
                </FormField>
                <FormField :label="t('settings.panels.profileModels.runtime.compactionReserveTokens')" :error="errorLabel('compactionReserveTokens')" :description="errorLabel('compactionReserveTokens') ? '' : inheritLabel('compactionReserveTokens', String(props.inherited.compaction.reserveTokens))">
                    <FormInput :model-value="props.modelValue.compactionReserveTokens" type="number" min="1" :placeholder="String(props.inherited.compaction.reserveTokens)" :disabled="props.disabled" @update:model-value="update({compactionReserveTokens: $event})" />
                </FormField>
                <FormField :label="t('settings.panels.profileModels.runtime.compactionKeepRecent')">
                    <FormSelect :model-value="kindInherit(props.modelValue.compactionKeepRecentKind)" :options="keepRecentOptions" :disabled="props.disabled" @update:model-value="update({compactionKeepRecentKind: inheritKind($event) as ProfileRuntimeSettingsDraft['compactionKeepRecentKind']})" />
                </FormField>
                <FormField v-if="props.modelValue.compactionKeepRecentKind" :label="t('settings.panels.profileModels.runtime.compactionKeepRecentValue')" :error="errorLabel('compactionKeepRecentValue')">
                    <FormInput :model-value="props.modelValue.compactionKeepRecentValue" type="number" min="0" :step="props.modelValue.compactionKeepRecentKind === 'percent' ? '0.05' : '1'" :disabled="props.disabled" @update:model-value="update({compactionKeepRecentValue: $event})" />
                </FormField>
                <FormField class="md:col-span-2" :label="t('settings.panels.profileModels.runtime.compactionPrompt')" :description="inheritLabel('compactionPrompt', props.inherited.compaction.prompt)">
                    <FormTextarea :model-value="props.modelValue.compactionPrompt" :placeholder="props.inherited.compaction.prompt" :rows="5" :disabled="props.disabled" @update:model-value="update({compactionPrompt: $event})" />
                </FormField>
                <FormField class="md:col-span-2" :label="t('settings.panels.profileModels.runtime.compactionSummaryPrefix')" :description="inheritLabel('compactionSummaryPrefix', props.inherited.compaction.summaryPrefix)">
                    <FormTextarea :model-value="props.modelValue.compactionSummaryPrefix" :placeholder="props.inherited.compaction.summaryPrefix" :rows="4" :disabled="props.disabled" @update:model-value="update({compactionSummaryPrefix: $event})" />
                </FormField>
            </div>
        </section>

        <!-- 文件变更通知 -->
        <section class="border-t border-[var(--divider)] pt-4">
            <h6 class="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{{ t("settings.panels.profileModels.runtime.groups.fileChangeNotice") }}</h6>
            <div class="grid gap-3 md:grid-cols-2">
                <FormField :label="t('settings.panels.profileModels.runtime.diffMaxChars')" :error="errorLabel('fileChangeDiffMaxChars')" :description="errorLabel('fileChangeDiffMaxChars') ? '' : inheritLabel('fileChangeDiffMaxChars', String(props.inherited.fileChangeNotice.diffMaxChars))">
                    <FormInput :model-value="props.modelValue.fileChangeDiffMaxChars" type="number" step="64" min="0" max="8192" :placeholder="String(props.inherited.fileChangeNotice.diffMaxChars)" :disabled="props.disabled" @update:model-value="update({fileChangeDiffMaxChars: $event})" />
                </FormField>
            </div>
        </section>
    </div>
</template>
