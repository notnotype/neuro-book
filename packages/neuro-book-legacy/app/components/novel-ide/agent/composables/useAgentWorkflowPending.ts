import {computed, onBeforeUnmount, ref, shallowRef, watch, type ComputedRef, type Ref} from "vue";
import {useAgentJobsFeed} from "nbook/app/composables/useAgentJobsFeed";
import {resolveApiErrorMessage, resolveApiErrorStatus} from "nbook/app/utils/api-error";
import {workflowPendingAskSignature} from "nbook/app/components/novel-ide/agent/workflow-bubble";
import type {WorkflowDemoRunState} from "nbook/server/agent/workflow/workflow-demo-service";
import type {JsonValue} from "@notnotype/nb-workflow";
import type {AgentJobSnapshot} from "nbook/shared/dto/agent-job.dto";

export type AskDraftValue = string | string[] | boolean;

export interface AgentWorkflowPendingRunView {
    job: AgentJobSnapshot;
    runId: string;
    workflowKey: string;
    state: WorkflowDemoRunState | null;
    error: string;
    draft: Record<string, AskDraftValue>;
    submitting: boolean;
    submitted: boolean;
}

export interface UseAgentWorkflowPendingOptions {
    sessionId: Ref<number | null> | ComputedRef<number | null>;
}

type RunRef = {runId: string; workflowKey: string};

/** 从 Job ref 读取正式 workflow run；其它类型的后台任务不进入此面板。 */
function readRunRef(job: AgentJobSnapshot): RunRef | null {
    const ref = job.ref;
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) return null;
    const runId = ref.runId;
    const workflowKey = ref.workflowKey;
    if (typeof runId !== "string" || !runId || typeof workflowKey !== "string" || !workflowKey) return null;
    return {runId, workflowKey};
}

export function useAgentWorkflowPending(options: UseAgentWorkflowPendingOptions) {
    const feed = useAgentJobsFeed(() => options.sessionId.value !== null);
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

    /** 当前 Session 中等待用户应答的后台 workflow；每个 Run 独立展示。 */
    const waitingJobs = computed(() => {
        const sid = options.sessionId.value;
        if (sid === null) return [];
        return feed.jobs.value.filter((job) => job.kind === "workflow"
            && job.ownerSessionId === sid
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
    watch(() => options.sessionId.value, resetRunState);

    function updateAnswer(runId: string, key: string, value: AskDraftValue): void {
        runDrafts.value = {
            ...runDrafts.value,
            [runId]: {...runDrafts.value[runId], [key]: value},
        };
    }

    async function submitRun(runId: string): Promise<void> {
        const state = runStates.value[runId];
        const asks = state?.view.pendingAsks ?? [];
        if (asks.length === 0 || submittingRuns.value.has(runId)) return;
        const answers: Record<string, JsonValue> = {};
        for (const ask of asks) {
            answers[ask.key] = runDrafts.value[runId]?.[ask.key] ?? "";
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

    const runs = computed<AgentWorkflowPendingRunView[]>(() => {
        return waitingJobs.value.map((job) => {
            const ref = readRunRef(job)!;
            return {
                job,
                runId: ref.runId,
                workflowKey: ref.workflowKey,
                state: runStates.value[ref.runId] ?? null,
                error: runErrors.value[ref.runId] ?? "",
                draft: runDrafts.value[ref.runId] ?? {},
                submitting: submittingRuns.value.has(ref.runId),
                submitted: submittedRuns.value.has(ref.runId),
            };
        });
    });

    onBeforeUnmount(() => {
        disposed = true;
        resetRunState();
    });

    return {
        runs,
        feedError: computed(() => feed.error.value),
        waitingCount,
        updateAnswer,
        submitRun,
    };
}
