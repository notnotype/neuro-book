import {beforeEach, describe, expect, it, vi} from "vitest";
import type {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {AgentSessionNotFoundError} from "nbook/server/agent/session/session-not-found-error";
import {ProjectNotOpenError} from "nbook/server/workspace-files/project-session-service";

const mocks = vi.hoisted(() => ({
    getQuery: vi.fn(() => ({})),
    getSessionQuery: vi.fn(),
    requireAgentSessionId: vi.fn(() => 12),
}));

describe("GET /api/agent/sessions/:sessionId", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mocks.getQuery.mockReset().mockReturnValue({});
        mocks.getSessionQuery.mockReset();
        mocks.requireAgentSessionId.mockReset().mockReturnValue(12);
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("Project 未 open 时返回稳定 PROJECT_NOT_OPEN", async () => {
        const projectRoot = "session-route-not-open";
        mocks.getQuery.mockReturnValue({});
        mocks.getSessionQuery.mockImplementation(async () => {
            throw new ProjectNotOpenError(projectRoot);
        });
        vi.doMock("h3", async (importOriginal) => ({
            ...(await importOriginal<typeof import("h3")>()),
            getQuery: mocks.getQuery,
        }));
        vi.doMock("nbook/server/agent/http", async (importOriginal) => {
            const actual = await importOriginal<typeof import("nbook/server/agent/http")>();
            const harness = {
                getSessionQuery: mocks.getSessionQuery,
            } as NeuroAgentHarness;
            return {
                ...actual,
                requireAgentSessionId: mocks.requireAgentSessionId,
                getAgentSessionQuery: (
                    sessionId: number,
                    query: Parameters<typeof actual.getAgentSessionQuery>[1],
                    _harness: NeuroAgentHarness | undefined,
                    timing: Parameters<typeof actual.getAgentSessionQuery>[3],
                ) => actual.getAgentSessionQuery(sessionId, query, harness, timing),
            };
        });
        vi.doMock("nbook/server/utils/server-timing", () => ({
            createServerTiming: vi.fn(() => ({
                mark: vi.fn(),
            })),
        }));

        const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/index.get")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {
                code: "PROJECT_NOT_OPEN",
                projectRoot,
            },
        });
    }, 10_000);

    it("把严格判别 query 交给统一 session query Interface", async () => {
        mocks.getQuery.mockReturnValue({view: "history", cursor: "cursor-1"});
        mocks.getSessionQuery.mockResolvedValue({
            kind: "history",
            sessionId: 12,
            activePathRevision: null,
            history: {entries: [], previousCursor: null},
        });
        vi.doMock("h3", async (importOriginal) => ({
            ...(await importOriginal<typeof import("h3")>()),
            getQuery: mocks.getQuery,
        }));
        vi.doMock("nbook/server/agent/http", async (importOriginal) => {
            const actual = await importOriginal<typeof import("nbook/server/agent/http")>();
            const harness = {getSessionQuery: mocks.getSessionQuery} as NeuroAgentHarness;
            return {
                ...actual,
                requireAgentSessionId: mocks.requireAgentSessionId,
                getAgentSessionQuery: (
                    sessionId: number,
                    query: Parameters<typeof actual.getAgentSessionQuery>[1],
                    _harness: NeuroAgentHarness | undefined,
                    timing: Parameters<typeof actual.getAgentSessionQuery>[3],
                ) => actual.getAgentSessionQuery(sessionId, query, harness, timing),
            };
        });
        vi.doMock("nbook/server/utils/server-timing", () => ({
            createServerTiming: vi.fn(() => ({mark: vi.fn()})),
        }));

        const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/index.get")).default;
        await expect(handler({} as never)).resolves.toEqual(expect.objectContaining({kind: "history"}));
        expect(mocks.getSessionQuery).toHaveBeenCalledWith(12, {
            view: "history",
            cursor: "cursor-1",
        }, expect.anything());
    });

    it.each([
        [12, 404, "SESSION_NOT_FOUND"],
        [13, 409, "SESSION_DEPENDENCY_NOT_FOUND"],
    ] as const)("使用生产 Session mapper 区分主/关联缺失 %i", async (missingSessionId, statusCode, code) => {
        mocks.getQuery.mockReturnValue({});
        mocks.getSessionQuery.mockRejectedValue(new AgentSessionNotFoundError(missingSessionId));
        vi.doMock("h3", async (importOriginal) => ({
            ...(await importOriginal<typeof import("h3")>()),
            getQuery: mocks.getQuery,
        }));
        vi.doMock("nbook/server/agent/http", async (importOriginal) => {
            const actual = await importOriginal<typeof import("nbook/server/agent/http")>();
            const harness = {getSessionQuery: mocks.getSessionQuery} as NeuroAgentHarness;
            return {
                ...actual,
                requireAgentSessionId: mocks.requireAgentSessionId,
                getAgentSessionQuery: (
                    sessionId: number,
                    query: Parameters<typeof actual.getAgentSessionQuery>[1],
                    _harness: NeuroAgentHarness | undefined,
                    timing: Parameters<typeof actual.getAgentSessionQuery>[3],
                ) => actual.getAgentSessionQuery(sessionId, query, harness, timing),
            };
        });
        vi.doMock("nbook/server/utils/server-timing", () => ({
            createServerTiming: vi.fn(() => ({mark: vi.fn()})),
        }));

        const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/index.get")).default;
        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode,
            data: {code},
        });
    });

    it("拒绝跨 view 的非法 query 组合", async () => {
        mocks.getQuery.mockReturnValue({view: "systemPrompt", cursor: "cursor-1"});
        vi.doMock("h3", async (importOriginal) => ({
            ...(await importOriginal<typeof import("h3")>()),
            getQuery: mocks.getQuery,
        }));
        vi.doMock("nbook/server/agent/http", async (importOriginal) => ({
            ...(await importOriginal<typeof import("nbook/server/agent/http")>()),
            requireAgentSessionId: mocks.requireAgentSessionId,
        }));
        vi.doMock("nbook/server/utils/server-timing", () => ({
            createServerTiming: vi.fn(() => ({mark: vi.fn()})),
        }));

        const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/index.get")).default;
        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 400,
            data: {code: "INVALID_SESSION_QUERY"},
        });
    });
});
