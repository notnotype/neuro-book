import {computed, effectScope, nextTick, readonly, ref, shallowReadonly, shallowRef, type Ref, type ShallowRef} from "vue";
import {afterEach, describe, expect, it, vi} from "vitest";
import {createAgentJobObserver} from "nbook/app/composables/useAgentJob";
import type {AgentJobsFeedView} from "nbook/app/composables/useAgentJobsFeed";
import type {AgentJobEventCursor, AgentJobSnapshot} from "nbook/shared/dto/agent-job.dto";

describe("useAgentJob", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("切换 Job 后丢弃旧 cancel 响应", async () => {
        let resolveOldCancel: ((value: {job: AgentJobSnapshot}) => void) | undefined;
        const oldCancel = new Promise<{job: AgentJobSnapshot}>((resolve) => {
            resolveOldCancel = resolve;
        });
        const fetchMock = vi.fn((url: string, init?: {method?: string}) => {
            if (url === "/api/agent/jobs/job-old/cancel" && init?.method === "POST") {
                return oldCancel;
            }
            throw new Error("未预期的请求：" + url);
        });
        vi.stubGlobal("$fetch", fetchMock);

        const jobId = ref("job-old");
        const jobs = shallowRef([snapshot("job-old", "running"), snapshot("job-new", "running")]);
        const feed = createFeed(jobs);
        const cursor = ref<AgentJobEventCursor | null>({eventEpoch: "epoch-1", after: 1});
        const scope = effectScope();
        const observer = scope.run(() => createAgentJobObserver(jobId, cursor, feed))!;
        expect(observer.job.value?.jobId).toBe("job-old");

        const cancelling = observer.cancel();
        await Promise.resolve();
        expect(observer.cancelling.value).toBe(true);

        jobId.value = "job-new";
        await nextTick();
        expect(observer.job.value?.jobId).toBe("job-new");
        expect(observer.cancelling.value).toBe(false);

        resolveOldCancel?.({job: snapshot("job-old", "cancelled")});
        await cancelling;

        expect(observer.job.value?.jobId).toBe("job-new");
        expect(observer.job.value?.status).toBe("running");
        expect(observer.cancelRequested.value).toBe(false);
        expect(fetchMock).toHaveBeenCalledOnce();
        scope.stop();
    });

    it("多个观察器共享列表，Job 删除后同时标记 unavailable", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("$fetch", fetchMock);
        const jobs = shallowRef([snapshot("job-shared", "running")]);
        const feed = createFeed(jobs);
        const firstScope = effectScope();
        const secondScope = effectScope();
        const jobId = ref("job-shared");
        const cursor = ref<AgentJobEventCursor | null>({eventEpoch: "epoch-1", after: 1});
        const first = firstScope.run(() => createAgentJobObserver(jobId, cursor, feed))!;
        const second = secondScope.run(() => createAgentJobObserver(jobId, cursor, feed))!;

        expect(first.job.value?.jobId).toBe("job-shared");
        expect(second.job.value?.jobId).toBe("job-shared");
        jobs.value = [];
        await nextTick();

        expect(first.job.value).toBeNull();
        expect(second.job.value).toBeNull();
        expect(first.unavailable.value).toBe(true);
        expect(second.unavailable.value).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
        firstScope.stop();
        secondScope.stop();
    });

    it("缺少因果游标时 Job 缺失保持 pending，不猜测 unavailable", () => {
        const jobs = shallowRef<AgentJobSnapshot[]>([]);
        const feed = createFeed(jobs);
        const scope = effectScope();
        const observer = scope.run(() => createAgentJobObserver(ref("job-old-history"), ref(null), feed))!;

        expect(observer.observation.value).toBe("pending");
        expect(observer.unavailable.value).toBe(false);
        expect(observer.error.value).toBe("");
        scope.stop();
    });

    it("null 到 A、B 再回 null 时只观察当前目标且不保留历史错误", async () => {
        const jobs = shallowRef([snapshot("job-a", "running"), snapshot("job-b", "waiting")]);
        const feedError = ref("事件连接中断");
        const feed = createFeed(jobs, feedError);
        const jobId = ref<string | null>(null);
        const cursor = ref<AgentJobEventCursor | null>({eventEpoch: "epoch-1", after: 1});
        const scope = effectScope();
        const observer = scope.run(() => createAgentJobObserver(jobId, cursor, feed))!;

        expect(observer.job.value).toBeNull();
        expect(observer.observation.value).toBe("pending");
        expect(observer.error.value).toBe("");
        expect(observer.canCancel.value).toBe(false);

        jobId.value = "job-a";
        await nextTick();
        expect(observer.job.value?.jobId).toBe("job-a");
        expect(observer.observation.value).toBe("available");
        expect(observer.error.value).toBe("事件连接中断");
        expect(observer.canCancel.value).toBe(true);

        jobId.value = "job-b";
        await nextTick();
        expect(observer.job.value?.jobId).toBe("job-b");
        expect(observer.observation.value).toBe("available");

        jobId.value = null;
        await nextTick();
        expect(observer.job.value).toBeNull();
        expect(observer.observation.value).toBe("pending");
        expect(observer.error.value).toBe("");
        expect(observer.canCancel.value).toBe(false);
        expect("refresh" in observer).toBe(false);
        scope.stop();
    });

    it("空字符串按无目标处理", () => {
        const jobs = shallowRef([snapshot("job-a", "running")]);
        const feed = createFeed(jobs, ref("事件连接中断"));
        const scope = effectScope();
        const observer = scope.run(() => createAgentJobObserver(ref("   "), ref(null), feed))!;

        expect(observer.job.value).toBeNull();
        expect(observer.observation.value).toBe("pending");
        expect(observer.error.value).toBe("");
        expect(observer.canCancel.value).toBe(false);
        scope.stop();
    });
});

/** 创建只由测试任务列表驱动的共享 feed。 */
function createFeed(jobs: ShallowRef<AgentJobSnapshot[]>, feedError: Ref<string> = ref("")): AgentJobsFeedView {
    const loaded = ref(true);
    return {
        jobs: shallowReadonly(jobs),
        activeCount: computed(() => jobs.value.filter((job) => job.status === "running" || job.status === "waiting").length),
        loaded: readonly(loaded),
        error: readonly(feedError),
        observe: (jobId: Readonly<Ref<string | null>>, cursor: Readonly<Ref<AgentJobEventCursor | null>>) => computed(() => {
            const target = jobId.value?.trim() || null;
            if (!target) return "pending";
            const exists = jobs.value.some((job) => job.jobId === target);
            if (!cursor.value) return exists ? "available" : "pending";
            return exists ? "available" : "unavailable";
        }),
    };
}

/** 创建最小可观察 Job 快照。 */
function snapshot(jobId: string, status: AgentJobSnapshot["status"]): AgentJobSnapshot {
    return {
        jobId,
        kind: "workflow",
        title: jobId,
        ownerSessionId: null,
        status,
        deliveryStatus: "not_required",
        createdAt: 1,
        ref: null,
    };
}
