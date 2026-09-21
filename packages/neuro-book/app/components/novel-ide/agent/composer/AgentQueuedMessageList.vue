<script setup lang="ts">
import type {AgentQueuedMessageDto} from "nbook/shared/dto/agent-session.dto";
import {publicValuePreviewJsonValue} from "nbook/app/components/novel-ide/agent/agent-message";

const props = defineProps<{
    queuedMessages: AgentQueuedMessageDto[];
}>();

const {t} = useI18n();

const queuedMessageText = (item: AgentQueuedMessageDto): string => {
    const text = item.text?.preview.trim();
    if (text) {
        return text;
    }
    if (item.images.length > 0) {
        return `包含 ${String(item.images.length + item.omittedImages)} 张图片`;
    }
    return item.input === undefined ? "" : JSON.stringify(publicValuePreviewJsonValue(item.input));
};

const queuedMessageIcon = (item: AgentQueuedMessageDto): string => item.kind === "steer" ? "i-lucide-corner-down-left" : "i-lucide-list-plus";

const queuedMessageLabel = (item: AgentQueuedMessageDto): string => item.kind === "steer" ? t("agent.composer.steer") : t("agent.composer.queue");
</script>

<template>
    <div v-if="props.queuedMessages.length > 0" class="flex min-w-0 flex-wrap gap-1 px-1 pb-1.5">
        <div
            v-for="item in props.queuedMessages"
            :key="item.id"
            class="inline-flex max-w-full items-center gap-1 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]"
            :title="`${queuedMessageLabel(item)}：${queuedMessageText(item)}`"
        >
            <span :class="queuedMessageIcon(item)" class="h-3 w-3 shrink-0 text-[var(--accent-text)]"></span>
            <span class="shrink-0 font-medium">{{ queuedMessageLabel(item) }}</span>
            <span class="max-w-[18rem] truncate text-[var(--text-muted)]">{{ queuedMessageText(item) }}</span>
        </div>
    </div>
</template>
