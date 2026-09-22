<script setup lang="ts">
import AgentTaskBubble from "../../components/novel-ide/agent/bubbles/tools/AgentTaskBubble.vue";
import type {AgentToolCall} from "../../components/novel-ide/agent/agent-message";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const toolCall: AgentToolCall = {
    id: "tc-task",
    index: 0,
    name: "task_create",
    argsText: JSON.stringify({
        title: "重构第二幕矛盾冲突",
        steps: [
            {id: "s1", title: "梳理暗夜之誓的背景设定与先知遗嘱", status: "completed"},
            {id: "s2", title: "在第二章前半段加入怀表道具特写与心理暗示", status: "in_progress"},
            {id: "s3", title: "修正背叛对峙场景的台词张力", status: "pending"},
        ],
    }),
    status: props.scene === "running" ? "running" : "success",
};
</script>

<template>
    <div class="w-full p-4">
        <AgentTaskBubble
            data-lab-subject
            class="w-full"
            :tool-call="toolCall"
        />
    </div>
</template>
