import type {PluginDescriptor} from "@notnotype/nb-runtime/plugins";

/** 问候：按报时服务给出的时间打招呼，演示依赖另一个插件的服务。 */
export const descriptor: PluginDescriptor = {id: "example.greeter", version: "0.1.0", locations: ["server"]};
