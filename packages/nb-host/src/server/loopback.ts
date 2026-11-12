/**
 * 只许在回环地址上监听、额外放行的页面来源也只能在回环地址上（docs/specs/runtime/server-host.md 的“输入与前置条件”）。
 * 鉴权插件还没有，这是不让局域网里的别人连上来的唯一一道：应用读配置时校验一次，监听之前（`startRpcListener`、端口试探）
 * 再校验一次，这样漏了配置校验的应用也监听不到非回环地址上。鉴权插件上线时在这里加放行条件。
 *
 * 两个集合的写法不同、不能合并：监听地址按 `Bun.serve` 的 `hostname` 写（IPv6 不带方括号），来源按 `URL.hostname` 写
 * （IPv6 带方括号）。合成一个，`::1` 的监听与 `Host: [::1]` 的请求必有一边被误拒。
 */

/** 监听地址的写法。 */
export const LOOPBACK_BIND_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "::1", "localhost"]);
/** `URL.hostname` 的写法：IPv6 带方括号。 */
export const LOOPBACK_URL_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

export type HostConfigErrorCode = "non-loopback-host" | "invalid-origin";

/** 监听地址或来源不在回环上。`message` 给人看，程序按 `code` 分支。 */
export class HostConfigError extends Error {
    readonly code: HostConfigErrorCode;

    constructor(code: HostConfigErrorCode, message: string) {
        super(message);
        this.name = "HostConfigError";
        this.code = code;
    }
}

/** 不是回环地址就抛 `non-loopback-host`。`label` 是说明来源的写法，进消息原文（应用传它的环境变量与取值，例如 `ACME_HOST=127.0.0.2`）。 */
export function assertLoopbackHost(host: string, label: string): void {
    if (!LOOPBACK_BIND_HOSTS.has(host)) throw new HostConfigError("non-loopback-host", `未加载鉴权插件时只允许监听回环地址，收到 ${label}`);
}

/**
 * 逗号分隔的页面来源，返回规范化的来源（`URL.origin`）。每项必须是回环主机上的 `http` 来源，不带用户名、路径、查询与片段；
 * 不合就抛 `invalid-origin`。`label` 是这串值的名字（应用传它的环境变量名）。没给或空串为空列表。
 */
export function parseAllowedOrigins(value: string | undefined, label: string): string[] {
    const origins: string[] = [];
    for (const item of (value ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
        let url: URL;
        try {
            url = new URL(item);
        } catch {
            throw new HostConfigError("invalid-origin", `${label} 里的 ${item} 不是 URL`);
        }
        if (!isLoopbackHttpOrigin(url)) {
            throw new HostConfigError("invalid-origin", `未加载鉴权插件时 ${label} 只能列回环地址上的 http 来源（例如 http://127.0.0.1:3000），收到 ${item}`);
        }
        origins.push(url.origin);
    }
    return origins;
}

/** 已解析好的来源再核一次（监听之前的第二道）；不合就抛 `invalid-origin`。 */
export function assertLoopbackOrigins(origins: ReadonlyArray<string>, label: string): void {
    for (const origin of origins) {
        let url: URL | null;
        try {
            url = new URL(origin);
        } catch {
            url = null;
        }
        if (url === null || !isLoopbackHttpOrigin(url) || url.origin !== origin) {
            throw new HostConfigError("invalid-origin", `未加载鉴权插件时 ${label} 只能列回环地址上的 http 来源（例如 http://127.0.0.1:3000），收到 ${origin}`);
        }
    }
}

/**
 * 一个回环端口在三个回环别名上的页面来源：同一个本机页面可以从任一别名打开，Origin 随之不同。用于本进程 HTTP 端口
 * （RPC 端口的允许来源）与开发模式的页面服务。
 */
export function loopbackOrigins(pageUrl: string): string[] {
    const port = new URL(pageUrl).port;
    const suffix = port === "" ? "" : `:${port}`;
    return [...LOOPBACK_URL_HOSTS].map((host) => new URL(`http://${host}${suffix}`).origin);
}

function isLoopbackHttpOrigin(url: URL): boolean {
    return url.protocol === "http:" && LOOPBACK_URL_HOSTS.has(url.hostname) && url.username === "" && url.pathname === "/" && url.search === "" && url.hash === "";
}
