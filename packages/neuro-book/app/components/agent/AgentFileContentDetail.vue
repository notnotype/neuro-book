<script setup lang="ts">
import {computed} from "vue";
import type {ToolDetailProps} from "./agent-view-registry";
import AgentCodeBlock from "./AgentCodeBlock.vue";
import {argString} from "./tool-args";
import {fileContentLines} from "./tool-detail-lines";

const props = defineProps<ToolDetailProps>();

const {t} = useI18n();

const content = computed(() => fileContentLines(props.call));
</script>

<template>
    <AgentCodeBlock
        v-if="props.call.result"
        :label="argString(props.call, 'path')"
        :lines="content.lines"
        :start-line="content.startLine"
        :truncated="props.call.result.truncated"
    />
    <p v-else-if="!props.call.error" class="agent-file-content-detail__pending">{{ t("agentView.toolDetail.pending") }}</p>
</template>

<style scoped>
.agent-file-content-detail__pending {
    color: var(--text-muted);
    font-size: 11px;
}
</style>
