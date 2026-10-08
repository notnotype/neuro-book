/**
 * 开发清单里插件的浏览器入口定义。`main.ts` 只在 `import.meta.env.DEV` 时动态加载本模块，生产构建不含它。
 */

import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {developmentPlugins} from "nbook/development-manifest";
import {labBrowserPlugin} from "nbook/plugins/lab/web/plugin";

export const developmentBrowserPlugins = developmentPlugins.filter((plugin) => plugin.locations.includes("browser"));

export const developmentBrowserPluginDefinitions: Readonly<Record<string, PluginDefinition>> = {
    "nbook.lab": labBrowserPlugin,
};
