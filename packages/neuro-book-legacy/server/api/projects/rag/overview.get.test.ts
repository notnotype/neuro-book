import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {closeAllProjects, resetProjectSessionsForTest} from "nbook/server/runtime/product-project";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";

describe("GET /api/projects/rag/overview", {timeout: 30_000}, () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("defineRouteMeta", () => undefined);
    });
    it("Project 未 open 时返回稳定 PROJECT_NOT_OPEN", async () => {
        setWorkspaceRuntimeRootContextForTest({workspaceRoot: testHostPath("rag-overview-not-open")});
        try {
            vi.doMock("nbook/server/api/projects/project-control-plane", async (importOriginal) => {
                const actual = await importOriginal<typeof import("nbook/server/api/projects/project-control-plane")>();
                return {
                    ...actual,
                    requireProjectRefQuery: vi.fn(() => ({projectRoot: "rag-not-open"})),
                };
            });

            const handler = (await import("nbook/server/api/projects/rag/overview.get")).default;

            await expect(handler({} as never)).rejects.toMatchObject({
                statusCode: 409,
                data: {
                    code: "PROJECT_NOT_OPEN",
                    projectRoot: "rag-not-open",
                },
            });
        } finally {
            await closeAllProjects();
            resetProjectSessionsForTest();
            setWorkspaceRuntimeRootContextForTest(null);
        }
    });
});
