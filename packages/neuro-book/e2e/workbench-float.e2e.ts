/**
 * 应用内浮动（docs/specs/ui/workbench-layout.md 输出 39）在真实浏览器里：松手没有落点就浮动打开，整窗移动、撕下、停靠、缩放、叠放、键盘。工具视图用测试插件的；编辑器标签在 editor-area.e2e.ts。
 */

import {mkdir, rm} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Locator, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {CLIENT_IDENTITY_KEY} from "nbook/web/host/client-identity";
import {SHELL_PANEL_MIN_WIDTH} from "nbook/plugins/workbench/web/shell/sizes";

import {startProbeServer} from "./fixtures";
import type {ProbeServer} from "./fixtures";

const D = "test.sample-views.delta";
const E = "test.sample-views.omega";
const NOT_FLOATABLE = "test.sample-views.zeta";

const LEAF = "[data-workbench-surface] > [data-grid-scope] > [data-leaf]";
const leaf = (page: Page, id: string) => page.locator(`${LEAF}[data-leaf="${id}"]`);
const windows = (page: Page) => page.locator(`${LEAF}[data-float]`);
const tab = (page: Page, viewId: string) => page.locator(`[data-panel-tab="view:${viewId}"]`);
const ghost = (page: Page) => page.locator("[data-workbench-drag-ghost]");
const feedback = (page: Page) => page.locator("[data-drop-kind]");
const area = (page: Page) => page.locator("[data-drop-feedback-area]");
const label = (page: Page) => page.locator("[data-drop-feedback-label]");
const content = (page: Page, viewId: string) => page.locator(`[data-content="view:${viewId}"]`);
const head = (page: Page, panel: string) => page.locator(`[data-panel-head="${panel}"]`);
const panelOfTab = (page: Page, viewId: string): Promise<string> => tab(page, viewId).evaluate((element) => element.closest<HTMLElement>("[data-panel-head]")!.dataset.panelHead!);

async function centerOf(locator: Locator): Promise<{x: number; y: number}> {
    const found = await locator.boundingBox();
    if (found === null) throw new Error("元素没有盒子");
    return {x: found.x + found.width / 2, y: found.y + found.height / 2};
}

async function inLeaf(page: Page, panel: string, fraction: {x: number; y: number}): Promise<{x: number; y: number}> {
    const found = await leaf(page, panel).boundingBox();
    if (found === null) throw new Error(`没有 ${panel} 的外框`);
    return {x: found.x + found.width * fraction.x, y: found.y + found.height * fraction.y};
}

async function press(page: Page, source: Locator | {x: number; y: number}): Promise<{x: number; y: number}> {
    const from = "x" in source ? source : await centerOf(source);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y + 10, {steps: 2});
    return from;
}

/** 拖到 `to`，拖动在这一步之后进行中。 */
async function dragTo(page: Page, source: Locator | {x: number; y: number}, to: {x: number; y: number}): Promise<void> {
    await press(page, source);
    await page.mouse.move(to.x, to.y, {steps: 6});
}

async function dropAt(page: Page, source: Locator | {x: number; y: number}, to: {x: number; y: number}): Promise<void> {
    await dragTo(page, source, to);
    await page.mouse.up();
    await expect(ghost(page)).toHaveCount(0);
}

/** 把视图浮出来：拖到编辑组里松手（缺省中央；落在别的窗上是并进去）。返回窗的面板 id。 */
async function floatOut(page: Page, viewId: string, at: {x: number; y: number} = {x: 0.5, y: 0.5}): Promise<string> {
    await dropAt(page, tab(page, viewId), await inLeaf(page, "g0", at));
    await expect.poll(() => panelOfTab(page, viewId)).not.toBe("");
    return panelOfTab(page, viewId);
}

/** 落点是下一帧才画出来的：等两帧再断言没有，免得断言在落点出现之前通过。 */
const noFeedback = async (page: Page): Promise<void> => {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(feedback(page)).toHaveCount(0);
};

const boxOf = async (page: Page, panel: string): Promise<{x: number; y: number; width: number; height: number}> => {
    const found = await leaf(page, panel).boundingBox();
    if (found === null) throw new Error(`没有 ${panel} 的外框`);
    return found;
};

test.describe("应用内浮动", () => {
    let tmp = "";
    let server: ProbeServer;

    // 每个用例一份干净的布局：浮动窗留在记录里，会串到下一个用例。
    test.beforeEach(async () => {
        tmp = await createTestTmpRoot("neuro-book-e2e", "workbench-float");
        await mkdir(join(tmp, "state"), {recursive: true});
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views", NBOOK_EXCLUDE_PLUGINS: "nbook.explorer,nbook.editor,nbook.agent"}});
    });

    test.afterEach(async () => {
        expect(await server.stop()).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 1440, height: 900}});

    async function writesOf(page: Page): Promise<number> {
        const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
        const db = new DatabaseSync(join(tmp, "state", "storage", "user.sqlite"));
        try {
            db.exec("CREATE TABLE IF NOT EXISTS layout_writes (client TEXT)");
            db.exec(`CREATE TRIGGER IF NOT EXISTS count_layout_insert AFTER INSERT ON records WHEN NEW.owner = 'nbook.workbench' AND NEW.key = 'workbench.layout' BEGIN INSERT INTO layout_writes VALUES (NEW.client); END`);
            db.exec(`CREATE TRIGGER IF NOT EXISTS count_layout_update AFTER UPDATE ON records WHEN NEW.owner = 'nbook.workbench' AND NEW.key = 'workbench.layout' BEGIN INSERT INTO layout_writes VALUES (NEW.client); END`);
            return (db.prepare("SELECT count(*) AS n FROM layout_writes WHERE client = ?1").get(client) as {n: number}).n;
        } finally {
            db.close();
        }
    }

    async function open(page: Page): Promise<void> {
        await page.goto(new URL("/workbench", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(page.locator("[data-shell-focus-target=\"panel-toggle\"]")).toBeEnabled();
    }

    test("工具视图拖到编辑组中央松手：浮动打开，内容是同一个节点，写一次；刷新后还在原处", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const node = await content(page, E).elementHandle();
        const target = await inLeaf(page, "g0", {x: 0.5, y: 0.5});
        await dragTo(page, tab(page, E), target);
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "float");
        await expect(label(page)).toHaveText("浮动打开");
        await expect(area(page)).toBeVisible();
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect(windows(page)).toHaveCount(1);
        const panel = await panelOfTab(page, E);
        expect(await panelOfTab(page, E)).not.toBe("panel");
        expect(await content(page, E).evaluate((element, other) => element === other, node)).toBe(true);
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
        // 指针落在头上：窗的头就在松手处。
        const box = await boxOf(page, panel);
        expect(target.x).toBeGreaterThan(box.x);
        expect(target.y).toBeGreaterThanOrEqual(box.y);
        expect(target.y).toBeLessThan(box.y + 32);
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(windows(page)).toHaveCount(1);
        expect(await boxOf(page, panel)).toEqual(box);
    });

    test("不浮动的情形：视图声明不许、按钮区、Esc；都不开窗、不写", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const center = await inLeaf(page, "g0", {x: 0.5, y: 0.5});
        // 面板里两个标签，己声明不许浮动。按下不切标签，拖不起来也不写。
        await dragTo(page, tab(page, NOT_FLOATABLE), center);
        await expect(ghost(page)).toBeVisible();
        await noFeedback(page);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        expect(await panelOfTab(page, NOT_FLOATABLE)).toBe("panel");

        await dragTo(page, tab(page, E), await centerOf(head(page, "panel").locator("[data-panel-action=\"nbook.view.toggle-panel-maximized\"]")));
        await expect(ghost(page)).toBeVisible();
        await noFeedback(page);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);

        await dragTo(page, tab(page, E), center);
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "float");
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);

        await expect(windows(page)).toHaveCount(0);
        expect(await writesOf(page)).toBe(writes);
    });

    test("拖窗：跟手、没有过渡、不写；放下写一次；经过面板中央继续浮着", async ({page}) => {
        await open(page);
        const baseline = await writesOf(page);
        const panel = await floatOut(page, E);
        const start = await boxOf(page, panel);
        await expect.poll(() => writesOf(page)).toBeGreaterThan(baseline);
        const writes = await writesOf(page);
        const node = await content(page, E).elementHandle();
        const from = await press(page, tab(page, E));
        // 整窗本身就在跟手，没有拖影。
        await expect(ghost(page)).toHaveCount(0);
        const over = await inLeaf(page, "sidebar", {x: 0.5, y: 0.5});
        await page.mouse.move(over.x, over.y, {steps: 4});
        const moved = await boxOf(page, panel);
        expect(moved.x).toBeCloseTo(start.x + over.x - from.x, 0);
        expect(moved.y).toBeCloseTo(Math.max(0, start.y + over.y - from.y), 0);
        // 拖动中不接指针：判定看得到底下。
        expect(await leaf(page, panel).evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
        expect(await writesOf(page)).toBe(writes);
        await page.mouse.up();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
        await expect(windows(page)).toHaveCount(1);
        expect(await boxOf(page, panel)).toEqual(moved);
        expect(await content(page, E).evaluate((element, other) => element === other, node)).toBe(true);

        // Esc：回到拿起前，不写。
        await press(page, tab(page, E));
        await page.mouse.move(over.x + 100, over.y + 50, {steps: 3});
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect.poll(async () => (await boxOf(page, panel)).x).toBeCloseTo(moved.x, 0);
        expect(await writesOf(page)).toBe(writes + 1);
    });

    test("窗刚开、过渡还在走时拖它：跟手，没有拖尾", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        const panel = await floatOut(page, E);
        // 不等过渡：`[data-moving]` 还在。
        const start = await boxOf(page, panel);
        const from = await press(page, tab(page, E));
        await page.mouse.move(from.x + 200, from.y + 60);
        const moved = await boxOf(page, panel);
        expect(moved.x).toBeCloseTo(start.x + 200, 0);
        expect(moved.y).toBeCloseTo(start.y + 60, 0);
        await page.keyboard.press("Escape");
        await page.mouse.up();
    });

    test("窗被夹着时，移动、单击手柄都不把夹过的大小写回", async ({page}) => {
        await open(page);
        const panel = await floatOut(page, E);
        const chrome = page.locator(`[data-float-chrome="${panel}"]`);
        const recorded = await boxOf(page, panel);
        await page.setViewportSize({width: 420, height: 300});
        await expect.poll(async () => (await boxOf(page, panel)).width).toBeLessThan(recorded.width);
        // 单击手柄（没动）、键盘移动、拖一下。
        const corner = await centerOf(chrome.locator("[data-float-handle=\"bottom-right\"]"));
        await page.mouse.click(corner.x, corner.y);
        await chrome.locator("[data-float-move-handle]").focus();
        await page.keyboard.press("ArrowLeft");
        const onHead = await centerOf(tab(page, E));
        await dropAt(page, onHead, {x: onHead.x - 30, y: onHead.y + 10});
        await page.setViewportSize({width: 1440, height: 900});
        await expect.poll(async () => (await boxOf(page, panel)).width).toBe(recorded.width);
        expect((await boxOf(page, panel)).height).toBe(recorded.height);
    });

    test("窗回到树里：到标签条并入，到 14% 窄带拆开，内容是同一个节点；28% 处还是移动", async ({page}) => {
        await open(page);
        const panel = await floatOut(page, E);
        const node = await content(page, E).elementHandle();

        // 侧栏这一列上下分：下缘 20% 处超过 14%，不算窄带。
        await press(page, tab(page, E));
        const notBand = await inLeaf(page, "sidebar", {x: 0.5, y: 0.8});
        await page.mouse.move(notBand.x, notBand.y, {steps: 4});
        await expect(feedback(page).and(page.locator("[data-drop-kind=\"edge\"]"))).toHaveCount(0);
        const band = await inLeaf(page, "sidebar", {x: 0.5, y: 0.95});
        await page.mouse.move(band.x, band.y, {steps: 2});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "edge");
        await page.mouse.up();
        await expect(windows(page)).toHaveCount(0);
        expect(await panelOfTab(page, E)).toBe(panel);
        expect(await content(page, E).evaluate((element, other) => element === other, node)).toBe(true);

        // 再浮出来，并到右栏的标签条。
        await floatOut(page, E);
        const strip = await page.locator("[data-panel-band=\"auxiliarybar\"]").boundingBox();
        await dragTo(page, tab(page, E), {x: strip!.x + strip!.width - 10, y: strip!.y + strip!.height / 2});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "strip");
        await page.mouse.up();
        await expect(windows(page)).toHaveCount(0);
        expect(await panelOfTab(page, E)).toBe("auxiliarybar");
        expect(await content(page, E).evaluate((element, other) => element === other, node)).toBe(true);
    });

    test("多标签的窗：并入标签条；拖标签是撕下，拖标签条空白是移动整窗", async ({page}) => {
        await open(page);
        const panel = await floatOut(page, E);
        const band = await page.locator(`[data-panel-band="${panel}"]`).boundingBox();
        const blank = {x: band!.x + band!.width - 6, y: band!.y + band!.height / 2};
        await dropAt(page, tab(page, D), blank);
        await expect.poll(() => panelOfTab(page, D)).toBe(panel);
        await expect(windows(page)).toHaveCount(1);

        // 空白：整窗移动，两个标签都还在。
        const before = await boxOf(page, panel);
        await dragTo(page, blank, {x: blank.x - 120, y: blank.y + 60});
        await page.mouse.up();
        await expect.poll(async () => (await boxOf(page, panel)).x).toBeCloseTo(before.x - 120, 0);
        expect(await panelOfTab(page, D)).toBe(panel);

        // 标签：撕下来是新窗。
        await dropAt(page, tab(page, D), await inLeaf(page, "g0", {x: 0.1, y: 0.3}));
        await expect(windows(page)).toHaveCount(2);
        expect(await panelOfTab(page, D)).not.toBe(panel);
        expect(await panelOfTab(page, E)).toBe(panel);
    });

    test("框架按钮：树里的工具面板能浮动，浮动窗只有回到停靠，回声明的位置，内容是同一个节点", async ({page}) => {
        await open(page);
        const node = await content(page, E).elementHandle();
        await head(page, "panel").locator("[data-panel-action=\"nbook.view.float\"]").click();
        await expect(windows(page)).toHaveCount(1);
        const panel = await panelOfTab(page, E);
        const actions = await head(page, panel).locator("[data-panel-action]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-panel-action")));
        expect(actions).toEqual(["nbook.view.dock"]);
        await head(page, panel).locator("[data-panel-action=\"nbook.view.dock\"]").click();
        await expect(windows(page)).toHaveCount(0);
        expect(await panelOfTab(page, E)).toBe("panel");
        expect(await content(page, E).evaluate((element, other) => element === other, node)).toBe(true);
    });

    test("缩放：角与边的手柄，有最小尺寸；放下写一次；键盘缩放与移动", async ({page}) => {
        await open(page);
        const baseline = await writesOf(page);
        const panel = await floatOut(page, E);
        const chrome = page.locator(`[data-float-chrome="${panel}"]`);
        const start = await boxOf(page, panel);
        await expect.poll(() => writesOf(page)).toBeGreaterThan(baseline);
        const writes = await writesOf(page);
        const corner = await centerOf(chrome.locator("[data-float-handle=\"bottom-right\"]"));
        await page.mouse.move(corner.x, corner.y);
        await page.mouse.down();
        await page.mouse.move(corner.x + 60, corner.y + 40, {steps: 3});
        await expect.poll(async () => (await boxOf(page, panel)).width).toBeCloseTo(start.width + 60, 0);
        expect(await writesOf(page)).toBe(writes);
        await page.mouse.up();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
        expect((await boxOf(page, panel)).height).toBeCloseTo(start.height + 40, 0);

        // 左边：位置跟着改；再怎么拖也不小于最小尺寸，右边不动。
        const grown = await boxOf(page, panel);
        const left = await centerOf(chrome.locator("[data-float-handle=\"left\"]"));
        await page.mouse.move(left.x, left.y);
        await page.mouse.down();
        await page.mouse.move(left.x + 2000, left.y, {steps: 3});
        await page.mouse.up();
        await expect.poll(async () => (await boxOf(page, panel)).width).toBe(SHELL_PANEL_MIN_WIDTH);
        const narrow = await boxOf(page, panel);
        expect(narrow.x + narrow.width).toBeCloseTo(grown.x + grown.width, 0);

        // 键盘。
        const keyStart = await boxOf(page, panel);
        await chrome.locator("[data-float-handle=\"bottom-right\"]").focus();
        await page.keyboard.press("ArrowRight");
        await expect.poll(async () => (await boxOf(page, panel)).width).toBeCloseTo(keyStart.width + 10, 0);
        await chrome.locator("[data-float-move-handle]").focus();
        await page.keyboard.press("Shift+ArrowLeft");
        await expect.poll(async () => (await boxOf(page, panel)).x).toBeCloseTo(keyStart.x - 1, 0);
    });

    test("窗口变小：窗夹回来，标签条抓得到，记录不改；变回来还在原处；夹住时拖窗不跳", async ({page}) => {
        await open(page);
        const panel = await floatOut(page, E);
        // 拖到靠右下，留出夹取的余地。
        const box = await boxOf(page, panel);
        await dropAt(page, tab(page, E), {x: 1380, y: 700});
        await expect.poll(async () => (await boxOf(page, panel)).x).toBeGreaterThan(box.x);
        const far = await boxOf(page, panel);
        await page.setViewportSize({width: 900, height: 600});
        await expect.poll(async () => (await boxOf(page, panel)).x).toBeLessThan(far.x);
        const clamped = await boxOf(page, panel);
        const onHead = await centerOf(tab(page, E));
        expect(onHead.x).toBeLessThan(900);
        expect(onHead.y).toBeLessThan(600);
        // 拖动从呈现的位置开始：刚过门槛时只动了门槛这么多。
        await page.mouse.move(onHead.x, onHead.y);
        await page.mouse.down();
        await page.mouse.move(onHead.x - 10, onHead.y - 10, {steps: 2});
        const started = await boxOf(page, panel);
        expect(Math.abs(started.x - (clamped.x - 10))).toBeLessThanOrEqual(1);
        expect(Math.abs(started.y - (clamped.y - 10))).toBeLessThanOrEqual(1);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await page.setViewportSize({width: 1440, height: 900});
        await expect.poll(async () => (await boxOf(page, panel)).x).toBeCloseTo(far.x, 0);
    });

    test("点击提到最前，已在最前不写；盖在别的面板上，树里的面板最大化时窗还在", async ({page}) => {
        await open(page);
        const baseline = await writesOf(page);
        // 第一个靠左，第二个开在它旁边、盖住它的右边一点：指针落在第一个窗外面才不是并进去。
        const first = await floatOut(page, E, {x: 0.15, y: 0.3});
        const firstRect = await boxOf(page, first);
        const second = await floatOut(page, D, {x: 0.15, y: 0.02});
        const zIndex = (panel: string): Promise<number> => leaf(page, panel).evaluate((element) => Number(getComputedStyle(element).zIndex));
        expect(await zIndex(second)).toBeGreaterThan(await zIndex(first));
        expect((await boxOf(page, second)).y + (await boxOf(page, second)).height).toBeGreaterThan(firstRect.y);
        await expect.poll(() => writesOf(page)).toBeGreaterThan(baseline);
        const settledWrites = await writesOf(page);
        // 点窗的正文：提到最前，写一次。
        const firstBox = await boxOf(page, first);
        await page.mouse.click(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height - 30);
        await expect.poll(async () => (await zIndex(first)) > (await zIndex(second))).toBe(true);
        await expect.poll(() => writesOf(page)).toBeGreaterThan(settledWrites);
        const raised = await writesOf(page);
        // 再点它的头：已在最前，不写。接着点第二个窗提到最前，写入只多一次：前一下要是写了这里就是两次。
        await head(page, first).click({position: {x: firstBox.width - 40, y: 12}});
        const secondBox = await boxOf(page, second);
        await page.mouse.click(secondBox.x + 30, secondBox.y + 60);
        await expect.poll(async () => (await zIndex(second)) > (await zIndex(first))).toBe(true);
        await expect.poll(() => writesOf(page)).toBe(raised + 1);

        // 树里的面板最大化：别的面板被盖住，窗还在上面，能用。
        await head(page, "sidebar").locator("[data-panel-action=\"nbook.view.toggle-panel-maximized\"]").click();
        await expect(windows(page)).toHaveCount(2);
        expect(await leaf(page, first).evaluate((element) => element.hasAttribute("inert"))).toBe(false);
        await expect(content(page, E)).toBeVisible();
        expect(await leaf(page, first).evaluate((element) => Number(getComputedStyle(element).zIndex))).toBeGreaterThan(await leaf(page, "sidebar").evaluate((element) => Number(getComputedStyle(element).zIndex) || 0));
    });

    test("键盘：区域里有“浮动”；拿起窗里的标签停在原位，Enter 不动；可以回到树里；F6 经过窗", async ({page}) => {
        await open(page);
        // 面板里两个标签，戊拿起，最后一个区域是“浮动”：Shift+Tab 绕到它。
        await tab(page, E).focus();
        await page.keyboard.press("Space");
        await expect(ghost(page)).toBeVisible();
        await page.keyboard.press("Shift+Tab");
        // 从面板往回：先经过别的区域，直到“浮动”。
        for (let step = 0; step < 6 && (await feedback(page).getAttribute("data-drop-kind").catch(() => null)) !== "float"; step += 1) await page.keyboard.press("Tab");
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "float");
        await page.keyboard.press("Enter");
        await expect(ghost(page)).toHaveCount(0);
        await expect(windows(page)).toHaveCount(1);
        const panel = await panelOfTab(page, E);
        await expect(tab(page, E)).toBeFocused();

        // 窗里只有这一个标签：拿起停在原位，Enter 不动。
        const before = await boxOf(page, panel);
        await page.keyboard.press("Space");
        await expect(ghost(page)).toBeVisible();
        await page.keyboard.press("Enter");
        await expect(ghost(page)).toHaveCount(0);
        expect(await panelOfTab(page, E)).toBe(panel);
        expect(await boxOf(page, panel)).toEqual(before);

        // F6 能到窗。
        await page.locator("[data-panel-tab=\"view:" + D + "\"]").focus();
        for (let step = 0; step < 8 && (await page.evaluate((id) => document.activeElement?.closest(`[data-leaf="${id}"], [data-content-leaf="${id}"]`) === null, panel)); step += 1) await page.keyboard.press("F6");
        expect(await page.evaluate((id) => document.activeElement?.closest(`[data-leaf="${id}"], [data-content-leaf="${id}"]`) !== null, panel)).toBe(true);
    });
});
