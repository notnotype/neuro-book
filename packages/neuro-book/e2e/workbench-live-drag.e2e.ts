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
