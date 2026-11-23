/**
 * “网络”分区与 `nbook.network` 的设置项（docs/specs/network/egress.md“输入与前置条件”）。分区 id 别的插件也按字面引用
 * （`nbook.models` 的设置项指向它，反过来引用会成环），改 id 时一起改。代理两项只允许用户层：指定网络出口的项不让项目层改
 * （configuration.md 的作者规则）。
 */

import {Type} from "typebox";

import type {WrittenSettingsSectionDeclaration} from "nbook/plugins/settings/shared/sections";
import {defineSettings} from "nbook/shared/settings";

import {networkText} from "./text";

export const NETWORK_SECTION = "nbook.network";

export const NETWORK_SECTION_DECLARATION: WrittenSettingsSectionDeclaration = {
    description: networkText("settingsSections.nbook.network.description"),
    icon: "i-lucide-globe",
    category: "app",
    order: 40,
    groups: [{id: "proxy"}, {id: "catalog"}],
};

/** 自定义代理地址的长度上限（与服务商级的 `proxy.url` 一致）。 */
export const PROXY_URL_MAX_LENGTH = 2048;

export const networkSettings = defineSettings("nbook.network", {
    proxyMode: {
        schema: Type.Union([Type.Literal("system"), Type.Literal("custom"), Type.Literal("direct")]),
        default: "system",
        description: networkText("settings.proxyMode.description"),
        layers: ["user"],
        section: NETWORK_SECTION,
        group: "proxy",
        order: 10,
        choices: [{value: "system"}, {value: "custom"}, {value: "direct"}],
    },
    proxyUrl: {
        schema: Type.String({maxLength: PROXY_URL_MAX_LENGTH}),
        default: "",
        description: networkText("settings.proxyUrl.description"),
        layers: ["user"],
        section: NETWORK_SECTION,
        group: "proxy",
        order: 20,
    },
});
