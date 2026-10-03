import type {H3Event} from "h3";
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    missingSessionId: 12,
    getSessionContextInspection: vi.fn(),
}));

vi.mock("h3", async (importOriginal) => ({
    ...await importOriginal<typeof import("h3")>(),
    getQuery: () => ({}),
}));

vi.mock("nbook/server/agent/http", async () => {
    const actual = await vi.importActual<typeof import("nbook/server/agent/http")>("nbook/server/agent/http");
    return {
        ...actual,
        requireAgentSessionId: () => 12,
        useAgentHarness: () => ({
            getSessionContextInspection: mocks.getSessionContextInspection,
        }),
    };
});

let handler: (event: H3Event) => Promise<unknown>;
const originalDefineEventHandler = (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler;

beforeAll(async () => {
    vi.stubGlobal("defineEventHandler", (routeHandler: typeof handler) => routeHandler);
    handler = (await import("nbook/server/api/agent/sessions/[sessionId]/context-inspection.get")).default;
});

afterAll(() => {
    vi.unstubAllGlobals();
    (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler = originalDefineEventHandler;
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.missingSessionId = 12;
    mocks.getSessionContextInspection.mockImplementation(async () => {
        throw Object.assign(new Error("missing"), {
            name: "AgentSessionNotFoundError",
            code: "SESSION_NOT_FOUND",
            sessionId: mocks.missingSessionId,
        });
    });
});

describe("GET /api/agent/sessions/:sessionId/context-inspection", () => {
    it.each([
        [12, 404, "SESSION_NOT_FOUND"],
        [13, 409, "SESSION_DEPENDENCY_NOT_FOUND"],
    ] as const)("按缺失 Session %i 保留目标或关联生命周期错误", async (missingSessionId, statusCode, code) => {
        mocks.missingSessionId = missingSessionId;

        await expect(handler({} as H3Event)).rejects.toMatchObject({
            statusCode,
            data: {code},
        });
    });
});
