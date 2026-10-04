/**
 * 开发清单里插件的浏览器入口工厂。`main.ts` 只在 `import.meta.env.DEV` 时动态加载本模块，生产构建不含它。
 */

import {developmentPlugins} from "nbook/development-manifest";
import {createLabBrowserPlugin} from "nbook/plugins/lab/web/plugin";

import type {BrowserPluginFactory} from "./plugins";

export const developmentBrowserPlugins = developmentPlugins.filter((plugin) => plugin.locations.includes("browser"));

export const developmentBrowserPluginFactories: Readonly<Record<string, BrowserPluginFactory>> = {
    "nbook.lab": () => createLabBrowserPlugin(),
};
