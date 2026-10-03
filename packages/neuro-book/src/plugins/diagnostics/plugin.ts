import type {PluginDescriptor} from "nbook/manifest";

/** 运行实例的结构化诊断与日志；后端在获授日志位置写 JSONL。 */
export const descriptor: PluginDescriptor = {id: "nbook.diagnostics", locations: ["server"]};
