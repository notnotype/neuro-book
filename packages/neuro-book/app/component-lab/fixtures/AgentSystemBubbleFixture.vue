<script setup lang="ts">
import AgentSystemBubble from "../../components/novel-ide/agent/bubbles/text/AgentSystemBubble.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import type {AgentMessage} from "../../components/novel-ide/agent/agent-message";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentSystemBubble>(() => props.input);
</script>
<template>
    <div class="w-full p-4"><AgentSystemBubble data-lab-subject class="w-full" v-bind="subject.bindings.value" :message="subject.bindings.value.message as AgentMessage" /></div>
</template>
