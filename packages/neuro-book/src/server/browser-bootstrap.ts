/**
 * 引导接口的后端实现：按产品清单列出在浏览器登记的插件（有浏览器入口的，加上只有顶层声明式贡献的），并告知内核
 * RPC 端口（runtime.browser-host 启动序列第 2 步）。请求带 `project`（地址栏的项目引用）时附上这部作品的显示名，
 * 窗口在连上服务端、打开项目之前就能显示书名。
 *
 * 内置插件只给 id 与版本：它们的定义随前端构建，窗口按 id 与版本核对。第三方插件不在构建里，另带清单（入口只留
 * 浏览器的）与插件文件 URL 的前缀，窗口据此在运行期登记、装载它们（docs/specs/runtime/browser-host.md 输出 2、4）。
 *
 * 消息目录索引另列（`catalogs`）：取自全部有效安装的第三方插件，不只是在浏览器登记的；窗口按它经目录端点取齐目录。
 *
 * 插件集合在进程生命期内不变（插件热插拔尚未实现），这部分在构造时算好。修订号由排序后的 `id@version`（第三方插件
 * 另加内容摘要）与目录索引得出，跨重启稳定；集合、任一版本、第三方插件的内容或目录变化时才变化。
 */

import {createHash} from "node:crypto";

import type {HostRoute} from "@notnotype/nb-host/server";

import {descriptorsOf, manifestOfInstalled} from "nbook/plugin-platform/backend/installed";
import type {InstalledPlugin} from "nbook/plugin-platform/backend/installed";
import {manifestFormat, NEUROBOOK_PROFILE} from "nbook/plugin-platform-profile";
import {pluginsAt} from "nbook/manifest";
import type {PluginDescriptor} from "nbook/manifest";
import {BROWSER_PROTOCOL_VERSION} from "nbook/shared/browser-bootstrap";
import type {BrowserBootstrap} from "nbook/shared/browser-bootstrap";
import {pluginCatalogsPrefix, pluginFilesPrefix} from "nbook/plugin-platform/shared/plugin-files";

/** 相对 `/api/runtime/` 的路径；完整路径见 `BROWSER_BOOTSTRAP_PATH`。 */
const ROUTE_PATH = "/browser-bootstrap";

/** 浏览器用得到的那部分清单：入口只留浏览器的；顶层声明、贡献点、合同与样式照旧。服务端已校验过原始内容。 */
function browserManifest(raw: unknown): unknown {
    const record = raw as {readonly entries?: Readonly<Record<string, {readonly location?: unknown}>>};
    const entries = Object.fromEntries(Object.entries(record.entries ?? {}).filter(([, entry]) => entry.location === "browser"));
    return {...(raw as object), entries};
}

/** 有效安装、写了 `l10n` 的第三方插件的目录索引，按 id 排序。清单读不了的跳过（与 `descriptorsOf` 相同，启动时已校验过）。 */
function catalogIndex(installed: ReadonlyArray<InstalledPlugin>): BrowserBootstrap["catalogs"] {
    return installed
        .flatMap((plugin) => {
            const read = manifestOfInstalled(plugin, manifestFormat);
            if (!read.ok || read.manifest.l10n === null) return [];
            const {source, locales} = read.manifest.l10n;
            return [{plugin: plugin.id, source, locales: [...locales], digest: plugin.digest, prefix: pluginCatalogsPrefix(NEUROBOOK_PROFILE.filesMount, plugin.id, plugin.digest)}];
        })
        .sort((left, right) => (left.plugin < right.plugin ? -1 : left.plugin > right.plugin ? 1 : 0));
}

export function browserBootstrap(builtin: ReadonlyArray<PluginDescriptor>, installed: ReadonlyArray<InstalledPlugin>, rpc: BrowserBootstrap["rpc"]): BrowserBootstrap {
    const byId = new Map(installed.map((plugin) => [plugin.id, plugin]));
    const third = pluginsAt("browser", descriptorsOf(installed, manifestFormat)).map(({id, version}) => {
        const plugin = byId.get(id);
        if (plugin === undefined) throw new Error(`第三方插件 ${id} 没有安装信息`);
        return {id, version, manifest: browserManifest(plugin.manifest), files: pluginFilesPrefix(NEUROBOOK_PROFILE.filesMount, id, plugin.digest), digest: plugin.digest};
    });
    const browser = [
        ...pluginsAt("browser", builtin).map(({id, version}) => ({id, version, digest: null as string | null})),
        ...third,
    ].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    const catalogs = catalogIndex(installed);
    const lines = [
        ...browser.map((plugin) => (plugin.digest === null ? `${plugin.id}@${plugin.version}` : `${plugin.id}@${plugin.version}#${plugin.digest}`)),
        ...catalogs.map((catalog) => `catalog:${catalog.plugin}#${catalog.digest}:${catalog.source}:${catalog.locales.join(",")}`),
    ];
    const revision = createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);
    const plugins: BrowserBootstrap["plugins"] = browser.map(({digest: _digest, ...plugin}) => plugin);
    return {protocolVersion: BROWSER_PROTOCOL_VERSION, revision, plugins, catalogs, rpc: {port: rpc.port, path: rpc.path}};
}

export function createBrowserBootstrapRoute(builtin: ReadonlyArray<PluginDescriptor>, installed: ReadonlyArray<InstalledPlugin>, rpc: BrowserBootstrap["rpc"], projectTitle: (reference: string) => Promise<string | null>): HostRoute {
    const body = browserBootstrap(builtin, installed, rpc);
    return {
        method: "GET",
        path: ROUTE_PATH,
        handle: async (request) => {
            const reference = new URL(request.url).searchParams.get("project");
            const title = reference === null || reference === "" ? null : await projectTitle(reference);
            // 页面与服务端版本对齐依赖每次都取到当前集合，不能被浏览器或代理缓存。
            return Response.json(title === null ? body : {...body, project: {title}}, {headers: {"cache-control": "no-store"}});
        },
    };
}
