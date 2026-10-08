/**
 * 前端入口：产品清单的浏览器插件，开发模式另加开发清单（Lab）。启动流程见 `boot.ts`。
 */

import {bootWindowUi} from "./boot";
import {browserPluginDefinitions, builtinBrowserPlugins} from "./plugins";

// 开发清单里的插件（Lab）只在开发模式加载；生产构建把这个分支连同它动态加载的模块一起去掉。
const development = import.meta.env.DEV ? await import("./development-plugins") : null;
await bootWindowUi({
    builtin: [...builtinBrowserPlugins, ...(development?.developmentBrowserPlugins ?? [])],
    definitions: {...browserPluginDefinitions, ...development?.developmentBrowserPluginDefinitions},
});
