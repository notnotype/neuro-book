import {beforeEach, describe, expect, it, vi} from "vitest";
import {ref} from "vue";
import {useAgentSession} from "nbook/app/components/novel-ide/agent/useAgentSession";
import {AgentSessionLoadController} from "nbook/app/components/novel-ide/agent/agent-chat-surface-state";
import {useAgentSessionStream} from "nbook/app/components/novel-ide/agent/useAgentSessionStream";
import type {AgentChatEntryDto} from "nbook/shared/dto/agent-public-event.dto";
import type {AgentSessionEventDto, AgentSessionEventsQueryDto, AgentSessionRecoveryDto} from "nbook/shared/dto/agent-session.dto";

describe("useAgentSessionStream", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it("首次订阅使用 recovery eventCursor", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 3));
        const cursors: AgentSessionEventsQueryDto[] = [];
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => recovery(1, 3)),
                subscribeSessionEvents: vi.fn(async (_sessionId, cursor, onEvent, _signal, options) => {
                    cursors.push(cursor);
                    options?.onOpen?.();
                    await onEvent(connected(7));
                    await never();
                }),
            },
        });

        await stream.start(1);

        expect(cursors).toEqual([{eventEpoch: "epoch-1", after: 3}]);
        stream.stop();
    });

    it("stop 后显式 ensure 会重新建立 Session SSE", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 3));
        const subscribeSessionEvents = vi.fn(async (
            _sessionId: number,
            _cursor: AgentSessionEventsQueryDto,
            _onEvent: (event: AgentSessionEventDto) => Promise<void>,
            signal: AbortSignal,
            options?: {onOpen?: () => void},
        ) => {
            options?.onOpen?.();
            await untilAbort(signal);
        });
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => recovery(1, 3)),
                subscribeSessionEvents,
            },
        });

        await stream.start(1);
        stream.stop();
        await stream.ensure();

        expect(subscribeSessionEvents).toHaveBeenCalledTimes(2);
        stream.stop();
    });

    it("连接 open 前 stop 会以 AbortError 结算 start", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 0));
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => recovery(1, 0)),
                subscribeSessionEvents: vi.fn(async (_sessionId, _cursor, _onEvent, signal) => untilAbort(signal)),
            },
        });

        const starting = stream.start(1);
        await Promise.resolve();
        stream.stop();

        await expect(starting).rejects.toMatchObject({name: "AbortError"});
    });

    it("订阅在 open 前正常关闭会拒绝 start 并安排重连", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 0));
        const subscribeSessionEvents = vi.fn(async () => {});
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => recovery(1, 0)),
                subscribeSessionEvents,
            },
        });

        await expect(stream.start(1)).rejects.toThrow("event stream closed before open");
        expect(session.connectionStatus.value).toBe("reconnecting");
        await vi.advanceTimersByTimeAsync(300);
        expect(subscribeSessionEvents).toHaveBeenCalledTimes(2);
        stream.stop();
    });

    it("短连接 onOpen 后立即 EOF 不清零内部失败序列", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 0));
        const subscribeSessionEvents = vi.fn(async (
            _sessionId: number,
            _cursor: AgentSessionEventsQueryDto,
            _onEvent: (event: AgentSessionEventDto) => void,
            _signal?: AbortSignal,
            options?: {onOpen?: () => void},
        ) => {
            options?.onOpen?.();
        });
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {getSessionRecovery: vi.fn(async () => recovery(1, 0)), subscribeSessionEvents},
        });

        await stream.start(1);
        await Promise.resolve();
        expect(stream.reconnectAttempt.value).toBe(1);
        for (const [index, delay] of [300, 800, 1500, 3000].entries()) {
            await vi.advanceTimersByTimeAsync(delay);
            await Promise.resolve();
            expect(subscribeSessionEvents).toHaveBeenCalledTimes(index + 2);
        }
        expect(stream.reconnectAttempt.value).toBe(5);
        stream.stop();
    });

    it("多个 snapshot_required 事件共用一次 recovery", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1));
        let resolveRecovery!: (value: AgentSessionRecoveryDto) => void;
        const getSessionRecovery = vi.fn(() => new Promise<AgentSessionRecoveryDto>((resolve) => {
            resolveRecovery = resolve;
        }));
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery,
                subscribeSessionEvents: vi.fn(async (_sessionId, _cursor, onEvent, signal, options) => {
                    options?.onOpen?.();
                    if (!signal?.aborted && getSessionRecovery.mock.calls.length === 0) {
                        void onEvent(control(2, {type: "snapshot_required", reason: "trimmed"}));
                        void onEvent(control(3, {type: "snapshot_required", reason: "trimmed again"}));
                    }
                    await untilAbort(signal);
                }),
            },
        });

        await stream.start(1);
        await Promise.resolve();
        expect(getSessionRecovery).toHaveBeenCalledTimes(1);

        resolveRecovery(recovery(1, 3));
        await vi.waitFor(() => expect(session.lastSeq.value).toBe(3));
        expect(session.needsRecovery.value).toBe(false);
        stream.stop();
    });

    it("同一连接内自动 recovery 失败后不重复请求同一原因", async () => {
        const session = useAgentSession();
        session.applyRecovery({
            ...recovery(1, 1),
            history: {entries: [userEntry("existing", "保留当前正文")], previousCursor: null},
        });
        let emit!: (event: AgentSessionEventDto) => void | Promise<void>;
        const getSessionRecovery = vi.fn(async () => {
            throw new Error("recovery failed");
        });
        const onError = vi.fn();
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery,
                subscribeSessionEvents: vi.fn(async (_sessionId, _cursor, onEvent, signal, options) => {
                    emit = onEvent;
                    options?.onOpen?.();
                    await untilAbort(signal);
                }),
            },
            onError,
        });

        await stream.start(1);
        await emit(control(2, {type: "snapshot_required", reason: "trimmed"}));
        await emit(control(2, {type: "snapshot_required", reason: "trimmed again"}));

        expect(getSessionRecovery).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(session.durableEntries.value.map((entry) => entry.id)).toEqual(["existing"]);
        expect(session.needsRecovery.value).toBe(false);
        expect(session.connectionStatus.value).toBe("connected");
        stream.stop();
    });

    it("同一连接内不同自动 recovery 原因可以分别尝试", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1));
        let emit!: (event: AgentSessionEventDto) => void | Promise<void>;
        const getSessionRecovery = vi.fn()
            .mockRejectedValueOnce(new Error("snapshot recovery failed"))
            .mockResolvedValueOnce(recovery(1, 2));
        const onError = vi.fn();
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery,
                subscribeSessionEvents: vi.fn(async (_sessionId, _cursor, onEvent, signal, options) => {
                    emit = onEvent;
                    options?.onOpen?.();
                    await untilAbort(signal);
                }),
            },
            onError,
        });

        await stream.start(1);
        await emit(control(2, {type: "snapshot_required", reason: "trimmed"}));
        await emit(control(2, {type: "session_projection_invalidated", reason: "linked_agent_changed"}));

        expect(getSessionRecovery).toHaveBeenCalledTimes(2);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(session.lastSeq.value).toBe(2);
        stream.stop();
    });

    it("手动强制 recovery 可在自动失败后重试", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1));
        let emit!: (event: AgentSessionEventDto) => void | Promise<void>;
        const getSessionRecovery = vi.fn()
            .mockRejectedValueOnce(new Error("automatic recovery failed"))
            .mockResolvedValueOnce(recovery(1, 4));
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery,
                subscribeSessionEvents: vi.fn(async (_sessionId, _cursor, onEvent, signal, options) => {
                    emit = onEvent;
                    options?.onOpen?.();
                    await untilAbort(signal);
                }),
            },
        });

        await stream.start(1);
        await emit(control(2, {type: "snapshot_required", reason: "trimmed"}));
        await expect(stream.refreshRecovery("manual_refresh")).resolves.toBe(true);

        expect(getSessionRecovery).toHaveBeenCalledTimes(2);
        expect(session.lastSeq.value).toBe(4);
        stream.stop();
    });

    it("重新连接后允许相同自动 recovery 原因再次尝试", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1));
        let emit!: (event: AgentSessionEventDto) => void | Promise<void>;
        const getSessionRecovery = vi.fn()
            .mockRejectedValueOnce(new Error("first connection failed"))
            .mockResolvedValueOnce(recovery(1, 5));
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery,
                subscribeSessionEvents: vi.fn(async (_sessionId, _cursor, onEvent, signal, options) => {
                    emit = onEvent;
                    options?.onOpen?.();
                    await untilAbort(signal);
                }),
            },
        });

        await stream.start(1);
        await emit(control(2, {type: "snapshot_required", reason: "trimmed"}));
        await stream.reconnectNow();
        await emit(control(2, {type: "snapshot_required", reason: "trimmed again"}));

        expect(getSessionRecovery).toHaveBeenCalledTimes(2);
        expect(session.lastSeq.value).toBe(5);
        stream.stop();
    });

    it("连接切换后旧 recovery 响应不会重置新连接", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1));
        const activeSessionId = ref<number | null>(1);
        const oldRecovery = deferred<AgentSessionRecoveryDto>();
        const newRecovery = deferred<AgentSessionRecoveryDto>();
        const getSessionRecovery = vi.fn()
            .mockImplementationOnce(() => oldRecovery.promise)
            .mockImplementationOnce(() => newRecovery.promise);
        const stream = useAgentSessionStream({
            session,
            activeSessionId,
            api: {
                getSessionRecovery,
                subscribeSessionEvents: vi.fn(async (_sessionId, _cursor, _onEvent, signal, options) => {
                    options?.onOpen?.();
                    await untilAbort(signal);
                }),
            },
        });

        const stale = stream.syncRecovery("snapshot_required");
        await stream.reconnectNow();
        const current = stream.syncRecovery("snapshot_required");

        expect(getSessionRecovery).toHaveBeenCalledTimes(2);
        oldRecovery.resolve(recovery(1, 2));
        await expect(stale).resolves.toBe(false);
        expect(session.lastSeq.value).toBe(1);

        newRecovery.resolve(recovery(1, 3));
        await expect(current).resolves.toBe(true);
        expect(session.lastSeq.value).toBe(3);
        stream.stop();
    });

    it("活动连接应用 recovery 后从返回 cursor 重新订阅", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 5));
        const cursors: AgentSessionEventsQueryDto[] = [];
        let subscriptionCount = 0;
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => recovery(1, 2)),
                subscribeSessionEvents: vi.fn(async (_sessionId, cursor, onEvent, signal, options) => {
                    subscriptionCount += 1;
                    cursors.push(cursor);
                    options?.onOpen?.();
                    await onEvent(connected(subscriptionCount === 1 ? 5 : 2));
                    if (subscriptionCount === 1) {
                        await onEvent(control(6, {type: "snapshot_required", reason: "replay expired"}));
                    }
                    await untilAbort(signal);
                }),
            },
        });

        await stream.start(1);
        await vi.waitFor(() => expect(cursors).toEqual([
            {eventEpoch: "epoch-1", after: 5},
            {eventEpoch: "epoch-1", after: 2},
        ]));
        expect(session.lastSeq.value).toBe(2);
        expect(session.connectionStatus.value).toBe("connected");
        stream.stop();
    });

    it("切换 session 后丢弃旧 recovery 响应", async () => {
        const session = useAgentSession();
        const activeSessionId = ref<number | null>(1);
        session.applyRecovery(recovery(1, 1));
        let resolveOld!: (value: AgentSessionRecoveryDto) => void;
        const stream = useAgentSessionStream({
            session,
            activeSessionId,
            api: {
                getSessionRecovery: vi.fn(() => new Promise<AgentSessionRecoveryDto>((resolve) => {
                    resolveOld = resolve;
                })),
                subscribeSessionEvents: vi.fn(async () => never()),
            },
        });

        const oldSync = stream.syncRecovery("manual_refresh");
        activeSessionId.value = 2;
        session.reset();
        session.applyRecovery(recovery(2, 9));
        resolveOld(recovery(1, 5));

        await expect(oldSync).resolves.toBe(false);
        expect(session.recoveryShell.value?.summary.sessionId).toBe(2);
        expect(session.lastSeq.value).toBe(9);
    });

    it("HTTP 与 SSE 同时请求 recovery 时复用同一 single-flight", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1, "rev-1"));
        let resolveRecovery!: (value: AgentSessionRecoveryDto) => void;
        const getSessionRecovery = vi.fn(() => new Promise<AgentSessionRecoveryDto>((resolve) => {
            resolveRecovery = resolve;
        }));
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {getSessionRecovery, subscribeSessionEvents: vi.fn(async () => never())},
        });

        session.applyLiveState({...liveState(1), activePathRevision: "rev-2"});
        const httpRecovery = stream.syncRecovery("active_path_changed");
        const sseRecovery = stream.syncRecovery("snapshot_required");

        expect(getSessionRecovery).toHaveBeenCalledTimes(1);
        resolveRecovery(recovery(1, 2, "rev-2"));
        await expect(httpRecovery).resolves.toBe(true);
        await expect(sseRecovery).resolves.toBe(true);
        expect(session.recoveryShell.value?.activePathRevision).toBe("rev-2");
    });

    it("普通 recovery 的 Session Not Found 只调用一次专用回调", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1));
        const onSessionNotFound = vi.fn(async () => undefined);
        const onError = vi.fn();
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => {
                    throw sessionNotFoundHttpError();
                }),
                subscribeSessionEvents: vi.fn(async () => never()),
            },
            onSessionNotFound,
            onError,
        });

        const first = stream.syncRecovery("snapshot_required");
        const second = stream.syncRecovery("seq_gap");

        await expect(first).resolves.toBe(true);
        await expect(second).resolves.toBe(true);
        expect(onSessionNotFound).toHaveBeenCalledTimes(1);
        expect(onSessionNotFound).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({sessionId: 1, isCurrent: expect.any(Function)}),
        );
        expect(onError).not.toHaveBeenCalled();
    });

    it("404 deferred 结果跳过普通错误出口，等待前台操作收口", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1));
        const onSessionNotFound = vi.fn(async () => "deferred" as const);
        const onError = vi.fn();
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => {
                    throw sessionNotFoundHttpError();
                }),
                subscribeSessionEvents: vi.fn(async () => never()),
            },
            onSessionNotFound,
            onError,
        });

        await expect(stream.syncRecovery("snapshot_required")).resolves.toBe(true);
        expect(onSessionNotFound).toHaveBeenCalledOnce();
        expect(onError).not.toHaveBeenCalled();
    });

    it("onSessionNotFound 挂起等待前台收口：前台成功不运行 work，前台失败 replay 且拒绝由回调捕获", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1));
        const loads = new AgentSessionLoadController();
        const work = vi.fn(async () => {
            throw new Error("recovery failed");
        });
        const onSessionNotFound = vi.fn(async () => {
            const started = loads.runRecovery("project:a", work);
            try {
                await started.promise;
            } catch {
                // Surface 层负责把 rejection 投影成错误状态；这里验证不产生 unhandled rejection
            }
            return started.status === "deferred" ? "deferred" as const : "handled" as const;
        });
        const onError = vi.fn();
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => {
                    throw sessionNotFoundHttpError();
                }),
                subscribeSessionEvents: vi.fn(async () => never()),
            },
            onSessionNotFound,
            onError,
        });

        const foreground = loads.beginForeground("project:a");
        const syncing = stream.syncRecovery("snapshot_required");
        await vi.waitFor(() => expect(onSessionNotFound).toHaveBeenCalledOnce());

        await loads.finish(foreground);
        await expect(syncing).resolves.toBe(true);
        expect(work).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();

        const nextForeground = loads.beginForeground("project:a");
        const replaying = stream.syncRecovery("snapshot_required");
        await vi.waitFor(() => expect(onSessionNotFound).toHaveBeenCalledTimes(2));

        await loads.finish(nextForeground, true);
        await expect(replaying).resolves.toBe(true);
        expect(work).toHaveBeenCalledOnce();
        expect(onError).not.toHaveBeenCalled();
    });

    it("404 ignored 结果不再发布普通错误", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1));
        const onSessionNotFound = vi.fn(async () => "ignored" as const);
        const onError = vi.fn();
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => {
                    throw sessionNotFoundHttpError();
                }),
                subscribeSessionEvents: vi.fn(async () => never()),
            },
            onSessionNotFound,
            onError,
        });

        await expect(stream.syncRecovery("snapshot_required")).resolves.toBe(false);
        expect(onSessionNotFound).toHaveBeenCalledOnce();
        expect(onError).not.toHaveBeenCalled();
    });

    it("强制 recovery 的 Session Not Found 交给专用回调而不向调用方抛出", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1));
        const onSessionNotFound = vi.fn(async () => undefined);
        const onError = vi.fn();
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => {
                    throw sessionNotFoundHttpError();
                }),
                subscribeSessionEvents: vi.fn(async () => never()),
            },
            onSessionNotFound,
            onError,
        });

        await expect(stream.refreshRecovery("manual_refresh")).resolves.toBe(true);
        expect(onSessionNotFound).toHaveBeenCalledTimes(1);
        expect(onError).not.toHaveBeenCalled();
    });

    it("新 event epoch 触发的 Session Not Found 进入专用恢复", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1));
        const onSessionNotFound = vi.fn(async () => undefined);
        const onError = vi.fn();
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => {
                    throw sessionNotFoundHttpError();
                }),
                subscribeSessionEvents: vi.fn(async (_sessionId, _cursor, onEvent, signal, options) => {
                    options?.onOpen?.();
                    await onEvent({
                        ...control(2, {type: "connected", eventEpoch: "epoch-2", latestSeq: 2}),
                        eventEpoch: "epoch-2",
                    });
                    await untilAbort(signal);
                }),
            },
            onSessionNotFound,
            onError,
        });

        await stream.start(1);
        await vi.waitFor(() => expect(onSessionNotFound).toHaveBeenCalledTimes(1));
        expect(onError).not.toHaveBeenCalled();
        stream.stop();
    });

    it("Session Not Found 到达时 owner 已失效则静默丢弃", async () => {
        const session = useAgentSession();
        const activeSessionId = ref<number | null>(1);
        session.applyRecovery(recovery(1, 1));
        const request = deferred<AgentSessionRecoveryDto>();
        const onSessionNotFound = vi.fn(async () => undefined);
        const onError = vi.fn();
        const stream = useAgentSessionStream({
            session,
            activeSessionId,
            api: {
                getSessionRecovery: vi.fn(() => request.promise),
                subscribeSessionEvents: vi.fn(async () => never()),
            },
            onSessionNotFound,
            onError,
        });

        const recoveryRequest = stream.syncRecovery("snapshot_required");
        activeSessionId.value = 2;
        request.reject(sessionNotFoundHttpError());

        await expect(recoveryRequest).resolves.toBe(false);
        expect(onSessionNotFound).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
    });

    it("未配置专用回调时保持普通 recovery 错误行为", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1));
        const onError = vi.fn();
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => {
                    throw sessionNotFoundHttpError();
                }),
                subscribeSessionEvents: vi.fn(async () => never()),
            },
            onError,
        });

        await expect(stream.syncRecovery("snapshot_required")).resolves.toBe(false);
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it("关联 Session 缺失走普通 recovery 错误出口，不调用 Session Not Found 回调", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1));
        session.requestRecovery("snapshot_required");
        const onSessionNotFound = vi.fn(async () => undefined);
        const onError = vi.fn();
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => {
                    throw sessionDependencyNotFoundHttpError();
                }),
                subscribeSessionEvents: vi.fn(async () => never()),
            },
            onSessionNotFound,
            onError,
        });

        await expect(stream.syncRecovery("snapshot_required")).resolves.toBe(false);
        expect(onSessionNotFound).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledOnce();
        expect(session.needsRecovery.value).toBe(false);
        expect(session.connectionStatus.value).toBe("idle");
    });

    it("活动连接遇到关联 Session 缺失时清除 latch，不重复发起 recovery", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1));
        const getSessionRecovery = vi.fn(async () => {
            throw sessionDependencyNotFoundHttpError();
        });
        const onError = vi.fn();
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery,
                subscribeSessionEvents: vi.fn(async (_sessionId, _cursor, onEvent, signal, options) => {
                    options?.onOpen?.();
                    await onEvent(control(2, {type: "snapshot_required", reason: "dependency missing"}));
                    await untilAbort(signal);
                }),
            },
            onError,
        });

        await stream.start(1);
        await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
        expect(getSessionRecovery).toHaveBeenCalledOnce();
        expect(session.needsRecovery.value).toBe(false);
        expect(session.connectionStatus.value).toBe("connected");
        stream.stop();
    });

    it("强制 recovery 的关联 Session 缺失保留调用方错误，不调用专用回调", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1));
        session.requestRecovery("snapshot_required");
        const onSessionNotFound = vi.fn(async () => undefined);
        const onError = vi.fn();
        const error = sessionDependencyNotFoundHttpError();
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => {
                    throw error;
                }),
                subscribeSessionEvents: vi.fn(async () => never()),
            },
            onSessionNotFound,
            onError,
        });

        await expect(stream.refreshRecovery("manual_refresh")).rejects.toBe(error);
        expect(onSessionNotFound).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        expect(session.needsRecovery.value).toBe(false);
        expect(session.connectionStatus.value).toBe("idle");
    });

    it("强制 recovery 开启新 generation，旧成功和旧错误都静默失效", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1));
        const first = deferred<AgentSessionRecoveryDto>();
        const second = deferred<AgentSessionRecoveryDto>();
        const getSessionRecovery = vi.fn()
            .mockImplementationOnce(() => first.promise)
            .mockImplementationOnce(() => second.promise);
        const onError = vi.fn();
        const sideEffects = vi.fn();
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {getSessionRecovery, subscribeSessionEvents: vi.fn(async () => never())},
            applyRecoverySideEffects: sideEffects,
            onError,
        });

        const stale = stream.syncRecovery("manual_refresh");
        const current = stream.refreshRecovery("manual_refresh");
        expect(getSessionRecovery).toHaveBeenCalledTimes(2);

        first.reject(new Error("stale failure"));
        await expect(stale).resolves.toBe(false);
        expect(onError).not.toHaveBeenCalled();

        second.resolve(recovery(1, 8));
        await expect(current).resolves.toBe(true);
        expect(session.lastSeq.value).toBe(8);
        expect(sideEffects).toHaveBeenCalledTimes(1);
    });

    it("事件副作用等待期间切换 Session 后不应用旧事件", async () => {
        const session = useAgentSession();
        const activeSessionId = ref<number | null>(1);
        session.applyRecovery(recovery(1, 1));
        const blocked = deferred<void>();
        const stream = useAgentSessionStream({
            session,
            activeSessionId,
            api: {
                getSessionRecovery: vi.fn(async () => recovery(1, 1)),
                subscribeSessionEvents: vi.fn(async (_sessionId, _cursor, onEvent, signal, options) => {
                    options?.onOpen?.();
                    await onEvent(control(2, {type: "follow_up_queued", item: {id: "old", clientMessageId: "message-old", kind: "followup", text: {preview: "旧消息", bytes: 9, omitted: false}, images: [], omittedImages: 0, createdAt: 1}}));
                    await untilAbort(signal);
                }),
            },
            onEvent: async () => blocked.promise,
        });

        const started = stream.start(1);
        await Promise.resolve();
        activeSessionId.value = 2;
        stream.stop();
        session.reset();
        session.applyRecovery(recovery(2, 9));
        blocked.resolve();

        await expect(started).resolves.toBeUndefined();
        expect(session.recoveryShell.value?.summary.sessionId).toBe(2);
        expect(session.recoveryShell.value?.followUpQueue.items).toEqual([]);
    });

    it("拒绝连接目标之外的 Session event envelope", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1));
        const onEvent = vi.fn();
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => recovery(1, 1)),
                subscribeSessionEvents: vi.fn(async (_sessionId, _cursor, emit, signal, options) => {
                    options?.onOpen?.();
                    await emit({...control(2, {type: "connected", eventEpoch: "epoch-1", latestSeq: 2}), sessionId: 2});
                    await untilAbort(signal);
                }),
            },
            onEvent,
        });

        await stream.start(1);

        expect(onEvent).not.toHaveBeenCalled();
        expect(session.lastSeq.value).toBe(1);
        stream.stop();
    });

    it("invalid cursor 并发 recovery 只执行一次窗口重置副作用", async () => {
        const session = useAgentSession();
        session.applyRecovery({
            ...recovery(1, 1, "rev-1"),
            history: {entries: [], previousCursor: "invalid-cursor"},
        });
        await session.loadPrevious(async () => {
            throw {statusCode: 400, data: {code: "INVALID_HISTORY_CURSOR", message: "cursor 已失效"}};
        });
        let resolveRecovery!: (value: AgentSessionRecoveryDto) => void;
        const getSessionRecovery = vi.fn(() => new Promise<AgentSessionRecoveryDto>((resolve) => {
            resolveRecovery = resolve;
        }));
        const applyRecoverySideEffects = vi.fn();
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {getSessionRecovery, subscribeSessionEvents: vi.fn(async () => {})},
            applyRecoverySideEffects,
        });

        const historyRecovery = stream.syncRecovery("invalid_history_cursor");
        const sseRecovery = stream.syncRecovery("snapshot_required");
        expect(getSessionRecovery).toHaveBeenCalledTimes(1);
        resolveRecovery(recovery(1, 2, "rev-1"));

        await expect(historyRecovery).resolves.toBe(true);
        await expect(sseRecovery).resolves.toBe(true);
        expect(applyRecoverySideEffects).toHaveBeenCalledTimes(1);
        expect(applyRecoverySideEffects).toHaveBeenCalledWith(
            expect.anything(),
            {historyWindowReset: true},
            expect.objectContaining({sessionId: 1, isCurrent: expect.any(Function)}),
        );
    });

    it("invalid cursor recovery 失败时保留当前内容且不执行重置副作用", async () => {
        const session = useAgentSession();
        session.applyRecovery({
            ...recovery(1, 1, "rev-1"),
            history: {entries: [userEntry("existing", "当前内容")], previousCursor: "invalid-cursor"},
        });
        await session.loadPrevious(async () => {
            throw {statusCode: 400, data: {code: "INVALID_HISTORY_CURSOR", message: "cursor 已失效"}};
        });
        const applyRecoverySideEffects = vi.fn();
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => {
                    throw new Error("recovery failed");
                }),
                subscribeSessionEvents: vi.fn(async () => {}),
            },
            applyRecoverySideEffects,
        });

        await expect(stream.syncRecovery("invalid_history_cursor")).resolves.toBe(false);

        expect(session.durableEntries.value.map((entry) => entry.id)).toEqual(["existing"]);
        expect(session.historyError.value).toBe("cursor 已失效");
        expect(session.needsRecovery.value).toBe(false);
        expect(session.connectionStatus.value).toBe("idle");
        expect(applyRecoverySideEffects).not.toHaveBeenCalled();
    });

    it("等待异步事件副作用完成后再应用下一帧", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1));
        const appliedSeq: number[] = [];
        let release!: () => void;
        const blocked = new Promise<void>((resolve) => {
            release = resolve;
        });
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => recovery(1, 1)),
                subscribeSessionEvents: vi.fn(async (_sessionId, _cursor, onEvent, _signal, options) => {
                    options?.onOpen?.();
                    await onEvent(control(2, {type: "client_variable_patch_requested", request: {namespace: "client", path: "ide.selection", operations: []}}));
                    appliedSeq.push(session.lastSeq.value);
                    await onEvent(control(3, {type: "follow_up_queued", item: {id: "follow-1", clientMessageId: "message-follow-1", kind: "followup", text: {preview: "继续", bytes: 6, omitted: false}, images: [], omittedImages: 0, createdAt: 1}}));
                    appliedSeq.push(session.lastSeq.value);
                    await never();
                }),
            },
            onEvent: async (event) => {
                if (event.kind === "session" && event.event.type === "client_variable_patch_requested") await blocked;
            },
        });

        const started = stream.start(1);
        await Promise.resolve();
        expect(appliedSeq).toEqual([]);
        release();
        await started;
        await vi.waitFor(() => expect(appliedSeq).toEqual([2, 3]));
        stream.stop();
    });

    it("连续重连失败后进入 disconnected，并允许手动重连", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 5));
        let fail = true;
        const subscribeSessionEvents = vi.fn(async (_sessionId: number, _cursor: AgentSessionEventsQueryDto, _onEvent: (event: AgentSessionEventDto) => void, _signal?: AbortSignal, options?: {onOpen?: () => void}) => {
            if (fail) throw new Error("network down");
            options?.onOpen?.();
            await never();
        });
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {getSessionRecovery: vi.fn(async () => recovery(1, 5)), subscribeSessionEvents},
        });

        await expect(stream.start(1)).rejects.toThrow("network down");
        await vi.advanceTimersByTimeAsync(300);
        await vi.advanceTimersByTimeAsync(800);
        await vi.advanceTimersByTimeAsync(1500);
        expect(session.connectionStatus.value).toBe("disconnected");

        fail = false;
        await stream.reconnectNow();
        expect(session.connectionStatus.value).toBe("connected");
        expect(subscribeSessionEvents).toHaveBeenCalledTimes(5);
        stream.stop();
    });

    it("服务端迟迟不返回 headers 时握手超时，start 拒绝并安排重连", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 0));
        const subscribeSessionEvents = vi.fn(async (
            _sessionId: number,
            _cursor: AgentSessionEventsQueryDto,
            _onEvent: (event: AgentSessionEventDto) => void,
            signal?: AbortSignal,
        ) => untilAbort(signal));
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => recovery(1, 0)),
                subscribeSessionEvents,
            },
        });

        const starting = stream.start(1);
        const rejection = expect(starting).rejects.toThrow("connect timeout");
        await vi.advanceTimersByTimeAsync(15_000);
        await rejection;
        expect(session.connectionStatus.value).toBe("reconnecting");
        await vi.advanceTimersByTimeAsync(300);
        expect(subscribeSessionEvents).toHaveBeenCalledTimes(2);
        stream.stop();
    });
});

function recovery(sessionId: number, after: number, revision: string | null = null): AgentSessionRecoveryDto {
    return {
        kind: "recovery",
        eventCursor: {eventEpoch: "epoch-1", after},
        summary: {sessionId, sessionIdentity: "sha256:0000000000000000000000000000000000000000000000000000000000000000", profileKey: "leader.default", status: "idle", updatedAt: 1, archived: false},
        activeLeafId: null,
        activePathRevision: revision,
        history: {entries: [], previousCursor: null},
        tree: [],
        linkedAgents: [],
        linkedByAgents: [],
        pendingUserInputs: [],
        steerQueue: {items: [], omittedItems: 0},
        followUpQueue: {status: "ready", items: [], omittedItems: 0},
        activeInvocation: null,
        model: null,
        thinkingLevel: null,
        effectiveThinkingLevel: "off",
        agentMode: "normal",
    };
}

function userEntry(id: string, content: string): AgentChatEntryDto {
    const bytes = Buffer.byteLength(content, "utf8");
    return {
        id,
        clientMessageId: `message-${id}`,
        timestamp: 1,
        type: "user",
        intent: "normal",
        blocks: [{type: "text", contentIndex: 0, content: {preview: content, bytes, omitted: false}}],
        omittedBlocks: 0,
        textSummary: {bytes, omitted: false},
    };
}

function liveState(sessionId: number) {
    const value = recovery(sessionId, 0);
    return {
        summary: value.summary,
        activeLeafId: value.activeLeafId,
        activePathRevision: value.activePathRevision,
        pendingUserInputs: value.pendingUserInputs,
        steerQueue: {count: value.steerQueue.items.length + value.steerQueue.omittedItems},
        followUpQueue: {status: value.followUpQueue.status, count: value.followUpQueue.items.length + value.followUpQueue.omittedItems},
        activeInvocation: value.activeInvocation,
        model: value.model,
        thinkingLevel: value.thinkingLevel,
        effectiveThinkingLevel: value.effectiveThinkingLevel,
        agentMode: value.agentMode,
    };
}

function connected(latestSeq: number): AgentSessionEventDto {
    return control(latestSeq, {type: "connected", eventEpoch: "epoch-1", latestSeq});
}

function control(seq: number, event: Extract<AgentSessionEventDto, {kind: "session"}>["event"]): AgentSessionEventDto {
    return {eventEpoch: "epoch-1", seq, sessionId: 1, kind: "session", event};
}

function deferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return {promise, resolve, reject};
}

function never(): Promise<void> {
    return new Promise<void>(() => {});
}

function untilAbort(signal?: AbortSignal): Promise<void> {
    if (!signal) return never();
    if (signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), {once: true}));
}

function sessionNotFoundHttpError(): {response: {_data: {data: {code: "SESSION_NOT_FOUND"}}}} {
    return {response: {_data: {data: {code: "SESSION_NOT_FOUND"}}}};
}

function sessionDependencyNotFoundHttpError(): {response: {_data: {data: {code: "SESSION_DEPENDENCY_NOT_FOUND"}}}} {
    return {response: {_data: {data: {code: "SESSION_DEPENDENCY_NOT_FOUND"}}}};
}
