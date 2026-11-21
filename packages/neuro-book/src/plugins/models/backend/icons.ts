/**
 * 服务商图标的文件存放与读取路由（docs/specs/models/service.md 输出 12）：上传的图标存在状态根的 `agent/provider-icons/`，文件名是
 * 内容的 SHA-256 加 `.png`，设置里只存名字。写入先落同目录的暂存文件再原子改名；读取经 `GET /api/nbook.models/icons/<name>`，
 * 逐段 `lstat`、不跟链接，响应头与跨站规则同 bots 的头像路由。
 */

import {mkdir, readdir, rename, unlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {Hono} from "hono";

import {rethrowRouteError} from "@notnotype/nb-host/http/contracts";
import type {HttpRouteEnv} from "@notnotype/nb-host/http/contracts";
import {ICON_NAME} from "@notnotype/nb-models/core";
import type {IconStore} from "@notnotype/nb-models/core";

import {entryInside} from "nbook/plugin-platform/backend/plugin-files";
import {sniffImageType} from "nbook/shared/image-type";

const SAFE_HEADERS = {"Content-Security-Policy": "sandbox", "X-Content-Type-Options": "nosniff"};
/** 上传时已按 64 KB 校验；读取再按这个上限防文件被换成大文件。 */
const READ_LIMIT = 128 * 1024;

export function fileIconStore(directory: string): IconStore {
    return {
        async save(name, bytes) {
            await mkdir(directory, {recursive: true, mode: 0o700});
            const temp = join(directory, `.${name}.${String(process.pid)}.tmp`);
            await writeFile(temp, bytes, {mode: 0o600});
            try {
                await rename(temp, join(directory, name));
            } catch (error) {
                await unlink(temp).catch(() => undefined);
                throw error;
            }
        },
        async remove(name) {
            try {
                await unlink(join(directory, name));
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
        },
        async list() {
            try {
                return (await readdir(directory)).filter((name) => ICON_NAME.test(name));
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
                throw error;
            }
        },
    };
}

/** 别的网页不能读；地址栏直接打开（`none`）可以。 */
function crossSite(request: Request): boolean {
    const site = request.headers.get("sec-fetch-site");
    return site !== null && site !== "same-origin" && site !== "none";
}

const notFound = (): Response => Response.json({error: {code: "not-found", message: "没有这个图标"}}, {status: 404, headers: SAFE_HEADERS});

export function createIconRoutes(directory: string): Hono<{Bindings: HttpRouteEnv}> {
    const app = new Hono<{Bindings: HttpRouteEnv}>().onError(rethrowRouteError);
    app.get("/icons/:name", async (c) => {
        if (crossSite(c.req.raw)) return Response.json({error: {code: "cross-site", message: "不给别的网页读图标"}}, {status: 403, headers: SAFE_HEADERS});
        const name = c.req.param("name");
        if (!ICON_NAME.test(name)) return notFound();
        const found = await entryInside(directory, [name], "file");
        if (found === "missing") return notFound();
        if (!("path" in found)) throw found.error;
        const file = Bun.file(found.path);
        if (file.size > READ_LIMIT) return notFound();
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.length > READ_LIMIT || sniffImageType(bytes) !== "image/png") return notFound();
        // 文件名是内容的哈希，同一个名字内容不会变：可以长缓存。
        const etag = `"${name.slice(0, 32)}"`;
        const headers = {...SAFE_HEADERS, etag, "cache-control": "private, max-age=31536000, immutable"};
        if (c.req.header("if-none-match") === etag) return new Response(null, {status: 304, headers});
        return new Response(bytes, {headers: {...headers, "content-type": "image/png"}});
    });
    return app;
}
