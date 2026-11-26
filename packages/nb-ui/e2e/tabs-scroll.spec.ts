import type {Locator, Page} from "@playwright/test";
import {test, expect} from "./fixtures";

/**
 * Tabs 的 `overflow="scroll"`：选中的标签总在标签栏看得见的范围里（同名 .md 的“布局”）。要真实布局才量得出可见范围，单元测试
 * 环境里矩形全是 0。断言用标签中心点上的元素：点上的是这个标签才算看得见（Playwright 的 click 会先把它滚进来，看不出来）。
 */

async function gotoScene(page: Page, scene: string): Promise<void> {
    await page.goto(`/acceptance/tabs-scroll?scene=${scene}&theme=nbook&colorway=nbook-light`);
    await expect(page.locator("#nb-lab-target")).toBeVisible();
}

/** 标签中心点上是不是它自己（或它里面的元素）。 */
async function visibleInStrip(tab: Locator): Promise<boolean> {
    return tab.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit !== null && element.contains(hit);
    });
}

// 无头 Chrome 缺省藏起滚动条（--hide-scrollbars），量不出经典滚动条占的高度：这一份放出来（`use` 的启动参数只能写在文件顶层）。
test.use({launchOptions: {ignoreDefaultArgs: ["--hide-scrollbars"]}});

const tablist = (page: Page): Locator => page.locator("[data-fixture-strip] [role='tablist']");

test("挂上时选中的是最后一个：标签栏直接滚到露出它", async ({page}) => {
    await gotoScene(page, "last");
    const last = tablist(page).getByRole("tab", {name: "情节"});
    await expect(last).toHaveAttribute("aria-selected", "true");
    expect(await tablist(page).evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await expect.poll(() => visibleInStrip(last)).toBe(true);
});

test("新加一项并选中它：标签栏滚到露出它，外层不滚；只改计数时不把滑到别处的标签栏拽回来", async ({page}) => {
    await gotoScene(page, "first");
    const outer = page.locator("[data-fixture-outer]");
    const list = tablist(page);
    await expect(list.getByRole("tab", {name: "人物"})).toHaveAttribute("aria-selected", "true");
    // 按钮在外层的可见区之外时 click 会先滚外层；先滚到按钮露出来，再记下外层的位置。
    await page.locator("[data-fixture-add]").scrollIntoViewIfNeeded();
    const outerTop = await outer.evaluate((element) => element.scrollTop);

    await page.locator("[data-fixture-add]").click();
    const added = list.getByRole("tab", {name: "新的一组 1"});
    await expect(added).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => visibleInStrip(added)).toBe(true);
    expect(await outer.evaluate((element) => element.scrollTop)).toBe(outerTop);

    // 滑回开头（不换选中），再只改计数：标签栏留在开头。
    await list.evaluate((element) => element.scrollTo({left: 0, behavior: "instant"}));
    await page.locator("[data-fixture-bump]").click();
    await expect(list.getByRole("tab", {name: /人物/u})).toContainText("1");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await list.evaluate((element) => element.scrollLeft)).toBe(0);
});

test("宽时选中最后一个，标签栏变窄以后它仍在看得见的范围里", async ({page}) => {
    await gotoScene(page, "first");
    const list = tablist(page);
    await page.locator("[data-fixture-width]").click();
    await expect.poll(() => list.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const last = list.getByRole("tab", {name: "情节"});
    await last.click();
    await expect(last).toHaveAttribute("aria-selected", "true");
    await page.locator("[data-fixture-width]").click();
    await expect.poll(() => list.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await expect.poll(() => visibleInStrip(last)).toBe(true);
});

test("标签栏不画滚动条：放不下与放得下时一样高", async ({page}) => {
    await gotoScene(page, "first");
    const list = tablist(page);
    await expect.poll(() => list.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    const narrow = await list.evaluate((element) => element.offsetHeight);
    await page.locator("[data-fixture-width]").click();
    await expect.poll(() => list.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await list.evaluate((element) => element.offsetHeight)).toBe(narrow);
});

test("鼠标滚轮在标签栏上竖着滚：标签栏横着滑、外层不动；滑到头以后照常滚外层", async ({page}) => {
    await gotoScene(page, "first");
    const outer = page.locator("[data-fixture-outer]");
    const list = tablist(page);
    const box = (await list.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 60);
    await expect.poll(() => list.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    expect(await outer.evaluate((element) => element.scrollTop)).toBe(0);

    await list.evaluate((element) => element.scrollTo({left: element.scrollWidth, behavior: "instant"}));
    await page.mouse.wheel(0, 60);
    await expect.poll(() => outer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test("两头渐隐：放不下时还有看不见的那一头淡出，滑到头那一头不淡出；放得下时都不淡出", async ({page}) => {
    await gotoScene(page, "first");
    const list = tablist(page);
    await expect(list).toHaveAttribute("data-fade-end", "");
    await expect(list).not.toHaveAttribute("data-fade-start", "");
    await list.evaluate((element) => element.scrollTo({left: element.scrollWidth, behavior: "instant"}));
    await expect(list).toHaveAttribute("data-fade-start", "");
    await expect(list).not.toHaveAttribute("data-fade-end", "");
    await page.locator("[data-fixture-width]").click();
    await expect(list).not.toHaveAttribute("data-fade-start", "");
    await expect(list).not.toHaveAttribute("data-fade-end", "");
});
