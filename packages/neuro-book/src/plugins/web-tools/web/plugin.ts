/**
 * `nbook.web` 浏览器入口：向设置窗口贡献“搜索与网页”页（docs/specs/web/settings-page.md）。窗口第一次显示这页时才激活；
 * 激活时建页面用的数据模块，入口停用时释放它。
 */

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {SETTINGS_PAGES_POINT, settingsKey, settingsPageEvent} from "nbook/plugins/settings/shared/contracts";
import type {WrittenSettingsPageDeclaration} from "nbook/plugins/settings/shared/sections";
import {settingsPage} from "nbook/ui/settings/settings-page";

import {descriptor} from "../plugin";
import {SEARCH_SECTION, webSettingsContract} from "../shared/contracts";
import {webText} from "../shared/text";
import {searchPage} from "./pages";
import {createSearchStore} from "./search-store";

const keywords = [webText("keywords.online"), webText("keywords.web"), webText("keywords.search"), webText("keywords.deepseek"), webText("keywords.tavily")];

// 标题省略：登记处补成约定键 `settingsPages.<本地 id>.title`（本地 id 是去掉插件 id 前缀的 `search`）。
// order 22：模型的两页（10、20）之后，Profile（25）之前。
const SEARCH_PAGE: WrittenSettingsPageDeclaration = {icon: "i-lucide-globe", category: "ai", order: 22, layout: "fill", layers: ["user"], description: webText("settingsPages.search.description"), keywords};

export const webBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        // 页面经它读写 `nbook.web` 的各设置项：插件只能写自己声明的项，所以由本插件的入口拿着交给页面。
        dependencies: [{key: settingsKey}],
        activationEvents: [settingsPageEvent(SEARCH_SECTION)],
        contributions: [{capability: SETTINGS_PAGES_POINT, id: SEARCH_SECTION, declaration: SEARCH_PAGE}],
        activate: (context) => {
            const settings = context.services.require(settingsKey);
            const store = createSearchStore(context.remote.use(webSettingsContract));
            context.onStop(() => store.dispose());
            return {contributions: {[SETTINGS_PAGES_POINT]: {
                [SEARCH_SECTION]: settingsPage(async () => searchPage((await import("./components/SearchSettingsPage.vue")).default, store, settings)),
            }}};
        },
    })],
};
