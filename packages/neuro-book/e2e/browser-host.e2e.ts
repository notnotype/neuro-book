/**
 * runtime.browser-host 在真实浏览器中的验收：生产构建（`bun run build`）的外壳与后端，本机 Chrome。
 * 覆盖场景 1（挂载前建立实例）、2（引导失败与重试）、4（多窗口隔离）、13（加载页跟随上次的明暗）、协议不兼容与页面表之外的路径。引导失败用拦截请求模拟：
 * 同源部署下服务端完全停止时浏览器连外壳都取不到，不属于场景 2。
 */

import {rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

const BOOTSTRAP = "**/api/runtime/browser-bootstrap";

let tmp = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "browser-host");
    server = await startProductServer(join(tmp, "state"));
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

test("首屏是空工作台：窗口运行实例建立、工作台激活之后才挂载界面（场景 1）", async ({page}) => {
    // 记下 #app 里出现过的宿主页状态：挂载前只有静态占位（loading），挂载后直接是工作台，从不出现“启动中”。
    await page.addInitScript(() => {
        const seen = new Set<string>();
        (window as unknown as {hostStatusesSeen: Set<string>}).hostStatusesSeen = seen;
        new MutationObserver(() => {
            for (const element of document.querySelectorAll("[data-browser-host-status]")) seen.add(element.getAttribute("data-browser-host-status") ?? "");
        }).observe(document, {childList: true, subtree: true, attributes: true});
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(server.url);
    const root = page.locator("[data-workbench-root]");
    await expect(root).toHaveAttribute("data-window-state", "ready");
    await expect(root).toHaveAttribute("data-window-instance", /.+/u);
    await expect(page.locator("[data-browser-host-status]")).toHaveCount(0);
    expect(await page.evaluate(() => [...(window as unknown as {hostStatusesSeen: Set<string>}).hostStatusesSeen])).toEqual(["loading"]);
    expect(errors).toEqual([]);
});

test("页面表之外的路径：窗口照常就绪，显示“页面不存在”，可以回到工作台；生产构建没有 /lab", async ({page}) => {
    await page.goto(`${server.url}lab`);
    await expect(page.locator("[data-page-not-found]")).toHaveAttribute("data-window-state", "ready");
    await page.goto(`${server.url}nope`);
    const notFound = page.locator("[data-page-not-found]");
    await expect(notFound).toHaveAttribute("data-window-state", "ready");
    await expect(page).toHaveTitle("页面不存在");
    await notFound.getByRole("link", {name: "回到工作台"}).click();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
});

test("引导请求失败：带重试的连接失败页，没有半个工作台；恢复后重试进入工作台（场景 2）", async ({page}) => {
    await page.route(BOOTSTRAP, (route) => route.abort("connectionrefused"));
    await page.goto(server.url);
    const failure = page.locator('[data-browser-host-status="connection-failed"]');
    await expect(failure).toBeVisible();
    await expect(page.locator("[data-workbench-root]")).toHaveCount(0);

    await page.unroute(BOOTSTRAP);
    await failure.getByRole("button", {name: "重试"}).click();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
});

test("服务端返回 503（例如正在关闭）：同样是可重试的连接失败，原因带状态码与错误码", async ({page}) => {
    await page.route(BOOTSTRAP, (route) => route.fulfill({status: 503, json: {error: {code: "stopping", message: "NeuroBook 正在关闭。"}}}));
    await page.goto(server.url);
    const failure = page.locator('[data-browser-host-status="connection-failed"]');
    await expect(failure).toContainText("503");
    await expect(failure).toContainText("stopping");
    await expect(failure.getByRole("button", {name: "重试"})).toBeVisible();
});

test("服务端协议版本不同：提示刷新页面，不给原地重试", async ({page}) => {
    await page.route(BOOTSTRAP, (route) => route.fulfill({json: {protocolVersion: 999}}));
    await page.goto(server.url);
    const failure = page.locator('[data-browser-host-status="incompatible"]');
    await expect(failure.getByRole("button", {name: "刷新页面"})).toBeVisible();
    await expect(failure.getByRole("button", {name: "重试"})).toHaveCount(0);
    await expect(page.locator("[data-workbench-root]")).toHaveCount(0);
});

test("两个窗口互相独立：关闭一个，另一个照常可用、刷新后重新引导，服务端不停止（场景 4）", async ({context}) => {
    const a = await context.newPage();
    const b = await context.newPage();
    await Promise.all([a.goto(server.url), b.goto(server.url)]);
    const rootB = b.locator("[data-workbench-root]");
    await expect(a.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
    await expect(rootB).toHaveAttribute("data-window-state", "ready");
    const instanceB = await rootB.getAttribute("data-window-instance");

    await a.close();
    await expect(rootB).toHaveAttribute("data-window-instance", instanceB ?? "");
    expect((await b.request.get(`${server.url}api/runtime/health`)).status()).toBe(200);
    await b.reload();
    await expect(rootB).toHaveAttribute("data-window-state", "ready");
    await expect(rootB).not.toHaveAttribute("data-window-instance", instanceB ?? "");
    expect(server.child.exitCode).toBeNull();
});

test("加载页跟随上次的明暗：系统与产品的明暗相反时，这个浏览器第一次打开按系统，之后第一帧就是产品的明暗（场景 13）", async ({browser}) => {
    const settings = join(tmp, "state", "settings.json");
    const LIGHT = "rgb(255, 252, 245)";
    const DARK = "rgb(45, 41, 37)";
    try {
        for (const {system, product, systemFrame, productFrame} of [
            {system: "dark", product: "light", systemFrame: DARK, productFrame: LIGHT},
            {system: "light", product: "dark", systemFrame: LIGHT, productFrame: DARK},
        ] as const) {
            await writeFile(settings, JSON.stringify({"nbook.workbench/appearance": product}));
            const context = await browser.newContext({colorScheme: system});
            const page = await context.newPage();
            // 动画帧回调在每次绘制之前运行（阻塞渲染的样式表没到时不会提前）：取第一个画出加载页的帧里它的底色。更早的帧
            // 可能还没解析到 body，只画画布（画布的明暗随内联脚本写的 color-scheme）。DOMContentLoaded 在模块脚本之后，
            // 节点刚插入时样式表可能还没生效，都不能代表第一帧。
            await page.addInitScript(() => {
                const sample = (): void => {
                    const loading = document.querySelector(".nb-host-loading");
                    if (loading === null) requestAnimationFrame(sample);
                    else (window as unknown as {firstFrame: string}).firstFrame = getComputedStyle(loading).backgroundColor;
                };
                requestAnimationFrame(sample);
            });
            const firstFrame = (): Promise<string | undefined> => page.evaluate(() => (window as unknown as {firstFrame?: string}).firstFrame);
            const root = page.locator("[data-workbench-root]");

            await page.goto(server.url);
            await expect(root).toHaveAttribute("data-window-state", "ready");
            expect(await firstFrame()).toBe(systemFrame);
            await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", product);
            await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("nbook.host-appearance") ?? "null") as {appearance?: string} | null)?.appearance)).toBe(product);

            await page.reload();
            await expect(root).toHaveAttribute("data-window-state", "ready");
            expect(await firstFrame()).toBe(productFrame);
            await context.close();
        }
    } finally {
        await rm(settings, {force: true});
    }
});

/**
 * 加载页的进度样式预设（theme.skins 输出 19）：往本地存储种一条合格的提示，让引导请求一直挂着，只看第一帧留下的静态加载页。
 * 判据是真实布局与计算样式：形状的尺寸、居中、各自的动画；`reducedMotion` 默认被压成静止（playwright.config.ts），测动画要开回来。
 */
test.describe("加载页的进度样式预设（theme.skins 输出 19）", () => {
    const HINT = {appearance: "light", background: "rgb(255, 252, 245)", text: "rgb(31, 28, 23)", muted: "rgb(139, 133, 123)", accent: "rgb(0, 122, 255)"};
    const PRESETS = [
        {name: "bar", hint: {}, size: [160, 2], animated: [{part: "::after", animation: "nb-host-loading"}]},
        {name: "dots", hint: {indicator: "dots"}, size: [6, 6], animated: [{part: "", animation: "nb-host-dot"}, {part: "::before", animation: "nb-host-dot"}, {part: "::after", animation: "nb-host-dot"}]},
        {name: "pulse", hint: {indicator: "pulse"}, size: [14, 14], animated: [{part: "", animation: "nb-host-pulse"}]},
        {name: "page", hint: {indicator: "page"}, size: [28, 36], animated: [{part: "::before", animation: "nb-host-page"}]},
    ] as const;

    for (const preset of PRESETS) {
        for (const motion of ["no-preference", "reduce"] as const) {
            test(`${preset.name}，${motion === "reduce" ? "减弱动效" : "有动效"}：形状尺寸、居中，${motion === "reduce" ? "全部静止" : "各部分按自己的动画动"}`, async ({page}) => {
                await page.emulateMedia({reducedMotion: motion});
                await page.addInitScript((hint) => localStorage.setItem("nbook.host-appearance", JSON.stringify(hint)), {...HINT, ...preset.hint});
                // 引导请求一直挂着：页面停在 index.html 的静态加载页，不会进工作台。
                await page.route(BOOTSTRAP, () => undefined);
                await page.goto(server.url, {waitUntil: "domcontentloaded"});
                const bar = page.locator(".nb-host-loading__bar");
                await expect(bar).toBeVisible();
                if ("indicator" in preset.hint) await expect(page.locator("html")).toHaveAttribute("data-host-indicator", preset.hint.indicator);
                else await expect(page.locator("html")).not.toHaveAttribute("data-host-indicator");

                // 布局尺寸用 offsetWidth/offsetHeight（动画里的缩放不算），居中看外接框的中心（缩放与旋转都绕中心，不动它）。
                expect(await bar.evaluate((element) => [(element as HTMLElement).offsetWidth, (element as HTMLElement).offsetHeight])).toEqual([...preset.size]);
                // 居中相对加载页自己的框（它铺满布局视口，窗口有细滚动条的槽位时比窗口窄一点）。
                const box = await bar.boundingBox();
                const page_ = await page.locator(".nb-host-loading").boundingBox();
                expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) / 2 - ((page_?.x ?? 0) + (page_?.width ?? 0) / 2))).toBeLessThanOrEqual(1);
                expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) / 2 - ((page_?.y ?? 0) + (page_?.height ?? 0) / 2))).toBeLessThanOrEqual(1);

                const animation = (part: string): Promise<string> => bar.evaluate((element, pseudo) => getComputedStyle(element, pseudo || null).animationName, part);
                for (const {part, animation: expected} of preset.animated) expect(await animation(part), `${preset.name}${part}`).toBe(motion === "reduce" ? "none" : expected);
                // 图形本身仍有尺寸与颜色（减弱动效不是不画）。
                const painted = await bar.evaluate((element) => ({color: getComputedStyle(element).backgroundColor, border: getComputedStyle(element).borderLeftWidth}));
                expect(preset.name === "page" ? painted.border : painted.color).not.toMatch(/^(0px|rgba\(0, 0, 0, 0\))$/u);

                // 书名在上、提示在下，各自水平居中，离指示器的布局边缘 10 到 16px（每种形状的高度不同，间距跟着换）。
                // 指示器的外接框随动画缩放与翻动，边缘取布局高度（居中用的是 translate，不进 offsetTop）。
                await page.evaluate(() => {
                    document.querySelector("[data-host-loading-title]")!.textContent = "雾港";
                    document.querySelector("[data-host-loading-hint]")!.textContent = "正在打开";
                });
                const title = await page.locator("[data-host-loading-title]").boundingBox();
                const hint = await page.locator("[data-host-loading-hint]").boundingBox();
                const centerX = (page_?.x ?? 0) + (page_?.width ?? 0) / 2;
                const centerY = (page_?.y ?? 0) + (page_?.height ?? 0) / 2;
                const height = preset.size[1];
                expect(Math.abs((title?.x ?? 0) + (title?.width ?? 0) / 2 - centerX), "书名水平居中").toBeLessThanOrEqual(1);
                expect(Math.abs((hint?.x ?? 0) + (hint?.width ?? 0) / 2 - centerX), "提示水平居中").toBeLessThanOrEqual(1);
                const titleGap = centerY - height / 2 - ((title?.y ?? 0) + (title?.height ?? 0));
                const hintGap = (hint?.y ?? 0) - (centerY + height / 2);
                expect(titleGap, `${preset.name} 书名到指示器`).toBeGreaterThanOrEqual(10);
                expect(titleGap, `${preset.name} 书名到指示器`).toBeLessThanOrEqual(16);
                expect(hintGap, `${preset.name} 指示器到提示`).toBeGreaterThanOrEqual(10);
                expect(hintGap, `${preset.name} 指示器到提示`).toBeLessThanOrEqual(16);

                // 后到的内容不推动指示器：流内多出一块高 40px 的东西，指示器的中心不动（它不在文档流里）。
                const before = await bar.boundingBox();
                await page.evaluate(() => {
                    const block = document.createElement("div");
                    block.style.height = "40px";
                    document.querySelector(".nb-host-loading")!.prepend(block);
                });
                const after = await bar.boundingBox();
                expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0)), `${preset.name} 流内多出内容时指示器的位置`).toBeLessThanOrEqual(1);

                // dots 的三点：两边的点离中间的点 14px（伪元素的 left）。
                if (preset.name === "dots") {
                    const left = (part: string): Promise<string> => bar.evaluate((element, pseudo) => getComputedStyle(element, pseudo).left, part);
                    expect([await left("::before"), await left("::after")]).toEqual(["-14px", "14px"]);
                }
            });
        }
    }

    for (const preset of PRESETS) {
        test(`${preset.name}，强制颜色：进度指示仍有可见的图形（不被强制成画布色），场景图不画`, async ({page}) => {
            await page.emulateMedia({forcedColors: "active"});
            await page.addInitScript((hint) => localStorage.setItem("nbook.host-appearance", JSON.stringify(hint)), {...HINT, ...preset.hint});
            await page.route(BOOTSTRAP, () => undefined);
            await page.goto(server.url, {waitUntil: "domcontentloaded"});
            const bar = page.locator(".nb-host-loading__bar");
            await expect(bar).toBeVisible();
            // 强制颜色会把 background-color 换成画布色：指示器的底色（dots、pulse、bar 的轨道）与画布色相同就看不见。
            // page 的形状靠书脊的 border-left，不受强制。
            const colors = await bar.evaluate((element, spine) => ({
                shape: spine ? getComputedStyle(element).borderLeftColor : getComputedStyle(element).backgroundColor,
                canvas: getComputedStyle(document.querySelector(".nb-host-loading")!).backgroundColor,
            }), preset.name === "page");
            expect(colors.shape, `${preset.name} 在强制颜色下的图形色`).not.toBe(colors.canvas);
        });
    }

    test("场景图地址跨源或写成协议相对地址：不画图，进度样式照常（两个字段各自独立）", async ({page}) => {
        const cases = [{scene: "//evil.example/a.webp"}, {scene: "https://evil.example/a.webp"}];
        for (const bad of cases) {
            await page.addInitScript((hint) => localStorage.setItem("nbook.host-appearance", JSON.stringify(hint)), {...HINT, indicator: "dots", ...bad});
            await page.route(BOOTSTRAP, () => undefined);
            const requested: string[] = [];
            page.on("request", (request) => requested.push(request.url()));
            await page.goto(server.url, {waitUntil: "domcontentloaded"});
            await expect(page.locator("html")).toHaveAttribute("data-host-indicator", "dots");
            await expect(page.locator("html")).not.toHaveAttribute("data-host-scene");
            expect(requested.filter((url) => url.includes("evil.example"))).toEqual([]);
            await page.unroute(BOOTSTRAP);
        }
    });
});
