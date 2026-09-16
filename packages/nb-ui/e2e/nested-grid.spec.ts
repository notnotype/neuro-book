import {test, expect, type Page, type Locator} from "./fixtures";

/**
 * 嵌套 Grid 用户手势与两轴几何的真实浏览器验收。
 * 遵循任务合同（t45-nested-grid-lab-fixture）与验收规范（docs/specs/ui/nested-grid.md）：
 * 1. 外层拖动守恒与内层高不变
 * 2. 内层拖动不改外层宽
 * 3. 键盘连发单次提交
 * 4. Escape 零提交
 * 5. 程序布局零提交
 * 6. 三个恢复场景：未知引用过滤保留原件、畸形快照拒绝、高版本快照拒绝
 * 7. 四主题组合（nbook/macos × light/dark）× 桌面/390×844 的几何与一次键盘调整
 */

async function gotoNestedGrid(
    page: Page,
    options: {
        scene?: string;
        theme?: string;
        colorway?: string;
        viewport?: "responsive" | "phone" | "tablet";
    } = {},
): Promise<void> {
    const query = new URLSearchParams({
        component: "nested-grid",
        scene: options.scene ?? "default",
        viewport: options.viewport ?? "responsive",
        theme: options.theme ?? "nbook",
        colorway: options.colorway ?? "nbook-light",
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

function nestedGridLocators(page: Page) {
    return {
        outerSash: page.locator("#nb-lab-target > div > [role=separator]"),
        innerSash: page.locator("#nb-lab-target [data-branch=right] [role=separator]"),
        leftLeaf: page.locator("#nb-lab-target [data-panel-leaf=left]"),
        topLeaf: page.locator("#nb-lab-target [data-panel-leaf=top]"),
        bottomLeaf: page.locator("#nb-lab-target [data-panel-leaf=bottom]"),
        rightBranch: page.locator("#nb-lab-target [data-branch=right]"),
        gesture: page.locator("[data-lab-gesture]"),
        recovery: page.locator("[data-lab-recovery]"),
    };
}

test("外层拖动守恒与内层高不变", async ({page}) => {
    await gotoNestedGrid(page);

    const {outerSash, innerSash, leftLeaf, rightBranch, topLeaf, bottomLeaf, gesture} = nestedGridLocators(page);
    await expect(outerSash).toBeVisible();
    await expect(innerSash).toBeVisible();
    await expect(outerSash).toHaveCSS("width", "7px");
    await expect(innerSash).toHaveCSS("height", "7px");

    const beforeLeft = (await leftLeaf.boundingBox())!;
    const beforeRight = (await rightBranch.boundingBox())!;
    const beforeTop = (await topLeaf.boundingBox())!;
    const beforeBottom = (await bottomLeaf.boundingBox())!;
    expect(beforeLeft).not.toBeNull();
    expect(beforeRight).not.toBeNull();
    expect(beforeTop).not.toBeNull();
    expect(beforeBottom).not.toBeNull();

    const sashBox = (await outerSash.boundingBox())!;
    expect(sashBox).not.toBeNull();
    const startX = sashBox.x + sashBox.width / 2;
    const startY = sashBox.y + sashBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 60, startY, {steps: 6});
    await page.mouse.up();


    await expect(gesture).toHaveAttribute("data-lab-gesture-state", "commit");
    await expect(gesture).toHaveAttribute("data-lab-commit-count", "1");
    await expect(gesture).toHaveAttribute("data-lab-last-sash", "left~right");

    const activeText = await gesture.getAttribute("data-lab-last-active");
    expect(JSON.parse(activeText!)).toEqual(["left", "right"]);

    const afterLeft = (await leftLeaf.boundingBox())!;
    const afterRight = (await rightBranch.boundingBox())!;
    const afterTop = (await topLeaf.boundingBox())!;
    const afterBottom = (await bottomLeaf.boundingBox())!;

    // 外层主轴：左栏变宽、右分支变窄，且两者之和守恒
    expect(afterLeft.width).toBeGreaterThan(beforeLeft.width);
    expect(afterRight.width).toBeLessThan(beforeRight.width);
    expect(afterLeft.width + afterRight.width).toBeCloseTo(beforeLeft.width + beforeRight.width, 0);

    // 内层纵轴：高完全不变（两轴独立性）
    expect(afterTop.height).toBeCloseTo(beforeTop.height, 1);
    expect(afterBottom.height).toBeCloseTo(beforeBottom.height, 1);

    await showEventLog(page);
    const names = await eventNames(page);
    expect(names.filter((n) => n === "gesture-start")).toHaveLength(1);
    expect(names.filter((n) => n === "gesture-end")).toHaveLength(1);
    expect(names.filter((n) => n === "gesture-cancel")).toHaveLength(0);
});

test("内层拖动不改外层宽", async ({page}) => {
    await gotoNestedGrid(page);

    const {outerSash, innerSash, leftLeaf, rightBranch, topLeaf, bottomLeaf, gesture} = nestedGridLocators(page);
    await expect(outerSash).toBeVisible();
    await expect(innerSash).toBeVisible();

    const beforeLeft = (await leftLeaf.boundingBox())!;
    const beforeRight = (await rightBranch.boundingBox())!;
    const beforeTop = (await topLeaf.boundingBox())!;
    const beforeBottom = (await bottomLeaf.boundingBox())!;

    const sashBox = (await innerSash.boundingBox())!;
    expect(sashBox).not.toBeNull();
    const startX = sashBox.x + sashBox.width / 2;
    const startY = sashBox.y + sashBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY + 40, {steps: 6});
    await page.mouse.up();


    await expect(gesture).toHaveAttribute("data-lab-gesture-state", "commit");
    await expect(gesture).toHaveAttribute("data-lab-commit-count", "1");
    await expect(gesture).toHaveAttribute("data-lab-last-sash", "top~bottom");

    const activeText = await gesture.getAttribute("data-lab-last-active");
    expect(JSON.parse(activeText!)).toEqual(["top", "bottom"]);

    const afterLeft = (await leftLeaf.boundingBox())!;
    const afterRight = (await rightBranch.boundingBox())!;
    const afterTop = (await topLeaf.boundingBox())!;
    const afterBottom = (await bottomLeaf.boundingBox())!;

    // 内层纵轴：上栏变高、下栏变矮，且总高守恒
    expect(afterTop.height).toBeGreaterThan(beforeTop.height);
    expect(afterBottom.height).toBeLessThan(beforeBottom.height);
    expect(afterTop.height + afterBottom.height).toBeCloseTo(beforeTop.height + beforeBottom.height, 0);

    // 外层横轴：列宽完全不变（两轴独立性）
    expect(afterLeft.width).toBeCloseTo(beforeLeft.width, 1);
    expect(afterRight.width).toBeCloseTo(beforeRight.width, 1);
});

test("键盘连发单次提交", async ({page}) => {
    await gotoNestedGrid(page);

    const {outerSash, gesture} = nestedGridLocators(page);
    await outerSash.focus();
    await expect(outerSash).toBeFocused();

    // 连续触发 keydown，最后释放
    await page.keyboard.down("ArrowRight");
    await page.keyboard.down("ArrowRight");
    await page.keyboard.down("ArrowRight");
    await page.keyboard.up("ArrowRight");


    await expect(gesture).toHaveAttribute("data-lab-gesture-state", "commit");
    await expect(gesture).toHaveAttribute("data-lab-commit-count", "1");
    await expect(gesture).toHaveAttribute("data-lab-gesture-source", "keyboard");

    await showEventLog(page);
    const names = await eventNames(page);
    expect(names.filter((n) => n === "gesture-start")).toHaveLength(1);
    expect(names.filter((n) => n === "gesture-end")).toHaveLength(1);
});

test("Escape 零提交", async ({page}) => {
    await gotoNestedGrid(page);

    const {outerSash, gesture} = nestedGridLocators(page);
    const box = (await outerSash.boundingBox())!;
    expect(box).not.toBeNull();

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 40, startY, {steps: 4});
    await page.keyboard.press("Escape");
    await page.mouse.up();


    await expect(gesture).toHaveAttribute("data-lab-gesture-state", "cancel");
    await expect(gesture).toHaveAttribute("data-lab-commit-count", "0");

    await showEventLog(page);
    const names = await eventNames(page);
    expect(names.filter((n) => n === "gesture-end")).toHaveLength(0);
    expect(names.filter((n) => n === "gesture-cancel")).toHaveLength(1);
});

test("程序布局零提交", async ({page}) => {
    await gotoNestedGrid(page);

    const {leftLeaf, gesture} = nestedGridLocators(page);
    await expect(gesture).toHaveAttribute("data-lab-commit-count", "0");
    await expect(gesture).toHaveAttribute("data-lab-gesture-state", "none");

    const beforeLeft = (await leftLeaf.boundingBox())!;
    await page.locator("[data-lab-action=programmatic-layout]").click();

    // 呈现几何已更新
    const afterLeft = (await leftLeaf.boundingBox())!;
    expect(afterLeft.width).not.toBeCloseTo(beforeLeft.width, 1);

    // 提交次数保持为 0，手势状态保持为 none
    await expect(gesture).toHaveAttribute("data-lab-commit-count", "0");
    await expect(gesture).toHaveAttribute("data-lab-gesture-state", "none");

    await showEventLog(page);
    const names = await eventNames(page);
    expect(names.filter((n) => n === "gesture-end")).toHaveLength(0);
});

test("恢复场景：未知引用过滤但原件保留且调整后不丢", async ({page}) => {
    await gotoNestedGrid(page, {scene: "unknown-ref"});

    const {outerSash, leftLeaf, topLeaf, bottomLeaf, gesture, recovery} = nestedGridLocators(page);
    await expect(recovery).toHaveAttribute("data-lab-restore-status", "dropped-unknown");
    await expect(recovery).toHaveAttribute("data-lab-dropped-count", "1");

    // 呈现层仅渲染已识别的节点，未识别的节点被过滤
    await expect(leftLeaf).toBeVisible();
    await expect(topLeaf).toBeVisible();
    await expect(bottomLeaf).toBeVisible();
    await expect(page.locator("#nb-lab-target [data-panel-leaf=ghost-plugin]")).toHaveCount(0);

    // 内存原件完整保留 ghost-plugin
    const rawBefore = JSON.parse((await recovery.getAttribute("data-lab-raw-record"))!);
    expect(JSON.stringify(rawBefore)).toContain("ghost-plugin");
    expect(JSON.stringify(rawBefore)).toContain("unknown-plugin-view");

    // 用户调整已知节点
    await outerSash.focus();
    await page.keyboard.press("ArrowRight");

    await expect(gesture).toHaveAttribute("data-lab-gesture-state", "commit");
    await expect(gesture).toHaveAttribute("data-lab-commit-count", "1");

    // 调整后原件依然保留未知部分（未抹除）
    const rawAfter = JSON.parse((await recovery.getAttribute("data-lab-raw-record"))!);
    expect(JSON.stringify(rawAfter)).toContain("ghost-plugin");
    expect(JSON.stringify(rawAfter)).toContain("unknown-plugin-view");
});

test("恢复场景：畸形重复身份整体拒绝且无异常", async ({page}) => {
    await gotoNestedGrid(page, {scene: "malformed"});

    const {leftLeaf, topLeaf, bottomLeaf, recovery} = nestedGridLocators(page);
    await expect(recovery).toHaveAttribute("data-lab-restore-status", "rejected");
    const reason = await recovery.getAttribute("data-lab-restore-reason");
    expect(reason).toContain("重复节点 id");

    // 安全回退默认布局，页面不抛未捕获异常
    await expect(leftLeaf).toBeVisible();
    await expect(topLeaf).toBeVisible();
    await expect(bottomLeaf).toBeVisible();
});

test("恢复场景：高版本快照整体拒绝且保留原件", async ({page}) => {
    await gotoNestedGrid(page, {scene: "high-version"});

    const {leftLeaf, topLeaf, bottomLeaf, recovery} = nestedGridLocators(page);
    await expect(recovery).toHaveAttribute("data-lab-restore-status", "rejected");
    const reason = await recovery.getAttribute("data-lab-restore-reason");
    expect(reason).toContain("99");

    // 保留原件
    const raw = JSON.parse((await recovery.getAttribute("data-lab-raw-record"))!);
    expect(raw.version).toBe(99);

    // 呈现安全默认布局
    await expect(leftLeaf).toBeVisible();
    await expect(topLeaf).toBeVisible();
    await expect(bottomLeaf).toBeVisible();
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
        test(`四主题组合 ${combination.theme}/${combination.colorway} 在 ${viewport.name} 保持真实几何与键盘调整`, async ({page}) => {
            await page.setViewportSize({width: viewport.width, height: viewport.height});
            await gotoNestedGrid(page, {
                theme: combination.theme,
                colorway: combination.colorway,
                viewport: "responsive",
            });

            const target = page.locator("#nb-lab-target");
            const {outerSash, innerSash, gesture} = nestedGridLocators(page);

            await expect(target).toBeVisible();
            await expect(outerSash).toBeVisible();
            await expect(innerSash).toBeVisible();

            const targetBox = (await target.boundingBox())!;
            expect(targetBox, "容器必须具有真实可见尺寸").not.toBeNull();
            expect(targetBox.width).toBeGreaterThan(0);
            expect(targetBox.height).toBeGreaterThan(0);

            if (viewport.name === "390×844") {
                expect(targetBox.width).toBeLessThan(390);
                const overflow = await page.evaluate(
                    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
                );
                expect(overflow).toBeLessThanOrEqual(0);
            }

            // 一次键盘调整验证手势可用
            await outerSash.focus();
            await page.keyboard.press("ArrowRight");


            await expect(gesture).toHaveAttribute("data-lab-gesture-state", "commit");
            await expect(gesture).toHaveAttribute("data-lab-commit-count", "1");
        });
    }
}
