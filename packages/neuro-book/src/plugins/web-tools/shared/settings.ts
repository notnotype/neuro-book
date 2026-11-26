/**
 * `nbook.web` 的设置项（docs/specs/web/tools.md“输入与前置条件”）。各项都只允许用户层；选用哪家与服务的地址关系到密钥发往
 * 哪里，不让项目层改。分区指向本插件自己的设置页，页面在“搜索规则”与各家的“高级”里画全部设置项，经设置服务写
 * （docs/specs/web/settings-page.md）。
 */

import {Type} from "typebox";

import {defineSettings} from "nbook/shared/settings";

import type {WebProviderId} from "./providers";

/** “搜索与网页”页的分区 id（页面在浏览器入口交付）。 */
export const SEARCH_SECTION = "nbook.web.search";

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_TAVILY_BASE_URL = "https://api.tavily.com";

/** 默认结果条数的范围（“输入与前置条件”的配置项表）。 */
export const RESULT_COUNT_MIN = 1;
export const RESULT_COUNT_MAX = 10;
/** 屏蔽网站的上限；每项的写法与归一化在 `sites.ts`（schema 只要字符串：写错的项由读的一方跳过，不让整份名单失效）。 */
export const MAX_BLOCKED_SITES = 100;

export const webSettings = defineSettings("nbook.web", {
    provider: {
        // 带 `choices` 的项要字面量联合的 schema（从数组映射出来的联合推不出字面量），所以照 `WEB_PROVIDERS` 逐个写出；加服务时这里的
        // schema 与 choices 一起加。
        schema: Type.Union([Type.Literal("deepseek"), Type.Literal("tavily")]),
        default: "deepseek",
        layers: ["user"],
        section: SEARCH_SECTION,
        choices: [{value: "deepseek"}, {value: "tavily"}] satisfies ReadonlyArray<{readonly value: WebProviderId}>,
    },
    deepseekBaseUrl: {
        schema: Type.String({minLength: 1}),
        default: DEFAULT_DEEPSEEK_BASE_URL,
        layers: ["user"],
        section: SEARCH_SECTION,
    },
    tavilyBaseUrl: {
        schema: Type.String({minLength: 1}),
        default: DEFAULT_TAVILY_BASE_URL,
        layers: ["user"],
        section: SEARCH_SECTION,
    },
    resultCount: {
        schema: Type.Integer({minimum: RESULT_COUNT_MIN, maximum: RESULT_COUNT_MAX}),
        default: 5,
        layers: ["user"],
        section: SEARCH_SECTION,
    },
    blockedSites: {
        schema: Type.Array(Type.String({minLength: 1, maxLength: 2048}), {maxItems: MAX_BLOCKED_SITES}),
        default: [],
        layers: ["user"],
        section: SEARCH_SECTION,
    },
    tavilySearchDepth: {
        schema: Type.Union([Type.Literal("basic"), Type.Literal("advanced")]),
        default: "basic",
        layers: ["user"],
        section: SEARCH_SECTION,
        choices: [{value: "basic"}, {value: "advanced"}],
    },
});
