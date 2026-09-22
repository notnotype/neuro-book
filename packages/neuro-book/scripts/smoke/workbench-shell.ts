import type {Page} from "playwright-core";
import type {SmokeFailure} from "./agent-profile-nav";
import type {LeafRect} from "./workbench-lab";
import {assert} from "./agent-profile-nav";
import {
    checkpoint,
    choosePanelMenu,
    chooseViewMenu,
    clickCenter,
    diagnosticsOf,
    containerHost,
    containerMount,
    containerTab,
    dragSash,
    eventCount,
    expectCollapsed,
    freshDiagnostics,
    gestureDiagnostics,
    expectVisible,
    FIXTURE_ROOT,
    invokeViewAction,
    lastEvent,
    mark,
    muteStageHandles,
    NAV_SEARCH,
    NAV_TREE,
    near,
    partRoot,
    readGeometry,
    rectOf,
    resetStageScroll,
    restoreStageHandles,
    sashSelector,
    selectFixture,
    waitForGeometry,
    selectScene,
    setRightSidebar,
    settleMenus,
    SHELL_ROOT,
    viewSection,
    viewSectionIn,
} from "./workbench-lab";

/**
 * 工作台骨架（`WorkbenchShellLayoutFixture`）的真实浏览器验收。
 *
 * 覆盖既有八步在新容器 / Grid 模型下的等价断言：找到部件、默认与跨度、Panel 位置与对齐、
 * 分隔线拖动与取消、三种状态（32px 标题头 / 隐藏 / 最大化）、View 贡献动作与「移动到」、实例生命周期、
 * 窄画布紧凑呈现、静置不抖动、复位。
 *
 * 容器与 View 的**跨容器移动 / 单选 / 清理**（`data-container-*` / `data-grid-scope` 那一层）在
 * `workbench-containers.ts` 里，按 `--suite workbench-shell` 一起跑。
 *
 * 步骤④b 单独量分隔线的**收起边界**与**动效**：拖到零之后量 `.sash-line` 的渲染矩形、
 * 裁剪后的可见矩形与内联几何（证明 3px 装饰带没被 `overflow-hidden` 裁细），再用真实指针的 rAF
 * 时间序列证明「短停留不亮 / 停留后渐显 / 离开淡出 / reduced-motion 无渐变」。
 *
 * 定位说明见 `workbench-lab.ts`：标题动作按作用域收窄（框架归 Panel、View 归对应 Section），
 * 拖动面是标题本体 `[data-workbench-drag-kind]`，分隔线是 `[data-sash="<branchId>:<index>"]`。
 */
export async function assertWorkbenchShellSmoke(page: Page, failures: SmokeFailure[]): Promise<void> {
    let stage = "准备";
    // 卡住时快速失败：默认 30s 的可操作性等待会把一次失败放大成几分钟，日志里看不出停在哪一步。
    page.setDefaultTimeout(8000);
    try {
        // ① 找到部件：部件名称与别名都能搜到真实组件。
        mark("按部件名称与别名检索");
        await page.locator('[role="tab"]').filter({hasText: "文档"}).click();
        const searches: {query: string; expected: string}[] = [
            {query: "活动栏", expected: "WorkbenchActivityBar"},
            {query: "Activity Bar", expected: "WorkbenchActivityBar"},
            {query: "Panel", expected: "WorkbenchPanelSurface"},
            {query: "主侧边栏", expected: "WorkbenchContainerSurface"},
            {query: "Secondary Side Bar", expected: "WorkbenchContainerSurface"},
            {query: "工作台骨架", expected: "WorkbenchShellLayout"},
        ];
        for (const item of searches) {
            await page.locator(NAV_SEARCH).fill(item.query);
            await page.waitForTimeout(150);
            const titles = await page.locator(NAV_TREE).allTextContents();
            assert(
                titles.some((title) => title.includes(item.expected)),
                failures,
                `搜「${item.query}」应命中 ${item.expected}（实际命中：${titles.slice(0, 8).join(" / ")}）`,
            );
        }
        await selectFixture(page, "WorkbenchShellLayout");

        // ② 默认与跨度：activity 通高、Panel 不跨活动栏。
        stage = "步骤② 默认几何";
        mark("默认 bottom/center 的边界");
        await selectScene(page, "default");
        await checkpoint(page, stage);
        const base = await readGeometry(page);
        assert(base.mode === "split", failures, `默认场景应是分栏呈现：实际 ${base.mode}`);
        assert(base.activity !== null && base.panel !== null && base.statusbar !== null, failures, "默认场景应渲染 activity / panel / statusbar 三个叶");
        assert(base.diagnostics === "", failures, `默认场景不该有布局诊断：${base.diagnostics}`);
        if (base.activity && base.panel && base.statusbar) {
            assert(near(base.activity.bottom, base.statusbar.top), failures, `activity 应通高到状态栏顶边：${base.activity.bottom} vs ${base.statusbar.top}`);
            assert(base.panel.left >= base.activity.right - 1.5, failures, `Panel 不得切进活动栏：panel.left=${base.panel.left} activity.right=${base.activity.right}`);
            if (base.editor) {
                assert(near(base.panel.left, base.editor.left, 2) && near(base.panel.right, base.editor.right, 2), failures, "bottom/center 的 Panel 应与编辑区同列");
            }
        }
        assert(base.overflow <= 0, failures, `默认场景不应有页面级横向溢出：${base.overflow}px`);

        mark("四种位置都不跨活动栏");
        for (const position of ["左侧", "右侧", "顶部", "底部"]) {
            if (!await choosePanelMenu(page, ["面板位置", position], failures, `切换到${position}位置`)) continue;
            const geometry = await readGeometry(page);
            if (geometry.activity && geometry.panel) {
                assert(geometry.panel.left >= geometry.activity.right - 1.5, failures, `${position}位置的 Panel 不得切进活动栏：${geometry.panel.left} vs ${geometry.activity.right}`);
                assert(geometry.panel.width > 0 && geometry.panel.height > 0, failures, `${position}位置的 Panel 应有可见尺寸`);
            }
            assert(geometry.overflow <= 0, failures, `${position}位置不应有横向溢出：${geometry.overflow}px`);
        }

        await checkpoint(page, "步骤③ 位置循环之后");
        mark("四种水平对齐的跨度");
        for (const alignment of ["居中", "左对齐", "右对齐", "两端对齐"]) {
            if (!await choosePanelMenu(page, ["面板对齐", alignment], failures, `切换到${alignment}`)) continue;
            // 「跨过左右侧栏」要先让右栏在场；显示右栏会把 Panel 挤窄（Lab 画布放不下两侧栏 + 可用编辑区），
            // 所以顺序必须是「先选对齐、后显示右栏」，断言完再藏回去，免得后面的菜单点不动。
            if (alignment === "两端对齐") {
                await clickCenter(page, page.locator('[data-activity-id="toggle-right"]'), "显示辅助侧栏");
                await page.waitForTimeout(200);
            }
            const geometry = await readGeometry(page);
            if (!geometry.activity || !geometry.panel || !geometry.editor) continue;
            assert(geometry.panel.left >= geometry.activity.right - 1.5, failures, `${alignment}的 Panel 不得切进活动栏`);
            if (alignment === "居中") {
                assert(near(geometry.panel.left, geometry.editor.left, 2), failures, "居中对齐应落在编辑区列内");
            }
            if (alignment === "两端对齐" && geometry.left && geometry.right) {
                assert(geometry.panel.left <= geometry.left.left + 2 && geometry.panel.right >= geometry.right.right - 2, failures, "两端对齐应跨过左右侧栏");
                assert(geometry.panel.left >= geometry.activity.right - 1.5, failures, "两端对齐仍然不得跨过活动栏");
                await clickCenter(page, page.locator('[data-activity-id="toggle-right"]'), "收起辅助侧栏");
                await page.waitForTimeout(200);
            }
        }

        await checkpoint(page, "步骤③ 对齐循环之后");

        // ③ 分隔线：一次手势只产生一次保存事件，Escape 取消回基线。
        stage = "步骤④ 分隔线拖动与取消";
        mark("拖动与取消");
        await choosePanelMenu(page, ["面板对齐", "居中"], failures, "回到居中对齐");
        await resetStageScroll(page);
        const beforeDrag = await readGeometry(page);
        const resizeEvents = await eventCount(page, "shell-resize");
        const diagnosticsBaseline = await diagnosticsOf(page);
        if (beforeDrag.left !== null && beforeDrag.panel !== null) {
            const leftBefore = beforeDrag.left.width;
            await dragSash(page, "body:0", 40, 0);
            const afterDrag = await readGeometry(page);
            if (afterDrag.left) {
                assert(Math.abs(afterDrag.left.width - leftBefore) > 10, failures, `拖动左栏边界应改变左栏宽度：${leftBefore} → ${afterDrag.left.width}`);
            }
            assert(await eventCount(page, "shell-resize") === resizeEvents + 1, failures, "一次手势只应产生一次 shell-resize（不逐帧保存）");
            const dragFresh = freshDiagnostics(diagnosticsBaseline, await diagnosticsOf(page));
            assert(dragFresh.length === 0, failures, `拖动不应留下诊断：${dragFresh.join(" | ")}`);

            const cancelEvents = await eventCount(page, "shell-resize");
            const widthBeforeCancel = (await readGeometry(page)).left?.width ?? 0;
            await dragSash(page, "body:0", 60, 0, {escape: true});
            const afterCancel = await readGeometry(page);
            assert(near(afterCancel.left?.width ?? 0, widthBeforeCancel, 1.5), failures, `Escape 取消应回到基线宽度：${widthBeforeCancel} → ${afterCancel.left?.width}`);
            assert(await eventCount(page, "shell-resize") === cancelEvents, failures, "Escape 取消不得保存");
        }

        mark("容器内部的 View 分隔线（同一份手势合同，另一层 Grid）");
        const viewSizesBefore = await eventCount(page, "view-sizes");
        const primaryLeaf = await rectOf(page, `${containerHost("lab.container.left")} [data-panel-id="view:lab.primary"]`);
        const viewSash = `${containerHost("lab.container.left")} [data-sash="container:lab.container.left:0"]`;
        const viewSashRect = await rectOf(page, viewSash);
        if (viewSashRect !== null && primaryLeaf !== null) {
            await dragSash(page, "container:lab.container.left:0", 0, 60);
            const afterViewDrag = await rectOf(page, `${containerHost("lab.container.left")} [data-panel-id="view:lab.primary"]`);
            assert(afterViewDrag !== null && Math.abs(afterViewDrag.height - primaryLeaf.height) > 10, failures, `容器内拖动应改变 View 高度：${primaryLeaf.height} → ${afterViewDrag?.height}`);
            assert(await eventCount(page, "view-sizes") > viewSizesBefore, failures, "容器内一次手势应折成一批 view-sizes");
        }

        await checkpoint(page, "步骤④ 拖动之后");

        // ④b 分隔线的收起边界与动效：这两件事此前只有「样式/计时器存在」的间接证据，
        // 所以这里用真实拖收起量装饰带几何、用真实指针采样 hover 的透明度时间序列。
        stage = "步骤④b 分隔线装饰带与 hover";
        mark("拖收起 left / right / panel：装饰带厚度与裁剪盒");
        await settleMenus(page);
        await muteStageHandles(page);
        const sashDiagnosticsBaseline = await diagnosticsOf(page);

        // 分隔线跟着指针走：向左拖＝左栏变窄，越过 24px 收起阈值就贴到零（收起边界＝前邻 0px）。
        // 拖动量取「原宽 − 120」而不是「原宽 + 余量」：理想尺寸 120 已经低于 min(160) − 阈值(24)，
        // 足够触发收起，又能让指针留在画布里（不必依赖视口外的合成事件）。
        const leftWidthBefore = (await readGeometry(page)).left?.width ?? 0;
        if (leftWidthBefore <= 0) {
            failures.push({kind: "assertion", message: `收起边界探测需要左栏先在场上，实际宽度 ${leftWidthBefore}`});
        } else {
            const collapseLeft = Math.max(60, leftWidthBefore - 120);
            assert(await dragSash(page, "body:0", -collapseLeft, 0), failures, "应能在 body:0 上把左栏边界拖到零");
            const leftCollapsed = await rectOf(page, containerMount("lab.container.left"));
            assert(leftCollapsed !== null && leftCollapsed.width <= 1, failures, `拖到零后左栏内容应零宽：${JSON.stringify(leftCollapsed)}`);
            assertSashBand(await readSashBand(page, "body:0"), failures, "左栏收起边界（body:0）的装饰带");
            // 回拖原宽：拖动以按下时的呈现为锚，从 0 回拖 W 就回到原宽（而不是 0 + W + 溢出量）。
            await dragSash(page, "body:0", leftWidthBefore, 0);
            const leftRestored = (await readGeometry(page)).left;
            assert(leftRestored !== null && leftRestored.width > 32, failures, `从零回拖后左栏应恢复展开：${JSON.stringify(leftRestored)}`);
        }

        mark("右栏拖到零：body:1 的装饰带");
        await setRightSidebar(page, true);
        const rightBefore = (await readGeometry(page)).right;
        if (rightBefore === null || rightBefore.width <= 0) {
            failures.push({kind: "assertion", message: `收起边界探测需要右栏先在场上：${JSON.stringify(rightBefore)}`});
        } else {
            // 竖线在右栏左缘：向右拖＝右栏变窄。
            const collapseRight = Math.max(60, rightBefore.width - 120);
            assert(await dragSash(page, "body:1", collapseRight, 0), failures, "应能在 body:1 上把右栏边界拖到零");
            const rightCollapsed = await rectOf(page, containerMount("lab.container.right"));
            assert(rightCollapsed !== null && rightCollapsed.width <= 1, failures, `拖到零后右栏内容应零宽：${JSON.stringify(rightCollapsed)}`);
            assertSashBand(await readSashBand(page, "body:1"), failures, "右栏收起边界（body:1）的装饰带");
            await dragSash(page, "body:1", -rightBefore.width, 0);
            const rightRestored = (await readGeometry(page)).right;
            assert(rightRestored !== null && rightRestored.width > 32, failures, `从零回拖后右栏应恢复展开：${JSON.stringify(rightRestored)}`);
            await setRightSidebar(page, false);
        }

        mark("Panel 拖到零：panel-stack:0 的装饰带（另一根轴）");
        const panelBefore = (await readGeometry(page)).panel?.height ?? 0;
        if (panelBefore <= 32) {
            failures.push({kind: "assertion", message: `收起边界探测需要 Panel 先有高度，实际 ${panelBefore}`});
        } else {
            // 横线在 Panel 上缘：向下拖＝Panel 变矮；理想高度取 40，低于 min(80) − 阈值(24)。
            const collapsePanel = Math.max(40, panelBefore - 40);
            assert(await dragSash(page, "panel-stack:0", 0, collapsePanel), failures, "应能在 panel-stack:0 上把 Panel 边界拖到零");
            const panelCollapsed = (await readGeometry(page)).panel;
            assert(panelCollapsed !== null && panelCollapsed.height <= 1, failures, `拖到零后 Panel 应零高：${JSON.stringify(panelCollapsed)}`);
            assertSashBand(await readSashBand(page, "panel-stack:0"), failures, "Panel 收起边界（panel-stack:0）的装饰带");
            await dragSash(page, "panel-stack:0", 0, -panelBefore);
            const panelRestored = (await readGeometry(page)).panel;
            assert(panelRestored !== null && panelRestored.height > 32, failures, `从零回拖后 Panel 应恢复展开：${JSON.stringify(panelRestored)}`);
        }

        mark("hover 时间序列：短停留不亮 / 停留后渐显 / 离开淡出 / reduced-motion 无渐变");
        await resetStageScroll(page);
        await page.mouse.move(4, 4);
        await page.waitForTimeout(150);
        const seamRect = await rectOf(page, sashSelector("body:0"));
        if (seamRect === null || seamRect.width + seamRect.height <= 0) {
            failures.push({kind: "assertion", message: `找不到 body:0 分隔元素（${JSON.stringify(seamRect)}），无法采样 hover 时间序列`});
        } else {
            const seamX = seamRect.left + seamRect.width / 2;
            const seamY = seamRect.top + seamRect.height / 2;
            const awayX = seamX + 140;
            await page.emulateMedia({reducedMotion: "no-preference"});
            // ① 短停留：进来 150ms 就离开，线不得亮（延时是防误触语义，不是动画装饰）。
            await installSashHoverProbe(page, "body:0");
            await page.mouse.move(seamX, seamY);
            await page.waitForTimeout(150);
            await page.mouse.move(awayX, seamY);
            await page.waitForTimeout(400);
            assertShortHover(await readSashHoverProbe(page), failures, "no-preference 短停留 150ms");
            // ② 长停留：停留计时后 0 → 1 之间必须有中间帧（只看到最终 1 不能证明有渐变）。
            await installSashHoverProbe(page, "body:0");
            await page.mouse.move(seamX, seamY);
            await page.waitForTimeout(700);
            await page.mouse.move(awayX, seamY);
            await page.waitForTimeout(450);
            assertHoverFade(await readSashHoverProbe(page), failures, {reduce: false, description: "no-preference 长停留"});
            // ③ 按下：拖动期间不等停留计时，立即全亮且不带渐变。
            await installSashHoverProbe(page, "body:0");
            await page.mouse.move(seamX, seamY);
            await page.mouse.down();
            await page.waitForTimeout(160);
            await page.mouse.up();
            await page.waitForTimeout(120);
            assertActiveInstant(await readSashHoverProbe(page), failures, "no-preference 按下分隔线");
            // ④ reduced-motion：保留停留延时（防误触），只去掉渐变——中间帧必须一帧都没有。
            await page.mouse.move(awayX, seamY);
            await page.waitForTimeout(400);
            await page.emulateMedia({reducedMotion: "reduce"});
            await installSashHoverProbe(page, "body:0");
            await page.mouse.move(seamX, seamY);
            await page.waitForTimeout(700);
            await page.mouse.move(awayX, seamY);
            await page.waitForTimeout(250);
            assertHoverFade(await readSashHoverProbe(page), failures, {reduce: true, description: "prefers-reduced-motion 长停留"});
        }
        await page.emulateMedia({reducedMotion: "no-preference"});
        await page.mouse.move(4, 4);
        await restoreStageHandles(page);
        const sashFresh = gestureDiagnostics(freshDiagnostics(sashDiagnosticsBaseline, await diagnosticsOf(page)));
        assert(sashFresh.length === 0, failures, `分隔线探测不该留下手势诊断：${sashFresh.join(" | ")}`);
        await checkpoint(page, "步骤④b 之后");

        // ④ 三种状态：32px 标题头、隐藏、最大化。
        stage = "步骤⑤ 三种状态";
        mark("收起 / 隐藏 / 最大化");
        if (await choosePanelMenu(page, "收起为标题头", failures, "收起 Panel")) {
            const collapsed = await readGeometry(page);
            assert(collapsed.panel !== null && near(collapsed.panel.height, 32, 2), failures, `收起后应只剩 32px 标题头：${collapsed.panel?.height}`);
        }
        if (await choosePanelMenu(page, "展开面板", failures, "展开 Panel")) {
            const expanded = await readGeometry(page);
            assert(expanded.panel !== null && expanded.panel.height > 32, failures, `展开后应恢复高度：${expanded.panel?.height}`);
        }
        if (await choosePanelMenu(page, "隐藏面板", failures, "隐藏 Panel")) {
            const hidden = await readGeometry(page);
            assert(hidden.panel === null, failures, "隐藏后 Panel 应零占用（叶不在渲染树里）");
            assert(hidden.overflow <= 0, failures, "隐藏 Panel 后不应有横向溢出");
            const showButton = page.locator(`${SHELL_ROOT} [data-shell-focus-target="panel-toggle"]`).first();
            if (await showButton.count() > 0) {
                await clickCenter(page, showButton, "点状态栏的显示面板");
                // 恢复是「命令 → 记录 → 重排」的异步链：等事实成立，而不是点完立刻读上一帧。
                const shown = await waitForGeometry(page, (geometry) => geometry.panel !== null && geometry.panel.height > 32);
                assert(shown !== null, failures, `状态栏「显示面板」应恢复 Panel（等待后仍未恢复：${JSON.stringify(await readGeometry(page))}）`);
            } else {
                failures.push({kind: "assertion", message: "状态栏缺少显示面板的落点（data-shell-focus-target=\"panel-toggle\"）"});
            }
        }
        if (await choosePanelMenu(page, "最大化面板", failures, "最大化 Panel")) {
            const maximized = await readGeometry(page);
            if (maximized.activity && maximized.panel && maximized.editor) {
                assert(maximized.activity.width > 0 && maximized.activity.height > 0, failures, "最大化不得吃掉活动栏");
                assert(near(maximized.panel.top, maximized.editor.top, 4), failures, "最大化应占满编辑区所在列");
            }
            await choosePanelMenu(page, "还原面板尺寸", failures, "还原 Panel");
        }

        await checkpoint(page, "步骤⑤ 三种状态之后");

        // ⑤ View 贡献动作：动作跟着自己的实例走，禁用动作点击不生效。
        stage = "步骤⑥ View 动作";
        mark("View 贡献动作");
        await selectScene(page, "view-actions");
        const counterBefore = await page.locator(`${viewSection("lab.panel-a")} [data-lab-demo-value="counter"]`).textContent();
        await invokeViewAction(page, "lab.panel-a", "increment", "增加演示计数", failures, "执行 panel-a 的「增加演示计数」");
        const counterAfter = await page.locator(`${viewSection("lab.panel-a")} [data-lab-demo-value="counter"]`).textContent();
        assert(counterBefore !== counterAfter, failures, `View 主操作应作用于当前实例：${counterBefore} → ${counterAfter}`);

        const markerBefore = await page.locator(`${viewSection("lab.panel-b")} [data-lab-demo-value="marker"]`).textContent();
        await invokeViewAction(page, "lab.panel-b", "toggle", "切换演示标记", failures, "执行 panel-b 的「切换演示标记」");
        const markerAfter = await page.locator(`${viewSection("lab.panel-b")} [data-lab-demo-value="marker"]`).textContent();
        assert(markerBefore !== markerAfter, failures, "同一个容器里的另一个 View 应能执行自己的 primary 动作");

        mark("禁用动作：菜单里带 aria-disabled，真实点击不产生状态变化");
        await settleMenus(page);
        await resetStageScroll(page);
        const viewMore = page.locator(`${viewSection("lab.panel-b")} [data-title-actions="view"] [data-title-action="more"]:visible`).first();
        await viewMore.focus();
        await resetStageScroll(page);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(300);
        const disabledItem = page.locator('[role="menuitem"]:visible[aria-disabled="true"]').first();
        if (await disabledItem.count() > 0) {
            const markerBeforeDisabled = await page.locator(`${viewSection("lab.panel-b")} [data-lab-demo-value="marker"]`).textContent();
            await clickCenter(page, disabledItem, "真实点击禁用动作");
            const markerAfterDisabled = await page.locator(`${viewSection("lab.panel-b")} [data-lab-demo-value="marker"]`).textContent();
            assert(markerBeforeDisabled === markerAfterDisabled, failures, "禁用动作点击不得改变实例状态");
        } else {
            failures.push({kind: "assertion", message: "panel-b 的更多菜单应包含禁用动作（aria-disabled）"});
        }
        await settleMenus(page);

        mark("菜单打开后切容器：旧菜单关闭且旧目标不作用于新容器");
        const staleProbe = await page.evaluate(`(() => [...document.querySelectorAll('[role="menuitem"]:not([aria-haspopup])')].some((el) => (el.textContent || "").includes("切换演示标记")))()`) as boolean;
        if (staleProbe) {
            const panelBContainer = page.locator(containerTab("lab.container.panel-b")).first();
            await clickCenter(page, panelBContainer, "切到第二个面板容器（第一次，先关菜单）");
            await clickCenter(page, panelBContainer, "切到第二个面板容器");
            const stale = await page.evaluate(`(() => [...document.querySelectorAll('[role="menuitem"]:not([aria-haspopup])')].some((el) => (el.textContent || "").includes("切换演示标记")))()`) as boolean;
            assert(!stale, failures, "切换活动容器后旧菜单应关闭（旧目标的菜单项不得留在 DOM）");
            const markerAfterSwitch = await page.locator(`${viewSection("lab.panel-b")} [data-lab-demo-value="marker"]`).textContent();
            assert(markerAfterSwitch === markerAfter, failures, "切换容器不得触发旧容器里 View 的动作");
            await clickCenter(page, page.locator(containerTab("lab.container.panel")).first(), "切回第一个面板容器");
        }
        await settleMenus(page);

        mark("View 的「移动到」菜单（容器换一个 Part）");
        const moveEventsBefore = await eventCount(page, "view-move");
        if (await chooseViewMenu(page, "lab.panel-b", ["移动到", "主侧边栏 · 第二容器"], failures, "把 panel-b 移到第二主侧栏容器")) {
            const moved = await page.locator(viewSectionIn("lab.container.left-b", "lab.panel-b")).count();
            assert(moved === 1, failures, "「移动到」之后 View 应出现在目标容器里");
            assert(await eventCount(page, "view-move") === moveEventsBefore + 1, failures, "一次移动应只发一次 view-move");
            const lastMove = await lastEvent(page, "view-move");
            assert(lastMove.includes("saved"), failures, `移动应真的落账：${lastMove}`);
        }
        await settleMenus(page);

        // ⑥ 生命周期：搬 DOM 不重挂、状态不丢。
        stage = "步骤⑦ 生命周期";
        mark("lifetime 场景的实例保留");
        await selectScene(page, "lifetime");
        const input = page.locator(`${viewSection("lab.panel-a")} [data-lab-probe="input"]`).first();
        await input.fill("保留这段输入");
        const mountsBefore = await page.locator(`${viewSection("lab.panel-a")} [data-lab-probe="mounts"]`).first().textContent();
        await page.evaluate(`(() => { const el = document.querySelector('[data-lab-skeleton-view="lab.panel-a"]'); if (el) { el.dataset.nbSmokeMark = "1"; } })()`);
        await choosePanelMenu(page, ["面板位置", "左侧"], failures, "换位置后检查实例");
        const inputAfter = page.locator(`${viewSection("lab.panel-a")} [data-lab-probe="input"]`).first();
        assert(await inputAfter.inputValue() === "保留这段输入", failures, "换位置后输入值应保留");
        /*
         * 这里**不**断言「输入还持有焦点」：换位置是用户在菜单里点出来的，焦点本来就跟着菜单走
         * （打开菜单 → 选子菜单 → 落点），「原焦点保留」规则的前提是「没有用户新焦点」。
         */
        const mountsAfter = await page.locator(`${viewSection("lab.panel-a")} [data-lab-probe="mounts"]`).first().textContent();
        assert(mountsBefore === mountsAfter, failures, `换位置不得重挂实例：${mountsBefore} → ${mountsAfter}`);
        const markSurvived = await page.evaluate(`(() => { const el = document.querySelector('[data-lab-skeleton-view="lab.panel-a"]'); return el !== null && el.dataset.nbSmokeMark === "1"; })()`) as boolean;
        assert(markSurvived, failures, "换位置应该搬 DOM 而不是重建实例（同一个节点应带着标记活下来）");
        assert(await page.locator('[data-lab-skeleton-view="lab.panel-a"]').count() === 1, failures, "同一个 View 只应有一个实例节点");

        // ⑦ 窄屏与短屏。
        stage = "步骤⑧ 窄画布";
        mark("窄画布进入紧凑呈现");
        await page.locator('[aria-label="画布宽度"] button').filter({hasText: /^手机$/u}).first().click();
        await page.waitForTimeout(400);
        const compact = await readGeometry(page);
        assert(compact.mode === "compact", failures, `390 宽画布应进入紧凑呈现：实际 ${compact.mode}`);
        assert(compact.overflow <= 0, failures, `紧凑呈现不应有横向溢出：${compact.overflow}px`);
        assert(compact.activity !== null, failures, "紧凑呈现里活动栏仍应是左侧通高列");

        // ⑧ 静置不抖动：标题操作的折叠不能靠 ResizeObserver 自激。
        stage = "步骤⑨ 静置";
        mark("标题操作静置不抖动");
        await page.locator('[aria-label="画布宽度"] button').filter({hasText: /^随窗口$/u}).first().click();
        await page.waitForTimeout(500);
        const churn = await page.evaluate(`(() => {
            const shell = document.querySelector("[data-workbench-shell]");
            if (shell === null) return -1;
            let count = 0;
            const observer = new MutationObserver((records) => { count += records.length; });
            observer.observe(shell, {childList: true, subtree: true, attributes: true});
            return new Promise((resolve) => setTimeout(() => { observer.disconnect(); resolve(count); }, 1500));
        })()`) as number;
        assert(churn >= 0 && churn < 100, failures, `静置 1.5 秒内标题区不应反复重建：实际 ${churn} 次 DOM 变更`);

        // ⑨ 隔离与复位。
        stage = "步骤⑩ 复位";
        mark("复位");
        const resetButton = page.getByRole("button", {name: "恢复演示初始状态"}).first();
        if (await resetButton.count() > 0) {
            await clickCenter(page, resetButton, "恢复演示初始状态");
        }
        const reset = await readGeometry(page);
        const resetFresh = freshDiagnostics(diagnosticsBaseline, await diagnosticsOf(page));
        assert(resetFresh.length === 0, failures, `复位后不该有新诊断：${resetFresh.join(" | ")}`);
        assert(await page.locator(`${partRoot("panel")} [data-container-id]`).count() === 1, failures, "复位后 Panel 里应恰好一个活动容器实例");
        assert(await page.locator(containerMount("lab.container.left")).count() === 1, failures, "复位后左栏应回到第一个容器");
    } catch (error) {
        failures.push({kind: "assertion", message: `工作台骨架 smoke 在阶段 [${stage}] 抛出：${error instanceof Error ? error.message : String(error)}`});
    }
}

/**
 * 分隔线反馈的观测量（装饰带几何 + hover 时间序列）。
 *
 * 「收起边界的装饰线被裁细」只能由**几何**证明：渲染矩形与「所有会裁剪的祖先内盒 ∩ 视口」
 * 相交之后还剩多少厚度——这才是 `overflow-hidden` 实际画出来的那一条。
 * 「hover 真的渐显」只能由**时间序列**证明：rAF 采样 `getComputedStyle` 的 opacity 与 transition，
 * 看停留期内是否恒为 0、延时之后是否出现 0<opacity<1 的中间帧、离开是否再淡出。
 * 两条都只读页面事实：不替实现重算第二份几何，也不另存一份状态。
 */
const SASH_BAND_TARGET_PX = 3;
/** 停留多久后才显现；精确值由 nb-ui 的单测钉住，这里只用它划验收窗口。 */
const SASH_REVEAL_DELAY_MS = 250;

/** 页面内共用的读取片段：样式表里是否真有 `.sash-line` 规则、元素矩形怎么取。 */
const SASH_PAGE_HELPERS_JS = `
    const hasSashLineRule = () => {
        for (const sheet of Array.from(document.styleSheets)) {
            let rules = null;
            try { rules = sheet.cssRules; } catch (error) { continue; }
            if (rules === null) { continue; }
            const walk = (list) => {
                for (const rule of Array.from(list)) {
                    if (rule.cssRules !== undefined && rule.cssRules !== null) {
                        if (walk(rule.cssRules)) { return true; }
                        continue;
                    }
                    if (typeof rule.selectorText === "string" && rule.selectorText.includes(".sash-line")) { return true; }
                }
                return false;
            };
            if (walk(rules)) { return true; }
        }
        return false;
    };
    const boxOf = (element) => {
        const box = element.getBoundingClientRect();
        return {left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height};
    };
`;

type SashBandSnapshot = Readonly<{
    found: boolean;
    note: string;
    staleHint: string;
    separator: LeafRect | null;
    line: LeafRect | null;
    /** 渲染矩形 ∩ 所有裁剪祖先 ∩ 视口；空交集为 null（整条都被裁掉）。 */
    visible: LeafRect | null;
    /** 每一侧被裁掉多少像素（>0.5 就是越出了裁剪盒）。 */
    cropped: {left: number; top: number; right: number; bottom: number} | null;
    clipOwner: string;
    inline: {left: string; top: string; width: string; height: string} | null;
    opacity: number;
    /** 计算样式的过渡三元组：动效合同由 hover 时间序列判定，这里只留证据（服务端 stale 时一眼看出）。 */
    transitionProperty: string;
    transitionDuration: string;
    transitionDelay: string;
    revealed: boolean;
    active: boolean;
    ariaDisabled: boolean;
}>;

/** 装饰带快照：内联几何 + 渲染矩形 + 裁剪后的可见矩形 + 分隔线自身的状态标记。 */
async function readSashBand(page: Page, sashKey: string): Promise<SashBandSnapshot> {
    return await page.evaluate(`(() => {
        ${SASH_PAGE_HELPERS_JS}
        const selector = ${JSON.stringify(sashSelector(sashKey))};
        const separator = document.querySelector(selector);
        const stale = "样式表里" + (hasSashLineRule() ? "已有" : "没有") + ".sash-line 规则（服务的产物可能是旧的）";
        const blank = (note, separatorRect) => ({
            found: false, note, staleHint: stale, separator: separatorRect, line: null, visible: null,
            cropped: null, clipOwner: "", inline: null, opacity: Number.NaN,
            transitionProperty: "", transitionDuration: "", transitionDelay: "",
            revealed: false, active: false, ariaDisabled: false,
        });
        if (separator === null) {
            return blank("没有分隔元素 " + selector, null);
        }
        const line = separator.querySelector(":scope > .sash-line");
        if (line === null) {
            return blank(
                "分隔元素里没有 .sash-line 子元素（分隔盒 " + JSON.stringify({width: separator.clientWidth, height: separator.clientHeight})
                + "，aria-disabled=" + String(separator.getAttribute("aria-disabled"))
                + "，本元素 class=" + JSON.stringify(typeof separator.className === "string" ? separator.className : "")
                + "，子元素 class=" + JSON.stringify(separator.firstElementChild === null || typeof separator.firstElementChild.className !== "string" ? "无" : separator.firstElementChild.className) + "）",
                boxOf(separator),
            );
        }
        const lineRect = boxOf(line);
        // 可见区：逐轴相交每个会裁剪的祖先内盒（clientWidth/Height 已经把边框与滚动条让开），最后夹到视口。
        const visible = {left: lineRect.left, top: lineRect.top, right: lineRect.right, bottom: lineRect.bottom};
        let clipOwner = "";
        let node = line.parentElement;
        while (node !== null) {
            const style = getComputedStyle(node);
            const clipsX = style.overflowX !== "visible";
            const clipsY = style.overflowY !== "visible";
            if (clipsX || clipsY) {
                const outer = boxOf(node);
                if (clipOwner === "") {
                    const classes = typeof node.className === "string" ? node.className.trim().split(/\\s+/u).slice(0, 2).join(".") : "";
                    clipOwner = node.tagName.toLowerCase() + (classes === "" ? "" : "." + classes);
                }
                const innerLeft = outer.left + node.clientLeft;
                const innerTop = outer.top + node.clientTop;
                if (clipsX) {
                    visible.left = Math.max(visible.left, innerLeft);
                    visible.right = Math.min(visible.right, innerLeft + node.clientWidth);
                }
                if (clipsY) {
                    visible.top = Math.max(visible.top, innerTop);
                    visible.bottom = Math.min(visible.bottom, innerTop + node.clientHeight);
                }
            }
            node = node.parentElement;
        }
        visible.left = Math.max(visible.left, 0);
        visible.top = Math.max(visible.top, 0);
        visible.right = Math.min(visible.right, document.documentElement.clientWidth);
        visible.bottom = Math.min(visible.bottom, document.documentElement.clientHeight);
        const visibleRect = {
            left: visible.left, top: visible.top, right: visible.right, bottom: visible.bottom,
            width: visible.right - visible.left, height: visible.bottom - visible.top,
        };
        const computed = getComputedStyle(line);
        return {
            found: true, note: "", staleHint: stale,
            separator: boxOf(separator),
            line: lineRect,
            visible: visibleRect.width > 0 && visibleRect.height > 0 ? visibleRect : null,
            cropped: {
                left: Math.max(0, lineRect.left - visible.left),
                top: Math.max(0, lineRect.top - visible.top),
                right: Math.max(0, visible.right - lineRect.right),
                bottom: Math.max(0, visible.bottom - lineRect.bottom),
            },
            clipOwner,
            inline: {left: line.style.left, top: line.style.top, width: line.style.width, height: line.style.height},
            opacity: Number.parseFloat(computed.opacity),
            transitionProperty: computed.transitionProperty,
            transitionDuration: computed.transitionDuration,
            transitionDelay: computed.transitionDelay,
            revealed: separator.getAttribute("data-sash-revealed") === "true",
            active: separator.getAttribute("data-sash-active") === "true",
            ariaDisabled: separator.getAttribute("aria-disabled") === "true",
        };
    })()`) as SashBandSnapshot;
}

/**
 * 3 CSS px 装饰带：厚度画满、交叉轴有跨度、内联写的几何与渲染一致，且**没有任何一侧被裁掉**。
 * 收起边界最容易在这里退化：贴边的线一旦越出 `overflow-hidden`，就会从 3px 变成 2px 的残线。
 *
 * 只在**静止态**调用（拖动刚结束、指针不在分隔线上）：此时线必须是精确 0 透明度——
 * 几何与显隐是两件事，收起边界不能因为「刚拖过」就一直亮着。
 */
function assertSashBand(snapshot: SashBandSnapshot, failures: SmokeFailure[], description: string): void {
    if (!snapshot.found || snapshot.line === null || snapshot.inline === null) {
        failures.push({kind: "assertion", message: `${description}：量不到装饰带——${snapshot.note}；served 诊断：${snapshot.staleHint}`});
        return;
    }
    // 竖条（横轴分支）厚度在 x，横条（纵轴分支）厚度在 y：按渲染矩形里较短的一边认，不靠方向属性猜。
    const along: "width" | "height" = snapshot.line.width <= snapshot.line.height ? "width" : "height";
    const thickness = snapshot.line[along];
    const cross = snapshot.line[along === "width" ? "height" : "width"];
    const inlineThickness = Number.parseFloat(along === "width" ? snapshot.inline.width : snapshot.inline.height);
    assert(near(thickness, SASH_BAND_TARGET_PX, 0.5), failures, `${description}：装饰带厚度应是 ${SASH_BAND_TARGET_PX} CSS px，实际 ${thickness}（渲染 ${JSON.stringify(snapshot.line)}，内联 ${JSON.stringify(snapshot.inline)}，过渡 ${snapshot.transitionDuration}）`);
    assert(Number.isFinite(inlineThickness) && near(inlineThickness, thickness, 0.5), failures, `${description}：内联厚度应与渲染一致：内联 ${inlineThickness} vs 渲染 ${thickness}`);
    assert(cross > 0, failures, `${description}：装饰带交叉轴应有可见跨度，实际 ${cross}`);
    const visibleThickness = snapshot.visible === null ? 0 : snapshot.visible[along];
    assert(snapshot.visible !== null && near(visibleThickness, thickness, 0.5), failures, `${description}：装饰带被裁剪祖先切掉（画 ${thickness}px / 可见 ${visibleThickness}px，裁剪者 ${snapshot.clipOwner}）`);
    const cropped = snapshot.cropped;
    assert(cropped !== null && Math.max(cropped.left, cropped.top, cropped.right, cropped.bottom) <= 0.5, failures, `${description}：装饰带越出了裁剪盒 ${JSON.stringify(cropped)}（裁剪者 ${snapshot.clipOwner}）`);
    assert(snapshot.opacity === 0 && !snapshot.revealed, failures, `${description}：静止态（指针不在分隔线上）不得亮起，实际 opacity=${snapshot.opacity} revealed=${snapshot.revealed}`);
}

type SashHoverSample = Readonly<{t: number; opacity: number; revealed: boolean; active: boolean; duration: number}>;

type SashHoverSeries = Readonly<{
    ok: boolean;
    note: string;
    staleHint: string;
    samples: readonly SashHoverSample[];
    /** 探针装上之后第一次指针移动（本次 hover 的事实起点）。 */
    movedAt: number | null;
    /** 指针真的走进 1px 分隔盒本体的时刻；只作证据，不参与判定（命中带比元素盒宽）。 */
    enteredAt: number | null;
    revealedAt: number | null;
    transitionProperty: string;
}>;

/** 装一个只读探针：rAF 采 opacity/transition，MutationObserver 记显现时刻，读的时候由 `readSashHoverProbe` 收尾。 */
async function installSashHoverProbe(page: Page, sashKey: string): Promise<SashHoverSeries> {
    return await page.evaluate(`(() => {
        ${SASH_PAGE_HELPERS_JS}
        const selector = ${JSON.stringify(sashSelector(sashKey))};
        const separator = document.querySelector(selector);
        const stale = "样式表里" + (hasSashLineRule() ? "已有" : "没有") + ".sash-line 规则（服务的产物可能是旧的）";
        const blank = (note) => ({ok: false, note, staleHint: stale, samples: [], movedAt: null, enteredAt: null, revealedAt: null, transitionProperty: ""});
        if (separator === null) {
            return blank("没有分隔元素 " + selector);
        }
        const line = separator.querySelector(":scope > .sash-line");
        if (line === null) {
            return blank(
                "分隔元素里没有 .sash-line 子元素（本元素 class=" + JSON.stringify(typeof separator.className === "string" ? separator.className : "")
                + "，子元素 class=" + JSON.stringify(separator.firstElementChild === null || typeof separator.firstElementChild.className !== "string" ? "无" : separator.firstElementChild.className) + "）",
            );
        }
        const state = {
            ok: true, note: "", staleHint: stale, samples: [], movedAt: null, enteredAt: null, revealedAt: null,
            transitionProperty: getComputedStyle(line).transitionProperty,
        };
        const sample = () => {
            const computed = getComputedStyle(line);
            state.samples.push({
                t: Math.round(performance.now()),
                opacity: Number.parseFloat(computed.opacity),
                revealed: separator.getAttribute("data-sash-revealed") === "true",
                active: separator.getAttribute("data-sash-active") === "true",
                duration: Number.parseFloat(computed.transitionDuration),
            });
        };
        const observer = new MutationObserver(() => {
            if (state.revealedAt === null && separator.getAttribute("data-sash-revealed") === "true") {
                state.revealedAt = performance.now();
            }
        });
        observer.observe(separator, {attributes: true, attributeFilter: ["data-sash-revealed"]});
        const onMove = () => { if (state.movedAt === null) { state.movedAt = performance.now(); } };
        const onEnter = () => { if (state.enteredAt === null) { state.enteredAt = performance.now(); } };
        document.addEventListener("pointermove", onMove, {capture: true});
        separator.addEventListener("pointerenter", onEnter);
        let frame = 0;
        const started = performance.now();
        const tick = () => {
            sample();
            if (performance.now() - started > 4000) { return; }
            frame = requestAnimationFrame(tick);
        };
        sample();
        frame = requestAnimationFrame(tick);
        window.__nbSashHover = {state, stop: () => {
            if (frame !== 0) { cancelAnimationFrame(frame); frame = 0; }
            observer.disconnect();
            document.removeEventListener("pointermove", onMove, {capture: true});
            separator.removeEventListener("pointerenter", onEnter);
        }};
        return state;
    })()`) as SashHoverSeries;
}

/** 读走已采样的时间序列并停掉探针（不留 rAF、不留监听）。 */
async function readSashHoverProbe(page: Page): Promise<SashHoverSeries> {
    return await page.evaluate(`(() => {
        const probe = window.__nbSashHover;
        if (probe === undefined) {
            return {ok: false, note: "hover 探针没有装上", staleHint: "", samples: [], movedAt: null, enteredAt: null, revealedAt: null, transitionProperty: ""};
        }
        probe.stop();
        return probe.state;
    })()`) as SashHoverSeries;
}

/** 短停留：指针进来又很快离开时，线一帧都不许亮（停留计时是防误触语义）。 */
function assertShortHover(series: SashHoverSeries, failures: SmokeFailure[], description: string): void {
    if (!series.ok) {
        failures.push({kind: "assertion", message: `${description}：${series.note}；served 诊断：${series.staleHint}`});
        return;
    }
    assert(series.movedAt !== null, failures, `${description}：探针装上之后没有观察到指针移动，这次采样不算数`);
    assert(series.revealedAt === null, failures, `${description}：停留不足 ${SASH_REVEAL_DELAY_MS}ms 不得显现（revealedAt=${series.revealedAt}）`);
    const peak = series.samples.reduce((max, item) => Math.max(max, item.opacity), 0);
    assert(peak === 0, failures, `${description}：短停留期间不得亮起，实际峰值 ${peak}（采样 ${series.samples.length} 帧）`);
}

/**
 * 长停留：停留计时之前恒为 0，之后有 0<opacity<1 的中间帧并到 1，离开后再淡回 0。
 * `reduce` 为真时保留延时但一帧中间帧都不许有——这正是 `prefers-reduced-motion` 合同。
 */
function assertHoverFade(series: SashHoverSeries, failures: SmokeFailure[], options: {reduce: boolean; description: string}): void {
    const {description} = options;
    if (!series.ok) {
        failures.push({kind: "assertion", message: `${description}：${series.note}；served 诊断：${series.staleHint}`});
        return;
    }
    const samples = series.samples;
    assert(samples.length >= 20, failures, `${description}：时间序列只有 ${samples.length} 帧，不足以证明渐变`);
    const hoverStart = series.movedAt;
    const revealedAt = series.revealedAt;
    assert(hoverStart !== null && revealedAt !== null, failures, `${description}：没有观察到显现（movedAt=${hoverStart} revealedAt=${revealedAt} enteredAt=${series.enteredAt}）；served 诊断：${series.staleHint}`);
    if (hoverStart === null || revealedAt === null) {
        return;
    }
    const delay = revealedAt - hoverStart;
    assert(delay >= SASH_REVEAL_DELAY_MS - 70, failures, `${description}：显现不得早于停留 ${SASH_REVEAL_DELAY_MS}ms，实际 ${Math.round(delay)}ms`);
    assert(delay <= SASH_REVEAL_DELAY_MS + 700, failures, `${description}：停留计时之后应很快显现，实际 ${Math.round(delay)}ms（enteredAt=${series.enteredAt}）`);
    const early = samples.filter((item) => item.t < hoverStart + SASH_REVEAL_DELAY_MS - 80);
    const earlyLit = early.filter((item) => item.opacity !== 0);
    assert(earlyLit.length === 0, failures, `${description}：停留期内不得亮起，越界采样 ${JSON.stringify(earlyLit.slice(0, 3))}`);
    const peak = samples.reduce((max, item) => Math.max(max, item.opacity), 0);
    assert(near(peak, 1, 0.01), failures, `${description}：显现后应到全亮，实际峰值 ${peak}`);
    // 中间帧只在「已显现且没按下」的帧里找：按下是全亮且无渐变的另一条合同。
    const fadeFrames = samples.filter((item) => !item.active && item.opacity > 0.02 && item.opacity < 0.98);
    const durations = samples.map((item) => item.duration);
    if (options.reduce) {
        assert(fadeFrames.length === 0, failures, `${description}：reduced-motion 下不该有渐变中间帧 ${JSON.stringify(fadeFrames.slice(0, 3))}`);
        assert(durations.every((value) => value === 0), failures, `${description}：reduced-motion 下过渡时长应为 0s，实际 ${JSON.stringify(durations.slice(0, 5))}`);
    } else {
        assert(fadeFrames.length > 0, failures, `${description}：渐显应有 0<opacity<1 的中间帧（峰值 ${peak}，属性 ${series.transitionProperty}，时长 ${JSON.stringify(durations.slice(0, 5))}）`);
        assert(series.transitionProperty.includes("opacity"), failures, `${description}：过渡属性应包含 opacity，实际 ${series.transitionProperty}`);
        assert(durations.some((value) => value > 0), failures, `${description}：渐显时长应为正，实际 ${JSON.stringify(durations.slice(0, 5))}`);
    }
    // 离开由采样本身证明：显现为真的最后一帧之后必须出现「不再显现」的帧，并最终回到 0。
    const lastRevealedIndex = samples.reduce((last, item, index) => item.revealed ? index : last, -1);
    assert(lastRevealedIndex >= 0, failures, `${description}：没有采到 data-sash-revealed 为真的帧`);
    if (lastRevealedIndex < 0) {
        return;
    }
    const after = samples.slice(lastRevealedIndex + 1);
    const tail = after.length > 0 ? after[after.length - 1] : undefined;
    assert(after.length > 0 && tail !== undefined && tail.opacity === 0, failures, `${description}：离开后应淡出到 0，实际 ${tail === undefined ? "离开后没有采样" : tail.opacity}（离开后 ${after.length} 帧）`);
    const fadeOut = after.filter((item) => item.opacity > 0.02 && item.opacity < 0.98);
    const fadeOutPeak = after.reduce((max, item) => Math.max(max, item.opacity), 0);
    if (options.reduce) {
        assert(fadeOut.length === 0, failures, `${description}：reduced-motion 下离开不该有渐变中间帧 ${JSON.stringify(fadeOut.slice(0, 3))}`);
    } else {
        assert(fadeOut.length > 0, failures, `${description}：离开应有淡出中间帧（离开后 ${after.length} 帧，最高 ${fadeOutPeak}）`);
    }
}

/** 按下分隔线：`data-sash-active` 期间必须已经全亮且不带过渡（拖动不等停留计时）。 */
function assertActiveInstant(series: SashHoverSeries, failures: SmokeFailure[], description: string): void {
    if (!series.ok) {
        failures.push({kind: "assertion", message: `${description}：${series.note}；served 诊断：${series.staleHint}`});
        return;
    }
    const samples = series.samples;
    const firstActive = samples.findIndex((item) => item.active);
    if (firstActive < 0) {
        const peak = samples.reduce((max, item) => Math.max(max, item.opacity), 0);
        failures.push({kind: "assertion", message: `${description}：按下后没有采到 data-sash-active（采样 ${samples.length} 帧，峰值 ${peak}；movedAt=${series.movedAt} enteredAt=${series.enteredAt}）`});
        return;
    }
    const before = samples.slice(0, firstActive).filter((item) => item.opacity !== 0);
    assert(before.length === 0, failures, `${description}：按下之前不得先渐显 ${JSON.stringify(before.slice(0, 3))}`);
    const pressed = samples.filter((item) => item.active);
    assert(pressed.every((item) => item.opacity === 1), failures, `${description}：按下期间应立刻全亮，实际 ${JSON.stringify(pressed.map((item) => item.opacity).slice(0, 5))}`);
    assert(pressed.every((item) => item.duration === 0), failures, `${description}：按下期间不该有过渡时长，实际 ${JSON.stringify(pressed.map((item) => item.duration).slice(0, 5))}`);
}
