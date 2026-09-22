<script setup lang="ts">
import {ref} from "vue";
import AgentChatHistoryLoader from "../../components/novel-ide/agent/flow/AgentChatHistoryLoader.vue";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();
const localLoading = ref(props.scene === "loading");

function handleLoad(): void {
    emitLabEvent("load");
    localLoading.value = true;
    setTimeout(() => {
        localLoading.value = false;
    }, 1200);
}
</script>

<template>
    <div class="w-full p-4">
        <AgentChatHistoryLoader
            data-lab-subject
            class="w-full"
            :has-previous="true"
            :loading="localLoading || props.scene === 'loading'"
            :error="props.scene === 'error' ? '网络连接超时，请重试' : ''"
            @load="handleLoad"
        />
    </div>
</template>
