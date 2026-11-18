/**
 * 取图路由（docs/specs/agent/stickers.md 的“边界与兼容”）：`GET /api/nbook.stickers/image/<表情包 id>/<文件名>?v=<版本>`。只给
 * 目录里有效的表情；字节经文件服务读 `stickers://`（根身份、链接与路径包含的规则在那里），读到后再按字节核对一次类型、大小与
 * 宽高，扫描之后被换掉的文件不按旧的结论给出去。响应头与跨站规则同文件服务的按地址读取字节。
 */

import {Hono} from "hono";

import {rethrowRouteError} from "@notnotype/nb-host/http/contracts";
import type {HttpRouteEnv} from "@notnotype/nb-host/http/contracts";

import type {WorkspaceFiles} from "nbook/plugins/files/shared/workspace-files";

import {STICKERS_SCHEME} from "../shared/contracts";
import {checkImage} from "./catalog";
import type {StickerCatalog} from "./catalog";

const SAFE_HEADERS = {"Content-Security-Policy": "sandbox", "X-Content-Type-Options": "nosniff"};

/** 别的网页不能读；地址栏直接打开（`none`）可以，沙箱管它。 */
function crossSite(request: Request): boolean {
    const site = request.headers.get("sec-fetch-site");
    return site !== null && site !== "same-origin" && site !== "none";
}

const notFound = (): Response => Response.json({error: {code: "not-found", message: "没有这个表情"}}, {status: 404, headers: SAFE_HEADERS});

export function createStickerRoutes(options: {readonly catalog: Pick<StickerCatalog, "item">; readonly files: () => WorkspaceFiles}): Hono<{Bindings: HttpRouteEnv}> {
    const app = new Hono<{Bindings: HttpRouteEnv}>().onError(rethrowRouteError);
    app.on(["GET", "HEAD"], "/image/:pack/:file", async (c) => {
        if (crossSite(c.req.raw)) return Response.json({error: {code: "cross-site", message: "不接受别的网页读取表情"}}, {status: 403, headers: SAFE_HEADERS});
        const pack = c.req.param("pack");
        const file = c.req.param("file");
        const sticker = options.catalog.item(pack)?.entry.stickers.find((candidate) => candidate.file === file);
        if (sticker === undefined) return notFound();
        const read = await options.files().read(`${STICKERS_SCHEME}://${pack}/${file}`);
        if (!read.ok) return notFound();
        const checked = await checkImage(read.value.bytes, file);
        if (!checked.ok) return notFound();
        const etag = `"${sticker.version}"`;
        const current = c.req.query("v") === sticker.version;
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
