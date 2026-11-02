/**
 * 项目宿主的插件装配：清单里每个有 `project` 入口的插件，在这里对应一份定义。普通插件的定义是常量，项目目录经
 * 宿主能力 `currentProjectKey` 取得；只有诊断是宿主适配器的工厂（docs/adr/0026-plugin-definitions-as-constants.md）。
 * 与 `src/server/plugins.ts` 对称。
 */

import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import type {InstalledPlugin} from "nbook/plugin-platform/backend/installed";
import {serverHostModules} from "nbook/backend/plugin-host-modules";
import {canonProjectPlugin} from "nbook/plugins/canon/backend/plugin";
import {thirdPartyDefinitionsAt} from "nbook/plugin-platform/backend/loader";
import {NEUROBOOK_PROFILE} from "nbook/plugin-platform-profile";
import {definitionAt, pluginsAt} from "nbook/manifest";
import type {PluginDescriptor} from "nbook/manifest";
import {createServerDiagnosticsPlugin} from "nbook/plugins/diagnostics/backend/plugin";
import {filesBackendPlugin} from "nbook/plugins/files/backend/plugin";
import {markdownProjectPlugin} from "nbook/plugins/markdown/shared/plugin";
import {projectsProjectPlugin} from "nbook/plugins/projects/project/plugin";
import {settingsBackendPlugin} from "nbook/plugins/settings/backend/plugin";
import {statePlugin} from "nbook/plugins/state/shared/plugin";
import {storageBackendPlugin} from "nbook/plugins/storage/backend/plugin";

import type {ProjectConfig} from "./config";

export interface ProjectPluginContext {
    readonly config: ProjectConfig;
    readonly manifest: ReadonlyArray<PluginDescriptor>;
    /**
     * 服务端本次启动登记的第三方插件的安装信息（IPC 的 `plugins` 消息）：子进程不自己读登记表，同一次服务端运行中先后打开的
     * 作品看到同一个集合。清单在登记时校验（`thirdPartyDefinitionsAt`）。
     */
    readonly installed: ReadonlyArray<InstalledPlugin>;
    readonly store: DiagnosticsStore;
}

export type ProjectHostPluginFactory = (context: ProjectPluginContext) => PluginDefinition;

/** 项目宿主的宿主适配器只有诊断；表的键收窄到它，普通插件进不了这张表。 */
export type ProjectHostPluginId = "runtime.diagnostics";

/** 普通插件：只能放定义常量。 */
export const projectPluginDefinitions: Readonly<Record<string, PluginDefinition>> = {
    "nbook.state": statePlugin,
    "nbook.storage": storageBackendPlugin,
    "nbook.settings": settingsBackendPlugin,
    "nbook.files": filesBackendPlugin,
    "nbook.markdown": markdownProjectPlugin,
    "nbook.projects": projectsProjectPlugin,
    "nbook.canon": canonProjectPlugin,
};

/** 宿主适配器：诊断要在内核启动之前就能记录（ADR 0026 决策第 5 条）。 */
export const projectHostPlugins: Readonly<Record<ProjectHostPluginId, ProjectHostPluginFactory>> = {
    "runtime.diagnostics": (context) => createServerDiagnosticsPlugin({store: context.store, exporter: {directory: context.config.logDirectory}, location: "project"}),
};

/** 按清单装配项目实例的插件：有项目入口的，加上只有顶层声明式贡献的；有项目入口而两张表都没有时直接失败。 */
export function manifestProjectPlugins(context: ProjectPluginContext): PluginDefinition[] {
    const builtin = pluginsAt("project", context.manifest).map((plugin) => {
        if (!plugin.locations.includes("project")) return definitionAt("project", plugin, undefined);
        return definitionAt("project", plugin, plugin.id === "runtime.diagnostics" ? projectHostPlugins[plugin.id](context) : projectPluginDefinitions[plugin.id]);
    });
    // 第三方插件按清单登记，入口激活时装载代码。
    return [...builtin, ...thirdPartyDefinitionsAt("project", context.installed, builtin, (input) => void context.store.record(input), {profile: NEUROBOOK_PROFILE, hostModules: serverHostModules})];
}
