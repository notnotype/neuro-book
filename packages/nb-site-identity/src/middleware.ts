/**
 * 账号子应用的门槛（w00037 t07 计划 3.6）：来源头、要会话、同意门槛、角色门槛。
 *
 * 先后：来源头最先（子应用的第一个中间件，先于请求体、限流与会话）；要会话的路由在处理函数开头调 `requireSession`：读会话 →
 * 延长与最后使用时间 → 同意门槛 → 角色门槛。门槛只装在账号子应用里（含 `admin/*`，以及 t08 挂进同一个子应用的 `oauth/*`
 * 自家路由），别的模块的接口不经它（`site.accounts` 输出 10）。
 */

import type {Context, MiddlewareHandler} from "hono";

import {IDENTITY_PATHS} from "@notnotype/nb-site-identity-contract";

import {IdentityFailure} from "./errors";
import type {CurrentSession, Sessions} from "./session";

/** 一个路由的方法与路径（相对 `IDENTITY_API_PREFIX`，带参数的写 Hono 的写法，例如 `DELETE /me/sessions/:id`）。 */
export type RouteKey = `${"GET" | "POST" | "PATCH" | "DELETE"} /${string}`;

/**
 * 同意门槛的放行表（`site.accounts` 输出 10；`me` 只指 `GET me`）：缺当前版本的同意时，要会话的路由里只有这几个照常处理，
 * 其余回 `consent_required`。`GET whoami` 也放行，但它不经 `requireSession`（不延长会话），所以不在表里。
 */
export const CONSENT_EXEMPT_ROUTES: ReadonlySet<RouteKey> = new Set<RouteKey>([`GET ${IDENTITY_PATHS.me}`, `POST ${IDENTITY_PATHS.meConsent}`, `POST ${IDENTITY_PATHS.logout}`]);

/** 要会话的路由的权限：`user` 是任何有效会话，`admin` 另要角色是管理员（`site.admin` 失败表的 `forbidden`）。 */
export type Access = "user" | "admin";

export type Authorization =
    | {readonly ok: true; readonly session: CurrentSession; readonly cookies: readonly string[]}
    | {readonly ok: false; readonly code: "unauthenticated" | "consent_required" | "forbidden"; readonly cookies: readonly string[]};

/**
 * 要会话的路由的判断，不碰 Hono：读会话、延长、两道门槛。`cookies` 无论成败都要随响应发出（到期时的清除、延长时的新 Cookie）。
 * 延长在门槛之前：被同意门槛挡住的请求也是在用这个会话。
 */
export async function authorize(sessions: Sessions, cookie: string | null, route: RouteKey, access: Access): Promise<Authorization> {
    const read = await sessions.read(cookie, "use");
    if (read.session === null) return {ok: false, code: "unauthenticated", cookies: read.cookies};
    const cookies = [...read.cookies, ...(await sessions.maintain(read.session))];
    if (read.session.consentRequired && !CONSENT_EXEMPT_ROUTES.has(route)) return {ok: false, code: "consent_required", cookies};
    if (access === "admin" && read.session.role !== "admin") return {ok: false, code: "forbidden", cookies};
    return {ok: true, session: read.session, cookies};
}

/** 把 `Set-Cookie` 记到响应上：成功的响应与出错出口回的响应都带着它们（`respondFailure` 用同一个 `c`）。 */
export function appendCookies(c: Context, cookies: readonly string[]): void {
    for (const cookie of cookies) c.header("Set-Cookie", cookie, {append: true});
}

/** 处理函数开头调用：通过时回会话，否则抛出对应的失败。 */
export async function requireSession(c: Context, sessions: Sessions, route: RouteKey, access: Access = "user"): Promise<CurrentSession> {
    const result = await authorize(sessions, c.req.header("Cookie") ?? null, route, access);
    appendCookies(c, result.cookies);
    if (!result.ok) throw new IdentityFailure(result.code);
    return result.session;
}

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/**
 * 来源头：改状态的请求（GET、HEAD 以外的方法）的 `Origin` 必须等于站点地址的 origin，缺或不同回 `forbidden_origin`
 * （`site.accounts` 输入一节）。未知的路径也先过这一道：不带来源头的写请求得不到“有没有这个接口”的回答。
 */
export function requireSameOrigin(siteOrigin: string): MiddlewareHandler {
    return async (c, next) => {
        if (!SAFE_METHODS.has(c.req.method) && c.req.header("Origin") !== siteOrigin) throw new IdentityFailure("forbidden_origin");
        await next();
    };
}
