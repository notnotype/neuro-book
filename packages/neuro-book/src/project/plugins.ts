/**
 * 项目宿主的插件装配：清单里每个有 `project` 入口的插件，在这里对应一个工厂；工厂拿到项目宿主给的配置
 * （诊断存储、启动参数）后产出插件定义。与 `src/server/plugins.ts` 对称。
 */

import {join} from "node:path";

import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import type {PluginDescriptor} from "nbook/manifest";
import {createServerDiagnosticsPlugin} from "nbook/plugins/diagnostics/server/plugin";
import {createStorageServerPlugin} from "nbook/plugins/storage/server/plugin";

import type {ProjectConfig} from "./config";

export interface ProjectPluginContext {
    readonly config: ProjectConfig;
    readonly manifest: ReadonlyArray<PluginDescriptor>;
    readonly store: DiagnosticsStore;
}

export type ProjectPluginFactory = (context: ProjectPluginContext) => PluginDefinition;

export const projectPluginFactories: Readonly<Record<string, ProjectPluginFactory>> = {
    "nbook.diagnostics": (context) => createServerDiagnosticsPlugin({store: context.store, exporter: {directory: context.config.logDirectory}, location: "project"}),
    "nbook.storage": (context) => createStorageServerPlugin({location: "project", path: join(context.config.root, ".nbook", "storage.sqlite")}),
};

/** 按清单装配项目入口；清单写了 `project` 入口而这里没有工厂时直接失败，不静默少装。 */
export function manifestProjectPlugins(context: ProjectPluginContext): PluginDefinition[] {
    return context.manifest
        .filter((plugin) => plugin.locations.includes("project"))
        .map((plugin) => {
            const factory = projectPluginFactories[plugin.id];
            if (factory === undefined) throw new Error(`清单中的插件 ${plugin.id} 没有项目入口工厂`);
            const definition = factory(context);
            if (definition.id !== plugin.id) throw new Error(`项目入口工厂产出的插件 id ${definition.id} 与清单 ${plugin.id} 不一致`);
            return definition;
        });
}
