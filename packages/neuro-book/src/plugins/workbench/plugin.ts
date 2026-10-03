import type {PluginDescriptor} from "nbook/manifest";

/** 工作台：窗口的根界面。第 3 步只有提供空工作台的浏览器入口，外壳、命令与布局随第 4 步加入。 */
export const descriptor: PluginDescriptor = {id: "nbook.workbench", version: "0.1.0", locations: ["browser"]};
