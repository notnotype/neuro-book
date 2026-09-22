<script setup lang="ts">
import AgentSystemBubble from "../../components/novel-ide/agent/bubbles/text/AgentSystemBubble.vue";
import type {AgentMessage} from "../../components/novel-ide/agent/agent-message";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

function getMessage(scene: string): AgentMessage {
    switch (scene) {
        case "reminder":
            return {
                id: "sys-reminder",
                type: "system",
                systemDisplayKind: "reminder",
                content: "上下文窗口已达到 85%，系统已自动触发记忆压缩整理。",
            };
        case "error":
            return {
                id: "sys-error",
                type: "system",
                systemDisplayKind: "error",
                content: "调用 Claude 模型接口发生网络超时错误 (ETIMEDOUT)，请检查本地代理或网络连接后点击重试。",
            };
        case "prompt":
        default:
            return {
                id: "sys-prompt",
                type: "system",
                systemDisplayKind: "prompt",
                content: "你是一个专门负责小说大纲结构优化与人设一致性校对的资深文学助理。请严格遵循世界观设定的物理法则与魔法体系铁律。",
            };
    }
}
</script>

<template>
    <div class="w-full p-4">
        <AgentSystemBubble
            data-lab-subject
            class="w-full"
            :message="getMessage(props.scene)"
        />
    </div>
</template>
