/**
 * 开发清单里插件的浏览器入口定义。`main.ts` 只在 `import.meta.env.DEV` 时动态加载本模块，生产构建不含它。
 */

import {setLayoutDevChecks} from "@notnotype/nb-layout";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {developmentPlugins} from "nbook/development-manifest";
import {pluginsAt} from "nbook/manifest";
import {labBrowserPlugin} from "nbook/plugins/lab/web/plugin";

export const developmentBrowserPlugins = pluginsAt("browser", developmentPlugins);

export const developmentBrowserPluginDefinitions: Readonly<Record<string, PluginDefinition>> = {
    "nbook.lab": labBrowserPlugin,
};

/**
 * 开发模式才开的检查：nb-layout 的接线错误在控制台警告（docs/specs/ui/nested-grid.md 输出 151）。库不读 `import.meta.env`，
 * 由宿主在自己的开发构建里打开；放在这里，生产构建与 e2e 外壳就不会引用它。
 */
export function enableDevelopmentChecks(): void {
    setLayoutDevChecks(true);
}
