import type {Locator, Page} from "@playwright/test";
import {test, expect} from "./fixtures";

/**
 * 浮层分档（w00032 t09 决定 23 至 25，开发者在 Lab 里对着彩色背景挑定）：nbook 主题下菜单一类小浮层亮 72%、暗 75%，
 * 对话框与叠在对话框上的二级对话框都是 90%；二级对话框的圆角不大于底下的窗口；减少透明度时都换成实心、不模糊。
 * 面的透明度读的是计算后的 background-color 的 alpha（color-mix 与透明混合后浏览器给出 srgb 带 alpha 的颜色）。
 */

type Colorway = "nbook-light" | "nbook-dark";

/** 计算样式里颜色的 alpha：`rgba(r, g, b, a)`、`color(srgb r g b / a)` 两种写法都认，没有 alpha 时是 1。 */
async function alphaOf(surface: Locator): Promise<number> {
    const color = await surface.evaluate((element) => getComputedStyle(element).backgroundColor);
    const match = /\/\s*([\d.]+)\)$/u.exec(color) ?? /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/u.exec(color);
    return match === null ? 1 : Number(match[1]);
}

async function settled(surface: Locator): Promise<void> {
    await expect(surface).toBeVisible();
    await surface.evaluate((element) => Promise.all(element.getAnimations({subtree: true}).map((animation) => animation.finished)));
}

async function gotoScene(page: Page, scene: string, colorway: Colorway): Promise<void> {
    await page.goto(`/acceptance/dialog-surfaces?scene=${scene}&theme=nbook&colorway=${colorway}`);
}

const radius = (surface: Locator): Promise<number> => surface.evaluate((element) => Number.parseFloat(getComputedStyle(element).borderTopLeftRadius));
const outerDialog = (page: Page): Locator => page.locator("[data-fixture-outer]");

for (const [colorway, menuAlpha] of [["nbook-light", 0.72], ["nbook-dark", 0.75]] as const) {
    test(`${colorway}：菜单 ${String(menuAlpha)}，对话框与二级对话框 0.9`, async ({page}) => {
        await page.goto(`/acceptance/popup-lists?scene=material&theme=nbook&colorway=${colorway}`);
        await page.locator("[data-fixture-dropdown-trigger]").click();
        const menu = page.locator("[data-fixture-dropdown]");
        await settled(menu);
        expect(await alphaOf(menu), "菜单").toBeCloseTo(menuAlpha, 2);

        await gotoScene(page, "nested", colorway);
        await settled(page.locator("[data-fixture-inner]"));
        expect(await alphaOf(outerDialog(page)), "一级对话框").toBeCloseTo(0.9, 2);
        expect(await alphaOf(page.locator("[data-fixture-inner]")), "二级对话框").toBeCloseTo(0.9, 2);
    });
}

test("二级对话框与叠在对话框上的确认框：圆角不大于窗口，一级对话框保持自己的圆角", async ({page}) => {
    await gotoScene(page, "single", "nbook-light");
    const outer = outerDialog(page);
    await settled(outer);
    const windowRadius = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--radius-window")));
    const dialogRadius = await radius(outer);
    expect(dialogRadius, "一级对话框比窗口圆，二级才需要收").toBeGreaterThan(windowRadius);
    await expect(outer).not.toHaveClass(/nb-ui-dialog-surface--nested/u);

    await gotoScene(page, "nested", "nbook-light");
    const inner = page.locator("[data-fixture-inner]");
    await settled(inner);
    expect(await radius(inner)).toBe(windowRadius);
    expect(await radius(outerDialog(page)), "外层不受内层影响").toBe(dialogRadius);

    await gotoScene(page, "alert", "nbook-light");
    const alert = page.getByRole("alertdialog");
    await settled(alert);
    expect(await radius(alert)).toBeLessThanOrEqual(windowRadius);
    expect(await alphaOf(alert)).toBeCloseTo(0.9, 2);
});

// nbook 里二级与一级同为 90%、确认框圆角又等于窗口圆角，从外观分不出嵌套生没生效；probe 场景把二级那档改成 50%，
// 相关圆角改成与窗口不同的值（见夹具），验“二级读二级那档、圆角收到窗口那档”这条机制。
test("二级读二级那档：对话框里的对话框、对话框里的确认框、浮动窗口里的浮动窗口", async ({page}) => {
    await gotoScene(page, "nested-probe", "nbook-light");
    const inner = page.locator("[data-fixture-inner]");
    await settled(inner);
    expect(await alphaOf(outerDialog(page)), "一级对话框不受影响").toBeCloseTo(0.9, 2);
    expect(await alphaOf(inner), "二级对话框").toBeCloseTo(0.5, 2);

    await gotoScene(page, "alert-probe", "nbook-light");
    const alert = page.getByRole("alertdialog");
    await settled(alert);
    const windowRadius = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--radius-window")));
    expect(await alphaOf(alert), "叠在对话框上的确认框").toBeCloseTo(0.5, 2);
    expect(await radius(alert), "确认框圆角（一级时是 20px）收到窗口那档").toBe(windowRadius);

    await gotoScene(page, "window-probe", "nbook-light");
    const innerWindow = page.locator("[data-fixture-inner]");
    await settled(innerWindow);
    expect(await alphaOf(outerDialog(page)), "一级浮动窗口").toBeCloseTo(0.9, 2);
    expect(await alphaOf(innerWindow), "二级浮动窗口").toBeCloseTo(0.5, 2);
    expect(await radius(innerWindow), "二级浮动窗口仍是窗口那档，不取更小的对话框圆角（8px）").toBe(windowRadius);
});

test("抽屉不画二级的面；窗口里的确认框画二级；模态遮罩用共用的淡入关键帧", async ({page}) => {
    await gotoScene(page, "drawer-in-dialog", "nbook-light");
    const drawer = page.locator(".nb-ui-drawer-surface");
    await settled(drawer);
    await expect(drawer, "抽屉只参加模态的叠放，不画二级的面").not.toHaveClass(/nb-ui-dialog-surface--nested/u);
    const overlayAnimations = await page.locator(".nb-ui-overlay").evaluateAll((overlays) => overlays.map((overlay) => getComputedStyle(overlay).animationName));
    expect(overlayAnimations.length, "对话框与抽屉各有一层遮罩").toBe(2);
    expect(overlayAnimations, "遮罩的入场来自 .nb-ui-overlay").toEqual(["nb-ui-overlay-in", "nb-ui-overlay-in"]);

    await gotoScene(page, "alert-in-window", "nbook-light");
    const alert = page.getByRole("alertdialog");
    await settled(alert);
    await expect(alert, "窗口里的确认框画二级").toHaveClass(/nb-ui-dialog-surface--nested/u);
    const windowZ = await outerDialog(page).evaluate((element) => Number(getComputedStyle(element).zIndex));
    const alertZ = await alert.evaluate((element) => Number(getComputedStyle(element).zIndex));
    expect(alertZ, "窗口里开的模态压在窗口之上").toBeGreaterThan(windowZ);
});

test("减少透明度：菜单、对话框与二级对话框都是实心，不模糊", async ({page}) => {
    // Playwright 的 emulateMedia 还不收这个特性，经 Chrome 的调试协议设（配置只跑 Chromium）。
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setEmulatedMedia", {features: [{name: "prefers-reduced-transparency", value: "reduce"}]});
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-transparency: reduce)").matches), "浏览器认这个媒体特性").toBe(true);

    await page.goto("/acceptance/popup-lists?scene=material&theme=nbook&colorway=nbook-light");
    await page.locator("[data-fixture-dropdown-trigger]").click();
    const menu = page.locator("[data-fixture-dropdown]");
    await settled(menu);
    expect(await alphaOf(menu), "菜单").toBe(1);

    for (const colorway of ["nbook-light", "nbook-dark"] as const) {
        await gotoScene(page, "nested", colorway);
        const inner = page.locator("[data-fixture-inner]");
        await settled(inner);
        for (const [name, surface] of [["一级对话框", outerDialog(page)], ["二级对话框", inner]] as const) {
            expect(await alphaOf(surface), `${colorway} ${name}`).toBe(1);
            await expect(surface, `${colorway} ${name}`).toHaveCSS("backdrop-filter", "none");
        }
    }
});

test("高对比度：菜单、对话框与二级对话框都是实心，不模糊", async ({page}) => {
    await page.emulateMedia({contrast: "more"});
    await page.goto("/acceptance/popup-lists?scene=material&theme=nbook&colorway=nbook-dark");
    await page.locator("[data-fixture-dropdown-trigger]").click();
    const menu = page.locator("[data-fixture-dropdown]");
    await settled(menu);
    expect(await alphaOf(menu), "菜单").toBe(1);

    await gotoScene(page, "nested", "nbook-light");
    const inner = page.locator("[data-fixture-inner]");
    await settled(inner);
    for (const [name, surface] of [["一级对话框", outerDialog(page)], ["二级对话框", inner]] as const) {
        expect(await alphaOf(surface), name).toBe(1);
        await expect(surface, name).toHaveCSS("backdrop-filter", "none");
    }
});
