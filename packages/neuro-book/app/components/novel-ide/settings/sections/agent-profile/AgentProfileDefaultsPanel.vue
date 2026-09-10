<script setup lang="ts">
import type {AgentProfileModelConfigDto} from "nbook/shared/dto/app-settings.dto";
import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";
import type {AgentProfileModelDraft, AgentProfileModelFieldErrors} from "./agent-profile-draft";
import type {FormSelectOption} from "@notnotype/nb-ui/components";
import type {ProfileRuntimeSettingsDraft, ProfileRuntimeSettingsErrors, ProfileRuntimeSettingsSources} from "./profile-runtime-settings";
import AgentProfileDefaultProfileSection from "./AgentProfileDefaultProfileSection.vue";
import AgentProfileDefaultModelSection from "./AgentProfileDefaultModelSection.vue";
import AgentProfileDefaultRuntimeSection from "./AgentProfileDefaultRuntimeSection.vue";

const props = withDefaults(defineProps<{
    scope: "global" | "project";
    defaultProfileKey: string;
    defaultProfileOptions: FormSelectOption[];
    effectiveDefaultProfileKey: string;
    modelDefaults: AgentProfileModelDraft;
    globalModelDefaults: AgentProfileModelConfigDto;
    enabledModels: ConfigAgentProfileSettingsDto["enabledModels"];
    validationIssues: ConfigAgentProfileSettingsDto["validationIssues"];
    modelErrors?: AgentProfileModelFieldErrors;
    runtimeDefaults: ProfileRuntimeSettingsDraft;
    runtimeEffective: ConfigAgentProfileSettingsDto["profileRuntimeDefaults"] | null;
    runtimeSources: ProfileRuntimeSettingsSources | null;
    runtimeErrors: ProfileRuntimeSettingsErrors;
    disabled?: boolean;
}>(), {
    disabled: false,
});

const emit = defineEmits<{
    (event: "update:defaultProfileKey", value: string): void;
    (event: "update:modelDefaults", value: AgentProfileModelDraft): void;
    (event: "update:runtimeDefaults", value: ProfileRuntimeSettingsDraft): void;
    (event: "reset"): void;
}>();
</script>

<template>
    <div class="space-y-4 pb-8">
        <AgentProfileDefaultProfileSection
            :scope="props.scope"
            :default-profile-key="props.defaultProfileKey"
            :default-profile-options="props.defaultProfileOptions"
            :effective-default-profile-key="props.effectiveDefaultProfileKey"
            :disabled="props.disabled"
            @update:default-profile-key="emit('update:defaultProfileKey', $event)"
        />
        <AgentProfileDefaultModelSection
            :scope="props.scope"
            :model-defaults="props.modelDefaults"
            :global-model-defaults="props.globalModelDefaults"
            :enabled-models="props.enabledModels"
            :validation-issues="props.validationIssues"
            :model-errors="props.modelErrors"
            :disabled="props.disabled"
            @update:model-defaults="emit('update:modelDefaults', $event)"
            @reset="emit('reset')"
        />
        <AgentProfileDefaultRuntimeSection
            :scope="props.scope"
            :runtime-defaults="props.runtimeDefaults"
            :runtime-effective="props.runtimeEffective"
            :runtime-sources="props.runtimeSources"
            :runtime-errors="props.runtimeErrors"
            :disabled="props.disabled"
            @update:runtime-defaults="emit('update:runtimeDefaults', $event)"
        />
    </div>
</template>
