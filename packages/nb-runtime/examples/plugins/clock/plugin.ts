import type {PluginDescriptor} from "@notnotype/nb-runtime/plugins";

/** 报时：把宿主能力里的时钟包成共享服务交给别的插件。 */
export const descriptor: PluginDescriptor = {id: "example.clock", version: "0.1.0", locations: ["server"]};
