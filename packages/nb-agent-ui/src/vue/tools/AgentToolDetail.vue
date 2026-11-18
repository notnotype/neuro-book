<script setup lang="ts">
import {computed} from "vue";
import type {AgentConversationContext, AgentConversationServices, ToolCallView} from "../../types";
import type {AgentViewRegistry} from "../../registry";
import AgentCodeBlock from "../parts/AgentCodeBlock.vue";
import {jsonLines, textLines} from "../../tool-detail-lines";
import RenderGuard from "../parts/RenderGuard.vue";
import {useAgentText} from "../host";
import type {ViewAction} from "../view-action";

const props = defineProps<{
    call: ToolCallView;
    ctx: AgentConversationContext;
    services: AgentConversationServices;
    registry: AgentViewRegistry;
}>();

const emit = defineEmits<{
    (e: "action", action: ViewAction): void;
}>();

const {t, locale} = useAgentText();

const renderer = computed(() => props.registry.resolveTool(props.call.name));
const adapter = computed(() => renderer.value.detail ?? null);
/**
 * 没有详情组件时画渲染器给的 diff；给不出（null）时与没有适配一样，显示原始数据。参数只给了预览的（`argsPreview`）不画 diff：
 * 截短的内容会被画成改动。
 */
const diffLines = computed(() => (adapter.value === null && props.call.argsPreview !== true ? renderer.value.diff?.(props.call) ?? null : null));
const adapted = computed(() => adapter.value !== null || diffLines.value !== null);
</script>

<template>
    <div class="agent-tool-detail">
        <p v-if="props.call.error" class="agent-tool-detail__error">{{ props.call.error }}</p>
        <!-- 出错且没有结果时，适配内容没东西可画，附上原始参数以便看是什么参数导致的 -->
        <AgentCodeBlock
            v-if="adapted && props.call.error && !props.call.result"
            :label="t('toolDetail.args', {name: props.call.name})"
            :lines="jsonLines(props.call.args)"
        />
        <RenderGuard v-else-if="adapter" :source="`工具 ${props.call.name} 的详情组件`">
            <component :is="adapter" :call="props.call" :ctx="props.ctx" :services="props.services" :locale="locale" @action="emit('action', $event)" />
        </RenderGuard>
        <AgentCodeBlock
            v-else-if="diffLines !== null"
            :label="renderer.summary(props.call)"
            :lines="diffLines"
        />
        <!-- 没有适配的工具：原样显示参数与结果 -->
        <template v-else>
            <AgentCodeBlock :label="t('toolDetail.args', {name: props.call.name})" :lines="jsonLines(props.call.args)" />
            <AgentCodeBlock
                v-if="props.call.result"
                :label="t('toolDetail.result')"
                :lines="textLines(props.call.result.text)"
                :truncated="props.call.result.truncated"
            />
            <AgentCodeBlock
                v-if="props.call.result?.details !== undefined"
                :label="t('toolDetail.details')"
                :lines="jsonLines(props.call.result.details)"
            />
            <p v-if="!props.call.result && !props.call.error" class="agent-tool-detail__pending">{{ t("toolDetail.pending") }}</p>
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
    font-size: var(--text-xs);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.agent-tool-detail__pending {
    color: var(--text-muted);
    font-size: var(--text-2xs);
}
</style>
