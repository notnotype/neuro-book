import {describe, expect, it, vi, beforeEach} from "vitest";

describe("GET /api/app/logs/status", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("returns app log status dto", async () => {
        const readAppLogStatus = vi.fn(async () => ({
            directory: "data/logs",
            currentFile: "data/logs/server-current.jsonl",
            files: [],
            fileCount: 0,
            totalBytes: 0,
            latestMtimeMs: null,
        }));
        vi.doMock("nbook/server/app-logs/logger", () => ({
            readAppLogStatus,
        }));

        const handler = (await import("nbook/server/api/app/logs/status.get")).default;
        await expect(handler()).resolves.toMatchObject({
            directory: "data/logs",
            fileCount: 0,
        });
        expect(readAppLogStatus).toHaveBeenCalledOnce();
    });
});
