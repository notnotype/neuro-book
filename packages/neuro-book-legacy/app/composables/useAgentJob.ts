import {computed, getCurrentScope, onScopeDispose, readonly, ref, watch, type ComputedRef, type Ref} from "vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {useAgentJobsFeed, type AgentJobsFeedView} from "nbook/app/composables/useAgentJobsFeed";
import type {AgentJobObservationStatus} from "nbook/app/composables/useAgentJobsFeed";
import type {AgentJobEventCursor, AgentJobSnapshot} from "nbook/shared/dto/agent-job.dto";

export type AgentJobObserver = {
    job: ComputedRef<AgentJobSnapshot | null>;
    observation: ComputedRef<AgentJobObservationStatus>;
    error: ComputedRef<string>;
    unavailable: ComputedRef<boolean>;
    cancelling: Readonly<Ref<boolean>>;
    cancelRequested: Readonly<Ref<boolean>>;
    canCancel: ComputedRef<boolean>;
    cancel(): Promise<void>;
};

/**
 * 从共享 Jobs feed 创建单 Job 观察器。观察本身不产生 HTTP GET 或 SSE；
 * 只有取消动作保留独立 POST，并以 revision guard 隔离 Job 切换时的迟到响应。
 */
export function createAgentJobObserver(
    jobId: Readonly<Ref<string | null>>,
    jobEventCursor: Readonly<Ref<AgentJobEventCursor | null>>,
    feed: AgentJobsFeedView,
): AgentJobObserver {
    const cancelling = ref(false);
    const cancelRequested = ref(false);
    const cancelError = ref("");
    let revision = 0;
    let disposed = false;

    const targetJobId = computed(() => jobId.value?.trim() || null);
    const job = computed(() => {
        const target = targetJobId.value;
        return target ? feed.jobs.value.find((item) => item.jobId === target) ?? null : null;
    });
    const observation = feed.observe(targetJobId, jobEventCursor);
    const unavailable = computed(() => observation.value === "unavailable");
    const error = computed(() => !targetJobId.value
        ? ""
        : cancelError.value
        || (unavailable.value ? "该后台任务已清除，或服务重启后已不可查询" : feed.error.value));
    const canCancel = computed(() => Boolean(targetJobId.value)
        && isActive(job.value)
        && !cancelRequested.value);

    /** 请求取消当前 Job；实际终态只由共享事件流确认。 */
    const cancel = async (): Promise<void> => {
        const target = targetJobId.value;
        if (!target || !canCancel.value || cancelling.value) return;
        const expectedRevision = revision;
        const expectedJobId = target;
        cancelling.value = true;
        cancelError.value = "";
        try {
            await $fetch(`/api/agent/jobs/${expectedJobId}/cancel`, {method: "POST"});
            if (disposed || expectedRevision !== revision || expectedJobId !== targetJobId.value) return;
            cancelRequested.value = true;
        } catch (caught: unknown) {
            if (disposed || expectedRevision !== revision || expectedJobId !== targetJobId.value) return;
            cancelError.value = resolveApiErrorMessage(caught, "取消后台任务失败");
        } finally {
            if (!disposed && expectedRevision === revision && expectedJobId === targetJobId.value) {
                cancelling.value = false;
            }
        }
    };

    watch(targetJobId, () => {
        revision += 1;
        cancelling.value = false;
        cancelRequested.value = false;
        cancelError.value = "";
    }, {immediate: true});

    watch(() => job.value?.status, () => {
        if (!isActive(job.value)) cancelRequested.value = false;
    });

    if (getCurrentScope()) {
        onScopeDispose(() => {
            disposed = true;
            revision += 1;
        });
    }

    return {
        job,
        observation,
        error,
        unavailable,
        cancelling: readonly(cancelling),
        cancelRequested: readonly(cancelRequested),
        canCancel,
        cancel,
    };
}

/** 取得共享 feed 上的单 Job 观察器。 */
export function useAgentJob(
    jobId: Readonly<Ref<string | null>>,
    jobEventCursor: Readonly<Ref<AgentJobEventCursor | null>>,
): AgentJobObserver {
    const feed = useAgentJobsFeed(() => Boolean(jobId.value?.trim()));
    return createAgentJobObserver(jobId, jobEventCursor, feed);
}

/** Job 是否允许取消。 */
function isActive(job: AgentJobSnapshot | null): boolean {
    return job?.status === "running" || job?.status === "waiting";
}
