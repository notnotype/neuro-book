/**
 * “网络”页与 `nbook.network` 的设置项（docs/specs/network/egress.md“输入与前置条件”）。三项都只允许用户层：指定网络出口与联网
 * 行为的项不让项目层改（configuration.md 的作者规则）。它们指向的是 page 分区，由网络页画，不进设置窗口的“其它”。
 */

import {Type} from "typebox";

import {defineSettings} from "nbook/shared/settings";

/** 网络页的分区 id（页面在浏览器入口交付）。 */
export const NETWORK_SECTION = "nbook.network";

/** 自定义代理地址的长度上限（与服务商级的 `proxy.url` 一致）。 */
export const PROXY_URL_MAX_LENGTH = 2048;

export const networkSettings = defineSettings("nbook.network", {
    proxyMode: {
        schema: Type.Union([Type.Literal("system"), Type.Literal("custom"), Type.Literal("direct")]),
        default: "system",
        layers: ["user"],
        section: NETWORK_SECTION,
        choices: [{value: "system"}, {value: "custom"}, {value: "direct"}],
    },
    /**
     * 模型列表与在线目录的自动更新（docs/specs/models/service.md 输出 25）。读它的是模型服务，但它显示在网络页、由网络页写：页面
     * 只能写自己插件声明的项（configuration.md 输出 11），所以归这里，模型服务按定义读。
     */
    catalogAutoUpdate: {
        schema: Type.Boolean(),
        default: true,
        layers: ["user"],
        section: NETWORK_SECTION,
    },
    proxyUrl: {
        schema: Type.String({maxLength: PROXY_URL_MAX_LENGTH}),
        default: "",
        layers: ["user"],
        section: NETWORK_SECTION,
    },
});
