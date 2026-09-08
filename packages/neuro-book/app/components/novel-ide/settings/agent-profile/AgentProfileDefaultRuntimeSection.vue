<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {Collapsible} from "@notnotype/nb-ui/components";
import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";
import type {ProfileRuntimeSettingsDraft, ProfileRuntimeSettingsErrors, ProfileRuntimeSettingsSources} from "./profile-runtime-settings";
import ProfileRuntimeSettingsFields from "./ProfileRuntimeSettingsFields.vue";

const props = defineProps<{
    scope: "global" | "project";
    runtimeDefaults: ProfileRuntimeSettingsDraft;
    runtimeEffective: ConfigAgentProfileSettingsDto["profileRuntimeDefaults"] | null;
    runtimeSources: ProfileRuntimeSettingsSources | null;
    runtimeErrors: ProfileRuntimeSettingsErrors;
    disabled: boolean;
}>();

const emit = defineEmits<{
    (event: "update:runtimeDefaults", value: ProfileRuntimeSettingsDraft): void;
}>();

const {t} = useI18n();
const isProjectScope = computed(() => props.scope === "project");
const runtimeExpanded = ref(false);
const runtimeHasErrors = computed(() => Object.keys(props.runtimeErrors).length > 0);

watch(runtimeHasErrors, (hasErrors) => {
    if (hasErrors) runtimeExpanded.value = true;
}, {immediate: true});
</script>

<template>
    <section v-if="props.runtimeEffective && props.runtimeSources" class="border-t border-[var(--divider)] pt-4 space-y-3">
        <Collapsible v-model:open="runtimeExpanded" :disabled="props.disabled">
            <template #trigger>
                <button type="button" class="group flex min-h-9 w-full items-center gap-2 rounded-[var(--radius-control)] border border-[var(--panel-outline)] bg-[var(--bg-input)] px-2.5 py-2 text-left transition-colors hover:border-[var(--accent-main)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-main)] disabled:cursor-not-allowed disabled:opacity-60" :aria-expanded="runtimeExpanded">
                    <span class="i-lucide-timer h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent-main)]" aria-hidden="true"></span>
                    <span class="min-w-0 flex-1 text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.runtime.defaultsTitle") }}</span>
                    <span v-if="runtimeHasErrors" class="i-lucide-triangle-alert h-4 w-4 shrink-0 text-[var(--status-danger)]" aria-hidden="true"></span>
                    <span class="i-lucide-chevron-down h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform duration-200" :class="runtimeExpanded ? 'rotate-180 text-[var(--accent-main)]' : ''" aria-hidden="true"></span>
                </button>
            </template>
            <div class="mt-2">
                <p class="mb-3 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? t("settings.panels.profileModels.runtime.projectDefaultsDescription") : t("settings.panels.profileModels.runtime.globalDefaultsDescription") }}</p>
                <ProfileRuntimeSettingsFields
                    :model-value="props.runtimeDefaults"
                    :inherited="props.runtimeEffective"
                    :sources="props.runtimeSources"
                    :errors="props.runtimeErrors"
                    :disabled="props.disabled"
                    @update:model-value="emit('update:runtimeDefaults', $event)"
                />
            </div>
        </Collapsible>
    </section>
</template>
