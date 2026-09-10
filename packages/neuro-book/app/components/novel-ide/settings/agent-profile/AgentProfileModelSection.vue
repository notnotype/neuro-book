<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {Badge, CollapsibleSection} from "@notnotype/nb-ui/components";
import type {AgentProfileModelConfigDto, EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";
import {countModelOverrides, type AgentProfileModelDraft, type AgentProfileModelFieldErrors} from "./agent-profile-draft";
import AgentProfileModelFields from "./AgentProfileModelFields.vue";

const props = withDefaults(defineProps<{
    model: AgentProfileModelDraft;
    inherited: AgentProfileModelConfigDto;
    enabledModels: EnabledModelOptionDto[];
    validationIssues: ConfigAgentProfileSettingsDto["validationIssues"];
    modelErrors?: AgentProfileModelFieldErrors;
    disabled?: boolean;
}>(), {disabled: false});

const emit = defineEmits<{
    (event: "update:model", value: AgentProfileModelDraft): void;
}>();

const {t} = useI18n();
const advancedExpanded = ref(false);
const modelOverrideCount = computed(() => countModelOverrides(props.model));
const modelHasErrors = computed(() => Object.keys(props.modelErrors ?? {}).length > 0);
watch(modelHasErrors, (hasErrors) => {
    if (hasErrors) advancedExpanded.value = true;
}, {immediate: true});
</script>

<template>
    <section class="border-t border-[var(--divider)] pt-3">
        <h5 class="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[var(--text-main)]">
            <span class="i-lucide-cpu h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true"></span>
            {{ t("settings.panels.profileModels.settingsView.useModel") }}
        </h5>
        <AgentProfileModelFields
            :model-value="props.model"
            :inherited="props.inherited"
            :enabled-models="props.enabledModels"
            :validation-issues="props.validationIssues"
            :errors="props.modelErrors"
            inherit-mode="profile"
            :visible-fields="['model', 'reasoning']"
            :disabled="props.disabled"
            @update:model-value="emit('update:model', $event)"
        />
    </section>
    <section class="border-t border-[var(--divider)] pt-3">
        <CollapsibleSection
            v-model:open="advancedExpanded"
            icon-class="i-lucide-settings-2"
            :label="t('settings.panels.profileModels.settingsView.advancedModel')"
            :disabled="props.disabled"
        >
            <template #meta>
                <Badge v-if="modelOverrideCount > 0" tone="neutral">{{ t("settings.panels.profileModels.overrideCount", {count: modelOverrideCount}) }}</Badge>
            </template>
            <AgentProfileModelFields
                class="mt-2"
                :model-value="props.model"
                :inherited="props.inherited"
                :enabled-models="props.enabledModels"
                :validation-issues="props.validationIssues"
                :errors="props.modelErrors"
                inherit-mode="profile"
                :visible-fields="['advanced']"
                :disabled="props.disabled"
                @update:model-value="emit('update:model', $event)"
            />
        </CollapsibleSection>
    </section>
</template>
