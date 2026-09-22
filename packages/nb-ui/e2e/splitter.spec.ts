import type {Page} from "@playwright/test";
import { test, expect } from "./fixtures";

/**
 * Splitter 用户手势的真实浏览器验收：单元测试环境没有布局引擎，指针拖拽只能在这里覆盖。
 * 断言面是用户可观察合同：拖动后真的变宽的栏、页面上「用户调整」那行提交记录、事件日志的次数与载荷。
 * 几何一律 CSS px：面板宽度 + separator 宽度 = 容器宽度，没有百分比往返。
 */

async function gotoSplitter(page: Page, theme = "nbook", colorway = "nbook-light"): Promise<void> {
    const query = new URLSearchParams({
        component: "splitter",
        scene: "default",
        viewport: "responsive",
        theme,
        colorway,
    });
    await page.goto(`/lab?${query.toString()}`);
    await expect(page.locator("#nb-lab-target")).toBeVisible();
}

async function showEventLog(page: Page): Promise<void> {
    await page.locator("[aria-label=\"检查器页签\"]").getByText("事件").click();
    await expect(page.locator(".lab-events__header")).toBeVisible();
}

async function eventNames(page: Page): Promise<string[]> {
    return page.locator(".lab-events__row .lab-events__name").allTextContents();
}

const PANEL_SELECTOR = "#nb-lab-target [data-splitter] [data-panel-id]";
const SASH_SELECTOR = "#nb-lab-target [data-sash]";

async function panelWidths(page: Page): Promise<number[]> {
    return page.locator(PANEL_SELECTOR).evaluateAll((items) => items.map((item) => item.getBoundingClientRect().width));
}

async function sashWidths(page: Page): Promise<number[]> {
    return page.locator(SASH_SELECTOR).evaluateAll((items) => items.map((item) => item.getBoundingClientRect().width));
}

async function selectBooleanControl(page: Page, label: string): Promise<void> {
    await page.getByText(label, {exact: true}).click();
}

test("指针拖动 sash 只提交一次，并给出主动与补偿划分", async ({ page }) => {
    await gotoSplitter(page);
    const sash = page.locator(SASH_SELECTOR);
    await expect(sash).toHaveCount(2);
    await expect(sash.first()).toHaveAttribute("data-sash", "panels:0");
    await expect(sash.first()).toHaveCSS("width", "7px");
    await expect(sash.nth(1)).toHaveCSS("width", "1px");
    await expect(page.locator(PANEL_SELECTOR)).toHaveCount(3);

    const before = await panelWidths(page);
    const box = await sash.first().boundingBox();
    expect(box, "sash 必须有真实几何，否则这条用例不成立").not.toBeNull();
    const startX = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 60, y, {steps: 6});
    await page.mouse.up();

    const gesture = page.locator("[data-lab-gesture]");
    await expect(gesture).toHaveAttribute("data-lab-gesture-state", "commit");
    await expect(gesture).toContainText("提交 · pointer · outline~editor");
    await expect(gesture).toContainText("主动 [outline, editor]");

    // 提交的 px 必须与真实几何一致：左栏变宽，面板 + separator 之和等于组件自己的盒宽
    const after = await panelWidths(page);
    expect(after[0]!).toBeGreaterThan(before[0]!);
    const rootWidth = (await page.locator("#nb-lab-target [data-splitter]").boundingBox())!.width;
    const sashTotal = (await sashWidths(page)).reduce((sum, width) => sum + width, 0);
    expect(after.reduce((sum, width) => sum + width, 0) + sashTotal).toBeCloseTo(rootWidth, 0);

    await showEventLog(page);
    const names = await eventNames(page);
    expect(names.filter((name) => name === "gesture-start")).toHaveLength(1);
    expect(names.filter((name) => name === "gesture-end")).toHaveLength(1);
    expect(names.filter((name) => name === "gesture-cancel")).toHaveLength(0);
    expect(names.filter((name) => name === "gesture-update").length).toBeGreaterThan(0);

    const payloadText = await gesture.getAttribute("data-lab-gesture-payload");
    expect(payloadText).not.toBeNull();
    const payload = JSON.parse(payloadText!);
    expect(payload.source).toBe("pointer");
    expect(payload.active).toEqual(["outline", "editor"]);
    expect(payload.sizesPx[0]).toBeGreaterThan(before[0]!);
    // 提交的 px 与渲染宽度同源
    expect(payload.sizesPx[0]).toBeCloseTo(after[0]!, 0);
    expect(payload.sizesPx[1]).toBeCloseTo(after[1]!, 0);
    expect(payload.sizesPx[2]).toBeCloseTo(after[2]!, 0);
});

test("点击 sash 不移动时不产生保存意图", async ({ page }) => {
    await gotoSplitter(page);
    const before = await panelWidths(page);
    const box = await page.locator(SASH_SELECTOR).first().boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    // 按下未移动：只发一条 no-change 取消回执，没有 gesture-end，也没有任何尺寸变化
    const gesture = page.locator("[data-lab-gesture]");
    await expect(gesture).toHaveAttribute("data-lab-gesture-state", "cancel");
    await expect(gesture).toContainText("未提交 · no-change · outline~editor");
    expect(await panelWidths(page)).toEqual(before);

    await showEventLog(page);
    const names = await eventNames(page);
    expect(names.filter((name) => name === "gesture-end")).toHaveLength(0);
    expect(names.filter((name) => name === "gesture-cancel")).toHaveLength(1);
});

test("键盘调整一次按键提交一次，普通导航键只移动焦点", async ({ page }) => {
    await gotoSplitter(page);
    const sash = page.locator(SASH_SELECTOR);
    await sash.first().focus();
    await expect(sash.first()).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(sash.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowRight");

    const gesture = page.locator("[data-lab-gesture]");
    await expect(gesture).toHaveAttribute("data-lab-gesture-state", "commit");
    await expect(gesture).toContainText("提交 · keyboard · editor~inspector");

    // 面板 px 与提交载荷同源：键盘一次 ArrowRight 的位移直接体现在渲染宽度上
    const after = await panelWidths(page);
    const payload = JSON.parse((await gesture.getAttribute("data-lab-gesture-payload"))!);
    expect(payload.sizesPx[1]).toBeCloseTo(after[1]!, 0);
    expect(payload.sizesPx[2]).toBeCloseTo(after[2]!, 0);

    await showEventLog(page);
    const names = await eventNames(page);
    // 一次 keydown + keyup 只算一次手势；Tab 移动焦点不算
    expect(names.filter((name) => name === "gesture-start")).toHaveLength(1);
    expect(names.filter((name) => name === "gesture-end")).toHaveLength(1);
});

test("Enter repeat 与多键序列只提交一次，DOM 与手势载荷一致", async ({page}) => {
    await gotoSplitter(page);
    const sash = page.locator(SASH_SELECTOR).first();
    await sash.focus();

    await page.keyboard.down("Enter");
    await page.keyboard.down("Enter");
    await page.keyboard.down("ArrowRight");
    await page.keyboard.up("ArrowRight");
    await page.keyboard.up("Enter");

    const gesture = page.locator("[data-lab-gesture]");
    await expect(gesture).toHaveAttribute("data-lab-gesture-state", "commit");
    const payload = JSON.parse((await gesture.getAttribute("data-lab-gesture-payload"))!);
    // Enter 折叠前侧面板：收起尺寸来自收起策略，不是普通最小宽度
    expect(payload.sizesPx[0]).toBe(0);
    expect(payload.collapsed).toEqual({outline: true});

    const domWidths = await panelWidths(page);
    expect(domWidths[0]!).toBeCloseTo(payload.sizesPx[0], 0);
    expect(domWidths[1]!).toBeCloseTo(payload.sizesPx[1], 0);
    expect(domWidths[2]!).toBeCloseTo(payload.sizesPx[2], 0);
    // 收起位由宿主按提交回发布：面板与分隔线都进入收起呈现
    await expect(page.locator(PANEL_SELECTOR).first()).toHaveAttribute("data-state", "collapsed");
    await expect(sash).toHaveAttribute("aria-valuetext", "已收起");

    await showEventLog(page);
    const names = await eventNames(page);
    expect(names.filter((name) => name === "gesture-start")).toHaveLength(1);
    expect(names.filter((name) => name === "gesture-end")).toHaveLength(1);
});

test("禁用与零宽 sash 截断 Enter，零宽边界不吞面板点击", async ({page}) => {
    await gotoSplitter(page);
    await selectBooleanControl(page, "禁用");
    const firstSash = page.locator(SASH_SELECTOR).first();
    const disabledBefore = await panelWidths(page);
    await firstSash.dispatchEvent("keydown", {key: "Enter", bubbles: true, cancelable: true});
    expect(await panelWidths(page)).toEqual(disabledBefore);

    await selectBooleanControl(page, "第二条分隔条零宽");
    const zeroSash = page.locator(SASH_SELECTOR).nth(1);
    await expect(zeroSash).toHaveCSS("width", "0px");
    await expect(zeroSash).toHaveAttribute("data-disabled", "true");
    const box = await zeroSash.boundingBox();
    expect(box).not.toBeNull();
    const hit = await page.evaluate(({x, y}) => {
        const element = document.elementFromPoint(x, y);
        return element?.closest("[data-sash]")?.getAttribute("data-sash") ?? null;
    }, {x: box!.x, y: box!.y + box!.height / 2});
    expect(hit).toBeNull();

    const zeroBefore = await panelWidths(page);
    await zeroSash.dispatchEvent("keydown", {key: "Enter", bubbles: true, cancelable: true});
    expect(await panelWidths(page)).toEqual(zeroBefore);
});

test("390×844 窄屏下 target 受容器约束且仍可拖拽", async ({ page }) => {
    await page.setViewportSize({width: 390, height: 844});
    await gotoSplitter(page);
    const target = page.locator("#nb-lab-target");
    const canvasScroll = page.locator(".lab-canvas-scroll");
    const targetBox = await target.boundingBox();
    const canvasBox = await canvasScroll.boundingBox();
    expect(targetBox, "被测 target 必须有真实几何").not.toBeNull();
    expect(canvasBox, "responsive 画布必须有真实几何").not.toBeNull();
    expect(targetBox!.width).toBeLessThanOrEqual(canvasBox!.width);
    expect(targetBox!.width).toBeLessThan(390);

    const sash = page.locator(SASH_SELECTOR).first();
    await sash.scrollIntoViewIfNeeded();
    await expect(sash).toBeVisible();
    const box = await sash.boundingBox();
    expect(box, "窄屏 sash 必须位于可交互区域").not.toBeNull();
    const startX = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 24, y, {steps: 4});
    await page.mouse.up();

    await expect(page.locator("[data-lab-gesture]")).toHaveAttribute("data-lab-gesture-state", "commit");
    const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});

for (const combination of [
    {theme: "nbook", colorway: "nbook-light"},
    {theme: "nbook", colorway: "nbook-dark"},
    {theme: "macos", colorway: "macos-light"},
    {theme: "macos", colorway: "macos-dark"},
]) {
    for (const viewport of [
        {name: "desktop", width: 1280, height: 720},
        {name: "390×844", width: 390, height: 844},
    ]) {
        test(`主题组合 ${combination.theme}/${combination.colorway} 在 ${viewport.name} 保持真实几何与键盘调整`, async ({page}) => {
            await page.setViewportSize({width: viewport.width, height: viewport.height});
            await gotoSplitter(page, combination.theme, combination.colorway);
            const target = page.locator("#nb-lab-target");
            const sash = page.locator(SASH_SELECTOR).first();
            await expect(target).toBeVisible();
            await expect(sash).toBeVisible();
            expect((await target.boundingBox())?.width).toBeGreaterThan(0);
            await sash.focus();
            await page.keyboard.press("ArrowRight");
            await expect(page.locator("[data-lab-gesture]")).toHaveAttribute("data-lab-gesture-state", "commit");
        });
    }
}
