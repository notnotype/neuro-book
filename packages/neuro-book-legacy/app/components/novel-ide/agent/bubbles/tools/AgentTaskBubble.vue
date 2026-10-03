<script setup lang="ts">
import type { AgentToolCall } from "nbook/app/components/novel-ide/agent/agent-message";
import { formatTimestamp } from "nbook/app/components/novel-ide/agent/agent-message";
import {
    parseTaskList,
    taskStatusClass,
    taskStatusIcon,
    taskStatusLabelKey,
} from "./task-list";

const props = defineProps<{
    toolCall: AgentToolCall;
}>();

const taskList = computed(() => parseTaskList(props.toolCall));
const isCollapsed = ref(false);
const {t} = useI18n();

const toolTitle = computed(() => props.toolCall.name === "task_create" ? t("agent.tool.taskList") : t("agent.tool.taskStatusUpdate"));

const statusLabel = computed(() => {
    switch (props.toolCall.status) {
        case "running":
        case "streaming":
            return t("agent.tasks.updating");
        case "error":
            return t("agent.tasks.failed");
        case "success":
            return t("agent.tasks.synced");
        default:
            return t("agent.tasks.task");
    }
});

const completedStepCount = computed(() => taskList.value?.steps.filter((step) => step.status === "completed").length ?? 0);
const stepSummary = computed(() => taskList.value
    ? t("agent.tasks.completeSummary", {completed: completedStepCount.value, total: taskList.value.steps.length})
    : statusLabel.value);
</script>

<template>
    <div class="mt-2 min-w-0 w-full max-w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-main)] px-2.5 py-2 shadow-sm">
        <div class="flex min-w-0 items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2">
                <div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--accent-main)]/30 bg-[var(--accent-bg)] text-[var(--accent-text)]">
                    <span class="i-lucide-list-checks h-3.5 w-3.5"></span>
                </div>
                <div class="min-w-0">
                    <div class="truncate text-xs font-medium text-[var(--text-main)]">{{ toolTitle }}</div>
                    <div class="truncate text-[10px] text-[var(--text-muted)]">{{ stepSummary }}</div>
                </div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
                <span class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">{{ statusLabel }}</span>
                <button
                    type="button"
                    class="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    :title="isCollapsed ? t('agent.tasks.expand') : t('agent.tasks.collapse')"
                    @click="isCollapsed = !isCollapsed"
                >
                    <span :class="isCollapsed ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'" class="h-3.5 w-3.5"></span>
                </button>
            </div>
        </div>

        <div v-if="taskList && !isCollapsed" class="mt-2 min-w-0 space-y-1.5">
            <div v-if="taskList.title" class="min-w-0 rounded-md border border-[var(--border-color)]/60 bg-[var(--bg-input)] px-2 py-1.5">
                <div class="break-words text-xs leading-5 text-[var(--text-main)]">{{ taskList.title }}</div>
            </div>

            <div class="space-y-1.5">
                <div
                    v-for="step in taskList.steps"
                    :key="step.id"
                    class="min-w-0 rounded-md border border-[var(--border-color)]/70 bg-[var(--bg-input)] px-2 py-1.5"
                >
                    <div class="flex min-w-0 items-start gap-2">
                        <div class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border" :class="taskStatusClass(step.status)">
                            <span :class="taskStatusIcon(step.status)" class="h-2.5 w-2.5"></span>
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="flex min-w-0 items-center gap-2">
                                <span class="min-w-0 flex-1 break-words text-xs leading-5 text-[var(--text-main)]">{{ step.text }}</span>
                                <span class="min-w-0 max-w-[40%] shrink rounded border border-[var(--border-color)] bg-[var(--bg-main)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)] break-all">
                                    {{ step.id }}
                                </span>
                            </div>
                            <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-5 text-[var(--text-muted)]">
                                <span>{{ t(taskStatusLabelKey(step.status)) }}</span>
                                <span v-if="step.note" class="min-w-0 break-words">{{ t("agent.tasks.note", {note: step.note}) }}</span>
                                <span>{{ t("agent.tasks.updatedAt", {time: formatTimestamp(step.updatedAt)}) }}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="flex flex-wrap items-center gap-2 text-[10px] leading-4 text-[var(--text-muted)]">
                <span>{{ t("agent.tasks.overallUpdatedAt", {time: formatTimestamp(taskList.updatedAt)}) }}</span>
            </div>
        </div>

        <div v-else-if="!isCollapsed" class="mt-2 min-w-0 break-words rounded-md border border-[var(--border-color)]/70 bg-[var(--bg-input)] px-2 py-1.5 text-[11px] leading-5 text-[var(--text-muted)]">
            {{ toolCall.result?.trim() || t("agent.tasks.parsing") }}
        </div>

        <div v-if="toolCall.error && !isCollapsed" class="mt-2 break-all whitespace-pre-wrap rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-2 font-mono text-[11px] text-[var(--status-danger)]">
            {{ toolCall.error }}
        </div>
    </div>
</template>
