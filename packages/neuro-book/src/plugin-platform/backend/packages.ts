/**
 * 插件包查询（docs/specs/runtime/plugin-code-loading.md 的“插件包里的目录”）：服务端宿主交给内置插件，按插件 id 找本次启动
 * 登记的第三方插件当前版本目录里的子目录。插件代码拿不到自己的安装目录；接收“声明一个目录”这类贡献的内置插件
 * （例如 Agent 插件的 `agent.skills`）经它取真实路径，安装布局只有平台知道。
 *
 * 一次运行里插件集合与版本目录不变（plugin-install.md：安装、启停、卸载在下一次启动生效），所以按启动时的 `installed` 建一次。
 * 安全规则与插件文件端点相同：只在版本目录里、逐段 `lstat`、不跟随链接。
 */

import {realpath} from "node:fs/promises";

import type {ManifestFormat} from "@notnotype/nb-runtime/plugin-manifest";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import {manifestOfInstalled} from "./installed";
import type {InstalledPlugin} from "./installed";
import {entryInside} from "./plugin-files";

export interface PluginPackages {
    /**
     * 插件包里的目录。`path` 是相对版本目录的路径，用 `/` 分段。是目录、在版本目录里、各段都不是链接时交回真实路径；不是本次
     * 启动的第三方插件（含内置插件）、写法不对、不存在或读不了时交回 null。
     */
    directory(plugin: string, path: string): Promise<string | null>;
    /** 插件包里的普通文件，规则同 `directory`：是普通文件、在版本目录里、各段都不是链接时交回真实路径，否则 null。 */
    file(plugin: string, path: string): Promise<string | null>;
    /** 清单的 `displayName`；没写或不是本次启动的第三方插件时为 null。 */
    title(plugin: string): string | null;
}

/** 服务 id 不带应用名：它属于通用的插件平台。 */
export const pluginPackagesKey: ServiceKey<PluginPackages> = defineServiceKey<PluginPackages>("plugin-platform/packages");

/** 只认 `/` 分段的相对路径：没有空段、`.`、`..`，不以 `/` 开头，没有反斜杠与冒号（协议、盘符）。 */
function segmentsOf(path: string): readonly string[] | null {
    if (path.startsWith("/") || path.includes("\\") || path.includes(":")) return null;
    const segments = path.split("/");
    return segments.some((segment) => segment === "" || segment === "." || segment === "..") ? null : segments;
}

export function createPluginPackages(installed: ReadonlyArray<InstalledPlugin>, format: ManifestFormat): PluginPackages {
    const byId = new Map(installed.map((plugin) => [plugin.id, plugin]));
    const find = async (plugin: string, path: string, kind: "file" | "directory"): Promise<string | null> => {
        const current = byId.get(plugin);
        const segments = segmentsOf(path);
        if (current === undefined || segments === null) return null;
        // 版本目录本身取一次真实路径（状态根可以经过链接，装载器也这样取）；它下面的各段不许是链接，拼出来的就是真实路径。
        const root = await realpath(current.root).catch(() => null);
        if (root === null) return null;
        const found = await entryInside(root, segments, kind);
        return typeof found === "object" && "path" in found ? found.path : null;
    };
    return {
        directory: (plugin, path) => find(plugin, path, "directory"),
        file: (plugin, path) => find(plugin, path, "file"),
        title: (plugin) => {
            const current = byId.get(plugin);
            if (current === undefined) return null;
            const read = manifestOfInstalled(current, format);
            return read.ok ? read.manifest.displayName : null;
        },
    };
}
