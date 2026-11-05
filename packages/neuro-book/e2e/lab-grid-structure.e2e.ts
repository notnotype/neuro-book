/**
 * NestedGrid 的结构变化、过渡、停放与设备像素（docs/specs/ui/nested-grid.md）在真实浏览器里的验收。场景夹具是
 * `fixtures/nb-layout/GridStructureScene.vue`。配置里默认减少动态效果，测过渡的用例开回来。
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
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-grid-structure");
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
    await page.goto(`${dev.pageUrl}lab?c=NestedGrid&s=structure&theme=nbook&cw=light`);
    await expect.poll(async () => (await labState(page))?.ready).toBe(true);
    await expect(page.locator("[data-leaf='a']")).toBeVisible();
}

/** 用脚本点场景的按钮：焦点不动。 */
const act = (page: Page, name: string) => page.locator(`[data-structure-action="${name}"]`).evaluate((button: HTMLElement) => button.click());
const frame = (page: Page, id: string) => page.locator(`[data-leaf="${id}"]`);
const content = (page: Page, id: string) => page.locator(`[data-leaf-content="${id}"]`);
const leaf = (page: Page, id: string) => page.locator(`[data-structure-leaf="${id}"]`);
const instanceOf = (page: Page, id: string) => leaf(page, id).getAttribute("data-structure-instance");
const domOrder = (page: Page) => page.locator("[data-grid-scope] > [data-leaf]").evaluateAll((frames) => frames.map((element) => (element as HTMLElement).dataset.leaf));
const widthOf = async (page: Page, id: string): Promise<number> => (await frame(page, id).boundingBox())?.width ?? -1;
const movingCount = (page: Page) => page.locator("[data-grid-scope] [data-moving]").count();
const settled = (page: Page) => expect(page.locator("[data-grid-scope] [data-moving]")).toHaveCount(0);

test.describe("结构变化（验收 8）", () => {
    test("拆分、关闭、换位：还在的叶不重建，输入、滚动与焦点都在；拆分与关闭后 DOM 序等于树序，换位后 DOM 不动", async ({page}) => {
        await open(page);
        const input = leaf(page, "a").locator("[data-structure-input]");
        await input.fill("还在");
        const scroller = leaf(page, "a").locator("[data-structure-scroll]");
        await scroller.evaluate((element) => {
            element.scrollTop = 300;
        });
        await input.focus();
        const instances = [await instanceOf(page, "a"), await instanceOf(page, "b"), await instanceOf(page, "c")];
        const keep = async (): Promise<void> => {
            expect([await instanceOf(page, "a"), await instanceOf(page, "b"), await instanceOf(page, "c")]).toEqual(instances);
            await expect(input).toHaveValue("还在");
            await expect(input).toBeFocused();
            expect(await scroller.evaluate((element) => element.scrollTop)).toBe(300);
        };

        await act(page, "split-before");
        await expect(frame(page, "n")).toBeVisible();
        await keep();
        expect(await domOrder(page)).toEqual(["n", "a", "b", "c"]);

        await act(page, "close-new");
        await expect(frame(page, "n")).toHaveCount(0);
        await keep();
        expect(await domOrder(page)).toEqual(["a", "b", "c"]);

        const before = (await frame(page, "a").boundingBox())?.x ?? -1;
        await act(page, "move-to-end");
        await expect.poll(async () => (await frame(page, "a").boundingBox())?.x ?? -1).toBeGreaterThan(before);
        expect((await frame(page, "a").boundingBox())?.x).toBeGreaterThan((await frame(page, "c").boundingBox())?.x ?? Number.POSITIVE_INFINITY);
        await keep();
        expect(await domOrder(page)).toEqual(["a", "b", "c"]);
    });
});

test.describe("过渡（输出“过渡”、验收 9）", () => {
    test("程序调整尺寸：外框过渡到新矩形，内容一开始就是最终尺寸，ResizeObserver 只报一次，结束后撤掉标记", async ({page}) => {
        await open(page, true);
        const resizesBefore = Number(await leaf(page, "a").getAttribute("data-structure-resizes"));
        const before = await widthOf(page, "a");
        await act(page, "widen");
        await expect(frame(page, "a")).toHaveAttribute("data-moving", "");
        // 读同一帧：外框还没走到，内容已经是最终尺寸。
        const during = await page.evaluate(() => {
            const outer = document.querySelector("[data-leaf='a']")!.getBoundingClientRect().width;
            const inner = document.querySelector("[data-leaf-content='a']")!.getBoundingClientRect().width;
            return {outer, inner};
        });
        expect(during.inner).toBeGreaterThan(before);
        expect(during.outer).toBeLessThan(during.inner);
        await settled(page);
        expect(await widthOf(page, "a")).toBe(during.inner);
        await expect.poll(async () => Number(await leaf(page, "a").getAttribute("data-structure-resizes"))).toBe(resizesBefore + 1);
    });

    test("新叶从挨着兄弟的边长出来；离开的叶立即消失", async ({page}) => {
        await open(page, true);
        await act(page, "split-before");
        await expect(frame(page, "n")).toHaveAttribute("data-moving", "");
        const finalWidth = await content(page, "n").evaluate((element) => element.getBoundingClientRect().width);
        // 过渡中：新叶的起点不动，终点和让位的 a 的起点一起走，中间不露空白；分隔线夹在它们之间。
        const during = await page.evaluate(() => {
            const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
            const n = rect("[data-leaf='n']");
            const a = rect("[data-leaf='a']");
            const sash = rect("[data-sash='a-split:0']");
            return {nLeft: n.left, nRight: n.right, aLeft: a.left, sashLeft: sash.left};
        });
        expect(during.nRight - during.nLeft).toBeLessThan(finalWidth);
        expect(Math.abs(during.nLeft - (await page.locator("[data-grid-scope]").boundingBox())!.x)).toBeLessThan(1);
        expect(during.aLeft - during.nRight).toBeLessThan(8);
        expect(during.sashLeft).toBeGreaterThanOrEqual(during.nRight - 2);
        expect(during.sashLeft).toBeLessThanOrEqual(during.aLeft + 2);
        await settled(page);
        expect(await widthOf(page, "n")).toBe(finalWidth);
        await act(page, "close-new");
        await expect(frame(page, "n")).toHaveCount(0);
    });

    test("拖分隔线、松手落账、改窗口尺寸都不过渡；过渡中开始手势，外框直接到终点", async ({page}) => {
        await open(page, true);
        const sash = page.locator("[data-sash='root:0']");
        const box = (await sash.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + 100);
        await page.mouse.down();
        await page.mouse.move(box.x + 60, box.y + 100, {steps: 4});
        expect(await movingCount(page)).toBe(0);
        await page.mouse.up();
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        expect(await movingCount(page)).toBe(0);

        // 高度也变：宿主与 grid 各有一个 ResizeObserver，晚一拍的那个不能被当成程序变化。等两帧再看，标记晚到也看得见。
        for (const size of [{width: 1200, height: 700}, {width: 1300, height: 600}]) {
            await page.setViewportSize(size);
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            expect(await movingCount(page)).toBe(0);
        }

        await act(page, "narrow");
        await expect(frame(page, "a")).toHaveAttribute("data-moving", "");
        const moved = (await sash.boundingBox())!;
        await page.mouse.move(moved.x + moved.width / 2, moved.y + 100);
        await page.mouse.down();
        await settled(page);
        await page.mouse.up();
    });

    test("连续两次变化：计时从最后一次算", async ({page}) => {
        await open(page, true);
        await page.evaluate(() => document.querySelector<HTMLElement>("[data-grid-scope]")!.style.setProperty("--motion-layout", "600ms"));
        await act(page, "widen");
        const first = await page.evaluate(() => performance.now());
        await page.waitForFunction((at) => performance.now() > at + 300, first);
        await act(page, "narrow");
        const second = await page.evaluate(() => performance.now());
        await settled(page);
        const ended = await page.evaluate(() => performance.now());
        expect(ended - second).toBeGreaterThan(500);
    });

    test("减少动态效果：没有过渡", async ({page}) => {
        await open(page);
        await act(page, "widen");
        await expect.poll(() => widthOf(page, "a")).toBeGreaterThan(0);
        expect(await movingCount(page)).toBe(0);
    });
});

test.describe("停放（输出“停放”）", () => {
    test("预览拖到零不停放，焦点不丢、内容不闪；落账才停放，内容保持原尺寸；拖回来实例与滚动都在", async ({page}) => {
        await open(page);
        const input = leaf(page, "c").locator("[data-structure-input]");
        const scroller = leaf(page, "c").locator("[data-structure-scroll]");
        await input.fill("c 的内容");
        await scroller.evaluate((element) => {
            element.scrollTop = 200;
        });
        await input.focus();
        const instance = await instanceOf(page, "c");
        const widthBefore = await widthOf(page, "c");
        const sash = page.locator("[data-sash='root:1']");
        const box = (await sash.boundingBox())!;
        const y = box.y + 100;
        const right = box.x + widthBefore + 40;

        await page.mouse.move(box.x + box.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(right, y, {steps: 8});
        await expect.poll(() => widthOf(page, "c")).toBe(0);
        // 预览：外框是零，内容保持最后一个非零尺寸（拖到最小宽度之后才跳到零），没有 inert，焦点还在。
        await expect(content(page, "c")).not.toHaveAttribute("inert", "");
        await expect(input).toBeFocused();
        const keptWidth = await content(page, "c").evaluate((element) => element.getBoundingClientRect().width);
        expect(keptWidth).toBe(120);

        await page.mouse.up();
        await expect(content(page, "c")).toHaveAttribute("inert", "");
        await expect(content(page, "c")).toHaveCSS("visibility", "hidden");
        expect(await content(page, "c").evaluate((element) => element.getBoundingClientRect().width)).toBe(keptWidth);

        const parkedSash = (await sash.boundingBox())!;
        await page.mouse.move(parkedSash.x + parkedSash.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(parkedSash.x - 200, y, {steps: 8});
        // 从零往外拉：松手前内容就在。
        await expect(content(page, "c")).not.toHaveAttribute("inert", "");
        await expect(content(page, "c")).toHaveCSS("visibility", "visible");
        await page.mouse.up();
        await expect.poll(() => widthOf(page, "c")).toBeGreaterThan(100);
        await expect(content(page, "c")).not.toHaveAttribute("inert", "");
        await expect(content(page, "c")).toHaveCSS("visibility", "visible");
        expect(await instanceOf(page, "c")).toBe(instance);
        await expect(input).toHaveValue("c 的内容");
        expect(await scroller.evaluate((element) => element.scrollTop)).toBe(200);
    });
});

test.describe("焦点与读屏顺序（输出“Tab 顺序”“移动焦点”“读屏顺序”）", () => {
    const focusedIn = (page: Page) => page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        return active?.closest<HTMLElement>("[data-sash]")?.dataset.sash ?? active?.closest<HTMLElement>("[data-structure-leaf]")?.dataset.structureLeaf ?? null;
    });
    const button = (page: Page, id: string, which: "first" | "last") => leaf(page, id).locator(`[data-structure-${which}]`);
    /** 无障碍树里的按钮名字，按树的顺序：Playwright 的 `ariaSnapshot()` 不反映 `aria-owns`，要用 CDP。 */
    async function axButtons(page: Page): Promise<string[]> {
        const cdp = await page.context().newCDPSession(page);
        const {nodes} = await cdp.send("Accessibility.getFullAXTree") as {nodes: Array<{nodeId: string; childIds?: string[]; role?: {value?: string}; name?: {value?: string}; ignored?: boolean}>};
        const byId = new Map(nodes.map((node) => [node.nodeId, node]));
        const names: string[] = [];
        const walk = (node: (typeof nodes)[number] | undefined): void => {
            if (node === undefined) return;
            if (node.role?.value === "button" && node.ignored !== true && node.name?.value !== undefined) names.push(node.name.value);
            for (const child of node.childIds ?? []) walk(byId.get(child));
        };
        walk(nodes[0]);
        return names.filter((name) => /^[abc]( 末尾)?$/u.test(name));
    }

    test("DOM 序等于树序时不接管：没有 aria-owns，Tab 是浏览器的", async ({page}) => {
        await open(page);
        expect(await page.locator("[data-grid-scope]").getAttribute("aria-owns")).toBeNull();
        await button(page, "a", "last").focus();
        await page.keyboard.press("Tab");
        expect(await focusedIn(page)).toBe("root:0");
        await page.keyboard.press("Tab");
        expect(await focusedIn(page)).toBe("b");
    });

    test("换位后 Tab 按树序走，走出最后一项离开 grid；Shift+Tab 反向；无障碍树也按树序", async ({page}) => {
        await open(page);
        await act(page, "move-to-end");
        await expect(page.locator("[data-grid-scope]")).toHaveAttribute("aria-owns", /.+/u);
        expect(await axButtons(page)).toEqual(["b", "b 末尾", "c", "c 末尾", "a", "a 末尾"]);

        // 树序是 b、c、a，DOM 序还是 a、b、c。
        await button(page, "b", "last").focus();
        await page.keyboard.press("Tab");
        expect(await focusedIn(page)).toBe("root:0");
        await page.keyboard.press("Tab");
        expect(await focusedIn(page)).toBe("c");
        await button(page, "c", "last").focus();
        await page.keyboard.press("Tab");
        expect(await focusedIn(page)).toBe("root:1");
        await page.keyboard.press("Tab");
        expect(await focusedIn(page)).toBe("a");
        await expect(button(page, "a", "first")).toBeFocused();

        await page.keyboard.press("Shift+Tab");
        expect(await focusedIn(page)).toBe("root:1");
        await page.keyboard.press("Shift+Tab");
        await expect(button(page, "c", "last")).toBeFocused();

        // 走出树序的最后一项：离开 grid，不按 DOM 序回到 b。
        await button(page, "a", "last").focus();
        await page.keyboard.press("Tab");
        expect(await page.evaluate(() => document.activeElement?.closest("[data-grid-scope]") === null)).toBe(true);
    });

    test("内容自己处理了 Tab、输入法正在组字时不接管", async ({page}) => {
        await open(page);
        await act(page, "move-to-end");
        await button(page, "b", "last").focus();
        const prevented = (isComposing: boolean) => button(page, "b", "last").evaluate((element, composing) => {
            const event = new KeyboardEvent("keydown", {key: "Tab", bubbles: true, cancelable: true, isComposing: composing});
            element.dispatchEvent(event);
            return event.defaultPrevented;
        }, isComposing);
        expect(await prevented(true)).toBe(false);
        expect(await prevented(false)).toBe(true);
    });

    test("F6 按树序在叶之间走，回到上次的焦点，最外层绕回；分隔线不是落点", async ({page}) => {
        await open(page);
        const input = leaf(page, "b").locator("[data-structure-input]");
        await input.focus();
        await page.keyboard.press("F6");
        expect(await focusedIn(page)).toBe("c");
        await page.keyboard.press("F6");
        expect(await focusedIn(page)).toBe("a");
        await page.keyboard.press("F6");
        await expect(input).toBeFocused();
        await page.keyboard.press("Shift+F6");
        expect(await focusedIn(page)).toBe("a");

        await page.locator("[data-sash='root:0']").focus();
        await page.keyboard.press("F6");
        expect(await focusedIn(page)).toBe("b");
    });
});

test.describe("设备像素比 1.25（验收 9）", () => {
    test.use({deviceScaleFactor: 1.25});

    test("两条缝一样宽，边都在设备像素上", async ({page}) => {
        await open(page);
        const measure = () => page.evaluate(() => {
            const dpr = window.devicePixelRatio;
            const device = (value: number): number => value * dpr;
            const sashes = [...document.querySelectorAll("[data-grid-scope] > [data-sash]")].map((element) => element.getBoundingClientRect());
            const leaves = [...document.querySelectorAll("[data-grid-scope] > [data-leaf]")].map((element) => element.getBoundingClientRect());
            // 取整是相对 grid 根的：Lab 的舞台不一定把根放在设备像素格上。
            const origin = document.querySelector("[data-grid-scope]")!.getBoundingClientRect().left;
            return {dpr, widths: sashes.map((rect) => device(rect.width)), offEdges: leaves.map((rect) => Math.abs(device(rect.left - origin) - Math.round(device(rect.left - origin))))};
        });
        for (const width of [1440, 1333, 1211]) {
            await page.setViewportSize({width, height: 800});
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const result = await measure();
            expect(result.dpr).toBe(1.25);
            expect(result.widths[0]).toBeCloseTo(result.widths[1] as number, 3);
            expect(result.widths[0]).toBeCloseTo(5, 3);
            for (const off of result.offEdges) expect(off).toBeLessThan(0.01);
        }
    });
});
