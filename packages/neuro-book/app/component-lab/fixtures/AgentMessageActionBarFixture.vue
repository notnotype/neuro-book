<script setup lang="ts">
import AgentMessageActionBar from "../../components/novel-ide/agent/bubbles/base/AgentMessageActionBar.vue";
import {useLabEventSink} from "../lab-event-sink";

import type {AgentMessageSwitcherState} from "../../components/novel-ide/agent/agent-message";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();

const branchState: AgentMessageSwitcherState = {
    nodeIds: ["node-1", "node-2", "node-3"],
    currentIndex: 1,
    total: 3,
};
</script>

<template>
    <div class="w-full p-4">
        <AgentMessageActionBar
            data-lab-subject
            class="w-full"
            :can-edit="props.scene === 'user' || props.scene === 'all'"
            :can-retry="props.scene === 'assistant' || props.scene === 'all'"
            :is-unknown-delivery="props.scene === 'unknown'"
            :branch-switcher="props.scene === 'with-branch' ? branchState : undefined"
            :action-disabled="props.scene === 'disabled'"
            @copy="emitLabEvent('copy')"
            @start-edit="emitLabEvent('start-edit')"
            @retry="emitLabEvent('retry')"
            @branch-from-here="emitLabEvent('branch-from-here')"
            @cycle-branch="emitLabEvent('cycle-branch', $event)"
        />
    </div>
</template>
