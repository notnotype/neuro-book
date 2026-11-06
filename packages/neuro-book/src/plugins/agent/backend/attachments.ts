/**
 * 用户附件的存与读（docs/specs/agent/sessions.md 的“附件”）：上传与读取路由，以及给内核的读取端口。
 *
 * 地址是 `sessions://<会话 id>/home/attachments/<SHA-256>.<扩展名>`，写全局地址：`fork` 只复制日志，单数地址到新会话就读不到了。
 * 文件名是内容的哈希，所以同一个内容只存一份，读取能放心缓存。
 */

import {createHash} from "node:crypto";
import {lstat} from "node:fs/promises";
import {join} from "node:path";

import {Hono} from "hono";

import type {AttachmentPort} from "@notnotype/nb-harness/kernel/contracts";

import type {WorkspaceFiles} from "nbook/plugins/files/shared/contracts";
import {rethrowRouteError} from "nbook/plugins/http/shared/contracts";
import type {HttpRouteEnv} from "nbook/plugins/http/shared/contracts";

import {ATTACHMENT_LIMIT_BYTES} from "../shared/attachments";
import {imageFormat, prepareImage} from "./builtin/image";

/** 扩展名按 MIME 定，不信原名。不在表里的存成 `.bin`，读取时只能下载。 */
const EXTENSIONS: Readonly<Record<string, string>> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "text/plain": "txt",
    "text/markdown": "md",
    "application/pdf": "pdf",
    "application/json": "json",
};
const MIME_OF_EXTENSION: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(EXTENSIONS).map(([mime, extension]) => [extension, mime]));
/** 能在 `<img>` 里内联显示的：别的一律下载。SVG 与 HTML 不在这里：它们能带脚本。 */
const INLINE = new Set(["png", "jpg", "gif", "webp"]);
const FILE_NAME = /^[0-9a-f]{64}\.[a-z0-9]{1,8}$/u;
/** 直接打开附件地址时不在应用的源里运行，和文件服务的原始路由一样。 */
const SAFE_HEADERS = {"Content-Security-Policy": "sandbox", "X-Content-Type-Options": "nosniff"};

/** 别的网页不能读写；地址栏直接打开（`none`）可以，沙箱管它。 */
function crossSite(request: Request): boolean {
    const site = request.headers.get("sec-fetch-site");
    return site !== null && site !== "same-origin" && site !== "none";
}

const attachmentAddress = (session: string, name: string): string => `sessions://${session}/home/attachments/${name}`;

/** 读请求体，超限立刻停：不信 `Content-Length`，分块上传没有它。 */
async function readLimited(request: Request): Promise<Uint8Array | "too-large"> {
    if (request.body === null) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = request.body.getReader();
    for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.length;
        if (size > ATTACHMENT_LIMIT_BYTES) {
            // 不等它：对方还在发的时候取消可能一直不完成。
            void reader.cancel().catch(() => undefined);
            return "too-large";
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}

function decodeName(header: string | null): string | null {
    if (header === null) return null;
    try {
        return decodeURIComponent(header);
    } catch {
        return null;
    }
}

/**
 * 这个会话在不在。每个上传、每张缩略图都问一次，不列全部会话：看它的目录就够了。`id` 来自地址，先挡住能走出目录的写法
 * （归档的会话目录还在，附件照常读）。
 */
export const sessionDirectoryExists = (sessionsRoot: string) => async (id: string): Promise<boolean> =>
    !/[/\\]|^\.\.?$/u.test(id) && await lstat(join(sessionsRoot, id)).then((stats) => stats.isDirectory(), () => false);

export function createAttachmentRoutes(options: {
    readonly files: WorkspaceFiles;
    /** 这个会话在不在：不在的不收，也不读。 */
    readonly hasSession: (id: string) => Promise<boolean>;
}): Hono<{Bindings: HttpRouteEnv}> {
    const {files, hasSession} = options;
    const app = new Hono<{Bindings: HttpRouteEnv}>().onError(rethrowRouteError);
    const error = (code: string, message: string, status: 400 | 403 | 404 | 413 | 500) => Response.json({error: {code, message}}, {status});

    app.post("/sessions/:id/attachments", async (c) => {
        if (crossSite(c.req.raw)) return error("cross-site", "不接受别的网页上传。", 403);
        const session = c.req.param("id");
        if (!await hasSession(session)) return error("unknown-session", "这个会话不存在。", 404);
        const bytes = await readLimited(c.req.raw);
        if (bytes === "too-large") return error("too-large", `单个文件不能超过 ${String(ATTACHMENT_LIMIT_BYTES / 1024 / 1024)} MB。`, 413);
        const format = imageFormat(bytes);
        const declared = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
        // 图片按文件头认；声明是图片、文件头却不是的（包括 SVG）按普通文件存，只能下载。
        const mime = format === null ? (declared === "" || declared.startsWith("image/") ? "application/octet-stream" : declared) : `image/${format}`;
        const extension = EXTENSIONS[mime] ?? "bin";
        const hash = createHash("sha256").update(bytes).digest("hex");
        const name = `${hash}.${extension}`;
        const address = attachmentAddress(session, name);
        const saved = await files.stage(address, async (sink) => sink.write(bytes), {expect: "absent", createParents: true});
        // 同一个内容已经有了（或并发的另一次先写好了）：内容寻址，算成功。
        if (!saved.ok && saved.code !== "conflict") return error(saved.code, "存附件没有成功。", 500);
        let width: number | undefined;
        let height: number | undefined;
        if (format !== null) {
            try {
                ({width, height} = await new Bun.Image(bytes).metadata());
            } catch {
                // 量不出尺寸也收：发给模型时读不了会说明，这里拒绝反而让用户看不出原因。
            }
        }
        return Response.json({
            uri: address,
            kind: format === null ? "file" : "image",
            name: decodeName(c.req.header("x-attachment-name") ?? null) ?? name,
            mime,
            bytes: bytes.length,
            ...(width === undefined ? {} : {width}),
            ...(height === undefined ? {} : {height}),
        });
    });

    app.on(["GET", "HEAD"], "/sessions/:id/attachments/:file", async (c) => {
        if (crossSite(c.req.raw)) return error("cross-site", "不接受别的网页读取附件。", 403);
        const session = c.req.param("id");
        const file = c.req.param("file");
        if (!FILE_NAME.test(file)) return error("invalid-name", "附件地址不对。", 400);
        if (!await hasSession(session)) return error("not-found", "这个附件不在了。", 404);
        const read = await files.read(attachmentAddress(session, file));
        if (!read.ok) return error("not-found", "这个附件不在了。", 404);
        const extension = file.slice(file.indexOf(".") + 1);
        const etag = `"${file.slice(0, 64)}"`;
        if (c.req.header("if-none-match") === etag) return new Response(null, {status: 304, headers: {...SAFE_HEADERS, ETag: etag}});
        const inline = INLINE.has(extension);
        return new Response(c.req.method === "HEAD" ? null : read.value.bytes, {headers: {
            ...SAFE_HEADERS,
            "Content-Type": inline ? MIME_OF_EXTENSION[extension]! : "application/octet-stream",
            "Content-Length": String(read.value.bytes.length),
            ...(inline ? {} : {"Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file)}`}),
            ETag: etag,
            "Cache-Control": "private, immutable, max-age=31536000",
        }});
    });
    return app;
}

/** 给内核的读取端口：读原图、缩放，交回能发给模型的样子。原图不动，结果也不写盘（内核按地址缓存）。 */
export function createAttachmentPort(files: WorkspaceFiles): AttachmentPort {
    return {
        read: async (uri, {signal}) => {
            const read = await files.read(uri, {signal});
            if (!read.ok) return read.code === "not-found" ? {missing: true} : {unusable: read.code};
            const format = imageFormat(read.value.bytes);
            if (format === null) return {unusable: "not-an-image"};
            try {
                const image = await prepareImage(read.value.bytes, format);
                return {data: Buffer.from(image.data).toString("base64"), mime: image.mime, width: image.width, height: image.height};
            } catch (error) {
                // 损坏、像素超限：发原图只会让之后每次请求都失败。
                return {unusable: error instanceof Error ? error.message : String(error)};
            }
        },
    };
}
