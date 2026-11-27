/**
 * 社交流程没完成时上游把人带回的落点参数 `social_error`（`site.accounts` 输出 23；t10 计划 3.1 的 `social_error` 表）。登录页、
 * 注册页、账号页三处都读它，读法收在这里：取第一个值，空值当作没带（输出 23）；显示之后从地址里去掉，刷新时不再显示一遍。
 * 去掉参数是同一页面上的跳转，组件不重建。
 */

import {SOCIAL_ERROR_PARAM} from "@notnotype/nb-site-identity-contract/constants";
import type {LocationQuery, RouteLocationNormalizedLoaded, Router} from "vue-router";

/** 地址上的码；没带、带了空值都回 `undefined`。码是谁都能写的字符串，显示时只经 `socialErrorText`。 */
export function readSocialError(query: LocationQuery): string | undefined {
    const value = query[SOCIAL_ERROR_PARAM];
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === "string" && first !== "" ? first : undefined;
}

export interface StripOptions {
    /** 同时换锚点。 */
    readonly hash?: string;
    /** 同一次替换里加上的查询参数（注册页把草稿里还原的续接令牌写回地址）。 */
    readonly add?: Readonly<Record<string, string>>;
}

/** 地址上有这个参数（空值也算）时把它去掉。 */
export function stripSocialError(route: RouteLocationNormalizedLoaded, router: Router, options: StripOptions = {}): void {
    if (!Object.hasOwn(route.query, SOCIAL_ERROR_PARAM)) return;
    const {[SOCIAL_ERROR_PARAM]: _shown, ...query} = route.query;
    router.replace({path: route.path, query: {...query, ...options.add}, hash: options.hash ?? route.hash}).catch((error: unknown) => {
        console.warn(`没能把 ${SOCIAL_ERROR_PARAM} 从地址里去掉`, error);
    });
}
