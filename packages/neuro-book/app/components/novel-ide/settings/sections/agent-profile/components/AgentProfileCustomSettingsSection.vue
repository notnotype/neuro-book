<script setup lang="ts">
import {computed, ref} from "vue";
import {Badge, CollapsibleSection} from "@notnotype/nb-ui/components";
import type {LowCodeJsonObject, LowCodeResourceMutationDto} from "nbook/shared/dto/low-code-form.dto";
import LowCodeForm from "nbook/app/components/common/low-code-form/LowCodeForm.vue";
import type {AgentProfileDraft} from "../agent-profile-draft";

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
    <section v-if="hasPresetsSection" class="border-t border-[var(--divider)] pt-3">
        <CollapsibleSection
            v-model:open="settingsExpanded"
            icon-class="i-lucide-sliders-horizontal"
            :label="t('settings.panels.profileModels.settingsView.profilePresets')"
            :disabled="props.disabled"
        >
            <template #meta>
                <Badge v-if="settingsOverrideCount > 0" tone="neutral">{{ t("settings.panels.profileModels.overrideCount", {count: settingsOverrideCount}) }}</Badge>
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
        </CollapsibleSection>
    </section>
</template>
