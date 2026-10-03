<script setup lang="ts">
import AgentToolNode from "../../components/novel-ide/agent/bubbles/tools/AgentToolNode.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import type {AgentToolCall} from "../../components/novel-ide/agent/agent-message";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentToolNode>(() => props.input);
function toggle(): void {
    subject.write("props", "expanded", !subject.bindings.value.expanded);
}
</script>
<template>
    <div class="w-full p-4"><AgentToolNode data-lab-subject class="w-full" v-bind="subject.bindings.value" :tool-call="subject.bindings.value.toolCall as AgentToolCall" @toggle="toggle" /></div>
</template>
