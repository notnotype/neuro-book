/**
 * 登录页的浏览器场景（t10 计划 3.10 的验收档“主题变量或窄屏布局”；t09 第 5 条）：构建产物加假接口，1440、390 与 360 三种宽度、
 * 亮暗两种明暗。量的是真实布局：页面不能横向滚动、稿纸的格线与卡片和字格对齐、产品名在一行、页面底色是纸色、状态行空着时也占着
 * 位置、状态行出现与消失时表单各部件的位置不变、窄屏上最长的原因没被截断、稿纸页之间切换时稿纸是同一个元素，以及稿纸两个站点
 * 变量与“没有这一页”的链接在两种明暗下的对比度（`styles/site.css` 的取值依据）。表单的逻辑在 `LoginPage.dom.test.ts`。
 */

import {readFileSync} from "node:fs";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";

import {installFakeIdentity, loginFails, loginSucceeds} from "./fake-api";
import type {FakeIdentity} from "./fake-api";
import {invalidCredentials, rateLimited} from "./fixtures/identity";
import {box, boxes, onGrid} from "./geometry";
import type {Box} from "./geometry";

/** 站点的中文目录：断言里的文字从这里取，改文案时场景不跟着坏。 */
const zhCN = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8")) as {
    readonly errors: {readonly identity: Readonly<Record<string, string>>};
};

const VIEWPORTS = [
    {name: "1440", width: 1440, height: 900},
    {name: "390", width: 390, height: 844},
    // 常见的安卓宽度：格子缩成 36px 的那一档（`PaperSheet.vue`）。
    {name: "360", width: 360, height: 800},
] as const;
const SCHEMES = ["light", "dark"] as const;

let fake: FakeIdentity;

test.afterEach(() => {
    expect(fake.unexpected).toEqual([]);
});

async function openLogin(page: Page, viewport: {readonly width: number; readonly height: number}, scheme: "light" | "dark", path = "/"): Promise<void> {
    await page.setViewportSize(viewport);
    // 站点的明暗跟随系统（`host/theme.ts`）。
    await page.emulateMedia({colorScheme: scheme});
    await page.goto(path);
    await expect(page.locator("[data-site-paper-card] form")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", scheme);
}

for (const viewport of VIEWPORTS) {
    for (const scheme of SCHEMES) {
        test(`${viewport.name} 宽、${scheme === "light" ? "亮色" : "暗色"}：不能横向滚动，卡片与字格落在格线上，产品名在一行，页面底色是纸色，空的状态行占着位置`, async ({page}) => {
            fake = await installFakeIdentity(page);
            await openLogin(page, viewport, scheme);

            // 直接试着横向滚：滚得动就是有横向溢出。比较 `scrollWidth` 与 `clientWidth` 会漏掉被 `overflow: clip` 以外的方式撑出来的情形。
            const scrolled = await page.evaluate(() => {
                window.scrollTo(100, 0);
                return window.scrollX;
            });
            expect(scrolled).toBe(0);

            // 格子的尺寸随宽度换档（360 宽时缩小），从稿纸上读，再按它量。
            const grid = await page.locator("[data-site-paper-sheet]").evaluate((element) => {
                const sheetStyle = getComputedStyle(element);
                const style = getComputedStyle(element, "::before");
                return {
                    cell: Number.parseFloat(sheetStyle.getPropertyValue("--paper-cell")),
                    row: Number.parseFloat(sheetStyle.getPropertyValue("--paper-row")),
                    top: Number.parseFloat(style.top),
                    left: Number.parseFloat(style.left),
                    maskSize: style.maskSize || style.getPropertyValue("-webkit-mask-size"),
                };
            });
            expect({cell: grid.cell, row: grid.row}).toEqual(viewport.width === 360 ? {cell: 36, row: 48} : {cell: 40, row: 52});
            const {cell: CELL, row: ROW} = grid;

            // 格线画在 `.paper-sheet` 的伪元素上，向四周伸出整数个周期，所以原点就是它的左上角。
            const sheet = await box(page, "[data-site-paper-sheet]");
            expect(onGrid(grid.left, CELL) && onGrid(grid.top, ROW)).toBe(true);
            expect(grid.maskSize).toBe(`${CELL}px ${ROW}px`);

            const card = await box(page, "[data-site-paper-card]");
            expect({left: onGrid(card.x - sheet.x, CELL), top: onGrid(card.y - sheet.y, ROW), width: card.width}).toEqual({left: true, top: true, width: 9 * CELL});
            expect(card.x + card.width).toBeLessThanOrEqual(viewport.width);

            const cells = await boxes(page, "[data-site-paper-cell]");
            expect(cells.length).toBeGreaterThan(0);
            const offGrid = cells.filter((cell) => !onGrid(cell.x - sheet.x, CELL) || !onGrid(cell.y - sheet.y, ROW) || cell.width !== CELL);
            expect(offGrid).toEqual([]);

            // 产品名一格一字写在同一行，不折到第二行。
            const title = await boxes(page, "[data-site-paper-title] [data-site-paper-cell]");
            expect(title.length).toBeGreaterThan(1);
            expect(new Set(title.map((cell) => cell.y)).size).toBe(1);

            // 根元素给滚动条预留的槽位露出的是 `body` 的底色：要与纸同色，右缘才不多一条别的颜色。
            const backgrounds = await page.evaluate(() => ({
                body: getComputedStyle(document.body).backgroundColor,
                paper: getComputedStyle(document.querySelector("[data-site-paper]")!).backgroundColor,
            }));
            expect(backgrounds.body).toBe(backgrounds.paper);

            // 空着的状态行也占着至少一行高，与提交按钮不相交：出错时字出现在这里，不推开按钮，也不压在按钮上。
            const status = await box(page, "[data-site-form-status]");
            const lineHeight = await page.locator("[data-site-form-status]").evaluate((element) => Number.parseFloat(getComputedStyle(element).lineHeight));
            const submit = await box(page, "[data-site-paper-card] button[type=submit]");
            await expect(page.locator("[data-site-form-status]")).not.toHaveAttribute("data-site-form-status-error");
            expect(lineHeight).toBeGreaterThan(0);
            expect(status.height).toBeGreaterThanOrEqual(lineHeight - 0.5);
            expect(status.y + status.height).toBeLessThanOrEqual(submit.y);
        });
    }
}

/** WCAG 的相对亮度对比度，两个颜色都是不透明的 sRGB 分量。 */
function ratio(a: readonly number[], b: readonly number[]): number {
    const luminance = (rgb: readonly number[]): number => {
        const [r, g, b] = rgb.map((channel) => {
            const value = channel / 255;
            return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high! + 0.05) / (low! + 0.05);
}

/** 元素的字色与它所在页面的底色（`body`），用画布合成成不透明的 sRGB 分量。 */
async function textOnPage(page: Page, selector: string): Promise<{text: number[]; page: number[]}> {
    return page.evaluate((selector) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext("2d")!;
        const over = (...layers: string[]): number[] => {
            context.clearRect(0, 0, 1, 1);
            for (const layer of layers) {
                context.fillStyle = layer;
                context.fillRect(0, 0, 1, 1);
            }
            return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
        };
        const background = getComputedStyle(document.body).backgroundColor;
        return {text: over(background, getComputedStyle(document.querySelector(selector)!).color), page: over(background)};
    }, selector);
}

test.describe("稿纸变量的对比度", () => {
    /** WCAG 的相对亮度对比度；颜色先在页面里用画布合成到纸色上，读出不透明的 sRGB。 */
    async function contrasts(page: Page): Promise<{line: number; seal: number; sealText: number}> {
        const colors = await page.evaluate(() => {
            const paper = getComputedStyle(document.querySelector("[data-site-paper]")!).backgroundColor;
            const line = getComputedStyle(document.querySelector("[data-site-paper-sheet]")!, "::before").backgroundColor;
            const seal = document.querySelector("[data-site-paper-seal]")!;
            const canvas = document.createElement("canvas");
            canvas.width = 1;
            canvas.height = 1;
            const context = canvas.getContext("2d")!;
            const over = (...layers: string[]): number[] => {
                context.clearRect(0, 0, 1, 1);
                for (const layer of layers) {
                    context.fillStyle = layer;
                    context.fillRect(0, 0, 1, 1);
                }
                return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
            };
            return {paper: over(paper), line: over(paper, line), seal: over(paper, getComputedStyle(seal).backgroundColor), sealText: over(getComputedStyle(seal).color)};
        });
        return {line: ratio(colors.line, colors.paper), seal: ratio(colors.seal, colors.paper), sealText: ratio(colors.sealText, colors.seal)};
    }

    test("两种明暗下格线的分量相当，印章看得清，印章上的字够对比", async ({page}) => {
        fake = await installFakeIdentity(page);
        const measured: Record<string, {line: number; seal: number; sealText: number}> = {};
        for (const scheme of SCHEMES) {
            await openLogin(page, VIEWPORTS[0], scheme);
            measured[scheme] = await contrasts(page);
        }
        const {light, dark} = measured as Record<(typeof SCHEMES)[number], {line: number; seal: number; sealText: number}>;
        // 格线：两种明暗下对纸的对比度相差不超过 0.1，格子不比另一种更抢眼或更淡。
        expect(Math.abs(light.line - dark.line)).toBeLessThanOrEqual(0.1);
        for (const scheme of [light, dark]) {
            // 印章是图形，下限 3:1；印章上的白字是文字，下限 4.5:1（WCAG 1.4.11、1.4.3）。
            expect(scheme.seal).toBeGreaterThanOrEqual(3);
            expect(scheme.sealText).toBeGreaterThanOrEqual(4.5);
        }
    });
});

test.describe("状态行不推动表单", () => {
    /** 表单里各部件的位置：两个输入框、状态行、提交按钮与卡片本身。 */
    async function layout(page: Page): Promise<Box[]> {
        return boxes(page, "[data-site-paper-card], [data-site-paper-card] input, [data-site-form-status], [data-site-paper-card] button[type=submit]");
    }

    async function fillAndSubmit(page: Page): Promise<void> {
        await page.locator('input[name="identifier"]').fill("alice");
        await page.locator('input[name="password"]').fill("wrong password");
        await page.locator('button[type="submit"]').click();
    }

    for (const viewport of VIEWPORTS) {
        test(`${viewport.name} 宽：invalid_credentials 出现、rate_limited 出现与倒数完消失时，字段与按钮的位置不变`, async ({page}) => {
            fake = await installFakeIdentity(page, {login: loginFails(401, invalidCredentials)});
            await openLogin(page, viewport, "light");
            const status = page.locator("[data-site-form-status]");
            const before = await layout(page);
            expect(before).toHaveLength(5);

            await fillAndSubmit(page);
            await expect(status).toHaveAttribute("data-site-form-status-error", "");
            await expect(page.locator('input[name="identifier"]')).toHaveAttribute("aria-invalid", "true");
            expect(await layout(page)).toEqual(before);

            fake.login = loginFails(429, rateLimited, {"Retry-After": "1"});
            await page.locator('button[type="submit"]').click();
            // 换成另一件事时旧的一条淡出、新的一条淡入，叠着的时候有两条：按字找新的那条。
            await expect(status.locator("[data-site-form-status-text]", {hasText: zhCN.errors.identity.rate_limited!.replace("{{seconds}}", "1")})).toBeVisible();
            await expect(page.locator('button[type="submit"]')).toBeDisabled();
            expect(await layout(page)).toEqual(before);

            await expect(status).not.toHaveAttribute("data-site-form-status-error");
            await expect(page.locator('button[type="submit"]')).toBeEnabled();
            expect(await layout(page)).toEqual(before);
            expect(fake.logins).toHaveLength(2);
        });
    }
});

test("“没有这一页”的链接在两种明暗下对页面底色够 4.5:1，静止时带下划线", async ({page}) => {
    fake = await installFakeIdentity(page);
    for (const scheme of SCHEMES) {
        await page.setViewportSize(VIEWPORTS[0]);
        await page.emulateMedia({colorScheme: scheme});
        await page.goto("/no-such-page");
        const link = page.locator('[data-site-page="not-found"] a');
        await expect(link).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", scheme);
        const colors = await textOnPage(page, '[data-site-page="not-found"] a');
        expect({scheme, enough: ratio(colors.text, colors.page) >= 4.5}).toEqual({scheme, enough: true});
        expect(await link.evaluate((element) => getComputedStyle(element).textDecorationLine)).toBe("underline");
    }
});

test("360 宽：最长的一条原因在状态行里两行写得下，没被截断", async ({page}) => {
    fake = await installFakeIdentity(page);
    // 登录页能显示的原因里最长的是 `identity_taken`（社交登录落回登录页时）。
    const longest = zhCN.errors.identity.identity_taken!;
    await openLogin(page, VIEWPORTS[2], "light", "/login?social_error=identity_taken");
    const text = page.locator("[data-site-form-status-text]");
    await expect(text).toHaveText(longest);
    const clamped = await text.evaluate((element) => ({overflow: element.scrollHeight - element.clientHeight, lines: Math.round(element.clientHeight / Number.parseFloat(getComputedStyle(element).lineHeight))}));
    // 前提：这一条在 360 宽下确实要两行，否则“没被截断”证明不了两行的高度够。
    expect(clamped).toEqual({overflow: 0, lines: 2});
});

test("从登录页去注册页：稿纸是同一个元素，只换卡片里的页面", async ({page}) => {
    fake = await installFakeIdentity(page);
    await openLogin(page, VIEWPORTS[0], "light", "/login");
    const paper = await page.locator("[data-site-paper]").elementHandle();
    await page.locator('[data-site-paper-card] a[href="/register"]').click();
    await expect(page).toHaveURL(/\/register$/u);
    await expect(page.locator('[data-site-paper-card] [data-site-page="register"]')).toBeVisible();
    expect(await page.evaluate((element) => element?.isConnected === true && document.querySelectorAll("[data-site-paper]").length === 1 && document.querySelector("[data-site-paper]") === element, paper)).toBe(true);
});

test.describe("真实构建里的主路径", () => {
    test("登录成功按分派去看板；social_error 显示后从地址里去掉", async ({page}) => {
        fake = await installFakeIdentity(page, {login: loginSucceeds("admin")});
        await openLogin(page, VIEWPORTS[0], "light", "/login?social_error=social_not_registered");
        await expect(page.locator("[data-site-form-status]")).toContainText(zhCN.errors.identity.social_not_registered!);
        await expect(page).toHaveURL(/\/login$/u);

        await page.locator('input[name="identifier"]').fill("root");
        await page.locator('input[name="password"]').fill("correct horse");
        await page.locator('button[type="submit"]').click();
        await expect(page).toHaveURL(/\/admin$/u);
        await expect(page.locator('[data-site-page="admin-dashboard"]')).toBeVisible();
        expect(fake.logins).toEqual([{identifier: "root", password: "correct horse"}]);
    });
});
