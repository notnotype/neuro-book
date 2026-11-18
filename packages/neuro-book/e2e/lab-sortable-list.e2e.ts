/**
 * 可拖动排序的分组列表（docs/specs/ui/sortable-list.md）：真实浏览器里的指针拖动、跨组、空组、取消、等写入、键盘与读屏。
 * 判定的几何在 nb-layout 的 sortable.test.ts；这里验的是会话接线、预览、跟手与放下后的样子。
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
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-sortable-list");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const labState = (page: Page) => page.evaluate(() => (window as unknown as {__nbLab?: {state(): LabDebugState}}).__nbLab?.state());

const open = async (page: Page, scene: string): Promise<void> => {
    await page.goto(`${dev.pageUrl}lab?c=SortableList&s=${scene}&theme=nbook&cw=light&vp=1200x800`);
    // 开发服务首次打开要编译，机器忙时更慢。
    await expect.poll(async () => (await labState(page))?.ready, {timeout: 60_000}).toBe(true);
    await expect(page.locator("[data-sortable-list]")).toBeVisible();
};
const row = (page: Page, key: string) => page.locator(`[data-sortable-key="${key}"]`);
/** 夹具记的次序：宿主采纳了的。 */
const committed = (page: Page) => page.locator("[data-sortable-order]");
const log = (page: Page) => page.locator("[data-sortable-log]");
/** 屏幕上的次序：行在 DOM 里的先后（预览）。 */
const shown = (page: Page) => page.locator("[data-sortable-list] [data-sortable-key]").evaluateAll((rows) => rows.map((element) => `${element.getAttribute("data-sortable-section")}:${element.getAttribute("data-sortable-key")}`).join(" "));

/** 在 `key` 那一行的文字上按下，沿竖直方向挪 `dy`（分多步，每步都过会话的帧合并）。不松手。 */
async function pick(page: Page, key: string, dy: number): Promise<void> {
    const box = (await row(page, key).boundingBox())!;
    const x = box.x + 80;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + Math.sign(dy) * 8, {steps: 2});
    await page.mouse.move(x, y + dy, {steps: 12});
}
const centerY = async (page: Page, selector: string): Promise<number> => {
    const box = (await page.locator(selector).boundingBox())!;
    return box.y + box.height / 2;
};

test.describe("可排序列表", () => {
    test("同组拖动：邻居让开、被拖的行底不透明；松手提交一次；拖过的勾选不被顺带点掉，没拖的点一下照常勾选", async ({page}) => {
        await open(page, "default");
        const from = await centerY(page, '[data-sortable-key="c1"]');
        const to = await centerY(page, '[data-sortable-key="c3"]');
        await pick(page, "c1", to - from + 6);
        await expect.poll(() => shown(page)).toBe("v1:c2 v1:c3 v1:c1 v2:c4 v2:c5");
        const background = await row(page, "c1").evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(background).not.toBe("rgba(0, 0, 0, 0)");
        expect(background).not.toMatch(/rgba\(.*, 0(\.\d+)?\)$/u);
        await expect(committed(page)).toHaveText("v1:c1,c2,c3 v2:c4,c5");
        await page.mouse.up();
        await expect(committed(page)).toHaveText("v1:c2,c3,c1 v2:c4,c5");
        await expect(log(page)).toHaveText("c1 v1:0 → v1:2");
        await expect(row(page, "c1").locator("input[type='checkbox']")).toBeChecked();

        await row(page, "c2").getByText("旧码头").click();
        await expect(row(page, "c2").locator("input[type='checkbox']")).not.toBeChecked();
        await expect(log(page)).toHaveText("c1 v1:0 → v1:2");
    });

    test("跨组：第二卷第一章拖到第一卷第一位；分区头跟着让位", async ({page}) => {
        await open(page, "default");
        const from = await centerY(page, '[data-sortable-key="c4"]');
        const to = await centerY(page, '[data-sortable-key="c1"]');
        await pick(page, "c4", to - from - 6);
        await expect.poll(() => shown(page)).toBe("v1:c4 v1:c1 v1:c2 v1:c3 v2:c5");
        await page.mouse.up();
        await expect(committed(page)).toHaveText("v1:c4,c1,c2,c3 v2:c5");
        await expect(log(page)).toHaveText("c4 v2:0 → v1:0");
    });

    test("最后一卷是空的：显示“拖到这里”，拖进去就是它的第一位", async ({page}) => {
        await open(page, "empty");
        const placeholder = page.locator('[data-sortable-placeholder][data-sortable-section="v2"]');
        await expect(placeholder).toHaveText("拖到这里");
        const from = await centerY(page, '[data-sortable-key="c5"]');
        const to = await centerY(page, '[data-sortable-placeholder][data-sortable-section="v2"]');
        await pick(page, "c5", to - from);
        await expect.poll(() => shown(page)).toBe("v1:c1 v1:c2 v1:c3 v1:c4 v2:c5");
        await page.mouse.up();
        await expect(committed(page)).toHaveText("v1:c1,c2,c3,c4 v2:c5");
        await expect(placeholder).toHaveCount(0);
    });

    test("拖到一半按 Esc：回到原样，零提交", async ({page}) => {
        await open(page, "default");
        const from = await centerY(page, '[data-sortable-key="c1"]');
        const to = await centerY(page, '[data-sortable-key="c3"]');
        await pick(page, "c1", to - from + 6);
        await expect.poll(() => shown(page)).toBe("v1:c2 v1:c3 v1:c1 v2:c4 v2:c5");
        await page.keyboard.press("Escape");
        await expect.poll(() => shown(page)).toBe("v1:c1 v1:c2 v1:c3 v2:c4 v2:c5");
        await page.mouse.up();
        await expect(committed(page)).toHaveText("v1:c1,c2,c3 v2:c4,c5");
        await expect(log(page)).toHaveText("");
        await expect(page.locator("[data-sortable-list] [role='status']")).toContainText("已取消");
    });

    test("宿主写得慢：放下后一直是放下的样子，不闪回旧次序，采纳后照旧", async ({page}) => {
        await open(page, "slow");
        // 记下放下之后屏幕上出现过的每一种次序。
        await page.evaluate(() => {
            const list = document.querySelector("[data-sortable-list]")!;
            const seen: string[] = [];
            (window as unknown as {__orders: string[]}).__orders = seen;
            new MutationObserver(() => {
                seen.push([...list.querySelectorAll("[data-sortable-key]")].map((element) => element.getAttribute("data-sortable-key")).join(","));
            }).observe(list, {childList: true, subtree: true});
        });
        const from = await centerY(page, '[data-sortable-key="c1"]');
        const to = await centerY(page, '[data-sortable-key="c3"]');
        await pick(page, "c1", to - from + 6);
        await expect.poll(() => shown(page)).toBe("v1:c2 v1:c3 v1:c1 v2:c4 v2:c5");
        await page.evaluate(() => (window as unknown as {__orders: string[]}).__orders.splice(0));
        await page.mouse.up();
        await expect(log(page)).toHaveText("c1 v1:0 → v1:2");
        await expect(committed(page)).toHaveText("v1:c2,c3,c1 v2:c4,c5");
        const orders = await page.evaluate(() => (window as unknown as {__orders: string[]}).__orders);
        expect(orders).not.toContain("c1,c2,c3,c4,c5");
        expect(await shown(page)).toBe("v1:c2 v1:c3 v1:c1 v2:c4 v2:c5");
    });

    test("宿主没采纳（写入失败）：放下后回到原样", async ({page}) => {
        await open(page, "fail");
        const from = await centerY(page, '[data-sortable-key="c1"]');
        const to = await centerY(page, '[data-sortable-key="c3"]');
        await pick(page, "c1", to - from + 6);
        await expect.poll(() => shown(page)).toBe("v1:c2 v1:c3 v1:c1 v2:c4 v2:c5");
        await page.mouse.up();
        await expect(log(page)).toHaveText("c1 v1:0 → v1:2");
        await expect.poll(() => shown(page)).toBe("v1:c1 v1:c2 v1:c3 v2:c4 v2:c5");
        await expect(committed(page)).toHaveText("v1:c1,c2,c3 v2:c4,c5");
    });

    test("键盘：把手上空格拿起，下键跨过分区头，回车放下，焦点回到把手，读屏播报位置", async ({page}) => {
        await open(page, "default");
        const handle = row(page, "c3").locator("[data-sortable-handle]");
        await expect(handle).toHaveAccessibleName("移动潮汐表");
        await handle.focus();
        await page.keyboard.press(" ");
        await page.keyboard.press("ArrowDown");
        await expect.poll(() => shown(page)).toBe("v1:c1 v1:c2 v2:c3 v2:c4 v2:c5");
        await expect(page.locator("[data-sortable-list] [role='status']")).toHaveText("第二卷第 1 位");
        await page.keyboard.press("Enter");
        await expect(committed(page)).toHaveText("v1:c1,c2 v2:c3,c4,c5");
        await expect(log(page)).toHaveText("c3 v1:2 → v2:0");
        await expect(row(page, "c3").locator("[data-sortable-handle]")).toBeFocused();
        await expect(page.locator("[data-sortable-list] [role='status']")).toHaveText("已把潮汐表放到第二卷第 1 位");
    });

    test("停用：按住拖不动，把手停用", async ({page}) => {
        await open(page, "disabled");
        await expect(row(page, "c1").locator("[data-sortable-handle]")).toBeDisabled();
        const from = await centerY(page, '[data-sortable-key="c1"]');
        const to = await centerY(page, '[data-sortable-key="c3"]');
        await pick(page, "c1", to - from + 6);
        await page.mouse.up();
        expect(await shown(page)).toBe("v1:c1 v1:c2 v1:c3 v2:c4 v2:c5");
        await expect(log(page)).toHaveText("");
    });
});
