/**
 * 管理面板四个列表页的浏览器场景（t10 计划 3.13；t09 第 12 条）：构建产物加假接口（`fake-api.ts`，五张表在 `fixtures/identity.ts`），
 * 以管理员的会话打开，量 happy-dom 量不了的：工具条、表格、页脚三块位置固定，只有表格区滚、页面不滚；最后一页不满时分页条仍在底部；
 * 多于 7 页时分页条 7 格；刷新与后退回到同一页；1440 与 1024 两种桌面宽、亮暗两种明暗下没有页面级的横向滚动；表格出错、对话框的
 * 状态行出现与消失都不推动布局；占位的字在亮暗两种明暗下都是 `--text-muted` 的颜色（B6、B7 审查第 4 条）。筛选、搜索、请求与各项处置在各页的组件测试里（`src/pages/admin/*Page.dom.test.ts`）。
 *
 * 外壳（`AdminShell.vue`，开发者 2026-11-27 看演示后的两处修正与“外观”）：左下角的账号菜单与按钮同宽、左右边缘对齐；宽窗口里看板与
 * 四个列表页在内容区水平居中，1280 宽时不横向溢出；在菜单里选暗色后整站换成暗色、看板的图按暗色重画，刷新后仍是暗色，选回跟随系统
 * 按系统的明暗。菜单里有哪几项、勾的是哪一项在 `AdminShell.dom.test.ts`。
 */

import {readFileSync} from "node:fs";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";

import {fails, installFakeIdentity} from "./fake-api";
import type {FakeIdentity} from "./fake-api";
import {box} from "./geometry";

const zhCN = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8")) as {
    readonly errors: {readonly identity: {readonly not_found: string; readonly unavailable: string}};
    readonly account: {readonly appearance: {readonly title: string; readonly system: string; readonly light: string; readonly dark: string}};
};
/** 管理面板的文字在它自己的目录里（`src/pages/admin/text.ts`）。 */
const adminZhCN = JSON.parse(readFileSync(new URL("../src/pages/admin/locales/zh-CN.json", import.meta.url), "utf8")) as {
    readonly admin: {
        readonly users: {readonly actions: {readonly ban: {readonly menu: string}}; readonly filters: {readonly banned: string}; readonly neverSignedIn: string};
        readonly codes: {readonly issue: {readonly rules: {readonly maxUses: string}}; readonly noNote: string};
    };
};

const SCHEMES = ["light", "dark"] as const;
type Scheme = (typeof SCHEMES)[number];
/** 1440 是定稿的宽度；1024 是常见的窄一些的桌面宽。 */
const VIEWPORTS = [{name: "1440", width: 1440, height: 900}, {name: "1024", width: 1024, height: 768}] as const;

const PAGES = [
    {path: "/admin/users", list: "users"},
    {path: "/admin/codes", list: "registration-codes"},
    {path: "/admin/codes?kind=invite", list: "invite-codes"},
    {path: "/admin/clients", list: "oauth-clients"},
    {path: "/admin/audit", list: "audit"},
] as const;

let fake: FakeIdentity;

test.afterEach(() => {
    expect(fake.unexpected).toEqual([]);
});

async function openList(page: Page, path: string, list: string, viewport: {readonly width: number; readonly height: number} = VIEWPORTS[0], scheme: Scheme = "light"): Promise<void> {
    await page.setViewportSize(viewport);
    await page.emulateMedia({colorScheme: scheme});
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", scheme);
    await expect(page.locator(`[data-site-admin-list="${list}"] tbody tr`).first()).toBeVisible();
}

const table = (list: string): string => `[data-site-admin-list="${list}"]`;

/** 工具条、表格区、页脚三块的位置。 */
async function blocks(page: Page, list: string): Promise<{readonly bar: unknown; readonly body: unknown; readonly foot: unknown}> {
    return {bar: await box(page, `${table(list)} .nb-data-table-bar`), body: await box(page, `${table(list)} .nb-data-table-body`), foot: await box(page, `${table(list)} .nb-data-table-foot`)};
}

/** 页面、内容区与表格区各自多出来的像素（没有多出来时是 0）。 */
async function overflow(page: Page, list: string): Promise<{readonly pageX: number; readonly pageY: number; readonly mainX: number; readonly mainY: number; readonly tableY: number}> {
    return page.evaluate((selector) => {
        const root = document.documentElement;
        const main = document.querySelector("main")!;
        const scroller = document.querySelector(`${selector} .nb-data-table-body`)!.firstElementChild!;
        return {
            pageX: Math.max(0, root.scrollWidth - root.clientWidth),
            pageY: Math.max(0, root.scrollHeight - root.clientHeight),
            mainX: Math.max(0, main.scrollWidth - main.clientWidth),
            mainY: Math.max(0, main.scrollHeight - main.clientHeight),
            tableY: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
        };
    }, table(list));
}

for (const viewport of VIEWPORTS) {
    for (const scheme of SCHEMES) {
        test(`${viewport.name} ${scheme}：用户页只有表格区滚，工具条与页脚不动；多于 7 页时分页条 7 格；没有页面级横向滚动`, async ({page}) => {
            fake = await installFakeIdentity(page, {session: "admin"});
            await openList(page, "/admin/users", "users", viewport, scheme);
            await expect(page.locator(`${table("users")} tbody tr`)).toHaveCount(20);
            await expect(page.locator(`${table("users")} .nb-pagination-cell`)).toHaveCount(7);

            const sizes = await overflow(page, "users");
            expect({pageX: sizes.pageX, pageY: sizes.pageY, mainX: sizes.mainX, mainY: sizes.mainY}).toEqual({pageX: 0, pageY: 0, mainX: 0, mainY: 0});
            expect(sizes.tableY).toBeGreaterThan(0);

            const before = await blocks(page, "users");
            await page.locator(`${table("users")} .nb-data-table-body`).evaluate((body) => {
                body.firstElementChild!.scrollTop = 10_000;
            });
            await expect.poll(() => page.locator(`${table("users")} .nb-data-table-body`).evaluate((body) => body.firstElementChild!.scrollTop)).toBeGreaterThan(0);
            expect(await blocks(page, "users")).toEqual(before);
        });
    }

    test(`${viewport.name}：各个列表都没有页面级横向或纵向滚动`, async ({page}) => {
        fake = await installFakeIdentity(page, {session: "admin"});
        for (const {path, list} of PAGES) {
            await openList(page, path, list, viewport);
            const sizes = await overflow(page, list);
            expect({path, pageX: sizes.pageX, pageY: sizes.pageY, mainX: sizes.mainX, mainY: sizes.mainY}).toEqual({path, pageX: 0, pageY: 0, mainX: 0, mainY: 0});
            // 工具条只有一行：各个控件的竖直中线对齐，没有被挤到第二行。
            const centers = await page.locator(`${table(list)} .nb-data-table-bar`).locator("input, button, [role=combobox]").evaluateAll((elements) =>
                elements.filter((element) => element.getBoundingClientRect().height > 0).map((element) => {
                    const rect = element.getBoundingClientRect();
                    return rect.top + rect.height / 2;
                }),
            );
            expect({path, spread: centers.length === 0 ? 0 : Math.round(Math.max(...centers) - Math.min(...centers))}).toEqual({path, spread: 0});
        }
    });
}

for (const scheme of SCHEMES) {
    test(`${scheme}：占位的字（没有登录过、没有备注）是 --text-muted 的颜色，与表格正文分得开`, async ({page}) => {
        fake = await installFakeIdentity(page, {session: "admin"});
        for (const {path, list, placeholder} of [
            {path: "/admin/users", list: "users", placeholder: adminZhCN.admin.users.neverSignedIn},
            {path: "/admin/codes", list: "registration-codes", placeholder: adminZhCN.admin.codes.noNote},
        ]) {
            await openList(page, path, list, VIEWPORTS[0], scheme);
            const cell = page.locator(`${table(list)} tbody td`).filter({hasText: new RegExp(`^${placeholder}$`, "u")}).first();
            // 拿同一个单元格里一个只设了 `--text-muted` 的探针作对照：主题的值在亮暗之间会变，照计算值比，不抄色号。
            const colors = await cell.evaluate((td, text) => {
                const span = [...td.querySelectorAll("span")].find((element) => element.textContent?.trim() === text)!;
                const probe = document.createElement("span");
                probe.style.color = "var(--text-muted)";
                td.append(probe);
                const muted = getComputedStyle(probe).color;
                probe.remove();
                return {placeholder: getComputedStyle(span).color, muted, row: getComputedStyle(td).color};
            }, placeholder);
            expect({path, color: colors.placeholder}).toEqual({path, color: colors.muted});
            expect(colors.row).not.toBe(colors.muted);
        }
    });
}

test("最后一页不满：分页条、表格区仍在原来的位置", async ({page}) => {
    fake = await installFakeIdentity(page, {session: "admin"});
    await openList(page, "/admin/users", "users");
    const full = await blocks(page, "users");
    await page.locator(`${table("users")} .nb-pagination-page`, {hasText: /^8$/u}).click();
    await expect(page).toHaveURL(/\?page=8$/u);
    await expect(page.locator(`${table("users")} tbody tr`)).toHaveCount(10);
    expect(await blocks(page, "users")).toEqual(full);
    expect((await overflow(page, "users")).tableY).toBe(0);
});

test("刷新与后退回到同一页", async ({page}) => {
    fake = await installFakeIdentity(page, {session: "admin"});
    await openList(page, "/admin/users", "users");
    await page.locator(`${table("users")} .nb-pagination-page`, {hasText: /^3$/u}).click();
    await expect(page).toHaveURL(/\?page=3$/u);
    await expect(page.locator(`${table("users")} tbody tr`).first()).toContainText("writer041");

    await page.reload();
    await expect(page.locator(`${table("users")} tbody tr`).first()).toContainText("writer041");
    await expect(page.locator(`${table("users")} .nb-pagination-page[aria-current="page"]`)).toHaveText("3");
    // 刷新丢掉了内存里的基准：刷新后的第一个请求不带它。
    expect(fake.adminRequests.at(-1)?.request).not.toContain("anchor=");

    await page.locator('[data-site-admin-filter] [role=radio][data-value="banned"]').click();
    await expect(page).toHaveURL(/\?filter=banned$/u);
    await page.goBack();
    await expect(page).toHaveURL(/\?page=3$/u);
    await expect(page.locator(`${table("users")} tbody tr`).first()).toContainText("writer041");
    await expect(page.locator(`${table("users")} .nb-pagination-page[aria-current="page"]`)).toHaveText("3");
});

test("列表取数失败：原因画在表格区里，工具条与页脚不动", async ({page}) => {
    fake = await installFakeIdentity(page, {session: "admin"});
    await openList(page, "/admin/users", "users");
    const ready = await blocks(page, "users");

    fake.admin = (request) => (request.startsWith("GET ") ? fails(503, {error: {code: "unavailable"}})() : undefined);
    await page.locator('[data-site-admin-filter] [role=radio][data-value="banned"]').click();
    await expect(page.locator(`${table("users")} [role=alert]`)).toContainText(zhCN.errors.identity.unavailable);
    expect(await blocks(page, "users")).toEqual(ready);
});

test("对话框的状态行出现与消失不推动布局：处置失败、发放注册码的规则", async ({page}) => {
    fake = await installFakeIdentity(page, {session: "admin", admin: (request) => (request.endsWith("/admin/users/5/ban") ? fails(404, {error: {code: "not_found"}})() : undefined)});
    await openList(page, "/admin/users", "users");
    await page.locator('[data-site-admin-row-menu="writer005"]').click();
    await page.getByRole("menuitem", {name: adminZhCN.admin.users.actions.ban.menu}).click();
    const dialog = page.locator("[data-site-admin-user-dialog]");
    await expect(dialog).toBeVisible();
    const before = {dialog: await box(page, "[data-site-admin-user-dialog]"), confirm: await box(page, "[data-site-admin-user-confirm]")};
    await page.locator("[data-site-admin-user-confirm]").click();
    await expect(dialog.locator("[data-dialog-status]")).toHaveText(zhCN.errors.identity.not_found);
    expect({dialog: await box(page, "[data-site-admin-user-dialog]"), confirm: await box(page, "[data-site-admin-user-confirm]")}).toEqual(before);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await page.goto("/admin/codes");
    await page.locator("[data-site-admin-issue]").click();
    const issue = page.locator("[data-site-admin-issue-dialog]");
    await expect(issue).toBeVisible();
    const empty = {dialog: await box(page, "[data-site-admin-issue-dialog]"), submit: await box(page, "[data-site-admin-issue-submit]")};
    await issue.locator('input[name="maxUses"]').fill("0");
    await issue.locator('input[name="note"]').focus();
    await expect(issue.locator("[data-dialog-status]")).toHaveText(adminZhCN.admin.codes.issue.rules.maxUses);
    expect({dialog: await box(page, "[data-site-admin-issue-dialog]"), submit: await box(page, "[data-site-admin-issue-submit]")}).toEqual(empty);
    await issue.locator('input[name="maxUses"]').fill("3");
    await expect(issue.locator("[data-dialog-status]")).toHaveText("");
    expect({dialog: await box(page, "[data-site-admin-issue-dialog]"), submit: await box(page, "[data-site-admin-issue-submit]")}).toEqual(empty);
});

test.describe("外壳", () => {
    const MENU_TRIGGER = "[data-site-admin-menu]";

    /** 点开左下角的账号菜单，等菜单浮层（reka 的菜单内容，`role="menu"` 的第一块）画出来。 */
    async function openShellMenu(page: Page): Promise<void> {
        await page.locator(MENU_TRIGGER).click();
        await expect(page.getByRole("menuitem", {name: zhCN.account.appearance.title})).toBeVisible();
    }

    /** 在账号菜单的“外观”子菜单里选一项，等菜单收起。 */
    async function chooseAppearance(page: Page, label: string): Promise<void> {
        await openShellMenu(page);
        await page.getByRole("menuitem", {name: zhCN.account.appearance.title}).click();
        await page.getByRole("menuitemradio", {name: label}).click();
        await expect(page.getByRole("menuitemradio")).toHaveCount(0);
    }

    test("1440 宽：左下角的账号菜单与按钮同宽、左右边缘对齐", async ({page}) => {
        fake = await installFakeIdentity(page, {session: "admin"});
        await openList(page, "/admin/users", "users");
        await openShellMenu(page);
        const menu = page.locator('[role="menu"]').first();
        // 宽度取 reka 写在菜单浮层上的触发器宽度：先确认它在这个元素上有值，不是退回了缺省宽度碰巧相等。
        const triggerWidth = await menu.evaluate((element) => getComputedStyle(element).getPropertyValue("--reka-dropdown-menu-trigger-width").trim());
        expect(triggerWidth).toMatch(/^\d+(?:\.\d+)?px$/u);
        const trigger = await page.locator(MENU_TRIGGER).boundingBox();
        const surface = await menu.boundingBox();
        const edges = {left: Math.abs(surface!.x - trigger!.x), right: Math.abs(surface!.x + surface!.width - (trigger!.x + trigger!.width))};
        expect(edges.left, JSON.stringify({trigger, surface})).toBeLessThanOrEqual(1);
        expect(edges.right, JSON.stringify({trigger, surface})).toBeLessThanOrEqual(1);
    });

    test("1920 宽：看板与四个列表页在内容区里水平居中；1280 宽时占满内容区，不横向溢出", async ({page}) => {
        fake = await installFakeIdentity(page, {session: "admin"});
        // 每一页等到内容画出来再量：看板等它的页面根，列表等第一行。
        const pages = [{path: "/admin", ready: '[data-site-page="admin-dashboard"]'}, ...PAGES.map(({path, list}) => ({path, ready: `${table(list)} tbody tr`}))];
        for (const viewport of [{width: 1920, height: 1080}, {width: 1280, height: 800}]) {
            await page.setViewportSize(viewport);
            for (const {path, ready} of pages) {
                await page.goto(path);
                await expect(page.locator(ready).first()).toBeVisible();
                // 内容区的可用宽度不含它自己的滚动条（看板比内容区高，内容区出竖向滚动条）。
                const gaps = await page.evaluate(() => {
                    const main = document.querySelector<HTMLElement>(".admin-main")!;
                    const content = document.querySelector<HTMLElement>(".admin-main__page")!.getBoundingClientRect();
                    const area = main.getBoundingClientRect();
                    return {
                        left: content.left - area.left,
                        right: area.left + main.clientWidth - content.right,
                        width: content.width,
                        mainX: Math.max(0, main.scrollWidth - main.clientWidth),
                        pageX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
                    };
                });
                const label = `${viewport.width} ${path}`;
                expect({label, mainX: gaps.mainX, pageX: gaps.pageX}).toEqual({label, mainX: 0, pageX: 0});
                if (viewport.width === 1920) {
                    expect({label, width: gaps.width}).toEqual({label, width: 1280});
                    expect(Math.abs(gaps.left - gaps.right), `${label} ${JSON.stringify(gaps)}`).toBeLessThanOrEqual(1);
                    expect(gaps.left, label).toBeGreaterThan(0);
                } else {
                    expect({label, left: Math.round(gaps.left), right: Math.round(gaps.right)}).toEqual({label, left: 0, right: 0});
                }
            }
        }
    });

    test("外观：系统是亮色时选暗色，整站换成暗色、看板的图按暗色重画，刷新后仍是暗色；选回跟随系统按系统的亮色", async ({page}) => {
        fake = await installFakeIdentity(page, {session: "admin"});
        await page.setViewportSize(VIEWPORTS[0]);
        await page.emulateMedia({colorScheme: "light"});
        await page.goto("/admin");
        const html = page.locator("html");
        await expect(html).toHaveAttribute("data-nb-appearance", "light");
        await expect(page.locator('[data-site-chart="active"]')).toHaveAttribute("data-chart-appearance", "light");

        await chooseAppearance(page, zhCN.account.appearance.dark);
        await expect(html).toHaveAttribute("data-nb-appearance", "dark");
        await expect(page.locator('[data-site-chart="active"]')).toHaveAttribute("data-chart-appearance", "dark");
        expect(await html.evaluate((element) => getComputedStyle(element).colorScheme)).toBe("dark");

        await page.reload();
        await expect(page.locator('[data-site-chart="active"]')).toHaveAttribute("data-chart-appearance", "dark");
        await expect(html).toHaveAttribute("data-nb-appearance", "dark");

        await chooseAppearance(page, zhCN.account.appearance.system);
        await expect(html).toHaveAttribute("data-nb-appearance", "light");
        await expect(page.locator('[data-site-chart="active"]')).toHaveAttribute("data-chart-appearance", "light");
        expect(await html.evaluate((element) => getComputedStyle(element).colorScheme)).toBe("light");
    });
});
