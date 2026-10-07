/**
 * 后端插件装配：清单里每个有后端入口的插件，在这里对应一个工厂；工厂拿到宿主提供的依赖
 * （诊断存储、HTTP 准入、启动参数、本进程加载的清单）后产出插件定义。
 */

import {join} from "node:path";

import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {PluginDescriptor} from "nbook/manifest";
import {createCommandsPlugin} from "nbook/plugins/commands/shared/plugin";
import {createServerDiagnosticsPlugin} from "nbook/plugins/diagnostics/server/plugin";
import type {HttpAdmission} from "nbook/plugins/http/server/admission";
import {createHttpPlugin} from "nbook/plugins/http/server/plugin";
import {createProjectsServerPlugin} from "nbook/plugins/projects/server/plugin";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {createStorageServerPlugin} from "nbook/plugins/storage/server/plugin";
import type {BrowserBootstrap} from "nbook/shared/browser-bootstrap";
import type {ProjectsService} from "nbook/shared/projects";

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
    /** 宿主能力：项目管理（docs/specs/runtime/projects.md 输出第 8 条）；需要它的插件在入口依赖里声明。 */
    readonly projects: ServiceKey<ProjectsService>;
}

export type ServerPluginFactory = (context: ServerPluginContext) => PluginDefinition;

export const serverPluginFactories: Readonly<Record<string, ServerPluginFactory>> = {
    "nbook.diagnostics": (context) => createServerDiagnosticsPlugin({store: context.store, exporter: {directory: context.config.logDirectory}}),
    "nbook.http": (context) => createHttpPlugin({
        admission: context.admission,
        host: context.config.host,
        port: context.config.port,
        onListening: context.onListening,
        hostRoutes: [createBrowserBootstrapRoute(context.manifest, context.rpc)],
        staticRoot: context.config.webRoot,
    }),
    "nbook.commands": () => createCommandsPlugin("server"),
    "nbook.projects": (context) => createProjectsServerPlugin({projects: context.projects}),
    "nbook.storage": (context) => createStorageServerPlugin({location: "server", storage: storageKey, path: join(context.config.stateRoot, "storage", "user.sqlite")}),
};

/** 按清单装配后端插件；清单写了后端入口而这里没有工厂时直接失败，不静默少装。 */
export function manifestServerPlugins(context: ServerPluginContext): PluginDefinition[] {
    return context.manifest
        .filter((plugin) => plugin.locations.includes("server"))
        .map((plugin) => {
            const factory = serverPluginFactories[plugin.id];
            if (factory === undefined) throw new Error(`清单中的插件 ${plugin.id} 没有后端入口工厂`);
            const definition = factory(context);
            if (definition.id !== plugin.id) throw new Error(`后端入口工厂产出的插件 id ${definition.id} 与清单 ${plugin.id} 不一致`);
            return definition;
        });
}
