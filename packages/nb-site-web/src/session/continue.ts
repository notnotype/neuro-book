/**
 * 登录续接（t10 计划 3.1“登录后的去向”；`site.accounts` 输出 4、11、23，`site.oauth-provider` 输出 4、12）。
 *
 * 授权端点把要先登录（或先补交同意）的人带到 `/login?continue=<令牌>`（或 `/consent?continue=<令牌>`）。令牌对页面是不透明的：
 * 页面只把它原样放进登录、注册、补交同意与社交发起的请求，从登录页走到注册页（或反过来）时带在地址上。服务端认得它时响应带
 * `continueUrl`，浏览器整页去那里回到那次授权请求；认不得时照常登录，页面照常分派。
 */

import {CONTINUE_PARAM} from "@notnotype/nb-site-identity-contract/constants";
import type {LocationQuery} from "vue-router";

import {safeNext} from "./dispatch";

/** 地址上的续接令牌：取第一个值；没带、带了空值都回 `undefined`。 */
export function readContinue(query: LocationQuery): string | undefined {
    const value = query[CONTINUE_PARAM];
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === "string" && first !== "" ? first : undefined;
}

/** 放进链接查询串或请求体的那一部分：没有令牌时是空对象，键不出现。 */
export function continuePart(token: string | undefined): {continue?: string} {
    return token === undefined ? {} : {[CONTINUE_PARAM]: token};
}

/**
 * 响应里的 `continueUrl` 能不能去：照 `next` 的规则核对是站内地址（`safeNext`）。合同的 schema 已经要求它以单个 `/` 开头，
 * 前端不跑 schema 校验，这里再核一次，免得服务端的缺陷变成开放跳转。不合格的当作没带、照常分派，记一条诊断（这是服务端缺陷）。
 */
export function continueTarget(continueUrl: string | undefined, origin: string): string | undefined {
    if (continueUrl === undefined) return undefined;
    const target = safeNext(continueUrl, origin);
    if (target === undefined) console.warn("服务端给的继续地址不是站内地址，当作没带、照常进站", continueUrl);
    return target;
}
