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
import {SAMPLE_VIEWS_RUN_EVENT} from "nbook/shared/testing/sample-views-contract";

import {startProbeServer} from "./fixtures";
import type {ProbeServer} from "./fixtures";

const A = "test.sample-views.alpha";
const D = "test.sample-views.delta";
const E = "test.sample-views.omega";
const NOT_FLOATABLE = "test.sample-views.zeta";

const LEAF = "[data-workbench-surface] > [data-grid-scope] > [data-leaf]";
const leaf = (page: Page, id: string) => page.locator(`${LEAF}[data-leaf="${id}"]`);
const windows = (page: Page) => page.locator(`${LEAF}[data-float]`);
/**
 * 视图的标题：头上的标题按钮。底部面板并成一行时头不写标题，按下的入口就是它的标题（右键开“移动到”、拖它就是拖这个视图，
 * docs/specs/ui/workbench-layout.md 输出 47）；只在没有标题按钮时取到它。
 */
const tab = (page: Page, viewId: string) => page.locator(`[data-panel-tab="view:${viewId}"], [data-region-strip="panel"] [data-tool-view="${viewId}"][aria-pressed="true"]`);
const ghost = (page: Page) => page.locator("[data-workbench-drag-ghost]");
const feedback = (page: Page) => page.locator("[data-drop-kind]");
const area = (page: Page) => page.locator("[data-drop-feedback-area]");
const label = (page: Page) => page.locator("[data-drop-feedback-label]");
const content = (page: Page, viewId: string) => page.locator(`[data-content="view:${viewId}"]`);
const head = (page: Page, panel: string) => page.locator(`[data-panel-head="${panel}"]`);
/** 视图所在分节的面板头：头里有它的标题；底部面板并成一行时头不写标题，是按下的入口是它的那条入口条里并进来的头（输出 47）。 */
const headOf = (page: Page, viewId: string) => page.locator(`[data-panel-head]:has([data-panel-tab="view:${viewId}"]), [data-region-strip="panel"]:has([data-tool-view="${viewId}"][aria-pressed="true"]) [data-panel-head]`);
const panelOfTab = async (page: Page, viewId: string): Promise<string> => (await headOf(page, viewId).getAttribute("data-panel-head"))!;
/**
 * 视图所在的块：每个样例视图没写容器，是自己的隐式容器里唯一的分节（docs/specs/ui/workbench-layout.md 输出 40、41），分节的 id 是布局起的；
 * 内容项上写着它所在的叶。侧栏显示甲、右栏显示丁、底部面板显示戊。
 */
async function sectionOf(page: Page, viewId: string): Promise<string> {
    const id = await content(page, viewId).getAttribute("data-content-leaf");
    if (id === null) throw new Error(`${viewId} 不在任何面板里`);
    return id;
}

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

/** 不在面板上的地方：松手开窗。 */
const offPanels = (page: Page): Promise<{x: number; y: number}> => centerOf(page.locator("[data-shell-titlebar]"));

/** 把视图浮出来：拖到标题栏上松手；`at` 是之后再把窗拖到编辑组里的哪儿。返回窗的面板 id。 */
async function floatOut(page: Page, viewId: string, at?: {x: number; y: number}): Promise<string> {
    await dropAt(page, tab(page, viewId), await offPanels(page));
    await expect.poll(() => panelOfTab(page, viewId)).not.toBe("");
    if (at !== undefined) await dropAt(page, tab(page, viewId), await inLeaf(page, "g0", at));
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
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views", NBOOK_EXCLUDE_PLUGINS: "nbook.explorer,nbook.editor,nbook.agent,nbook.bots,nbook.canon,nbook.plot"}});
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

    /** 记录里这个视图所在分节的归属（输出 40）；还没写到记录里时为 null。 */
    async function savedContainerOf(page: Page, viewId: string): Promise<string | null> {
        const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
        const db = new DatabaseSync(join(tmp, "state", "storage", "user.sqlite"));
        try {
            const row = db.prepare("SELECT value FROM records WHERE owner = 'nbook.workbench' AND key = 'workbench.layout' AND client = ?1").get(client) as {value: string} | undefined;
            if (row === undefined) return null;
            const panels = (JSON.parse(row.value) as {doc: {panels: Record<string, {readonly tabs: ReadonlyArray<{readonly viewId?: string}>; readonly container?: string}>}}).doc.panels;
            return Object.values(panels).find((panel) => panel.tabs.some((item) => item.viewId === viewId))?.container ?? null;
        } finally {
            db.close();
        }
    }

    async function open(page: Page): Promise<void> {
        await page.goto(new URL("/workbench", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(page.locator("[data-shell-focus-target=\"panel-toggle\"]")).toBeEnabled();
    }

    test("工具视图拖到标题栏上松手：浮动打开，内容是同一个节点，写一次；刷新后还在原处", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const node = await content(page, E).elementHandle();
        const target = await offPanels(page);
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
        // 窗开在松手处，夹回树区域：标题栏在树外，窗贴着树的顶边。
        const box = await boxOf(page, panel);
        expect(target.x).toBeGreaterThan(box.x);
        expect(box.y).toBeGreaterThan(target.y);
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(windows(page)).toHaveCount(1);
        expect(await boxOf(page, panel)).toEqual(box);
    });

    test("拖到状态栏上松手：窗整个露出来，不开到屏幕外", async ({page}) => {
        await open(page);
        const bar = await centerOf(page.locator("[data-leaf=\"statusbar\"]"));
        await dropAt(page, tab(page, E), {x: bar.x, y: bar.y});
        await expect(windows(page)).toHaveCount(1);
        await expect(page.locator("[data-moving]")).toHaveCount(0);
        const box = await boxOf(page, await panelOfTab(page, E));
        expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
        expect(box.y).toBeGreaterThan(0);
    });

    test("面板上被拒绝：工具视图在编辑组上，没有反馈、光标是禁止、读屏写原因；松手取消，不开窗、不写", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const home = await sectionOf(page, E);
        await dragTo(page, tab(page, E), await inLeaf(page, "g0", {x: 0.5, y: 0.5}));
        await noFeedback(page);
        await expect(page.locator("html")).toHaveAttribute("data-drop-rejected", "");
        expect(await leaf(page, "g0").evaluate((element) => getComputedStyle(element).cursor)).toBe("not-allowed");
        await expect(page.locator("[data-drag-live-status]")).toHaveText("不能放在这里");
        // 还在被拒绝的面板上移动：标记不动。规则里有 `*`，写一下整页都要重算样式。
        await page.evaluate(() => {
            const probe = window as unknown as {__rejectedWrites: number};
            probe.__rejectedWrites = 0;
            new MutationObserver((records) => {
                probe.__rejectedWrites += records.length;
            }).observe(document.documentElement, {attributes: true, attributeFilter: ["data-drop-rejected"]});
        });
        const elsewhere = await inLeaf(page, "g0", {x: 0.6, y: 0.6});
        await page.mouse.move(elsewhere.x, elsewhere.y, {steps: 8});
        await noFeedback(page);
        expect(await page.evaluate(() => (window as unknown as {__rejectedWrites: number}).__rejectedWrites)).toBe(0);
        // 离开面板就不再是拒绝：标题栏上是浮动。
        const off = await offPanels(page);
        await page.mouse.move(off.x, off.y, {steps: 4});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "float");
        await expect(page.locator("html")).not.toHaveAttribute("data-drop-rejected", "");
        const back = await inLeaf(page, "g0", {x: 0.5, y: 0.5});
        await page.mouse.move(back.x, back.y, {steps: 4});
        await noFeedback(page);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect(page.locator("html")).not.toHaveAttribute("data-drop-rejected", "");
        await expect(windows(page)).toHaveCount(0);
        expect(await panelOfTab(page, E)).toBe(home);
        expect(await writesOf(page)).toBe(writes);
    });

    test("不浮动的情形：视图声明不许、按钮区、Esc；都不开窗、不写", async ({page}) => {
        await open(page);
        // 己声明不许浮动；它是底部面板里另一个容器唯一的分节，先用“打开视图”把底部面板切过去（输出 42，一次写入）。
        const opened = await writesOf(page);
        await page.evaluate(({name, view}) => window.dispatchEvent(new CustomEvent(name, {detail: {command: "nbook.view.open", args: {viewId: view}}})), {name: SAMPLE_VIEWS_RUN_EVENT, view: NOT_FLOATABLE});
        await expect(tab(page, NOT_FLOATABLE)).toBeVisible();
        await expect.poll(() => writesOf(page)).toBe(opened + 1);
        const writes = await writesOf(page);
        const home = await sectionOf(page, NOT_FLOATABLE);
        const center = await offPanels(page);
        // 拖不起来也不写。
        await dragTo(page, tab(page, NOT_FLOATABLE), center);
        await expect(ghost(page)).toBeVisible();
        await noFeedback(page);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        expect(await panelOfTab(page, NOT_FLOATABLE)).toBe(home);

        // 按钮区：丁拖到底部面板那一节头上的“最大化”上。
        await dragTo(page, tab(page, D), await centerOf(head(page, home).locator("[data-panel-action=\"nbook.view.toggle-panel-maximized\"]")));
        await expect(ghost(page)).toBeVisible();
        await noFeedback(page);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);

        await dragTo(page, tab(page, D), center);
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
        /** 这一点命中的元素在哪块面板里（内容项写着它的叶）。 */
        const panelAt = (point: {x: number; y: number}) => page.evaluate(({x, y}) => {
            const hit = document.elementFromPoint(x, y);
            return hit?.closest("[data-content-leaf]")?.getAttribute("data-content-leaf") ?? hit?.closest("[data-leaf]")?.getAttribute("data-leaf") ?? null;
        }, point);
        // 手柄盖着整个窗，空白处不接指针（ui/nested-grid 输出 113）：窗的正文中央命中的是窗的内容，不是手柄。
        const body = await centerOf(content(page, E));
        const chromeBox = (await page.locator(`[data-float-chrome="${panel}"]`).boundingBox())!;
        expect(body.x > chromeBox.x && body.x < chromeBox.x + chromeBox.width && body.y > chromeBox.y && body.y < chromeBox.y + chromeBox.height).toBe(true);
        expect(await page.evaluate(({x, y}) => document.elementFromPoint(x, y)?.closest("[data-content]")?.getAttribute("data-content") ?? null, body)).toBe(`view:${E}`);
        const from = await press(page, tab(page, E));
        // 整窗本身就在跟手，没有拖影。
        await expect(ghost(page)).toHaveCount(0);
        const alpha = await sectionOf(page, A);
        const over = await inLeaf(page, alpha, {x: 0.5, y: 0.5});
        await page.mouse.move(over.x, over.y, {steps: 4});
        const moved = await boxOf(page, panel);
        expect(moved.x).toBeCloseTo(start.x + over.x - from.x, 0);
        expect(moved.y).toBeCloseTo(Math.max(0, start.y + over.y - from.y), 0);
        // 拖动中不接指针：判定看得到底下（ui/nested-grid 输出 114）。指针压着窗的头，命中的是底下甲那一节；窗的正文中央也命中不到窗。
        expect(await leaf(page, panel).evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
        expect(await panelAt(over)).toBe(alpha);
        const movedBody = await centerOf(content(page, E));
        expect(await panelAt(movedBody)).not.toBeNull();
        expect(await panelAt(movedBody)).not.toBe(panel);
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
        // 不等过渡：`[data-moving]` 还在（拖出来的窗从卡片长到终点）。按下时过渡直接到终点，之后两次移动之间窗挪的就是指针挪的。
        const from = await press(page, tab(page, E));
        await page.mouse.move(from.x + 100, from.y + 30);
        const start = await boxOf(page, panel);
        await page.mouse.move(from.x + 200, from.y + 60);
        const moved = await boxOf(page, panel);
        expect(moved.x).toBeCloseTo(start.x + 100, 0);
        expect(moved.y).toBeCloseTo(start.y + 30, 0);
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

        // 侧栏这一列上下分：甲那一节下缘 20% 处超过 14%，不算窄带（整窗拖动到分节上只有沿区域方向两端的窄带与缝，输出 39；验收 23）。
        const alpha = await sectionOf(page, A);
        await press(page, tab(page, E));
        const notBand = await inLeaf(page, alpha, {x: 0.5, y: 0.8});
        await page.mouse.move(notBand.x, notBand.y, {steps: 4});
        await expect(feedback(page).and(page.locator("[data-drop-kind=\"edge\"]"))).toHaveCount(0);
        const band = await inLeaf(page, alpha, {x: 0.5, y: 0.95});
        await page.mouse.move(band.x, band.y, {steps: 2});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "edge");
        await page.mouse.up();
        await expect(windows(page)).toHaveCount(0);
        expect(await panelOfTab(page, E)).toBe(panel);
        expect(await content(page, E).evaluate((element, other) => element === other, node)).toBe(true);

        // 再浮出来，回到右栏：分节没有标签条，经过分节中央继续浮着；到这一节下缘的窄带才停靠，成为右栏的一个分节（输出 39；验收 23）。
        // 分节的头落在上缘 14% 窄带里，经过它就是停靠点，所以“继续浮着”取正文中央。
        await floatOut(page, E, {x: 0.5, y: 0.3});
        const delta = await sectionOf(page, D);
        await press(page, tab(page, E));
        const middle = await inLeaf(page, delta, {x: 0.5, y: 0.5});
        await page.mouse.move(middle.x, middle.y, {steps: 4});
        // 继续浮着时窗就是反馈，没有落点指示。
        await noFeedback(page);
        const auxBand = await inLeaf(page, delta, {x: 0.5, y: 0.95});
        await page.mouse.move(auxBand.x, auxBand.y, {steps: 4});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "edge");
        await page.mouse.up();
        await expect(windows(page)).toHaveCount(0);
        // 在右栏：和丁那一节同一列，在它下面；归右栏的当前容器（丁的隐式容器，输出 39）。
        await expect.poll(async () => (await boxOf(page, await sectionOf(page, E))).x).toBeCloseTo((await boxOf(page, delta)).x, 0);
        expect((await boxOf(page, await sectionOf(page, E))).y).toBeGreaterThan((await boxOf(page, delta)).y);
        await expect.poll(() => savedContainerOf(page, E)).toBe(`view:${D}`);
        expect(await content(page, E).evaluate((element, other) => element === other, node)).toBe(true);
    });

    test("停靠的过渡从松手处出发：首帧离松手处近，不先跳回按下之前的位置（ui/nested-grid 输出 172）", async ({page}) => {
        await open(page);
        const panel = await floatOut(page, E, {x: 0.3, y: 0.3});
        const moving = page.locator("[data-workbench-surface] [data-moving]");
        await expect(moving).toHaveCount(0);
        // 过渡要真的在跑：时长为 0 时采样不到中间帧，用例会空过。窗已经停稳之后再打开，开窗的过渡不混进来。
        await page.emulateMedia({reducedMotion: "no-preference"});
        const delta = await sectionOf(page, D);
        const pressed = await boxOf(page, panel);
        await press(page, tab(page, E));
        const auxBand = await inLeaf(page, delta, {x: 0.5, y: 0.95});
        await page.mouse.move(auxBand.x, auxBand.y, {steps: 6});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "edge");
        const dropped = await boxOf(page, panel);
        // 松手后每一帧记下这块外框的位置。采样会读布局、强制浏览器算样式，所以从松手之后才开始：
        // `pointerup` 监听挂在 window 的冒泡阶段，晚于工作台的提交。
        await page.evaluate((id) => {
            const win = window as unknown as {__frames: {x: number; y: number}[]; __sampling: boolean};
            win.__frames = [];
            win.__sampling = true;
            const sample = () => {
                const element = document.querySelector(`[data-workbench-surface] > [data-grid-scope] > [data-leaf="${id}"]`);
                if (element !== null) {
                    const {x, y} = element.getBoundingClientRect();
                    win.__frames.push({x, y});
                }
                if (win.__sampling) requestAnimationFrame(sample);
            };
            window.addEventListener("pointerup", () => requestAnimationFrame(sample), {once: true});
        }, panel);
        await page.mouse.up();
        await expect(windows(page)).toHaveCount(0);
        await expect(moving.first()).toBeAttached();
        await expect(moving).toHaveCount(0);
        const frames = await page.evaluate(() => {
            const win = window as unknown as {__frames: {x: number; y: number}[]; __sampling: boolean};
            win.__sampling = false;
            return win.__frames;
        });
        const distance = (a: {x: number; y: number}, b: {x: number; y: number}): number => Math.hypot(a.x - b.x, a.y - b.y);
        // 松手处离按下之前的位置隔得远，“第一帧离哪个近”才分得出两种起点。
        expect(distance(dropped, pressed)).toBeGreaterThan(200);
        const first = frames.findIndex((each) => distance(each, dropped) > 1);
        expect(first).toBeGreaterThanOrEqual(0);
        const start = frames[first]!;
        expect(distance(start, dropped)).toBeLessThan(distance(start, pressed));
        // 之后还有几帧才到终点：确实是在飞，不是一帧就到。
        expect(frames.length - first).toBeGreaterThanOrEqual(4);
    });

    test("多标签的窗：并入标签条；拖标签是撕下，拖标签条空白是移动整窗", async ({page}) => {
        await open(page);
        // 摆到编辑组上：开在标题栏下面的窗会盖住右栏，拖不到那边的标签。
        const panel = await floatOut(page, E, {x: 0.5, y: 0.3});
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
        await dropAt(page, tab(page, D), await offPanels(page));
        await expect(windows(page)).toHaveCount(2);
        expect(await panelOfTab(page, D)).not.toBe(panel);
        expect(await panelOfTab(page, E)).toBe(panel);
    });

    test("框架按钮：树里的工具面板能浮动，浮动窗只有回到停靠，回声明的位置，内容是同一个节点", async ({page}) => {
        await open(page);
        const node = await content(page, E).elementHandle();
        const home = await sectionOf(page, E);
        await head(page, home).locator("[data-panel-action=\"nbook.view.float\"]").click();
        await expect(windows(page)).toHaveCount(1);
        const panel = await panelOfTab(page, E);
        const actions = await head(page, panel).locator("[data-panel-action]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-panel-action")));
        expect(actions).toEqual(["nbook.view.dock"]);
        await head(page, panel).locator("[data-panel-action=\"nbook.view.dock\"]").click();
        await expect(windows(page)).toHaveCount(0);
        // 回声明的位置：底部面板，在编辑组下面；戊没写容器，回它自己的隐式容器（输出 39）。
        expect((await boxOf(page, await sectionOf(page, E))).y).toBeGreaterThan((await boxOf(page, "g0")).y);
        await expect.poll(() => savedContainerOf(page, E)).toBe(`view:${E}`);
        expect(await content(page, E).evaluate((element, other) => element === other, node)).toBe(true);
    });

    test("框架按钮浮动、停靠的过渡：整张卡片从那一节拿起来飞到窗的位置，停靠时飞回去；每一帧外框与内容是同一块，内容在上面；投影与圆角在外框上，第一帧就有，停靠时按加速的曲线淡去（ui/nested-grid 输出 88、107、109、110、112）", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        const moving = page.locator("[data-workbench-surface] [data-moving]");
        // 打开后的布局过渡走完再量、再点：过渡中开窗时内容从它此刻的位置出发，外框从布局的终点出发，起点差一截。
        await expect(moving).toHaveCount(0);
        const home = await sectionOf(page, E);
        const source = await boxOf(page, home);
        /** 点一下按钮，逐帧量视图所在的外框与内容，直到网格的过渡结束；点在页面里，第一帧就开始量。 */
        const film = (button: string, view: string) => page.evaluate(async ({button, view}) => {
            const box = (element: Element) => {
                const rect = element.getBoundingClientRect();
                return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
            };
            const rows: Array<{float: boolean; frame: ReturnType<typeof box>; content: ReturnType<typeof box>; contentOnTop: boolean; at: number; shadow: string; radius: number; contentShadow: string}> = [];
            document.querySelector<HTMLElement>(button)!.click();
            for (let index = 0; index < 90; index += 1) {
                await new Promise((resolve) => requestAnimationFrame(resolve));
                const contentEl = document.querySelector<HTMLElement>(`[data-content="view:${view}"]`)!;
                const frameEl = document.querySelector(`[data-workbench-surface] > [data-grid-scope] > [data-leaf="${CSS.escape(contentEl.dataset.contentLeaf!)}"]`);
                if (frameEl !== null) {
                    const rect = box(contentEl);
                    // 内容正中命中的是内容自己：外框的卡片底色没盖住它。
                    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
                    // 窗的投影与圆角（ui/nested-grid 输出 107、110、112）：过渡中读到的是插值。
                    const style = getComputedStyle(frameEl);
                    rows.push({
                        float: frameEl.hasAttribute("data-float"),
                        frame: box(frameEl),
                        content: rect,
                        contentOnTop: hit !== null && contentEl.contains(hit),
                        at: performance.now(),
                        shadow: style.boxShadow,
                        radius: Number.parseFloat(style.borderTopLeftRadius),
                        contentShadow: getComputedStyle(contentEl).boxShadow,
                    });
                }
                if (index > 2 && document.querySelector("[data-workbench-surface] [data-moving]") === null) break;
            }
            return rows;
        }, {button, view});
        /**
         * 每一帧内容的左、右、下边就是外框的：同一个起点、同一个终点、同一条曲线，不是两张卡片错开；内容一直盖在外框上面。
         * 上边是外框的上边加面板头。戊是底部面板唯一的一节，头并在入口条里（ui/workbench-layout 输出 47），叶里没有头：浮出去时内容的上边距从 0
         * 跟着过渡长到浮动窗的头高，停靠回去时从头高缩回 0（内容层按起止两个内容矩形过渡），一路朝终点走、不回跳。
         */
        const expectOneCard = (rows: Awaited<ReturnType<typeof film>>, headed: boolean) => {
            const insetOf = (row: (typeof rows)[number]) => row.content.y - row.frame.y;
            const [start, head] = [insetOf(rows[0]!), insetOf(rows.at(-1)!)];
            if (headed) expect(head).toBeGreaterThan(0);
            else expect(head).toBe(0);
            const [low, high, direction] = [Math.min(start, head), Math.max(start, head), Math.sign(head - start)];
            let previous = start;
            for (const row of rows) {
                const {frame, content: inner, contentOnTop} = row;
                expect(Math.abs(inner.x - frame.x)).toBeLessThanOrEqual(1);
                expect(Math.abs(inner.x + inner.width - (frame.x + frame.width))).toBeLessThanOrEqual(1);
                expect(Math.abs(inner.y + inner.height - (frame.y + frame.height))).toBeLessThanOrEqual(1);
                const inset = insetOf(row);
                expect(inset).toBeGreaterThanOrEqual(low - 1);
                expect(inset).toBeLessThanOrEqual(high + 1);
                expect((inset - previous) * direction).toBeGreaterThanOrEqual(-1);
                previous = inset;
                expect(contentOnTop).toBe(true);
            }
        };
        const near = (left: {x: number; y: number}, right: {x: number; y: number}): boolean => Math.abs(left.x - right.x) <= 2 && Math.abs(left.y - right.y) <= 2;

        // 浮动：窗出现的第一帧，外框在那一节原来的位置（按新叶算，浮动窗没有兄弟，会直接画在终点）；确实量到了半路。
        const floating = await film(`[data-panel-head="${home}"] [data-panel-action="nbook.view.float"]`, E);
        await expect(moving).toHaveCount(0);
        const panel = await panelOfTab(page, E);
        const floatBox = await boxOf(page, panel);
        expect(near(floating.find((row) => row.float)!.frame, source)).toBe(true);
        expect(floating.some(({frame}) => !near(frame, source) && !near(frame, floatBox))).toBe(true);
        expectOneCard(floating, true);
        // 投影与圆角第一帧就有（输出 107），画在外框自身、不在内容上（输出 112）。
        const firstFloat = floating.find((row) => row.float)!;
        expect(firstFloat.shadow).not.toBe("none");
        expect(firstFloat.radius).toBeGreaterThan(0);
        for (const row of floating.filter((item) => item.float)) expect(row.contentShadow).toBe("none");

        // 停靠：窗的叶回到树里的第一帧，外框还在窗的位置，从那里飞回去；内容跟着、压在外框上面。
        const docking = await film(`[data-panel-head="${panel}"] [data-panel-action="nbook.view.dock"]`, E);
        await expect(moving).toHaveCount(0);
        expect(near(docking.find((row) => !row.float)!.frame, floatBox)).toBe(true);
        expect(docking.some(({frame}) => !near(frame, floatBox) && !near(frame, source))).toBe(true);
        expectOneCard(docking, false);
        // 窗的投影与圆角随过渡淡去（输出 110）：落回树里那一帧还是卡片，圆角一路只减不增，走完才没；曲线是加速的，过渡走到一半时圆角还剩大半。
        const landing = docking.filter((row) => !row.float);
        const [first, last] = [landing[0]!, landing.at(-1)!];
        expect(first.radius).toBeGreaterThan(0);
        expect(first.shadow).not.toBe("none");
        for (let index = 1; index < landing.length; index += 1) expect(landing[index]!.radius).toBeLessThanOrEqual(landing[index - 1]!.radius + 0.01);
        expect(last.radius).toBe(0);
        expect(last.shadow).toBe("none");
        const middle = landing.reduce((best, row) => (Math.abs(row.at - (first.at + last.at) / 2) < Math.abs(best.at - (first.at + last.at) / 2) ? row : best));
        expect(middle.radius).toBeGreaterThan(first.radius * 0.6);

        // 侧栏的分节头在它自己的叶里：浮出去、停靠回来，两头都有头，每一帧内容的上边都是外框上边加头高（不用上面那段放宽）。
        const expectHeadKept = (rows: Awaited<ReturnType<typeof film>>) => {
            const head = rows.at(-1)!.content.y - rows.at(-1)!.frame.y;
            expect(head).toBeGreaterThan(0);
            for (const {frame, content: inner, contentOnTop} of rows) {
                expect(Math.abs(inner.y - frame.y - head)).toBeLessThanOrEqual(1);
                expect(Math.abs(inner.x - frame.x)).toBeLessThanOrEqual(1);
                expect(Math.abs(inner.y + inner.height - (frame.y + frame.height))).toBeLessThanOrEqual(1);
                expect(contentOnTop).toBe(true);
            }
        };
        const alpha = await sectionOf(page, A);
        const out = await film(`[data-panel-head="${alpha}"] [data-panel-action="nbook.view.float"]`, A);
        await expect(moving).toHaveCount(0);
        expect(out.some((row) => row.float)).toBe(true);
        expectHeadKept(out);
        const back = await film(`[data-panel-head="${await panelOfTab(page, A)}"] [data-panel-action="nbook.view.dock"]`, A);
        await expect(moving).toHaveCount(0);
        expectHeadKept(back);
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
        const alpha = await sectionOf(page, A);
        await head(page, alpha).locator("[data-panel-action=\"nbook.view.toggle-panel-maximized\"]").click();
        await expect(windows(page)).toHaveCount(2);
        expect(await leaf(page, first).evaluate((element) => element.hasAttribute("inert"))).toBe(false);
        await expect(content(page, E)).toBeVisible();
        expect(await leaf(page, first).evaluate((element) => Number(getComputedStyle(element).zIndex))).toBeGreaterThan(await leaf(page, alpha).evaluate((element) => Number(getComputedStyle(element).zIndex) || 0));
    });

    test("三扇窗时聚焦最底下那扇的移动把手：它提到最前，焦点留在把手上（ui/nested-grid 输出 103）", async ({page}) => {
        await open(page);
        const bottom = await floatOut(page, E, {x: 0.15, y: 0.3});
        const middle = await floatOut(page, D, {x: 0.35, y: 0.2});
        const top = await floatOut(page, A, {x: 0.55, y: 0.1});
        await expect(windows(page)).toHaveCount(3);
        await expect(page.locator("[data-workbench-surface] [data-moving]")).toHaveCount(0);
        const zIndex = (panel: string): Promise<number> => leaf(page, panel).evaluate((element) => Number(getComputedStyle(element).zIndex));
        expect(await zIndex(bottom)).toBeLessThan(await zIndex(middle));
        expect(await zIndex(middle)).toBeLessThan(await zIndex(top));
        // 最底下那扇提到最前，要把另外两扇都排到它下面：手柄层搬了它的节点的话，焦点当场丢到 body。
        const move = page.locator(`[data-float-chrome="${bottom}"] [data-float-move-handle]`);
        await move.focus();
        await expect.poll(async () => (await zIndex(bottom)) > (await zIndex(top))).toBe(true);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await expect(move).toBeFocused();
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
