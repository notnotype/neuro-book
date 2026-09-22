<script setup lang="ts">
import AgentToolBubble from "../../components/novel-ide/agent/bubbles/tools/AgentToolBubble.vue";
import type {AgentToolCall} from "../../components/novel-ide/agent/agent-message";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const toolCall: AgentToolCall = {
    id: "tb-call-1",
    index: 0,
    name: "read_file",
    argsText: JSON.stringify({path: "chapters/01.md"}),
    status: "success",
    result: "章回内容预览...",
};
</script>

<template>
    <div class="w-full p-4">
        <AgentToolBubble
            data-lab-subject
            class="w-full"
            :tool-call="toolCall"
        />
    </div>
</template>
