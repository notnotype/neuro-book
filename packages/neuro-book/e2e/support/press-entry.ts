import type {Locator, Page} from "@playwright/test";

/**
 * 点活动栏或入口条上的入口，再把指针移到状态栏中间：指针留在入口上，入口的提示框会盖住侧栏顶上的标签，接着点侧栏的那一下就点在提示框上（高负载时偶发）。
 * 状态栏中间没有条目（Lab 的表面场景里只有一行字），移过去不触发别的悬停。状态栏隐藏着时不移：`boundingBox` 找不到元素会一直等到超时。
 */
export async function pressEntry(page: Page, target: Locator): Promise<void> {
    await target.click();
    const bar = page.locator("[data-workbench-surface] > [data-grid-scope] > [data-leaf='statusbar']");
    if (await bar.count() === 0) return;
    const box = await bar.boundingBox();
    if (box !== null) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}
