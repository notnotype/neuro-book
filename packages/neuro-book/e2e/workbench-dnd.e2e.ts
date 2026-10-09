/**
 * 外壳三拖放在真实 Chrome 中的验收（docs/specs/ui/workbench-shell.md 外壳三输出 19–23、验收 19–25）：生产构建的
 * e2e 测试外壳，测试插件 `test.sample-views` 贡献六个视图。指针手势用 Playwright 的真实鼠标，等页面上可观察的
 * 变化，不按时长等待。
 *
 * 不在这里的：落点判定的逐行规则（`views/drop.test.ts`）、意图与补丁（`views/dnd-model.test.ts`）、保存冲突
 * （`state/layout-store.test.ts`）。
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

const A = "test.sample-views.alpha";
const B = "test.sample-views.beta";
const C = "test.sample-views.gamma";
const D = "test.sample-views.delta";
const E = "test.sample-views.omega";
const F = "test.sample-views.zeta";

const ghost = (page: Page) => page.locator("[data-workbench-drag-ghost]");
const feedback = (page: Page) => page.locator("[data-drop-kind]");

const tabOf = (page: Page, part: string, containerId: string) => page.locator(`[data-switcher-band="${part}"] [data-switcher-entry="${containerId}"]`);
const host = (page: Page, containerId: string) => page.locator(`[data-container-host="${containerId}"]`);

async function centerOf(locator: Locator): Promise<{x: number; y: number}> {
    const box = (await locator.boundingBox())!;
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

/** 按下源、移过门槛，再分几步移到 `to`：拖动在这一步之后进行中，由调用方决定松手还是取消。 */
async function dragTo(page: Page, source: Locator, to: {x: number; y: number}): Promise<void> {
    const from = await centerOf(source);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y + 10, {steps: 2});
    await expect(ghost(page)).toBeVisible();
    await page.mouse.move(to.x, to.y, {steps: 8});
}

test.describe("产品页：拖放", () => {
    let tmp = "";
    let server: ProbeServer;

    test.beforeAll(async () => {
        tmp = await createTestTmpRoot("neuro-book-e2e", "workbench-dnd");
        await mkdir(join(tmp, "state"), {recursive: true});
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views"}});
    });

    test.afterAll(async () => {
        expect(await server.stop()).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 1440, height: 900}});

    /**
     * user 分区的最新修订号：数写入次数用。Spec 只保证修订号在分区内单调、不复用，当前实现逐次加一，所以“恰好多一”
     * 就是“只写了一次”；各用例在同一个分区里先后运行，拖动期间页面没有别的写入。存储换成不连续的修订号时，这里要
     * 改用别的计数。
     */
    async function revisionOf(page: Page): Promise<number> {
        await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
        const db = new DatabaseSync(join(tmp, "state", "storage", "user.sqlite"));
        try {
            const row = db.prepare("SELECT MAX(revision) AS revision FROM records").get() as {revision: number | null};
            return Number(row.revision ?? 0);
        } finally {
            db.close();
        }
    }

    async function open(page: Page): Promise<void> {
        await page.goto(server.url);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(page.locator("[data-shell-focus-target=\"panel-toggle\"]")).toBeEnabled();
    }

    test("活动条目拖到右栏标签带：拖动中源不动、有拖影与插入线；松手整容器迁到右栏并选中，只写一次", async ({page}) => {
        await open(page);
        const entry = page.locator(`[data-activity-container="view:${C}"]`);
        const before = await entry.boundingBox();
        const tab = page.locator(`[data-tool-part="auxiliarybar"] [data-switcher-entry="view:${D}"]`);
        const tabBox = (await tab.boundingBox())!;
        await dragTo(page, entry, {x: tabBox.x + tabBox.width + 20, y: tabBox.y + tabBox.height / 2});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-container");
        await expect(page.locator("[data-drop-feedback-line]")).toBeVisible();
        expect(await entry.boundingBox()).toEqual(before);
        const revision = await revisionOf(page);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect(page.locator(`[data-tool-part="auxiliarybar"] [data-switcher-entry="view:${C}"]`)).toHaveAttribute("aria-selected", "true");
        await expect(entry).toHaveCount(0);
        await expect.poll(() => revisionOf(page)).toBe(revision + 1);
    });

    test("整容器拖到另一个容器内容的边缘：整组并入命中叶的那一侧，预览是那一半；源容器消失", async ({page}) => {
        await open(page);
        const content = (await host(page, `view:${E}`).boundingBox())!;
        // 面板横向：左半是“插到戊之前”。
        await dragTo(page, tabOf(page, "panel", `view:${F}`), {x: content.x + content.width * 0.2, y: content.y + content.height / 2});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "merge-container");
        const area = (await page.locator("[data-drop-feedback-area]").boundingBox())!;
        expect(area.x + area.width).toBeLessThanOrEqual(content.x + content.width / 2 + 1);
        await page.mouse.up();
        await expect(host(page, `view:${E}`)).toHaveAttribute("data-container-mode", "multiple");
        await expect(tabOf(page, "panel", `view:${F}`)).toHaveCount(0);
        const sections = host(page, `view:${E}`).locator("[data-view-section]");
        await expect(sections).toHaveCount(2);
        expect(await sections.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-view-section")))).toEqual([F, E]);
    });

    test("视图标题拖到 ActivityBar 条目带：在插入位建一个只装它的新容器并选中，悬停条目的成员不变", async ({page}) => {
        await open(page);
        // 先把乙并进甲，侧栏的甲容器成 multiple，乙有自己的标题。
        const sidebar = (await page.locator('[data-tool-part="sidebar"]').boundingBox())!;
        await dragTo(page, page.locator(`[data-activity-container="view:${B}"]`), {x: sidebar.x + sidebar.width / 2, y: sidebar.y + sidebar.height * 0.9});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "merge-container");
        await page.mouse.up();
        await expect(host(page, `view:${A}`)).toHaveAttribute("data-container-mode", "multiple");

        const entryC = (await page.locator(`[data-activity-container="view:${C}"]`).boundingBox())!;
        // 落在丙条目的上半：插到丙之前。
        await dragTo(page, page.locator(`[data-drag-view="${B}"]`), {x: entryC.x + entryC.width / 2, y: entryC.y + 4});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "detach-view");
        await expect(page.locator("[data-drop-feedback-line]")).toBeVisible();
        await page.mouse.up();
        const ids = await page.locator('[data-switcher-band="sidebar"] [data-switcher-entry]').evaluateAll((elements) => elements.map((element) => element.getAttribute("data-switcher-entry")));
        expect(ids).toHaveLength(3);
        expect(ids[0]).toBe(`view:${A}`);
        expect(ids[1]).toMatch(/^custom:/u);
        expect(ids[2]).toBe(`view:${C}`);
        await expect(page.locator(`[data-activity-container="${ids[1]}"]`)).toHaveAttribute("aria-pressed", "true");
        await expect(host(page, `view:${A}`)).toHaveAttribute("data-container-mode", "single");
    });

    test("空 Part：右栏搬空后标签带与空正文常驻；视图拖进空正文建新容器、拖进空标签带同样建新容器", async ({page}) => {
        await open(page);
        const panelBand = (await page.locator('[data-switcher-band="panel"]').boundingBox())!;
        await dragTo(page, tabOf(page, "auxiliarybar", `view:${D}`), {x: panelBand.x + panelBand.width - 40, y: panelBand.y + panelBand.height / 2});
        await page.mouse.up();
        await expect(tabOf(page, "panel", `view:${D}`)).toBeVisible();
        const empty = page.locator('[data-empty-part="auxiliarybar"]');
        await expect(empty).toHaveText("将视图拖动到此处显示");
        const band = (await page.locator('[data-switcher-band="auxiliarybar"]').boundingBox())!;
        expect(band.width).toBeGreaterThan(40);

        const emptyBox = (await empty.boundingBox())!;
        await dragTo(page, tabOf(page, "panel", `view:${D}`), {x: emptyBox.x + emptyBox.width / 2, y: emptyBox.y + emptyBox.height / 2});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-container");
        await page.mouse.up();
        await expect(tabOf(page, "auxiliarybar", `view:${D}`)).toHaveAttribute("aria-selected", "true");
    });

    test("松手在源自己身上（原位，无操作）：不提交，也不触发那一下点击", async ({page}) => {
        await open(page);
        const revision = await revisionOf(page);
        const tab = tabOf(page, "panel", `view:${F}`);
        await expect(tab).toHaveAttribute("aria-selected", "false");
        const center = await centerOf(tab);
        await dragTo(page, tab, center);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect(tab).toHaveAttribute("aria-selected", "false");
        expect(await revisionOf(page)).toBe(revision);
        // 普通点击照常选中。
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
    });

    test("键盘：面板标签上空格拿起，方向键沿标签带移动插入位（标签带不切换），Enter 只提交一次，焦点回到标签", async ({page}) => {
        await open(page);
        const revision = await revisionOf(page);
        const tabF = tabOf(page, "panel", `view:${F}`);
        const tabE = tabOf(page, "panel", `view:${E}`);
        await expect(tabE).toHaveAttribute("aria-selected", "true");
        await tabF.focus();
        await page.keyboard.press("Space");
        await expect(ghost(page)).toBeVisible();
        // 起点是自己的位置：原位，带插入线的无操作。
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "noop");
        await page.keyboard.press("ArrowLeft");
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-container");
        await expect(tabE).toHaveAttribute("aria-selected", "true");
        expect(await revisionOf(page)).toBe(revision);
        await page.keyboard.press("Enter");
        await expect(ghost(page)).toHaveCount(0);
        const ids = await page.locator('[data-switcher-band="panel"] [data-switcher-entry]').evaluateAll((elements) => elements.map((element) => element.getAttribute("data-switcher-entry")));
        expect(ids).toEqual([`view:${F}`, `view:${E}`]);
        await expect(tabF).toBeFocused();
        await expect.poll(() => revisionOf(page)).toBe(revision + 1);
    });

    test("键盘：三个 Part 各拿起一次；Tab 换区后仍在拖动、没有写入；Escape 只取消，焦点回到源", async ({page}) => {
        await open(page);
        const revision = await revisionOf(page);
        const sources = [
            page.locator(`[data-activity-container="view:${A}"]`),
            tabOf(page, "auxiliarybar", `view:${D}`),
            tabOf(page, "panel", `view:${E}`),
        ];
        for (const source of sources) {
            await source.focus();
            await page.keyboard.press("Space");
            await expect(ghost(page)).toBeVisible();
            for (let step = 0; step < 3; step += 1) {
                await page.keyboard.press("Tab");
                await expect(ghost(page)).toBeVisible();
            }
            await page.keyboard.press("Shift+Tab");
            await expect(ghost(page)).toBeVisible();
            expect(await revisionOf(page)).toBe(revision);
            await page.keyboard.press("Escape");
            await expect(ghost(page)).toHaveCount(0);
            await expect(source).toBeFocused();
        }
        expect(await revisionOf(page)).toBe(revision);
    });

    test("键盘：视图标题的把手拿起，Tab 到另一个容器的内容区，方向键选半区，Enter 并入", async ({page}) => {
        await open(page);
        // 先用键盘把乙的整个容器并进甲：甲成 multiple，各有标题把手。
        const sidebar = (await page.locator('[data-tool-part="sidebar"]').boundingBox())!;
        await dragTo(page, page.locator(`[data-activity-container="view:${B}"]`), {x: sidebar.x + sidebar.width / 2, y: sidebar.y + sidebar.height * 0.9});
        await page.mouse.up();
        await expect(host(page, `view:${A}`)).toHaveAttribute("data-container-mode", "multiple");
        const revision = await revisionOf(page);
        const handle = page.locator(`[data-drag-view="${B}"] [data-drag-handle]`);
        await expect(handle).toHaveAccessibleName("拖动 样例乙");
        await handle.focus();
        await page.keyboard.press("Space");
        await expect(ghost(page)).toBeVisible();
        // 区域按 Part 的顺序：活动栏、侧栏内容、右栏标签带、右栏内容、面板……；从甲的内容区往后两个是右栏内容（丁）。
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-view");
        await page.keyboard.press("ArrowDown");
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-view");
        await page.keyboard.press("Enter");
        await expect(host(page, `view:${D}`)).toHaveAttribute("data-container-mode", "multiple");
        const sections = await host(page, `view:${D}`).locator("[data-view-section]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-view-section")));
        expect(sections).toEqual([D, B]);
        await expect.poll(() => revisionOf(page)).toBe(revision + 1);
        await expect(page.locator(`[data-drag-view="${B}"] [data-drag-handle]`)).toBeFocused();
    });

    test("Escape 取消：拖影与预览消失，松手不写；窗口失焦同样取消", async ({page}) => {
        await open(page);
        const entry = page.locator(`[data-activity-container="view:${A}"]`);
        const panel = (await page.locator('[data-switcher-band="panel"]').boundingBox())!;
        const revision = await revisionOf(page);
        await dragTo(page, entry, {x: panel.x + panel.width - 30, y: panel.y + panel.height / 2});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-container");
        await page.keyboard.press("Escape");
        await expect(ghost(page)).toHaveCount(0);
        await expect(feedback(page)).toHaveCount(0);
        await page.mouse.up();
        await expect(entry).toBeVisible();

        await dragTo(page, entry, {x: panel.x + panel.width - 30, y: panel.y + panel.height / 2});
        // 窗口失焦：无头浏览器里换不走真实焦点，派发窗口自己的 blur 事件（会话只听窗口这一种）。
        await page.evaluate(() => window.dispatchEvent(new FocusEvent("blur")));
        await expect(ghost(page)).toHaveCount(0);
        await page.mouse.up();
        expect(await revisionOf(page)).toBe(revision);
        await expect(entry).toBeVisible();
    });
});
