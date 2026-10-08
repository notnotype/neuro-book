/**
 * 项目宿主的插件装配：清单里每个有 `project` 入口的插件，在这里对应一份定义。普通插件的定义是常量，项目目录经
 * 宿主能力 `currentProjectKey` 取得；只有诊断是宿主适配器的工厂（docs/adr/0026-plugin-definitions-as-constants.md）。
 * 与 `src/server/plugins.ts` 对称。
 */

import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import type {PluginDescriptor} from "nbook/manifest";
import {createServerDiagnosticsPlugin} from "nbook/plugins/diagnostics/backend/plugin";
import {storageBackendPlugin} from "nbook/plugins/storage/backend/plugin";

import type {ProjectConfig} from "./config";

export interface ProjectPluginContext {
    readonly config: ProjectConfig;
    readonly manifest: ReadonlyArray<PluginDescriptor>;
    readonly store: DiagnosticsStore;
}

export type ProjectHostPluginFactory = (context: ProjectPluginContext) => PluginDefinition;

/** 普通插件：只能放定义常量。 */
export const projectPluginDefinitions: Readonly<Record<string, PluginDefinition>> = {
    "nbook.storage": storageBackendPlugin,
};

/** 宿主适配器：诊断要在内核启动之前就能记录（ADR 0026 决策第 5 条）。 */
export const projectHostPlugins: Readonly<Record<string, ProjectHostPluginFactory>> = {
    "nbook.diagnostics": (context) => createServerDiagnosticsPlugin({store: context.store, exporter: {directory: context.config.logDirectory}, location: "project"}),
};

/** 按清单装配项目入口；清单写了 `project` 入口而两张表都没有时直接失败，不静默少装。 */
export function manifestProjectPlugins(context: ProjectPluginContext): PluginDefinition[] {
    return context.manifest
        .filter((plugin) => plugin.locations.includes("project"))
        .map((plugin) => {
            const factory = projectHostPlugins[plugin.id];
            const definition = factory === undefined ? projectPluginDefinitions[plugin.id] : factory(context);
            if (definition === undefined) throw new Error(`清单中的插件 ${plugin.id} 没有项目入口定义`);
            if (definition.id !== plugin.id) throw new Error(`项目入口定义的插件 id ${definition.id} 与清单 ${plugin.id} 不一致`);
            return definition;
        });
}
