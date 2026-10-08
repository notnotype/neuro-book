/**
 * 插件描述（读法见 `../clock/plugin.ts`）。
 */

import type {PluginDescriptor} from "@notnotype/nb-runtime/plugins";

/** 文件菜单：向 `example.menu` 贡献“打开”“关闭”两项。 */
export const descriptor: PluginDescriptor = {id: "example.file-menu", version: "0.1.0", locations: ["server"]};
