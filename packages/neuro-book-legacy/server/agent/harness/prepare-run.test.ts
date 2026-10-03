import {describe, expect, it} from "vitest";
import {createUserMessage} from "nbook/server/agent/messages/message-utils";
import type {NeuroSessionContext, SessionSnapshot} from "nbook/server/agent/session/types";
import {buildPromptPrefixAttribution, compilePrepareRunWritePlan} from "nbook/server/agent/harness/prepare-run";

describe("prepare run reducer", () => {
    it("session context 启用时会编译 HistorySet 和 AppendingSet 写入", () => {
        const init = createUserMessage({text: "INIT"});
        const append = createUserMessage({text: "APPEND"});
        const modelAppend = createUserMessage({text: "MODEL_APPEND"});

        const plan = compilePrepareRunWritePlan({
            sessionId: 7,
            profileKey: "test.profile",
            context: fakeContext({messageCount: 0}),
            sessionContextEnabled: true,
            prepared: {
                historyInitMessages: [init],
                appendingMessages: [append],
                modelContextAppendingMessages: [modelAppend],
            },
        });

        expect(plan).toMatchObject({
            target: {sessionId: 7},
            cause: "profile.prepare",
            ops: [{
                kind: "appendMany",
                entries: [
                    {type: "custom_message", message: init, visibleToModel: true},
                    {type: "custom_message", message: modelAppend, visibleToModel: true},
                    {type: "custom_message", message: append, visibleToModel: true},
                ],
            }],
        });
    });

    it("session context 关闭时只保留 profile 私有 stateWrites", () => {
        const plan = compilePrepareRunWritePlan({
            sessionId: 7,
            profileKey: "test.profile",
            context: fakeContext({messageCount: 0}),
            sessionContextEnabled: false,
            prepared: {
                historyInitMessages: [createUserMessage({text: "INIT"})],
                appendingMessages: [createUserMessage({text: "APPEND"})],
                stateWrites: [{
                    type: "custom",
                    key: "profileState.test.profile",
                    value: {ok: true},
                }],
            },
        });

        expect(plan?.ops).toEqual([{
            kind: "appendMany",
            entries: [{
                type: "custom",
                key: "profileState.test.profile",
                value: {ok: true},
            }],
        }]);
    });

    it("已有消息时不会再次写入 history init messages", () => {
        const plan = compilePrepareRunWritePlan({
            sessionId: 7,
            profileKey: "test.profile",
            context: fakeContext({messageCount: 1}),
            sessionContextEnabled: true,
            prepared: {
                historyInitMessages: [createUserMessage({text: "INIT"})],
            },
        });

        expect(plan).toBeUndefined();
    });

    it("按分区写入 promptSource：HistorySet 与 AppendingSet 的 zone 和来源名各归各位", () => {
        const init = createUserMessage({text: "INIT"});
        const append = createUserMessage({text: "APPEND"});
        const modelAppend = createUserMessage({text: "MODEL_APPEND"});

        const plan = compilePrepareRunWritePlan({
            sessionId: 7,
            profileKey: "test.profile",
            context: fakeContext({messageCount: 0}),
            sessionContextEnabled: true,
            prepared: {
                historyInitMessages: [init],
                appendingMessages: [append],
                modelContextAppendingMessages: [modelAppend],
                promptSourceLabels: {
                    historyInit: [["Import:AGENTS.md"]],
                    appending: [["Reminder:agent-mode"]],
                    modelContextAppending: [["Reminder:workspace-focus"]],
                },
            },
        });

        const entries = plan?.ops[0]?.kind === "appendMany" ? plan.ops[0].entries : [];
        expect(entries.map((entry) => entry.type === "custom_message" ? entry.promptSource : null)).toEqual([
            {zone: "historySet", labels: ["Import:AGENTS.md"]},
            // modelContextAppending 排在 appending 之前，顺序错位会让归因整体串行。
            {zone: "appending", labels: ["Reminder:workspace-focus"]},
            {zone: "appending", labels: ["Reminder:agent-mode"]},
        ]);
    });

    it("无具名来源时仍写入 zone，匿名 AppendingSet 消息不会被当成普通对话", () => {
        const plan = compilePrepareRunWritePlan({
            sessionId: 7,
            profileKey: "test.profile",
            context: fakeContext({messageCount: 0}),
            sessionContextEnabled: true,
            prepared: {appendingMessages: [createUserMessage({text: "ANON"})]},
        });

        const entries = plan?.ops[0]?.kind === "appendMany" ? plan.ops[0].entries : [];
        expect(entries[0]?.type === "custom_message" ? entries[0].promptSource : null).toEqual({zone: "appending"});
    });

    it("拒绝 profile 写入非自身 state key", () => {
        expect(() => compilePrepareRunWritePlan({
            sessionId: 7,
            profileKey: "test.profile",
            context: fakeContext({messageCount: 0}),
            sessionContextEnabled: true,
            prepared: {
                stateWrites: [{
                    type: "custom",
                    key: "other",
                    value: null,
                }],
            },
        })).toThrow("stateWrites 只允许写 profileState.test.profile");
    });
});

describe("buildPromptPrefixAttribution", () => {
    it("按 promptSource 区分 HistorySet 前缀、历史沉淀的旧提醒与普通对话", () => {
        const history = createUserMessage({text: "HISTORY_SET"});
        const oldReminder = createUserMessage({text: "OLD_REMINDER"});
        const chat = createUserMessage({text: "CHAT"});
        const appending = createUserMessage({text: "APPENDING"});
        const currentInput = createUserMessage({text: "NOW"});
        const persistedMessages = [history, oldReminder, chat, appending, currentInput];

        const attribution = buildPromptPrefixAttribution({
            snapshot: fakeSnapshot([
                {message: history, promptSource: {zone: "historySet", labels: ["Import:AGENTS.md"]}},
                {message: oldReminder, promptSource: {zone: "appending", labels: ["Reminder:agent-mode"]}},
                {message: appending, promptSource: {zone: "appending", labels: ["Reminder:workspace-focus"]}},
            ]),
            persistedMessages,
            modelContextCount: 1,
            appendingCount: 1,
            currentUserInputCount: 1,
        });

        expect(attribution.kinds).toEqual([
            "historySet",
            // 历史里沉淀的旧 AppendingSet 提醒仍归 appending，不该被混进对话历史。
            "appending",
            "conversation",
            "modelContext",
            "appending",
            "currentInput",
        ]);
        expect(attribution.labels).toEqual([
            ["Import:AGENTS.md"],
            ["Reminder:agent-mode"],
            null,
            null,
            ["Reminder:workspace-focus"],
            null,
        ]);
    });

    it("有 promptSource 时 mode 为 full", () => {
        const message = createUserMessage({text: "H"});
        const attribution = buildPromptPrefixAttribution({
            snapshot: fakeSnapshot([{message, promptSource: {zone: "historySet"}}]),
            persistedMessages: [message],
            modelContextCount: 0,
            appendingCount: 0,
            currentUserInputCount: 0,
        });
        expect(attribution.mode).toBe("full");
    });

    it("旧 session 无 promptSource 时按位置推断：首条真实消息之前的 custom_message 判为 HistorySet", () => {
        const historyA = createUserMessage({text: "HISTORY_A"});
        const historyB = createUserMessage({text: "HISTORY_B"});
        const chat = createUserMessage({text: "CHAT"});
        const laterReminder = createUserMessage({text: "LATER_REMINDER"});
        const persistedMessages = [historyA, historyB, chat, laterReminder];

        const attribution = buildPromptPrefixAttribution({
            snapshot: {
                entries: [
                    {id: "e0", parentId: null, timestamp: 0, type: "custom_message", message: historyA, visibleToModel: true},
                    {id: "e1", parentId: null, timestamp: 1, type: "custom_message", message: historyB, visibleToModel: true},
                    {id: "e2", parentId: null, timestamp: 2, type: "message", message: chat},
                    {id: "e3", parentId: null, timestamp: 3, type: "custom_message", message: laterReminder, visibleToModel: true},
                ],
            } as unknown as SessionSnapshot,
            persistedMessages,
            modelContextCount: 0,
            appendingCount: 0,
            currentUserInputCount: 0,
        });

        expect(attribution.mode).toBe("legacy");
        // 首条真实 message 之前 = HistorySet（含分不开的首轮提醒）；之后的 custom_message = AppendingSet。
        expect(attribution.kinds).toEqual(["historySet", "historySet", "conversation", "appending"]);
        // 位置推断给不出具名来源。
        expect(attribution.labels).toEqual([null, null, null, null]);
    });

    it("完全没有 custom_message 的旧 session 全部按对话归因，不报错", () => {
        const messages = [createUserMessage({text: "A"}), createUserMessage({text: "B"})];
        const attribution = buildPromptPrefixAttribution({
            snapshot: {
                entries: messages.map((message, index) => ({id: `e${String(index)}`, parentId: null, timestamp: index, type: "message", message})),
            } as unknown as SessionSnapshot,
            persistedMessages: messages,
            modelContextCount: 0,
            appendingCount: 0,
            currentUserInputCount: 0,
        });

        expect(attribution.kinds).toEqual(["conversation", "conversation"]);
        expect(attribution.labels).toEqual([null, null]);
    });

    it("ModelContext 插在 AppendingSet 之前——顺序与 assemblePersistedProfilePromptMessages 一致", () => {
        const messages = [createUserMessage({text: "H"}), createUserMessage({text: "APPEND"})];
        const attribution = buildPromptPrefixAttribution({
            snapshot: fakeSnapshot([{message: messages[1]!, promptSource: {zone: "appending"}}]),
            persistedMessages: messages,
            modelContextCount: 2,
            appendingCount: 1,
            currentUserInputCount: 0,
        });

        expect(attribution.kinds).toEqual(["conversation", "modelContext", "modelContext", "appending"]);
    });
});

function fakeSnapshot(entries: Array<{message: ReturnType<typeof createUserMessage>; promptSource?: {zone: "historySet" | "appending"; labels?: string[]}}>): SessionSnapshot {
    return {
        entries: entries.map((entry, index) => ({
            id: `e${String(index)}`,
            parentId: null,
            timestamp: index,
            type: "custom_message" as const,
            message: entry.message,
            visibleToModel: true,
            ...(entry.promptSource ? {promptSource: entry.promptSource} : {}),
        })),
    } as unknown as SessionSnapshot;
}

function fakeContext(input: {messageCount: number}): NeuroSessionContext {
    return {
        sessionId: 7,
        profileKey: "test.profile",
        workspaceRoot: "workspace",
        workspaceKey: "global",
        systemPrompt: "",
        model: null,
        thinkingLevel: null,
        messages: Array.from({length: input.messageCount}, (_, index) => createUserMessage({text: `message-${index}`})),
        customState: {},
        linkedAgents: [],
        agentMode: "normal",
        archived: false,
    } as NeuroSessionContext;
}
