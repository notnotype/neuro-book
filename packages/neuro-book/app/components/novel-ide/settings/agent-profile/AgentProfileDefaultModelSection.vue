<script setup lang="ts">
import {computed} from "vue";
import type {AgentProfileModelConfigDto, EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";
import type {AgentProfileModelDraft} from "./agent-profile-draft";
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
</script>

<template>
    <section class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-color)] pb-4">
            <div>
                <h4 class="text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.defaultParameters") }}</h4>
                <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? t("settings.panels.profileModels.projectDefaultDescription") : t("settings.panels.profileModels.globalDefaultDescription") }}</p>
            </div>
            <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :disabled="props.disabled" @click="emit('reset')">
                <span class="i-lucide-rotate-ccw h-3 w-3" aria-hidden="true"></span>
                {{ t("settings.panels.profileModels.resetDefault") }}
            </button>
        </div>
        <AgentProfileModelFields
            :model-value="props.modelDefaults"
            :inherited="props.globalModelDefaults"
            :enabled-models="props.enabledModels"
            :validation-issues="props.validationIssues"
            :inherit-mode="isProjectScope ? 'projectDefaults' : 'globalDefaults'"
            :disabled="props.disabled"
            @update:model-value="emit('update:modelDefaults', $event)"
        />
    </section>
</template>
