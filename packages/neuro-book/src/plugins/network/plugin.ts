import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

import {SETTINGS_SECTIONS_POINT} from "nbook/plugins/settings/shared/contracts";

import {NETWORK_SECTION, NETWORK_SECTION_DECLARATION} from "./shared/settings";

/**
 * 网络（w00032 t43）：设置窗口的“网络”分区。现在只有分区，里面是 `nbook.models` 的“自动更新模型列表”（读它的是模型服务，所以那一项
 * 归模型服务）；代理设置与出口服务在段 C 加进这里。没有入口。
 */
export const descriptor: PluginDescriptor = {
    id: "nbook.network",
    version: PRODUCT_VERSION,
    locations: [],
    contributions: [{capability: SETTINGS_SECTIONS_POINT, id: NETWORK_SECTION, declaration: NETWORK_SECTION_DECLARATION}],
};
