/**
 * 路由表与守卫（t10 计划 3.1）。页面按需加载：访客的入口块里只有外壳，管理面板、看板（B5 起带 ECharts）点到才取。
 *
 * 还没做的页面先挂同一个空壳 `ShellPage`，只显示路由的标题；各片做到那一页时换成自己的组件。看板从一开始就是单独的
 * `admin/DashboardPage.vue`：构建测试按它认出看板的块（ECharts 只许在那里）。
 */

import {createRouter} from "vue-router";
import type {RouteLocationNormalized, Router, RouterHistory} from "vue-router";

import {knownAccount} from "./session/account";
import type {CurrentAccount} from "./session/account";
import {guard} from "./session/guard";
import type {Access, GuardTarget} from "./session/guard";
import type {SiteTextKey} from "./text";

declare module "vue-router" {
    interface RouteMeta {
        /** 谁能进（`session/guard.ts` 的 `Access`）。没写的按 `public`。 */
        access?: Access;
        /** 页面套哪种版式：四张稿纸页、账号页、管理面板、普通版式（公开页与“没有这一页”）。 */
        layout?: "paper" | "account" | "admin" | "plain";
        /** 标签页标题用的键。 */
        titleKey?: SiteTextKey;
        /** 见 `GuardTarget.signedInWithContinue`。 */
        signedInWithContinue?: boolean;
    }
}

const shell = () => import("./pages/ShellPage.vue");

export interface SiteRouterOptions {
    readonly history: RouterHistory;
    readonly account: CurrentAccount;
    /** 站点的 origin，校验 `next` 用；产品里是 `location.origin`。 */
    readonly origin: string;
}

/** 路由翻成守卫认识的样子；统一处理（`site.ts`）也用它判断当前页。 */
export function guardTarget(route: RouteLocationNormalized): GuardTarget {
    return {
        fullPath: route.fullPath,
        access: route.meta.access ?? "public",
        next: route.query.next,
        signedInWithContinue: route.meta.signedInWithContinue === true,
        hasContinue: typeof route.query.continue === "string" && route.query.continue !== "",
    };
}

export function createSiteRouter(options: SiteRouterOptions): Router {
    const router = createRouter({
        history: options.history,
        routes: [
            {path: "/", name: "home", component: shell, meta: {access: "guest", layout: "paper", titleKey: "login.title"}},
            {path: "/login", name: "login", component: shell, meta: {access: "guest", layout: "paper", titleKey: "login.title", signedInWithContinue: true}},
            {path: "/register", name: "register", component: shell, meta: {access: "guest", layout: "paper", titleKey: "register.title"}},
            {path: "/consent", name: "consent", component: shell, meta: {access: "consent", layout: "paper", titleKey: "consent.title"}},
            {path: "/account", name: "account", component: shell, meta: {access: "user", layout: "account", titleKey: "account.title"}},
            // 路径暂定，随 `site.oauth-provider` 的改写定（计划 3.1）。
            {path: "/oauth/consent", name: "oauth-consent", component: shell, meta: {access: "user", layout: "paper", titleKey: "oauthConsent.title"}},
            {path: "/admin", name: "admin-dashboard", component: () => import("./pages/admin/DashboardPage.vue"), meta: {access: "admin", layout: "admin", titleKey: "admin.dashboard.title"}},
            {path: "/admin/users", name: "admin-users", component: shell, meta: {access: "admin", layout: "admin", titleKey: "admin.users.title"}},
            {path: "/admin/codes", name: "admin-codes", component: shell, meta: {access: "admin", layout: "admin", titleKey: "admin.codes.title"}},
            {path: "/admin/clients", name: "admin-clients", component: shell, meta: {access: "admin", layout: "admin", titleKey: "admin.clients.title"}},
            {path: "/admin/audit", name: "admin-audit", component: shell, meta: {access: "admin", layout: "admin", titleKey: "admin.audit.title"}},
            {path: "/privacy", name: "privacy", component: shell, meta: {access: "public", layout: "plain", titleKey: "legal.privacy.title"}},
            {path: "/terms", name: "terms", component: shell, meta: {access: "public", layout: "plain", titleKey: "legal.terms.title"}},
            // `/admin/` 下没有的地址也落到这里，不按管理员守卫：没有的页对谁都是没有。
            {path: "/:rest(.*)*", name: "not-found", component: () => import("./pages/NotFoundPage.vue"), meta: {access: "public", layout: "plain", titleKey: "notFound.title"}},
        ],
    });

    router.beforeEach(async (to) => {
        // 第一次导航时取身份，之后用缓存（`CurrentAccount.ensure`）。取不到时放行：外壳整页显示连不上与重试，不画页面。
        const account = knownAccount(await options.account.ensure());
        if (account === undefined) return true;
        return guard(guardTarget(to), account, options.origin);
    });

    return router;
}
