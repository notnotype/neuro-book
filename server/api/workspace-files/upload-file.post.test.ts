import {describe, expect, it, vi, beforeEach} from "vitest";
import {testAbsoluteFsPath} from "nbook/server/runtime/paths/test-path";

describe("POST /api/workspace-files/upload-file", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.doMock("nbook/server/workspace-files/project-open-guard", () => ({
            withProjectTargetMutation: vi.fn((_target, handler: (handles: undefined) => unknown) => handler(undefined)),
        }));
        vi.doMock("nbook/server/workspace-history/tracked-workspace-files", () => ({
            USER_LOCAL_ACTOR: {kind: "user", userId: "local"},
            recordUploadedFiles: vi.fn(),
        }));
    });

    it("resolves user-assets uploads to Workspace Root .nbook", async () => {
        const root = testAbsoluteFsPath("workspace-upload-file", "workspace", ".nbook");
        const resolveWorkspaceFileTarget = vi.fn(async () => ({kind: "user-assets" as const, root}));
        const uploadWorkspaceFile = vi.fn(async () => ({written: 1, skipped: 0, totalBytes: 3, files: []}));

        vi.doMock("h3", () => ({
            createError: (input: {statusCode?: number; message?: string}) => Object.assign(new Error(input.message), input),
            getRequestHeader: vi.fn(() => undefined),
            readMultipartFormData: vi.fn(async () => [
                {name: "workspaceKind", data: Buffer.from("user-assets")},
                {name: "file", filename: "cover.jpg", data: Buffer.from([1, 2, 3]), type: "image/jpeg"},
            ]),
        }));
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({
            resolveWorkspaceFileTarget,
        }));
        vi.doMock("nbook/server/runtime/paths/runtime-paths", () => ({runtimePathsFromEnv: vi.fn(() => ({}))}));
        vi.doMock("nbook/server/workspace-files/workspace-upload", () => ({
            uploadWorkspaceFile,
            WorkspaceUploadError: class WorkspaceUploadError extends Error {
                statusCode = 400;
            },
        }));
        vi.doMock("nbook/server/utils/prisma", () => ({prisma: {}}));

        const handler = (await import("nbook/server/api/workspace-files/upload-file.post")).default;
        await handler({} as never);

        expect(resolveWorkspaceFileTarget).toHaveBeenCalledWith(expect.anything(), {
            projectRoot: undefined,
            workspaceKind: "user-assets",
        });
        expect(uploadWorkspaceFile).toHaveBeenCalledWith(root, {
            fileName: "cover.jpg",
            data: Buffer.from([1, 2, 3]),
        });
    });

    it("rejects content-length above single file limit", async () => {
        vi.doMock("h3", () => ({
            createError: (input: {statusCode?: number; message?: string}) => Object.assign(new Error(input.message), input),
            getRequestHeader: vi.fn(() => String(51 * 1024 * 1024 + 1)),
            readMultipartFormData: vi.fn(),
        }));
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({
            resolveWorkspaceFileTarget: vi.fn(),
        }));
        vi.doMock("nbook/server/runtime/paths/runtime-paths", () => ({runtimePathsFromEnv: vi.fn(() => ({}))}));
        vi.doMock("nbook/server/workspace-files/workspace-upload", () => ({
            uploadWorkspaceFile: vi.fn(),
            WorkspaceUploadError: class WorkspaceUploadError extends Error {
                statusCode = 400;
            },
        }));
        vi.doMock("nbook/server/utils/prisma", () => ({prisma: {}}));

        const handler = (await import("nbook/server/api/workspace-files/upload-file.post")).default;
        await expect(handler({} as never)).rejects.toMatchObject({statusCode: 413});
    });
});
