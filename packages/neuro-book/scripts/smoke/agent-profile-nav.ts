import type {Page} from "playwright-core";

export type SmokeFailure = {
    kind: "console" | "page" | "assertion";
    message: string;
};

export function assert(condition: boolean, failures: SmokeFailure[], message: string): void {
    if (!condition) failures.push({kind: "assertion", message});
}

/**
 * DialogWindow 场景留下的浮层会拦住 Lab 自身的点击：切换到别的 fixture 前先关掉它。
 */
export async function closeLeftoverDialogWindow(page: Page): Promise<void> {
    const openDialog = page.locator('[data-dialog-window][data-state="open"]');
    if (await openDialog.count() === 0) return;
    await openDialog.locator('button[title="关闭"]').first().click();
    await page.waitForFunction(() => document.querySelector('[data-dialog-window][data-state="open"]') === null, undefined, {timeout: 10_000});
}

/**
 * 验证 AgentProfileNavList 的真实 Component Lab surface。
 * 该函数只操作已登记的 Lab fixture，不访问产品 API、store 或浏览器存储。
 */
export async function runAgentProfileNavSmoke(page: Page, failures: SmokeFailure[]): Promise<void> {
    try {
        await page.setViewportSize({width: 1440, height: 900});
        const treeItem = page.locator('[role="treeitem"]').filter({hasText: /^AgentProfileNavList$/u});
        await treeItem.click();
        const subject = page.locator("[data-lab-subject]").first();
        await subject.waitFor({state: "visible", timeout: 10_000});

        const sceneGroup = page.locator('[role="group"][aria-label="场景"]');
        const scene = (label: string) => sceneGroup.locator('[role="radio"]').filter({hasText: label}).first();
        const profileRows = subject.locator("ul > li > button");
        const search = subject.locator("input[type='search']");
        const defaultButton = () => subject.locator("button").filter({hasText: "默认设置"}).first();

        async function selectScene(label: string): Promise<void> {
            const target = scene(label);
            if (await target.getAttribute("aria-checked") === "true") {
                const alternatives = sceneGroup.locator('[role="radio"]:not([aria-checked="true"])');
                await alternatives.first().click();
                await page.waitForFunction(
                    (expected) => [...document.querySelectorAll('[role="group"][aria-label="场景"] [role="radio"]')].some((element) =>
                        element.getAttribute("aria-checked") === "true" && !element.textContent?.includes(expected)),
                    label,
                    {timeout: 10_000},
                );
            }
            await target.click();
            await page.waitForFunction(
                (expected) => [...document.querySelectorAll('[role="group"][aria-label="场景"] [role="radio"]')].some((element) =>
                    element.getAttribute("aria-checked") === "true" && element.textContent?.includes(expected)),
                label,
                {timeout: 10_000},
            );
            await subject.waitFor({state: "visible", timeout: 10_000});
        }

        async function waitForRows(count: number): Promise<void> {
            await page.waitForFunction(
                (expected) => document.querySelectorAll('[data-lab-subject] ul > li > button').length === expected,
                count,
                {timeout: 10_000},
            );
        }

        async function selectTheme(label: string, id: string): Promise<void> {
            await page.locator('[aria-label="主题"]').click();
            await page.locator('[role="option"]').filter({hasText: label}).first().click();
            await page.waitForFunction((expected) => document.documentElement.dataset.nbTheme === expected, id, {timeout: 10_000});
        }

        async function checkStatusSet(description: string): Promise<void> {
            await selectScene("状态全集");
            await waitForRows(7);
            await page.waitForFunction(() => document.querySelector('[data-lab-subject] [aria-current="page"]')?.textContent?.includes("line-editor") === true, undefined, {timeout: 10_000});
            assert(await subject.getByText("编译中", {exact: true}).count() === 1, failures, `${description} 应显示编译中状态文字`);
            const statusClasses = await profileRows.evaluateAll((rows) => rows.map((row) => row.querySelector(".nb-badge")?.className ?? ""));
            assert(statusClasses.filter((classes) => classes.includes("nb-badge--success")).length === 1, failures, `${description} success Badge 数量错误`);
            assert(statusClasses.filter((classes) => classes.includes("nb-badge--accent")).length === 1, failures, `${description} accent Badge 数量错误`);
            assert(statusClasses.filter((classes) => classes.includes("nb-badge--warning")).length === 2, failures, `${description} warning Badge 数量错误`);
            assert(statusClasses.filter((classes) => classes.includes("nb-badge--danger")).length === 3, failures, `${description} danger Badge 数量错误`);
            assert(await subject.locator('[aria-current="page"]').count() === 1, failures, `${description} 应有一个 aria-current`);
            assert((await subject.locator('[aria-current="page"]').first().textContent() ?? "").includes("line-editor"), failures, `${description} current 应为 line-editor`);
            const iconsAccessible = await subject.locator('[class*="i-lucide-"]').evaluateAll((icons) => icons.every((icon) => icon.getAttribute("aria-hidden") === "true"));
            assert(iconsAccessible, failures, `${description} 装饰图标必须 aria-hidden=true`);
            assert(await subject.locator('[aria-label="清空输入"]').count() === 0, failures, `${description} 不应有 clearable 清空按钮`);
        }
        await selectTheme("NeuroBook", "nbook");
        await checkStatusSet("NeuroBook 主题");


        await search.fill("  Line  ");
        await waitForRows(1);
        assert((await profileRows.first().textContent() ?? "").includes("line-editor"), failures, "name/key 搜索应命中 line-editor");
        assert(await defaultButton().count() === 1, failures, "搜索时默认入口必须保持可见");
        await page.locator('[role="tab"]').filter({hasText: "事件"}).click();
        await page.getByText("update:search", {exact: true}).waitFor({state: "visible", timeout: 10_000});
        const eventPayload = await page.locator(".nb-lab-event-chip").evaluateAll((chips) => chips.map((chip) => chip.parentElement?.textContent ?? ""));
        assert(eventPayload.some((text) => text.includes("  Line  ")), failures, "搜索事件必须保留原始前后空格");

        await search.fill("");
        await waitForRows(7);
        await search.focus();
        assert(await search.evaluate((element) => document.activeElement === element), failures, "清空后搜索焦点必须保持");
        await profileRows.filter({hasText: "编译中"}).first().click();
        await page.getByText("update:activeKey", {exact: true}).waitFor({state: "visible", timeout: 10_000});

        await page.locator('[role="tab"]').filter({hasText: "数据"}).click();
        const reset = page.getByRole("button", {name: "还原"});
        if (await reset.count() === 1) {
            await reset.click();
        }
        await waitForRows(7);

        await selectScene("默认设置");
        assert(await defaultButton().getAttribute("aria-current") === "page", failures, "默认场景入口应有 aria-current");
        assert((await defaultButton().textContent() ?? "").includes("有未保存的修改"), failures, "默认场景应显示 dirty 文案");
        await profileRows.first().click();
        assert((await subject.locator('[aria-current="page"]').first().textContent() ?? "").includes("story-writer"), failures, "Profile 点击后 current 应转移");

        await selectScene("长列表与长文本");
        await waitForRows(30);
        const metrics = await subject.locator("ul").evaluate((list) => {
            const root = list.closest("[data-lab-subject]");
            const searchBox = root?.querySelector("input[type='search']");
            const defaults = [...(root?.querySelectorAll("button") ?? [])].find((button) => button.textContent?.includes("默认设置"));
            const row = list.querySelector("li > button");
            return {
                overflowing: list.scrollHeight > list.clientHeight,
                searchTop: searchBox?.getBoundingClientRect().top ?? 0,
                defaultTop: defaults?.getBoundingClientRect().top ?? 0,
                rootRight: root?.getBoundingClientRect().right ?? 0,
                rowRight: row?.getBoundingClientRect().right ?? 0,
            };
        });
        assert(metrics.overflowing, failures, "长列表必须由列表自身滚动");
        assert(metrics.rowRight <= metrics.rootRight + 1, failures, "长文本不应撑出导航根节点");
        await subject.locator("ul").evaluate((list) => {
            list.scrollTop = list.scrollHeight;
        });
        const afterScroll = await subject.locator("ul").evaluate((list) => {
            const root = list.closest("[data-lab-subject]");
            const searchBox = root?.querySelector("input[type='search']");
            const defaults = [...(root?.querySelectorAll("button") ?? [])].find((button) => button.textContent?.includes("默认设置"));
            return {
                searchTop: searchBox?.getBoundingClientRect().top ?? 0,
                defaultTop: defaults?.getBoundingClientRect().top ?? 0,
            };
        });
        assert(Math.abs(afterScroll.searchTop - metrics.searchTop) < 1, failures, "列表滚动不应移动搜索框");
        assert(Math.abs(afterScroll.defaultTop - metrics.defaultTop) < 1, failures, "列表滚动不应移动默认入口");
        await assertNoPageOverflow(page, failures, "桌面长列表");

        await selectScene("空列表");
        await waitForRows(0);
        assert(await subject.getByText("没有可配置的 Profile", {exact: true}).count() === 1, failures, "空列表应显示空态");
        assert(await defaultButton().count() === 1, failures, "空列表仍应保留默认入口");

        await selectScene("搜索无匹配");
        assert(await search.inputValue() === "不存在的搜索词xyz", failures, "无匹配场景应恢复搜索初值");
        await waitForRows(0);
        assert(await subject.getByText("没有匹配的 Profile", {exact: true}).count() === 1, failures, "无匹配应显示无匹配文案");
        assert(await subject.locator('[aria-current="page"]').count() === 0, failures, "被过滤 Profile 不应保留 aria-current");
        await search.focus();
        await search.fill("");
        await waitForRows(2);
        assert(await search.evaluate((element) => document.activeElement === element), failures, "无匹配清空后焦点必须保持");

        await selectScene("状态全集");
        await waitForRows(7);
        await search.fill("");
        await search.focus();
        await page.keyboard.press("Tab");
        const currentDefault = defaultButton();
        assert(await currentDefault.evaluate((element) => document.activeElement === element), failures, "Tab 应从搜索进入默认按钮");
        await page.keyboard.press("Tab");
        assert(await profileRows.first().evaluate((element) => document.activeElement === element), failures, "Tab 应从默认按钮进入第一个 Profile");
        await page.keyboard.press("Enter");
        assert((await subject.locator('[aria-current="page"]').first().textContent() ?? "").includes("story-writer"), failures, "Enter 应选择 Profile");
        await currentDefault.focus();
        await page.keyboard.press("Space");
        assert(await currentDefault.getAttribute("aria-current") === "page", failures, "Space 应选择默认入口");

        await selectTheme("macOS", "macos");
        await checkStatusSet("macOS 主题");
        await page.emulateMedia({reducedMotion: "reduce"});
        await checkStatusSet("macOS reduced-motion");
        await page.emulateMedia({reducedMotion: "no-preference"});

        await selectScene("长列表与长文本");
        await waitForRows(30);
        await page.setViewportSize({width: 390, height: 844});
        await page.waitForFunction(() => document.querySelectorAll(".nb-lab-panel-head").length === 0, undefined, {timeout: 10_000});
        await page.locator("button").filter({hasText: /^手机$/u}).first().click();
        await page.getByText("390 × 844", {exact: false}).first().waitFor({state: "visible", timeout: 10_000});
        const mobileMetrics = await subject.locator("ul").evaluate((list) => {
            const root = list.closest("[data-lab-subject]");
            return {overflowing: list.scrollHeight > list.clientHeight, width: root?.getBoundingClientRect().width ?? 0};
        });
        assert(mobileMetrics.overflowing, failures, "390 × 844 下列表仍应内部滚动");
        assert(mobileMetrics.width <= 280, failures, `390 × 844 下导航宽度应受控：${mobileMetrics.width}px`);
        await assertNoPageOverflow(page, failures, "390 × 844");
        assert((await profileRows.first().textContent() ?? "").includes("一个用于验证窄屏截断"), failures, "390 × 844 下长文本 Profile 应可见");
        await page.setViewportSize({width: 1440, height: 900});
    } catch (error) {
        failures.push({kind: "assertion", message: `AgentProfileNavList smoke 执行失败：${error instanceof Error ? error.message : String(error)}`});
    }
}

async function assertNoPageOverflow(page: Page, failures: SmokeFailure[], label: string): Promise<void> {
    const {documentWidth, viewportWidth} = await page.evaluate(() => ({documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth}));
    assert(documentWidth <= viewportWidth, failures, `${label} 不应产生页面级横向溢出：${documentWidth}px > ${viewportWidth}px`);

}
