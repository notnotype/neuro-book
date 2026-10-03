<script setup lang="ts">
/**
 * Pi 请求 trace 详情（查看器右栏）。纯展示组件：只吃一条 AgentTraceRecordDto，
 * System/Messages/Tools 三个 tab 用 pi 规范化 context 渲染（跨 provider 统一），
 * Payload/Response 透传 JsonViewer。sessionId 点击只 emit，不自己跳转——
 * 属于查看器的可分离核心。
 */
import JsonViewer from "nbook/app/components/common/JsonViewer.vue";
import type {AgentTraceRecordDto} from "nbook/shared/dto/agent-trace.dto";
import type {TraceMessageView} from "nbook/app/components/novel-ide/agent/trace-viewer/trace-view-model";
import {formatMs, formatTokens, normalizeTraceContext, traceStatusDotClass} from "nbook/app/components/novel-ide/agent/trace-viewer/trace-view-model";

type DetailTab = "overview" | "system" | "messages" | "tools" | "payload" | "response";

const props = withDefaults(defineProps<{
    record: AgentTraceRecordDto | null;
    loading?: boolean;
}>(), {
    loading: false,
});

const emit = defineEmits<{
    (e: "open-session", sessionId: number): void;
}>();

const {t} = useI18n();

const activeTab = ref<DetailTab>("overview");

// 切换记录时回到概览，避免停留在上一条的 payload tab 造成错觉
watch(() => props.record?.id, () => {
    activeTab.value = "overview";
});

const contextView = computed(() => normalizeTraceContext(props.record?.request.context));

const tabs = computed<Array<{key: DetailTab; label: string}>>(() => [
    {key: "overview", label: t("agent.traceViewer.tab.overview")},
    {key: "system", label: "System"},
    {key: "messages", label: `Messages${contextView.value ? ` (${String(contextView.value.messages.length)})` : ""}`},
    {key: "tools", label: `Tools${contextView.value ? ` (${String(contextView.value.tools.length)})` : ""}`},
    {key: "payload", label: "Payload"},
    {key: "response", label: t("agent.traceViewer.tab.response")},
]);

/** 概览键值行。空值行直接省略。 */
const overviewRows = computed<Array<{label: string; value: string}>>(() => {
    const record = props.record;
    if (!record) {
        return [];
    }
    const usage = record.response.usage;
    const rows: Array<{label: string; value: string | undefined}> = [
        {label: t("agent.traceViewer.field.kind"), value: record.correlation.kind},
        {label: t("agent.traceViewer.field.model"), value: `${record.request.provider} / ${record.request.model}`},
        {label: "API", value: record.request.api},
        {label: "Base URL", value: record.request.baseUrl},
        {label: t("agent.traceViewer.field.reasoning"), value: record.request.reasoning},
        {label: t("agent.traceViewer.field.startedAt"), value: new Date(record.timing.startedAt).toLocaleString()},
        {label: "TTFT", value: record.timing.ttftMs !== undefined ? formatMs(record.timing.ttftMs) : undefined},
        {label: t("agent.traceViewer.field.duration"), value: record.timing.durationMs !== undefined ? formatMs(record.timing.durationMs) : undefined},
        {label: "HTTP", value: record.response.httpStatus !== undefined ? String(record.response.httpStatus) : undefined},
        {label: "Stop reason", value: record.response.stopReason},
        {
            label: t("agent.traceViewer.field.tokens"),
            value: usage
                ? `${formatTokens(usage.totalTokens)} (in ${formatTokens(usage.input)} / out ${formatTokens(usage.output)} / cacheR ${formatTokens(usage.cacheRead)} / cacheW ${formatTokens(usage.cacheWrite)})`
                : undefined,
        },
        {label: "Invocation", value: record.correlation.invocationId},
        {label: "Profile", value: record.correlation.profileKey},
        {label: "Turn", value: record.correlation.turnIndex !== undefined ? String(record.correlation.turnIndex) : undefined},
        {label: "Mode", value: record.correlation.mode},
    ];
    return rows.filter((row): row is {label: string; value: string} => row.value !== undefined && row.value !== "");
});

/** 消息 role 徽标配色。 */
function roleBadgeClass(role: string): string {
    if (role === "assistant") {
        return "bg-[var(--accent-bg)] text-[var(--accent-text)]";
    }
    if (role === "user") {
        return "bg-[var(--status-success-bg)] text-[var(--status-success)]";
    }
    if (role === "toolResult") {
        return "bg-[var(--status-info-bg)] text-[var(--status-info)]";
    }
    return "bg-[var(--bg-input)] text-[var(--text-secondary)]";
}

function messageKey(message: TraceMessageView, index: number): string {
    return `${String(index)}-${message.role}`;
}
</script>

<template>
    <!-- trace 详情容器 -->
    <div class="flex h-full flex-col">
        <div v-if="props.loading" class="flex flex-1 items-center justify-center">
            <span class="i-lucide-loader-2 h-5 w-5 animate-spin text-[var(--text-muted)]"></span>
        </div>

        <div v-else-if="!props.record" class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <span class="i-lucide-mouse-pointer-click h-6 w-6 text-[var(--text-muted)]"></span>
            <span class="text-xs text-[var(--text-muted)]">{{ t("agent.traceViewer.selectPrompt") }}</span>
        </div>

        <template v-else>
            <!-- 状态条 + tab 栏 -->
            <div class="shrink-0 border-b border-[var(--border-color)] px-4 pt-3">
                <div class="flex items-center gap-2">
                    <span class="h-2.5 w-2.5 rounded-full" :class="traceStatusDotClass(props.record.status)"></span>
                    <span class="text-sm font-semibold text-[var(--text-main)]">#{{ props.record.id }} · {{ props.record.status }}</span>
                    <button
                        v-if="props.record.correlation.sessionId !== undefined"
                        type="button"
                        class="ml-auto inline-flex items-center gap-1 rounded-md border border-[var(--border-color)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                        @click="emit('open-session', props.record.correlation.sessionId)"
                    >
                        <span class="i-lucide-messages-square h-3 w-3"></span>
                        <span>{{ t("agent.traceViewer.openSession", {id: props.record.correlation.sessionId}) }}</span>
                    </button>
                </div>
                <div v-if="props.record.response.errorMessage" class="mt-2 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2.5 py-1.5 text-xs text-[var(--status-danger)]">{{ props.record.response.errorMessage }}</div>
                <div class="mt-2 flex gap-1">
                    <button
                        v-for="tab in tabs"
                        :key="tab.key"
                        type="button"
                        class="rounded-t-md px-2.5 py-1.5 text-xs transition-colors"
                        :class="activeTab === tab.key ? 'border border-b-0 border-[var(--border-color)] bg-[var(--bg-panel)] font-medium text-[var(--text-main)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'"
                        @click="activeTab = tab.key"
                    >{{ tab.label }}</button>
                </div>
            </div>

            <!-- tab 内容区 -->
            <div class="min-h-0 flex-1 overflow-y-auto p-4">
                <!-- 概览 -->
                <dl v-if="activeTab === 'overview'" class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
                    <template v-for="row in overviewRows" :key="row.label">
                        <dt class="text-[var(--text-muted)]">{{ row.label }}</dt>
                        <dd class="break-all text-[var(--text-main)]">{{ row.value }}</dd>
                    </template>
                </dl>

                <!-- System prompt -->
                <div v-else-if="activeTab === 'system'">
                    <pre v-if="contextView?.systemPrompt" class="whitespace-pre-wrap break-words rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] bg-opacity-40 p-3 text-xs leading-relaxed text-[var(--text-main)]">{{ contextView.systemPrompt }}</pre>
                    <p v-else class="text-xs text-[var(--text-muted)]">{{ t("agent.traceViewer.emptySection") }}</p>
                </div>

                <!-- Messages（pi 规范化，轻量结构化渲染） -->
                <div v-else-if="activeTab === 'messages'" class="space-y-3">
                    <p v-if="!contextView || contextView.messages.length === 0" class="text-xs text-[var(--text-muted)]">{{ t("agent.traceViewer.emptySection") }}</p>
                    <article v-for="(message, index) in contextView?.messages ?? []" :key="messageKey(message, index)" class="rounded-lg border border-[var(--border-color)] border-opacity-60">
                        <header class="flex items-center gap-2 border-b border-[var(--border-color)] border-opacity-40 px-2.5 py-1.5">
                            <span class="rounded px-1.5 py-0.5 text-[10px] font-semibold" :class="roleBadgeClass(message.role)">{{ message.role }}</span>
                            <span v-if="message.note" class="truncate text-[10px] text-[var(--text-muted)]">{{ message.note }}</span>
                        </header>
                        <div class="space-y-2 p-2.5">
                            <template v-for="(block, blockIndex) in message.blocks" :key="blockIndex">
                                <pre v-if="block.kind === 'text'" class="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--text-main)]">{{ block.text }}</pre>
                                <pre v-else-if="block.kind === 'thinking'" class="max-h-48 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-[var(--border-color)] pl-2 text-xs italic leading-relaxed text-[var(--text-muted)]">{{ block.text }}</pre>
                                <div v-else-if="block.kind === 'toolCall'" class="space-y-1">
                                    <div class="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
                                        <span class="i-lucide-wrench h-3 w-3"></span>
                                        <span>{{ block.name }}</span>
                                    </div>
                                    <JsonViewer :value="block.args" :max-height="200" />
                                </div>
                                <JsonViewer v-else :value="block.value" :max-height="200" />
                            </template>
                        </div>
                    </article>
                </div>

                <!-- Tools 定义 -->
                <div v-else-if="activeTab === 'tools'" class="space-y-3">
                    <p v-if="!contextView || contextView.tools.length === 0" class="text-xs text-[var(--text-muted)]">{{ t("agent.traceViewer.emptySection") }}</p>
                    <details v-for="tool in contextView?.tools ?? []" :key="tool.name" class="rounded-lg border border-[var(--border-color)] border-opacity-60 px-2.5 py-2">
                        <summary class="cursor-pointer text-xs">
                            <span class="font-medium text-[var(--text-main)]">{{ tool.name }}</span>
                            <span v-if="tool.description" class="ml-2 text-[var(--text-muted)]">{{ tool.description.slice(0, 120) }}</span>
                        </summary>
                        <div class="mt-2">
                            <JsonViewer :value="tool.raw" :max-height="320" />
                        </div>
                    </details>
                </div>

                <!-- Provider 原生请求体 -->
                <div v-else-if="activeTab === 'payload'" class="flex h-full min-h-0 flex-col">
                    <JsonViewer v-if="props.record.request.payload !== undefined" :value="props.record.request.payload" :max-height="0" class="min-h-0 flex-1" />
                    <p v-else class="text-xs text-[var(--text-muted)]">{{ t("agent.traceViewer.notCaptured") }}</p>
                </div>

                <!-- 响应元数据（httpStatus / headers / usage / stopReason / error） -->
                <div v-else class="flex h-full min-h-0 flex-col">
                    <JsonViewer :value="props.record.response" :max-height="0" class="min-h-0 flex-1" />
                </div>
            </div>
        </template>
    </div>
</template>
