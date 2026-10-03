<script setup lang="ts">
import AgentAssistantBubble from "../../components/novel-ide/agent/bubbles/text/AgentAssistantBubble.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import type {AgentMessage} from "../../components/novel-ide/agent/agent-message";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentAssistantBubble>(() => props.input, ["copy","retry","branch-from-here"]);
</script>
<template>
    <div class="w-full p-4"><AgentAssistantBubble data-lab-subject class="w-full" v-bind="subject.bindings.value" :message="subject.bindings.value.message as AgentMessage" /></div>
</template>
