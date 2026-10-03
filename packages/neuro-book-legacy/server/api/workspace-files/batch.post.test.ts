import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {testAbsoluteFsPath} from "@notnotype/neuro-book-test-support/test-path";
import {parseWorkspaceFileBinding} from "nbook/shared/dto/workspace-file-binding.dto";

const originalReadBody = (globalThis as typeof globalThis & {readBody?: unknown}).readBody;
const originalDefineEventHandler = (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler;
const originalDefineRouteMeta = (globalThis as typeof globalThis & {defineRouteMeta?: unknown}).defineRouteMeta;

const readBodyMock = vi.fn();
const mutateMock = vi.fn();
const batchMock = vi.fn();
const projectTarget = {kind: "project-workspace" as const, root: testAbsoluteFsPath("batch-route", "workspace", "novel-1"), projectRoot: "novel-1"};

describe("POST /api/workspace-files/batch", () => {
    beforeEach(() => {
        vi.resetModules();
        readBodyMock.mockReset();
        mutateMock.mockReset();
        batchMock.mockReset();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("defineRouteMeta", () => undefined);
        vi.stubGlobal("readBody", readBodyMock);
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({resolveWorkspaceFileTarget: vi.fn(async () => projectTarget)}));
        vi.doMock("nbook/server/runtime/product-startup", () => ({
            withProductWorkspaceFiles: (_binding: unknown, operation: (files: {batch: typeof batchMock}) => unknown) => operation({batch: batchMock}),
        }));
        vi.doMock("nbook/server/workspace-files/project-open-guard", () => ({
            parseWorkspaceFileHttpBinding: parseWorkspaceFileBinding,
            withBoundProjectTargetMutation: mutateMock,
        }));
    });
    afterEach(() => {
        const globals = globalThis as typeof globalThis & {readBody?: unknown; defineEventHandler?: unknown; defineRouteMeta?: unknown};
        globals.readBody = originalReadBody;
        globals.defineEventHandler = originalDefineEventHandler;
        globals.defineRouteMeta = originalDefineRouteMeta;
        vi.doUnmock("nbook/server/workspace-files/novel-workspace");
        vi.doUnmock("nbook/server/runtime/product-startup");
        vi.doUnmock("nbook/server/workspace-files/project-open-guard");
    });

    it("缺失 Project publicId 时拒绝整批操作", async () => {
        readBodyMock.mockResolvedValue({projectRoot: "novel-1", kind: "copy", sources: ["chapter/"], destination: "copies/"});
        const handler = (await import("nbook/server/api/workspace-files/batch.post")).default;
        await expect(handler({} as never)).rejects.toThrow();
        expect(mutateMock).not.toHaveBeenCalled();
        expect(batchMock).not.toHaveBeenCalled();
    });

    it("Project 过期绑定在 mutation guard 中拒绝且不调用批量磁盘入口", async () => {
        readBodyMock.mockResolvedValue({projectRoot: "novel-1", publicId: "stale-id", kind: "move", sources: ["chapter/"], destination: "copies/"});
        mutateMock.mockImplementation(() => {throw Object.assign(new Error("Project generation stale"), {statusCode: 409});});
        const handler = (await import("nbook/server/api/workspace-files/batch.post")).default;
        await expect(handler({} as never)).rejects.toMatchObject({statusCode: 409});
        expect(batchMock).not.toHaveBeenCalled();
    });

    it("非法目标 basename 在写入口前被拒绝", async () => {
        const handler = (await import("nbook/server/api/workspace-files/batch.post")).default;
        for (const name of ["", ".", "..", "sub/name", "sub\\name", "   "]) {
            readBodyMock.mockResolvedValue({projectRoot: "novel-1", publicId: "ready-id", kind: "move",
                sources: ["source.md"], destination: "copies", targetNames: {"source.md": name}});
            await expect(handler({} as never)).rejects.toThrow();
        }
        expect(batchMock).not.toHaveBeenCalled();
    });
});
