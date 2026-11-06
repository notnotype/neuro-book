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
            return {inner: read("[data-content='view:a']"), outer: read("[data-leaf='a']")};
        });
        // 飞到和编辑组重叠的地方：重叠处点到的是飞着的内容，不是编辑组。
        await expect.poll(() => page.evaluate(() => {
            const flying = document.querySelector("[data-content='view:a']")!.getBoundingClientRect();
            const below = document.querySelector("[data-content='tab:eb']")!.getBoundingClientRect();
            const left = Math.max(flying.left, below.left);
            const right = Math.min(flying.right, below.right);
            if (right - left < 4) return "还没重叠";
            return document.elementFromPoint((left + right) / 2, (flying.top + flying.bottom) / 2)?.closest<HTMLElement>("[data-content]")?.dataset.content;
        }), {intervals: [16]}).toBe("view:a");
        await settled(page);
        const after = await contentBox(page, "view:a");

        expect(after.x).toBeGreaterThan(before.x);
        expect(during.inner.x).toBeGreaterThan(before.x);
        expect(during.inner.x).toBeLessThan(after.x);
        // 同步：同一组令牌同时开始，与外框的差值恒为面板头。
        expect(Math.abs(during.inner.x - during.outer.x)).toBeLessThan(1);
        expect(Math.abs(during.inner.y - during.outer.y - 32)).toBeLessThan(1);

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

    test("收成标题行：高度等于面板头，内容停放不重建、内层保持最后的尺寸；展开回来", async ({page}) => {
        await open(page);
        const instance = await instanceOf(page, "view:d");
        const open0 = await frameBox(page, "d");
        await act(page, "collapse-d");
        await expect.poll(async () => (await frameBox(page, "d")).height).toBe(32);
        await expect(content(page, "view:d")).toHaveCSS("visibility", "hidden");
        expect(Math.abs((await box(page, "[data-content='view:d'] > .nb-grid-content__body")).height - (open0.height - 32))).toBeLessThan(2);
        await act(page, "collapse-d");
        await expect.poll(async () => (await frameBox(page, "d")).height).toBeGreaterThan(100);
        expect(Math.abs((await frameBox(page, "d")).height - open0.height)).toBeLessThan(2);
        expect(await instanceOf(page, "view:d")).toBe(instance);
    });

    test("手势预览不把内容停放：往零拖时等落账；松手才停放", async ({page}) => {
        await open(page);
        const d = await frameBox(page, "d");
        await page.mouse.move(d.x + d.width / 2, d.y - 2);
        await page.mouse.down();
        await page.mouse.move(d.x + d.width / 2, d.y + d.height + 200, {steps: 8});
        await expect.poll(async () => (await frameBox(page, "d")).height).toBeLessThan(40);
        await expect(content(page, "view:d")).toHaveCSS("visibility", "visible");
        await page.mouse.up();
        await expect(content(page, "view:d")).toHaveCSS("visibility", "hidden");
    });

    test("最大化：盖住除条以外的区域，别的面板一点不动，内容不重建；还原时缩回去露出它们", async ({page}) => {
        await open(page, true);
        await act(page, "open-e3-right-of-eb");
        await settled(page);
        const instance = await instanceOf(page, "tab:ea");
        await leafOf(page, "tab:ea").locator("[data-structure-input]").fill("还在");
        const stillIds = ["ea", "eb", "e3", "a", "c", "d"];
        const before = Object.fromEntries(await Promise.all(stillIds.map(async (id) => [id, await frameBox(page, id)] as const)));
        const smallB = await frameBox(page, "b");

        await act(page, "maximize-b");
        await expect(frame(page, "b")).toHaveAttribute("data-moving", "");
        // 过渡中：b 在长，别的面板原地不动、还看得见、已经不可交互；b 压在它们上面。
        await expect.poll(async () => (await frameBox(page, "b")).width).toBeGreaterThan(smallB.width + 1);
        for (const id of stillIds) expect(await frameBox(page, id)).toEqual(before[id]);
        await expect(content(page, "tab:ea")).toHaveCSS("visibility", "visible");
        await expect(content(page, "tab:ea")).toHaveAttribute("inert", "");
        await expect(frame(page, "ea")).toHaveAttribute("inert", "");
        await expect(page.locator("[data-grid-scope] > [data-sash]").first()).toHaveCSS("visibility", "hidden");
        await settled(page);

        const host = await box(page, "[data-panels-host]");
        const activity = await frameBox(page, "activitybar");
        const statusbar = await frameBox(page, "statusbar");
        const big = await frameBox(page, "b");
        expect(big.x).toBe(activity.x + activity.width);
        expect(Math.abs(big.x + big.width - (host.x + host.width))).toBeLessThan(1);
        expect(Math.abs(big.y + big.height - statusbar.y)).toBeLessThan(6);
        const middle = before.eb as Box;
        expect(await contentAt(page, {x: middle.x + middle.width / 2, y: middle.y + 100})).toBe("view:b");
        await expect(content(page, "tab:ea")).toHaveCSS("visibility", "hidden");

        await act(page, "maximize-b");
        await expect(frame(page, "b")).toHaveAttribute("data-moving", "");
        // 还原中：b 还压在上面往回缩，别的面板已经看得见，矩形还是原来的，不从边上重新长出来。
        await expect(frame(page, "b")).toHaveAttribute("data-flying", "");
        for (const id of stillIds) expect(await frameBox(page, id)).toEqual(before[id]);
        await expect(content(page, "tab:ea")).toHaveCSS("visibility", "visible");
        await settled(page);
        await expect(frame(page, "b")).not.toHaveAttribute("data-flying", "");
        expect(await frameBox(page, "b")).toEqual(smallB);
        expect(await instanceOf(page, "tab:ea")).toBe(instance);
        await expect(leafOf(page, "tab:ea").locator("[data-structure-input]")).toHaveValue("还在");
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

    test("从 grid 外面按 Tab 进来：落在树序的第一块，不按 DOM 序；程序聚焦与点击不改落点", async ({page}) => {
        await open(page);
        await act(page, "a-between-c-d");
        await settled(page);
        await page.locator("[data-panels-action='maximize-b']").focus();
        await page.keyboard.press("Tab");
        expect(await focusedPlace(page)).toBe("view:b");

        await page.locator("[data-panels-action='maximize-b']").focus();
        await content(page, "view:d").locator("[data-structure-input]").focus();
        expect(await focusedPlace(page)).toBe("view:d");

        await page.locator("[data-panels-action='maximize-b']").focus();
        await content(page, "view:d").locator("[data-structure-input]").click();
        expect(await focusedPlace(page)).toBe("view:d");
    });

    test("按下 Tab 不松开（收不到 keyup）之后点 grid 里的控件：不改落点", async ({page}) => {
        await open(page);
        await act(page, "a-between-c-d");
        await settled(page);
        await page.locator("[data-panels-action='maximize-b']").focus();
        await page.keyboard.down("Tab");
        await page.waitForFunction(() => new Promise((resolve) => {
            setTimeout(() => resolve(true), 0);
        }));
        await content(page, "view:d").locator("[data-structure-input]").click();
        expect(await focusedPlace(page)).toBe("view:d");
        await page.keyboard.up("Tab");
    });

    test("别的处理器在 Tab 的 keydown 里把焦点还给 grid 里的控件（弹层关闭）：不改落点", async ({page}) => {
        await open(page);
        await act(page, "a-between-c-d");
        await settled(page);
        await page.evaluate(() => {
            document.addEventListener("keydown", (event) => {
                if (event.key !== "Tab") return;
                event.preventDefault();
                document.querySelector<HTMLElement>("[data-content='view:d'] input")?.focus();
            }, {capture: true, once: true});
        });
        await page.locator("[data-panels-action='maximize-b']").focus();
        await page.keyboard.press("Tab");
        expect(await focusedPlace(page)).toBe("view:d");
    });

    test("外框和内容不相邻时，同一站里 Tab 从面板头走进内容", async ({page}) => {
        await open(page);
        await act(page, "b2-into-d-strip");
        await settled(page);
        await page.locator("[data-panel-tab='view:b2']").focus();
        await page.keyboard.press("Tab");
        expect(await focusedPlace(page)).toBe("view:b2");
        expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-structure-first"))).toBe(true);
    });

    test("点面板头空白之后按 Tab、Shift+Tab：从点的那一块按树序走，内容和外框不相邻也走得到；点空白不改上次焦点", async ({page}) => {
        await open(page);
        await act(page, "b2-into-d-strip");
        await settled(page);
        const head = await frameBox(page, "d");
        const blank = {x: head.x + head.width - 30, y: head.y + 16};
        await content(page, "view:c").locator("[data-structure-input]").focus();
        await page.mouse.click(blank.x, blank.y);
        expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
        // 这一站里点的位置之后是面板头的标签，再往后是内容；DOM 里内容离得很远。
        await page.keyboard.press("Tab");
        expect(await focusedPlace(page)).toBe("view:d");
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        expect(await focusedPlace(page)).toBe("view:b2");

        // 往前：这一站里点的位置之前没有东西，去树序的上一站（d 上面的分隔线）。
        await page.mouse.click(blank.x, blank.y);
        await page.keyboard.press("Shift+Tab");
        expect(await focusedPlace(page)).toMatch(/:/u);
        expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-sash"))).toBe(true);
    });

    test("点内部滚动区之后键盘还能滚动它", async ({page}) => {
        await open(page);
        const scroller = content(page, "view:a").locator("[data-structure-scroll]");
        await scroller.click();
        await page.keyboard.press("PageDown");
        await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    });
});
