/**
 * 把插件文件端点与消息目录端点（`plugin-platform/backend/plugin-files.ts`）挂到 `nbook.http` 的宿主路由上。分发器转交
 * 宿主路由时已去掉挂载前缀 `/api/runtime`（`dispatch.ts` 的 `forwardedRequest`），与平台档案的 `filesMount` 一致。
 */

import type {HostRoute} from "@notnotype/nb-host/server";
import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";

import type {InstalledPlugin} from "nbook/plugin-platform/backend/installed";
import {pluginCatalogHandler, pluginFileHandler} from "nbook/plugin-platform/backend/plugin-files";
import {manifestFormat} from "nbook/plugin-platform-profile";
import {PLUGIN_CATALOGS_ROUTE, PLUGIN_FILES_ROUTE} from "nbook/plugin-platform/shared/plugin-files";

export function createPluginFilesRoute(installed: ReadonlyArray<InstalledPlugin>, record: (input: DiagnosticInput) => void): HostRoute {
    const handle = pluginFileHandler(installed, record);
    return {method: "GET", path: PLUGIN_FILES_ROUTE, handle: (request) => handle(new URL(request.url).pathname)};
}

/** 消息目录端点（同一个挂载前缀）：服务本次启动有效安装的全部插件的目录。 */
export function createPluginCatalogsRoute(installed: ReadonlyArray<InstalledPlugin>, record: (input: DiagnosticInput) => void): HostRoute {
    const handle = pluginCatalogHandler(installed, manifestFormat, record);
    return {method: "GET", path: PLUGIN_CATALOGS_ROUTE, handle: (request) => handle(new URL(request.url).pathname)};
}
