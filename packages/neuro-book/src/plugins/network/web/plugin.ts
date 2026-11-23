/**
 * `nbook.network` 浏览器入口：向设置窗口贡献“网络”页（docs/specs/network/egress.md 的“网络页”）。窗口第一次显示这页时才激活；
 * 激活时建页面用的数据模块，入口停用时释放它。用渲染函数包页面：插件的合同测试在 bun test 里导入插件，bun 不能加载 `.vue`。
 */

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {defineComponent, h} from "vue";
import type {Component, PropType} from "vue";

import {modelsSettingsContract} from "nbook/plugins/models/shared/contracts";
import {SETTINGS_PAGES_POINT, settingsKey, settingsPageEvent} from "nbook/plugins/settings/shared/contracts";
import type {WrittenSettingsPageDeclaration} from "nbook/plugins/settings/shared/sections";
import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import type {SettingsService} from "nbook/shared/settings";
import {settingsPage} from "nbook/ui/settings/settings-page";

import {descriptor} from "../plugin";
import {networkSettingsContract} from "../shared/contracts";
import {NETWORK_SECTION} from "../shared/settings";
import {networkText} from "../shared/text";
import {createNetworkStore} from "./network-store";
import type {NetworkStore} from "./network-store";

// order 40：“外观”（10）、“作品”（30）之后。三项设置都只允许用户层。
const NETWORK_PAGE: WrittenSettingsPageDeclaration = {
    title: networkText("settingsPages.nbook.network.title"),
    description: networkText("settingsPages.nbook.network.description"),
    icon: "i-lucide-globe",
    category: "app",
    order: 40,
    layout: "column",
    layers: ["user"],
    keywords: [networkText("keywords.proxy"), networkText("keywords.vpn"), networkText("keywords.catalog")],
};

/** 设置窗口给页面 `context`；这里拆成页面要的几样，连同数据模块与配置服务交给页面组件（页面因此能在 Lab 里直接摆）。 */
function networkPage(component: Component, store: NetworkStore, settings: SettingsService): Component {
    return defineComponent({
        name: "NetworkSettingsHost",
        props: {context: {type: Object as PropType<SettingsPageContext>, required: true}},
        setup: (props) => () => h(component, {store, settings, writable: props.context.writable.value, reportWriteFailure: props.context.reportWriteFailure}),
    });
}

export const networkBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        dependencies: [{key: settingsKey}],
        activationEvents: [settingsPageEvent(NETWORK_SECTION)],
        contributions: [{capability: SETTINGS_PAGES_POINT, id: NETWORK_SECTION, declaration: NETWORK_PAGE}],
        activate: (context) => {
            const settings = context.services.require(settingsKey);
            const store = createNetworkStore(context.remote.use(networkSettingsContract), context.remote.use(modelsSettingsContract));
            context.onStop(() => store.dispose());
            return {contributions: {[SETTINGS_PAGES_POINT]: {
                [NETWORK_SECTION]: settingsPage(async () => networkPage((await import("./components/NetworkPage.vue")).default, store, settings)),
            }}};
        },
    })],
};
