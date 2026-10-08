import type {PluginDescriptor} from "nbook/manifest";

import {appearanceSetting, themeSetting} from "./shared/contracts";

/** 工作台：窗口的根界面（外壳与布局、命令面板、产品主题）。主题与明暗两项配置在这里声明。 */
export const descriptor: PluginDescriptor = {id: "nbook.workbench", version: "0.1.0", locations: ["browser"], contributions: [themeSetting.contribution, appearanceSetting.contribution]};
