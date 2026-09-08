<script setup lang="ts">
import {computed, ref} from "vue";
import {Badge, Collapsible} from "@notnotype/nb-ui/components";
import type {AgentProfileModelConfigDto, EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";
import {countModelOverrides, type AgentProfileModelDraft} from "./agent-profile-draft";
import AgentProfileModelFields from "./AgentProfileModelFields.vue";

const props = withDefaults(defineProps<{
    model: AgentProfileModelDraft;
    inherited: AgentProfileModelConfigDto;
    enabledModels: EnabledModelOptionDto[];
    validationIssues: ConfigAgentProfileSettingsDto["validationIssues"];
    disabled?: boolean;
}>(), {disabled: false});

const emit = defineEmits<{
    (event: "update:model", value: AgentProfileModelDraft): void;
}>();

const {t} = useI18n();
const advancedExpanded = ref(false);
const modelOverrideCount = computed(() => countModelOverrides(props.model));
</script>

<template>
    <section>
        <h5 class="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[var(--text-main)]">
            <span class="i-lucide-cpu h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true"></span>
            {{ t("settings.panels.profileModels.settingsView.useModel") }}
        </h5>
        <AgentProfileModelFields
            :model-value="props.model"
            :inherited="props.inherited"
            :enabled-models="props.enabledModels"
            :validation-issues="props.validationIssues"
            inherit-mode="profile"
            :visible-fields="['model', 'reasoning']"
            :disabled="props.disabled"
            @update:model-value="emit('update:model', $event)"
        />
    </section>
    <section class="border-t border-[var(--divider)] pt-3">
        <Collapsible v-model:open="advancedExpanded" :disabled="props.disabled">
            <template #trigger>
                <button type="button" class="flex w-full items-center gap-2 rounded-[var(--radius-control)] py-1 text-left" :aria-expanded="advancedExpanded">
                    <span class="i-lucide-settings-2 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                    <span class="min-w-0 flex-1 text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.settingsView.advancedModel") }}</span>
                    <Badge v-if="modelOverrideCount > 0" tone="neutral">{{ t("settings.panels.profileModels.overrideCount", {count: modelOverrideCount}) }}</Badge>
                </button>
            </template>
            <AgentProfileModelFields
                class="mt-2"
                :model-value="props.model"
                :inherited="props.inherited"
                :enabled-models="props.enabledModels"
                :validation-issues="props.validationIssues"
                inherit-mode="profile"
                :visible-fields="['advanced']"
                :disabled="props.disabled"
                @update:model-value="emit('update:model', $event)"
            />
        </Collapsible>
    </section>
</template>
