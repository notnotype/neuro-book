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
/** 这个点上最上面的是什么：分隔线、内容项、外框（各取最近的那一层），都不是时为 null。 */
const layerAt = (page: Page, point: {x: number; y: number}) => page.evaluate(({x, y}) => {
    const hit = document.elementFromPoint(x, y);
    const sash = hit?.closest<HTMLElement>("[data-sash]")?.dataset.sash;
    if (sash !== undefined) return `sash ${sash}`;
    const key = hit?.closest<HTMLElement>("[data-content]")?.dataset.content;
    if (key !== undefined) return `content ${key}`;
    const leaf = hit?.closest<HTMLElement>("[data-leaf]")?.dataset.leaf;
    return leaf === undefined ? null : `frame ${leaf}`;
}, point);
const twoFrames = (page: Page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const inside = (point: {x: number; y: number}, rect: Box): boolean => point.x > rect.x && point.x < rect.x + rect.width && point.y > rect.y && point.y < rect.y + rect.height;

/** 截一张图，读几个点的颜色（在页面里解码，不加依赖；同 lab-grid-swap.e2e.ts）。 */
async function colorsAt(page: Page, points: ReadonlyArray<{x: number; y: number}>): Promise<number[][]> {
    const png = await page.screenshot();
    return page.evaluate(async ({data, points}) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return points.map(({x, y}) => [...context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data].slice(0, 3));
    }, {data: png.toString("base64"), points});
}
const near = (color: number[] | undefined, expected: readonly number[]): boolean => color !== undefined && color.every((value, index) => Math.abs(value - (expected[index] ?? 0)) <= 6);
/** 夹具里盖层的洋红与拿起的头的绿（GridPanelsScene.vue）。 */
const MAGENTA = [255, 0, 255] as const;
const GREEN = [0, 200, 0] as const;

test.describe("意图回写（docs/specs/ui/workbench-layout.md 输出 8、49）", () => {
    /** 用键盘调 Lab 盒子的宽：方向键每按一次 10 像素，不受盒子的缩放倍率影响。盒子的宽就是组件量到的宽，和浏览器视口无关。 */
    async function resizeCanvas(page: Page, steps: number): Promise<void> {
        const handle = page.locator('.lab-main [aria-label="调整宽度"]');
        await handle.focus();
        for (let step = 0; step < Math.abs(steps); step += 1) await page.keyboard.press(steps < 0 ? "ArrowLeft" : "ArrowRight");
    }

    test("窄盒子里侧栏被压缩；拖别的边界、再放宽，侧栏回到原宽：压缩的宽度不写成意图", async ({page}) => {
        await page.setViewportSize({width: 2560, height: 1000});
        await page.goto(`${dev.pageUrl}lab?c=NestedGrid&s=panels&theme=nbook&cw=light&vp=1400x800`);
        await expect.poll(async () => (await labState(page))?.ready).toBe(true);
        await expect(page.locator("[data-content='view:a']")).toBeVisible();
        // 盒子 1400 宽：意图之和放得下，侧栏是它的意图 280。
        await expect.poll(async () => (await frameBox(page, "a")).width).toBeGreaterThan(270);
        const wide = (await frameBox(page, "a")).width;

        // 800 宽：两个编辑器先缩到最小，再压两侧保留像素的栏。
        await resizeCanvas(page, -60);
        await expect.poll(async () => (await labState(page))?.canvas.width).toBe(800);
        await expect.poll(async () => (await frameBox(page, "a")).width).toBeLessThan(wide - 20);
        const squeezed = (await frameBox(page, "a")).width;
        expect(squeezed).toBeGreaterThan(120);

        // eb 与右栏之间的分隔条（body 的第 3 条：活动栏、侧栏、ea、eb、右栏）往右拖：右栏让位，侧栏这次没动，它的意图不该被写成压缩后的宽度。
        // （落账后右栏的意图变小，窄盒子里侧栏分到的会多一点，所以这里不断言侧栏的宽度不变。）
        const right0 = (await frameBox(page, "c")).width;
        const sash = await box(page, "[data-sash='body:3']");
        const y = sash.y + sash.height / 2;
        await page.mouse.move(sash.x + sash.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(sash.x + sash.width / 2 + 20, y, {steps: 4});
        await page.mouse.up();
        await expect.poll(async () => (await frameBox(page, "c")).width).toBeLessThan(right0 - 10);

        await resizeCanvas(page, 60);
        await expect.poll(async () => (await labState(page))?.canvas.width).toBe(1400);
        await expect.poll(async () => (await frameBox(page, "a")).width).toBeGreaterThan(wide - 1);
        expect(Math.abs((await frameBox(page, "a")).width - wide)).toBeLessThan(1);
    });
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
        // 飞到 eb 与右栏之间的分隔线上：分隔线压在飞的内容上面（输出 88：飞的抬到分隔线之下、别的内容之上）。
        await expect.poll(() => page.evaluate(() => {
            const flying = document.querySelector("[data-content='view:a']")!.getBoundingClientRect();
            const sash = document.querySelector("[data-sash='body:3']")!.getBoundingClientRect();
            const x = sash.left + sash.width / 2;
            if (x < flying.left + 1 || x > flying.right - 1) return "还没压到线上";
            return document.elementFromPoint(x, (flying.top + flying.bottom) / 2)?.closest<HTMLElement>("[data-sash]")?.dataset.sash ?? "不是分隔线";
        }), {intervals: [16]}).toBe("body:3");
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

    test("标签并入已有面板：两块面板都不动，内容仍从旧面板滑到新面板，实例、输入与滚动都在（验收 10）", async ({page}) => {
        await open(page, true);
        const fromFrame = await frameBox(page, "b");
        const toFrame = await frameBox(page, "d");
        const parkedAt = await contentBox(page, "view:b2");
        const instance = await instanceOf(page, "view:b2");
        // b2 这时是 b 里不活动的标签，停放着（inert）：输入与滚动直接写，不经焦点。
        const input = leafOf(page, "view:b2").locator("[data-structure-input]");
        const scroller = leafOf(page, "view:b2").locator("[data-structure-scroll]");
        await input.evaluate((element: HTMLInputElement) => {
            element.value = "还在";
        });
        await scroller.evaluate((element) => {
            element.scrollTop = 300;
        });
        expect(await scroller.evaluate((element) => element.scrollTop)).toBe(300);
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
        await expect(input).toHaveValue("还在");
        expect(await scroller.evaluate((element) => element.scrollTop)).toBe(300);
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

    test("竖着从零长出来、留着缩回去的叶：每一帧内容的上边都是外框的上边加面板头（输出 86）", async ({page}) => {
        await open(page, true);
        // 不用 4 秒：逐帧量到过渡结束。
        await page.addStyleTag({content: ":root { --motion-layout: 600ms !important; }"});
        /** 点一下按钮，逐帧量 c3 的外框与内容体，直到网格的过渡结束；点在页面里，第一帧就开始量。 */
        const film = (action: string) => page.evaluate(async (name) => {
            const rows: Array<{frameTop: number; frameHeight: number; bodyTop: number}> = [];
            document.querySelector<HTMLElement>(`[data-panels-action="${name}"]`)!.click();
            for (let index = 0; index < 200; index += 1) {
                await new Promise((resolve) => requestAnimationFrame(resolve));
                const frameEl = document.querySelector("[data-leaf='c3']");
                const bodyEl = document.querySelector("[data-content='view:c3'] > .nb-grid-content__body");
                if (frameEl !== null && bodyEl !== null) {
                    const frameRect = frameEl.getBoundingClientRect();
                    rows.push({frameTop: frameRect.top, frameHeight: frameRect.height, bodyTop: bodyEl.getBoundingClientRect().top});
                }
                if (index > 2 && document.querySelector("[data-grid-scope] [data-moving]") === null) break;
            }
            return rows;
        }, action);
        const expectHugsHead = (rows: Awaited<ReturnType<typeof film>>, growing: boolean): void => {
            const heights = rows.map((row) => row.frameHeight);
            const tallest = Math.max(...heights);
            // 确实量到了半路：有一帧在零与终点之间，且朝着该走的方向。
            expect(rows.some((row) => row.frameHeight > 1 && row.frameHeight < tallest - 1)).toBe(true);
            expect(growing ? heights.at(-1) : heights[0]).toBeCloseTo(tallest, 0);
            for (const row of rows) expect(Math.abs(row.bodyTop - row.frameTop - 32)).toBeLessThanOrEqual(1);
        };

        const opening = await film("open-c3-below-c");
        await settled(page);
        expect((await frameBox(page, "c3")).height).toBeGreaterThan(100);
        expectHugsHead(opening, true);

        // 关掉：内容项标了留住（`leave: "retain"`），叶在过渡里缩回那道缝，过渡结束才摘掉。
        const closing = await film("close-c3");
        await settled(page);
        await expect(frame(page, "c3")).toHaveCount(0);
        expect(closing.length).toBeGreaterThan(2);
        expectHugsHead(closing, false);
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

    test("收成标题行：高度等于面板头，内容停放不重建、内层保持最后的尺寸；展开回来不重新排版（输出 117）", async ({page}) => {
        await open(page);
        const instance = await instanceOf(page, "view:d");
        const open0 = await frameBox(page, "d");
        // 挂上时的第一次回调到了再记基数。
        await expect(leafOf(page, "view:d")).not.toHaveAttribute("data-structure-resizes", "0");
        await twoFrames(page);
        const resizes = await leafOf(page, "view:d").getAttribute("data-structure-resizes");
        await act(page, "collapse-d");
        await expect.poll(async () => (await frameBox(page, "d")).height).toBe(32);
        await expect(content(page, "view:d")).toHaveCSS("visibility", "hidden");
        expect(Math.abs((await box(page, "[data-content='view:d'] > .nb-grid-content__body")).height - (open0.height - 32))).toBeLessThan(2);
        await act(page, "collapse-d");
        await expect.poll(async () => (await frameBox(page, "d")).height).toBeGreaterThan(100);
        expect(Math.abs((await frameBox(page, "d")).height - open0.height)).toBeLessThan(2);
        expect(await instanceOf(page, "view:d")).toBe(instance);
        // 内容的 ResizeObserver 在停放与解除停放时都没有回调：等两帧，晚到的回调也看得见。
        await expect(content(page, "view:d")).toHaveCSS("visibility", "visible");
        await twoFrames(page);
        expect(await leafOf(page, "view:d").getAttribute("data-structure-resizes")).toBe(resizes);
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

    test("从 grid 后面按 Shift+Tab 进来：落在树序最后一站的最后一个控件，不按 DOM 序（输出 125）", async ({page}) => {
        await open(page);
        await act(page, "a-between-c-d");
        await settled(page);
        // 树序里右栏是 c、a、d，d 是最后一站；DOM 里 a 的内容还排在最前面。
        await page.locator("[data-panels-after]").focus();
        await page.keyboard.press("Shift+Tab");
        expect(await focusedPlace(page)).toBe("view:d");
        expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-structure-last"))).toBe(true);
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

/**
 * 叠放与拿起的内容：夹具的浮动窗 fw 压在 ea 与 eb 之间的分隔线上，盖层的洋红带压着窗的一截，拿起的 A 的绿头压着两者（矩形见 GridPanelsScene.vue）。
 * 盖层与拿起的内容不接指针，谁在上面按截图里的像素认；接不接指针按命中认。
 */
test.describe("叠放（输出 87、88、90、104）", () => {
    /** 相对网格根的点换成视口坐标。 */
    const inGrid = async (page: Page, x: number, y: number): Promise<{x: number; y: number}> => {
        const root = await box(page, "[data-grid-scope]");
        return {x: root.x + x, y: root.y + y};
    };

    test("浮动窗在分隔线之上，盖层在窗之上、不接指针，拿起的内容在最上、不接指针；拿起的内容体占满头下面并跟着重排，不停放", async ({page}) => {
        await open(page);
        await act(page, "float-fw");
        await expect(frame(page, "fw")).toBeVisible();
        const fw = await frameBox(page, "fw");
        const sash = await box(page, "[data-sash='body:2']");
        const onSash = {x: sash.x + sash.width / 2, y: (await inGrid(page, 0, 250)).y};
        expect(inside(onSash, fw), JSON.stringify({onSash, fw, sash, root: await box(page, "[data-grid-scope]")})).toBe(true);
        expect(await layerAt(page, onSash)).toBe("content view:fw");

        await act(page, "overlay");
        await expect(page.locator("[data-panels-overlay]")).toBeVisible();
        const overlayOnly = await inGrid(page, 320, 170);
        expect(inside(overlayOnly, fw)).toBe(true);
        // 命中穿过盖层，落在底下的窗里。
        expect(await layerAt(page, overlayOnly)).toBe("content view:fw");

        await act(page, "lift-a");
        await expect(content(page, "view:a")).toHaveAttribute("data-lifted", "");
        const card = await contentBox(page, "view:a");
        const head = await box(page, "[data-panels-lifted-head]");
        const body = await box(page, "[data-content='view:a'] > .nb-grid-content__body");
        expect(card.height).toBeCloseTo(200, 0);
        expect(Math.abs(body.height - (card.height - head.height))).toBeLessThanOrEqual(1);
        expect(Math.abs(body.y - (head.y + head.height))).toBeLessThanOrEqual(1);
        // 拿起的不算停放：看得见、没有 inert。
        await expect(content(page, "view:a")).toHaveCSS("visibility", "visible");
        await expect(content(page, "view:a")).not.toHaveAttribute("inert", "");
        // 拿起的卡片不接指针：卡片正文下面命中的是底下的面板，不是 A。
        const underCard = await inGrid(page, 580, 330);
        expect(inside(underCard, card)).toBe(true);
        expect(inside(underCard, fw)).toBe(false);
        expect(await layerAt(page, underCard)).not.toBeNull();
        expect(await layerAt(page, underCard)).not.toBe("content view:a");

        // 像素：盖层压着窗（洋红），拿起的头压着盖层与窗（绿）。
        const headOverOverlay = await inGrid(page, 450, 195);
        const headOverFloat = await inGrid(page, 450, 216);
        expect(inside(headOverFloat, fw)).toBe(true);
        const [overlayColor, headOnOverlay, headOnFloat] = await colorsAt(page, [overlayOnly, headOverOverlay, headOverFloat]);
        expect(near(overlayColor, MAGENTA), `盖层压在窗上：${JSON.stringify(overlayColor)}`).toBe(true);
        expect(near(headOnOverlay, GREEN), `拿起的头压在盖层上：${JSON.stringify(headOnOverlay)}`).toBe(true);
        expect(near(headOnFloat, GREEN), `拿起的头压在窗上：${JSON.stringify(headOnFloat)}`).toBe(true);

        // 宿主改了卡片的尺寸：内容体跟着重排，还是占满头下面。
        await act(page, "lift-a-taller");
        await expect.poll(async () => (await contentBox(page, "view:a")).height).toBeCloseTo(260, 0);
        const tallerBody = await box(page, "[data-content='view:a'] > .nb-grid-content__body");
        expect(Math.abs(tallerBody.height - (260 - head.height))).toBeLessThanOrEqual(1);
    });

    test("飞行的内容在浮动窗下面（输出 104）", async ({page}) => {
        await open(page, true);
        await act(page, "float-fw");
        await expect(frame(page, "fw")).toBeVisible();
        await act(page, "a-between-c-d");
        await expect(content(page, "view:a")).toHaveAttribute("data-flying", "");
        // 飞的 A 从左栏去右栏，经过窗：重叠处命中的是窗的内容。
        await expect.poll(() => page.evaluate(() => {
            const flying = document.querySelector("[data-content='view:a']")!.getBoundingClientRect();
            const window = document.querySelector("[data-content='view:fw']")!.getBoundingClientRect();
            const [left, right] = [Math.max(flying.left, window.left), Math.min(flying.right, window.right)];
            const [top, bottom] = [Math.max(flying.top, window.top), Math.min(flying.bottom, window.bottom)];
            if (right - left < 4 || bottom - top < 4) return "还没重叠";
            return document.elementFromPoint((left + right) / 2, (top + bottom) / 2)?.closest<HTMLElement>("[data-content]")?.dataset.content ?? null;
        }), {intervals: [16]}).toBe("view:fw");
    });

    test("外框、内容与浮动窗手柄是里面 fixed 元素的包含块，里面的 z-index 出不来（输出 28）", async ({page}) => {
        await open(page);
        /** 放一个 `position: fixed; inset: 0`、层级很高、接指针的元素，返回它的矩形。 */
        const fixedIn = (selector: string) => page.locator(selector).evaluate((host) => {
            const element = document.createElement("div");
            element.dataset.testFixed = "";
            element.style.cssText = "position: fixed; inset: 0; z-index: 99999; pointer-events: auto;";
            host.append(element);
            const {x, y, width, height} = element.getBoundingClientRect();
            return {x, y, width, height};
        });
        const expectSameBox = (actual: Box, expected: Box): void => {
            for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(actual[key] - expected[key])).toBeLessThan(0.5);
        };

        // 外框：放在 eb 的面板头里。矩形是外框；它的层级出不了外框，eb 的内容（内容层）照样盖在它上面。
        expectSameBox(await fixedIn("[data-panel-head='eb']"), await frameBox(page, "eb"));
        const ebBody = await contentBox(page, "tab:eb");
        expect(await layerAt(page, {x: ebBody.x + ebBody.width / 2, y: ebBody.y + ebBody.height / 2})).toBe("content tab:eb");
        // 内容：矩形是内容项的外层。
        expectSameBox(await fixedIn("[data-content='view:a'] [data-structure-leaf]"), await contentBox(page, "view:a"));
        // 手柄：矩形同窗。浮动窗最后才开，免得它盖住上面量的 eb。
        await act(page, "float-fw");
        await expect(frame(page, "fw")).toBeVisible();
        expectSameBox(await fixedIn("[data-float-chrome='fw']"), await box(page, "[data-float-chrome='fw']"));
        expectSameBox(await box(page, "[data-float-chrome='fw']"), await frameBox(page, "fw"));
    });
});
