<script setup lang="ts">
import {ref} from "vue";
import AgentUserBubble from "../../components/novel-ide/agent/bubbles/text/AgentUserBubble.vue";
import type {AgentMessage} from "../../components/novel-ide/agent/agent-message";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();

function getMessage(scene: string): AgentMessage {
    switch (scene) {
        case "steer":
            return {
                id: "user-steer",
                type: "user",
                intent: "steer",
                content: "注意节奏，不要在这里过早揭晓反派的真实身份。",
                timestamp: "10:05:00",
            };
        case "with-attachments":
            return {
                id: "user-att",
                type: "user",
                content: "请帮我看下这张参考线稿的设计是否符合世界观？",
                timestamp: "10:06:00",
                attachments: [
                    {
                        contentIndex: 0,
                        attachment: {
                            attachmentId: "att-1" as any,
                            mimeType: "image/png",
                            bytes: 1024 * 512,
                            name: "character-sketch.png",
                            dataOmitted: true,
                        },
                    },
                ],
            };
        case "editing":
            return {
                id: "user-edit",
                type: "user",
                content: "这段历史消息正在被用户点击就地编辑...",
                timestamp: "10:07:00",
            };
        case "unknown-delivery":
            return {
                id: "user-unknown",
                type: "user",
                deliveryState: "unknown",
                content: "由于网络原因尚未确认是否投递成功的消息。",
                timestamp: "10:08:00",
            };
        case "default":
        default:
            return {
                id: "user-default",
                type: "user",
                content: "我想为我的长篇小说第一卷设计一个充满悬念的开场，有什么好的思路？",
                timestamp: "10:00:00",
            };
    }
}

const msg = ref<AgentMessage>(getMessage(props.scene));
</script>

<template>
    <div class="w-full p-4">
        <AgentUserBubble
            data-lab-subject
            class="w-full"
            :message="msg"
            :editing-message-id="props.scene === 'editing' ? msg.id : null"
            @copy="emitLabEvent('copy', $event)"
            @start-edit="emitLabEvent('start-edit', $event)"
            @retry="emitLabEvent('retry', $event)"
            @branch-from-here="emitLabEvent('branch-from-here', $event)"
            @resend-unknown="emitLabEvent('resend-unknown', $event)"
            @dismiss-unknown="emitLabEvent('dismiss-unknown', $event)"
        />
    </div>
</template>
