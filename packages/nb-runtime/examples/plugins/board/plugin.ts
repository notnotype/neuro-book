import type {PluginDescriptor} from "@notnotype/nb-runtime/plugins";

/** 项目白板：每个打开的项目一块，条目存在这个项目的实例里；窗口里的插件看到的是窗口绑定的那个项目的白板。 */
export const descriptor: PluginDescriptor = {id: "example.board", version: "0.1.0", locations: ["project"]};
