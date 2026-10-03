<script setup lang="ts">
import AgentSwitchModeBubble from "../../components/novel-ide/agent/bubbles/interactive/AgentSwitchModeBubble.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import type {AgentToolCall} from "../../components/novel-ide/agent/agent-message";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentSwitchModeBubble>(() => props.input);
</script>
<template>
    <div class="w-full p-4"><AgentSwitchModeBubble data-lab-subject class="w-full" v-bind="subject.bindings.value" :tool-call="subject.bindings.value.toolCall as AgentToolCall" /></div>
</template>
