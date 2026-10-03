import {afterEach, describe, expect, it, vi} from "vitest";
import {effectScope, ref, type EffectScope, type MaybeRefOrGetter} from "vue";
import {createAgentJobsFeed, type AgentJobsFeedTransport} from "nbook/app/composables/useAgentJobsFeed";
import type {AgentJobsFeedController} from "nbook/app/composables/useAgentJobsFeed";
import type {
    AgentJobEventCursor,
    AgentJobEventDto,
    AgentJobListResponseDto,
    AgentJobSnapshot,
} from "nbook/shared/dto/agent-job.dto";

describe("useAgentJobsFeed", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("consumer 必须在 Vue effect scope 内创建", () => {
        const transport = createTransport({
            jobs: [],
            eventCursor: {eventEpoch: "epoch-1", after: 0},
        });
        const controller = createAgentJobsFeed(transport);

        expect(() => controller.consume()).toThrow("必须在 Vue effect scope 内创建");
        expect(transport.loadSnapshot).not.toHaveBeenCalled();
    });

    it("disabled 时零请求，启用后共享连接，最后一个消费者离开才中止", async () => {
        vi.useFakeTimers();
        const transport = createTransport({
            jobs: [snapshot("job-1", "running", 1)],
            eventCursor: {eventEpoch: "epoch-1", after: 3},
        });
        const controller = createAgentJobsFeed(transport);
        const firstEnabled = ref(false);
        const secondEnabled = ref(false);
        const firstScope = consume(controller, firstEnabled);
        const secondScope = consume(controller, secondEnabled);

        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(transport.loadSnapshot).not.toHaveBeenCalled();
        expect(transport.stream).not.toHaveBeenCalled();

        firstEnabled.value = true;
        await flushPromises();

        expect(transport.loadSnapshot).toHaveBeenCalledOnce();
        expect(transport.stream).toHaveBeenCalledOnce();
        expect(controller.feed.jobs.value.map((job) => job.jobId)).toEqual(["job-1"]);

        secondEnabled.value = true;
        expect(transport.loadSnapshot).toHaveBeenCalledOnce();
        expect(transport.stream).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(transport.loadSnapshot).toHaveBeenCalledOnce();
        expect(transport.stream).toHaveBeenCalledOnce();

        firstEnabled.value = false;
        expect(transport.connections[0]?.signal.aborted).toBe(false);
        secondEnabled.value = false;
        expect(transport.connections[0]?.signal.aborted).toBe(true);
        firstScope.stop();
        secondScope.stop();
    });

    it("最后一个 consumer 重新启用时重新读取快照并建立新 SSE", async () => {
        const transport = createTransport({
            jobs: [snapshot("job-1", "running", 1)],
            eventCursor: {eventEpoch: "epoch-1", after: 3},
        });
        const controller = createAgentJobsFeed(transport);
        const enabled = ref(true);
        const scope = consume(controller, enabled);
        await flushPromises();

        enabled.value = false;
        expect(transport.connections[0]?.signal.aborted).toBe(true);
        enabled.value = true;
        await flushPromises();

        expect(transport.loadSnapshot).toHaveBeenCalledTimes(2);
        expect(transport.stream).toHaveBeenCalledTimes(2);
        expect(transport.connections[1]?.signal.aborted).toBe(false);
        scope.stop();
    });

    it("consumer 目标从 Job A 切到 Job B 时保持同一条连接，清空目标才释放", async () => {
        const transport = createTransport({
            jobs: [snapshot("job-a", "running", 1), snapshot("job-b", "waiting", 2)],
            eventCursor: {eventEpoch: "epoch-1", after: 3},
        });
        const controller = createAgentJobsFeed(transport);
        const jobId = ref<string | null>(null);
        const scope = consume(controller, () => Boolean(jobId.value));

        jobId.value = "job-a";
        await flushPromises();
        expect(transport.loadSnapshot).toHaveBeenCalledOnce();
        expect(transport.stream).toHaveBeenCalledOnce();

        jobId.value = "job-b";
        await flushPromises();
        expect(transport.loadSnapshot).toHaveBeenCalledOnce();
        expect(transport.stream).toHaveBeenCalledOnce();
        expect(transport.connections[0]?.signal.aborted).toBe(false);

        jobId.value = null;
        expect(transport.connections[0]?.signal.aborted).toBe(true);
        scope.stop();
    });

    it("初始快照失败按退避恢复，成功建立 SSE 后不再周期 GET", async () => {
        vi.useFakeTimers();
        const response: AgentJobListResponseDto = {
            jobs: [snapshot("job-recovered", "running", 1)],
            eventCursor: {eventEpoch: "epoch-1", after: 4},
        };
        const transport = createTransport(response);
        transport.loadSnapshot.mockReset()
            .mockRejectedValueOnce(new Error("offline-1"))
            .mockRejectedValueOnce(new Error("offline-2"))
            .mockRejectedValueOnce(new Error("offline-3"))
            .mockResolvedValueOnce(response);
        const controller = createAgentJobsFeed(transport);

        const scope = consume(controller);
        await flushPromises();
        expect(transport.loadSnapshot).toHaveBeenCalledOnce();
        expect(transport.stream).not.toHaveBeenCalled();

        for (const [index, delay] of [300, 800, 1500].entries()) {
            await vi.advanceTimersByTimeAsync(delay - 1);
            expect(transport.loadSnapshot).toHaveBeenCalledTimes(index + 1);
            await vi.advanceTimersByTimeAsync(1);
            await flushPromises();
            expect(transport.loadSnapshot).toHaveBeenCalledTimes(index + 2);
        }

        expect(transport.stream).toHaveBeenCalledOnce();
        expect(controller.feed.jobs.value.map((job) => job.jobId)).toEqual(["job-recovered"]);

        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(transport.loadSnapshot).toHaveBeenCalledTimes(4);
        expect(transport.stream).toHaveBeenCalledOnce();
        scope.stop();
    });

    it("按 jobId upsert、删除并保持 createdAt 倒序，重复 seq 不重复应用", async () => {
        const transport = createTransport({
            jobs: [snapshot("job-1", "running", 1)],
            eventCursor: {eventEpoch: "epoch-1", after: 3},
        });
        const controller = createAgentJobsFeed(transport);
        const scope = consume(controller);
        await flushPromises();
        const connection = transport.connections[0]!;

        connection.onEvent(event(4, {type: "job_upserted", job: snapshot("job-2", "waiting", 2)}));
        connection.onEvent(event(4, {type: "job_upserted", job: snapshot("job-2", "failed", 2)}));
        expect(controller.feed.jobs.value.map((job) => `${job.jobId}:${job.status}`)).toEqual([
            "job-2:waiting",
            "job-1:running",
        ]);

        connection.onEvent(event(5, {type: "jobs_removed", jobIds: ["job-1"]}));
        expect(controller.feed.jobs.value.map((job) => job.jobId)).toEqual(["job-2"]);
        scope.stop();
    });

    it("用创建游标区分 pending、available、删除后的 unavailable，并且无游标不猜测", async () => {
        const transport = createTransport({
            jobs: [],
            eventCursor: {eventEpoch: "epoch-1", after: 5},
        });
        const controller = createAgentJobsFeed(transport);
        const scope = effectScope();
        const jobId = ref("job-causal");
        const cursor = ref<AgentJobEventCursor | null>({eventEpoch: "epoch-1", after: 6});
        const observation = scope.run(() => {
            controller.consume();
            return controller.feed.observe(jobId, cursor);
        })!;
        await flushPromises();

        expect(observation.value).toBe("pending");
        transport.connections[0]!.onEvent(event(6, {type: "job_upserted", job: snapshot("job-causal", "running", 6)}));
        expect(observation.value).toBe("available");
        transport.connections[0]!.onEvent(event(7, {type: "jobs_removed", jobIds: ["job-causal"]}));
        expect(observation.value).toBe("unavailable");

        cursor.value = null;
        expect(observation.value).toBe("pending");
        transport.connections[0]!.onEvent(event(8, {type: "job_upserted", job: snapshot("job-causal", "completed", 6)}));
        expect(observation.value).toBe("available");
        scope.stop();
    });

    it("初始快照可作为跨 epoch 恢复证据，成功后才判定 unavailable", async () => {
        const initial: AgentJobListResponseDto = {
            jobs: [],
            eventCursor: {eventEpoch: "epoch-old", after: 5},
        };
        const transport = createTransport(initial);
        const controller = createAgentJobsFeed(transport);
        const scope = effectScope();
        const observation = scope.run(() => {
            controller.consume();
            return controller.feed.observe(
                ref("job-before-restart"),
                ref({eventEpoch: "epoch-new", after: 1}),
            );
        })!;

        expect(observation.value).toBe("pending");
        await flushPromises();
        expect(transport.loadSnapshot).toHaveBeenCalledOnce();
        expect(observation.value).toBe("unavailable");
        scope.stop();
    });

    it("跨 epoch 切换共用游标的 Job 时为新目标重新取得恢复证据", async () => {
        const response: AgentJobListResponseDto = {
            jobs: [],
            eventCursor: {eventEpoch: "epoch-new", after: 2},
        };
        const transport = createTransport(response);
        const controller = createAgentJobsFeed(transport);
        const scope = effectScope();
        const jobId = ref("job-a");
        const cursor = ref<AgentJobEventCursor | null>({eventEpoch: "epoch-old", after: 8});
        const observation = scope.run(() => {
            controller.consume();
            return controller.feed.observe(jobId, cursor);
        })!;

        await flushPromises();
        expect(observation.value).toBe("unavailable");
        expect(transport.loadSnapshot).toHaveBeenCalledOnce();

        jobId.value = "job-b";
        expect(observation.value).toBe("pending");
        await flushPromises();

        expect(transport.loadSnapshot).toHaveBeenCalledTimes(2);
        expect(observation.value).toBe("unavailable");
        scope.stop();
    });

    it("gap 与 snapshot_required 并发时只执行一次快照恢复", async () => {
        const initial: AgentJobListResponseDto = {
            jobs: [snapshot("job-old", "running", 1)],
            eventCursor: {eventEpoch: "epoch-1", after: 3},
        };
        const recovered: AgentJobListResponseDto = {
            jobs: [snapshot("job-recovered", "waiting", 9)],
            eventCursor: {eventEpoch: "epoch-2", after: 20},
        };
        const transport = createTransport(initial);
        transport.loadSnapshot.mockReset()
            .mockResolvedValueOnce(initial)
            .mockResolvedValueOnce(recovered);
        const controller = createAgentJobsFeed(transport);
        const scope = consume(controller);
        await flushPromises();
        const oldConnection = transport.connections[0]!;

        oldConnection.onEvent(event(5, {type: "job_upserted", job: snapshot("job-gap", "running", 5)}));
        oldConnection.onEvent(event(3, {type: "snapshot_required", reason: "expired"}));
        await flushPromises();

        expect(transport.loadSnapshot).toHaveBeenCalledTimes(2);
        expect(oldConnection.signal.aborted).toBe(true);
        expect(controller.feed.jobs.value.map((job) => job.jobId)).toEqual(["job-recovered"]);
        expect(transport.connections[1]?.cursor).toEqual({eventEpoch: "epoch-2", after: 20});
        scope.stop();
    });

    it("消费者重启后丢弃上一代迟到的快照响应", async () => {
        const stale = deferred<AgentJobListResponseDto>();
        const current: AgentJobListResponseDto = {
            jobs: [snapshot("job-current", "running", 2)],
            eventCursor: {eventEpoch: "epoch-current", after: 8},
        };
        const transport = createTransport(current);
        transport.loadSnapshot.mockReset()
            .mockImplementationOnce(async () => await stale.promise)
            .mockResolvedValueOnce(current);
        const controller = createAgentJobsFeed(transport);

        const enabled = ref(true);
        const scope = consume(controller, enabled);
        await Promise.resolve();
        enabled.value = false;
        enabled.value = true;
        await flushPromises();
        expect(controller.feed.jobs.value.map((job) => job.jobId)).toEqual(["job-current"]);

        stale.resolve({
            jobs: [snapshot("job-stale", "failed", 99)],
            eventCursor: {eventEpoch: "epoch-stale", after: 99},
        });
        await flushPromises();

        expect(controller.feed.jobs.value.map((job) => job.jobId)).toEqual(["job-current"]);
        expect(transport.connections).toHaveLength(1);
        expect(transport.connections[0]?.cursor.eventEpoch).toBe("epoch-current");
        scope.stop();
    });

    it("SSE 断线按 300/800/1500/3000/5000ms 退避并保持 5 秒重试", async () => {
        vi.useFakeTimers();
        const response: AgentJobListResponseDto = {
            jobs: [snapshot("job-trusted", "running", 1)],
            eventCursor: {eventEpoch: "epoch-1", after: 0},
        };
        const stream = vi.fn(async () => {
            throw new Error("offline");
        });
        const transport: AgentJobsFeedTransport = {
            loadSnapshot: vi.fn(async () => response),
            stream,
            clearFinished: vi.fn(async () => 0),
        };
        const controller = createAgentJobsFeed(transport);
        const scope = consume(controller);
        await flushPromises();
        expect(stream).toHaveBeenCalledTimes(1);

        const delays = [300, 800, 1500, 3000, 5000, 5000];
        for (const [index, delay] of delays.entries()) {
            await vi.advanceTimersByTimeAsync(delay - 1);
            expect(stream).toHaveBeenCalledTimes(index + 1);
            await vi.advanceTimersByTimeAsync(1);
            await flushPromises();
            expect(stream).toHaveBeenCalledTimes(index + 2);
            expect(controller.feed.jobs.value.map((job) => job.jobId)).toEqual(["job-trusted"]);
        }
        expect(transport.loadSnapshot).toHaveBeenCalledOnce();
        scope.stop();
    });

    it("SSE 打开后立即正常 EOF 不清零失败序列，并暴露断线错误", async () => {
        vi.useFakeTimers();
        const response: AgentJobListResponseDto = {
            jobs: [snapshot("job-trusted", "running", 1)],
            eventCursor: {eventEpoch: "epoch-1", after: 0},
        };
        const stream = vi.fn(async (
            _cursor: {eventEpoch: string; after: number},
            _signal: AbortSignal,
            _onEvent: (event: AgentJobEventDto) => void,
            onOpen: () => void,
        ) => {
            onOpen();
        });
        const controller = createAgentJobsFeed({
            loadSnapshot: vi.fn(async () => response),
            stream,
            clearFinished: vi.fn(async () => 0),
        });
        const scope = consume(controller);
        await flushPromises();

        expect(controller.feed.error.value).toContain("已断开");
        for (const [index, delay] of [300, 800, 1500, 3000, 5000].entries()) {
            await vi.advanceTimersByTimeAsync(delay);
            await flushPromises();
            expect(stream).toHaveBeenCalledTimes(index + 2);
        }
        scope.stop();
    });

    it("connected 握手发现 epoch 变化时立即恢复快照", async () => {
        const initial: AgentJobListResponseDto = {
            jobs: [snapshot("job-old-epoch", "running", 1)],
            eventCursor: {eventEpoch: "epoch-1", after: 4},
        };
        const recovered: AgentJobListResponseDto = {
            jobs: [snapshot("job-new-epoch", "running", 2)],
            eventCursor: {eventEpoch: "epoch-2", after: 0},
        };
        const transport = createTransport(initial);
        transport.loadSnapshot.mockReset()
            .mockResolvedValueOnce(initial)
            .mockResolvedValueOnce(recovered);
        const controller = createAgentJobsFeed(transport);
        const scope = consume(controller);
        await flushPromises();

        transport.connections[0]!.onEvent({
            eventEpoch: "epoch-2",
            seq: 0,
            event: {type: "connected", eventEpoch: "epoch-2", latestSeq: 0},
        });
        await flushPromises();

        expect(transport.loadSnapshot).toHaveBeenCalledTimes(2);
        expect(controller.feed.jobs.value.map((job) => job.jobId)).toEqual(["job-new-epoch"]);
        expect(transport.connections[1]?.cursor.eventEpoch).toBe("epoch-2");
        scope.stop();
    });

    it("snapshot_required 立即执行一次快照恢复", async () => {
        const initial: AgentJobListResponseDto = {
            jobs: [snapshot("job-before", "running", 1)],
            eventCursor: {eventEpoch: "epoch-1", after: 4},
        };
        const recovered: AgentJobListResponseDto = {
            jobs: [snapshot("job-after", "completed", 1)],
            eventCursor: {eventEpoch: "epoch-1", after: 9},
        };
        const transport = createTransport(initial);
        transport.loadSnapshot.mockReset()
            .mockResolvedValueOnce(initial)
            .mockResolvedValueOnce(recovered);
        const controller = createAgentJobsFeed(transport);
        const scope = consume(controller);
        await flushPromises();

        transport.connections[0]!.onEvent(event(4, {type: "snapshot_required", reason: "expired"}));
        await flushPromises();

        expect(transport.loadSnapshot).toHaveBeenCalledTimes(2);
        expect(controller.feed.jobs.value.map((job) => `${job.jobId}:${job.status}`)).toEqual(["job-after:completed"]);
        scope.stop();
    });

    it("手动刷新与清除已结束各执行一次快照恢复", async () => {
        const initial: AgentJobListResponseDto = {
            jobs: [snapshot("job-1", "completed", 1)],
            eventCursor: {eventEpoch: "epoch-1", after: 1},
        };
        const refreshed: AgentJobListResponseDto = {
            jobs: [snapshot("job-2", "running", 2)],
            eventCursor: {eventEpoch: "epoch-1", after: 2},
        };
        const cleared: AgentJobListResponseDto = {
            jobs: [],
            eventCursor: {eventEpoch: "epoch-1", after: 3},
        };
        const transport = createTransport(initial);
        transport.loadSnapshot.mockReset()
            .mockResolvedValueOnce(initial)
            .mockResolvedValueOnce(refreshed)
            .mockResolvedValueOnce(cleared);
        transport.clearFinished.mockResolvedValueOnce(1);
        const controller = createAgentJobsFeed(transport);
        const scope = consume(controller);
        await flushPromises();

        controller.feed.refresh();
        await flushPromises();
        expect(controller.feed.jobs.value.map((job) => job.jobId)).toEqual(["job-2"]);

        await expect(controller.feed.clearFinished()).resolves.toBe(1);
        expect(controller.feed.jobs.value).toEqual([]);
        expect(transport.loadSnapshot).toHaveBeenCalledTimes(3);
        expect(transport.clearFinished).toHaveBeenCalledOnce();
        scope.stop();
    });
});

type TestConnection = {
    cursor: {eventEpoch: string; after: number};
    signal: AbortSignal;
    onEvent: (event: AgentJobEventDto) => void;
};

/** 在真实 effect scope 内消费 feed，scope.stop() 即生产侧组件卸载。 */
function consume(controller: AgentJobsFeedController, enabled: MaybeRefOrGetter<boolean> = true): EffectScope {
    const scope = effectScope();
    scope.run(() => controller.consume(enabled));
    return scope;
}

/** 创建当前测试 epoch 的 Job envelope。 */
function event(seq: number, payload: AgentJobEventDto["event"]): AgentJobEventDto {
    return {eventEpoch: "epoch-1", seq, event: payload};
}

/** 创建手工完成的 Promise，模拟迟到 HTTP 响应。 */
function deferred<T>(): {promise: Promise<T>; resolve(value: T): void} {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((accept) => {
        resolve = accept;
    });
    return {promise, resolve};
}

/** 创建可控的 SSE transport；连接保持 pending 直到调用方 abort。 */
function createTransport(snapshotResponse: AgentJobListResponseDto) {
    const connections: TestConnection[] = [];
    const loadSnapshot = vi.fn(async (): Promise<AgentJobListResponseDto> => snapshotResponse);
    const transport = {
        connections,
        loadSnapshot,
        clearFinished: vi.fn(async () => 0),
        stream: vi.fn(async (cursor, signal, onEvent, onOpen) => {
            connections.push({cursor, signal, onEvent});
            onOpen();
            await new Promise<void>((resolve) => {
                signal.addEventListener("abort", () => resolve(), {once: true});
            });
        }),
    } satisfies AgentJobsFeedTransport & {connections: TestConnection[]};
    return transport;
}

/** 冲刷 snapshot -> connect 的连续微任务。 */
async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

function snapshot(jobId: string, status: AgentJobSnapshot["status"], createdAt: number): AgentJobSnapshot {
    return {
        jobId,
        kind: "bash",
        title: jobId,
        ownerSessionId: null,
        status,
        deliveryStatus: "not_required",
        createdAt,
        ref: null,
    };
}
