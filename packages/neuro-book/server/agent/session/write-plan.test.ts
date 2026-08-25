import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {randomUUID} from "node:crypto";
import {readFile, rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {AgentSessionEventHub} from "nbook/server/agent/events/session-event-hub";
import {createAssistantTextMessage, createTextToolResult} from "nbook/server/agent/messages/message-utils";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {SessionWriteExecutor} from "nbook/server/agent/session/write-plan";
import type {SessionWriteTimingSink} from "nbook/server/agent/session/write-plan";
import type {AgentSessionEventDto} from "nbook/shared/dto/agent-session.dto";
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
