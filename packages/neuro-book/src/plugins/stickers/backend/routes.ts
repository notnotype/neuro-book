/**
 * 取图路由（docs/specs/agent/stickers.md 的“边界与兼容”）：`GET /api/nbook.stickers/image/<表情包 id>/<文件名>?v=<版本>`。只给
 * 目录里有效的表情；字节经文件服务读 `stickers://`（根身份、链接与路径包含的规则在那里），读到后再按字节核对一次类型、大小与
 * 宽高，扫描之后被换掉的文件不按旧的结论给出去。响应头与跨站规则同文件服务的按地址读取字节。
 *
 * 表情包页另要显示两类不是表情的图（目录的 `extras`：名字当不了表情名的、清单没列的）：同样只给目录分好类的、读到时字节核对过的；
 * 它们一律 `no-cache`、不回 304：版本来自扫描，扫描之后被换掉的文件不能被长期缓存（输出 26）。
 *
 * 表情包页的三条：`PUT /packs/<id>/images/<文件名>`（加图，至多 32 MiB）、`POST /import`（导入 zip，至多 64 MiB）、`GET /export/<id>`
 * （导出）。写的两条只放行 `Sec-Fetch-Site` 为 `same-origin` 或没有这个头的；请求体边收边数，超了 413，30 秒没有新字节就断开；
 * 进程里同时只做 2 个上传或导入，再排 8 个，多了 429，名额占到这次请求的全部工作做完才放。
 */

import {Hono} from "hono";

import {rethrowRouteError} from "@notnotype/nb-host/http/contracts";
import type {HttpRouteEnv} from "@notnotype/nb-host/http/contracts";

import type {WorkspaceFiles} from "nbook/plugins/files/shared/workspace-files";

import {STICKERS_SCHEME} from "../shared/contracts";
import type {ArchiveCode, EditCode} from "../shared/contracts";
import {ARCHIVE_LIMITS} from "./archive";
import {checkImage} from "./catalog";
import type {StickerCatalog} from "./catalog";
import type {Edited, StickerEditor} from "./editor";

/** 单张图片上传的上限（手机照片）；缩小之后另按 2 MiB 核对。 */
export const UPLOAD_MAX_BYTES = 32 * 1024 * 1024;
const GATE_ACTIVE = 2;
const GATE_WAITING = 8;
const IDLE_MS = 30_000;

const SAFE_HEADERS = {"Content-Security-Policy": "sandbox", "X-Content-Type-Options": "nosniff"};

/** 别的网页不能读；地址栏直接打开（`none`）可以，沙箱管它。 */
function crossSite(request: Request): boolean {
    const site = request.headers.get("sec-fetch-site");
    return site !== null && site !== "same-origin" && site !== "none";
}

const notFound = (): Response => Response.json({error: {code: "not-found", message: "没有这个表情"}}, {status: 404, headers: SAFE_HEADERS});

/** 写入只放行本源发出的请求：没有“用户自己打开”这一种，所以 `none` 也不行；不带这个头的（本机进程）交给宿主的 `Origin` 核对。 */
function crossSiteWrite(request: Request): boolean {
    const site = request.headers.get("sec-fetch-site");
    return site !== null && site !== "same-origin";
}

const STATUS: Readonly<Record<EditCode | ArchiveCode, number>> = {
    "not-user-pack": 403, "permission-denied": 403, "pack-missing": 404, "pack-exists": 409, "pack-changed": 409, "folder-invalid": 422, "name-invalid": 422,
    "name-duplicate": 409, "description-invalid": 422, "title-invalid": 422, "sticker-missing": 404, "manifest-full": 409, "too-large": 413, "write-failed": 500, "refresh-failed": 500,
    "busy": 429, "request-aborted": 408, "image-rejected": 422, "import-invalid": 422, "import-conflict": 409, "export-too-large": 413, "export-empty": 422, "export-conflict": 409, "pack-invalid": 422,
};

function problem(result: Extract<Edited<unknown, EditCode | ArchiveCode>, {ok: false}>): Response {
    const body = {error: {code: result.code, message: result.detail, ...(result.code === "image-rejected" ? {reason: result.detail} : {})}, ...(result.conflict === undefined ? {} : {conflict: result.conflict})};
    return Response.json(body, {status: STATUS[result.code], headers: SAFE_HEADERS});
}

/** 进程里同时做几个、再排几个：占名额一直占到工作做完；排队时请求取消就退出队列。 */
export class Gate {
    #active = 0;
    readonly #waiting: Array<() => void> = [];

    constructor(readonly active: number, readonly waiting: number) {}

    /** 拿到名额交回释放函数；队列满了交回 null。 */
    async enter(signal: AbortSignal): Promise<(() => void) | null> {
        if (this.#active >= this.active) {
            if (this.#waiting.length >= this.waiting) return null;
            const proceeded = await new Promise<boolean>((resolve) => {
                const turn = (): void => resolve(true);
                this.#waiting.push(turn);
                signal.addEventListener("abort", () => {
                    const at = this.#waiting.indexOf(turn);
                    if (at >= 0) this.#waiting.splice(at, 1);
                    resolve(false);
                }, {once: true});
            });
            if (!proceeded) return null;
        } else {
            this.#active += 1;
        }
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const next = this.#waiting.shift();
            if (next === undefined) this.#active -= 1;
            else next();
        };
    }
}

/**
 * 读请求体，边收边数：超过 `max` 就停（分块传输没有 `Content-Length`，所以不能只看头）；`idleMs` 没有新字节就断开；请求被取消
 * （客户端断开）立即停读、放掉读取器，不等空闲超时。
 */
async function readBody(request: Request, max: number, idleMs: number): Promise<Uint8Array | "too-large" | "idle" | "aborted"> {
    const reader = request.body?.getReader();
    if (reader === undefined) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let total = 0;
    const {signal} = request;
    for (;;) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let onAbort: (() => void) | undefined;
        const idle = new Promise<"idle" | "aborted">((resolve) => {
            timer = setTimeout(() => resolve("idle"), idleMs);
            onAbort = () => resolve("aborted");
            if (signal.aborted) resolve("aborted");
            else signal.addEventListener("abort", onAbort, {once: true});
        });
        const step = await Promise.race([reader.read(), idle]);
        clearTimeout(timer);
        if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
        if (step === "idle" || step === "aborted") {
            await reader.cancel().catch(() => undefined);
            return step;
        }
        if (step.done) break;
        total += step.value.byteLength;
        if (total > max) {
            await reader.cancel().catch(() => undefined);
            return "too-large";
        }
        chunks.push(step.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

const tooLarge = (message: string): Response => Response.json({error: {code: "too-large", message}}, {status: 413, headers: SAFE_HEADERS});

export interface StickerRoutesOptions {
    readonly catalog: Pick<StickerCatalog, "item">;
    readonly files: () => WorkspaceFiles;
    /** 表情包页的写入；没有时只有取图。 */
    readonly editor?: Pick<StickerEditor, "addImage" | "importZip" | "exportPack">;
    /** 读体没有新字节多久就断开，缺省 30 秒（测试给短的）。 */
    readonly idleMs?: number;
    /** 上传与导入的名额，缺省同时 2 个、再排 8 个（测试给满的或小的）。 */
    readonly gate?: Gate;
}

export function createStickerRoutes(options: StickerRoutesOptions): Hono<{Bindings: HttpRouteEnv}> {
    const app = new Hono<{Bindings: HttpRouteEnv}>().onError(rethrowRouteError);
    const gate = options.gate ?? new Gate(GATE_ACTIVE, GATE_WAITING);
    const idleMs = options.idleMs ?? IDLE_MS;

    /** 上传与导入共用的流程：来源、长度、名额、读体，再交给 `work`。 */
    async function upload(request: Request, max: number, work: (bytes: Uint8Array) => Promise<Response>): Promise<Response> {
        if (crossSiteWrite(request)) return Response.json({error: {code: "cross-site", message: "不接受别的网页写入表情包"}}, {status: 403, headers: SAFE_HEADERS});
        const declared = Number(request.headers.get("content-length") ?? "0");
        if (declared > max) return tooLarge("请求体太大");
        const release = await gate.enter(request.signal);
        if (release === null) return problem({ok: false, code: "busy", detail: "同时上传或导入的太多，稍后再试"});
        try {
            const body = await readBody(request, max, idleMs);
            if (body === "too-large") return tooLarge("请求体太大");
            if (body === "idle") return Response.json({error: {code: "timeout", message: "很久没收到数据，断开了"}}, {status: 408, headers: SAFE_HEADERS});
            if (body === "aborted") return problem({ok: false, code: "request-aborted", detail: "请求已取消"});
            return await work(body);
        } finally {
            release();
        }
    }

    app.put("/packs/:id/images/:file", async (c) => {
        const {editor} = options;
        if (editor === undefined) return notFound();
        return upload(c.req.raw, UPLOAD_MAX_BYTES, async (bytes) => {
            const added = await editor.addImage(c.req.param("id"), c.req.param("file"), bytes, c.req.raw.signal);
            return added.ok ? Response.json(added.value, {headers: SAFE_HEADERS}) : problem(added);
        });
    });
    app.post("/import", async (c) => {
        const {editor} = options;
        if (editor === undefined) return notFound();
        const mode = c.req.query("mode");
        const token = c.req.query("token");
        const choice = mode === "copy" ? {mode: "copy" as const} : mode === "replace" && token !== undefined ? {mode: "replace" as const, token} : undefined;
        return upload(c.req.raw, ARCHIVE_LIMITS.archiveBytes, async (bytes) => {
            const imported = await editor.importZip(bytes, c.req.query("name") ?? "", choice, c.req.raw.signal);
            return imported.ok ? Response.json(imported.value, {headers: SAFE_HEADERS}) : problem(imported);
        });
    });
    app.get("/export/:id", async (c) => {
        const {editor} = options;
        if (editor === undefined) return notFound();
        if (crossSite(c.req.raw)) return Response.json({error: {code: "cross-site", message: "不接受别的网页导出表情包"}}, {status: 403, headers: SAFE_HEADERS});
        const exported = await editor.exportPack(c.req.param("id"));
        if (!exported.ok) return problem(exported);
        return new Response(exported.value.bytes, {headers: {
            ...SAFE_HEADERS,
            "Content-Type": "application/zip",
            "Content-Length": String(exported.value.bytes.length),
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(exported.value.name)}`,
            "Cache-Control": "no-store",
        }});
    });
    app.on(["GET", "HEAD"], "/image/:pack/:file", async (c) => {
        if (crossSite(c.req.raw)) return Response.json({error: {code: "cross-site", message: "不接受别的网页读取表情"}}, {status: 403, headers: SAFE_HEADERS});
        const pack = c.req.param("pack");
        const file = c.req.param("file");
        const item = options.catalog.item(pack);
        const sticker = item?.entry.stickers.find((candidate) => candidate.file === file);
        const extra = sticker === undefined ? item?.extras.find((candidate) => candidate.file === file) : undefined;
        const found = sticker ?? extra;
        if (found === undefined) return notFound();
        const read = await options.files().read(`${STICKERS_SCHEME}://${pack}/${file}`);
        if (!read.ok) return notFound();
        const checked = await checkImage(read.value.bytes, file);
        if (!checked.ok) return notFound();
        if (sticker === undefined) {
            return new Response(c.req.method === "HEAD" ? null : read.value.bytes, {headers: {...SAFE_HEADERS, "Content-Type": checked.type, "Content-Length": String(read.value.bytes.length), "Cache-Control": "no-cache"}});
        }
        const etag = `"${found.version}"`;
        const current = c.req.query("v") === found.version;
        const cache = current ? "private, max-age=31536000, immutable" : "no-cache";
        if (c.req.header("if-none-match") === etag) return new Response(null, {status: 304, headers: {...SAFE_HEADERS, "ETag": etag, "Cache-Control": cache}});
        return new Response(c.req.method === "HEAD" ? null : read.value.bytes, {headers: {
            ...SAFE_HEADERS,
            "Content-Type": checked.type,
            "Content-Length": String(read.value.bytes.length),
            "ETag": etag,
            "Cache-Control": cache,
        }});
    });
    return app;
}
