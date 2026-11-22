/**
 * 服务商图标的文件存放与读取路由（docs/specs/models/service.md 输出 21）：上传的图标存在状态根的 `agent/provider-icons/`，文件名是
 * 内容的 SHA-256 加 `.png`，设置里只存名字。写入先落同目录的暂存文件再原子改名；读取经 `GET /api/nbook.models/icons/<name>`。
 * 存、读、列都从状态根起逐段 `lstat`、不跟链接（目录本身被换成链接也算），响应头与跨站规则同 bots 的头像路由。
 */

import {mkdir, open, readdir, rename, unlink, writeFile} from "node:fs/promises";
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

/** 图标目录在状态根下的位置。 */
const SEGMENTS = ["agent", "provider-icons"] as const;

/**
 * 状态根下的图标目录：从状态根起逐段 `lstat`、不跟符号链接（`agent` 或 `provider-icons` 被换成链接时不写、不读、不列）。
 * `create` 为真时先建出来（权限 0700）。
 */
async function iconDirectory(stateRoot: string, create: boolean): Promise<string | null> {
    if (create) await mkdir(join(stateRoot, ...SEGMENTS), {recursive: true, mode: 0o700});
    const found = await entryInside(stateRoot, SEGMENTS, "directory");
    if (found === "missing") return null;
    if (!("path" in found)) throw found.error;
    return found.path;
}

export function fileIconStore(stateRoot: string): IconStore {
    return {
        async save(name, bytes) {
            const directory = await iconDirectory(stateRoot, true);
            if (directory === null) throw new Error("the provider icon directory is not a plain directory");
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
            const directory = await iconDirectory(stateRoot, false);
            if (directory === null) return;
            try {
                await unlink(join(directory, name));
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
        },
        async list() {
            const directory = await iconDirectory(stateRoot, false);
            if (directory === null) return [];
            try {
                return (await readdir(directory)).filter((name) => ICON_NAME.test(name));
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
                throw error;
            }
        },
    };
}

/** 在打开的句柄上读，至多 `READ_LIMIT + 1` 字节：检查与读取之间文件被换掉、变大也读不出界。 */
async function readBounded(path: string): Promise<Uint8Array<ArrayBuffer>> {
    const handle = await open(path, "r");
    try {
        const buffer = new Uint8Array(READ_LIMIT + 1);
        let length = 0;
        while (length < buffer.length) {
            const {bytesRead} = await handle.read(buffer, length, buffer.length - length, null);
            if (bytesRead === 0) break;
            length += bytesRead;
        }
        return buffer.slice(0, length);
    } finally {
        await handle.close();
    }
}

/** 别的网页不能读；地址栏直接打开（`none`）可以。 */
function crossSite(request: Request): boolean {
    const site = request.headers.get("sec-fetch-site");
    return site !== null && site !== "same-origin" && site !== "none";
}

const notFound = (): Response => Response.json({error: {code: "not-found", message: "没有这个图标"}}, {status: 404, headers: SAFE_HEADERS});

export function createIconRoutes(stateRoot: string): Hono<{Bindings: HttpRouteEnv}> {
    const app = new Hono<{Bindings: HttpRouteEnv}>().onError(rethrowRouteError);
    app.get("/icons/:name", async (c) => {
        if (crossSite(c.req.raw)) return Response.json({error: {code: "cross-site", message: "不给别的网页读图标"}}, {status: 403, headers: SAFE_HEADERS});
        const name = c.req.param("name");
        if (!ICON_NAME.test(name)) return notFound();
        const found = await entryInside(stateRoot, [...SEGMENTS, name], "file");
        if (found === "missing") return notFound();
        if (!("path" in found)) throw found.error;
        const bytes = await readBounded(found.path);
        if (bytes.length > READ_LIMIT || sniffImageType(bytes) !== "image/png") return notFound();
        // 文件名是内容的哈希，同一个名字内容不会变：可以长缓存。
        const etag = `"${name.slice(0, 32)}"`;
        const headers = {...SAFE_HEADERS, etag, "cache-control": "private, max-age=31536000, immutable"};
        if (c.req.header("if-none-match") === etag) return new Response(null, {status: 304, headers});
        return new Response(bytes, {headers: {...headers, "content-type": "image/png"}});
    });
    return app;
}
