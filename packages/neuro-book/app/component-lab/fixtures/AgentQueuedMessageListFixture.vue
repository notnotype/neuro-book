<script setup lang="ts">
import AgentQueuedMessageList from "../../components/novel-ide/agent/composer/AgentQueuedMessageList.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import type {AgentQueuedMessageDto} from "nbook/shared/dto/agent-session.dto";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentQueuedMessageList>(() => props.input);
</script>
<template>
    <div class="w-full p-4"><AgentQueuedMessageList data-lab-subject class="w-full" v-bind="subject.bindings.value" :queued-messages="subject.bindings.value.queuedMessages as AgentQueuedMessageDto[]" /></div>
</template>
