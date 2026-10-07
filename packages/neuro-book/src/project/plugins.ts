/**
 * 项目宿主的插件装配：清单里每个有 `project` 入口的插件，在这里对应一个工厂；工厂拿到项目宿主提供的依赖
 * （诊断存储、启动参数、当前项目的服务键）后产出插件定义。与 `src/server/plugins.ts` 对称。
 */

import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {PluginDescriptor} from "nbook/manifest";
import {createServerDiagnosticsPlugin} from "nbook/plugins/diagnostics/server/plugin";

import type {ProjectConfig} from "./config";
import type {CurrentProject} from "./current-project";

export interface ProjectPluginContext {
    readonly config: ProjectConfig;
    readonly manifest: ReadonlyArray<PluginDescriptor>;
    readonly store: DiagnosticsStore;
    /** 当前项目的服务键：需要它的插件在依赖里声明。 */
    readonly currentProject: ServiceKey<CurrentProject>;
}

export type ProjectPluginFactory = (context: ProjectPluginContext) => PluginDefinition;

export const projectPluginFactories: Readonly<Record<string, ProjectPluginFactory>> = {
    "nbook.diagnostics": (context) => createServerDiagnosticsPlugin({store: context.store, exporter: {directory: context.config.logDirectory}, location: "project"}),
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
