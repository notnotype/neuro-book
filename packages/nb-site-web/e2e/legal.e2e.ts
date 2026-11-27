/**
 * 隐私政策与服务条款两页的浏览器场景（t10 计划 3.11；t09 第 5 条：公开页适配手机）：构建产物加假接口，1440、390 与 360 三种宽度、
 * 亮暗两种明暗。量的是真实布局：页面不能横向滚动、正文列宽不超过 680px 且宽屏时居中、站名那一行与正文列对齐、正文的颜色取主题的
 * 语义变量（换明暗跟着换）；版本等于同意页显示的条款版本；从登录页底部与同意页的链接进得去，站名回到首页。
 * 页面画出哪些部分在 `src/site.dom.test.ts`，正文的构建在 `tests/build.test.ts`。
 */

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";

import {installFakeIdentity} from "./fake-api";
import type {FakeIdentity} from "./fake-api";
import {meta} from "./fixtures/identity";
import {box} from "./geometry";

const VIEWPORTS = [
    {name: "1440", width: 1440, height: 900},
    {name: "390", width: 390, height: 844},
    {name: "360", width: 360, height: 800},
] as const;
const SCHEMES = ["light", "dark"] as const;
const PAGES = [
    {path: "/privacy", name: "privacy"},
    {path: "/terms", name: "terms"},
] as const;
/** 正文列的上限宽度（`LegalPage.vue`）。 */
const COLUMN_MAX = 680;

let fake: FakeIdentity;

test.afterEach(() => {
    expect(fake.unexpected).toEqual([]);
});

async function openLegal(page: Page, path: string, name: string, viewport: {readonly width: number; readonly height: number}, scheme: "light" | "dark"): Promise<void> {
    await page.setViewportSize(viewport);
    await page.emulateMedia({colorScheme: scheme});
    await page.goto(path);
    await expect(page.locator(`[data-site-page="${name}"] [data-site-legal-body] h2`).first()).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", scheme);
}

/** 几处文字的计算颜色，与主题变量在同一页上解析出来的颜色。 */
async function legalColors(page: Page): Promise<{readonly body: string; readonly version: string; readonly title: string; readonly main: string; readonly secondary: string}> {
    return page.evaluate(() => {
        const resolve = (variable: string): string => {
            const probe = document.createElement("span");
            probe.style.color = `var(${variable})`;
            document.body.append(probe);
            const color = getComputedStyle(probe).color;
            probe.remove();
            return color;
        };
        const colorOf = (selector: string): string => getComputedStyle(document.querySelector(selector)!).color;
        return {
            body: colorOf("[data-site-legal-body] p"),
            version: colorOf("[data-site-legal-version]"),
            title: colorOf("[data-site-legal-column] h1"),
            main: resolve("--text-main"),
            secondary: resolve("--text-secondary"),
        };
    });
}

for (const legal of PAGES) {
    for (const viewport of VIEWPORTS) {
        test(`${legal.path} ${viewport.name} 宽：亮暗两种都不能横向滚动，正文列不超过 ${COLUMN_MAX}px、与站名一行对齐，文字颜色跟着明暗换，版本是同意页的条款版本`, async ({page}) => {
            fake = await installFakeIdentity(page);
            const mainColors = new Set<string>();
            for (const scheme of SCHEMES) {
                await openLegal(page, legal.path, legal.name, viewport, scheme);

                // 直接试着横向滚：滚得动就是有横向溢出（与 `login.e2e.ts` 同一种量法）。
                const scrolled = await page.evaluate(() => {
                    window.scrollTo(100, 0);
                    return window.scrollX;
                });
                expect({scheme, scrolled}).toEqual({scheme, scrolled: 0});

                // 量页面根元素而不是视口：根元素预留了滚动条的槽位（`app.css`），`clientWidth` 却把槽位算在里面。
                const root = await box(page, `[data-site-page="${legal.name}"]`);
                const column = await box(page, "[data-site-legal-column]");
                const head = await box(page, `[data-site-page="${legal.name}"] header`);
                expect(column.width).toBeLessThanOrEqual(COLUMN_MAX);
                expect(column.x).toBeGreaterThan(root.x);
                expect(column.x + column.width).toBeLessThan(root.x + root.width);
                expect({x: head.x, width: head.width}).toEqual({x: column.x, width: column.width});
                if (viewport.width === 1440) {
                    // 宽屏时列宽到顶、居中：左右留白相差不到 1px。
                    expect(column.width).toBe(COLUMN_MAX);
                    expect(Math.abs((column.x - root.x) - (root.x + root.width - column.x - column.width))).toBeLessThan(1);
                }
                // 正文自己也不比列宽：长词、表格在列里折行或自己滚。
                const bodyOverflow = await page.locator("[data-site-legal-body]").evaluate((element) => element.scrollWidth - element.clientWidth);
                expect({scheme, bodyOverflow}).toEqual({scheme, bodyOverflow: 0});

                const colors = await legalColors(page);
                expect({scheme, body: colors.body, title: colors.title, version: colors.version}).toEqual({scheme, body: colors.main, title: colors.main, version: colors.secondary});
                mainColors.add(colors.main);

                await expect(page.locator("[data-site-legal-version]")).toHaveText(`${meta.termsVersion} 版`);
            }
            // 前提：两种明暗下正文色确实不同，上面“取自变量”的断言才说明换明暗跟着换。
            expect(mainColors.size).toBe(2);
        });
    }
}

// 两份占位正文没有长网址也没有表格，上面的 `bodyOverflow` 量不到这两种内容；这里往正文里追加测试自己的一段长网址与一张宽表格再量。
// 表格的每格都是一个长英文词：列宽按词宽排时，四列合起来远宽于 360 宽的正文列，表格只能在自己里面滚。
test("/privacy 360 宽：正文里的长网址折行，宽表格在自己里面横向滚动，页面不横向滚动", async ({page}) => {
    fake = await installFakeIdentity(page);
    await openLegal(page, "/privacy", "privacy", VIEWPORTS[2], "light");
    await page.locator("[data-site-legal-body]").evaluate((body) => {
        const paragraph = document.createElement("p");
        paragraph.dataset.testLongWord = "";
        paragraph.textContent = `https://example.invalid/${"a".repeat(200)}`;
        const table = document.createElement("table");
        table.dataset.testWideTable = "";
        for (const words of [["Responsibilities", "Interoperability", "Pseudonymisation", "Telecommunications"], ["Notwithstanding", "Characteristics", "Incomprehensible", "Indemnification"]]) {
            const row = table.insertRow();
            for (const word of words) row.insertCell().textContent = word;
        }
        body.append(paragraph, table);
    });

    const measured = await page.evaluate(() => {
        const body = document.querySelector<HTMLElement>("[data-site-legal-body]")!;
        const paragraph = document.querySelector<HTMLElement>("[data-test-long-word]")!;
        const table = document.querySelector<HTMLElement>("[data-test-wide-table]")!;
        const lineHeight = Number.parseFloat(getComputedStyle(paragraph).lineHeight);
        window.scrollTo(100, 0);
        table.scrollLeft = 50;
        return {
            pageScrolled: window.scrollX,
            bodyOverflow: body.scrollWidth - body.clientWidth,
            wordOverflow: paragraph.scrollWidth - paragraph.clientWidth,
            wordWrapped: paragraph.getBoundingClientRect().height > lineHeight * 1.5,
            tableWithinBody: table.getBoundingClientRect().width <= body.clientWidth,
            tableOverflows: table.scrollWidth > table.clientWidth,
            tableScrolled: table.scrollLeft,
        };
    });
    expect({pageScrolled: measured.pageScrolled, bodyOverflow: measured.bodyOverflow, wordOverflow: measured.wordOverflow, wordWrapped: measured.wordWrapped, tableWithinBody: measured.tableWithinBody, tableOverflows: measured.tableOverflows})
        .toEqual({pageScrolled: 0, bodyOverflow: 0, wordOverflow: 0, wordWrapped: true, tableWithinBody: true, tableOverflows: true});
    expect(measured.tableScrolled).toBeGreaterThan(0);
    // 表格里的词不从中间断开：每格的文字只占一行。
    const cellLines = await page.locator("[data-test-wide-table] td").evaluateAll((cells) => cells.map((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        return range.getClientRects().length;
    }));
    expect(cellLines).toEqual(Array.from({length: 8}, () => 1));
});

test("从登录页底部进两页，站名回到首页", async ({page}) => {
    fake = await installFakeIdentity(page);
    await page.setViewportSize(VIEWPORTS[0]);
    await page.goto("/");
    await expect(page.locator("[data-site-paper-card] form")).toBeVisible();

    for (const legal of PAGES) {
        await page.locator(`[data-site-paper] footer a[href="${legal.path}"]`).click();
        await expect(page).toHaveURL(new RegExp(`${legal.path}$`, "u"));
        await expect(page.locator(`[data-site-page="${legal.name}"] [data-site-legal-body]`)).toBeVisible();
        await page.locator(`[data-site-page="${legal.name}"] header a`).click();
        await expect(page).toHaveURL(/\/$/u);
        await expect(page.locator("[data-site-paper-card] form")).toBeVisible();
    }
});

test("同意页的两条链接在新标签页打开对应的一页，版本与同意页写的相同", async ({context, page}) => {
    // 装在上下文上：链接是 `target="_blank"`，新标签页也要由假接口回答。
    fake = await installFakeIdentity(context, {session: "user", consentRequired: true});
    await page.setViewportSize(VIEWPORTS[0]);
    await page.goto("/consent");
    await expect(page.locator('[data-site-page="consent"]')).toBeVisible();

    for (const legal of PAGES) {
        const row = page.locator(".consent-doc").filter({has: page.locator(`a[href="${legal.path}"]`)});
        const shown = row.locator("[data-site-consent-version]");
        await expect(shown).toHaveText(`${meta.termsVersion} 版`);
        const [opened] = await Promise.all([context.waitForEvent("page"), row.locator("a").click()]);
        await expect(opened.locator(`[data-site-page="${legal.name}"] [data-site-legal-version]`)).toHaveText((await shown.textContent())!);
        expect(new URL(opened.url()).pathname).toBe(legal.path);
        await opened.close();
    }
    // 同意页自己没动。
    await expect(page).toHaveURL(/\/consent$/u);
});
