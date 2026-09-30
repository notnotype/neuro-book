<script setup lang="ts">
import AgentApplyPatchBubble from "../../components/novel-ide/agent/bubbles/tools/AgentApplyPatchBubble.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import type {AgentToolCall} from "../../components/novel-ide/agent/agent-message";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentApplyPatchBubble>(() => props.input);
</script>
<template>
    <div class="w-full p-4"><AgentApplyPatchBubble data-lab-subject class="w-full" v-bind="subject.bindings.value" :tool-call="subject.bindings.value.toolCall as AgentToolCall" /></div>
</template>
