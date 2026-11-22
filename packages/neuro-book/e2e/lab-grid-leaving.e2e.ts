/**
 * NestedGrid 离开的内容由库留到过渡结束（docs/specs/ui/nested-grid.md 输出 155、156）在真实浏览器里的验收。场景夹具是
 * `fixtures/nb-layout/GridLeavingScene.vue`：一行四张卡，关一张就在同一个同步段里去掉它的叶、内容项和数据。a、b、c 标了 `leave: "retain"`，d 没标。
 * 配置里默认减少动态效果，测过渡的用例开回来、把过渡放慢。
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
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-grid-leaving");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const DURATION = 1500;

const labState = (page: Page) => page.evaluate(() => (window as unknown as {__nbLab?: {state(): LabDebugState}}).__nbLab?.state() ?? null);

/** 打开场景，收集页面错误与控制台报错（冻住的内容里渲染出错时库会报一条）。 */
async function open(page: Page, motion = true): Promise<string[]> {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });
    await page.emulateMedia({reducedMotion: motion ? "no-preference" : "reduce"});
    await page.setViewportSize({width: 1440, height: 800});
    await page.goto(`${dev.pageUrl}lab?c=NestedGrid&s=leaving&theme=nbook&cw=light`);
    await expect.poll(async () => (await labState(page))?.ready).toBe(true);
    await expect(page.locator("[data-leaving-card='b']")).toBeVisible();
    await page.addStyleTag({content: `:root { --motion-layout: ${String(DURATION)}ms !important; }`});
    return errors;
}

/** 用脚本点“关”，等两帧（过渡第一帧写起点，下一帧写终点）再读这一刻的样子：断言要落在过渡里，不能等 Playwright 的重试。 */
function closeAndRead(page: Page, id: string) {
    return page.evaluate((id) => new Promise<{frame: {leaving: boolean; inert: boolean; head: string | null} | null; content: {leaving: boolean; inert: boolean; visibility: string; text: string} | null}>((resolve) => {
        document.querySelector<HTMLElement>(`[data-leaving-action="close-${id}"]`)?.click();
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const frame = document.querySelector<HTMLElement>(`[data-lab-subject] > [data-leaf="${id}"]`);
            const content = document.querySelector<HTMLElement>(`[data-lab-subject] > [data-content="${id}"]`);
            resolve({
                frame: frame === null ? null : {leaving: frame.hasAttribute("data-leaving"), inert: frame.hasAttribute("inert"), head: frame.querySelector(`[data-leaving-head]`)?.textContent ?? null},
                content: content === null ? null : {leaving: content.hasAttribute("data-content-leaving"), inert: content.hasAttribute("inert"), visibility: getComputedStyle(content).visibility, text: content.querySelector(`[data-leaving-card]`)?.textContent?.trim() ?? ""},
            });
        }));
    }), id);
}

/** 过渡中途（叶外框缩到关之前的四分之一到四分之三之间）那一帧，叶外框与内容外层的宽度（关之前的宽度一并给出）。逐帧等这个状态，不按时长等。 */
function widthsMidway(page: Page, id: string) {
    return page.evaluate((id) => {
        const read = () => {
            const frame = document.querySelector<HTMLElement>(`[data-lab-subject] > [data-leaf="${id}"]`);
            const content = document.querySelector<HTMLElement>(`[data-lab-subject] > [data-content="${id}"]`);
            return {frame: frame?.getBoundingClientRect().width ?? null, content: content?.getBoundingClientRect().width ?? null};
        };
        const before = read();
        document.querySelector<HTMLElement>(`[data-leaving-action="close-${id}"]`)?.click();
        return new Promise<{before: ReturnType<typeof read>; midway: ReturnType<typeof read>}>((resolve) => {
            const step = () => {
                const now = read();
                if (now.frame !== null && before.frame !== null && now.frame > before.frame * 0.25 && now.frame < before.frame * 0.75) resolve({before, midway: now});
                else requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
    }, id);
}

test("标了留住的卡片关掉时，内容与面板头停在关之前的样子跟着叶缩回去，过渡结束才卸载", async ({page}) => {
    const errors = await open(page);
    const during = await closeAndRead(page, "b");
    expect(during.frame).toEqual({leaving: true, inert: true, head: "卡片 B"});
    expect(during.content).toEqual({leaving: true, inert: true, visibility: "visible", text: "B 的正文"});
    await expect(page.locator("[data-lab-subject] > [data-content='b']")).toHaveCount(0, {timeout: DURATION * 3});
    await expect(page.locator("[data-lab-subject] > [data-leaf='b']")).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("留着的内容跟着叶一起缩：过渡走到一半时两者的宽度都在关之前与零之间", async ({page}) => {
    const errors = await open(page);
    const {before, midway} = await widthsMidway(page, "c");
    expect(before.frame).toBeGreaterThan(100);
    for (const width of [midway.frame, midway.content]) {
        expect(width).not.toBeNull();
        expect(width!).toBeGreaterThan(0);
        expect(width!).toBeLessThan(before.frame! - 20);
    }
    expect(Math.abs(midway.frame! - midway.content!)).toBeLessThan(2);
    expect(errors).toEqual([]);
});

test("没标留住的卡片关掉时当即卸载，叶也不留着缩回去", async ({page}) => {
    const errors = await open(page);
    const during = await closeAndRead(page, "d");
    expect(during).toEqual({frame: null, content: null});
    expect(errors).toEqual([]);
});

test("减少动态效果时不过渡，标了留住的也当即卸载", async ({page}) => {
    const errors = await open(page, false);
    const during = await closeAndRead(page, "b");
    expect(during).toEqual({frame: null, content: null});
    expect(errors).toEqual([]);
});
