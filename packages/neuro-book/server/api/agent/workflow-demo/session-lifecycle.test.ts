import type {H3Event} from "h3";
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    sessionTree: vi.fn(),
    directChat: vi.fn(),
}));

const h3State = vi.hoisted(() => ({
    routerParam: "12" as string | undefined,
    body: {sessionId: 12, message: "hello"} as {sessionId?: number; message?: string},
}));

vi.mock("h3", async (importOriginal) => ({
    ...await importOriginal<typeof import("h3")>(),
    getRouterParam: () => h3State.routerParam,
    readBody: async () => h3State.body,
}));

vi.mock("nbook/server/agent/workflow/workflow-demo-service", () => ({
    useWorkflowDemoService: () => ({
        sessionTree: mocks.sessionTree,
        directChat: mocks.directChat,
    }),
}));

vi.mock("nbook/server/agent/http", async () => {
    return vi.importActual<typeof import("nbook/server/agent/http")>("nbook/server/agent/http");
});

let treeHandler: (event: H3Event) => Promise<unknown>;
let directChatHandler: (event: H3Event) => Promise<unknown>;
const originalDefineEventHandler = (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler;

beforeAll(async () => {
    vi.stubGlobal("defineEventHandler", (routeHandler: typeof treeHandler) => routeHandler);
    treeHandler = (await import("nbook/server/api/agent/workflow-demo/sessions/[sessionId]/tree.get")).default;
    directChatHandler = (await import("nbook/server/api/agent/workflow-demo/direct-chat.post")).default;
});

afterAll(() => {
    vi.unstubAllGlobals();
    (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler = originalDefineEventHandler;
});

beforeEach(() => {
    vi.clearAllMocks();
    h3State.routerParam = "12";
    h3State.body = {sessionId: 12, message: "hello"};
});

describe("Workflow Preview Session lifecycle", () => {
    it("tree 保留目标 Session 404", async () => {
        mocks.sessionTree.mockRejectedValue(sessionMissing(12));

        await expect(treeHandler({} as H3Event)).rejects.toMatchObject({
            statusCode: 404,
            data: {code: "SESSION_NOT_FOUND"},
        });
    });

    it("direct-chat 保留关联 Session 409", async () => {
        mocks.directChat.mockRejectedValue(sessionMissing(13));

        await expect(directChatHandler({} as H3Event)).rejects.toMatchObject({
            statusCode: 409,
            data: {code: "SESSION_DEPENDENCY_NOT_FOUND"},
        });
    });

    it("其它 tree/direct-chat 错误维持既有 404/400", async () => {
        mocks.sessionTree.mockRejectedValue(new Error("tree failed"));
        mocks.directChat.mockRejectedValue(new Error("chat failed"));

        await expect(treeHandler({} as H3Event)).rejects.toMatchObject({statusCode: 404});
        await expect(directChatHandler({} as H3Event)).rejects.toMatchObject({statusCode: 400});
    });

    it.each([undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
        "direct-chat 拒绝非安全正整数 sessionId %s",
        async (badSessionId) => {
            h3State.body = {sessionId: badSessionId, message: "hello"};

            await expect(directChatHandler({} as H3Event)).rejects.toMatchObject({statusCode: 400});
            expect(mocks.directChat).not.toHaveBeenCalled();
        },
    );

    it.each(["0", "-12", "12.5", "abc", String(Number.MAX_SAFE_INTEGER + 1), undefined])(
        "tree 路由拒绝非法 sessionId 参数 %s",
        async (rawSessionId) => {
            h3State.routerParam = rawSessionId;

            await expect(treeHandler({} as H3Event)).rejects.toMatchObject({
                statusCode: 400,
                message: "sessionId 必须是正整数",
            });
            expect(mocks.sessionTree).not.toHaveBeenCalled();
        },
    );
});

/** 构造跨 HMR 仍可识别的 Session 生命周期错误。 */
function sessionMissing(sessionId: number): Error {
    return Object.assign(new Error("missing"), {
        name: "AgentSessionNotFoundError",
        code: "SESSION_NOT_FOUND",
        sessionId,
    });
}
