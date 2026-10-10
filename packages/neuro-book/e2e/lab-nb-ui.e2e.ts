/**
 * nb-ui 组件在 Lab 场景里的真实浏览器行为：浮层的展开方向、禁用项、页面不锁、Escape 关闭，以及非模态窗口的外部交互与
 * 键盘调整尺寸。原来在 nb-ui playground 的 Lab 用例里（`packages/nb-ui/e2e/lab.spec.ts`），playground 的 Lab 退役时
 * 迁到这里，改为对新应用 Lab 里的真实组件场景断言（w00017 t73）。拖动与嵌套分栏的手势验收仍在 nb-ui 的
 * `e2e/nested-grid.spec.ts`、`e2e/splitter.spec.ts`。
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
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-nb-ui");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const labState = (page: Page) => page.evaluate(() => (window as unknown as {__nbLab?: {state(): LabDebugState}}).__nbLab?.state() ?? null);

async function openScene(page: Page, query: string): Promise<void> {
    await page.goto(`${dev.pageUrl}lab?${query}`);
    await expect.poll(async () => (await labState(page))?.ready).toBe(true);
}

/** 舞台里的被测元素；Lab 外壳自己的下拉框也是 combobox，所以限定在舞台里。 */
const stage = (page: Page) => page.locator(".lab-main [data-lab-stage]");
const popperSide = (page: Page) => page.locator("[data-reka-popper-content-wrapper] > *").first();

test("下拉选择：Enter 展开、向下展开、页面不锁、禁用项选不中、Escape 关闭", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1200});
    await openScene(page, "c=FormSelect&s=default");
    // 列表打开时 reka 把列表之外的元素标成 aria-hidden，按角色就找不到触发器了，所以用属性选择器。
    const trigger = stage(page).locator('[role="combobox"]');
    await trigger.focus();
    await page.keyboard.press("Enter");
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    await expect(popperSide(page)).toHaveAttribute("data-side", "bottom");

    // 非模态浮层：列表开着时页面仍然可以滚动、可以点。
    expect(await page.evaluate(() => ({overflow: document.body.style.overflow, pointerEvents: document.body.style.pointerEvents}))).toEqual({overflow: "", pointerEvents: ""});

    const disabled = listbox.getByRole("option").filter({hasText: "日本語"});
    await expect(disabled).toHaveAttribute("aria-disabled", "true");
    for (let index = 0; index < 6; index += 1) await page.keyboard.press("ArrowDown");
    await expect(disabled).toHaveAttribute("aria-selected", "false");
    await expect(trigger).toContainText("简体中文");

    await page.keyboard.press("Escape");
    await expect(listbox).toBeHidden();
});

test("下拉选择：指定向上展开时浮层在上方", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1200});
    await openScene(page, "c=FormSelect&s=up");
    await stage(page).getByRole("combobox").click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(popperSide(page)).toHaveAttribute("data-side", "top");
});

test("下拉选择的长列表：收起成截半高度，键盘走到最后一项时它滚进可见区；富选项带图标与说明", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1200});
    await openScene(page, "c=FormSelect&s=long");
    await stage(page).locator('[role="combobox"]').click();
    const viewport = page.locator("[data-reka-select-viewport]");
    await expect(viewport).toBeVisible();
    const size = await viewport.evaluate((element) => ({client: element.clientHeight, scroll: element.scrollHeight}));
    expect(size.scroll).toBeGreaterThan(size.client);
    // 14 项不全展开：设计规范的截半高度在 194 与 228 之间。
    expect(size.client).toBeGreaterThanOrEqual(180);
    expect(size.client).toBeLessThanOrEqual(240);
    await expect(page.getByRole("option").filter({hasText: "EPUB 电子书"}).locator(".i-lucide-book-open")).toBeAttached();
    await expect(page.getByRole("option").filter({hasText: "EPUB 电子书"})).toContainText("按卷生成目录");

    // End 一步走到最后一项。reka 在 keydown 之后才挪焦点（setTimeout），连按方向键不等焦点移动会合并成一步。
    await page.keyboard.press("End");
    const last = page.getByRole("option").filter({hasText: "NeuroBook 备份"});
    await expect(last).toHaveAttribute("data-highlighted");
    const [box, item] = await Promise.all([viewport.boundingBox(), last.boundingBox()]);
    expect(item!.y).toBeGreaterThanOrEqual(box!.y - 1);
    expect(item!.y + item!.height).toBeLessThanOrEqual(box!.y + box!.height + 1);
});

test("非模态窗口：不画遮罩、六个调整手柄、窗口外照常可点，方向键调整宽度一次 10px", async ({page}) => {
    await page.setViewportSize({width: 1600, height: 1000});
    await openScene(page, "c=DialogWindow&s=resizable");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-labelledby", /.+/u);
    await expect(page.locator("[data-dialog-overlay]")).toHaveCount(0);
    for (const handle of ["right", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"]) {
        await expect(dialog.locator(`[data-dialog-resize='${handle}']`)).toBeVisible();
    }

    // 窗口外的元素：左栏的组件检索框，它整个在窗口左边。非模态窗口不被外部交互关闭。
    const search = page.getByRole("searchbox", {name: "搜组件名或部件名称"});
    const [windowBox, searchBox] = await Promise.all([dialog.boundingBox(), search.boundingBox()]);
    expect((searchBox?.x ?? 0) + (searchBox?.width ?? 0)).toBeLessThan(windowBox?.x ?? 0);
    await search.click();
    await expect(search).toBeFocused();
    await expect(dialog).toBeVisible();

    const before = (await dialog.boundingBox())!.width;
    await dialog.locator("[data-dialog-resize='right']").focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => Math.round((await dialog.boundingBox())!.width - before)).toBe(10);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("非模态窗口在手机画布里：按画布宽度收窄，落在画布以内", async ({page}) => {
    await page.setViewportSize({width: 1600, height: 1000});
    await openScene(page, "c=DialogWindow&s=resizable&vp=phone");
    const dialog = page.locator("[data-lab-overlay-root] [role='dialog']");
    await expect(dialog).toBeVisible();
    const [canvas, window] = await Promise.all([page.locator(".lab-main .nb-lab-stage-box").first().boundingBox(), dialog.boundingBox()]);
    expect(window!.x).toBeGreaterThanOrEqual(canvas!.x);
    expect(window!.x + window!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width + 1);
});

/** 事件页签的全文：事件名与负载都在里面。 */
async function recordedEvents(page: Page): Promise<string> {
    return (await page.locator('[data-lab-panel="events"]').textContent()) ?? "";
}

test("菜单栏：方向键在项之间移动并跳过禁用项，禁用项带原因，Enter 选中后关闭并把焦点还给组标题；左右键换组后 Escape 回到最初的组标题", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1000});
    await openScene(page, "c=Menubar&s=flat&tab=events");
    const edit = stage(page).getByRole("menuitem", {name: "编辑"});
    await edit.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();

    const redo = menu.getByRole("menuitem", {name: "重做"});
    await expect(redo).toHaveAttribute("aria-disabled", "true");
    await expect(redo).toHaveAttribute("title", "没有可以重做的操作");
    await expect(redo).toHaveAttribute("aria-description", "没有可以重做的操作");

    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", {name: "撤销"})).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", {name: "查找"})).toBeFocused();
    await page.keyboard.press("Home");
    await expect(menu.getByRole("menuitem", {name: "撤销"})).toBeFocused();
    await page.keyboard.press("End");
    await expect(menu.getByRole("menuitem", {name: "查找"})).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await expect(edit).toBeFocused();
    await expect.poll(() => recordedEvents(page)).toContain("find");

    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("menu").getByRole("menuitemcheckbox", {name: "显示侧栏"})).toBeVisible();
    await page.keyboard.press("Escape");
    // 关闭动画期间已关闭的菜单还在 DOM 里（data-state=closed），只核对没有打开着的。
    await expect(page.locator('[role="menu"][data-state="open"]')).toHaveCount(0);
    // 用左右键换过组之后，Escape 把焦点还给最初打开菜单的组标题（reka 的行为），也就是打开菜单之前焦点所在的位置。
    await expect(edit).toBeFocused();
});

test("下拉菜单：方向键跳过禁用项，禁用项带原因，Enter 选中", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1000});
    await openScene(page, "c=Dropdown&s=default&tab=events");
    await stage(page).getByRole("button", {name: "更多操作"}).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const trash = menu.getByRole("menuitem", {name: "移到回收站"});
    await expect(trash).toHaveAttribute("aria-disabled", "true");
    await expect(trash).toHaveAttribute("aria-description", "根目录不能移到回收站");

    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", {name: "重命名"})).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", {name: "复制路径"})).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", {name: "排序方式"})).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await expect.poll(() => recordedEvents(page)).toContain("copy-path");
});
