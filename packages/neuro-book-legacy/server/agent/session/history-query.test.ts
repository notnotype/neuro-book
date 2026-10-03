import {describe, expect, it} from "vitest";
import {
    AgentHistoryQueryError,
    buildAgentHistoryPage,
    decodeAgentHistoryCursor,
    encodeAgentHistoryCursor,
} from "nbook/server/agent/session/history-query";
import type {SessionEntry} from "nbook/server/agent/session/types";

describe("Agent history query", () => {
    it("连续翻页时按旧到新返回且无重叠遗漏", () => {
        const path = Array.from({length: 35}, (_, index) => userEntry(index));
        const latest = buildAgentHistoryPage({
            sessionId: 7,
            activePathRevision: null,
            activePath: path,
        });
        expect(latest.entries).toHaveLength(30);
        expect(latest.entries[0]?.id).toBe("entry-5");
        expect(latest.previousCursor).not.toBeNull();

        const previous = buildAgentHistoryPage({
            sessionId: 7,
            activePathRevision: null,
            activePath: path,
            cursor: latest.previousCursor ?? undefined,
        });
        expect(previous.entries.map((entry) => entry.id)).toEqual([
            "entry-0",
            "entry-1",
            "entry-2",
            "entry-3",
            "entry-4",
        ]);
        expect(previous.previousCursor).toBeNull();

        const appended = buildAgentHistoryPage({
            sessionId: 7,
            activePathRevision: null,
            activePath: [
                ...path,
                ...Array.from({length: 5}, (_, index) => userEntry(35 + index)),
            ],
            cursor: latest.previousCursor ?? undefined,
        });
        expect(appended.entries.map((entry) => entry.id)).toEqual(previous.entries.map((entry) => entry.id));
    });

    it("assistant 与所属 tool result 保持在同一个显示组", () => {
        const assistant = assistantEntry();
        const toolResult = toolResultEntry();
        const path = [
            ...Array.from({length: 30}, (_, index) => userEntry(index)),
            invocationEntry(),
            assistant,
            invisibleEntry("invisible", toolResult.parentId),
            toolResult,
        ];
        const page = buildAgentHistoryPage({
            sessionId: 9,
            activePathRevision: "revision-1",
            activePath: path,
        });

        expect(page.entries.slice(-2).map((entry) => entry.type)).toEqual(["assistant", "tool_result"]);
        expect(page.entries).toHaveLength(31);
        expect(page.entries.at(-2)).toEqual(expect.objectContaining({invocationId: "invocation-1"}));
    });

    it("assistant 与 tool result 之间有可见 entry 时仍保持同一个显示组", () => {
        const assistant = assistantEntry();
        const toolResult = toolResultEntry();
        const path = [
            invocationEntry(),
            assistant,
            visibleSystemEntry("visible-between", assistant.id),
            toolResult,
            ...Array.from({length: 29}, (_, index) => userEntry(index + 100)),
        ];
        const page = buildAgentHistoryPage({
            sessionId: 9,
            activePathRevision: "revision-1",
            activePath: path,
        });

        expect(page.entries.slice(0, 3).map((entry) => entry.type)).toEqual(["assistant", "system", "tool_result"]);
        expect(page.entries).toHaveLength(32);
    });

    it("相交 assistant span 合并且无 owner tool result 保持独立", () => {
        const path = [
            invocationEntry(),
            assistantEntry("assistant-a", "tool-a"),
            visibleSystemEntry("visible-between", "assistant-a"),
            assistantEntry("assistant-b", "tool-b"),
            toolResultEntry("result-a", "tool-a", "assistant-b"),
            toolResultEntry("result-b", "tool-b", "result-a"),
            ...Array.from({length: 28}, (_, index) => userEntry(index + 200)),
        ];
        const merged = buildAgentHistoryPage({
            sessionId: 10,
            activePathRevision: "revision-1",
            activePath: path,
        });
        expect(merged.entries.slice(0, 5).map((entry) => entry.id)).toEqual([
            "assistant-a",
            "visible-between",
            "assistant-b",
            "result-a",
            "result-b",
        ]);

        const orphan = buildAgentHistoryPage({
            sessionId: 11,
            activePathRevision: "revision-1",
            activePath: [
                invocationEntry(),
                assistantEntry("assistant-owner", "tool-owner"),
                toolResultEntry("orphan-result", "tool-missing", "assistant-owner"),
                ...Array.from({length: 29}, (_, index) => userEntry(index + 300)),
            ],
        });
        expect(orphan.entries[0]).toEqual(expect.objectContaining({id: "orphan-result", type: "tool_result"}));
    });

    it("不同 invocation 复用 toolCallId 时分别绑定各自 assistant", () => {
        const path = [
            invocationEntry("invocation-start-1", "invocation-1"),
            assistantEntry("assistant-1", "shared-tool"),
            toolResultEntry("result-1", "shared-tool", "assistant-1"),
            invocationEndEntry("invocation-end-1", "invocation-1", "result-1"),
            invocationEntry("invocation-start-2", "invocation-2", "invocation-end-1"),
            assistantEntry("assistant-2", "shared-tool"),
            visibleSystemEntry("visible-2", "assistant-2"),
            toolResultEntry("result-2", "shared-tool", "visible-2"),
            ...Array.from({length: 29}, (_, index) => userEntry(index + 400)),
        ];
        const page = buildAgentHistoryPage({
            sessionId: 12,
            activePathRevision: "revision-1",
            activePath: path,
        });

        expect(page.entries.slice(0, 3).map((entry) => entry.id)).toEqual([
            "assistant-2",
            "visible-2",
            "result-2",
        ]);
        expect(page.entries).toHaveLength(32);
    });

    it("复杂显示组连续翻完所有页时顺序完整且 cursor 必须终止", () => {
        const path = [
            ...Array.from({length: 20}, (_, index) => userEntry(index)),
            invocationEntry("invocation-complex", "invocation-complex", "entry-19"),
            assistantEntryWithTools("assistant-complex", ["tool-a", "tool-b"]),
            visibleSystemEntry("visible-complex", "assistant-complex"),
            toolResultEntry("result-a", "tool-a", "visible-complex"),
            toolResultEntry("result-b", "tool-b", "result-a"),
            ...Array.from({length: 45}, (_, index) => userEntry(index + 20)),
        ];
        const expectedIds = [
            ...Array.from({length: 20}, (_, index) => `entry-${String(index)}`),
            "assistant-complex",
            "visible-complex",
            "result-a",
            "result-b",
            ...Array.from({length: 45}, (_, index) => `entry-${String(index + 20)}`),
        ];
        let cursor: string | undefined;
        let pages = 0;
        let collected: string[] = [];
        do {
            const page = buildAgentHistoryPage({
                sessionId: 13,
                activePathRevision: "revision-complex",
                activePath: path,
                ...(cursor ? {cursor} : {}),
            });
            collected = [...page.entries.map((entry) => entry.id), ...collected];
            cursor = page.previousCursor ?? undefined;
            pages += 1;
            expect(pages).toBeLessThan(10);
        } while (cursor);

        expect(collected).toEqual(expectedIds);
        expect(new Set(collected).size).toBe(collected.length);
    });

    it("严格校验 cursor 的 session、revision、边界和版本", () => {
        const path = Array.from({length: 35}, (_, index) => userEntry(index));
        const cursor = encodeAgentHistoryCursor({
            version: 1,
            sessionId: 7,
            activePathRevision: "revision-1",
            beforeEntryId: "entry-5",
        });
        expect(decodeAgentHistoryCursor(cursor)).toEqual({
            version: 1,
            sessionId: 7,
            activePathRevision: "revision-1",
            beforeEntryId: "entry-5",
        });
        expect(() => buildAgentHistoryPage({
            sessionId: 8,
            activePathRevision: "revision-1",
            activePath: path,
            cursor,
        })).toThrowError(expect.objectContaining({code: "INVALID_HISTORY_CURSOR", statusCode: 400}));
        expect(() => buildAgentHistoryPage({
            sessionId: 7,
            activePathRevision: "revision-2",
            activePath: path,
            cursor,
        })).toThrowError(expect.objectContaining({code: "ACTIVE_PATH_CHANGED"}));
        const invalidBoundary = encodeAgentHistoryCursor({
            version: 1,
            sessionId: 7,
            activePathRevision: "revision-1",
            beforeEntryId: "missing",
        });
        expect(() => buildAgentHistoryPage({
            sessionId: 7,
            activePathRevision: "revision-1",
            activePath: path,
            cursor: invalidBoundary,
        })).toThrowError(expect.objectContaining({code: "INVALID_HISTORY_CURSOR"}));
        expect(() => decodeAgentHistoryCursor("not+base64")).toThrowError(expect.objectContaining({
            code: "INVALID_HISTORY_CURSOR",
        }));
    });
});

function userEntry(index: number): SessionEntry {
    return {
        id: `entry-${String(index)}`,
        parentId: index === 0 ? null : `entry-${String(index - 1)}`,
        timestamp: index,
        type: "message",
        origin: "prompt",
        clientMessageId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        intent: "normal",
        message: {
            role: "user",
            content: [{type: "text", text: `message ${String(index)}`}],
            timestamp: index,
        },
    };
}

function assistantEntry(id = "assistant", toolCallId = "tool-1"): SessionEntry {
    return {
        id,
        parentId: "entry-29",
        timestamp: 31,
        type: "message",
        origin: "ingest",
        message: {
            role: "assistant",
            content: [{type: "toolCall", id: toolCallId, name: "read", arguments: {path: "manuscript/1.md"}}],
            api: "openai-responses",
            provider: "openai",
            model: "gpt-5",
            usage: {
                input: 1,
                output: 1,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 2,
                cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
            },
            stopReason: "toolUse",
            timestamp: 31,
        },
    };
}

function assistantEntryWithTools(id: string, toolCallIds: string[]): SessionEntry {
    const entry = assistantEntry(id, toolCallIds[0] ?? "tool-1");
    if (entry.type !== "message" || entry.message.role !== "assistant") {
        throw new Error("assistant fixture 构建失败");
    }
    entry.message.content = toolCallIds.map((toolCallId) => ({
        type: "toolCall" as const,
        id: toolCallId,
        name: "read",
        arguments: {path: `manuscript/${toolCallId}.md`},
    }));
    return entry;
}

function toolResultEntry(id = "tool-result", toolCallId = "tool-1", parentId = "invisible"): SessionEntry {
    return {
        id,
        parentId,
        timestamp: 33,
        type: "message",
        origin: "ingest",
        message: {
            role: "toolResult",
            toolCallId,
            toolName: "read",
            content: [{type: "text", text: "ok"}],
            isError: false,
            timestamp: 33,
        },
    };
}

function invisibleEntry(id: string, parentId: string | null): SessionEntry {
    return {
        id,
        parentId,
        timestamp: 32,
        type: "label",
        targetEntryId: parentId ?? "assistant",
        label: "hidden",
    };
}

function invocationEntry(id = "invocation-start", invocationId = "invocation-1", parentId = "entry-29"): SessionEntry {
    return {
        id,
        parentId,
        timestamp: 30,
        type: "invocation_lifecycle",
        invocationId,
        status: "start",
    };
}

function invocationEndEntry(id: string, invocationId: string, parentId: string): SessionEntry {
    return {
        id,
        parentId,
        timestamp: 34,
        type: "invocation_lifecycle",
        invocationId,
        status: "end",
    };
}

function visibleSystemEntry(id: string, parentId: string | null): SessionEntry {
    return {
        id,
        parentId,
        timestamp: 32,
        type: "custom_message",
        message: {
            role: "user",
            content: [{type: "text", text: "可见系统记录"}],
            timestamp: 32,
        },
        visibleToModel: true,
    };
}
