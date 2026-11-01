/**
 * `nbook.models` 浏览器入口：向设置窗口贡献“服务商与模型”“模型角色”两页（docs/specs/models/settings-pages.md）。窗口第一次显示
 * 任一页时才激活；激活时建两页共用的数据模块，入口停用时释放它的订阅。
 */

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {SETTINGS_PAGES_POINT, settingsPageEvent} from "nbook/plugins/settings/shared/contracts";
import type {WrittenSettingsPageDeclaration} from "nbook/plugins/settings/shared/sections";
import {settingsPage} from "nbook/ui/settings/settings-page";

import {descriptor} from "../plugin";
import {modelsSettingsContract} from "../shared/contracts";
import {PROVIDERS_SECTION, ROLES_SECTION} from "../shared/settings";
import {modelsText} from "../shared/text";
import {createModelsStore} from "./models-store";
import {modelsPage} from "./pages";

const keywords = [modelsText("keywords.apiKey"), modelsText("keywords.llm"), modelsText("keywords.provider")];

// 标题省略：登记处补成约定键 `settingsPages.<本地 id>.title`（本地 id 是去掉插件 id 前缀的 `providers`、`roles`）。
const PROVIDERS_PAGE: WrittenSettingsPageDeclaration = {icon: "i-lucide-server", category: "ai", order: 10, layout: "fill", layers: ["user"], description: modelsText("settingsPages.providers.description"), keywords};
const ROLES_PAGE: WrittenSettingsPageDeclaration = {icon: "i-lucide-users-round", category: "ai", order: 20, layout: "fill", layers: ["user"], description: modelsText("settingsPages.roles.description")};

export const modelsBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: [settingsPageEvent(PROVIDERS_SECTION), settingsPageEvent(ROLES_SECTION)],
        contributions: [
            {capability: SETTINGS_PAGES_POINT, id: PROVIDERS_SECTION, declaration: PROVIDERS_PAGE},
            {capability: SETTINGS_PAGES_POINT, id: ROLES_SECTION, declaration: ROLES_PAGE},
        ],
        activate: (context) => {
            const store = createModelsStore(context.remote.use(modelsSettingsContract));
            context.onStop(() => store.dispose());
            return {contributions: {[SETTINGS_PAGES_POINT]: {
                [PROVIDERS_SECTION]: settingsPage(async () => modelsPage((await import("./components/ProvidersPage.vue")).default, store)),
                [ROLES_SECTION]: settingsPage(async () => modelsPage((await import("./components/RolesPage.vue")).default, store)),
            }}};
        },
    })],
};
