<script setup lang="ts">
import AgentQueuedMessageList from "../../components/novel-ide/agent/composer/AgentQueuedMessageList.vue";
import type {AgentQueuedMessageDto} from "nbook/shared/dto/agent-session.dto";
import type {PublicTextPreviewDto} from "nbook/shared/dto/agent-public-event.dto";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const makeText = (preview: string): PublicTextPreviewDto => ({
    preview,
    bytes: preview.length,
    omitted: false,
});

const queuedMessages = computed<AgentQueuedMessageDto[]>(() => {
    switch (props.scene) {
        case "steer-only":
            return [
                {
                    id: "queue-1",
                    clientMessageId: "client-1",
                    kind: "steer",
                    text: makeText("请重点描写主角的心理挣扎"),
                    images: [],
                    omittedImages: 0,
                    createdAt: Date.now(),
                },
            ];
        case "queue-only":
            return [
                {
                    id: "queue-2",
                    clientMessageId: "client-2",
                    kind: "followup",
                    text: makeText("帮我总结一下这一章的冲突点"),
                    images: [],
                    omittedImages: 0,
                    createdAt: Date.now(),
                },
                {
                    id: "queue-3",
                    clientMessageId: "client-3",
                    kind: "followup",
                    text: makeText("检查第三节的伏笔是否收回"),
                    images: [],
                    omittedImages: 0,
                    createdAt: Date.now(),
                },
            ];
        case "mixed":
        default:
            return [
                {
                    id: "queue-1",
                    clientMessageId: "client-1",
                    kind: "steer",
                    text: makeText("不要写得太冗长，加快节奏"),
                    images: [],
                    omittedImages: 0,
                    createdAt: Date.now(),
                },
                {
                    id: "queue-2",
                    clientMessageId: "client-2",
                    kind: "followup",
                    text: makeText("下一段准备接入悬念"),
                    images: [],
                    omittedImages: 0,
                    createdAt: Date.now(),
                },
            ];
    }
});
</script>

<template>
    <div class="w-full p-4">
        <AgentQueuedMessageList data-lab-subject class="w-full" :queued-messages="queuedMessages" />
    </div>
</template>
