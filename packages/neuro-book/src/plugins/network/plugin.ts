import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

import {SETTINGS_SECTIONS_POINT} from "nbook/plugins/settings/shared/contracts";

import {NETWORK_SECTION, NETWORK_SECTION_DECLARATION, networkSettings} from "./shared/settings";

/**
 * 网络（docs/specs/network/egress.md）：设置窗口的“网络”分区、代理设置与网络出口。服务端入口交出 `networkKey`，模型服务与网页工具
 * 经它选路发请求；分区里另有 `nbook.models` 的“自动更新模型列表”（读它的是模型服务，所以那一项归模型服务）。
 */
export const descriptor: PluginDescriptor = {
    id: "nbook.network",
    version: PRODUCT_VERSION,
    locations: ["server"],
    contributions: [{capability: SETTINGS_SECTIONS_POINT, id: NETWORK_SECTION, declaration: NETWORK_SECTION_DECLARATION}, ...networkSettings.contributions],
};
