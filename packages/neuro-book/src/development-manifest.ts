/**
 * 开发清单：只在开发模式加载的插件。开发入口（`src/server/development-main.ts`，`bun run dev` 启动的后端）与前端
 * 的开发分支（`src/web/development-plugins.ts`，只在 `import.meta.env.DEV` 时动态加载）在产品清单之外再加载它们；
 * 生产构建的两个入口都不引用本文件，`check:dist` 确认产物里没有它们的代码。
 */

import type {PluginDescriptor} from "./manifest";
import {descriptor as lab} from "./plugins/lab/plugin";

export const developmentPlugins: ReadonlyArray<PluginDescriptor> = [lab];
