/**
 * `vite dev` 对着一个真实的 `nb-site serve` 开发（w00037 t10 计划 3.8 最后一段）：设了 `NB_SITE_DEV_API` 时，开发服务把 `/api` 与
 * `/.well-known` 转给那个进程；没设时不转，开发服务与原来一样（页面的接口请求落到开发服务自己，回 404）。
 *
 * 为什么要改 `Origin`：账号模块只收 `Origin` 等于站点地址（进程的 `NB_SITE_URL`）的写请求（`site/identity`），而开发页面的源是
 * `http://localhost:<端口>`。转发时把带着的 `Origin` 换成 `NB_SITE_URL` 的源；没带 `Origin` 的请求（GET 等）不加。`Host` 不改：
 * 进程按 `Host` 分站，不是统计写入口的主机名都归站点。
 *
 * Cookie 不改写：会话 Cookie 是 `__Host-` 前缀、带 `Secure`，Chrome 把 `http://localhost` 与 `http://127.0.0.1` 当作安全的源，照样存、
 * 照样带（B10 实测，Chrome 稳定版）；去掉 `Secure` 反而让浏览器拒收 `__Host-` 前缀的 Cookie。所以开发页面用这两个地址打开，
 * 不用局域网地址（那里不是安全的源，Cookie 存不下）。
 */

import type {ProxyOptions} from "vite";

/**
 * 转给真实进程的路径：账号与统计的接口、OpenID 的发现文档。写成以 `^` 开头的正则：Vite 把不带 `^` 的键当作字符串前缀，
 * `/api` 会连 `/apis…` 这样的页面路径一起转走。
 */
const DEV_API_PATHS = ["^/api(?:[/?]|$)", "^/\\.well-known(?:[/?]|$)"] as const;

/**
 * 按环境给出开发服务的 `server.proxy`；没设 `NB_SITE_DEV_API` 时为 undefined。设了却不是 http(s) 地址、或没有 `NB_SITE_URL` 时抛错：
 * 悄悄不转发，页面上看到的会是一串看不懂的 404。
 */
export function devApiProxy(env: Readonly<Record<string, string | undefined>>): Record<string, ProxyOptions> | undefined {
    const api = env.NB_SITE_DEV_API?.trim() ?? "";
    if (api === "") return undefined;
    const target = httpUrl("NB_SITE_DEV_API", api);
    const site = httpUrl("NB_SITE_URL", env.NB_SITE_URL?.trim() ?? "");
    const options: ProxyOptions = {
        target: target.origin,
        // 不改 `Host`（见文件头）。
        changeOrigin: false,
        configure: (proxy) => {
            proxy.on("proxyReq", (request) => {
                if (request.getHeader("origin") !== undefined) request.setHeader("origin", site.origin);
            });
        },
    };
    return Object.fromEntries(DEV_API_PATHS.map((path) => [path, options]));
}

function httpUrl(name: string, value: string): URL {
    if (value === "") throw new Error(`${name} must be set when NB_SITE_DEV_API is set (the site URL the nb-site process was started with)`);
    let url: URL;
    try {
        url = new URL(value);
    } catch (error) {
        throw new Error(`${name} is not a URL: ${value}`, {cause: error});
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${name} must be an http or https URL: ${value}`);
    return url;
}
