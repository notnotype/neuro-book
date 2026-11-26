/**
 * 失败的文案（t10 计划 3.2“失败码的文案”）：放在站点目录的 `errors.<拥有者>.<码>`，按码取，不按 HTTP 状态。
 * 前端自己判出的失败（连不上、回答看不懂）在 `errors.web`。目录里没有的码显示 `errors.web.unknown` 并附上码（ADR 0034 的做法），
 * 所以服务端新加一个码时页面照样有字可显示，`tests/catalog.test.ts` 再提醒补文案。
 */

import {SOCIAL_ERROR_CODES} from "@notnotype/nb-site-identity-contract";
import type {TextRef} from "@notnotype/nb-ui/text";
import {textRef} from "@notnotype/nb-ui/text";

import {SITE_SOURCE_CATALOG, SITE_TEXT_NAMESPACE, siteRef} from "../text";
import type {Failure} from "./core";

/** 失败码的拥有者：账号与管理是同一个模块（`identity`，对外 OAuth 的自家接口也在里面），统计是 `telemetry`。 */
export type FailureOwner = "identity" | "telemetry";

/** 源语言目录里 `errors.<拥有者>` 下有没有这个码。用 `Object.hasOwn`：码是任意字符串，不能从原型上取到东西。 */
function hasCode(owner: FailureOwner, code: string): boolean {
    const group = (SITE_SOURCE_CATALOG.errors as Readonly<Record<string, Readonly<Record<string, string>> | undefined>>)[owner];
    return group !== undefined && Object.hasOwn(group, code);
}

/** 一个码的文案引用；`seconds` 给 `rate_limited` 的倒数用。 */
export function codeText(owner: FailureOwner, code: string, params?: {readonly seconds?: number}): TextRef {
    if (!hasCode(owner, code)) return siteRef("errors.web.unknown", {code});
    return textRef(`errors.${owner}.${code}`, params?.seconds === undefined ? undefined : {seconds: params.seconds}, SITE_TEXT_NAMESPACE);
}

/** 一次失败要显示的文案引用。 */
export function failureText(owner: FailureOwner, failure: Failure): TextRef {
    switch (failure.kind) {
        case "network":
            return siteRef("errors.web.network");
        case "malformed":
            return siteRef("errors.web.malformed");
        case "code":
            return codeText(owner, failure.code, failure.retryAfterSeconds === undefined ? undefined : {seconds: failure.retryAfterSeconds});
    }
}

/** 码的样子：小写字母开头的小写字母、数字与下划线。合同里的码都是这样。 */
const CODE_SHAPE = /^[a-z][a-z0-9_]{0,63}$/u;

/**
 * 落点页上 `social_error` 的文案（`site.accounts` 输出 23；计划 3.1 的 `social_error`）。这个参数谁都能写进链接里：
 * 合同列出的码取它的文案；样子像码、合同里没有的显示通用文案加码（ADR 0034）；不像码的（一段话、网址）不照抄到页面上，
 * 显示 `social_failed`，免得别人借站点的状态行说话。
 */
export function socialErrorText(code: string): TextRef {
    if ((SOCIAL_ERROR_CODES as readonly string[]).includes(code)) return codeText("identity", code);
    if (CODE_SHAPE.test(code)) return siteRef("errors.web.unknown", {code});
    return codeText("identity", "social_failed");
}
