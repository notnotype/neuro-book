<script setup lang="ts">
import AgentAttachmentCard from "./AgentAttachmentCard.vue";
import type {AgentAttachmentDisplay} from "nbook/app/components/novel-ide/agent/agent-attachment";

const props = defineProps<{
    attachments: AgentAttachmentDisplay[];
    sessionId?: number | null;
    /** live 工具结果尚未持久化时为空，由 Card 展示不可用状态。 */
    entryId?: string | null;
}>();
const {t} = useI18n();
</script>

<template>
    <div v-if="props.attachments.length > 0" class="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2" :aria-label="t('agent.chat.attachmentsLabel')">
        <AgentAttachmentCard
            v-for="item in props.attachments"
            :key="`${props.entryId ?? 'pending'}:${item.contentIndex}`"
            :session-id="props.sessionId"
            :entry-id="item.locator?.entryId ?? props.entryId"
            :content-index="item.locator?.contentIndex ?? item.contentIndex"
            :attachment="item.attachment"
        />
    </div>
</template>
