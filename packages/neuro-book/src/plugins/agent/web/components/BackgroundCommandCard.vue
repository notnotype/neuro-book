<script setup lang="ts">
/**
 * 后台命令卡片（见同名 `.md`）。任务的现状来自宿主推来的任务表；任务不在表里时读一次 `status.json`。输出只在展开时取。
 */
import {computed, inject, onMounted, ref, watch} from "vue";
import {Button, Spinner} from "@notnotype/nb-ui/components";
import type {AgentConversationContext, AgentViewAction, ToolCallView} from "@notnotype/nb-agent-ui";

import type {CommandStatus} from "../../shared/subagents";
import {subagentStoreKey} from "../subagent-store";
import {useAgentPageText} from "../text";

const props = defineProps<{call: ToolCallView; ctx: AgentConversationContext; services?: unknown; locale?: string}>();
const emit = defineEmits<{action: [action: AgentViewAction]}>();

const t = useAgentPageText();
const store = inject(subagentStoreKey, null);

/** 取输出至多这么频繁（运行中跟着最后一行的变化）。 */
const TAIL_EVERY_MS = 1_000;
const TAIL_LINES = 50;

const details = computed(() => (props.call.result?.details ?? {}) as {jobId?: string; output?: string; autoBackground?: boolean});
const command = computed(() => {
    const args = props.call.args;
    return args !== null && typeof args === "object" && !Array.isArray(args) && typeof args.command === "string" ? args.command : "";
});
const job = computed(() => (details.value.jobId === undefined ? undefined : store?.data.value.jobs.get(details.value.jobId)));
const saved = ref<CommandStatus | null>(null);

onMounted(() => {
    if (job.value === undefined && details.value.jobId !== undefined) void store?.status(details.value.jobId).then((status) => (saved.value = status));
});
// 任务结束后被取走、从表里消失：终态改从 status.json 读。
watch(job, (now, before) => {
    if (now === undefined && before !== undefined && details.value.jobId !== undefined) void store?.status(details.value.jobId).then((status) => (saved.value = status));
});

const running = computed(() => job.value?.state === "running");
/**
 * 还没有任务 id 时看调用自己：在等审批或正在登记写“等待开始”，被拒、参数不对写“没有执行”。有了任务 id 看任务表，
 * 任务已移出时看 `status.json`。
 */
const state = computed((): "pending" | "denied" | "invalid" | "running" | "completed" | "failed" | "aborted" | "interrupted" | "unknown" => {
    if (details.value.jobId === undefined) {
        if (props.call.status === "running" || props.call.status === "streaming") return "pending";
        if (props.call.status === "denied" || props.call.status === "invalid") return props.call.status;
        if (props.call.status === "error") return "failed";
        return "unknown";
    }
    if (job.value !== undefined) return job.value.state === "question" ? "running" : job.value.state;
    return saved.value?.state ?? "unknown";
});
const exitCode = computed(() => job.value?.exitCode ?? saved.value?.exitCode ?? null);
const lines = computed(() => job.value?.lines ?? saved.value?.lines ?? 0);

const duration = (ms: number): string => {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
};
const meta = computed(() => {
    const id = details.value.jobId ?? "";
    const started = job.value?.startedAt;
    const ended = job.value?.endedAt ?? (running.value ? store?.now.value : undefined);
    return started === undefined || ended === undefined ? t("conversation.subagent.commandJob", {id}) : `${t("conversation.subagent.commandJob", {id})} · ${duration(ended - started)}`;
});
const summary = computed(() => {
    switch (state.value) {
        case "pending": return t("conversation.subagent.commandPending");
        case "denied": return t("conversation.subagent.commandDenied");
        case "invalid": return t("conversation.subagent.commandInvalid");
        case "running": return job.value?.lastLine === undefined ? t("conversation.subagent.starting") : t("conversation.subagent.lastLine", {line: job.value.lastLine});
        case "completed": return t("conversation.subagent.exited", {code: exitCode.value ?? 0, lines: lines.value});
        // 没登记成任务就失败了（例如任务数到了上限）：写调用的错误。
        case "failed": return details.value.jobId === undefined ? t("conversation.subagent.failed", {line: props.call.result?.text ?? ""}) : t("conversation.subagent.commandFailed", {code: exitCode.value ?? "?"});
        case "aborted": return t("conversation.subagent.commandAborted");
        case "interrupted": return t("conversation.subagent.commandInterrupted");
        case "unknown": return t("conversation.subagent.unknown");
    }
});
const STATE_ICON = {
    pending: "i-lucide-clock",
    denied: "i-lucide-ban",
    invalid: "i-lucide-circle-alert",
    completed: "i-lucide-check",
    failed: "i-lucide-circle-x",
    aborted: "i-lucide-circle-stop",
    interrupted: "i-lucide-circle-pause",
    unknown: "i-lucide-circle-help",
} as const;

const open = ref(false);
const tail = ref<string | null>(null);
let fetchedAt = Number.NEGATIVE_INFINITY;
/** 取到的是哪一行之后的输出：最后一行变了、上次取过超过一秒，就该再取。 */
let fetchedLine: string | undefined;
/** 请求的序号：只认最新一次的回应，先发后到的旧回应不盖掉新的。 */
let requests = 0;
async function loadTail(): Promise<void> {
    if (details.value.jobId === undefined || store === null) return;
    const request = (requests += 1);
    fetchedAt = store.now.value;
    fetchedLine = job.value?.lastLine;
    const read = await store.tail(details.value.jobId, TAIL_LINES);
    if (request === requests) tail.value = read === null ? null : read.lines.join("\n");
}
function toggle(): void {
    open.value = !open.value;
    if (open.value) void loadTail();
}
/**
 * 展开着：结束时取一次拿到完整的结尾；运行中最后一行变了就再取，至多每秒一次。每秒走的 `now` 也触发，所以一秒内的最后一次
 * 变化不会丢：等够一秒那一拍会补取。
 */
watch(() => [job.value?.lastLine, state.value, store?.now.value] as const, ([line, phase], [, before]) => {
    if (!open.value) return;
    if (phase !== before) void loadTail();
    else if (phase === "running" && line !== fetchedLine && (store?.now.value ?? 0) - fetchedAt >= TAIL_EVERY_MS) void loadTail();
});
</script>

<template>
    <div class="bg-card" :data-state="state" data-background-command>
        <div class="bg-card__head">
            <span class="i-lucide-square-terminal bg-card__icon" aria-hidden="true" />
            <span class="bg-card__title">{{ t("conversation.subagent.command") }}</span>
            <!-- 前台跑过门槛自动转的（builtin-tools.md 输出 31）：卡头注明 -->
            <span v-if="details.autoBackground === true" class="bg-card__meta" data-background-auto>{{ t("conversation.subagent.autoBackground") }}</span>
            <code class="bg-card__command" :title="command">{{ command }}</code>
            <span class="bg-card__meta">{{ meta }}</span>
            <template v-if="running">
                <Spinner size="sm" :label="t('conversation.subagent.running')" class="bg-card__state" />
                <Button size="sm" variant="ghost" data-background-stop @click="details.jobId !== undefined && store?.kill(details.jobId)">{{ t("conversation.subagent.stop") }}</Button>
            </template>
            <span v-else :class="[STATE_ICON[state === 'running' ? 'unknown' : state], 'bg-card__state bg-card__state-icon']" aria-hidden="true" />
        </div>
        <div class="bg-card__row" :class="{'is-open': open}">
            <button type="button" class="bg-card__toggle nb-ui-focus-ring-inset" :disabled="details.jobId === undefined" :aria-expanded="details.jobId === undefined ? undefined : open" :title="details.jobId === undefined ? undefined : t(open ? 'conversation.subagent.hideOutput' : 'conversation.subagent.showOutput')" data-background-line @click="toggle">
                <span class="bg-card__line">{{ summary }}</span>
                <span v-if="details.jobId !== undefined" :class="[open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right', 'bg-card__chevron']" aria-hidden="true" />
            </button>
            <!-- 与展开的按钮并列：点地址打开输出文件，不展开 -->
            <button v-if="details.output" type="button" class="bg-card__address nb-ui-focus-ring-inset" :title="t('conversation.subagent.openOutput', {path: details.output})" data-background-output @click="emit('action', {type: 'reference.open', target: details.output})">{{ details.output }}</button>
        </div>
        <pre v-if="open" class="bg-card__tail" data-background-tail>{{ tail ?? t("conversation.subagent.outputUnavailable") }}</pre>
    </div>
</template>

<style scoped>
.bg-card {
    min-width: 0;
    border: var(--border-w) solid var(--border-color);
    border-radius: var(--radius-control);
}

.bg-card[data-state="failed"] {
    border-color: var(--status-danger-border);
}

.bg-card__head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 0 4px 0 8px;
    border-bottom: var(--border-w) solid var(--border-color);
    font-size: var(--text-xs);
}

.bg-card__icon,
.bg-card__state-icon,
.bg-card__chevron {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

.bg-card__title {
    flex-shrink: 0;
    font-weight: var(--weight-medium);
}

.bg-card__command {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.bg-card__meta {
    flex-shrink: 0;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
}

.bg-card__state {
    flex-shrink: 0;
}

.bg-card[data-state="completed"] .bg-card__state-icon {
    color: var(--status-success);
}

.bg-card[data-state="failed"] .bg-card__state-icon {
    color: var(--status-danger);
}

/* 卡片的最后一块（输出没展开时）：圆角跟着卡片，悬停底色与焦点环不戳出卡片的圆角。 */
.bg-card__row {
    display: flex;
    align-items: stretch;
    height: 26px;
    overflow: hidden;
    border-radius: 0 0 var(--radius-control) var(--radius-control);
}

.bg-card__row.is-open {
    border-radius: 0;
}

.bg-card__toggle {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 0 8px;
    border: 0;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-xs);
    text-align: left;
}

.bg-card__toggle:not(:disabled) {
    cursor: pointer;
}

.bg-card__toggle:not(:disabled):hover,
.bg-card__address:hover {
    background: var(--bg-hover);
}

.bg-card__line {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.bg-card__address {
    flex-shrink: 1;
    min-width: 0;
    max-width: 40%;
    overflow: hidden;
    padding: 0 8px;
    border: 0;
    background: none;
    color: var(--accent-text);
    font: inherit;
    font-size: var(--text-2xs);
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
}

.bg-card__tail {
    max-height: 9.6em;
    margin: 0;
    overflow-y: auto;
    padding: 6px 10px;
    border-top: var(--border-w) solid var(--border-color);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    line-height: 1.6;
    white-space: pre-wrap;
}
</style>
