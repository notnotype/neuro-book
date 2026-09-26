#!/usr/bin/env node
import {mkdir} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import {dirname, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {resolveAgentScratchPath} from "@notnotype/neuro-book-test-support/paths";
import {chromium, type Browser, type ConsoleMessage, type Page} from "playwright-core";
import {assert, runAgentProfileNavSmoke} from "./agent-profile-nav";
import {assertAgentProfileSettingsDialogSmoke, assertAgentProfileSettingsNarrowSmoke} from "./agent-profile-settings-dialog";
import {assertSettingsViewSmoke} from "./settings-view";
import {assertProjectPickerViewSmoke} from "./project-picker-view";
import {assertWorkbenchContainerSmoke} from "./workbench-containers";
import {assertWorkbenchShellSmoke} from "./workbench-shell";

type ComponentLabSmokeSuite = "all" | "core" | "agent-profile" | "project-picker" | "workbench-shell";

type ComponentLabSmokeOptions = {
    url: string;
    browserExecutable: string;
    screenshot?: string;
    suite?: ComponentLabSmokeSuite;
};

type BrowserFailure = import("./agent-profile-nav").SmokeFailure;

/**
 * 验证主应用 Component Lab 的真实开发路径：路由、四个检查面板、场景数据、主题恢复和窄屏溢出。
 * 必须由 Node 启动 Playwright；Windows 下 Bun 连接 Chromium pipe 不稳定。
 */
export async function runComponentLabSmoke(input: ComponentLabSmokeOptions): Promise<void> {
    const suite = input.suite ?? "all";
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
        const page = await browser.newPage({viewport: {width: 1600, height: 1000}});
        observePage(page, failures);

        await page.goto(new URL("/lab", input.url).href, {waitUntil: "domcontentloaded", timeout: 30_000});
        await page.locator(".lab-root").waitFor({state: "visible", timeout: 30_000});
        assert(await page.locator('[aria-label="主题"]').count() === 1, failures, "Lab 路由应提供主题选择器");
        assert(await page.locator('[role="tab"]').count() === 5, failures, "右侧检查器应提供五个 tab");
        assert(
            await page.locator('[role="tab"]').allTextContents().then((items) => items.map((item) => item.replace(/\s+/gu, "").replace(/\d+$/u, "")))
                .then((items) => items.some((name) => name === "文档")
                    && items.some((name) => name === "元素")
                    && items.some((name) => name === "事件")
                    && items.some((name) => name === "数据")
                    && items.some((name) => name === "命令")),
            failures,
            "右侧检查器应包含文档、元素、事件、数据、命令五个面板",
        );

        // 五个 tab 要真能切：逐个切过去，只应留下该面板自己的容器（不只数标签个数）
        const panelTabs: {panel: string; tab: string; label: string}[] = [
            {panel: "doc", tab: "文档", label: "文档面板"},
            {panel: "element", tab: "元素", label: "元素面板"},
            {panel: "events", tab: "事件", label: "事件面板"},
            {panel: "data", tab: "数据", label: "数据面板"},
            {panel: "commands", tab: "命令", label: "命令面板"},
        ];
        for (const item of panelTabs) {
            await page.locator('[role="tab"]').filter({hasText: item.tab}).click();
            try {
                await page.locator(`[data-lab-panel="${item.panel}"]`).first().waitFor({state: "visible", timeout: 10_000});
                const rendered = await page.locator("[data-lab-panel]").count();
                assert(rendered === 1, failures, `${item.label}切换后不该同时挂着别的面板（当前 ${rendered} 个）`);
            } catch {
                failures.push({kind: "assertion", message: `${item.label}切换后应显示自己`});
            }
        }


        await page.locator("button", {hasText: "检查"}).click();
        await page.locator(".lab-columns > .nb-lab-panel--nav > div:nth-child(2)").click();
        assert(await page.locator(".lab-picked-marker .nb-lab-highlight-box").count() === 0, failures, "选中元素不应显示常驻边框");
        assert(await page.locator(".lab-picked-marker .nb-lab-highlight-label").isVisible(), failures, "选中元素应保留贴边标签");
        const initialSelectedTreeItem = page.locator(".lab-columns > .nb-lab-panel--nav [role='treeitem'][data-selected]").first();
        assert(
            await initialSelectedTreeItem.evaluate((element) => getComputedStyle(element).borderLeftWidth) === "0px",
            failures,
            "左侧组件树选中行不应显示左边框",
        );
        if (suite === "agent-profile") {
            await assertAgentProfileSettingsDialogSmoke(page, failures);
            await assertSettingsViewSmoke(page, failures);
            // 窄容器检查把画布留在 390 × 844，之后 Lab 顶栏与侧栏的点击会被拦下，所以它排在导航 smoke 之前。
            await assertAgentProfileSettingsNarrowSmoke(page, failures);
            await runAgentProfileNavSmoke(page, failures);
            if (failures.length > 0) {
                const screenshot = input.screenshot ?? resolveAgentScratchPath("browser", "component-lab-agent-profile", randomBytes(4).toString("hex"), "failure.png");
                await mkdir(dirname(screenshot), {recursive: true});
                await page.screenshot({path: screenshot, fullPage: true});
                throw new Error(formatFailures(failures, screenshot));
            }
            console.log(`Component Lab Agent Profile smoke passed: ${input.url}`);
            return;
        }

        if (suite === "project-picker") {
            await assertProjectPickerViewSmoke(page, failures);
            if (failures.length > 0) {
                const screenshot = input.screenshot ?? resolveAgentScratchPath("browser", "component-lab-project-picker", randomBytes(4).toString("hex"), "failure.png");
                await mkdir(dirname(screenshot), {recursive: true});
                await page.screenshot({path: screenshot, fullPage: true});
                throw new Error(formatFailures(failures, screenshot));
            }
            console.log(`Component Lab Project Picker smoke passed: ${input.url}`);
            return;
        }

        if (suite === "workbench-shell") {
            /**
             * 工作台骨架必须**整块**落在舞台可视区里：默认 1600×1000 时舞台可视高度只有约 730px，
             * 骨架（约 720px + 标题栏/状态栏）底部会被裁掉——状态栏正好压在可视区边界外，
             * 于是「点状态栏显示面板」「拖底部 Panel 的分隔线」都会落到 Lab 自己的控制面板上，
             * 表现为断言以「命令没反应 / 尺寸没变」的形式失败。加高视口后状态栏与横向分隔线都在可视区内。
             */
            await page.setViewportSize({width: 1600, height: 1300});
            await assertWorkbenchShellSmoke(page, failures);
            // 容器分层与通用 Grid sash：与骨架八步同一套夹具、同一次浏览器会话。
            await assertWorkbenchContainerSmoke(page, failures);
            if (failures.length > 0) {
                const screenshot = input.screenshot ?? resolveAgentScratchPath("browser", "component-lab-workbench-shell", randomBytes(4).toString("hex"), "failure.png");
                await mkdir(dirname(screenshot), {recursive: true});
                await page.screenshot({path: screenshot, fullPage: true});
                throw new Error(formatFailures(failures, screenshot));
            }
            console.log(`Component Lab workbench shell smoke passed: ${input.url}`);
            return;
        }

        const viewportCanvasItem = page.locator('.lab-columns > .nb-lab-panel--nav [role="treeitem"]').filter({hasText: /^ViewportCanvas$/u});
        await viewportCanvasItem.click();
        await page.locator('[role="radio"]').filter({hasText: "不限尺寸"}).click();
        await expectText(page, "这块内容用来看盒子尺寸变化", failures, "ViewportCanvas 不限尺寸场景应挂载");
        const sidePanelItem = page.locator('.lab-columns > .nb-lab-panel--nav [role="treeitem"]').filter({hasText: /^CollapsibleSidePanel$/u});
        await sidePanelItem.click();
        await expectText(page, "这块代表侧栏旁边的内容区", failures, "切换后应挂载 CollapsibleSidePanel 场景");
        const switchedCanvasHeight = await page.locator(".lab-main .nb-lab-stage-box").first().evaluate((element) => element.getBoundingClientRect().height);
        assert(switchedCanvasHeight > 80, failures, `从 ViewportCanvas 切换后画布不应塌缩：${switchedCanvasHeight}px`);

        const jsonViewerItem = page.locator('.lab-columns > .nb-lab-panel--nav [role="treeitem"]').filter({hasText: /^JsonViewer$/u});
        await jsonViewerItem.click();
        await expectText(page, "当前内容可以解析", failures, "JsonViewer 场景应恢复挂载");

        const arrayScene = page.locator('[role="radio"]').filter({hasText: "数组"});
        await arrayScene.click();
        await expectText(page, "read_file", failures, "切换数组场景应挂载确定性 fixture 数据");

        // 分层输入：组件发出的事件经 fixture 回写输入，数据面板「还原输入」回到登记初值
        const fixtureExampleItem = page.locator('.lab-columns > .nb-lab-panel--nav [role="treeitem"]').filter({hasText: /^FixtureExample$/u});
        await fixtureExampleItem.click();
        await page.locator('[role="tab"]').filter({hasText: "数据"}).click();
        await expectText(page, "还原输入", failures, "数据面板应提供输入重置入口");
        const switchReaches = (checked: boolean) => page.locator(`.lab-main .fixture-example-card [role="switch"][aria-checked="${checked}"]`).first().waitFor({state: "visible", timeout: 5_000}).then(() => true, () => false);
        await page.locator('.lab-main .fixture-example-card [role="switch"][aria-checked="false"]').first().click();
        assert(await switchReaches(true), failures, "toggle 经 fixture 回写 props.active 后组件应显示启用态");
        await page.locator('[data-lab-panel="data"] button').filter({hasText: /^还原输入$/u}).click();
        assert(await switchReaches(false), failures, "数据面板还原输入后应回到登记的 active 初值");
        if (suite === "all") {
            // 工作台骨架会把画布切到手机宽度，排在它之后的窄容器检查必须从宽画布重新开始。
            await page.locator('[aria-label="画布宽度"] button').filter({hasText: /^随窗口$/u}).first().click().catch(() => undefined);
            await assertWorkbenchShellSmoke(page, failures);
            await assertWorkbenchContainerSmoke(page, failures);
            await assertAgentProfileSettingsDialogSmoke(page, failures);
            await assertSettingsViewSmoke(page, failures);
            await assertProjectPickerViewSmoke(page, failures);
            // 窄容器检查把画布留在 390 × 844，之后 Lab 顶栏与侧栏的点击会被拦下，所以它排在导航 smoke 之前。
            await assertAgentProfileSettingsNarrowSmoke(page, failures);
            await runAgentProfileNavSmoke(page, failures);
        }

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
        throw new Error("用法：node --import tsx scripts/smoke/component-lab.ts --url <url> --browser-executable <path> [--suite all|core|agent-profile|project-picker|workbench-shell] [--screenshot <path>]");
    }
    const suite = values["--suite"];
    if (suite !== undefined && suite !== "all" && suite !== "core" && suite !== "agent-profile" && suite !== "project-picker" && suite !== "workbench-shell") {
        throw new Error(`无效 smoke 套件：${suite}`);
    }
    return {url: new URL(url).href, browserExecutable, screenshot: values["--screenshot"], suite: (suite ?? "all") as ComponentLabSmokeSuite};
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
