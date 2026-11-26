/**
 * 登录状态到去处的分派（t10 计划 3.1“分派”；`site.accounts` 输出 7、8，t09 第 2、3 条）。纯函数：输入当前账号的状态与
 * `next`，输出要去的站内地址。登录、注册、补交同意成功之后，已登录的人进登录页时，管理接口回 `forbidden` 之后都走它。
 */

import type {Role} from "@notnotype/nb-site-identity-contract/constants";

/** 分派与守卫要知道的账号状态：取到了身份之后的两种。没取到（连不上账号服务）的不进分派，由外壳整页提示。 */
export type KnownAccount =
    | {readonly kind: "anonymous"}
    | {readonly kind: "signed-in"; readonly role: Role; readonly consentRequired: boolean};

/** 浏览器当成别的站点的开头：协议相对的 `//host`，以及反斜杠当斜杠用的 `/\host`。 */
const OTHER_HOST = /^[/\\]{2}/u;

/**
 * `next` 只收站内路径（防开放跳转）：以 `/` 开头、不以 `//` 或 `/\` 开头，按站点的 origin 解析后 origin 不变。回解析后的路径、
 * 查询串与片段（规范化过的写法）；不合格时回 `undefined`，当作没带。
 *
 * 规范化之后再查一遍开头：`/.//evil`、`/a/..//evil`、`/%2e%2e//evil` 解析时 origin 不变，路径却成了 `//evil`。
 * 回出去的值会被放进 `href`、`location.assign` 或服务端的跳转，那里 `//evil` 就是别的站点。
 */
export function safeNext(next: unknown, origin: string): string | undefined {
    if (typeof next !== "string" || !next.startsWith("/") || OTHER_HOST.test(next)) return undefined;
    let url: URL;
    try {
        url = new URL(next, origin);
    } catch {
        // 解析不了的地址就是不合格的 next：当作没带，不是要上报的错误。
        return undefined;
    }
    if (url.origin !== origin) return undefined;
    const path = `${url.pathname}${url.search}${url.hash}`;
    return OTHER_HOST.test(path) ? undefined : path;
}

/** 带着 `next` 的站内地址；`next` 为空时就是 `path` 本身。 */
export function withNext(path: string, next: string | undefined): string {
    return next === undefined ? path : `${path}?next=${encodeURIComponent(next)}`;
}

/**
 * 去处，按顺序：匿名留在登录页；缺同意去同意页、原来的 `next` 带过去；带合格的 `next` 去 `next`；管理员去看板，普通用户去账号页。
 * `next` 要是 `safeNext` 过的。
 */
export function dispatch(account: KnownAccount, next: string | undefined): string {
    if (account.kind === "anonymous") return withNext("/login", next);
    if (account.consentRequired) return withNext("/consent", next);
    if (next !== undefined) return next;
    return account.role === "admin" ? "/admin" : "/account";
}
