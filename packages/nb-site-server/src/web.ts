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
 * 5. 发之前把整个文件读进内存：读不出（没有读权限、刚被删掉、I/O 错误）时还没交出响应，按没有这个文件回 404 并记一条诊断。
 *    交给 Bun 的惰性 `Bun.file` 时，真正的打开发生在 Hono 已经返回、入口已经按 200 记过日志之后，失败只能落到 `Bun.serve`
 *    的错误页（B8 实现审查第 5 条）。产物都是小文件（最大的看板块约 525 KB），整读的内存可以接受；产物里有了大文件
 *    （视频、大图）时要换成先打开、再按句柄流式发。整读之后 Bun 不再替这些响应处理 `Range`，单页应用的产物用不到它。
 */

import {open, realpath} from "node:fs/promises";
import {extname, join, relative, sep} from "node:path";

import type {Logger} from "./log";

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
 * `real` 是否在 `root` 里面（两者都是真实路径；`root` 本身也算）。配置校验判 `index.html` 时也用它（`config.ts`），
 * 与发文件时是同一条规则：校验收下的 `index.html`，回退一定发得出。
 */
export function isInsideDir(root: string, real: string): boolean {
    const inside = relative(root, real);
    return inside !== ".." && !inside.startsWith(`..${sep}`);
}

type Lookup = {readonly kind: "file"; readonly path: string} | {readonly kind: "missing"} | {readonly kind: "outside"};

/** 第 4 步：`root` 是产物目录的真实路径。 */
async function lookup(root: string, segments: readonly string[]): Promise<Lookup> {
    // 以 `/` 结尾：按 URL 的语义是目录，不对应文件（`/assets/app.js/` 不发 `app.js`）。
    if (segments.at(-1) === "") return {kind: "missing"};
    let real: string;
    try {
        real = await realpath(join(root, ...segments));
    } catch {
        // 不存在、中间一段不是目录、链接指向不存在之处、没有权限：都当作没有这个文件，交给回退的规则。
        return {kind: "missing"};
    }
    return isInsideDir(root, real) ? {kind: "file", path: real} : {kind: "outside"};
}

type Read = {readonly kind: "file"; readonly bytes: Uint8Array | null; readonly size: number} | {readonly kind: "missing"} | {readonly kind: "unreadable"; readonly errorCode: string};

/**
 * 第 5 步：打开、确认是普通文件、读完（`HEAD` 不读内容，只要大小），都在交出响应之前。目录与别的非普通文件当作没有这个文件；
 * 打开或读的时候系统报错是 `unreadable`，调用方同样回 404，另记一条诊断。
 */
async function readFile(path: string, head: boolean): Promise<Read> {
    let handle;
    try {
        handle = await open(path, "r");
    } catch (error) {
        // realpath 之后到这里之间被删掉的，与没有读权限的一样记下来：都是“产物目录里有、却发不出”。
        return {kind: "unreadable", errorCode: errorCodeOf(error)};
    }
    try {
        const info = await handle.stat();
        if (!info.isFile()) return {kind: "missing"};
        return {kind: "file", bytes: head ? null : await handle.readFile(), size: info.size};
    } catch (error) {
        return {kind: "unreadable", errorCode: errorCodeOf(error)};
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

/** 发一个读好的文件。`HEAD` 只回头部：不依赖 Hono 在 `HEAD` 时丢掉响应体，这里本来就不带。 */
function fileResponse(path: string, file: {readonly bytes: Uint8Array | null; readonly size: number}, cacheControl: string): Response {
    // 按扩展名定（只看名字，不读文件）；Bun 认不得的扩展名是 `application/octet-stream`。
    const type = Bun.file(path).type;
    const headers = new Headers({...WEB_HEADERS, "Content-Type": type, "Content-Length": String(file.size), "Cache-Control": cacheControl});
    return new Response(file.bytes, {status: 200, headers});
}

/** `root` 是产物目录的真实路径（配置校验时已解开链接，见 `config.ts` 的 `webDir`）。`log` 记文件读不出的诊断。 */
export function createWebHandler(root: string, log: Logger): WebHandler {
    /** 找到、读好就是响应；没有这个文件为 undefined；落到目录外或读不出是 404。 */
    const serveFile = async (segments: readonly string[], cacheControl: string, head: boolean, requestId: string): Promise<Response | undefined> => {
        const found = await lookup(root, segments);
        if (found.kind === "outside") return notFound();
        if (found.kind === "missing") return undefined;
        const read = await readFile(found.path, head);
        if (read.kind === "missing") return undefined;
        if (read.kind === "unreadable") {
            log.warn("web.file_unreadable", "a file in the web directory could not be read", {requestId, errorCode: read.errorCode});
            return notFound();
        }
        return fileResponse(found.path, read, cacheControl);
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
            return (await serveFile(["index.html"], NO_CACHE, head, requestId)) ?? notFound();
        })();
    };
}
