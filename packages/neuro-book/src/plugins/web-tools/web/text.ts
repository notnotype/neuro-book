/**
 * `nbook.web` 的消息目录与组件里取文字的函数（docs/specs/ui/i18n.md 的“目录与键”）。目录随前端构建：`web/plugins.ts` 的
 * `builtinPluginCatalogs` 登记它，窗口挂载界面前登记进翻译引擎，命名空间是插件 id；文字引用的构造函数在 `shared/text.ts`。
 */

import type {PluginCatalogs} from "nbook/shared/convention-keys";
import {usePluginText} from "nbook/shared/use-plugin-text";
import type {BoundText} from "nbook/shared/use-plugin-text";

import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";
import {WEB_TEXT_NAMESPACE} from "../shared/text";
import type {WebFailure} from "./search-store";
import {detailText} from "./search-store";

export const webCatalogs: PluginCatalogs = {source: "zh-CN", catalogs: {"zh-CN": zhCN, "en-US": enUS}};

export type WebText = BoundText<typeof zhCN>;

/** 组件里取文字：`const text = useWebText();` 然后 `text("key.label")`。 */
export const useWebText = (): WebText => usePluginText<typeof zhCN>(WEB_TEXT_NAMESPACE);

const FAILURE_CODES = new Set(Object.keys(zhCN.failure));

/** 失败码（远程调用的，或检测结果里的）写成原因，`provider` 是服务名（服务那一侧的失败带它）；目录里没有的码写“失败了（码）”。 */
export function failureReason(text: WebText, failure: WebFailure, provider: string): string {
    if (!FAILURE_CODES.has(failure.code) || failure.code === "other") return text("failure.other", {code: failure.code});
    return text(`failure.${failure.code}` as "failure.other", {detail: detailText(failure.detail), code: failure.code, provider});
}
