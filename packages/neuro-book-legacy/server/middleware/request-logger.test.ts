import {beforeEach, describe, expect, it, vi} from "vitest";

describe("request logger", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("summarizes query parameters without logging values", async () => {
        const {summarizeQuery} = await import("nbook/server/middleware/request-logger");
        const summary = summarizeQuery(new URLSearchParams([
            ["q", "小说正文片段"],
            ["token", "secret-token-value"],
            ["tag", "one"],
            ["tag", "two"],
        ]));

        expect(summary).toEqual({
            params: [
                {key: "q", valueCount: 1, redacted: false},
                {key: "token", valueCount: 1, redacted: true},
                {key: "tag", valueCount: 2, redacted: false},
            ],
            truncated: false,
        });
        expect(JSON.stringify(summary)).not.toContain("小说正文片段");
        expect(JSON.stringify(summary)).not.toContain("secret-token-value");
    });
});
