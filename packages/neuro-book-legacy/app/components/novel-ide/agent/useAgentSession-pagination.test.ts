import {describe, expect, it, vi} from "vitest";
import {useAgentSession} from "nbook/app/components/novel-ide/agent/useAgentSession";
import type {AgentChatEntryDto} from "nbook/shared/dto/agent-public-event.dto";
import type {AgentSessionHistoryPageDto, AgentSessionRecoveryDto} from "nbook/shared/dto/agent-session.dto";

describe("useAgentSession durable history", () => {
    it("same revision recovery 更新尾页但保留已加载旧页和最老 cursor", () => {
        const session = useAgentSession();
        session.applyRecovery(recovery("rev-1", [user("entry-2", "二"), user("entry-3", "三")], "cursor-1"));
        session.applyHistoryPage(history("rev-1", [user("entry-1", "一")], null));

        const result = session.applyRecovery(recovery("rev-1", [user("entry-3", "三（更新）"), user("entry-4", "四")], "cursor-new-tail"));

        expect(session.durableEntries.value.map((entry) => entry.id)).toEqual(["entry-1", "entry-2", "entry-3", "entry-4"]);
        expect(session.messages.value.map((message) => message.content)).toEqual(["一", "二", "三（更新）", "四"]);
        expect(session.previousCursor.value).toBeNull();
        expect(result.historyWindowReset).toBe(false);
    });

    it("active path revision 变化时替换 durable history 并清空旧 live overlay", () => {
        const session = useAgentSession();
        session.applyRecovery(recovery("rev-1", [user("old", "旧分支")], null));
        session.applyEvent({
            eventEpoch: "epoch-1",
            seq: 1,
            sessionId: 1,
            invocationId: "run-1",
            kind: "runtime",
            event: {type: "message_start", messageId: "live-1", role: "assistant", timestamp: 1, model: "test"},
        });

        session.applyRecovery(recovery("rev-2", [user("new", "新分支")], "cursor-new"));

        expect(session.durableEntries.value.map((entry) => entry.id)).toEqual(["new"]);
        expect(session.messages.value.map((message) => message.content)).toEqual(["新分支"]);
        expect(session.previousCursor.value).toBe("cursor-new");
        expect(session.liveOverlay.value).toEqual([]);
    });

    it("live state 提前报告新 revision 后，recovery 仍替换旧 durable history", () => {
        const session = useAgentSession();
        session.applyRecovery(recovery("rev-1", [user("old", "旧分支")], null));
        session.applyLiveState({
            summary: summary(1),
            activeLeafId: "new",
            activePathRevision: "rev-2",
            pendingUserInputs: [],
            steerQueue: {count: 0},
            followUpQueue: {status: "ready", count: 0},
            activeInvocation: null,
            model: null,
            thinkingLevel: null,
            effectiveThinkingLevel: "off",
            agentMode: "normal",
        });

        session.applyRecovery(recovery("rev-2", [user("new", "新分支")], null));

        expect(session.durableEntries.value.map((entry) => entry.id)).toEqual(["new"]);
    });

    it("同一 history cursor 只发出一次请求，并忽略切换 session 后的迟到响应", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery("rev-1", [user("entry-2", "二")], "cursor-1"));
        let resolvePage!: (page: AgentSessionHistoryPageDto) => void;
        const loader = vi.fn(() => new Promise<AgentSessionHistoryPageDto>((resolve) => {
            resolvePage = resolve;
        }));

        const first = session.loadPrevious(loader);
        const reused = session.loadPrevious(loader);
        expect(loader).toHaveBeenCalledTimes(1);

        session.reset();
        session.applyRecovery({...recovery("rev-1", [user("other", "另一会话")], null), summary: summary(2)});
        resolvePage(history("rev-1", [user("entry-1", "一")], null));

        await expect(first).resolves.toBe(false);
        await expect(reused).resolves.toBe(false);
        expect(session.durableEntries.value.map((entry) => entry.id)).toEqual(["other"]);
    });

    it("ACTIVE_PATH_CHANGED 稳定业务码请求统一 recovery，不把旧页并入当前窗口", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery("rev-1", [user("entry-2", "二")], "cursor-1"));

        await expect(session.loadPrevious(async () => {
            throw {data: {code: "ACTIVE_PATH_CHANGED", message: "历史分支已变化"}};
        })).resolves.toBe(false);

        expect(session.needsRecovery.value).toBe(true);
        expect(session.recoveryReasons.value).toContain("active_path_changed");
        expect(session.historyError.value).toBe("历史分支已变化");
    });

    it("INVALID_HISTORY_CURSOR 稳定业务码在 recovery 成功后重置到最新尾页", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery("rev-1", [user("entry-1", "旧页"), user("entry-2", "当前")], "invalid-cursor"));

        await expect(session.loadPrevious(async () => {
            throw {data: {code: "INVALID_HISTORY_CURSOR", message: "history cursor 已失效"}};
        })).resolves.toBe(false);

        expect(session.durableEntries.value.map((entry) => entry.id)).toEqual(["entry-1", "entry-2"]);
        expect(session.recoveryReasons.value).toContain("invalid_history_cursor");

        const result = session.applyRecovery(recovery("rev-1", [user("entry-3", "最新尾页")], "fresh-cursor"));

        expect(session.durableEntries.value.map((entry) => entry.id)).toEqual(["entry-3"]);
        expect(session.previousCursor.value).toBe("fresh-cursor");
        expect(session.historyError.value).toBe("");
        expect(result.historyWindowReset).toBe(true);
    });

    it("invalid cursor 后 active path revision 同时变化仍标记窗口重置", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery("rev-1", [user("old", "旧分支")], "invalid-cursor"));
        await session.loadPrevious(async () => {
            throw {statusCode: 400, data: {code: "INVALID_HISTORY_CURSOR", message: "cursor 已失效"}};
        });

        const result = session.applyRecovery(recovery("rev-2", [user("new", "新分支尾页")], null));

        expect(result.historyWindowReset).toBe(true);
        expect(session.durableEntries.value.map((entry) => entry.id)).toEqual(["new"]);
    });

    it("不同 session recovery 不继承旧 session 的 invalid window reset", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery("rev-1", [], "invalid-cursor"));
        await session.loadPrevious(async () => {
            throw {statusCode: 400, data: {code: "INVALID_HISTORY_CURSOR", message: "cursor 已失效"}};
        });

        const result = session.applyRecovery({...recovery("rev-1", [], null), summary: summary(2)});

        expect(result.historyWindowReset).toBe(false);
    });

    it("普通 history 网络错误保留当前窗口和 cursor 供局部重试", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery("rev-1", [user("entry-1", "旧页"), user("entry-2", "当前")], "cursor-1"));

        await expect(session.loadPrevious(async () => {
            throw new Error("网络暂时不可用");
        })).resolves.toBe(false);

        expect(session.durableEntries.value.map((entry) => entry.id)).toEqual(["entry-1", "entry-2"]);
        expect(session.previousCursor.value).toBe("cursor-1");
        expect(session.needsRecovery.value).toBe(false);
        expect(session.historyError.value).toBe("网络暂时不可用");
    });

    it("Session Not Found 在 history 中保持局部错误且不请求隐式切换", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery("rev-1", [user("entry-1", "当前")], "cursor-1"));

        await expect(session.loadPrevious(async () => {
            throw {data: {code: "SESSION_NOT_FOUND", message: "Session 不存在或已不可用"}};
        })).resolves.toBe(false);

        expect(session.needsRecovery.value).toBe(false);
        expect(session.previousCursor.value).toBe("cursor-1");
        expect(session.historyError.value).toBe("Session 不存在或已不可用");
    });

    it("System Prompt 仅在显式加载时请求，并按 session single-flight", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery("rev-1", [], null));
        const loader = vi.fn(async (sessionId: number) => ({kind: "systemPrompt" as const, sessionId, systemPrompt: "SYSTEM"}));

        expect(loader).not.toHaveBeenCalled();
        await Promise.all([session.loadSystemPrompt(loader), session.loadSystemPrompt(loader)]);

        expect(loader).toHaveBeenCalledTimes(1);
        expect(session.systemPrompt.value).toBe("SYSTEM");
        expect(session.messages.value).toEqual([]);
    });

    it("Session Not Found 在 System Prompt 中只发布局部错误", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery("rev-1", [], null));

        await expect(session.loadSystemPrompt(async () => {
            throw {response: {_data: {code: "SESSION_NOT_FOUND", message: "Session 不存在或已不可用"}}};
        })).resolves.toBe(false);

        expect(session.systemPrompt.value).toBeNull();
        expect(session.systemPromptError.value).toBe("Session 不存在或已不可用");
        expect(session.needsRecovery.value).toBe(false);
    });

    it("durable user entry 到达后按 clientMessageId 收敛 optimistic message", () => {
        const session = useAgentSession();
        session.applyRecovery(recovery("rev-1", [], null));
        session.appendOptimisticUserMessage("message-1", "你好");
        expect(session.optimisticMessages.value).toHaveLength(1);

        session.applyEvent({
            eventEpoch: "epoch-1",
            seq: 1,
            sessionId: 1,
            kind: "session",
            event: {type: "session_entry", entry: user("user-1", "你好", "message-1")},
        });

        expect(session.optimisticMessages.value).toEqual([]);
        expect(session.messages.value.map((message) => message.id)).toEqual(["user-1"]);
    });

    it("截断的长文本 durable entry 仍只按 clientMessageId 收敛 optimistic message", () => {
        const session = useAgentSession();
        session.applyRecovery(recovery("rev-1", [], null));
        const content = `${"中文🙂".repeat(20_000)}结尾`;
        const preview = "中文🙂".repeat(4_000);
        session.appendOptimisticUserMessage("message-long", content);

        session.applyEvent({
            eventEpoch: "epoch-1",
            seq: 1,
            sessionId: 1,
            kind: "session",
            event: {
                type: "session_entry",
                entry: userPreview("user-long", preview, Buffer.byteLength(content, "utf8"), true, "message-long"),
            },
        });

        expect(session.optimisticMessages.value).toEqual([]);
        expect(session.messages.value.map((message) => message.id)).toEqual(["user-long"]);
    });

    it("正文与字节相同但 clientMessageId 不匹配时不消费 optimistic message", () => {
        const session = useAgentSession();
        session.applyRecovery(recovery("rev-1", [], null));
        const content = `${"中文🙂".repeat(2_000)}甲`;
        session.appendOptimisticUserMessage("message-correct", content);

        session.applyEvent({
            eventEpoch: "epoch-1",
            seq: 1,
            sessionId: 1,
            kind: "session",
            event: {
                type: "session_entry",
                entry: userPreview("wrong-prefix", "其它前缀", Buffer.byteLength(content, "utf8"), true, "message-wrong-prefix"),
            },
        });
        session.applyEvent({
            eventEpoch: "epoch-1",
            seq: 2,
            sessionId: 1,
            kind: "session",
            event: {
                type: "session_entry",
                entry: userPreview("wrong-bytes", "中文🙂".repeat(100), Buffer.byteLength(content, "utf8") + 1, true, "message-wrong-bytes"),
            },
        });

        expect(session.optimisticMessages.value).toHaveLength(1);
    });

    it("recovery 中两条截断长文本按各自 clientMessageId 精确收敛", () => {
        const session = useAgentSession();
        session.applyRecovery(recovery("rev-1", [], null));
        const first = `${"共同前缀🙂".repeat(2_000)}甲`;
        const second = `${"共同前缀🙂".repeat(2_000)}乙乙`;
        const preview = "共同前缀🙂".repeat(100);
        session.appendOptimisticUserMessage("message-long-1", first);
        session.appendOptimisticUserMessage("message-long-2", second);

        session.applyRecovery(recovery("rev-1", [
            userPreview("long-1", preview, Buffer.byteLength(first, "utf8"), true, "message-long-1"),
            userPreview("long-2", preview, Buffer.byteLength(second, "utf8"), true, "message-long-2"),
        ], null));

        expect(session.optimisticMessages.value).toEqual([]);
        expect(session.messages.value.map((message) => message.id)).toEqual(["long-1", "long-2"]);
    });

    it("相同正文 optimistic message 按 clientMessageId 分别收敛", () => {
        const session = useAgentSession();
        session.applyRecovery(recovery("rev-1", [], null));
        session.appendOptimisticUserMessage("message-1", "重复");
        session.appendOptimisticUserMessage("message-2", "重复");

        expect(new Set(session.optimisticMessages.value.map((message) => message.id)).size).toBe(2);

        session.applyEvent({
            eventEpoch: "epoch-1",
            seq: 1,
            sessionId: 1,
            kind: "session",
            event: {type: "session_entry", entry: user("user-1", "重复", "message-1")},
        });
        expect(session.optimisticMessages.value).toHaveLength(1);

        session.applyRecovery(recovery("rev-1", [
            user("user-1", "重复", "message-1"),
            user("user-2", "重复", "message-2"),
        ], null));
        expect(session.optimisticMessages.value).toEqual([]);
    });

    it("recovery 重放已有同正文 durable entry 时不消费新 optimistic message", () => {
        const session = useAgentSession();
        const existing = user("user-old", "重复");
        session.applyRecovery(recovery("rev-1", [existing], null));
        session.appendOptimisticUserMessage("message-new", "重复");

        session.applyRecovery(recovery("rev-1", [existing], null));

        expect(session.optimisticMessages.value).toHaveLength(1);
    });

    it("revision 变化时不使用新分支中的同正文历史消费 optimistic message", () => {
        const session = useAgentSession();
        session.applyRecovery(recovery("rev-1", [user("old", "旧分支")], null));
        session.appendOptimisticUserMessage("message-new", "重复");

        const result = session.applyRecovery(recovery("rev-2", [user("new-branch-old", "重复")], null));

        expect(result.historyWindowReset).toBe(false);
        expect(session.optimisticMessages.value).toHaveLength(1);
    });
});

function recovery(revision: string, entries: AgentChatEntryDto[], previousCursor: string | null): AgentSessionRecoveryDto {
    return {
        kind: "recovery",
        eventCursor: {eventEpoch: "epoch-1", after: 0},
        summary: summary(1),
        activeLeafId: entries.at(-1)?.id ?? null,
        activePathRevision: revision,
        history: {entries, previousCursor},
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

function history(revision: string, entries: AgentChatEntryDto[], previousCursor: string | null): AgentSessionHistoryPageDto {
    return {
        kind: "history",
        sessionId: 1,
        activePathRevision: revision,
        history: {entries, previousCursor},
    };
}

function user(id: string, content: string, clientMessageId = `message-${id}`): AgentChatEntryDto {
    return {
        id,
        clientMessageId,
        timestamp: Number(id.replace(/\D/g, "")) || 1,
        type: "user",
        intent: "normal",
        blocks: [{
            type: "text",
            contentIndex: 0,
            content: {preview: content, bytes: Buffer.byteLength(content, "utf8"), omitted: false},
        }],
        omittedBlocks: 0,
        textSummary: {bytes: Buffer.byteLength(content, "utf8"), omitted: false},
    };
}

function userPreview(id: string, preview: string, bytes: number, omitted: boolean, clientMessageId = `message-${id}`): AgentChatEntryDto {
    return {
        id,
        clientMessageId,
        timestamp: Number(id.replace(/\D/g, "")) || 1,
        type: "user",
        intent: "normal",
        blocks: [{type: "text", contentIndex: 0, content: {preview, bytes, omitted}}],
        omittedBlocks: 0,
        textSummary: {bytes, omitted},
    };
}

function summary(sessionId: number): AgentSessionRecoveryDto["summary"] {
    return {
        sessionId,
        sessionIdentity: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        profileKey: "leader.default",
        status: "idle",
        updatedAt: 1,
        archived: false,
    };
}
