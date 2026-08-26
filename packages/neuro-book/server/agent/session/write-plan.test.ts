import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {randomUUID} from "node:crypto";
import {readFile, rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {AgentSessionEventHub} from "nbook/server/agent/events/session-event-hub";
import {createAssistantTextMessage, createTextToolResult} from "nbook/server/agent/messages/message-utils";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {SessionWriteExecutor} from "nbook/server/agent/session/write-plan";
import type {SessionWritePlan, SessionWriteTimingSink} from "nbook/server/agent/session/write-plan";
import type {SessionSnapshot} from "nbook/server/agent/session/types";
import type {AgentSessionEventDto, AgentSessionLiveStateDto} from "nbook/shared/dto/agent-session.dto";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

describe("SessionWriteExecutor", () => {
    let root: AbsoluteFsPath;
    let repo: JsonlSessionRepository;
    let eventHub: AgentSessionEventHub;
    let executor: SessionWriteExecutor;
    let liveStateCalls: number;

    beforeEach(() => {
        root = absoluteFsPath(testHostPath("agent-write-plan-test", randomUUID()));
        repo = new JsonlSessionRepository(root);
        eventHub = new AgentSessionEventHub();
        liveStateCalls = 0;
        executor = new SessionWriteExecutor({
            repo,
            eventHub,
            liveStateProvider: async (sessionId) => {
                liveStateCalls += 1;
                return {
                    summary: {
                        sessionId,
                        sessionIdentity: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
                        profileKey: "leader.default",
                        status: "idle",
                        updatedAt: 1,
                        archived: false,
                    },
                    activeLeafId: null,
                    activePathRevision: null,
                    pendingUserInputs: [],
                    pendingApprovals: [],
                    steerQueue: {count: 0},
                    followUpQueue: {
                        status: "ready",
                        count: 0,
                    },
                    activeInvocation: null,
                    model: null,
                    thinkingLevel: null,
                    effectiveThinkingLevel: "off",
                    agentMode: "normal",
                };
            },
        });
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    it("要求 write plan 必须有 target 和 cause", async () => {
        await expect(executor.execute([{
            target: {sessionId: 0},
            cause: "test",
            ops: [],
        }])).rejects.toThrow("target.sessionId");

        await expect(executor.execute([{
            target: {sessionId: 1},
            cause: "",
            ops: [],
        }])).rejects.toThrow("cause");
    });

    it("按顺序写入 batch 并发布 session events", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const events: string[] = [];
        let stateChangedEvent: AgentSessionEventDto | undefined;
        const subscription = eventHub.subscribe(session.metadata.sessionId);
        const iterator = subscription[Symbol.asyncIterator]();
        const timing = createTimingRecorder();

        const result = await executor.execute([{
            target: {sessionId: session.metadata.sessionId},
            cause: "test",
            ops: [{
                kind: "appendMany",
                entries: [
                    {
                        type: "message",
                        message: createAssistantTextMessage({text: "assistant"}),
                        origin: "harness",
                    },
                    {
                        type: "message",
                        message: createTextToolResult({
                            toolCallId: "tool-1",
                            toolName: "read",
                            text: "ok",
                        }),
                        origin: "harness",
                    },
                ],
            }],
        }], "invoke-1", {timing: timing.sink});

        for (let index = 0; index < 3; index += 1) {
            const event = await iterator.next();
            if (!event.done) {
                const payload = event.value.payload;
                events.push(payload.kind === "session" ? payload.event.type : payload.kind);
                if (payload.kind === "session" && payload.event.type === "session_state_changed") {
                    stateChangedEvent = payload;
                }
            }
        }
        await iterator.return?.();
        expect(result.entries.map((entry) => entry.type)).toEqual(["message", "message"]);
        expect(events).toEqual(["session_entry", "session_entry", "session_state_changed"]);
        expect(stateChangedEvent?.kind).toBe("session");
        if (stateChangedEvent?.kind === "session" && stateChangedEvent.event.type === "session_state_changed") {
            expect(stateChangedEvent.event).not.toHaveProperty("snapshot");
            expect(stateChangedEvent.event.state.summary.sessionId).toBe(session.metadata.sessionId);
            expect(stateChangedEvent.event.state).not.toHaveProperty("messages");
            expect(stateChangedEvent.event.state).not.toHaveProperty("entries");
            expect(stateChangedEvent.event.state).not.toHaveProperty("tree");
            expect(Buffer.byteLength(JSON.stringify(stateChangedEvent), "utf8")).toBeLessThan(50 * 1024);
        }
        expect(repo.reduce(await repo.readSession(session.metadata.sessionId)).messages.map((message) => message.role)).toEqual(["assistant", "toolResult"]);
        expect(result.liveStates.get(session.metadata.sessionId)).toEqual(
            stateChangedEvent?.kind === "session" && stateChangedEvent.event.type === "session_state_changed"
                ? stateChangedEvent.event.state
                : undefined,
        );
        expect(liveStateCalls).toBe(1);
        expect(timing.events).toEqual([
            "writePlan:start",
            "writePlan:end",
            `liveState:${String(session.metadata.sessionId)}:start`,
            `liveState:${String(session.metadata.sessionId)}:end`,
        ]);
    });

    it("连续 savePoint plans 会合并成同一个 session batch", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const timing = createTimingRecorder();

        await executor.execute([
            {
                target: {sessionId: session.metadata.sessionId},
                cause: "turn.ingest",
                durability: "savePoint",
                ops: [{
                    kind: "appendMany",
                    entries: [
                        {
                            type: "message",
                            message: createAssistantTextMessage({text: "assistant"}),
                            origin: "harness",
                        },
                        {
                            type: "message",
                            message: createTextToolResult({
                                toolCallId: "tool-1",
                                toolName: "read",
                                text: "ok",
                            }),
                            origin: "harness",
                        },
                    ],
                }],
            },
            {
                target: {sessionId: session.metadata.sessionId},
                cause: "tool.state",
                durability: "savePoint",
                ops: [{
                    kind: "append",
                    entry: {
                        type: "custom",
                        key: "test.tool.state",
                        value: "queued",
                    },
                }],
            },
        ], "invoke-1", {timing: timing.sink});

        const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(session.metadata.sessionId)}.jsonl`);
        const records = (await readFile(sessionPath, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line) as {kind: string; entries?: Array<{type: string; key?: string; message?: {role?: string}}>});
        const batches = records.filter((record) => record.kind === "batch");
        expect(batches).toHaveLength(1);
        expect((batches[0]?.entries ?? [])
            .filter((entry) => entry.type !== "leaf")
            .map((entry) => entry.type === "message" ? entry.message?.role : entry.key)).toEqual([
            "assistant",
            "toolResult",
            "test.tool.state",
        ]);
        expect(timing.events).toEqual([
            "writePlan:start",
            "writePlan:end",
            `liveState:${String(session.metadata.sessionId)}:start`,
            `liveState:${String(session.metadata.sessionId)}:end`,
        ]);
    });

    it("after-write observer 收到实际落盘 batch，且早于 live state 计算", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const observed: Array<{
            sessionId: number;
            cause: string;
            invocationId?: string;
            entries: string[];
            liveStateCallsAtNotify: number;
        }> = [];
        executor = new SessionWriteExecutor({
            repo,
            eventHub,
            liveStateProvider: async (sessionId) => {
                liveStateCalls += 1;
                return {
                    summary: {
                        sessionId,
                        sessionIdentity: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
                        profileKey: "leader.default",
                        status: "idle",
                        updatedAt: 1,
                        archived: false,
                    },
                    activeLeafId: null,
                    activePathRevision: null,
                    pendingUserInputs: [],
                    pendingApprovals: [],
                    steerQueue: {count: 0},
                    followUpQueue: {
                        status: "ready",
                        count: 0,
                    },
                    activeInvocation: null,
                    model: null,
                    thinkingLevel: null,
                    effectiveThinkingLevel: "off",
                    agentMode: "normal",
                };
            },
            onEntriesWritten: (batch) => {
                observed.push({
                    sessionId: batch.sessionId,
                    cause: batch.cause,
                    invocationId: batch.invocationId,
                    entries: batch.entries.map((entry) => entry.type === "custom" ? entry.key : entry.type),
                    liveStateCallsAtNotify: liveStateCalls,
                });
            },
        });

        const result = await executor.execute([
            {
                target: {sessionId: session.metadata.sessionId},
                cause: "turn.ingest",
                durability: "savePoint",
                ops: [{
                    kind: "append",
                    entry: {
                        type: "message",
                        message: createAssistantTextMessage({text: "assistant"}),
                        origin: "harness",
                    },
                }],
            },
            {
                target: {sessionId: session.metadata.sessionId},
                cause: "tool.state",
                durability: "savePoint",
                ops: [{
                    kind: "append",
                    entry: {
                        type: "custom",
                        key: "test.tool.state",
                        value: "queued",
                    },
                }],
            },
        ], "invoke-observer");

        expect(observed).toEqual([
            {
                sessionId: session.metadata.sessionId,
                cause: "turn.ingest",
                invocationId: "invoke-observer",
                entries: ["message", "test.tool.state"],
                liveStateCallsAtNotify: 0,
            },
        ]);
        expect(result.liveStates.get(session.metadata.sessionId)).toBeDefined();
        expect(liveStateCalls).toBe(1);
    });

    it("after-write observer 失败不阻断已落盘写入和 live state 发布", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        executor = new SessionWriteExecutor({
            repo,
            eventHub,
            liveStateProvider: async (sessionId) => {
                liveStateCalls += 1;
                return {
                    summary: {
                        sessionId,
                        sessionIdentity: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
                        profileKey: "leader.default",
                        status: "idle",
                        updatedAt: 1,
                        archived: false,
                    },
                    activeLeafId: null,
                    activePathRevision: null,
                    pendingUserInputs: [],
                    pendingApprovals: [],
                    steerQueue: {count: 0},
                    followUpQueue: {
                        status: "ready",
                        count: 0,
                    },
                    activeInvocation: null,
                    model: null,
                    thinkingLevel: null,
                    effectiveThinkingLevel: "off",
                    agentMode: "normal",
                };
            },
            onEntriesWritten: () => {
                throw new Error("observer failed");
            },
        });

        const result = await executor.execute([{
            target: {sessionId: session.metadata.sessionId},
            cause: "observer.failure",
            ops: [{
                kind: "append",
                entry: {
                    type: "message",
                    message: createAssistantTextMessage({text: "still persisted"}),
                    origin: "harness",
                },
            }],
        }], "invoke-observer-failure");

        expect(result.entries).toHaveLength(1);
        expect(result.liveStates.get(session.metadata.sessionId)).toBeDefined();
        expect(liveStateCalls).toBe(1);
        expect(repo.reduce(await repo.readSession(session.metadata.sessionId)).messages.map((message) => message.role)).toEqual(["assistant"]);
    });

    it("projection 写入不移动 active leaf", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const user = await repo.appendUserMessage(session.metadata.sessionId, "hello");

        await executor.execute([{
            target: {sessionId: session.metadata.sessionId},
            cause: "projection",
            ops: [{
                kind: "append",
                projection: true,
                entry: {
                    type: "session_update",
                    updates: {
                        title: "Title",
                    },
                },
            }],
        }]);

        const snapshot = await repo.readSession(session.metadata.sessionId);
        expect(snapshot.leafId).toBe(user.id);
        expect(repo.reduce(snapshot).title).toBe("Title");
    });

    it("同一个 session 的并发写入会串行执行", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const originalAppendEntry = repo.appendEntry.bind(repo);
        let activeAppends = 0;
        let maxActiveAppends = 0;
        repo.appendEntry = async (...args: Parameters<JsonlSessionRepository["appendEntry"]>): ReturnType<JsonlSessionRepository["appendEntry"]> => {
            activeAppends += 1;
            maxActiveAppends = Math.max(maxActiveAppends, activeAppends);
            await new Promise((resolve) => setTimeout(resolve, 10));
            try {
                return await originalAppendEntry(...args);
            } finally {
                activeAppends -= 1;
            }
        };

        await Promise.all([
            executor.execute([{
                target: {sessionId: session.metadata.sessionId},
                cause: "concurrent.first",
                ops: [{
                    kind: "append",
                    entry: {
                        type: "message",
                        message: createAssistantTextMessage({text: "first"}),
                        origin: "harness",
                    },
                }],
            }]),
            executor.execute([{
                target: {sessionId: session.metadata.sessionId},
                cause: "concurrent.second",
                ops: [{
                    kind: "append",
                    entry: {
                        type: "message",
                        message: createAssistantTextMessage({text: "second"}),
                        origin: "harness",
                    },
                }],
            }]),
        ]);

        expect(maxActiveAppends).toBe(1);
        expect(repo.reduce(await repo.readSession(session.metadata.sessionId)).messages.map((message) => message.role)).toEqual(["assistant", "assistant"]);
    });

    it("普通 invocation 失去 ownership 后拒绝写入", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        executor = new SessionWriteExecutor({
            repo,
            eventHub,
            liveStateProvider: async () => testLiveState(session.metadata.sessionId),
            invocationWriteAllowed: () => false,
        });

        await expect(executor.execute([{
            target: {sessionId: session.metadata.sessionId},
            cause: "lifecycle.start",
            ops: [{
                kind: "append",
                entry: {
                    type: "invocation_lifecycle",
                    invocationId: "old-invocation",
                    status: "start",
                },
            }],
        }], "old-invocation")).rejects.toThrow("已失去 session");

        expect(lifecycleStatuses(await repo.readSession(session.metadata.sessionId))).toEqual([]);
    });

    it("强制取消写入必须持有精确 tombstone 并发布归属事件", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const authorizations = new Set<string>();
        executor = new SessionWriteExecutor({
            repo,
            eventHub,
            liveStateProvider: async () => testLiveState(session.metadata.sessionId),
            forcedAbortWriteAllowed: (sessionId: number, invocationId: string) => authorizations.has(`${String(sessionId)}:${invocationId}`),
        });
        const forced = executor as unknown as ForcedAbortExecutor;
        const plan = forcedAbortPlan(session.metadata.sessionId, "old-invocation");

        expect(() => forced.enqueueForcedAbort(plan, "old-invocation")).toThrow("强制取消");
        expect(lifecycleStatuses(await repo.readSession(session.metadata.sessionId))).toEqual([]);

        authorizations.add(`${String(session.metadata.sessionId)}:old-invocation`);
        const subscription = eventHub.subscribe(session.metadata.sessionId);
        const iterator = subscription[Symbol.asyncIterator]();
        await forced.enqueueForcedAbort(plan, "old-invocation").completion;
        const stateEvent = await iterator.next();
        await iterator.return?.();

        expect(lifecycleStatuses(await repo.readSession(session.metadata.sessionId))).toEqual(["aborted"]);
        const payload = stateEvent.done ? undefined : stateEvent.value.payload;
        expect(payload?.kind === "session" && payload.event.type === "session_state_changed"
            && payload.invocationId === "old-invocation").toBe(true);
    });

    it("强制取消终态同步入队，保证先于下一 invocation start", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const authorizations = new Set([`${String(session.metadata.sessionId)}:old-invocation`]);
        executor = new SessionWriteExecutor({
            repo,
            eventHub,
            liveStateProvider: async () => testLiveState(session.metadata.sessionId),
            invocationWriteAllowed: (_sessionId: number, invocationId: string) => invocationId === "new-invocation",
            forcedAbortWriteAllowed: (sessionId: number, invocationId: string) => authorizations.has(`${String(sessionId)}:${invocationId}`),
        });
        const forced = executor as unknown as ForcedAbortExecutor;
        const originalAppendEntry = repo.appendEntry.bind(repo);
        const abortWriteStarted = Promise.withResolvers<void>();
        const abortWriteGate = Promise.withResolvers<void>();
        repo.appendEntry = async (...args: Parameters<JsonlSessionRepository["appendEntry"]>) => {
            const entry = args[1];
            if (entry.type === "invocation_lifecycle" && entry.invocationId === "old-invocation" && entry.status === "aborted") {
                abortWriteStarted.resolve();
                await abortWriteGate.promise;
            }
            return originalAppendEntry(...args);
        };

        const forcedWrite = forced.enqueueForcedAbort(
            forcedAbortPlan(session.metadata.sessionId, "old-invocation"),
            "old-invocation",
        ).completion;
        await abortWriteStarted.promise;
        let nextSettled = false;
        const nextWrite = executor.execute([{
            target: {sessionId: session.metadata.sessionId},
            cause: "lifecycle.start",
            ops: [{
                kind: "append",
                entry: {
                    type: "invocation_lifecycle",
                    invocationId: "new-invocation",
                    status: "start",
                },
            }],
        }], "new-invocation").finally(() => {
            nextSettled = true;
        });

        // 固定观察窗是计划规定的时序合同：新 start 必须等旧 aborted 完成，而不是碰巧先到。
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(nextSettled).toBe(false);
        abortWriteGate.resolve();
        await Promise.all([forcedWrite, nextWrite]);

        expect(lifecycleStatuses(await repo.readSession(session.metadata.sessionId))).toEqual(["aborted", "start"]);
    });

    it("畸形强制取消计划在同步入队前拒绝", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        executor = new SessionWriteExecutor({
            repo,
            eventHub,
            liveStateProvider: async () => testLiveState(session.metadata.sessionId),
            forcedAbortWriteAllowed: () => true,
        });
        const forced = executor as unknown as ForcedAbortExecutor;
        const malformed = {
            ...forcedAbortPlan(session.metadata.sessionId, "old-invocation"),
            cause: "tool.state",
        };

        expect(() => forced.enqueueForcedAbort(malformed, "old-invocation")).toThrow("强制取消");
        expect(lifecycleStatuses(await repo.readSession(session.metadata.sessionId))).toEqual([]);
    });

    it("forced 计划不能通过普通 execute 绕过窄化授权", async () => {
        const session = await repo.createSession({profileKey: "leader.default", initial: {}});
        const plan = forcedAbortPlan(session.metadata.sessionId, "old-invocation");

        await expect(executor.execute([plan], "old-invocation")).rejects.toThrow("enqueueForcedAbort");
        expect(lifecycleStatuses(await repo.readSession(session.metadata.sessionId))).toEqual([]);
    });

    it("forced 入队会快照计划，调用方改写 target 也不越过原 Session 队列", async () => {
        const first = await repo.createSession({profileKey: "leader.default", initial: {}});
        const second = await repo.createSession({profileKey: "leader.default", initial: {}});
        const authorizations = new Set([
            `${String(first.metadata.sessionId)}:old-invocation`,
            `${String(second.metadata.sessionId)}:old-invocation`,
        ]);
        executor = new SessionWriteExecutor({
            repo,
            eventHub,
            liveStateProvider: async (sessionId) => testLiveState(sessionId),
            forcedAbortWriteAllowed: (sessionId: number, invocationId: string) => authorizations.has(`${String(sessionId)}:${invocationId}`),
        });
        const forced = executor as unknown as ForcedAbortExecutor;
        const plan = forcedAbortPlan(first.metadata.sessionId, "old-invocation");
        const completion = forced.enqueueForcedAbort(plan, "old-invocation").completion;
        plan.target.sessionId = second.metadata.sessionId;

        await completion;
        expect(lifecycleStatuses(await repo.readSession(first.metadata.sessionId))).toEqual(["aborted"]);
        expect(lifecycleStatuses(await repo.readSession(second.metadata.sessionId))).toEqual([]);
    });

    it("forced physical append 失败保留 recovery，重试后只追加一次 aborted", async () => {
        const session = await repo.createSession({profileKey: "leader.default", initial: {}});
        const authorizations = new Set([`${String(session.metadata.sessionId)}:old-invocation`]);
        const originalAppendEntry = repo.appendEntry.bind(repo);
        let failures = 1;
        repo.appendEntry = async (...args: Parameters<JsonlSessionRepository["appendEntry"]>): ReturnType<JsonlSessionRepository["appendEntry"]> => {
            const entry = args[1];
            if (entry.type === "invocation_lifecycle" && entry.invocationId === "old-invocation" && failures > 0) {
                failures -= 1;
                throw new Error("append unavailable");
            }
            return originalAppendEntry(...args);
        };
        executor = new SessionWriteExecutor({
            repo,
            eventHub,
            liveStateProvider: async () => testLiveState(session.metadata.sessionId),
            forcedAbortWriteAllowed: (sessionId: number, invocationId: string) => authorizations.has(`${String(sessionId)}:${invocationId}`),
        });
        const forced = executor as unknown as ForcedAbortExecutor;
        const plan = forcedAbortPlan(session.metadata.sessionId, "old-invocation");

        await expect(forced.enqueueForcedAbort(plan, "old-invocation").completion).rejects.toMatchObject({
            code: "session_abort_durability_unavailable",
            statusCode: 503,
        });
        expect(lifecycleStatuses(await repo.readSession(session.metadata.sessionId))).toEqual([]);
        await expect(forced.enqueueForcedAbort(plan, "old-invocation").completion).resolves.toBeDefined();
        expect(lifecycleStatuses(await repo.readSession(session.metadata.sessionId))).toEqual(["aborted"]);
    });

    it("partial lifecycle append 后 repair 失败可继续重试并只补一条 auto leaf", async () => {
        const session = await repo.createSession({profileKey: "leader.default", initial: {}});
        const authorizations = new Set([`${String(session.metadata.sessionId)}:old-invocation`]);
        const repositoryInternals = repo as unknown as {
            appendLine(path: string, record: unknown): Promise<void>;
        };
        const appendLine = repositoryInternals.appendLine.bind(repo);
        let appendLineCalls = 0;
        const appendLineSpy = vi.spyOn(repositoryInternals, "appendLine").mockImplementation(async (...args) => {
            appendLineCalls += 1;
            if (appendLineCalls === 2) {
                throw new Error("auto leaf unavailable");
            }
            return appendLine(...args);
        });
        let repairFailures = 1;
        const observedBatches: string[] = [];
        const observedEvents: string[] = [];
        const subscription = eventHub.subscribe(session.metadata.sessionId);
        const iterator = subscription[Symbol.asyncIterator]();
        executor = new SessionWriteExecutor({
            repo,
            eventHub,
            liveStateProvider: async () => testLiveState(session.metadata.sessionId),
            onEntriesWritten: (batch) => {
                observedBatches.push(`${batch.cause}:${batch.entries.map((entry) => entry.type).join(",")}`);
            },
            forcedAbortWriteAllowed: (sessionId: number, invocationId: string) => authorizations.has(`${String(sessionId)}:${invocationId}`),
        });
        const forced = executor as unknown as ForcedAbortExecutor;
        const originalEnsureAutoLeaf = repo.ensureAutoLeaf.bind(repo);
        const ensureAutoLeafSpy = vi.spyOn(repo, "ensureAutoLeaf").mockImplementation(async (...args) => {
            if (repairFailures > 0) {
                repairFailures -= 1;
                throw new Error("repair leaf unavailable");
            }
            return originalEnsureAutoLeaf(...args);
        });
        const plan = forcedAbortPlan(session.metadata.sessionId, "old-invocation");

        await expect(forced.enqueueForcedAbort(plan, "old-invocation").completion).rejects.toMatchObject({
            code: "session_abort_durability_unavailable",
            statusCode: 503,
        });
        const partial = await repo.readSession(session.metadata.sessionId);
        const lifecycle = partial.entries.find((entry) => entry.type === "invocation_lifecycle");
        expect(lifecycle?.status).toBe("aborted");
        expect(partial.leafId).not.toBe(lifecycle?.id);

        await expect(forced.enqueueForcedAbort(plan, "old-invocation").completion).rejects.toMatchObject({
            code: "session_abort_durability_unavailable",
            statusCode: 503,
        });
        expect(forced.hasPendingForcedAbortRecovery(session.metadata.sessionId, "old-invocation")).toBe(true);

        await expect(forced.enqueueForcedAbort(plan, "old-invocation").completion).resolves.toBeDefined();
        const repaired = await repo.readSession(session.metadata.sessionId);
        const repairedLifecycle = repaired.entries.find((entry) => entry.type === "invocation_lifecycle");
        expect(lifecycleStatuses(repaired)).toEqual(["aborted"]);
        expect(repaired.leafId).toBe(repairedLifecycle?.id);
        expect(repaired.entries.filter((entry) => entry.type === "leaf" && entry.leafId === repairedLifecycle?.id)).toHaveLength(1);
        expect(observedBatches).toEqual([
            "lifecycle.aborted.repair:leaf",
            "lifecycle.aborted.force:invocation_lifecycle",
        ]);

        const event = await iterator.next();
        if (!event.done) {
            observedEvents.push(event.value.payload.kind === "session" ? event.value.payload.event.type : event.value.payload.kind);
        }
        await iterator.return?.();
        expect(observedEvents).toEqual(["session_state_changed"]);
        appendLineSpy.mockRestore();
        ensureAutoLeafSpy.mockRestore();
    });
    it("forced live-state 失败保留 recovery，重试不重复追加 aborted", async () => {
        const session = await repo.createSession({profileKey: "leader.default", initial: {}});
        const authorizations = new Set([`${String(session.metadata.sessionId)}:old-invocation`]);
        let failures = 1;
        executor = new SessionWriteExecutor({
            repo,
            eventHub,
            liveStateProvider: async () => {
                if (failures > 0) {
                    failures -= 1;
                    throw new Error("live state unavailable");
                }
                return testLiveState(session.metadata.sessionId);
            },
            forcedAbortWriteAllowed: (sessionId: number, invocationId: string) => authorizations.has(`${String(sessionId)}:${invocationId}`),
        });
        const forced = executor as unknown as ForcedAbortExecutor;
        const plan = forcedAbortPlan(session.metadata.sessionId, "old-invocation");

        await expect(forced.enqueueForcedAbort(plan, "old-invocation").completion).rejects.toMatchObject({
            code: "session_abort_durability_unavailable",
            statusCode: 503,
        });
        expect(lifecycleStatuses(await repo.readSession(session.metadata.sessionId))).toEqual(["aborted"]);
        await expect(forced.enqueueForcedAbort(plan, "old-invocation").completion).resolves.toBeDefined();
        expect(lifecycleStatuses(await repo.readSession(session.metadata.sessionId))).toEqual(["aborted"]);
    });
    it("forced physical after-write 失败登记 recovery，重试不重复追加 aborted", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const authorizations = new Set([`${String(session.metadata.sessionId)}:old-invocation`]);
        let failures = 1;
        executor = new SessionWriteExecutor({
            repo,
            eventHub,
            liveStateProvider: async () => testLiveState(session.metadata.sessionId),
            onEntriesWritten: async () => {
                if (failures > 0) {
                    failures -= 1;
                    throw new Error("after-write unavailable");
                }
            },
            forcedAbortWriteAllowed: (sessionId: number, invocationId: string) => authorizations.has(`${String(sessionId)}:${invocationId}`),
        });
        const forced = executor as unknown as ForcedAbortExecutor;
        const plan = forcedAbortPlan(session.metadata.sessionId, "old-invocation");

        await expect(forced.enqueueForcedAbort(plan, "old-invocation").completion).rejects.toMatchObject({
            code: "session_abort_durability_unavailable",
            statusCode: 503,
        });
        expect(lifecycleStatuses(await repo.readSession(session.metadata.sessionId))).toEqual(["aborted"]);

        await expect(forced.enqueueForcedAbort(plan, "old-invocation").completion).resolves.toBeDefined();
        expect(lifecycleStatuses(await repo.readSession(session.metadata.sessionId))).toEqual(["aborted"]);
    });
    it("pending recovery 必须先于同一 session 的普通 start", async () => {
        const session = await repo.createSession({profileKey: "leader.default", initial: {}});
        const authorizations = new Set([`${String(session.metadata.sessionId)}:old-invocation`]);
        let afterWriteFailures = 1;
        const recoveryStarted = Promise.withResolvers<void>();
        const recoveryGate = Promise.withResolvers<void>();
        executor = new SessionWriteExecutor({
            repo,
            eventHub,
            liveStateProvider: async () => testLiveState(session.metadata.sessionId),
            onEntriesWritten: async (batch) => {
                if (batch.invocationId === "old-invocation" && afterWriteFailures > 0) {
                    afterWriteFailures -= 1;
                    throw new Error("after-write unavailable");
                }
                if (batch.invocationId === "old-invocation") {
                    recoveryStarted.resolve();
                    await recoveryGate.promise;
                }
            },
            forcedAbortWriteAllowed: (sessionId: number, invocationId: string) => authorizations.has(`${String(sessionId)}:${invocationId}`),
        });
        const forced = executor as unknown as ForcedAbortExecutor;
        const plan = forcedAbortPlan(session.metadata.sessionId, "old-invocation");
        await expect(forced.enqueueForcedAbort(plan, "old-invocation").completion).rejects.toMatchObject({statusCode: 503});

        const start = executor.execute([{
            target: {sessionId: session.metadata.sessionId},
            cause: "lifecycle.start",
            ops: [{kind: "append", entry: {type: "invocation_lifecycle", invocationId: "new-invocation", status: "start"}}],
        }], "new-invocation");
        await recoveryStarted.promise;
        let settled = false;
        void start.finally(() => {
            settled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(settled).toBe(false);
        recoveryGate.resolve();
        await start;
        expect(lifecycleStatuses(await repo.readSession(session.metadata.sessionId))).toEqual(["aborted", "start"]);
    });

    it("ensureAutoLeaf op 经同一 write queue 幂等补齐 active leaf", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const lifecycle = await repo.appendEntry(session.metadata.sessionId, {
            type: "invocation_lifecycle",
            invocationId: "old-invocation",
            status: "aborted",
        });
        await repo.moveLeaf(session.metadata.sessionId, null);

        const repairPlan: SessionWritePlan = {
            target: {sessionId: session.metadata.sessionId},
            cause: "lifecycle.aborted.repair",
            ops: [{kind: "ensureAutoLeaf", targetEntryId: lifecycle.id}],
        };
        const repaired = await executor.execute([repairPlan], "old-invocation");
        expect(repaired.entries).toHaveLength(1);
        expect(repaired.entries[0]).toMatchObject({type: "leaf", leafId: lifecycle.id});
        expect((await repo.readSession(session.metadata.sessionId)).leafId).toBe(lifecycle.id);

        const noop = await executor.execute([repairPlan], "old-invocation");
        expect(noop.entries).toEqual([]);
        expect(noop.liveStates).toEqual(new Map());
    });

    it("moveLeaf op 会移动 active leaf，并只发布有类型的 live state", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const user = await repo.appendUserMessage(session.metadata.sessionId, "hello");
        const subscription = eventHub.subscribe(session.metadata.sessionId);
        const iterator = subscription[Symbol.asyncIterator]();
        const timing = createTimingRecorder();

        const result = await executor.execute([{
            target: {sessionId: session.metadata.sessionId},
            cause: "tree.before",
            ops: [{
                kind: "moveLeaf",
                leafId: user.parentId,
            }],
        }], "invoke-1", {timing: timing.sink});

        const firstEvent = await iterator.next();
        await iterator.return?.();
        const snapshot = await repo.readSession(session.metadata.sessionId);
        expect(result.entries.map((entry) => entry.type)).toEqual(["leaf"]);
        expect(snapshot.leafId).toBeNull();
        const firstPayload = firstEvent.done ? undefined : firstEvent.value.payload;
        expect(firstPayload?.kind === "session" ? firstPayload.event.type : firstPayload?.kind).toBe("session_state_changed");
        expect(timing.events).toEqual([
            "writePlan:start",
            "writePlan:end",
            `liveState:${String(session.metadata.sessionId)}:start`,
            `liveState:${String(session.metadata.sessionId)}:end`,
        ]);
    });
});

type ForcedAbortExecutor = {
    enqueueForcedAbort(plan: SessionWritePlan, invocationId: string): {completion: Promise<unknown>};
    hasPendingForcedAbortRecovery(sessionId: number, invocationId: string): boolean;
};

function forcedAbortPlan(sessionId: number, invocationId: string): SessionWritePlan {
    return {
        target: {sessionId},
        cause: "lifecycle.aborted.force",
        ops: [{
            kind: "append",
            entry: {
                type: "invocation_lifecycle",
                invocationId,
                status: "aborted",
            },
        }],
    };
}

function lifecycleStatuses(snapshot: SessionSnapshot): string[] {
    return snapshot.entries
        .filter((entry) => entry.type === "invocation_lifecycle")
        .map((entry) => entry.status);
}

function testLiveState(sessionId: number): AgentSessionLiveStateDto {
    return {
        summary: {
            sessionId,
            sessionIdentity: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            profileKey: "leader.default",
            status: "idle",
            updatedAt: 1,
            archived: false,
        },
        activeLeafId: null,
        activePathRevision: null,
        pendingUserInputs: [],
        steerQueue: {count: 0},
        followUpQueue: {status: "ready", count: 0},
        activeInvocation: null,
        model: null,
        thinkingLevel: null,
        effectiveThinkingLevel: "off",
        agentMode: "normal",
    };
}

function createTimingRecorder(): {sink: SessionWriteTimingSink; events: string[]} {
    const events: string[] = [];
    return {
        events,
        sink: {
            async measureWritePlan<T>(task: () => Promise<T>): Promise<T> {
                events.push("writePlan:start");
                try {
                    return await task();
                } finally {
                    events.push("writePlan:end");
                }
            },
            async measureLiveState<T>(sessionId: number, task: () => Promise<T>): Promise<T> {
                events.push(`liveState:${String(sessionId)}:start`);
                try {
                    return await task();
                } finally {
                    events.push(`liveState:${String(sessionId)}:end`);
                }
            },
        },
    };
}
