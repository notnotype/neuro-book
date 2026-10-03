import {describe, expect, it} from "vitest";
import type {StoredAgentMessage, StoredAttachmentContent} from "nbook/server/agent/messages/stored-types";
import {estimateStoredContextTokens, estimateStoredMessageTokens} from "nbook/server/agent/messages/stored-message-tokens";
import {
    attachmentMarker,
    storedMessageText,
    storedMessagesForText,
} from "nbook/server/agent/messages/stored-message-presentation";

const attachment: StoredAttachmentContent = {
    type: "attachment",
    attachment: {
        id: `sha256:${"a".repeat(64)}`,
        mimeType: "image/png",
        bytes: 7_170_689,
    },
    name: "地图.png",
};

describe("stored message presentation", () => {
    it("按原 content 顺序生成 compaction/非视觉 marker", () => {
        const message: StoredAgentMessage = {
            role: "user",
            content: [
                {type: "text", text: "前"},
                attachment,
                {type: "text", text: "后"},
            ],
            timestamp: 1,
        };

        const marker = attachmentMarker(attachment);
        expect(storedMessageText(message)).toBe(`前\n${marker}\n后`);
        expect(storedMessagesForText([message])[0]?.content).toEqual([
            {type: "text", text: "前"},
            {type: "text", text: marker},
            {type: "text", text: "后"},
        ]);
    });

    it("附件使用固定图片成本估算，不按 marker 长度低估", () => {
        const imageOnly: StoredAgentMessage = {
            role: "user",
            content: [attachment],
            timestamp: 1,
        };
        const withText: StoredAgentMessage = {
            role: "toolResult",
            toolCallId: "tool-1",
            toolName: "read",
            content: [{type: "text", text: "1234"}, attachment],
            isError: false,
            timestamp: 2,
        };

        expect(estimateStoredMessageTokens(imageOnly)).toBe(1_200);
        expect(estimateStoredMessageTokens(withText)).toBe(1_201);
    });

    it("上下文估算保留最近 assistant usage，并只估算其后的 attachment", () => {
        const messages: StoredAgentMessage[] = [
            {role: "user", content: [{type: "text", text: "ignored before usage"}, attachment], timestamp: 1},
            {
                role: "assistant",
                content: [{type: "text", text: "done"}],
                api: "test",
                provider: "test",
                model: "test",
                usage: {
                    input: 100,
                    output: 20,
                    cacheRead: 0,
                    cacheWrite: 0,
                    totalTokens: 120,
                    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
                },
                stopReason: "stop",
                timestamp: 2,
            },
            {role: "user", content: [attachment], timestamp: 3},
        ];

        const usage = estimateStoredContextTokens(messages);
        expect(usage.usageTokens).toBe(120);
        expect(usage.trailingTokens).toBe(1_200);
        expect(usage.tokens).toBe(1_320);
    });
});
