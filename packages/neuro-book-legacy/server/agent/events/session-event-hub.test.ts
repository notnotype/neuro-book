import {describe, expect, it} from "vitest";
import {AgentSessionEventHub} from "nbook/server/agent/events/session-event-hub";

describe("AgentSessionEventHub", () => {
    it("publish 只序列化一次并与后续原对象修改隔离", () => {
        const hub = new AgentSessionEventHub();
        const source = {
            sessionId: 1,
            kind: "session" as const,
            event: {
                type: "invocation_aborted" as const,
                reason: "before",
            },
        };

        const published = hub.publish(source);
        source.event.reason = "after";

        expect(published.payload.event).toEqual({type: "invocation_aborted", reason: "before"});
        expect(published.frame.toString("utf8")).toContain('"reason":"before"');
        expect(published.frame.toString("utf8")).not.toContain('"reason":"after"');
        expect(published.frameBytes).toBe(published.frame.byteLength);
    });

    it("超过单 event 预算时发布有界 snapshot_required fallback", () => {
        const hub = new AgentSessionEventHub({maxEventBytes: 1024});
        const published = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {type: "invocation_aborted", reason: "x".repeat(10_000)},
        });

        expect(published.frameBytes).toBeLessThanOrEqual(1024);
        expect(published.payload).toEqual(expect.objectContaining({
            seq: 1,
            event: {
                type: "snapshot_required",
                reason: "public event exceeded maximum frame size",
            },
        }));
        expect(hub.lastSeq(1)).toBe(1);
    });

    it("Task 22 的 agent_end 终态事件保持 5 KiB 以内且不携带 messages", () => {
        const hub = new AgentSessionEventHub();
        const published = hub.publish({
            sessionId: 1,
            invocationId: "invocation-1",
            kind: "runtime",
            event: {type: "agent_end", status: "completed"},
        });

        expect(published.frameBytes).toBeLessThan(5 * 1024);
        expect(published.payload.event).not.toHaveProperty("messages");
    });

    it("replay pin 仍受事件数和字节数硬上限约束", () => {
        const hub = new AgentSessionEventHub({replayLimit: 3, replayByteLimit: 700});
        hub.pinReplayFrom(1, 1);
        for (let index = 0; index < 20; index += 1) {
            hub.publish({
                sessionId: 1,
                kind: "session",
                event: {type: "invocation_aborted", reason: `${String(index)}-${"x".repeat(180)}`},
            });
        }

        const metrics = hub.metrics(1);
        expect(metrics.replayCount).toBeLessThanOrEqual(3);
        expect(metrics.replayBytes).toBeLessThanOrEqual(700);
        expect(hub.canReplayFrom(1, 0)).toBe(false);
    });

    it("慢订阅者队列溢出时立即 abort 并释放排队引用", async () => {
        const hub = new AgentSessionEventHub({subscriberQueueLimit: 2, subscriberQueueByteLimit: 1024});
        const subscription = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: 0});
        hub.publish({sessionId: 1, kind: "session", event: {type: "invocation_aborted", reason: "one"}});
        hub.publish({sessionId: 1, kind: "session", event: {type: "invocation_aborted", reason: "two"}});
        hub.publish({sessionId: 1, kind: "session", event: {type: "invocation_aborted", reason: "three"}});

        expect(subscription.signal.aborted).toBe(true);
        expect(subscription.closeReason).toBe("queue_overflow");
        expect(hub.metrics(1)).toMatchObject({subscriberCount: 0, queuedCount: 0, queuedBytes: 0});
        await expect(subscription.next()).resolves.toEqual({done: true, value: undefined});
    });

    it("iterator.return 会注销 subscriber 并清空 replay/live 引用", async () => {
        const hub = new AgentSessionEventHub();
        hub.publish({sessionId: 1, kind: "session", event: {type: "invocation_aborted", reason: "replay"}});
        const subscription = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: 0});
        hub.publish({sessionId: 1, kind: "session", event: {type: "invocation_aborted", reason: "live"}});

        await subscription.return();

        expect(subscription.signal.aborted).toBe(true);
        expect(subscription.closeReason).toBe("consumer_closed");
        expect(hub.metrics(1)).toMatchObject({subscriberCount: 0, queuedCount: 0, queuedBytes: 0});
    });

    it("无 subscriber 且无 retention 时立即释放 inactive replay，只保留 seq", () => {
        const hub = new AgentSessionEventHub();
        hub.publish({sessionId: 1, kind: "session", event: {type: "invocation_aborted", reason: "inactive"}});

        expect(hub.lastSeq(1)).toBe(1);
        expect(hub.metrics(1)).toEqual(expect.objectContaining({replayCount: 0, replayBytes: 0, subscriberCount: 0}));
        expect(hub.canReplayFrom(1, 0)).toBe(false);
    });

    it("支持多订阅者和 after replay", async () => {
        const hub = new AgentSessionEventHub();
        hub.pinReplayFrom(1, 1);
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "old",
            },
        });
        const first = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: 0})[Symbol.asyncIterator]();
        const second = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: 1})[Symbol.asyncIterator]();

        const nextEvent = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "new",
            },
        });

        await expect(first.next()).resolves.toEqual({
            done: false,
            value: expect.objectContaining({payload: expect.objectContaining({seq: 1})}),
        });
        await expect(first.next()).resolves.toEqual({
            done: false,
            value: nextEvent,
        });
        await expect(second.next()).resolves.toEqual({
            done: false,
            value: nextEvent,
        });

        await first.return?.();
        await second.return?.();
    });

    it("after 超出 replay buffer 时推送 snapshot_required", async () => {
        const hub = new AgentSessionEventHub({replayLimit: 1});
        hub.pinReplayFrom(1, 1);
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "first",
            },
        });
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "second",
            },
        });

        const subscription = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: 0})[Symbol.asyncIterator]();

        await expect(subscription.next()).resolves.toEqual({
            done: false,
            value: expect.objectContaining({
                payload: expect.objectContaining({
                    kind: "session",
                    event: {
                        type: "snapshot_required",
                        reason: "event replay buffer expired",
                    },
                }),
            }),
        });

        await subscription.return?.();
    });

    it("replay pin 不绕过 replayLimit，旧 anchor 会明确失效", async () => {
        const hub = new AgentSessionEventHub({replayLimit: 1});
        const first = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "first",
            },
        });
        hub.pinReplayFrom(1, first.payload.seq);
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "second",
            },
        });
        const latest = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "third",
            },
        });

        expect(hub.canReplayFrom(1, first.payload.seq - 1)).toBe(false);
        const pinned = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: first.payload.seq - 1})[Symbol.asyncIterator]();
        await expect(pinned.next()).resolves.toEqual({
            done: false,
            value: expect.objectContaining({
                payload: expect.objectContaining({
                    seq: latest.payload.seq,
                    kind: "session",
                    event: expect.objectContaining({type: "snapshot_required"}),
                }),
            }),
        });
        await pinned.return?.();
        hub.unpinReplay(1);
    });

    it("lazy replay 不受较小 live queue 上限误杀快速客户端", async () => {
        const hub = new AgentSessionEventHub({replayLimit: 10, replayByteLimit: 4096, subscriberQueueLimit: 1, subscriberQueueByteLimit: 64});
        hub.pinReplayFrom(1, 1);
        const events = [0, 1, 2].map((index) => hub.publish({
            sessionId: 1,
            kind: "session" as const,
            event: {type: "invocation_aborted" as const, reason: `${String(index)}-${"x".repeat(120)}`},
        }));
        const subscription = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: 0});

        await expect(subscription.next()).resolves.toEqual({done: false, value: events[0]});
        await expect(subscription.next()).resolves.toEqual({done: false, value: events[1]});
        await expect(subscription.next()).resolves.toEqual({done: false, value: events[2]});
        expect(subscription.signal.aborted).toBe(false);
        await subscription.return();
    });

    it("snapshot_required 只发送给落后的订阅者，不广播给正常订阅者", async () => {
        const hub = new AgentSessionEventHub({replayLimit: 1});
        hub.pinReplayFrom(1, 1);
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "first",
            },
        });
        const latest = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "second",
            },
        });

        const stale = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: 0})[Symbol.asyncIterator]();
        const current = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: latest.payload.seq - 1})[Symbol.asyncIterator]();

        await expect(stale.next()).resolves.toEqual({
            done: false,
            value: expect.objectContaining({
                payload: expect.objectContaining({
                    kind: "session",
                    event: expect.objectContaining({type: "snapshot_required"}),
                }),
            }),
        });
        await expect(current.next()).resolves.toEqual({
            done: false,
            value: latest,
        });

        await stale.return?.();
        await current.return?.();
    });

    it("snapshot_required 不推进 session seq，避免给正常订阅者制造缺口", async () => {
        const hub = new AgentSessionEventHub({replayLimit: 1});
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "first",
            },
        });
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "second",
            },
        });

        const stale = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: 0})[Symbol.asyncIterator]();
        await expect(stale.next()).resolves.toEqual({
            done: false,
            value: expect.objectContaining({
                payload: expect.objectContaining({
                    seq: 2,
                    event: expect.objectContaining({type: "snapshot_required"}),
                }),
            }),
        });

        const next = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "third",
            },
        });

        expect(next.payload.seq).toBe(3);
        await stale.return?.();
    });

    it("不同 session 使用独立 seq，避免单 session 订阅误判 gap", () => {
        const hub = new AgentSessionEventHub();
        const first = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "session-1-first",
            },
        });
        hub.publish({
            sessionId: 2,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "session-2-first",
            },
        });
        hub.publish({
            sessionId: 2,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "session-2-second",
            },
        });
        const second = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "session-1-second",
            },
        });

        expect(first.payload.seq).toBe(1);
        expect(second.payload.seq).toBe(2);
        expect(hub.lastSeq(1)).toBe(2);
        expect(hub.lastSeq(2)).toBe(2);
        expect(hub.connectedEvent(1).payload.event).toMatchObject({
            type: "connected",
            latestSeq: 2,
        });
    });

    it("connected handshake 暴露当前 eventEpoch 和 latestSeq", () => {
        const hub = new AgentSessionEventHub();
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "old",
            },
        });

        expect(hub.connectedEvent(1).payload).toMatchObject({
            eventEpoch: hub.eventEpoch,
            seq: 1,
            event: {
                type: "connected",
                eventEpoch: hub.eventEpoch,
                latestSeq: 1,
            },
        });
    });

    it("close 会释放 replay、订阅和 session seq 元数据", async () => {
        const hub = new AgentSessionEventHub();
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {type: "invocation_aborted", reason: "done"},
        });
        const subscription = hub.subscribe(1)[Symbol.asyncIterator]();

        hub.close();

        expect(hub.lastSeq(1)).toBe(0);
        expect(hub.metrics(1)).toEqual({
            replayCount: 0,
            replayBytes: 0,
            subscriberCount: 0,
            queuedCount: 0,
            queuedBytes: 0,
            pendingReplayCount: 0,
            pendingReplayBytes: 0,
            retained: false,
        });
        await expect(subscription.next()).resolves.toEqual({done: true, value: undefined});
        expect(() => hub.publish({sessionId: 1, kind: "session", event: {type: "invocation_aborted"}})).toThrow("event_hub_closed");
        expect(() => hub.subscribe(1)).toThrow("event_hub_closed");
        expect(() => hub.connectedEvent(1)).toThrow("event_hub_closed");
        expect(() => hub.pinReplayFrom(1, 1)).toThrow("event_hub_closed");
        expect(() => hub.unpinReplay(1)).toThrow("event_hub_closed");
        expect(() => hub.close()).not.toThrow();
    });

    it("after 来自未来时推送 snapshot_required", async () => {
        const hub = new AgentSessionEventHub();
        const subscription = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: 426})[Symbol.asyncIterator]();

        await expect(subscription.next()).resolves.toEqual({
            done: false,
            value: expect.objectContaining({
                payload: expect.objectContaining({
                    eventEpoch: hub.eventEpoch,
                    kind: "session",
                    event: {
                        type: "snapshot_required",
                        reason: "event cursor is ahead of server",
                    },
                }),
            }),
        });

        await subscription.return?.();
    });

    it("正数 after 缺少 eventEpoch 时拒绝 replay 当前进程事件", async () => {
        const hub = new AgentSessionEventHub();
        hub.pinReplayFrom(1, 1);
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {type: "invocation_aborted", reason: "current-epoch"},
        });
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {type: "invocation_aborted", reason: "must-not-replay"},
        });
        const subscription = hub.subscribe(1, {after: 1})[Symbol.asyncIterator]();

        await expect(subscription.next()).resolves.toEqual({
            done: false,
            value: expect.objectContaining({
                payload: expect.objectContaining({
                    eventEpoch: hub.eventEpoch,
                    kind: "session",
                    event: {
                        type: "snapshot_required",
                        reason: "event cursor is missing epoch",
                    },
                }),
            }),
        });

        await subscription.return?.();
    });

    it("eventEpoch 不一致时不 replay 旧事件", async () => {
        const hub = new AgentSessionEventHub();
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "old",
            },
        });
        const subscription = hub.subscribe(1, {eventEpoch: "old-epoch", after: 0})[Symbol.asyncIterator]();
        const next = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "new",
            },
        });

        await expect(subscription.next()).resolves.toEqual({
            done: false,
            value: next,
        });
        await subscription.return?.();
    });
});
