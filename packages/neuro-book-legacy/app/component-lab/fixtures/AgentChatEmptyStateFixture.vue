<script setup lang="ts">
import AgentChatEmptyState from "../../components/novel-ide/agent/flow/AgentChatEmptyState.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentChatEmptyState>(() => props.input);
</script>
<template>
    <div class="flex h-full w-full items-center justify-center"><AgentChatEmptyState data-lab-subject class="w-full" v-bind="subject.bindings.value" /></div>
</template>
