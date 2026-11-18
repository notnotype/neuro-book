/**
 * 桌面窗口外框在真实浏览器里的验收（docs/specs/runtime/browser-host.md 的“窗口外框”，docs/specs/ui/workbench-shell.md 输出 28）：
 * 生产构建的后端与前端，本机 Chrome。壳由 `addInitScript` 代替：像预加载脚本那样定义只读的能力标记、设 `data-desktop-frame`，
 * 装一个假发送函数记下页面发给壳的消息；壳的消息用与壳相同的方式派发 `nbook-desktop` 事件（形状见 src/shared/desktop-bridge.ts）。
 *
 * 拖动区域只能断言 `-webkit-app-region` 的计算值：它证明样式写对了；桌面里命中的真的是系统标题栏（HTCAPTION），只有 Windows
 * 验收能证明（w00046 t03 的证据）。
 */

import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import {markFirstRunSeen} from "./support/desktop-shell";
import type {ProductServer} from "./fixtures";

let tmp = "";
let projectDir = "";
let stateRoot = "";
let server: ProductServer;

test.beforeAll(async ({browser}) => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "desktop-frame");
    projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await mkdir(join(projectDir, "notes"), {recursive: true});
    await writeFile(join(projectDir, "notes/a.md"), "甲\n");
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    server = await startProductServer(stateRoot);
    // 首次启动向导会在桌面窗口里弹出、挡住用例：先在这个状态根上记下看过（desktop-shell 输出 34）。
    await markFirstRunSeen(browser, server.url, stateRoot);
});

test.afterEach(async () => {
    await rm(join(stateRoot, "settings.json"), {force: true});
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 像桌面壳的预加载脚本那样：只读的能力标记、`<html>` 上的属性；再装一个记录消息的假发送函数。 */
async function installFrame(page: Page): Promise<void> {
    await page.addInitScript(() => {
        Object.defineProperty(window, "__nbookDesktopFrame", {value: 1, writable: false, configurable: false, enumerable: false});
        // 与预加载脚本一样：初始化脚本运行时 `<html>` 可能还没有，出现后再设。
        const mark = (): boolean => document.documentElement !== null && (document.documentElement.setAttribute("data-desktop-frame", ""), true);
        if (!mark()) {
            const observer = new MutationObserver(() => void (mark() && observer.disconnect()));
            observer.observe(document, {childList: true});
        }
        const messages: unknown[] = [];
        (window as unknown as {__shellSent: unknown[]}).__shellSent = messages;
        (window as unknown as {__electrobunSendToHost: (message: unknown) => void}).__electrobunSendToHost = (message) => void messages.push(message);
    });
}

const sent = async (page: Page, type: string): Promise<unknown[]> => (await page.evaluate(() => (window as unknown as {__shellSent: unknown[]}).__shellSent)).filter((message) => (message as {type: string}).type === type);

async function shell(page: Page, detail: unknown): Promise<void> {
    await page.evaluate((value) => window.dispatchEvent(new CustomEvent("nbook-desktop", {detail: value})), detail);
}

const controls = (page: Page) => page.locator("[data-desktop-controls]");
const fallbackBar = (page: Page) => page.locator("[data-desktop-fallback-bar]");
const titlebar = (page: Page) => page.locator("[data-workbench-titlebar]");

async function openWorkbench(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(titlebar(page)).toBeVisible();
}

/** 元素的拖动区域计算值；`app-region` 会被后代继承。 */
const region = (page: Page, selector: string): Promise<string[]> => page.$$eval(selector, (elements) => elements.map((element) => getComputedStyle(element).getPropertyValue("-webkit-app-region")));

/** 标题栏里有点击或悬停行为的元素（测量层除外）：每一个都要是 no-drag。 */
const INTERACTIVE = "[data-workbench-titlebar] :is(button, a[href], input, [role=menuitem], [tabindex]:not([tabindex='-1']), [data-workbench-item]):not(.workbench-titlebar__measure *)";

test("工作台：只画窗口按钮、不画后备标题栏；标题栏空白处是拖动区域，可交互的部分都不是；一建立就问窗口状态", async ({page}) => {
    await installFrame(page);
    await page.setViewportSize({width: 1280, height: 800});
    await openWorkbench(page);
    await expect(controls(page)).toBeVisible();
    // 窗口按钮左边的分隔线分隔的是标题栏右端的布局按钮：工作台里看得见。
    expect(await page.locator(".desktop-frame__divider").evaluate((element) => getComputedStyle(element).visibility)).toBe("visible");
    await expect(fallbackBar(page)).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveAttribute("data-desktop-frame-bar", /.*/u);
    expect(await sent(page, "window-state-query")).toHaveLength(1);

    expect(await region(page, "[data-workbench-titlebar]")).toEqual(["drag"]);
    // 完整菜单栏（reka 在 nb-ui Menubar 里渲染的触发器）与 ≡ 两种宽度各验一次。
    expect(await page.locator("[data-workbench-titlebar] [role=menuitem]").count()).toBeGreaterThan(0);
    expect(new Set(await region(page, INTERACTIVE))).toEqual(new Set(["no-drag"]));
    await page.setViewportSize({width: 700, height: 800});
    await expect(titlebar(page)).toHaveAttribute("data-titlebar-level", /[2-5]/u);
    expect(new Set(await region(page, INTERACTIVE))).toEqual(new Set(["no-drag"]));
});

test("工作台：窗口按钮贴住窗口右上角，右栏不压在它下面，两侧够宽时搜索在窗口正中", async ({page}) => {
    await installFrame(page);
    for (const width of [1600, 1280, 900]) {
        await page.setViewportSize({width, height: 800});
        if (width === 1600) await openWorkbench(page);
        const buttons = await controls(page).boundingBox();
        if (buttons === null) throw new Error("没有窗口按钮");
        expect(buttons.x + buttons.width).toBe(width);
        expect(buttons.y).toBe(0);
        const lastEnd = await page.$$eval("[data-workbench-titlebar] .workbench-titlebar__end > *", (elements) => Math.max(...elements.map((element) => element.getBoundingClientRect().right)));
        expect(lastEnd).toBeLessThanOrEqual(buttons.x);
        // 1280 宽时右栏（布局按钮、条目、窗口按钮的留位）已经比一半宽，搜索往左让，不再居中。
        if (width === 1600) {
            const search = await page.locator("[data-titlebar-search]").boundingBox();
            if (search === null) throw new Error("没有搜索按钮");
            expect(Math.abs(search.x + search.width / 2 - width / 2)).toBeLessThanOrEqual(1);
        }
    }
});

test("窗口按钮的命中区 34×36、关闭按钮到窗口右上角，按钮组宽等于留位；指针在命中区边角也点亮芯", async ({page}) => {
    await installFrame(page);
    await page.setViewportSize({width: 1280, height: 800});
    await openWorkbench(page);
    const group = await controls(page).boundingBox();
    expect(group?.width).toBe(120);
    for (const control of ["minimize", "toggle-maximize", "close"]) {
        const box = await page.locator(`[data-desktop-control="${control}"]`).boundingBox();
        expect([box?.width, box?.height]).toEqual([34, 36]);
    }
    const close = await page.locator("[data-desktop-control=close]").boundingBox();
    expect([close!.x + close!.width, close!.y]).toEqual([1280, 0]);
    const chip = page.locator("[data-desktop-control=minimize] .desktop-frame__chip");
    expect(await chip.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    const minimize = (await page.locator("[data-desktop-control=minimize]").boundingBox())!;
    // 命中区的左上角，离芯 4px 以上。
    await page.mouse.move(minimize.x + 2, minimize.y + 2);
    await expect.poll(() => chip.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
});

test("高对比度模式下三个窗口按钮的图标仍看得见：描边色是系统给的按钮文字色，不是背景色", async ({page}) => {
    await installFrame(page);
    await page.emulateMedia({forcedColors: "active"});
    await openWorkbench(page);
    const colors = await page.$$eval("[data-desktop-controls] svg", (icons) => icons.map((icon) => ({stroke: getComputedStyle(icon).stroke, visible: icon.getBoundingClientRect().width > 0})));
    const canvas = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(colors).toHaveLength(3);
    for (const {stroke, visible} of colors) {
        expect(visible).toBe(true);
        expect(stroke).not.toBe(canvas);
        expect(stroke).not.toBe("none");
    }
});

test("“页面不存在”：画后备标题栏，内容从 36px 处开始，视口没有滚动条，按钮贴住右缘", async ({page}) => {
    await installFrame(page);
    await page.setViewportSize({width: 1000, height: 700});
    await page.goto(new URL("/nope", server.url).href);
    await expect(page.locator("[data-page-not-found]")).toBeVisible();
    await expect(fallbackBar(page)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-desktop-frame-bar", "");
    await expect(fallbackBar(page)).toContainText("页面不存在");
    expect(await region(page, "[data-desktop-fallback-bar]")).toEqual(["drag"]);
    const app = await page.locator("#app").boundingBox();
    expect(app?.y).toBe(36);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const buttons = await controls(page).boundingBox();
    expect((buttons?.x ?? 0) + (buttons?.width ?? 0)).toBe(1000);
});

test("书架首页：不画后备标题栏，页面从窗口顶端开始，顶端 36px 的透明行是拖动区域，窗口按钮浮在页面上、左边没有分隔线", async ({page}) => {
    await installFrame(page);
    await page.setViewportSize({width: 1000, height: 700});
    await page.goto(new URL("/", server.url).href);
    await expect(page.locator("[data-bookshelf-page]")).toBeVisible();
    await expect(fallbackBar(page)).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveAttribute("data-desktop-frame-bar", /.*/u);
    expect((await page.locator("#app").boundingBox())?.y).toBe(0);
    const strip = page.locator("[data-bookshelf-page] [data-desktop-titlebar]");
    const box = await strip.boundingBox();
    expect(box).toMatchObject({x: 0, y: 0, width: 1000, height: 36});
    expect(await region(page, "[data-bookshelf-page] [data-desktop-titlebar]")).toEqual(["drag"]);
    // 书架上有点击行为的部分（设置齿轮、卡片按钮）不能是拖动区域。
    expect(await region(page, "[data-bookshelf-page] button")).not.toContain("drag");
    expect(await page.locator(".desktop-frame__divider").evaluate((element) => getComputedStyle(element).visibility)).toBe("hidden");
    const buttons = await controls(page).boundingBox();
    expect((buttons?.x ?? 0) + (buttons?.width ?? 0)).toBe(1000);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("按钮把动作交给壳；壳推来最大化后按钮名换成“还原”", async ({page}) => {
    await installFrame(page);
    await openWorkbench(page);
    await controls(page).getByRole("button", {name: "最小化"}).click();
    await controls(page).getByRole("button", {name: "最大化"}).click();
    await controls(page).getByRole("button", {name: "关闭"}).click();
    await expect.poll(() => sent(page, "window-control")).toEqual([{type: "window-control", action: "minimize"}, {type: "window-control", action: "toggle-maximize"}, {type: "window-control", action: "close"}]);
    await shell(page, {type: "window-state", maximized: true});
    await expect(controls(page).getByRole("button", {name: "还原"})).toBeVisible();
});

test("关闭前询问开着时（模态与 inert 都在）：窗口按钮照样能点，消息交给壳", async ({page}) => {
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify({"nbook.editor/autoSave": "off"}));
    await installFrame(page);
    await openWorkbench(page);
    const folder = page.locator('[data-explorer-row="project://notes"]');
    if (await folder.getAttribute("aria-expanded") !== "true") await folder.click();
    await page.locator('[data-explorer-row="project://notes/a.md"]').dblclick();
    const prose = page.locator("[data-editor-group-active] [data-editor-kind=\"nbook.editor.markdown\"]:visible [data-editor-prose]");
    await prose.locator("p").last().click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("乙");
    await shell(page, {type: "close-query", generation: 1, reason: "window"});
    await expect(page.locator("[data-close-layer]")).toBeVisible();
    await expect(page.locator("[data-editor-window-close-dialog]")).toBeVisible();
    // 模态开着时 reka 给它之外的兄弟节点设 aria-hidden（外框根也在其中），按角色找不到按钮，按属性找；点击要真的落在按钮上。
    await page.locator('[data-desktop-control="minimize"]').click();
    await expect.poll(() => sent(page, "window-control")).toEqual([{type: "window-control", action: "minimize"}]);
});

test("设置窗口（经 Portal 的浮动窗口）不是拖动区域，点它的顶边不会变成拖窗口", async ({page}) => {
    await installFrame(page);
    await openWorkbench(page);
    await page.keyboard.press("Control+,");
    const settings = page.getByRole("dialog", {name: "设置"});
    await expect(settings).toBeVisible();
    expect(await settings.evaluate((element) => getComputedStyle(element).getPropertyValue("-webkit-app-region"))).toBe("no-drag");
});

test("盖在标题栏上的浮层（命令面板）不是拖动区域", async ({page}) => {
    await installFrame(page);
    await openWorkbench(page);
    await page.keyboard.press("Control+Shift+P");
    const input = page.getByRole("combobox", {name: "输入命令，或输入 : 跳到某一行"});
    await expect(input).toBeVisible();
    const regions = await input.evaluate((element) => {
        let top: Element = element;
        while (top.parentElement !== null && top.parentElement !== document.body) top = top.parentElement;
        return [top.id, getComputedStyle(top).getPropertyValue("-webkit-app-region"), getComputedStyle(element).getPropertyValue("-webkit-app-region")];
    });
    expect(regions[0]).not.toBe("app");
    expect(regions.slice(1)).toEqual(["no-drag", "no-drag"]);
});

test("磨砂窗口（<html data-window-backdrop>）：窗体底只罩淡淡的一层、外层面板半透明、编辑器所在的卡片不透明；没有这个属性时面板是不透明的", async ({page}) => {
    await installFrame(page);
    await page.setViewportSize({width: 1280, height: 800});
    // 计算后的颜色可能是 `rgba(r, g, b, a)`，也可能是 color-mix 给的 `color(srgb r g b / a)`：取透明度。
    const alphaOf = (selector: string): Promise<number> => page.locator(selector).first().evaluate((element) => {
        const color = getComputedStyle(element).backgroundColor;
        const slash = /\/\s*([\d.]+)\s*\)/u.exec(color);
        if (slash !== null) return Number(slash[1]);
        if (color.startsWith("color(")) return 1; // 没有 “/ 透明度” 的 color() 是不透明的
        const parts = /\(([^)]*)\)/u.exec(color)?.[1]?.split(/[\s,]+/u).filter((part) => part !== "") ?? [];
        return parts.length >= 4 ? Number(parts[3]) : 1;
    });
    await openWorkbench(page);
    expect(await alphaOf("[data-shell-card^='section:']")).toBe(1);

    // 预加载脚本在页面脚本之前设这个属性；这里页面已经起来，直接设同一个属性验样式。
    await page.evaluate(() => document.documentElement.setAttribute("data-window-backdrop", "acrylic"));
    // 根上只罩淡淡的一层主题底色：看得见窗口底，又不至于全透。
    const root = await alphaOf("html");
    expect(root).toBeGreaterThan(0);
    expect(root).toBeLessThan(0.6);
    const side = await alphaOf("[data-shell-card^='section:']");
    expect(side).toBeGreaterThan(0.3);
    expect(side).toBeLessThan(0.9);
    // 编辑器分组（g0）的卡片仍不透明：字落在不透明的纸上。
    expect(await alphaOf("[data-shell-card='g0']")).toBe(1);

    // “减少透明”：两层罩色盖满，底与面板退回不透明（Playwright 的 emulateMedia 没有这个特性，走 CDP）。
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setEmulatedMedia", {features: [{name: "prefers-reduced-transparency", value: "reduce"}]});
    expect(await alphaOf("html")).toBe(1);
    expect(await alphaOf("[data-shell-card^='section:']")).toBe(1);
    await cdp.send("Emulation.setEmulatedMedia", {features: [{name: "prefers-reduced-transparency", value: "no-preference"}]});
    expect(await alphaOf("html")).toBeLessThan(0.6);
});

test("没有能力标记（普通浏览器）：不画外框，`<html>` 不带属性，工作台占满视口", async ({page}) => {
    await page.setViewportSize({width: 1280, height: 800});
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(controls(page)).toHaveCount(0);
    await expect(fallbackBar(page)).toHaveCount(0);
    expect(await page.evaluate(() => ["data-desktop-frame", "data-desktop-frame-bar"].some((name) => document.documentElement.hasAttribute(name)))).toBe(false);
    const workbench = await page.locator(".nb-workbench-page").boundingBox();
    expect(workbench?.height).toBe(800);
    const end = await page.locator("[data-workbench-titlebar] .workbench-titlebar__end").evaluate((element) => getComputedStyle(element).paddingRight);
    expect(end).toBe("0px");
});
