<script setup lang="ts">
import {computed} from "vue";
import type {AgentConversationContext, ToolCallView} from "./agent-view.types";
import type {AgentViewRegistry} from "./agent-view-registry";
import AgentCodeBlock from "./AgentCodeBlock.vue";
import {jsonLines, textLines} from "./tool-detail-lines";

const props = defineProps<{
    call: ToolCallView;
    ctx: AgentConversationContext;
    registry: AgentViewRegistry;
}>();

const {t} = useI18n();

const adapter = computed(() => props.registry.resolveTool(props.call.name).detail ?? null);
</script>

<template>
    <div class="agent-tool-detail">
        <p v-if="props.call.error" class="agent-tool-detail__error">{{ props.call.error }}</p>
        <!-- 出错且没有结果时，适配组件没东西可画，附上原始参数以便看是什么参数导致的 -->
        <AgentCodeBlock
            v-if="adapter && props.call.error && !props.call.result"
            :label="t('agentView.toolDetail.args', {name: props.call.name})"
            :lines="jsonLines(props.call.args)"
        />
        <component :is="adapter" v-else-if="adapter" :call="props.call" :ctx="props.ctx" />
        <!-- 没有适配的工具：原样显示参数与结果 -->
        <template v-else>
            <AgentCodeBlock :label="t('agentView.toolDetail.args', {name: props.call.name})" :lines="jsonLines(props.call.args)" />
            <AgentCodeBlock
                v-if="props.call.result"
                :label="t('agentView.toolDetail.result')"
                :lines="textLines(props.call.result.text)"
                :truncated="props.call.result.truncated"
            />
            <AgentCodeBlock
                v-if="props.call.result?.details !== undefined"
                :label="t('agentView.toolDetail.details')"
                :lines="jsonLines(props.call.result.details)"
            />
            <p v-if="!props.call.result && !props.call.error" class="agent-tool-detail__pending">{{ t("agentView.toolDetail.pending") }}</p>
        </template>
    </div>
</template>

<style scoped>
.agent-tool-detail {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    padding: 2px 0 4px;
}

.agent-tool-detail__error {
    color: var(--status-danger);
    font-size: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.agent-tool-detail__pending {
    color: var(--text-muted);
    font-size: 11px;
}
</style>
