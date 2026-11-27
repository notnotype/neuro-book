/**
 * 从上游点返回、页面由往返缓存原样恢复（t10 计划“B3、B4 实现审查的处理”第 2 条）：发起社交登录或注册后页面停在“正在离开”，
 * 按钮都不能点；恢复时 `pageshow` 带着 `persisted`，页面要放开这个状态，否则人回来后什么都点不了。happy-dom 里只能手发事件
 * （`LoginPage.dom.test.ts`、`RegisterPage.dom.test.ts`），这里走真实浏览器的那条路。
 *
 * Playwright 启动 Chrome 时缺省关掉往返缓存，这个文件去掉那个开关；它要换一个浏览器进程，所以单放一个文件，不与别的场景共用。
 * “上游”是同一来源下截出来的空页面：截成 `github.com` 时，从别的站点回来的那次 Chrome 不用往返缓存（`notRestoredReasons` 报
 * `masked`），走的是重新加载，测不到要测的那条路（实验记录在 t10 的 B4 修正汇报里）。
 */

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";

import {installFakeIdentity} from "./fake-api";
import type {FakeIdentity} from "./fake-api";

test.use({launchOptions: {ignoreDefaultArgs: ["--disable-back-forward-cache"]}});

const UPSTREAM = "/upstream-stub";

let fake: FakeIdentity;

test.afterEach(() => {
    expect(fake.unexpected).toEqual([]);
});

/** 截下上游的地址，回一个空页面；记下每次 `pageshow` 是不是从往返缓存回来的：没走那条路时用例要失败，不能照样过。 */
async function prepare(page: Page, baseURL: string | undefined): Promise<void> {
    fake = await installFakeIdentity(page, {socialStart: () => ({status: 200, body: {url: new URL(UPSTREAM, baseURL).href}})});
    await page.route(`**${UPSTREAM}`, (route) => route.fulfill({status: 200, contentType: "text/html", body: "<!doctype html><title>upstream</title>"}));
    await page.addInitScript(() => {
        window.addEventListener("pageshow", (event) => {
            (window as unknown as {restoredFromCache?: boolean}).restoredFromCache = event.persisted;
        });
    });
    await page.setViewportSize({width: 1440, height: 900});
}

/** 卡片里每个按钮能不能点，按画出来的先后。 */
async function enabledButtons(page: Page): Promise<boolean[]> {
    return page.locator("[data-site-paper-card] button").evaluateAll((buttons) => buttons.map((button) => !(button as HTMLButtonElement).disabled));
}

/** 点了图标、到了上游之后点返回，等到页面确实是从往返缓存恢复的；之后每个按钮能不能点，与离开之前一样。 */
async function leaveAndComeBack(page: Page, path: RegExp): Promise<void> {
    const before = await enabledButtons(page);
    expect(before).toContain(true);
    await page.locator('[data-site-social-provider="github"]').click();
    await expect(page).toHaveURL(new RegExp(`${UPSTREAM}$`, "u"));
    // 截着请求的页面不进往返缓存：回去之前撤掉。恢复的页面在内存里，不再发请求。
    await page.unrouteAll({behavior: "ignoreErrors"});
    // 从往返缓存恢复的页面不再发 `load`，只等到地址提交。
    await page.goBack({waitUntil: "commit"});
    await expect(page).toHaveURL(path);
    await expect.poll(() => page.evaluate(() => (window as unknown as {restoredFromCache?: boolean}).restoredFromCache)).toBe(true);
    await expect.poll(() => enabledButtons(page)).toEqual(before);
}

test("登录页：发起社交登录、到了上游再点返回，图标与登录按钮又能点了，输入的还在", async ({page, baseURL}) => {
    await prepare(page, baseURL);
    await page.goto("/login");
    await page.locator('input[name="identifier"]').fill("alice");
    await page.locator('input[name="password"]').fill("correct horse");
    await expect(page.locator('[data-site-paper-card] button[type="submit"]')).toBeEnabled();
    await leaveAndComeBack(page, /\/login$/u);
    await expect(page.locator('[data-site-paper-card] button[type="submit"]')).toBeEnabled();
    await expect(page.locator('input[name="identifier"]')).toHaveValue("alice");
    await expect(page.locator('[data-site-social-provider="github"]')).toBeEnabled();
    await expect(page.locator('[data-site-social-provider="google"]')).toBeEnabled();
    expect(fake.socialStarts.map(({provider, body}) => ({provider, intent: body.intent}))).toEqual([{provider: "github", intent: "login"}]);
});

test("注册页：勾上两项同意、发起社交注册、到了上游再点返回，每个按钮能不能点与离开前一样，勾选还在", async ({page, baseURL}) => {
    await prepare(page, baseURL);
    await page.goto("/register");
    await page.locator('input[name="registrationCode"]').fill("CODE-1");
    await page.locator('input[name="username"]').fill("bob");
    for (const name of ["termsConsent", "overseasStorage"]) {
        await page.locator(`label:has(> input[name="${name}"]) > span`).first().click();
        await expect(page.locator(`input[name="${name}"]`)).toBeChecked();
    }
    await leaveAndComeBack(page, /\/register$/u);
    await expect(page.locator('[data-site-social-provider="github"]')).toBeEnabled();
    await expect(page.locator('[data-site-social-provider="google"]')).toBeEnabled();
    await expect(page.locator('input[name="termsConsent"]')).toBeChecked();
    await expect(page.locator('input[name="username"]')).toHaveValue("bob");
    expect(fake.socialStarts.map(({provider, body}) => ({provider, intent: body.intent}))).toEqual([{provider: "github", intent: "register"}]);
});
