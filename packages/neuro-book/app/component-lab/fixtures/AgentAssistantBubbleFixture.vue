<script setup lang="ts">
import {ref} from "vue";
import AgentAssistantBubble from "../../components/novel-ide/agent/bubbles/text/AgentAssistantBubble.vue";
import type {AgentMessage} from "../../components/novel-ide/agent/agent-message";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();

function getMessage(scene: string): AgentMessage {
    switch (scene) {
        case "streaming":
            return {
                id: "ai-streaming",
                type: "ai",
                model: "claude-3-5-sonnet",
                status: "streaming",
                thinking: "正在构思悬念开局的三种经典范式：倒叙切入、危机切入与日常突变...",
                content: "设计悬念开场通常有以下三种行之有效的切入方式：\n\n1. **危机中途切入（In Media Res）**：直接从追逐或暗杀的高潮时刻开始；\n2. **认知反差法**：用看似平常的对话揭示骇人听闻的秘密；\n3. **遗物线索法**：通过一件不属于死者的旧物引出一段被尘封的历史。\n\n您更倾向于哪种叙事基调？",
                timestamp: "10:01:05",
            };
        case "interrupted":
            return {
                id: "ai-interrupted",
                type: "ai",
                model: "gpt-4o",
                status: "interrupted",
                content: "主角在雪夜中前行，忽然听到了远处传来的钟声...",
                timestamp: "10:02:00",
            };
        case "with-cost":
            return {
                id: "ai-cost",
                type: "ai",
                model: "claude-3-5-sonnet",
                status: "done",
                content: "已经根据您的要求完成了第一幕的节奏评估与情节张力分析。",
                timestamp: "10:03:00",
                usage: {
                    input: 12450,
                    output: 820,
                    cacheRead: 9800,
                    cacheWrite: 2650,
                    totalTokens: 13270,
                    cost: {
                        input: 0.037,
                        output: 0.012,
                        cacheRead: 0.003,
                        cacheWrite: 0.008,
                        total: 0.06,
                    },
                },
            };
        case "default":
        default:
            return {
                id: "ai-default",
                type: "ai",
                model: "claude-3-5-sonnet",
                status: "done",
                thinking: "分析长篇小说开场的读者留存心理学：前 3000 字的核心任务是建立情绪钩子。",
                content: "长篇小说的第一卷开局至关重要。一个好的悬念应当**早早埋下问题，但推迟给出答案**。\n\n例如：主角不是发现自己身处险境，而是发现身边最信任的人在秘密记录自己的行踪。",
                timestamp: "10:00:30",
            };
    }
}

const msg = ref<AgentMessage>(getMessage(props.scene));
</script>

<template>
    <div class="w-full p-4">
        <AgentAssistantBubble
            data-lab-subject
            class="w-full"
            :message="msg"
            @copy="emitLabEvent('copy', $event)"
            @retry="emitLabEvent('retry', $event)"
            @branch-from-here="emitLabEvent('branch-from-here', $event)"
        />
    </div>
</template>
