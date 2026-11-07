/**
 * 实时布局（docs/specs/ui/workbench-layout.md“实时布局”）在真实浏览器里：邻居真实让位、预览不写记录、松手提交指针下的候选、取消回原样。应用的 Playwright 配置缺省减少动态效果，那时一律落点指示，所以这里每个用例开回来。
 */

import {mkdir, rm} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Locator, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {CLIENT_IDENTITY_KEY} from "nbook/web/host/client-identity";

import {startProbeServer} from "./fixtures";
import type {ProbeServer} from "./fixtures";

const E = "test.sample-views.omega";

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
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views", NBOOK_EXCLUDE_PLUGINS: "nbook.explorer,nbook.editor,nbook.agent"}});
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

    test("预览不改可见性，读屏文字按语义变；拖到面板边上有空位与淡线", async ({page}) => {
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
        const sectors = page.locator("[data-drop-sectors]");
        await expect(sectors).toHaveCount(1);
        expect(await sectors.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
        await expect(page.locator("[data-drop-sector-label]")).toHaveCount(0);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(page.locator("[data-live-slot]")).toHaveCount(0);
        await expect(sectors).toHaveCount(0);
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

    test("标签条里不拿起卡片：只有标签跟手，预览马上换；离开才撕下", async ({page}) => {
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
        await expect(ghost(page)).toBeVisible();
        await expect(page.locator("[data-lifted]")).toHaveCount(0);
        await expect(surface(page)).not.toHaveAttribute("data-live-preview", "none");
        await expect(tab(page, E).evaluate((element) => getComputedStyle(element.parentElement as Element).visibility)).resolves.toBe("hidden");
        // 离开标签条：撕下。
        const away = await inLeaf(page, panel, {x: 0.5, y: 0.6});
        await page.mouse.move(away.x, away.y, {steps: 3});
        await expect(page.locator("[data-lifted]")).toHaveCount(1);
        await expect(ghost(page)).toHaveCount(0);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(page.locator("[data-lifted]")).toHaveCount(0);
    });

    test("隐藏的右栏：拖到预备区时真的长出来，预备区让开，不写记录；松手一次写入", async ({page}) => {
        await open(page);
        const hide = page.locator("[data-panel-head=\"auxiliarybar\"] [data-panel-action=\"nbook.view.set-part-hidden\"]");
        if (await leaf(page, "auxiliarybar").count() > 0 && await hide.count() > 0) await hide.click();
        await expect(leaf(page, "auxiliarybar")).toHaveCount(0);
        await settled(page);
        const writes = await writesOf(page);
        await lift(page, tab(page, E));
        const zone = page.locator("[data-reveal-zone=\"auxiliarybar\"]");
        await expect(zone).toHaveCount(1);
        const at = await centerOf(zone);
        await page.mouse.move(at.x, at.y, {steps: 5});
        await expect(surface(page)).not.toHaveAttribute("data-live-preview", "none");
        await expect(leaf(page, "auxiliarybar")).toHaveCount(1);
        await expect(zone).toHaveCount(0);
        expect(await writesOf(page)).toBe(writes);
        await page.mouse.up();
        await expect.poll(() => writesOf(page)).toBeGreaterThan(writes);
        await expect(leaf(page, "auxiliarybar")).toHaveCount(1);
        expect(await panelOfTab(page, E)).toBe("auxiliarybar");
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
