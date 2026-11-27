/**
 * 管理面板的外壳（`AdminShell.vue`）：装起整个站点（`testing/site-harness.ts`），以管理员身份打开。断言左栏导航有哪几项、当前页
 * 标在哪一项、在几页之间走时外壳不重建，与左下角用户菜单的账号页、外观、退出登录。没有页面级横向滚动、内容区的高度要真实布局，
 * 在 `e2e/dashboard.e2e.ts`；菜单与按钮同宽、内容区在宽窗口里居中、首帧的明暗在 `e2e/admin-lists.e2e.ts` 与 `e2e/login.e2e.ts`。
 */

import {IDENTITY_PATHS} from "@notnotype/nb-site-identity-contract/constants";
import {afterEach, describe, expect, it, vi} from "vitest";

import zhCN from "../../locales/zh-CN.json";
import {APPEARANCE_KEY} from "../../host/storage";
import {cleanUp, failure, identityUrl, menuClosed, openMenu, openSubmenu, pressEscape, radioStates, settledAt, startAt, stopKeepingStorage} from "../../testing/site-harness";
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
async function openUserMenu(harness: Harness): Promise<HTMLElement[]> {
    await openMenu(shell(harness).querySelector<HTMLElement>("[data-site-admin-menu]")!);
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
    it("写着当前管理员的用户名；菜单里是账号页、外观与退出登录，点账号页去账号页", async () => {
        const harness = await openAdmin("/admin/users", "admin-users");
        const trigger = shell(harness).querySelector<HTMLButtonElement>("[data-site-admin-menu]")!;
        expect(trigger.textContent).toContain("alice");
        expect(trigger.getAttribute("aria-label")).toBe(zhCN.account.menu.replace("{{username}}", "alice"));

        const items = await openUserMenu(harness);
        expect(items.map((item) => item.textContent?.trim())).toEqual([adminZhCN.admin.accountPage, zhCN.account.appearance.title, zhCN.account.signOut]);
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
        const items = await openUserMenu(harness);
        items[2]!.click();

        await settledAt(harness, "/", "home");
        expect(harness.requests.filter((request) => request.method !== "GET")).toEqual([{method: "POST", path: LOGOUT, body: undefined}]);
        expect(harness.site.account.state.value).toEqual({kind: "anonymous"});
    });

    it("退出登录没成：留在这一页，菜单上方写原因", async () => {
        const harness = await openAdmin("/admin/users", "admin-users", {[`POST ${LOGOUT}`]: () => failure({error: {code: "unavailable"}}, 503)});
        const items = await openUserMenu(harness);
        items[2]!.click();

        await vi.waitFor(() => expect(shell(harness).querySelector("nav")?.textContent).toContain(zhCN.errors.identity.unavailable));
        expect(harness.site.router.currentRoute.value.path).toBe("/admin/users");
    });
});

describe("外观", () => {
    const APPEARANCE = zhCN.account.appearance;
    const trigger = (harness: Harness): HTMLElement => shell(harness).querySelector<HTMLElement>("[data-site-admin-menu]")!;

    it("子菜单是跟随系统、亮色、暗色，当前的打勾；选暗色后整站换成暗色并存下，刷新后仍是暗色；选回跟随系统按系统的明暗", async () => {
        const harness = await openAdmin("/admin/users", "admin-users");
        const radios = await openSubmenu(trigger(harness), APPEARANCE.title);
        expect(radioStates(radios)).toEqual([
            {label: APPEARANCE.system, checked: true},
            {label: APPEARANCE.light, checked: false},
            {label: APPEARANCE.dark, checked: false},
        ]);

        radios[2]!.click();
        await menuClosed(trigger(harness));
        expect(document.documentElement.dataset.nbAppearance).toBe("dark");
        expect(window.localStorage.getItem(APPEARANCE_KEY)).toBe("dark");
        expect(radioStates(await openSubmenu(trigger(harness), APPEARANCE.title)).map((radio) => radio.checked)).toEqual([false, false, true]);
        pressEscape(document.activeElement as HTMLElement);
        await menuClosed(trigger(harness));

        // 刷新：停掉站点、存储照旧，再从同一页装起来。happy-dom 的系统明暗是亮色。
        stopKeepingStorage(harness);
        const reloaded = await openAdmin("/admin/users", "admin-users");
        expect(document.documentElement.dataset.nbAppearance).toBe("dark");

        (await openSubmenu(trigger(reloaded), APPEARANCE.title))[0]!.click();
        await menuClosed(trigger(reloaded));
        expect(document.documentElement.dataset.nbAppearance).toBe("light");
        expect(window.localStorage.getItem(APPEARANCE_KEY)).toBe("system");
        expect(reloaded.site.router.currentRoute.value.path).toBe("/admin/users");
    });
});
