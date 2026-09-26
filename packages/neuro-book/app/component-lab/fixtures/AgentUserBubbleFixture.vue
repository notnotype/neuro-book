<script setup lang="ts">
import AgentUserBubble from "../../components/novel-ide/agent/bubbles/text/AgentUserBubble.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import type {AgentMessage} from "../../components/novel-ide/agent/agent-message";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentUserBubble>(() => props.input, ["copy","start-edit","retry","branch-from-here","resend-unknown","dismiss-unknown"]);
</script>
<template>
    <div class="w-full p-4"><AgentUserBubble data-lab-subject class="w-full" v-bind="subject.bindings.value" :message="subject.bindings.value.message as AgentMessage" /></div>
</template>
