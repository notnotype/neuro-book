<script setup lang="ts">
import AgentProfileRuntimeSection from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileRuntimeSection.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentProfileRuntimeSection>(() => props.input, ["update:runtime"]);
function updateRuntime(value: typeof subject.bindings.value.profile.runtime): void {
    subject.write("props", "profile", {...subject.bindings.value.profile, runtime: value});
}
</script>
<template>
    <div class="min-h-[520px] w-full min-w-0 overflow-y-auto p-4">
        <AgentProfileRuntimeSection data-lab-subject v-bind="subject.bindings.value" @update:runtime="updateRuntime" />
    </div>
</template>
