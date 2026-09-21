import {computed, effectScope, onScopeDispose, ref, shallowRef, watch, type ComputedRef, type Ref} from "vue";
import {useAgentJob} from "nbook/app/composables/useAgentJob";
import {resolveApiErrorMessage, resolveApiErrorStatus} from "nbook/app/utils/api-error";
import {
    parseRunWorkflowArgs,
    parseRunWorkflowDetails,
    shouldPollWorkflowRun,
    workflowPollDelay,
} from "nbook/app/components/novel-ide/agent/workflow-bubble";
import type {AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import type {WorkflowDemoRunState} from "nbook/server/agent/workflow/workflow-demo-service";
import type {AgentJobSnapshot} from "nbook/shared/dto/agent-job.dto";

export interface AgentWorkflowObservation {
    job: AgentJobSnapshot | null;
    jobUnavailable: boolean;
    jobFeedError?: string;
    cancelSubmitting: boolean;
    cancelRequested: boolean;
    canCancelJob: boolean;
    runState: WorkflowDemoRunState | null;
    runUnavailable: boolean;
    pollError?: string;
    catalogTitle?: string;
    catalogDescription?: string;
    now: number;
}

export interface UseAgentWorkflowObservationOptions {
    projectRoot: Ref<string | null> | ComputedRef<string | null>;
}

export function useAgentWorkflowObservationManager(options: UseAgentWorkflowObservationOptions) {
    const observations = shallowRef<Record<string, AgentWorkflowObservation>>({});
    const scopes = new Map<string, {scope: ReturnType<typeof effectScope>; cancel: () => Promise<void>}>();

    function observe(toolKey: string, toolCall: AgentToolCall): void {
        if (scopes.has(toolKey)) {
            return;
        }

        const scope = effectScope();
        scope.run(() => {
            const parsedArgs = computed(() => parseRunWorkflowArgs(toolCall.argsJson ?? toolCall.argsText));
            const details = computed(() => parseRunWorkflowDetails(toolCall.resultData));
            const jobId = computed(() => details.value?.jobId ?? null);
            const jobEventCursor = computed(() => details.value?.jobEventCursor ?? null);

            const {
                job: observedJob,
                error: jobFeedError,
                unavailable: jobUnavailable,
                cancelling: cancelSubmitting,
                cancelRequested,
                canCancel: canCancelJob,
                cancel: cancelJob,
            } = useAgentJob(jobId, jobEventCursor);

            const matchingJob = computed(() => observedJob.value?.jobId === jobId.value ? observedJob.value : null);
            const jobRefRunId = computed(() => {
                const refValue = matchingJob.value?.ref;
                return refValue && typeof refValue === "object" && !Array.isArray(refValue) && typeof refValue.runId === "string"
                    ? refValue.runId
                    : "";
            });
            const runId = computed(() => details.value?.runId ?? jobRefRunId.value);

            const runState = shallowRef<WorkflowDemoRunState | null>(null);
            const pollError = ref("");
            const runUnavailable = ref(false);
            const catalogTitle = ref("");
            const catalogDescription = ref("");
            const nowTick = ref(Date.now());

            let runPollTimer: ReturnType<typeof setTimeout> | null = null;
            let runPollCursor = 0;
            let runPollRevision = 0;
            let runPollInFlightRevision = -1;
            let disposed = false;

            function clearRunPollTimer(): void {
                if (runPollTimer) {
                    clearTimeout(runPollTimer);
                    runPollTimer = null;
                }
            }

            function scheduleRunPoll(delay: number): void {
                const observedStatus = runState.value?.view.status;
                const canPollRun = shouldPollWorkflowRun({
                    hasBackgroundJob: Boolean(jobId.value),
                    detailsStatus: details.value?.status,
                    runStatus: observedStatus,
                    runUnavailable: runUnavailable.value,
                });
                if (disposed || runPollTimer || runPollInFlightRevision === runPollRevision || !runId.value || runUnavailable.value
                    || !canPollRun) {
                    return;
                }
                const revision = runPollRevision;
                const expectedRunId = runId.value;
                runPollTimer = setTimeout(() => {
                    runPollTimer = null;
                    void pollRun(revision, expectedRunId);
                }, delay);
            }

            async function pollRun(revision: number, expectedRunId: string): Promise<void> {
                if (disposed || revision !== runPollRevision || expectedRunId !== runId.value) {
                    return;
                }
                runPollInFlightRevision = revision;
                try {
                    const next = await $fetch(`/api/agent/workflow/runs/${expectedRunId}`, {
                        query: {after: runPollCursor},
                    }) as unknown as WorkflowDemoRunState;
                    if (disposed || revision !== runPollRevision || expectedRunId !== runId.value) {
                        return;
                    }
                    runPollCursor = next.nextCursor;
                    runState.value = next;
                    nowTick.value = Date.now();
                    pollError.value = "";
                    runUnavailable.value = false;
                } catch (error) {
                    if (disposed || revision !== runPollRevision || expectedRunId !== runId.value) {
                        return;
                    }
                    if (resolveApiErrorStatus(error) === 404) {
                        runUnavailable.value = true;
                        pollError.value = matchingJob.value?.status === "completed"
                            ? "任务执行明细已不可用"
                            : "该 workflow run 已不可查询，可能因服务重启而中断";
                    } else {
                        pollError.value = resolveApiErrorMessage(error, "读取 workflow 状态失败");
                    }
                } finally {
                    if (runPollInFlightRevision === revision) {
                        runPollInFlightRevision = -1;
                    }
                    if (revision === runPollRevision && expectedRunId === runId.value) {
                        scheduleRunPoll(workflowPollDelay(runState.value?.view.status));
                    }
                }
            }

            watch(runId, (nextRunId) => {
                runPollRevision++;
                clearRunPollTimer();
                runPollCursor = 0;
                runState.value = null;
                pollError.value = "";
                runUnavailable.value = false;
                if (nextRunId) {
                    scheduleRunPoll(0);
                }
            }, {immediate: true});

            // 保持最新 observation 投影
            watch([
                matchingJob,
                jobUnavailable,
                jobFeedError,
                cancelSubmitting,
                cancelRequested,
                canCancelJob,
                runState,
                runUnavailable,
                pollError,
                catalogTitle,
                catalogDescription,
                nowTick,
            ], () => {
                observations.value = {
                    ...observations.value,
                    [toolKey]: {
                        job: matchingJob.value,
                        jobUnavailable: jobUnavailable.value,
                        jobFeedError: jobFeedError.value,
                        cancelSubmitting: cancelSubmitting.value,
                        cancelRequested: cancelRequested.value,
                        canCancelJob: canCancelJob.value,
                        runState: runState.value,
                        runUnavailable: runUnavailable.value,
                        pollError: pollError.value,
                        catalogTitle: catalogTitle.value,
                        catalogDescription: catalogDescription.value,
                        now: nowTick.value,
                    },
                };
            }, {immediate: true});

            onScopeDispose(() => {
                disposed = true;
                clearRunPollTimer();
            });

            scopes.set(toolKey, {scope, cancel: cancelJob});
        });
    }

    function unobserve(toolKey: string): void {
        const item = scopes.get(toolKey);
        if (item) {
            item.scope.stop();
            scopes.delete(toolKey);
            const next = {...observations.value};
            delete next[toolKey];
            observations.value = next;
        }
    }

    async function cancelJob(toolKey: string): Promise<void> {
        const item = scopes.get(toolKey);
        if (item) {
            await item.cancel();
        }
    }

    function reset(): void {
        for (const [key, item] of scopes.entries()) {
            item.scope.stop();
        }
        scopes.clear();
        observations.value = {};
    }

    onScopeDispose(() => {
        reset();
    });

    return {
        observations,
        observe,
        unobserve,
        cancelJob,
        reset,
    };
}
