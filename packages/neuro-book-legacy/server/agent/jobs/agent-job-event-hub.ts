import {randomUUID} from "node:crypto";
import {PUBLIC_EVENT_MAX_BYTES} from "nbook/shared/agent/public-event-limits";
import type {
    AgentJobEventCursor,
    AgentJobEventDto,
    AgentJobStreamEvent,
} from "nbook/shared/dto/agent-job.dto";

const DEFAULT_REPLAY_LIMIT = 500;
const DEFAULT_REPLAY_BYTE_LIMIT = 4 * 1024 * 1024;
const DEFAULT_SUBSCRIBER_QUEUE_LIMIT = 128;
const DEFAULT_SUBSCRIBER_QUEUE_BYTE_LIMIT = 1024 * 1024;

export type PublishedAgentJobEvent = Readonly<{
    payload: AgentJobEventDto;
    frame: Buffer;
    frameBytes: number;
}>;

export type AgentJobSubscriptionCloseReason = "consumer_closed" | "queue_overflow" | "hub_closed";

export interface AgentJobEventSubscription extends AsyncIterable<PublishedAgentJobEvent>, AsyncIterator<PublishedAgentJobEvent> {
    readonly connected: PublishedAgentJobEvent;
    readonly signal: AbortSignal;
    readonly closeReason: AgentJobSubscriptionCloseReason | null;
    return(): Promise<IteratorResult<PublishedAgentJobEvent>>;
    close(reason?: AgentJobSubscriptionCloseReason): void;
}

export type AgentJobEventHubOptions = {
    replayLimit?: number;
    replayByteLimit?: number;
    subscriberQueueLimit?: number;
    subscriberQueueByteLimit?: number;
    maxEventBytes?: number;
};

/** 单个 Job SSE 订阅；replay 与 live queue 分离，避免历史回放误占 live 预算。 */
class JobEventSubscription implements AgentJobEventSubscription {
    readonly connected: PublishedAgentJobEvent;
    readonly signal: AbortSignal;
    closeReason: AgentJobSubscriptionCloseReason | null = null;
    private readonly controller = new AbortController();
    private readonly liveQueue: PublishedAgentJobEvent[] = [];
    private replayQueue: PublishedAgentJobEvent[];
    private liveQueueBytes = 0;
    private resolver: ((value: IteratorResult<PublishedAgentJobEvent>) => void) | null = null;
    private closed = false;

    constructor(
        connected: PublishedAgentJobEvent,
        replay: PublishedAgentJobEvent[],
        private readonly queueLimit: number,
        private readonly queueByteLimit: number,
        private readonly onClose: (subscription: JobEventSubscription) => void,
    ) {
        this.connected = connected;
        this.replayQueue = replay;
        this.signal = this.controller.signal;
    }

    /** 推送 live 事件；慢消费者超过硬预算时立即断开。 */
    push(event: PublishedAgentJobEvent): void {
        if (this.closed) return;
        if (this.resolver && this.replayQueue.length === 0) {
            const resolve = this.resolver;
            this.resolver = null;
            resolve({done: false, value: event});
            return;
        }
        if (this.liveQueue.length + 1 > this.queueLimit || this.liveQueueBytes + event.frameBytes > this.queueByteLimit) {
            this.close("queue_overflow");
            return;
        }
        this.liveQueue.push(event);
        this.liveQueueBytes += event.frameBytes;
    }

    /** 依次消费 replay 和 live 事件。 */
    async next(): Promise<IteratorResult<PublishedAgentJobEvent>> {
        const replay = this.replayQueue.shift();
        if (replay) return {done: false, value: replay};
        const live = this.liveQueue.shift();
        if (live) {
            this.liveQueueBytes -= live.frameBytes;
            return {done: false, value: live};
        }
        if (this.closed) return {done: true, value: undefined};
        return new Promise((resolve) => {
            this.resolver = resolve;
        });
    }

    /** AsyncIterator 主动结束时释放订阅。 */
    async return(): Promise<IteratorResult<PublishedAgentJobEvent>> {
        this.close("consumer_closed");
        return {done: true, value: undefined};
    }

    /** 关闭订阅并释放所有排队帧。 */
    close(reason: AgentJobSubscriptionCloseReason = "hub_closed"): void {
        if (this.closed) return;
        this.closed = true;
        this.closeReason = reason;
        this.replayQueue = [];
        this.liveQueue.length = 0;
        this.liveQueueBytes = 0;
        this.controller.abort(reason);
        const resolve = this.resolver;
        this.resolver = null;
        this.onClose(this);
        resolve?.({done: true, value: undefined});
    }

    [Symbol.asyncIterator](): AsyncIterator<PublishedAgentJobEvent> {
        return this;
    }
}

/** 全局 Job 事件中心：快照为恢复真相，SSE 提供有界 replay 与 live 增量。 */
export class AgentJobEventHub {
    readonly eventEpoch = randomUUID();
    private readonly replayLimit: number;
    private readonly replayByteLimit: number;
    private readonly subscriberQueueLimit: number;
    private readonly subscriberQueueByteLimit: number;
    private readonly maxEventBytes: number;
    private readonly replay: PublishedAgentJobEvent[] = [];
    private readonly subscribers = new Set<JobEventSubscription>();
    private replayBytes = 0;
    private seq = 0;
    private closed = false;

    constructor(options: AgentJobEventHubOptions = {}) {
        this.replayLimit = normalizeLimit(options.replayLimit, DEFAULT_REPLAY_LIMIT);
        this.replayByteLimit = normalizeLimit(options.replayByteLimit, DEFAULT_REPLAY_BYTE_LIMIT);
        this.subscriberQueueLimit = normalizeLimit(options.subscriberQueueLimit, DEFAULT_SUBSCRIBER_QUEUE_LIMIT);
        this.subscriberQueueByteLimit = normalizeLimit(options.subscriberQueueByteLimit, DEFAULT_SUBSCRIBER_QUEUE_BYTE_LIMIT);
        this.maxEventBytes = normalizeLimit(options.maxEventBytes, PUBLIC_EVENT_MAX_BYTES);
    }

    /** 返回与当前 Job Map 同步读取的恢复游标。 */
    cursor(): AgentJobEventCursor {
        return {eventEpoch: this.eventEpoch, after: this.seq};
    }

    /** 发布一个 durable Job 变化，并广播给所有订阅者。 */
    publish(event: Extract<AgentJobStreamEvent, {type: "job_upserted" | "jobs_removed"}>): PublishedAgentJobEvent {
        this.assertOpen();
        const nextSeq = this.seq + 1;
        let published = this.createPublished({eventEpoch: this.eventEpoch, seq: nextSeq, event});
        if (published.frameBytes > this.maxEventBytes) {
            published = this.createPublished({
                eventEpoch: this.eventEpoch,
                seq: nextSeq,
                event: {type: "snapshot_required", reason: "public event exceeded maximum frame size"},
            });
        }
        if (published.frameBytes > this.maxEventBytes) {
            throw new Error(`snapshot_required frame 超过公开事件预算：${String(published.frameBytes)}`);
        }
        this.seq = nextSeq;
        this.replay.push(published);
        this.replayBytes += published.frameBytes;
        this.trimReplay();
        for (const subscriber of [...this.subscribers]) subscriber.push(published);
        return published;
    }

    /** 从游标订阅；不可 replay 时只给该订阅者发送 snapshot_required。 */
    subscribe(cursor: Partial<AgentJobEventCursor> = {}): AgentJobEventSubscription {
        this.assertOpen();
        const subscription = new JobEventSubscription(
            this.connectedEvent(),
            this.subscriptionReplay(cursor),
            this.subscriberQueueLimit,
            this.subscriberQueueByteLimit,
            (closed) => this.subscribers.delete(closed),
        );
        this.subscribers.add(subscription);
        return subscription;
    }

    /** 关闭全部订阅并释放 replay。 */
    close(): void {
        if (this.closed) return;
        this.closed = true;
        for (const subscriber of [...this.subscribers]) subscriber.close("hub_closed");
        this.replay.length = 0;
        this.replayBytes = 0;
    }

    /** 生成不参与 seq/replay 的连接握手帧。 */
    private connectedEvent(): PublishedAgentJobEvent {
        return this.createPublished({
            eventEpoch: this.eventEpoch,
            seq: this.seq,
            event: {type: "connected", eventEpoch: this.eventEpoch, latestSeq: this.seq},
        });
    }

    /** 计算指定游标可安全回放的事件。 */
    private subscriptionReplay(cursor: Partial<AgentJobEventCursor>): PublishedAgentJobEvent[] {
        if (typeof cursor.after === "number" && cursor.after > 0 && !cursor.eventEpoch) {
            return [this.snapshotRequired("event cursor is missing epoch")];
        }
        if (cursor.eventEpoch && cursor.eventEpoch !== this.eventEpoch) {
            return [this.snapshotRequired("event epoch changed")];
        }
        const after = cursor.after;
        if (typeof after === "number" && after > this.seq) {
            return [this.snapshotRequired("event cursor is ahead of server")];
        }
        const floor = this.replay[0]?.payload.seq ?? this.seq + 1;
        if (typeof after === "number" && after < this.seq && after < floor - 1) {
            return [this.snapshotRequired("event replay buffer expired")];
        }
        return this.replay.filter((event) => typeof after !== "number" || event.payload.seq > after);
    }

    /** 构造仅面向当前订阅者的恢复请求，不推进全局 seq。 */
    private snapshotRequired(reason: string): PublishedAgentJobEvent {
        return this.createPublished({
            eventEpoch: this.eventEpoch,
            seq: this.seq,
            event: {type: "snapshot_required", reason},
        });
    }

    /** 将 payload 一次序列化为 immutable replay frame。 */
    private createPublished(payload: AgentJobEventDto): PublishedAgentJobEvent {
        const json = JSON.stringify(payload);
        const detached = deepFreeze(JSON.parse(json) as AgentJobEventDto);
        const frame = Buffer.from(`event: ${detached.event.type}\ndata: ${json}\n\n`, "utf8");
        return Object.freeze({payload: detached, frame, frameBytes: frame.byteLength});
    }

    /** 按事件数和字节数硬裁剪 replay。 */
    private trimReplay(): void {
        while (this.replay.length > this.replayLimit || this.replayBytes > this.replayByteLimit) {
            const removed = this.replay.shift();
            if (!removed) break;
            this.replayBytes -= removed.frameBytes;
        }
    }

    /** 禁止关闭后的迟到发布或订阅。 */
    private assertOpen(): void {
        if (this.closed) throw new Error("job_event_hub_closed");
    }
}

/** 规范化事件内存预算。 */
function normalizeLimit(value: number | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    if (!Number.isFinite(value) || value < 1) throw new Error(`事件内存预算必须是正数：${String(value)}`);
    return Math.floor(value);
}

/** 深冻结 detached JSON，禁止订阅者污染 replay。 */
function deepFreeze<T>(value: T): T {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
}
