<script setup lang="ts">
import AgentProfileCustomSettingsSection from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileCustomSettingsSection.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentProfileCustomSettingsSection>(() => props.input, ["update:settingsValues", "update:settingsOverridePaths", "update:settingsResourceMutations"]);
function updateSettings(key: "values" | "overridePaths" | "resourceMutations", value: unknown): void {
    const profile = subject.bindings.value.profile;
    if (profile.settings) subject.write("props", "profile", {...profile, settings: {...profile.settings, [key]: value}});
}
</script>
<template>
    <div class="min-h-[520px] w-full min-w-0 overflow-y-auto p-4">
        <AgentProfileCustomSettingsSection data-lab-subject v-bind="subject.bindings.value"
            @update:settings-values="updateSettings('values', $event)"
            @update:settings-override-paths="updateSettings('overridePaths', $event)"
            @update:settings-resource-mutations="updateSettings('resourceMutations', $event)" />
    </div>
</template>
