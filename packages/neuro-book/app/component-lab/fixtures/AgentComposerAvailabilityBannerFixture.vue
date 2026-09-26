<script setup lang="ts">
import AgentComposerAvailabilityBanner from "../../components/novel-ide/agent/composer/AgentComposerAvailabilityBanner.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentComposerAvailabilityBanner>(() => props.input, ["action"]);
</script>
<template>
    <div class="w-full p-4"><AgentComposerAvailabilityBanner data-lab-subject class="w-full" v-bind="subject.bindings.value" /></div>
</template>
