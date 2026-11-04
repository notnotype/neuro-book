import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

import {SETTINGS_SECTIONS_POINT} from "nbook/plugins/settings/shared/contracts";

import {agentSettings, RUN_GUARDS_SECTION, RUN_GUARDS_SECTION_DECLARATION} from "./shared/settings";

/**
 * Agent（docs/specs/agent/sessions.md、contributions.md）：服务端持有 Agent 会话，接收插件贡献的扩展、工具与 Profile。
 * 浏览器入口（对话界面）与项目级入口（要项目数据的内置工具）在用到它们的 Task 里加。
 */
export const descriptor: PluginDescriptor = {
    id: "nbook.agent",
    version: PRODUCT_VERSION,
    locations: ["server"],
    contributions: [...agentSettings.contributions, {capability: SETTINGS_SECTIONS_POINT, id: RUN_GUARDS_SECTION, declaration: RUN_GUARDS_SECTION_DECLARATION}],
};
