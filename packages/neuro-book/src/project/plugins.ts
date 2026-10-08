/**
 * 项目宿主的插件装配：清单里每个有 `project` 入口的插件，在这里对应一份定义。普通插件的定义是常量，项目目录经
 * 宿主能力 `currentProjectKey` 取得；只有诊断是宿主适配器的工厂（docs/adr/0026-plugin-definitions-as-constants.md）。
 * 与 `src/server/plugins.ts` 对称。
 */

import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {definitionAt, pluginsAt} from "nbook/manifest";
import type {PluginDescriptor} from "nbook/manifest";
import {createServerDiagnosticsPlugin} from "nbook/plugins/diagnostics/backend/plugin";
import {statePlugin} from "nbook/plugins/state/shared/plugin";
import {storageBackendPlugin} from "nbook/plugins/storage/backend/plugin";

import type {ProjectConfig} from "./config";

export interface ProjectPluginContext {
    readonly config: ProjectConfig;
    readonly manifest: ReadonlyArray<PluginDescriptor>;
    readonly store: DiagnosticsStore;
}

export type ProjectHostPluginFactory = (context: ProjectPluginContext) => PluginDefinition;

/** 项目宿主的宿主适配器只有诊断；表的键收窄到它，普通插件进不了这张表。 */
export type ProjectHostPluginId = "nbook.diagnostics";

/** 普通插件：只能放定义常量。 */
export const projectPluginDefinitions: Readonly<Record<string, PluginDefinition>> = {
    "nbook.state": statePlugin,
    "nbook.storage": storageBackendPlugin,
};

/** 宿主适配器：诊断要在内核启动之前就能记录（ADR 0026 决策第 5 条）。 */
export const projectHostPlugins: Readonly<Record<ProjectHostPluginId, ProjectHostPluginFactory>> = {
    "nbook.diagnostics": (context) => createServerDiagnosticsPlugin({store: context.store, exporter: {directory: context.config.logDirectory}, location: "project"}),
};

/** 按清单装配项目实例的插件：有项目入口的，加上只有顶层声明式贡献的；有项目入口而两张表都没有时直接失败。 */
export function manifestProjectPlugins(context: ProjectPluginContext): PluginDefinition[] {
    return pluginsAt("project", context.manifest).map((plugin) => {
        if (!plugin.locations.includes("project")) return definitionAt("project", plugin, undefined);
        return definitionAt("project", plugin, plugin.id === "nbook.diagnostics" ? projectHostPlugins[plugin.id](context) : projectPluginDefinitions[plugin.id]);
    });
}
