/**
 * 注册页与同意页的浏览器场景（t10 计划 3.10 的验收档“主题变量或窄屏布局”；t09 第 5、7、10 条；审定 D3）：构建产物加假接口。
 * 量的是真实布局与真实浏览器才有的东西：1440、390、360 三种宽度、亮暗两种明暗下页面不能横向滚动、卡片落在格线上、社交图标在
 * 表单下面；注册的拒绝出现时表单各部件不动；稿纸页之间切换时稿纸是同一个元素；两枚标志的画法（截图里数颜色）与读屏名字；
 * 社交注册跳去上游、带着 `social_error` 回来时，同一个标签页的 `sessionStorage` 把表单还原。表单的逻辑在两页的 dom 测试里。
 */

import {readFileSync} from "node:fs";

import {expect, test} from "@playwright/test";
import type {Locator, Page} from "@playwright/test";

import {fails, installFakeIdentity} from "./fake-api";
import type {FakeIdentity} from "./fake-api";
import {meta, socialStartResponse, usernameTaken} from "./fixtures/identity";
import {box, boxes, onGrid} from "./geometry";
import type {Box} from "./geometry";

/** 站点的中文目录：断言里的文字从这里取，改文案时场景不跟着坏。 */
const zhCN = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8")) as {
    readonly social: {readonly login: Readonly<Record<string, string>>; readonly register: Readonly<Record<string, string>>};
    readonly errors: {readonly identity: Readonly<Record<string, string>>};
};

const VIEWPORTS = [
    {name: "1440", width: 1440, height: 900},
    {name: "390", width: 390, height: 844},
    {name: "360", width: 360, height: 800},
] as const;
const SCHEMES = ["light", "dark"] as const;
type Scheme = (typeof SCHEMES)[number];

let fake: FakeIdentity;

test.afterEach(() => {
    expect(fake.unexpected).toEqual([]);
});

async function open(page: Page, viewport: {readonly width: number; readonly height: number}, scheme: Scheme, path: string, form = "form"): Promise<void> {
    await page.setViewportSize(viewport);
    await page.emulateMedia({colorScheme: scheme});
    await page.goto(path);
    await expect(page.locator(`[data-site-paper-card] ${form}`)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", scheme);
}

/** 横向滚得动就是有横向溢出（`login.e2e.ts` 同一种量法）。 */
async function horizontalScroll(page: Page): Promise<number> {
    return page.evaluate(() => {
        window.scrollTo(100, window.scrollY);
        return window.scrollX;
    });
}

/**
 * 两项同意都勾上：像用户那样点方框。nb-ui 的勾选框把 input 做成只给读屏的（sr-only），上面盖着 label，
 * Playwright 的 `check()` 点 input 会被 label 挡住、一直重试。
 */
async function agreeToBoth(page: Page): Promise<void> {
    for (const name of ["termsConsent", "overseasStorage"]) {
        await page.locator(`label:has(> input[name="${name}"]) > span`).first().click();
        await expect(page.locator(`input[name="${name}"]`)).toBeChecked();
    }
}

/** 卡片相对稿纸的偏移落在格线上、宽 9 格、不出视口。 */
async function cardOnGrid(page: Page, viewportWidth: number): Promise<void> {
    const grid = await page.locator("[data-site-paper-sheet]").evaluate((element) => {
        const style = getComputedStyle(element);
        return {cell: Number.parseFloat(style.getPropertyValue("--paper-cell")), row: Number.parseFloat(style.getPropertyValue("--paper-row"))};
    });
    const sheet = await box(page, "[data-site-paper-sheet]");
    const card = await box(page, "[data-site-paper-card]");
    expect({left: onGrid(card.x - sheet.x, grid.cell), top: onGrid(card.y - sheet.y, grid.row), width: card.width}).toEqual({left: true, top: true, width: 9 * grid.cell});
    expect(card.x + card.width).toBeLessThanOrEqual(viewportWidth);
}

for (const viewport of VIEWPORTS) {
    for (const scheme of SCHEMES) {
        const label = `${viewport.name} 宽、${scheme === "light" ? "亮色" : "暗色"}`;

        test(`注册页 ${label}：不能横向滚动，卡片落在格线上，社交图标在提交按钮下面一行居中、在卡片里`, async ({page}) => {
            fake = await installFakeIdentity(page);
            await open(page, viewport, scheme, "/register");
            expect(await horizontalScroll(page)).toBe(0);
            await cardOnGrid(page, viewport.width);

            const buttons = page.locator("[data-site-social-provider]");
            await expect(buttons).toHaveCount(2);
            await expect(buttons.first()).toBeEnabled();
            const card = await box(page, "[data-site-paper-card]");
            const submit = await box(page, "[data-site-paper-card] button[type=submit]");
            const icons = await boxes(page, "[data-site-social-provider]");
            expect(icons.map((icon) => ({width: icon.width, height: icon.height}))).toEqual([{width: 38, height: 38}, {width: 38, height: 38}]);
            // 同一行，在提交按钮下面，两枚之间 16px，整行在卡片的中线上。
            expect(icons[0]!.y).toBe(icons[1]!.y);
            expect(icons[0]!.y).toBeGreaterThan(submit.y + submit.height);
            expect(icons[1]!.x - (icons[0]!.x + icons[0]!.width)).toBe(16);
            const middle = (icons[0]!.x + icons[1]!.x + icons[1]!.width) / 2;
            expect(Math.abs(middle - (card.x + card.width / 2))).toBeLessThan(1);
            expect(icons[1]!.y + icons[1]!.height).toBeLessThanOrEqual(card.y + card.height);
        });

        test(`同意页 ${label}：不能横向滚动，卡片落在格线上，两份条款的版本号在`, async ({page}) => {
            fake = await installFakeIdentity(page, {session: "user", consentRequired: true});
            await open(page, viewport, scheme, "/consent");
            await expect(page.locator("[data-site-consent-version]").first()).toHaveText(`${meta.termsVersion} 版`);
            expect(await horizontalScroll(page)).toBe(0);
            await cardOnGrid(page, viewport.width);
            const card = await box(page, "[data-site-paper-card]");
            const buttons = await boxes(page, "[data-site-paper-card] button");
            expect(buttons.every((button) => button.x >= card.x && button.x + button.width <= card.x + card.width)).toBe(true);
        });
    }
}

test.describe("注册的拒绝不推动表单", () => {
    async function layout(page: Page): Promise<Box[]> {
        return boxes(page, "[data-site-paper-card], [data-site-paper-card] input:not([type=checkbox]), [data-site-paper-card] label:has(input[type=checkbox]), [data-site-form-status], [data-site-paper-card] button");
    }

    async function fill(page: Page): Promise<void> {
        await page.locator('input[name="registrationCode"]').fill("CODE-1");
        await page.locator('input[name="username"]').fill("bob");
        await page.locator('input[name="email"]').fill("bob@example.com");
        await page.locator('input[name="password"]').fill("correct horse");
        await agreeToBoth(page);
    }

    for (const viewport of VIEWPORTS) {
        test(`${viewport.name} 宽：username_taken 出现时字段、勾选框、按钮与社交图标的位置不变`, async ({page}) => {
            fake = await installFakeIdentity(page, {register: fails(409, usernameTaken)});
            await open(page, viewport, "light", "/register");
            await expect(page.locator("[data-site-social-provider]").first()).toBeEnabled();
            await fill(page);
            const before = await layout(page);
            await page.locator('button[type="submit"]').click();
            await expect(page.locator("[data-site-form-status]")).toHaveAttribute("data-site-form-status-error", "");
            await expect(page.locator('input[name="username"]')).toHaveAttribute("aria-invalid", "true");
            await expect(page.locator('input[name="username"]')).toBeFocused();
            expect(await layout(page)).toEqual(before);
            expect(fake.registers).toHaveLength(1);
        });
    }
});

test("登录页与注册页之间来回切换：稿纸始终是同一个元素", async ({page}) => {
    fake = await installFakeIdentity(page);
    await open(page, VIEWPORTS[0], "light", "/login");
    const paper = await page.locator("[data-site-paper]").elementHandle();
    const same = (): Promise<boolean> => page.evaluate((element) => element?.isConnected === true && document.querySelectorAll("[data-site-paper]").length === 1 && document.querySelector("[data-site-paper]") === element, paper);

    await page.locator('[data-site-paper-card] a[href="/register"]').click();
    await expect(page.locator('[data-site-paper-card] [data-site-page="register"]')).toBeVisible();
    expect(await same()).toBe(true);
    await page.locator('[data-site-paper-card] a[href="/login"]').click();
    await expect(page.locator('[data-site-paper-card] [data-site-page="login"]')).toBeVisible();
    expect(await same()).toBe(true);
});

/** 截图里的颜色：有颜色的像素按色相分到红、黄、绿、蓝四格，另数很暗与很亮的像素。截图用画布读（data URL 的图不污染画布）。 */
interface Colors {
    readonly red: number;
    readonly yellow: number;
    readonly green: number;
    readonly blue: number;
    readonly saturated: number;
    readonly dark: number;
    readonly light: number;
}

async function colorsOf(page: Page, target: Locator): Promise<Colors> {
    const png = await target.screenshot({animations: "disabled"});
    return page.evaluate(async (source) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const {data} = context.getImageData(0, 0, canvas.width, canvas.height);
        const counts = {red: 0, yellow: 0, green: 0, blue: 0, saturated: 0, dark: 0, light: 0};
        for (let index = 0; index < data.length; index += 4) {
            const [r, g, b] = [data[index]! / 255, data[index + 1]! / 255, data[index + 2]! / 255];
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const lightness = (max + min) / 2;
            if (lightness < 0.2) counts.dark += 1;
            if (lightness > 0.8) counts.light += 1;
            // 按色度（最大与最小通道之差）判有没有颜色，不按 HSL 饱和度：稿纸那种很浅的暖色在 HSL 里饱和度很高，
            // 从按钮面的圆角漏进截图，会被当成彩色。
            const delta = max - min;
            if (delta < 0.25) continue;
            counts.saturated += 1;
            let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
            hue = (hue * 60 + 360) % 360;
            if (hue < 20 || hue >= 340) counts.red += 1;
            else if (hue >= 35 && hue < 65) counts.yellow += 1;
            else if (hue >= 90 && hue < 170) counts.green += 1;
            else if (hue >= 190 && hue < 250) counts.blue += 1;
        }
        return counts;
    }, `data:image/png;base64,${png.toString("base64")}`);
}

test.describe("两枚标志", () => {
    for (const scheme of SCHEMES) {
        test(`${scheme === "light" ? "亮色" : "暗色"}：Google 是四色的“G”，GitHub 只有黑白；读屏名字按页面写“登录”或“注册”`, async ({page}) => {
            fake = await installFakeIdentity(page);
            for (const [path, intent] of [["/login", "login"], ["/register", "register"]] as const) {
                await open(page, VIEWPORTS[0], scheme, path);
                const github = page.locator('[data-site-social-provider="github"]');
                const google = page.locator('[data-site-social-provider="google"]');
                await expect(github).toHaveAccessibleName(zhCN.social[intent].github!);
                await expect(google).toHaveAccessibleName(zhCN.social[intent].google!);
                await expect(github).toHaveAttribute("title", zhCN.social[intent].github!);
                // 每枚只显示一份明暗的图，且已经画出来（不是坏图）。
                for (const button of [github, google]) {
                    const shown = await button.locator("img").evaluateAll((images) => images.filter((image) => getComputedStyle(image).display !== "none").map((image) => (image as HTMLImageElement).naturalWidth > 0));
                    expect(shown).toEqual([true]);
                }

                // 按钮面的底跟着明暗：亮色是白底、暗色是深底（两家规范里的两种按钮），所以底色的像素占多数。
                const background = (colors: Colors): "light" | "dark" => (colors.light > colors.dark ? "light" : "dark");
                const g = await colorsOf(page, google.locator(".social-face"));
                expect({red: g.red > 3, yellow: g.yellow > 3, green: g.green > 3, blue: g.blue > 3}).toEqual({red: true, yellow: true, green: true, blue: true});
                expect(background(g)).toBe(scheme);
                const octocat = await colorsOf(page, github.locator(".social-face"));
                // 单色：没有有颜色的像素；标志与底一深一浅，两种都有不少。
                expect(octocat.saturated).toBe(0);
                expect(Math.min(octocat.dark, octocat.light)).toBeGreaterThan(50);
                expect(background(octocat)).toBe(scheme);
            }
        });
    }
});

test.describe("真实构建里的主路径", () => {
    test("社交注册：跳去上游之前存下草稿，带着 social_error 回来时同一个标签页里还原表单，密码不在", async ({page}) => {
        fake = await installFakeIdentity(page, {socialStart: () => ({status: 200, body: socialStartResponse})});
        // 上游的授权页：截下来回一张空页，浏览器不真的出站。
        await page.route("https://github.com/**", (route) => route.fulfill({status: 200, contentType: "text/html", body: "<!doctype html><title>upstream</title>"}));
        await open(page, VIEWPORTS[0], "light", "/register");
        await expect(page.locator("[data-site-social-provider]").first()).toBeEnabled();
        await page.locator('input[name="registrationCode"]').fill("CODE-1");
        await page.locator('input[name="username"]').fill("bob");
        await page.locator('input[name="displayName"]').fill("鲍勃");
        await page.locator('input[name="password"]').fill("never stored");
        await page.locator('input[name="inviteCode"]').fill("INV-9");
        await agreeToBoth(page);
        await page.locator('[data-site-social-provider="github"]').click();
        await expect(page).toHaveURL(socialStartResponse.url);
        expect(fake.socialStarts).toEqual([{provider: "github", body: {intent: "register", username: "bob", displayName: "鲍勃", registrationCode: "CODE-1", inviteCode: "INV-9", termsVersion: meta.termsVersion, overseasStorage: true}}]);

        await page.goto("/register?social_error=email_taken");
        await expect(page).toHaveURL(/\/register$/u);
        await expect(page.locator("[data-site-form-status-text]")).toHaveText(zhCN.errors.identity.email_taken!);
        await expect(page.locator('input[name="registrationCode"]')).toHaveValue("CODE-1");
        await expect(page.locator('input[name="username"]')).toHaveValue("bob");
        await expect(page.locator('input[name="displayName"]')).toHaveValue("鲍勃");
        await expect(page.locator('input[name="inviteCode"]')).toHaveValue("INV-9");
        await expect(page.locator('input[name="password"]')).toHaveValue("");
        await expect(page.getByRole("checkbox").nth(0)).toBeChecked();
        await expect(page.getByRole("checkbox").nth(1)).toBeChecked();
        expect(await page.evaluate(() => window.sessionStorage.getItem("nb-site.social-register-draft"))).toBeNull();
    });

    test("密码注册成功进账号页；缺同意的用户补交之后回 next", async ({page}) => {
        fake = await installFakeIdentity(page);
        await open(page, VIEWPORTS[0], "light", "/register?invite=INV-42");
        await expect(page.locator('input[name="inviteCode"]')).toHaveValue("INV-42");
        await page.locator('input[name="registrationCode"]').fill("CODE-1");
        await page.locator('input[name="username"]').fill("bob");
        await page.locator('input[name="email"]').fill("bob@example.com");
        await page.locator('input[name="password"]').fill("correct horse");
        await agreeToBoth(page);
        await page.locator('button[type="submit"]').click();
        await expect(page).toHaveURL(/\/account$/u);
        expect(fake.registers).toEqual([{username: "bob", email: "bob@example.com", password: "correct horse", registrationCode: "CODE-1", inviteCode: "INV-42", termsVersion: meta.termsVersion, overseasStorage: true}]);

        fake.consentRequired = true;
        await page.goto("/consent?next=%2Faccount%23sessions");
        await expect(page.locator('[data-site-page="consent"]')).toBeVisible();
        await agreeToBoth(page);
        await page.locator('button[type="submit"]').click();
        await expect(page).toHaveURL(/\/account#sessions$/u);
        expect(fake.consents).toEqual([{termsVersion: meta.termsVersion, overseasStorage: true}]);
    });
});
