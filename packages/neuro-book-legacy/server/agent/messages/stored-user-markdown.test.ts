import {describe, expect, it} from "vitest";
import {
    appendInvocationPayload,
    serializeStoredContent,
    storedUserMessageMarkdown,
    visibleStoredUserContent,
    wrapStoredSteerContent,
} from "nbook/server/agent/messages/stored-user-markdown";
import {attachmentMarkdownTarget, serializeAgentImageMarkdown} from "nbook/shared/agent/agent-image-markdown";

const attachment = {
    id: `sha256:${"d".repeat(64)}` as const,
    mimeType: "image/png",
    bytes: 10,
};

describe("stored user Markdown", () => {
    it("序列化文字—图片—文字与重复图片时不重排", () => {
        const content = [
            {type: "text" as const, text: "前"},
            {type: "attachment" as const, attachment, name: "图一"},
            {type: "text" as const, text: "中"},
            {type: "attachment" as const, attachment, name: "图二"},
            {type: "text" as const, text: "后"},
        ];

        expect(serializeStoredContent(content)).toBe([
            "前",
            serializeAgentImageMarkdown("图一", attachmentMarkdownTarget(attachment.id)),
            "中",
            serializeAgentImageMarkdown("图二", attachmentMarkdownTarget(attachment.id)),
            "后",
        ].join(""));
    });

    it("payload 只追加到尾部，steer envelope 只包首尾", () => {
        const ordered = [
            {type: "text" as const, text: "前"},
            {type: "attachment" as const, attachment, name: "图"},
            {type: "text" as const, text: "后"},
        ];
        const payload = appendInvocationPayload(ordered, {chapter: 1});
        const wrapped = wrapStoredSteerContent(payload);
        const visible = visibleStoredUserContent({role: "user", content: wrapped, timestamp: 1}, "steer");

        expect(payload.slice(0, 3)).toEqual(ordered);
        expect(payload.at(-1)).toEqual({type: "text", text: "\n\n<payload>\n{\n  \"chapter\": 1\n}\n</payload>"});
        expect(visible.blocks.map(({contentIndex}) => contentIndex)).toEqual([1, 2, 3, 4]);
        expect(storedUserMessageMarkdown({role: "user", content: wrapped, timestamp: 1}, "steer"))
            .toBe(serializeStoredContent(payload));
    });
});
