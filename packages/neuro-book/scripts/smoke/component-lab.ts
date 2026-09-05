#!/usr/bin/env node
import {mkdir} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import {dirname, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {resolveAgentScratchPath} from "@notnotype/neuro-book-test-support/paths";
import {chromium, type Browser, type ConsoleMessage, type Page} from "playwright-core";
import {assert, runAgentProfileNavSmoke} from "./agent-profile-nav";

type ComponentLabSmokeOptions = {
    url: string;
    browserExecutable: string;
    screenshot?: string;
};

type BrowserFailure = import("./agent-profile-nav").SmokeFailure;

/**
 * 验证主应用 Component Lab 的真实开发路径：路由、四个检查面板、场景数据、主题恢复和窄屏溢出。
 * 必须由 Node 启动 Playwright；Windows 下 Bun 连接 Chromium pipe 不稳定。
 */
export async function runComponentLabSmoke(input: ComponentLabSmokeOptions): Promise<void> {
    if (process.platform === "win32" && typeof Bun !== "undefined") {
        throw new Error("Component Lab smoke 必须由 Node 运行；Windows Bun 无法可靠连接 Chromium 调试 pipe。");
    }

    const failures: BrowserFailure[] = [];
    let browser: Browser | null = null;
    try {
        browser = await chromium.launch({
            executablePath: resolve(input.browserExecutable),
            headless: true,
            timeout: 60_000,
        });
        const page = await browser.newPage({viewport: {width: 1440, height: 900}});
        observePage(page, failures);

        await page.goto(new URL("/lab", input.url).href, {waitUntil: "domcontentloaded", timeout: 30_000});
        await page.locator(".lab-root").waitFor({state: "visible", timeout: 30_000});
        assert(await page.locator('[aria-label="主题"]').count() === 1, failures, "Lab 路由应提供主题选择器");
        assert(await page.locator('[role="tab"]').count() === 4, failures, "右侧检查器应提供四个 tab");
        assert(
            await page.locator('[role="tab"]').allTextContents().then((items) => items.map((item) => item.replace(/\s+/gu, "").replace(/\d+$/u, "")))
                .then((items) => items.some((name) => name === "文档")
                    && items.some((name) => name === "元素")
                    && items.some((name) => name === "事件")
                    && items.some((name) => name === "数据")),
            failures,
            "右侧检查器应包含文档、元素、事件、数据四个面板",
        );

        await page.locator("button", {hasText: "检查"}).click();
        await page.locator(".nb-lab-panel--nav > div:nth-child(2)").click();
        assert(await page.locator(".lab-picked-marker .nb-lab-highlight-box").count() === 0, failures, "选中元素不应显示常驻边框");
        assert(await page.locator(".lab-picked-marker .nb-lab-highlight-label").isVisible(), failures, "选中元素应保留贴边标签");
        const initialSelectedTreeItem = page.locator(".nb-lab-panel--nav [role='treeitem'][data-selected]").first();
        assert(
            await initialSelectedTreeItem.evaluate((element) => getComputedStyle(element).borderLeftWidth) === "0px",
            failures,
            "左侧组件树选中行不应显示左边框",
        );

        const viewportCanvasItem = page.locator('[role="treeitem"]').filter({hasText: /^ViewportCanvas$/u});
        await viewportCanvasItem.click();
        await page.locator('[role="radio"]').filter({hasText: "不限尺寸"}).click();
        await expectText(page, "这块内容用来看盒子尺寸变化", failures, "ViewportCanvas 不限尺寸场景应挂载");
        const sidePanelItem = page.locator('[role="treeitem"]').filter({hasText: /^CollapsibleSidePanel$/u});
        await sidePanelItem.click();
        await expectText(page, "这块代表侧栏旁边的内容区", failures, "切换后应挂载 CollapsibleSidePanel 场景");
        const switchedCanvasHeight = await page.locator(".lab-main .nb-lab-stage-box").first().evaluate((element) => element.getBoundingClientRect().height);
        assert(switchedCanvasHeight > 80, failures, `从 ViewportCanvas 切换后画布不应塌缩：${switchedCanvasHeight}px`);

        const jsonViewerItem = page.locator('[role="treeitem"]').filter({hasText: /^JsonViewer$/u});
        await jsonViewerItem.click();
        await expectText(page, "当前内容可以解析", failures, "JsonViewer 场景应恢复挂载");

        const arrayScene = page.locator('[role="radio"]').filter({hasText: "数组"});
        await arrayScene.click();
        await expectText(page, "read_file", failures, "切换数组场景应挂载确定性 fixture 数据");

        await page.locator('[role="tab"]').filter({hasText: "数据"}).click();
        await expectText(page, "还原", failures, "数据面板应提供场景重置入口");
        await runAgentProfileNavSmoke(page, failures);

        await page.locator('[aria-label="主题"]').click();
        const macosOption = page.locator('[role="option"]').filter({hasText: "macOS"});
        await macosOption.waitFor({state: "visible", timeout: 10_000});
        await macosOption.click();
        await page.waitForFunction(() => document.documentElement.dataset.nbTheme === "macos", undefined, {timeout: 10_000});

        await page.setViewportSize({width: 390, height: 844});
        await page.waitForFunction(
            () => document.querySelectorAll(".nb-lab-panel-head").length === 0,
            undefined,
            {timeout: 10_000},
        );
        assert(
            await page.locator(".nb-lab-panel-head").count() === 0,
            failures,
            "运行中进入 390px 窗口应自动收起左右侧栏",
        );
        await page.setViewportSize({width: 1440, height: 900});
        assert(
            await page.locator(".nb-lab-panel-head").count() === 0,
            failures,
            "恢复宽屏不应自动展开已收起的左右侧栏",
        );

        await page.emulateMedia({reducedMotion: "reduce"});
        await page.reload({waitUntil: "domcontentloaded"});
        await page.locator(".lab-root").waitFor({state: "visible", timeout: 30_000});
        const reducedMotionDuration = await page.locator(".nb-lab-panel").first().evaluate((element) => getComputedStyle(element).transitionDuration);
        assert(reducedMotionDuration === "0s", failures, `reduced-motion 应关闭侧栏转场：${reducedMotionDuration}`);
        assert(
            await page.evaluate(() => document.documentElement.dataset.nbTheme) === "macos",
            failures,
            "刷新后应恢复已保存的 Lab 主题",
        );
        await page.goto(new URL("/", input.url).href, {waitUntil: "domcontentloaded", timeout: 30_000});
        await page.waitForFunction(
            () => location.pathname === "/" && !document.documentElement.hasAttribute("data-nb-theme"),
            undefined,
            {timeout: 10_000},
        );

        await page.setViewportSize({width: 390, height: 844});
        await page.goto(new URL("/lab", input.url).href, {waitUntil: "domcontentloaded", timeout: 30_000});
        await page.locator(".lab-root").waitFor({state: "visible", timeout: 30_000});
        const mobile = page.locator("button").filter({hasText: /^手机$/u});
        await mobile.click();
        await expectText(page, "390 × 844", failures, "手机预设应切换到 390 × 844 画布");
        await page.reload({waitUntil: "domcontentloaded"});
        await page.locator(".lab-root").waitFor({state: "visible", timeout: 30_000});
        await expectText(page, "390 × 844", failures, "刷新后应恢复已保存的手机画布尺寸");
        assert(
            await page.evaluate(() => document.documentElement.dataset.nbTheme) === "macos",
            failures,
            "再次进入 Lab 后应保留主题偏好",
        );
        await page.getByRole("button", {name: "恢复 Lab 默认配置"}).click();
        await page.waitForFunction(() => document.documentElement.dataset.nbTheme === "nbook", undefined, {timeout: 10_000});
        assert(
            await page.evaluate(() => localStorage.getItem("nb-lab:preferences:v1")) === null,
            failures,
            "恢复默认配置后应清除 Lab 偏好键",
        );
        const overflow = await page.evaluate(() => ({documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth}));
        assert(overflow.documentWidth <= overflow.viewportWidth, failures, `390px 视口不应发生页面级横向溢出：${JSON.stringify(overflow)}`);

        if (failures.length > 0) {
            const screenshot = input.screenshot ?? resolveAgentScratchPath("browser", "component-lab", randomBytes(4).toString("hex"), "failure.png");
            await mkdir(dirname(screenshot), {recursive: true});
            await page.screenshot({path: screenshot, fullPage: true});
            throw new Error(formatFailures(failures, screenshot));
        }

        console.log(`Component Lab smoke passed: ${input.url}`);
    } finally {
        await browser?.close();
    }
}

function observePage(page: Page, failures: BrowserFailure[]): void {
    page.on("console", (message: ConsoleMessage) => {
        if (message.type() === "error" || message.type() === "warning") {
            failures.push({kind: "console", message: `${message.type()}: ${message.text()}`});
        }
    });
    page.on("pageerror", (error: Error) => failures.push({kind: "page", message: error.stack ?? error.message}));
}

async function expectText(page: Page, text: string, failures: BrowserFailure[], description: string): Promise<void> {
    try {
        await page.getByText(text, {exact: false}).first().waitFor({state: "visible", timeout: 10_000});
    } catch {
        failures.push({kind: "assertion", message: `${description}（未找到：${text}）`});
    }
}

function parseOptions(args: string[]): ComponentLabSmokeOptions {
    const values: Record<string, string> = {};
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        const value = args[index + 1];
        if (!key?.startsWith("--") || !value) throw new Error(`无效参数：${args.slice(index).join(" ")}`);
        values[key] = value;
    }
    const url = values["--url"];
    const browserExecutable = values["--browser-executable"];
    if (!url || !browserExecutable) {
        throw new Error("用法：node --import tsx scripts/smoke/component-lab.ts --url <url> --browser-executable <path> [--screenshot <path>]");
    }
    return {url: new URL(url).href, browserExecutable, screenshot: values["--screenshot"]};
}

function formatFailures(failures: BrowserFailure[], screenshot: string): string {
    const details = failures.map((failure) => `- [${failure.kind}] ${failure.message}`).join("\n");
    return `Component Lab smoke failed:\n${details}\nScreenshot: ${screenshot}`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        await runComponentLabSmoke(parseOptions(process.argv.slice(2)));
    } catch (error) {
        console.error(error instanceof Error ? error.stack ?? error.message : String(error));
        process.exitCode = 1;
    }
}
