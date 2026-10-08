/**
 * 引导接口的后端实现：按产品清单列出有浏览器入口的插件，并告知内核 RPC 端口（runtime.browser-host 启动序列第 2 步）。
 *
 * 插件集合在进程生命期内不变（插件热插拔尚未实现），响应在构造时算好。修订号由排序后的
 * `id@version` 得出，跨重启稳定；集合或任一版本变化时才变化。
 */

import {createHash} from "node:crypto";

import type {PluginDescriptor} from "nbook/manifest";
import type {HostRoute} from "nbook/plugins/http/backend/plugin";
import {BROWSER_PROTOCOL_VERSION} from "nbook/shared/browser-bootstrap";
import type {BrowserBootstrap} from "nbook/shared/browser-bootstrap";

/** 相对 `/api/runtime/` 的路径；完整路径见 `BROWSER_BOOTSTRAP_PATH`。 */
const ROUTE_PATH = "/browser-bootstrap";

export function browserBootstrap(plugins: ReadonlyArray<PluginDescriptor>, rpc: BrowserBootstrap["rpc"]): BrowserBootstrap {
    const browser = plugins
        .filter((plugin) => plugin.locations.includes("browser"))
        .map(({id, version}) => ({id, version}))
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    const revision = createHash("sha256").update(browser.map((plugin) => `${plugin.id}@${plugin.version}`).join("\n")).digest("hex").slice(0, 16);
    return {protocolVersion: BROWSER_PROTOCOL_VERSION, revision, plugins: browser, rpc: {port: rpc.port, path: rpc.path}};
}

export function createBrowserBootstrapRoute(plugins: ReadonlyArray<PluginDescriptor>, rpc: BrowserBootstrap["rpc"]): HostRoute {
    const body = browserBootstrap(plugins, rpc);
    // 页面与服务端版本对齐依赖每次都取到当前集合，不能被浏览器或代理缓存。
    return {method: "GET", path: ROUTE_PATH, handle: () => Response.json(body, {headers: {"cache-control": "no-store"}})};
}
