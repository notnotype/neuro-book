import {beforeEach, describe, expect, it, vi} from "vitest";
import {createError} from "h3";
import type * as AgentHttp from "nbook/server/agent/http";
import {AgentAbortDurabilityError} from "nbook/server/agent/session/abort-durability-error";
import {AgentAbortNotAllowedError} from "nbook/server/agent/session/abort-not-allowed-error";
import {AgentSessionNotFoundError} from "nbook/server/agent/session/session-not-found-error";

const mocks = vi.hoisted(() => ({
    requireAgentSessionId: vi.fn(() => 12),
    abortInvocation: vi.fn(),
    validateBody: vi.fn(),
}));

vi.mock("nbook/server/agent/http", async (importOriginal) => {
    const actual = await importOriginal<typeof AgentHttp>();
    return {
        ...actual,
        requireAgentSessionId: mocks.requireAgentSessionId,
        abortAgentSession: (
            sessionId: number,
            body: Parameters<typeof actual.abortAgentSession>[1],
        ) => actual.abortAgentSession(sessionId, body, {abortInvocation: mocks.abortInvocation} as never),
    };
});

vi.mock("nbook/server/utils/novel-chapter", () => ({
    validateBody: mocks.validateBody,
}));

describe("POST /api/agent/sessions/:sessionId/abort", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("校验 body 后转发 abort 请求并保留 aborted 响应", async () => {
        const body = {reason: "用户停止", clearQueue: false};
        mocks.validateBody.mockResolvedValue(body);
        mocks.abortInvocation.mockResolvedValue({status: "aborted", sessionId: 12});
        const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/abort.post")).default;

        await expect(handler({} as never)).resolves.toEqual({status: "aborted", sessionId: 12});
        expect(mocks.validateBody).toHaveBeenCalledWith(expect.anything(), expect.anything());
        expect(mocks.abortInvocation).toHaveBeenCalledWith(12, body);
    }, 10_000);

    it("无 active invocation 时保留 idle 幂等响应", async () => {
        mocks.validateBody.mockResolvedValue({});
        mocks.abortInvocation.mockResolvedValue({status: "idle", sessionId: 12});
        const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/abort.post")).default;

        await expect(handler({} as never)).resolves.toEqual({status: "idle", sessionId: 12});
    });
    it.each([
        [new AgentSessionNotFoundError(12), 404, "SESSION_NOT_FOUND"],
        [new AgentAbortNotAllowedError(), 409, "session_abort_not_allowed"],
        [new AgentAbortDurabilityError(new Error("C:\\private\\session.jsonl")), 503, "session_abort_durability_unavailable"],
    ] as const)("保留统一 Session HTTP 错误 %i", async (error, statusCode, code) => {
        mocks.validateBody.mockResolvedValue({});
        mocks.abortInvocation.mockRejectedValue(error);
        const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/abort.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode,
            data: {code},
        });
    });

    it("非法 body 由请求 schema 边界返回 400", async () => {
        mocks.validateBody.mockRejectedValue(createError({
            statusCode: 400,
            message: "请求 body 无效",
            data: {code: "INVALID_BODY"},
        }));
        const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/abort.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 400,
            data: {code: "INVALID_BODY"},
        });
        expect(mocks.abortInvocation).not.toHaveBeenCalled();
    });

    it("非法路径参数在调用 abort 前返回 400", async () => {
        mocks.requireAgentSessionId.mockImplementation(() => {
            throw createError({statusCode: 400, data: {code: "INVALID_SESSION_ID"}});
        });
        mocks.validateBody.mockResolvedValue({});
        const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/abort.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 400,
            data: {code: "INVALID_SESSION_ID"},
        });
        expect(mocks.validateBody).not.toHaveBeenCalled();
        expect(mocks.abortInvocation).not.toHaveBeenCalled();
    });
});
