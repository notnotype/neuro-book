/**
 * 条目区的溢出在真实 Chrome 里的几何（docs/specs/ui/workbench-shell.md 外壳四输出 34、验收 38）：在 Lab 的
 * `WorkbenchItemStrip` 场景上直接改容器宽度，核对“全部实际放得下时全部显示”、差一像素就收起、摆出来的条目与“更多”都在
 * 容器内不重叠，以及“更多”里的长文字换行显示全文。宽度按真实渲染的测量层算，不用人工数字。
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
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-item-strip");
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

const strip = (page: Page) => page.locator(".lab-main [data-lab-stage] [data-workbench-item-strip]");
const GAP = 4;

/** 全部条目摆出来要的宽度：测量层里每个条目的实际宽度加 n - 1 个间距。 */
async function fullWidth(page: Page): Promise<number> {
    return strip(page).evaluate((root, gap) => {
        const widths = [...root.querySelectorAll<HTMLElement>("[data-measure-item]")].map((element) => element.getBoundingClientRect().width);
        return widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1);
    }, GAP);
}

async function setWidth(page: Page, width: number): Promise<void> {
    await strip(page).evaluate((root, value) => {
        root.style.flex = "none";
        root.style.width = `${String(value)}px`;
    }, width);
}

/** 摆出来的条目与“更多”都在容器内，彼此不重叠。 */
async function expectLaidOut(page: Page): Promise<void> {
    const boxes = await strip(page).evaluate((root) => {
        const outer = root.getBoundingClientRect();
        const items = [...root.querySelectorAll<HTMLElement>("[data-workbench-item], [data-workbench-item-more]")].map((element) => element.getBoundingClientRect());
        return {outer: {left: outer.left, right: outer.right}, items: items.map((box) => ({left: box.left, right: box.right}))};
    });
    const sorted = [...boxes.items].sort((a, b) => a.left - b.left);
    for (const [index, box] of sorted.entries()) {
        expect(box.left).toBeGreaterThanOrEqual(boxes.outer.left - 0.5);
        expect(box.right).toBeLessThanOrEqual(boxes.outer.right + 0.5);
        if (index > 0) expect(box.left).toBeGreaterThanOrEqual(sorted[index - 1]!.right - 0.5);
    }
}

test("全部实际放得下时全部显示；差一像素就按优先级收进“更多”，摆出来的都在容器内", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await openScene(page, "c=WorkbenchItemStrip&s=many");
    const items = strip(page).locator("[data-workbench-item]");
    // Lab 画布比 14 个条目窄，先按测量层算出全放下要的宽度再把容器撑到那么宽。
    await expect(strip(page).locator("[data-measure-item]")).toHaveCount(14);
    const needed = Math.ceil(await fullWidth(page));

    await setWidth(page, needed);
    await expect(items).toHaveCount(14);
    await expect(strip(page).locator("[data-workbench-item-more]")).toHaveCount(0);
    await expectLaidOut(page);

    await setWidth(page, needed - 1);
    await expect(strip(page).locator("[data-workbench-item-more]")).toHaveCount(1);
    const shown = await items.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-workbench-item")));
    expect(shown.length).toBeLessThan(14);
    // 场景里 priority = index % 4：优先级 3 的四项（n3、n7、n11）先摆，不会被低优先级越过。
    for (const id of ["test.items.n3", "test.items.n7", "test.items.n11"]) expect(shown).toContain(id);
    await expectLaidOut(page);

    await setWidth(page, Math.round(needed / 3));
    await expect(strip(page).locator("[data-workbench-item-more]")).toHaveCount(1);
    await expectLaidOut(page);
    await strip(page).locator("[data-workbench-item-more]").click();
    const menu = page.locator('[role="menu"][data-state="open"]');
    await expect(menu).toBeVisible();
    expect(await menu.locator('[role^="menuitem"]').count()).toBe(14 - (await items.count()));
    await page.keyboard.press("Escape");
});

test("“更多”里的长文字换行显示全文，纯文字条目是禁用的一行", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await openScene(page, "c=WorkbenchItemStrip&s=states");
    await setWidth(page, 120);
    await strip(page).locator("[data-workbench-item-more]").click();
    const menu = page.locator('[role="menu"][data-state="open"]');
    const long = menu.locator('[role^="menuitem"]', {hasText: "一段相当长的条目文字"});
    await expect(long).toBeVisible();
    await expect(long).toHaveAttribute("aria-disabled", "true");
    await expect(long).toContainText("什么样子");
    expect(await long.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe("normal");
    const box = await long.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(320);
    // 换了行：比单行高。
    expect(box!.height).toBeGreaterThan(40);
    await page.keyboard.press("Escape");
});
