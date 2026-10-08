import type {PluginDescriptor} from "@notnotype/nb-runtime/plugins";

/** 报时：把宿主给的时钟作为共享服务交给别的插件。 */
export const descriptor: PluginDescriptor = {id: "example.clock", version: "0.1.0", locations: ["server"]};
