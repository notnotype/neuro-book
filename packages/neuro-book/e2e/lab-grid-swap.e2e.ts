/**
 * NestedGrid 的交换（docs/specs/ui/nested-grid.md 的“交换”，验收 11）在真实浏览器里的验收。场景夹具是 `fixtures/nb-layout/GridSwapScene.vue`：
 * 左边一列放一组叶，列的上下各有一块叶。放慢过渡，停在几个时刻读外框的位置与像素。配置里默认减少动态效果，测过渡的用例开回来。
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
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-grid-swap");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const DURATION = 6000;
const GAP = 8;
const FIXED = [225, 225, 225];
const COLORS = {A: [200, 60, 60], B: [60, 160, 60], C: [60, 90, 200]};

const labState = (page: Page) => page.evaluate(() => (window as unknown as {__nbLab?: {state(): LabDebugState}}).__nbLab?.state() ?? null);

async function open(page: Page, motion = true): Promise<void> {
    await page.emulateMedia({reducedMotion: motion ? "no-preference" : "reduce"});
    await page.setViewportSize({width: 1440, height: 800});
    await page.goto(`${dev.pageUrl}lab?c=NestedGrid&s=swap&theme=nbook&cw=light`);
    await expect.poll(async () => (await labState(page))?.ready).toBe(true);
    await expect(page.locator("[data-leaf='a1']")).toBeVisible();
    await page.addStyleTag({content: `:root { --motion-layout: ${String(DURATION)}ms !important; }`});
}

/** 用脚本点场景的按钮：焦点不动，也不受停住的动画影响。 */
const act = (page: Page, name: string) => page.locator(`[data-swap-action="${name}"]`).evaluate((button: HTMLElement) => button.click());
/** 等过渡真的开始：第一帧写起点，下一帧写终点。 */
const started = (page: Page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

interface Column {
    readonly top: number;
    readonly bottom: number;
    readonly center: number;
}

/** 列（交换的裁切窗）：开始前 A 两块叶的外接矩形。 */
async function columnOf(page: Page): Promise<Column> {
    const [first, second] = await Promise.all(["a1", "a2"].map(async (id) => (await page.locator(`[data-leaf='${id}']`).boundingBox())!));
    return {top: first!.y, bottom: second!.y + second!.height, center: first!.x + first!.width / 2};
}

/** 停住全部过渡、走到 `fraction`，读每块组里的叶此刻的上下边（没有的为 null）。 */
async function pauseAt(page: Page, fraction: number) {
    return page.evaluate(({fraction, duration}) => {
        for (const animation of document.getAnimations()) {
            animation.pause();
            animation.currentTime = fraction * duration;
        }
        const edges = (id: string) => {
            const element = document.querySelector(`[data-lab-subject] > [data-leaf="${id}"]`);
            if (element === null) return null;
            const rect = element.getBoundingClientRect();
            return {top: rect.top, bottom: rect.bottom};
        };
        const sash = document.querySelector('[data-lab-subject] > .nb-grid-sash[data-swap="out"]');
        return {
            a1: edges("a1"), a2: edges("a2"), b1: edges("b1"), c1: edges("c1"), c2: edges("c2"),
            sash: sash === null ? null : {top: sash.getBoundingClientRect().top, besideZero: sash.querySelector("[data-beside-zero='true']") !== null},
        };
    }, {fraction, duration: DURATION});
}

/** 截一张图，读几个点的颜色（在页面里解码，不加依赖）。 */
async function colorsAt(page: Page, points: ReadonlyArray<readonly [number, number]>): Promise<number[][]> {
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
        return points.map(([x, y]) => [...context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data].slice(0, 3));
    }, {data: png.toString("base64"), points});
}
const near = (a: number[] | undefined, b: readonly number[]): boolean => a !== undefined && a.every((value, index) => Math.abs(value - (b[index] ?? 0)) <= 6);

/** 列上面、下面那两块叶里的点：交换中这里只能是它们自己的颜色。 */
async function outsideIsClean(page: Page, column: Column): Promise<void> {
    const [above, below] = await colorsAt(page, [[column.center, column.top - 30], [column.center, column.bottom + 30]]);
    expect(near(above, FIXED), `列上面 ${String(above)}`).toBe(true);
    expect(near(below, FIXED), `列下面 ${String(below)}`).toBe(true);
}

test("换一组：两组整块平移、相距列高加间距，组里的分隔线跟着滑、线在；第一帧起列外没有像素；结束后旧的一组摘掉", async ({page}) => {
    await open(page);
    const column = await columnOf(page);
    const step = column.bottom - column.top + GAP;
    await act(page, "B");
    await started(page);
    let bothSeen = false;
    for (const fraction of [0, 0.1, 0.3, 0.6]) {
        const at = await pauseAt(page, fraction);
        expect(at.a1 !== null && at.b1 !== null).toBe(true);
        // 刚开始 A 在原位、B 在列下面一个步长；之后两组一起往上走，距离不变。
        if (fraction === 0) {
            expect(at.a1!.top).toBeCloseTo(column.top, 0);
            expect(at.b1!.top).toBeCloseTo(column.top + step, 0);
        }
        expect(at.b1!.top - at.a1!.top).toBeCloseTo(step, 0);
        expect(at.sash).not.toBeNull();
        expect(at.sash!.top - at.a1!.bottom).toBeCloseTo(0, 0);
        expect(at.sash!.besideZero).toBe(false);
        await outsideIsClean(page, column);
        // 列里看得见的部分是两组自己的颜色：A 的尾巴、B 的头（布局曲线前段快，走到后面 A 已经整个出去了）。
        const tail = at.a2!.bottom - 4;
        const head = at.b1!.top + 20;
        if (tail > column.top && head < column.bottom) {
            bothSeen = true;
            const [upper, lower] = await colorsAt(page, [[column.center, tail], [column.center, head]]);
            expect(near(upper, COLORS.A), `A 的尾巴 ${String(upper)}`).toBe(true);
            expect(near(lower, COLORS.B), `B 的头 ${String(lower)}`).toBe(true);
        }
    }
    expect(bothSeen).toBe(true);
    await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
    });
    await expect(page.locator("[data-lab-subject] > [data-leaf='a1']")).toHaveCount(0);
    await expect(page.locator("[data-lab-subject] > [data-swap]")).toHaveCount(0);
    expect((await page.locator("[data-leaf='b1']").boundingBox())!.y).toBeCloseTo(column.top, 0);
});

test("滑到一半点回正在滑出去的那组：从此刻的位置往回走、重新开始完整的一段，两组不相交，回到原处", async ({page}) => {
    await open(page);
    const column = await columnOf(page);
    await act(page, "B");
    await started(page);
    const before = await pauseAt(page, 0.4);
    await act(page, "A");
    await started(page);
    const restarted = await pauseAt(page, 0);
    expect(restarted.a1!.top).toBeCloseTo(before.a1!.top, 0);
    expect(restarted.b1!.top).toBeCloseTo(before.b1!.top, 0);
    const durations = await page.evaluate(() => [...new Set(document.getAnimations().map((animation) => animation.effect?.getComputedTiming().duration))]);
    expect(durations).toEqual([DURATION]);
    for (const fraction of [0.3, 0.7]) {
        const at = await pauseAt(page, fraction);
        expect(at.a1!.top).toBeGreaterThan(before.a1!.top);
        expect(at.a2!.bottom).toBeLessThanOrEqual(at.b1!.top);
        await outsideIsClean(page, column);
    }
    await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
    });
    await expect(page.locator("[data-lab-subject] > [data-leaf='b1']")).toHaveCount(0);
    expect((await page.locator("[data-leaf='a1']").boundingBox())!.y).toBeCloseTo(column.top, 0);
});

test("滑到一半换到第三组：接在最外面那组后面，三组同向一起走、不相交", async ({page}) => {
    await open(page);
    const column = await columnOf(page);
    await act(page, "B");
    await started(page);
    const before = await pauseAt(page, 0.4);
    await act(page, "C");
    await started(page);
    const restarted = await pauseAt(page, 0);
    expect(restarted.a1!.top).toBeCloseTo(before.a1!.top, 0);
    expect(restarted.c1!.top - restarted.b1!.bottom).toBeCloseTo(GAP, 0);
    for (const fraction of [0.3, 0.7]) {
        const at = await pauseAt(page, fraction);
        expect(at.b1!.bottom).toBeLessThanOrEqual(at.c1!.top);
        if (at.a2 !== null) expect(at.a2.bottom).toBeLessThanOrEqual(at.b1!.top);
        await outsideIsClean(page, column);
    }
    await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
    });
    await expect(page.locator("[data-lab-subject] > [data-swap]")).toHaveCount(0);
    expect((await page.locator("[data-leaf='c1']").boundingBox())!.y).toBeCloseTo(column.top, 0);
});

test("减少动态效果：直接换，不交换", async ({page}) => {
    await open(page, false);
    await act(page, "B");
    await expect(page.locator("[data-lab-subject] > [data-leaf='a1']")).toHaveCount(0);
    await expect(page.locator("[data-lab-subject] > [data-swap]")).toHaveCount(0);
    await expect(page.locator("[data-swap-issues]")).toHaveText("");
});
