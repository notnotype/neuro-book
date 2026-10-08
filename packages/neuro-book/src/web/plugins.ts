/**
 * 浏览器插件装配：产品清单里有浏览器入口的插件，在这里对应一个工厂。与 `src/server/plugins.ts` 对称；
 * 清单写了浏览器入口而这里没有工厂时直接失败，不静默少装。
 */

import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {productPlugins} from "nbook/manifest";
import type {PluginDescriptor} from "nbook/manifest";
import {createCommandsPlugin} from "nbook/plugins/commands/shared/plugin";
import type {DiagnosticsConsole} from "nbook/plugins/diagnostics/web/console-exporter";
import {createBrowserDiagnosticsPlugin} from "nbook/plugins/diagnostics/web/plugin";
import {createProjectsBrowserPlugin} from "nbook/plugins/projects/web/plugin";
import {createStorageBrowserPlugin} from "nbook/plugins/storage/web/plugin";
import {createWorkbenchBrowserPlugin} from "nbook/plugins/workbench/web/plugin";

export interface BrowserPluginContext {
    /** 本窗口运行实例的诊断存储。 */
    readonly store: DiagnosticsStore;
    readonly console: DiagnosticsConsole;
    /** 整页加载到 `href`。 */
    readonly navigateDocument: (href: string) => void;
}

export type BrowserPluginFactory = (context: BrowserPluginContext) => PluginDefinition;

export const browserPluginFactories: Readonly<Record<string, BrowserPluginFactory>> = {
    "nbook.diagnostics": (context) => createBrowserDiagnosticsPlugin({store: context.store, console: context.console}),
    "nbook.commands": () => createCommandsPlugin("browser"),
    "nbook.workbench": () => createWorkbenchBrowserPlugin(),
    "nbook.projects": (context) => createProjectsBrowserPlugin({navigateDocument: context.navigateDocument}),
    "nbook.storage": () => createStorageBrowserPlugin(),
};

/** 本外壳构建进去的浏览器插件：清单中有浏览器运行位置的插件。 */
export const builtinBrowserPlugins: ReadonlyArray<PluginDescriptor> = productPlugins.filter((plugin) => plugin.locations.includes("browser"));
