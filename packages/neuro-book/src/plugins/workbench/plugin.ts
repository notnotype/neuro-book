import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

import {appearanceSetting, themeSetting} from "./shared/contracts";
import {BUILTIN_THEME_CONTRIBUTIONS, themesPoint} from "./shared/themes";

/** 工作台：窗口的根界面（外壳与布局、命令面板、产品主题）。主题与明暗两项配置在这里声明。 */
export const descriptor: PluginDescriptor = {id: "nbook.workbench", version: PRODUCT_VERSION, locations: ["browser"], contributionPoints: [themesPoint], contributions: [themeSetting.contribution, appearanceSetting.contribution, ...BUILTIN_THEME_CONTRIBUTIONS]};
