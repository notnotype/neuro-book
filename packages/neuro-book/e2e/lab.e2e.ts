/**
 * ui.component-lab 在真实浏览器中的验收：真实的 `bun run dev`（Lab 只在开发模式加载）与本机 Chrome。整个文件共用一个
 * 开发会话，Lab 的偏好记录在它的状态根里（`nbook.storage` 的 `lab.preferences`）：每个用例开始前恢复默认。
 * 场景 10（生产构建不含 Lab）在 browser-host.e2e.ts 与 `check:dist`；场景 3、4 的索引判定在组件索引的模型测试；
 * 场景 14（measure 与截图命令）在 lab-shot.e2e.ts；场景 16（命令场景）在 lab-commands.e2e.ts。
 */

import {rm} from "node:fs/promises";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";

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

/** 状态根里用户分区的库：直接读写偏好记录，制造坏记录、核对落盘的值。 */
const userDatabase = (): DatabaseSync => new DatabaseSync(join(tmp, "state", "storage", "user.sqlite"));

function recordValue(): unknown {
    const db = userDatabase();
    try {
        const row = db.prepare("SELECT value FROM records WHERE owner = 'nbook.lab' AND key = 'lab.preferences'").get() as {value: string} | undefined;
        if (row === undefined) return "missing";
        try {
            return JSON.parse(row.value) as unknown;
        } catch {
            return row.value;
        }
    } finally {
        db.close();
    }
}

function writeRecordValue(value: string): void {
    const db = userDatabase();
    try {
        db.prepare("UPDATE records SET value = ? WHERE owner = 'nbook.lab' AND key = 'lab.preferences'").run(value);
    } finally {
        db.close();
    }
}

test.beforeEach(async ({browser}) => {
    const page = await browser.newPage();
    await openLab(page);
    await page.getByRole("button", {name: "恢复 Lab 默认配置"}).click();
    await expect.poll(recordValue).toEqual({});
    await page.close();
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

test("打开 Lab：组件树、画布与五个检视面板；地址参数直达；只发引导一个接口请求，不写浏览器存储（场景 1、13）", async ({page}) => {
    const problems = watchConsole(page);
    const apiRequests: string[] = [];
    page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(new URL(request.url()).pathname);
    });
    await openLab(page, "?c=JsonViewer&s=array&theme=macos&cw=light&vp=phone&zoom=2&tab=data&debug=1");
    await expect.poll(() => labState(page)).toMatchObject({component: "JsonViewer", scene: "array", ready: true, themeId: "macos", colorwayId: "nbook-light", canvas: {width: 390, height: 844}});
    await expect(page.locator('[data-lab-panel="data"]')).toBeVisible();
    await expect(page.locator('[aria-label="画布缩放"]')).toContainText("200%");
    // 地址里的主题与配色只作用于这个标签页，不写偏好；会话状态留在地址栏，不认识的参数原样保留。
    await expect.poll(() => new URL(page.url()).search).toBe("?theme=macos&cw=light&debug=1&c=JsonViewer&s=array&vp=phone&zoom=2&tab=data");
    expect(recordValue()).toEqual({});
    await expect(page.getByText("read_file").first()).toBeVisible();
    await expect(page.locator('[aria-label="主题"]')).toHaveCount(1);
    for (const tab of ["文档", "元素", "事件", "变量", "数据"]) {
        await page.locator('[role="tab"]').filter({hasText: tab}).click();
        await expect(page.locator("[data-lab-panel]")).toHaveCount(1);
    }
    expect(apiRequests).toEqual(["/api/runtime/browser-bootstrap"]);
    // 宿主每个窗口都写客户端身份（runtime.browser-host），它不是 Lab 的存储；Lab 不写浏览器存储。
    expect(await page.evaluate(() => [...Array(localStorage.length).keys()].map((index) => localStorage.key(index)))).toEqual(["nbook.client-identity"]);
    expect(await page.evaluate(() => sessionStorage.length)).toBe(0);

    // 刷新：地址栏里就是当前画面。
    await page.reload();
    await expect.poll(() => labState(page)).toMatchObject({component: "JsonViewer", scene: "array", ready: true, themeId: "macos", colorwayId: "nbook-light", canvas: {width: 390, height: 844}});
    await expect(page.locator('[data-lab-panel="data"]')).toBeVisible();
    // 在界面上换主题：画面上的主题与配色一起写进偏好，地址里的主题配色去掉。
    await page.locator('[aria-label="主题"]').click();
    await page.locator('[role="option"]').filter({hasNotText: "macOS"}).first().click();
    await expect.poll(async () => (await labState(page))?.themeId).not.toBe("macos");
    const look = await labState(page);
    await expect.poll(recordValue).toEqual({themeId: look?.themeId, colorwayId: look?.colorwayId});
    await expect.poll(() => new URL(page.url()).searchParams.has("theme") || new URL(page.url()).searchParams.has("cw")).toBe(false);
    // 不带参数再打开：主题与配色来自偏好，组件、场景与画布回到缺省。
    await openLab(page);
    await expect.poll(() => labState(page)).toMatchObject({ready: true, themeId: look?.themeId, colorwayId: look?.colorwayId, canvas: {width: 0, height: 0}});

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
    // 直接在窄屏打开：偏好里展开的侧栏不能盖掉自动收起。
    await expect(labPanelHeads(page)).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByRole("button", {name: "恢复 Lab 默认配置"}).click();
    await expect.poll(() => htmlTheme(page)).toBe("nbook");
    await expect.poll(recordValue).toEqual({});
    expect(problems).toEqual([]);
});

test("偏好记录有不认识的值：只有这些字段回到默认；记录损坏时用默认值运行、不覆盖原件，恢复默认后照常保存（场景 9）", async ({page}) => {
    const problems = watchConsole(page);
    writeRecordValue(JSON.stringify({themeId: "macos", colorwayId: "no-such-colorway", leftPanelWidth: 99999}));
    await openLab(page, "?c=JsonViewer");
    await expect.poll(() => labState(page)).toMatchObject({ready: true, themeId: "macos", colorwayId: "nbook-dark"});
    await expect(page.locator("[data-lab-notice]")).toHaveCount(0);

    writeRecordValue("{not json");
    await page.reload();
    await expect.poll(() => labState(page)).toMatchObject({ready: true, themeId: "nbook"});
    await expect(page.locator("[data-lab-preferences-problem]")).toContainText("损坏");
    await page.locator('[aria-label="主题"]').click();
    await page.locator('[role="option"]').filter({hasText: "macOS"}).click();
    await expect.poll(() => htmlTheme(page)).toBe("macos");
    expect(recordValue()).toBe("{not json");

    await page.locator("[data-lab-notice] button").filter({hasText: "恢复默认"}).click();
    await expect.poll(recordValue).toEqual({});
    await expect(page.locator("[data-lab-notice]")).toHaveCount(0);
    await page.locator('[aria-label="主题"]').click();
    await page.locator('[role="option"]').filter({hasText: "macOS"}).click();
    await expect.poll(recordValue).toEqual({themeId: "macos"});
    expect(problems).toEqual([]);
});

// 确定性的冲突重放（两边以同一个 revision 提交）由 `lab-preferences-store.test.ts` 在真实 Storage 上保证；这里是端到端补充：
// 真实浏览器、真实界面操作下两项都留下，刷新后两个窗口一致。
test("两个 Lab 窗口同时改不同的偏好：两项都保存，刷新后两个窗口一致（场景 20）", async ({browser}) => {
    const first = await browser.newPage({viewport: {width: 1440, height: 900}});
    const second = await browser.newPage({viewport: {width: 1440, height: 900}});
    await Promise.all([openLab(first, "?c=JsonViewer"), openLab(second, "?c=JsonViewer")]);
    const handle = second.locator('[aria-label="调整组件栏宽度"]');
    await Promise.all([
        (async () => {
            await first.locator('[aria-label="主题"]').click();
            await first.locator('[role="option"]').filter({hasText: "macOS"}).click();
        })(),
        (async () => {
            await handle.focus();
            await second.keyboard.press("ArrowRight");
        })(),
    ]);
    await expect.poll(recordValue).toEqual({themeId: "macos", leftPanelWidth: 310});
    for (const page of [first, second]) {
        await page.reload();
        await expect.poll(() => labState(page)).toMatchObject({ready: true, themeId: "macos"});
        expect(await page.locator(".lab-columns > .nb-lab-panel--nav").evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(310);
        await page.close();
    }
});

test("切组件新增历史，后退回到上一个组件；地址栏、router 的当前路由与 Lab 状态一致，离开 Lab 按当前地址整页加载（场景 21）", async ({page}) => {
    await openLab(page, "?c=JsonViewer");
    await expect.poll(async () => (await labState(page))?.ready).toBe(true);
    const routerQuery = () => page.evaluate(() => (document.querySelector("#app") as unknown as {__vue_app__: {config: {globalProperties: {$router: {currentRoute: {value: {query: Record<string, string>}}}}}}}).__vue_app__.config.globalProperties.$router.currentRoute.value.query);
    await treeItem(page, "SkillChip").click();
    await expect.poll(() => labState(page)).toMatchObject({component: "SkillChip", ready: true});
    await treeItem(page, "ViewportCanvas").click();
    await expect.poll(() => labState(page)).toMatchObject({component: "ViewportCanvas", ready: true});
    // 切场景只替换当前记录：后退一次回到 SkillChip，而不是 ViewportCanvas 的上一个场景。
    await page.locator('[role="radio"]').nth(1).click();

    await page.goBack();
    await expect.poll(() => labState(page)).toMatchObject({component: "SkillChip", ready: true});
    await expect.poll(routerQuery).toMatchObject({c: "SkillChip"});
    expect(new URL(page.url()).searchParams.get("c")).toBe("SkillChip");
    await page.goBack();
    await expect.poll(() => labState(page)).toMatchObject({component: "JsonViewer", ready: true});
    await page.goForward();
    await expect.poll(() => labState(page)).toMatchObject({component: "SkillChip", ready: true});

    const labInstance = await page.locator("[data-lab-page]").getAttribute("data-window-instance");
    await page.evaluate(() => {
        const app = (document.querySelector("#app") as unknown as {__vue_app__: {config: {globalProperties: {$router: {push(path: string): unknown}}}}}).__vue_app__;
        void app.config.globalProperties.$router.push("/?from=lab");
    });
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
    expect(await page.locator("[data-workbench-root]").getAttribute("data-window-instance")).not.toBe(labInstance);
    expect(new URL(page.url()).search).toBe("?from=lab");
});

test("复制场景链接：只含有效参数并带上主题与配色；地址里的场景不存在时回落到首个场景并提示（场景 13 与输出“复制场景链接”）", async ({page, context}) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openLab(page, "?c=JsonViewer&s=no-such-scene&component=Old");
    await expect.poll(() => labState(page)).toMatchObject({component: "JsonViewer", ready: true});
    await expect(page.locator("[data-lab-missing-scene]")).toContainText("no-such-scene");
    const scene = (await labState(page))?.scene;
    await page.locator("[data-lab-copy-link]").click();
    const copied = new URL(await page.evaluate(() => navigator.clipboard.readText()));
    expect(Object.fromEntries(copied.searchParams)).toEqual({c: "JsonViewer", s: scene, theme: "nbook", cw: "nbook-dark"});
    // 换场景后提示消失。
    await page.locator('[role="radio"]').nth(1).click();
    await expect(page.locator("[data-lab-missing-scene]")).toHaveCount(0);
});

test("同一状态根换端口再起一个开发服务：读到同一份偏好（场景 22）", async ({page, browser}) => {
    await openLab(page, "?c=JsonViewer");
    await page.locator('[aria-label="主题"]').click();
    await page.locator('[role="option"]').filter({hasText: "macOS"}).click();
    await expect.poll(recordValue).toEqual({themeId: "macos"});

    // 新端口是另一个浏览器来源，客户端身份也是另一个；偏好记录是 shared，仍是同一份。
    const other = await startDevSession(join(tmp, "state"));
    try {
        expect(new URL(other.pageUrl).port).not.toBe(new URL(dev.pageUrl).port);
        const second = await browser.newPage();
        await second.goto(`${other.pageUrl}lab?c=JsonViewer`);
        await expect.poll(() => labState(second)).toMatchObject({ready: true, themeId: "macos"});
        await second.close();
    } finally {
        other.child.kill("SIGTERM");
        expect(await other.exit).toBe(0);
    }
});

test("对话框类浮层在手机画布里打开：落在画布里、按画布居中、不越出画布（场景 24）", async ({page}) => {
    const problems = watchConsole(page);
    await page.setViewportSize({width: 1440, height: 900});
    // editorial 不开背景模糊：玻璃主题的 backdrop-filter 会碰巧让画布盒子成为包含块，掩盖浮层落点自己的缺陷。
    await openLab(page, "?c=Dialog&s=default&vp=phone&theme=editorial&cw=light");
    await expect.poll(() => labState(page)).toMatchObject({component: "Dialog", ready: true, canvas: {width: 390, height: 844}});
    const panel = page.locator('[data-lab-overlay-root] [role="dialog"]');
    await expect(panel).toBeVisible();
    const [box, dialog] = await Promise.all([
        page.locator(".lab-main .nb-lab-stage-box").first().boundingBox(),
        panel.boundingBox(),
    ]);
    expect(box).not.toBeNull();
    expect(dialog).not.toBeNull();
    if (box === null || dialog === null) return;
    expect(dialog.x).toBeGreaterThanOrEqual(box.x);
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(box.x + box.width);
    expect(Math.abs((dialog.x + dialog.width / 2) - (box.x + box.width / 2))).toBeLessThanOrEqual(1);
    // 模态遮罩盖住画布的调整手柄：手柄跨在画布边上，画布里的那一半上最上层是浮层（画布外的一半不归画布里的遮罩管）。
    const handle = await page.locator('.lab-main [aria-label="调整宽度"]').boundingBox();
    expect(handle).not.toBeNull();
    const top = await page.evaluate(({x, y}) => document.elementFromPoint(x, y)?.closest("[data-lab-overlay-root]") !== null, {x: handle!.x + 1, y: handle!.y + handle!.height / 2});
    expect(top).toBe(true);
    expect(problems).toEqual([]);
});

test("变量页签：覆盖一个变量立即生效，导出、全部清除、再导入，刷新后消失；元素页签给出结构检查与读数（场景 23）", async ({page}) => {
    const problems = watchConsole(page);
    await page.setViewportSize({width: 1600, height: 1000});
    await openLab(page, "?c=Button&s=primary&tab=variables");
    await expect(page.locator('[data-lab-panel="variables"]')).toBeVisible();
    const accent = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent-main").trim());
    const original = await accent();
    const input = page.getByRole("textbox", {name: "--accent-main 覆盖值"});
    await input.fill("rgb(255, 0, 0)");
    await input.press("Enter");
    await expect.poll(accent).toBe("rgb(255, 0, 0)");
    await expect(page.locator("[data-lab-override-count]")).toHaveText("1 项覆盖");

    const download = page.waitForEvent("download");
    await page.locator('[data-lab-panel="variables"] button').filter({hasText: /^导出$/u}).click();
    const file = join(tmp, "overrides.json");
    await (await download).saveAs(file);
    await page.locator('[data-lab-panel="variables"] button').filter({hasText: /^全部清除$/u}).click();
    await expect.poll(accent).toBe(original);
    // 导入是整份替换：导入前另有的覆盖被换掉，不是合并。
    const radius = page.getByRole("textbox", {name: "--radius-control 覆盖值"});
    await radius.fill("3px");
    await radius.press("Enter");
    await expect(page.locator("[data-lab-override-count]")).toHaveText("1 项覆盖");
    await page.locator("[data-lab-override-file]").setInputFiles(file);
    await expect(page.locator("[data-lab-override-status]")).toHaveText("已导入 1 项覆盖");
    await expect.poll(accent).toBe("rgb(255, 0, 0)");
    await expect(page.locator("[data-lab-override-count]")).toHaveText("1 项覆盖");
    await expect(radius).toHaveValue("");

    // 不合法的值不生效，原因写在面板上，已有覆盖不变。
    await input.fill("red; color: blue");
    await input.press("Enter");
    await expect(page.locator("[data-lab-override-status]")).toContainText("规则边界");
    await expect.poll(accent).toBe("rgb(255, 0, 0)");

    await page.reload();
    await expect.poll(async () => (await labState(page))?.ready).toBe(true);
    await expect.poll(accent).toBe(original);
    await expect(page.locator("[data-lab-override-count]")).toHaveText("0 项覆盖");

    await page.locator("button").filter({hasText: "检查"}).click();
    await page.locator(".lab-main [data-lab-subject]").first().click();
    const checks = page.locator("[data-lab-checks]");
    await expect(checks).toBeVisible();
    await expect(checks.locator('[data-pass="true"]').filter({hasText: "可访问名称"})).toHaveCount(1);
    await expect(page.locator('[data-lab-readout="aria"]')).toContainText("button");
    expect(problems).toEqual([]);
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
