/**
 * 头像路由（docs/specs/bots/bots.md 的头像）：`GET /api/nbook.bots/avatar/<bot id>`。只给 bot 记录里有的 bot；在它的目录里按
 * `avatar.png`、`.jpg`、`.jpeg`、`.webp` 找，逐段 `lstat`、不跟链接（bot 目录是用户数据，不经文件服务）；类型按文件开头的字节判定，
 * 判不出的不给。响应头与跨站规则同表情包的取图路由；头像会被用户换掉，`no-cache` 加 ETag。
 */

import {createHash} from "node:crypto";
import {open} from "node:fs/promises";

import {Hono} from "hono";

import {rethrowRouteError} from "@notnotype/nb-host/http/contracts";
import type {HttpRouteEnv} from "@notnotype/nb-host/http/contracts";

import {entryInside} from "nbook/plugin-platform/backend/plugin-files";
import {sniffImageType} from "nbook/shared/image-type";

import {AVATAR_EXTENSIONS, AVATAR_MAX_BYTES, BOT_ID} from "../shared/contracts";

const SAFE_HEADERS = {"Content-Security-Policy": "sandbox", "X-Content-Type-Options": "nosniff"};

/** 别的网页不能读；地址栏直接打开（`none`）可以。 */
function crossSite(request: Request): boolean {
    const site = request.headers.get("sec-fetch-site");
    return site !== null && site !== "same-origin" && site !== "none";
}

const notFound = (): Response => Response.json({error: {code: "not-found", message: "没有这个头像"}}, {status: 404, headers: SAFE_HEADERS});

/** 超过上限的不读进内存：先看打开的句柄有多大，读的时候也只读到上限多一个字节（读的过程中变大了照样判超限）。 */
async function readBounded(path: string): Promise<Uint8Array | null> {
    const handle = await open(path, "r");
    try {
        if ((await handle.stat()).size > AVATAR_MAX_BYTES) return null;
        const buffer = new Uint8Array(AVATAR_MAX_BYTES + 1);
        let length = 0;
        while (length < buffer.byteLength) {
            const {bytesRead} = await handle.read(buffer, length, buffer.byteLength - length, length);
            if (bytesRead === 0) break;
            length += bytesRead;
        }
        return length > AVATAR_MAX_BYTES ? null : buffer.subarray(0, length);
    } finally {
        await handle.close();
    }
}

export interface AvatarRoutesOptions {
    /** `<状态根>/user/bots`。 */
    readonly root: string;
    /** 这个 bot 在记录里吗：目录在、记录不在的不给（bots.md 输出 5 的“不登记”）。 */
    readonly known: (botId: string) => boolean;
}

export function createAvatarRoutes(options: AvatarRoutesOptions): Hono<{Bindings: HttpRouteEnv}> {
    const app = new Hono<{Bindings: HttpRouteEnv}>().onError(rethrowRouteError);
    app.get("/avatar/:botId", async (c) => {
        if (crossSite(c.req.raw)) return Response.json({error: {code: "cross-site", message: "不给别的网页读头像"}}, {status: 403, headers: SAFE_HEADERS});
        const botId = c.req.param("botId");
        if (!BOT_ID.test(botId) || !options.known(botId)) return notFound();
        for (const extension of AVATAR_EXTENSIONS) {
            const found = await entryInside(options.root, [botId, `avatar.${extension}`], "file");
            if (found === "missing") continue;
            if (!("path" in found)) throw found.error;
            const bytes = await readBounded(found.path);
            const type = bytes === null ? null : sniffImageType(bytes);
            if (bytes === null || type === null || type === "image/gif") return notFound();
            const etag = `"${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}"`;
            if (c.req.header("if-none-match") === etag) return new Response(null, {status: 304, headers: {...SAFE_HEADERS, etag, "cache-control": "no-cache"}});
            return new Response(bytes, {headers: {...SAFE_HEADERS, "content-type": type, etag, "cache-control": "no-cache"}});
        }
        return notFound();
    });
    return app;
}
