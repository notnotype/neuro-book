import {beforeEach, describe, expect, it, vi} from "vitest";

type DeleteFailure = Error & {
    readonly operation?: string;
    readonly committed?: boolean | "unknown";
    readonly lifecycleKind?: "transaction" | "release";
};

const mocks = vi.hoisted(() => ({
    order: [] as string[],
    closeProject: vi.fn(async () => {
        mocks.order.push("close");
    }),
    deleteProject: vi.fn(async () => {
        mocks.order.push("delete");
        return {revision: 8, projectRoot: "book"};
    }),
    projectOccupancy: vi.fn(() => null as {agentActive: boolean} | null),
    archiveSessionsByProjectRoot: vi.fn(async () => {
        mocks.order.push("archive");
        return 1;
    }),
    warn: vi.fn(),
}));

vi.mock("nbook/server/api/projects/project-control-plane", () => ({
    requireProjectRefQuery: vi.fn(() => ({projectRoot: "book"})),
}));
vi.mock("nbook/server/runtime/product-project", () => ({
    closeProject: mocks.closeProject,
    deleteProject: mocks.deleteProject,
    projectOccupancy: mocks.projectOccupancy,
}));
vi.mock("nbook/server/agent/http", () => ({
    useAgentHarness: vi.fn(() => ({archiveSessionsByProjectRoot: mocks.archiveSessionsByProjectRoot})),
}));
vi.mock("consola", () => ({consola: {warn: mocks.warn}}));
vi.mock("nbook/server/workspace-files/project-lifecycle", () => ({
    isProjectLifecycleTransactionError: (error: DeleteFailure) => error.lifecycleKind === "transaction",
    isProjectLifecycleLockReleaseFailedError: (error: DeleteFailure) => error.lifecycleKind === "release",
}));
vi.mock("nbook/server/api/projects/project-http-error", () => ({
    throwProjectHttpError: (error: unknown): never => {
        throw error;
    },
}));

describe("DELETE /api/projects/item", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.order.length = 0;
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        mocks.projectOccupancy.mockReturnValue(null);
    });

    it("按 close、Lifecycle delete、Session archive 顺序返回 revision", async () => {
        const handler = (await import("nbook/server/api/projects/item.delete")).default;

        await expect(handler({} as never)).resolves.toEqual({revision: 8, projectRoot: "book"});
        expect(mocks.order).toEqual(["close", "delete", "archive"]);
    });

    it("close 失败时不删除也不归档", async () => {
        const failure = new Error("close failed");
        mocks.closeProject.mockRejectedValueOnce(failure);
        const handler = (await import("nbook/server/api/projects/item.delete")).default;

        await expect(handler({} as never)).rejects.toBe(failure);
        expect(mocks.deleteProject).not.toHaveBeenCalled();
        expect(mocks.archiveSessionsByProjectRoot).not.toHaveBeenCalled();
    });

    it("agent 正在运行时在 close 前拒绝删除", async () => {
        mocks.projectOccupancy.mockReturnValue({agentActive: true});
        const handler = (await import("nbook/server/api/projects/item.delete")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: expect.objectContaining({code: "PROJECT_IN_USE", projectRoot: "book"}),
        });
        expect(mocks.closeProject).not.toHaveBeenCalled();
        expect(mocks.deleteProject).not.toHaveBeenCalled();
        expect(mocks.archiveSessionsByProjectRoot).not.toHaveBeenCalled();
    });

    it.each([false, "unknown"] as const)("delete committed=%s 时不归档", async (committed) => {
        const failure = Object.assign(new Error("delete failed"), {
            lifecycleKind: "transaction" as const,
            operation: "delete",
            committed,
        });
        mocks.deleteProject.mockRejectedValueOnce(failure);
        const handler = (await import("nbook/server/api/projects/item.delete")).default;

        await expect(handler({} as never)).rejects.toBe(failure);
        expect(mocks.archiveSessionsByProjectRoot).not.toHaveBeenCalled();
    });

    it.each(["transaction", "release"] as const)("delete 已提交的 %s 错误先归档再重抛", async (lifecycleKind) => {
        const failure = Object.assign(new Error("release failed"), {
            lifecycleKind,
            operation: "delete",
            committed: true,
        });
        mocks.deleteProject.mockRejectedValueOnce(failure);
        const handler = (await import("nbook/server/api/projects/item.delete")).default;

        await expect(handler({} as never)).rejects.toBe(failure);
        expect(mocks.order).toEqual(["close", "archive"]);
    });

    it("归档失败不改变已提交删除响应", async () => {
        mocks.archiveSessionsByProjectRoot.mockRejectedValueOnce(new Error("archive failed"));
        const handler = (await import("nbook/server/api/projects/item.delete")).default;

        await expect(handler({} as never)).resolves.toEqual({revision: 8, projectRoot: "book"});
        expect(mocks.warn).toHaveBeenCalledOnce();
    });
});
