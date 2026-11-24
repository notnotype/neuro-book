/**
 * 示例 e2e 共用的拖动辅助：按指针真实地按下、移动、松手。
 *
 * 会话只在“松手时的动作与最后显示过的相同”时提交，落点在指针移动之后的下一帧才发布：所以每一步都等示例写在外框上的
 * `data-drop` 变成期望的完整动作再走下一步，不按时长等。要断言“这里不是落点”，先移到一个真落点、等它显示出来，
 * 再一步跳到要测的地方、等 `data-drop` 变成 `none`：直接断言“没有”会在落点发布之前就空过。
 */

import {expect, type Locator, type Page} from "@playwright/test";

export type Point = {readonly x: number; readonly y: number};

export async function boxOf(locator: Locator): Promise<{x: number; y: number; width: number; height: number}> {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (box === null) throw new Error("元素没有矩形");
    return box;
}

export async function centerOf(locator: Locator): Promise<Point> {
    const box = await boxOf(locator);
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

/** 网格上没有进行中的过渡：过渡中量到的矩形是中间值，指针会落到别处。 */
export async function settled(page: Page): Promise<void> {
    await expect(page.locator("[data-moving]")).toHaveCount(0);
}

/** 等两帧：落点在指针移动之后的下一帧发布，两帧之后还没有就是真的没有。 */
export async function twoFrames(page: Page): Promise<void> {
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** 在来源上按下，挪过起拖门槛。 */
export async function pickUp(page: Page, source: Locator): Promise<void> {
    await settled(page);
    const at = await centerOf(source);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 10, at.y + 6, {steps: 3});
}

/** 移到 `to`，等外框的 `data-drop` 变成 `expected`。 */
export async function moveTo(page: Page, to: Point, expected: string | RegExp, steps = 8): Promise<void> {
    await page.mouse.move(to.x, to.y, {steps});
    await expect(page.locator("[data-drop]")).toHaveAttribute("data-drop", expected);
}

/** 一整次拖放：按下、移到目标、等落点、松手。 */
export async function dragTo(page: Page, source: Locator, to: Point, expected: string): Promise<void> {
    await pickUp(page, source);
    await moveTo(page, to, expected);
    await page.mouse.up();
    await expect(page.locator("[data-drop]")).toHaveCount(0);
}
