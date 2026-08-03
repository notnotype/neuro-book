import type {H3Event} from "h3";
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    getAgentSessionUserContent: vi.fn(),
}));

vi.mock("h3", async (importOriginal) => ({
    ...await importOriginal<typeof import("h3")>(),
    getRouterParam: (_event: H3Event, name: string) => name === "entryId" ? "entry-1" : undefined,
}));

vi.mock("nbook/server/agent/http", () => ({
    getAgentSessionUserContent: mocks.getAgentSessionUserContent,
    isAgentSessionNotFoundHttpError: (error: unknown) => typeof error === "object"
        && error !== null
        && "data" in error
        && (error as {data?: {code?: string}}).data?.code === "SESSION_NOT_FOUND",
    requireAgentSessionId: () => 12,
}));

vi.mock("nbook/server/api/projects/project-http-error", () => ({
    withProjectHttpError: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
}));

vi.mock("nbook/server/workspace-files/project-session", () => ({
    isProjectNotOpenError: () => false,
}));

let handler: (event: H3Event) => Promise<unknown>;
const originalDefineEventHandler = (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler;

beforeAll(async () => {
    vi.stubGlobal("defineEventHandler", (routeHandler: typeof handler) => routeHandler);
    handler = (await import("nbook/server/api/agent/sessions/[sessionId]/entries/[entryId]/user-content.get")).default;
});

afterAll(() => {
    vi.unstubAllGlobals();
    (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler = originalDefineEventHandler;
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe("GET /api/agent/sessions/:sessionId/entries/:entryId/user-content", () => {
    it("保留 Session Not Found，不改写为 User Message Not Found", async () => {
        mocks.getAgentSessionUserContent.mockRejectedValue(Object.assign(new Error("Session 不存在或已不可用"), {
            statusCode: 404,
            data: {code: "SESSION_NOT_FOUND"},
        }));

        await expect(handler({} as H3Event)).rejects.toMatchObject({
            statusCode: 404,
            data: {code: "SESSION_NOT_FOUND"},
        });
    });

    it("普通 entry 缺失继续映射为 User Message Not Found", async () => {
        mocks.getAgentSessionUserContent.mockRejectedValue(new Error("entry missing"));

        await expect(handler({} as H3Event)).rejects.toMatchObject({
            statusCode: 404,
            data: {code: "USER_MESSAGE_NOT_FOUND"},
        });
    });
});
