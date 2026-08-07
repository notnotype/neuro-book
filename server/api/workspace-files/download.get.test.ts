import {Readable} from "node:stream";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {testAbsoluteFsPath} from "nbook/server/runtime/paths/test-path";
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";

describe("GET /api/workspace-files/download", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("只按 projectRoot 解析 Project Workspace，忽略 root 查询参数", async () => {
        const target = {
            kind: "project-workspace" as const,
            root: testAbsoluteFsPath("workspace-download", "workspace", "novel-1"),
            projectRoot: projectWorkspaceRef("novel-1").projectRoot,
        };
        const resolveWorkspaceFileTarget = vi.fn(async () => target);
        const ref = projectWorkspaceRef("novel-1");
        const workspace = resolvedProjectWorkspace(
            ref,
            target.root,
            createProjectWorkspaceKey(testAbsoluteFsPath("workspace-download", "workspace"), ref),
        );
        const createProjectWorkspaceZipStream = vi.fn(async () => ({
            root: target.root,
            filename: "novel-1.zip",
            stream: Readable.from([]),
        }));

        vi.stubGlobal("getQuery", () => ({
            projectRoot: "novel-1",
            root: "server",
        }));
        vi.doMock("h3", () => ({
            createError: (input: {statusCode?: number; message?: string}) => Object.assign(new Error(input.message), input),
            sendStream: vi.fn((_event, stream) => stream),
            setResponseHeader: vi.fn(),
        }));
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({
            resolveWorkspaceFileTarget,
            USER_ASSETS_WORKSPACE_KIND: "user-assets",
        }));
        vi.doMock("nbook/server/runtime/paths/runtime-paths", () => ({runtimePathsFromEnv: vi.fn(() => ({}))}));
        vi.doMock("nbook/server/workspace-files/workspace-archive", () => ({
            createProjectWorkspaceZipStream,
            createWorkspaceZipStream: vi.fn(),
        }));
        vi.doMock("nbook/server/workspace-files/project-open-guard", () => ({
            withProjectTargetOperation: vi.fn((_target, handler: (handles: unknown) => unknown) => handler({
                ready: {workspace, generation: 1},
                fileIndex: {},
                history: {},
            })),
        }));
        vi.doMock("nbook/server/utils/prisma", () => ({
            prisma: {},
        }));

        const handler = (await import("nbook/server/api/workspace-files/download.get")).default;
        await handler({} as never);

        expect(resolveWorkspaceFileTarget).toHaveBeenCalledWith(expect.anything(), {
            projectRoot: "novel-1",
            workspaceKind: undefined,
        });
        expect(createProjectWorkspaceZipStream).toHaveBeenCalledWith(workspace);
    });

    it("user-assets 继续使用普通 workspace archive", async () => {
        const target = {
            kind: "user-assets" as const,
            root: testAbsoluteFsPath("workspace-download", "state", ".nbook"),
        };
        const resolveWorkspaceFileTarget = vi.fn(async () => target);
        const createWorkspaceZipStream = vi.fn(async () => ({
            root: target.root,
            filename: ".nbook.zip",
            stream: Readable.from([]),
        }));
        const createProjectWorkspaceZipStream = vi.fn();

        vi.stubGlobal("getQuery", () => ({workspaceKind: "user-assets"}));
        vi.doMock("h3", () => ({
            createError: (input: {statusCode?: number; message?: string}) => Object.assign(new Error(input.message), input),
            sendStream: vi.fn((_event, stream) => stream),
            setResponseHeader: vi.fn(),
        }));
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({
            resolveWorkspaceFileTarget,
            USER_ASSETS_WORKSPACE_KIND: "user-assets",
        }));
        vi.doMock("nbook/server/runtime/paths/runtime-paths", () => ({runtimePathsFromEnv: vi.fn(() => ({}))}));
        vi.doMock("nbook/server/workspace-files/workspace-archive", () => ({
            createProjectWorkspaceZipStream,
            createWorkspaceZipStream,
        }));
        vi.doMock("nbook/server/workspace-files/project-open-guard", () => ({
            withProjectTargetOperation: vi.fn((_target, handler: (handles: undefined) => unknown) => handler(undefined)),
        }));

        const handler = (await import("nbook/server/api/workspace-files/download.get")).default;
        await handler({} as never);

        expect(createWorkspaceZipStream).toHaveBeenCalledWith(target.root);
        expect(createProjectWorkspaceZipStream).not.toHaveBeenCalled();
    });

    it("缺少 projectRoot 时拒绝下载", async () => {
        vi.stubGlobal("getQuery", () => ({
            root: "workspace/novel-1",
        }));
        vi.doMock("h3", () => ({
            createError: (input: {statusCode?: number; message?: string}) => Object.assign(new Error(input.message), input),
            sendStream: vi.fn(),
            setResponseHeader: vi.fn(),
        }));
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({
            resolveWorkspaceFileTarget: vi.fn(),
            USER_ASSETS_WORKSPACE_KIND: "user-assets",
        }));
        vi.doMock("nbook/server/workspace-files/workspace-archive", () => ({
            createProjectWorkspaceZipStream: vi.fn(),
            createWorkspaceZipStream: vi.fn(),
        }));
        vi.doMock("nbook/server/utils/prisma", () => ({
            prisma: {},
        }));

        const handler = (await import("nbook/server/api/workspace-files/download.get")).default;
        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 400,
            message: "projectRoot 不能为空",
        });
    });
});
