import { test } from "./fixtures";

test.use({ viewport: { width: 1440, height: 800 } });

const combos = [
    { theme: "nbook", colorway: "macos-light", name: "nbook-macos-light" },
    { theme: "nbook", colorway: "nbook-dark", name: "nbook-dark" },
    { theme: "macos", colorway: "macos-light", name: "macos-light" },
    { theme: "macos", colorway: "macos-dark", name: "macos-dark" },
    { theme: "editorial", colorway: "nbook-light", name: "editorial-light" },
    { theme: "editorial", colorway: "dark", name: "editorial-dark" },
    { theme: "aurora", colorway: "macos-light", name: "aurora-light" },
    { theme: "aurora", colorway: "dark", name: "aurora-dark" },
];

test("shots: 4 主题 × 明暗配色矩阵", async ({ page }, testInfo) => {
    for (const combo of combos) {
        await page.goto(`/lab?component=form-input&scene=default&viewport=responsive&theme=${combo.theme}&colorway=${combo.colorway}`);
        await page.locator("#nb-lab-target").waitFor();
        await page.waitForTimeout(500);
        await page.screenshot({ path: testInfo.outputPath(`30-${combo.name}.png`) });
    }

    // 组件覆盖面抽查（NeuroBook + macOS Light，用户参照组合）
    for (const component of ["button", "tabs", "switch-field", "segmented-control"]) {
        await page.goto(`/lab?component=${component}&scene=default&viewport=responsive&theme=nbook&colorway=macos-light`);
        await page.locator("#nb-lab-target").waitFor();
        await page.waitForTimeout(400);
        await page.screenshot({ path: testInfo.outputPath(`31-${component}-reference.png`) });
    }
});

test("shots: 窄屏 390", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/lab?component=form-input&scene=default&viewport=responsive&theme=nbook&colorway=macos-light");
    await page.locator("#nb-lab-target").waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: testInfo.outputPath("32-narrow-390.png") });
});
