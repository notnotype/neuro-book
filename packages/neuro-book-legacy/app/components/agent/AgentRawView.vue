<script setup lang="ts">
import {ref} from "vue";
import {IconButton} from "@notnotype/nb-ui/components";
import type {
    AgentConversationContext,
    AgentConversationServices,
    AgentViewAction,
    AssistantMessageView,
    MessageView,
    ToolCallView,
    ViewText,
} from "./agent-view.types";
import type {AgentViewRegistry} from "./agent-view-registry";
import {textLines} from "./tool-detail-lines";
import AgentCodeBlock from "./AgentCodeBlock.vue";
import AgentDeliveryNotice from "./AgentDeliveryNotice.vue";
import AgentStepLine from "./AgentStepLine.vue";
import AgentToolDetail from "./AgentToolDetail.vue";
import AgentUserContent from "./AgentUserContent.vue";

const props = defineProps<{
    messages: MessageView[];
    ctx: AgentConversationContext;
    services: AgentConversationServices;
    registry: AgentViewRegistry;
}>();

const emit = defineEmits<{
    (e: "action", action: AgentViewAction): void;
}>();

const {t, locale} = useI18n();

function text(value: ViewText): string {
    return typeof value === "string" ? value : t(value.key, value.params ?? {});
}

/** 切到 JSON 的消息、展开的思考与工具调用，按 id 记录。 */
const openItems = ref<Record<string, boolean>>({});

function toggle(id: string) {
    openItems.value = {...openItems.value, [id]: !openItems.value[id]};
}

function formatTime(timestamp: number): string {
    return new Intl.DateTimeFormat(locale.value, {hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false}).format(timestamp);
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
            ].filter(Boolean);
        case "system":
            return [message.label];
        case "error":
            return message.retryable ? ["retryable"] : [];
    }
}

function jsonOf(message: MessageView) {
    return textLines(JSON.stringify(message, null, 2));
}

function firstLine(value: string): string {
    return value.trim().split("\n")[0] ?? "";
}

function stepStatus(call: ToolCallView): "running" | "error" | "done" {
    switch (call.status) {
        case "streaming":
        case "running": return "running";
        case "error":
        case "invalid": return "error";
        case "success": return "done";
    }
}

function usageLine(message: AssistantMessageView): string {
    const usage = message.usage;
    if (usage === undefined) {
        return "";
    }
    const symbol = props.ctx.usage.currency === "CNY" ? "¥" : "$";
    return `${t("agentView.usage.detail", {
        input: usage.input,
        output: usage.output,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
    })} · ${symbol}${usage.cost}`;
}
</script>

<template>
    <div class="acv-raw" data-raw-view>
        <article v-for="message in props.messages" :key="message.id" class="acv-raw__message" :data-raw-kind="message.kind">
            <header class="acv-raw__head">
                <span class="acv-raw__kind" :data-kind="message.kind">{{ kindLabel(message) }}</span>
                <time class="acv-raw__meta">{{ formatTime(message.timestamp) }}</time>
                <span v-for="field in fields(message)" :key="field" class="acv-raw__field">{{ field }}</span>
                <span class="acv-raw__id" :title="message.id">{{ message.id }}</span>
                <IconButton
                    class="acv-raw__json"
                    size="sm"
                    icon-class="i-lucide-braces"
                    :title="openItems[`json:${message.id}`] ? t('agentView.raw.hideJson') : t('agentView.raw.showJson')"
                    :aria-label="openItems[`json:${message.id}`] ? t('agentView.raw.hideJson') : t('agentView.raw.showJson')"
                    :aria-pressed="Boolean(openItems[`json:${message.id}`])"
                    @click="toggle(`json:${message.id}`)"
                />
            </header>

            <AgentCodeBlock v-if="openItems[`json:${message.id}`]" :lines="jsonOf(message)" label="JSON" />

            <template v-else-if="message.kind === 'user'">
                <AgentUserContent :message="message" :resolve-attachment-url="props.services.resolveAttachmentUrl" />
                <AgentDeliveryNotice
                    v-if="message.delivery === 'unknown'"
                    @resend="emit('action', {type: 'message.resend', messageId: message.id})"
                    @dismiss="emit('action', {type: 'message.dismiss', messageId: message.id})"
                />
            </template>

            <div v-else-if="message.kind === 'assistant'" class="acv-raw__body">
                <AgentStepLine
                    v-if="message.thinking"
                    icon="i-lucide-brain"
                    :label="t('agentView.step.thinking')"
                    :detail="openItems[`thinking:${message.id}`] ? '' : firstLine(message.thinking)"
                    :expanded="Boolean(openItems[`thinking:${message.id}`])"
                    @toggle="toggle(`thinking:${message.id}`)"
                >
                    <p class="acv-raw__text acv-raw__text--muted">{{ message.thinking }}</p>
                </AgentStepLine>
                <p v-if="message.text" class="acv-raw__text">{{ message.text }}</p>
                <AgentStepLine
                    v-for="call in message.toolCalls"
                    :key="call.id"
                    :icon="props.registry.resolveTool(call.name).icon"
                    :label="text(props.registry.resolveTool(call.name).label)"
                    :detail="props.registry.resolveTool(call.name).summary(call)"
                    :status="stepStatus(call)"
                    :expanded="Boolean(openItems[call.id])"
                    @toggle="toggle(call.id)"
                >
                    <AgentToolDetail :call="call" :ctx="props.ctx" :registry="props.registry" />
                </AgentStepLine>
                <p v-if="message.error" class="acv-raw__text acv-raw__text--danger">{{ message.error }}</p>
                <p v-if="message.usage" class="acv-raw__usage">{{ usageLine(message) }}</p>
            </div>

            <p v-else-if="message.kind === 'system'" class="acv-raw__text">{{ message.text }}</p>

            <p v-else class="acv-raw__text acv-raw__text--danger">{{ message.message }}</p>
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
    font-size: 13px;
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
    font-size: 11px;
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
    font-size: 12px;
}

.acv-raw__text--danger {
    color: var(--status-danger);
}

.acv-raw__usage {
    margin: 0;
    color: var(--text-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
}
</style>
