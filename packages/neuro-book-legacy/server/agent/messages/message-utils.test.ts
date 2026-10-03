import {describe, expect, it} from "vitest";
import type {Usage} from "@earendil-works/pi-ai";
import {
    createStoredToolResultFromResult,
    createToolResultFromResult,
    normalizeToolResultDetails,
    sumUsage,
} from "nbook/server/agent/messages/message-utils";

describe("sumUsage", () => {
    it("仅当来源提供时汇总 reasoning 与 cacheWrite1h", () => {
        expect(sumUsage([usage(1, 2), usage(3, 4)])).not.toHaveProperty("reasoning");
        expect(sumUsage([
            {...usage(1, 2), reasoning: 1, cacheWrite1h: 3},
            usage(3, 4),
        ])).toMatchObject({reasoning: 1, cacheWrite1h: 3});
    });
});

describe("createToolResultFromResult", () => {
    it("AgentEvent seam 将 attachment 投影为 marker，durable seam 保留引用", () => {
        const input = {
            toolCallId: "read-1",
            toolName: "read",
            result: {
                content: [{
                    type: "attachment" as const,
                    attachment: {id: `sha256:${"a".repeat(64)}` as const, mimeType: "image/png", bytes: 8},
                    name: "cover.png",
                }],
                details: normalizeToolResultDetails({
                    path: "cover.png",
                    missing: undefined,
                    count: 2n,
                }),
            },
        };
        const eventMessage = createToolResultFromResult(input);
        const storedMessage = createStoredToolResultFromResult(input);

        expect(eventMessage.content).toEqual([{
            type: "text",
            text: "[attachment omitted: image/png, 8 bytes, cover.png]",
        }]);
        expect(storedMessage.content[0]).toMatchObject({type: "attachment", name: "cover.png"});
        expect(eventMessage.details).toEqual({path: "cover.png", count: "2"});
        expect(storedMessage.details).toEqual({path: "cover.png", count: "2"});
    });
});

function usage(input: number, output: number): Usage {
    return {
        input,
        output,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: input + output,
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
    };
}
