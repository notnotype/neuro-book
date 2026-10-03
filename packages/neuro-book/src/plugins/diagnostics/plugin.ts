import type {PluginDescriptor} from "nbook/manifest";

/** 运行实例的结构化诊断与日志；后端在获授日志位置写 JSONL，浏览器写 console。 */
export const descriptor: PluginDescriptor = {id: "nbook.diagnostics", version: "0.1.0", locations: ["server", "browser"]};
