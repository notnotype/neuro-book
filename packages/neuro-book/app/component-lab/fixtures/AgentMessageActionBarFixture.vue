<script setup lang="ts">
import AgentMessageActionBar from "../../components/novel-ide/agent/bubbles/base/AgentMessageActionBar.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentMessageActionBar>(() => props.input, ["copy","start-edit","retry","branch-from-here","cycle-branch"]);
</script>
<template>
    <div class="w-full p-4"><AgentMessageActionBar data-lab-subject class="w-full" v-bind="subject.bindings.value" /></div>
</template>
