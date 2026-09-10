<script setup lang="ts">
import {computed} from "vue";
import type {AgentProfileModelConfigDto, EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";
import type {LowCodeJsonObject, LowCodeResourceMutationDto} from "nbook/shared/dto/low-code-form.dto";
import type {AgentProfileDraft, AgentProfileModelDraft, AgentProfileModelFieldErrors} from "./agent-profile-draft";
import type {ProfileRuntimeSettingsDraft, ProfileRuntimeSettingsErrors} from "./profile-runtime-settings";
import AgentProfileCustomSettingsSection from "./AgentProfileCustomSettingsSection.vue";
import AgentProfileIdentitySection from "./AgentProfileIdentitySection.vue";
import AgentProfileModelSection from "./AgentProfileModelSection.vue";
import AgentProfileRuntimeSection from "./AgentProfileRuntimeSection.vue";

const props = withDefaults(defineProps<{
    profile: AgentProfileDraft;
    inheritedModel: AgentProfileModelConfigDto;
    enabledModels: EnabledModelOptionDto[];
    validationIssues: ConfigAgentProfileSettingsDto["validationIssues"];
    modelErrors?: AgentProfileModelFieldErrors;
    scope: "global" | "project";
    runtimeBaseline: {settings: ConfigAgentProfileSettingsDto["agentProfiles"][number]["runtime"]["effective"]; sources: Record<string, string>} | null;
    runtimeErrors?: ProfileRuntimeSettingsErrors;
    descriptions: Record<string, string>;
    disabled?: boolean;
    isDefaultProfile: boolean;
}>(), {
    disabled: false,
    runtimeErrors: () => ({}),
});

const emit = defineEmits<{
    (event: "update:model", value: AgentProfileModelDraft): void;
    (event: "update:runtime", value: ProfileRuntimeSettingsDraft): void;
    (event: "update:settingsValues", value: LowCodeJsonObject): void;
    (event: "update:settingsOverridePaths", value: string[]): void;
    (event: "update:settingsResourceMutations", value: LowCodeResourceMutationDto[]): void;
}>();

const {t} = useI18n();

/** 编译队列提示；无进行中的构建时为空串。 */
const buildHint = computed(() => {
    if (props.profile.buildState.running) return t("settings.panels.profileModels.buildRunning");
    if (props.profile.buildState.queued) return t("settings.panels.profileModels.buildQueued");
    return "";
});
</script>


<template>
    <section class="space-y-4">
        <AgentProfileIdentitySection
            :profile="props.profile"
            :descriptions="props.descriptions"
            :is-default-profile="props.isDefaultProfile"
            :build-hint="buildHint"
        />
        <AgentProfileModelSection
            :model="props.profile.model"
            :inherited="props.inheritedModel"
            :enabled-models="props.enabledModels"
            :validation-issues="props.validationIssues"
            :model-errors="props.modelErrors"
            :disabled="props.disabled"
            @update:model="emit('update:model', $event)"
        />
        <AgentProfileCustomSettingsSection
            :profile="props.profile"
            :scope="props.scope"
            :disabled="props.disabled"
            @update:settings-values="emit('update:settingsValues', $event)"
            @update:settings-override-paths="emit('update:settingsOverridePaths', $event)"
            @update:settings-resource-mutations="emit('update:settingsResourceMutations', $event)"
        />
        <AgentProfileRuntimeSection
            :profile="props.profile"
            :runtime-baseline="props.runtimeBaseline"
            :runtime-errors="props.runtimeErrors"
            :disabled="props.disabled"
            @update:runtime="emit('update:runtime', $event)"
        />
    </section>
</template>
