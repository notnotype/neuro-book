import type {H3Event} from "h3";
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {ProjectCoverUploadError} from "nbook/server/workspace-files/project-cover-upload";

const mocks = vi.hoisted(() => ({
    listProjects: vi.fn(),
    updateProjectCover: vi.fn(),
    readSingleMultipartFile: vi.fn(),
    validateProjectCoverUpload: vi.fn(),
}));

vi.mock("nbook/server/api/projects/project-control-plane", async (importOriginal) => ({
    ...await importOriginal<typeof import("nbook/server/api/projects/project-control-plane")>(),
    requireProjectRefQuery: () => projectWorkspaceRef("book"),
}));
vi.mock("nbook/server/runtime/product-project", () => ({
    listProjects: mocks.listProjects,
    updateProjectCover: mocks.updateProjectCover,
}));
vi.mock("nbook/server/media/single-file-multipart", async (importOriginal) => ({
    ...await importOriginal<typeof import("nbook/server/media/single-file-multipart")>(),
    readSingleMultipartFile: mocks.readSingleMultipartFile,
}));
vi.mock("nbook/server/workspace-files/project-cover-upload", async (importOriginal) => ({
    ...await importOriginal<typeof import("nbook/server/workspace-files/project-cover-upload")>(),
    validateProjectCoverUpload: mocks.validateProjectCoverUpload,
}));

const originalDefineEventHandler = (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler;
let putHandler: (event: H3Event) => Promise<unknown>;
let deleteHandler: (event: H3Event) => Promise<unknown>;

beforeAll(async () => {
    vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    putHandler = (await import("nbook/server/api/projects/cover.put")).default as typeof putHandler;
    deleteHandler = (await import("nbook/server/api/projects/cover.delete")).default as typeof deleteHandler;
});

afterAll(() => {
    vi.unstubAllGlobals();
    (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler = originalDefineEventHandler;
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.listProjects.mockResolvedValue({
        revision: 1,
        projects: [{projectRoot: "book", kind: "novel", title: "Book", summary: ""}],
    });
    mocks.readSingleMultipartFile.mockResolvedValue({
        bytes: Buffer.from("original"),
        mimeType: "image/png",
        name: "cover.png",
    });
    mocks.validateProjectCoverUpload.mockResolvedValue({
        bytes: Buffer.from("original"),
        extension: "png",
    });
    mocks.updateProjectCover.mockResolvedValue({
        revision: 2,
        project: {
            projectRoot: "book",
            kind: "novel",
            title: "Book",
            summary: "",
            cover: `assets/project-covers/${"a".repeat(64)}.png`,
        },
    });
});

describe("Project cover mutation routes", () => {
    it("PUT 授权 Project 后只把原始内容交给 Lifecycle，不接收目标路径", async () => {
        const event = createEvent();

        await expect(putHandler(event)).resolves.toMatchObject({
            revision: 2,
            project: {projectRoot: "book", cover: expect.stringContaining("assets/project-covers/")},
        });

        expect(mocks.readSingleMultipartFile).toHaveBeenCalledWith(event.node.req, {
            fieldName: "file",
            maxBytes: 20 * 1024 * 1024,
        });
        expect(mocks.validateProjectCoverUpload).toHaveBeenCalledWith({
            bytes: Buffer.from("original"),
            declaredMimeType: "image/png",
        });
        expect(mocks.updateProjectCover).toHaveBeenCalledWith({
            ref: expect.objectContaining({projectRoot: "book"}),
            cover: {bytes: Buffer.from("original"), extension: "png"},
        });
    });

    it("PUT 在读取 multipart 前拒绝不存在的 Project", async () => {
        mocks.listProjects.mockResolvedValue({revision: 1, projects: []});

        await expect(putHandler(createEvent())).rejects.toMatchObject({
            statusCode: 404,
            data: {code: "PROJECT_NOT_FOUND"},
        });
        expect(mocks.readSingleMultipartFile).not.toHaveBeenCalled();
    });

    it("PUT 映射不可解码图片为 422", async () => {
        mocks.validateProjectCoverUpload.mockRejectedValue(new ProjectCoverUploadError(
            "PROJECT_COVER_DECODE_FAILED",
            "封面无法完整解码",
        ));

        await expect(putHandler(createEvent())).rejects.toMatchObject({
            statusCode: 422,
            data: {code: "PROJECT_COVER_DECODE_FAILED"},
        });
        expect(mocks.updateProjectCover).not.toHaveBeenCalled();
    });

    it("DELETE 只提交 cover=null 并返回已发布 metadata", async () => {
        mocks.updateProjectCover.mockResolvedValue({
            revision: 3,
            project: {projectRoot: "book", kind: "novel", title: "Book", summary: ""},
        });

        await expect(deleteHandler(createEvent())).resolves.toEqual({
            revision: 3,
            project: {projectRoot: "book", kind: "novel", title: "Book", summary: ""},
        });
        expect(mocks.updateProjectCover).toHaveBeenCalledWith({
            ref: expect.objectContaining({projectRoot: "book"}),
            cover: null,
        });
    });
});

/** 建立上传路由需要的最小 H3 event。 */
function createEvent(): H3Event {
    return {
        node: {
            req: {headers: {}, url: "/api/projects/cover?projectRoot=book"},
            res: {},
        },
        path: "/api/projects/cover?projectRoot=book",
    } as H3Event;
}
