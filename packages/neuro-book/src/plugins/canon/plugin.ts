import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

import {BUILTIN_COMPONENTS, CANON_COMPONENTS_POINT} from "./shared/components";
import {canonSettings} from "./shared/settings";

/**
 * 世界引擎（docs/specs/canon/）：项目入口拥有这部作品的世界，经远程服务给浏览器与服务端用；浏览器入口按调用方
 * 转发。内置的 Component 类型是顶层声明，和第三方类型走同一个贡献点（components.md 输入与前置条件）。
 */
export const descriptor: PluginDescriptor = {
    id: "nbook.canon",
    version: PRODUCT_VERSION,
    locations: ["project", "browser"],
    contributions: [...BUILTIN_COMPONENTS.map(({id, ...declaration}) => ({capability: CANON_COMPONENTS_POINT, id, declaration})), ...canonSettings.contributions],
};
