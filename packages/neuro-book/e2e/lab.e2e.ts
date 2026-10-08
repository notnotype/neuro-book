/**
 * ui.component-lab 在真实浏览器中的验收：真实的 `bun run dev`（Lab 只在开发模式加载）与本机 Chrome。每个用例一个新的
 * 浏览器上下文，localStorage 与 sessionStorage 互不影响；整个文件共用一个开发会话。
 * 场景 10（生产构建不含 Lab）在 browser-host.e2e.ts 与 `check:dist`；场景 3、4 的索引判定在组件索引的模型测试；
 * 场景 14（measure 与截图命令）在 lab-shot.e2e.ts；场景 16（命令场景）在 lab-commands.e2e.ts。
 */

import {rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {LabDebugState} from "nbook/plugins/lab/shared/debug-api";

import {startDevSession} from "./fixtures";
import type {DevSession} from "./fixtures";

let tmp = "";
let dev: DevSession;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 页面上的报错与警告；Lab 在正常使用中不该产生任何一条。 */
function watchConsole(page: Page): string[] {
    const problems: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    return problems;
}

async function openLab(page: Page, query = ""): Promise<void> {
    await page.goto(`${dev.pageUrl}lab${query}`);
    await expect(page.locator(".lab-root")).toBeVisible();
}

const labState = (page: Page) => page.evaluate(() => (window as unknown as {__nbLab?: {state(): LabDebugState}}).__nbLab?.state() ?? null);
const htmlTheme = (page: Page) => page.evaluate(() => document.documentElement.dataset.nbTheme ?? null);
/** Lab 自己的两条侧栏的标题行；舞台上的 CollapsibleSidePanel 场景也画同样的标题行，所以限定在外壳的列上。 */
const labPanelHeads = (page: Page) => page.locator(".lab-columns > .nb-lab-panel .nb-lab-panel-head");
const treeItem = (page: Page, name: string) => page.locator('.lab-columns > .nb-lab-panel--nav [role="treeitem"]').filter({hasText: new RegExp(`^${name}$`, "u")});

test("打开 Lab：组件树、画布与四个检视面板；地址参数直达；只发引导一个接口请求，只写 Lab 自己的存储键（场景 1、13）", async ({page}) => {
    const problems = watchConsole(page);
    const apiRequests: string[] = [];
    page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(new URL(request.url()).pathname);
    });
    await openLab(page, "?c=JsonViewer&s=array&theme=macos&cw=light&vp=phone");
    await expect.poll(() => labState(page)).toMatchObject({component: "JsonViewer", scene: "array", ready: true, themeId: "macos", colorwayId: "nbook-light", canvas: {width: 390, height: 844}});
    await expect(page.getByText("read_file").first()).toBeVisible();
    await expect(page.locator('[aria-label="主题"]')).toHaveCount(1);
    for (const tab of ["文档", "元素", "事件", "数据"]) {
        await page.locator('[role="tab"]').filter({hasText: tab}).click();
        await expect(page.locator("[data-lab-panel]")).toHaveCount(1);
    }
    expect(apiRequests).toEqual(["/api/runtime/browser-bootstrap"]);
    const keys = await page.evaluate(() => [...Array(localStorage.length).keys()].map((index) => localStorage.key(index)));
    // 宿主每个窗口都写客户端身份（runtime.browser-host），它不是 Lab 的存储；Lab 自己只写 `nb-lab:` 开头的键。
    expect(keys.filter((key) => key !== "nbook.client-identity").every((key) => key?.startsWith("nb-lab:"))).toBe(true);

    // 地址参数等同于在界面上选中：不带参数再打开，恢复的是同一个状态。
    await openLab(page);
    await expect.poll(() => labState(page)).toMatchObject({component: "JsonViewer", scene: "array", ready: true, themeId: "macos", colorwayId: "nbook-light", canvas: {width: 390, height: 844}});

    expect(problems).toEqual([]);
});

test("地址里不认识的尺寸参数被忽略，按没有这个参数打开（场景 13）", async ({page}) => {
    await openLab(page, "?c=ViewportCanvas&vp=wide");
    await expect.poll(() => labState(page)).toMatchObject({component: "ViewportCanvas", ready: true, canvas: {width: 0, height: 0}});
});

test("切换组件与场景直接替换舞台；组件回写的输入可在数据面板还原（场景 2、12）", async ({page}) => {
    const problems = watchConsole(page);
    await page.setViewportSize({width: 1600, height: 1000});
    await openLab(page);
    await treeItem(page, "ViewportCanvas").click();
    await page.locator('[role="radio"]').filter({hasText: "不限尺寸"}).click();
    await expect(page.getByText("这块内容用来看盒子尺寸变化").first()).toBeVisible();
    // 换组件时记录舞台：始终只有一个、始终不透明（不插入空白退场阶段）。
    await page.evaluate(() => {
        const samples: Array<{count: number; opacity: number}> = [];
        (window as unknown as {stageSamples: typeof samples}).stageSamples = samples;
        const sample = (): void => {
            const stages = [...document.querySelectorAll("[data-lab-stage]")];
            samples.push({count: stages.length, opacity: Math.min(...stages.map((stage) => Number(getComputedStyle(stage).opacity)), 1)});
            if (samples.length < 600) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    });
    await treeItem(page, "CollapsibleSidePanel").click();
    await expect(page.getByText("这块代表侧栏旁边的内容区").first()).toBeVisible();
    const samples = await page.evaluate(() => (window as unknown as {stageSamples: Array<{count: number; opacity: number}>}).stageSamples);
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.filter((item) => item.count > 0).every((item) => item.count === 1 && item.opacity === 1)).toBe(true);
    // 地址栏经宿主 router 改写，router 记录的当前路由跟着变。
    expect(await page.evaluate(() => (document.querySelector("#app") as unknown as {__vue_app__: {config: {globalProperties: {$router: {currentRoute: {value: {query: Record<string, string>}}}}}}}).__vue_app__.config.globalProperties.$router.currentRoute.value.query.c)).toBe("CollapsibleSidePanel");
    await expect(page).toHaveURL(/[?&]c=CollapsibleSidePanel(?:&|$)/u);
    expect(await page.locator(".lab-main .nb-lab-stage-box").first().evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(80);

    await treeItem(page, "FixtureExample").click();
    await page.locator('[role="tab"]').filter({hasText: "数据"}).click();
    const toggle = (checked: boolean) => page.locator(`.lab-main .fixture-example-card [role="switch"][aria-checked="${String(checked)}"]`).first();
    await toggle(false).click();
    await expect(toggle(true)).toBeVisible();
    await page.locator('[data-lab-panel="data"] button').filter({hasText: /^还原输入$/u}).click();
    await expect(toggle(false)).toBeVisible();
    expect(problems).toEqual([]);
});

test("按部件别名检索能找到真实组件，检索不到的条目隐藏（场景 11）", async ({page}) => {
    await openLab(page);
    await page.getByPlaceholder("搜组件名或部件名称").fill("技能徽标");
    await expect(treeItem(page, "SkillChip")).toBeVisible();
    await expect(treeItem(page, "JsonViewer")).toHaveCount(0);
});

test("透传夹具：SkillChip 没有手写夹具组件，场景输入直接作为 props 交给它（场景 15）", async ({page}) => {
    const problems = watchConsole(page);
    await openLab(page, "?c=SkillChip&s=skill");
    await expect.poll(() => labState(page)).toMatchObject({component: "SkillChip", scene: "skill", ready: true});
    const chip = page.locator(".lab-main [data-lab-subject]");
    await expect(chip).toHaveAttribute("data-agent-skill-name", "novel-outline");
    await page.locator('[role="radio"]').filter({hasText: "长技能名"}).click();
    await expect(chip).toHaveAttribute("data-agent-skill-name", "novel-character-motivation-and-continuity-review");
    expect(problems).toEqual([]);
});

test("检查模式：悬停有探针框，点击后元素面板给出组件与源文件，不留常驻边框；Esc 退出（场景 5）", async ({page}) => {
    const problems = watchConsole(page);
    await page.setViewportSize({width: 1600, height: 1000});
    await openLab(page, "?c=FixtureExample&s=default");
    await expect.poll(async () => (await labState(page))?.ready).toBe(true);
    const root = page.locator(".lab-root");
    const subject = page.locator(".lab-main .fixture-example-card").first();

    await page.locator("button").filter({hasText: "检查"}).click();
    await expect(root).toHaveClass(/lab-root--inspecting/u);
    await subject.hover();
    await expect(page.locator(".nb-lab-highlight-box").first()).toBeVisible();
    await subject.click();
    await expect(root).not.toHaveClass(/lab-root--inspecting/u);
    const element = page.locator('[data-lab-panel="element"]');
    await expect(element).toBeVisible();
    await expect(element).toContainText("FixtureExample");
    await expect(page.locator(".lab-picked-marker .nb-lab-highlight-box")).toHaveCount(0);
    await expect(page.locator(".lab-picked-marker .nb-lab-highlight-label")).toBeVisible();

    await page.locator("button").filter({hasText: "检查"}).click();
    await expect(root).toHaveClass(/lab-root--inspecting/u);
    await page.keyboard.press("Escape");
    await expect(root).not.toHaveClass(/lab-root--inspecting/u);
    expect(problems).toEqual([]);
});

test("主题、窄屏与偏好：窄屏自动收起侧栏、恢复宽屏不弹回；减少动态时没有转场；刷新后恢复，恢复默认清掉偏好（场景 6、7、8）", async ({page}) => {
    const problems = watchConsole(page);
    await page.setViewportSize({width: 1440, height: 900});
    await openLab(page, "?c=JsonViewer");
    await page.locator('[aria-label="主题"]').click();
    await page.locator('[role="option"]').filter({hasText: "macOS"}).click();
    await expect.poll(() => htmlTheme(page)).toBe("macos");

    await expect(labPanelHeads(page)).toHaveCount(2);
    await page.setViewportSize({width: 390, height: 844});
    await expect(labPanelHeads(page)).toHaveCount(0);
    await page.setViewportSize({width: 1440, height: 900});
    await expect(labPanelHeads(page)).toHaveCount(0);

    await page.emulateMedia({reducedMotion: "reduce"});
    await page.reload();
    await expect(page.locator(".lab-root")).toBeVisible();
    expect(await page.locator(".lab-columns > .nb-lab-panel").first().evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
    expect(await htmlTheme(page)).toBe("macos");

    await page.setViewportSize({width: 390, height: 844});
    await page.locator("button").filter({hasText: /^手机$/u}).click();
    await expect(page.getByText("390 × 844").first()).toBeVisible();
    await page.reload();
    await expect(page.getByText("390 × 844").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByRole("button", {name: "恢复 Lab 默认配置"}).click();
    await expect.poll(() => htmlTheme(page)).toBe("nbook");
    expect(await page.evaluate(() => localStorage.getItem("nb-lab:preferences:v1"))).toBeNull();
    expect(problems).toEqual([]);
});

test("偏好存储被写坏：合法的字段照常恢复，不合法的回到默认；整份不是 JSON 时按没有偏好打开（场景 9）", async ({browser}) => {
    const partial = await browser.newPage();
    await partial.addInitScript(() => {
        localStorage.setItem("nb-lab:preferences:v1", JSON.stringify({schema: 1, themeId: "macos", colorwayId: "no-such-colorway", canvasZoom: 7, leftPanelWidth: 99999}));
    });
    await openLab(partial, "?c=JsonViewer");
    await expect.poll(() => labState(partial)).toMatchObject({ready: true, themeId: "macos", colorwayId: "nbook-dark"});
    await partial.close();

    const broken = await browser.newPage();
    await broken.addInitScript(() => {
        localStorage.setItem("nb-lab:preferences:v1", "{not json");
    });
    await openLab(broken, "?c=JsonViewer");
    await expect.poll(() => labState(broken)).toMatchObject({ready: true, themeId: "nbook"});
    await broken.close();
});

test("离开 Lab 回到工作台是整页加载：新的窗口运行实例，Lab 写在 <html> 上的主题不留下，换成产品配置的主题（场景 17）", async ({page}) => {
    await openLab(page, "?c=JsonViewer&theme=macos");
    await expect.poll(() => htmlTheme(page)).toBe("macos");
    const labInstance = await page.locator("[data-lab-page]").getAttribute("data-window-instance");
    expect(labInstance).toBeTruthy();
    await page.evaluate(() => {
        const app = (document.querySelector("#app") as unknown as {__vue_app__: {config: {globalProperties: {$router: {push(path: string): unknown}}}}}).__vue_app__;
        void app.config.globalProperties.$router.push("/");
    });
    const workbench = page.locator("[data-workbench-root]");
    await expect(workbench).toHaveAttribute("data-window-state", "ready");
    expect(await workbench.getAttribute("data-window-instance")).not.toBe(labInstance);
    // 产品页按配置写自己的主题（默认 nbook、浅色，docs/specs/theme/system.md），Lab 的 macOS 与深色不留下。
    await expect.poll(() => htmlTheme(page)).toBe("nbook");
    expect(await page.evaluate(() => document.documentElement.dataset.nbAppearance ?? null)).toBe("light");
});
