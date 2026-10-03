import {describe, expect, it} from "vitest";
import {projectQueuedMessage, projectQueuedMessages} from "nbook/server/agent/events/public-queue-projection";

describe("public queue projection", () => {
    it("图片 base64 和大 payload 不进入公开 queue item", () => {
        const attachmentId = `sha256:${"a".repeat(64)}` as const;
        const projected = projectQueuedMessage({
            id: "queue-1",
            clientMessageId: "message-queue-1",
            kind: "steer",
            message: {content: [
                {type: "text", text: "x".repeat(100_000)},
                {type: "attachment", attachment: {id: attachmentId, mimeType: "image/png", bytes: 10 * 1024 * 1024}},
            ]},
            input: {nested: "y".repeat(100_000)},
            createdAt: 1,
        });

        expect(projected.images).toEqual([{mimeType: "image/png", dataBytes: 10 * 1024 * 1024, dataOmitted: true}]);
        expect(projected.text?.omitted).toBe(true);
        expect(JSON.stringify(projected)).not.toContain('"data":');
        expect(Buffer.byteLength(JSON.stringify(projected), "utf8")).toBeLessThan(32 * 1024);
    });

    it("recovery queue 只公开最早 64 项", () => {
        const projected = projectQueuedMessages(Array.from({length: 100}, (_, index) => ({
            id: `queue-${String(index)}`,
            clientMessageId: `message-queue-${String(index)}`,
            kind: "followup" as const,
            message: {content: [{type: "text" as const, text: `message-${String(index)}`}]},
            createdAt: index,
        })));

        expect(projected.items).toHaveLength(64);
        expect(projected.items[0]?.id).toBe("queue-0");
        expect(projected.items.at(-1)?.id).toBe("queue-63");
        expect(projected.omittedItems).toBe(36);
        expect(Buffer.byteLength(JSON.stringify(projected), "utf8")).toBeLessThan(128 * 1024);
    });
});
