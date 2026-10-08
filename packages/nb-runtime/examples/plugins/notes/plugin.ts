import type {PluginDescriptor} from "@notnotype/nb-runtime/plugins";

/** 笔记：按调用方插件分开存，每个插件只看到自己写的。 */
export const descriptor: PluginDescriptor = {id: "example.notes", version: "0.1.0", locations: ["server"]};
