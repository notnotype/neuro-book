/**
 * 插件文件端点的请求处理（docs/specs/runtime/plugin-code-loading.md 输出 8）：浏览器经它取第三方插件的入口代码、样式与静态资源。
 * 应用把它挂到自己的 HTTP 路由上（挂载前缀是平台档案的 `filesMount`）。
 *
 * - 只服务本次启动登记的插件的当前版本目录，地址带内容摘要（`shared/plugin-files.ts`）；摘要不是当前的为 404。
 * - 逐段 `lstat`，不跟随符号链接：安装时已拒绝链接，这里遇到也按不存在处理。
 * - 响应带 `Cross-Origin-Resource-Policy: same-origin` 与 `nosniff`：别的网页不能用 `<script>` 跨源加载来探测装了哪些插件。
 *   认证尚未实现（Spec 的 401 是 planned），服务端只监听回环地址并核对 `Host`。
 */

import {lstat} from "node:fs/promises";
import {join} from "node:path";

import {errno} from "@notnotype/nb-file-lock";
import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import {catalogFile} from "@notnotype/nb-runtime/plugin-manifest";
import type {ManifestFormat} from "@notnotype/nb-runtime/plugin-manifest";

import {parsePluginCatalogPath, parsePluginFilePath} from "nbook/plugin-platform/shared/plugin-files";

import {manifestOfInstalled} from "./installed";
import type {InstalledPlugin} from "./installed";

const SECURITY_HEADERS = {"cross-origin-resource-policy": "same-origin", "x-content-type-options": "nosniff"} as const;

const FAILURE_CODES = {400: "bad-path", 404: "not-found", 500: "read-failed"} as const;

/** 路径本身的问题：请求的文件不在。其余的 `lstat` 错误（权限、文件描述符用完、I/O）是服务端自己的问题。 */
const MISSING_ERRNO: ReadonlySet<string> = new Set(["ENOENT", "ENOTDIR", "ENAMETOOLONG"]);

/** 失败的响应：与宿主 HTTP 接口同一种 JSON 形状（`{error: {code, message}}`），不缓存。 */
function failure(status: 400 | 404 | 500, message: string): Response {
    return Response.json({error: {code: FAILURE_CODES[status], message}}, {status, headers: {"cache-control": "no-store", ...SECURITY_HEADERS}});
}

/**
 * 版本目录里的一项（逐段核对，不跟随符号链接）：`kind` 是要的最后一段是普通文件还是目录。不存在、种类不对或经过链接时为
 * `missing`；`lstat` 因路径以外的原因失败时带上错误。插件文件端点与插件包查询（`packages.ts`）共用。
 */
export async function entryInside(root: string, segments: ReadonlyArray<string>, kind: "file" | "directory"): Promise<{readonly path: string} | "missing" | {readonly error: unknown}> {
    let path = root;
    for (const [index, segment] of segments.entries()) {
        path = join(path, segment);
        let info;
        try {
            info = await lstat(path);
        } catch (error) {
            if (MISSING_ERRNO.has(errno(error) ?? "")) return "missing";
            return {error};
        }
        if (info.isSymbolicLink()) return "missing";
        const last = index === segments.length - 1;
        // 中间的段都要是目录；最后一段按 `kind`。
        if (last && kind === "file" ? !info.isFile() : !info.isDirectory()) return "missing";
    }
    return {path};
}

/** 处理一次请求；`pathname` 是去掉挂载前缀之后的路径。 */
export function pluginFileHandler(installed: ReadonlyArray<InstalledPlugin>, record: (input: DiagnosticInput) => void): (pathname: string) => Promise<Response> {
    const byId = new Map(installed.map((plugin) => [plugin.id, plugin]));
    return async (pathname) => {
        const parsed = parsePluginFilePath(pathname);
        if (parsed === null) return failure(400, "插件文件的路径不合法");
        const {plugin, digest, segments} = parsed;
        const current = byId.get(plugin);
        if (current === undefined || current.digest !== digest) return failure(404, "没有这个插件文件：插件没有登记，或地址里的内容摘要不是当前的");
        const file = await entryInside(current.root, segments, "file");
        if (file === "missing") return failure(404, "没有这个插件文件");
        if ("error" in file) {
            record({level: "warn", event: "plugins.files.read-failed", message: `读不了插件 ${plugin} 的文件`, data: {plugin, path: segments.join("/")}, error: file.error});
            return failure(500, "读不了这个插件文件");
        }
        const body = Bun.file(file.path);
        return new Response(body, {headers: {"content-type": body.type, "cache-control": "public, max-age=31536000, immutable", ...SECURITY_HEADERS}});
    };
}

/**
 * 消息目录端点（docs/specs/runtime/plugin-code-loading.md 的目录端点）：只读清单 `l10n.locales` 列出的 `locales/<语言>.json`，
 * 原样返回，不执行插件代码、不检查内容（窗口用与安装相同的规则检查，坏了记为该插件的目录问题）。服务本次启动有效安装的全部
 * 插件，包括没有浏览器入口、不在浏览器登记的：它们的文字也要在窗口里显示。地址带版本目录的摘要，与插件文件端点同一种缓存。
 */
export function pluginCatalogHandler(installed: ReadonlyArray<InstalledPlugin>, format: ManifestFormat, record: (input: DiagnosticInput) => void): (pathname: string) => Promise<Response> {
    const served = new Map<string, {readonly plugin: InstalledPlugin; readonly locales: ReadonlySet<string>}>();
    for (const plugin of installed) {
        const read = manifestOfInstalled(plugin, format);
        if (!read.ok) {
            // 启动时已校验过；读不了说明两处规则不一致。不提供它的目录，窗口那边得到 404。
            record({level: "warn", event: "plugins.catalogs.manifest-unreadable", message: `插件 ${plugin.id} 的清单读不了，不提供它的消息目录`, data: {plugin: plugin.id, detail: read.detail}});
            continue;
        }
        if (read.manifest.l10n !== null) served.set(plugin.id, {plugin, locales: new Set(read.manifest.l10n.locales)});
    }
    return async (pathname) => {
        const parsed = parsePluginCatalogPath(pathname);
        if (parsed === null) return failure(400, "消息目录的路径不合法");
        const {plugin, digest, locale} = parsed;
        const current = served.get(plugin);
        if (current === undefined || current.plugin.digest !== digest) return failure(404, "没有这份消息目录：插件没有有效安装、没有目录，或地址里的内容摘要不是当前的");
        if (!current.locales.has(locale)) return failure(404, "没有这份消息目录：清单 l10n.locales 里没有这种语言");
        const file = await entryInside(current.plugin.root, catalogFile(locale).split("/"), "file");
        if (file === "missing") return failure(404, "没有这份消息目录");
        if ("error" in file) {
            record({level: "warn", event: "plugins.catalogs.read-failed", message: `读不了插件 ${plugin} 的消息目录`, data: {plugin, locale}, error: file.error});
            return failure(500, "读不了这份消息目录");
        }
        return new Response(Bun.file(file.path), {headers: {"content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=31536000, immutable", ...SECURITY_HEADERS}});
    };
}
