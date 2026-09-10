<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {Badge, Button, CollapsibleSection} from "@notnotype/nb-ui/components";
import type {AgentProfileModelConfigDto, EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";
import {countModelOverrides, type AgentProfileModelDraft, type AgentProfileModelFieldErrors} from "../agent-profile-draft";
import AgentProfileModelFields from "./AgentProfileModelFields.vue";

const props = defineProps<{
    scope: "global" | "project";
    modelDefaults: AgentProfileModelDraft;
    globalModelDefaults: AgentProfileModelConfigDto;
    enabledModels: EnabledModelOptionDto[];
    validationIssues: ConfigAgentProfileSettingsDto["validationIssues"];
    modelErrors?: AgentProfileModelFieldErrors;
    disabled: boolean;
}>();

const emit = defineEmits<{
    (event: "update:modelDefaults", value: AgentProfileModelDraft): void;
    (event: "reset"): void;
}>();

const {t} = useI18n();
const isProjectScope = computed(() => props.scope === "project");
const advancedExpanded = ref(false);
const modelOverrideCount = computed(() => countModelOverrides(props.modelDefaults));
const modelHasErrors = computed(() => Object.keys(props.modelErrors ?? {}).length > 0);
watch(modelHasErrors, (hasErrors) => {
    if (hasErrors) advancedExpanded.value = true;
}, {immediate: true});
</script>

<template>
    <section class="border-t border-[var(--divider)] pt-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--divider)] pb-3">
            <div>
                <h4 class="text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.defaultParameters") }}</h4>
                <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? t("settings.panels.profileModels.projectDefaultDescription") : t("settings.panels.profileModels.globalDefaultDescription") }}</p>
            </div>
            <Button size="sm" variant="ghost" :disabled="props.disabled" @click="emit('reset')">
                <span class="i-lucide-rotate-ccw h-3 w-3" aria-hidden="true"></span>
                {{ t("settings.panels.profileModels.resetDefault") }}
            </Button>
        </div>
        <AgentProfileModelFields
            :model-value="props.modelDefaults"
            :inherited="props.globalModelDefaults"
            :enabled-models="props.enabledModels"
            :validation-issues="props.validationIssues"
            :errors="props.modelErrors"
            :inherit-mode="isProjectScope ? 'projectDefaults' : 'globalDefaults'"
            :visible-fields="['model', 'reasoning']"
            :disabled="props.disabled"
            @update:model-value="emit('update:modelDefaults', $event)"
        />
        <div class="border-t border-[var(--divider)] pt-2">
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
                    :model-value="props.modelDefaults"
                    :inherited="props.globalModelDefaults"
                    :enabled-models="props.enabledModels"
                    :validation-issues="props.validationIssues"
                    :errors="props.modelErrors"
                    :inherit-mode="isProjectScope ? 'projectDefaults' : 'globalDefaults'"
                    :visible-fields="['advanced']"
                    :disabled="props.disabled"
                    @update:model-value="emit('update:modelDefaults', $event)"
                />
            </CollapsibleSection>
        </div>
    </section>
</template>
