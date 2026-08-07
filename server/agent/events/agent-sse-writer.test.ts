import {EventEmitter} from "node:events";
import {once} from "node:events";
import {createServer, request, type ServerResponse} from "node:http";
import {describe, expect, it, vi} from "vitest";
import {
    writeAgentEventStream,
    type AgentSseResponse,
    type AgentSseSubscription,
} from "nbook/server/agent/events/agent-sse-writer";
import {AgentSessionEventHub, type AgentSessionEventSubscription, type PublishedAgentSessionEvent} from "nbook/server/agent/events/session-event-hub";

class FakeResponse extends EventEmitter implements AgentSseResponse {
    destroyed = false;
    writableEnded = false;
    readonly headers = new Map<string, string>();
    readonly frames: Buffer[] = [];
    private readonly writeResults: boolean[];

    constructor(writeResults: boolean[]) {
        super();
        this.writeResults = [...writeResults];
    }

    setHeader(name: string, value: string): void {
        this.headers.set(name.toLowerCase(), value);
    }

    flushHeaders(): void {}

    write(frame: Buffer): boolean {
        this.frames.push(frame);
        return this.writeResults.shift() ?? true;
    }

    end(): void {
        this.writableEnded = true;
        this.emit("finish");
    }

    destroy(): this {
        this.destroyed = true;
        this.emit("close");
        return this;
    }
}

class CountingSubscription implements AgentSessionEventSubscription {
    readonly connected: PublishedAgentSessionEvent;
    readonly signal: AbortSignal;
    closeReason: AgentSessionEventSubscription["closeReason"] = null;
    nextCalls = 0;
    private readonly controller = new AbortController();
    private readonly events: PublishedAgentSessionEvent[];

    constructor(events: PublishedAgentSessionEvent[]) {
        this.connected = events[0]!;
        this.events = events.slice(1);
        this.signal = this.controller.signal;
    }

    async next(): Promise<IteratorResult<PublishedAgentSessionEvent>> {
        this.nextCalls += 1;
        const event = this.events.shift();
        return event ? {done: false, value: event} : {done: true, value: undefined};
    }

    async return(): Promise<IteratorResult<PublishedAgentSessionEvent>> {
        this.close("consumer_closed");
        return {done: true, value: undefined};
    }

    close(reason: NonNullable<AgentSessionEventSubscription["closeReason"]> = "hub_closed"): void {
        if (this.signal.aborted) return;
        this.closeReason = reason;
        this.controller.abort(reason);
    }

    [Symbol.asyncIterator](): AsyncIterator<PublishedAgentSessionEvent> {
        return this;
    }
}

describe("writeAgentEventStream", () => {
    it("write=false 后等待 drain，期间不拉取下一事件", async () => {
        const hub = new AgentSessionEventHub();
        const connected = hub.connectedEvent(1);
        const first = hub.publish({sessionId: 1, kind: "session", event: {type: "invocation_aborted", reason: "first"}});
        const second = hub.publish({sessionId: 1, kind: "session", event: {type: "invocation_aborted", reason: "second"}});
        const subscription = new CountingSubscription([connected, first, second]);
        const response = new FakeResponse([true, false, true]);

        const writing = writeAgentEventStream(response, subscription);
        await Promise.resolve();
        await Promise.resolve();

        expect(response.frames).toHaveLength(2);
        expect(subscription.nextCalls).toBe(1);

        response.emit("drain");
        await writing;

        expect(response.frames).toHaveLength(3);
        expect(subscription.nextCalls).toBe(3);
        expect(response.writableEnded).toBe(true);
    });

    it("subscription overflow 能中止 drain 等待并 destroy response", async () => {
        const hub = new AgentSessionEventHub();
        const subscription = new CountingSubscription([
            hub.connectedEvent(1),
            hub.publish({sessionId: 1, kind: "session", event: {type: "invocation_aborted", reason: "first"}}),
        ]);
        const response = new FakeResponse([true, false]);
        const writing = writeAgentEventStream(response, subscription);
        await Promise.resolve();
        await Promise.resolve();

        subscription.close("queue_overflow");
        await writing;

        expect(response.destroyed).toBe(true);
        expect(response.listenerCount("drain")).toBe(0);
        expect(response.listenerCount("close")).toBe(0);
        expect(response.listenerCount("error")).toBe(0);
    });

    it("response close 会关闭 subscription 并清理监听器", async () => {
        const hub = new AgentSessionEventHub();
        const subscription = new CountingSubscription([hub.connectedEvent(1)]);
        const response = new FakeResponse([false]);
        const writing = writeAgentEventStream(response, subscription);
        await Promise.resolve();

        response.destroy();
        await writing;

        expect(subscription.signal.aborted).toBe(true);
        expect(subscription.closeReason).toBe("consumer_closed");
        expect(response.listenerCount("drain")).toBe(0);
        expect(response.listenerCount("close")).toBe(0);
        expect(response.listenerCount("error")).toBe(0);
    });

    it("Product shutdown signal 会关闭长连接并结束 pending subscription", async () => {
        const hub = new AgentSessionEventHub();
        const connected = hub.connectedEvent(1);
        const subscriptionController = new AbortController();
        const productShutdownController = new AbortController();
        let resolveNext: ((result: IteratorResult<PublishedAgentSessionEvent>) => void) | null = null;
        const close = vi.fn((_reason?: "consumer_closed") => {
            subscriptionController.abort();
            resolveNext?.({done: true, value: undefined});
            resolveNext = null;
        });
        const iterator: AsyncIterator<PublishedAgentSessionEvent> = {
            async next() {
                return await new Promise<IteratorResult<PublishedAgentSessionEvent>>((resolvePromise) => {
                    resolveNext = resolvePromise;
                });
            },
            async return() {
                close("consumer_closed");
                return {done: true, value: undefined};
            },
        };
        const subscription = {
            connected,
            signal: subscriptionController.signal,
            close,
            [Symbol.asyncIterator]() {
                return iterator;
            },
        } satisfies AgentSseSubscription<PublishedAgentSessionEvent>;
        const response = new FakeResponse([true]);
        const writing = writeAgentEventStream(response, subscription, {
            shutdownSignal: productShutdownController.signal,
        });
        await Promise.resolve();
        await Promise.resolve();

        productShutdownController.abort();
        await writing;

        expect(close).toHaveBeenCalledWith("consumer_closed");
        expect(response.destroyed).toBe(true);
        expect(response.listenerCount("close")).toBe(0);
        expect(response.listenerCount("error")).toBe(0);
    });

    it("注册前已经 aborted 的 Product shutdown signal 会立即关闭长连接", async () => {
        const hub = new AgentSessionEventHub();
        const subscription = new CountingSubscription([hub.connectedEvent(1)]);
        const response = new FakeResponse([true]);
        const productShutdownController = new AbortController();
        productShutdownController.abort();

        await writeAgentEventStream(response, subscription, {
            shutdownSignal: productShutdownController.signal,
        });

        expect(subscription.signal.aborted).toBe(true);
        expect(subscription.closeReason).toBe("consumer_closed");
        expect(response.destroyed).toBe(true);
        expect(response.frames).toHaveLength(0);
        expect(response.listenerCount("close")).toBe(0);
        expect(response.listenerCount("error")).toBe(0);
    });

    it("真实 paused socket 下 response buffer 有界，queue overflow 会打断 drain", async () => {
        const hub = new AgentSessionEventHub({
            subscriberQueueLimit: 8,
            subscriberQueueByteLimit: 160 * 1024,
        });
        const state: {
            response?: ServerResponse;
            subscription?: AgentSessionEventSubscription;
        } = {};
        let finishWriter = () => {};
        const writerFinished = new Promise<void>((resolve) => {
            finishWriter = resolve;
        });
        const server = createServer((_request, response) => {
            state.response = response;
            state.subscription = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: hub.lastSeq(1)});
            void writeAgentEventStream(response, state.subscription).finally(finishWriter);
        });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        if (!address || typeof address === "string") {
            throw new Error("测试 HTTP server 未取得端口");
        }

        const clientResponsePromise = new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
            const client = request({host: "127.0.0.1", port: address.port, path: "/events"}, resolve);
            client.on("error", reject);
            client.end();
        });
        const clientResponse = await clientResponsePromise;
        clientResponse.pause();

        let maxWritableLength = 0;
        for (let index = 0; index < 100; index += 1) {
            hub.publish({
                sessionId: 1,
                kind: "session",
                event: {type: "invocation_aborted", reason: `${String(index)}-${"x".repeat(20 * 1024)}`},
            });
            maxWritableLength = Math.max(maxWritableLength, state.response?.writableLength ?? 0);
            if (state.subscription?.signal.aborted) {
                break;
            }
        }

        await Promise.race([
            writerFinished,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SSE writer 未及时退出")), 2_000)),
        ]);

        expect(state.subscription?.closeReason).toBe("queue_overflow");
        expect(maxWritableLength).toBeLessThan(256 * 1024);
        clientResponse.destroy();
        server.close();
        await once(server, "close");
    });
});
