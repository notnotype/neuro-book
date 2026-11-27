/**
 * 路由表与守卫（t10 计划 3.1）。页面按需加载：访客的入口块里只有外壳与登录页（它就是主页，打开站点第一眼就要它），
 * 管理面板、看板（带 ECharts）点到才取。
 *
 * 管理面板的五页是 `/admin` 这条父路由的子路由：父路由的组件是管理面板的外壳（`admin/AdminShell.vue`，左栏导航与用户菜单），
 * 单独一个块，五页共用，在它们之间切换时外壳不重建（计划 3.13）。访问级别与版式写在父路由上，子路由的 `meta` 合并它们。
 *
 * 还没做的页面（隐私政策、服务条款）先挂同一个空壳 `ShellPage`，只显示路由的标题。
 * 看板是单独的 `admin/DashboardPage.vue`：构建测试按它认出看板的块（ECharts 只许在那里）。用户、注册码与邀请码、OAuth 客户端、
 * 审计四个列表页各自一个块，共用的取数与表格骨架由打包器拆成它们共用的块。
 */

import {CONTINUE_PARAM, OAUTH_ERROR_PARAM, OAUTH_PAGES} from "@notnotype/nb-site-identity-contract/constants";
import type {TextRef} from "@notnotype/nb-ui/text";
import {createRouter} from "vue-router";
import type {LocationQueryValue, RouteLocationNormalized, Router, RouterHistory} from "vue-router";

import LoginPage from "./pages/LoginPage.vue";
import {adminRef} from "./pages/admin/text-ref";
import {knownAccount} from "./session/account";
import type {CurrentAccount} from "./session/account";
import {guard} from "./session/guard";
import type {Access, GuardTarget} from "./session/guard";
import {siteRef} from "./text";

declare module "vue-router" {
    interface RouteMeta {
        /** 谁能进（`session/guard.ts` 的 `Access`）。没写的按 `public`。 */
        access?: Access;
        /**
         * 页面套哪种版式：四张稿纸页、账号页、管理面板、普通版式（公开页与“没有这一页”）。稿纸由外壳套上（`App.vue`），
         * 页面只画卡片里的内容；别的版式还由页面自己画。
         */
        layout?: "paper" | "account" | "admin" | "plain";
        /** 标签页标题。管理面板的五页取管理面板目录里的字（`pages/admin/text-ref.ts`），别的页取站点目录里的。 */
        title?: TextRef;
        /** 见 `GuardTarget.signedInWithContinue`。 */
        signedInWithContinue?: boolean;
        /**
         * 地址带这个查询参数（非空）时，这条路由对任何人开放，`access` 不算数。只有授权确认页：授权端点把客户端或回调地址不对的人
         * 带到 `/oauth/consent?error=<码>`（`site.oauth-provider` 输出 3），那时他可能还没登录，页面只显示一张说明卡片、不取接口；
         * 带 `request` 的要登录、要交齐同意。
         */
        publicWith?: string;
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
    const publicWith = route.meta.publicWith;
    const opened = publicWith !== undefined && nonEmpty(route.query[publicWith]);
    return {
        fullPath: route.fullPath,
        access: opened ? "public" : (route.meta.access ?? "public"),
        next: route.query.next,
        signedInWithContinue: route.meta.signedInWithContinue === true,
        hasContinue: nonEmpty(route.query[CONTINUE_PARAM]),
    };
}

/** 查询参数带了非空的值（重复的参数看第一个，与页面读它的方式相同）。 */
function nonEmpty(value: LocationQueryValue | LocationQueryValue[] | undefined): boolean {
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === "string" && first !== "";
}

export function createSiteRouter(options: SiteRouterOptions): Router {
    const router = createRouter({
        history: options.history,
        routes: [
            {path: "/", name: "home", component: LoginPage, meta: {access: "guest", layout: "paper", title: siteRef("login.title")}},
            {path: "/login", name: "login", component: LoginPage, meta: {access: "guest", layout: "paper", title: siteRef("login.title"), signedInWithContinue: true}},
            {path: "/register", name: "register", component: () => import("./pages/RegisterPage.vue"), meta: {access: "guest", layout: "paper", title: siteRef("register.title")}},
            {path: "/consent", name: "consent", component: () => import("./pages/ConsentPage.vue"), meta: {access: "consent", layout: "paper", title: siteRef("consent.title")}},
            {path: "/account", name: "account", component: () => import("./pages/account/AccountPage.vue"), meta: {access: "user", layout: "account", title: siteRef("account.title")}},
            // 路径是 `site.oauth-provider` 输出 3、5 定的（`OAUTH_PAGES.consent`）。
            {
                path: OAUTH_PAGES.consent,
                name: "oauth-consent",
                component: () => import("./pages/OAuthConsentPage.vue"),
                meta: {access: "user", publicWith: OAUTH_ERROR_PARAM, layout: "paper", title: siteRef("oauthConsent.title")},
            },
            {
                path: "/admin",
                component: () => import("./pages/admin/AdminShell.vue"),
                meta: {access: "admin", layout: "admin"},
                children: [
                    {path: "", name: "admin-dashboard", component: () => import("./pages/admin/DashboardPage.vue"), meta: {title: adminRef("admin.dashboard.title")}},
                    {path: "users", name: "admin-users", component: () => import("./pages/admin/UsersPage.vue"), meta: {title: adminRef("admin.users.title")}},
                    {path: "codes", name: "admin-codes", component: () => import("./pages/admin/CodesPage.vue"), meta: {title: adminRef("admin.codes.title")}},
                    {path: "clients", name: "admin-clients", component: () => import("./pages/admin/ClientsPage.vue"), meta: {title: adminRef("admin.clients.title")}},
                    {path: "audit", name: "admin-audit", component: () => import("./pages/admin/AuditPage.vue"), meta: {title: adminRef("admin.audit.title")}},
                ],
            },
            {path: "/privacy", name: "privacy", component: shell, meta: {access: "public", layout: "plain", title: siteRef("legal.privacy.title")}},
            {path: "/terms", name: "terms", component: shell, meta: {access: "public", layout: "plain", title: siteRef("legal.terms.title")}},
            // `/admin/` 下没有的地址也落到这里，不按管理员守卫：没有的页对谁都是没有。
            {path: "/:rest(.*)*", name: "not-found", component: () => import("./pages/NotFoundPage.vue"), meta: {access: "public", layout: "plain", title: siteRef("notFound.title")}},
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
