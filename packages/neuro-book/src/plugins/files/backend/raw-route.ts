/**
 * 按地址读取字节（docs/specs/workspace/files.md 的“按地址读取字节”）：挂在 `/api/nbook.files/` 下，图片这类二进制文件
 * 不走远程服务，浏览器直接把地址交给 `<img>` 或 `fetch`。
 *
 * 项目根只认正在运行的那一代：项目子进程里的文件服务用的是这一代启动时校验过的目录，这里每一代第一次请求时打开一次、
 * 记下根身份，之后同样逐请求核对；代次变了就丢掉重开。这样两边对同一个地址给出同一个文件，根被换掉时两边都是 `root-gone`。
 */

import type {Stats} from "node:fs";
import {randomBytes} from "node:crypto";
import {join} from "node:path";

import {Hono} from "hono";
import type {Context} from "hono";

import type {HttpRouteEnv} from "nbook/plugins/http/shared/contracts";
import {rethrowRouteError} from "nbook/plugins/http/shared/contracts";
import type {ProjectsService} from "nbook/shared/projects";

import {previewContentSecurityPolicy} from "../shared/contracts";
import type {FilesFailureCode} from "../shared/failures";
import {openRoot} from "./rooted";
import type {RootedFailure, RootedRoot} from "./rooted";

/** 一次至多读这么多字节；字节是整段读进内存再交出的。 */
export const RAW_MAX_BYTES = 32 * 1024 * 1024;

/** 按扩展名给出的类型；不在表里的一律 `application/octet-stream`，配合 `nosniff` 不让浏览器猜。 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    avif: "image/avif",
    bmp: "image/bmp",
    ico: "image/x-icon",
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    mjs: "text/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    txt: "text/plain; charset=utf-8",
    md: "text/markdown; charset=utf-8",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
};

export function contentTypeOf(path: string): string {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const dot = name.lastIndexOf(".");
    return (dot <= 0 ? undefined : CONTENT_TYPES[name.slice(dot + 1).toLowerCase()]) ?? "application/octet-stream";
}

/** 失败码对应的状态：受保护与不存在不区分，探测的一方分不出“存在但不让看”。 */
const STATUS: Partial<Record<FilesFailureCode, number>> = {
    "permission-denied": 403,
    "root-gone": 410,
    "too-large": 413,
    "io-failed": 500,
};

export function failureResponse(failure: {readonly code: string; readonly detail: string}): Response {
    const status = STATUS[failure.code as FilesFailureCode] ?? 404;
    return Response.json({error: {code: status === 404 ? "not-found" : failure.code, message: failure.detail}}, {status});
}

/**
 * 预览令牌（docs/specs/workspace/files.md 的“预览的受限读取”）：令牌只放行一部作品的一代、只读。签发与作废经远程服务
 * `nbook.files.preview`（按调用方门面，门面释放时它签发的全部作废）；路由每次请求核对令牌，代次结束的令牌在被用到时作废。
 * 令牌是读文件的凭据：不写日志、不落盘。
 */
export interface PreviewTokens {
    issue(project: string, generation: number, network: boolean): string;
    revoke(token: string): void;
    lookup(token: string): PreviewGrant | null;
}

/** 一个令牌放行的范围：哪部作品的哪一代，响应放不放行外网。 */
export interface PreviewGrant {
    readonly project: string;
    readonly generation: number;
    readonly network: boolean;
}

export function createPreviewTokens(): PreviewTokens {
    const tokens = new Map<string, PreviewGrant>();
    return {
        issue: (project, generation, network) => {
            const token = randomBytes(16).toString("hex");
            tokens.set(token, {project, generation, network});
            return token;
        },
        revoke: (token) => {
            tokens.delete(token);
        },
        lookup: (token) => tokens.get(token) ?? null,
    };
}

/** 预览路由的前缀（挂载在 `/api/nbook.files/` 下）。 */
export const PREVIEW_PREFIX = "/api/nbook.files/preview/";

export interface RawRouteSources {
    /** 项目登记；实例里没有它（只装了文件服务的测试场地）时为 null，项目的地址一律 503。 */
    readonly projects: Pick<ProjectsService, "list" | "readMetadata"> | null;
    /** `user://` 的根：服务端入口激活时打开的那一个。 */
    readonly user: RootedRoot;
    readonly tokens: PreviewTokens;
    readonly record: (event: string, detail: string, error?: unknown) => void;
}

/** 正在运行的项目代次与它的根。 */
export interface ProjectRoots {
    /** id 与代次对得上、身份文件核对过的根；对不上为失败（码与状态见 `failureResponse` 与 410、409）。 */
    open(id: string, generation: number): Promise<{readonly ok: true; readonly root: RootedRoot} | {readonly ok: false; readonly status: number; readonly code: string; readonly detail: string}>;
}

export function createProjectRoots(sources: {readonly projects: Pick<ProjectsService, "list" | "readMetadata">; readonly record: RawRouteSources["record"]}): ProjectRoots {
    /** 每个项目只留当前那一代的根；代次变了就换掉。 */
    type Opened = {readonly ok: true; readonly root: RootedRoot} | {readonly ok: false; readonly status: number; readonly code: string; readonly detail: string};
    const opened = new Map<string, {readonly generation: number; readonly root: Promise<Opened>}>();
    return {
        open: async (id, generation) => {
            const listed = await sources.projects.list();
            if (!listed.ok) return {ok: false, status: 500, code: "registry-invalid", detail: listed.detail};
            const project = listed.value.find((item) => item.id === id);
            // 宽限期里的项目仍是同一代、仍在运行（只是暂时没有窗口持有它）。
            const running = project !== undefined && (project.state === "running" || project.state === "idle-grace") ? project.generation : null;
            // 缓存只随实际运行的代次失效：URL 里写错（或迟到的旧窗口带着）的代次不能把正在用的根丢掉，否则下一次会按登记
            // 路径重新打开、认到换进来的目录。
            const cached = opened.get(id);
            if (cached !== undefined && cached.generation !== running) opened.delete(id);
            if (project === undefined || running !== generation) return {ok: false, status: 410, code: "generation-gone", detail: `作品 ${id} 的第 ${String(generation)} 代不在运行`};
            let entry = opened.get(id);
            if (entry === undefined || entry.generation !== generation) {
                const root = (async (): Promise<Opened> => {
                    // 登记路径上换成了另一部作品时，不能把它的文件当成这个 id 交出去（同封面路由）。
                    const metadata = await sources.projects.readMetadata(id);
                    if (!metadata.ok) return {ok: false, status: 409, code: metadata.reason, detail: `作品 ${id} 的身份核对失败：${metadata.detail}`};
                    // 只读：锁目录不会被用到，写成项目实例里文件服务的同一个位置。
                    const rooted: RootedRoot | RootedFailure = await openRoot(project.path, {controlDirectory: true, lockDirectory: join(project.path, ".nbook", "locks", "files"), report: (event, error) => sources.record(`files.raw.${event}`, "读取字节的收尾出错", error)});
                    return "ok" in rooted ? {ok: false, status: 410, code: rooted.code, detail: rooted.detail} : {ok: true, root: rooted};
                })();
                entry = {generation, root};
                opened.set(id, entry);
            }
            const result = await entry.root;
            // 打开失败不缓存：下次请求再试（目录可能只是暂时不可读）。
            if (!result.ok && opened.get(id) === entry) opened.delete(id);
            return result;
        },
    };
}

/** 路径各段按 URL 编码；解码失败为 null。 */
export function decodePath(encoded: string): string | null {
    try {
        return encoded.split("/").map((segment) => decodeURIComponent(segment)).join("/");
    } catch (error) {
        if (error instanceof URIError) return null;
        throw error;
    }
}

/** 读根下的一个文件并按规则给出响应：ETag 命中时不读内容。`extra` 是调用方另加的响应头。 */
export async function serveFile(root: RootedRoot, path: string, request: Request, extra: Readonly<Record<string, string>> = {}): Promise<Response> {
    const resolved = await root.resolve(path);
    if ("ok" in resolved) return failureResponse(resolved);
    if (!resolved.stats.isFile()) return failureResponse({code: "not-a-file", detail: `${path} 不是普通文件`});
    // 验证器要在内容变了时一定变：同样大小、改回原修改时间的改写也要认得出。inode 随“写临时文件再改名”换新，ctime 在
    // 任何写入时前进且不能被用户改回去，所以带上这两个；不读内容算哈希。
    const etagOf = (stats: Stats): string => `"${[stats.ino, Math.round(stats.ctimeMs * 1000), Math.round(stats.mtimeMs * 1000), stats.size].map((part) => part.toString(36)).join("-")}"`;
    const headers = {
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
        ...extra,
    };
    if (request.headers.get("if-none-match") === etagOf(resolved.stats)) return new Response(null, {status: 304, headers: {...headers, ETag: etagOf(resolved.stats)}});
    // HEAD 只要头：大小与验证器取自解析时的目录项，不读内容；上限照样判。
    if (request.method === "HEAD") {
        if (resolved.stats.size > RAW_MAX_BYTES) return failureResponse({code: "too-large", detail: `${path} 超过 ${String(RAW_MAX_BYTES)} 字节`});
        return new Response(null, {headers: {...headers, "Content-Type": contentTypeOf(path), "Content-Length": String(resolved.stats.size), ETag: etagOf(resolved.stats)}});
    }
    const read = await root.read(path, RAW_MAX_BYTES);
    if (!read.ok) return failureResponse(read);
    return new Response(read.bytes, {headers: {...headers, "Content-Type": contentTypeOf(path), ETag: etagOf(read.resolved.stats)}});
}

/**
 * 浏览器带 `Sec-Fetch-Site` 且不是本源发出（`same-origin`）或用户自己打开（`none`）的请求：别的网页不能把这条路由当作
 * 读取接口。不带这个头的是本机进程，与 HTTP 端口未加载鉴权时的信任相同。
 */
function crossSite(request: Request): boolean {
    const site = request.headers.get("sec-fetch-site");
    return site !== null && site !== "same-origin" && site !== "none";
}

/** `raw` 的响应另带 `sandbox`：直接打开一个 HTML 或 SVG 的地址，它也不在应用的源里运行。 */
const RAW_HEADERS = {"Content-Security-Policy": "sandbox"};

export function createRawRoutes(sources: RawRouteSources): Hono<{Bindings: HttpRouteEnv}> {
    const app = new Hono<{Bindings: HttpRouteEnv}>().onError(rethrowRouteError);
    const projects = sources.projects;
    const roots = projects === null ? null : createProjectRoots({projects, record: sources.record});
    const rest = (c: Context, prefix: number): string | null => decodePath(new URL(c.req.url).pathname.split("/").slice(prefix).join("/"));

    app.on(["GET", "HEAD"], "/raw/project/:id/:generation/*", async (c) => {
        if (crossSite(c.req.raw)) return Response.json({error: {code: "cross-site", message: "不接受别的网页读取文件。"}}, {status: 403});
        const generation = Number(c.req.param("generation"));
        // 路径是 /raw/project/<id>/<代次>/<路径…>：前五段（含开头的空段）之后才是文件路径。
        const path = rest(c, 5);
        if (!Number.isSafeInteger(generation) || generation < 1 || path === null) return failureResponse({code: "invalid-address", detail: "地址不合法"});
        if (roots === null) return Response.json({error: {code: "unavailable", message: "这个实例没有项目登记。"}}, {status: 503});
        const opened = await roots.open(c.req.param("id"), generation);
        if (!opened.ok) return Response.json({error: {code: opened.code, message: opened.detail}}, {status: opened.status});
        return serveFile(opened.root, path, c.req.raw, RAW_HEADERS);
    });

    // 预览的受限读取：沙箱页面是不透明源，它的每个请求都是跨站的，所以这里不看 `Sec-Fetch-Site`，只认令牌；对 `Origin: null`
    // 回 CORS 头，模块脚本、`fetch` 与字体才读得到响应。别的来源拿不到令牌，也就读不到。
    app.on(["GET", "HEAD"], "/preview/:token/*", async (c) => {
        const missing = (): Response => Response.json({error: {code: "not-found", message: "没有这个预览。"}}, {status: 404});
        const token = c.req.param("token");
        const granted = sources.tokens.lookup(token);
        const path = rest(c, 3);
        if (granted === null || roots === null || path === null) return missing();
        const opened = await roots.open(granted.project, granted.generation);
        if (!opened.ok) {
            // 这一代结束了：令牌随之作废（同一代不会回来）。
            if (opened.status === 410) sources.tokens.revoke(token);
            return missing();
        }
        const cors: Record<string, string> = c.req.header("origin") === "null" ? {"Access-Control-Allow-Origin": "null", "Vary": "Origin"} : {"Vary": "Origin"};
        // 预览页在 iframe 里导航到作品里别的 HTML、或有人直接打开这个地址时，加载的是这里给的原文：响应头自己带沙箱与网络
        // 限制，不靠控件注入的 meta。
        const base = `${new URL(c.req.url).origin}${PREVIEW_PREFIX}${token}/`;
        const policy = `sandbox allow-scripts; ${previewContentSecurityPolicy(base, granted.network)}`;
        return serveFile(opened.root, path, c.req.raw, {...cors, "Referrer-Policy": "no-referrer", "Content-Security-Policy": policy});
    });

    app.on(["GET", "HEAD"], "/raw/user/*", async (c) => {
        if (crossSite(c.req.raw)) return Response.json({error: {code: "cross-site", message: "不接受别的网页读取文件。"}}, {status: 403});
        const path = rest(c, 3);
        if (path === null) return failureResponse({code: "invalid-address", detail: "地址不合法"});
        return serveFile(sources.user, path, c.req.raw, RAW_HEADERS);
    });

    return app;
}
