import type {PluginDescriptor} from "@notnotype/nb-runtime/plugins";

/** 菜单：定义贡献点 `menu.items`，别的插件往里加菜单项。 */
export const descriptor: PluginDescriptor = {id: "example.menu", version: "0.1.0", locations: ["server"]};
