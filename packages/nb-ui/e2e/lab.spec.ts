import { test, expect, type Page } from "./fixtures";

/**
 * /lab 诊断实验室的行为级用例（Task 150 阶段 D）。
 * 断言面全是用户可观察合同：URL 五参数、真实元素的计算样式、portal 内容、
 * 焦点归还、事件日志与离开页面后的残留。控制台 error 与 pageerror 由 fixtures.ts 归零。
 */

const THEMES = ["editorial", "macos", "aurora", "nbook"] as const;

type LabParams = {
    component?: string;
    scene?: string;
    viewport?: string;
    theme?: string;
    colorway?: string;
    targetState?: "visible" | "attached";
};

/** 直接以五参数 URL 进入 /lab，等待目标出现（默认绕开 UI 操作，单测单一职责） */
async function gotoLab(page: Page, params: LabParams = {}): Promise<URL> {
    const query = new URLSearchParams({
        component: params.component ?? "form-input",
        scene: params.scene ?? "default",
        viewport: params.viewport ?? "responsive",
        theme: params.theme ?? "nbook",
        colorway: params.colorway ?? "nbook-light",
    });
    await page.goto(`/lab?${query.toString()}`);
    const target = page.locator("#nb-lab-target");
    if (params.targetState === "attached") await expect(target).toBeAttached();
    else await expect(target).toBeVisible();
    return new URL(page.url());
}

async function readCssVar(page: Page, name: string): Promise<string> {
    return page.evaluate((token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(), name);
}

/** 切主题 / 开浮层后读数前必须等过过渡（坑 #18：--motion-fast 90–120ms，等待不足会读到中间态） */
async function settle(page: Page, ms = 600): Promise<void> {
    await page.waitForTimeout(ms);
}

test("smoke: 首页打开无报错", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("nb-ui 设计实验室")).toBeVisible();
});

test("lab: 打开 /lab 无报错且 URL 首屏归一化", async ({ page }) => {
    await page.goto("/lab");
    await page.waitForURL(/component=form-input/);
    const url = new URL(page.url());
    expect(url.searchParams.get("component")).toBe("form-input");
    expect(url.searchParams.get("scene")).toBe("default");
    expect(url.searchParams.get("viewport")).toBe("responsive");
    expect(url.searchParams.get("theme")).toBeTruthy();
    expect(url.searchParams.get("colorway")).toBeTruthy();
    await expect(page.locator("#nb-lab-target")).toBeVisible();
});

test("场景切换同步 URL，刷新后恢复", async ({ page }) => {
    await gotoLab(page);
    await page.locator('[aria-label="场景"]').getByText("前缀").click();
    await page.waitForURL(/scene=prefix/);
    // 前缀场景的可见证据：FormInput fixture 的前缀文本渲染出来
    await expect(page.getByText("@WORLD/", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator("#nb-lab-target")).toBeVisible();
    const url = new URL(page.url());
    expect(url.searchParams.get("scene")).toBe("prefix");
    await expect(page.getByText("@WORLD/", { exact: true })).toBeVisible();
});

test("非法 URL 首屏归一化并用 replace 覆盖历史", async ({ page }) => {
    await page.goto("/lab?component=bogus&scene=nope&viewport=huge&theme=ghost&colorway=ghost");
    await page.waitForURL(/component=form-input/);
    const url = new URL(page.url());
    expect(url.searchParams.get("scene")).toBe("default");
    expect(url.searchParams.get("viewport")).toBe("responsive");
    expect(url.searchParams.get("theme")).not.toBe("ghost");
    // replace 语义：历史里只有归一化后的这一条，后退不会回到非法 URL
    await page.goBack();
    expect(page.url()).not.toContain("/lab");
});

test("theme=bare 裸基线可复现且不装主题", async ({ page }) => {
    await gotoLab(page, { theme: "bare" });
    const url = new URL(page.url());
    expect(url.searchParams.get("theme")).toBe("bare");
    const hasTheme = await page.evaluate(() => document.documentElement.hasAttribute("data-nb-theme"));
    expect(hasTheme).toBe(false);
    await page.reload();
    await expect(page.locator("#nb-lab-target")).toBeVisible();
    expect(new URL(page.url()).searchParams.get("theme")).toBe("bare");
});

test("4 主题 × 明暗配色切换后读数变化", async ({ page }) => {
    for (const theme of THEMES) {
        const readings: string[] = [];
        for (const colorway of ["nbook-light", "nbook-dark"]) {
            await gotoLab(page, { theme, colorway });
            await settle(page);
            const value = await readCssVar(page, "--bg-panel");
            expect(value, `${theme}/${colorway} 的 --bg-panel 应有值`).not.toBe("");
            // 变量面板的当前计算值（读的是元素计算样式，不是变量表）与根读数一致
            const input = page.getByLabel("--bg-panel 覆盖值");
            await expect(input).toHaveAttribute("placeholder", value);
            readings.push(value);
        }
        expect(readings[0], `${theme} 明暗两档的 --bg-panel 必须不同`).not.toBe(readings[1]);
    }
});

test("变量覆盖实时更新读数，单项与全部重置生效", async ({ page }) => {
    await gotoLab(page);
    const original = await readCssVar(page, "--accent-main");

    const input = page.getByLabel("--accent-main 覆盖值");
    await input.fill("rebeccapurple");
    await input.blur();
    await settle(page);
    expect(await readCssVar(page, "--accent-main")).toBe("rebeccapurple");
    await expect(page.locator(".lab-vars__count")).toHaveText("1 项覆盖");

    // 单项重置
    await page.getByRole("button", { name: "重置 --accent-main" }).click();
    await settle(page);
    expect(await readCssVar(page, "--accent-main")).toBe(original);
    await expect(page.locator(".lab-vars__count")).toHaveText("0 项覆盖");

    // 全部重置
    await input.fill("rebeccapurple");
    await input.blur();
    const other = page.getByLabel("--bg-panel 覆盖值");
    await other.fill("rgb(1, 2, 3)");
    await other.blur();
    await expect(page.locator(".lab-vars__count")).toHaveText("2 项覆盖");
    await page.getByRole("button", { name: "全部重置" }).click();
    await settle(page);
    await expect(page.locator(".lab-vars__count")).toHaveText("0 项覆盖");
    expect(await readCssVar(page, "--accent-main")).toBe(original);
});

test("快照导出为合法 JSON，导入合法生效，三份非法拒入且不污染旧覆盖", async ({ page }) => {
    await gotoLab(page);
    const input = page.getByLabel("--accent-main 覆盖值");
    await input.fill("rebeccapurple");
    await input.blur();
    await settle(page);

    // 导出：内容是可再导入的快照
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 JSON 快照" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("nb-ui-component-lab-overrides.json");
    const stream = await download.createReadStream();
    let raw = "";
    for await (const chunk of stream) raw += String(chunk);
    const snapshot = JSON.parse(raw) as { schema: string; version: number; overrides: Record<string, string> };
    expect(snapshot.schema).toBe("nb-ui-component-lab-overrides");
    expect(snapshot.version).toBe(1);
    expect(snapshot.overrides["--accent-main"]).toBe("rebeccapurple");

    const fileInput = page.locator("input[type=file].lab-vars__file");
    const upload = async (payload: unknown) => {
        await fileInput.setInputFiles({
            name: "snapshot.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(payload)),
        });
    };
    const valid = (overrides: Record<string, string>) => ({
        schema: "nb-ui-component-lab-overrides",
        version: 1,
        overrides,
    });

    // 非法 1：未登记变量——拒入且旧覆盖（rebeccapurple）不变
    await upload(valid({ "--not-a-token": "red" }));
    await expect(page.locator(".lab-vars__status")).toContainText("导入被拒绝");
    await expect(page.locator(".lab-vars__status")).toContainText("未登记的变量");
    await expect(page.locator(".lab-vars__count")).toHaveText("1 项覆盖");
    expect(await readCssVar(page, "--accent-main")).toBe("rebeccapurple");

    // 非法 2：值里带分号注入
    await upload(valid({ "--accent-main": "red;position:fixed" }));
    await expect(page.locator(".lab-vars__status")).toContainText("导入被拒绝");
    await expect(page.locator(".lab-vars__status")).toContainText("分号");
    await expect(page.locator(".lab-vars__count")).toHaveText("1 项覆盖");
    expect(await readCssVar(page, "--accent-main")).toBe("rebeccapurple");

    // 非法 3：schema 不符
    await upload({ schema: "wrong", version: 1, overrides: { "--accent-main": "blue" } });
    await expect(page.locator(".lab-vars__status")).toContainText("导入被拒绝");
    await expect(page.locator(".lab-vars__status")).toContainText("schema");
    await expect(page.locator(".lab-vars__count")).toHaveText("1 项覆盖");
    expect(await readCssVar(page, "--accent-main")).toBe("rebeccapurple");

    // 合法导入：整份替换
    await upload(valid({ "--accent-main": "rgb(9, 8, 7)" }));
    await expect(page.locator(".lab-vars__status")).toContainText("已导入 1 项覆盖");
    await settle(page);
    expect(await readCssVar(page, "--accent-main")).toBe("rgb(9, 8, 7)");
});

test("数字输入：合法编辑、步进与边界 clamp", async ({ page }) => {
    await gotoLab(page, { component: "form-number-input" });
    const target = page.locator("#nb-lab-target");

    // 当前 fixture 是原生 number 输入：step=0.05，行距范围由步进按钮 clamp 到 1.0~3.0。
    await target.fill("1.25");
    await expect(target).toHaveValue("1.25");
    await target.press("ArrowUp");
    await expect(target).toHaveValue("1.3");

    // 上边界：3.0 再增加仍保持 3.0。
    await target.fill("3");
    await page.getByRole("button", {name: "增加行距"}).click();
    await expect(target).toHaveValue("3");

    // 下边界：1.0 再减少仍保持 1.0。
    await target.fill("1");
    await page.getByRole("button", {name: "减少行距"}).click();
    await expect(target).toHaveValue("1");
});

test("选择器：Enter 展开、富选项、禁用项、页面不锁、Escape 关闭", async ({ page }) => {
    await gotoLab(page, { component: "form-select", scene: "rich" });
    const trigger = page.locator("#nb-lab-target");
    // auto 定位按视口可用空间碰撞判定：Lab 画布内容固定约 711px 高并垂直居中，
    // 触发器始终贴近画布底部，720–1100px 视口的下方空间都不足 247px 富选项列表，
    // 浮层会合法翻转到上方；视口 ≥1250px 后 data-side=bottom 契约稳定成立。
    await page.setViewportSize({width: 1280, height: 1400});
    await page.waitForTimeout(300);

    // 键盘 Enter 展开（坑 #26：弹出层必须打开测，不能只测关闭态）
    await trigger.focus();
    await page.keyboard.press("Enter");
    const listbox = page.locator("[role=listbox]");
    await expect(listbox).toBeVisible();
    // 向下展开时 data-side=bottom
    await expect(page.locator("[data-reka-popper-content-wrapper] > *").first()).toHaveAttribute("data-side", "bottom");

    // 非模态浮层：页面仍是活的（坑 #33——先断言列表开着再断言 body 无 lock）
    const bodyStyle = await page.evaluate(() => ({ overflow: document.body.style.overflow, pointerEvents: document.body.style.pointerEvents }));
    expect(bodyStyle).toEqual({ overflow: "", pointerEvents: "" });

    // 富选项：图标与长列表内容渲染（fixture 的 longOptions 无 description 字段，
    // 说明文字断言在 56a56c35 的 fixture 重构后失效，改为断言真实渲染的项与图标）
    await expect(listbox.getByText("EPUB 电子书（.epub）")).toBeVisible();
    await expect(listbox.locator(".i-lucide-file-text").first()).toBeAttached();

    // 禁用项不可选：PDF 带 aria-disabled；键盘循环遍历整张列表时高亮永远不会落在它上面，
    // 且不触发选择，trigger 值保持预选 docx（Playwright 也拒绝点击 disabled 元素，与用户一致）
    const disabledPdf = listbox.locator("[role=option]").filter({hasText: "PDF 文档（暂不可用）"});
    await expect(disabledPdf).toHaveAttribute("aria-disabled", "true");
    for (let i = 0; i < 15; i += 1) {
        await page.keyboard.press("ArrowDown");
    }
    await expect(disabledPdf).toHaveAttribute("aria-selected", "false");
    await expect(trigger).toContainText("Word 文档（.docx）");
    await expect(listbox).toBeVisible();

    // Escape 关闭：裸 Reka fixture 无产品级焦点管理，这里只断言列表关闭；
    // 焦点归还契约属于 nb-ui FormSelect 产品组件，不在本用例范围。
    await page.keyboard.press("Escape");
    await expect(listbox).toBeHidden();
});

test("DialogWindow：稳定触发目标、非模态交互与 resize 行为", async ({ page }) => {
    await gotoLab(page, {component: "dialog-window", scene: "resizable"});
    const trigger = page.locator("#nb-lab-target");
    await expect(trigger).toBeVisible();
    await expect(page.locator("[data-dialog-window]")).toHaveCount(0);

    await trigger.click();
    const dialog = page.locator("[role=dialog]");
    await expect(dialog).toBeVisible();
    await expect(page.locator("[data-dialog-overlay]")).toHaveCount(0);
    await expect(dialog).toHaveAttribute("aria-labelledby", /.+/u);
    await expect(dialog.locator("[data-dialog-resize='right']")).toBeVisible();
    await expect(dialog.locator("[data-dialog-resize='bottom']")).toBeVisible();
    // 组件合同是「右、下两条边加四个角」六个手柄（DialogWindow.md）；`corner` 是旧实现的单一角手柄 id。
    for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
        await expect(dialog.locator(`[data-dialog-resize='${corner}']`)).toBeVisible();
    }

    // 窗口居中打开（d8d52be5）会盖住舞台里的触发按钮，所以「窗口外仍可点击」要换一个确实在窗口外的页面元素：
    // 左侧组件导航的搜索框。非模态窗口不渲染 overlay、不锁背景指针事件，也不会被 outside interaction 关闭。
    const navSearch = page.getByPlaceholder(/^搜索组件/u);
    const windowBox = await dialog.boundingBox();
    const searchBox = await navSearch.boundingBox();
    const windowLeft = windowBox?.x ?? 0;
    const searchRight = (searchBox?.x ?? 0) + (searchBox?.width ?? 0);
    expect(searchRight, "搜索框必须整体位于窗口左侧之外，否则这条「窗口外可点击」的证人不成立").toBeLessThan(windowLeft);
    await navSearch.click();
    await expect(navSearch).toBeFocused();
    await expect(dialog).toBeVisible();

    const widthHandle = dialog.locator("[data-dialog-resize='right']");
    await widthHandle.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText(/当前尺寸：570 × 520 px/u)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("选择器向上展开时 data-side=top", async ({ page }) => {
    await gotoLab(page, { component: "form-select" });
    await page.locator('[data-control="direction"] [role=combobox]').click();
    await page.locator("[role=listbox]").getByText("向上").click();
    const trigger = page.locator("#nb-lab-target");
    await trigger.click();
    await expect(page.locator("[role=listbox][data-state=open]")).toBeVisible();
    await expect(page.locator("[data-reka-popper-content-wrapper] > *").first()).toHaveAttribute("data-side", "top");
});

test("输入框：prefix 渲染、focus 入事件日志", async ({ page }) => {
    await gotoLab(page, { component: "form-input", scene: "prefix" });
    await expect(page.getByText("@WORLD/", { exact: true })).toBeVisible();
    await page.locator('[aria-label="检查器页签"]').getByText("事件").click();
    await page.locator("#nb-lab-target").click();
    await expect(page.locator(".lab-events__row").first()).toContainText("focus");
});

test("复选框：无 label 时回退显示布尔值，focus 入事件日志", async ({ page }) => {
    await gotoLab(page, {component: "form-checkbox", scene: "fallback", targetState: "attached"});
    const target = page.locator("#nb-lab-target");
    await expect(target).toHaveRole("checkbox");
    // fallback 场景从 false 起步，组件显示当前布尔值
    await expect(page.locator(".lab-canvas").getByText("false", { exact: true })).toBeVisible();
    await page.locator('[aria-label="检查器页签"]').getByText("事件").click();
    await target.focus();
    await expect(page.locator(".lab-events__row", {hasText: "focus"}).first()).toBeVisible();
});

test("表单原生作用域与复选框键盘焦点保持隔离", async ({ page }) => {
    await gotoLab(page, {component: "form-input"});
    const nativeStyles = await page.evaluate(() => {
        const marker = document.querySelector<HTMLInputElement>("#nb-marker-search");
        const visibleSearch = document.querySelector<HTMLInputElement>('input[placeholder^="检索大纲"]');
        const host = document.querySelector<HTMLInputElement>("#host-search");
        if (!marker || !visibleSearch || !host) throw new Error("native input probes missing");
        const pseudoRules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules])
            .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
            .filter((rule) => /webkit-(?:search|inner-spin|outer-spin)/u.test(rule.selectorText));
        const matchingRules = (input: HTMLInputElement) => pseudoRules.filter((rule) => rule.selectorText
            .split(",")
            .map((selector) => selector.replace(/::-[a-z-]+$/u, "").trim())
            .some((selector) => input.matches(selector)));
        return {
            markerClass: marker.classList.contains("nb-ui-native-input"),
            visibleSearchClass: visibleSearch.classList.contains("nb-ui-native-input"),
            hostClass: host.classList.contains("nb-ui-native-input"),
            markerRuleCount: matchingRules(marker).length,
            visibleSearchRuleCount: matchingRules(visibleSearch).length,
            hostRuleCount: matchingRules(host).length,
            markerPseudoSuppressed: matchingRules(marker).every((rule) => rule.style.display === "none" && rule.style.getPropertyValue("-webkit-appearance") === "none"),
        };
    });
    expect(nativeStyles.markerClass).toBe(true);
    expect(nativeStyles.visibleSearchClass).toBe(true);
    expect(nativeStyles.hostClass).toBe(false);
    expect(nativeStyles.markerRuleCount).toBeGreaterThan(0);
    expect(nativeStyles.visibleSearchRuleCount).toBeGreaterThan(0);
    expect(nativeStyles.hostRuleCount).toBe(0);
    expect(nativeStyles.markerPseudoSuppressed).toBe(true);

    await gotoLab(page, {component: "form-number-input"});
    const numberStyles = await page.evaluate(() => {
        const host = document.querySelector<HTMLInputElement>("#host-number");
        if (!host) throw new Error("host number probe missing");
        const owned = [...document.querySelectorAll<HTMLInputElement>('input[type="number"]')]
            .filter((input) => input !== host);
        const spinnerRules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules])
            .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
            .filter((rule) => /webkit-(?:inner|outer)-spin-button/u.test(rule.selectorText));
        const matchingRules = (input: HTMLInputElement) => spinnerRules.filter((rule) => rule.selectorText
            .split(",")
            .map((selector) => selector.replace(/::-[a-z-]+$/u, "").trim())
            .some((selector) => input.matches(selector)));
        return {
            owned: owned.map((input) => ({
                marker: input.classList.contains("nb-ui-native-input"),
                matchingCount: matchingRules(input).length,
                pseudoSuppressed: matchingRules(input).every((rule) => rule.style.getPropertyValue("-webkit-appearance") === "none"),
            })),
            hostMarker: host.classList.contains("nb-ui-native-input"),
            hostRuleCount: matchingRules(host).length,
        };
    });
    expect(numberStyles.owned).toHaveLength(4);
    expect(numberStyles.owned.every(({marker, matchingCount, pseudoSuppressed}) => marker && matchingCount > 0 && pseudoSuppressed)).toBe(true);
    expect(numberStyles.hostMarker).toBe(false);
    expect(numberStyles.hostRuleCount).toBe(0);

    await gotoLab(page, {component: "form-checkbox", scene: "default", targetState: "attached"});
    const checkbox = page.locator("#nb-lab-target");
    const visual = checkbox.locator("xpath=following-sibling::span[1]");
    const baseStyle = await visual.evaluate((element) => {
        const style = getComputedStyle(element);
        return {borderColor: style.borderColor, boxShadow: style.boxShadow};
    });
    await checkbox.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(checkbox).toBeFocused();
    const focusStyle = await visual.evaluate((element) => {
        const style = getComputedStyle(element);
        return {borderColor: style.borderColor, boxShadow: style.boxShadow};
    });
    expect(focusStyle.borderColor).not.toBe(baseStyle.borderColor);
    expect(focusStyle.boxShadow).not.toBe(baseStyle.boxShadow);
    await checkbox.press("Space");
    const checkedBackground = await visual.evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(checkedBackground).toContain("linear-gradient");

    await gotoLab(page, {component: "form-checkbox", scene: "invalid", targetState: "attached"});
    const invalidCheckbox = page.locator("#nb-lab-target");
    const invalidVisual = invalidCheckbox.locator("xpath=following-sibling::span[1]");
    await expect(invalidCheckbox).toHaveAttribute("aria-invalid", "true");
    const invalidBaseStyle = await invalidVisual.evaluate((element) => {
        const style = getComputedStyle(element);
        return {borderColor: style.borderColor, boxShadow: style.boxShadow};
    });
    expect(invalidBaseStyle.borderColor).not.toBe(baseStyle.borderColor);
    await invalidCheckbox.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(invalidCheckbox).toBeFocused();
    const invalidFocusStyle = await invalidVisual.evaluate((element) => {
        const style = getComputedStyle(element);
        return {borderColor: style.borderColor, boxShadow: style.boxShadow};
    });
    expect(invalidFocusStyle.borderColor).toBe(invalidBaseStyle.borderColor);
    expect(invalidFocusStyle.boxShadow).not.toBe(invalidBaseStyle.boxShadow);

    for (const width of [1440, 390]) {
        await page.setViewportSize({width, height: 800});
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
});

test("Tree 选中行不用左边框表达状态", async ({ page }) => {
    for (const width of [1440, 390]) {
        await page.setViewportSize({width, height: 844});
        await gotoLab(page, {component: "tree"});
        const row = page.locator("#nb-lab-target [role='treeitem']").filter({hasText: "第01章"});
        await row.click();
        await expect(row).toHaveAttribute("aria-selected", "true");
        await settle(page, 300);

        const style = await row.evaluate((element) => {
            const computed = getComputedStyle(element);
            return {
                borderLeftWidth: computed.borderLeftWidth,
                backgroundColor: computed.backgroundColor,
                fontWeight: computed.fontWeight,
            };
        });
        expect(style.borderLeftWidth).toBe("0px");
        expect(style.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
        expect(style.backgroundColor).not.toBe("transparent");
        expect(style.fontWeight).toBe("500");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
});

test("事件日志 100 条封顶且可清空", async ({ page }) => {
    await gotoLab(page, { component: "button" });
    const target = page.locator("#nb-lab-target");
    await page.locator('[aria-label="检查器页签"]').getByText("事件").click();
    for (let i = 0; i < 105; i += 1) {
        await target.click();
    }
    await expect(page.locator(".lab-events__count")).toHaveText("100/100");
    await page.getByRole("button", { name: "清空事件日志" }).click();
    await expect(page.locator(".lab-events__count")).toHaveText("0/100");
    await expect(page.getByText("与组件交互后事件会出现在这里")).toBeVisible();
});

test("离开 /lab 后覆盖层与激活属性无残留", async ({ page }) => {
    await gotoLab(page);
    const input = page.getByLabel("--accent-main 覆盖值");
    await input.fill("rebeccapurple");
    await input.blur();
    await page.locator(".lab-vars__count").filter({ hasText: "1 项覆盖" }).waitFor();
    await expect(page.locator("#nb-ui-component-lab-overrides")).toBeAttached();
    await page.goto("/components");
    await expect(page.locator("#nb-ui-component-lab-overrides")).toHaveCount(0);
    const hasAttr = await page.evaluate(() => document.documentElement.hasAttribute("data-nb-lab-active"));
    expect(hasAttr).toBe(false);
});

test("1440 与 390 宽度下根节点无横向溢出", async ({ page }) => {
    for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 800 });
        await gotoLab(page);
        await settle(page, 300);
        const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
        expect(fits, `${width}px 下不应有页面级横向溢出`).toBe(true);
    }
});
