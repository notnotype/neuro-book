import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

/**
 * 表情包（docs/specs/agent/stickers.md）：服务端持有表情目录、`stickers://` 与取图路由，接收插件经 `stickers.packs` 带来的
 * 表情包；浏览器入口取目录，交给 Markdown 的表情写法查表情。
 */
export const descriptor: PluginDescriptor = {id: "nbook.stickers", version: PRODUCT_VERSION, locations: ["server", "browser"]};
