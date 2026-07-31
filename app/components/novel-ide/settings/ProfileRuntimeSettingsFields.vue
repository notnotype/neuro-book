<script setup lang="ts">
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import type {ProfileRuntimeSettingsDraft, ProfileRuntimeSettingsErrors, ProfileRuntimeSettingsField, ProfileRuntimeSettingsSources} from "nbook/app/components/novel-ide/settings/profile-runtime-settings";
import type {ProfileRuntimeSettingsDto} from "nbook/shared/dto/config.dto";

const props = defineProps<{
    modelValue: ProfileRuntimeSettingsDraft;
    inherited: ProfileRuntimeSettingsDto;
    sources: ProfileRuntimeSettingsSources;
    errors?: ProfileRuntimeSettingsErrors;
}>();

const emit = defineEmits<{
    (event: "update:modelValue", value: ProfileRuntimeSettingsDraft): void;
}>();

const {t} = useI18n();

const sourceLabel = (field: ProfileRuntimeSettingsField): string => t(`settings.panels.profileModels.runtime.sources.${props.sources[field]}`);
const inheritLabel = (field: ProfileRuntimeSettingsField, value: string): string => t("settings.panels.profileModels.runtime.inheritSource", {source: sourceLabel(field), value});
const errorLabel = (field: ProfileRuntimeSettingsField): string => props.errors?.[field] ? t(`settings.panels.profileModels.runtime.errors.${props.errors[field]}`) : "";

const booleanOptions = (field: ProfileRuntimeSettingsField, inherited: boolean): SelectOption[] => [
    {value: "inherit", label: inheritLabel(field, inherited ? t("settings.panels.profileModels.enabled") : t("settings.panels.profileModels.disabled"))},
    {value: "true", label: t("settings.panels.profileModels.enabled")},
    {value: "false", label: t("settings.panels.profileModels.disabled")},
];

const intervalOptions: SelectOption[] = [
    {value: "", label: inheritLabel("summarizerIntervalKind", props.inherited.summarizer.interval.kind)},
    {value: "sourceInvocation", label: t("settings.panels.profileModels.runtime.sourceInvocation")},
    {value: "dialogueContentTokens", label: t("settings.panels.profileModels.runtime.dialogueContentTokens")},
];

const triggerOptions: SelectOption[] = [
    {value: "", label: inheritLabel("compactionTriggerKind", props.inherited.compaction.trigger.kind)},
    {value: "autoReserve", label: t("settings.panels.profileModels.runtime.autoReserve")},
    {value: "percent", label: t("settings.panels.profileModels.runtime.percent")},
    {value: "tokens", label: t("settings.panels.profileModels.runtime.tokens")},
];

const keepRecentOptions: SelectOption[] = [
    {value: "", label: inheritLabel("compactionKeepRecentKind", props.inherited.compaction.keepRecent.kind)},
    {value: "percent", label: t("settings.panels.profileModels.runtime.percent")},
    {value: "tokens", label: t("settings.panels.profileModels.runtime.tokens")},
];

function update(patch: Partial<ProfileRuntimeSettingsDraft>): void {
    emit("update:modelValue", {...props.modelValue, ...patch});
}

function booleanValue(value: boolean | null): string {
    return value === null ? "inherit" : String(value);
}

function parseBoolean(value: string): boolean | null {
    return value === "inherit" ? null : value === "true";
}
</script>

<template>
    <!-- Profile 通用运行策略字段：Global 默认和单 Profile 覆盖共用。 -->
    <div class="grid gap-3 md:grid-cols-2">
        <div class="space-y-1.5">
            <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.runtime.summarizerEnabled") }}</label>
            <FormSelect :model-value="booleanValue(props.modelValue.summarizerEnabled)" :options="booleanOptions('summarizerEnabled', props.inherited.summarizer.enabled)" @update:model-value="update({summarizerEnabled: parseBoolean($event)})" />
        </div>
        <div class="space-y-1.5">
            <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.runtime.summarizerProfile") }}</label>
            <FormInput :model-value="props.modelValue.summarizerProfileKey" :placeholder="props.inherited.summarizer.profileKey" @update:model-value="update({summarizerProfileKey: $event})" />
            <p class="text-[10px] text-[var(--text-muted)]">{{ inheritLabel('summarizerProfileKey', props.inherited.summarizer.profileKey) }}</p>
        </div>
        <div class="space-y-1.5">
            <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.runtime.summarizerIntervalKind") }}</label>
            <FormSelect :model-value="props.modelValue.summarizerIntervalKind" :options="intervalOptions" @update:model-value="update({summarizerIntervalKind: $event as ProfileRuntimeSettingsDraft['summarizerIntervalKind']})" />
        </div>
        <div class="space-y-1.5">
            <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.runtime.summarizerIntervalValue") }}</label>
            <FormInput :model-value="props.modelValue.summarizerIntervalValue" type="number" min="1" :placeholder="String(props.inherited.summarizer.interval.value)" @update:model-value="update({summarizerIntervalValue: $event})" />
            <p :class="errorLabel('summarizerIntervalValue') ? 'text-[var(--status-danger)]' : 'text-[var(--text-muted)]'" class="text-[10px]">{{ errorLabel('summarizerIntervalValue') || inheritLabel('summarizerIntervalValue', String(props.inherited.summarizer.interval.value)) }}</p>
        </div>
        <div class="space-y-1.5">
            <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.runtime.summarizerMaxTokens") }}</label>
            <FormInput :model-value="props.modelValue.summarizerMaxTokens" type="number" min="1" :placeholder="String(props.inherited.summarizer.maxDialogueContentTokens)" @update:model-value="update({summarizerMaxTokens: $event})" />
            <p :class="errorLabel('summarizerMaxTokens') ? 'text-[var(--status-danger)]' : 'text-[var(--text-muted)]'" class="text-[10px]">{{ errorLabel('summarizerMaxTokens') || inheritLabel('summarizerMaxTokens', String(props.inherited.summarizer.maxDialogueContentTokens)) }}</p>
        </div>
        <div class="space-y-1.5">
            <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.runtime.diffMaxChars") }}</label>
            <FormInput :model-value="props.modelValue.fileChangeDiffMaxChars" type="number" step="64" min="0" max="8192" :placeholder="String(props.inherited.fileChangeNotice.diffMaxChars)" @update:model-value="update({fileChangeDiffMaxChars: $event})" />
            <p :class="errorLabel('fileChangeDiffMaxChars') ? 'text-[var(--status-danger)]' : 'text-[var(--text-muted)]'" class="text-[10px]">{{ errorLabel('fileChangeDiffMaxChars') || inheritLabel('fileChangeDiffMaxChars', String(props.inherited.fileChangeNotice.diffMaxChars)) }}</p>
        </div>
        <div class="space-y-1.5">
            <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.runtime.compactionEnabled") }}</label>
            <FormSelect :model-value="booleanValue(props.modelValue.compactionEnabled)" :options="booleanOptions('compactionEnabled', props.inherited.compaction.enabled)" @update:model-value="update({compactionEnabled: parseBoolean($event)})" />
        </div>
        <div class="space-y-1.5">
            <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.runtime.compactionTrigger") }}</label>
            <FormSelect :model-value="props.modelValue.compactionTriggerKind" :options="triggerOptions" @update:model-value="update({compactionTriggerKind: $event as ProfileRuntimeSettingsDraft['compactionTriggerKind']})" />
        </div>
        <div v-if="props.modelValue.compactionTriggerKind === 'percent' || props.modelValue.compactionTriggerKind === 'tokens'" class="space-y-1.5">
            <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.runtime.compactionTriggerValue") }}</label>
            <FormInput :model-value="props.modelValue.compactionTriggerValue" type="number" min="0" :step="props.modelValue.compactionTriggerKind === 'percent' ? '0.05' : '1'" @update:model-value="update({compactionTriggerValue: $event})" />
            <p v-if="errorLabel('compactionTriggerValue')" class="text-[10px] text-[var(--status-danger)]">{{ errorLabel('compactionTriggerValue') }}</p>
        </div>
        <div class="space-y-1.5">
            <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.runtime.compactionReserveTokens") }}</label>
            <FormInput :model-value="props.modelValue.compactionReserveTokens" type="number" min="1" :placeholder="String(props.inherited.compaction.reserveTokens)" @update:model-value="update({compactionReserveTokens: $event})" />
            <p :class="errorLabel('compactionReserveTokens') ? 'text-[var(--status-danger)]' : 'text-[var(--text-muted)]'" class="text-[10px]">{{ errorLabel('compactionReserveTokens') || inheritLabel('compactionReserveTokens', String(props.inherited.compaction.reserveTokens)) }}</p>
        </div>
        <div class="space-y-1.5">
            <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.runtime.compactionKeepRecent") }}</label>
            <FormSelect :model-value="props.modelValue.compactionKeepRecentKind" :options="keepRecentOptions" @update:model-value="update({compactionKeepRecentKind: $event as ProfileRuntimeSettingsDraft['compactionKeepRecentKind']})" />
        </div>
        <div v-if="props.modelValue.compactionKeepRecentKind" class="space-y-1.5">
            <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.runtime.compactionKeepRecentValue") }}</label>
            <FormInput :model-value="props.modelValue.compactionKeepRecentValue" type="number" min="0" :step="props.modelValue.compactionKeepRecentKind === 'percent' ? '0.05' : '1'" @update:model-value="update({compactionKeepRecentValue: $event})" />
            <p v-if="errorLabel('compactionKeepRecentValue')" class="text-[10px] text-[var(--status-danger)]">{{ errorLabel('compactionKeepRecentValue') }}</p>
        </div>
    </div>
</template>
