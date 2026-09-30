<script setup lang="ts">
import AgentThinkingCollapsible from "../../components/novel-ide/agent/bubbles/base/AgentThinkingCollapsible.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentThinkingCollapsible>(() => props.input);
</script>
<template>
    <div class="w-full p-4"><AgentThinkingCollapsible data-lab-subject class="w-full" v-bind="subject.bindings.value" /></div>
</template>
