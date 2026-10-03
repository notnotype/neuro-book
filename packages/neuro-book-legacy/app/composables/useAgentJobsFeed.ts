import {
    computed,
    getCurrentScope,
    onScopeDispose,
    readonly,
    ref,
    shallowReadonly,
    shallowRef,
    toValue,
    watch,
    type ComputedRef,
    type MaybeRefOrGetter,
    type Ref,
    type ShallowRef,
} from "vue";
import {readSseStream} from "nbook/app/utils/http/read-sse";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {SseReconnectBackoff} from "nbook/app/utils/http/sse-reconnect-backoff";
import type {
    AgentJobEventCursor,
    AgentJobEventDto,
    AgentJobListResponseDto,
    AgentJobSnapshot,
} from "nbook/shared/dto/agent-job.dto";

export type AgentJobObservationStatus = "pending" | "available" | "unavailable";

export type AgentJobsFeedView = {
    /** 全量任务快照，始终按 createdAt 倒序整体替换。 */
    jobs: Readonly<ShallowRef<AgentJobSnapshot[]>>;
    /** running + waiting 数量，供顶栏徽标消费。 */
    activeCount: ComputedRef<number>;
    /** 首次成功取得恢复快照后为 true。 */
    loaded: Readonly<Ref<boolean>>;
    /** 最近一次快照或事件流失败；成功恢复后自动清空。 */
    error: Readonly<Ref<string>>;
    /** 用服务端签发的创建游标判断指定 Job 是否已经可被可靠观测。 */
    observe(
        jobId: Readonly<Ref<string | null>>,
        jobEventCursor: Readonly<Ref<AgentJobEventCursor | null>>,
    ): ComputedRef<AgentJobObservationStatus>;
};

export type AgentJobsFeed = AgentJobsFeedView & {
    /** 重新读取一次恢复快照并用新游标重建 SSE。 */
    refresh(): void;
    /** 清除已结束任务，并在成功后重新读取恢复快照。 */
    clearFinished(): Promise<number>;
};

export type AgentJobsFeedTransport = {
    /** 读取列表与原子恢复游标。 */
    loadSnapshot(): Promise<AgentJobListResponseDto>;
    /** 打开一条 SSE，直到服务端收尾、网络断开或 signal 中止。 */
    stream(
        cursor: AgentJobEventCursor,
        signal: AbortSignal,
        onEvent: (event: AgentJobEventDto) => void | Promise<void>,
        onOpen: () => void,
    ): Promise<void>;
    /** 调用服务端清除已结束任务。 */
    clearFinished(): Promise<number>;
};

export type AgentJobsFeedController = {
    feed: AgentJobsFeed;
    /** 在当前 Vue effect scope 内按 enabled 自动取得或释放一个 consumer。 */
    consume(enabled?: MaybeRefOrGetter<boolean>): AgentJobsFeed;
};

/**
 * 创建 Jobs SSE 状态机。transport 注入让恢复、乱序和退避无需浏览器即可确定性测试；
 * 页面只使用文件末尾的模块级单例。
 */
export function createAgentJobsFeed(transport: AgentJobsFeedTransport): AgentJobsFeedController {
    const jobs = shallowRef<AgentJobSnapshot[]>([]);
    const loaded = ref(false);
    const error = ref("");
    const activeCount = computed(() => jobs.value.filter(isActiveJob).length);

    let consumers = 0;
    let started = false;
    let generation = 0;
    const appliedCursor = shallowRef<AgentJobEventCursor | null>(null);
    const snapshotRevision = ref(0);
    let streamController: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let recoveryTask: Promise<void> | null = null;
    const reconnectBackoff = new SseReconnectBackoff();

    /** 当前异步回调是否仍属于活跃代次。 */
    const isCurrent = (expectedGeneration: number): boolean => started && expectedGeneration === generation;

    /** 取消当前 SSE 与待执行重连，不修改最后可信列表。 */
    const stopConnection = (): void => {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        streamController?.abort();
        streamController = null;
    };

    /** 以整体替换方式 upsert，并恢复稳定倒序。 */
    const upsert = (job: AgentJobSnapshot): void => {
        const next = jobs.value.filter((item) => item.jobId !== job.jobId);
        next.push(job);
        jobs.value = sortJobs(next);
    };

    /** 消费一个 envelope；重复帧丢弃，缺口和 epoch 变化触发单飞快照恢复。 */
    const consumeEvent = (event: AgentJobEventDto, expectedGeneration: number): void => {
        const cursor = appliedCursor.value;
        if (!isCurrent(expectedGeneration) || !cursor) return;
        if (event.event.type === "connected") {
            if (event.eventEpoch !== cursor.eventEpoch || event.event.eventEpoch !== cursor.eventEpoch) {
                void recover();
            }
            return;
        }
        if (event.event.type === "snapshot_required") {
            void recover();
            return;
        }
        if (event.eventEpoch !== cursor.eventEpoch) {
            void recover();
            return;
        }
        if (event.seq <= cursor.after) return;
        if (event.seq !== cursor.after + 1) {
            void recover();
            return;
        }
        if (event.event.type === "job_upserted") {
            upsert(event.event.job);
        } else {
            const removed = new Set(event.event.jobIds);
            jobs.value = jobs.value.filter((job) => !removed.has(job.jobId));
        }
        appliedCursor.value = {...cursor, after: event.seq};
    };

    /** 按共享退避策略安排快照或 SSE 重试。 */
    const scheduleRetry = (expectedGeneration: number, target: "snapshot" | "stream", delayMs: number): void => {
        if (!isCurrent(expectedGeneration) || reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (!isCurrent(expectedGeneration)) return;
            if (target === "snapshot") {
                void recover();
            } else {
                connect(expectedGeneration);
            }
        }, delayMs);
    };

    /** 打开当前游标对应的 SSE；断线保留列表并从最后已应用 seq 重连。 */
    const connect = (expectedGeneration: number): void => {
        if (!isCurrent(expectedGeneration) || !appliedCursor.value || streamController) return;
        const controller = new AbortController();
        const cursor = {...appliedCursor.value};
        streamController = controller;
        void transport.stream(
            cursor,
            controller.signal,
            (event) => consumeEvent(event, expectedGeneration),
            () => {
                if (!isCurrent(expectedGeneration)) return;
                reconnectBackoff.opened();
                error.value = "";
            },
        ).then(() => {
            if (streamController === controller) streamController = null;
            if (isCurrent(expectedGeneration) && !controller.signal.aborted) {
                error.value = "后台任务事件连接已断开";
                const retry = reconnectBackoff.disconnected();
                scheduleRetry(expectedGeneration, "stream", retry.delayMs);
            }
        }).catch((caught: unknown) => {
            if (streamController === controller) streamController = null;
            if (!isCurrent(expectedGeneration) || isAbortError(caught)) return;
            error.value = resolveApiErrorMessage(caught, "后台任务事件连接中断");
            const retry = reconnectBackoff.disconnected();
            scheduleRetry(expectedGeneration, "stream", retry.delayMs);
        });
    };

    /** 单飞读取恢复快照；成功后替换全表并以新游标重建连接。 */
    const recover = (): Promise<void> => {
        if (!started) return Promise.resolve();
        if (recoveryTask) return recoveryTask;
        stopConnection();
        const expectedGeneration = ++generation;
        const task = (async (): Promise<void> => {
            try {
                const response = await transport.loadSnapshot();
                if (!isCurrent(expectedGeneration)) return;
                jobs.value = sortJobs(response.jobs);
                appliedCursor.value = {...response.eventCursor};
                snapshotRevision.value += 1;
                loaded.value = true;
                error.value = "";
                reconnectBackoff.reset();
                connect(expectedGeneration);
            } catch (caught: unknown) {
                if (!isCurrent(expectedGeneration)) return;
                error.value = resolveApiErrorMessage(caught, "读取后台任务列表失败");
                const retry = reconnectBackoff.disconnected();
                scheduleRetry(expectedGeneration, "snapshot", retry.delayMs);
            }
        })();
        recoveryTask = task;
        void task.then(() => {
            if (recoveryTask === task) recoveryTask = null;
        }, () => {
            if (recoveryTask === task) recoveryTask = null;
        });
        return task;
    };

    /** 首个消费者启动状态机。 */
    const start = (): void => {
        if (started) return;
        started = true;
        reconnectBackoff.reset();
        void recover();
    };

    /** 最后一个消费者离开时使全部旧异步响应失效。 */
    const stop = (): void => {
        if (!started) return;
        started = false;
        generation += 1;
        stopConnection();
        recoveryTask = null;
        reconnectBackoff.reset();
    };

    /**
     * 为单个观察器建立因果判定。epoch 不同时先强制完成一轮新快照，避免把旧 feed
     * 与新进程启动回执之间的短暂竞态误判为 unavailable。
     */
    const observe = (
        jobId: Readonly<Ref<string | null>>,
        jobEventCursor: Readonly<Ref<AgentJobEventCursor | null>>,
    ): ComputedRef<AgentJobObservationStatus> => {
        const epochRecovery = shallowRef<{
            jobId: string;
            eventEpoch: string;
            after: number;
            snapshotRevision: number;
        } | null>(null);
        watch([jobId, jobEventCursor, appliedCursor], ([targetJobId, expected, applied]) => {
            if (!targetJobId || !expected) {
                epochRecovery.value = null;
                return;
            }
            const current = epochRecovery.value;
            const matchesTarget = current
                && current.jobId === targetJobId
                && current.eventEpoch === expected.eventEpoch
                && current.after === expected.after;
            if (!applied) {
                if (!matchesTarget) {
                    epochRecovery.value = {
                        jobId: targetJobId,
                        eventEpoch: expected.eventEpoch,
                        after: expected.after,
                        snapshotRevision: snapshotRevision.value,
                    };
                }
                return;
            }
            if (expected.eventEpoch === applied.eventEpoch) {
                epochRecovery.value = null;
                return;
            }
            if (matchesTarget) {
                return;
            }
            epochRecovery.value = {
                jobId: targetJobId,
                eventEpoch: expected.eventEpoch,
                after: expected.after,
                snapshotRevision: snapshotRevision.value,
            };
            void recover();
        }, {immediate: true});
        return computed(() => {
            const targetJobId = jobId.value;
            if (!targetJobId) return "pending";
            const exists = jobs.value.some((job) => job.jobId === targetJobId);
            const expected = jobEventCursor.value;
            if (!expected) return exists ? "available" : "pending";
            const applied = appliedCursor.value;
            if (!applied) return "pending";
            if (applied.eventEpoch !== expected.eventEpoch) {
                const recovery = epochRecovery.value;
                const matchesTarget = recovery
                    && recovery.jobId === targetJobId
                    && recovery.eventEpoch === expected.eventEpoch
                    && recovery.after === expected.after;
                return matchesTarget && snapshotRevision.value > recovery.snapshotRevision
                    ? "unavailable"
                    : "pending";
            }
            if (applied.after < expected.after) return "pending";
            return exists ? "available" : "unavailable";
        });
    };

    const feed: AgentJobsFeed = {
        jobs: shallowReadonly(jobs),
        activeCount,
        loaded: readonly(loaded),
        error: readonly(error),
        observe,
        refresh: () => {
            reconnectBackoff.reset();
            void recover();
        },
        clearFinished: async () => {
            const removed = await transport.clearFinished();
            reconnectBackoff.reset();
            await recover();
            return removed;
        },
    };

    /** 增加一个内部 consumer；首个 consumer 启动快照与 SSE。 */
    const retain = (): void => {
        consumers += 1;
        if (consumers === 1) start();
    };

    /** 释放一个内部 consumer；最后一个 consumer 离开时停止网络观察。 */
    const release = (): void => {
        consumers = Math.max(0, consumers - 1);
        if (consumers === 0) stop();
    };

    return {
        feed,
        consume: (enabled: MaybeRefOrGetter<boolean> = true) => {
            if (!getCurrentScope()) {
                throw new Error("Agent Jobs feed consumer 必须在 Vue effect scope 内创建");
            }
            let retained = false;
            watch(() => Boolean(toValue(enabled)), (nextEnabled) => {
                if (nextEnabled === retained) return;
                retained = nextEnabled;
                if (retained) {
                    retain();
                } else {
                    release();
                }
            }, {immediate: true, flush: "sync"});
            onScopeDispose(() => {
                if (!retained) return;
                retained = false;
                release();
            });
            return feed;
        },
    };
}

/** 活跃状态判定。 */
function isActiveJob(job: AgentJobSnapshot): boolean {
    return job.status === "running" || job.status === "waiting";
}

/** createdAt 倒序；时间相同以 jobId 稳定排序。 */
function sortJobs(value: AgentJobSnapshot[]): AgentJobSnapshot[] {
    return [...value].sort((left, right) => right.createdAt - left.createdAt || left.jobId.localeCompare(right.jobId));
}

/** 外部 fetch/stream 错误只在 name 明确为 AbortError 时视为主动中止。 */
function isAbortError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

const singleton = createAgentJobsFeed({
    /** JsonValue 是递归类型，避免让 Nuxt $fetch 的序列化泛型递归展开。 */
    loadSnapshot: async () => await $fetch("/api/agent/jobs") as unknown as AgentJobListResponseDto,
    stream: async (cursor, signal, onEvent, onOpen) => {
        const query = new URLSearchParams({eventEpoch: cursor.eventEpoch, after: String(cursor.after)});
        const response = await fetch(`/api/agent/jobs/events?${query.toString()}`, {signal});
        await readSseStream<AgentJobEventDto>(response, onEvent, {onOpen});
    },
    clearFinished: async () => {
        // 避免 Nuxt 对全路由 union 做递归响应推断；该稳定端点只返回 removed 计数。
        const request = $fetch as unknown as (
            path: string,
            options: {method: "POST"},
        ) => Promise<{removed: number}>;
        const response = await request("/api/agent/jobs/clear-finished", {method: "POST"});
        return response.removed;
    },
});

/**
 * 取得页面级 Jobs SSE 单例。enabled 为 false 时不持有 consumer；最后一个有效 scope 离开时断开连接。
 */
export function useAgentJobsFeed(enabled: MaybeRefOrGetter<boolean> = true): AgentJobsFeed {
    if (!import.meta.client) return singleton.feed;
    return singleton.consume(enabled);
}
