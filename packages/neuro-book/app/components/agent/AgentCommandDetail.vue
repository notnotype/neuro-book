<script setup lang="ts">
import type {ToolDetailProps} from "./agent-view-registry";
import AgentCodeBlock from "./AgentCodeBlock.vue";
import {commandText, textLines} from "./tool-detail-lines";

const props = defineProps<ToolDetailProps>();

const {t} = useI18n();
</script>

<template>
    <div class="agent-command-detail">
        <AgentCodeBlock :label="t('agentView.toolDetail.command')" :lines="textLines(commandText(props.call))" />
        <AgentCodeBlock
            v-if="props.call.result"
            :label="t('agentView.toolDetail.output')"
            :lines="textLines(props.call.result.text)"
            :truncated="props.call.result.truncated"
        />
        <p v-else-if="!props.call.error" class="agent-command-detail__pending">{{ t("agentView.toolDetail.pending") }}</p>
    </div>
</template>

<style scoped>
.agent-command-detail {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
}

.agent-command-detail__pending {
    color: var(--text-muted);
    font-size: 11px;
}
</style>
