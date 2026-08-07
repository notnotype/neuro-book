import {beforeEach, describe, expect, it, vi} from "vitest";
import {testAbsoluteFsPath} from "nbook/server/runtime/paths/test-path";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";

describe("GET /api/workspace-files/read", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("defineRouteMeta", () => undefined);
        vi.stubGlobal("getQuery", () => ({
            projectRoot: "not-open",
            path: "note.md",
        }));
        vi.doMock("nbook/server/workspace-files/project-open-guard", () => ({
            withProjectTargetOperation: vi.fn((target: {projectRoot: string}) => {
                throw Object.assign(new Error("Project未打开"), {
                    statusCode: 409,
                    data: {code: "PROJECT_NOT_OPEN", projectRoot: target.projectRoot},
                });
            }),
        }));
    });

    it("Project root 未 open 时返回 PROJECT_NOT_OPEN", async () => {
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({
            resolveWorkspaceFileTarget: vi.fn(async () => ({
                kind: "project-workspace",
                root: testAbsoluteFsPath("workspace-read", "workspace", "not-open"),
                projectRoot: projectWorkspaceRef("not-open").projectRoot,
            })),
        }));

        const handler = (await import("nbook/server/api/workspace-files/read.get")).default;
        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {
                code: "PROJECT_NOT_OPEN",
                projectRoot: "not-open",
            },
        });
    });
});
