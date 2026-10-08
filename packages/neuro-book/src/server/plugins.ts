/**
 * 后端插件装配（docs/adr/0026-plugin-definitions-as-constants.md）：清单里每个有后端入口的插件，在这里对应一份
 * 定义。普通插件的定义是常量，宿主的东西经宿主能力取得；只有宿主适配器（诊断、HTTP）是工厂，拿宿主上下文
 * （诊断存储、HTTP 准入、启动参数、本进程加载的清单）产出定义。
 */

import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import type {PluginDescriptor} from "nbook/manifest";
import {commandsPlugin} from "nbook/plugins/commands/shared/plugin";
import {createServerDiagnosticsPlugin} from "nbook/plugins/diagnostics/backend/plugin";
import type {HttpAdmission} from "nbook/plugins/http/backend/admission";
import {createHttpPlugin} from "nbook/plugins/http/backend/plugin";
import {projectsBackendPlugin} from "nbook/plugins/projects/backend/plugin";
import {storageBackendPlugin} from "nbook/plugins/storage/backend/plugin";
import type {BrowserBootstrap} from "nbook/shared/browser-bootstrap";

import {createBrowserBootstrapRoute} from "./browser-bootstrap";
import type {ServerConfig} from "./config";

export interface ServerPluginContext {
    readonly config: ServerConfig;
    /** 本进程加载的插件：产品清单，开发入口另加开发清单。引导接口按它列出浏览器插件。 */
    readonly manifest: ReadonlyArray<PluginDescriptor>;
    readonly store: DiagnosticsStore;
    readonly admission: HttpAdmission;
    readonly onListening: (url: string) => void;
    /** 内核 RPC 端口（已在监听）；引导接口据此告知浏览器。 */
    readonly rpc: BrowserBootstrap["rpc"];
}

export type ServerHostPluginFactory = (context: ServerPluginContext) => PluginDefinition;

/** 服务端的宿主适配器只有这两个；表的键收窄到它们，普通插件进不了这张表。 */
export type ServerHostPluginId = "nbook.diagnostics" | "nbook.http";

/** 普通插件：只能放定义常量。 */
export const serverPluginDefinitions: Readonly<Record<string, PluginDefinition>> = {
    "nbook.commands": commandsPlugin,
    "nbook.projects": projectsBackendPlugin,
    "nbook.storage": storageBackendPlugin,
};

/**
 * 宿主适配器：诊断要在内核启动之前就能记录，HTTP 的准入与监听结果参与宿主就绪和停机前的排空，所以随宿主装配、
 * 配置随工厂传入（ADR 0026 决策第 5 条）。新增一项要说明同样的启动或停机依赖。
 */
export const serverHostPlugins: Readonly<Record<ServerHostPluginId, ServerHostPluginFactory>> = {
    "nbook.diagnostics": (context) => createServerDiagnosticsPlugin({store: context.store, exporter: {directory: context.config.logDirectory}}),
    "nbook.http": (context) => createHttpPlugin({
        admission: context.admission,
        host: context.config.host,
        port: context.config.port,
        onListening: context.onListening,
        hostRoutes: [createBrowserBootstrapRoute(context.manifest, context.rpc)],
        staticRoot: context.config.webRoot,
    }),
};

/** 清单里一个有后端入口的插件对应的定义；两张表都没有时直接失败，不静默少装。 */
export function serverPlugin(id: string, context: ServerPluginContext): PluginDefinition {
    const definition = isServerHostPlugin(id) ? serverHostPlugins[id](context) : serverPluginDefinitions[id];
    if (definition === undefined) throw new Error(`清单中的插件 ${id} 没有后端入口定义`);
    if (definition.id !== id) throw new Error(`后端入口定义的插件 id ${definition.id} 与清单 ${id} 不一致`);
    return definition;
}

function isServerHostPlugin(id: string): id is ServerHostPluginId {
    return Object.hasOwn(serverHostPlugins, id);
}

/** 按清单装配后端插件。 */
export function manifestServerPlugins(context: ServerPluginContext): PluginDefinition[] {
    return context.manifest.filter((plugin) => plugin.locations.includes("server")).map((plugin) => serverPlugin(plugin.id, context));
}
