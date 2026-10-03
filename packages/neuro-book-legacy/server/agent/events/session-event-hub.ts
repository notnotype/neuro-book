import {randomUUID} from "node:crypto";
import {PUBLIC_EVENT_MAX_BYTES} from "nbook/server/agent/events/public-event-policy";
import type {AgentSessionEventDto} from "nbook/shared/dto/agent-session.dto";

const DEFAULT_REPLAY_LIMIT = 500;
const DEFAULT_REPLAY_BYTE_LIMIT = 4 * 1024 * 1024;
const DEFAULT_SUBSCRIBER_QUEUE_LIMIT = 128;
const DEFAULT_SUBSCRIBER_QUEUE_BYTE_LIMIT = 1024 * 1024;

export type AgentSessionEventCursor = {
    eventEpoch?: string;
    after?: number;
};

export type PublishedAgentSessionEvent = Readonly<{
    /** 与 provider/runtime 可变对象完全脱离的公开事件。 */
    payload: AgentSessionEventDto;
    /** 已格式化的完整 SSE frame；replay 与 writer 共享同一 Buffer。 */
    frame: Buffer;
    frameBytes: number;
}>;

export type AgentSessionSubscriptionCloseReason =
    | "consumer_closed"
    | "queue_overflow"
    | "hub_closed";

export type AgentSessionEventHubOptions = {
    replayLimit?: number;
    replayByteLimit?: number;
    subscriberQueueLimit?: number;
    subscriberQueueByteLimit?: number;
    maxEventBytes?: number;
};

export type AgentSessionEventHubMetrics = {
    replayCount: number;
    replayBytes: number;
    subscriberCount: number;
    queuedCount: number;
    queuedBytes: number;
    pendingReplayCount: number;
    pendingReplayBytes: number;
    retained: boolean;
};

export interface AgentSessionEventSubscription
    extends AsyncIterable<PublishedAgentSessionEvent>, AsyncIterator<PublishedAgentSessionEvent> {
    readonly connected: PublishedAgentSessionEvent;
    readonly signal: AbortSignal;
    readonly closeReason: AgentSessionSubscriptionCloseReason | null;
    return(): Promise<IteratorResult<PublishedAgentSessionEvent>>;
    close(reason?: AgentSessionSubscriptionCloseReason): void;
}

type SessionStreamState = {
    replay: PublishedAgentSessionEvent[];
    replayBytes: number;
    subscribers: Set<SessionEventSubscription>;
    /** 仅表示 snapshot 希望从这里恢复；硬预算仍可裁掉该位置。 */
    retentionFirstSeq?: number;
};

/**
 * 单个 SSE 订阅。历史 replay 与运行中新事件队列分离，避免连接建立时把 replay
 * 同步塞入较小的 live queue 而误判为慢客户端。
 */
class SessionEventSubscription implements AgentSessionEventSubscription {
    readonly connected: PublishedAgentSessionEvent;
    readonly signal: AbortSignal;
    private readonly abortController = new AbortController();
    private readonly liveQueue: PublishedAgentSessionEvent[] = [];
    private replayQueue: PublishedAgentSessionEvent[];
    private liveQueueBytes = 0;
    private resolver: ((value: IteratorResult<PublishedAgentSessionEvent>) => void) | null = null;
    private closed = false;
    private readonly onClose: (subscription: SessionEventSubscription) => void;
    private readonly queueLimit: number;
    private readonly queueByteLimit: number;
    closeReason: AgentSessionSubscriptionCloseReason | null = null;

    constructor(input: {
        connected: PublishedAgentSessionEvent;
        replay: PublishedAgentSessionEvent[];
        queueLimit: number;
        queueByteLimit: number;
        onClose: (subscription: SessionEventSubscription) => void;
    }) {
        this.connected = input.connected;
        this.replayQueue = input.replay;
        this.queueLimit = input.queueLimit;
        this.queueByteLimit = input.queueByteLimit;
        this.onClose = input.onClose;
        this.signal = this.abortController.signal;
    }

    /** 将运行中新事件交给订阅者；超限时立即中止连接并释放所有引用。 */
    push(event: PublishedAgentSessionEvent): void {
        if (this.closed) {
            return;
        }
        if (this.resolver && this.replayQueue.length === 0) {
            const resolve = this.resolver;
            this.resolver = null;
            resolve({done: false, value: event});
            return;
        }
        const nextCount = this.liveQueue.length + 1;
        const nextBytes = this.liveQueueBytes + event.frameBytes;
        if (nextCount > this.queueLimit || nextBytes > this.queueByteLimit) {
            this.close("queue_overflow");
            return;
        }
        this.liveQueue.push(event);
        this.liveQueueBytes = nextBytes;
    }

    async next(): Promise<IteratorResult<PublishedAgentSessionEvent>> {
        const replay = this.replayQueue.shift();
        if (replay) {
            return {done: false, value: replay};
        }
        const live = this.liveQueue.shift();
        if (live) {
            this.liveQueueBytes -= live.frameBytes;
            return {done: false, value: live};
        }
        if (this.closed) {
            return {done: true, value: undefined};
        }
        return new Promise((resolve) => {
            this.resolver = resolve;
        });
    }

    async return(): Promise<IteratorResult<PublishedAgentSessionEvent>> {
        this.close("consumer_closed");
        return {done: true, value: undefined};
    }

    async throw(error?: unknown): Promise<IteratorResult<PublishedAgentSessionEvent>> {
        this.close("consumer_closed");
        throw error;
    }

    close(reason: AgentSessionSubscriptionCloseReason = "hub_closed"): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.closeReason = reason;
        this.replayQueue = [];
        this.liveQueue.length = 0;
        this.liveQueueBytes = 0;
        this.abortController.abort(reason);
        const resolve = this.resolver;
        this.resolver = null;
        this.onClose(this);
        resolve?.({done: true, value: undefined});
    }

    [Symbol.asyncIterator](): AsyncIterator<PublishedAgentSessionEvent> {
        return this;
    }

    metrics(): Pick<AgentSessionEventHubMetrics, "queuedCount" | "queuedBytes" | "pendingReplayCount" | "pendingReplayBytes"> {
        return {
            queuedCount: this.liveQueue.length,
            queuedBytes: this.liveQueueBytes,
            pendingReplayCount: this.replayQueue.length,
            pendingReplayBytes: this.replayQueue.reduce((total, event) => total + event.frameBytes, 0),
        };
    }
}

/**
 * session 级事件中心。公开事件只序列化一次，并对 replay 与慢订阅者分别执行
 * 事件数/字节数硬预算。
 */
export class AgentSessionEventHub {
    readonly eventEpoch = randomUUID();
    private readonly replayLimit: number;
    private readonly replayByteLimit: number;
    private readonly subscriberQueueLimit: number;
    private readonly subscriberQueueByteLimit: number;
    private readonly maxEventBytes: number;
    private readonly states = new Map<number, SessionStreamState>();
    private readonly seqBySession = new Map<number, number>();
    private closed = false;

    constructor(options: AgentSessionEventHubOptions = {}) {
        this.replayLimit = normalizeLimit(options.replayLimit, DEFAULT_REPLAY_LIMIT);
        this.replayByteLimit = normalizeLimit(options.replayByteLimit, DEFAULT_REPLAY_BYTE_LIMIT);
        this.subscriberQueueLimit = normalizeLimit(options.subscriberQueueLimit, DEFAULT_SUBSCRIBER_QUEUE_LIMIT);
        this.subscriberQueueByteLimit = normalizeLimit(options.subscriberQueueByteLimit, DEFAULT_SUBSCRIBER_QUEUE_BYTE_LIMIT);
        this.maxEventBytes = normalizeLimit(options.maxEventBytes, PUBLIC_EVENT_MAX_BYTES);
    }

    /** 给事件分配 session 内递增序号，生成一次 SSE frame 后广播。 */
    publish(event: Omit<AgentSessionEventDto, "seq" | "eventEpoch">): PublishedAgentSessionEvent {
        this.assertOpen();
        const seq = this.lastSeq(event.sessionId) + 1;
        const candidate = {
            ...event,
            eventEpoch: this.eventEpoch,
            seq,
        } as AgentSessionEventDto;
        let published = this.createPublished(candidate);
        if (published.frameBytes > this.maxEventBytes) {
            published = this.createPublished({
                eventEpoch: this.eventEpoch,
                seq,
                sessionId: event.sessionId,
                kind: "session",
                event: {
                    type: "snapshot_required",
                    reason: "public event exceeded maximum frame size",
                },
            });
        }
        if (published.frameBytes > this.maxEventBytes) {
            throw new Error(`snapshot_required frame 超过公开事件预算：${String(published.frameBytes)}`);
        }

        // 只有序列化和 fallback 都成功后才提交 seq，避免产生不可恢复的缺口。
        this.seqBySession.set(event.sessionId, seq);
        const state = this.state(event.sessionId);
        state.replay.push(published);
        state.replayBytes += published.frameBytes;
        this.trimReplay(state);
        for (const subscriber of [...state.subscribers]) {
            subscriber.push(published);
        }
        this.cleanupInactiveState(event.sessionId, state);
        return published;
    }

    /** 生成不参与 replay 的 SSE 连接握手 frame。 */
    connectedEvent(sessionId: number): PublishedAgentSessionEvent {
        this.assertOpen();
        const latestSeq = this.lastSeq(sessionId);
        return this.createPublished({
            eventEpoch: this.eventEpoch,
            seq: latestSeq,
            sessionId,
            kind: "session",
            event: {
                type: "connected",
                eventEpoch: this.eventEpoch,
                latestSeq,
            },
        });
    }

    /**
     * 订阅 session 事件。同 epoch cursor 使用独立 replay cursor；跨 epoch 只接收
     * 后续 live event，由 connected handshake 驱动 snapshot 恢复。
     */
    subscribe(sessionId: number, cursor: AgentSessionEventCursor = {}): AgentSessionEventSubscription {
        this.assertOpen();
        const state = this.state(sessionId);
        const replay = this.subscriptionReplay(sessionId, state, cursor);
        const subscription = new SessionEventSubscription({
            connected: this.connectedEvent(sessionId),
            replay,
            queueLimit: this.subscriberQueueLimit,
            queueByteLimit: this.subscriberQueueByteLimit,
            onClose: (closed) => this.removeSubscriber(sessionId, closed),
        });
        state.subscribers.add(subscription);
        return subscription;
    }

    /** 当前 session 最新事件序号。 */
    lastSeq(sessionId: number): number {
        return this.seqBySession.get(sessionId) ?? 0;
    }

    /** 当前 replay 连续窗口的第一条 seq；空窗口返回 latest + 1。 */
    replayFloorSeq(sessionId: number): number {
        const state = this.states.get(sessionId);
        return state?.replay[0]?.payload.seq ?? this.lastSeq(sessionId) + 1;
    }

    /** cursor 之后的所有事件是否仍可从当前连续 replay 窗口恢复。 */
    canReplayFrom(sessionId: number, after: number): boolean {
        const latest = this.lastSeq(sessionId);
        if (!Number.isInteger(after) || after < 0 || after > latest) {
            return false;
        }
        if (after === latest) {
            return true;
        }
        return after >= this.replayFloorSeq(sessionId) - 1;
    }

    /**
     * 声明运行中 transcript 的期望 replay 起点。retention 只阻止 inactive cleanup，
     * 不绕过 replay count/byte 硬裁剪。
     */
    pinReplayFrom(sessionId: number, firstSeq: number): void {
        this.assertOpen();
        const state = this.state(sessionId);
        const normalized = Math.max(1, Math.floor(firstSeq));
        state.retentionFirstSeq = state.retentionFirstSeq === undefined
            ? normalized
            : Math.min(state.retentionFirstSeq, normalized);
        this.trimReplay(state);
    }

    /** 解除 transcript retention；无订阅时同步释放 replay payload。 */
    unpinReplay(sessionId: number): void {
        this.assertOpen();
        const state = this.states.get(sessionId);
        if (!state) {
            return;
        }
        state.retentionFirstSeq = undefined;
        this.cleanupInactiveState(sessionId, state);
    }

    /** 供确定性压力测试和诊断读取，不暴露正文。 */
    metrics(sessionId: number): AgentSessionEventHubMetrics {
        const state = this.states.get(sessionId);
        if (!state) {
            return emptyMetrics();
        }
        let queuedCount = 0;
        let queuedBytes = 0;
        let pendingReplayCount = 0;
        let pendingReplayBytes = 0;
        for (const subscriber of state.subscribers) {
            const metrics = subscriber.metrics();
            queuedCount += metrics.queuedCount;
            queuedBytes += metrics.queuedBytes;
            pendingReplayCount += metrics.pendingReplayCount;
            pendingReplayBytes += metrics.pendingReplayBytes;
        }
        return {
            replayCount: state.replay.length,
            replayBytes: state.replayBytes,
            subscriberCount: state.subscribers.size,
            queuedCount,
            queuedBytes,
            pendingReplayCount,
            pendingReplayBytes,
            retained: state.retentionFirstSeq !== undefined,
        };
    }

    /** 关闭全部订阅并释放所有 replay；seq 仍保留到 hub 生命周期结束。 */
    close(): void {
        if (this.closed) return;
        this.closed = true;
        for (const [sessionId, state] of this.states) {
            for (const subscriber of [...state.subscribers]) {
                subscriber.close("hub_closed");
            }
            state.replay = [];
            state.replayBytes = 0;
            this.states.delete(sessionId);
        }
        this.seqBySession.clear();
    }

    private assertOpen(): void {
        if (this.closed) throw new Error("event_hub_closed");
    }

    private subscriptionReplay(
        sessionId: number,
        state: SessionStreamState,
        cursor: AgentSessionEventCursor,
    ): PublishedAgentSessionEvent[] {
        if (typeof cursor.after === "number" && cursor.after > 0 && !cursor.eventEpoch) {
            return [this.snapshotRequiredEvent(sessionId, "event cursor is missing epoch")];
        }
        if (cursor.eventEpoch && cursor.eventEpoch !== this.eventEpoch) {
            return [];
        }
        const after = cursor.after;
        const latest = this.lastSeq(sessionId);
        if (typeof after === "number" && after > latest) {
            return [this.snapshotRequiredEvent(sessionId, "event cursor is ahead of server")];
        }
        if (typeof after === "number" && !this.canReplayFrom(sessionId, after)) {
            return [this.snapshotRequiredEvent(sessionId, "event replay buffer expired")];
        }
        return state.replay.filter((event) => typeof after !== "number" || event.payload.seq > after);
    }

    private snapshotRequiredEvent(sessionId: number, reason: string): PublishedAgentSessionEvent {
        return this.createPublished({
            eventEpoch: this.eventEpoch,
            seq: this.lastSeq(sessionId),
            sessionId,
            kind: "session",
            event: {type: "snapshot_required", reason},
        });
    }

    private createPublished(payload: AgentSessionEventDto): PublishedAgentSessionEvent {
        const json = JSON.stringify(payload);
        const detached = deepFreeze(JSON.parse(json) as AgentSessionEventDto);
        const frame = Buffer.from(`event: ${detached.event.type}\ndata: ${json}\n\n`, "utf8");
        return Object.freeze({
            payload: detached,
            frame,
            frameBytes: frame.byteLength,
        });
    }

    private state(sessionId: number): SessionStreamState {
        const existing = this.states.get(sessionId);
        if (existing) {
            return existing;
        }
        const created: SessionStreamState = {
            replay: [],
            replayBytes: 0,
            subscribers: new Set(),
        };
        this.states.set(sessionId, created);
        return created;
    }

    private trimReplay(state: SessionStreamState): void {
        while (state.replay.length > this.replayLimit || state.replayBytes > this.replayByteLimit) {
            const removed = state.replay.shift();
            if (!removed) {
                break;
            }
            state.replayBytes -= removed.frameBytes;
        }
    }

    private removeSubscriber(sessionId: number, subscription: SessionEventSubscription): void {
        const state = this.states.get(sessionId);
        if (!state) {
            return;
        }
        state.subscribers.delete(subscription);
        this.cleanupInactiveState(sessionId, state);
    }

    private cleanupInactiveState(sessionId: number, state: SessionStreamState): void {
        if (state.subscribers.size > 0 || state.retentionFirstSeq !== undefined) {
            return;
        }
        state.replay = [];
        state.replayBytes = 0;
        this.states.delete(sessionId);
    }
}

function normalizeLimit(value: number | undefined, fallback: number): number {
    if (value === undefined) {
        return fallback;
    }
    if (!Number.isFinite(value) || value < 1) {
        throw new Error(`事件内存预算必须是正数：${String(value)}`);
    }
    return Math.floor(value);
}

function emptyMetrics(): AgentSessionEventHubMetrics {
    return {
        replayCount: 0,
        replayBytes: 0,
        subscriberCount: 0,
        queuedCount: 0,
        queuedBytes: 0,
        pendingReplayCount: 0,
        pendingReplayBytes: 0,
        retained: false,
    };
}

/** bounded public DTO 的深冻结，防止 publish 返回值被调用方再次修改。 */
function deepFreeze<T>(value: T): T {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
        return value;
    }
    for (const child of Object.values(value)) {
        deepFreeze(child);
    }
    return Object.freeze(value);
}
