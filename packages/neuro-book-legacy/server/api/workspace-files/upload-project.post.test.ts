import {describe, expect, it, vi, beforeEach} from "vitest";
import { testAbsoluteFsPath } from "@notnotype/neuro-book-test-support/test-path";

const root = testAbsoluteFsPath("workspace-upload-project", "workspace", "novel-7");

function parseBinding(input: Record<string, unknown>): {projectRoot: string; publicId: string} | {workspaceKind: "user-assets"} {
    if (input.workspaceKind === "user-assets") return {workspaceKind: "user-assets"};
    if (typeof input.projectRoot !== "string" || !input.projectRoot.trim() || typeof input.publicId !== "string" || !input.publicId.trim()) {
        throw Object.assign(new Error("projectRoot 不能为空"), {statusCode: 400});
    }
    return {projectRoot: input.projectRoot, publicId: input.publicId};
}

describe("POST /api/workspace-files/upload-project", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.doMock("nbook/server/workspace-files/project-open-guard", () => ({
            parseWorkspaceFileHttpBinding: parseBinding,
            withBoundProjectTargetMutation: vi.fn((_target, _binding, handler: (handles: undefined) => unknown) => handler(undefined)),
        }));
        vi.doMock("nbook/server/workspace-history/tracked-workspace-files", () => ({
            USER_LOCAL_ACTOR: {kind: "user", userId: "local"},
            recordUploadedFiles: vi.fn(),
        }));
        vi.doMock("nbook/server/runtime/paths/runtime-paths", () => ({runtimePathsFromEnv: vi.fn(() => ({}))}));
    });

    it("passes directory relative paths in file order", async () => {
        const uploadWorkspaceProjectFiles = vi.fn(async () => ({written: 2, skipped: 0, totalBytes: 6, files: []}));

        vi.doMock("h3", () => ({
            createError: (input: {statusCode?: number; message?: string}) => Object.assign(new Error(input.message), input),
            getRequestHeader: vi.fn(() => undefined),
            readMultipartFormData: vi.fn(async () => [
                {name: "projectRoot", data: Buffer.from("novel-7")},
                {name: "publicId", data: Buffer.from("opened-id")},
                {name: "mode", data: Buffer.from("files")},
                {name: "files", filename: "index.md", data: Buffer.from("one")},
                {name: "relativePath", data: Buffer.from("project/index.md")},
                {name: "files", filename: "index.md", data: Buffer.from("two")},
                {name: "relativePath", data: Buffer.from("project/nested/index.md")},
            ]),
        }));
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({
            resolveWorkspaceFileTarget: vi.fn(async () => ({kind: "project-workspace", root, projectRoot: "novel-7"})),
        }));
        vi.doMock("nbook/server/workspace-files/workspace-upload", () => ({
            uploadWorkspaceProjectFiles,
            uploadWorkspaceProjectZip: vi.fn(),
            WorkspaceUploadError: class WorkspaceUploadError extends Error {
                statusCode = 400;
            },
        }));
        vi.doMock("nbook/server/utils/prisma", () => ({prisma: {}}));

        const handler = (await import("nbook/server/api/workspace-files/upload-project.post")).default;
        await handler({} as never);

        expect(uploadWorkspaceProjectFiles).toHaveBeenCalledWith({kind: "project-workspace", root, projectRoot: "novel-7"}, [
            {fileName: "index.md", relativePath: "project/index.md", data: Buffer.from("one")},
            {fileName: "index.md", relativePath: "project/nested/index.md", data: Buffer.from("two")},
        ]);
    });

    it("routes zip uploads to zip importer", async () => {
        const uploadWorkspaceProjectZip = vi.fn(async () => ({written: 1, skipped: 0, totalBytes: 3, files: []}));

        vi.doMock("h3", () => ({
            createError: (input: {statusCode?: number; message?: string}) => Object.assign(new Error(input.message), input),
            getRequestHeader: vi.fn(() => undefined),
            readMultipartFormData: vi.fn(async () => [
                {name: "projectRoot", data: Buffer.from("novel-7")},
                {name: "publicId", data: Buffer.from("opened-id")},
                {name: "mode", data: Buffer.from("zip")},
                {name: "zip", filename: "project.zip", data: Buffer.from([1, 2, 3])},
            ]),
        }));
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({
            resolveWorkspaceFileTarget: vi.fn(async () => ({kind: "project-workspace", root, projectRoot: "novel-7"})),
        }));
        vi.doMock("nbook/server/workspace-files/workspace-upload", () => ({
            uploadWorkspaceProjectFiles: vi.fn(),
            uploadWorkspaceProjectZip,
            WorkspaceUploadError: class WorkspaceUploadError extends Error {
                statusCode = 400;
            },
        }));
        vi.doMock("nbook/server/utils/prisma", () => ({prisma: {}}));

        const handler = (await import("nbook/server/api/workspace-files/upload-project.post")).default;
        await handler({} as never);

        expect(uploadWorkspaceProjectZip).toHaveBeenCalledWith({kind: "project-workspace", root, projectRoot: "novel-7"}, {
            fileName: "project.zip",
            data: Buffer.from([1, 2, 3]),
        });
    });
});
