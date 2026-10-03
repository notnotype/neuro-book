import {describe, expect, it} from "vitest";
import {applyRuntimeEventToMessages, applySessionEntryToMessages, deriveMessagesFromChatEntries, isContinuationPointMessage, type AgentMessage} from "nbook/app/components/novel-ide/agent/agent-message";
import type {AgentChatEntryDto} from "nbook/shared/dto/agent-public-event.dto";
import {assertPublicToolCallId} from "nbook/shared/agent/public-tool-identity";
import {agentAttachmentUrl} from "nbook/app/components/novel-ide/agent/agent-attachment";

describe("agent-message public projection", () => {
    it("durable history 保留正文 preview 的 bytes/omitted 元数据", () => {
        const messages = deriveMessagesFromChatEntries([
            user("user-1", "截断正文", 100_000, true),
            assistant("assistant-1", "回答预览", 80_000, true),
        ]);

        expect(messages).toEqual([
            expect.objectContaining({id: "user-1", contentBytes: 100_000, contentOmitted: true}),
            expect.objectContaining({id: "assistant-1", contentBytes: 80_000, contentOmitted: true}),
        ]);
    });

    it("durable assistant 按 invocation 收敛对应 live turn", () => {
        const previous: AgentMessage[] = [
            {id: "old", type: "ai", content: "旧", invocationId: "run-1", projectionSource: "durable"},
            {id: "live", type: "ai", content: "生成中", invocationId: "run-1", projectionSource: "live"},
        ];

        const messages = applySessionEntryToMessages(previous, {...assistant("assistant-1", "最终", 6, false), invocationId: "run-1"});

        expect(messages.map((message) => [message.id, message.content, message.projectionSource])).toEqual([
            ["old", "旧", "durable"],
            ["assistant-1", "最终", "durable"],
        ]);
    });

    it("durable tool result 归并到 toolCallId 所属 assistant", () => {
        const withAssistant = applySessionEntryToMessages([], {
            ...assistant("assistant-1", "", 0, false),
            toolCalls: [{id: assertPublicToolCallId("call-1"), index: 0, name: "write", args: {kind: "write", path: "a.md", contentPreview: "", contentBytes: 0, contentOmitted: false}}],
        });
        const messages = applySessionEntryToMessages(withAssistant, {
            id: "result-1",
            timestamp: 2,
            type: "tool_result",
            toolCallId: assertPublicToolCallId("call-1"),
            toolName: "write",
            result: {content: [{type: "text", contentIndex: 0, textPreview: "完成", textBytes: 6, textOmitted: false}], omittedContentBlocks: 0},
            isError: false,
        });

        expect(messages[0]?.toolCalls?.[0]).toEqual(expect.objectContaining({id: "call-1", status: "success", result: "完成", resultEntryId: "result-1"}));
    });

    it("durable user entry 保留纯图片附件 locator", () => {
        const messages = deriveMessagesFromChatEntries([{
            id: "user-image",
            clientMessageId: "message-user-image",
            timestamp: 1,
            type: "user",
            intent: "normal",
            blocks: [{
                type: "attachment",
                contentIndex: 1,
                attachment: {
                    attachmentId: `sha256:${"a".repeat(64)}`,
                    mimeType: "image/png",
                    bytes: 128,
                    name: "cover.png",
                    dataOmitted: true,
                },
            }],
            omittedBlocks: 0,
            textSummary: {bytes: 0, omitted: false},
        }]);

        expect(messages).toEqual([expect.objectContaining({
            id: "user-image",
            content: "",
            attachments: [expect.objectContaining({contentIndex: 1, attachment: expect.objectContaining({name: "cover.png"})})],
            contentBlocks: [expect.objectContaining({type: "attachment", contentIndex: 1})],
        })]);
    });

    it("durable user blocks 按原始 contentIndex 保留文本与图片混合顺序", () => {
        const firstAttachment = {
            attachmentId: `sha256:${"c".repeat(64)}` as const,
            mimeType: "image/png",
            bytes: 100,
            dataOmitted: true as const,
        };
        const secondAttachment = {
            attachmentId: `sha256:${"d".repeat(64)}` as const,
            mimeType: "image/webp",
            bytes: 200,
            dataOmitted: true as const,
        };
        const messages = deriveMessagesFromChatEntries([{
            id: "mixed-user",
            clientMessageId: "message-mixed-user",
            timestamp: 1,
            type: "user",
            intent: "normal",
            blocks: [
                {type: "attachment", contentIndex: 3, attachment: secondAttachment},
                {type: "text", contentIndex: 0, content: {preview: "第一段", bytes: 9, omitted: false}},
                {type: "attachment", contentIndex: 1, attachment: firstAttachment},
                {type: "text", contentIndex: 2, content: {preview: "第二段", bytes: 9, omitted: false}},
            ],
            omittedBlocks: 0,
            textSummary: {bytes: 19, omitted: false},
        }]);

        expect(messages[0]?.contentBlocks).toEqual([
            expect.objectContaining({type: "text", contentIndex: 0, content: expect.objectContaining({preview: "第一段"})}),
            expect.objectContaining({type: "attachment", contentIndex: 1, attachment: firstAttachment}),
            expect.objectContaining({type: "text", contentIndex: 2, content: expect.objectContaining({preview: "第二段"})}),
            expect.objectContaining({type: "attachment", contentIndex: 3, attachment: secondAttachment}),
        ]);
    });

    it("durable tool result 保留 attachment content index 与所属 entry", () => {
        const messages = deriveMessagesFromChatEntries([
            {
                ...assistant("assistant-image", "", 0, false),
                toolCalls: [{id: assertPublicToolCallId("call-image"), index: 0, name: "read", args: {kind: "generic", value: {kind: "object", entries: [], omittedEntries: 0}}}],
            },
            {
                id: "result-image",
                timestamp: 2,
                type: "tool_result",
                toolCallId: assertPublicToolCallId("call-image"),
                toolName: "read",
                isError: false,
                result: {
                    content: [{
                        type: "attachment",
                        contentIndex: 2,
                        attachment: {
                            attachmentId: `sha256:${"b".repeat(64)}`,
                            mimeType: "image/webp",
                            bytes: 256,
                            dataOmitted: true,
                        },
                    }],
                    omittedContentBlocks: 0,
                },
            },
        ]);

        expect(messages[0]?.toolCalls?.[0]).toEqual(expect.objectContaining({
            resultEntryId: "result-image",
            publicResult: expect.objectContaining({
                content: [expect.objectContaining({type: "attachment", contentIndex: 2})],
            }),
        }));
    });

    it("live 工具附件先展示无 locator 状态，durable entry 到达后生成授权地址", () => {
        const toolCallId = assertPublicToolCallId("call-live-attachment");
        const result = {
            content: [
                {
                    type: "attachment" as const,
                    contentIndex: 1,
                    attachment: {
                        attachmentId: `sha256:${"e".repeat(64)}` as const,
                        mimeType: "image/png",
                        bytes: 128,
                        name: "cover.png",
                        dataOmitted: true as const,
                    },
                },
                {
                    type: "attachment" as const,
                    contentIndex: 2,
                    attachment: {
                        attachmentId: `sha256:${"f".repeat(64)}` as const,
                        mimeType: "application/pdf",
                        bytes: 256,
                        name: "notes.pdf",
                        dataOmitted: true as const,
                    },
                },
            ],
            omittedContentBlocks: 0,
        };
        let messages = applyRuntimeEventToMessages([], {
            type: "tool_execution_end",
            toolCallId,
            toolName: "read",
            result,
            isError: false,
        }, "run-live-attachment");
        const liveToolCall = messages[0]?.toolCalls?.[0];

        expect(liveToolCall?.publicResult?.content).toHaveLength(2);
        expect(liveToolCall?.resultEntryId).toBeUndefined();
        expect(agentAttachmentUrl(42, liveToolCall?.resultEntryId, 1, "attachment-chat")).toBeNull();
        expect(agentAttachmentUrl(42, liveToolCall?.resultEntryId, 2)).toBeNull();

        messages = applySessionEntryToMessages(messages, {
            id: "result-live-attachment",
            timestamp: 2,
            type: "tool_result",
            toolCallId,
            toolName: "read",
            result,
            isError: false,
        });
        const durableToolCall = messages[0]?.toolCalls?.[0];

        expect(durableToolCall?.resultEntryId).toBe("result-live-attachment");
        expect(agentAttachmentUrl(42, durableToolCall?.resultEntryId, 1, "attachment-chat")).toBe(
            "/api/agent/sessions/42/entries/result-live-attachment/attachments/1?preset=attachment-chat",
        );
        expect(agentAttachmentUrl(42, durableToolCall?.resultEntryId, 2)).toBe(
            "/api/agent/sessions/42/entries/result-live-attachment/attachments/2",
        );
    });

    it("delta-first runtime event 按 messageId/contentIndex 合并", () => {
        let messages = applyRuntimeEventToMessages([], {type: "message_start", messageId: "assistant-1", role: "assistant", timestamp: 1, model: "test"}, "run-1");
        messages = applyRuntimeEventToMessages(messages, {type: "message_update", messageId: "assistant-1", update: {type: "text_delta", contentIndex: 0, delta: "你", deltaBytes: 3, deltaOmitted: false}}, "run-1");
        messages = applyRuntimeEventToMessages(messages, {type: "message_update", messageId: "assistant-1", update: {type: "text_delta", contentIndex: 0, delta: "好", deltaBytes: 3, deltaOmitted: false}}, "run-1");

        expect(messages).toEqual([expect.objectContaining({id: "assistant-1", content: "你好", projectionSource: "live"})]);
    });

    it("continuation point 只接受允许的 settled tool call", () => {
        expect(isContinuationPointMessage({id: "user", type: "user", content: "继续"})).toBe(true);
        expect(isContinuationPointMessage({id: "ai", type: "ai", content: "", toolCalls: [{id: "call", index: 0, name: "read", argsText: "", status: "success"}]}, {allowSettledAiToolCalls: true})).toBe(true);
        expect(isContinuationPointMessage({id: "ai", type: "ai", content: "", toolCalls: [{id: "call", index: 0, name: "read", argsText: "", status: "running"}]}, {allowSettledAiToolCalls: true})).toBe(false);
    });
});

function user(id: string, preview: string, bytes: number, omitted: boolean): AgentChatEntryDto {
    return {
        id,
        clientMessageId: `message-${id}`,
        timestamp: 1,
        type: "user",
        intent: "normal",
        blocks: [{type: "text", contentIndex: 0, content: {preview, bytes, omitted}}],
        omittedBlocks: 0,
        textSummary: {bytes, omitted},
    };
}

function assistant(id: string, preview: string, bytes: number, omitted: boolean): Extract<AgentChatEntryDto, {type: "assistant"}> {
    return {
        id,
        timestamp: 1,
        type: "assistant",
        content: {preview, bytes, omitted},
        thinking: {preview: "", bytes: 0, omitted: false},
        status: "done",
        model: "test",
        usage: {input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
        toolCalls: [],
        omittedToolCalls: 0,
    };
}
