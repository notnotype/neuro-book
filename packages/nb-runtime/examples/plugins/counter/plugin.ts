import type {PluginDescriptor} from "@notnotype/nb-runtime/plugins";

/** 计数器：数据在服务端，浏览器窗口经远程服务读写并订阅变化。 */
export const descriptor: PluginDescriptor = {id: "example.counter", version: "0.1.0", locations: ["server", "browser"]};
