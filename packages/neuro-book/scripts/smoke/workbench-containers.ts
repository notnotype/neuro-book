import type {Page} from "playwright-core";
import type {SmokeFailure} from "./agent-profile-nav";
import {assert} from "./agent-profile-nav";
import {
    checkpoint,
    chooseContainerMenu,
    clickCenter,
    containerHost,
    containerLocation,
    containerMount,
    containerEntry,
    containerTab,
    expectDropShape,
    dragOnto,
    dragPointer,
    diagnosticsOf,
    dragSash,
    eventCount,
    expectCollapsed,
    expectVisible,
    focusedText,
    freshDiagnostics,
    FIXTURE_ROOT,
    gestureDiagnostics,
    lastEvent,
    type LeafRect,
    mark,
    menuOpen,
    muteStageHandles,
    near,
    partRoot,
    type DropPreviewSnapshot,
    readDropPreview,
    readGeometry,
    rectOf,
    resetStageScroll,
    restoreStageHandles,
    sashSelector,
    selectFixture,
    selectScene,
    setRightSidebar,
    settleMenus,
    SHELL_ROOT,
    viewHead,
    viewLeavesOf,
    viewSection,
    viewSectionIn,
    waitForContainerPart,
} from "./workbench-lab";

/**
 * 容器分层与通用 Grid sash 的浏览器验收（`WorkbenchShellLayoutFixture`）。
 *
 * 这一层证明的是**容器模型真的生效**，而不只是标签换了皮：
 * - Part 里多容器单选（未活动容器停在实例层 parking，不销毁也不留在 Part 里）；
 * - 一个容器内部的多个 View **同屏纵向排列**（同一个 `[data-grid-scope]`，每个 Section 一个 `view:<viewId>` 叶）；
 * - 整容器跨 Part 移动、单 View 同容器换序、View 投切换器插入位自动建容器，搬动不重挂实例；
 * - 空 Part 的正文（整区落点）与空 Switcher 的条目带仍然能接收，来源搬空后容器按成员数收口；
 * - 同一次按下同时动 x/y 的双轴手势（实际线中心与 fine 命中边缘）、拖到零与从边界拉回、Escape 取消。
 */
export async function assertWorkbenchContainerSmoke(page: Page, failures: SmokeFailure[]): Promise<void> {
    let stage = "准备";
    page.setDefaultTimeout(8000);
    try {
        await selectFixture(page, "WorkbenchShellLayout");

        // ── ① 主侧栏两个容器单选 + 显式打开 ────────────────────────────────────────
        stage = "容器单选";
        mark("主侧栏两个容器可单选");
        await selectScene(page, "default");
        await checkpoint(page, stage);
        // 新模型：主侧栏**不画第二套标签条**，头部只有当前容器的可拖标题；切换容器是活动栏主入口组的职责。
        const leftTabs = await page.locator(`${partRoot("left")} [data-tab-id]`).count();
        assert(leftTabs === 0, failures, `主侧栏不应再有容器标签条（容器切换归活动栏）：实际 ${leftTabs} 项`);
        const leftTitle = await page.locator(`${partRoot("left")} [data-container-tab]`).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-container-tab")));
        assert(leftTitle.length === 1 && leftTitle[0] === "lab.container.left", failures, `主侧栏头部应只有一个当前容器标题：${leftTitle.join(",")}`);
        const leftEntries = await page.locator(`${FIXTURE_ROOT} [data-activity-id][aria-pressed]`).evaluateAll((nodes) => nodes.map((node) => `${node.getAttribute("data-activity-id")}:${node.getAttribute("aria-pressed")}`));
        assert(leftEntries.filter((entry) => entry.endsWith(":true")).length === 1, failures, `活动栏主入口组同一时刻只能选中一个容器：${leftEntries.join(",")}`);
        assert(leftEntries.includes("lab.container.left:true"), failures, `默认应选中第一个容器：${leftEntries.join(",")}`);
        expectVisible(await rectOf(page, containerMount("lab.container.left")), failures, "默认活动容器的挂载点应有尺寸");

        const selectsBefore = await eventCount(page, "container-select");
        await clickCenter(page, page.locator('[data-activity-id="lab.container.left-b"]'), "点活动栏里的第二个主侧栏容器");
        const switchedTabs = await page.locator(`${FIXTURE_ROOT} [data-activity-id][aria-pressed]`).evaluateAll((nodes) => nodes.map((node) => `${node.getAttribute("data-activity-id")}:${node.getAttribute("aria-pressed")}`));
        assert(switchedTabs.filter((entry) => entry.endsWith(":true")).length === 1, failures, `一个 Part 只能有一个活动容器：${switchedTabs.join(",")}`);
        assert(switchedTabs.includes("lab.container.left-b:true"), failures, `点过之后应选中第二个容器：${switchedTabs.join(",")}`);
        assert(await eventCount(page, "container-select") === selectsBefore + 1, failures, "一次选择只应发一次 container-select");
        expectVisible(await rectOf(page, containerMount("lab.container.left-b")), failures, "切过去之后第二个容器的挂载点应有尺寸");
        assert(await page.locator(`${partRoot("left")} [data-container-mount]`).count() === 1, failures, "Part 里只应有当前活动容器的一个挂载点");
        const parkedHost = await rectOf(page, containerHost("lab.container.left"));
        expectCollapsed(parkedHost, failures, "未活动容器应停在 parking（零尺寸），而不是留在 Part 里");

        mark("重复点当前容器条目：保持选中，不切换成 null");
        await clickCenter(page, page.locator('[data-activity-id="toggle-left"]'), "隐藏主侧栏");
        expectCollapsed(await rectOf(page, `${SHELL_ROOT} [data-leaf="left"]`), failures, "隐藏后主侧栏应零占用");
        await clickCenter(page, page.locator('[data-activity-id="lab.container.left"]'), "点另一个容器条目把主侧栏打开");
        const reopened = await readGeometry(page);
        expectVisible(reopened.left, failures, "点活动栏里的容器条目应显式打开被隐藏的主侧栏");
        const reopenedTabs = await page.locator(`${partRoot("left")} [data-container-tab]`).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-container-tab")));
        assert(reopenedTabs.length === 1 && reopenedTabs[0] === "lab.container.left", failures, `打开后活动容器应是刚点的那个：${reopenedTabs.join(",")}`);
        await clickCenter(page, page.locator('[data-activity-id="lab.container.left"]'), "再点一次当前容器条目");
        const stillActive = await page.locator(`${partRoot("left")} [data-container-tab]`).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-container-tab")));
        assert(stillActive.length === 1 && stillActive[0] === "lab.container.left", failures, `重复点当前项不得清空选择：${stillActive.join(",")}`);

        // ── ② Panel 两个容器切换 + 容器内部多 View 同屏 ─────────────────────────────
        stage = "容器内多 View 同屏";
        mark("一个容器内部两个 View 同屏（同一条竖向 Grid）");
        const panelLeaves = await viewLeavesOf("lab.container.panel", page);
        assert(panelLeaves.length === 2, failures, `面板容器内部应有两个 View 叶：${panelLeaves.join(",")}`);
        const primaryLeaf = await rectOf(page, `${containerHost("lab.container.panel")} [data-panel-id="view:lab.panel-a"]`);
        const secondaryLeaf = await rectOf(page, `${containerHost("lab.container.panel")} [data-panel-id="view:lab.panel-b"]`);
        expectVisible(primaryLeaf, failures, "第一个 View 叶应可见");
        expectVisible(secondaryLeaf, failures, "第二个 View 叶应可见");
        if (primaryLeaf !== null && secondaryLeaf !== null) {
            // Panel 的容器内部是**左右排**（轴向由 Part 决定，与 Panel 自己的停靠位置无关）。
            assert(secondaryLeaf.left >= primaryLeaf.right - 1.5, failures, `面板容器内的两个 View 应左右排：${primaryLeaf.right} vs ${secondaryLeaf.left}`);
            assert(primaryLeaf.width > 40 && secondaryLeaf.width > 40, failures, "两个 View 都应有可读宽度（不是只留竖条）");
        }
        const scopes = await page.locator(`${containerHost("lab.container.panel")} [data-grid-scope]`).count();
        assert(scopes === 1, failures, `同一容器的多个 View 应在同一个 Grid scope 里：实际 ${scopes}`);
        const panelSash = await rectOf(page, sashSelector("container:lab.container.panel:0"));
        expectVisible(panelSash, failures, "容器内两个 View 之间应有一条可拖分隔线");
        const collapsedSections = await page.locator(`${containerHost("lab.container.panel")} [data-view-id][data-collapsed="true"]`).count();
        assert(collapsedSections === 0, failures, "默认两个 View 都应是展开的");

        mark("Panel 两个容器可切换");
        await clickCenter(page, page.locator(containerTab("lab.container.panel-b")).first(), "切到第二个面板容器");
        const activePanelTab = await page.locator(`${partRoot("panel")} [data-tab-id][data-tab-active="true"]`).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-tab-id")));
        assert(activePanelTab.length === 1 && activePanelTab[0] === "lab.container.panel-b", failures, `面板容器应切到第二项：${activePanelTab.join(",")}`);
        const emptyContainer = page.locator(`${FIXTURE_ROOT} [data-container-empty="lab.container.panel-b"]`);
        if (await emptyContainer.count() > 0) {
            expectVisible(await rectOf(page, `${FIXTURE_ROOT} [data-container-empty="lab.container.panel-b"]`), failures, "空容器应显示可接收 View 的空态");
        } else {
            failures.push({kind: "assertion", message: "空容器应渲染空态落点（data-container-empty）"});
        }
        assert(await page.locator(viewSectionIn("lab.container.panel", "lab.panel-a")).count() === 1, failures, "未活动容器的 View 实例不应销毁");
        const parkedPanelHost = await rectOf(page, containerHost("lab.container.panel"));
        expectCollapsed(parkedPanelHost, failures, "未活动容器应停在 parking（零尺寸）");
        await clickCenter(page, page.locator(containerTab("lab.container.panel")).first(), "切回第一个面板容器");

        // ── ③ 右侧栏容器 + 容器选择 ───────────────────────────────────────────────
        stage = "右侧栏容器";
        mark("辅助侧栏的容器与内部两视图");
        await setRightSidebar(page, true);
        const rightTabs = await page.locator(`${partRoot("right")} [data-tab-id]`).count();
        // 右栏与 Panel 一样**始终**是标签带（只有一个容器也保留）；单容器标题形态只留给主侧栏。
        // 注意根元素两种形态都带 `data-container-tab`，区分要看内部是标签部件（`data-tab-id`）还是标题。
        const rightTitleText = await page.locator(`${partRoot("right")} [data-container-tab] .workbench-container-tab__title`).count();
        assert(rightTabs === 1 && rightTitleText === 0, failures, `右栏应是单条容器标签带：tabs=${rightTabs} 标题形态=${rightTitleText}`);
        const rightHost = await rectOf(page, containerHost("lab.container.right"));
        expectVisible(rightHost, failures, "辅助侧栏的活动容器应可见");
        const rightLeaves = await viewLeavesOf("lab.container.right", page);
        assert(rightLeaves.length === 2, failures, `辅助侧栏容器内部应有两个 View 叶：${rightLeaves.join(",")}`);
        expectVisible(await rectOf(page, `${containerHost("lab.container.right")} [data-panel-id="view:lab.secondary"]`), failures, "辅助侧栏第一个 View 应可见");
        expectVisible(await rectOf(page, `${containerHost("lab.container.right")} [data-panel-id="view:lab.extra-c"]`), failures, "辅助侧栏第二个 View 应可见");

        mark("把第二个主侧栏容器搬到辅助侧栏：右栏出现两个可切换容器");
        if (await chooseContainerMenu(page, "left", ["移动到", "辅助侧边栏"], failures, "把第二主侧栏容器搬到辅助侧栏")) {
            const moveLog = await lastEvent(page, "container-move");
            assert(moveLog.includes("saved"), failures, `容器移动应真的落账：${moveLog}`);
            const rightTabsAfter = await page.locator(`${partRoot("right")} [data-tab-id]`).count();
            assert(rightTabsAfter === 2, failures, `搬过去之后辅助侧栏应有两个容器标签：实际 ${rightTabsAfter}`);
            await clickCenter(page, page.locator(containerTab("lab.container.right")).first(), "切到辅助侧栏的另一个容器");
            const rightActive = await page.locator(`${partRoot("right")} [data-tab-id][data-tab-active="true"]`).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-tab-id")));
            assert(rightActive.length === 1 && rightActive[0] === "lab.container.right", failures, `辅助侧栏容器选择应生效：${rightActive.join(",")}`);
        }
        await settleMenus(page);
        await clickCenter(page, page.locator('[data-activity-id="footer-reset"]'), "复位演示状态");
        await page.waitForTimeout(300);

        // ── ④ 整容器移动 left→panel→right：实例不重挂 ─────────────────────────────
        stage = "整容器移动";
        mark("整容器 left → panel → right");
        await page.evaluate(`(() => { const el = document.querySelector('[data-lab-skeleton-view="lab.primary"]'); if (el) { el.dataset.nbSmokeMark = "1"; } })()`);
        const instanceLabel = await page.locator(`${viewSection("lab.primary")} [data-lab-instance]`).textContent();
        const containerMoves = await eventCount(page, "container-move");
        if (await chooseContainerMenu(page, "left", ["移动到", "面板"], failures, "把主侧栏容器搬到面板")) {
            const firstMove = await lastEvent(page, "container-move");
            assert(firstMove.includes("saved") && firstMove.includes('"targetLocation":"panel"'), failures, `容器移动应真的落账到面板：${firstMove}`);
            expectVisible(await rectOf(page, containerMount("lab.container.left")), failures, "搬到面板后容器应在目标 Part 里可见");
            assert(await page.locator(`${viewSection("lab.primary")} [data-lab-instance]`).textContent() === instanceLabel, failures, "搬容器不得换实例（实例序号应不变）");
            assert(await eventCount(page, "container-move") === containerMoves + 1, failures, "一次容器移动只应发一次 container-move");
        }
        assert(await waitForContainerPart(page, "lab.container.left", "panel"), failures, `搬过去的容器应由面板 Part 承载（实际 ${await containerLocation(page, "lab.container.left")}）`);
        if (await chooseContainerMenu(page, "panel", ["移动到", "辅助侧边栏"], failures, "把主侧栏容器从面板搬到辅助侧栏")) {
            assert(await waitForContainerPart(page, "lab.container.left", "right"), failures, `再搬一次应由辅助侧栏 Part 承载（实际 ${await containerLocation(page, "lab.container.left")}）`);
        }
        const survived = await page.evaluate(`(() => { const el = document.querySelector('[data-lab-skeleton-view="lab.primary"]'); return el !== null && el.dataset.nbSmokeMark === "1"; })()`) as boolean;
        assert(survived, failures, "整容器跨 Part 移动应搬 DOM 而不是重建实例（同一个节点应带着标记活下来）");
        assert(await page.locator('[data-lab-skeleton-view="lab.primary"]').count() === 1, failures, "同一个 View 只应有一个实例节点");
        await settleMenus(page);
        await clickCenter(page, page.locator('[data-activity-id="footer-reset"]'), "复位演示状态");
        await page.waitForTimeout(300);

        // ── ⑤ 单 View：同容器换序 + 跨容器移动 + 搬空 ──────────────────────────────
        stage = "View 换序与跨容器移动";
        mark("同容器换序：extra-a 插到 primary 之前");
        const beforeOrder = await viewLeavesOf("lab.container.left", page);
        assert(beforeOrder.length === 2, failures, `主侧栏容器应有两条 View 叶：${beforeOrder.join(",")}`);
        const reorderPreviewRef: {value: DropPreviewSnapshot | null} = {value: null};
        const reorder = await dragOnto(page, viewHead("lab.extra-a"), viewSectionIn("lab.container.left", "lab.primary"), {
            steps: 14,
            aim: {x: 0.5, y: 0.1},
            exactAim: true,
            sample: async (progress: number) => {
                const snapshot = await readDropPreview(page);
                if (progress === 1 || reorderPreviewRef.value === null) {
                    reorderPreviewRef.value = snapshot;
                }
            },
        });
        const reorderPreview = reorderPreviewRef.value;
        assert(reorder.ok, failures, `同容器换序拖动没能开始：${reorder.note}`);
        // 同容器拖动期间 dnd-kit 只派发一次 dragover（命中目标从头到尾没变），预览必须由逐帧的
        // dragmove 推动：只接 dragover 的实现在这里整场没有指示，而松手后又真的会换序。
        assert(reorderPreview !== null, failures, "同容器换序在拖动期间应给出拖放预览（这一场不能没有指示）");
        if (reorderPreview !== null) {
            assert(reorderPreview.kind === "move-view", failures, `同容器换序的预览应是「移动视图」：${String(reorderPreview.kind)}`);
            expectDropShape(reorderPreview.area, failures, "同容器换序的内容落点反馈", {minimum: 1});
            assert(reorderPreview.line === null, failures, "内容落点反馈不叠加插入线");
            assert(reorderPreview.pointerEvents === "none", failures, "拖放覆盖层不得拦截指针命中");
            assert(reorderPreview.overlay.width > 0 && reorderPreview.overlay.height > 0, failures, "拖放覆盖层应有视口尺寸");
        }
        const afterOrder = await viewLeavesOf("lab.container.left", page);
        assert(afterOrder[0] === "view:lab.extra-a" && afterOrder[1] === "view:lab.primary", failures, `换序后叶顺序应是 extra-a → primary：${afterOrder.join(",")}`);
        const reorderLog = await lastEvent(page, "view-move");
        assert(reorderLog.includes("saved"), failures, `同容器换序应落账：${reorderLog}`);

        mark("视图拖到第二容器条目上＝在插入位新建容器（新合同）：悬停条目所属容器不动");
        // 旧语义（「并入悬停的那个容器」）已删除：切换器插入位一律 detach-view，落点是**新**容器的位置。
        await clickCenter(page, page.locator('[data-activity-id="lab.container.left"]'), "在活动栏里确保来源容器是活动容器");
        const movedToSibling = await dragOnto(page, viewHead("lab.primary"), containerEntry("lab.container.left-b"));
        assert(movedToSibling.ok, failures, `拖到条目上没能开始：${movedToSibling.note}`);
        assert(await page.locator(viewSectionIn("lab.container.left", "lab.primary")).count() === 0, failures, "View 应离开来源容器");
        assert(await page.locator(viewSectionIn("lab.container.left-b", "lab.primary")).count() === 0, failures, "悬停条目所属容器不该收到这个 View（应新建容器）");
        const detachedByEntry = await customContainerIds(page);
        assert(detachedByEntry.length === 1, failures, `View 投条目应恰好新建一个自建容器：${detachedByEntry.join(",")}`);
        const detachedMembers = await viewLeavesOf(detachedByEntry[0] ?? "", page);
        assert(detachedMembers.length === 1 && detachedMembers[0] === "view:lab.primary", failures, `新容器应只装被拖出来的那个 View：${detachedMembers.join(",")}`);
        const crossLog = await lastEvent(page, "view-detach");
        assert(crossLog.includes("saved"), failures, `拖出应落账：${crossLog}`);

        mark("来源只剩一个 View：single 不再重复标题，搬整个容器即可腾空它");
        // 新模型：容器可见成员只剩 1 个时是 single，View 标题不重复渲染；此处验证整容器移动。
        const singleHeads = await page.locator(`${viewSectionIn("lab.container.left", "lab.extra-a")} [data-workbench-drag-kind="view"]`).count();
        assert(singleHeads === 0, failures, `single 容器不该再有 View 拖动标题：实际 ${singleHeads}`);
        const movedToPanel = await dragOnto(page, containerEntry("lab.container.left"), `${FIXTURE_ROOT} [data-part-switcher="panel"]`, {aim: {x: 0.18, y: 0.5}});
        assert(movedToPanel.ok, failures, `整容器搬到面板没能开始：${movedToPanel.note}`);
        assert(await waitForContainerPart(page, "lab.container.left", "panel"), failures, `整容器应改由面板承载（实际 ${await containerLocation(page, "lab.container.left")}）`);

        mark("空 Part：容器全部搬走后正文仍是整区落点（不再是「空头部接收」）");
        // 上一步把左栏活动容器搬到面板；把剩余左栏容器再搬到辅助侧栏，左栏此时应只剩空态。
        const leftRemaining = await activityContainerIds(page);
        for (let index = 0; index < leftRemaining.length; index += 1) {
            const moved = await chooseContainerMenu(page, "left", ["移动到", "辅助侧边栏"], failures, `把剩下的主侧栏容器也搬到辅助侧栏（第 ${index + 1} 个）`);
            assert(moved, failures, "主侧栏清空前必须成功移动容器");
        }
        assert((await activityContainerIds(page)).length === 0, failures, "主侧栏容器应全部搬走");
        const emptyPart = page.locator(`${partRoot("left")} [data-workbench-part-empty]`);
        assert(await emptyPart.count() === 1, failures, "容器全部搬走后空 Part 的空态应留在 DOM 中");
        assert(await emptyPart.evaluate((element) => getComputedStyle(element).display !== "none"), failures, "容器全部搬走后空 Part 的空态应可见");
        expectVisible(await rectOf(page, `${partRoot("left")} .workbench-part__body`), failures, "容器全部搬走后空 Part 的承载区域应有尺寸");
        const drop = await dragOnto(page, containerEntry("lab.container.panel-b"), `${partRoot("left")} [data-workbench-part-empty]`);
        assert(drop.ok, failures, `把容器拖进空 Part 没能开始：${drop.note}`);
        assert(await waitForContainerPart(page, "lab.container.panel-b", "left"), failures, `空正文应当能接收容器（实际 ${await containerLocation(page, "lab.container.panel-b")}）`);
        await settleMenus(page);
        await clickCenter(page, page.locator('[data-activity-id="footer-reset"]'), "复位演示状态");
        await page.waitForTimeout(300);

        // ── ⑥ 同场两轴（T/十字）：一次按下同时动 x/y ────────────────────────────────
        stage = "同场两轴";
        mark("T/十字：实际线中心与 fine 命中边缘偏移 4px（后者落在容器标签这类拖动源上，也应当由分隔线赢）");
        for (const offset of [0, 4]) {
            await selectScene(page, "default");
            await setRightSidebar(page, true);
            await resetStageScroll(page);
            const verticalSash = await rectOf(page, sashSelector("body:0"));
            const horizontalSash = await rectOf(page, sashSelector("panel-stack:0"));
            if (verticalSash === null || horizontalSash === null) {
                failures.push({kind: "assertion", message: "默认场景应同时有 body:0（竖）与 panel-stack:0（横）两条可拖分隔线"});
                continue;
            }
            const centre = {x: verticalSash.left + verticalSash.width / 2, y: horizontalSash.top + horizontalSash.height / 2};
            const point = {x: centre.x + offset, y: centre.y + offset};
            await page.mouse.move(point.x, point.y);
            await page.waitForTimeout(160);
            const hovered = await page.evaluate(`(() => ({
                hover: [...document.querySelectorAll("[data-sash-hover]")].map((el) => el.getAttribute("data-sash")),
                cross: [...document.querySelectorAll("[data-sash-cross]")].map((el) => el.getAttribute("data-sash")),
            }))()`) as {hover: string[]; cross: string[]};
            assert(hovered.hover.includes("body:0") && hovered.hover.includes("panel-stack:0"), failures, `offset=${String(offset)} 时两条线都应在命中集合里：${hovered.hover.join(",")}`);
            assert(hovered.cross.length === 2, failures, `offset=${String(offset)} 时交点应两根都点亮：${hovered.cross.join(",")}`);

            const baseline = await readGeometry(page);
            const diagnosticsBaseline = await diagnosticsOf(page);
            const eventsBefore = await eventCount(page, "shell-resize");
            const samples: string[] = [];
            await dragPointer(page, point, {x: point.x + 90, y: point.y - 60}, {
                steps: 6,
                sample: async () => {
                    await page.waitForTimeout(60);
                    const geometry = await readGeometry(page);
                    const active = await page.evaluate(`(() => [...document.querySelectorAll("[data-sash-active]")].map((el) => el.getAttribute("data-sash")))()`) as string[];
                    samples.push(`${Math.round(geometry.left?.width ?? 0)}/${Math.round(geometry.editor?.height ?? 0)}/${active.join("+")}`);
                },
            });
            assert(samples.length >= 2, failures, `offset=${String(offset)} 松手前应至少采样两次：${samples.length}`);
            const widths = samples.map((sample) => Number(sample.split("/")[0]));
            const heights = samples.map((sample) => Number(sample.split("/")[1]));
            assert(widths.every((value, index) => index === 0 || value >= widths[index - 1]!), failures, `offset=${String(offset)} 按下后左栏宽度应逐帧跟随 x：${samples.join(" | ")}`);
            assert(heights.every((value, index) => index === 0 || value <= heights[index - 1]!), failures, `offset=${String(offset)} 按下后编辑区高度应逐帧跟随 y：${samples.join(" | ")}`);
            assert(widths[widths.length - 1]! > (baseline.left?.width ?? 0), failures, `offset=${String(offset)} 双轴手势里 x 轴应真的变大：${samples.join(" | ")}`);
            assert(heights[heights.length - 1]! < (baseline.editor?.height ?? 0), failures, `offset=${String(offset)} 双轴手势里 y 轴应真的变小：${samples.join(" | ")}`);
            assert(samples.every((sample) => sample.includes("body:0") && sample.includes("panel-stack:0")), failures, `offset=${String(offset)} 手势期间两条线都应保持 active：${samples.join(" | ")}`);
            const resizeDelta = await eventCount(page, "shell-resize") - eventsBefore;
            assert(resizeDelta === 1, failures, `offset=${String(offset)} 同场两轴只应发一场 commit：实际 ${resizeDelta}`);
            const payload = await lastEvent(page, "shell-resize");
            assert(payload.includes("leftPanelWidth") && payload.includes("panelHeight"), failures, `offset=${String(offset)} 一场 commit 应同时带两个轴的最终值：${payload}`);
            const settled = await readGeometry(page);
            assert((settled.left?.width ?? 0) > (baseline.left?.width ?? 0) && (settled.editor?.height ?? 0) < (baseline.editor?.height ?? 0), failures, `offset=${String(offset)} 松手后两个轴都应保留最终值`);
            const gestureIssues = gestureDiagnostics(freshDiagnostics(diagnosticsBaseline, await diagnosticsOf(page)));
            assert(gestureIssues.length === 0, failures, `offset=${String(offset)} 双轴手势不该被取消或拒绝：${gestureIssues.join(" | ")}`);
        }

        mark("只动一轴时另一轴不落账，Escape 取消回基线");
        await selectScene(page, "default");
        await setRightSidebar(page, true);
        await resetStageScroll(page);
        const singleBefore = await readGeometry(page);
        const singleEvents = await eventCount(page, "shell-resize");
        const singleSash = await rectOf(page, sashSelector("body:0"));
        if (singleSash !== null) {
            const start = {x: singleSash.left + singleSash.width / 2, y: singleSash.top + singleSash.height / 2};
            await dragPointer(page, start, {x: start.x - 40, y: start.y}, {steps: 5});
            const singleAfter = await readGeometry(page);
            assert(await eventCount(page, "shell-resize") === singleEvents + 1, failures, "单轴手势只应落账一次");
            const singlePayload = await lastEvent(page, "shell-resize");
            assert(singlePayload.includes("leftPanelWidth") && !singlePayload.includes("panelHeight"), failures, `只动的那个轴应进补丁、没动的不该进：${singlePayload}`);
            assert(near(singleAfter.editor?.height ?? 0, singleBefore.editor?.height ?? 0, 2), failures, "单轴手势不应改变编辑区高度");
        }

        await selectScene(page, "default");
        await setRightSidebar(page, true);
        await resetStageScroll(page);
        const escapeGeometry = await readGeometry(page);
        const escapeEvents = await eventCount(page, "shell-resize");
        const escapeBody = await rectOf(page, sashSelector("body:0"));
        const escapeStack = await rectOf(page, sashSelector("panel-stack:0"));
        if (escapeBody !== null && escapeStack !== null) {
            const crossPoint = {x: escapeBody.left + escapeBody.width / 2, y: escapeStack.top + escapeStack.height / 2};
            await dragPointer(page, crossPoint, {x: crossPoint.x - 80, y: crossPoint.y + 60}, {steps: 5, escape: true});
            const escapeAfter = await readGeometry(page);
            assert(near(escapeAfter.left?.width ?? 0, escapeGeometry.left?.width ?? 0, 2), failures, `Escape 后左栏宽度应回基线：${escapeGeometry.left?.width} → ${escapeAfter.left?.width}`);
            assert(near(escapeAfter.editor?.height ?? 0, escapeGeometry.editor?.height ?? 0, 2), failures, `Escape 后编辑区高度应回基线：${escapeGeometry.editor?.height} → ${escapeAfter.editor?.height}`);
            const escapeCount = await eventCount(page, "shell-resize");
            assert(escapeCount === escapeEvents, failures, `Escape 取消不得保存任何轴（${String(escapeEvents)} → ${String(escapeCount)}，最近一条：${await lastEvent(page, "shell-resize")}）`);
        }

        // ── ⑦ 拖到零与从边界拉回 ─────────────────────────────────────────────────
        stage = "拖到零与拉回";
        mark("左右侧栏与 Panel 都能拖到零、保留可拉回的 1px 边界，拉回时线绝对跟随鼠标");
        /**
         * 这一格必须从**重新加载过的页面**开始。
         *
         * 上面的容器阶段会真的把容器搬走、合并、抑制（`suppressedContainers`），这些偏好留在 Lab 的内存记录里，
         * `selectScene("default")` 只切演示场景、不还原容器落位。沿用那些状态时，探针按
         * `[data-container-mount="lab.container.left"]` 量到的可能是**别的 Part 里的**元素，
         * 分隔线拖动的对象与量到的尺寸不再对应，断言就会以「Enter 没反应 / 拉回尺寸不对」的形式失败——
         * 那是量错了对象，不是手势坏了（同一段序列在干净页面上逐条通过）。
         */
        await page.reload({waitUntil: "domcontentloaded", timeout: 30_000});
        await selectFixture(page, "WorkbenchShellLayout");
        await setRightSidebar(page, false);
        await resetStageScroll(page);
        // Lab 画布自己的东侧缩放柄压在骨架右栏的分隔线上，先停掉（量的是骨架的手势，不是 Lab 外框）。
        await muteStageHandles(page);
        // 每一格都从场景默认几何开始：拖到零的位移与「理想边界 vs 记忆」都依赖起点，不能沿用上一格的状态。
        await selectScene(page, "default");
        await setRightSidebar(page, false);
        await assertCollapseRoundTrip(page, {
            label: "左栏",
            sashKey: "body:0",
            leafId: "left",

            axis: "width",
            shrink: {x: -1, y: 0},
            minimum: SHELL_SIDE_MIN_PX,
        }, failures);
        // 辅助侧栏（`body:1`）：历史上一格测到 677px 是因为画布落进紧凑呈现、量到的是通宽卡片。
        // 现在探针自己先断 `data-shell-layout="split"`，模式一变就按明确失败处理，不会再把卡片宽度当列宽。
        await selectScene(page, "default");
        await setRightSidebar(page, true);
        await resetStageScroll(page);
        if ((await readGeometry(page)).mode !== "split") {
            failures.push({kind: "assertion", message: `辅助侧栏收起往返需要分栏呈现，当前是 ${(await readGeometry(page)).mode}：请用更宽的画布`});
        } else {
            await assertCollapseRoundTrip(page, {
                label: "辅助侧栏",
                sashKey: "body:1",
                leafId: "right",

                axis: "width",
                shrink: {x: 1, y: 0},
                minimum: SHELL_SIDE_MIN_PX,
            }, failures);
        }
        await selectScene(page, "default");
        await setRightSidebar(page, false);
        await assertCollapseRoundTrip(page, {
            label: "面板（横向位置）",
            sashKey: "panel-stack:0",
            leafId: "panel",

            axis: "height",
            shrink: {x: 0, y: 1},
            minimum: SHELL_PANEL_MIN_HEIGHT_PX,
        }, failures);
        const afterCollapse = await readGeometry(page);
        assert(afterCollapse.overflow <= 0, failures, `收起往返不应产生横向溢出：${afterCollapse.overflow}px`);
        await restoreStageHandles(page);
        await clickCenter(page, page.locator('[data-activity-id="footer-reset"]'), "复位演示状态");
        await page.waitForTimeout(300);
        stage = "切换器命中与空 Part 回收";
        await assertSwitcherFeedback(page, failures);
    } catch (error) {
        failures.push({kind: "assertion", message: `容器 / Grid sash smoke 在阶段 [${stage}] 抛出：${error instanceof Error ? error.message : String(error)}`});
    }
}

/** 落点期望：切换器插入位（View＝建容器 / 容器＝移动 / 原位 noop）、内容区（move-view / merge-container）与空 Part 整区。 */
type SwitcherExpectation = "detach" | "container" | "merge-container" | "view" | "noop" | "empty-view" | "empty-switcher-view" | "empty-container" | "empty-switcher-container" | "none" | "reject";

/** 一次采样留下的证据：预览帧（`null`＝这一刻没有任何落点反馈）与落点 / 条目带的几何。 */
type DropEvidence = Readonly<{targetRect: LeafRect | null; band: Readonly<{rect: LeafRect; orientation: "horizontal" | "vertical"}> | null}>;

/** 空 Switcher 的条目带：Panel/right 是常驻的 selector，left 由活动栏主入口组承担。 */
function emptySwitcherOf(part: string): string {
    return part === "left" ? '[data-activity-group="primary"]' : `${partRoot(part)} .workbench-part__selector`;
}

/** 空 Part 的整区落点元素（`workbench-part-empty-target` 的几何源）。 */
function partEmptyOf(part: string): string {
    return `${partRoot(part)} [data-workbench-part-empty]`;
}

/** 矩形断言：四边按同一容差比对，失败时两边的读数都给出来（半区 / 整区 / 插入线共用这一条口径）。 */
function expectBox(
    actual: Readonly<{left: number; top: number; width: number; height: number}>,
    expected: Readonly<{left: number; top: number; width: number; height: number}>,
    failures: SmokeFailure[],
    description: string,
): void {
    assert(near(actual.left, expected.left, 1.5) && near(actual.top, expected.top, 1.5)
        && near(actual.width, expected.width, 1.5) && near(actual.height, expected.height, 1.5),
    failures, `${description}：实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`);
}

/**
 * 边缘并入的**承诺几何**：命中叶沿目标轴的一半（内容区前后各 50%，中点归后半），绘制时四边内缩
 * `min(6, 尺寸/4)`（`DropFeedbackOverlay` 的既有口径）。`trailing` 决定取命中叶的哪一半。
 */
function expectedHalfBox(leaf: LeafRect, axis: "width" | "height", trailing: boolean): Readonly<{left: number; top: number; width: number; height: number}> {
    const width = axis === "width" ? leaf.width / 2 : leaf.width;
    const height = axis === "height" ? leaf.height / 2 : leaf.height;
    const left = leaf.left + (axis === "width" && trailing ? leaf.width / 2 : 0);
    const top = leaf.top + (axis === "height" && trailing ? leaf.height / 2 : 0);
    const insetX = Math.min(6, width / 4);
    const insetY = Math.min(6, height / 4);
    return {left: left + insetX, top: top + insetY, width: width - insetX * 2, height: height - insetY * 2};
}

/** 空 Part 整区落点的绘制几何：语义矩形就是整个空区域，四边同样内缩 `min(6, 尺寸/4)`。 */
function expectedAreaBox(rect: LeafRect): Readonly<{left: number; top: number; width: number; height: number}> {
    const insetX = Math.min(6, rect.width / 4);
    const insetY = Math.min(6, rect.height / 4);
    return {left: rect.left + insetX, top: rect.top + insetY, width: rect.width - insetX * 2, height: rect.height - insetY * 2};
}

/**
 * 切换器插入线的绘制几何：语义插入位由 `resolveListInsertion({edgeGap: 4})` 求（首尾外侧留 4px、
 * 内部槽居中、越界夹进条目带），绘制时只对**长轴**两端内缩 2px。
 *
 * `span` 有值＝线的跨度取那个条目的可见矩形；`null`＝空条目带（真正没有条目），跨度取整条带、插入位贴带前缘。
 * `boundary` 是调用方算出的语义插入位；给 `null` 即贴带前缘。
 */
function expectSwitcherLine(
    frame: DropPreviewSnapshot,
    input: Readonly<{orientation: "horizontal" | "vertical"; band: LeafRect; span: LeafRect | null; boundary: number | null}>,
    failures: SmokeFailure[],
    description: string,
): void {
    const line = frame.line;
    if (line === null) {
        failures.push({kind: "assertion", message: `${description}：切换器插入位必须给出那一条插入线`});
        return;
    }
    const span = input.span ?? input.band;
    const thickness = 2;
    if (input.orientation === "horizontal") {
        const boundary = Math.max(input.band.left, Math.min(input.boundary ?? input.band.left, input.band.right - thickness));
        const inset = Math.min(2, span.height / 4);
        expectBox(line.rendered, {left: boundary, top: span.top + inset, width: thickness, height: span.height - inset * 2}, failures, `${description}（插入线）`);
        return;
    }
    const boundary = Math.max(input.band.top, Math.min(input.boundary ?? input.band.top, input.band.bottom - thickness));
    const inset = Math.min(2, span.width / 4);
    expectBox(line.rendered, {left: span.left + inset, top: boundary, width: span.width - inset * 2, height: thickness}, failures, `${description}（插入线）`);
}

/**
 * 拖动中那份唯一拖影的读数：图标与文字必须同时在场（`DropIndicatorLabel` 的图标子节点是空文本的
 * `aria-hidden` span，文字子节点带完整名称）——容器 Tab、活动条目与 View 标题共用这一份拖影。
 */
async function readDragOverlay(page: Page): Promise<Readonly<{count: number; text: string; icon: boolean}> | null> {
    return await page.evaluate(`(() => {
        const overlay = document.querySelector("[data-workbench-drag-overlay]");
        if (overlay === null) return null;
        const label = overlay.querySelector("[data-drop-indicator-label]");
        if (label === null) return {count: 0, text: "", icon: false};
        const icon = [...label.children].find((child) => child.getAttribute("aria-hidden") === "true" && (child.textContent ?? "").trim() === "") ?? null;
        const iconStyle = icon === null ? null : getComputedStyle(icon);
        const iconRect = icon === null ? null : icon.getBoundingClientRect();
        return {
            count: overlay.querySelectorAll("[data-drop-indicator-label]").length,
            text: (label.textContent ?? "").trim(),
            icon: iconStyle !== null && iconStyle.maskImage !== "none" && iconRect !== null && iconRect.width > 0 && iconRect.height > 0,
        };
    })()`) as Readonly<{count: number; text: string; icon: boolean}> | null;
}

/** 全夹具里此刻存在的自建容器 id（Tab / 活动栏条目 / 挂载点任一处出现即算）。 */
async function customContainerIds(page: Page): Promise<string[]> {
    return await page.evaluate(`(() => {
        const ids = new Set();
        const containers = ["data-container-tab", "data-activity-id", "data-container-mount"];
        for (const element of document.querySelectorAll('[data-container-tab^="custom:"], [data-activity-id^="custom:"], [data-container-mount^="custom:"]')) {
            for (const name of containers) {
                const value = element.getAttribute(name);
                if (value !== null && value.startsWith("custom:")) ids.add(value);
            }
        }
        return [...ids];
    })()`) as string[];
}

/** 活动栏主入口组里的容器条目顺序：主侧栏的容器顺序就是这条竖排列表的渲染顺序。 */
async function activityContainerIds(page: Page): Promise<string[]> {
    return await page.locator('[data-activity-group="primary"] [data-activity-id]').evaluateAll((nodes) => nodes
        .map((node) => node.getAttribute("data-activity-id") ?? "")
        .filter((id) => id.startsWith("lab.container.") || id.startsWith("custom:")));
}

/** 某个 Part 此刻的容器条目顺序：left 读活动栏主入口组，Panel/right 读标签带。 */
async function containerEntryIds(page: Page, part: string): Promise<string[]> {
    if (part === "left") {
        return await activityContainerIds(page);
    }
    return await page.locator(`${partRoot(part)} [data-tab-id]`).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-tab-id") ?? ""));
}

/** 落点所在的切换器条目带：活动栏主入口组是竖排，Panel/right 的标签带是横排；都不是时为 `null`。 */
async function switcherBandOf(page: Page, selector: string): Promise<Readonly<{rect: LeafRect; orientation: "horizontal" | "vertical"}> | null> {
    return await page.locator(selector).first().evaluate((element) => {
        const band = element.closest(".workbench-part__selector, [data-activity-group]");
        if (band === null) return null;
        const rect = band.getBoundingClientRect();
        return {
            rect: {left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height},
            orientation: band.hasAttribute("data-activity-group") ? "vertical" : "horizontal",
        };
    }) as Readonly<{rect: LeafRect; orientation: "horizontal" | "vertical"}> | null;
}

/**
 * single 容器**上提**的「移动到」菜单：容器里只剩一个可见 View 时，View 的标题与本组动作都不渲染，入口被
 * 投射到容器右上角（`WorkbenchPartHost` 的 `[data-title-actions="view"]`）。
 *
 * 为什么需要它：`single` 的 View 没有拖动把手（结构性事实，不是缺陷），所以「最后一个成员离开容器」这条路径
 * 只能走这个真实的业务菜单（`move-view`，与拖动共用同一条记录收口）。键盘漫游而不是指针：Reka 的浮层在
 * 动画 / 重定位期间会让 Playwright 的可操作性等待一路卡住。
 */
async function chooseElevatedViewMenu(
    page: Page,
    part: string,
    labels: readonly string[],
    failures: SmokeFailure[],
    description: string,
): Promise<boolean> {
    try {
        await settleMenus(page);
        const trigger = page.locator(`${partRoot(part)} [data-title-actions="view"] [data-title-action="more"]:visible`).first();
        await trigger.focus();
        await resetStageScroll(page);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(250);
        if (!await menuOpen(page)) {
            throw new Error("Enter 没有打开菜单");
        }
        await page.keyboard.press("Home");
        await page.waitForTimeout(80);
        for (let index = 0; index < labels.length; index += 1) {
            const last = index === labels.length - 1;
            let hops = 0;
            while (!(await focusedText(page)).includes(labels[index]!) && hops < 24) {
                if (!await menuOpen(page)) {
                    throw new Error(`漫游到第 ${hops} 步时菜单已关闭（目标「${labels[index]}」，当前焦点：${await focusedText(page) || "无"}）`);
                }
                await page.keyboard.press("ArrowDown");
                hops += 1;
                await page.waitForTimeout(50);
            }
            if (!(await focusedText(page)).includes(labels[index]!)) {
                throw new Error(`漫游找不到「${labels[index]}」（当前焦点：${await focusedText(page) || "无"}）`);
            }
            if (!last) {
                await page.keyboard.press("ArrowRight");
                await page.waitForTimeout(160);
            }
        }
        await page.keyboard.press("Enter");
        await page.waitForTimeout(320);
        return true;
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failures.push({kind: "assertion", message: `${description}（未点到菜单路径：${labels.join(" → ")}；原因：${reason}）`});
        await settleMenus(page);
        return false;
    }
}

/**
 * 新版拖放落点契约的浏览器验收（`WorkbenchShellLayoutFixture`）。
 *
 * 与旧语义的三条差别正是这一格要证明的事：
 * - **View 投任何切换器插入位都新建容器**（`view-detach`）：落下后多出一个 `custom:` 容器、只装被拖的那个
 *   View，悬停条目所属容器**一个成员都不动**；切换器只画那一条插入线（条目高亮整条删除，`entryRect` 恒 `null`）；
 * - **空 Part 的正文是一个整区落点**（`workbench-part-empty-target`）：View 落上去建容器、容器落上去搬回，
 *   反馈是整个空区域；空 Switcher 的条目带（Panel/right 常驻、left 归活动栏主入口组）是第二个接收入口；
 * - **内容区前后各 50%**：中点归后半；非法方向没有区域、没有线、没有提示，释放也不提交。承诺的落点范围是
 *   **命中叶的一半**（绘制时四边内缩 `min(6, 尺寸/4)`）。
 *
 * 可在独立宿主里直接调用（不依赖 Lab 导航）：入口只等夹具根出现，其余全部走真实指针 / 键盘路径；每次起拖都真
 * 释放，事件计数 + DOM 归属 + 记录载荷三者共同证明预览与提交一致。旧语义（中央保持反馈、View 投 Tab 追加到
 * 悬停容器、空头部接收整容器）在这里必须失败。
 */
export async function assertSwitcherFeedback(page: Page, failures: SmokeFailure[]): Promise<void> {
    // 独立宿主里也可能直接调用这一格：默认超时与视口都在这里自己兜住（套件里是幂等的）。
    page.setDefaultTimeout(8000);
    await page.setViewportSize({width: 1600, height: 1300});
    if (await page.locator(SHELL_ROOT).count() === 0) {
        await page.waitForSelector(SHELL_ROOT, {timeout: 8000}).catch(() => undefined);
        assert(await page.locator(SHELL_ROOT).count() === 1, failures, "拖放验收需要工作台外壳夹具在场（独立宿主请直接挂载真实 fixture）");
        await page.waitForTimeout(320);
    }
    const reset = async (): Promise<void> => {
        await settleMenus(page);
        await clickCenter(page, page.locator('[data-activity-id="footer-reset"]'), "复位拖放场景");
        await resetStageScroll(page);
        await page.waitForTimeout(220);
    };
    /** 四类写记录的事件 + 一次提交事件：一次拖放的账必须逐项对得上（`view-detach` 是新建容器那条）。 */
    const counts = async (): Promise<number[]> => [
        await eventCount(page, "view-move"),
        await eventCount(page, "view-detach"),
        await eventCount(page, "container-move"),
        await eventCount(page, "drop-committed"),
    ];
    /** 活动栏主入口组里的条目读数（渲染顺序）：插入线几何要拿相邻两条目的边缘。 */
    const activityEntries = async (): Promise<ReadonlyArray<Readonly<{id: string; rect: LeafRect}>>> => {
        const entries: {id: string; rect: LeafRect}[] = [];
        for (const id of await activityContainerIds(page)) {
            const rect = await rectOf(page, `[data-activity-group="primary"] [data-activity-id="${id}"]`);
            if (rect !== null) {
                entries.push({id, rect});
            }
        }
        return entries;
    };
    /** 把某个容器切成它所在 Part 的活动容器：View 的拖动把手只在活动容器里挂着。 */
    const activateContainer = async (containerId: string, description: string): Promise<void> => {
        await clickCenter(page, page.locator(containerEntry(containerId)).first(), description);
        await page.waitForTimeout(200);
    };

    /**
     * 一次真实拖放：通用层管预览形状、事件账与覆盖层清理，`check` 给场景专属的几何断言（半区 / 插入线 /
     * 整区）。采样只在**松手之前**：这时预览层还挂着，读到的就是判定给出的形状。
     */
    const exercise = async (
        source: string,
        target: string,
        expected: SwitcherExpectation,
        description: string,
        options: Readonly<{
            aim?: {x: number; y: number};
            escape?: boolean;
            /** 拒绝场景：指针落在左栏标题上时不得误入有效条目或内容区。 */
            title?: boolean;
            check?: (frame: DropPreviewSnapshot, evidence: DropEvidence) => void;
        }> = {},
    ): Promise<void> => {
        const before = await counts();
        const sourceRect = await rectOf(page, source);
        const sourceOpacity = await page.locator(source).first().evaluate((element) => getComputedStyle(element).opacity);
        const frames: (DropPreviewSnapshot | null)[] = [];
        let targetRect: LeafRect | null = null;
        let band: Readonly<{rect: LeafRect; orientation: "horizontal" | "vertical"}> | null = null;
        const result = await dragOnto(page, source, target, {
            exactAim: true,
            aim: options.aim,
            escape: options.escape,
            sample: async (progress, point) => {
                if (progress !== 1) {
                    return;
                }
                const currentSource = await rectOf(page, source);
                assert(sourceRect !== null && currentSource !== null
                    && near(sourceRect.left, currentSource.left, 1) && near(sourceRect.top, currentSource.top, 1)
                    && near(sourceRect.width, currentSource.width, 1) && near(sourceRect.height, currentSource.height, 1),
                failures, `${description}：源矩形在拖动中保持不变：${JSON.stringify({sourceRect, currentSource})}`);
                assert(await page.locator(source).first().evaluate((element) => getComputedStyle(element).opacity) === sourceOpacity,
                    failures, `${description}：源透明度在拖动中保持不变`);
                assert(await page.locator("[data-workbench-drag-overlay]").count() === 1, failures, `${description}：活动自定义拖影只有一个`);
                const overlay = await readDragOverlay(page);
                assert(overlay !== null && overlay.count === 1 && overlay.text.length > 0 && overlay.icon,
                    failures, `${description}：拖影必须同时有图标与文字（容器条目与 View 标题同一份拖影）：${JSON.stringify(overlay)}`);
                assert(await page.locator("[data-dnd-placeholder]").count() === 0, failures, `${description}：不插入占位元素`);
                const frame = await readDropPreview(page);
                frames.push(frame);
                targetRect = await rectOf(page, target);
                band = await switcherBandOf(page, target);
                if (expected === "reject") {
                    const forbidden = await page.evaluate(({x, y, title}) => {
                        const hit = document.elementFromPoint(x, y);
                        if (title && hit?.closest('.workbench-part__head [data-container-tab]')) return null;
                        return hit?.closest('[data-container-tab], [data-container-content], [data-activity-id^="lab.container."], [data-activity-id^="custom:"]')?.outerHTML ?? null;
                    }, {...point, title: options.title === true});
                    assert(forbidden === null, failures, `${description}：拒绝点不得误入有效条目或内容区：${forbidden}`);
                }
                if (frame !== null && options.check !== undefined) {
                    options.check(frame, {targetRect, band});
                }
            },
        });
        assert(result.ok, failures, `${description}：必须证明源激活：${result.note}`);
        assert(frames.length >= 2, failures, `${description}：落点至少两帧证据`);
        for (const frame of frames) {
            if (expected === "none" || expected === "reject") {
                assert(frame === null, failures, `${description}：这个落点不该有任何落点反馈：${JSON.stringify(frame)}`);
                continue;
            }
            assert(frame !== null, failures, `${description}：已激活的有效落点应有预览`);
            if (frame === null) {
                continue;
            }
            const wantedKind = expected === "detach" || expected === "empty-view" || expected === "empty-switcher-view"
                ? "detach-view"
                : expected === "view" ? "move-view"
                    : expected === "merge-container" ? "merge-container"
                        : expected === "noop" ? "noop" : "move-container";
            assert(frame.kind === wantedKind, failures, `${description}：预览语义应是 ${wantedKind}（实际 ${String(frame.kind)}）`);
            assert(frame.labelVisible && frame.labelInsideViewport && frame.iconVisible,
                failures, `${description}：提示和图标应可见且在视口内：${JSON.stringify(frame)}`);
            assert(frame.pointerEvents === "none", failures, `${description}：反馈不得拦截指针`);
            // 新合同：切换器的条目高亮整条删除——`entryRect` 在任何落点都必须是 null。
            assert(frame.entry === null, failures, `${description}：切换器不再给条目高亮（entryRect 必须是 null）`);
            const isArea = expected === "view" || expected === "merge-container"
                || expected === "empty-view" || expected === "empty-container";
            if (!isArea) {
                assert(frame.area === null, failures, `${description}：切换器插入位只画线，不给区域反馈：${JSON.stringify(frame.area)}`);
                expectDropShape(frame.line, failures, `${description} 插入线`);
            } else {
                assert(frame.line === null, failures, `${description}：内容落点只给区域反馈，不叠加插入线`);
                expectDropShape(frame.area, failures, `${description} 内容落点`);
            }
        }
        const after = await counts();
        const delta = after.map((value, index) => value - before[index]!);
        const wanted = options.escape === true || expected === "none" || expected === "reject" || expected === "noop"
            ? [0, 0, 0, 0]
            : expected === "view" ? [1, 0, 0, 1]
                : expected === "detach" || expected === "empty-view" || expected === "empty-switcher-view" ? [0, 1, 0, 1]
                    : expected === "merge-container" ? [0, 0, 0, 1] : [0, 0, 1, 1];
        assert(delta.every((value, index) => value === wanted[index]), failures,
            `${description}：事件账 ${JSON.stringify(delta)}，预期 ${JSON.stringify(wanted)}`);
        assert(await page.locator("[data-drop-feedback]").count() === 0, failures, `${description}：释放后覆盖层移除`);
        assert(await page.locator("[data-workbench-drag-overlay]").count() === 0, failures, `${description}：释放或取消后拖影移除`);
    };

    /** 把一个 Part 真实清空（容器菜单 → 其它落位）并断言空态合同。 */
    const emptyPart = async (part: "left" | "panel" | "right"): Promise<void> => {
        await reset();
        await setRightSidebar(page, true);
        const destination = part === "left" ? "面板" : "主侧边栏";
        for (let guard = 0; guard < 4; guard += 1) {
            const remaining = await containerEntryIds(page, part);
            if (remaining.length === 0) {
                break;
            }
            const moved = await chooseContainerMenu(page, part, ["移动到", destination], failures, `清空 ${part}（还剩 ${remaining.length} 个容器）`);
            assert(moved, failures, `${part} 清空前必须成功移动容器`);
            await page.waitForTimeout(160);
        }
        assert(await page.locator(`${partRoot(part)} [data-container-tab]`).count() === 0, failures, `${part} 清空后不应再有任何容器条目`);
        assert(await page.locator(partEmptyOf(part)).isVisible(), failures, `${part} 清空后空正文应可见`);
        if (part === "left") {
            const group = await rectOf(page, emptySwitcherOf("left"));
            assert(group !== null && group.height >= 44, failures, `空 left 的活动栏主入口组应留 44px 当条目带：${JSON.stringify(group)}`);
            assert((await activityContainerIds(page)).length === 0, failures, `空 left 的活动栏主入口组不应再挂容器条目：${(await activityContainerIds(page)).join(",")}`);
            return;
        }
        assert(await page.locator(`${partRoot(part)} .workbench-part__selector`).count() === 1,
            failures, `${part} 空 Switcher 的条目带应常驻（第二个接收入口，旧合同里的「空态不留零尺寸 selector」已删除）`);
        expectVisible(await rectOf(page, emptySwitcherOf(part)), failures, `${part} 空条目带应有可见尺寸`);
    };

    // ── ① 非空 left：当前容器标题、头部空白与动作区都不接受投递（两种源）──────────
    for (const kind of ["view", "container"] as const) {
        const source = kind === "view" ? viewHead("lab.panel-a") : containerTab("lab.container.panel");
        for (const zone of ["head", "actions"] as const) {
            await reset();
            mark(`${kind} → 非空左栏 ${zone}：禁投（无反馈、不提交）`);
            await exercise(source, zone === "head" ? `${partRoot("left")} .workbench-part__head` : `${partRoot("left")} .workbench-part__actions`,
                "reject", `${kind} → left ${zone}`, {aim: {x: 0.7, y: 0.5}, title: true});
        }
        for (const side of [0.1, 0.5, 0.9]) {
            await reset();
            mark(`${kind} → 左栏当前容器标题 x=${side}：任何时候都禁投`);
            await exercise(source, containerTab("lab.container.left"), "reject", `${kind} → 左栏标题 ${side}`, {title: true, aim: {x: side, y: 0.5}});
        }
    }

    // ── ② 隐藏成员也算成员：只有隐藏 View 的容器仍在导航里，空态给出原因 ───────────
    await reset();
    mark("隐藏成员也算成员：只装了一个 `when` 不可见 View 的容器仍留在切换器里");
    assert(await page.locator(containerTab("lab.container.panel-b")).count() === 1,
        failures, "只有一个隐藏成员的容器应仍在切换器里（隐藏 View 算成员），成员归零才收口");
    assert((await viewLeavesOf("lab.container.panel-b", page)).length === 0, failures, "隐藏成员不该渲染可见叶");
    await clickCenter(page, page.locator(containerTab("lab.container.panel-b")).first(), "切到只装隐藏成员的面板容器");
    expectVisible(await rectOf(page, `${FIXTURE_ROOT} [data-container-empty="lab.container.panel-b"]`), failures,
        "只装隐藏成员的容器应显示空态（成员不可见 ≠ 没有成员）");

    // ── ③ View 投切换器插入位：新建自建容器，悬停条目所属容器一个成员都不动 ───────
    await reset();
    mark("View → 活动栏条目：新建 custom: 容器（单成员、自动选中）");
    const detachSourceMembers = await viewLeavesOf("lab.container.panel", page);
    const detachTargetMembers = await viewLeavesOf("lab.container.left-b", page);
    const detachEntries = await activityEntries();
    const detachAnchor = detachEntries.find((entry) => entry.id === "lab.container.left-b") ?? null;
    const detachPrevious = detachEntries.find((entry) => entry.id !== "lab.container.left-b") ?? null;
    await exercise(viewHead("lab.panel-a"), `[data-activity-group="primary"] [data-activity-id="lab.container.left-b"]`, "detach",
        "View → 左栏活动条目", {
            aim: {x: 0.5, y: 0.2},
            check: (frame, {band}) => {
                assert(band !== null && detachAnchor !== null && detachPrevious !== null, failures, "插入线几何需要相邻两条目的读数");
                if (band === null || detachAnchor === null || detachPrevious === null) {
                    return;
                }
                expectSwitcherLine(frame, {
                    orientation: "vertical",
                    band: band.rect,
                    span: detachAnchor.rect,
                    boundary: (detachPrevious.rect.bottom + detachAnchor.rect.top - 2) / 2,
                }, failures, "View → 左栏活动条目");
            },
        });
    const detached = await customContainerIds(page);
    assert(detached.length === 1, failures, `View 投切换器应恰好新建一个自建容器：${detached.join(",")}`);
    const detachedId = detached[0] ?? "";
    assert(detachedId.startsWith("custom:"), failures, `自建容器 id 应以 custom: 开头：${detachedId}`);
    assert((await containerLocation(page, detachedId)).includes("part=left"), failures, `自建容器应落在目标 Part：${await containerLocation(page, detachedId)}`);
    assert(await page.locator(`${partRoot("left")} [data-container-mounted="${detachedId}"]`).count() === 1, failures, "新建的容器应被自动选中（目标落位）");
    const detachedMembers = await viewLeavesOf(detachedId, page);
    assert(detachedMembers.length === 1 && detachedMembers[0] === "view:lab.panel-a", failures, `新容器应只装被拖出来的那个 View：${detachedMembers.join(",")}`);
    const anchorMembersAfter = await viewLeavesOf("lab.container.left-b", page);
    assert(anchorMembersAfter.length === detachTargetMembers.length && anchorMembersAfter.every((id, index) => id === detachTargetMembers[index]),
        failures, `悬停条目所属容器不该被动过：${detachTargetMembers.join(",")} → ${anchorMembersAfter.join(",")}`);
    assert(await page.locator(viewSectionIn("lab.container.left-b", "lab.panel-a")).count() === 0, failures, "被拖的 View 不得进入悬停条目所属容器");
    const sourceMembersAfter = await viewLeavesOf("lab.container.panel", page);
    assert(!sourceMembersAfter.includes("view:lab.panel-a") && sourceMembersAfter.length === detachSourceMembers.length - 1,
        failures, `来源容器应少掉被拖走的 View：${detachSourceMembers.join(",")} → ${sourceMembersAfter.join(",")}`);
    const detachEntriesAfter = await activityContainerIds(page);
    const detachedAt = detachEntriesAfter.indexOf(detachedId);
    assert(detachedAt >= 0 && detachEntriesAfter[detachedAt + 1] === "lab.container.left-b",
        failures, `新容器应插在命中条目之前：${detachEntriesAfter.join(",")}`);
    const detachLog = await lastEvent(page, "view-detach");
    assert(detachLog.includes("saved") && detachLog.includes(`"containerId":"${detachedId}"`) && detachLog.includes('"targetLocation":"sidebar-left"'),
        failures, `拖出应与新容器的创建同一次落账：${detachLog}`);

    mark("自建容器的唯一成员用真实「移动到」菜单搬走：成员归零 → 容器与入口一起收口");
    await chooseElevatedViewMenu(page, "left", ["移动到", "面板（演示）"], failures, "把自建容器的唯一成员搬回面板容器");
    assert((await customContainerIds(page)).length === 0, failures, "成员归零的自建容器应收口（Tab / 活动条目 / 挂载点都不该留下）");
    assert(await page.locator(containerHost("lab.container.left")).count() === 1, failures, "收口后左栏仍应有真实容器，不得留下空 Tab 或空挂点");
    assert(await page.locator(`${partRoot("left")} [data-container-mounted="lab.container.left"]`).count() === 1,
        failures, "收口后左栏应回落到真实容器的挂载点");
    assert(await page.locator(viewSectionIn("lab.container.panel", "lab.panel-a")).count() === 1, failures, "被搬走的 View 应回到面板容器");

    // ── ④ 容器投切换器插入位：仍是整容器换序 / 迁移（只画线，不高亮条目）──────────
    await reset();
    mark("容器 → 活动栏条目：整容器插到命中条目前");
    const moveEntries = await activityEntries();
    const moveAnchor = moveEntries.find((entry) => entry.id === "lab.container.left-b") ?? null;
    const movePrevious = moveEntries.find((entry) => entry.id !== "lab.container.left-b") ?? null;
    await exercise(containerTab("lab.container.panel"), `[data-activity-group="primary"] [data-activity-id="lab.container.left-b"]`, "container",
        "容器 → 左栏活动条目", {
            aim: {x: 0.5, y: 0.2},
            check: (frame, {band}) => {
                assert(band !== null && moveAnchor !== null && movePrevious !== null, failures, "插入线几何需要相邻两条目的读数");
                if (band === null || moveAnchor === null || movePrevious === null) {
                    return;
                }
                expectSwitcherLine(frame, {
                    orientation: "vertical",
                    band: band.rect,
                    span: moveAnchor.rect,
                    boundary: (movePrevious.rect.bottom + moveAnchor.rect.top - 2) / 2,
                }, failures, "容器 → 左栏活动条目");
            },
        });
    assert(await waitForContainerPart(page, "lab.container.panel", "left"), failures, `整容器应改由左栏承载：${await containerLocation(page, "lab.container.panel")}`);
    const movedOrder = await activityContainerIds(page);
    assert(movedOrder.indexOf("lab.container.panel") === movedOrder.indexOf("lab.container.left-b") - 1,
        failures, `整容器应插到命中条目前：${movedOrder.join(",")}`);
    const containerLog = await lastEvent(page, "container-move");
    assert(containerLog.includes("saved") && containerLog.includes('"targetLocation":"sidebar-left"'), failures, `整容器移动应一次落账：${containerLog}`);

    await reset();
    mark("容器拖到自己条目前的插入位：原位线照画、释放不写记录");
    const ownEntries = await activityEntries();
    const ownEntry = ownEntries.find((entry) => entry.id === "lab.container.left-b") ?? null;
    const ownPrevious = ownEntries.find((entry) => entry.id !== "lab.container.left-b") ?? null;
    await exercise(containerEntry("lab.container.left-b"), `[data-activity-group="primary"] [data-activity-id="lab.container.left-b"]`, "noop",
        "容器 → 自己的插入位", {
            aim: {x: 0.5, y: 0.2},
            check: (frame, {band}) => {
                assert(band !== null && ownEntry !== null && ownPrevious !== null, failures, "原位插入线几何需要相邻两条目的读数");
                if (band === null || ownEntry === null || ownPrevious === null) {
                    return;
                }
                expectSwitcherLine(frame, {
                    orientation: "vertical",
                    band: band.rect,
                    span: ownEntry.rect,
                    boundary: (ownPrevious.rect.bottom + ownEntry.rect.top - 2) / 2,
                }, failures, "容器 → 自己的插入位");
            },
        });
    assert(await page.locator(`${FIXTURE_ROOT} [data-activity-id="lab.container.left-b"]`).count() === 1, failures, "原位释放不得动容器的落位或选择");

    // ── ⑤ Panel/right 的标签带：View 建容器、容器搬入，插入线按条目带夹紧 ──────────
    for (const part of ["panel", "right"] as const) {
        for (const kind of ["view", "container"] as const) {
            await reset();
            await setRightSidebar(page, true);
            const source = kind === "view" ? viewHead("lab.primary") : `${FIXTURE_ROOT} [data-activity-id="lab.container.left"]`;
            const target = containerTab(`lab.container.${part}`);
            const firstTab = await rectOf(page, target);
            const band = await switcherBandOf(page, target);
            mark(`${kind} → ${part} 标签带：${kind === "view" ? "新建容器" : "整容器移动"}`);
            await exercise(source, target, kind === "view" ? "detach" : "container", `${kind} → ${part} 标签`, {
                aim: {x: 0.25, y: 0.5},
                check: (frame) => {
                    assert(band !== null && firstTab !== null, failures, `${part} 插入线几何需要条目带与首条目的读数`);
                    if (band === null || firstTab === null) {
                        return;
                    }
                    expectSwitcherLine(frame, {
                        orientation: band.orientation,
                        band: band.rect,
                        span: firstTab,
                        boundary: firstTab.left - 4 - 2,
                    }, failures, `${kind} → ${part} 标签`);
                },
            });
            const partEntries = await containerEntryIds(page, part);
            if (kind === "view") {
                const created = await customContainerIds(page);
                assert(created.length === 1, failures, `${part} 标签带接收 View 应新建一个容器：${created.join(",")}`);
                const createdId = created[0] ?? "";
                assert((await containerLocation(page, createdId)).includes(`part=${part}`), failures, `${part} 新容器应落在本 Part：${await containerLocation(page, createdId)}`);
                assert(await page.locator(`${partRoot(part)} [data-container-mounted="${createdId}"]`).count() === 1, failures, `${part} 新容器应被自动选中`);
                const members = await viewLeavesOf(createdId, page);
                assert(members.length === 1 && members[0] === "view:lab.primary", failures, `${part} 新容器应只装被拖的 View：${members.join(",")}`);
                assert(partEntries.indexOf(createdId) === partEntries.indexOf(`lab.container.${part}`) - 1,
                    failures, `${part} 新容器应插在命中标签之前：${partEntries.join(",")}`);
                assert(await page.locator(viewSectionIn(`lab.container.${part}`, "lab.primary")).count() === 0,
                    failures, `${part} 命中标签所属容器不该收到这个 View`);
            } else {
                assert(await waitForContainerPart(page, "lab.container.left", part), failures, `${part} 标签带应接收整容器：${await containerLocation(page, "lab.container.left")}`);
                assert(partEntries.indexOf("lab.container.left") === partEntries.indexOf(`lab.container.${part}`) - 1,
                    failures, `${part} 整容器应插在命中标签之前：${partEntries.join(",")}`);
            }
        }
    }

    // ── ⑥ 空 Part：正文整区接收（View 建容器 / 容器搬回），条目带是第二个入口 ──────
    for (const part of ["panel", "right", "left"] as const) {
        const host = part === "left" ? "lab.container.panel" : "lab.container.left";
        const hostView = part === "left" ? "lab.panel-a" : "lab.primary";
        const instanceView = part === "panel" ? "lab.panel-a" : part === "right" ? "lab.secondary" : "lab.primary";
        await emptyPart(part);
        await activateContainer(host, `让 ${hostView} 的容器成为活动容器（拖动把手只在活动容器里挂）`);
        if (part === "left") {
            mark("空 left 的头部仍然禁投（标题与动作区从来不是落点，空态也一样）");
            await exercise(viewHead(hostView), `${partRoot("left")} [data-part-switcher="left"]`, "reject", "View → 空 left 头部", {aim: {x: 0.7, y: 0.5}, title: true});
        }
        // ① View → 空正文（panel 走常驻的条目带）：反馈与落下新建的容器一起验。
        const emptyTarget = part === "panel" ? emptySwitcherOf("panel") : partEmptyOf(part);
        const emptyRect = await rectOf(page, partEmptyOf(part));
        const emptyViewExpectation = part === "panel" ? "empty-switcher-view" : "empty-view";
        mark(`View → 空 ${part} ${part === "panel" ? "条目带（插入线）" : "正文（整区）"}：新建容器`);
        await exercise(viewHead(hostView), emptyTarget, emptyViewExpectation, `View → 空 ${part} ${part === "panel" ? "条目带" : "正文"}`, {
            aim: {x: 0.5, y: 0.5},
            check: (frame, {band}) => {
                if (part === "panel") {
                    assert(band !== null, failures, "空条目带的插入线需要条目带读数");
                    if (band === null) {
                        return;
                    }
                    expectSwitcherLine(frame, {orientation: band.orientation, band: band.rect, span: null, boundary: null}, failures, "空 panel 条目带");
                    return;
                }
                assert(emptyRect !== null && frame.area !== null, failures, `${part} 整区反馈需要空区域读数`);
                if (emptyRect === null || frame.area === null) {
                    return;
                }
                expectBox(frame.area.rendered, expectedAreaBox(emptyRect), failures, `${part} 空正文整区反馈`);
            },
        });
        const createdHere = await customContainerIds(page);
        assert(createdHere.length === 1, failures, `${part} 空落点接收 View 应新建一个容器：${createdHere.join(",")}`);
        const createdId = createdHere[0] ?? "";
        assert((await containerLocation(page, createdId)).includes(`part=${part}`), failures, `${part} 新容器应落在本 Part：${await containerLocation(page, createdId)}`);
        assert(await page.locator(`${partRoot(part)} [data-container-mounted="${createdId}"]`).count() === 1, failures, `${part} 新容器应被自动选中`);
        const createdMembers = await viewLeavesOf(createdId, page);
        assert(createdMembers.length === 1 && createdMembers[0] === `view:${hostView}`, failures, `${part} 新容器应只装被拖的 View：${createdMembers.join(",")}`);
        assert(!await page.locator(partEmptyOf(part)).isVisible(), failures, `${part} 有容器之后空正文落点应让位`);

        // ② 容器 → 空正文 / 空条目带：整容器搬回，实例不重挂、目标自动选中。
        const backContainer = `lab.container.${part}`;
        const backTarget = part === "panel" ? partEmptyOf("panel") : emptySwitcherOf(part);
        const instance = await page.locator(`${viewSection(instanceView)} [data-lab-instance]`).textContent();
        await emptyPart(part);
        const backRect = await rectOf(page, backTarget);
        mark(`容器 → 空 ${part} ${part === "panel" ? "正文（整区）" : "条目带（插入线）"}：整容器搬回`);
        const emptyContainerExpectation = part === "panel" ? "empty-container" : "empty-switcher-container";
        await exercise(containerEntry(backContainer), backTarget, emptyContainerExpectation, `容器 → 空 ${part}`, {
            aim: {x: 0.5, y: 0.5},
            check: (frame, {band}) => {
                if (part === "panel") {
                    assert(backRect !== null && frame.area !== null, failures, "整区反馈需要空区域读数");
                    if (backRect === null || frame.area === null) {
                        return;
                    }
                    expectBox(frame.area.rendered, expectedAreaBox(backRect), failures, "panel 空正文整区反馈");
                    return;
                }
                assert(band !== null, failures, `${part} 插入线需要条目带读数`);
                if (band === null) {
                    return;
                }
                expectSwitcherLine(frame, {orientation: band.orientation, band: band.rect, span: null, boundary: null}, failures, `${part} 空条目带`);
            },
        });
        assert(await waitForContainerPart(page, backContainer, part), failures, `${part} 空落点应接收整容器：${await containerLocation(page, backContainer)}`);
        assert(await page.locator(`${partRoot(part)} [data-container-mounted="${backContainer}"]`).count() === 1, failures, `${part} 搬回后目标容器应被选中`);
        assert(await page.locator(`${viewSection(instanceView)} [data-lab-instance]`).textContent() === instance,
            failures, `${part} 搬出搬回不该重挂 View 实例`);
    }

    // ── ⑦ 非空内容：前后各 50%，中点归后半，承诺命中叶的一半 ────────────────
    for (const part of ["left", "panel"] as const) {
        const vertical = part === "left";
        const containerId = `lab.container.${part}`;
        const pair = vertical
            ? {source: "lab.panel-a", target: "lab.primary", axis: "height" as const, other: "lab.container.panel"}
            : {source: "lab.primary", target: "lab.panel-a", axis: "width" as const, other: "lab.container.left"};
        await reset();
        mark(`${part} 中点：归后半并显示对应半区`);
        await exercise(viewHead(pair.source), viewSection(pair.target), "view", `${part} 内容中点（View）`, {aim: {x: 0.5, y: 0.5}});
        await reset();
        await exercise(containerTab(pair.other), viewSection(pair.target), "merge-container", `${part} 内容中点（容器）`, {aim: {x: 0.5, y: 0.5}});
        for (const trailing of [false, true]) {
            await reset();
            const leaf = await rectOf(page, viewSection(pair.target));
            const membersBefore = await viewLeavesOf(containerId, page);
            mark(`${part} ${trailing ? "后" : "前"}缘：半区＝命中叶的一半（前后各 50%）`);
            await exercise(viewHead(pair.source), viewSection(pair.target), "view", `${part} ${trailing ? "后" : "前"}缘半区`, {
                aim: vertical ? {x: 0.5, y: trailing ? 0.9 : 0.1} : {x: trailing ? 0.9 : 0.1, y: 0.5},
                check: (frame) => {
                    assert(leaf !== null && frame.area !== null, failures, `${part} 半区几何需要命中叶读数`);
                    if (leaf === null || frame.area === null) {
                        return;
                    }
                    expectBox(frame.area.rendered, expectedHalfBox(leaf, pair.axis, trailing), failures, `${part} ${trailing ? "后" : "前"}缘半区`);
                },
            });
            const membersAfter = await viewLeavesOf(containerId, page);
            assert(membersAfter.includes(`view:${pair.source}`) && membersBefore.every((id) => membersAfter.includes(id)),
                failures, `${part} 边缘并入应把 View 收进目标容器：${membersBefore.join(",")} → ${membersAfter.join(",")}`);
            const leafAfter = await rectOf(page, viewSection(pair.target));
            const half = leaf === null ? 0 : leaf[pair.axis] / 2;
            assert(leafAfter !== null && near(leafAfter[pair.axis], half, Math.max(8, half * 0.25)),
                failures, `${part} 命中叶应保留一半（归属与半区尺寸同一次落账）：${JSON.stringify({before: leaf?.[pair.axis], after: leafAfter?.[pair.axis]})}`);
        }
        await reset();
        mark(`${part} 同容器换序也只承诺半区，不叠加插入线`);
        const reorderSource = vertical ? "lab.extra-a" : "lab.panel-b";
        const reorderTarget = vertical ? "lab.primary" : "lab.panel-a";
        const reorderLead = await rectOf(page, viewSection(reorderTarget));
        await exercise(viewHead(reorderSource), viewSection(reorderTarget), "view", `${part} 同容器换序半区`, {
            aim: vertical ? {x: 0.5, y: 0.1} : {x: 0.1, y: 0.5},
            check: (frame) => {
                assert(reorderLead !== null && frame.area !== null, failures, `${part} 换序半区需要命中叶读数`);
                if (reorderLead === null || frame.area === null) {
                    return;
                }
                expectBox(frame.area.rendered, expectedHalfBox(reorderLead, pair.axis, false), failures, `${part} 换序半区`);
            },
        });
        const reordered = await viewLeavesOf(containerId, page);
        assert(reordered[0] === `view:${reorderSource}` && reordered[1] === `view:${reorderTarget}`,
            failures, `${part} 换序后叶顺序应变：${reordered.join(",")}`);
    }

    // ── ⑧ 非等比来源并入：真实 sash 先把来源拖成明显不等比，并入后按同一比例分另一半 ──
    await reset();
    mark("真实 sash 调整：命中叶拖大、来源两个成员拖成明显非等比");
    // 首个叶在主轴哪一侧由布局决定，所以「往哪边拖会让它变大」不写死：一次不够就反向补一次（净位移仍是一次拖大的量）。
    const hitBefore = await rectOf(page, viewSectionIn("lab.container.left", "lab.primary"));
    assert(await dragSash(page, "container:lab.container.left:0", 0, -140), failures, "命中叶所在容器的分隔线应可拖");
    let hitGrown = await rectOf(page, viewSectionIn("lab.container.left", "lab.primary"));
    if (hitBefore !== null && hitGrown !== null && hitGrown.height <= hitBefore.height) {
        assert(await dragSash(page, "container:lab.container.left:0", 0, 280), failures, "命中叶所在容器的分隔线应可拖");
        hitGrown = await rectOf(page, viewSectionIn("lab.container.left", "lab.primary"));
    }
    assert(hitBefore !== null && hitGrown !== null && hitGrown.height > hitBefore.height + 20,
        failures, `真实 sash 调整必须把命中叶真的拖大：${JSON.stringify({before: hitBefore?.height, after: hitGrown?.height})}`);
    assert(await dragSash(page, "container:lab.container.panel:0", 120, 0), failures, "来源容器内部的分隔线应可拖");
    let sourceA = await rectOf(page, viewSectionIn("lab.container.panel", "lab.panel-a"));
    let sourceB = await rectOf(page, viewSectionIn("lab.container.panel", "lab.panel-b"));
    if (Math.abs((sourceA?.width ?? 1) / (sourceB?.width ?? 1) - 1) < 0.2) {
        assert(await dragSash(page, "container:lab.container.panel:0", -240, 0), failures, "来源容器内部的分隔线应可拖");
        sourceA = await rectOf(page, viewSectionIn("lab.container.panel", "lab.panel-a"));
        sourceB = await rectOf(page, viewSectionIn("lab.container.panel", "lab.panel-b"));
    }
    assert(sourceA !== null && sourceB !== null && sourceA.width > 80 && sourceB.width > 80,
        failures, `来源两片都应有未被夹取的可读宽度：${JSON.stringify({a: sourceA?.width, b: sourceB?.width})}`);
    const sourceRatio = (sourceA?.width ?? 1) / (sourceB?.width ?? 1);
    assert(sourceRatio >= 1.3 || sourceRatio <= 0.77, failures, `来源比例必须被真实 sash 调成非等比（否则「按比例」无从证起）：${sourceRatio.toFixed(2)}`);
    const mergeHit = await rectOf(page, viewSectionIn("lab.container.left", "lab.primary"));
    const mergeMembers = await viewLeavesOf("lab.container.panel", page);
    await exercise(containerTab("lab.container.panel"), viewSectionIn("lab.container.left", "lab.primary"), "merge-container", "非等比来源并入", {
        aim: {x: 0.5, y: 0.1},
        check: (frame) => {
            assert(mergeHit !== null && frame.area !== null, failures, "并入半区需要命中叶读数");
            assert(frame.count === String(mergeMembers.length), failures, `并入预览的成员数应含全部成员：${JSON.stringify(frame.count)} vs ${mergeMembers.length}`);
            if (mergeHit === null || frame.area === null) {
                return;
            }
            expectBox(frame.area.rendered, expectedHalfBox(mergeHit, "height", false), failures, "并入半区承诺");
        },
    });
    const merged = await viewLeavesOf("lab.container.left", page);
    assert(merged.join(",") === "view:lab.panel-a,view:lab.panel-b,view:lab.primary,view:lab.extra-a",
        failures, `并入成员应按来源顺序插在命中叶之前：${merged.join(",")}`);
    const hitAfter = await rectOf(page, viewSectionIn("lab.container.left", "lab.primary"));
    assert(hitAfter !== null && mergeHit !== null && near(hitAfter.height, mergeHit.height / 2, Math.max(8, mergeHit.height * 0.25)),
        failures, `命中叶应留下并入前几何的一半：${JSON.stringify({before: mergeHit?.height, after: hitAfter?.height})}`);
    const mergedA = await rectOf(page, viewSectionIn("lab.container.left", "lab.panel-a"));
    const mergedB = await rectOf(page, viewSectionIn("lab.container.left", "lab.panel-b"));
    const targetRatio = (mergedA?.height ?? 1) / (mergedB?.height ?? 1);
    assert(near(targetRatio, sourceRatio, sourceRatio * 0.2 + 0.1),
        failures, `并入的成员应按来源几何比例分另一半（跨轴用比例，不拷像素）：来源 ${sourceRatio.toFixed(2)} → 目标 ${targetRatio.toFixed(2)}`);
    assert(await page.locator(`${partRoot("panel")} [data-container-mount="lab.container.panel"]`).count() === 0, failures, "并入后的来源容器不再占用 Part 挂载目标");

    // ── ⑨ 真实拖动清空 Panel：最后一项卸载，空条目带与空正文重新成为落点 ─────────────
    await reset();
    mark("拖走 Panel 的全部容器：空条目带与空正文都能回收");
    for (const id of ["lab.container.panel", "lab.container.panel-b"]) {
        const currentPanelEntries = await activityEntries();
        const panelAnchorIndex = currentPanelEntries.findIndex((entry) => entry.id === "lab.container.left-b");
        const panelAnchor = panelAnchorIndex >= 0 ? currentPanelEntries[panelAnchorIndex]! : null;
        const panelPrevious = panelAnchorIndex > 0 ? currentPanelEntries[panelAnchorIndex - 1]! : null;
        await exercise(containerEntry(id), `[data-activity-group="primary"] [data-activity-id="lab.container.left-b"]`, "container",
            `拖走 Panel 容器 ${id}`, {
                aim: {x: 0.5, y: 0.2},
                check: (frame, {band}) => {
                    assert(band !== null && panelAnchor !== null && panelPrevious !== null, failures, "插入线几何需要相邻两条目的读数");
                    if (band === null || panelAnchor === null || panelPrevious === null) {
                        return;
                    }
                    expectSwitcherLine(frame, {
                        orientation: "vertical",
                        band: band.rect,
                        span: panelAnchor.rect,
                        boundary: (panelPrevious.rect.bottom + panelAnchor.rect.top - 2) / 2,
                    }, failures, `拖走 ${id}`);
                },
            });
    }
    assert(await page.locator(`${partRoot("panel")} [data-tab-id]`).count() === 0, failures, "拖走全部容器后 Panel 应清空");
    assert(await page.locator(emptySwitcherOf("panel")).count() === 1, failures, "Panel 空掉后条目带应常驻");
    let panelBand: Readonly<{rect: LeafRect; orientation: "horizontal" | "vertical"}> | null = null;
    await exercise(containerEntry("lab.container.panel"), emptySwitcherOf("panel"), "container", "从空条目带搬回 Panel", {
        aim: {x: 0.5, y: 0.5},
        check: (frame, {band}) => {
            panelBand = band;
            assert(band !== null, failures, "空条目带插入线需要条目带读数");
            if (band === null) {
                return;
            }
            expectSwitcherLine(frame, {orientation: band.orientation, band: band.rect, span: null, boundary: null}, failures, "空 Panel 条目带");
        },
    });
    assert(panelBand !== null, failures, "空条目带应真的被量到过");
    assert(await waitForContainerPart(page, "lab.container.panel", "panel"), failures, "真实拖空后仍能回收整容器");

    // ── ⑩ 指针静止时目标尺寸变化：反馈跟着新几何走，不再是等下一次 pointermove ──────
    await reset();
    const beforeResize = await counts();
    let resized = false;
    let oldWidth = 0;
    const resizeDrag = await dragOnto(page, viewHead("lab.panel-a"), viewSection("lab.primary"), {
        escape: true,
        aim: {x: 0.5, y: 0.1},
        exactAim: true,
        sample: async (progress) => {
            if (progress !== 1) {
                return;
            }
            if (!resized) {
                resized = true;
                oldWidth = (await rectOf(page, viewSection("lab.primary")))!.width;
                await page.locator(sashSelector("body:0")).focus();
                await page.keyboard.press("ArrowRight");
                await page.keyboard.press("ArrowRight");
                await page.waitForTimeout(150);
            }
            const leaf = await rectOf(page, viewSection("lab.primary"));
            const feedback = await readDropPreview(page);
            assert(leaf !== null && Math.abs(leaf.width - oldWidth) > 1, failures, "静止指针场景必须真的改变目标宽度");
            assert(feedback?.area !== null && feedback?.area !== undefined, failures, "目标变宽后仍有内容预览");
            if (leaf && feedback?.area) {
                assert(near(feedback.area.rendered.width, leaf.width - 12, 1), failures, "无 pointermove 时反馈宽度跟随目标");
            }
        },
    });
    assert(resizeDrag.ok && resized, failures, `静止指针尺寸变化拖动已激活：${resizeDrag.note}`);
    assert(await page.locator("[data-drop-feedback]").count() === 0, failures, "尺寸变化后 Escape 清除预览");
    const afterResize = await counts();
    assert(afterResize.every((value, index) => value === beforeResize[index]), failures, "尺寸变化后取消不提交");

    // ── ⑪ 键盘路径与 Escape：与指针共用同一份判定，取消不提交 ────────────────────
    await reset();
    const keyboardBefore = await counts();
    const keyboardSource = page.locator(viewHead("lab.panel-a"));
    await keyboardSource.focus();
    await page.keyboard.press("Space");
    await page.locator("[data-workbench-drag-overlay]").waitFor({state: "visible"});
    assert(await keyboardSource.getAttribute("aria-grabbed") === "true", failures, "键盘 Space 必须激活真实拖动源");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Escape");
    await page.locator("[data-workbench-drag-overlay]").waitFor({state: "detached"});
    const keyboardAfter = await counts();
    assert(keyboardAfter.every((value, index) => value === keyboardBefore[index]), failures, "键盘取消不得提交移动");
    await reset();
    const escapeBefore = await counts();
    await exercise(viewHead("lab.panel-a"), viewSection("lab.primary"), "view", "Escape 取消边缘并入", {aim: {x: 0.5, y: 0.1}, escape: true});
    const escapeAfter = await counts();
    assert(escapeAfter.every((value, index) => value === escapeBefore[index]), failures, "Escape 取消不得提交任何账");
}

/**
 * 一次「拖到零再拉回」的探针：`shrink` 是单位方向（把分隔线往哪边拖会让该 Part 变小），
 * 位移由内容尺寸与**视口内还能走多远**算出来——拖出窗口会让 Chrome 发 `pointercancel`。
 */
type CollapseProbe = {
    label: string;
    sashKey: string;
    /** 会被收起的 Part 叶（`left` / `right` / `panel`）：尺寸与收起态都读它自己的 `data-leaf` 叶。 */
    leafId: "left" | "right" | "panel";
    axis: "width" | "height";
    shrink: {x: number; y: number};
    /** 该 Part 的有效最小尺寸（左右栏宽 160、Panel 高 80）：拉回位移必须超过它才会重新展开。 */
    minimum: number;
};

/** 收起/恢复阈值（计划：CSS px，24）与拖大时的位移。 */
const EXPAND_THRESHOLD_PX = 24;
const GROW_TRAVEL_PX = 90;
/** 拉回位移比该 Part 的最小尺寸再多走的距离：落在「可行展开区」里，线必须绝对贴住鼠标。 */
const RESTORE_SLACK_PX = 80;
/**
 * 产品外壳的最小尺寸（CSS px）：左右栏宽 160、Panel 高 80，见 `app/utils/workbench/layout.ts`。
 * smoke 不 import 应用代码（只驱动浏览器），所以这里镜像常量；改产品下限时两处一起改。
 */
const SHELL_SIDE_MIN_PX = 160;
const SHELL_PANEL_MIN_HEIGHT_PX = 80;

/**
 * 收起/恢复探针：证明 pointer 路径**绝对跟随鼠标**，退出边界后不得把几何跳跃当新锚点。
 *
 * 计划里的 DOM 判据是「按下时记 `grabOffset = pointerAxis − sashCenterAxis`，之后每个采样点
 * `|sashCenterAxis − (pointerAxis − grabOffset)| ≤ 1 CSS px`」。这里按下点就取分隔线中心（grabOffset≈0），
 * 因此在可行展开区里等价于「线中心 == 鼠标坐标」。
 *
 * 两条路径分别证明：pointer 拉回得到**理想边界**（等于拉回位移，不是记忆尺寸）；按钮/Enter 显式展开
 * 才回到**记忆尺寸**。旧断言（26px 拉回＝回到记忆）在新合同下必须失败，所以这里改成绝对跟随区间。
 */
async function assertCollapseRoundTrip(page: Page, probe: CollapseProbe, failures: SmokeFailure[]): Promise<void> {
    /**
     * 尺寸读数取 **Part 叶**（`data-leaf`），与套件其余几何断言同一个源。
     *
     * 容器挂载点在 Part 叶里面还有内边距（左栏左右各 6px、面板上下各 16px），拿它当"Part 尺寸"
     * 会让绝对断言差出固定的一截（240 → 228、160 → 128）；差值断言（拖大量）反而看不出来。
     */
    const sizeOf = async (): Promise<number> => {
        const rect = (await readGeometry(page))[probe.leafId];
        return rect === null ? -1 : Math.round(rect[probe.axis]);
    };
    /**
     * 内容读数：Part 里当前活动容器的挂载点。
     *
     * 收起时**叶**还留着 1px 边界与命中带（读数是 12px），所以"内容完全不占用"这条只能读内容；
     * 展开后两者相差固定的一圈内边距，绝对位移断言读叶（叶与分隔线位置同源）。
     */
    const contentSizeOf = async (): Promise<number> => {
        const rect = await rectOf(page, `${partRoot(probe.leafId)} [data-container-mount]`);
        return rect === null ? -1 : Math.round(rect[probe.axis]);
    };
    const mainKey = probe.axis === "width" ? "width" : "height";
    const axisCenter = (rect: LeafRect): number => (probe.axis === "width" ? rect.left + rect.width / 2 : rect.top + rect.height / 2);
    const restEvents = (): Promise<number> => eventCount(page, "shell-resize");
    const modeNow = async (): Promise<string> => (await readGeometry(page)).mode;
    const baselineDiagnostics = await diagnosticsOf(page);

    /**
     * 指针落点必须真的落在这一格要拖的那条分隔线上。
     *
     * 分隔线只有 1px 宽，紧挨着它的可能是别的东西（Lab 画布自己的缩放柄、View 标题、容器标签）。
     * 命中错对象时后面的尺寸断言全都在量错的东西，表现为"手势没反应/尺寸差一点"，
     * 所以这里把实际命中直接写进失败原因，而不是让读数字猜。
     */
    const requireSashAt = async (point: {x: number; y: number}, label: string): Promise<void> => {
        // 1px 的分隔线：中心 724.5 之类要**向下**取整回到线内，取整向上会落到邻居元素上（自己造出假命中）。
        const hit = await page.evaluate(`(() => {
            const el = document.elementFromPoint(${Math.floor(point.x)}, ${Math.floor(point.y)});
            if (el === null) return "none";
            const sash = el.closest("[data-sash]");
            if (sash !== null) return "sash:" + sash.getAttribute("data-sash");
            const own = (name) => el.getAttribute(name);
            const text = (el.textContent ?? "").trim().slice(0, 30);
            return el.tagName.toLowerCase() + "[" + String(own("data-container-tab") ?? own("data-part") ?? own("data-view-id") ?? own("class") ?? text) + "]";
        })()`) as string;
        if (hit !== `sash:${probe.sashKey}`) {
            failures.push({kind: "assertion", message: `${label}：指针起点没落在分隔线 ${probe.sashKey} 上，命中的是 ${hit}——这一格的尺寸断言无定义`});
        }
    };

    /** 从当前分隔线中心按下：先确认命中，再交给通用拖动。 */
    const dragGuarded = async (dx: number, dy: number, label: string, options: {escape?: boolean} = {}): Promise<void> => {
        const rect = await rectOf(page, sashSelector(probe.sashKey));
        if (rect !== null && rect.width + rect.height > 0) {
            await requireSashAt({x: rect.left + rect.width / 2, y: rect.top + rect.height / 2}, label);
        }
        await dragSash(page, probe.sashKey, dx, dy, options);
    };



    /** 分栏呈现是全部分栏尺寸断言的前提：紧凑呈现里叶子是通宽卡片，读出来的宽度不是列宽。 */
    if ((await modeNow()) !== "split") {
        failures.push({kind: "assertion", message: `${probe.label}：当前是紧凑呈现（data-shell-layout=${await modeNow()}），分栏尺寸断言无定义；请用更宽的画布`});
        return;
    }

    /**
     * 在可行展开区里逐帧采样：返回每个采样点的 `{travel, size, drift}`，
     * `drift` 是「线中心 − 鼠标坐标」的绝对偏差，必须 ≤1px。
     */
    const followDrag = async (dx: number, dy: number, steps: number, label: string): Promise<{samples: {travel: number; size: number; drift: number}[]; start: LeafRect; ok: boolean}> => {
        const start = await rectOf(page, sashSelector(probe.sashKey));
        if (start === null || start.width + start.height <= 0) {
            failures.push({kind: "assertion", message: `${label}：找不到可拖的分隔线 ${probe.sashKey}`});
            return {samples: [], start: {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0}, ok: false};
        }
        const from = {x: start.left + start.width / 2, y: start.top + start.height / 2};
        const samples: {travel: number; size: number; drift: number}[] = [];
        await dragPointer(page, from, {x: from.x + dx, y: from.y + dy}, {
            steps,
            sample: async (progress) => {
                const sash = await rectOf(page, sashSelector(probe.sashKey));
                if (sash === null) {
                    return;
                }
                const pointerAxis = (probe.axis === "width" ? from.x + dx * progress : from.y + dy * progress);
                samples.push({
                    travel: Math.round(progress * Math.abs(dx + dy) * 10) / 10,
                    size: await sizeOf(),
                    drift: Math.abs(axisCenter(sash) - pointerAxis),
                });
            },
        });
        return {samples, start, ok: true};
    };

    // ⓪ 拖大：记忆尺寸必须明显高于默认值，否则「拉回不是记忆」无从证起；同时验证正向绝对跟随。
    const startSize = await sizeOf();
    assert(startSize > 0, failures, `${probe.label}：拖大之前内容应可见（实际 ${startSize}）`);
    const growEvents = await restEvents();
    const grow = await followDrag(-probe.shrink.x * GROW_TRAVEL_PX, -probe.shrink.y * GROW_TRAVEL_PX, 10, `${probe.label}拖大`);
    const memory = await sizeOf();
    assert(memory >= startSize + 40, failures, `${probe.label}：先把该 Part 拖大（记忆值应明显高于起点）：${startSize} → ${memory}`);
    assert(near(memory, startSize + GROW_TRAVEL_PX, 3), failures, `${probe.label}：拖大 ${GROW_TRAVEL_PX}px 应等量进入尺寸：${startSize} → ${memory}`);
    const growFeasible = grow.samples.filter((sample) => sample.size >= probe.minimum && sample.size <= memory + 2);
    assert(growFeasible.length >= 3, failures, `${probe.label}：拖大过程应留下至少 3 个可行区采样：${grow.samples.map((sample) => `${sample.size}@${sample.travel}`).join(" | ")}`);
    assert(growFeasible.every((sample) => sample.drift <= 1), failures, `${probe.label}：拖大时线中心应贴住鼠标（偏差 ≤1px）：${growFeasible.map((sample) => `${sample.size}px漂${sample.drift.toFixed(1)}`).join(" | ")}`);
    assert(await restEvents() === growEvents + 1, failures, `${probe.label}：拖大只应保存一次`);
    const grown = await readGeometry(page);
    assert((grown.editor?.[mainKey] ?? 0) > 0, failures, `${probe.label}：拖大之后余量叶（编辑区）仍应可见`);


    // ① 拖到零：一次手势一次保存，保留 1px 可拉回边界
    const sashStart = await rectOf(page, sashSelector(probe.sashKey));
    const viewport = page.viewportSize() ?? {width: 1600, height: 1000};
    if (sashStart === null) {
        failures.push({kind: "assertion", message: `${probe.label}：找不到分隔线 ${probe.sashKey}`});
        return;
    }
    const travel = probe.shrink.x !== 0
        ? (probe.shrink.x < 0 ? sashStart.left - 20 : viewport.width - sashStart.right - 20)
        : (probe.shrink.y < 0 ? sashStart.top - 20 : viewport.height - sashStart.bottom - 20);
    const distance = Math.min(memory + 160, Math.max(60, travel));
    const before = await restEvents();
    await dragGuarded(probe.shrink.x * distance, probe.shrink.y * distance, `${probe.label}拖到零`);
    const collapsedSize = await contentSizeOf();
    assert(collapsedSize === 0, failures, `${probe.label}拖到零后内容应完全不占用：实际 ${collapsedSize}`);
    const fresh = gestureDiagnostics(freshDiagnostics(baselineDiagnostics, await diagnosticsOf(page)));
    assert(fresh.length === 0, failures, `${probe.label}拖到零不该有手势级诊断：${fresh.join(" | ")}`);
    const sash = await rectOf(page, sashSelector(probe.sashKey));
    if (sash === null) {
        failures.push({kind: "assertion", message: `${probe.label}：收起后应保留可拉回的边界`});
    } else {
        assert(Math.round(probe.axis === "width" ? sash.width : sash.height) <= 1, failures, `${probe.label}：收起边界应只占 1px：${sash.width}x${sash.height}`);
    }
    const leafState = await page.locator(`${FIXTURE_ROOT} [data-panel-id="${probe.leafId}"]`).getAttribute("data-state");
    assert(leafState === "collapsed", failures, `${probe.label}：收起后叶的 data-state 应是 collapsed（实际 ${String(leafState)}）`);
    assert(await restEvents() === before + 1, failures, `${probe.label}：拖到零只应保存一次`);


    // ② 显式展开（分隔线上的 Enter）走**记忆尺寸**：与 pointer 路径分工不同
    /**
     * 读事件数会点右侧检查器的 tab（真实鼠标点击），**焦点会从分隔线移走**；
     * 所以顺序必须是「先读事件数 → 再把焦点交给分隔线 → 最后按 Enter」，
     * 否则 Enter 落在检查器 tab 上，分隔线的键盘路径根本收不到这次按键。
     */
    const keyEvents = await restEvents();
    const leaf = page.locator(sashSelector(probe.sashKey));
    await leaf.focus();
    const focusState = await page.evaluate(`(() => ({focused: document.activeElement?.getAttribute('data-sash') ?? document.activeElement?.tagName ?? null, mode: document.querySelector('[data-workbench-shell]')?.getAttribute('data-shell-layout') ?? null, leafState: document.querySelector('[data-panel-id="${probe.leafId}"]')?.getAttribute('data-state') ?? null, pane: (() => { const el = document.querySelector('[data-workbench-shell] [data-leaf="${probe.leafId}"]'); if (el === null) return 'absent'; const r = el.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); })(), sash: (() => { const el = document.querySelector(${JSON.stringify(sashSelector(probe.sashKey))}); if (el === null) return 'absent'; const r = el.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); })()}))()`);
    mark(`${probe.label}：Enter 之前 ${JSON.stringify(focusState)}`);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(320);
    // 显式展开走的是「键盘会话 → 提交 → 记录保存」链路：固定 320ms 在容器阶段之后不够稳，
    // 这里按真实尺寸轮询到落账为止（最多 2s），失败时下面的断言给出实际读数。
    let restoredByKey = await sizeOf();
    for (let attempt = 0; attempt < 8 && !near(restoredByKey, memory, 2); attempt += 1) {
        await page.waitForTimeout(220);
        restoredByKey = await sizeOf();
    }
    assert(near(restoredByKey, memory, 2), failures, `${probe.label}：Enter 显式展开应回到记忆尺寸 ${memory}，实际 ${restoredByKey}`);

    assert(await restEvents() === keyEvents + 1, failures, `${probe.label}：Enter 显式展开只应保存一次`);
    const keyPayload = await lastEvent(page, "shell-resize");
    assert(!/PanelWidth":0/u.test(keyPayload) && !/panelHeight":0/u.test(keyPayload), failures, `${probe.label}：显式展开不得把 0 写进尺寸偏好：${keyPayload}`);
    await dragGuarded(probe.shrink.x * distance, probe.shrink.y * distance, `${probe.label}再次拖到零`);
    assert(await contentSizeOf() === 0, failures, `${probe.label}：再次拖到零应收起`);

    // ③ 从边界拉回：绝对跟随鼠标，落点是理想边界（＝拉回位移），不是记忆尺寸
    const restoreTravel = probe.minimum + RESTORE_SLACK_PX;
    const restoreEvents = await restEvents();
    const restore = await followDrag(-probe.shrink.x * restoreTravel, -probe.shrink.y * restoreTravel, 24, `${probe.label}拉回`);
    const restored = await sizeOf();
    assert(near(restored, restoreTravel, 3), failures, `${probe.label}：拉回 ${restoreTravel}px 应得到同样大小的展开尺寸（理想边界），实际 ${restored}`);

    assert(Math.abs(restored - memory) > 20 || Math.abs(restoreTravel - memory) <= 20, failures, `${probe.label}：拉回不得跳回记忆尺寸 ${memory}（实际 ${restored}）`);
    const restoredFeasible = restore.samples.filter((sample) => sample.size >= probe.minimum && sample.size <= restored + 2);
    assert(restoredFeasible.length >= 3, failures, `${probe.label}：拉回过程应留下至少 3 个可行区采样：${restore.samples.map((sample) => `${sample.size}@${sample.travel}`).join(" | ")}`);
    assert(restoredFeasible.every((sample) => sample.drift <= 1), failures, `${probe.label}：拉回时线中心应贴住鼠标（偏差 ≤1px，旧实现会差出「记忆尺寸−位移」）：${restoredFeasible.map((sample) => `${sample.size}px漂${sample.drift.toFixed(1)}`).join(" | ")}`);
    assert(await restEvents() === restoreEvents + 1, failures, `${probe.label}：拉回只应保存一次`);
    const restoredPayload = await lastEvent(page, "shell-resize");
    assert(!/PanelWidth":0/u.test(restoredPayload) && !/panelHeight":0/u.test(restoredPayload), failures, `${probe.label}：恢复不得把 0 写进尺寸偏好：${restoredPayload}`);

    // ④ 反向/再正向的小位移仍然等量跟随（+10 / −10px 同步移动）
    const shrinkEvents = await restEvents();
    await dragGuarded(probe.shrink.x * 10, probe.shrink.y * 10, `${probe.label}反向 10px`);
    assert(near(await sizeOf(), restoreTravel - 10, 3), failures, `${probe.label}：反向 10px 应等量回到 ${restoreTravel - 10}`);
    assert(await restEvents() === shrinkEvents + 1, failures, `${probe.label}：反向 10px 只应保存一次`);
    // ⑤ 一步跨过阈值（不是逐帧挪过去）同样得到理想边界
    await dragGuarded(-probe.shrink.x * (EXPAND_THRESHOLD_PX + 40), -probe.shrink.y * (EXPAND_THRESHOLD_PX + 40), `${probe.label}一步跨阈值`);
    assert(near(await sizeOf(), restoreTravel + EXPAND_THRESHOLD_PX + 30, 3), failures, `${probe.label}：一步跨阈值后应继续按理想边界跟随`);
    // ⑥ Escape 回滚：零提交、零位移
    const escapeBefore = await sizeOf();
    const escapeEvents = await restEvents();
    await dragGuarded(probe.shrink.x * 60, probe.shrink.y * 60, `${probe.label}Escape 取消`, {escape: true});
    assert(near(await sizeOf(), escapeBefore, 2), failures, `${probe.label}：Escape 取消后尺寸应回基线：${escapeBefore} → ${await sizeOf()}`);
    assert(await restEvents() === escapeEvents, failures, `${probe.label}：Escape 取消不得保存`);
    // ⑥ 的 Escape 是**故意**产生的取消诊断：后面的「不该有手势级诊断」必须以它为基线，
    // 否则这一格会把自家这一步当成回归报出来（旧断言就是这么误报的）。
    const afterEscapeDiagnostics = await diagnosticsOf(page);

    // ⑦ 余量兄弟没有被这次收起/恢复挤成 0：编辑区与另一侧栏应回到收起前的几何
    const after = await readGeometry(page);
    assert(after.mode === "split", failures, `${probe.label}：收起往返之后应仍是分栏呈现（实际 ${after.mode}）`);
    assert((after.editor?.[mainKey] ?? 0) > 0, failures, `${probe.label}：收起往返之后余量叶（编辑区）仍应可见：${after.editor?.[mainKey]}`);
    if (grown.editor !== null && after.editor !== null) {
        assert(near(after.editor[mainKey], grown.editor[mainKey], 4 * (EXPAND_THRESHOLD_PX + 40) + 3), failures, `${probe.label}：收起往返之后编辑区尺寸应可解释：${grown.editor[mainKey]} → ${after.editor[mainKey]}`);
    }
    const siblingKey = probe.leafId === "left" ? "right" : "left";
    const siblingBefore = grown[siblingKey];
    const siblingAfter = after[siblingKey];
    if (siblingBefore !== null && siblingBefore !== undefined && siblingAfter !== null && siblingAfter !== undefined) {
        assert(near(siblingAfter.width, siblingBefore.width, 4), failures, `${probe.label}：另一侧栏不得被挤走：${siblingBefore.width} → ${siblingAfter.width}`);
    }
    const restoreFresh = gestureDiagnostics(freshDiagnostics(afterEscapeDiagnostics, await diagnosticsOf(page)));
    assert(restoreFresh.length === 0, failures, `${probe.label}：收起往返不该有手势级诊断：${restoreFresh.join(" | ")}`);
}

