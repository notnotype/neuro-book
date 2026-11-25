/**
 * `nbook.web` 的设置项（docs/specs/web/tools.md“输入与前置条件”）。三项都只允许用户层：选用哪家与服务的地址都关系到密钥发往
 * 哪里，不让项目层改。分区指向本插件自己的设置页：两个地址那一页不画，只能改设置文件（docs/specs/web/settings-page.md 的
 * “不承诺”）；选用哪家由那一页经设置服务写。
 */

import {Type} from "typebox";

import {defineSettings} from "nbook/shared/settings";

import type {WebProviderId} from "./providers";
import {webText} from "./text";

/** “搜索与网页”页的分区 id（页面在浏览器入口交付）。 */
export const SEARCH_SECTION = "nbook.web.search";

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_TAVILY_BASE_URL = "https://api.tavily.com";

export const webSettings = defineSettings("nbook.web", {
    provider: {
        // 带 `choices` 的项要字面量联合的 schema（从数组映射出来的联合推不出字面量），所以照 `WEB_PROVIDERS` 逐个写出；加服务时这里的
        // schema 与 choices 一起加。
        schema: Type.Union([Type.Literal("deepseek"), Type.Literal("tavily")]),
        default: "deepseek",
        description: webText("settings.provider.description"),
        layers: ["user"],
        section: SEARCH_SECTION,
        choices: [{value: "deepseek"}, {value: "tavily"}] satisfies ReadonlyArray<{readonly value: WebProviderId}>,
    },
    deepseekBaseUrl: {
        schema: Type.String({minLength: 1}),
        default: DEFAULT_DEEPSEEK_BASE_URL,
        description: webText("settings.deepseekBaseUrl.description"),
        layers: ["user"],
        section: SEARCH_SECTION,
    },
    tavilyBaseUrl: {
        schema: Type.String({minLength: 1}),
        default: DEFAULT_TAVILY_BASE_URL,
        description: webText("settings.tavilyBaseUrl.description"),
        layers: ["user"],
        section: SEARCH_SECTION,
    },
});
