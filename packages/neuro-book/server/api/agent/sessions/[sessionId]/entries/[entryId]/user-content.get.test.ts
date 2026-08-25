import type {H3Event} from "h3";
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    getAgentSessionUserContent: vi.fn(),
}));

vi.mock("h3", async (importOriginal) => ({
    ...await importOriginal<typeof import("h3")>(),
    getRouterParam: (_event: H3Event, name: string) => name === "entryId" ? "entry-1" : undefined,
}));

vi.mock("nbook/server/agent/http", async () => {
    const actual = await vi.importActual<typeof import("nbook/server/agent/http")>("nbook/server/agent/http");
    return {
        ...actual,
        requireAgentSessionId: () => 12,
        getAgentSessionUserContent: (sessionId: number, entryId: string) => actual.withAgentSessionHttpError(
            sessionId,
            () => mocks.getAgentSessionUserContent(sessionId, entryId),
        ),
    };
});

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
        mocks.getAgentSessionUserContent.mockRejectedValue(Object.assign(new Error("missing"), {
            name: "AgentSessionNotFoundError",
            code: "SESSION_NOT_FOUND",
            sessionId: 12,
        }));

        await expect(handler({} as H3Event)).rejects.toMatchObject({
            statusCode: 404,
            data: {code: "SESSION_NOT_FOUND"},
        });
    });

    it("保留 Session Dependency Not Found，不改写为 User Message Not Found", async () => {
        mocks.getAgentSessionUserContent.mockRejectedValue(Object.assign(new Error("missing"), {
            name: "AgentSessionNotFoundError",
            code: "SESSION_NOT_FOUND",
            sessionId: 13,
        }));

        await expect(handler({} as H3Event)).rejects.toMatchObject({
            statusCode: 409,
            data: {code: "SESSION_DEPENDENCY_NOT_FOUND"},
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
