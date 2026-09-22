<script setup lang="ts">
import {computed} from "vue";
import AgentMarkdownContent from "../../bubbles/base/AgentMarkdownContent.vue";
import type {AgentWorkflowPendingRunView, AskDraftValue} from "../../composables/useAgentWorkflowPending";
import type {PendingAsk} from "@notnotype/nb-workflow";

const props = defineProps<{
    runs: readonly AgentWorkflowPendingRunView[];
    feedError?: string;
}>();

const emit = defineEmits<{
    (e: "update-answer", payload: {runId: string; key: string; value: AskDraftValue}): void;
    (e: "submit-run", runId: string): void;
}>();

const waitingCount = computed(() => props.runs.length);

function asksFor(run: AgentWorkflowPendingRunView): PendingAsk[] {
    return run.state?.view.pendingAsks ?? [];
}

function isSelected(run: AgentWorkflowPendingRunView, askKey: string, optionId: string): boolean {
    const value = run.draft[askKey];
    return Array.isArray(value) ? value.includes(optionId) : value === optionId;
}

function toggleOption(run: AgentWorkflowPendingRunView, ask: PendingAsk, optionId: string): void {
    if (!ask.spec.multi) {
        emit("update-answer", {runId: run.runId, key: ask.key, value: optionId});
        return;
    }
    const current = Array.isArray(run.draft[ask.key])
        ? [...run.draft[ask.key] as string[]]
        : [];
    const index = current.indexOf(optionId);
    if (index >= 0) current.splice(index, 1);
    else current.push(optionId);
    emit("update-answer", {runId: run.runId, key: ask.key, value: current});
}

function hasAnswer(run: AgentWorkflowPendingRunView, ask: PendingAsk): boolean {
    const value = run.draft[ask.key];
    if (ask.spec.kind === "approve") return typeof value === "boolean";
    if (ask.spec.kind === "text") return typeof value === "string" && Boolean(value.trim());
    return Array.isArray(value) ? value.length > 0 : typeof value === "string" && Boolean(value);
}

function canSubmit(run: AgentWorkflowPendingRunView): boolean {
    const asks = asksFor(run);
    return asks.length > 0 && asks.every((ask) => hasAnswer(run, ask));
}
</script>

<template>
    <section v-if="waitingCount || props.feedError" class="border-t border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-3">
        <div class="flex items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--text-main)]">
                <span class="i-lucide-inbox h-4 w-4 shrink-0 text-[var(--status-warning)]"></span>
                <span>Workflow 待处理</span>
                <span v-if="waitingCount" class="rounded-full bg-[var(--status-warning-bg)] px-1.5 py-0.5 text-[10px] text-[var(--status-warning)]">{{ waitingCount }}</span>
            </div>
            <span class="text-[10px] text-[var(--text-muted)]">每个流程分别应答</span>
        </div>

        <div v-for="run in props.runs" :key="run.runId" class="mt-3 border-t border-[var(--border-color)] pt-3 first:mt-2 first:border-t-0 first:pt-0">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-2">
                    <span class="i-lucide-route h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]"></span>
                    <span class="truncate text-xs font-medium text-[var(--text-main)]">{{ run.job.title }}</span>
                    <span class="font-mono text-[10px] text-[var(--text-muted)]">{{ run.runId }}</span>
                </div>
                <span class="text-[10px] text-[var(--status-warning)]">等待应答</span>
            </div>

            <template v-if="run.state">
                <div v-for="ask in asksFor(run)" :key="ask.key" class="mt-2 rounded border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-3">
                    <div class="text-sm font-semibold text-[var(--status-warning)]">{{ ask.spec.title }}</div>
                    <AgentMarkdownContent v-if="ask.spec.description" class="mt-2 text-xs text-[var(--text-secondary)]" :content="ask.spec.description" />
                    <div v-if="ask.spec.kind === 'select'" class="mt-2 flex flex-wrap gap-2">
                        <button
                            v-for="option in ask.spec.options ?? []"
                            :key="option.id"
                            type="button"
                            class="rounded-full border px-3 py-1 text-xs transition-colors"
                            :class="isSelected(run, ask.key, option.id)
                                ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]'
                                : 'border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-secondary)]'"
                            :disabled="run.submitting || run.submitted"
                            @click="toggleOption(run, ask, option.id)"
                        >
                            {{ option.label }}
                        </button>
                    </div>
                    <input
                        v-else-if="ask.spec.kind === 'text'"
                        type="text"
                        class="mt-2 w-full rounded border border-[var(--border-color)] bg-[var(--bg-main)] px-2 py-1.5 text-sm text-[var(--text-main)]"
                        :value="run.draft[ask.key] as string | undefined"
                        :disabled="run.submitting || run.submitted"
                        placeholder="输入应答…"
                        @input="emit('update-answer', {runId: run.runId, key: ask.key, value: ($event.target as HTMLInputElement).value})"
                    >
                    <div v-else class="mt-2 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            class="rounded border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-1 text-xs text-[var(--status-success)]"
                            :disabled="run.submitting || run.submitted"
                            @click="emit('update-answer', {runId: run.runId, key: ask.key, value: true})"
                        >
                            同意
                        </button>
                        <button
                            type="button"
                            class="rounded border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-1 text-xs text-[var(--status-danger)]"
                            :disabled="run.submitting || run.submitted"
                            @click="emit('update-answer', {runId: run.runId, key: ask.key, value: false})"
                        >
                            否决
                        </button>
                        <span class="text-xs text-[var(--text-muted)]">
                            {{ typeof run.draft[ask.key] === "boolean" ? (run.draft[ask.key] ? "已选择同意" : "已选择否决") : "尚未选择" }}
                        </span>
                    </div>
                </div>
                <div v-if="asksFor(run).length === 0" class="mt-2 text-xs text-[var(--text-muted)]">正在读取待应答项…</div>
                <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span v-if="run.error" class="text-xs text-[var(--status-danger)]">{{ run.error }}</span>
                    <span v-else-if="run.submitted" class="text-xs text-[var(--status-info)]">已提交，正在继续…</span>
                    <span v-else class="text-xs text-[var(--text-muted)]">完成全部问题后继续</span>
                    <button
                        type="button"
                        class="rounded bg-[var(--accent-main)] px-3 py-1.5 text-xs font-medium text-[var(--text-inverse)] disabled:cursor-not-allowed disabled:opacity-50"
                        :disabled="!canSubmit(run) || run.submitting || run.submitted"
                        @click="emit('submit-run', run.runId)"
                    >
                        {{ run.submitting ? "提交中…" : run.submitted ? "已提交" : "应答并继续" }}
                    </button>
                </div>
            </template>
            <div v-else class="mt-2 text-xs text-[var(--text-muted)]">正在读取 workflow 问题…</div>
        </div>
        <div v-if="props.feedError" class="mt-2 text-xs text-[var(--status-danger)]">{{ props.feedError }}</div>
    </section>
</template>
