/**
 * 站点作为 OAuth 提供方的浏览器场景（t10 计划 3.1、3.12、3.13；t09 第 5、7、12 条）：构建产物加假接口（`fake-api.ts`）。
 *
 * - 登录续接：从 `/login?continue=…` 登录后，浏览器整页到继续地址（假接口在授权端点回一页 HTML）。
 * - 授权确认页：允许、拒绝之后到客户端的地址（客户端的主机在这里另外接住）；过期的请求是整张说明卡片；1440、390、360 三种宽度、
 *   亮暗两种明暗下不能横向滚动；卡片与登录页的卡片在稿纸上的同一个位置；客户端名字是一长串不带空格的字时标题折行（B6、B7 审查第 2 条）。
 * - 客户端页：登记机密客户端后密钥只显示一次，换密钥后显示新的。
 *
 * 各页的逻辑在组件测试里（`OAuthConsentPage.dom.test.ts`、`LoginPage.dom.test.ts`、`admin/ClientsPage.dom.test.ts`）；
 * 客户端列表的版式随另外几个列表在 `admin-lists.e2e.ts`。
 */

import {readFileSync} from "node:fs";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";

import {fails, installFakeIdentity} from "./fake-api";
import type {FakeIdentity} from "./fake-api";
import {authorizationExpired, oauthAllowed, oauthAuthorization, oauthDenied, rotateSecretResponse, userLogin, userLoginContinued} from "./fixtures/identity";
import {box} from "./geometry";

const zhCN = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8")) as {
    readonly oauthConsent: {readonly heading: string; readonly ended: {readonly authorization_expired: {readonly title: string}}};
};

const VIEWPORTS = [
    {name: "1440", width: 1440, height: 900},
    {name: "390", width: 390, height: 844},
    {name: "360", width: 360, height: 800},
] as const;
const SCHEMES = ["light", "dark"] as const;

const REQUEST = "req_e2e_1";
const CONSENT_PAGE = `/oauth/consent?request=${REQUEST}`;
const TOKEN = "tok_e2e_1";

let fake: FakeIdentity;

test.afterEach(() => {
    expect(fake.unexpected).toEqual([]);
});

/** 客户端的主机不在站点里：接住整页跳过去的请求，回一页 HTML，好断言浏览器到了那里。 */
async function catchClient(page: Page): Promise<string[]> {
    const visits: string[] = [];
    await page.route("https://shelf.example.com/**", async (route) => {
        visits.push(route.request().url());
        await route.fulfill({status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><title>client</title><h1>客户端</h1>"});
    });
    return visits;
}

async function open(page: Page, path: string, viewport: {readonly width: number; readonly height: number} = VIEWPORTS[0], scheme: "light" | "dark" = "light"): Promise<void> {
    await page.setViewportSize(viewport);
    await page.emulateMedia({colorScheme: scheme});
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", scheme);
}

async function settled(page: Page): Promise<void> {
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState !== "finished").length)).toBe(0);
}

test("从 /login?continue= 登录：请求带着令牌，浏览器整页到继续地址", async ({page}) => {
    fake = await installFakeIdentity(page, {
        login: (body, current) => {
            current.session = "user";
            return {status: 200, body: body.continue === undefined ? userLogin : userLoginContinued};
        },
    });
    await open(page, `/login?continue=${TOKEN}`);
    await page.locator('input[name="identifier"]').fill("alice");
    await page.locator('input[name="password"]').fill("correct horse");
    await page.locator('[data-site-paper-card] button[type="submit"]').click();
    await expect(page.locator("h1")).toHaveText("授权端点");
    expect(fake.authorizeVisits).toEqual([userLoginContinued.continueUrl]);
    expect(fake.logins).toEqual([{identifier: "alice", password: "correct horse", continue: TOKEN}]);
});

test.describe("授权确认页", () => {
    for (const [label, button, expected] of [["允许", "[data-site-oauth-allow]", oauthAllowed], ["拒绝", "[data-site-oauth-deny]", oauthDenied]] as const) {
        test(`${label}：发一次确认，浏览器到客户端回来的地址`, async ({page}) => {
            fake = await installFakeIdentity(page, {session: "user"});
            const visits = await catchClient(page);
            await open(page, CONSENT_PAGE);
            await expect(page.locator("[data-site-oauth-heading]")).toHaveText(zhCN.oauthConsent.heading.replace("{{client}}", oauthAuthorization.clientName));
            await page.locator(button).click();
            await expect(page.locator("h1")).toHaveText("客户端");
            expect(visits).toEqual([expected.redirectUrl]);
            expect(fake.oauthDecisions).toEqual([{request: REQUEST, accept: label === "允许"}]);
        });
    }

    test("请求已经过期：整张说明卡片，没有按钮", async ({page}) => {
        fake = await installFakeIdentity(page, {session: "user", oauth: fails(400, authorizationExpired)});
        await open(page, CONSENT_PAGE);
        const card = page.locator('[data-site-oauth-ended="authorization_expired"]');
        await expect(card.locator("h1")).toHaveText(zhCN.oauthConsent.ended.authorization_expired.title);
        await expect(page.locator('[data-site-page="oauth-consent"] button')).toHaveCount(0);
    });

    test("360 宽、客户端名字是一长串不带空格的字：标题在卡片里折行，自己不溢出", async ({page}) => {
        // 名字取合同允许的最长（100 个字符），中间没有能折行的地方。只量页面能不能横向滚动看不出来：卡片裁掉了溢出的部分。
        const clientName = "BookshelfSynchronizationAssistant".repeat(4).slice(0, 100);
        fake = await installFakeIdentity(page, {session: "user", oauth: (method, _request, body) => (method === "GET" ? {status: 200, body: {...oauthAuthorization, clientName}} : {status: 200, body: body?.accept === true ? oauthAllowed : oauthDenied})});
        await open(page, CONSENT_PAGE, VIEWPORTS[2]);
        const heading = page.locator("[data-site-oauth-heading]");
        await expect(heading).toHaveText(zhCN.oauthConsent.heading.replace("{{client}}", clientName));
        await settled(page);
        const size = await heading.evaluate((element) => ({scroll: element.scrollWidth, client: element.clientWidth}));
        expect(size.scroll).toBeLessThanOrEqual(size.client);
        const [card, title] = [await box(page, "[data-site-paper-card]"), await box(page, "[data-site-oauth-heading]")];
        expect(title.x + title.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
    });

    for (const viewport of VIEWPORTS) {
        for (const scheme of SCHEMES) {
            test(`${viewport.name} 宽、${scheme === "light" ? "亮色" : "暗色"}：不能横向滚动；卡片与登录页的卡片在稿纸上的同一个位置、同样宽`, async ({page}) => {
                fake = await installFakeIdentity(page);
                await open(page, "/login", viewport, scheme);
                await expect(page.locator("[data-site-paper-card] form")).toBeVisible();
                await settled(page);
                const login = await box(page, "[data-site-paper-card]");

                fake.session = "user";
                await page.goto(CONSENT_PAGE);
                await expect(page.locator("[data-site-oauth-allow]")).toBeVisible();
                await settled(page);
                const consent = await box(page, "[data-site-paper-card]");
                expect({x: consent.x, y: consent.y, width: consent.width}).toEqual({x: login.x, y: login.y, width: login.width});

                const scrolled = await page.evaluate(() => {
                    window.scrollTo(100, 0);
                    return window.scrollX;
                });
                expect(scrolled).toBe(0);
                // 两个按钮并排、都在卡片里。
                const [deny, allow] = [await box(page, "[data-site-oauth-deny]"), await box(page, "[data-site-oauth-allow]")];
                expect(deny.y).toBe(allow.y);
                expect(allow.x + allow.width).toBeLessThanOrEqual(consent.x + consent.width + 0.5);
            });
        }
    }
});

test.describe("客户端页", () => {
    test("登记机密客户端：同一个对话框显示客户端 ID 与密钥；关掉再打开，密钥不在页面上了", async ({page}) => {
        fake = await installFakeIdentity(page, {session: "admin"});
        await open(page, "/admin/clients");
        await expect(page.locator('[data-site-admin-list="oauth-clients"] tbody tr').first()).toBeVisible();
        await page.locator("[data-site-admin-client-register]").click();
        const dialog = page.locator("[data-site-admin-client-dialog]");
        await dialog.locator('input[name="name"]').fill("书签同步");
        await dialog.locator('textarea[name="redirectUris"]').fill("https://bookmark.example.com/callback");
        await dialog.locator("[data-site-admin-client-submit]").click();
        const secret = dialog.locator("[data-site-admin-created-secret]");
        await expect(secret).toBeVisible();
        const shown = (await secret.textContent()) ?? "";
        expect(shown).not.toBe("");
        await expect(page.locator('[data-site-admin-list="oauth-clients"]')).toContainText("书签同步");

        await dialog.locator("[data-site-admin-client-finish]").click();
        await expect(dialog).toHaveCount(0);
        await page.locator("[data-site-admin-client-register]").click();
        await expect(page.locator('[data-site-admin-client-dialog][data-site-admin-client-step="form"]')).toBeVisible();
        expect(await page.evaluate((value) => document.body.textContent?.includes(value) === true, shown)).toBe(false);
    });

    test("换密钥：确认后显示新密钥", async ({page}) => {
        fake = await installFakeIdentity(page, {session: "admin"});
        await open(page, "/admin/clients");
        const first = fake.oauthClients.find((client) => client.type === "confidential" && !client.disabled)!;
        await page.locator(`[data-site-admin-row-menu="${first.clientId}"]`).click();
        await page.getByRole("menuitem", {name: "换密钥"}).click();
        const dialog = page.locator("[data-site-admin-rotate-dialog]");
        await dialog.locator("[data-site-admin-rotate-confirm]").click();
        await expect(dialog.locator("[data-site-admin-rotated-secret]")).toHaveText(rotateSecretResponse.clientSecret);
    });
});
