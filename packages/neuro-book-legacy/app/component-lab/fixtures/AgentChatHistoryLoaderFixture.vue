<script setup lang="ts">
import AgentChatHistoryLoader from "../../components/novel-ide/agent/flow/AgentChatHistoryLoader.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {ref} from "vue";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentChatHistoryLoader>(() => props.input, ["load"]);
const localLoading = ref(false);
function handleLoad(): void {
    localLoading.value = true;
    setTimeout(() => { localLoading.value = false; }, 1200);
}
</script>
<template>
    <div class="w-full p-4"><AgentChatHistoryLoader data-lab-subject class="w-full" v-bind="subject.bindings.value" :loading="subject.bindings.value.loading || localLoading" @load="handleLoad" /></div>
</template>
