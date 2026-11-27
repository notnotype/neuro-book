/**
 * 发官方站的网页：前端产物目录里的文件与单页回退（`site.operations` 输出 12）。只在站点入口上、各模块都没接的请求才交到这里
 * （`site.ts` 的站点子应用的 `notFound`），所以模块的路由、健康检查与测试控制入口总是先匹配。
 *
 * 没用 Hono 的 `serveStatic`（`hono/bun`，4.12）：它跟随符号链接，链到目录外的文件也照发；把目录当作 `目录/index.html` 发；
 * 单页回退、两种缓存头与安全头仍要在它外面另写一层。这里要守的只有几条，自己写更容易看清每一条。
 *
 * 路径怎样落到文件上（顺序就是代码的顺序）：
 * 1. Bun 交来的 `request.url` 已经按 URL 标准规范化过：点段（`..`、`%2e%2e`）已经消解、反斜杠已经当成斜杠，所以请求方写的
 *    `/../x` 到这里已是 `/x`，落不到根之上。剩下能越出目录的只有编码在一段里面的分隔符（`..%2fx`）与符号链接。
 *    重复的斜杠不合并：`//api/x` 到这里仍是 `//api/x`。
 * 2. 取路径的原文（不经 `URL` 再解析一次），按 `/` 切段。只解码第一段来判它是不是不回退的前缀之一；是的话不归这里管，后面的段
 *    写成什么（包括编码不合法）都原样回到入口的 404，与没有网页时逐字相同。第一段解码不了的不是任何前缀。
 * 3. 其余的才逐段解码。某一段编码不合法、解码后以 `.` 开头（含 `.`、`..`）或含 `/`、`\`、空字节，或路径中间有空段的，回 404，
 *    不去推算它落在哪里。以 `.` 开头的段不发，免得产物目录里的点文件（Vite 原样拷贝 `publicDir` 里的点文件）被发出去；
 *    `.well-known` 在第 2 步已经是前缀，不到这里。
 * 4. 以 `/` 结尾的路径不对应文件，直接按回退的规则处理。否则拼出路径后取真实路径（解开符号链接）；不在产物目录里的回 404，
 *    不论有没有扩展名。是普通文件才发，目录当作没有这个文件。
 * 5. 发之前把整个文件读进内存：读不出时还没交出响应，回 404 并记一条诊断。交给 Bun 的惰性 `Bun.file` 时，真正的打开发生在
 *    Hono 已经返回、入口已经按 200 记过日志之后，失败只能落到 `Bun.serve` 的错误页，请求日志与响应对不上。产物都是小文件
 *    （最大的看板块约 525 KB），整读的内存可以接受；产物里有了大文件（视频、大图）时要换成先打开、再按句柄流式发。整读之后
 *    Bun 不再替这些响应处理 `Range`，单页应用的产物用不到它。
 *
 * 第 4、5 步里“没有这个文件”与“有却读不出”分开：前者（不存在、中间一段不是目录）交给回退的规则，不记诊断；后者（目录或文件
 * 没有权限、链接成环、I/O 错误、链接落到目录外）回 404 并记 `web.file_unreadable`，因为它们在产物目录里看得见、却发不出，
 * 只看响应分不出是部署出了错。回退时连 `index.html` 都没有（启动时校验过它在）同样记：多半是产物目录在运行中被挪走或替换。
 */

import {open, realpath} from "node:fs/promises";
import {extname, join} from "node:path";

import type {Logger} from "./log";
import {isInsideDir, isNotFoundError} from "./paths";

/**
 * 这几个前缀下的地址不回退（`site.operations` 输出 12 与“边界与兼容”）：模块与入口的地址空间。按第一段比，`/api` 本身与
 * `/api/…` 都算。
 */
const RESERVED_FIRST_SEGMENTS: ReadonlySet<string> = new Set(["api", ".well-known", "health", "test-control"]);

/** 内容哈希命名的产物所在的第一段（Vite 的 `build.assetsDir` 缺省值）。 */
const HASHED_ASSETS_SEGMENT = "assets";

const IMMUTABLE = "public, max-age=31536000, immutable";
const NO_CACHE = "no-cache";

/**
 * 内容安全策略，取值与理由见 w00037 t10 计划 3.8：`style-src` 要 `'unsafe-inline'`（nb-ui 的主题插内联样式、
 * ECharts 的提示框带 `style` 属性）；Vite 的产物没有内联脚本，`script-src` 只许 `'self'`。每个网页响应都带，不只 HTML：
 * 直接打开的 SVG、XHTML 同样会被当作文档执行，对脚本、样式与字体这条头不起作用、也无害。
 */
const CONTENT_SECURITY_POLICY =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

/** 每个网页响应（文件、回退与这里回的 404）都带。 */
const WEB_HEADERS: Readonly<Record<string, string>> = {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
};

/**
 * 处理一个模块都没接的站点请求。不归网页管（不是 `GET`、`HEAD`，或落在不回退的前缀下）时同步返回 undefined，调用方照旧回 404；
 * 否则返回这个请求的响应，调用方据此把日志的 `module` 记成 `web`。`requestId` 只用来让诊断与那一行请求日志对得上。
 */
export type WebHandler = (request: Request, requestId: string) => Promise<Response> | undefined;

/** 路径的原文：协议与主机之后、查询串与片段之前。主机名读不出的请求在入口就回了 400，到这里的 `url` 都是绝对地址。 */
function rawPath(url: string): string {
    const start = url.indexOf("/", url.indexOf("://") + 3);
    if (start < 0) return "/";
    const end = url.slice(start).search(/[?#]/u);
    return end < 0 ? url.slice(start) : url.slice(start, start + end);
}

/** 解码一段；编码不合法时为 null。 */
function decodeSegment(segment: string): string | null {
    try {
        return decodeURIComponent(segment);
    } catch {
        // `URIError`：`%` 后面不是两位十六进制，或解出来不是合法的 UTF-8。调用方按“不是前缀”“不对应文件”处理。
        return null;
    }
}

/** 第 3 步：拼路径时会改变层级、截断路径或指到点文件的段。 */
function isUnsafeSegment(segment: string): boolean {
    return segment.startsWith(".") || segment.includes("/") || segment.includes("\\") || segment.includes("\0");
}

/**
 * 诊断里写明的原因：系统报的错误码（`EACCES` 这类），或没有错误码时的原因词。都不带路径：错误的说明里带着产物目录的绝对路径，
 * 不进日志。
 */
type Cause = {readonly errorCode: string} | {readonly reason: "outside_web_dir" | "index_missing"};

const MISSING = {kind: "missing"} as const;

type Lookup = {readonly kind: "file"; readonly path: string} | typeof MISSING | {readonly kind: "unreadable"; readonly cause: Cause};

/** 第 4 步：`root` 是产物目录的真实路径。 */
async function lookup(root: string, segments: readonly string[]): Promise<Lookup> {
    // 以 `/` 结尾：按 URL 的语义是目录，不对应文件（`/assets/app.js/` 不发 `app.js`）。
    if (segments.at(-1) === "") return MISSING;
    let real: string;
    try {
        real = await realpath(join(root, ...segments));
    } catch (error) {
        // 不存在、中间一段不是目录、链接指向不存在之处：没有这个文件，交给回退的规则。别的（路径上的目录不让进、链接成环）
        // 是有却读不出。
        return isNotFoundError(error) ? MISSING : {kind: "unreadable", cause: {errorCode: errorCodeOf(error)}};
    }
    return isInsideDir(root, real) ? {kind: "file", path: real} : {kind: "unreadable", cause: {reason: "outside_web_dir"}};
}

type Read = {readonly kind: "file"; readonly bytes: Uint8Array | null; readonly size: number} | typeof MISSING | {readonly kind: "unreadable"; readonly cause: Cause};

/**
 * 第 5 步：打开、确认是普通文件、读完（`HEAD` 不读内容，只要大小），都在交出响应之前。目录与别的非普通文件当作没有这个文件；
 * 打开或读的时候系统报的错，除了不存在都是 `unreadable`。
 */
async function readFile(path: string, head: boolean): Promise<Read> {
    let handle;
    try {
        handle = await open(path, "r");
    } catch (error) {
        // realpath 之后到这里之间被删掉的，与 realpath 时就不在的一样是没有这个文件。
        return isNotFoundError(error) ? MISSING : {kind: "unreadable", cause: {errorCode: errorCodeOf(error)}};
    }
    try {
        const info = await handle.stat();
        if (!info.isFile()) return MISSING;
        return {kind: "file", bytes: head ? null : await handle.readFile(), size: info.size};
    } catch (error) {
        return {kind: "unreadable", cause: {errorCode: errorCodeOf(error)}};
    } finally {
        await handle.close();
    }
}

/** 系统错误的错误码（`EACCES` 这类）；拿不到时记错误的类型名。错误的说明里带着路径，不进日志。 */
function errorCodeOf(error: unknown): string {
    const code = (error as {code?: unknown} | undefined)?.code;
    if (typeof code === "string") return code;
    return error instanceof Error ? error.name : typeof error;
}

function notFound(): Response {
    return Response.json({code: "not_found"}, {status: 404, headers: WEB_HEADERS});
}

/**
 * 发一个读好的文件。`name` 是请求路径的最后一段：`Content-Type` 按它的扩展名定，不按解开链接后的真实文件名（`style.css`
 * 链到不带扩展名的带哈希文件时仍是样式表；类型错了又有 `nosniff`，浏览器会拒绝用它）。只看名字，不读文件；Bun 认不得的
 * 扩展名是 `application/octet-stream`。`HEAD` 只回头部：不依赖 Hono 在 `HEAD` 时丢掉响应体，这里本来就不带。
 */
function fileResponse(name: string, file: {readonly bytes: Uint8Array | null; readonly size: number}, cacheControl: string): Response {
    const type = Bun.file(name).type;
    const headers = new Headers({...WEB_HEADERS, "Content-Type": type, "Content-Length": String(file.size), "Cache-Control": cacheControl});
    return new Response(file.bytes, {status: 200, headers});
}

/** `root` 是产物目录的真实路径（配置校验时已解开链接，见 `config.ts` 的 `webDir`）。`log` 记文件读不出的诊断。 */
export function createWebHandler(root: string, log: Logger): WebHandler {
    const unreadable = (requestId: string, cause: Cause): Response => {
        log.warn("web.file_unreadable", "a file in the web directory could not be served", {requestId, ...cause});
        return notFound();
    };

    /** 找到、读好就是响应；没有这个文件为 undefined；有却读不出（含链接落到目录外）是 404，另记一条诊断。 */
    const serveFile = async (segments: readonly string[], cacheControl: string, head: boolean, requestId: string): Promise<Response | undefined> => {
        const found = await lookup(root, segments);
        if (found.kind === "missing") return undefined;
        if (found.kind === "unreadable") return unreadable(requestId, found.cause);
        const read = await readFile(found.path, head);
        if (read.kind === "missing") return undefined;
        if (read.kind === "unreadable") return unreadable(requestId, read.cause);
        return fileResponse(segments.at(-1)!, read, cacheControl);
    };

    return (request, requestId) => {
        if (request.method !== "GET" && request.method !== "HEAD") return undefined;
        const raw = rawPath(request.url).slice(1).split("/");
        // 第 2 步：只看第一段。
        const first = decodeSegment(raw[0]!);
        if (first !== null && RESERVED_FIRST_SEGMENTS.has(first)) return undefined;
        return (async () => {
            // 第 3 步。最后一段是空的（以 `/` 结尾）不算中间的空段；`/` 本身切出来就是一个空段。
            const decoded: string[] = [];
            for (const [position, segment] of raw.entries()) {
                const value = decodeSegment(segment);
                if (value === null || isUnsafeSegment(value)) return notFound();
                if (value === "" && position < raw.length - 1) return notFound();
                decoded.push(value);
            }
            const head = request.method === "HEAD";
            // `/assets` 本身不在 `/assets/` 下（它是目录，`lookup` 本来也找不到它）；只有其下的文件是带内容哈希的产物。
            const cacheControl = decoded.length > 1 && decoded[0] === HASHED_ASSETS_SEGMENT ? IMMUTABLE : NO_CACHE;
            const served = await serveFile(decoded, cacheControl, head, requestId);
            if (served !== undefined) return served;
            // 最后一段带扩展名的是在要一个文件（脚本、图片），没有就是没有；不带的当作前端路由的地址，交给 index.html。
            if (extname(decoded.at(-1)!) !== "") return notFound();
            // 配置校验收下的目录里一定有读得了的 `index.html`；这里没有它，是目录在运行中变了（链接只在启动时解开一次）。
            return (await serveFile(["index.html"], NO_CACHE, head, requestId)) ?? unreadable(requestId, {reason: "index_missing"});
        })();
    };
}
