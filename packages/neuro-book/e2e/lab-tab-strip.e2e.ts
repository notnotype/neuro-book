/**
 * 标签条（packages/nb-layout/src/vue/TabStrip.md）：键盘、多行的纵向导航、分区的插入位、放不下时的逐级让位。
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
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-tab-strip");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const labState = (page: Page) => page.evaluate(() => (window as unknown as {__nbLab?: {state(): LabDebugState}}).__nbLab?.state());

const open = async (page: Page, scene: string): Promise<void> => {
    await page.goto(`${dev.pageUrl}lab?c=TabStrip&s=${scene}&theme=nbook&cw=light&vp=1200x400`);
    await expect.poll(async () => (await labState(page))?.ready).toBe(true);
    await expect(page.locator("[data-tab-strip]")).toBeVisible();
};
const tab = (page: Page, id: string) => page.locator(`[data-panel-tab="${id}"]`);
const log = (page: Page) => page.locator("[data-tab-strip-log]");

test.describe("标签条", () => {
    test("方向键循环并激活，焦点跟过去；Home、End；选中的是唯一的 Tab 停靠点", async ({page}) => {
        await open(page, "scroll");
        await tab(page, "t0").focus();
        await page.keyboard.press("ArrowRight");
        await expect(tab(page, "t1")).toBeFocused();
        await expect(tab(page, "t1")).toHaveAttribute("aria-selected", "true");
        await page.keyboard.press("ArrowLeft");
        await page.keyboard.press("ArrowLeft");
        await expect(tab(page, "t19")).toBeFocused();
        await page.keyboard.press("Home");
        await expect(tab(page, "t0")).toBeFocused();
        await page.keyboard.press("End");
        await expect(tab(page, "t19")).toBeFocused();
        await expect(page.locator("[data-tab-strip] [role='tab'][tabindex='0']")).toHaveCount(1);
    });

    test("活动标签换了滚到完整可见；Alt 加方向键换序，活动标签不变；Delete、菜单键、双击发事件", async ({page}) => {
        await open(page, "scroll");
        await tab(page, "t0").focus();
        await page.keyboard.press("End");
        await expect.poll(async () => {
            const box = (await tab(page, "t19").locator("..").boundingBox())!;
            const strip = (await page.locator("[data-tab-strip]").boundingBox())!;
            return box.x + box.width <= strip.x + strip.width + 1;
        }).toBe(true);
        await page.keyboard.press("Home");
        await page.keyboard.press("Alt+ArrowRight");
        await expect(log(page)).toContainText("reorder t0 1");
        const order = await page.locator("[data-panel-tab]").evaluateAll((elements) => elements.slice(0, 2).map((element) => (element as HTMLElement).dataset.panelTab));
        expect(order).toEqual(["t1", "t0"]);
        await expect(tab(page, "t0")).toHaveAttribute("aria-selected", "true");
        await page.keyboard.press("Delete");
        await expect(log(page)).toContainText("close t0");
        await page.keyboard.press("Shift+F10");
        await expect(log(page)).toContainText("menu t0");
        await tab(page, "t1").dblclick();
        await expect(log(page)).toContainText("keep t1");
    });

    test("分区一行一个，多行时上下键到上一行或下一行里最近的标签", async ({page}) => {
        await open(page, "wrap");
        const rows = page.locator("[data-tab-row]");
        await expect(rows).toHaveCount(2);
        await expect(rows.nth(0)).toHaveAttribute("data-layout", "scroll");
        await expect(rows.nth(1)).toHaveAttribute("data-layout", "wrap");
        const top = async (id: string): Promise<number> => (await tab(page, id).boundingBox())!.y;
        expect(await top("t2")).toBeGreaterThan(await top("t0"));
        // 普通标签折到了不止一行。
        expect(await top("t13")).toBeGreaterThan(await top("t2"));
        await tab(page, "t0").focus();
        await page.keyboard.press("ArrowDown");
        await expect(tab(page, "t2")).toBeFocused();
        await page.keyboard.press("ArrowDown");
        const focused = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.panelTab);
        expect(await top(focused!)).toBeGreaterThan(await top("t2"));
        await page.keyboard.press("ArrowUp");
        await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement).dataset.panelTab)).toBe("t2");
    });

    test("插入位：标签前半是它前面、后半是它后面；行尾归下一行行首；分区看后面那个标签", async ({page}) => {
        await open(page, "wrap");
        const insertion = (): Promise<{before: string | null; after: string | null; partition: string | null}> => page.locator("[data-tab-strip-insertion]").textContent().then((text) => JSON.parse(text ?? "{}") as {before: string | null; after: string | null; partition: string | null});
        const at = async (id: string, ratio: number): Promise<void> => {
            const box = (await tab(page, id).locator("..").boundingBox())!;
            await page.mouse.move(box.x + box.width * ratio, box.y + box.height / 2);
        };
        await at("t1", 0.2);
        expect(await insertion()).toEqual({before: "t1", after: "t0", partition: "pinned"});
        await at("t1", 0.8);
        expect(await insertion()).toEqual({before: null, after: "t1", partition: "pinned"});
        await at("t2", 0.2);
        expect(await insertion()).toEqual({before: "t2", after: null, partition: "normal"});
        // 第一行普通标签的行尾：归下一行行首。
        const boxes = await page.locator("[data-tab-row='normal'] .nb-tab-frame").evaluateAll((frames) => frames.map((frame) => ({id: (frame.querySelector("[data-panel-tab]") as HTMLElement).dataset.panelTab, top: frame.getBoundingClientRect().top})));
        const firstRowLast = boxes.filter((box) => box.top === boxes[0]?.top).at(-1)!;
        const next = boxes[boxes.indexOf(firstRowLast) + 1]!;
        await at(firstRowLast.id!, 0.9);
        expect(await insertion()).toEqual({before: next.id, after: firstRowLast.id, partition: "normal"});
    });

    test("放不下时逐级让位：完整、截断、只留图标、收进“更多”；选中的始终带标题；从“更多”选中的回到标签带", async ({page}) => {
        await open(page, "adapt");
        const level = page.locator("[data-tab-strip]");
        const setWidth = (width: number) => page.locator("[data-tab-strip-width]").evaluate((input, value) => {
            (input as HTMLInputElement).value = String(value);
            input.dispatchEvent(new Event("input", {bubbles: true}));
        }, width);
        await setWidth(600);
        await expect(level).toHaveAttribute("data-tabs-level", "0");
        await setWidth(420);
        await expect(level).toHaveAttribute("data-tabs-level", "1");
        await setWidth(300);
        await expect(level).toHaveAttribute("data-tabs-level", "2");
        await expect(tab(page, "t1")).toHaveAttribute("aria-label", "大纲视图");
        await expect(tab(page, "t0").locator(".nb-tab__title")).toHaveText("资源管理器");
        await setWidth(150);
        await expect(level).toHaveAttribute("data-tabs-level", "3");
        await page.locator("[data-tabs-more]").click();
        await page.getByRole("menuitem", {name: "终端输出"}).click();
        await expect(tab(page, "t4")).toHaveAttribute("aria-selected", "true");
        await expect(tab(page, "t4")).toBeVisible();
    });
});
