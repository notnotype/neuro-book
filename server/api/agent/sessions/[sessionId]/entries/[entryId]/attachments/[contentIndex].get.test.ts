import type {H3Event} from "h3";
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";

type TestEvent = H3Event & {
    readonly params: Readonly<Record<string, string>>;
    readonly requestHeaders: Readonly<Record<string, string>>;
    readonly query: Readonly<Record<string, string>>;
    readonly responseHeaders: Map<string, string | number>;
    readonly sessionId: number;
};

const mocks = vi.hoisted(() => ({
    resolveSessionAttachment: vi.fn(),
    load: vi.fn(),
    render: vi.fn(),
    projectNotOpenError: Object.assign(new Error("Project not open"), {projectRoot: "closed-attachment"}),
    sessionNotFoundError: Object.assign(new Error("Session missing"), {
        name: "AgentSessionNotFoundError",
        code: "SESSION_NOT_FOUND",
        sessionId: 12,
    }),
}));

vi.mock("h3", async (importOriginal) => ({
    ...await importOriginal<typeof import("h3")>(),
    getQuery: (event: TestEvent) => event.query,
    getRequestHeader: (event: TestEvent, name: string) => event.requestHeaders[name.toLowerCase()],
    getRouterParam: (event: TestEvent, name: string) => event.params[name],
    setResponseHeader: (event: TestEvent, name: string, value: string | number) => {
        event.responseHeaders.set(name.toLowerCase(), value);
    },
    setResponseStatus: (event: TestEvent, status: number) => {
        event.node.res.statusCode = status;
    },
}));

vi.mock("nbook/server/agent/http", () => ({
    isAgentSessionNotFoundHttpError: (error: unknown) => typeof error === "object"
        && error !== null
        && "data" in error
        && (error as {data?: {code?: string}}).data?.code === "SESSION_NOT_FOUND",
    mapAgentHttpError: (error: unknown) => error === mocks.sessionNotFoundError
        ? Object.assign(new Error("Session 不存在或已不可用"), {
            statusCode: 404,
            data: {code: "SESSION_NOT_FOUND"},
        })
        : error,
    requireAgentSessionId: (event: TestEvent) => event.sessionId,
    useAgentHarness: () => ({
        resolveSessionAttachment: mocks.resolveSessionAttachment,
    }),
}));

vi.mock("nbook/server/media/image-variant-runtime", () => ({
    useImageVariantModule: () => ({render: mocks.render}),
}));

vi.mock("nbook/server/workspace-files/project-session", () => ({
    isProjectNotOpenError: (error: unknown) => error === mocks.projectNotOpenError,
}));

vi.mock("nbook/server/api/projects/project-http-error", async (importOriginal) => {
    const actual = await importOriginal<typeof import("nbook/server/api/projects/project-http-error")>();
    return {
        ...actual,
        withProjectHttpError: async <T>(operation: () => Promise<T>): Promise<T> => {
            try {
                return await operation();
            } catch (error) {
                if (error === mocks.projectNotOpenError) {
                    throw Object.assign(new Error("Project 未打开，请先打开 Project"), {
                        statusCode: 409,
                        data: {code: "PROJECT_NOT_OPEN", projectRoot: "closed-attachment"},
                    });
                }
                throw error;
            }
        },
    };
});

let handler: (event: H3Event) => Promise<unknown>;
const originalDefineEventHandler = (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler;

beforeAll(async () => {
    vi.stubGlobal("defineEventHandler", (routeHandler: typeof handler) => routeHandler);
    handler = (await import("nbook/server/api/agent/sessions/[sessionId]/entries/[entryId]/attachments/[contentIndex].get")).default;
});

afterAll(() => {
    vi.unstubAllGlobals();
    (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler = originalDefineEventHandler;
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSessionAttachment.mockResolvedValue({
        ref: {id: `sha256:${"a".repeat(64)}`, mimeType: "image/png", bytes: 8},
        name: "cover.png",
        read: mocks.load,
    });
    mocks.load.mockResolvedValue(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    mocks.render.mockResolvedValue({bytes: Buffer.from("webp"), etag: '"variant-etag"', cache: "hit"});
});

describe("GET /api/agent/sessions/:sessionId/entries/:entryId/attachments/:contentIndex", () => {
    it("保留 Session Not Found，不改写为 Attachment Not Found", async () => {
        mocks.resolveSessionAttachment.mockRejectedValue(mocks.sessionNotFoundError);

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 404,
            data: {code: "SESSION_NOT_FOUND"},
        });
    });

    it("If-None-Match 命中时在 locator 授权后返回原图 304，且不读取 blob", async () => {
        const attachmentId = `sha256:${"a".repeat(64)}`;
        const event = createEvent({requestHeaders: {"if-none-match": `"${attachmentId}"`}});

        await expect(handler(event)).resolves.toBeNull();

        expect(mocks.resolveSessionAttachment).toHaveBeenCalledWith(12, "entry-1", 1);
        expect(mocks.load).not.toHaveBeenCalled();
        expect(event.node.res.statusCode).toBe(304);
        expect(headers(event)).toMatchObject({
            etag: `"${attachmentId}"`,
            "cache-control": "private, max-age=31536000, immutable",
        });
    });

    it("经魔数验证的 raster 原图以内联响应返回", async () => {
        const event = createEvent();
        const result = await handler(event);

        expect(Buffer.from(result as Uint8Array)).toEqual(Buffer.from(await mocks.load.mock.results[0]!.value));
        expect(headers(event)).toMatchObject({
            "content-type": "image/png",
            "content-length": 8,
            "x-content-type-options": "nosniff",
            "content-disposition": "inline; filename*=UTF-8''cover.png",
        });
        expect(String(headers(event)["server-timing"])).toContain("attachment_blob");
    });

    it("非 raster MIME 强制下载，且无变体参数时保持原图合同", async () => {
        const bytes = Buffer.from("<script>alert(1)</script>", "utf8");
        mocks.resolveSessionAttachment.mockResolvedValue({
            ref: {id: `sha256:${"b".repeat(64)}`, mimeType: "text/html", bytes: bytes.byteLength},
            name: "unsafe.html",
            read: mocks.load,
        });
        mocks.load.mockResolvedValue(bytes);
        const event = createEvent();

        await expect(handler(event)).resolves.toEqual(bytes);
        expect(headers(event)).toMatchObject({
            "content-type": "text/html",
            "content-disposition": "attachment; filename*=UTF-8''unsafe.html",
        });
        expect(mocks.render).not.toHaveBeenCalled();
    });

    it("变体参数仍先完成 locator 授权，再生成 immutable WebP", async () => {
        mocks.render.mockImplementation(async (source) => {
            await source.read();
            return {bytes: Buffer.from("webp"), etag: '"variant-etag"', cache: "generated"};
        });
        const event = createEvent({query: {preset: "attachment-grid"}});

        await expect(handler(event)).resolves.toEqual(Buffer.from("webp"));

        expect(mocks.resolveSessionAttachment.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.render.mock.invocationCallOrder[0]!);
        expect(mocks.render).toHaveBeenCalledWith(
            expect.objectContaining({identity: `attachment:sha256:${"a".repeat(64)}`}),
            {width: 384, height: 216, fit: "contain", quality: 80},
        );
        expect(mocks.load).toHaveBeenCalledTimes(1);
        expect(headers(event)).toMatchObject({
            etag: '"variant-etag"',
            "cache-control": "private, max-age=31536000, immutable",
            "content-type": "image/webp",
            "content-length": 4,
        });
        expect(String(headers(event)["server-timing"])).toContain('desc="generated"');
    });

    it("变体 ETag 命中时返回 304，缓存命中不要求路由读取 blob", async () => {
        const event = createEvent({
            query: {preset: "attachment-chat"},
            requestHeaders: {"if-none-match": '"variant-etag"'},
        });

        await expect(handler(event)).resolves.toBeNull();
        expect(event.node.res.statusCode).toBe(304);
        expect(mocks.load).not.toHaveBeenCalled();
    });

    it("非图片变体返回 415，且不把 blob 或路径交给变体 Module", async () => {
        mocks.resolveSessionAttachment.mockResolvedValue({
            ref: {id: `sha256:${"c".repeat(64)}`, mimeType: "text/plain", bytes: 4},
            name: "note.txt",
            read: mocks.load,
        });
        const event = createEvent({query: {preset: "attachment-grid"}});

        await expect(handler(event)).rejects.toMatchObject({
            statusCode: 415,
            data: {code: "UNSUPPORTED_IMAGE_TYPE"},
        });
        expect(mocks.resolveSessionAttachment).toHaveBeenCalledTimes(1);
        expect(mocks.load).not.toHaveBeenCalled();
        expect(mocks.render).not.toHaveBeenCalled();
    });

    it("非法变体参数在 locator 授权后返回 400", async () => {
        const event = createEvent({query: {preset: "attachment-grid", width: "100"}});

        await expect(handler(event)).rejects.toMatchObject({
            statusCode: 400,
            data: {code: "INVALID_IMAGE_VARIANT"},
        });
        expect(mocks.resolveSessionAttachment).toHaveBeenCalledTimes(1);
        expect(mocks.render).not.toHaveBeenCalled();
    });

    it("无效 locator 返回 400 且禁止缓存错误", async () => {
        const event = createEvent({params: {entryId: "", contentIndex: "-1"}});

        await expect(handler(event)).rejects.toMatchObject({
            statusCode: 400,
            data: {code: "INVALID_ATTACHMENT_LOCATOR"},
        });
        expect(headers(event)["cache-control"]).toBe("no-store");
        expect(mocks.resolveSessionAttachment).not.toHaveBeenCalled();
    });

    it("Project 未 open 保留 typed 409，不降级成 Attachment 404", async () => {
        mocks.resolveSessionAttachment.mockRejectedValue(mocks.projectNotOpenError);
        const event = createEvent();

        await expect(handler(event)).rejects.toMatchObject({
            statusCode: 409,
            data: {code: "PROJECT_NOT_OPEN", projectRoot: "closed-attachment"},
        });
        expect(headers(event)["cache-control"]).toBeUndefined();
    });

    it("blob 不可用返回 410 且禁止缓存错误", async () => {
        mocks.load.mockRejectedValue(new Error("missing"));
        const event = createEvent();

        await expect(handler(event)).rejects.toMatchObject({
            statusCode: 410,
            data: {code: "ATTACHMENT_UNAVAILABLE"},
        });
        expect(headers(event)["cache-control"]).toBe("no-store");
    });
});

/** 建立路由级最小 H3 event；文件路径和物理 blob 身份不进入事件。 */
function createEvent(overrides: {
    readonly params?: Readonly<Record<string, string>>;
    readonly requestHeaders?: Readonly<Record<string, string>>;
    readonly query?: Readonly<Record<string, string>>;
} = {}): TestEvent {
    return {
        params: overrides.params ?? {entryId: "entry-1", contentIndex: "1"},
        requestHeaders: overrides.requestHeaders ?? {},
        query: overrides.query ?? {},
        responseHeaders: new Map(),
        sessionId: 12,
        node: {req: {}, res: {statusCode: 200}},
    } as unknown as TestEvent;
}

/** 把大小写无关的响应头转为便于断言的普通对象。 */
function headers(event: TestEvent): Record<string, string | number> {
    return Object.fromEntries(event.responseHeaders);
}
