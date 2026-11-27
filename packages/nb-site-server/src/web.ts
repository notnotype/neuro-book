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
 * 2. 取路径的原文（不经 `URL` 再解析一次），按 `/` 切段、每段解码一次。第一段是不回退的前缀之一时不归这里管，原样回到入口的
 *    404，与没有网页时逐字相同。
 * 3. 解码后的某一段是 `.`、`..`，或含 `/`、`\`、空字节的，回 404：它们只能来自编码过的写法，正常的页面地址里没有。
 * 4. 拼出路径后取真实路径（解开符号链接）；不在产物目录里的回 404，不论有没有扩展名。是普通文件才发，目录当作没有这个文件。
 */

import {realpath, stat} from "node:fs/promises";
import {extname, join, relative, sep} from "node:path";

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
 * 回 HTML 时的内容安全策略，取值与理由见 w00037 t10 计划 3.8：`style-src` 要 `'unsafe-inline'`（nb-ui 的主题插内联样式、
 * ECharts 的提示框带 `style` 属性）；Vite 的产物没有内联脚本，`script-src` 只许 `'self'`。
 */
const CONTENT_SECURITY_POLICY =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

/** 每个网页响应（文件、回退与这里回的 404）都带。 */
const WEB_HEADERS: Readonly<Record<string, string>> = {"X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin"};

/**
 * 处理一个模块都没接的站点请求。不归网页管（不是 `GET`、`HEAD`，或落在不回退的前缀下）时同步返回 undefined，调用方照旧回 404；
 * 否则返回这个请求的响应，调用方据此把日志的 `module` 记成 `web`。
 */
export type WebHandler = (request: Request) => Promise<Response> | undefined;

/** 路径的原文：协议与主机之后、查询串与片段之前。主机名读不出的请求在入口就回了 400，到这里的 `url` 都是绝对地址。 */
function rawPath(url: string): string {
    const start = url.indexOf("/", url.indexOf("://") + 3);
    if (start < 0) return "/";
    const end = url.slice(start).search(/[?#]/u);
    return end < 0 ? url.slice(start) : url.slice(start, start + end);
}

/** 逐段解码；某一段的编码不合法时为 null。 */
function decodeSegments(path: string): string[] | null {
    try {
        return path.slice(1).split("/").map(decodeURIComponent);
    } catch {
        // `URIError`：`%` 后面不是两位十六进制，或解出来不是合法的 UTF-8。这样的地址不对应任何文件。
        return null;
    }
}

/** 第 3 步：只能来自编码过的写法、拼路径时会改变层级或截断路径的段。 */
function isUnsafeSegment(segment: string): boolean {
    return segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\") || segment.includes("\0");
}

function notFound(): Response {
    return Response.json({code: "not_found"}, {status: 404, headers: WEB_HEADERS});
}

type Lookup = {readonly kind: "file"; readonly path: string; readonly size: number} | {readonly kind: "missing"} | {readonly kind: "outside"};

/** 第 4 步：`root` 是产物目录的真实路径。 */
async function lookup(root: string, segments: readonly string[]): Promise<Lookup> {
    let real: string;
    try {
        real = await realpath(join(root, ...segments));
    } catch {
        // 不存在、中间一段不是目录、链接指向不存在之处、没有权限：都当作没有这个文件，交给回退的规则。
        return {kind: "missing"};
    }
    const inside = relative(root, real);
    if (inside === ".." || inside.startsWith(`..${sep}`)) return {kind: "outside"};
    try {
        const info = await stat(real);
        return info.isFile() ? {kind: "file", path: real, size: info.size} : {kind: "missing"};
    } catch {
        // realpath 之后到 stat 之间文件被删掉了。
        return {kind: "missing"};
    }
}

/** 发一个文件。`HEAD` 只回头部：不依赖 Hono 在 `HEAD` 时丢掉响应体，这里本来就不带。 */
function fileResponse(file: {readonly path: string; readonly size: number}, cacheControl: string, head: boolean): Response {
    const body = Bun.file(file.path);
    // 按扩展名定；Bun 认不得的扩展名是 `application/octet-stream`。
    const type = body.type;
    const headers = new Headers({...WEB_HEADERS, "Content-Type": type, "Content-Length": String(file.size), "Cache-Control": cacheControl});
    if (type.startsWith("text/html")) headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    return new Response(head ? null : body, {status: 200, headers});
}

/** `root` 是产物目录的真实路径（配置校验时已解开链接，见 `config.ts` 的 `webDir`）。 */
export function createWebHandler(root: string): WebHandler {
    const index = join(root, "index.html");
    return (request) => {
        if (request.method !== "GET" && request.method !== "HEAD") return undefined;
        const segments = decodeSegments(rawPath(request.url));
        // 第一段解码失败的地址不在任何前缀下，照网页的规则回 404。
        if (segments !== null && RESERVED_FIRST_SEGMENTS.has(segments[0]!)) return undefined;
        return (async () => {
            if (segments === null || segments.some(isUnsafeSegment)) return notFound();
            const head = request.method === "HEAD";
            const found = await lookup(root, segments);
            if (found.kind === "outside") return notFound();
            if (found.kind === "file") return fileResponse(found, segments[0] === HASHED_ASSETS_SEGMENT && segments.length > 1 ? IMMUTABLE : NO_CACHE, head);
            // 最后一段带扩展名的是在要一个文件（脚本、图片），没有就是没有；不带的当作前端路由的地址，交给 index.html。
            if (extname(segments.at(-1)!) !== "") return notFound();
            const fallback = await lookup(root, ["index.html"]);
            return fallback.kind === "file" ? fileResponse(fallback, NO_CACHE, head) : notFound();
        })();
    };
}
