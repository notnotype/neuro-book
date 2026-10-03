import {describe, expect, it} from "vitest";
import type {AgentChatUserEntryDto} from "nbook/shared/dto/agent-public-event.dto";
import {
    agentMessageMarkdown,
    optimisticUserMessage,
    userEntryContentIdentity,
    userEntryMarkdown,
} from "nbook/app/components/novel-ide/agent/agent-user-message-markdown";
import {attachmentMarkdownTarget, serializeAgentImageMarkdown} from "nbook/shared/agent/agent-image-markdown";

const attachmentId = `sha256:${"a".repeat(64)}` as const;
const target = attachmentMarkdownTarget(attachmentId);
const attachment = {
    attachmentId,
    mimeType: "image/png",
    bytes: 128,
    name: "原名.png",
    dataOmitted: true as const,
};

describe("Agent 用户消息 Markdown", () => {
    it("乐观消息按 Markdown 原顺序构造文字和图片 blocks", () => {
        const markdown = `前${serializeAgentImageMarkdown("新名称", target)}后`;
        const message = optimisticUserMessage({
            id: "optimistic-user-1",
            clientMessageId: "message-1",
            markdown,
            attachments: [{
                attachment,
                target,
                locator: {entryId: "registered-entry", contentIndex: 0},
                firstSeenAt: 1,
                lastSeenAt: 1,
                referenceCount: 1,
            }],
            timestamp: "刚刚",
        });

        expect(message.content).toBe("前后");
        expect(message.contentBlocks).toEqual([
            expect.objectContaining({type: "text", contentIndex: 0, content: expect.objectContaining({preview: "前"})}),
            expect.objectContaining({
                type: "attachment",
                contentIndex: 1,
                locator: {entryId: "registered-entry", contentIndex: 0},
                attachment: expect.objectContaining({name: "新名称"}),
            }),
            expect.objectContaining({type: "text", contentIndex: 2, content: expect.objectContaining({preview: "后"})}),
        ]);
        expect(agentMessageMarkdown(message)).toBe(markdown);
    });

    it("durable entry 使用同一 serializer 重建完整交错 Markdown", () => {
        const entry = userEntry([
            {type: "text", contentIndex: 0, content: {preview: "前", bytes: 3, omitted: false}},
            {type: "attachment", contentIndex: 1, attachment: {...attachment, name: "封面(一).png"}},
            {type: "text", contentIndex: 2, content: {preview: "后", bytes: 3, omitted: false}},
        ]);

        expect(userEntryMarkdown(entry)).toBe(`前${serializeAgentImageMarkdown("封面(一).png", target)}后`);
        expect(userEntryContentIdentity(entry).exact).toBeDefined();
    });

    it("公开正文或 block 被截断时要求调用 user-content API", () => {
        const omittedText = userEntry([
            {type: "text", contentIndex: 0, content: {preview: "预览", bytes: 100, omitted: true}},
            {type: "attachment", contentIndex: 1, attachment},
        ]);
        const omittedBlock = {...userEntry([{type: "attachment", contentIndex: 0, attachment}]), omittedBlocks: 1};

        expect(userEntryMarkdown(omittedText)).toBeNull();
        expect(userEntryMarkdown(omittedBlock)).toBeNull();
        expect(userEntryContentIdentity(omittedText).exact).toBeUndefined();
    });
});

function userEntry(blocks: AgentChatUserEntryDto["blocks"]): AgentChatUserEntryDto {
    return {
        id: "user-entry",
        clientMessageId: "message-user-entry",
        timestamp: 1,
        type: "user",
        blocks,
        omittedBlocks: 0,
        textSummary: {
            bytes: blocks.reduce((total, block) => total + (block.type === "text" ? block.content.bytes : 0), 0),
            omitted: blocks.some((block) => block.type === "text" && block.content.omitted),
        },
        intent: "normal",
    };
}
