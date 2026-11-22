/**
 * “网络”分区的声明。分区 id 别的插件也按字面引用（`nbook.models` 的设置项指向它，反过来引用会成环），改 id 时一起改。
 */

import type {WrittenSettingsSectionDeclaration} from "nbook/plugins/settings/shared/sections";

import {networkText} from "./text";

export const NETWORK_SECTION = "nbook.network";

export const NETWORK_SECTION_DECLARATION: WrittenSettingsSectionDeclaration = {
    description: networkText("settingsSections.nbook.network.description"),
    icon: "i-lucide-globe",
    category: "app",
    order: 40,
};
