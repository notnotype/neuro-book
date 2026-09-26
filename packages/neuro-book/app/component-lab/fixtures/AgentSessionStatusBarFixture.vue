<script setup lang="ts">
import AgentSessionStatusBar from "../../components/novel-ide/agent/panels/status/AgentSessionStatusBar.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentSessionStatusBar>(() => props.input, ["open-context-inspector","reconnect-events","refresh-history"]);
</script>
<template>
    <div class="w-full p-4"><AgentSessionStatusBar data-lab-subject class="w-full" v-bind="subject.bindings.value" /></div>
</template>
