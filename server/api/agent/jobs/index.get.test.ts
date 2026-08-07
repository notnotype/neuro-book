import {beforeEach, describe, expect, it, vi} from "vitest";
import {createApp, defineEventHandler, toWebHandler} from "h3";

describe("GET /api/agent/jobs", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", defineEventHandler);
    });

    it("原子返回过滤快照与对应事件游标", async () => {
        const response = {
            jobs: [],
            eventCursor: {eventEpoch: "epoch-1", after: 12},
        };
        const recovery = vi.fn(() => response);
        const recoverInterrupted = vi.fn(async () => {});
        vi.doMock("h3", async (importOriginal) => ({
            ...(await importOriginal<typeof import("h3")>()),
            getQuery: vi.fn(() => ({ownerSessionId: "7", status: "waiting"})),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentHarness: vi.fn(() => ({jobs: {recovery, recoverInterrupted}})),
        }));

        const handler = (await import("nbook/server/api/agent/jobs/index.get")).default;

        await expect(handler({} as never)).resolves.toEqual(response);
        expect(recoverInterrupted).toHaveBeenCalledOnce();
        expect(recovery).toHaveBeenCalledWith({ownerSessionId: 7, status: "waiting"});
    });

    it.each([
        ["非法 status", "status=unknown"],
        ["ownerSessionId 不是整数", "ownerSessionId=1.5"],
        ["ownerSessionId 不是正数", "ownerSessionId=0"],
        ["ownerSessionId 是数组", "ownerSessionId=7&ownerSessionId=8"],
        ["包含未知字段", "unexpected=value"],
    ])("以 HTTP 400 拒绝%s", async (_label, query) => {
        const useAgentHarness = vi.fn();
        vi.doUnmock("h3");
        vi.doMock("nbook/server/agent/http", () => ({useAgentHarness}));
        const handler = (await import("nbook/server/api/agent/jobs/index.get")).default;
        const app = createApp();
        app.use("/api/agent/jobs", handler);

        const response = await toWebHandler(app)(new Request(`http://localhost/api/agent/jobs?${query}`));
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            statusCode: 400,
            data: {code: "INVALID_AGENT_JOB_LIST_QUERY", issues: expect.any(Array)},
        });
        expect(useAgentHarness).not.toHaveBeenCalled();
    });
});
