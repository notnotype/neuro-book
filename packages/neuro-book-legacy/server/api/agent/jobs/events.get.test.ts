import {beforeEach, describe, expect, it, vi} from "vitest";
import {createApp, defineEventHandler, toWebHandler} from "h3";

describe("GET /api/agent/jobs/events", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", defineEventHandler);
    });

    it("解析恢复游标并通过通用 writer 写出全局事件流", async () => {
        const subscription = {kind: "job-subscription"};
        const subscribeEvents = vi.fn(() => subscription);
        const recoverInterrupted = vi.fn(async () => {});
        const writeAgentEventStream = vi.fn(async () => {});
        vi.doMock("h3", async (importOriginal) => ({
            ...(await importOriginal<typeof import("h3")>()),
            getQuery: vi.fn(() => ({eventEpoch: "epoch-1", after: "12"})),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentHarness: vi.fn(() => ({jobs: {subscribeEvents, recoverInterrupted}})),
        }));
        vi.doMock("nbook/server/agent/events/agent-sse-writer", () => ({writeAgentEventStream}));
        const response = {kind: "node-response"};

        const handler = (await import("nbook/server/api/agent/jobs/events.get")).default;
        await handler({node: {res: response}} as never);

        expect(recoverInterrupted).toHaveBeenCalledOnce();
        expect(subscribeEvents).toHaveBeenCalledWith({eventEpoch: "epoch-1", after: 12});
        expect(writeAgentEventStream).toHaveBeenCalledWith(response, subscription);
    });

    it.each([
        ["缺少 after", "eventEpoch=epoch-1"],
        ["空 after", "eventEpoch=epoch-1&after="],
        ["小数 after", "eventEpoch=epoch-1&after=1.5"],
        ["负数 after", "eventEpoch=epoch-1&after=-1"],
        ["数组 after", "eventEpoch=epoch-1&after=1&after=2"],
        ["空 eventEpoch", "eventEpoch=%20&after=0"],
        ["未知字段", "eventEpoch=epoch-1&after=0&unexpected=value"],
    ])("以 HTTP 400 拒绝%s", async (_label, query) => {
        const subscribeEvents = vi.fn();
        const recoverInterrupted = vi.fn(async () => {});
        vi.doUnmock("h3");
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentHarness: vi.fn(() => ({jobs: {subscribeEvents, recoverInterrupted}})),
        }));
        vi.doMock("nbook/server/agent/events/agent-sse-writer", () => ({writeAgentEventStream: vi.fn()}));

        const handler = (await import("nbook/server/api/agent/jobs/events.get")).default;
        const app = createApp();
        app.use("/api/agent/jobs/events", handler);

        const response = await toWebHandler(app)(new Request(`http://localhost/api/agent/jobs/events?${query}`));
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            statusCode: 400,
            data: {code: "INVALID_AGENT_JOB_EVENTS_QUERY", issues: expect.any(Array)},
        });
        expect(subscribeEvents).not.toHaveBeenCalled();
    });
});
