<script setup lang="ts">
import AgentChatEmptyState from "../../components/novel-ide/agent/flow/AgentChatEmptyState.vue";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();
</script>

<template>
    <div class="flex h-full w-full items-center justify-center">
        <AgentChatEmptyState
            data-lab-subject
            class="w-full"
            :mode="props.scene === 'compact' ? 'compact' : 'main'"
            :unselected="props.scene === 'unselected'"
        />
    </div>
</template>
