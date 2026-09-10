import type {Page} from "playwright-core";
import type {SmokeFailure} from "./agent-profile-nav";
import {assert, closeLeftoverDialogWindow} from "./agent-profile-nav";

/**
 * 验证 AgentProfileSettingsView 在 Component Lab 中的 DialogWindow 组合场景。
 * 只使用确定性 fixture，不访问真实配置或业务 API。
 */
export async function assertAgentProfileSettingsDialogSmoke(page: Page, failures: SmokeFailure[]): Promise<void> {
    try {
        const treeItem = page.locator('[role="treeitem"]').filter({hasText: /^AgentProfileSettingsView$/u});
        await treeItem.click();
        const subject = page.locator("[data-lab-subject]").first();
        await subject.waitFor({state: "visible", timeout: 10_000});

        const sceneGroup = page.locator('[role="group"][aria-label="场景"]');
        const dialogScene = sceneGroup.locator('[role="radio"]').filter({hasText: "DialogWindow 内嵌"}).first();
        await dialogScene.click();
        await page.waitForFunction(
            () => [...document.querySelectorAll('[role="group"][aria-label="场景"] [role="radio"]')]
                .some((element) => element.getAttribute("aria-checked") === "true" && element.textContent?.includes("DialogWindow 内嵌")),
            undefined,
            {timeout: 10_000},
        );

        const dialog = page.locator('[data-dialog-window][data-state="open"]');
        await dialog.waitFor({state: "visible", timeout: 10_000});
        const geometry = await page.evaluate(() => {
            const element = document.querySelector<HTMLElement>('[data-dialog-window][data-state="open"]');
            const rect = element?.getBoundingClientRect();
            return {
                rect: rect ? {left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom} : null,
                viewport: {width: window.innerWidth, height: window.innerHeight},
                documentOverflow: {
                    width: document.documentElement.scrollWidth,
                    clientWidth: document.documentElement.clientWidth,
                    viewportWidth: window.innerWidth,
                },
            };
        });
        assert(
            geometry.rect !== null
                && geometry.rect.left >= 0
                && geometry.rect.top >= 0
                && geometry.rect.right <= geometry.viewport.width
                && geometry.rect.bottom <= geometry.viewport.height,
            failures,
            `Agent Profile DialogWindow 应收敛在视口内：${JSON.stringify(geometry.rect)} / ${JSON.stringify(geometry.viewport)}`,
        );
        console.log(`Agent Profile DialogWindow geometry: ${JSON.stringify(geometry)}`);
        assert(
            geometry.documentOverflow.width <= geometry.documentOverflow.clientWidth,
            failures,
            `Agent Profile DialogWindow 不应造成页面级横向溢出：${JSON.stringify(geometry.documentOverflow)}`,
        );
        assert(await dialog.locator("[data-lab-subject]").count() === 1, failures, "Agent Profile DialogWindow 应包含受控设置视图");
        const composition = await page.evaluate(() => {
            const windowElement = document.querySelector<HTMLElement>('[data-dialog-window][data-state="open"]');
            const rail = windowElement?.querySelector<HTMLElement>("aside");
            const nav = rail?.querySelector<HTMLElement>("nav");
            const detail = windowElement?.querySelector<HTMLElement>("section");
            const railLine = rail ? getComputedStyle(rail, "::after") : null;
            return {
                railBorderRight: rail ? getComputedStyle(rail).borderRightWidth : "",
                railLineDisplay: railLine?.display ?? "",
                railLineWidth: railLine?.width ?? "",
                railLineTop: railLine?.top ?? "",
                railLineBottom: railLine?.bottom ?? "",
                railPaddingLeft: rail ? getComputedStyle(rail).paddingLeft : "",
                navBorder: nav ? getComputedStyle(nav).borderTopWidth : "",
                navPadding: nav ? getComputedStyle(nav).paddingTop : "",
                detailBorder: detail ? getComputedStyle(detail).borderTopWidth : "",
            };
        });
        assert(
            composition.railBorderRight === "0px"
                && composition.railLineDisplay !== "none"
                && composition.railLineWidth !== "0px"
                && composition.railLineTop !== "0px"
                && composition.railLineBottom !== "0px"
                && composition.railPaddingLeft !== "0px"
                && composition.navBorder === "0px"
                && composition.navPadding === "0px"
                && composition.detailBorder === "0px",
            failures,
            `DialogWindow 内嵌视图应使用单层线条布局：栏间竖线两端留边距、子分栏无卡片描边 ${JSON.stringify(composition)}`,
        );
        const columnLayout = await page.evaluate(() => {
            const windowElement = document.querySelector<HTMLElement>('[data-dialog-window][data-state="open"]');
            const scroller = windowElement?.querySelector<HTMLElement>('section div[class*="overflow-y-auto"]');
            const scrollerRect = scroller?.getBoundingClientRect();
            const labelId = windowElement?.getAttribute("aria-labelledby") ?? "";
            const title = labelId ? document.getElementById(labelId) : null;
            const windowRect = windowElement?.getBoundingClientRect();
            const titleRect = title?.getBoundingClientRect();
            return {
                footers: windowElement ? windowElement.querySelectorAll("footer").length : 0,
                bottomGap: windowRect && scrollerRect ? Math.round(windowRect.bottom - scrollerRect.bottom) : null,
                titleText: title?.textContent?.trim() ?? "",
                titleCenterOffset: windowRect && titleRect
                    ? Math.round((titleRect.left + titleRect.width / 2) - (windowRect.left + windowRect.width / 2))
                    : null,
                pane: scroller ? Math.round(scroller.getBoundingClientRect().width) : 0,
                column: scroller?.firstElementChild ? Math.round(scroller.firstElementChild.getBoundingClientRect().width) : 0,
            };
        });
        assert(
            columnLayout.footers === 0 && columnLayout.bottomGap !== null && columnLayout.bottomGap <= 2,
            failures,
            `就地保存不应有底部动作栏，内容列直接落到窗口底边：${JSON.stringify(columnLayout)}`,
        );
        assert(
            columnLayout.titleCenterOffset !== null && Math.abs(columnLayout.titleCenterOffset) <= 2,
            failures,
            `DialogWindow 标题应居中：${JSON.stringify(columnLayout)}`,
        );
        assert(
            columnLayout.titleText.includes("Agent Profile 设置") && columnLayout.titleText.includes("全局设定"),
            failures,
            `DialogWindow 标题应由宿主拼出页面身份与作用域：${JSON.stringify(columnLayout.titleText)}`,
        );
        assert(
            columnLayout.column > 0 && columnLayout.column <= 769 && columnLayout.column <= columnLayout.pane,
            failures,
            `详情内容列应在宽窗口下封顶：${JSON.stringify(columnLayout)}`,
        );
        const disclosure = dialog.locator('button[aria-expanded]').filter({hasText: "高级模型参数"}).first();
        await disclosure.click();
        await page.waitForTimeout(60);
        const disclosureAnimation = await page.evaluate(() => {
            const content = document.querySelector<HTMLElement>('[data-dialog-window][data-state="open"] .nb-collapsible-content');
            return {
                state: content?.dataset.state ?? "",
                animations: content ? content.getAnimations().map((animation) => (animation as CSSAnimation).animationName) : [],
            };
        });
        assert(
            disclosureAnimation.state === "open" && disclosureAnimation.animations.includes("nb-accordion-down"),
            failures,
            `折叠区段展开始终要走高度动画：${JSON.stringify(disclosureAnimation)}`,
        );
        assert(await dialog.locator('[data-dialog-resize]').count() === 3, failures, "Agent Profile DialogWindow 应提供三个 resize 手柄");
        assert(await dialog.locator('button[title="关闭"]').count() === 1, failures, "Agent Profile DialogWindow 应提供关闭按钮");
        const selectTrigger = dialog.locator('[role="combobox"]').first();
        await selectTrigger.press("Enter");
        const selectMenu = page.locator(".nb-ui-menu-surface").last();
        await selectMenu.waitFor({state: "visible", timeout: 10_000});
        const selectLayer = await page.evaluate(() => {
            const dialogElement = document.querySelector<HTMLElement>('[data-dialog-window][data-state="open"]');
            const menuElement = document.querySelector<HTMLElement>(".nb-ui-menu-surface:last-of-type");
            return {
                dialogZIndex: dialogElement ? Number.parseInt(getComputedStyle(dialogElement).zIndex, 10) : 0,
                menuZIndex: menuElement ? Number.parseInt(getComputedStyle(menuElement).zIndex, 10) : 0,
            };
        });
        assert(selectLayer.menuZIndex > selectLayer.dialogZIndex, failures, `Dialog 内 FormSelect 下拉应显示在窗口上层：${JSON.stringify(selectLayer)}`);
        await selectTrigger.press("Escape");

        const initialWidth = await dialog.evaluate((element) => element.getBoundingClientRect().width);
        const widthHandle = dialog.locator('[data-dialog-resize="right"]');
        await widthHandle.focus();
        await page.keyboard.press("ArrowRight");
        await page.waitForFunction(
            (width) => {
                const element = document.querySelector('[data-dialog-window][data-state="open"]');
                return element !== null && element.getBoundingClientRect().width > width;
            },
            initialWidth,
            {timeout: 10_000},
        );

        await dialog.locator('button[title="关闭"]').click();
        await page.waitForFunction(() => document.querySelector('[data-dialog-window][data-state="open"]') === null, undefined, {timeout: 10_000});
        const reopen = page.getByRole("button", {name: "打开 Agent Profile 设置窗口"});
        assert(await reopen.count() === 1, failures, "DialogWindow 关闭后应保留重新打开入口");
        await reopen.click();
        await page.locator('[data-dialog-window][data-state="open"]').waitFor({state: "visible", timeout: 10_000});
    } catch (error) {
        failures.push({kind: "assertion", message: `AgentProfileSettingsView DialogWindow smoke 执行失败：${error instanceof Error ? error.message : String(error)}`});
    }
}

/**
 * 验证窄容器下设置视图退化为单列：导航与详情互斥，靠切换条往返。
 * 容器宽度用 Lab 的「手机」画布预设取得，不动窗口——缩窗口会让 Lab 收起左右侧栏，
 * 后面就再也点不到组件树了。代价是画布窄过 700px 后，Lab 顶栏与侧栏的点击会被画布交互
 * 留下的浮层拦下，所以这一段必须排在其它 Lab 交互之前，结束时画布停在 390 × 844。
 * 显示态由容器查询独占（元素上不挂 display 工具类），所以这里比对的是真实计算样式。
 */
export async function assertAgentProfileSettingsNarrowSmoke(page: Page, failures: SmokeFailure[]): Promise<void> {
    const preset = (label: string) => page.locator('[aria-label="画布宽度"] [role="radio"], [aria-label="画布宽度"] button').filter({hasText: label}).first();
    const waitForRootWidth = (min: number, max: number) => page.waitForFunction(
        (bounds) => {
            const root = document.querySelector<HTMLElement>(".settings-view-root");
            if (root === null) {
                return false;
            }
            const width = root.getBoundingClientRect().width;
            return width >= bounds.min && width <= bounds.max;
        },
        {min, max},
        {timeout: 10_000},
    );
    let stage = "准备";
    try {
        stage = "关闭遗留窗口";
        await closeLeftoverDialogWindow(page);
        stage = "选择组件与场景";
        await page.locator('[role="treeitem"]').filter({hasText: /^AgentProfileSettingsView$/u}).click();
        await page.locator('[role="group"][aria-label="场景"] [role="radio"]').filter({hasText: "全局设定"}).first().click();
        await page.locator(".settings-view-root").first().waitFor({state: "visible", timeout: 10_000});

        const readLayout = () => page.evaluate(() => {
            const root = document.querySelector<HTMLElement>(".settings-view-root");
            const rail = root?.querySelector<HTMLElement>(".settings-nav-aside") ?? null;
            const detail = root?.querySelector<HTMLElement>(".settings-detail-section") ?? null;
            const bar = detail?.querySelector<HTMLElement>(".settings-mobile-bar") ?? null;
            const railLine = rail ? getComputedStyle(rail, "::after") : null;
            return {
                rootWidth: root ? Math.round(root.getBoundingClientRect().width) : 0,
                railDisplay: rail ? getComputedStyle(rail).display : "",
                railWidth: rail ? Math.round(rail.getBoundingClientRect().width) : 0,
                railLineDisplay: railLine?.display ?? "",
                detailDisplay: detail ? getComputedStyle(detail).display : "",
                barDisplay: bar ? getComputedStyle(bar).display : "",
            };
        });

        stage = "宽容器检查";
        await waitForRootWidth(700, 100000);
        const wide = await readLayout();
        assert(
            wide.railDisplay === "flex"
                && wide.railWidth === 276
                && wide.railLineDisplay !== "none"
                && wide.detailDisplay === "flex"
                && wide.barDisplay === "none",
            failures,
            `宽容器应显示双栏、栏间竖线与导航轨宽度：${JSON.stringify(wide)}`,
        );

        stage = "切到手机画布";
        await preset("手机").click();
        await waitForRootWidth(1, 699);
        const collapsed = await readLayout();
        assert(
            collapsed.railDisplay === "none"
                && collapsed.detailDisplay === "flex"
                && collapsed.barDisplay === "flex",
            failures,
            `窄容器应只显示详情并给出切换条：${JSON.stringify(collapsed)}`,
        );

        stage = "打开单列导航";
        await page.locator(".settings-detail-section .settings-mobile-bar button").first().click();
        await page.waitForTimeout(120);
        const opened = await readLayout();
        assert(
            opened.railDisplay === "flex"
                && opened.railWidth >= collapsed.rootWidth - 1
                && opened.railLineDisplay === "none"
                && opened.detailDisplay === "none",
            failures,
            `单列打开导航时导航应占满整行且不画分栏竖线：${JSON.stringify(opened)}`,
        );

        stage = "返回详情列";
        await page.locator(".settings-nav-aside .settings-mobile-bar button").first().click();
        await page.waitForTimeout(120);
        const back = await readLayout();
        assert(
            back.railDisplay === "none" && back.detailDisplay === "flex" && back.barDisplay === "flex",
            failures,
            `从导航返回后应回到详情列：${JSON.stringify(back)}`,
        );

        console.log(`Agent Profile container layout: ${JSON.stringify({wide, collapsed, opened, back})}`);
    } catch (error) {
        failures.push({kind: "assertion", message: `AgentProfileSettingsView 窄容器 smoke 在「${stage}」失败：${error instanceof Error ? error.message : String(error)}`});
    }
}
