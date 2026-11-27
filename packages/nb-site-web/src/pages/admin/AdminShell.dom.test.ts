/**
 * 管理面板的外壳（`AdminShell.vue`）：装起整个站点（`testing/site-harness.ts`），以管理员身份打开。断言左栏导航有哪几项、当前页
 * 标在哪一项、在几页之间走时外壳不重建，与左下角用户菜单的账号页、退出登录。没有页面级横向滚动、内容区的高度要真实布局，
 * 在 `e2e/dashboard.e2e.ts`。
 */

import {IDENTITY_PATHS} from "@notnotype/nb-site-identity-contract/constants";
import {afterEach, describe, expect, it, vi} from "vitest";

import zhCN from "../../locales/zh-CN.json";
import {cleanUp, failure, identityUrl, settledAt, startAt} from "../../testing/site-harness";
import type {Handler, Harness} from "../../testing/site-harness";
import adminZhCN from "./locales/zh-CN.json";

const LOGOUT = identityUrl(IDENTITY_PATHS.logout);

afterEach(cleanUp);

const NAV = [
    {route: "admin-dashboard", path: "/admin", title: adminZhCN.admin.dashboard.title},
    {route: "admin-users", path: "/admin/users", title: adminZhCN.admin.users.title},
    {route: "admin-codes", path: "/admin/codes", title: adminZhCN.admin.codes.title},
    {route: "admin-clients", path: "/admin/clients", title: adminZhCN.admin.clients.title},
    {route: "admin-audit", path: "/admin/audit", title: adminZhCN.admin.audit.title},
] as const;

async function openAdmin(path: string, page: string, handlers: Readonly<Record<string, Handler>> = {}): Promise<Harness> {
    const harness = startAt(path, {session: {role: "admin", consentRequired: false}, handlers});
    await settledAt(harness, path, page);
    return harness;
}

function shell(harness: Harness): HTMLElement {
    const found = harness.target.querySelector<HTMLElement>("[data-site-admin-shell]");
    if (found === null) throw new Error("没有管理面板的外壳");
    return found;
}

function navLinks(harness: Harness): HTMLAnchorElement[] {
    return [...shell(harness).querySelectorAll<HTMLAnchorElement>("nav a[data-site-admin-nav]")];
}

/** 标成当前页（`aria-current="page"`）的导航项。 */
function current(harness: Harness): string[] {
    return navLinks(harness).filter((link) => link.getAttribute("aria-current") === "page").map((link) => link.dataset.siteAdminNav ?? "");
}

/** 打开左下角的用户菜单，回菜单项。 */
async function openMenu(harness: Harness): Promise<HTMLElement[]> {
    const trigger = shell(harness).querySelector<HTMLButtonElement>("[data-site-admin-menu]")!;
    trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true}));
    await vi.waitFor(() => expect(document.body.querySelector('[role="menuitem"]')).not.toBeNull());
    return [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

describe("导航", () => {
    it("左栏五项按定稿的先后，各指向自己的页；当前页那一项标成当前", async () => {
        const harness = await openAdmin("/admin", "admin-dashboard");
        expect(navLinks(harness).map((link) => ({text: link.textContent?.trim(), href: link.getAttribute("href")}))).toEqual(NAV.map(({title, path}) => ({text: title, href: path})));
        expect(current(harness)).toEqual(["admin-dashboard"]);
        expect(shell(harness).querySelector("nav")?.getAttribute("aria-label")).toBe(adminZhCN.admin.nav);
    });

    it("点到别的页：当前项跟着换，外壳不重建；再回看板", async () => {
        const harness = await openAdmin("/admin", "admin-dashboard");
        const before = shell(harness);

        for (const {route, path} of NAV.slice(1)) {
            navLinks(harness).find((link) => link.dataset.siteAdminNav === route)!.click();
            await settledAt(harness, path, route);
            expect(current(harness)).toEqual([route]);
            expect(shell(harness)).toBe(before);
        }

        navLinks(harness)[0]!.click();
        await settledAt(harness, "/admin", "admin-dashboard");
        expect(current(harness)).toEqual(["admin-dashboard"]);
        expect(shell(harness)).toBe(before);
    });
});

describe("用户菜单", () => {
    it("写着当前管理员的用户名；菜单里是账号页与退出登录，点账号页去账号页", async () => {
        const harness = await openAdmin("/admin/users", "admin-users");
        const trigger = shell(harness).querySelector<HTMLButtonElement>("[data-site-admin-menu]")!;
        expect(trigger.textContent).toContain("alice");
        expect(trigger.getAttribute("aria-label")).toBe(zhCN.account.menu.replace("{{username}}", "alice"));

        const items = await openMenu(harness);
        expect(items.map((item) => item.textContent?.trim())).toEqual([adminZhCN.admin.accountPage, zhCN.account.signOut]);
        items[0]!.click();
        await settledAt(harness, "/account", "account");
    });

    it("退出登录：结束会话，回到首页的登录表单", async () => {
        const harness = await openAdmin("/admin/users", "admin-users", {
            [`POST ${LOGOUT}`]: (_body, server) => {
                server.session = undefined;
                return Response.json({});
            },
        });
        const items = await openMenu(harness);
        items[1]!.click();

        await settledAt(harness, "/", "home");
        expect(harness.requests.filter((request) => request.method !== "GET")).toEqual([{method: "POST", path: LOGOUT, body: undefined}]);
        expect(harness.site.account.state.value).toEqual({kind: "anonymous"});
    });

    it("退出登录没成：留在这一页，菜单上方写原因", async () => {
        const harness = await openAdmin("/admin/users", "admin-users", {[`POST ${LOGOUT}`]: () => failure({error: {code: "unavailable"}}, 503)});
        const items = await openMenu(harness);
        items[1]!.click();

        await vi.waitFor(() => expect(shell(harness).querySelector("nav")?.textContent).toContain(zhCN.errors.identity.unavailable));
        expect(harness.site.router.currentRoute.value.path).toBe("/admin/users");
    });
});
