<script setup lang="ts">
import AgentProfileNavList from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileNavList.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentProfileNavList>(() => props.input);

</script>

<template>
    <div class="h-full w-full min-w-0 overflow-hidden">
        <AgentProfileNavList
            data-lab-subject
            class="h-full w-full"
            v-bind="subject.bindings.value"
        />
    </div>
</template>
