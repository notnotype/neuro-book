import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {readFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {appLogger} from "nbook/server/app-logs/logger";
import type {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {
    AgentJobDurableStore,
    type DurableAgentJobDelivery,
    type DurableAgentJobRecord,
} from "nbook/server/agent/jobs/agent-job-durable-store";
import {
    AgentJobEventHub,
    type AgentJobEventSubscription,
    type PublishedAgentJobEvent,
} from "nbook/server/agent/jobs/agent-job-event-hub";
import type {
    AgentJobDetail,
    AgentJobEventCursor,
    AgentJobKind,
    AgentJobListResponseDto,
    AgentJobSnapshot,
    AgentJobStatus,
    JsonValue,
} from "nbook/shared/dto/agent-job.dto";

export type {AgentJobDetail, AgentJobKind, AgentJobSnapshot, AgentJobStatus} from "nbook/shared/dto/agent-job.dto";

/** kind 专属详情只在 get_job/HTTP 详情入口按需读取，不进入列表快照。 */
export type JobDetailProvider = () => Promise<JsonValue | undefined>;

/** job 执行回调拿到的运行上下文。 */
export type JobRunContext = {
    /** cancel_job 触发；invoke/workflow Agent activity 走 Harness 有界取消，bash 走 owned-process。 */
    signal: AbortSignal;
    /** 更新进行中预览（任务列表/气泡实时可见）。 */
    setPreview(text: string): void;
    /** 标记 job 进入等待人工应答状态（workflow ask 挂起用）；恢复运行时再 setRunning。 */
    setWaiting(text: string): void;
    setRunning(): void;
};

/** job 结束产物：resultPreview 进快照，message 作为回流 follow-up 的完整正文。 */
export type JobOutcome = {
    resultPreview: string;
    /** get_job / 单 Job HTTP 详情返回的完整结构化结果，不做裁剪。 */
    result?: JsonValue;
    /** 回流 follow-up 的完整正文；缺省时由 Manager 用标题和 resultPreview 组装结果卡。 */
    message?: string;
};

/** Job 执行器主动报告取消终态，供底层 Run 被直接取消时保持状态一致。 */
export class AgentJobCancelledError extends Error {
    constructor(message = "后台任务已取消") {
        super(message);
        this.name = "AgentJobCancelledError";
    }
}

export type SpawnJobSpec = {
    kind: AgentJobKind;
    title: string;
    ownerSessionId?: number;
    originToolCallId?: string;
    ref?: JsonValue;
    run: (ctx: JobRunContext) => Promise<JobOutcome>;
    /** kind 专属取消传播钩子（bash=owned-process terminate；workflow=Run signal）。 */
    onCancel?: () => void | Promise<void>;
    /** 缺省：有 owner 则 followup 回流，无则 none。 */
    deliver?: "followup" | "none";
    /** kind 专属详情；Provider 失败不改变执行状态，由详情入口记录为不可用。 */
    detail?: JobDetailProvider;
};

/** Manager 启动结果；游标来自首次 running 快照的实际发布帧。 */
export type SpawnedAgentJob = {
    job: AgentJobSnapshot;
    jobEventCursor: AgentJobEventCursor;
};

/** 旧 jobs.jsonl 的薄登记行；只用于迁移遗留 active Job。 */
type RegistryLine = {
    at: number;
    jobId: string;
    kind: AgentJobKind;
    title: string;
    ownerSessionId: number | null;
    originToolCallId?: string;
    status: AgentJobStatus;
    error?: string;
    deliveryStatus?: AgentJobSnapshot["deliveryStatus"];
    deliveryError?: string;
};

type JobRecord = {
    snapshot: AgentJobSnapshot;
    result?: JsonValue;
    persistedDetail?: JsonValue;
    delivery?: DurableAgentJobDelivery;
    detail?: JobDetailProvider;
    controller?: AbortController;
    promise: Promise<void>;
    spec?: SpawnJobSpec;
};

/**
 * 统一后台任务管理器。
 *
 * Durable truth 位于 `<Workspace Root>/.nbook/agent/jobs/<jobId>.json`：
 * - 列表只在内存保留公开 snapshot；完整 result/detail 按需读取单 Job 文件；
 * - terminal snapshot、完整结果、详情、回流正文与稳定 ID 在一次原子 commit 中发布；
 * - 结果回流写入 Harness 现有 durable follow-up queue，accepted 不等待 Provider 回合完成；
 * - 旧 jobs.jsonl 不再追加，只把遗留 running/waiting 迁移为 interrupted。
 */
export class AgentJobManager {
    private readonly jobs = new Map<string, JobRecord>();
    private readonly events = new AgentJobEventHub();
    private readonly previewTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly durableStore: AgentJobDurableStore;
    /** 所有 durable 写按调用顺序串行；失败不会毒化后续写。 */
    private persistQueue: Promise<void> = Promise.resolve();
    /** clearFinished 移除后仍可能有极短的 promise 收尾；waitIdle 继续等待。 */
    private removedSettle: Promise<void> = Promise.resolve();
    private recoveryRun: Promise<void> | null = null;
    private shuttingDown = false;

    constructor(
        /** 延迟取 harness：Manager 在 harness 构造期创建，回流时才解引用。 */
        private readonly harness: () => NeuroAgentHarness,
        /** 旧登记表路径；同目录 `jobs/` 是新 durable store。空字符串关闭持久化。 */
        private readonly registryPath: string,
        durableStore?: AgentJobDurableStore,
    ) {
        this.durableStore = durableStore
            ?? new AgentJobDurableStore(registryPath ? join(dirname(registryPath), "jobs") : "");
    }

    /** 启动一个后台 job：内存登记、首次快照发布、durable running 写入和后台执行。 */
    spawn(spec: SpawnJobSpec): SpawnedAgentJob {
        if (this.shuttingDown) {
            throw new Error("Agent Job Manager 已关闭，不能启动新任务");
        }
        const deliver = spec.deliver ?? (spec.ownerSessionId === undefined ? "none" : "followup");
        const deliveryRequired = deliver === "followup" && spec.ownerSessionId !== undefined;
        const snapshot: AgentJobSnapshot = {
            jobId: `job_${randomUUID().slice(0, 8)}`,
            kind: spec.kind,
            title: spec.title,
            ownerSessionId: spec.ownerSessionId ?? null,
            originToolCallId: spec.originToolCallId,
            status: "running",
            deliveryStatus: deliveryRequired ? "pending" : "not_required",
            createdAt: Date.now(),
            ref: spec.ref ?? null,
        };
        const record: JobRecord = {
            snapshot,
            controller: new AbortController(),
            spec,
            detail: spec.detail,
            promise: Promise.resolve(),
            ...(deliveryRequired ? {
                delivery: {
                    deliveryId: randomUUID(),
                    clientMessageId: randomUUID(),
                },
            } : {}),
        };
        this.jobs.set(snapshot.jobId, record);
        const createdEvent = this.publishSnapshot(record);
        if (!createdEvent || createdEvent.payload.event.type !== "job_upserted") {
            this.jobs.delete(snapshot.jobId);
            throw new Error("Agent Job 创建事件未发布");
        }
        this.persistBestEffort(record, "spawn");
        record.promise = this.execute(record);
        return {
            job: {...snapshot},
            jobEventCursor: {
                eventEpoch: createdEvent.payload.eventEpoch,
                after: createdEvent.payload.seq,
            },
        };
    }

    /** 原子读取过滤后的任务列表与对应事件恢复游标。 */
    recovery(filter?: {ownerSessionId?: number; status?: AgentJobStatus}): AgentJobListResponseDto {
        return {jobs: this.list(filter), eventCursor: this.events.cursor()};
    }

    /** 从恢复游标订阅全局 Job 事件。 */
    subscribeEvents(cursor: Partial<AgentJobEventCursor> = {}): AgentJobEventSubscription {
        return this.events.subscribe(cursor);
    }

    list(filter?: {ownerSessionId?: number; status?: AgentJobStatus}): AgentJobSnapshot[] {
        return [...this.jobs.values()]
            .map((record) => ({...record.snapshot}))
            .filter((job) => (filter?.ownerSessionId === undefined || job.ownerSessionId === filter.ownerSessionId)
                && (filter?.status === undefined || job.status === filter.status))
            .sort((a, b) => b.createdAt - a.createdAt);
    }

    async get(jobId: string): Promise<AgentJobDetail | null> {
        const record = this.jobs.get(jobId);
        if (!record) return null;

        const durable = isTerminal(record.snapshot.status)
            ? await this.readDurableRecord(jobId)
            : null;
        let detail = durable?.detail ?? record.persistedDetail;
        if (detail === undefined && record.detail) {
            detail = await this.resolveDetail(record);
        }
        const result = durable?.result ?? record.result;
        return {
            ...record.snapshot,
            ...(result === undefined ? {} : {result}),
            ...(detail === undefined ? {} : {detail}),
        };
    }

    /** 请求取消：置 abort 信号 + 调用 kind 专属钩子；实际状态翻转由执行路径收尾时落。 */
    async cancel(jobId: string): Promise<AgentJobSnapshot> {
        const record = this.jobs.get(jobId);
        if (!record) throw new Error(`job ${jobId} 不存在`);
        if (record.snapshot.status !== "running" && record.snapshot.status !== "waiting") {
            return {...record.snapshot};
        }
        if (!record.controller || !record.spec) {
            throw new Error(`job ${jobId} 缺少当前进程执行上下文`);
        }
        record.controller.abort();
        try {
            await record.spec.onCancel?.();
        } catch (error) {
            void appLogger.warn("agent.jobs.cancelHookFailed", {
                jobId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
        return {...record.snapshot};
    }

    /** harness.close 统一等待：所有 live Job、结果入队与 durable 写入都落定。 */
    async waitIdle(): Promise<void> {
        const waited = new Set<Promise<void>>();
        while (true) {
            const pending = [...this.jobs.values()]
                .map((record) => record.promise)
                .filter((promise) => !waited.has(promise));
            if (pending.length === 0) break;
            for (const promise of pending) waited.add(promise);
            await Promise.allSettled(pending);
        }
        await this.removedSettle;
        await this.persistQueue;
    }

    /**
     * 删除 durable 已结束历史；deliveryStatus=pending 的 Job 必须保留到可靠入队完成。
     */
    async clearFinished(): Promise<number> {
        const removedJobIds: string[] = [];
        for (const [jobId, record] of [...this.jobs]) {
            if (!isTerminal(record.snapshot.status) || record.snapshot.deliveryStatus === "pending") {
                continue;
            }
            try {
                await this.durableStore.delete(jobId);
            } catch (error) {
                void appLogger.warn("agent.jobs.clearDurableFailed", {
                    jobId,
                    error: error instanceof Error ? error.message : String(error),
                });
                continue;
            }
            this.jobs.delete(jobId);
            this.removedSettle = Promise.allSettled([this.removedSettle, record.promise]).then(() => {});
            removedJobIds.push(jobId);
        }
        if (removedJobIds.length > 0 && !this.shuttingDown) {
            this.events.publish({type: "jobs_removed", jobIds: removedJobIds});
        }
        return removedJobIds.length;
    }

    /** 取消所有仍活跃的当前进程 Job；历史记录不会进入此路径。 */
    async cancelActive(): Promise<void> {
        const active = [...this.jobs.values()]
            .filter((record) => (record.snapshot.status === "running" || record.snapshot.status === "waiting")
                && record.controller !== undefined)
            .map((record) => record.snapshot.jobId);
        await Promise.all(active.map((jobId) => this.cancel(jobId)));
    }

    /** 停服收口：取消活跃任务，等待执行与 durable 写入；pending 回流留给下次启动幂等恢复。 */
    async shutdown(): Promise<void> {
        this.shuttingDown = true;
        this.events.close();
        for (const timer of this.previewTimers.values()) clearTimeout(timer);
        this.previewTimers.clear();
        await this.cancelActive();
        await this.waitIdle();
    }

    /**
     * 启动恢复：
     * - 新 durable store 的全部历史重新进入列表；
     * - running/waiting 转为 interrupted；
     * - terminal pending 使用稳定 deliveryId/clientMessageId 幂等重投；
     * - 旧 jobs.jsonl 只迁移遗留 active 行，不伪造历史终态结果。
     */
    async recoverInterrupted(): Promise<void> {
        if (!this.recoveryRun) {
            this.recoveryRun = this.recoverDurableState();
        }
        await this.recoveryRun;
    }

    private async recoverDurableState(): Promise<void> {
        await this.persistQueue;
        const durableJobIds = await this.durableStore.listJobIds();
        for (const jobId of durableJobIds) {
            if (this.jobs.has(jobId)) {
                continue;
            }
            const durable = await this.readDurableRecord(jobId);
            if (!durable) {
                continue;
            }
            const record = this.recordFromDurable(durable);
            if (record.snapshot.status === "running" || record.snapshot.status === "waiting") {
                this.interruptRecoveredRecord(record);
                await this.persistRequired(record);
            }
            this.jobs.set(jobId, record);
            this.publishSnapshot(record);
            if (record.snapshot.deliveryStatus === "pending") {
                await this.deliverPending(record);
            } else if (record.snapshot.deliveryStatus === "accepted"
                && record.delivery?.acceptedState === "queued") {
                await this.resumeAcceptedDelivery(record);
            }
        }
        await this.migrateLegacyActiveJobs(new Set(durableJobIds));
    }

    private async migrateLegacyActiveJobs(existingJobIds: Set<string>): Promise<void> {
        if (!this.registryPath || !existsSync(this.registryPath)) {
            return;
        }
        const lines = (await readFile(this.registryPath, "utf8")).split(/\r?\n/u).filter(Boolean);
        const firstAt = new Map<string, number>();
        const last = new Map<string, RegistryLine>();
        for (const line of lines) {
            try {
                const parsed = JSON.parse(line) as RegistryLine;
                firstAt.set(parsed.jobId, Math.min(firstAt.get(parsed.jobId) ?? parsed.at, parsed.at));
                last.set(parsed.jobId, parsed);
            } catch {
                // 旧登记表只作为迁移输入；损坏行无法安全恢复，保留原文件供人工审计。
            }
        }
        for (const entry of last.values()) {
            if ((entry.status !== "running" && entry.status !== "waiting")
                || existingJobIds.has(entry.jobId)
                || this.jobs.has(entry.jobId)) {
                continue;
            }
            const deliveryRequired = entry.deliveryStatus === "pending"
                || (entry.deliveryStatus === undefined && entry.ownerSessionId !== null);
            const record: JobRecord = {
                snapshot: {
                    jobId: entry.jobId,
                    kind: entry.kind,
                    title: entry.title,
                    ownerSessionId: entry.ownerSessionId,
                    originToolCallId: entry.originToolCallId,
                    status: "interrupted",
                    createdAt: firstAt.get(entry.jobId) ?? entry.at,
                    endedAt: Date.now(),
                    ref: null,
                    error: "进程重启，后台任务丢失",
                    deliveryStatus: deliveryRequired ? "pending" : "not_required",
                },
                promise: Promise.resolve(),
                ...(deliveryRequired ? {
                    delivery: {
                        deliveryId: randomUUID(),
                        clientMessageId: randomUUID(),
                        message: interruptedDeliveryMessage(entry.title, entry.jobId),
                    },
                } : {}),
            };
            await this.persistRequired(record);
            this.jobs.set(entry.jobId, record);
            this.publishSnapshot(record);
            if (record.snapshot.deliveryStatus === "pending") {
                await this.deliverPending(record);
            }
        }
    }

    private async execute(record: JobRecord): Promise<void> {
        const {snapshot, spec, controller} = record;
        if (!spec || !controller) {
            throw new Error(`live Job ${snapshot.jobId} 缺少执行上下文`);
        }
        const ctx: JobRunContext = {
            signal: controller.signal,
            setPreview: (text) => {
                snapshot.preview = clip(text, 400);
                this.schedulePreview(record);
            },
            setWaiting: (text) => {
                snapshot.status = "waiting";
                snapshot.preview = clip(text, 400);
                this.cancelPreview(record);
                this.publishSnapshot(record);
                this.persistBestEffort(record, "waiting");
            },
            setRunning: () => {
                snapshot.status = "running";
                this.cancelPreview(record);
                this.publishSnapshot(record);
                this.persistBestEffort(record, "running");
            },
        };

        let outcome: JobOutcome | null = null;
        let failure: string | null = null;
        try {
            outcome = await spec.run(ctx);
        } catch (error) {
            failure = error instanceof Error ? error.message : String(error);
            if (error instanceof AgentJobCancelledError) {
                controller.abort();
            }
        }

        const terminalSnapshot: AgentJobSnapshot = {
            ...snapshot,
            endedAt: Date.now(),
        };
        let result: JsonValue | undefined;
        if (controller.signal.aborted) {
            terminalSnapshot.status = "cancelled";
            terminalSnapshot.error = failure ?? undefined;
        } else if (failure !== null) {
            terminalSnapshot.status = "failed";
            terminalSnapshot.error = failure;
        } else {
            terminalSnapshot.status = "completed";
            terminalSnapshot.preview = clip(outcome!.resultPreview, 400);
            result = outcome!.result;
        }
        const persistedDetail = await this.resolveDetail(record);
        const delivery = record.delivery
            ? {...record.delivery}
            : undefined;
        if (terminalSnapshot.deliveryStatus === "pending" && delivery) {
            delivery.message = resultDeliveryMessage(terminalSnapshot, outcome, failure);
        }
        this.cancelPreview(record);

        if (!await this.commitTerminal(record, {
            schemaVersion: 1,
            snapshot: terminalSnapshot,
            ...(result === undefined ? {} : {result}),
            ...(persistedDetail === undefined ? {} : {detail: persistedDetail}),
            ...(delivery === undefined ? {} : {delivery}),
        })) {
            return;
        }
        await this.deliverPending(record);
    }

    /** terminal 完整 truth 必须先 durable commit，成功后才进入列表/SSE 公共终态。 */
    private async commitTerminal(record: JobRecord, terminal: DurableAgentJobRecord): Promise<boolean> {
        try {
            await this.persistDurable(terminal);
        } catch (error) {
            const message = `后台任务结果持久化失败：${error instanceof Error ? error.message : String(error)}`;
            const failed: DurableAgentJobRecord = {
                schemaVersion: 1,
                snapshot: {
                    ...terminal.snapshot,
                    status: "failed",
                    error: message,
                    deliveryStatus: terminal.delivery ? "failed" : "not_required",
                    deliveryError: terminal.delivery ? message : undefined,
                },
            };
            await this.persistDurable(failed).catch((persistError) => {
                void appLogger.error("agent.jobs.terminalPersistFailed", {
                    jobId: terminal.snapshot.jobId,
                    error: persistError instanceof Error ? persistError.message : String(persistError),
                }, persistError, "Agent Job terminal durable commit 失败");
            });
            this.applyDurableRecord(record, failed);
            this.publishSnapshot(record);
            return false;
        }
        this.applyDurableRecord(record, terminal);
        this.publishSnapshot(record);
        return true;
    }

    /**
     * 结果回流只把稳定系统 follow-up 写入 Session durable queue。
     * accepted 不等待 Provider 回合完成；重启通过 queue item/sourceQueueItemId 幂等确认。
     */
    private async deliverPending(record: JobRecord): Promise<void> {
        const {snapshot, delivery} = record;
        if (snapshot.deliveryStatus !== "pending") {
            return;
        }
        if (this.shuttingDown) {
            return;
        }
        if (snapshot.ownerSessionId === null || !delivery?.message) {
            await this.trySetDeliveryFailed(record, "Job 缺少可靠结果回流正文或 owner Session");
            return;
        }
        try {
            const admission = await this.harness().enqueueDurableSystemFollowUp({
                sessionId: snapshot.ownerSessionId,
                text: delivery.message,
                deliveryId: delivery.deliveryId,
                clientMessageId: delivery.clientMessageId,
            });
            const previousAcceptedState = delivery.acceptedState;
            delivery.acceptedState = admission.state;
            try {
                await this.setDeliveryStatus(record, "accepted");
            } catch (error) {
                delivery.acceptedState = previousAcceptedState;
                throw error;
            }
        } catch (error) {
            if (this.shuttingDown) {
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            await this.trySetDeliveryFailed(record, message);
            void appLogger.error("agent.jobs.deliverFailed", {
                jobId: snapshot.jobId,
                ownerSessionId: snapshot.ownerSessionId,
                deliveryError: message,
            }, error, "后台任务结果进入 Session durable queue 失败");
        }
    }

    /** accepted=queued 时，重启只重新触发现有 durable queue 的 drain，不重复写消息。 */
    private async resumeAcceptedDelivery(record: JobRecord): Promise<void> {
        const {snapshot, delivery} = record;
        if (this.shuttingDown || snapshot.ownerSessionId === null || !delivery?.message) {
            return;
        }
        try {
            const admission = await this.harness().enqueueDurableSystemFollowUp({
                sessionId: snapshot.ownerSessionId,
                text: delivery.message,
                deliveryId: delivery.deliveryId,
                clientMessageId: delivery.clientMessageId,
            });
            if (admission.state === "persisted") {
                delivery.acceptedState = "persisted";
                await this.persistRequired(record);
            }
        } catch (error) {
            void appLogger.warn("agent.jobs.acceptedDeliveryResumeFailed", {
                jobId: snapshot.jobId,
                ownerSessionId: snapshot.ownerSessionId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private async trySetDeliveryFailed(record: JobRecord, message: string): Promise<void> {
        await this.setDeliveryStatus(record, "failed", message).catch((error) => {
            void appLogger.error("agent.jobs.deliveryStatusPersistFailed", {
                jobId: record.snapshot.jobId,
                deliveryError: message,
                persistError: error instanceof Error ? error.message : String(error),
            }, error, "Agent Job delivery failed 状态持久化失败");
        });
    }

    /** delivery 状态先 durable commit，再发布列表/SSE；失败时恢复旧内存快照。 */
    private async setDeliveryStatus(
        record: JobRecord,
        status: AgentJobSnapshot["deliveryStatus"],
        error?: string,
    ): Promise<void> {
        const durable = this.toDurableRecord(record);
        durable.snapshot = {
            ...durable.snapshot,
            deliveryStatus: status,
            deliveryError: error,
        };
        await this.persistDurable(durable);
        this.applyDurableRecord(record, durable);
        this.publishSnapshot(record);
    }

    private async resolveDetail(record: JobRecord): Promise<JsonValue | undefined> {
        if (!record.detail) {
            return record.persistedDetail;
        }
        try {
            return await record.detail();
        } catch (error) {
            void appLogger.warn("agent.jobs.detailUnavailable", {
                jobId: record.snapshot.jobId,
                error: error instanceof Error ? error.message : String(error),
            });
            return record.persistedDetail;
        }
    }

    private recordFromDurable(durable: DurableAgentJobRecord): JobRecord {
        const active = durable.snapshot.status === "running" || durable.snapshot.status === "waiting";
        const deliveryMutable = durable.snapshot.deliveryStatus === "pending"
            || (durable.snapshot.deliveryStatus === "accepted" && durable.delivery?.acceptedState === "queued");
        const retainPayload = active || deliveryMutable;
        return {
            snapshot: {...durable.snapshot},
            ...(retainPayload && durable.result !== undefined ? {result: durable.result} : {}),
            ...(retainPayload && durable.detail !== undefined ? {persistedDetail: durable.detail} : {}),
            ...(deliveryMutable && durable.delivery ? {delivery: {...durable.delivery}} : {}),
            promise: Promise.resolve(),
        };
    }

    private applyDurableRecord(record: JobRecord, durable: DurableAgentJobRecord): void {
        record.snapshot = {...durable.snapshot};
        record.result = durable.result;
        record.persistedDetail = durable.detail;
        record.delivery = durable.delivery ? {...durable.delivery} : undefined;
    }

    private interruptRecoveredRecord(record: JobRecord): void {
        record.snapshot.status = "interrupted";
        record.snapshot.endedAt = Date.now();
        record.snapshot.error = "进程重启，后台任务丢失";
        const deliveryRequired = record.snapshot.ownerSessionId !== null
            && record.snapshot.deliveryStatus !== "not_required";
        record.snapshot.deliveryStatus = deliveryRequired ? "pending" : "not_required";
        record.snapshot.deliveryError = undefined;
        record.result = undefined;
        record.persistedDetail = undefined;
        record.delivery = deliveryRequired
            ? {
                deliveryId: record.delivery?.deliveryId ?? randomUUID(),
                clientMessageId: record.delivery?.clientMessageId ?? randomUUID(),
                message: interruptedDeliveryMessage(record.snapshot.title, record.snapshot.jobId),
            }
            : undefined;
    }

    private async readDurableRecord(jobId: string): Promise<DurableAgentJobRecord | null> {
        try {
            return await this.durableStore.read(jobId);
        } catch (error) {
            let quarantinedPath: string | null = null;
            try {
                quarantinedPath = await this.durableStore.quarantine(jobId);
            } catch (quarantineError) {
                void appLogger.warn("agent.jobs.durableQuarantineFailed", {
                    jobId,
                    error: quarantineError instanceof Error ? quarantineError.message : String(quarantineError),
                });
            }
            void appLogger.warn("agent.jobs.detailDurableReadFailed", {
                jobId,
                error: error instanceof Error ? error.message : String(error),
                ...(quarantinedPath === null ? {} : {quarantinedPath}),
            });
            return null;
        }
    }

    private persistBestEffort(record: JobRecord, phase: string): void {
        void this.persistRequired(record).catch((error) => {
            void appLogger.warn("agent.jobs.persistFailed", {
                jobId: record.snapshot.jobId,
                phase,
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }

    private async persistRequired(record: JobRecord): Promise<void> {
        await this.persistDurable(this.toDurableRecord(record));
    }

    private async persistDurable(record: DurableAgentJobRecord): Promise<void> {
        const durable = structuredClone(record);
        const operation = this.persistQueue.then(() => this.durableStore.write(durable));
        this.persistQueue = operation.catch(() => undefined);
        await operation;
    }

    private toDurableRecord(record: JobRecord): DurableAgentJobRecord {
        return {
            schemaVersion: 1,
            snapshot: {...record.snapshot},
            ...(record.result === undefined ? {} : {result: record.result}),
            ...(record.persistedDetail === undefined ? {} : {detail: record.persistedDetail}),
            ...(record.delivery === undefined ? {} : {delivery: {...record.delivery}}),
        };
    }

    /** 合并高频 preview，只在最后一次更新静默 250ms 后发布。 */
    private schedulePreview(record: JobRecord): void {
        if (this.shuttingDown) return;
        const jobId = record.snapshot.jobId;
        const pending = this.previewTimers.get(jobId);
        if (pending) clearTimeout(pending);
        this.previewTimers.set(jobId, setTimeout(() => {
            this.previewTimers.delete(jobId);
            this.publishSnapshot(record);
        }, 250));
    }

    /** 取消尚未发布的 preview，供离散状态变化抢先发布最新快照。 */
    private cancelPreview(record: JobRecord): void {
        const pending = this.previewTimers.get(record.snapshot.jobId);
        if (!pending) return;
        clearTimeout(pending);
        this.previewTimers.delete(record.snapshot.jobId);
    }

    /** 发布 detached Job 快照；shutdown 后的迟到状态变化不再进入事件流。 */
    private publishSnapshot(record: JobRecord): PublishedAgentJobEvent | null {
        if (this.shuttingDown || this.jobs.get(record.snapshot.jobId) !== record) return null;
        return this.events.publish({type: "job_upserted", job: {...record.snapshot}});
    }
}

function isTerminal(status: AgentJobStatus): boolean {
    return status !== "running" && status !== "waiting";
}

function resultDeliveryMessage(
    snapshot: AgentJobSnapshot,
    outcome: JobOutcome | null,
    failure: string | null,
): string {
    const header = snapshot.status === "completed"
        ? `[后台任务完成] ${snapshot.title}（${snapshot.jobId}）`
        : snapshot.status === "cancelled"
            ? `[后台任务已取消] ${snapshot.title}（${snapshot.jobId}）`
            : `[后台任务失败] ${snapshot.title}（${snapshot.jobId}）：${failure ?? "未知错误"}`;
    const content = snapshot.status === "completed" && outcome?.message
        ? outcome.message
        : [header, snapshot.status === "completed" ? outcome?.resultPreview ?? "" : ""].filter(Boolean).join("\n");
    return [
        "<system-reminder>",
        content,
        "</system-reminder>",
    ].join("\n");
}

function interruptedDeliveryMessage(title: string, jobId: string): string {
    return [
        "<system-reminder>",
        `[后台任务中断] ${title}（${jobId}）`,
        "服务重启导致该后台任务丢失，未能产出结果。如仍需要请重新发起。",
        "</system-reminder>",
    ].join("\n");
}

function clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
}
