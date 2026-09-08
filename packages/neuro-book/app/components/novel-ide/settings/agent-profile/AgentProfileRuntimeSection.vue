<script setup lang="ts">
import {computed, ref} from "vue";
import {Badge, Collapsible} from "@notnotype/nb-ui/components";
import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";
import type {AgentProfileDraft} from "./agent-profile-draft";
import {countProfileRuntimeOverrides, type ProfileRuntimeSettingsDraft, type ProfileRuntimeSettingsSources} from "./profile-runtime-settings";
import ProfileRuntimeSettingsFields from "./ProfileRuntimeSettingsFields.vue";

type RuntimeBaseline = {
    settings: ConfigAgentProfileSettingsDto["agentProfiles"][number]["runtime"]["effective"];
    sources: Record<string, string>;
};

const props = withDefaults(defineProps<{
    profile: AgentProfileDraft;
    runtimeBaseline: RuntimeBaseline | null;
    disabled?: boolean;
}>(), {
    disabled: false,
});

const emit = defineEmits<{
    (event: "update:runtime", value: ProfileRuntimeSettingsDraft): void;
}>();

const {t} = useI18n();
const runtimeExpanded = ref(countProfileRuntimeOverrides(props.profile.runtime) > 0);
const runtimeOverrideCount = computed(() => countProfileRuntimeOverrides(props.profile.runtime));
const runtimeEffective = computed(() => props.runtimeBaseline?.settings ?? null);
const runtimeSources = computed(() => props.runtimeBaseline?.sources ?? null);
</script>

<template>
    <section class="border-t border-[var(--divider)] pt-3">
        <Collapsible :default-open="runtimeExpanded" :disabled="props.disabled">
            <template #trigger>
                <button type="button" class="flex w-full items-center gap-2 rounded-[var(--radius-control)] py-1 text-left" :aria-expanded="runtimeExpanded">
                    <span class="i-lucide-timer h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                    <span class="min-w-0 flex-1 text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.runtime.profileOverrideTitle") }}</span>
                    <Badge v-if="runtimeOverrideCount > 0" tone="neutral">{{ t("settings.panels.profileModels.overrideCount", {count: runtimeOverrideCount}) }}</Badge>
                </button>
            </template>
            <div v-if="runtimeEffective && runtimeSources" class="mt-2">
                <ProfileRuntimeSettingsFields
                    :model-value="props.profile.runtime"
                    :inherited="runtimeEffective"
                    :sources="runtimeSources as ProfileRuntimeSettingsSources"
                    :disabled="props.disabled"
                    @update:model-value="emit('update:runtime', $event)"
                />
            </div>
            <p v-else class="mt-2 text-xs text-[var(--text-muted)]">{{ t("settings.panels.profileModels.settingsView.presetsUnavailable") }}</p>
        </Collapsible>
    </section>
</template>
