import type {PluginDescriptor} from "nbook/manifest";

/** 公开状态：拥有贡献点 `state.public`，在每个运行实例里提供公开键的同步读取。 */
export const descriptor: PluginDescriptor = {id: "nbook.state", version: "0.1.0", locations: ["server", "project", "browser"]};
