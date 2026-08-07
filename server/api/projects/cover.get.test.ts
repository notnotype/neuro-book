import type {H3Event} from "h3";
import {createHash} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";

const mocks = vi.hoisted(() => ({
    listProjects: vi.fn(),
    authorizeProjectCover: vi.fn(),
    renderVariant: vi.fn(),
}));
const originalDefineEventHandler = (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler;

vi.mock("nbook/server/api/projects/project-control-plane", () => ({
    requireProjectRefQuery: () => projectWorkspaceRef("book"),
}));
vi.mock("nbook/server/workspace-files/project-session", () => ({
    listProjects: mocks.listProjects,
}));
vi.mock("nbook/server/workspace-files/project-cover", async (importOriginal) => ({
    ...await importOriginal<typeof import("nbook/server/workspace-files/project-cover")>(),
    authorizeProjectCover: mocks.authorizeProjectCover,
}));
vi.mock("nbook/server/media/image-variant-runtime", () => ({
    useImageVariantModule: () => ({render: mocks.renderVariant}),
}));
vi.mock("nbook/server/workspace-files/workspace-runtime-root", () => ({
    resolveRuntimeWorkspaceRoot: () => "C:/workspace",
}));

describe("GET /api/projects/cover", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        mocks.listProjects.mockResolvedValue({
            revision: 1,
            projects: [{projectRoot: "book", kind: "novel", title: "Book", summary: "", cover: "cover.png"}],
        });
        mocks.authorizeProjectCover.mockResolvedValue({
            mimeType: "image/png",
            source: {
                identity: "project-cover:book:cover.png",
                revision: "revision-1",
                read: async () => Buffer.from("png"),
            },
        });
        mocks.renderVariant.mockResolvedValue({
            bytes: Buffer.from("webp"),
            etag: '"variant-etag"',
            cache: "hit",
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler = originalDefineEventHandler;
    });

    it("只把 manifest 封面路径交给受约束 reader，并返回图片缓存头", async () => {
        const handler = (await import("nbook/server/api/projects/cover.get")).default as (event: H3Event) => Promise<unknown>;
        const {event, headers} = createEvent();

        await expect(handler(event)).resolves.toEqual(Buffer.from("png"));

        expect(mocks.authorizeProjectCover).toHaveBeenCalledWith(
            "C:/workspace",
            expect.objectContaining({projectRoot: "book"}),
            "cover.png",
        );
        expect(headers).toMatchObject({
            etag: `"${createHash("sha256").update("png").digest("hex")}"`,
            "cache-control": "private, max-age=0, must-revalidate",
            "x-content-type-options": "nosniff",
            "content-type": "image/png",
            "content-length": 3,
            "content-disposition": "inline; filename*=UTF-8''cover.png",
        });
    }, 30_000);

    it("ETag 命中时返回 304 且不重复发送图片 body", async () => {
        const handler = (await import("nbook/server/api/projects/cover.get")).default as (event: H3Event) => Promise<unknown>;
        const etag = `"${createHash("sha256").update("png").digest("hex")}"`;
        const {event} = createEvent(etag);

        await expect(handler(event)).resolves.toBeNull();
        expect(event.node.res.statusCode).toBe(304);
    });

    it("原图 filename 使用 manifest basename 并按 RFC 5987 编码", async () => {
        mocks.listProjects.mockResolvedValue({
            revision: 1,
            projects: [{projectRoot: "book", kind: "novel", title: "Book", summary: "", cover: "assets/封面 (终稿).png"}],
        });
        const handler = (await import("nbook/server/api/projects/cover.get")).default as (event: H3Event) => Promise<unknown>;
        const {event, headers} = createEvent();

        await handler(event);

        expect(mocks.authorizeProjectCover).toHaveBeenCalledWith(
            "C:/workspace",
            expect.objectContaining({projectRoot: "book"}),
            "assets/封面 (终稿).png",
        );
        expect(headers["content-disposition"]).toBe(
            "inline; filename*=UTF-8''%E5%B0%81%E9%9D%A2%20%28%E7%BB%88%E7%A8%BF%29.png",
        );
    });

    it("授权完成后按 project-cover preset 返回可重验证 WebP", async () => {
        const handler = (await import("nbook/server/api/projects/cover.get")).default as (event: H3Event) => Promise<unknown>;
        const {event, headers} = createEvent(undefined, "preset=project-cover");

        await expect(handler(event)).resolves.toEqual(Buffer.from("webp"));

        expect(mocks.authorizeProjectCover).toHaveBeenCalledTimes(1);
        expect(mocks.renderVariant).toHaveBeenCalledWith(
            expect.objectContaining({identity: "project-cover:book:cover.png"}),
            {width: 384, height: 576, fit: "cover", quality: 80},
        );
        expect(headers).toMatchObject({
            etag: '"variant-etag"',
            "cache-control": "private, max-age=0, must-revalidate",
            "content-type": "image/webp",
            "content-length": 4,
            "content-disposition": "inline",
        });
    });

    it("没有 manifest 封面时稳定返回 404", async () => {
        mocks.listProjects.mockResolvedValue({
            revision: 1,
            projects: [{projectRoot: "book", kind: "novel", title: "Book", summary: ""}],
        });
        const handler = (await import("nbook/server/api/projects/cover.get")).default as (event: H3Event) => Promise<unknown>;

        await expect(handler(createEvent().event)).rejects.toMatchObject({
            statusCode: 404,
            data: {code: "PROJECT_COVER_UNAVAILABLE"},
        });
        expect(mocks.authorizeProjectCover).not.toHaveBeenCalled();
    });
});

/** 建立 H3 response header/status 可观察的最小事件。 */
function createEvent(
    ifNoneMatch?: string,
    query = "",
): {event: H3Event; headers: Record<string, string | number>} {
    const headers: Record<string, string | number> = {};
    const event = {
        path: `/api/projects/cover${query ? `?${query}` : ""}`,
        node: {
            req: {
                headers: ifNoneMatch ? {"if-none-match": ifNoneMatch} : {},
                url: `/api/projects/cover${query ? `?${query}` : ""}`,
            },
            res: {
                statusCode: 200,
                setHeader: (name: string, value: string | number) => {
                    headers[name.toLocaleLowerCase("en-US")] = value;
                },
                getHeader: (name: string) => headers[name.toLocaleLowerCase("en-US")],
            },
        },
    } as unknown as H3Event;
    return {event, headers};
}
