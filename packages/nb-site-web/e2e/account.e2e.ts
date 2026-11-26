/**
 * 账号页的浏览器场景（t10 计划 3.12；t09 第 8、11 条）：构建产物加假接口，量真实布局。有邮箱与没有邮箱（上游注册、待补）两种账号
 * 各节的位置完全相同；1440、390、360 三种宽度、亮暗两种明暗下页面不能横向滚动；滚动时目录高亮跟着走；状态行出现与消失时各节的
 * 内容不移动。每一节的逻辑（请求、状态行的字、焦点）在 `src/pages/account/AccountPage.dom.test.ts`。
 */

import {readFileSync} from "node:fs";

import {IDENTITY_API_PREFIX, IDENTITY_PATHS} from "@notnotype/nb-site-identity-contract";
import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";

import {installFakeIdentity} from "./fake-api";
import type {FakeIdentity} from "./fake-api";
import {userMe, userMeWithoutEmail} from "./fixtures/identity";
import {boxes} from "./geometry";
import type {Box} from "./geometry";

const zhCN = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8")) as {
    readonly account: {readonly saved: string; readonly profile: {readonly emailPending: string}};
    readonly errors: {readonly identity: Readonly<Record<string, string>>};
};

const VIEWPORTS = [
    {name: "1440", width: 1440, height: 900},
    {name: "390", width: 390, height: 844},
    {name: "360", width: 360, height: 800},
] as const;
const SCHEMES = ["light", "dark"] as const;
const SECTIONS = ["profile", "security", "sessions", "invites"] as const;

let fake: FakeIdentity;

test.afterEach(() => {
    expect(fake.unexpected).toEqual([]);
});

/** 打开账号页，等四节都画出来、过渡跑完。 */
async function openAccount(page: Page, viewport: {readonly width: number; readonly height: number}, scheme: "light" | "dark"): Promise<void> {
    await page.setViewportSize(viewport);
    await page.emulateMedia({colorScheme: scheme});
    await page.goto("/account");
    await expect(page.locator("[data-site-account-section]")).toHaveCount(SECTIONS.length);
    await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", scheme);
    await settled(page);
}

async function settled(page: Page): Promise<void> {
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState !== "finished").length)).toBe(0);
}

/**
 * 版式上要对齐的东西：各节的标题、每个输入框、目录的每一项、各节的外框。“待补”只在邮箱格里占位，所以换成没有邮箱的账号时，
 * 它们一个都不该动。
 */
async function layout(page: Page): Promise<Record<string, Box[]>> {
    return {
        titles: await boxes(page, "[data-site-account-section-title]"),
        sections: await boxes(page, "[data-site-account-section]"),
        fields: await boxes(page, "[data-site-account-section] input[name], [data-site-account-section] textarea[name]"),
        toc: await boxes(page, "[data-site-account-toc-item]"),
    };
}

for (const viewport of [VIEWPORTS[0], VIEWPORTS[1]]) {
    test(`${viewport.name} 宽：有邮箱与没有邮箱的账号，各节标题、输入框、目录与各节外框的位置相同；没有邮箱时邮箱格里看得见“待补”`, async ({page}) => {
        fake = await installFakeIdentity(page, {session: "user", me: userMe});
        await openAccount(page, viewport, "light");
        const withEmail = await layout(page);
        await expect(page.locator("[data-site-account-email-pending]")).toBeHidden();

        fake.me = userMeWithoutEmail;
        await page.reload();
        await expect(page.locator("[data-site-account-section]")).toHaveCount(SECTIONS.length);
        await settled(page);
        await expect(page.locator("[data-site-account-email-pending]")).toBeVisible();
        await expect(page.locator("[data-site-account-email-pending]")).toHaveText(zhCN.account.profile.emailPending);
        await expect(page.locator('[data-site-account-toc-item="profile"] [data-site-account-toc-dot]')).toHaveAttribute("data-site-account-toc-dot", "on");

        expect(await layout(page)).toEqual(withEmail);
        expect(withEmail.fields.length).toBeGreaterThan(0);
    });
}

for (const viewport of VIEWPORTS) {
    for (const scheme of SCHEMES) {
        test(`${viewport.name} 宽、${scheme === "light" ? "亮色" : "暗色"}：页面不能横向滚动，各节不超出视口`, async ({page}) => {
            fake = await installFakeIdentity(page, {session: "user"});
            await openAccount(page, viewport, scheme);

            const scrolled = await page.evaluate(() => {
                window.scrollTo(100, window.scrollY);
                return window.scrollX;
            });
            expect(scrolled).toBe(0);
            for (const section of await boxes(page, "[data-site-account-section]")) {
                expect(section.x).toBeGreaterThanOrEqual(0);
                expect(section.x + section.width).toBeLessThanOrEqual(viewport.width + 0.5);
            }
        });
    }
}

/** 目录里标为当前的那一项。 */
async function currentTocItem(page: Page): Promise<string | null> {
    return page.locator('[data-site-account-toc-item][aria-current="location"]').getAttribute("data-site-account-toc-item");
}

for (const viewport of [VIEWPORTS[0], VIEWPORTS[1]]) {
    test(`${viewport.name} 宽：滚动时目录高亮跟着走，滚到底高亮最后一节；点目录滚到那一节`, async ({page}) => {
        fake = await installFakeIdentity(page, {session: "user"});
        // 矮一点的视口：四节在 1440 宽时也放不下一屏，滚动才有意义。
        await openAccount(page, {width: viewport.width, height: 600}, "light");
        expect(await currentTocItem(page)).toBe("profile");

        // 用滚轮滚（像人那样），每一节的标题滚到视口上部之后，那一节成为当前。
        for (const id of ["security", "sessions"] as const) {
            const top = await page.locator(`[data-site-account-section="${id}"]`).evaluate((element) => element.getBoundingClientRect().top);
            await page.mouse.move(viewport.width / 2, 300);
            await page.mouse.wheel(0, top - 40);
            await expect.poll(() => currentTocItem(page)).toBe(id);
        }

        await page.mouse.wheel(0, 100_000);
        await expect.poll(() => currentTocItem(page)).toBe("invites");

        await page.evaluate(() => window.scrollTo(0, 0));
        await expect.poll(() => currentTocItem(page)).toBe("profile");
        await page.locator('[data-site-account-toc-item="sessions"]').click();
        await expect(page).toHaveURL(/#sessions$/u);
        await expect.poll(() => currentTocItem(page)).toBe("sessions");
        const sectionTop = await page.locator('[data-site-account-section="sessions"]').evaluate((element) => element.getBoundingClientRect().top);
        // 窄屏时目录是顶上吸附的一排标签，节的 `scroll-margin-top` 给它让出位置；宽屏时只留一点边距。
        expect(sectionTop).toBeGreaterThanOrEqual(0);
        expect(sectionTop).toBeLessThan(100);
    });
}

for (const viewport of [VIEWPORTS[0], VIEWPORTS[1]]) {
    test(`${viewport.name} 宽：关联没成、带着 social_error 回来，地址换成 #security，页面滚到“登录与安全”、目录高亮它`, async ({page}) => {
        fake = await installFakeIdentity(page, {session: "user"});
        await page.setViewportSize({width: viewport.width, height: 600});
        await page.goto("/account?social_error=identity_taken");
        await expect(page).toHaveURL(/\/account#security$/u);
        const security = page.locator('[data-site-account-section="security"]');
        await expect(security.locator("[data-site-form-status]")).toContainText(zhCN.errors.identity.identity_taken);
        await settled(page);
        const top = await security.evaluate((element) => element.getBoundingClientRect().top);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(top).toBeLessThan(100);
        expect(await currentTocItem(page)).toBe("security");
    });
}

for (const viewport of [VIEWPORTS[0], VIEWPORTS[2]]) {
    test(`${viewport.name} 宽：“已保存”出现与 3 秒后消失时，各节的内容都不移动`, async ({page}) => {
        fake = await installFakeIdentity(page, {session: "user"});
        await openAccount(page, viewport, "light");
        const displayName = page.locator('[data-site-account-section="profile"] input[name="displayName"]');
        await displayName.fill("老猫");
        // 输入后“保存”可用，这时量的版式里已含输入框的新值；之后只有状态行在变。
        await expect(page.locator("[data-site-account-save]")).toBeEnabled();
        await settled(page);
        const before = await layout(page);
        const saveBefore = await boxes(page, "[data-site-account-save]");

        await page.locator("[data-site-account-save]").click();
        const status = page.locator('[data-site-account-section="profile"] [data-site-form-status]');
        await expect(status).toContainText(zhCN.account.saved);
        await settled(page);
        expect(await layout(page)).toEqual(before);
        expect(await boxes(page, "[data-site-account-save]")).toEqual(saveBefore);
        expect(fake.accountChanges).toEqual([{request: `PATCH ${IDENTITY_API_PREFIX}${IDENTITY_PATHS.me}`, body: {displayName: "老猫"}}]);

        // 3 秒后清掉：等可观察的状态，不按固定时长等。
        await expect(status).not.toContainText(zhCN.account.saved, {timeout: 6_000});
        await settled(page);
        expect(await layout(page)).toEqual(before);
    });
}
