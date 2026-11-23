import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

import {networkSettings} from "./shared/settings";

/**
 * 网络（docs/specs/network/egress.md）：代理设置与网络出口。服务端入口交出 `networkKey`，模型服务与网页工具经它选路发请求；浏览器
 * 入口向设置窗口贡献“网络”页（代理与模型目录；“自动更新模型列表”声明在这里，读它的是模型服务）。
 */
export const descriptor: PluginDescriptor = {
    id: "nbook.network",
    version: PRODUCT_VERSION,
    locations: ["server", "browser"],
    contributions: [...networkSettings.contributions],
};
