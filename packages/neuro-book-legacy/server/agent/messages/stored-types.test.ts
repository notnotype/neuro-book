import {describe, expect, it} from "vitest";
import {parseStoredMessage, StoredMessageInvariantError} from "nbook/server/agent/messages/stored-message-codec";

describe("stored agent message", () => {
    it("拒绝持久化 Pi raw image", () => {
        expect(() => parseStoredMessage({
            role: "toolResult",
            content: [{type: "image", mimeType: "image/png", data: "AAAA"}],
        })).toThrowError(expect.objectContaining<Partial<StoredMessageInvariantError>>({code: "migration_required"}));
    });

    it("接受 attachment ref", () => {
        expect(() => parseStoredMessage({
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "read",
            content: [{
                type: "attachment",
                attachment: {id: `sha256:${"a".repeat(64)}`, mimeType: "image/png", bytes: 3},
            }],
            isError: false,
            timestamp: 1,
        })).not.toThrow();
    });

    it("拒绝损坏的 attachment ref 并区分 corrupt", () => {
        expect(() => parseStoredMessage({
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "read",
            content: [{type: "attachment", attachment: {id: "sha256:bad", mimeType: "image/png", bytes: 3}}],
            isError: false,
            timestamp: 1,
        })).toThrowError(expect.objectContaining<Partial<StoredMessageInvariantError>>({code: "corrupt"}));
    });
});
