<script setup lang="ts">
import {computed, onBeforeUnmount, ref, shallowRef, watch} from "vue";
import AgentMarkdownContent from "nbook/app/components/novel-ide/agent/AgentMarkdownContent.vue";
import {useAgentJobsFeed} from "nbook/app/composables/useAgentJobsFeed";
import {resolveApiErrorMessage, resolveApiErrorStatus} from "nbook/app/utils/api-error";
import {workflowPendingAskSignature} from "nbook/app/components/novel-ide/agent/workflow-bubble";
import type {WorkflowDemoRunState} from "nbook/server/agent/workflow/workflow-demo-service";
import type {JsonValue, PendingAsk} from "nbook/server/vendor/nb-workflow/index";
import type {AgentJobSnapshot} from "nbook/shared/dto/agent-job.dto";

const props = defineProps<{
    /** 当前 Composer 所属的 chat Session；后台 workflow 以 ownerSessionId 回流。 */
    sessionId: number | null;
}>();

type AskDraftValue = string | string[] | boolean;
type RunRef = {runId: string; workflowKey: string};

const feed = useAgentJobsFeed(() => props.sessionId !== null);
const runStates = shallowRef<Record<string, WorkflowDemoRunState>>({});
const runErrors = ref<Record<string, string>>({});
const runDrafts = ref<Record<string, Record<string, AskDraftValue>>>({});
const submittingRuns = ref<Set<string>>(new Set());
const submittedRuns = ref<Set<string>>(new Set());
const submittedAskSignatures = ref<Record<string, string>>({});
const pollTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pollCursors = new Map<string, number>();
const pollRevisions = new Map<string, number>();
const inFlightRuns = new Set<string>();
let observationRevision = 0;
let disposed = false;

/** 从 Job ref 读取正式 workflow run；其它类型的后台任务不进入此面板。 */
function readRunRef(job: AgentJobSnapshot): RunRef | null {
    const ref = job.ref;
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) return null;
    const runId = ref.runId;
    const workflowKey = ref.workflowKey;
    if (typeof runId !== "string" || !runId || typeof workflowKey !== "string" || !workflowKey) return null;
    return {runId, workflowKey};
}

/** 当前 Session 中等待用户应答的后台 workflow；每个 Run 独立展示。 */
const waitingJobs = computed(() => {
    const sessionId = props.sessionId;
    if (sessionId === null) return [];
    return feed.jobs.value.filter((job) => job.kind === "workflow"
        && job.ownerSessionId === sessionId
        && job.status === "waiting"
        && readRunRef(job) !== null);
});

const waitingCount = computed(() => waitingJobs.value.length);

/** 清掉某个 Run 的轮询 timer，并使迟到响应失效。 */
function stopRunPolling(runId: string): void {
    const timer = pollTimers.get(runId);
    if (timer) clearTimeout(timer);
    pollTimers.delete(runId);
    pollRevisions.set(runId, (pollRevisions.get(runId) ?? 0) + 1);
    inFlightRuns.delete(runId);
}

/** 释放当前 Session 切换前的本地观察状态。 */
function resetRunState(): void {
    observationRevision++;
    for (const runId of new Set([...pollTimers.keys(), ...inFlightRuns])) stopRunPolling(runId);
    pollCursors.clear();
    pollRevisions.clear();
    runStates.value = {};
    runErrors.value = {};
    runDrafts.value = {};
    submittingRuns.value = new Set();
    submittedRuns.value = new Set();
    submittedAskSignatures.value = {};
}

/** 安排单个 Run 的下一次状态读取。 */
function scheduleRunPoll(runId: string, delay: number): void {
    if (disposed || !waitingJobs.value.some((job) => readRunRef(job)?.runId === runId) || pollTimers.has(runId) || inFlightRuns.has(runId)) return;
    pollTimers.set(runId, setTimeout(() => {
        pollTimers.delete(runId);
        void pollRun(runId);
    }, delay));
}

/** 读取单个正式 Run，并以 Run 自身状态决定下一次轮询节奏。 */
async function pollRun(runId: string): Promise<void> {
    if (disposed || !waitingJobs.value.some((job) => readRunRef(job)?.runId === runId) || inFlightRuns.has(runId)) return;
    const revision = pollRevisions.get(runId) ?? 0;
    const observationAtStart = observationRevision;
    const cursor = pollCursors.get(runId) ?? 0;
    let nextPollDelay: number | null = null;
    inFlightRuns.add(runId);
    try {
        const next = await $fetch(`/api/agent/workflow/runs/${runId}`, {query: {after: cursor}}) as unknown as WorkflowDemoRunState;
        if (disposed || observationAtStart !== observationRevision || revision !== (pollRevisions.get(runId) ?? 0)) return;
        pollCursors.set(runId, next.nextCursor);
        runStates.value = {...runStates.value, [runId]: next};
        runErrors.value = {...runErrors.value, [runId]: ""};
        const submittedSignature = submittedAskSignatures.value[runId];
        if (submittedSignature !== undefined
            && (next.view.status !== "waiting" || workflowPendingAskSignature(next.view.pendingAsks) !== submittedSignature)) {
            const nextSubmitted = new Set(submittedRuns.value);
            nextSubmitted.delete(runId);
            submittedRuns.value = nextSubmitted;
            const nextSignatures = {...submittedAskSignatures.value};
            delete nextSignatures[runId];
            submittedAskSignatures.value = nextSignatures;
        }
        nextPollDelay = next.view.status === "waiting" ? 2000 : 500;
    } catch (error) {
        if (disposed || observationAtStart !== observationRevision || revision !== (pollRevisions.get(runId) ?? 0)) return;
        runErrors.value = {
            ...runErrors.value,
            [runId]: resolveApiErrorStatus(error) === 404
                ? "该 workflow run 暂时不可查询"
                : resolveApiErrorMessage(error, "读取 workflow 问题失败"),
        };
        nextPollDelay = 3000;
    } finally {
        inFlightRuns.delete(runId);
        if (!disposed
            && observationAtStart === observationRevision
            && revision === (pollRevisions.get(runId) ?? 0)
            && nextPollDelay !== null) {
            scheduleRunPoll(runId, nextPollDelay);
        }
    }
}

/** Job SSE 更新后补齐或停止对应 Run 的观察。 */
function reconcileRunPolling(jobs: AgentJobSnapshot[]): void {
    const activeRunIds = new Set(jobs.flatMap((job) => {
        const ref = readRunRef(job);
        return ref ? [ref.runId] : [];
    }));
    for (const runId of new Set([...pollTimers.keys(), ...inFlightRuns])) {
        if (!activeRunIds.has(runId)) stopRunPolling(runId);
    }
    for (const job of jobs) {
        const ref = readRunRef(job);
        if (!ref) continue;
        if (!runStates.value[ref.runId] && !inFlightRuns.has(ref.runId)) {
            void pollRun(ref.runId);
        } else {
            scheduleRunPoll(ref.runId, 2000);
        }
    }
}

watch(waitingJobs, reconcileRunPolling, {immediate: true});
watch(() => props.sessionId, resetRunState);

/** 返回单个 Run 当前快照。 */
function stateFor(runId: string): WorkflowDemoRunState | null {
    return runStates.value[runId] ?? null;
}

/** 返回单个 Run 的完整 ask；状态尚未到达时保持空数组。 */
function asksFor(runId: string): PendingAsk[] {
    return stateFor(runId)?.view.pendingAsks ?? [];
}

/** 写入一个 ask 草稿，避免模板直接修改深层递归 JsonValue。 */
function setDraft(runId: string, key: string, value: AskDraftValue): void {
    runDrafts.value = {
        ...runDrafts.value,
        [runId]: {...runDrafts.value[runId], [key]: value},
    };
}

/** 切换 select ask 的选项。 */
function toggleOption(runId: string, ask: PendingAsk, optionId: string): void {
    if (!ask.spec.multi) {
        setDraft(runId, ask.key, optionId);
        return;
    }
    const current = Array.isArray(runDrafts.value[runId]?.[ask.key])
        ? [...runDrafts.value[runId]![ask.key] as string[]]
        : [];
    const index = current.indexOf(optionId);
    if (index >= 0) current.splice(index, 1);
    else current.push(optionId);
    setDraft(runId, ask.key, current);
}

/** 判断 select 选项是否已选。 */
function isSelected(runId: string, askKey: string, optionId: string): boolean {
    const value = runDrafts.value[runId]?.[askKey];
    return Array.isArray(value) ? value.includes(optionId) : value === optionId;
}

/** 判断 ask 是否已有可提交答案。 */
function hasAnswer(runId: string, ask: PendingAsk): boolean {
    const value = runDrafts.value[runId]?.[ask.key];
    if (ask.spec.kind === "approve") return typeof value === "boolean";
    if (ask.spec.kind === "text") return typeof value === "string" && Boolean(value.trim());
    return Array.isArray(value) ? value.length > 0 : typeof value === "string" && Boolean(value);
}

function canSubmit(runId: string): boolean {
    const asks = asksFor(runId);
    return asks.length > 0 && asks.every((ask) => hasAnswer(runId, ask));
}

/** 独立提交一个 Run 的全部 ask 答案；不会触碰普通 Session resolution。 */
async function submitRun(runId: string): Promise<void> {
    if (!canSubmit(runId) || submittingRuns.value.has(runId)) return;
    const asks = asksFor(runId);
    const answers: Record<string, JsonValue> = {};
    for (const ask of asks) {
        answers[ask.key] = runDrafts.value[runId]![ask.key]!;
    }
    const submittedSignature = workflowPendingAskSignature(asks);
    const observationAtStart = observationRevision;
    const revision = pollRevisions.get(runId) ?? 0;
    submittingRuns.value = new Set(submittingRuns.value).add(runId);
    runErrors.value = {...runErrors.value, [runId]: ""};
    try {
        await $fetch(`/api/agent/workflow/runs/${runId}/resume`, {method: "POST", body: {answers}});
        if (disposed || observationAtStart !== observationRevision || revision !== (pollRevisions.get(runId) ?? 0)) return;
        submittedRuns.value = new Set(submittedRuns.value).add(runId);
        submittedAskSignatures.value = {...submittedAskSignatures.value, [runId]: submittedSignature};
        scheduleRunPoll(runId, 0);
    } catch (error) {
        if (disposed || observationAtStart !== observationRevision || revision !== (pollRevisions.get(runId) ?? 0)) return;
        runErrors.value = {...runErrors.value, [runId]: resolveApiErrorMessage(error, "继续 workflow 失败")};
    } finally {
        if (disposed || observationAtStart !== observationRevision || revision !== (pollRevisions.get(runId) ?? 0)) return;
        const next = new Set(submittingRuns.value);
        next.delete(runId);
        submittingRuns.value = next;
    }
}

onBeforeUnmount(() => {
    disposed = true;
    resetRunState();
});
</script>

<template>
    <section v-if="waitingCount || feed.error" class="border-t border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-3">
        <div class="flex items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--text-main)]">
                <span class="i-lucide-inbox h-4 w-4 shrink-0 text-[var(--status-warning)]"></span>
                <span>Workflow 待处理</span>
                <span v-if="waitingCount" class="rounded-full bg-[var(--status-warning-bg)] px-1.5 py-0.5 text-[10px] text-[var(--status-warning)]">{{ waitingCount }}</span>
            </div>
            <span class="text-[10px] text-[var(--text-muted)]">每个流程分别应答</span>
        </div>

        <div v-for="job in waitingJobs" :key="job.jobId" class="mt-3 border-t border-[var(--border-color)] pt-3 first:mt-2 first:border-t-0 first:pt-0">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-2">
                    <span class="i-lucide-route h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]"></span>
                    <span class="truncate text-xs font-medium text-[var(--text-main)]">{{ job.title }}</span>
                    <span class="font-mono text-[10px] text-[var(--text-muted)]">{{ readRunRef(job)?.runId }}</span>
                </div>
                <span class="text-[10px] text-[var(--status-warning)]">等待应答</span>
            </div>

            <template v-if="readRunRef(job) && stateFor(readRunRef(job)!.runId)">
                <div v-for="ask in asksFor(readRunRef(job)!.runId)" :key="ask.key" class="mt-2 rounded border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-3">
                    <div class="text-sm font-semibold text-[var(--status-warning)]">{{ ask.spec.title }}</div>
                    <AgentMarkdownContent v-if="ask.spec.description" class="mt-2 text-xs text-[var(--text-secondary)]" :content="ask.spec.description" />
                    <div v-if="ask.spec.kind === 'select'" class="mt-2 flex flex-wrap gap-2">
                        <button v-for="option in ask.spec.options ?? []" :key="option.id" type="button" class="rounded-full border px-3 py-1 text-xs transition-colors"
                            :class="isSelected(readRunRef(job)!.runId, ask.key, option.id)
                                ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]'
                                : 'border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-secondary)]'"
                            :disabled="submittingRuns.has(readRunRef(job)!.runId) || submittedRuns.has(readRunRef(job)!.runId)"
                            @click="toggleOption(readRunRef(job)!.runId, ask, option.id)">{{ option.label }}</button>
                    </div>
                    <input v-else-if="ask.spec.kind === 'text'" type="text" class="mt-2 w-full rounded border border-[var(--border-color)] bg-[var(--bg-main)] px-2 py-1.5 text-sm text-[var(--text-main)]"
                        :value="runDrafts[readRunRef(job)!.runId]?.[ask.key] as string | undefined"
                        :disabled="submittingRuns.has(readRunRef(job)!.runId) || submittedRuns.has(readRunRef(job)!.runId)"
                        placeholder="输入应答…"
                        @input="setDraft(readRunRef(job)!.runId, ask.key, ($event.target as HTMLInputElement).value)">
                    <div v-else class="mt-2 flex flex-wrap items-center gap-2">
                        <button type="button" class="rounded border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-1 text-xs text-[var(--status-success)]"
                            :disabled="submittingRuns.has(readRunRef(job)!.runId) || submittedRuns.has(readRunRef(job)!.runId)" @click="setDraft(readRunRef(job)!.runId, ask.key, true)">同意</button>
                        <button type="button" class="rounded border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-1 text-xs text-[var(--status-danger)]"
                            :disabled="submittingRuns.has(readRunRef(job)!.runId) || submittedRuns.has(readRunRef(job)!.runId)" @click="setDraft(readRunRef(job)!.runId, ask.key, false)">否决</button>
                        <span class="text-xs text-[var(--text-muted)]">{{ typeof runDrafts[readRunRef(job)!.runId]?.[ask.key] === "boolean" ? (runDrafts[readRunRef(job)!.runId]?.[ask.key] ? "已选择同意" : "已选择否决") : "尚未选择" }}</span>
                    </div>
                </div>
                <div v-if="asksFor(readRunRef(job)!.runId).length === 0" class="mt-2 text-xs text-[var(--text-muted)]">正在读取待应答项…</div>
                <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span v-if="runErrors[readRunRef(job)!.runId]" class="text-xs text-[var(--status-danger)]">{{ runErrors[readRunRef(job)!.runId] }}</span>
                    <span v-else-if="submittedRuns.has(readRunRef(job)!.runId)" class="text-xs text-[var(--status-info)]">已提交，正在继续…</span>
                    <span v-else class="text-xs text-[var(--text-muted)]">完成全部问题后继续</span>
                    <button type="button" class="rounded bg-[var(--accent-main)] px-3 py-1.5 text-xs font-medium text-[var(--text-inverse)] disabled:cursor-not-allowed disabled:opacity-50"
                        :disabled="!canSubmit(readRunRef(job)!.runId) || submittingRuns.has(readRunRef(job)!.runId) || submittedRuns.has(readRunRef(job)!.runId)"
                        @click="submitRun(readRunRef(job)!.runId)">
                        {{ submittingRuns.has(readRunRef(job)!.runId) ? "提交中…" : submittedRuns.has(readRunRef(job)!.runId) ? "已提交" : "应答并继续" }}
                    </button>
                </div>
            </template>
            <div v-else class="mt-2 text-xs text-[var(--text-muted)]">正在读取 workflow 问题…</div>
        </div>
        <div v-if="feed.error" class="mt-2 text-xs text-[var(--status-danger)]">{{ feed.error }}</div>
    </section>
</template>
