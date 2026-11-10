/**
 * 实时布局（docs/specs/ui/workbench-layout.md“实时布局”）在真实浏览器里：邻居真实让位、预览不写记录、松手提交指针下的候选、取消回原样。应用的 Playwright 配置缺省减少动态效果，那时一律落点指示，所以这里每个用例开回来。
 */

import {mkdir, rm, writeFile} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Locator, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {CLIENT_IDENTITY_KEY} from "nbook/web/host/client-identity";

import {startProbeServer} from "./fixtures";
import type {ProbeServer} from "./fixtures";

const E = "test.sample-views.omega";
const AUXILIARY_VIEW = "test.sample-views.delta";

const ghost = (page: Page) => page.locator("[data-workbench-drag-ghost]");
const surface = (page: Page) => page.locator("[data-workbench-surface]");
const leaf = (page: Page, id: string) => page.locator(`[data-workbench-surface] > [data-grid-scope] > [data-leaf="${id}"]`);
const tab = (page: Page, viewId: string) => page.locator(`[data-panel-tab="view:${viewId}"]`);
const panelOfTab = (page: Page, viewId: string): Promise<string> => tab(page, viewId).evaluate((element) => element.closest<HTMLElement>("[data-panel-head]")!.dataset.panelHead!);

async function centerOf(locator: Locator): Promise<{x: number; y: number}> {
    const found = await locator.boundingBox();
    if (found === null) throw new Error("没有矩形");
    return {x: found.x + found.width / 2, y: found.y + found.height / 2};
}

async function inLeaf(page: Page, panel: string, fraction: {x: number; y: number}): Promise<{x: number; y: number}> {
    const found = await leaf(page, panel).boundingBox();
    if (found === null) throw new Error(`没有 ${panel} 的外框`);
    return {x: found.x + found.width * fraction.x, y: found.y + found.height * fraction.y};
}

/** 外框的过渡走完：量几何之前等它（docs/testing/README.md“e2e 量几何先等它稳定”）。 */
const settled = (page: Page): Promise<void> => expect(page.locator("[data-moving]")).toHaveCount(0);
const content = (page: Page, viewId: string) => page.locator(`[data-content="view:${viewId}"]`);
/** 这块面板的头里看得见的标签：只写标题的头就是那一个。 */
const headTabsOf = (page: Page, panel: string): Promise<Array<string | null>> => page.locator(`[data-panel-head="${panel}"] [data-panel-tab]`).evaluateAll((elements) => elements.map((element) => element.getAttribute("data-panel-tab")));
/** 标签条里被拖的那个标签的外框（`translate` 写在它上面）：显示没有、横向在哪。 */
const sortedFrameOf = (locator: Locator): Promise<{visible: boolean; left: number; right: number}> => locator.evaluate((element) => {
    const frame = element.parentElement as HTMLElement;
    const box = frame.getBoundingClientRect();
    return {visible: getComputedStyle(frame).visibility === "visible", left: box.left, right: box.right};
});
/** 这个标签所在的那一行标签条。 */
const rowOf = (locator: Locator): Promise<{left: number; right: number}> => locator.evaluate((element) => {
    const box = (element.closest("[data-tab-row]") as Element).getBoundingClientRect();
    return {left: box.left, right: box.right};
});
/** 收起的面板整个叶都不在：算 0 宽。 */
const shownWidth = async (page: Page, panel: string): Promise<number> => ((await leaf(page, panel).count()) === 0 ? 0 : ((await leaf(page, panel).boundingBox())?.width ?? 0));
const widthOf = async (page: Page, panel: string): Promise<number> => {
    await settled(page);
    return (await leaf(page, panel).boundingBox())?.width ?? 0;
};

/** 按下、过门槛，拖动进行中，由调用方决定松手还是取消。 */
async function lift(page: Page, source: Locator): Promise<void> {
    const from = await centerOf(source);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y + 10, {steps: 2});
    await expect(surface(page)).toHaveAttribute("data-drag-feel", "live");
}

test.describe("实时布局", () => {
    let tmp = "";
    let server: ProbeServer;

    test.beforeAll(async () => {
        tmp = await createTestTmpRoot("neuro-book-e2e", "workbench-live-drag");
        await mkdir(join(tmp, "state"), {recursive: true});
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views", NBOOK_EXCLUDE_PLUGINS: "nbook.explorer,nbook.editor,nbook.agent,nbook.canon,nbook.plot"}});
    });

    test.afterAll(async () => {
        expect(await server.stop()).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 1440, height: 900}});

    /** 本页客户端对 `workbench.layout` 的写入次数（同 `workbench-dnd.e2e.ts`）。 */
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
        await page.emulateMedia({reducedMotion: "no-preference"});
        await page.goto(new URL("/workbench", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(page.locator("[data-shell-focus-target=\"panel-toggle\"]")).toBeEnabled();
    }

    test("拖到面板这一排的右边：拖动中邻居真实让位，不写记录；松手一次写入，结果就是预览的样子", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const before = await widthOf(page, "panel");
        await lift(page, tab(page, E));
        const target = await inLeaf(page, "panel", {x: 0.97, y: 0.6});
        await page.mouse.move(target.x, target.y, {steps: 6});
        await expect(surface(page)).not.toHaveAttribute("data-live-preview", "none");
        // 预览换树之后布局下一拍才发布，过渡这时才开始：先等宽度真的变了。
        await expect.poll(async () => (await leaf(page, "panel").boundingBox())?.width ?? 0).toBeLessThan(before - 40);
        const previewWidth = await widthOf(page, "panel");
        expect(await writesOf(page)).toBe(writes);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
        await expect(surface(page)).toHaveAttribute("data-drag-feel", "indicator");
        await expect(surface(page)).toHaveAttribute("data-live-preview", "none");
        expect(await panelOfTab(page, E)).not.toBe("panel");
        expect(await widthOf(page, "panel")).toBeCloseTo(previewWidth, 0);
    });

    test("来源是那块面板最后一个视图：落到别处时它收起，指针回到原处也不再展开；Esc 回原样（输出 38）", async ({page}) => {
        await open(page);
        expect(await headTabsOf(page, "auxiliarybar")).toEqual([`view:${AUXILIARY_VIEW}`]);
        const writes = await writesOf(page);
        const home = await centerOf(leaf(page, "auxiliarybar"));
        await lift(page, tab(page, AUXILIARY_VIEW));
        // 拿起的是它唯一的视图：还没落到别处、没收起之前，原位是空位，标题头不留在原地。
        await page.mouse.move(home.x, home.y + 40, {steps: 4});
        await expect(page.locator("[data-lifted]")).toHaveCount(1);
        await expect(page.locator(`[data-panel-head="auxiliarybar"]`)).toHaveCount(0);
        await expect(leaf(page, "auxiliarybar")).toHaveCount(1);
        const target = await inLeaf(page, "sidebar", {x: 0.5, y: 0.5});
        await page.mouse.move(target.x, target.y, {steps: 6});
        await expect(surface(page)).not.toHaveAttribute("data-live-preview", "none");
        await expect.poll(async () => shownWidth(page, "auxiliarybar")).toBeLessThan(2);
        // 回到它原来的位置：那里现在是编辑组，工具视图放不进去，是来源收起的样子，不是放回原处。
        await page.mouse.move(home.x, home.y, {steps: 12});
        await expect(surface(page)).toHaveAttribute("data-live-preview", "source-removed");
        await settled(page);
        expect(await shownWidth(page, "auxiliarybar")).toBeLessThan(2);
        expect(await writesOf(page)).toBe(writes);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect.poll(async () => shownWidth(page, "auxiliarybar")).toBeGreaterThan(100);
        expect(await writesOf(page)).toBe(writes);
    });

    test("候选还没预览就松手：提交指针下的候选", async ({page}) => {
        await open(page);
        const from = await panelOfTab(page, E);
        await lift(page, tab(page, E));
        const target = await inLeaf(page, from === "auxiliarybar" ? "sidebar" : "auxiliarybar", {x: 0.5, y: 0.5});
        await page.mouse.move(target.x, target.y);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect.poll(() => panelOfTab(page, E)).not.toBe(from);
    });

    test("移动与松手在同一个任务里到（候选一帧都没显示过）：还是提交指针下的候选", async ({page}) => {
        await open(page);
        const from = await panelOfTab(page, E);
        await lift(page, tab(page, E));
        const target = await inLeaf(page, from === "auxiliarybar" ? "sidebar" : "auxiliarybar", {x: 0.5, y: 0.5});
        // 两次 Playwright 调用之间浏览器可能已经跑过一帧，分不出“与最后显示的相同才提交”：在页面里同一个任务派发。
        await page.evaluate(({x, y}) => {
            for (const type of ["pointermove", "pointerup"]) window.dispatchEvent(new PointerEvent(type, {bubbles: true, pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: x, clientY: y, button: type === "pointerup" ? 0 : -1, buttons: type === "pointerup" ? 0 : 1}));
        }, target);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect.poll(() => panelOfTab(page, E)).not.toBe(from);
    });

    test("拿起时上一次布局变化的过渡还在走：判定按终点的矩形", async ({page}) => {
        await open(page);
        const finalPanel = await inLeaf(page, "panel", {x: 0.5, y: 0.5});
        const toggle = page.locator("[data-shell-focus-target=\"panel-toggle\"]");
        await toggle.click();
        await expect(leaf(page, "panel")).toHaveCount(0);
        await settled(page);
        // 放慢过渡：面板还在长的时候拿起。过渡中间的矩形里指针下是别的面板（或者没有面板）。
        await page.addStyleTag({content: ":root { --motion-layout: 5000ms !important; }"});
        await toggle.click();
        await expect.poll(() => page.locator("[data-moving]").count()).toBeGreaterThan(0);
        // 面板这一排在动，拖右栏的视图。
        await lift(page, tab(page, AUXILIARY_VIEW));
        await page.mouse.move(finalPanel.x, finalPanel.y, {steps: 3});
        await expect(surface(page)).toHaveAttribute("data-live-preview", /center.*panel.*panel/);
        await page.keyboard.press("Escape");
        await page.mouse.up();
    });

    test("拖到面板外松手：卡片写“浮动打开”，内容从卡片飞到浮动窗，是同一个节点；面板上被拒绝时不写，光标是禁止", async ({page}) => {
        await open(page);
        const content = page.locator(`[data-content="view:${AUXILIARY_VIEW}"]`);
        const node = await content.elementHandle();
        await lift(page, tab(page, AUXILIARY_VIEW));
        const rejected = await inLeaf(page, "g0", {x: 0.5, y: 0.5});
        await page.mouse.move(rejected.x, rejected.y, {steps: 6});
        await expect(page.locator("html")).toHaveAttribute("data-drop-rejected", "");
        await expect(page.locator("[data-drag-card-hint]")).toHaveText("不能放在这里");
        const target = await centerOf(page.locator("[data-shell-titlebar]"));
        await page.mouse.move(target.x, target.y, {steps: 6});
        await expect(page.locator("[data-lifted]")).toHaveCount(1);
        await expect(surface(page)).toHaveAttribute("data-live-preview", /float/);
        await expect(page.locator("[data-drag-card-hint]")).toHaveText("浮动打开");
        const card = await page.locator("[data-lifted]").boundingBox();
        if (card === null) throw new Error("没有卡片");
        // 松手后逐帧量新窗的外框与把手：它们和内容一起从卡片长到终点，不先画在终点。
        await page.evaluate(() => {
            const host = window as unknown as {__floatSamples: Array<{frame: number; chrome: number}>};
            host.__floatSamples = [];
            const sample = (): void => {
                const frame = document.querySelector("[data-workbench-surface] > [data-grid-scope] > [data-leaf][data-float]");
                const chrome = document.querySelector("[data-float-chrome]");
                if (frame !== null && chrome !== null) host.__floatSamples.push({frame: frame.getBoundingClientRect().width, chrome: chrome.getBoundingClientRect().width});
                if (host.__floatSamples.length < 40) requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
        });
        await page.mouse.up();
        await expect(page.locator("[data-lifted]")).toHaveCount(0);
        await expect(page.locator("[data-workbench-surface] > [data-grid-scope] > [data-leaf][data-float]")).toHaveCount(1);
        await expect.poll(() => page.evaluate(() => (window as unknown as {__floatSamples: unknown[]}).__floatSamples.length)).toBe(40);
        const samples = await page.evaluate(() => (window as unknown as {__floatSamples: Array<{frame: number; chrome: number}>}).__floatSamples);
        const [first, last] = [samples[0]!, samples.at(-1)!];
        expect(Math.abs(first.frame - card.width)).toBeLessThan(40);
        expect(Math.abs(first.chrome - first.frame)).toBeLessThan(2);
        expect(last.frame - first.frame).toBeGreaterThan(40);
        expect(await content.evaluate((element, other) => element === other, node)).toBe(true);
        // 布局记录这个文件的用例共用：放回去。
        await page.locator(`[data-panel-head="${await panelOfTab(page, AUXILIARY_VIEW)}"] [data-panel-action="nbook.view.dock"]`).click();
        await expect.poll(() => panelOfTab(page, AUXILIARY_VIEW)).toBe("auxiliarybar");
    });

    test("取消：布局回原样，不写记录", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const from = await panelOfTab(page, E);
        const before = await widthOf(page, "panel");
        await lift(page, tab(page, E));
        const target = await inLeaf(page, "panel", {x: 0.97, y: 0.6});
        await page.mouse.move(target.x, target.y, {steps: 6});
        await expect(surface(page)).not.toHaveAttribute("data-live-preview", "none");
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect(surface(page)).toHaveAttribute("data-live-preview", "none");
        expect(await widthOf(page, "panel")).toBeCloseTo(before, 0);
        expect(await panelOfTab(page, E)).toBe(from);
        expect(await writesOf(page)).toBe(writes);
    });

    test("离开标签条就缩小：指针还在来源面板里，卡片已经是紧凑的（设置缺省）", async ({page}) => {
        await open(page);
        const from = await panelOfTab(page, E);
        await lift(page, tab(page, E));
        const inside = await inLeaf(page, from, {x: 0.5, y: 0.5});
        await page.mouse.move(inside.x, inside.y, {steps: 3});
        const card = page.locator("[data-lifted]");
        await expect(card).toHaveCount(1);
        await expect.poll(async () => (await card.boundingBox())?.width ?? 0).toBeLessThanOrEqual(381);
        await page.keyboard.press("Escape");
        await page.mouse.up();
    });

    test.describe("设置离开面板才缩小（dragCardShrink）", () => {
        const settingsFile = (): string => join(tmp, "state", "settings.json");
        test.beforeEach(async () => {
            await writeFile(settingsFile(), JSON.stringify({"nbook.workbench/dragCardShrink": "panel"}));
        });
        test.afterEach(async () => {
            await rm(settingsFile(), {force: true});
        });

        test("离开标签条撕下一张卡片：内容是同一个节点、盖在分隔线上跟手，抓住的点在指针下；离开来源面板后缩小；取消后回到原处", async ({page}) => {
            await open(page);
            const source = tab(page, E);
            const from = await panelOfTab(page, E);
            const content = page.locator(`[data-content="view:${E}"]`);
            const node = await content.elementHandle();
            await lift(page, source);
            // 还在标签条里：不拿起。
            await expect(page.locator("[data-lifted]")).toHaveCount(0);
            const inside = await inLeaf(page, from, {x: 0.5, y: 0.5});
            await page.mouse.move(inside.x, inside.y, {steps: 3});
            const card = page.locator("[data-lifted]");
            await expect(card).toHaveCount(1);
            expect(await card.evaluate((element, other) => element === other, node)).toBe(true);
            // 还在来源面板里：卡片是面板原大小，不是缩成的 380×260。卡片按布局里的面板矩形摆，和叶元素的盒差几个像素（卡片外沿），所以差 6px 以内算同样大。
            const home = await leaf(page, from).boundingBox();
            if (home === null || (home.width <= 390 && home.height <= 270)) throw new Error(`来源面板 ${String(home?.width)}×${String(home?.height)} 不比小卡大，分不出原大小与缩小后的卡片`);
            await expect.poll(async () => {
                const box = await card.boundingBox();
                return box === null ? Infinity : Math.max(Math.abs(box.width - home.width), Math.abs(box.height - home.height));
            }).toBeLessThanOrEqual(6);
            await expect(page.locator("[data-workbench-drag-ghost]")).toHaveCount(0);
            await expect(page.locator("[data-drag-card-head]")).toHaveCount(1);
            const look = await card.evaluate((element) => {
                const style = getComputedStyle(element);
                return {events: style.pointerEvents, z: style.zIndex};
            });
            expect(look.events).toBe("none");
            expect(Number(look.z)).toBeGreaterThan(3);
            // 离开来源面板：缩到小卡，抓住的点还在指针下。
            const away = {x: inside.x + 500, y: inside.y};
            await page.mouse.move(away.x, away.y, {steps: 4});
            await expect.poll(async () => (await card.boundingBox())?.width ?? 0).toBeLessThanOrEqual(385);
            const box = await card.boundingBox();
            expect(away.x).toBeGreaterThanOrEqual(box?.x ?? 0);
            expect(away.x).toBeLessThanOrEqual((box?.x ?? 0) + (box?.width ?? 0));
            expect(away.y).toBeGreaterThanOrEqual(box?.y ?? 0);
            expect(away.y).toBeLessThanOrEqual((box?.y ?? 0) + (box?.height ?? 0));
            await page.keyboard.press("Escape");
            await page.mouse.up();
            await expect(page.locator("[data-lifted]")).toHaveCount(0);
            await expect(content).not.toHaveAttribute("data-lifted", "");
            await settled(page);
            expect(await content.evaluate((element, other) => element === other, node)).toBe(true);
        });
    });

    test("预览不改可见性，读屏文字按语义变；拖到面板边上有空位，不画分区", async ({page}) => {
        await open(page);
        const instanceCount = () => page.locator("[data-sample-view]").count();
        const instances = await instanceCount();
        await lift(page, tab(page, E));
        const target = await inLeaf(page, "panel", {x: 0.97, y: 0.6});
        await page.mouse.move(target.x, target.y, {steps: 6});
        await expect(surface(page)).not.toHaveAttribute("data-live-preview", "none");
        expect(await instanceCount()).toBe(instances);
        await expect(page.locator("[data-drag-live-status]")).not.toHaveText("");
        await expect(page.locator("[data-live-slot]")).toHaveCount(1);
        await expect(page.locator("[data-drop-sectors]")).toHaveCount(0);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(page.locator("[data-live-slot]")).toHaveCount(0);
    });

    test("松手时内容体一次到终点宽度：不先压成小卡再长回去", async ({page}) => {
        await open(page);
        await lift(page, tab(page, E));
        const target = await inLeaf(page, "panel", {x: 0.97, y: 0.6});
        await page.mouse.move(target.x, target.y, {steps: 6});
        await expect(surface(page)).not.toHaveAttribute("data-live-preview", "none");
        await settled(page);
        await page.evaluate(() => {
            const widths: number[] = [];
            const probe = window as unknown as {__widths: number[]; __frames: number};
            probe.__widths = widths;
            probe.__frames = 0;
            const sample = (): void => {
                probe.__frames += 1;
                const body = document.querySelector("[data-lifted] > .nb-grid-content__body, [data-flying] > .nb-grid-content__body");
                if (body !== null) widths.push(Math.round(body.getBoundingClientRect().width));
                if (probe.__frames < 30) requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
        });
        await page.mouse.up();
        await expect.poll(() => page.evaluate(() => (window as unknown as {__frames: number}).__frames)).toBe(30);
        const widths = await page.evaluate(() => (window as unknown as {__widths: number[]}).__widths);
        // 只有拿起时的宽与终点的宽：中间值说明内容体跟着外框走了（先压成小卡再逐帧长回去）。
        expect(new Set(widths).size).toBeLessThanOrEqual(2);
    });

    test("标签条里不拿起卡片：被拖的标签自己沿条跟手、夹在条里，没有拖影，预览马上换；离开才撕下", async ({page}) => {
        await open(page);
        const panel = await panelOfTab(page, E);
        const tabs = page.locator(`[data-panel-head="${panel}"] [data-panel-tab]`);
        expect(await tabs.count()).toBeGreaterThan(1);
        const other = tabs.filter({hasNot: page.locator(`[data-panel-tab="view:${E}"]`)}).first();
        await tab(page, E).click();
        await lift(page, tab(page, E));
        const otherBox = await other.boundingBox();
        if (otherBox === null) throw new Error("没有别的标签");
        await page.mouse.move(otherBox.x + 2, otherBox.y + otherBox.height / 2, {steps: 4});
        await expect(page.locator("[data-lifted]")).toHaveCount(0);
        await expect(surface(page)).not.toHaveAttribute("data-live-preview", "none");
        await expect(ghost(page)).toHaveCount(0);
        // 标签自己在指针下（横向）：留着的位置就是它，显示出来跟手。
        await expect.poll(() => sortedFrameOf(tab(page, E))).toMatchObject({visible: true});
        await expect.poll(async () => {
            const frame = await sortedFrameOf(tab(page, E));
            return frame.left <= otherBox.x + 2 && otherBox.x + 2 <= frame.right;
        }).toBe(true);
        // 指针到标签条的最左端：抓住的点在标签中间，不夹的话标签有一半出了条；夹住时左沿贴着条的左端。
        const row = await rowOf(tab(page, E));
        await page.mouse.move(row.left + 1, otherBox.y + otherBox.height / 2, {steps: 6});
        await expect.poll(async () => (await sortedFrameOf(tab(page, E))).left).toBeGreaterThanOrEqual(row.left - 1);
        expect((await sortedFrameOf(tab(page, E))).left).toBeLessThan(row.left + 4);
        // 离开标签条：撕下。
        const away = await inLeaf(page, panel, {x: 0.5, y: 0.6});
        await page.mouse.move(away.x, away.y, {steps: 3});
        await expect(page.locator("[data-lifted]")).toHaveCount(1);
        await expect(ghost(page)).toHaveCount(0);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(page.locator("[data-lifted]")).toHaveCount(0);
    });

    test("长出新块时是空位：不画头，放下才有（输出 38）", async ({page}) => {
        await open(page);
        const heads = await page.locator("[data-panel-head]").count();
        const node = await content(page, E).elementHandle();
        await lift(page, tab(page, E));
        const target = await inLeaf(page, "panel", {x: 0.97, y: 0.6});
        await page.mouse.move(target.x, target.y, {steps: 6});
        await expect(surface(page)).toHaveAttribute("data-live-preview", /edge/u);
        await expect(page.locator("[data-live-slot]")).toBeVisible();
        // 新块的头、标题都还没有：头的数量不变，来源的标签哪儿都没有。
        await expect(page.locator("[data-panel-head]")).toHaveCount(heads);
        await expect(tab(page, E)).toHaveCount(0);
        // 让出的位置什么都不画：卡片没有底、没有投影，缺省没有边框，露出窗体底。
        const slotCard = page.locator("[data-shell-slot]");
        await expect(slotCard).toHaveCount(1);
        const paint = await slotCard.evaluate((element) => {
            const computed = getComputedStyle(element);
            const slot = getComputedStyle(document.querySelector("[data-live-slot]") as Element);
            return {background: computed.backgroundColor, shadow: computed.boxShadow, border: slot.borderTopColor, fill: slot.backgroundColor};
        });
        expect(paint).toEqual({background: "rgba(0, 0, 0, 0)", shadow: "none", border: "rgba(0, 0, 0, 0)", fill: "rgba(0, 0, 0, 0)"});
        await page.mouse.up();
        await expect(tab(page, E)).toHaveCount(1);
        await expect(page.locator("[data-panel-head]")).toHaveCount(heads + 1);
        expect(await content(page, E).evaluate((element, other) => element === other, node)).toBe(true);
    });

    test("并入是目标不动、盖一层：头和活动标签不变，内容是同一个节点；放下才变（输出 38）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const node = await content(page, E).elementHandle();
        const headBefore = await headTabsOf(page, "auxiliarybar");
        await lift(page, tab(page, E));
        const target = await inLeaf(page, "auxiliarybar", {x: 0.5, y: 0.5});
        await page.mouse.move(target.x, target.y, {steps: 6});
        const merge = page.locator("[data-live-merge]");
        await expect(merge).toHaveAttribute("data-live-merge-panel", "auxiliarybar");
        await expect(merge).toContainText("添加为标签");
        await settled(page);
        expect(await headTabsOf(page, "auxiliarybar")).toEqual(headBefore);
        // 来源那块还有一个标签，头不跟着变成只写标题：按已提交的文档算（输出 20）。
        await expect(page.locator("[data-panel-head=\"panel\"] [role=\"tab\"]")).not.toHaveCount(0);
        // 盖住整块面板：头也算。
        const [cover, frame] = [await merge.boundingBox(), await leaf(page, "auxiliarybar").boundingBox()];
        expect(Math.abs((cover?.x ?? 0) - (frame?.x ?? 0))).toBeLessThanOrEqual(1);
        expect(Math.abs((cover?.height ?? 0) - (frame?.height ?? 0))).toBeLessThanOrEqual(1);
        const style = await merge.evaluate((element) => {
            const computed = getComputedStyle(element);
            return {background: computed.backgroundColor, shadow: computed.boxShadow};
        });
        expect(style.background).not.toBe("rgba(0, 0, 0, 0)");
        expect(style.shadow).toContain("2px");
        expect(await content(page, E).evaluate((element, other) => element === other, node)).toBe(true);
        expect(await writesOf(page)).toBe(writes);
        await page.mouse.up();
        await expect(merge).toHaveCount(0);
        await expect.poll(() => panelOfTab(page, E)).toBe("auxiliarybar");
        expect(await content(page, E).evaluate((element, other) => element === other, node)).toBe(true);
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test("别人的标签条上被吸收：卡片收回，预览是放下的样子，零写入；离开卡片回来，目标恢复；放下就是预览的样子（输出 38）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const node = await content(page, AUXILIARY_VIEW).elementHandle();
        const head = page.locator("[data-panel-head=\"panel\"]");
        const activeBefore = await head.locator("[data-panel-tab][aria-selected=\"true\"]").getAttribute("data-panel-tab");
        await lift(page, tab(page, AUXILIARY_VIEW));
        const strip = await head.locator("[data-panel-tab]").first().boundingBox();
        if (strip === null) throw new Error("面板没有标签");
        await page.mouse.move(strip.x + 2, strip.y + strip.height / 2, {steps: 6});
        const card = page.locator("[data-lifted]");
        const placed = head.locator(`[data-panel-tab="view:${AUXILIARY_VIEW}"]`);
        await expect(placed).toHaveCount(1);
        await expect(card).toHaveCount(0);
        await expect(ghost(page)).toHaveCount(0);
        await expect(page.locator("[data-live-merge]")).toHaveCount(0);
        // 它自己在这条标签条里跟手，是这块面板的活动标签；内容是同一个节点。
        await expect.poll(() => sortedFrameOf(placed)).toMatchObject({visible: true});
        await expect(placed).toHaveAttribute("aria-selected", "true");
        expect(await content(page, AUXILIARY_VIEW).evaluate((element, other) => element === other && element.isConnected, node)).toBe(true);
        expect(await writesOf(page)).toBe(writes);
        // 离开标签条：卡片回来；预览换走之后目标恢复。
        const away = await inLeaf(page, "panel", {x: 0.5, y: 0.6});
        await page.mouse.move(away.x, away.y, {steps: 3});
        await expect(card).toHaveCount(1);
        await expect(ghost(page)).toHaveCount(0);
        await expect(head.locator("[data-panel-tab][aria-selected=\"true\"]")).toHaveAttribute("data-panel-tab", activeBefore ?? "");
        // 回去，放下。
        await page.mouse.move(strip.x + 2, strip.y + strip.height / 2, {steps: 3});
        await expect(card).toHaveCount(0);
        await page.mouse.up();
        await expect.poll(() => panelOfTab(page, AUXILIARY_VIEW)).toBe("panel");
        await expect(head.locator("[data-panel-tab]").first()).toHaveAttribute("data-panel-tab", `view:${AUXILIARY_VIEW}`);
        expect(await content(page, AUXILIARY_VIEW).evaluate((element, other) => element === other, node)).toBe(true);
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test("活动栏也是标签条：别处的视图放上去被吸收，条目让位，零写入；Esc 回原样；放下进侧栏（输出 22、38）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const entries = page.locator("[data-tool-band] [data-tool-entry]");
        const before = await entries.evaluateAll((elements) => elements.map((element) => (element as HTMLElement).dataset.toolEntry));
        const first = await entries.first().boundingBox();
        if (first === null || before.length === 0) throw new Error("活动栏没有条目");
        await lift(page, tab(page, AUXILIARY_VIEW));
        await page.mouse.move(first.x + first.width / 2, first.y + 2, {steps: 6});
        const placed = page.locator(`[data-tool-band] [data-tool-entry="${AUXILIARY_VIEW}"]`);
        await expect(placed).toHaveCount(1);
        await expect(page.locator("[data-lifted]")).toHaveCount(0);
        await expect(ghost(page)).toHaveCount(0);
        await expect.poll(() => placed.evaluate((element) => getComputedStyle(element.closest(".workbench-tool-strip__frame") as Element).visibility)).toBe("visible");
        await expect.poll(() => entries.evaluateAll((elements) => elements.map((element) => (element as HTMLElement).dataset.toolEntry))).toEqual([AUXILIARY_VIEW, ...before]);
        expect(await writesOf(page)).toBe(writes);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect.poll(() => entries.evaluateAll((elements) => elements.map((element) => (element as HTMLElement).dataset.toolEntry))).toEqual(before);
        expect(await writesOf(page)).toBe(writes);
        await settled(page);
        await lift(page, tab(page, AUXILIARY_VIEW));
        await page.mouse.move(first.x + first.width / 2, first.y + 2, {steps: 6});
        await expect(placed).toHaveCount(1);
        await page.mouse.up();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
        await expect.poll(() => entries.evaluateAll((elements) => elements.map((element) => (element as HTMLElement).dataset.toolEntry))).toEqual([AUXILIARY_VIEW, ...before]);
    });

    test("侧栏隐藏时放到活动栏：预览里侧栏不展开，条目照样让位；放下才展开并装着它（输出 22、38）", async ({page}) => {
        await open(page);
        await page.locator(`[data-panel-head="sidebar"] [data-panel-action="nbook.view.set-part-hidden"]`).click();
        await expect(leaf(page, "sidebar")).toHaveCount(0);
        await settled(page);
        const writes = await writesOf(page);
        const first = await page.locator("[data-tool-band] [data-tool-entry]").first().boundingBox();
        if (first === null) throw new Error("活动栏没有条目");
        await lift(page, tab(page, AUXILIARY_VIEW));
        await page.mouse.move(first.x + first.width / 2, first.y + 2, {steps: 6});
        await expect(page.locator(`[data-tool-band] [data-tool-entry="${AUXILIARY_VIEW}"]`)).toHaveCount(1);
        await settled(page);
        await expect(leaf(page, "sidebar")).toHaveCount(0);
        expect(await writesOf(page)).toBe(writes);
        await page.mouse.up();
        await expect(leaf(page, "sidebar")).toBeVisible();
        expect(await panelOfTab(page, AUXILIARY_VIEW)).toBe("sidebar");
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test("活动栏里换序：别的图标滑开（真的播了过渡），被拖的图标自己竖着跟手，没有拖影", async ({page}) => {
        await open(page);
        const entries = page.locator("[data-tool-band] [data-tool-entry]");
        expect(await entries.count()).toBeGreaterThan(1);
        const second = await entries.nth(1).boundingBox();
        if (second === null) throw new Error("没有第二个条目");
        await page.evaluate(() => {
            const host = window as unknown as {__toolMoved: boolean};
            host.__toolMoved = false;
            new MutationObserver((records) => {
                if (records.some((record) => (record.target as Element).classList.contains("workbench-tool-strip__frame--moving"))) host.__toolMoved = true;
            }).observe(document.querySelector("[data-tool-band]") as Element, {subtree: true, attributes: true, attributeFilter: ["class"]});
        });
        const firstId = await entries.first().getAttribute("data-tool-entry");
        await lift(page, entries.first());
        await expect(page.locator("[data-lifted]")).toHaveCount(0);
        await page.mouse.move(second.x + second.width / 2, second.y + second.height - 2, {steps: 6});
        await expect.poll(() => page.evaluate(() => (window as unknown as {__toolMoved: boolean}).__toolMoved)).toBe(true);
        await expect(ghost(page)).toHaveCount(0);
        const dragged = page.locator(`[data-tool-band] [data-tool-entry="${firstId}"]`);
        await expect.poll(async () => {
            const box = await dragged.boundingBox();
            const y = second.y + second.height - 2;
            return box !== null && box.y <= y && y <= box.y + box.height;
        }).toBe(true);
        await expect(page.locator("[data-lifted]")).toHaveCount(0);
        await page.keyboard.press("Escape");
        await page.mouse.up();
    });

    test("中途窗口变了：整场取消", async ({page}) => {
        await open(page);
        const from = await panelOfTab(page, E);
        await lift(page, tab(page, E));
        const target = await inLeaf(page, "panel", {x: 0.97, y: 0.6});
        await page.mouse.move(target.x, target.y, {steps: 6});
        await expect(surface(page)).not.toHaveAttribute("data-live-preview", "none");
        await page.setViewportSize({width: 1300, height: 800});
        // 指针一动就判定：窗口变化的事件先于布局发布，那一次还看不出来。
        await page.mouse.move(target.x - 2, target.y);
        await page.mouse.move(target.x - 4, target.y);
        await expect(surface(page)).toHaveAttribute("data-drag-feel", "indicator");
        await expect(surface(page)).toHaveAttribute("data-live-preview", "none");
        await page.mouse.up();
        expect(await panelOfTab(page, E)).toBe(from);
    });

    test("键盘拖动是落点指示", async ({page}) => {
        await open(page);
        await tab(page, E).focus();
        await page.keyboard.press("Space");
        await expect(ghost(page)).toBeVisible();
        await expect(surface(page)).toHaveAttribute("data-drag-feel", "indicator");
        await page.keyboard.press("Escape");
        await expect(ghost(page)).toHaveCount(0);
    });
});
