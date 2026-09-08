<script setup lang="ts">
import {computed, ref} from "vue";
import {Badge, Collapsible} from "@notnotype/nb-ui/components";
import type {LowCodeJsonObject, LowCodeResourceMutationDto} from "nbook/shared/dto/low-code-form.dto";
import LowCodeForm from "nbook/app/components/common/low-code-form/LowCodeForm.vue";
import type {AgentProfileDraft} from "./agent-profile-draft";

const props = withDefaults(defineProps<{
    profile: AgentProfileDraft;
    scope: "global" | "project";
    disabled?: boolean;
}>(), {
    disabled: false,
});

const emit = defineEmits<{
    (event: "update:settingsValues", value: LowCodeJsonObject): void;
    (event: "update:settingsOverridePaths", value: string[]): void;
    (event: "update:settingsResourceMutations", value: LowCodeResourceMutationDto[]): void;
}>();

const {t} = useI18n();
const isProjectScope = computed(() => props.scope === "project");
const settingsExpanded = ref(true);
const canEditSettings = computed(() => props.profile.loadStatus === "loaded" && Boolean(props.profile.settings));
const hasPresetsSection = computed(() => props.profile.settings !== null || props.profile.loadStatus !== "loaded");
const settingsOverrideCount = computed(() => props.profile.settings ? props.profile.settings.overridePaths.length + props.profile.settings.resourceMutations.length : 0);
</script>

<template>
    <section v-if="hasPresetsSection">
        <Collapsible v-model:open="settingsExpanded" :disabled="props.disabled">
            <template #trigger>
                <button type="button" class="group flex min-h-9 w-full items-center gap-2 rounded-[var(--radius-control)] border border-[var(--panel-outline)] bg-[var(--bg-input)] px-2.5 py-2 text-left transition-colors hover:border-[var(--accent-main)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-main)] disabled:cursor-not-allowed disabled:opacity-60" :aria-expanded="settingsExpanded">
                    <span class="i-lucide-sliders-horizontal h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent-main)]" aria-hidden="true"></span>
                    <span class="min-w-0 flex-1 text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.settingsView.profilePresets") }}</span>
                    <Badge v-if="settingsOverrideCount > 0" tone="neutral">{{ t("settings.panels.profileModels.overrideCount", {count: settingsOverrideCount}) }}</Badge>
                    <span class="i-lucide-chevron-down h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform duration-200" :class="settingsExpanded ? 'rotate-180 text-[var(--accent-main)]' : ''" aria-hidden="true"></span>
                </button>
            </template>
            <div class="mt-2">
                <p v-if="canEditSettings && props.profile.settings" class="mb-3 text-[11px] text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.profilePresetsDescription") }}</p>
                <LowCodeForm
                    v-if="canEditSettings && props.profile.settings"
                    :model-value="props.profile.settings.values"
                    :override-paths="props.profile.settings.overridePaths"
                    :resource-mutations="props.profile.settings.resourceMutations"
                    :form="props.profile.settings.form"
                    :issues="props.profile.settings.issues"
                    :scope="isProjectScope ? 'project' : 'global'"
                    :inheritance-mode="isProjectScope ? 'manual' : 'always-override'"
                    :inherited-value="props.profile.settings.inheritedValue"
                    :disabled="props.disabled"
                    @update:model-value="emit('update:settingsValues', $event)"
                    @update:override-paths="emit('update:settingsOverridePaths', $event)"
                    @update:resource-mutations="emit('update:settingsResourceMutations', $event)"
                />
                <p v-else-if="props.profile.loadStatus !== 'loaded'" class="text-xs text-[var(--text-muted)]">{{ t("settings.panels.profileModels.settingsView.presetsUnavailable") }}</p>
                <p v-else class="text-xs text-[var(--text-muted)]">{{ t("settings.panels.profileModels.settingsView.noPresets") }}</p>
            </div>
        </Collapsible>
    </section>
</template>
