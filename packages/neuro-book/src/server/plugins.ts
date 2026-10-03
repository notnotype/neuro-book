/**
 * 后端插件装配：产品清单里每个有后端入口的插件，在这里对应一个工厂；工厂拿到宿主提供的依赖
 * （诊断存储、HTTP 准入、启动参数）后产出插件定义。
 */

import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import {productPlugins} from "nbook/manifest";
import {createServerDiagnosticsPlugin} from "nbook/plugins/diagnostics/server/plugin";
import type {HttpAdmission} from "nbook/plugins/http/server/admission";
import {createHttpPlugin} from "nbook/plugins/http/server/plugin";

import {createBrowserBootstrapRoute} from "./browser-bootstrap";
import type {ServerConfig} from "./config";

export interface ServerPluginContext {
    readonly config: ServerConfig;
    readonly store: DiagnosticsStore;
    readonly admission: HttpAdmission;
    readonly onListening: (url: string) => void;
}

export type ServerPluginFactory = (context: ServerPluginContext) => PluginDefinition;

export const serverPluginFactories: Readonly<Record<string, ServerPluginFactory>> = {
    "nbook.diagnostics": (context) => createServerDiagnosticsPlugin({store: context.store, exporter: {directory: context.config.logDirectory}}),
    "nbook.http": (context) => createHttpPlugin({
        admission: context.admission,
        host: context.config.host,
        port: context.config.port,
        onListening: context.onListening,
        hostRoutes: [createBrowserBootstrapRoute(productPlugins)],
        staticRoot: context.config.webRoot,
    }),
};

/** 按产品清单装配后端插件；清单写了后端入口而这里没有工厂时直接失败，不静默少装。 */
export function productServerPlugins(context: ServerPluginContext): PluginDefinition[] {
    return productPlugins
        .filter((plugin) => plugin.locations.includes("server"))
        .map((plugin) => {
            const factory = serverPluginFactories[plugin.id];
            if (factory === undefined) throw new Error(`产品清单中的插件 ${plugin.id} 没有后端入口工厂`);
            const definition = factory(context);
            if (definition.id !== plugin.id) throw new Error(`后端入口工厂产出的插件 id ${definition.id} 与清单 ${plugin.id} 不一致`);
            return definition;
        });
}

/** 清单的服务键登记表：插件入口提供与依赖的全部键。 */
export function collectServiceKeys(plugins: ReadonlyArray<PluginDefinition>): ServiceKey<unknown>[] {
    const keys = new Set<ServiceKey<unknown>>();
    for (const plugin of plugins) {
        for (const entry of plugin.entries) {
            for (const key of entry.provides ?? []) keys.add(key);
            for (const dependency of entry.dependencies ?? []) keys.add(dependency.key);
        }
    }
    return [...keys];
}
