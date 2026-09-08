<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {Badge, Collapsible} from "@notnotype/nb-ui/components";
import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";
import type {AgentProfileDraft} from "./agent-profile-draft";
import {countProfileRuntimeOverrides, type ProfileRuntimeSettingsDraft, type ProfileRuntimeSettingsErrors, type ProfileRuntimeSettingsSources} from "./profile-runtime-settings";
import ProfileRuntimeSettingsFields from "./ProfileRuntimeSettingsFields.vue";

type RuntimeBaseline = {
    settings: ConfigAgentProfileSettingsDto["agentProfiles"][number]["runtime"]["effective"];
    sources: Record<string, string>;
};

const props = withDefaults(defineProps<{
    profile: AgentProfileDraft;
    runtimeBaseline: RuntimeBaseline | null;
    runtimeErrors?: ProfileRuntimeSettingsErrors;
    disabled?: boolean;
}>(), {
    runtimeErrors: () => ({}),
    disabled: false,
});

const emit = defineEmits<{
    (event: "update:runtime", value: ProfileRuntimeSettingsDraft): void;
}>();

const {t} = useI18n();
const runtimeExpanded = ref(countProfileRuntimeOverrides(props.profile.runtime) > 0);
const runtimeOverrideCount = computed(() => countProfileRuntimeOverrides(props.profile.runtime));
const runtimeHasErrors = computed(() => Object.keys(props.runtimeErrors).length > 0);
const runtimeEffective = computed(() => props.runtimeBaseline?.settings ?? null);
const runtimeSources = computed(() => props.runtimeBaseline?.sources ?? null);
watch(runtimeHasErrors, (hasErrors) => {
    if (hasErrors) runtimeExpanded.value = true;
}, {immediate: true});
</script>

<template>
    <section class="border-t border-[var(--divider)] pt-3">
        <Collapsible v-model:open="runtimeExpanded" :disabled="props.disabled">
            <template #trigger>
                <button type="button" class="group flex min-h-9 w-full items-center gap-2 rounded-[var(--radius-control)] border border-[var(--panel-outline)] bg-[var(--bg-input)] px-2.5 py-2 text-left transition-colors hover:border-[var(--accent-main)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-main)] disabled:cursor-not-allowed disabled:opacity-60" :aria-expanded="runtimeExpanded">
                    <span class="i-lucide-timer h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent-main)]" aria-hidden="true"></span>
                    <span class="min-w-0 flex-1 text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.runtime.profileOverrideTitle") }}</span>
                    <Badge v-if="runtimeOverrideCount > 0" tone="neutral">{{ t("settings.panels.profileModels.overrideCount", {count: runtimeOverrideCount}) }}</Badge>
                    <span v-if="runtimeHasErrors" class="i-lucide-triangle-alert h-4 w-4 shrink-0 text-[var(--status-danger)]" aria-hidden="true"></span>
                    <span class="i-lucide-chevron-down h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform duration-200" :class="runtimeExpanded ? 'rotate-180 text-[var(--accent-main)]' : ''" aria-hidden="true"></span>
                </button>
            </template>
            <div v-if="runtimeEffective && runtimeSources" class="mt-2">
                <ProfileRuntimeSettingsFields
                    :model-value="props.profile.runtime"
                    :inherited="runtimeEffective"
                    :sources="runtimeSources as ProfileRuntimeSettingsSources"
                    :errors="props.runtimeErrors"
                    :disabled="props.disabled"
                    @update:model-value="emit('update:runtime', $event)"
                />
            </div>
            <p v-else class="mt-2 text-xs text-[var(--text-muted)]">{{ t("settings.panels.profileModels.settingsView.presetsUnavailable") }}</p>
        </Collapsible>
    </section>
</template>
