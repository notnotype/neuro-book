import fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {statWorkspacePath} from "nbook/server/workspace-files/workspace-files";
import {WorkspaceWriteConflictDtoSchema} from "nbook/shared/dto/workspace-file-conflict.dto";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {testAbsoluteFsPath} from "nbook/server/runtime/paths/test-path";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";

const createdRoots: string[] = [];
const originalReadBody = (globalThis as typeof globalThis & {readBody?: unknown}).readBody;
const originalDefineEventHandler = (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler;
const originalDefineRouteMeta = (globalThis as typeof globalThis & {defineRouteMeta?: unknown}).defineRouteMeta;
let readBodyMock: ReturnType<typeof vi.fn>;

describe("PUT /api/workspace-files/write", () => {
    beforeEach(() => {
        vi.resetModules();
        readBodyMock = vi.fn();
        const globals = globalThis as typeof globalThis & {
            defineEventHandler?: <THandler>(handler: THandler) => THandler;
            defineRouteMeta?: (meta: unknown) => void;
            readBody?: typeof readBodyMock;
        };
        globals.defineEventHandler = (handler) => handler;
        globals.defineRouteMeta = () => undefined;
        globals.readBody = readBodyMock;
        vi.doMock("nbook/server/utils/prisma", () => ({
            prisma: {},
        }));
        vi.doMock("nbook/server/workspace-history/tracked-workspace-files", () => ({
            USER_LOCAL_ACTOR: {kind: "user", userId: "local"},
            writeWorkspaceTextFileTracked: vi.fn(),
        }));
        vi.doMock("nbook/server/workspace-files/project-open-guard", () => ({
            withProjectTargetMutation: vi.fn((target: {kind: string; projectRoot?: string}, handler: (handles: undefined) => unknown) => {
                if (target.kind === "project-workspace") {
                    throw Object.assign(new Error("Project未打开"), {
                        statusCode: 409,
                        data: {code: "PROJECT_NOT_OPEN", projectRoot: target.projectRoot},
                    });
                }
                return handler(undefined);
            }),
        }));
    });

    afterEach(async () => {
        const globals = globalThis as typeof globalThis & {
            defineEventHandler?: unknown;
            defineRouteMeta?: unknown;
            readBody?: unknown;
        };
        globals.defineEventHandler = originalDefineEventHandler;
        globals.defineRouteMeta = originalDefineRouteMeta;
        globals.readBody = originalReadBody;
        vi.doUnmock("nbook/server/utils/prisma");
        await Promise.all(createdRoots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
    });

    it("真实文件版本变化时会返回写入冲突", async () => {
        const root = absoluteFsPath(path.resolve(".agent", "workspace-write-conflict-test", randomUUID()));
        const filePath = "note.md";
        createdRoots.push(root);
        await fs.mkdir(root, {recursive: true});
        await fs.writeFile(path.join(root, filePath), "共同基线\n", "utf-8");
        const baseNode = await statWorkspacePath(root, filePath);
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({
            resolveWorkspaceFileTarget: vi.fn(async () => ({kind: "workspace-root", root})),
        }));

        await fs.writeFile(path.join(root, filePath), "真实文件\n", "utf-8");
        await fs.utimes(path.join(root, filePath), new Date(), new Date(baseNode.mtimeMs + 5000));
        readBodyMock.mockResolvedValue({
            projectRoot: "test-project",
            path: filePath,
            content: "网页编辑\n",
            baseContent: "共同基线\n",
            expectedMtimeMs: baseNode.mtimeMs,
        });

        const handler = (await import("nbook/server/api/workspace-files/write.put")).default;
        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: expect.objectContaining({
                kind: "workspace_write_conflict",
                path: filePath,
                localContent: "网页编辑\n",
                remoteContent: "真实文件\n",
            }),
        });

        try {
            await handler({} as never);
        } catch (error) {
            const parsed = WorkspaceWriteConflictDtoSchema.safeParse((error as {data?: unknown}).data);
            expect(parsed.success).toBe(true);
        }
    }, 15_000);

    it("Project root 未 open 时返回 PROJECT_NOT_OPEN", async () => {
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({
            resolveWorkspaceFileTarget: vi.fn(async () => ({
                kind: "project-workspace",
                root: testAbsoluteFsPath("workspace-write", "workspace", "not-open"),
                projectRoot: projectWorkspaceRef("not-open").projectRoot,
            })),
        }));
        readBodyMock.mockResolvedValue({
            projectRoot: "not-open",
            path: "note.md",
            content: "不会写入\n",
        });

        const handler = (await import("nbook/server/api/workspace-files/write.put")).default;
        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {
                code: "PROJECT_NOT_OPEN",
                projectRoot: "not-open",
            },
        });
    });
});
