<script setup lang="ts">
import ProfilePromptMessageCard from "nbook/app/components/profile-template-editor/ProfilePromptMessageCard.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import type {ProfileTemplatePreviewMessageDto} from "nbook/shared/dto/profile-template.dto";

type StructuredTextMode = "rich" | "source";

const props = defineProps<{
    messages: ProfileTemplatePreviewMessageDto[];
    loading?: boolean;
}>();

const previewModes = ref<Record<string, StructuredTextMode>>({});
const collapsedMessages = ref<Record<string, boolean>>({});
const notification = useNotification();

/**
 * 使用 index + role 生成仅用于本次预览列表展示的稳定 key。
 */
function messageKey(message: ProfileTemplatePreviewMessageDto, index: number): string {
    return `${index}-${message.role}-${message.source ?? "context"}`;
}

function messageMode(message: ProfileTemplatePreviewMessageDto, index: number): StructuredTextMode {
    return previewModes.value[messageKey(message, index)] ?? "rich";
}

function updateMessageMode(message: ProfileTemplatePreviewMessageDto, index: number, mode: StructuredTextMode): void {
    previewModes.value = {
        ...previewModes.value,
        [messageKey(message, index)]: mode,
    };
}

function isCollapsed(message: ProfileTemplatePreviewMessageDto, index: number): boolean {
    return collapsedMessages.value[messageKey(message, index)] ?? false;
}

function toggleCollapsed(message: ProfileTemplatePreviewMessageDto, index: number): void {
    const key = messageKey(message, index);
    collapsedMessages.value = {
        ...collapsedMessages.value,
        [key]: !collapsedMessages.value[key],
    };
}

async function copyMessage(message: ProfileTemplatePreviewMessageDto): Promise<void> {
    const text = message.role === "assistant"
        ? JSON.stringify(message, null, 2)
        : message.text;
    if (!text.trim()) {
        return;
    }
    await navigator.clipboard.writeText(text);
    notification.success(message.role === "assistant" ? "AIMessage JSON 已复制" : "消息文本已复制");
}
</script>

<template>
    <div v-if="props.loading" class="empty-state min-h-[160px]">正在生成预览...</div>
    <div v-else-if="props.messages.length === 0" class="empty-state min-h-[160px]">暂无预览消息。</div>
    <div v-else class="profile-prompt-message-list custom-scrollbar">
        <ProfilePromptMessageCard
            v-for="(message, index) in props.messages"
            :key="messageKey(message, index)"
            :message="message"
            :index="index"
            :mode="messageMode(message, index)"
            :collapsed="isCollapsed(message, index)"
            @update:mode="updateMessageMode(message, index, $event)"
            @toggle="toggleCollapsed(message, index)"
            @copy="void copyMessage(message)"
        />
    </div>
</template>

<style scoped>
.profile-prompt-message-list {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: 8px;
    overflow: auto;
    padding-right: 2px;
}
</style>
