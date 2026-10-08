/**
 * 浏览器插件装配：产品清单里有浏览器入口的插件，在这里对应一份定义。与 `src/server/plugins.ts` 对称：普通插件的
 * 定义是常量，宿主的东西经宿主能力取得；只有诊断是宿主适配器的工厂（docs/adr/0026-plugin-definitions-as-constants.md）。
 * 清单写了浏览器入口而两张表都没有时，窗口以启动失败结束，不静默少装。
 */

import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {productPlugins} from "nbook/manifest";
import type {PluginDescriptor} from "nbook/manifest";
import {commandsPlugin} from "nbook/plugins/commands/shared/plugin";
import type {DiagnosticsConsole} from "nbook/plugins/diagnostics/web/console-exporter";
import {createBrowserDiagnosticsPlugin} from "nbook/plugins/diagnostics/web/plugin";
import {projectsBrowserPlugin} from "nbook/plugins/projects/web/plugin";
import {storageBrowserPlugin} from "nbook/plugins/storage/web/plugin";
import {workbenchBrowserPlugin} from "nbook/plugins/workbench/web/plugin";

export interface BrowserPluginContext {
    /** 本窗口运行实例的诊断存储。 */
    readonly store: DiagnosticsStore;
    readonly console: DiagnosticsConsole;
}

export type BrowserHostPluginFactory = (context: BrowserPluginContext) => PluginDefinition;

/** 浏览器的宿主适配器只有诊断；表的键收窄到它，普通插件进不了这张表。 */
export type BrowserHostPluginId = "nbook.diagnostics";

export function isBrowserHostPlugin(id: string): id is BrowserHostPluginId {
    return id === "nbook.diagnostics";
}

/** 普通插件：只能放定义常量。 */
export const browserPluginDefinitions: Readonly<Record<string, PluginDefinition>> = {
    "nbook.commands": commandsPlugin,
    "nbook.workbench": workbenchBrowserPlugin,
    "nbook.projects": projectsBrowserPlugin,
    "nbook.storage": storageBrowserPlugin,
};

/** 宿主适配器：诊断的存储在窗口运行实例建立之前就要能记录（ADR 0026 决策第 5 条）。 */
export const browserHostPlugins: Readonly<Record<BrowserHostPluginId, BrowserHostPluginFactory>> = {
    "nbook.diagnostics": (context) => createBrowserDiagnosticsPlugin({store: context.store, console: context.console}),
};

/** 本外壳构建进去的浏览器插件：清单中有浏览器运行位置的插件。 */
export const builtinBrowserPlugins: ReadonlyArray<PluginDescriptor> = productPlugins.filter((plugin) => plugin.locations.includes("browser"));
