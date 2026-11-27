/**
 * 管理面板四个列表页的浏览器场景（t10 计划 3.13；t09 第 12 条）：构建产物加假接口（`fake-api.ts`，五张表在 `fixtures/identity.ts`），
 * 以管理员的会话打开，量 happy-dom 量不了的：工具条、表格、页脚三块位置固定，只有表格区滚、页面不滚；最后一页不满时分页条仍在底部；
 * 多于 7 页时分页条 7 格；刷新与后退回到同一页；1440 与 1024 两种桌面宽、亮暗两种明暗下没有页面级的横向滚动；表格出错、对话框的
 * 状态行出现与消失都不推动布局。筛选、搜索、请求与各项处置在各页的组件测试里（`src/pages/admin/*Page.dom.test.ts`）。
 */

import {readFileSync} from "node:fs";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";

import {fails, installFakeIdentity} from "./fake-api";
import type {FakeIdentity} from "./fake-api";
import {box} from "./geometry";

const zhCN = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8")) as {
    readonly admin: {
        readonly users: {readonly actions: {readonly ban: {readonly menu: string}}; readonly filters: {readonly banned: string}};
        readonly codes: {readonly issue: {readonly rules: {readonly maxUses: string}}};
    };
    readonly errors: {readonly identity: {readonly not_found: string; readonly unavailable: string}};
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
    await page.getByRole("menuitem", {name: zhCN.admin.users.actions.ban.menu}).click();
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
    await expect(issue.locator("[data-dialog-status]")).toHaveText(zhCN.admin.codes.issue.rules.maxUses);
    expect({dialog: await box(page, "[data-site-admin-issue-dialog]"), submit: await box(page, "[data-site-admin-issue-submit]")}).toEqual(empty);
    await issue.locator('input[name="maxUses"]').fill("3");
    await expect(issue.locator("[data-dialog-status]")).toHaveText("");
    expect({dialog: await box(page, "[data-site-admin-issue-dialog]"), submit: await box(page, "[data-site-admin-issue-submit]")}).toEqual(empty);
});
