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
                <button
                    type="button"
                    class="group flex min-h-9 w-full items-center gap-2 rounded-[var(--radius-control)] border border-[var(--panel-outline)] bg-[var(--bg-input)] px-2.5 py-2 text-left transition-colors hover:border-[var(--accent-main)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-main)] disabled:cursor-not-allowed disabled:opacity-60"
                    :aria-expanded="advancedExpanded"
                >
                    <span class="i-lucide-settings-2 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent-main)]" aria-hidden="true"></span>
                    <span class="min-w-0 flex-1 text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.settingsView.advancedModel") }}</span>
                    <Badge v-if="modelOverrideCount > 0" tone="neutral">{{ t("settings.panels.profileModels.overrideCount", {count: modelOverrideCount}) }}</Badge>
                    <span
                        class="i-lucide-chevron-down h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform duration-200"
                        :class="advancedExpanded ? 'rotate-180 text-[var(--accent-main)]' : ''"
                        aria-hidden="true"
                    ></span>
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
