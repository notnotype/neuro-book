import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

import {DESKTOP_PLUGIN, desktopSectionContribution, desktopSettingContributions} from "./shared/contracts";

/**
 * 桌面专属设置（docs/specs/runtime/desktop-shell.md 的“桌面专属设置”）：配置项与设置分区写在描述的顶层，每个实例都登记；浏览器
 * 入口在桌面壳的窗口里把有效值交给壳、接管缩放的快捷键，在普通浏览器里只声明公开状态（值为 false）。
 */
export const descriptor: PluginDescriptor = {
    id: DESKTOP_PLUGIN,
    version: PRODUCT_VERSION,
    locations: ["browser"],
    contributions: [...desktopSettingContributions, desktopSectionContribution],
};
