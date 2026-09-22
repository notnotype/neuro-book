<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {Badge, CollapsibleSection} from "@notnotype/nb-ui/components";
import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";
import type {AgentProfileDraft} from "../agent-profile-draft";
import {countProfileRuntimeOverrides, type ProfileRuntimeSettingsDraft, type ProfileRuntimeSettingsErrors, type ProfileRuntimeSettingsSources} from "../profile-runtime-settings";
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
        <CollapsibleSection
            v-model:open="runtimeExpanded"
            icon-class="i-lucide-timer"
            :label="t('settings.panels.profileModels.runtime.profileOverrideTitle')"
            :disabled="props.disabled"
        >
            <template #meta>
                <Badge v-if="runtimeOverrideCount > 0" tone="neutral">{{ t("settings.panels.profileModels.overrideCount", {count: runtimeOverrideCount}) }}</Badge>
                <span v-if="runtimeHasErrors" class="i-lucide-triangle-alert h-4 w-4 shrink-0 text-[var(--status-danger)]" aria-hidden="true"></span>
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
        </CollapsibleSection>
    </section>
</template>
