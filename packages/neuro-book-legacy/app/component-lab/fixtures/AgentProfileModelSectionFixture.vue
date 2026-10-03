<script setup lang="ts">
import AgentProfileModelSection from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileModelSection.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentProfileModelSection>(() => props.input, ["update:model"]);
function updateModel(value: typeof subject.bindings.value.model): void {
    subject.write("props", "model", value);
}
</script>
<template>
    <div class="min-h-[520px] w-full min-w-0 overflow-y-auto p-4">
        <AgentProfileModelSection data-lab-subject v-bind="subject.bindings.value" @update:model="updateModel" />
    </div>
</template>
