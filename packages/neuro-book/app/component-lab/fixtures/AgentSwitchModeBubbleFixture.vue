<script setup lang="ts">
import AgentSwitchModeBubble from "../../components/novel-ide/agent/bubbles/interactive/AgentSwitchModeBubble.vue";
import type {AgentToolCall} from "../../components/novel-ide/agent/agent-message";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const toolCall: AgentToolCall = {
    id: "tc-switch",
    index: 0,
    name: "switch_mode",
    argsText: JSON.stringify({
        targetMode: props.scene === "writer" ? "writer" : "reviewer",
        reason: "当前任务需要专注于大纲结构的逻辑校验与伏笔呼应审校。",
    }),
    status: "success",
    result: JSON.stringify({approved: true, targetMode: props.scene === "writer" ? "writer" : "reviewer"}),
};
</script>

<template>
    <div class="w-full p-4">
        <AgentSwitchModeBubble
            data-lab-subject
            class="w-full"
            :tool-call="toolCall"
        />
    </div>
</template>
