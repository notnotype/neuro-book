<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {Badge, CollapsibleSection} from "@notnotype/nb-ui/components";
import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";
import {countProfileRuntimeOverrides, type ProfileRuntimeSettingsDraft, type ProfileRuntimeSettingsErrors, type ProfileRuntimeSettingsSources} from "../profile-runtime-settings";
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
const runtimeOverrideCount = computed(() => countProfileRuntimeOverrides(props.runtimeDefaults));
const runtimeHasErrors = computed(() => Object.keys(props.runtimeErrors).length > 0);

watch(runtimeHasErrors, (hasErrors) => {
    if (hasErrors) runtimeExpanded.value = true;
}, {immediate: true});
</script>

<template>
    <section v-if="props.runtimeEffective && props.runtimeSources" class="border-t border-[var(--divider)] pt-4 space-y-3">
        <CollapsibleSection
            v-model:open="runtimeExpanded"
            icon-class="i-lucide-timer"
            :label="t('settings.panels.profileModels.runtime.defaultsTitle')"
            :disabled="props.disabled"
        >
            <template #meta>
                <Badge v-if="runtimeOverrideCount > 0" tone="neutral">{{ t("settings.panels.profileModels.overrideCount", {count: runtimeOverrideCount}) }}</Badge>
                <span v-if="runtimeHasErrors" class="i-lucide-triangle-alert h-4 w-4 shrink-0 text-[var(--status-danger)]" aria-hidden="true"></span>
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
        </CollapsibleSection>
    </section>
</template>
