import {existsSync} from "node:fs";
import {appendFile, mkdir, readFile} from "node:fs/promises";
import {dirname} from "node:path";
import {randomUUID} from "node:crypto";
import {appLogger} from "nbook/server/app-logs/logger";
import type {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
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
import type {AgentInvocationResult} from "nbook/server/agent/harness/types";

export type {AgentJobDetail, AgentJobKind, AgentJobSnapshot, AgentJobStatus} from "nbook/shared/dto/agent-job.dto";

/** kind 专属详情只在 get_job/HTTP 详情入口按需读取，不进入列表快照。 */
export type JobDetailProvider = () => Promise<JsonValue | undefined>;

/** job 执行回调拿到的运行上下文 */
export type JobRunContext = {
    /** cancel_job 触发；invoke/workflow Agent activity 走 Harness 有界取消，bash 走 owned-process。 */
    signal: AbortSignal;
    /** 更新进行中预览（任务列表/气泡实时可见） */
    setPreview(text: string): void;
    /** 标记 job 进入等待人工应答状态（workflow ask 挂起用）；恢复运行时再 setRunning */
    setWaiting(text: string): void;
    setRunning(): void;
};

/** job 结束产物：resultPreview 进快照，message 作为回流 followup 的完整正文 */
export type JobOutcome = {
    resultPreview: string;
    /** get_job / 单 Job HTTP 详情返回的完整结构化结果，不做裁剪。 */
    result?: JsonValue;
    /** 回流 followup 的完整正文；缺省时由 Manager 用标题和 resultPreview 组装结果卡。 */
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
    /** 缺省：有 owner 则 followup 回流，无则 none */
    deliver?: "followup" | "none";
    /** kind 专属详情；Provider 失败不改变执行状态，由详情入口记录为不可用。 */
    detail?: JobDetailProvider;
};

/** Manager 启动结果；游标来自首次 running 快照的实际发布帧。 */
export type SpawnedAgentJob = {
    job: AgentJobSnapshot;
    jobEventCursor: AgentJobEventCursor;
};

/** 登记表行（append-only 状态翻转；不存观测载荷） */
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
    /** 仅详情面消费；不进入 list() 投影与薄登记表。 */
    result?: JsonValue;
    detail?: JobDetailProvider;
    controller: AbortController;
    promise: Promise<void>;
    spec: SpawnJobSpec;
};

/**
 * 统一后台任务管理器（Task 111 PLAN-E）。
 *
 * Job = 有身份、有状态机、有观测面、有回流策略的后台工作单元：
 * - 回流走 harness invokeAgent(mode:"prompt")：owner 空闲立即触发一轮、忙时自动进 followup 队列；
 *   回流只带 message 文本（结果卡），不带 payload——payload 会撞 owner profile 的 PayloadSchema 校验，
 *   完整数据让 agent 用 get_job / workflow runs API 查询；
 * - 崩溃恢复：jobs.jsonl 薄登记表（只记身份与状态翻转），启动扫描把 running/waiting 标 interrupted
 *   并给 owner 补发中断通知——「重启丢回流」从静默变显式；
 * - 观测：HTTP 原子恢复快照 + 全局 Jobs SSE；完整 result 仍按 Job 详情读取。
 */
export class AgentJobManager {
    private readonly jobs = new Map<string, JobRecord>();
    private readonly events = new AgentJobEventHub();
    /** bash 输出 preview 采用每 Job 独立的 250ms 尾沿合并。 */
    private readonly previewTimers = new Map<string, ReturnType<typeof setTimeout>>();
    /** jobs.jsonl 必须保持状态翻转顺序，避免迟到的 running 行覆盖 terminal 行。 */
    private persistQueue: Promise<void> = Promise.resolve();
    /** clearFinished 移除的条目若回流投递仍在途，其 promise 挂在此链上，waitIdle 仍会等它。 */
    private removedSettle: Promise<void> = Promise.resolve();
    /** 结果回流属于 Job 的收尾边界；停服时必须能取消在途的 owner invocation。 */
    private readonly deliveryController = new AbortController();
    /** shutdown 开始后不再启动新的结果回流 invocation。 */
    private shuttingDown = false;

    constructor(
        /** 延迟取 harness：Manager 在 harness 构造期创建，回流时才解引用 */
        private readonly harness: () => NeuroAgentHarness,
        /** 登记表路径（<workspaceRoot>/.nbook/agent/jobs.jsonl）；空字符串 = 关闭持久化（隔离测试用） */
        private readonly registryPath: string,
    ) {}

    /** 启动一个后台 job：登记 + 落盘 + 后台执行 + settle 回流 */
    spawn(spec: SpawnJobSpec): SpawnedAgentJob {
        if (this.shuttingDown) {
            throw new Error("Agent Job Manager 已关闭，不能启动新任务");
        }
        const delivery = spec.deliver ?? (spec.ownerSessionId === undefined ? "none" : "followup");
        const snapshot: AgentJobSnapshot = {
            jobId: `job_${randomUUID().slice(0, 8)}`,
            kind: spec.kind,
            title: spec.title,
            ownerSessionId: spec.ownerSessionId ?? null,
            originToolCallId: spec.originToolCallId,
            status: "running",
            deliveryStatus: delivery === "none" || spec.ownerSessionId === undefined ? "not_required" : "pending",
            createdAt: Date.now(),
            ref: spec.ref ?? null,
        };
        const controller = new AbortController();
        const record: JobRecord = {snapshot, controller, spec, detail: spec.detail, promise: Promise.resolve()};
        this.jobs.set(snapshot.jobId, record);
        const createdEvent = this.publishSnapshot(record);
        if (!createdEvent || createdEvent.payload.event.type !== "job_upserted") {
            this.jobs.delete(snapshot.jobId);
            throw new Error("Agent Job 创建事件未发布");
        }
        void this.persist(snapshot);
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
        let detail: JsonValue | undefined;
        if (record.detail) {
            try {
                detail = await record.detail();
            } catch (error) {
                void appLogger.warn("agent.jobs.detailUnavailable", {
                    jobId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        return {
            ...record.snapshot,
            ...(record.result === undefined ? {} : {result: record.result}),
            ...(detail === undefined ? {} : {detail}),
        };
    }

    /** 请求取消：置 abort 信号 + 调用 kind 专属钩子；实际状态翻转由执行路径收尾时落 */
    async cancel(jobId: string): Promise<AgentJobSnapshot> {
        const record = this.jobs.get(jobId);
        if (!record) throw new Error(`job ${jobId} 不存在`);
        if (record.snapshot.status !== "running" && record.snapshot.status !== "waiting") {
            return {...record.snapshot};
        }
        record.controller.abort();
        try {
            await record.spec.onCancel?.();
        } catch (error) {
            void appLogger.warn("agent.jobs.cancelHookFailed", {jobId, error: error instanceof Error ? error.message : String(error)});
        }
        return {...record.snapshot};
    }

    /** harness.close 统一等待：所有 job 落定（含回流完成） */
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
    }

    /**
     * 清除内存中的已结束任务（任务中心「清除已结束」按钮）；返回清除数量。
     * 仅内存回收——jobs.jsonl 登记表是 append-only 审计面，不受影响。
     */
    clearFinished(): number {
        const removedJobIds: string[] = [];
        for (const [jobId, record] of this.jobs) {
            const status = record.snapshot.status;
            if (status === "running" || status === "waiting") continue;
            this.jobs.delete(jobId);
            // 终态翻转发生在回流投递之前：被清条目可能仍有在途 followup，保住 waitIdle 合同
            this.removedSettle = Promise.allSettled([this.removedSettle, record.promise]).then(() => {});
            removedJobIds.push(jobId);
        }
        if (removedJobIds.length > 0 && !this.shuttingDown) {
            this.events.publish({type: "jobs_removed", jobIds: removedJobIds});
        }
        return removedJobIds.length;
    }

    /** 取消所有仍活跃的 Job；Harness dispose 用它解除 waiting Job。 */
    async cancelActive(): Promise<void> {
        const active = [...this.jobs.values()]
            .filter((record) => record.snapshot.status === "running" || record.snapshot.status === "waiting")
            .map((record) => record.snapshot.jobId);
        await Promise.all(active.map((jobId) => this.cancel(jobId)));
    }

    /** 停服收口：先取消活跃任务，再等待执行、结果投递和登记表写入全部完成。 */
    async shutdown(): Promise<void> {
        this.shuttingDown = true;
        this.events.close();
        for (const timer of this.previewTimers.values()) clearTimeout(timer);
        this.previewTimers.clear();
        this.deliveryController.abort(new Error("agent job manager shutdown"));
        await this.cancelActive();
        await this.waitIdle();
        await this.persistQueue;
    }

    /**
     * 启动恢复：把上次进程留下的 running/waiting job 标 interrupted，并给 owner 补发中断通知。
     * 由 harness 构造尾部 fire-and-forget 调用（与 profile bootSweep 同模式）。
     */
    async recoverInterrupted(): Promise<void> {
        if (!this.registryPath || !existsSync(this.registryPath)) return;
        await this.persistQueue;
        const lines = (await readFile(this.registryPath, "utf8")).split("\n").filter(Boolean);
        const last = new Map<string, RegistryLine>();
        for (const line of lines) {
            try {
                const parsed = JSON.parse(line) as RegistryLine;
                last.set(parsed.jobId, parsed);
            } catch {
                // 损坏行跳过：登记表是尽力而为的恢复面，不是 truth
            }
        }
        for (const entry of last.values()) {
            if (entry.status !== "running" && entry.status !== "waiting") continue;
            const interrupted: RegistryLine = {...entry, at: Date.now(), status: "interrupted", error: "进程重启，后台任务丢失"};
            const needsDelivery = entry.deliveryStatus === "pending" || (entry.deliveryStatus === undefined && entry.ownerSessionId !== null);
            interrupted.deliveryStatus = needsDelivery ? "pending" : "not_required";
            await this.persistLine(interrupted);
            if (entry.ownerSessionId !== null && needsDelivery) {
                try {
                    const result = await this.sendFollowup(entry.ownerSessionId, [
                        `[后台任务中断] ${entry.title}（${entry.jobId}）`,
                        "服务重启导致该后台任务丢失，未能产出结果。如仍需要请重新发起。",
                    ].join("\n"));
                    if (result.status === "error") {
                        await this.persistLine({...interrupted, deliveryStatus: "failed", deliveryError: result.error ?? "owner invocation 返回 error"});
                    } else {
                        await this.persistLine({...interrupted, deliveryStatus: "accepted", deliveryError: undefined});
                    }
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    void appLogger.error("agent.jobs.recoverDeliveryFailed", {
                        jobId: entry.jobId,
                        ownerSessionId: entry.ownerSessionId,
                        error: message,
                    }, error, "后台任务中断通知回流失败");
                    await this.persistLine({...interrupted, deliveryStatus: "failed", deliveryError: message});
                }
            }
        }
    }

    private async execute(record: JobRecord): Promise<void> {
        const {snapshot, spec, controller} = record;
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
                void this.persist(snapshot);
            },
            setRunning: () => {
                snapshot.status = "running";
                this.cancelPreview(record);
                this.publishSnapshot(record);
                void this.persist(snapshot);
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
        snapshot.endedAt = Date.now();
        if (controller.signal.aborted) {
            snapshot.status = "cancelled";
            snapshot.error = failure ?? undefined;
        } else if (failure !== null) {
            snapshot.status = "failed";
            snapshot.error = failure;
        } else {
            snapshot.status = "completed";
            snapshot.preview = clip(outcome!.resultPreview, 400);
            record.result = outcome!.result;
        }
        this.cancelPreview(record);
        this.publishSnapshot(record);
        await this.persist(snapshot);
        await this.deliverResult(record, outcome, failure);
    }

    /** settle 回流：完成/失败/取消都告知 owner（agent 读到结果卡后向用户汇报或继续编排） */
    private async deliverResult(record: JobRecord, outcome: JobOutcome | null, failure: string | null): Promise<void> {
        const {snapshot, spec} = record;
        const deliver = spec.deliver ?? (snapshot.ownerSessionId !== null ? "followup" : "none");
        if (deliver === "none" || snapshot.ownerSessionId === null) return;
        if (this.shuttingDown) {
            await this.setDeliveryStatus(record, "failed", "Agent Job Manager 已关闭，未发送结果回流");
            return;
        }
        const header = snapshot.status === "completed"
            ? `[后台任务完成] ${snapshot.title}（${snapshot.jobId}）`
            : snapshot.status === "cancelled"
                ? `[后台任务已取消] ${snapshot.title}（${snapshot.jobId}）`
                : `[后台任务失败] ${snapshot.title}（${snapshot.jobId}）：${failure ?? "未知错误"}`;
        const content = snapshot.status === "completed" && outcome?.message
            ? outcome.message
            : [header, snapshot.status === "completed" ? outcome?.resultPreview ?? "" : ""].filter(Boolean).join("\n");
        try {
            const result = await this.sendFollowup(snapshot.ownerSessionId, [
                "<system-reminder>",
                content,
                "</system-reminder>",
            ].join("\n"));
            if (result.status === "error") {
                await this.setDeliveryStatus(record, "failed", result.error ?? "owner invocation 返回 error");
                return;
            }
            await this.setDeliveryStatus(record, "accepted");
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.setDeliveryStatus(record, "failed", message);
            void appLogger.error("agent.jobs.deliverFailed", {
                jobId: snapshot.jobId,
                ownerSessionId: snapshot.ownerSessionId,
                deliveryError: message,
            }, error, "后台任务结果回流失败");
        }
    }

    /** mode:"prompt" 兼顾两态：owner 空闲立即触发一轮，忙时 harness 自动进 followup 队列。 */
    private async sendFollowup(sessionId: number, text: string): Promise<AgentInvocationResult> {
        if (this.deliveryController.signal.aborted) {
            return {
                sessionId,
                invocationId: "delivery-aborted",
                status: "error",
                acceptance: {state: "none"},
                error: "Agent Job Manager 已关闭",
            };
        }
        return await this.harness().invokeAgent({
            sessionId,
            mode: "prompt",
            message: {text},
            caller: {kind: "system"},
            messageIdentity: "system",
            signal: this.deliveryController.signal,
        });
    }

    /** 投递状态独立于执行状态翻转，并通过同一快照/SSE/登记表发布。 */
    private async setDeliveryStatus(record: JobRecord, status: AgentJobSnapshot["deliveryStatus"], error?: string): Promise<void> {
        record.snapshot.deliveryStatus = status;
        record.snapshot.deliveryError = error;
        this.publishSnapshot(record);
        await this.persist(record.snapshot);
    }

    private async persist(snapshot: AgentJobSnapshot): Promise<void> {
        await this.persistLine({
            at: Date.now(),
            jobId: snapshot.jobId,
            kind: snapshot.kind,
            title: snapshot.title,
            ownerSessionId: snapshot.ownerSessionId,
            originToolCallId: snapshot.originToolCallId,
            status: snapshot.status,
            error: snapshot.error,
            deliveryStatus: snapshot.deliveryStatus,
            deliveryError: snapshot.deliveryError,
        });
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
        const jobId = record.snapshot.jobId;
        const pending = this.previewTimers.get(jobId);
        if (!pending) return;
        clearTimeout(pending);
        this.previewTimers.delete(jobId);
    }

    /** 发布 detached Job 快照；shutdown 后的迟到状态变化不再进入事件流。 */
    private publishSnapshot(record: JobRecord): PublishedAgentJobEvent | null {
        if (this.shuttingDown || this.jobs.get(record.snapshot.jobId) !== record) return null;
        return this.events.publish({type: "job_upserted", job: {...record.snapshot}});
    }

    private async persistLine(line: RegistryLine): Promise<void> {
        if (!this.registryPath) return;
        this.persistQueue = this.persistQueue.then(async () => {
            await this.appendRegistryLine(line);
        });
        await this.persistQueue;
    }

    /** 单次物理 append；调用方必须经过 persistQueue 串行化。 */
    private async appendRegistryLine(line: RegistryLine): Promise<void> {
        try {
            await mkdir(dirname(this.registryPath), {recursive: true});
            await appendFile(this.registryPath, `${JSON.stringify(line)}\n`, "utf8");
        } catch (error) {
            void appLogger.warn("agent.jobs.persistFailed", {jobId: line.jobId, error: error instanceof Error ? error.message : String(error)});
        }
    }
}

function clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
}
