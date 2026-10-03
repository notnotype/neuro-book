/**
 * 生产环境提供前端构建产物：静态根是 `vite build` 的输出目录（`NBOOK_WEB_ROOT`）。
 *
 * - 只有 GET、HEAD；解码后的路径（含符号链接）必须落在静态根之内，否则按不存在处理。
 * - 没有扩展名的页面路径回退到 `index.html`，交给前端；`/assets/` 下与带扩展名的路径不回退：
 *   带哈希的资源缺失要如实 404，用外壳顶替会让浏览器把 HTML 当脚本执行。
 * - `/assets/` 下的文件名带内容哈希，长期缓存；其余（含 `index.html`）每次重新验证，
 *   部署新版本后外壳立即生效。
 */

import {realpath, stat} from "node:fs/promises";
import {resolve, sep} from "node:path";

import {errorResponse} from "./dispatch";

const ASSET_PREFIX = "/assets/";
const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "no-cache";

export interface StaticFiles {
    serve(request: Request): Promise<Response>;
}

/** 打开静态根；目录不存在或缺少 `index.html` 时拒绝，让 http 入口激活失败而不是带着空外壳启动。 */
export async function openStaticFiles(root: string): Promise<StaticFiles> {
    let realRoot: string;
    try {
        realRoot = await realpath(root);
    } catch (error) {
        throw new Error(`前端构建目录不存在：${root}`, {cause: error});
    }
    const index = resolve(realRoot, "index.html");
    if (!(await isFile(index))) throw new Error(`前端构建目录缺少 index.html：${root}`);
    const inside = (path: string): boolean => path === realRoot || path.startsWith(realRoot + sep);

    return {
        async serve(request) {
            if (request.method !== "GET" && request.method !== "HEAD") {
                return withHeaders(errorResponse(405, "method-not-allowed", "页面资源只支持 GET 与 HEAD。"), {allow: "GET, HEAD"});
            }
            const path = decodePath(new URL(request.url).pathname);
            if (path === null) return notFound();
            const candidate = resolve(realRoot, `.${path}`);
            if (!inside(candidate)) return notFound();
            const file = path === "/" ? index : await resolveFile(candidate, inside);
            if (file !== null) return fileResponse(request, file, path.startsWith(ASSET_PREFIX) ? IMMUTABLE : REVALIDATE);
            if (path.startsWith(ASSET_PREFIX) || hasExtension(path)) return notFound();
            return fileResponse(request, index, REVALIDATE);
        },
    };
}

/** URL 编码非法、含 NUL 或反斜杠的路径一律按不存在处理，不尝试纠正。 */
function decodePath(pathname: string): string | null {
    let decoded: string;
    try {
        decoded = decodeURIComponent(pathname);
    } catch (error) {
        if (error instanceof URIError) return null;
        throw error;
    }
    return decoded.includes("\0") || decoded.includes("\\") ? null : decoded;
}

/** 普通文件且真实路径仍在静态根内时返回真实路径；目录、缺失或经符号链接逃出的返回 null。 */
async function resolveFile(candidate: string, inside: (path: string) => boolean): Promise<string | null> {
    let real: string;
    try {
        real = await realpath(candidate);
    } catch (error) {
        if (isMissing(error)) return null;
        throw error;
    }
    return inside(real) && (await isFile(real)) ? real : null;
}

async function isFile(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isFile();
    } catch (error) {
        if (isMissing(error)) return false;
        throw error;
    }
}

function isMissing(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return code === "ENOENT" || code === "ENOTDIR";
}

function hasExtension(path: string): boolean {
    const last = path.slice(path.lastIndexOf("/") + 1);
    return last.includes(".");
}

function fileResponse(request: Request, path: string, cacheControl: string): Response {
    const file = Bun.file(path);
    const headers = {"content-type": file.type, "cache-control": cacheControl, "x-content-type-options": "nosniff"};
    return new Response(request.method === "HEAD" ? null : file, {headers});
}

function notFound(): Response {
    return errorResponse(404, "not-found", "没有这个页面资源。");
}

function withHeaders(response: Response, headers: Record<string, string>): Response {
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    return response;
}
