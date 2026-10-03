import {describe, expect, it} from "vitest";
import {
    encodeFollowUpQueue,
    parseFollowUpQueue,
    parseStoredMessage,
    parseStoredMessages,
    StoredMessageInvariantError,
} from "nbook/server/agent/messages/stored-message-codec";

describe("stored message codec", () => {
    it("将 Pi raw image 识别为待迁移数据", () => {
        expect(() => parseStoredMessage({
            role: "user",
            content: [{type: "image", mimeType: "image/png", data: "AAAA"}],
            timestamp: 1,
        })).toThrowError(expect.objectContaining<Partial<StoredMessageInvariantError>>({
            code: "migration_required",
        }));
    });

    it("拒绝 attachment block 偷渡内联 data", () => {
        expect(() => parseStoredMessage({
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "read",
            content: [{
                type: "attachment",
                attachment: {id: `sha256:${"a".repeat(64)}`, mimeType: "image/png", bytes: 4},
                data: "AAAA",
            }],
            isError: false,
            timestamp: 1,
        })).toThrowError(expect.objectContaining<Partial<StoredMessageInvariantError>>({code: "corrupt"}));
    });

    it("严格校验 assistant 的必需字段与 content block", () => {
        expect(() => parseStoredMessage({
            role: "assistant",
            content: [{type: "text", text: "done"}],
            timestamp: 1,
        })).toThrowError(expect.objectContaining<Partial<StoredMessageInvariantError>>({code: "corrupt"}));
    });

    it("批量 parser 和 Provider 最终门禁拒绝 assistant attachment", () => {
        expect(() => parseStoredMessages([{
            role: "assistant",
            content: [{
                type: "attachment",
                attachment: {id: `sha256:${"a".repeat(64)}`, mimeType: "image/png", bytes: 4},
            }],
            api: "openai-completions",
            provider: "test",
            model: "test",
            usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
            stopReason: "stop",
            timestamp: 1,
        }])).toThrowError(expect.objectContaining<Partial<StoredMessageInvariantError>>({code: "corrupt"}));
    });

    it("follow-up queue 使用严格 codec 往返并拒绝坏 item", () => {
        const state = {
            status: "paused" as const,
            pausedBy: {invocationId: "inv-1", reason: "aborted" as const},
            items: [{
                id: "item-1",
                clientMessageId: "00000000-0000-4000-8000-000000000001",
                kind: "followup" as const,
                message: {
                    content: [
                        {type: "text" as const, text: "继续"},
                        {
                            type: "attachment" as const,
                            attachment: {id: `sha256:${"b".repeat(64)}` as const, mimeType: "image/png", bytes: 4},
                            name: "cover.png",
                        },
                    ],
                },
                modelKey: "local/reviewer",
                createdAt: 1,
            }],
        };

        expect(parseFollowUpQueue(encodeFollowUpQueue(state))).toEqual(state);
        expect(() => parseFollowUpQueue({
            status: "ready",
            items: [{id: "bad", kind: "followup", message: {text: "继续", images: []}, createdAt: 1}],
        })).toThrowError(expect.objectContaining<Partial<StoredMessageInvariantError>>({code: "corrupt"}));
        expect(() => parseFollowUpQueue({
            status: "ready",
            items: [{id: "bad-model", kind: "followup", message: {text: "继续"}, modelKey: " ", createdAt: 1}],
        })).toThrowError(expect.objectContaining<Partial<StoredMessageInvariantError>>({code: "corrupt"}));
    });

    it("details 和 queue input 只接受真正可序列化的 JsonValue", () => {
        const circular: {self?: unknown} = {};
        circular.self = circular;
        expect(() => parseStoredMessage({
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "read",
            content: [{type: "text", text: "done"}],
            details: new Date(),
            isError: false,
            timestamp: 1,
        })).toThrowError(expect.objectContaining<Partial<StoredMessageInvariantError>>({code: "corrupt"}));
        expect(() => parseFollowUpQueue({
            status: "ready",
            items: [{id: "item-1", kind: "followup", input: circular, createdAt: 1}],
        })).toThrowError(expect.objectContaining<Partial<StoredMessageInvariantError>>({code: "corrupt"}));
    });

    it("拒绝message、content、usage和cost中的未声明字段", () => {
        const invalidMessages = [
            {role: "user", content: [{type: "text", text: "ok", hidden: "data:image/png;base64,AAAA"}], timestamp: 1},
            {role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{type: "text", text: "ok"}], isError: false, timestamp: 1, hidden: true},
            assistantMessage({hidden: true}),
            assistantMessage({content: [{type: "text", text: "ok", hidden: true}]}),
            assistantMessage({usage: {...assistantUsage(), hidden: true}}),
            assistantMessage({usage: {...assistantUsage(), cost: {...assistantUsage().cost, hidden: true}}}),
        ];

        for (const message of invalidMessages) {
            expect(() => parseStoredMessage(message))
                .toThrowError(expect.objectContaining<Partial<StoredMessageInvariantError>>({code: "corrupt"}));
        }
    });

    it("details、diagnostics和tool arguments继续接受合法JsonValue", () => {
        expect(() => parseStoredMessage({
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "read",
            content: [{type: "text", text: "ok"}],
            details: {nested: ["data:image/png;base64,AAAA", 1, true, null]},
            isError: false,
            timestamp: 1,
        })).not.toThrow();
        expect(() => parseStoredMessage(assistantMessage({
            content: [{type: "toolCall", id: "call-1", name: "tool", arguments: {custom: {enabled: true}}}],
            diagnostics: [{type: "provider", timestamp: 1, details: {custom: "value"}}],
        }))).not.toThrow();
    });
});

function assistantUsage() {
    return {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
    };
}

function assistantMessage(patch: Record<string, unknown> = {}) {
    return {
        role: "assistant",
        content: [{type: "text", text: "ok"}],
        api: "openai-completions",
        provider: "test",
        model: "test",
        usage: assistantUsage(),
        stopReason: "stop",
        timestamp: 1,
        ...patch,
    };
}
