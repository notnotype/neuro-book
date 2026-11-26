/**
 * 登录页的浏览器场景（t10 计划 3.10 的验收档“主题变量或窄屏布局”；t09 第 5 条）：构建产物加假接口，1440 与 390 两种宽度、
 * 亮暗两种明暗。量的是真实布局：页面没有横向溢出、稿纸的格线与卡片和字格对齐、状态行出现与消失时表单各部件的位置不变，
 * 以及稿纸两个站点变量在两种明暗下的对比度（`styles/site.css` 的取值依据）。表单的逻辑在 `LoginPage.dom.test.ts`。
 */

import {readFileSync} from "node:fs";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";

import {installFakeIdentity, loginFails, loginSucceeds} from "./fake-api";
import type {FakeIdentity} from "./fake-api";
import {invalidCredentials, rateLimited} from "./fixtures/identity";

/** 站点的中文目录：断言里的文字从这里取，改文案时场景不跟着坏。 */
const zhCN = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8")) as {
    readonly errors: {readonly identity: Readonly<Record<string, string>>};
};

const CELL = 40;
const ROW = 52;

const VIEWPORTS = [
    {name: "1440", width: 1440, height: 900},
    {name: "390", width: 390, height: 844},
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

interface Box {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** 元素的边框盒（相对页面的左上角，含滚动）。 */
async function boxes(page: Page, selector: string): Promise<Box[]> {
    return page.locator(selector).evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height};
    }));
}

async function box(page: Page, selector: string): Promise<Box> {
    const found = await boxes(page, selector);
    expect(found, selector).toHaveLength(1);
    return found[0]!;
}

/** 偏移是不是周期的整数倍（容许取整的误差）。 */
function onGrid(offset: number, period: number): boolean {
    const remainder = ((offset % period) + period) % period;
    return remainder < 0.01 || period - remainder < 0.01;
}

for (const viewport of VIEWPORTS) {
    for (const scheme of SCHEMES) {
        test(`${viewport.name} 宽、${scheme === "light" ? "亮色" : "暗色"}：没有横向溢出，卡片与字格落在格线上`, async ({page}) => {
            fake = await installFakeIdentity(page);
            await openLogin(page, viewport, scheme);

            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            expect(overflow).toBeLessThanOrEqual(0);

            // 格线画在 `.paper-sheet` 的伪元素上，向四周伸出整数个周期，所以原点就是它的左上角。
            const sheet = await box(page, "[data-site-paper-sheet]");
            const bleed = await page.locator("[data-site-paper-sheet]").evaluate((element) => {
                const style = getComputedStyle(element, "::before");
                return {top: Number.parseFloat(style.top), left: Number.parseFloat(style.left), maskSize: style.maskSize || style.getPropertyValue("-webkit-mask-size")};
            });
            expect(onGrid(bleed.left, CELL) && onGrid(bleed.top, ROW)).toBe(true);
            expect(bleed.maskSize).toBe(`${CELL}px ${ROW}px`);

            const card = await box(page, "[data-site-paper-card]");
            expect({left: onGrid(card.x - sheet.x, CELL), top: onGrid(card.y - sheet.y, ROW), width: card.width}).toEqual({left: true, top: true, width: 9 * CELL});
            expect(card.x + card.width).toBeLessThanOrEqual(viewport.width);

            const cells = await boxes(page, "[data-site-paper-cell]");
            expect(cells.length).toBeGreaterThan(0);
            const offGrid = cells.filter((cell) => !onGrid(cell.x - sheet.x, CELL) || !onGrid(cell.y - sheet.y, ROW) || cell.width !== CELL);
            expect(offGrid).toEqual([]);
        });
    }
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
        const luminance = (rgb: number[]): number => {
            const [r, g, b] = rgb.map((channel) => {
                const value = channel / 255;
                return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        };
        const ratio = (a: number[], b: number[]): number => {
            const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
            return (high! + 0.05) / (low! + 0.05);
        };
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
            await expect(status).toHaveText(zhCN.errors.identity.rate_limited!.replace("{{seconds}}", "1"));
            await expect(page.locator('button[type="submit"]')).toBeDisabled();
            expect(await layout(page)).toEqual(before);

            await expect(status).not.toHaveAttribute("data-site-form-status-error");
            await expect(page.locator('button[type="submit"]')).toBeEnabled();
            expect(await layout(page)).toEqual(before);
            expect(fake.logins).toHaveLength(2);
        });
    }
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
