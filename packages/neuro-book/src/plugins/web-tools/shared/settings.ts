/**
 * `nbook.web-tools` 的设置项（docs/specs/web/tools.md“输入与前置条件”）。DeepSeek 的地址只允许用户层（指定网络地址的项不让项目层
 * 改），分区指向本插件自己的设置页：那一页不画它，所以只能改设置文件（docs/specs/web/settings-page.md 的“不承诺”）。
 */

import {Type} from "typebox";

import {defineSettings} from "nbook/shared/settings";

import {webText} from "./text";

/** “搜索与网页”页的分区 id（页面在浏览器入口交付）。 */
export const SEARCH_SECTION = "nbook.web-tools.search";

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export const webSettings = defineSettings("nbook.web-tools", {
    deepseekBaseUrl: {
        schema: Type.String({minLength: 1}),
        default: DEFAULT_DEEPSEEK_BASE_URL,
        description: webText("settings.deepseekBaseUrl.description"),
        layers: ["user"],
        section: SEARCH_SECTION,
    },
});
