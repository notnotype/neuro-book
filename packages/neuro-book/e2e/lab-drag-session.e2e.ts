/**
 * 拖动会话在真实浏览器里的时序（docs/specs/ui/layout-drag.md）：指针捕获、触摸、焦点、边缘滚动中松手，这些在 happy-dom 里
 * 根本不发生。场景夹具是 `fixtures/nb-layout/DragSessionScene.vue`，不依赖外壳、编辑器或资源树；断言面是它写的日志与
 * `data-session-*` 属性。
 *
 * 无头 Chrome 没有真实的窗口失焦与页面隐藏，这两种由派发事件验证。
 */

import {rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Browser, Locator, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {LabDebugState} from "nbook/plugins/lab/shared/debug-api";

import {startDevSession} from "./fixtures";
import type {DevSession} from "./fixtures";

let tmp = "";
let dev: DevSession;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-drag-session");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const labState = (page: Page) => page.evaluate(() => (window as unknown as {__nbLab?: {state(): LabDebugState}}).__nbLab?.state() ?? null);

async function open(page: Page): Promise<void> {
    await page.setViewportSize({width: 1440, height: 1000});
    await page.goto(`${dev.pageUrl}lab?c=DropFeedbackOverlay&s=session&theme=nbook&cw=light`);
    await expect.poll(async () => (await labState(page))?.ready).toBe(true);
    await expect(page.locator("[data-session-root]")).toBeVisible();
}

async function log(page: Page): Promise<string[]> {
    const text = await page.locator("[data-session-log]").textContent();
    return (text ?? "").split("\n").filter((line) => line !== "");
}

async function center(locator: Locator): Promise<{x: number; y: number}> {
    const box = await locator.boundingBox();
    if (box === null) throw new Error("元素没有矩形");
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

const sessionRoot = (page: Page) => page.locator("[data-session-root]");
const sourceA = (page: Page) => page.locator("[data-source='a']");
const target = (page: Page, name: string) => page.locator(`[data-target='${name}']`);
const row = (page: Page, id: string) => page.locator(`[data-row='${id}']`);

/** 拿起来源 A，指针停在 `to` 上，等这一帧发布。 */
async function grabTo(page: Page, from: Locator, to: Locator, over: string): Promise<void> {
    const start = await center(from);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const end = await center(to);
    await page.mouse.move(end.x, end.y, {steps: 4});
    await expect(sessionRoot(page)).toHaveAttribute("data-session-over", over);
}

test.describe("指针拖动", () => {
    test("没过门槛的按下照常是点击；过了门槛放到落点提交一次，末尾的 click 被吞", async ({page}) => {
        await open(page);
        await sourceA(page).click();
        expect(await log(page)).toEqual(["click:a"]);

        await grabTo(page, sourceA(page), target(page, "first"), "first");
        await expect(sessionRoot(page)).toHaveAttribute("data-session-state", "pointer");
        await page.mouse.up();
        await expect(sessionRoot(page)).toHaveAttribute("data-session-state", "idle");
        expect(await log(page)).toEqual(["click:a", "end:committed", "commit:a->first"]);
    });

    test("松手在来源自己身上：只显示的落点不提交，也不算点击", async ({page}) => {
        await open(page);
        const start = await center(sourceA(page));
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x + 12, start.y, {steps: 3});
        await expect(sessionRoot(page)).toHaveAttribute("data-session-state", "pointer");
        await page.mouse.up();
        await expect(sessionRoot(page)).toHaveAttribute("data-session-state", "idle");
        expect(await log(page)).toEqual(["end:no-action"]);
    });

    test("反馈元素压在指针下也不挡命中（输出 5）", async ({page}) => {
        await open(page);
        await grabTo(page, sourceA(page), target(page, "second"), "second");
        const at = await center(target(page, "second"));
        const covered = await page.evaluate(({x, y}) => document.elementFromPoint(x, y)?.hasAttribute("data-session-ghost") ?? false, at);
        expect(covered).toBe(true);
        await page.mouse.up();
        expect(await log(page)).toContain("commit:a->second");
    });

    test("菜单挡住落点时不接收（输出 5、16）", async ({page}) => {
        await open(page);
        const box = await target(page, "first").boundingBox();
        await page.evaluate((rect) => {
            const menu = document.createElement("div");
            menu.dataset.testMenu = "";
            menu.style.cssText = `position:fixed;left:${rect?.x}px;top:${rect?.y}px;width:${rect?.width}px;height:${rect?.height}px;background:gray;z-index:99999`;
            document.body.append(menu);
        }, box);
        await grabTo(page, sourceA(page), target(page, "second"), "second");
        const at = await center(page.locator("[data-test-menu]"));
        await page.mouse.move(at.x, at.y, {steps: 2});
        await expect(sessionRoot(page)).toHaveAttribute("data-session-over", "none");
        await page.mouse.up();
        expect(await log(page)).toEqual(["end:no-action"]);
    });

    test("松手在窗口外：没有落点，不提交", async ({page}) => {
        await open(page);
        await grabTo(page, sourceA(page), target(page, "first"), "first");
        await page.mouse.move(-40, 300, {steps: 3});
        await expect(sessionRoot(page)).toHaveAttribute("data-session-over", "none");
        await page.mouse.up();
        await expect(sessionRoot(page)).toHaveAttribute("data-session-state", "idle");
        expect(await log(page)).toEqual(["end:no-action"]);
    });

    test("待起拖时松手事件丢了：没有按键的移动不起拖（输出 1）", async ({page}) => {
        await open(page);
        const start = await center(sourceA(page));
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Input.dispatchMouseEvent", {type: "mouseMoved", x: start.x, y: start.y});
        await cdp.send("Input.dispatchMouseEvent", {type: "mousePressed", x: start.x, y: start.y, button: "left", buttons: 1, clickCount: 1});
        await cdp.send("Input.dispatchMouseEvent", {type: "mouseMoved", x: start.x + 30, y: start.y, buttons: 0});
        await cdp.send("Input.dispatchMouseEvent", {type: "mouseMoved", x: start.x + 60, y: start.y, buttons: 0});
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await expect(sessionRoot(page)).toHaveAttribute("data-session-state", "idle");
        expect(await log(page)).toEqual([]);
    });
});

test.describe("取消（输出 7）", () => {
    const CASES: ReadonlyArray<{readonly name: string; readonly reason: string; readonly act: (page: Page) => Promise<unknown>}> = [
        {name: "Escape", reason: "escape", act: (page) => page.keyboard.press("Escape")},
        // 浏览器在下一个指针事件时才派发 `lostpointercapture`，所以释放之后要动一下。
        {name: "失去指针捕获", reason: "capture-lost", act: async (page) => {
            await sessionRoot(page).evaluate((root) => root.releasePointerCapture(1));
            const start = await center(sourceA(page));
            await page.mouse.move(start.x + 11, start.y);
        }},
        {name: "焦点移到根之外", reason: "focus-left", act: (page) => page.locator("[data-session-outside]").evaluate((input: HTMLInputElement) => input.focus())},
        {name: "窗口失焦", reason: "blur", act: (page) => page.evaluate(() => window.dispatchEvent(new FocusEvent("blur")))},
        {name: "页面隐藏", reason: "hidden", act: (page) => page.evaluate(() => {
            Object.defineProperty(document, "visibilityState", {configurable: true, get: () => "hidden"});
            document.dispatchEvent(new Event("visibilitychange"));
        })},
    ];

    for (const {name, reason, act} of CASES) {
        test(`${name}：不写，反馈撤下，松手时的 click 不到来源`, async ({page}) => {
            await open(page);
            const start = await center(sourceA(page));
            await page.mouse.move(start.x, start.y);
            await page.mouse.down();
            await page.mouse.move(start.x + 10, start.y, {steps: 2});
            await expect(sessionRoot(page)).toHaveAttribute("data-session-state", "pointer");
            await act(page);
            await expect(sessionRoot(page)).toHaveAttribute("data-session-state", "idle");
            await expect(page.locator("[data-session-ghost]")).toHaveCount(0);
            await page.mouse.move(start.x, start.y);
            await page.mouse.up();
            expect(await log(page)).toEqual([`end:cancelled:${reason}`]);
        });
    }

    test("拖动中方向键内层收不到，别的键照常（输出 10）", async ({page}) => {
        await open(page);
        const start = await center(sourceA(page));
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await sourceA(page).focus();
        await page.mouse.move(start.x + 10, start.y, {steps: 2});
        await expect(sessionRoot(page)).toHaveAttribute("data-session-state", "pointer");
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("a");
        await expect.poll(() => log(page)).toContain("key:a");
        expect(await log(page)).not.toContain("key:ArrowRight");
        await page.keyboard.press("Escape");
        await page.mouse.up();
    });
});

test.describe("触摸（验收 5）", () => {
    async function touchPage(browser: Browser): Promise<Page> {
        const context = await browser.newContext({hasTouch: true, viewport: {width: 1440, height: 1000}});
        const page = await context.newPage();
        await page.goto(`${dev.pageUrl}lab?c=DropFeedbackOverlay&s=session&theme=nbook&cw=light`);
        await expect.poll(async () => (await labState(page))?.ready).toBe(true);
        await expect(sessionRoot(page)).toBeVisible();
        return page;
    }

    /** 按下后带 1 px 抖动（真实手指几乎必有），按住到起拖，再拖到落点松开。抖动让捕获换手发生在拖动中的第一个事件上。 */
    async function holdAndDrag(page: Page, from: Locator, to: Locator, over: string): Promise<void> {
        const cdp = await page.context().newCDPSession(page);
        const start = await center(from);
        await cdp.send("Input.dispatchTouchEvent", {type: "touchStart", touchPoints: [{x: start.x, y: start.y}]});
        await cdp.send("Input.dispatchTouchEvent", {type: "touchMove", touchPoints: [{x: start.x + 1, y: start.y}]});
        await expect(sessionRoot(page)).toHaveAttribute("data-session-state", "pointer");
        const end = await center(to);
        for (const ratio of [0.25, 0.5, 0.75, 1]) {
            await cdp.send("Input.dispatchTouchEvent", {type: "touchMove", touchPoints: [{x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio}]});
        }
        await expect(sessionRoot(page)).toHaveAttribute("data-session-over", over);
        await cdp.send("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []});
        await expect(sessionRoot(page)).toHaveAttribute("data-session-state", "idle");
    }

    test("来源是按钮：抖动后按住再拖，不被隐式捕获的换手取消", async ({browser}) => {
        const page = await touchPage(browser);
        await holdAndDrag(page, sourceA(page), target(page, "first"), "first");
        expect(await log(page)).toEqual(["end:committed", "commit:a->first"]);
        await page.context().close();
    });

    test("来源在可滚动的区域里：拿起后拖动不让给滚动", async ({browser}) => {
        const page = await touchPage(browser);
        await holdAndDrag(page, row(page, "r2"), target(page, "second"), "second");
        expect(await log(page)).toEqual(["end:committed", "commit:r2->second"]);
        await page.context().close();
    });
});

test.describe("滚动", () => {
    const scroller = (page: Page) => page.locator("[data-session-scroller]");

    test("边缘滚动中松手：放下生效，落到松手时指针下的行（验收 6）", async ({page}) => {
        await open(page);
        await grabTo(page, row(page, "r1"), row(page, "r3"), "r3");
        const box = await scroller(page).boundingBox();
        if (box === null) throw new Error("滚动区没有矩形");
        const at = {x: box.x + box.width / 2, y: box.y + box.height - 4};
        await page.mouse.move(at.x, at.y, {steps: 2});
        await expect.poll(() => scroller(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(40);
        await page.mouse.up();
        await expect(sessionRoot(page)).toHaveAttribute("data-session-state", "idle");
        const lines = await log(page);
        expect(lines[0]).toBe("end:committed");
        const under = await page.evaluate(({x, y}) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-row]")?.dataset.row ?? null, at);
        expect(lines[1]).toBe(`commit:r1->${under}`);
    });

    test("用户自己滚动：撤下落点，这期间放下不写；指针再动恢复（输出 12）", async ({page}) => {
        await open(page);
        await grabTo(page, row(page, "r1"), row(page, "r4"), "r4");
        await scroller(page).evaluate((element) => {
            element.scrollTop = 120;
        });
        await expect(sessionRoot(page)).toHaveAttribute("data-session-over", "none");
        await page.mouse.up();
        await expect(sessionRoot(page)).toHaveAttribute("data-session-state", "idle");
        expect(await log(page)).toEqual(["end:no-action"]);
    });
});

test.describe("键盘拖动（输出 15）", () => {
    async function pick(page: Page): Promise<void> {
        await sourceA(page).focus();
        await page.keyboard.press("Space");
        await expect(sessionRoot(page)).toHaveAttribute("data-session-state", "keyboard");
    }

    test("空格拿起直接 Enter 不移动；空格的抬起不激活按钮；焦点回到来源", async ({page}) => {
        await open(page);
        await pick(page);
        await expect(sessionRoot(page)).toHaveAttribute("data-session-over", "none");
        await page.keyboard.press("Enter");
        await expect(sessionRoot(page)).toHaveAttribute("data-session-state", "idle");
        await expect(sourceA(page)).toBeFocused();
        expect(await log(page)).toEqual(["end:no-action"]);
    });

    test("Tab 换区域、方向键沿轴移动、Enter 提交，焦点在下一帧回到来源", async ({page}) => {
        await open(page);
        await pick(page);
        await page.keyboard.press("Tab");
        await expect(sessionRoot(page)).toHaveAttribute("data-session-over", "second");
        await page.keyboard.press("Tab");
        await expect(sessionRoot(page)).toHaveAttribute("data-session-over", "first");
        await page.keyboard.press("Shift+Tab");
        await expect(sessionRoot(page)).toHaveAttribute("data-session-over", "second");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
        await expect(sessionRoot(page)).toHaveAttribute("data-session-state", "idle");
        await expect(sourceA(page)).toBeFocused();
        // 修饰键不归会话，来源收得到。
        expect((await log(page)).filter((line) => line !== "key:Shift")).toEqual(["end:committed", "commit:a->second"]);
    });

    test("Escape 取消；焦点移到根之外的取消不还焦点", async ({page}) => {
        await open(page);
        await pick(page);
        await page.keyboard.press("Escape");
        await expect(sourceA(page)).toBeFocused();
        expect(await log(page)).toEqual(["end:cancelled:escape"]);

        await pick(page);
        const outside = page.locator("[data-session-outside]");
        await outside.focus();
        await expect(sessionRoot(page)).toHaveAttribute("data-session-state", "idle");
        await expect(outside).toBeFocused();
    });

    test("键盘拖动中按下指针：取消", async ({page}) => {
        await open(page);
        await pick(page);
        const at = await center(target(page, "first"));
        await page.mouse.move(at.x, at.y);
        await page.mouse.down();
        await expect(sessionRoot(page)).toHaveAttribute("data-session-state", "idle");
        await page.mouse.up();
        expect(await log(page)).toEqual(["end:cancelled:pressed-elsewhere"]);
    });
});
