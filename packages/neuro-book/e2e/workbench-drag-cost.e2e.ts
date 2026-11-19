/**
 * 拖动的每帧开销（docs/specs/ui/workbench-layout.md“实时布局”）：跟手的东西不走渲染。开着长章节，候选稳定、过渡结束之后，移动中每帧至多一次样式重算（帧自己那次）、不布局；指针不动一次也没有。
 * 数次数，不计时：次数和机器快慢无关。Playwright 的轨迹快照本身要重算样式，这里关掉。
 */

import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {CDPSession, Locator, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

test.use({trace: "off", video: "off", screenshot: "off"});

const PARAGRAPH = "天色将晚，她推开了门，雨下了一整夜。街上没有人，只有远处的灯还亮着，风把门吹得吱吱作响。\n\n";
/** 帧数的抖动：测量开始和结束那一帧可能多算一次。 */
const PER_FRAME_LIMIT = 1.3;

let tmp = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "drag-cost");
    const project = join(tmp, "book");
    await mkdir(join(project, "notes"), {recursive: true});
    await mkdir(join(project, ".nbook"), {recursive: true});
    const id = randomUUID();
    await writeFile(join(project, ".nbook", "project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(project, "notes", "short.md"), `# 短章\n\n${PARAGRAPH.repeat(20)}`);
    await writeFile(join(project, "notes", "long.md"), `# 长章\n\n${PARAGRAPH.repeat(2300)}`);
    const state = join(tmp, "state");
    await mkdir(join(state, "user"), {recursive: true});
    await writeFile(join(state, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: project}]}));
    server = await startProductServer(state);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function openBook(page: Page): Promise<CDPSession> {
    await page.setViewportSize({width: 1440, height: 900});
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    const folder = page.locator("[data-explorer-row=\"project://notes\"]");
    if (await folder.getAttribute("aria-expanded") !== "true") await folder.click();
    const tabs = page.locator("[data-editor-tab]");
    for (const name of ["short", "long"]) {
        await page.locator(`[data-explorer-row="project://notes/${name}.md"]`).dblclick();
        await expect(tabs.filter({hasText: `${name}.md`})).toHaveCount(1);
    }
    await expect(page.locator("[data-editor-group-active] [data-editor-prose]")).toContainText("长章");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    return cdp;
}

async function counts(cdp: CDPSession): Promise<{recalc: number; layout: number}> {
    const {metrics} = await cdp.send("Performance.getMetrics") as {metrics: Array<{name: string; value: number}>};
    const read = (name: string): number => metrics.find((item) => item.name === name)?.value ?? 0;
    return {recalc: read("RecalcStyleCount"), layout: read("LayoutCount")};
}

/** 等 N 帧。不按时长等：帧才是这里的单位。 */
const frames = (page: Page, count: number): Promise<void> => page.evaluate((target) => new Promise<void>((done) => {
    let seen = 0;
    const tick = (): void => {
        seen += 1;
        if (seen >= target) done();
        else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}), count);

/** 跑一段，返回这段里每帧多少次样式重算与布局。 */
async function perFrame(page: Page, cdp: CDPSession, run: () => Promise<void>): Promise<{recalc: number; layout: number; frames: number}> {
    await page.evaluate(() => {
        const host = window as unknown as {__frames: number; __counting: boolean};
        host.__frames = 0;
        host.__counting = true;
        const tick = (): void => {
            if (!host.__counting) return;
            host.__frames += 1;
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
    const before = await counts(cdp);
    await run();
    const after = await counts(cdp);
    const seen = await page.evaluate(() => {
        const host = window as unknown as {__frames: number; __counting: boolean};
        host.__counting = false;
        return host.__frames;
    });
    return {recalc: (after.recalc - before.recalc) / seen, layout: (after.layout - before.layout) / seen, frames: seen};
}

async function lift(page: Page, source: Locator): Promise<void> {
    const box = await source.boundingBox();
    if (box === null) throw new Error("没有来源");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + 80, {steps: 4});
}

/** 这一段里指针一直在动：在一块小范围里来回，候选不变。 */
async function wiggle(page: Page, at: {x: number; y: number}, rounds: number): Promise<void> {
    for (let round = 0; round < rounds; round += 1) {
        await page.mouse.move(at.x + 40, at.y + 30, {steps: 20});
        await page.mouse.move(at.x - 40, at.y - 30, {steps: 20});
    }
}

/** 候选稳定、预览的过渡与卡片的缩放都结束。 */
async function settle(page: Page): Promise<void> {
    await expect(page.locator("[data-moving]")).toHaveCount(0);
    const card = page.locator("[data-lifted]");
    if (await card.count() === 0) return;
    await expect.poll(async () => {
        const first = await card.evaluate((element) => (element as HTMLElement).style.width);
        await frames(page, 2);
        return first === await card.evaluate((element) => (element as HTMLElement).style.width);
    }).toBe(true);
}

test.describe("拖动的每帧开销", () => {
    test("实时布局，拖视图：卡片跟手每帧至多一次样式重算、不布局；指针不动一次也没有", async ({page}) => {
        test.setTimeout(120_000);
        await page.emulateMedia({reducedMotion: "no-preference"});
        const cdp = await openBook(page);
        // 侧栏是“项目”容器的分节，拖资源管理器那一节的标题。
        await lift(page, page.locator("[data-panel-tab=\"view:nbook.explorer\"]"));
        const body = await page.locator("[data-editor-group-active]").boundingBox();
        if (body === null) throw new Error("没有编辑组");
        const at = {x: body.x + body.width * 0.5, y: body.y + body.height * 0.5};
        await page.mouse.move(at.x, at.y, {steps: 8});
        await settle(page);
        await wiggle(page, at, 1);
        await settle(page);
        const moving = await perFrame(page, cdp, () => wiggle(page, at, 3));
        expect(moving.recalc, JSON.stringify(moving)).toBeLessThanOrEqual(PER_FRAME_LIMIT);
        expect(moving.layout, JSON.stringify(moving)).toBeLessThanOrEqual(0.1);
        // 最后一次移动的那一帧还没画完就开始数的话，会把它算进来。
        await frames(page, 5);
        const still = await perFrame(page, cdp, () => frames(page, 60));
        expect(still.recalc, JSON.stringify(still)).toBe(0);
        await page.keyboard.press("Escape");
        await page.mouse.up();
    });

    test("实时布局按住不动：页面不排动画帧；再动一步，卡片在指针移动后的那一帧就跟上", async ({page}) => {
        test.setTimeout(120_000);
        await page.emulateMedia({reducedMotion: "no-preference"});
        // 页面自己排的动画帧回调执行一次记一次；用例自己等帧用原函数，不算进去。
        await page.addInitScript(() => {
            const raw = window.requestAnimationFrame.bind(window);
            const host = window as unknown as {__raf: {calls: number; raw: typeof requestAnimationFrame}};
            host.__raf = {calls: 0, raw};
            window.requestAnimationFrame = (callback) => raw((time) => {
                host.__raf.calls += 1;
                callback(time);
            });
        });
        await openBook(page);
        await lift(page, page.locator("[data-panel-tab=\"view:nbook.explorer\"]"));
        const body = await page.locator("[data-editor-group-active]").boundingBox();
        if (body === null) throw new Error("没有编辑组");
        const at = {x: body.x + body.width * 0.5, y: body.y + body.height * 0.5};
        await page.mouse.move(at.x, at.y, {steps: 8});
        await expect(page.locator("[data-lifted]")).toHaveCount(1);
        // 工具视图放不进编辑组：这里被拒绝，预览最后是来源收起。先等它换上（布局开始过渡），再等过渡结束：只等过渡的话，
        // 候选还在等稳定时就过了，之后预览才换、布局才动，过渡结束时分隔线对齐排的那一帧落进下面数的 60 帧里。
        await expect(page.locator("[data-workbench-surface]")).toHaveAttribute("data-live-preview", "source-removed");
        await settle(page);
        const held = await page.evaluate(() => new Promise<number>((done) => {
            const host = window as unknown as {__raf: {calls: number; raw: typeof requestAnimationFrame}};
            const wait = (count: number, then: () => void): void => {
                host.__raf.raw(() => (count <= 1 ? then() : wait(count - 1, then)));
            };
            // 前 10 帧里可能还有收尾的一两帧；之后的 60 帧（约一秒）里一次都不该有。
            wait(10, () => {
                const start = host.__raf.calls;
                wait(60, () => done(host.__raf.calls - start));
            });
        }));
        expect(held).toBe(0);

        // 指针移动时登记一个原函数的帧回调：它和手势、帧循环排在同一帧，读到的卡片位置就是这一帧写的。
        const card = page.locator("[data-lifted]");
        const before = await card.boundingBox();
        if (before === null) throw new Error("没有卡片");
        await page.evaluate(() => {
            const host = window as unknown as {__raf: {raw: typeof requestAnimationFrame}; __cardX?: number};
            window.addEventListener("pointermove", () => {
                host.__raf.raw(() => {
                    host.__cardX = document.querySelector("[data-lifted]")!.getBoundingClientRect().x;
                });
            }, {capture: true, once: true});
        });
        await page.mouse.move(at.x + 30, at.y);
        await expect.poll(() => page.evaluate(() => (window as unknown as {__cardX?: number}).__cardX ?? null)).not.toBeNull();
        const followed = await page.evaluate(() => (window as unknown as {__cardX: number}).__cardX);
        expect(followed - before.x).toBeCloseTo(30, 0);
        await page.keyboard.press("Escape");
        await page.mouse.up();
    });

    test("实时布局，拖编辑器标签：每帧至多一次样式重算、不布局", async ({page}) => {
        test.setTimeout(120_000);
        await page.emulateMedia({reducedMotion: "no-preference"});
        const cdp = await openBook(page);
        // 往右拆一组（开着长章），把短章拖到那一组的正文中央：卡片拿着，那一组盖着“添加为标签”。
        await page.locator("[data-editor-group-head-active] [data-title-action-key=\"own:split-right\"]").click();
        await expect(page.locator("[data-editor-group-head]")).toHaveCount(2);
        await expect(page.locator("[data-editor-group-active] [data-editor-prose]")).toContainText("长章");
        const body = await page.locator("[data-editor-group-active]").boundingBox();
        if (body === null) throw new Error("没有编辑组");
        await lift(page, page.locator("[data-editor-tab]").filter({hasText: "short.md"}));
        const at = {x: body.x + body.width * 0.5, y: body.y + body.height * 0.5};
        await page.mouse.move(at.x, at.y, {steps: 8});
        await expect(page.locator("[data-lifted]")).toHaveCount(1);
        await settle(page);
        await wiggle(page, at, 1);
        await settle(page);
        const moving = await perFrame(page, cdp, () => wiggle(page, at, 3));
        expect(moving.recalc, JSON.stringify(moving)).toBeLessThanOrEqual(PER_FRAME_LIMIT);
        expect(moving.layout, JSON.stringify(moving)).toBeLessThanOrEqual(0.1);
        await page.keyboard.press("Escape");
        await page.mouse.up();
    });

    test("实时布局，标签条里排序：被拖的标签跟手每帧至多一次样式重算、不布局", async ({page}) => {
        test.setTimeout(120_000);
        await page.emulateMedia({reducedMotion: "no-preference"});
        const cdp = await openBook(page);
        const tab = page.locator("[data-editor-tab]").filter({hasText: "short.md"});
        const box = await tab.boundingBox();
        if (box === null) throw new Error("没有标签");
        const at = {x: box.x + box.width / 2 + 12, y: box.y + box.height / 2};
        await page.mouse.move(box.x + box.width / 2, at.y);
        await page.mouse.down();
        await page.mouse.move(at.x, at.y, {steps: 4});
        await expect(page.locator("html")).toHaveAttribute("data-workbench-dragging", "");
        await expect(page.locator("[data-lifted]")).toHaveCount(0);
        // 量的是排序：标签自己显示出来跟手，没有拖影。
        await expect.poll(() => tab.evaluate((element) => getComputedStyle(element.parentElement as Element).visibility)).toBe("visible");
        await expect(page.locator("[data-workbench-drag-ghost]")).toHaveCount(0);
        await settle(page);
        // 在自己的位置附近横着来回：还在标签条里，插入位不变。
        const sway = async (rounds: number): Promise<void> => {
            for (let round = 0; round < rounds; round += 1) {
                await page.mouse.move(at.x + 5, at.y, {steps: 20});
                await page.mouse.move(at.x - 5, at.y, {steps: 20});
            }
        };
        await sway(1);
        await settle(page);
        const moving = await perFrame(page, cdp, () => sway(3));
        expect(moving.recalc, JSON.stringify(moving)).toBeLessThanOrEqual(PER_FRAME_LIMIT);
        expect(moving.layout, JSON.stringify(moving)).toBeLessThanOrEqual(0.1);
        await page.keyboard.press("Escape");
        await page.mouse.up();
    });

    test("整窗拖动：窗跟手每帧至多一次样式重算、不布局；放下落在指针处", async ({page}) => {
        test.setTimeout(120_000);
        const cdp = await openBook(page);
        // 拖到状态栏上松手开一个窗；减少动效时是落点指示，开窗不用等过渡。
        const status = await page.locator("[data-leaf='statusbar']").boundingBox();
        if (status === null) throw new Error("没有状态栏");
        await lift(page, page.locator("[data-editor-tab]").filter({hasText: "short.md"}));
        await page.mouse.move(status.x + 600, status.y + status.height / 2, {steps: 6});
        await page.mouse.up();
        const windowTab = page.locator("[data-leaf][data-float] [data-editor-tab]");
        await expect(windowTab).toHaveCount(1);
        await page.emulateMedia({reducedMotion: "no-preference"});
        await lift(page, windowTab);
        // 树里编辑组的正中央（1440 宽的缺省布局）：经过中央继续浮着，松手不停靠。
        const at = {x: 700, y: 500};
        await page.mouse.move(at.x, at.y, {steps: 8});
        await settle(page);
        await wiggle(page, at, 1);
        await settle(page);
        const frame = page.locator("[data-leaf][data-float]");
        const start = await frame.boundingBox();
        const moving = await perFrame(page, cdp, () => wiggle(page, at, 3));
        expect(moving.recalc, JSON.stringify(moving)).toBeLessThanOrEqual(PER_FRAME_LIMIT);
        expect(moving.layout, JSON.stringify(moving)).toBeLessThanOrEqual(0.1);
        await page.mouse.move(at.x + 50, at.y, {steps: 4});
        await frames(page, 2);
        const held = await frame.boundingBox();
        if (start === null || held === null) throw new Error("没有窗");
        await page.mouse.up();
        await expect(page.locator("[data-workbench-dragging]")).toHaveCount(0);
        await settle(page);
        const dropped = await frame.boundingBox();
        expect(dropped?.x).toBeCloseTo(held.x, 0);
        expect(dropped?.y).toBeCloseTo(held.y, 0);
    });

    test("落点指示：拖影跟手每帧至多一次样式重算、不布局", async ({page}) => {
        test.setTimeout(120_000);
        const cdp = await openBook(page);
        await lift(page, page.locator("[data-editor-tab]").filter({hasText: "short.md"}));
        const body = await page.locator("[data-editor-group-active]").boundingBox();
        if (body === null) throw new Error("没有编辑组");
        const at = {x: body.x + body.width * 0.5, y: body.y + body.height * 0.5};
        await page.mouse.move(at.x, at.y, {steps: 8});
        await settle(page);
        await wiggle(page, at, 1);
        const moving = await perFrame(page, cdp, () => wiggle(page, at, 3));
        expect(moving.recalc, JSON.stringify(moving)).toBeLessThanOrEqual(PER_FRAME_LIMIT);
        expect(moving.layout, JSON.stringify(moving)).toBeLessThanOrEqual(0.1);
        await page.keyboard.press("Escape");
        await page.mouse.up();
    });
});
