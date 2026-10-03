import type {PluginDescriptor} from "nbook/manifest";

/** HTTP 监听、准入排空与插件路由分发；只有后端入口。 */
export const descriptor: PluginDescriptor = {id: "nbook.http", locations: ["server"]};
