/**
 * 一棵树的工作台表面（docs/specs/ui/workbench-layout.md 的“渲染”“面板头与活动栏”）：夹具是 `lab/web/fixtures/WorkbenchSurfaceFixture.vue`，文档、呈现树、有效可见、活动栏条目都用产品的纯函数算。
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
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-workbench-surface");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const labState = (page: Page) => page.evaluate(() => (window as unknown as {__nbLab?: {state(): LabDebugState}}).__nbLab?.state() ?? null);

async function open(page: Page, scene = "default"): Promise<void> {
    await page.setViewportSize({width: 1440, height: 800});
    await page.goto(`${dev.pageUrl}lab?c=WorkbenchSurface&s=${scene}&theme=nbook&cw=light&vp=1400x720`);
    await expect.poll(async () => (await labState(page))?.ready).toBe(true);
    await expect(page.locator("[data-content='view:a']")).toBeVisible();
}

const act = (page: Page, name: string) => page.locator(`[data-surface-action="${name}"]`).click();
const fixture = (page: Page) => page.locator(".workbench-surface-fixture");
const visibleTabs = async (page: Page) => ((await fixture(page).getAttribute("data-visible-tabs")) ?? "").split(" ").filter((tab) => tab !== "");
const entry = (page: Page, id: string) => page.locator(`[data-tool-entry="${id}"]`);
const frameButton = (page: Page, panel: string, action: string) => page.locator(`[data-panel-head="${panel}"] [data-panel-action="${action}"]`);

const rectOf = (page: Page, selector: string) => page.evaluate((target) => {
    const {x, y, width, height} = document.querySelector(target)!.getBoundingClientRect();
    return {x, y, width, height};
}, selector);

test.describe("面板头", () => {
    test("32px 一行，顺序是标签带、视图动作、框架按钮；无名面板没有隐藏按钮", async ({page}) => {
        await open(page);
        expect((await rectOf(page, "[data-panel-head='sidebar']")).height).toBe(32);
        const order = await page.locator("[data-panel-head='sidebar'] > *").evaluateAll((items) => items.map((item) => (item.querySelector("[role='tablist']") !== null ? "tabs" : item.querySelector("[data-view-action]") !== null ? "view" : item.querySelector("[data-panel-action]") !== null ? "frame" : "?")));
        expect(order).toEqual(["tabs", "view", "frame"]);
        await expect(page.locator("[data-panel-head='sidebar'] [data-panel-action]")).toHaveCount(3);

        await act(page, "c-to-new-panel");
        const anonymous = page.locator("[data-panel-head]:has([data-panel-tab='view:c'])");
        await expect(anonymous.locator("[data-panel-action]")).toHaveCount(2);
        await expect(anonymous.locator("[data-panel-action='hide']")).toHaveCount(0);
    });

    test("标签和内容互相引用；点标签换内容，实例不重建；右键发给宿主", async ({page}) => {
        await open(page);
        const tab = page.locator("[data-panel-tab='view:b']");
        const panelId = await tab.getAttribute("aria-controls");
        expect(await page.locator(`[id="${panelId}"]`).getAttribute("aria-labelledby")).toBe(await tab.getAttribute("id"));

        const instance = await page.locator("[data-content='view:a'] [data-structure-leaf]").getAttribute("data-structure-instance");
        await tab.click();
        await expect(page.locator("[data-content='view:b']")).toBeVisible();
        await expect(page.locator("[data-content='view:a']")).toBeHidden();
        await page.locator("[data-panel-tab='view:a']").click();
        await expect(page.locator("[data-content='view:a']")).toBeVisible();
        expect(await page.locator("[data-content='view:a'] [data-structure-leaf]").getAttribute("data-structure-instance")).toBe(instance);

        await tab.click({button: "right"});
        await expect(fixture(page)).toHaveAttribute("data-last-menu", "view:b");
    });

    test("菜单键打开标签的菜单", async ({page}) => {
        await open(page);
        await page.locator("[data-panel-tab='view:a']").focus();
        await page.keyboard.press("ContextMenu");
        await expect(fixture(page)).toHaveAttribute("data-last-menu", "view:a");
    });

    test("视图动作随鼠标显示，范围是整块面板：外框和内容都算，别的面板不算", async ({page}) => {
        await open(page);
        const action = page.locator("[data-panel-head='sidebar'] [data-hover-actions]");
        const opacity = () => action.evaluate((element) => getComputedStyle(element).opacity);

        await page.locator("[data-content='view:c']").hover();
        await expect.poll(opacity).toBe("0");

        await page.locator("[data-content='view:a']").hover();
        await expect.poll(opacity).toBe("1");

        await page.locator("[data-panel-head='sidebar']").hover();
        await expect.poll(opacity).toBe("1");

        await page.locator("[data-content='view:c']").hover();
        await expect.poll(opacity).toBe("0");

        // 焦点在内容里时，指针走开也还显示。
        await page.locator("[data-content='view:a'] [data-structure-first]").focus();
        await expect.poll(opacity).toBe("1");
    });
});

test.describe("内容跟着视图走", () => {
    test("视图 A 并进右栏：实例不重建，内容在右栏的矩形里，侧栏活动标签换成 B", async ({page}) => {
        await open(page);
        const instance = await page.locator("[data-content='view:a'] [data-structure-leaf]").getAttribute("data-structure-instance");
        await page.locator("[data-content='view:a'] [data-structure-input]").fill("写到一半");

        await act(page, "a-to-right");
        await expect(page.locator("[data-panel-head='auxiliarybar'] [data-panel-tab='view:a']")).toBeVisible();
        await page.locator("[data-panel-tab='view:a']").click();
        await expect(page.locator("[data-content='view:a']")).toHaveAttribute("data-content-leaf", "auxiliarybar");
        expect(await page.locator("[data-content='view:a'] [data-structure-leaf]").getAttribute("data-structure-instance")).toBe(instance);
        await expect(page.locator("[data-content='view:a'] [data-structure-input]")).toHaveValue("写到一半");

        const aux = await rectOf(page, "[data-leaf='auxiliarybar']");
        const moved = await rectOf(page, "[data-content='view:a']");
        expect(moved.x).toBe(aux.x);
        expect(moved.y).toBe(aux.y + 32);
        await expect(page.locator("[data-panel-tab='view:a'][aria-selected='true']")).toBeVisible();
        await expect(page.locator("[data-panel-head='sidebar'] [data-panel-tab='view:b'][aria-selected='true']")).toBeVisible();
    });
});

test.describe("有效可见", () => {
    test("只有活动标签；收起、隐藏、被最大化盖住都不算，再回来", async ({page}) => {
        await open(page);
        expect(await visibleTabs(page)).toEqual(expect.arrayContaining(["view:a", "view:c", "view:e"]));
        expect(await visibleTabs(page)).not.toContain("view:b");

        await frameButton(page, "panel", "collapse").click();
        await expect.poll(() => visibleTabs(page)).not.toContain("view:e");
        expect((await rectOf(page, "[data-leaf='panel']")).height).toBe(32);
        await frameButton(page, "panel", "collapse").click();
        await expect.poll(() => visibleTabs(page)).toContain("view:e");

        await frameButton(page, "sidebar", "hide").click();
        await expect.poll(() => visibleTabs(page)).not.toContain("view:a");
        await expect(page.locator("[data-leaf='sidebar']")).toHaveCount(0);

        await frameButton(page, "auxiliarybar", "maximize").click();
        await expect.poll(() => visibleTabs(page)).toEqual(["view:c"]);
        await frameButton(page, "auxiliarybar", "maximize").click();
        await expect.poll(() => visibleTabs(page)).toEqual(expect.arrayContaining(["view:c", "view:e"]));
    });

    test("从零拉回：按着拖的过程中内容就可见，按回零又不可见；往零拖过阈值时先不算不可见，松手才算", async ({page}) => {
        await open(page);
        const sidebar = await rectOf(page, "[data-leaf='sidebar']");
        const sashX = sidebar.x + sidebar.width;
        const y = sidebar.y + 200;

        // 往零拖，过了阈值还按着：视图仍算可见。
        await page.mouse.move(sashX, y);
        await page.mouse.down();
        await page.mouse.move(sidebar.x + 5, y, {steps: 8});
        expect(await visibleTabs(page)).toContain("view:a");
        await page.mouse.up();
        await expect.poll(() => visibleTabs(page)).not.toContain("view:a");
        expect((await rectOf(page, "[data-leaf='sidebar']")).width).toBe(0);

        // 拉回来：还按着就可见，文档还没写，所以条目也跟着按下。
        const zero = await rectOf(page, "[data-leaf='sidebar']");
        await page.mouse.move(zero.x, y);
        await page.mouse.down();
        await page.mouse.move(zero.x + 240, y, {steps: 8});
        await expect.poll(() => visibleTabs(page)).toContain("view:a");
        await expect(entry(page, "a")).toHaveAttribute("aria-pressed", "true");
        await page.mouse.move(zero.x, y, {steps: 8});
        await expect.poll(() => visibleTabs(page)).not.toContain("view:a");
        await page.mouse.move(zero.x + 240, y, {steps: 8});
        await page.mouse.up();
        await expect.poll(() => visibleTabs(page)).toContain("view:a");
        expect((await rectOf(page, "[data-leaf='sidebar']")).width).toBeGreaterThan(200);
    });
});

test.describe("活动栏", () => {
    test("列全部工具视图，不管停在哪；几个同时按下，切走的不按下", async ({page}) => {
        await open(page);
        await expect(page.locator("[data-tool-entry]")).toHaveCount(5);
        await expect(entry(page, "a")).toHaveAttribute("aria-pressed", "true");
        await expect(entry(page, "b")).toHaveAttribute("aria-pressed", "false");
        await expect(entry(page, "c")).toHaveAttribute("aria-pressed", "true");
        await act(page, "a-to-right");
        await expect(page.locator("[data-tool-entry]")).toHaveCount(5);
    });

    test("不可见：显示并激活，焦点给它；可见没焦点：聚焦；已聚焦：隐藏具名面板", async ({page}) => {
        await open(page);
        await entry(page, "b").click();
        await expect(entry(page, "b")).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("[data-content='view:b'] [data-structure-first]")).toBeFocused();

        await page.locator("[data-content='view:c'] [data-structure-first]").focus();
        await entry(page, "b").click();
        await expect(page.locator("[data-content='view:b'] [data-structure-first]")).toBeFocused();
        await expect(page.locator("[data-leaf='sidebar']")).toHaveCount(1);

        await entry(page, "b").click();
        await expect(page.locator("[data-leaf='sidebar']")).toHaveCount(0);
        await expect(entry(page, "b")).toHaveAttribute("aria-pressed", "false");

        await entry(page, "b").click();
        await expect(page.locator("[data-leaf='sidebar']")).toHaveCount(1);
    });

    test("无名面板已聚焦时是收起", async ({page}) => {
        await open(page);
        await act(page, "d-below-b");
        await page.locator("[data-content='view:d'] [data-structure-first]").focus();
        await entry(page, "d").click();
        await expect(entry(page, "d")).toHaveAttribute("aria-pressed", "false");
        const head = page.locator("[data-panel-head]:has([data-panel-tab='view:d'])");
        await expect(head).toBeVisible();
    });
});

test.describe("卡片按邻接算", () => {
    const paddingOf = (page: Page, panel: string) => page.locator(`[data-leaf='${panel}'] > .nb-grid-leaf > *`).evaluate((element) => {
        const style = getComputedStyle(element);
        return {top: Number.parseFloat(style.paddingTop), right: Number.parseFloat(style.paddingRight), bottom: Number.parseFloat(style.paddingBottom), left: Number.parseFloat(style.paddingLeft)};
    });

    test("贴窗体整缝，相邻半缝，活动栏与侧栏相连；内容和外框拼成一张卡片", async ({page}) => {
        await open(page, "cards");
        const bar = await paddingOf(page, "activitybar");
        expect(bar.left).toBe(8);
        expect(bar.right).toBe(0);
        const sidebar = await paddingOf(page, "sidebar");
        expect(sidebar.left).toBe(0);
        expect(sidebar.top).toBe(8);
        expect(sidebar.right).toBeLessThan(4);
        await expect(page.locator("[data-surface-card='activitybar']")).toHaveAttribute("data-surface-join", "start");
        await expect(page.locator("[data-surface-card='sidebar']")).toHaveAttribute("data-surface-join", "end");

        // 活动栏的卡片宽不变，叶宽加上缝。
        expect((await rectOf(page, "[data-surface-card='activitybar']")).width).toBe(48);

        // 内容的左右和卡片对齐，下边也是。
        const card = await rectOf(page, "[data-surface-card='sidebar']");
        const content = await rectOf(page, "[data-content='view:a'] .workbench-surface__content-clip");
        expect(content.x).toBe(card.x);
        expect(content.width).toBe(card.width);
        expect(content.y).toBe(card.y + 32);
        expect(content.y + content.height).toBe(card.y + card.height);
    });

    test("侧栏隐藏后活动栏不再相连；最大化时盖住的面板四边贴窗体", async ({page}) => {
        await open(page, "cards");
        await frameButton(page, "sidebar", "hide").click();
        await expect(page.locator("[data-surface-card='activitybar']")).not.toHaveAttribute("data-surface-join", /.+/);

        await frameButton(page, "panel", "maximize").click();
        await expect.poll(async () => (await paddingOf(page, "panel")).right).toBe(8);
        const panel = await paddingOf(page, "panel");
        expect(panel.top).toBe(8);
        expect(panel.left).toBe(4);
    });

    test("分隔线按两侧是什么分种类：卡片主题里主体的接缝透明，工具面板之间、编辑组之间的线看得见", async ({page}) => {
        await open(page, "cards");
        await act(page, "d-below-b");
        const seam = (kind: string) => page.locator(`.nb-grid-sash[data-sash-kind="${kind}"]`).first().evaluate((element) => getComputedStyle(element).getPropertyValue("--nb-splitter-seam").trim());
        expect(await seam("shell")).toBe("transparent");
        expect(await seam("editors")).not.toBe("transparent");
        expect(await seam("panes")).not.toBe("transparent");
    });
});

test.describe("主题的场景图", () => {
    test("挂在侧栏和右栏上，高度不足 300px 不画", async ({page}) => {
        await open(page);
        await page.evaluate(() => document.documentElement.setAttribute("data-nb-skin-scene", ""));
        const scene = (panel: string) => page.locator(`[data-surface-card="${panel}"]`).evaluate((element) => getComputedStyle(element, "::after").display);
        const content = (panel: string) => page.locator(`[data-surface-card="${panel}"]`).evaluate((element) => getComputedStyle(element, "::after").content);
        expect(await content("sidebar")).not.toBe("none");
        expect(await content("auxiliarybar")).not.toBe("none");
        expect(await content("panel")).toBe("none");
        expect(await scene("sidebar")).not.toBe("none");

        // 侧栏拆成上下两块，再拖矮到 300px 以下。
        await act(page, "d-below-b");
        const split = await rectOf(page, "[data-leaf='sidebar']");
        await page.mouse.move(split.x + 100, split.y + split.height);
        await page.mouse.down();
        await page.mouse.move(split.x + 100, split.y + 200, {steps: 6});
        await page.mouse.up();
        await expect.poll(() => rectOf(page, "[data-surface-card='sidebar']").then((rect) => rect.height)).toBeLessThan(300);
        await expect.poll(() => scene("sidebar")).toBe("none");
    });
});
