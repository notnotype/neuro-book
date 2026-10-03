import {Readable} from "node:stream";
import type {IncomingMessage} from "node:http";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {AGENT_IMAGE_POLICY} from "nbook/shared/agent/agent-image-policy";

type UploadService = (sessionId: number, file: {
    bytes: Uint8Array;
    mimeType?: string;
    name: string;
}) => Promise<unknown>;

describe("POST /api/agent/sessions/:sessionId/attachments", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("流式接收无 Content-Length 的 chunked 单 file part", async () => {
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const upload = vi.fn<UploadService>(async () => ({
            attachment: {attachmentId: `sha256:${"a".repeat(64)}`, mimeType: "image/png", bytes: bytes.byteLength, name: "cover.png"},
            target: `workspace/.nbook/agent/attachments/sha256/aa/${"a".repeat(62)}`,
            locator: {entryId: "attachment-entry", contentIndex: 0},
            firstSeenAt: 1,
            lastSeenAt: 1,
            referenceCount: 1,
        }));
        const preflight = vi.fn(async () => {});
        installMocks(preflight, upload);
        const boundary = "nbook-boundary";
        const body = multipartBody(boundary, [{name: "file", filename: "cover.png", mimeType: "image/png", data: bytes}]);
        const request = incomingRequest([
            body.subarray(0, 7),
            body.subarray(7, 31),
            body.subarray(31),
        ], {"content-type": `multipart/form-data; boundary=${boundary}`});

        const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/attachments.post")).default;
        await expect(handler({node: {req: request}} as never)).resolves.toMatchObject({
            locator: {entryId: "attachment-entry", contentIndex: 0},
        });
        expect(preflight).toHaveBeenCalledWith(12);
        expect(upload).toHaveBeenCalledWith(12, {
            bytes,
            mimeType: "image/png",
            name: "cover.png",
        });
    });

    it("拒绝额外字段、第二文件和空文件", async () => {
        for (const parts of [
            [
                {name: "file", filename: "cover.png", mimeType: "image/png", data: Buffer.from("png")},
                {name: "note", data: Buffer.from("extra")},
            ],
            [
                {name: "file", filename: "cover.png", mimeType: "image/png", data: Buffer.from("png")},
                {name: "second", filename: "second.png", mimeType: "image/png", data: Buffer.from("png")},
            ],
            [{name: "file", filename: "empty.png", mimeType: "image/png", data: Buffer.alloc(0)}],
        ]) {
            vi.resetModules();
            const upload = vi.fn<UploadService>();
            installMocks(vi.fn(async () => {}), upload);
            const boundary = `nbook-${crypto.randomUUID()}`;
            const request = incomingRequest([multipartBody(boundary, parts)], {
                "content-type": `multipart/form-data; boundary=${boundary}`,
            });
            const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/attachments.post")).default;

            await expect(handler({node: {req: request}} as never)).rejects.toMatchObject({
                statusCode: 400,
                data: {code: "INVALID_ATTACHMENT_MULTIPART"},
            });
            expect(upload).not.toHaveBeenCalled();
        }
    });

    it("真实流超过 16 MiB 时拒绝，即使没有 Content-Length", async () => {
        const upload = vi.fn<UploadService>();
        installMocks(vi.fn(async () => {}), upload);
        const boundary = "nbook-overflow";
        const body = multipartBody(boundary, [{
            name: "file",
            filename: "huge.png",
            mimeType: "image/png",
            data: Buffer.alloc(AGENT_IMAGE_POLICY.maxImageBytes + 1, 1),
        }]);
        const request = incomingRequest([body], {"content-type": `multipart/form-data; boundary=${boundary}`});
        const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/attachments.post")).default;

        await expect(handler({node: {req: request}} as never)).rejects.toMatchObject({
            statusCode: 413,
            data: {code: "AGENT_IMAGE_LIMIT_EXCEEDED"},
        });
        expect(upload).not.toHaveBeenCalled();
    });

    it("无 Content-Length 的精确 16 MiB 文件可以通过流式边界", async () => {
        const bytes = Buffer.alloc(AGENT_IMAGE_POLICY.maxImageBytes);
        bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const upload = vi.fn<UploadService>(async (_sessionId, file) => ({bytes: file.bytes.byteLength}));
        installMocks(vi.fn(async () => {}), upload);
        const boundary = "nbook-exact-limit";
        const request = incomingRequest([multipartBody(boundary, [{
            name: "file",
            filename: "exact.png",
            mimeType: "image/png",
            data: bytes,
        }])], {"content-type": `multipart/form-data; boundary=${boundary}`});
        const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/attachments.post")).default;

        await expect(handler({node: {req: request}} as never)).resolves.toEqual({bytes: AGENT_IMAGE_POLICY.maxImageBytes});
        expect(upload).toHaveBeenCalledOnce();
        expect(upload.mock.calls[0]?.[1].bytes.byteLength).toBe(AGENT_IMAGE_POLICY.maxImageBytes);
    });

    it("Content-Length 明确超限时在消费 body 前拒绝", async () => {
        const upload = vi.fn<UploadService>();
        const preflight = vi.fn(async () => {});
        installMocks(preflight, upload);
        const request = incomingRequest([], {
            "content-type": "multipart/form-data; boundary=unused",
            "content-length": String(AGENT_IMAGE_POLICY.maxImageBytes + 1024 * 1024 + 1),
        });
        const pipe = vi.spyOn(request, "pipe");
        const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/attachments.post")).default;

        await expect(handler({node: {req: request}} as never)).rejects.toMatchObject({
            statusCode: 413,
            data: {code: "AGENT_IMAGE_LIMIT_EXCEEDED"},
        });
        expect(preflight).toHaveBeenCalledOnce();
        expect(pipe).not.toHaveBeenCalled();
        expect(upload).not.toHaveBeenCalled();
    });

    it("Session preflight 失败时不消费 multipart body", async () => {
        const preflight = vi.fn(async () => {
            throw new Error("archived session");
        });
        installMocks(preflight, vi.fn<UploadService>());
        const request = incomingRequest([], {"content-type": "multipart/form-data; boundary=unused"});
        const pipe = vi.spyOn(request, "pipe");
        const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/attachments.post")).default;

        await expect(handler({node: {req: request}} as never)).rejects.toThrow("archived session");
        expect(pipe).not.toHaveBeenCalled();
    });
});

/** 安装路由 seam；multipart 本身不 mock，必须经过真实 busboy。 */
function installMocks(preflight: () => Promise<void>, upload: UploadService): void {
    vi.doMock("h3", async (importOriginal) => ({
        ...(await importOriginal<typeof import("h3")>()),
        getRequestHeader: (event: {node: {req: IncomingMessage}}, name: string) => event.node.req.headers[name.toLowerCase()],
    }));
    vi.doMock("nbook/server/agent/http", () => ({
        requireAgentSessionId: vi.fn(() => 12),
        preflightAgentSessionAttachmentRegistration: preflight,
        uploadAgentSessionAttachment: upload,
    }));
    vi.doMock("nbook/server/api/projects/project-http-error", () => ({
        withProjectHttpError: async (run: () => Promise<unknown>) => run(),
    }));
}

/** 构造支持 pipe 的 IncomingMessage 测试替身，并保留真实 chunk 边界。 */
function incomingRequest(chunks: Buffer[], headers: IncomingMessage["headers"]): IncomingMessage {
    return Object.assign(Readable.from(chunks), {headers}) as IncomingMessage;
}

type MultipartPart = {
    name: string;
    filename?: string;
    mimeType?: string;
    data: Buffer;
};

/** 生成最小合法 multipart body；二进制 data 不做字符串往返。 */
function multipartBody(boundary: string, parts: MultipartPart[]): Buffer {
    const chunks: Buffer[] = [];
    for (const part of parts) {
        const disposition = part.filename
            ? `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`
            : `Content-Disposition: form-data; name="${part.name}"\r\n`;
        chunks.push(Buffer.from(`--${boundary}\r\n${disposition}${part.mimeType ? `Content-Type: ${part.mimeType}\r\n` : ""}\r\n`, "utf8"));
        chunks.push(part.data, Buffer.from("\r\n", "utf8"));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
    return Buffer.concat(chunks);
}
