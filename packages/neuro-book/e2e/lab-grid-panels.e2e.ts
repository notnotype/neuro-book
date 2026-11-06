/**
 * 内容层：一棵树上的面板跨面板移动（docs/specs/ui/nested-grid.md 的“内容层”、docs/specs/ui/workbench-layout.md 验收 1）。场景夹具是
 * `fixtures/nb-layout/GridPanelsScene.vue`：`侧栏(a | b) | (ea | eb) | 右栏(c | d)`。配置里默认减少动态效果，测过渡的用例开回来，并把过渡放慢：
 * 断言“走在新旧之间”不靠赶在缓出的前几帧读到。
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
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-grid-panels");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const labState = (page: Page) => page.evaluate(() => (window as unknown as {__nbLab?: {state(): LabDebugState}}).__nbLab?.state() ?? null);

async function open(page: Page, motion = false): Promise<void> {
    if (motion) await page.emulateMedia({reducedMotion: "no-preference"});
    await page.setViewportSize({width: 1440, height: 800});
    await page.goto(`${dev.pageUrl}lab?c=NestedGrid&s=panels&theme=nbook&cw=light`);
    await expect.poll(async () => (await labState(page))?.ready).toBe(true);
    await expect(page.locator("[data-content='view:a']")).toBeVisible();
    if (motion) await page.addStyleTag({content: ":root { --motion-layout: 4000ms !important; }"});
}

/** 用脚本点场景的按钮：焦点不动。 */
const act = (page: Page, name: string) => page.locator(`[data-panels-action="${name}"]`).evaluate((button: HTMLElement) => button.click());
const frame = (page: Page, id: string) => page.locator(`[data-leaf="${id}"]`);
const content = (page: Page, key: string) => page.locator(`[data-content="${key}"]`);
const leafOf = (page: Page, key: string) => content(page, key).locator("[data-structure-leaf]");
const instanceOf = (page: Page, key: string) => leafOf(page, key).getAttribute("data-structure-instance");
const movingCount = (page: Page) => page.locator("[data-grid-scope] [data-moving]").count();
const settled = (page: Page) => expect(page.locator("[data-grid-scope] [data-moving]")).toHaveCount(0);

interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

const box = async (page: Page, selector: string): Promise<Box> => page.evaluate((target) => {
    const {x, y, width, height} = document.querySelector(target)!.getBoundingClientRect();
    return {x, y, width, height};
}, selector);
const contentBox = (page: Page, key: string) => box(page, `[data-content="${key}"]`);
const frameBox = (page: Page, id: string) => box(page, `[data-leaf="${id}"]`);
/** 这个点上最上面的内容项。 */
const contentAt = (page: Page, point: {x: number; y: number}) => page.evaluate(({x, y}) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-content]")?.dataset.content ?? null, point);
const focusedPlace = (page: Page) => page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return active?.closest<HTMLElement>("[data-panel-tab]")?.dataset.panelTab ?? active?.closest<HTMLElement>("[data-sash]")?.dataset.sash ?? active?.closest<HTMLElement>("[data-content]")?.dataset.content ?? null;
});

test.describe("跨面板的位移", () => {
    test("视图 A 移到右栏 C、D 之间：内容走在新旧之间，和外框同步，压在别的面板上；实例、输入与滚动都在，来源那一列只剩 B 并占满", async ({page}) => {
        await open(page, true);
        await leafOf(page, "view:a").locator("[data-structure-input]").fill("还在");
        const scroller = leafOf(page, "view:a").locator("[data-structure-scroll]");
        await scroller.evaluate((element) => {
            element.scrollTop = 300;
        });
        const instance = await instanceOf(page, "view:a");
        const before = await contentBox(page, "view:a");

        await act(page, "a-between-c-d");
        await expect(frame(page, "a")).toHaveAttribute("data-moving", "");
        await expect.poll(async () => (await contentBox(page, "view:a")).x).toBeGreaterThan(before.x + 1);
        const during = await page.evaluate(() => {
            const read = (selector: string) => {
                const {x, y, width, height} = document.querySelector(selector)!.getBoundingClientRect();
                return {x, y, width, height};
            };
            const inner = read("[data-content='view:a']");
            const top = document.elementFromPoint(inner.x + inner.width / 2, inner.y + inner.height / 2)?.closest<HTMLElement>("[data-content]")?.dataset.content;
            return {inner, outer: read("[data-leaf='a']"), top};
        });
        await settled(page);
        const after = await contentBox(page, "view:a");

        expect(after.x).toBeGreaterThan(before.x);
        expect(during.inner.x).toBeGreaterThan(before.x);
        expect(during.inner.x).toBeLessThan(after.x);
        // 同步：同一组令牌同时开始，与外框的差值恒为面板头。
        expect(Math.abs(during.inner.x - during.outer.x)).toBeLessThan(1);
        expect(Math.abs(during.inner.y - during.outer.y - 32)).toBeLessThan(1);
        expect(during.top).toBe("view:a");

        expect(await instanceOf(page, "view:a")).toBe(instance);
        await expect(leafOf(page, "view:a").locator("[data-structure-input]")).toHaveValue("还在");
        expect(await scroller.evaluate((element) => element.scrollTop)).toBe(300);
        const b = await frameBox(page, "b");
        const statusbar = await frameBox(page, "statusbar");
        expect(Math.abs(b.y + b.height - statusbar.y)).toBeLessThan(6);
        expect(b.y).toBe(await frameBox(page, "c").then((c) => c.y));
    });

    test("标签并入已有面板：两块面板都不动，内容仍从旧面板滑到新面板", async ({page}) => {
        await open(page, true);
        const fromFrame = await frameBox(page, "b");
        const toFrame = await frameBox(page, "d");
        const parkedAt = await contentBox(page, "view:b2");
        const instance = await instanceOf(page, "view:b2");
        await act(page, "b2-into-d-strip");
        await expect(content(page, "view:b2")).toHaveAttribute("data-flying", "");
        await expect.poll(async () => (await contentBox(page, "view:b2")).x).toBeGreaterThan(parkedAt.x + 1);
        const during = await contentBox(page, "view:b2");
        expect(await frameBox(page, "b")).toEqual(fromFrame);
        expect(await frameBox(page, "d")).toEqual(toFrame);
        await settled(page);
        const after = await contentBox(page, "view:b2");
        expect(during.x).toBeLessThan(after.x);
        expect(after.x).toBe(toFrame.x);
        await expect(content(page, "view:b2")).not.toHaveAttribute("data-flying", "");
        expect(await instanceOf(page, "view:b2")).toBe(instance);
        await expect(page.locator("[data-panel-tab='view:b2']")).toHaveAttribute("aria-pressed", "true");
        // 原来活动的 D 停放，B 留下的活动标签还是 B。
        await expect(content(page, "view:d")).toHaveCSS("visibility", "hidden");
        await expect(content(page, "view:b")).toHaveCSS("visibility", "visible");
    });

    test("标签拆到外缘：新面板从边上长出来，内容从旧面板飞过去，不重建", async ({page}) => {
        await open(page, true);
        const instance = await instanceOf(page, "view:b2");
        const before = await contentBox(page, "view:b2");
        await act(page, "b2-to-eb-edge");
        await expect(content(page, "view:b2")).toHaveAttribute("data-flying", "");
        await settled(page);
        const after = await contentBox(page, "view:b2");
        expect(after.x).toBeGreaterThan(before.x);
        expect(await instanceOf(page, "view:b2")).toBe(instance);
    });

    test("放回原处：什么都不动", async ({page}) => {
        await open(page, true);
        const before = await frameBox(page, "eb");
        await act(page, "eb-in-place");
        expect(await movingCount(page)).toBe(0);
        expect(await frameBox(page, "eb")).toEqual(before);
    });
});

test.describe("过渡里的内容尺寸（nested-grid 验收 10）", () => {
    test("新叶的内容一开始就是最终尺寸，ResizeObserver 只报一次；让位的内容跟着外框", async ({page}) => {
        await open(page, true);
        await act(page, "open-e3-right-of-eb");
        await expect(frame(page, "e3")).toHaveAttribute("data-moving", "");
        const during = await page.evaluate(() => {
            const width = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().width;
            return {
                newOuter: width("[data-content='tab:e3']"),
                newInner: width("[data-content='tab:e3'] > .nb-grid-content__body"),
                oldOuter: width("[data-content='tab:eb']"),
                oldInner: width("[data-content='tab:eb'] > .nb-grid-content__body"),
            };
        });
        expect(during.newOuter).toBeLessThan(during.newInner);
        expect(Math.abs(during.oldOuter - during.oldInner)).toBeLessThan(0.5);
        await settled(page);
        const final = await page.evaluate(() => document.querySelector("[data-content='tab:e3'] > .nb-grid-content__body")!.getBoundingClientRect().width);
        expect(Math.abs(final - during.newInner)).toBeLessThan(0.5);
        await expect(leafOf(page, "tab:e3")).toHaveAttribute("data-structure-resizes", "1");
    });
});

test.describe("停放", () => {
    test("切标签不是布局变化；不活动的内容隐藏不卸载", async ({page}) => {
        await open(page, true);
        const instance = await instanceOf(page, "view:b");
        await page.locator("[data-panel-tab='view:b2']").click();
        expect(await movingCount(page)).toBe(0);
        await expect(content(page, "view:b2")).toHaveCSS("visibility", "visible");
        await expect(content(page, "view:b")).toHaveCSS("visibility", "hidden");
        await expect(content(page, "view:b")).toHaveAttribute("inert", "");
        await page.locator("[data-panel-tab='view:b']").click();
        expect(await instanceOf(page, "view:b")).toBe(instance);
    });

    test("收成标题行：高度等于面板头，内容停放不重建；展开回来", async ({page}) => {
        await open(page);
        const instance = await instanceOf(page, "view:d");
        const open0 = await frameBox(page, "d");
        await act(page, "collapse-d");
        await expect.poll(async () => (await frameBox(page, "d")).height).toBe(32);
        await expect(content(page, "view:d")).toHaveCSS("visibility", "hidden");
        await act(page, "collapse-d");
        await expect.poll(async () => (await frameBox(page, "d")).height).toBeGreaterThan(100);
        expect(Math.abs((await frameBox(page, "d")).height - open0.height)).toBeLessThan(2);
        expect(await instanceOf(page, "view:d")).toBe(instance);
    });

    test("最大化：占满除条以外的区域，别的内容停放不重建；退出回到原样", async ({page}) => {
        await open(page);
        const instance = await instanceOf(page, "view:a");
        await leafOf(page, "view:a").locator("[data-structure-input]").fill("还在");
        const before = await frameBox(page, "a");
        await act(page, "maximize-b");
        await expect(frame(page, "a")).toHaveCount(0);
        await expect(content(page, "view:a")).toHaveCSS("visibility", "hidden");
        const host = await box(page, "[data-panels-host]");
        const activity = await frameBox(page, "activitybar");
        const maximized = await frameBox(page, "b");
        expect(maximized.x).toBe(activity.x + activity.width);
        expect(Math.abs(maximized.x + maximized.width - (host.x + host.width))).toBeLessThan(1);
        await act(page, "maximize-b");
        await expect(frame(page, "a")).toHaveCount(1);
        await expect(content(page, "view:a")).toHaveCSS("visibility", "visible");
        expect(await instanceOf(page, "view:a")).toBe(instance);
        await expect(leafOf(page, "view:a").locator("[data-structure-input]")).toHaveValue("还在");
        expect(Math.abs((await frameBox(page, "a")).height - before.height)).toBeLessThan(2);
    });
});

test.describe("命中与焦点", () => {
    test("内容移到 DOM 序靠前的叶之后，点得到它", async ({page}) => {
        await open(page);
        await act(page, "a-between-c-d");
        await settled(page);
        const inner = await contentBox(page, "view:a");
        expect(await contentAt(page, {x: inner.x + inner.width / 2, y: inner.y + inner.height / 2})).toBe("view:a");
    });

    test("移动之后 Tab 与 F6 都按树序，不按 DOM 序", async ({page}) => {
        await open(page);
        await act(page, "a-between-c-d");
        await settled(page);
        await content(page, "view:c").locator("[data-structure-last]").focus();
        await page.keyboard.press("Tab");
        expect(await focusedPlace(page)).toMatch(/:/u);
        await page.keyboard.press("Tab");
        expect(await focusedPlace(page)).toBe("view:a");
        await page.keyboard.press("F6");
        expect(await focusedPlace(page)).toBe("view:d");
        await page.keyboard.press("Shift+F6");
        expect(await focusedPlace(page)).toBe("view:a");
    });

    test("从 grid 外面按 Tab 进来：落在树序的第一块，不按 DOM 序；程序聚焦不改落点", async ({page}) => {
        await open(page);
        await act(page, "a-between-c-d");
        await settled(page);
        await page.locator("[data-panels-action='maximize-b']").focus();
        await page.keyboard.press("Tab");
        expect(await focusedPlace(page)).toBe("view:b");

        await page.locator("[data-panels-action='maximize-b']").focus();
        await content(page, "view:d").locator("[data-structure-input]").focus();
        expect(await focusedPlace(page)).toBe("view:d");
    });
});
