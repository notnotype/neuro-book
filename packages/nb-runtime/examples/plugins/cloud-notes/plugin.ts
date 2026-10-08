import type {PluginDescriptor} from "@notnotype/nb-runtime/plugins";

/** 云笔记：窗口里的插件像用本地服务一样用，数据存在服务端并按调用方插件分开。`nbook.storage` 的同款结构。 */
export const descriptor: PluginDescriptor = {id: "example.cloud-notes", version: "0.1.0", locations: ["server", "browser"]};
