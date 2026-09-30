<script setup lang="ts">
import AgentToolBubble from "../../components/novel-ide/agent/bubbles/tools/AgentToolBubble.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import type {AgentToolCall} from "../../components/novel-ide/agent/agent-message";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentToolBubble>(() => props.input);
</script>
<template>
    <div class="w-full p-4"><AgentToolBubble data-lab-subject class="w-full" v-bind="subject.bindings.value" :tool-call="subject.bindings.value.toolCall as AgentToolCall" /></div>
</template>
