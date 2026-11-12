/**
 * 失败码到文字（docs/specs/ui/i18n.md 输出 13）：闭合错误域的拥有者用一张“码 → 自己目录里的键”的表取文字，不从码拼键；
 * 表里没有的码（服务端比页面新）显示宿主目录里的一句中性文案并附上码。远程路由的十个失败码归宿主，文案在宿主目录的
 * `errors.<码>` 下，各插件不各写一份。
 *
 * 诊断原文（异常 message、服务端 `detail`）不进这里取出的文字，交给通知的“详情”。
 */

import type {Text, TextParams, TextRef} from "@notnotype/nb-ui/text";
import type {RemoteFailureCode} from "@notnotype/nb-runtime/remote";

import {hostText} from "./host-text";

/** 拥有者绑定了命名空间的引用构造函数，例如 `pluginText<…>(插件 id)` 的返回值。 */
export type OwnerText<Key extends string> = (key: Key, params?: TextParams) => TextRef;

/**
 * 按拥有者的表取一个码的文字；表里没有这个码时是宿主的未知码文案。命名空间由 `text` 带，表只写键，所以两个拥有者
 * 的同名码各取各的目录。
 */
export function codeText<Key extends string>(text: OwnerText<Key>, table: Readonly<Record<string, Key>>, code: string, params?: TextParams): Text {
    return Object.hasOwn(table, code) ? text(table[code] as Key, params) : unknownResultText(code);
}

/** 不认识的结果码：只陈述收到了不认识的结果，不说“失败”“未保存”。 */
export function unknownResultText(code: string): TextRef {
    return hostText("unknownResult", {code});
}

/** 路由失败码在宿主目录里的键；`satisfies` 保证每个码都有，目录一侧由目录检查与 failure-text.test.ts 核对。 */
const REMOTE_FAILURE_KEYS = {
    "invalid-input": "errors.invalid-input",
    denied: "errors.denied",
    "target-gone": "errors.target-gone",
    unavailable: "errors.unavailable",
    "not-provided": "errors.not-provided",
    "version-changed": "errors.version-changed",
    timeout: "errors.timeout",
    cancelled: "errors.cancelled",
    "unknown-outcome": "errors.unknown-outcome",
    "provider-error": "errors.provider-error",
} as const satisfies Readonly<Record<RemoteFailureCode, `errors.${RemoteFailureCode}`>>;

/** 远程路由失败码的文字；不是路由码时按未知码。业务码先查拥有者自己的表，查不到再交给这里。 */
export function remoteFailureText(code: string): Text {
    return codeText(hostText, REMOTE_FAILURE_KEYS, code);
}

/** 是不是路由失败码：调用方据此决定先查自己的业务码表还是交给 `remoteFailureText`。 */
export function isRemoteFailureCode(code: string): code is RemoteFailureCode {
    return Object.hasOwn(REMOTE_FAILURE_KEYS, code);
}
