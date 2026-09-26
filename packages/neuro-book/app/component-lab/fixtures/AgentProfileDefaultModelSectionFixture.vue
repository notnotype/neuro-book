<script setup lang="ts">
import AgentProfileDefaultModelSection from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileDefaultModelSection.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentProfileDefaultModelSection>(() => props.input, ["reset"]);
function reset(): void {
    subject.write("props", "modelDefaults", structuredClone(props.input?.props?.globalModelDefaults));
}
</script>
<template>
    <div class="min-h-[520px] w-full min-w-0 overflow-y-auto p-4">
        <AgentProfileDefaultModelSection data-lab-subject v-bind="subject.bindings.value" @reset="reset" />
    </div>
</template>
