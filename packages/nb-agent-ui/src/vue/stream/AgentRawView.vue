<script setup lang="ts">
import {IconButton} from "@notnotype/nb-ui/components";
import type {
    AgentConversationContext,
    AgentConversationServices,
    AssistantMessageView,
    MessageView,
} from "../../types";
import type {AgentViewRegistry} from "../../registry";
import {textLines} from "../../tool-detail-lines";
import {firstLine, formatClock} from "../../format";
import {formatCost} from "../../process-summary";
import {toolCallPhase} from "../../tool-status";
import AgentCodeBlock from "../parts/AgentCodeBlock.vue";
import AgentDeliveryNotice from "./AgentDeliveryNotice.vue";
import {CollapsibleRow} from "@notnotype/nb-ui/components";
import AgentToolDetail from "../tools/AgentToolDetail.vue";
import AgentUserContent from "./AgentUserContent.vue";
import {useAgentText} from "../host";
import {useOpenSet} from "../use-open-set";
import type {ViewAction} from "../view-action";

const props = defineProps<{
    messages: readonly MessageView[];
    ctx: AgentConversationContext;
    services: AgentConversationServices;
    registry: AgentViewRegistry;
}>();

const emit = defineEmits<{
    (e: "action", action: ViewAction): void;
}>();

const {t, text, locale} = useAgentText();


/** 切到 JSON 的消息、展开的思考与工具调用，按 id 记录。 */
const openSet = useOpenSet();

function toggle(id: string) {
    openSet.set(id, !openSet.isOpen(id));
}

/** 开头的种类标签就是数据里的原值，方便对照 ctx.messages。 */
function kindLabel(message: MessageView): string {
    return message.kind === "system" ? `system · ${message.source}` : message.kind;
}

/** 偏离默认值的字段；默认值（普通用户消息、已完成的回复）不写，免得每块都一样长。 */
function fields(message: MessageView): string[] {
    switch (message.kind) {
        case "user":
            return [
                message.intent === "steer" ? "intent: steer" : "",
                message.delivery === undefined ? "" : `delivery: ${message.delivery}`,
                message.contentOmitted ? "contentOmitted" : "",
            ].filter(Boolean);
        case "assistant":
            return [
                message.model,
                message.status === "done" ? "" : `status: ${message.status}`,
                message.contentOmitted ? "contentOmitted" : "",
                // 附注是宿主加的，不在会话日志里；写出类型，对照时认得出。
                (message.annotations?.length ?? 0) > 0 ? `annotations: ${message.annotations!.map((annotation) => annotation.customType).join(", ")}` : "",
            ].filter(Boolean);
        case "system":
            return [text(message.label)];
        case "error":
            return message.retryable ? ["retryable"] : [];
    }
}

function jsonOf(message: MessageView) {
    return textLines(JSON.stringify(message, null, 2));
}


function usageLine(message: AssistantMessageView): string {
    const usage = message.usage;
    if (usage === undefined) {
        return "";
    }
    const detail = t("usage.detail", {
        input: usage.input,
        output: usage.output,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
    });
    // 单价未知（null）时不写金额，与轮末汇总一致。
    return usage.cost === null ? detail : `${detail} · ${formatCost(usage.cost, props.ctx.usage.currency)}`;
}
</script>

<template>
    <div class="acv-raw" data-raw-view>
        <article v-for="message in props.messages" :key="message.id" class="acv-raw__message" :data-raw-kind="message.kind">
            <header class="acv-raw__head">
                <span class="acv-raw__kind" :data-kind="message.kind">{{ kindLabel(message) }}</span>
                <time class="acv-raw__meta">{{ formatClock(message.timestamp, locale) }}</time>
                <span v-for="field in fields(message)" :key="field" class="acv-raw__field">{{ field }}</span>
                <span class="acv-raw__id" :title="message.id">{{ message.id }}</span>
                <IconButton
                    class="acv-raw__json"
                    size="sm"
                    icon-class="i-lucide-braces"
                    :title="openSet.isOpen(`json:${message.id}`) ? t('raw.hideJson') : t('raw.showJson')"
                    :aria-label="openSet.isOpen(`json:${message.id}`) ? t('raw.hideJson') : t('raw.showJson')"
                    :aria-pressed="openSet.isOpen(`json:${message.id}`)"
                    @click="toggle(`json:${message.id}`)"
                />
            </header>

            <AgentCodeBlock v-if="openSet.isOpen(`json:${message.id}`)" :lines="jsonOf(message)" label="JSON" />

            <template v-else-if="message.kind === 'user'">
                <AgentUserContent
                    :message="message"
                    :resolve-attachment-url="props.services.resolveAttachmentUrl"
                    @action="emit('action', $event)"
                />
                <AgentDeliveryNotice
                    v-if="message.delivery === 'unknown'"
                    @resend="emit('action', {type: 'message.resend', messageId: message.id})"
                    @dismiss="emit('action', {type: 'message.dismiss', messageId: message.id})"
                />
            </template>

            <div v-else-if="message.kind === 'assistant'" class="acv-raw__body">
                <CollapsibleRow
                    v-if="message.thinking"
                    :running-label="t('turn.running')"
                    icon="i-lucide-brain"
                    :label="t('step.thinking')"
                    :detail="openSet.isOpen(`thinking:${message.id}`) ? '' : firstLine(message.thinking)"
                    :expanded="openSet.isOpen(`thinking:${message.id}`)"
                    @update:expanded="toggle(`thinking:${message.id}`)"
                >
                    <p class="acv-raw__text acv-raw__text--muted">{{ message.thinking }}</p>
                </CollapsibleRow>
                <p v-if="message.text" class="acv-raw__text">{{ message.text }}</p>
                <template v-for="call in message.toolCalls" :key="call.id">
                    <!-- 子调用（嵌套调用）缩进列在它下面，不再有自己的子调用 -->
                    <CollapsibleRow
                        v-for="item in [call, ...(call.children ?? [])]"
                        :key="item.id"
                        :class="{'acv-raw__nested': item !== call}"
                        :running-label="t('turn.running')"
                        :icon="props.registry.resolveTool(item.name).icon"
                        :label="text(props.registry.resolveTool(item.name).label)"
                        :detail="props.registry.resolveTool(item.name).summary(item)"
                        :status="toolCallPhase(item.status)"
                        :expanded="openSet.isOpen(item.id)"
                        @update:expanded="toggle(item.id)"
                    >
                        <AgentToolDetail :call="item" :ctx="props.ctx" :services="props.services" :registry="props.registry" @action="emit('action', $event)" />
                    </CollapsibleRow>
                </template>
                <p v-if="message.error" class="acv-raw__text acv-raw__text--danger">{{ message.error }}</p>
                <p v-if="message.usage" class="acv-raw__usage">{{ usageLine(message) }}</p>
            </div>

            <p v-else-if="message.kind === 'system'" class="acv-raw__text">{{ message.text }}</p>

            <p v-else class="acv-raw__text acv-raw__text--danger">{{ text(message.message) }}</p>
        </article>
    </div>
</template>

<style scoped>
.acv-raw {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.acv-raw__message {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    padding: 10px 0;
    border-top: var(--border-w, 1px) solid var(--divider);
    font-size: var(--text-sm);
}

.acv-raw__message:first-child {
    border-top: 0;
    padding-top: 0;
}

.acv-raw__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 8px;
    min-width: 0;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.acv-raw__kind {
    padding: 0 6px;
    border-radius: var(--radius-control);
    background: var(--bg-subtle);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    line-height: 18px;
}

.acv-raw__kind[data-kind="user"] {
    background: var(--accent-bg);
    color: var(--accent-text);
}

.acv-raw__kind[data-kind="error"] {
    background: var(--status-danger-bg);
    color: var(--status-danger);
}

.acv-raw__meta {
    font-variant-numeric: tabular-nums;
}

.acv-raw__field {
    font-family: var(--font-mono);
}

.acv-raw__id {
    min-width: 0;
    max-width: 160px;
    overflow: hidden;
    font-family: var(--font-mono);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-raw__json {
    margin-left: auto;
}

.acv-raw__body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}

.acv-raw__text {
    margin: 0;
    color: var(--text-main);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.acv-raw__text--muted {
    color: var(--text-secondary);
    font-size: var(--text-xs);
}

.acv-raw__text--danger {
    color: var(--status-danger);
}

.acv-raw__nested {
    margin-left: 20px;
}

.acv-raw__usage {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
}
</style>
