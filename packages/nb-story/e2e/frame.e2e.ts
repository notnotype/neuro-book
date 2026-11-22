/**
 * 书页外壳的三栏（docs/specs/story/viewer.md 输出 1、32 与“边界与兼容”的偏好）：拖分隔线、键盘、按钮收起与展开、平板档、
 * 过渡中的内容与图。生产构建的网页，真实的 `nbstory serve`，100 章样例书，本机 Chrome，1440×900。
 *
 * 三栏是 nb-layout 的网格：一栏是一片叶（`data-leaf` 是 `nav`、`main`、`drawer`），分隔线是带 `aria-valuenow` 的
 * `role="separator"`，导航那条在左、抽屉那条在右。偏好存在浏览器本地（`nbstory:drawer-width`、`nbstory:nav-collapsed`），
 * 每条用例一个新的浏览器配置。
 */

import {expect, test, type Locator, type Page} from "@playwright/test";

import {login, makeLibrary, startServe, type StoryServer} from "./fixtures";

let server: StoryServer;
let cleanup: () => Promise<void>;

test.beforeAll(async () => {
    const library = await makeLibrary("frame");
    cleanup = library.cleanup;
    server = await startServe(library.library);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    await cleanup();
});

test.beforeEach(async ({context}) => {
    await login(context, server);
});

async function open(page: Page, path: string): Promise<void> {
    await page.goto(`${server.base}${path}`);
    await expect(page.getByTestId("book-frame")).toBeVisible();
}

function pane(page: Page, id: "nav" | "main" | "drawer"): Locator {
    return page.locator(`[data-testid='book-frame'] [data-leaf='${id}']`);
}
function sash(page: Page, which: "nav" | "drawer"): Locator {
    return page.locator("[data-testid='book-frame'] [role='separator'][aria-valuenow]").nth(which === "nav" ? 0 : 1);
}
async function width(locator: Locator): Promise<number> {
    return Math.round((await locator.boundingBox())?.width ?? 0);
}
async function pref(page: Page, key: "drawer-width" | "nav-collapsed"): Promise<string | null> {
    return page.evaluate((name) => localStorage.getItem(`nbstory:${name}`), key);
}
/** 按住分隔线横着拖 `dx`。 */
async function drag(page: Page, handle: Locator, dx: number): Promise<void> {
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, {steps: 12});
    await page.mouse.up();
}

test.describe("宽屏", () => {
    test.use({viewport: {width: 1440, height: 900}});

    test("拖抽屉的分隔线（输出 1）：变宽记进偏好；拖到 0 收起、偏好不变；从 0 拖开回到刚才的内容", async ({page}) => {
        await open(page, "/book/fox/roster?at=38.57&entity=e1-1");
        await expect(page.getByTestId("card-name")).toHaveText("苏天晴");
        await expect.poll(() => width(pane(page, "drawer"))).toBe(400);

        await drag(page, sash(page, "drawer"), -60);
        await expect.poll(() => width(pane(page, "drawer"))).toBe(460);
        expect(await pref(page, "drawer-width")).toBe("460");

        await drag(page, sash(page, "drawer"), 600);
        await expect(page.getByTestId("card-name")).toHaveCount(0);
        await expect.poll(() => width(pane(page, "drawer"))).toBe(0);
        expect(await pref(page, "drawer-width")).toBe("460");

        await drag(page, sash(page, "drawer"), -420);
        await expect(page.getByTestId("card-name")).toHaveText("苏天晴");
        const reopened = await width(pane(page, "drawer"));
        expect(reopened).toBeGreaterThanOrEqual(280);
        expect(await pref(page, "drawer-width")).toBe(String(reopened));
    });

    test("键盘（输出 1）：导航线 Home、End、Enter 收起与展开，收起记进偏好；抽屉线 Enter 收起抽屉", async ({page}) => {
        await open(page, "/book/fox/roster?at=38.57&entity=e1-1");
        await expect(page.getByTestId("card-name")).toHaveText("苏天晴");
        const nav = sash(page, "nav");
        await nav.focus();
        await page.keyboard.press("Home");
        await expect.poll(() => width(pane(page, "nav"))).toBe(150);
        await page.keyboard.press("End");
        await expect.poll(() => width(pane(page, "nav"))).toBe(300);
        await page.keyboard.press("Enter");
        await expect.poll(() => width(pane(page, "nav"))).toBe(44);
        await expect(nav).toHaveAttribute("aria-valuetext", "已收起");
        expect(await pref(page, "nav-collapsed")).toBe("true");
        await nav.focus();
        await page.keyboard.press("Enter");
        // 展开回到收起之前的宽度（网格在收起那一刻记下）。
        await expect.poll(() => width(pane(page, "nav"))).toBe(300);
        expect(await pref(page, "nav-collapsed")).toBe("false");

        await sash(page, "drawer").focus();
        await page.keyboard.press("Enter");
        await expect(page.getByTestId("card-name")).toHaveCount(0);
        await expect.poll(() => width(pane(page, "drawer"))).toBe(0);
    });

    test("按钮（输出 1）：顶栏开关与卡片的关闭按钮收起抽屉，顶栏开关再打开", async ({page}) => {
        await open(page, "/book/fox/roster?at=38.57&entity=e1-1");
        await expect(page.getByTestId("card-name")).toHaveText("苏天晴");
        await page.getByTestId("toggle-drawer").click();
        await expect.poll(() => width(pane(page, "drawer"))).toBe(0);
        await page.getByTestId("toggle-drawer").click();
        await expect(page.getByTestId("card-name")).toHaveText("苏天晴");
        await expect.poll(() => width(pane(page, "drawer"))).toBe(400);
        await page.getByTestId("entity-card").getByRole("button", {name: "关闭"}).click();
        await expect.poll(() => width(pane(page, "drawer"))).toBe(0);
    });

    test("还没打开过任何内容时抽屉的分隔线停用（与顶栏开关一致），打开过之后可以拖", async ({page}) => {
        await open(page, "/book/fox/roster?at=38.57");
        await expect(page.getByTestId("page-roster")).toBeVisible();
        await expect(sash(page, "drawer")).toHaveAttribute("aria-disabled", "true");
        await expect(sash(page, "drawer")).toHaveAttribute("tabindex", "-1");
        await expect(page.getByTestId("toggle-drawer")).toBeDisabled();
        await page.getByTestId("page-roster").getByText("苏天晴", {exact: true}).first().click();
        await expect(page.getByTestId("card-name")).toHaveText("苏天晴");
        await expect(sash(page, "drawer")).not.toHaveAttribute("aria-disabled", "true");
    });

    test("过渡（输出 1）：关上的那几帧抽屉里仍是刚关掉的内容；过渡中图的画布不换尺寸，结束后铺满", async ({page}) => {
        await open(page, "/book/fox/relations?at=38&entity=e1-1");
        await expect(page.getByTestId("card-name")).toHaveText("苏天晴");
        const canvas = page.getByTestId("relation-graph").locator("canvas").first();
        await expect(canvas).toBeVisible();
        const before = await width(canvas);
        // 逐帧记：网格有没有在过渡、抽屉那一栏里还有没有人物卡、画布多宽。
        await page.evaluate(() => {
            const frames: Array<{moving: boolean; card: boolean; canvas: number}> = [];
            (window as unknown as {__frames: typeof frames}).__frames = frames;
            const start = performance.now();
            const step = () => {
                const graphCanvas = document.querySelector<HTMLCanvasElement>("[data-testid='relation-graph'] canvas");
                frames.push({
                    moving: document.querySelector("[data-testid='book-frame'] [data-moving]") !== null,
                    card: document.querySelector("[data-leaf='drawer'] [data-testid='card-name']") !== null,
                    canvas: Math.round(graphCanvas?.getBoundingClientRect().width ?? 0),
                });
                if (performance.now() - start < 1500) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
        await page.getByTestId("toggle-drawer").click();
        await expect.poll(() => width(canvas)).toBeGreaterThan(before + 300);
        const frames = await page.evaluate(() => (window as unknown as {__frames: Array<{moving: boolean; card: boolean; canvas: number}>}).__frames);
        const moving = frames.filter((frame) => frame.moving);
        expect(moving.length).toBeGreaterThan(3);
        expect(moving.every((frame) => frame.card)).toBe(true);
        expect(moving.every((frame) => frame.canvas === before)).toBe(true);
    });
});

test.describe("平板", () => {
    test.use({viewport: {width: 900, height: 800}});

    test("平板（输出 32）：导航是 44 宽的图标条、那条线停用；主区与抽屉之间没有能用的线，主区与只有两块时同宽；打开时导航从没展开过", async ({page}) => {
        // 打开之前就逐帧记导航那一栏的宽度：在平板宽度打开时不该先按宽屏画一帧 188 再收起。
        await page.addInitScript(() => {
            const widths: number[] = [];
            (window as unknown as {__nav: number[]}).__nav = widths;
            const step = () => {
                const nav = document.querySelector("[data-testid='book-frame'] [data-leaf='nav']");
                if (nav) widths.push(Math.round(nav.getBoundingClientRect().width));
                if (widths.length < 120) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
        await open(page, "/book/fox/roster?at=38.57&entity=e1-1");
        await expect(page.getByTestId("card-name")).toHaveText("苏天晴");
        await expect.poll(() => width(pane(page, "nav"))).toBe(44);
        expect(await width(pane(page, "main"))).toBe(900 - 44 - 1);
        await expect(sash(page, "nav")).toHaveAttribute("aria-disabled", "true");
        await expect(sash(page, "drawer")).toHaveAttribute("tabindex", "-1");
        expect(await width(sash(page, "drawer"))).toBe(0);
        const navWidths = await page.evaluate(() => (window as unknown as {__nav: number[]}).__nav);
        expect(navWidths.length).toBeGreaterThan(0);
        expect(Math.max(...navWidths)).toBe(44);
    });
});
