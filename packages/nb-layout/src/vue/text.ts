/**
 * 取本包目录里的文字（docs/specs/ui/i18n.md）：读宿主注入的翻译端口，键绑定命名空间 `nb-layout`。没有宿主注入时走 nb-ui 的
 * 缺省端口，目录在本模块导入时登记。调用的组件要在同名 `.md` 里声明 `state:inject`。
 */

import {textRef} from "@notnotype/nb-ui/text";
import type {TextParams} from "@notnotype/nb-ui/text";
import {registerDefaultCatalog, useText} from "@notnotype/nb-ui/text-port";

import {NB_LAYOUT_CATALOGS, NB_LAYOUT_NAMESPACE, NB_LAYOUT_SOURCE_LOCALE} from "../locales";

registerDefaultCatalog(NB_LAYOUT_NAMESPACE, NB_LAYOUT_CATALOGS, NB_LAYOUT_SOURCE_LOCALE);

export type LayoutTextKey = "splitter.resizeWidth" | "splitter.resizeHeight" | "splitter.collapsed" | "splitter.pixels" | "floatWindow.resize" | "floatWindow.move";

/** 在 `setup` 里调用。返回的函数每次调用都读端口的当前语言，放进 `computed` 或模板里，换语言后会更新。 */
export function useLayoutText(): (key: LayoutTextKey, params?: TextParams) => string {
    const port = useText();
    return (key, params) => port.t(textRef(key, params, NB_LAYOUT_NAMESPACE));
}
