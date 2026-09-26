<script setup lang="ts">
import AgentProfileIdentitySection from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileIdentitySection.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentProfileIdentitySection>(() => props.input);
</script>
<template>
    <div class="min-h-[520px] w-full min-w-0 overflow-y-auto p-4">
        <AgentProfileIdentitySection data-lab-subject v-bind="subject.bindings.value" />
    </div>
</template>
