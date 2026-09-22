<script setup lang="ts">
import AgentComposerAvailabilityBanner from "../../components/novel-ide/agent/composer/AgentComposerAvailabilityBanner.vue";
import type {AgentComposerAvailability} from "../../components/novel-ide/agent/agent-chat-surface-state";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();

const availability = computed<AgentComposerAvailability>(() => {
    switch (props.scene) {
        case "empty":
            return {status: "empty", readonly: true, canStop: false};
        case "archived":
            return {status: "archived", readonly: true, canRestore: true, canStop: false};
        case "load-error":
            return {status: "load-error", readonly: true, message: "同步会话记录超时，网络连接已中断。", canStop: false};
        case "waiting-blocked":
            return {status: "waiting-blocked", readonly: true, canStop: false};
        case "unselected":
        default:
            return {status: "unselected", readonly: true, canStop: false};
    }
});
</script>

<template>
    <div class="w-full p-4">
        <AgentComposerAvailabilityBanner
            data-lab-subject
            class="w-full"
            :availability="availability"
            @action="emitLabEvent('action', $event)"
        />
    </div>
</template>
