import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

type TestEvent = {
    headers: Record<string, string | undefined>;
    responseHeaders: Record<string, string>;
};

describe("app version startup nonce", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.doMock("h3", () => ({
            getRequestHeader: (event: TestEvent, name: string) => event.headers[name],
            setResponseHeader: (event: TestEvent, name: string, value: string) => {
                event.responseHeaders[name] = value;
            },
        }));
        vi.stubEnv("NEURO_BOOK_STARTUP_NONCE", "a".repeat(32));
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it("普通请求不返回启动 nonce，并禁止缓存", async () => {
        const handler = await loadHandler();
        const event: TestEvent = {headers: {}, responseHeaders: {}};
        const value = await handler(event);

        expect(value).not.toHaveProperty("startupNonce");
        expect(event.responseHeaders["cache-control"]).toBe("no-store");
    });

    it("只有精确的 Manager header 能读回启动 nonce", async () => {
        const handler = await loadHandler();
        const valid: TestEvent = {
            headers: {"x-neuro-book-startup-nonce": "a".repeat(32)},
            responseHeaders: {},
        };
        const invalid: TestEvent = {
            headers: {"x-neuro-book-startup-nonce": "b".repeat(32)},
            responseHeaders: {},
        };

        await expect(handler(valid)).resolves.toHaveProperty("startupNonce", "a".repeat(32));
        await expect(handler(invalid)).resolves.not.toHaveProperty("startupNonce");
    });
});

async function loadHandler(): Promise<(event: TestEvent) => Promise<Record<string, unknown>>> {
    return (await import("nbook/server/api/app/version.get")).default as (event: TestEvent) => Promise<Record<string, unknown>>;
}
