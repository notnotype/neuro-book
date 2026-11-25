import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

import {BUILTIN_COMPONENTS, BUILTIN_ENTRY_KINDS, CANON_COMPONENTS_POINT} from "./shared/components";
import {CANON_ENTRY_KINDS_POINT} from "./shared/entry-kinds";
import {canonSettings} from "./shared/settings";

/**
 * 世界引擎（docs/specs/canon/）：项目入口拥有这部作品的世界，经远程服务给浏览器与服务端用；浏览器入口按调用方
 * 转发；服务端入口给 Agent 贡献读写设定的工具（canon/agent-tools.md）。内置的 Component 类型与条目种类是顶层声明，和第三方的走同一个贡献点（components.md 输入与前置条件、author-ui.md 输入一节）。
 */
export const descriptor: PluginDescriptor = {
    id: "nbook.canon",
    version: PRODUCT_VERSION,
    locations: ["project", "server", "browser"],
    contributions: [
        ...BUILTIN_COMPONENTS.map(({id, ...declaration}) => ({capability: CANON_COMPONENTS_POINT, id, declaration})),
        ...BUILTIN_ENTRY_KINDS.map(({id, declaration}) => ({capability: CANON_ENTRY_KINDS_POINT, id, declaration})),
        ...canonSettings.contributions,
    ],
};
