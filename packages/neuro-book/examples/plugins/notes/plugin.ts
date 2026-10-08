/**
 * 插件描述（读法见 `../clock/plugin.ts`）。notes 在两个运行位置有入口：服务端存数据、提供远程服务；浏览器窗口里
 * 给本窗口的插件一份同步可读的缓存。两个入口各自激活、各自受阻，彼此只经远程合同通信。
 */

import type {PluginDescriptor} from "@notnotype/nb-runtime/plugins";

/** 笔记：按写笔记的插件分开存，每个插件只看到自己写的；数据落在 `nbook.storage`，服务端重启后还在。 */
export const descriptor: PluginDescriptor = {id: "example.notes", version: "0.1.0", locations: ["server", "browser"]};
