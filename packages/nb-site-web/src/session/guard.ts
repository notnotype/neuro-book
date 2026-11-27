/**
 * 路由守卫与统一处理的去处（t10 计划 3.1 的路由表与“守卫”；`site.accounts` 输出 7、8、10，`site.admin` 输出 1）。
 * 纯函数，不认识 vue-router：`router.ts` 把要去的路由翻成 `GuardTarget` 再问这里。
 */

import {dispatch, safeNext, withNext} from "./dispatch";
import type {KnownAccount} from "./dispatch";

/**
 * 谁能进一条路由。
 *
 * - `public`：任何人（公开页、“没有这一页”）。
 * - `guest`：访客的页（`/`、`/login`、`/register`）；已登录的人按分派跳走。
 * - `consent`：只给缺同意的用户（`/consent`）；访客先登录，不缺同意的按分派跳走。
 * - `user`、`admin`：要登录、要交齐同意；`admin` 另要管理员，普通用户去账号页。
 */
export type Access = "public" | "guest" | "consent" | "user" | "admin";

export interface GuardTarget {
    /** 路由的完整地址（路径加查询串与片段），被挡下时作为 `next` 带走。 */
    readonly fullPath: string;
    readonly access: Access;
    /** 地址上原样的 `next` 查询参数（可能不是字符串，也可能不合格）。 */
    readonly next: unknown;
    /**
     * 这条路由在地址带续接令牌（`continue`）时让已登录的人也进来。只有登录页：授权请求要求重新登录（`prompt=login`）时，
     * 服务端把已登录的人带到 `/login?continue=…`，他要看到登录表单而不是被分派走（计划 3.1“登录后的去向”）。
     */
    readonly signedInWithContinue: boolean;
    readonly hasContinue: boolean;
}

/** 放行回 `true`，否则回要改去的站内地址。`origin` 是站点的 origin，用来校验 `next`。 */
export function guard(target: GuardTarget, account: KnownAccount, origin: string): true | string {
    const next = safeNext(target.next, origin);
    switch (target.access) {
        case "public":
            return true;
        case "guest":
            if (account.kind === "anonymous") return true;
            if (target.signedInWithContinue && target.hasContinue) return true;
            return dispatch(account, next);
        case "consent":
            if (account.kind === "anonymous") return withNext("/login", target.fullPath);
            return account.consentRequired ? true : dispatch(account, next);
        case "user":
        case "admin":
            if (account.kind === "anonymous") return withNext("/login", target.fullPath);
            if (account.consentRequired) return withNext("/consent", target.fullPath);
            if (target.access === "admin" && account.role !== "admin") return "/account";
            return true;
    }
}

/**
 * 某个请求回了 `unauthenticated` 之后去哪：在要登录的页上，带着当前地址去登录；本来就是访客也能看的页（登录页、公开页）
 * 留在原地，回 `undefined`。
 */
export function afterUnauthenticated(current: Pick<GuardTarget, "fullPath" | "access">): string | undefined {
    return current.access === "public" || current.access === "guest" ? undefined : withNext("/login", current.fullPath);
}

/**
 * 同意门槛的统一处理在这一页上管不管：只在有登录态的页上（同意页与要登录的页）。访客页与公开页上没有登录态，撞不上门槛，
 * `consent_required` 只能是注册的“没勾同意”（`site.accounts` 输出 3），当普通失败交给页面。与 `afterUnauthenticated` 对访客页的处理对称。
 */
export function takesConsentGate(current: Pick<GuardTarget, "access">): boolean {
    return current.access !== "public" && current.access !== "guest";
}

/** 撞上同意门槛之后去哪（`takesConsentGate` 为真时才问）：带着当前地址去同意页；已经在同意页上时回 `undefined`。 */
export function afterConsentRequired(current: Pick<GuardTarget, "fullPath" | "access">): string | undefined {
    return current.access === "consent" ? undefined : withNext("/consent", current.fullPath);
}
