import {Readable} from "node:stream";
import {beforeEach, describe, expect, it, vi} from "vitest";

describe("GET /api/app/logs/download", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("returns zip stream with attachment headers", async () => {
        const stream = Readable.from(["zip"]);
        const createAppLogsZipStream = vi.fn(async () => ({
            filename: "neuro-book-logs-20260628-100000.zip",
            directory: "data/logs",
            stream,
        }));
        const setResponseHeader = vi.fn();
        const sendStream = vi.fn((_event, value) => value);

        vi.doMock("nbook/server/app-logs/archive", () => ({
            createAppLogsZipStream,
        }));
        vi.doMock("h3", () => ({
            sendStream,
            setResponseHeader,
        }));

        const event = {};
        const handler = (await import("nbook/server/api/app/logs/download.get")).default;
        await expect(handler(event as never)).resolves.toBe(stream);

        expect(createAppLogsZipStream).toHaveBeenCalledOnce();
        expect(setResponseHeader).toHaveBeenCalledWith(event, "Content-Type", "application/zip");
        expect(setResponseHeader).toHaveBeenCalledWith(
            event,
            "Content-Disposition",
            "attachment; filename=\"neuro-book-logs-20260628-100000.zip\"; filename*=UTF-8''neuro-book-logs-20260628-100000.zip",
        );
        expect(sendStream).toHaveBeenCalledWith(event, stream);
    });
});
