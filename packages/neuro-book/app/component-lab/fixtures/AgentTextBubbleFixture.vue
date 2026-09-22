<script setup lang="ts">
import AgentTextBubble from "../../components/novel-ide/agent/bubbles/text/AgentTextBubble.vue";
import type {ChatNode} from "../../components/novel-ide/agent/agent-message";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

function getNode(scene: string): Extract<ChatNode, {kind: "text"}> {
    if (scene === "system") {
        return {
            kind: "text",
            message: {
                id: "tb-sys",
                type: "system",
                content: "系统已成功挂载工作区上下文。",
            },
        };
    }
    if (scene === "user") {
        return {
            kind: "text",
            message: {
                id: "tb-user",
                type: "user",
                content: "请帮我重构一下这段关于夜晚街道的描写。",
                timestamp: "10:15:00",
            },
        };
    }
    return {
        kind: "text",
        message: {
            id: "tb-ai",
            type: "ai",
            model: "claude-3-5-sonnet",
            thinking: "思考如何增强五感描写...",
            content: "好的，我们可以从气味和声音切入，增加潮湿雨后石板路的质感。",
            status: "done",
            timestamp: "10:15:05",
        },
    };
}
</script>

<template>
    <div class="w-full p-4">
        <AgentTextBubble
            data-lab-subject
            class="w-full"
            :node="getNode(props.scene)"
        />
    </div>
</template>
