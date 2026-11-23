/**
 * 实时布局的编排在第二个形状上的验收（docs/specs/ui/layout-drag.md 的“实时布局的编排”）：Lab 场景 `fixtures/nb-layout/LivePanelsScene.vue`，
 * 四块卡片两列（左 a、b，右 c、d），拖一块的头到别的卡片外缘长出新块。只经 nb-layout 的公开入口（`useLiveDragSession`），不是标签页。
 * 实时布局要有过渡（减少动效时是落点指示），这里开回动效、把过渡放慢。
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
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-live-panels");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const labState = (page: Page) => page.evaluate(() => (window as unknown as {__nbLab?: {state(): LabDebugState}}).__nbLab?.state() ?? null);
const scene = (page: Page) => page.locator("[data-live-preview]");

async function open(page: Page, durationMs = 300): Promise<void> {
    await page.emulateMedia({reducedMotion: "no-preference"});
    await page.setViewportSize({width: 1440, height: 800});
    await page.goto(`${dev.pageUrl}lab?c=NestedGrid&s=live-panels&theme=nbook&cw=light`);
    await expect.poll(async () => (await labState(page))?.ready).toBe(true);
    await expect(page.locator("[data-live-head='d']")).toBeVisible();
    await page.addStyleTag({content: `:root { --motion-layout: ${String(durationMs)}ms !important; }`});
}

type Box = {readonly x: number; readonly y: number; readonly width: number; readonly height: number};
async function leaf(page: Page, id: string): Promise<Box> {
    const box = await page.locator(`[data-lab-subject] > [data-leaf="${id}"]`).boundingBox();
    if (box === null) throw new Error(`leaf ${id} is not laid out`);
    return box;
}

/** 按住 `id` 的头，过门槛，停在 (x, y)。 */
async function lift(page: Page, id: string, x: number, y: number): Promise<void> {
    const head = (await page.locator(`[data-live-head="${id}"]`).boundingBox())!;
    await page.mouse.move(head.x + head.width / 2, head.y + head.height / 2);
    await page.mouse.down();
    await page.mouse.move(head.x + head.width / 2 + 12, head.y + head.height / 2 + 12, {steps: 3});
    await page.mouse.move(x, y, {steps: 8});
}

/** 等这一场摆完过渡：来源收起的布局与空位不再动。 */
const settled = async (page: Page, id: string): Promise<Box> => {
    let last = "";
    await expect.poll(async () => {
        const now = JSON.stringify(await leaf(page, id));
        const same = now === last;
        last = now;
        return same;
    }, {intervals: [100]}).toBe(true);
    return leaf(page, id);
};

test("拖到别的卡片外缘：停稳后来源收起、长出新块（空位），松手写进树；内容是同一个实例", async ({page}) => {
    await open(page);
    await page.locator("[data-live-input='a']").fill("留着的字");
    const c = await leaf(page, "c");
    await lift(page, "a", c.x + c.width - 10, c.y + c.height / 2);
    await expect(scene(page)).toHaveAttribute("data-live-preview", "c:right");
    await expect(scene(page)).toHaveAttribute("data-live-collapsed", "true");
    // 来源收起：左列只剩 b，b 占满整列。
    const b = await settled(page, "b");
    expect(b.height).toBeGreaterThan(c.height * 1.5);
    // 空位是 c 的右半。
    const slot = (await page.locator("[data-live-slot]").boundingBox())!;
    expect(slot.x).toBeGreaterThan(c.x + c.width / 3);
    expect(Math.abs(slot.x + slot.width - (c.x + c.width))).toBeLessThanOrEqual(2);
    await page.mouse.up();
    await expect(scene(page)).toHaveAttribute("data-live-active", "false");
    const a = await settled(page, "a");
    const after = await leaf(page, "c");
    expect(a.x).toBeGreaterThan(after.x);
    expect(Math.abs(a.y - after.y)).toBeLessThanOrEqual(2);
    await expect(page.locator("[data-live-input='a']")).toHaveValue("留着的字");
});

test("落到别处之后回到自己原来那块：是原位，来源展开回原位；松手不写", async ({page}) => {
    await open(page);
    const a = await leaf(page, "a");
    const c = await leaf(page, "c");
    await lift(page, "a", c.x + c.width - 10, c.y + c.height / 2);
    await expect(scene(page)).toHaveAttribute("data-live-collapsed", "true");
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2, {steps: 8});
    await expect(scene(page)).toHaveAttribute("data-live-preview", "in-place");
    await expect(scene(page)).toHaveAttribute("data-live-collapsed", "false");
    await page.mouse.up();
    await expect(scene(page)).toHaveAttribute("data-live-active", "false");
    await expect(scene(page)).toHaveAttribute("data-live-commits", "0");
    const back = await settled(page, "a");
    expect(Math.abs(back.x - a.x) + Math.abs(back.y - a.y)).toBeLessThanOrEqual(2);
});

test("空位粘住：指针移进已显示的空位里（按判定的几何已是 c 的中央，不是落点），候选不变：马上松手也放到那块", async ({page}) => {
    await open(page);
    const c = await leaf(page, "c");
    await lift(page, "a", c.x + c.width - 10, c.y + c.height / 2);
    await expect(scene(page)).toHaveAttribute("data-live-preview", "c:right");
    await settled(page, "c");
    const slot = (await page.locator("[data-live-slot]").boundingBox())!;
    // c 原来宽度的 60% 处：判定的几何里是 c 的中央（不是落点），但在空位里。
    const x = c.x + c.width * 0.6;
    expect(x).toBeGreaterThan(slot.x);
    // 松手按指针下的候选提交，不等预览稳定：没有粘住的话这一点没有落点，什么都不写。
    await page.mouse.move(x, c.y + c.height / 2, {steps: 4});
    await page.mouse.up();
    await expect(scene(page)).toHaveAttribute("data-live-commits", "1");
    const a = await settled(page, "a");
    expect(a.x).toBeGreaterThan((await leaf(page, "c")).x);
});

test("收起那一刻指针没动：松手放到屏幕上那个落点；指针一动就按收起后的几何重判", async ({page}) => {
    await open(page);
    const b = await leaf(page, "b");
    // b 的上沿：收起 a 之后 b 占满左列，这一点在收起后的几何里是 b 的中段，不是落点。
    const point = {x: b.x + b.width / 2, y: b.y + b.height * 0.1};
    await lift(page, "a", point.x, point.y);
    await expect(scene(page)).toHaveAttribute("data-live-preview", "b:top");
    await expect(scene(page)).toHaveAttribute("data-live-collapsed", "true");
    await page.mouse.up();
    await expect(scene(page)).toHaveAttribute("data-live-commits", "1");
    const a = await settled(page, "a");
    const after = await leaf(page, "b");
    expect(a.y).toBeLessThan(after.y);
    expect(Math.abs(a.x - after.x)).toBeLessThanOrEqual(2);

    // 还原，再来一次：这回收起之后指针动一下。
    await page.locator("[data-live-action='reset']").click();
    await settled(page, "a");
    await lift(page, "a", point.x, point.y);
    await expect(scene(page)).toHaveAttribute("data-live-preview", "b:top");
    await expect(scene(page)).toHaveAttribute("data-live-collapsed", "true");
    await page.mouse.move(point.x + 1, point.y);
    await expect(scene(page)).toHaveAttribute("data-live-preview", "source-removed");
    await page.mouse.up();
    await expect(scene(page)).toHaveAttribute("data-live-active", "false");
    // 上一回写了一次，这回不写。
    await expect(scene(page)).toHaveAttribute("data-live-commits", "1");
});

test("布局过渡进行中拿起：判定的几何量的是过渡终点，按终点的矩形判外缘", async ({page}) => {
    await open(page, 1500);
    const grid = (await page.locator("[data-lab-subject]").boundingBox())!;
    // 左右两列换成 3 比 1，过渡 1.5s；马上拿起。
    await page.locator("[data-live-action='widen']").click();
    const c = await leaf(page, "c");
    expect(c.x).toBeLessThan(grid.x + grid.width * 0.7);
    // 终点里 c 从 3/4 处开始、宽 1/4：它左沿往里 10% 的这一点按终点是 c 的左缘；按过渡起点（c 从一半处起）是 c 的中央，不是落点。
    const x = grid.x + grid.width * 0.775;
    await lift(page, "d", x, c.y + c.height / 2);
    await expect(scene(page)).toHaveAttribute("data-live-preview", "c:left");
    await page.mouse.up();
});
