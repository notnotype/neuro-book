/**
 * 插件描述（读法见 `../clock/plugin.ts`）。counter 在两种后端位置各有一个入口：服务端一份全局的计数，每个打开的
 * 项目一份自己的计数。两个入口写在同一份后端定义里（`backend/plugin.ts`），各在本位置的实例里激活。
 */

import type {PluginDescriptor} from "@notnotype/nb-runtime/plugins";

/** 计数器：别的插件（例如窗口里的面板）直接用它的远程合同读写并订阅变化。 */
export const descriptor: PluginDescriptor = {id: "example.counter", version: "0.1.0", locations: ["server", "project"]};
