<script setup lang="ts">
import {computed} from "vue";
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
</script>

<template>
    <section v-if="props.runtimeEffective && props.runtimeSources" class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm">
        <div class="mb-4 border-b border-[var(--border-color)] pb-4">
            <h4 class="text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.runtime.defaultsTitle") }}</h4>
            <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? t("settings.panels.profileModels.runtime.projectDefaultsDescription") : t("settings.panels.profileModels.runtime.globalDefaultsDescription") }}</p>
        </div>
        <ProfileRuntimeSettingsFields
            :model-value="props.runtimeDefaults"
            :inherited="props.runtimeEffective"
            :sources="props.runtimeSources"
            :errors="props.runtimeErrors"
            :disabled="props.disabled"
            @update:model-value="emit('update:runtimeDefaults', $event)"
        />
    </section>
</template>
