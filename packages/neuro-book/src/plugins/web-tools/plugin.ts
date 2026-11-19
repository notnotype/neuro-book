import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

import {webSettings} from "./shared/settings";

/**
 * 网页工具（docs/specs/web/tools.md）：给 Agent 的 `web_search`、`web_fetch`，经 DeepSeek 的搜索与读取接口；密钥在
 * `<状态根>/web/keys.json`，只在服务端。内置插件，不能在插件管理里停用；不想要这两个工具时在 Profile 的工具绑定里去掉。
 */
export const descriptor: PluginDescriptor = {
    id: "nbook.web-tools",
    version: PRODUCT_VERSION,
    locations: ["server"],
    contributions: [...webSettings.contributions],
};
