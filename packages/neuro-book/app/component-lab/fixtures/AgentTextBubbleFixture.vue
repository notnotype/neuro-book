<script setup lang="ts">
import AgentTextBubble from "../../components/novel-ide/agent/bubbles/text/AgentTextBubble.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import type {ChatNode} from "../../components/novel-ide/agent/agent-message";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentTextBubble>(() => props.input);
</script>
<template>
    <div class="w-full p-4"><AgentTextBubble data-lab-subject class="w-full" v-bind="subject.bindings.value" :node="subject.bindings.value.node as Extract<ChatNode, {kind: 'text'}>" /></div>
</template>
