<script setup lang="ts">
import {computed, ref} from "vue";
import {Badge, Button, Collapsible} from "@notnotype/nb-ui/components";
import type {AgentProfileModelConfigDto, EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";
import {countModelOverrides, type AgentProfileModelDraft} from "./agent-profile-draft";
import AgentProfileModelFields from "./AgentProfileModelFields.vue";

const props = defineProps<{
    scope: "global" | "project";
    modelDefaults: AgentProfileModelDraft;
    globalModelDefaults: AgentProfileModelConfigDto;
    enabledModels: EnabledModelOptionDto[];
    validationIssues: ConfigAgentProfileSettingsDto["validationIssues"];
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
            :inherit-mode="isProjectScope ? 'projectDefaults' : 'globalDefaults'"
            :visible-fields="['model', 'reasoning']"
            :disabled="props.disabled"
            @update:model-value="emit('update:modelDefaults', $event)"
        />
        <div class="border-t border-[var(--divider)] pt-2">
            <Collapsible v-model:open="advancedExpanded" :disabled="props.disabled">
                <template #trigger>
                    <button type="button" class="group flex min-h-9 w-full items-center gap-2 rounded-[var(--radius-control)] border border-[var(--panel-outline)] bg-[var(--bg-input)] px-2.5 py-2 text-left transition-colors hover:border-[var(--accent-main)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-main)] disabled:cursor-not-allowed disabled:opacity-60" :aria-expanded="advancedExpanded">
                        <span class="i-lucide-settings-2 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent-main)]" aria-hidden="true"></span>
                        <span class="min-w-0 flex-1 text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.settingsView.advancedModel") }}</span>
                        <Badge v-if="modelOverrideCount > 0" tone="neutral">{{ t("settings.panels.profileModels.overrideCount", {count: modelOverrideCount}) }}</Badge>
                        <span class="i-lucide-chevron-down h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform duration-200" :class="advancedExpanded ? 'rotate-180 text-[var(--accent-main)]' : ''" aria-hidden="true"></span>
                    </button>
                </template>
                <AgentProfileModelFields
                    class="mt-2"
                    :model-value="props.modelDefaults"
                    :inherited="props.globalModelDefaults"
                    :enabled-models="props.enabledModels"
                    :validation-issues="props.validationIssues"
                    :inherit-mode="isProjectScope ? 'projectDefaults' : 'globalDefaults'"
                    :visible-fields="['advanced']"
                    :disabled="props.disabled"
                    @update:model-value="emit('update:modelDefaults', $event)"
                />
            </Collapsible>
        </div>
    </section>
</template>
