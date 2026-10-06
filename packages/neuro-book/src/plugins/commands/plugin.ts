import type {PluginDescriptor} from "nbook/manifest";

/** 命令系统：每个运行位置一份命令表，插件经贡献点登记命令、经命令服务执行。界面（命令面板、键位）不在这里。 */
export const descriptor: PluginDescriptor = {id: "nbook.commands", version: "0.1.0", locations: ["server", "browser"]};
