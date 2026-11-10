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
defineEmits<{action: [action: AgentViewAction]}>();

const t = useAgentPageText();
const store = inject(subagentStoreKey, null);

/** 取输出至多这么频繁（运行中跟着最后一行的变化）。 */
const TAIL_EVERY_MS = 1_000;
const TAIL_LINES = 50;

const details = computed(() => (props.call.result?.details ?? {}) as {jobId?: string; output?: string});
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
const state = computed((): "running" | "completed" | "failed" | "aborted" | "interrupted" | "unknown" => {
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
        case "running": return job.value?.lastLine === undefined ? t("conversation.subagent.starting") : t("conversation.subagent.lastLine", {line: job.value.lastLine});
        case "completed": return t("conversation.subagent.exited", {code: exitCode.value ?? 0, lines: lines.value});
        case "failed": return t("conversation.subagent.commandFailed", {code: exitCode.value ?? "?"});
        case "aborted": return t("conversation.subagent.commandAborted");
        case "interrupted": return t("conversation.subagent.commandInterrupted");
        case "unknown": return t("conversation.subagent.unknown");
    }
});
const STATE_ICON = {completed: "i-lucide-check", failed: "i-lucide-circle-x", aborted: "i-lucide-circle-stop", interrupted: "i-lucide-circle-pause", unknown: "i-lucide-circle-help"} as const;

const open = ref(false);
const tail = ref<string | null>(null);
let fetchedAt = Number.NEGATIVE_INFINITY;
async function loadTail(): Promise<void> {
    if (details.value.jobId === undefined || store === null) return;
    fetchedAt = store.now.value;
    const read = await store.tail(details.value.jobId, TAIL_LINES);
    tail.value = read === null ? null : read.lines.join("\n");
}
function toggle(): void {
    open.value = !open.value;
    if (open.value) void loadTail();
}
// 展开着、运行中：最后一行变了就再取，至多每秒一次；结束时再取一次拿到完整的结尾。
watch(() => [job.value?.lastLine, state.value] as const, ([, now], [, before]) => {
    if (!open.value) return;
    if (now !== before || (store?.now.value ?? 0) - fetchedAt >= TAIL_EVERY_MS) void loadTail();
});
</script>

<template>
    <div class="bg-card" :data-state="state" data-background-command>
        <div class="bg-card__head">
            <span class="i-lucide-square-terminal bg-card__icon" aria-hidden="true" />
            <span class="bg-card__title">{{ t("conversation.subagent.command") }}</span>
            <code class="bg-card__command" :title="command">{{ command }}</code>
            <span class="bg-card__meta">{{ meta }}</span>
            <template v-if="running">
                <Spinner size="sm" class="bg-card__state" />
                <Button size="sm" variant="ghost" data-background-stop @click="details.jobId !== undefined && store?.kill(details.jobId)">{{ t("conversation.subagent.stop") }}</Button>
            </template>
            <span v-else :class="[STATE_ICON[state === 'running' ? 'unknown' : state], 'bg-card__state bg-card__state-icon']" aria-hidden="true" />
        </div>
        <button type="button" class="bg-card__row nb-ui-focus-ring-inset" :aria-expanded="open" :title="t(open ? 'conversation.subagent.hideOutput' : 'conversation.subagent.showOutput')" data-background-line @click="toggle">
            <span class="bg-card__line">{{ summary }}</span>
            <span v-if="details.output" class="bg-card__address">{{ details.output }}</span>
            <span :class="[open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right', 'bg-card__chevron']" aria-hidden="true" />
        </button>
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

.bg-card__row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 26px;
    padding: 0 8px;
    border: 0;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-xs);
    text-align: left;
    cursor: pointer;
}

.bg-card__row:hover {
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
    color: var(--accent-text);
    font-size: var(--text-2xs);
    text-overflow: ellipsis;
    white-space: nowrap;
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
