import type {Page} from "playwright-core";
import type {SmokeFailure} from "./agent-profile-nav";
import {assert, closeLeftoverDialogWindow} from "./agent-profile-nav";

/**
 * 验证设置外壳（NovelIdeSettingsView）在 Component Lab 中的组合：
 * 作用域切换、区段导航、栏间竖线与内容列都由真实计算样式核对，不使用业务 store。
 */
export async function assertSettingsViewSmoke(page: Page, failures: SmokeFailure[]): Promise<void> {
    let stage = "准备";
    try {
        stage = "关闭遗留窗口";
        await closeLeftoverDialogWindow(page);
        stage = "选择组件与场景";
        await page.locator('[role="treeitem"]').filter({hasText: /^NovelIdeSettingsView$/u}).click();
        await page.locator('[role="group"][aria-label="场景"] [role="radio"]').filter({hasText: "全局设定"}).first().click();
        // 用外壳独有的作用域选择器定位：文档里可能还留着别的 fixture（甚至 teleport 出去的窗口内容）。
        await page.locator('[aria-label="配置作用域"]').first().waitFor({state: "visible", timeout: 10_000});
        await page.waitForTimeout(150);

        stage = "外壳结构";
        const layout = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>('[aria-label="配置作用域"]')?.closest<HTMLElement>(".settings-view-root") ?? null;
            const rail = root?.querySelector<HTMLElement>(".settings-nav-aside") ?? null;
            const detail = root?.querySelector<HTMLElement>(".settings-detail-section") ?? null;
            const railLine = rail ? getComputedStyle(rail, "::after") : null;
            const scopes = [...(rail?.querySelectorAll('[aria-label="配置作用域"] [role="radio"]') ?? [])];
            const sections = [...(rail?.querySelectorAll("nav ul li button") ?? [])];
            const nested = detail?.querySelectorAll(".settings-view-root").length ?? 0;
            const overflow: number = document.documentElement.scrollWidth - document.documentElement.clientWidth;
            return {
                railDisplay: rail ? getComputedStyle(rail).display : "",
                railWidth: rail ? Math.round(rail.getBoundingClientRect().width) : 0,
                railLineDisplay: railLine?.display ?? "",
                railLineWidth: railLine?.width ?? "",
                detailDisplay: detail ? getComputedStyle(detail).display : "",
                barDisplay: detail ? getComputedStyle(detail.querySelector<HTMLElement>(".settings-mobile-bar")!).display : "",
                scopeCount: scopes.length,
                scopeDisabled: scopes.filter((scope) => scope.hasAttribute("disabled") || scope.getAttribute("aria-disabled") === "true").length,
                sectionCount: sections.length,
                activeSections: sections.filter((section) => section.getAttribute("aria-current") === "page").length,
                nestedViews: nested,
                overflow,
            };
        });
        assert(
            layout.railDisplay === "flex"
                && layout.railWidth === 276
                && layout.railLineDisplay !== "none"
                && layout.railLineWidth !== "0px"
                && layout.detailDisplay === "flex"
                && layout.barDisplay === "none",
            failures,
            `设置外壳应是一栏导航轨 + 内容区，轨宽 276px 且带栏间竖线：${JSON.stringify(layout)}`,
        );
        assert(
            layout.scopeCount === 4 && layout.scopeDisabled === 0,
            failures,
            `作用域选择器应给出四档且都可进入：${JSON.stringify(layout)}`,
        );
        assert(
            layout.sectionCount === 6 && layout.activeSections === 1,
            failures,
            `区段导航应列出六个已迁移区段并只标出一个当前项：${JSON.stringify(layout)}`,
        );
        assert(layout.overflow <= 0, failures, `设置外壳不应造成页面级横向溢出：${JSON.stringify(layout)}`);

        stage = "内容槽渲染真实区段体";
        const slot = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>('[aria-label="配置作用域"]')?.closest<HTMLElement>(".settings-view-root") ?? null;
            const host = root?.querySelector<HTMLElement>(".settings-detail-section") ?? null;
            const nested = host ? [...host.querySelectorAll<HTMLElement>(".settings-view-root")] : [];
            const nestedRoot = nested[0] ?? null;
            const nestedRail = nestedRoot?.querySelector<HTMLElement>(".settings-nav-aside") ?? null;
            return {
                nested: nested.length,
                nestedWidth: nestedRoot ? Math.round(nestedRoot.getBoundingClientRect().width) : 0,
                nestedRailDisplay: nestedRail ? getComputedStyle(nestedRail).display : "",
                text: host?.textContent?.slice(0, 80) ?? "",
            };
        });
        assert(
            slot.nested === 1 && slot.text.includes("Agent Profiles"),
            failures,
            `内容槽应挂载已迁移的 Agent Profile 设置视图：${JSON.stringify(slot)}`,
        );
        assert(
            slot.nestedWidth > 0
                && (slot.nestedWidth < 700 ? slot.nestedRailDisplay === "none" : slot.nestedRailDisplay === "flex"),
            failures,
            `嵌套区段体应按自身容器宽度决定单栏或双栏：${JSON.stringify(slot)}`,
        );

        stage = "切到可观测区段";
        await page.locator(".settings-nav-aside nav ul li button").filter({hasText: "可观测"}).first().click();
        await page.waitForTimeout(200);
        const sectionSwitch = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>('[aria-label="配置作用域"]')?.closest<HTMLElement>(".settings-view-root") ?? null;
            const rows = [...(root?.querySelectorAll<HTMLElement>(".settings-nav-aside nav ul li button") ?? [])];
            const body = root?.querySelector<HTMLElement>(".settings-detail-section") ?? null;
            return {
                active: rows.filter((row) => row.getAttribute("aria-current") === "page").map((row) => row.textContent?.trim().slice(0, 3) ?? ""),
                switches: body ? body.querySelectorAll('[role="switch"]').length : 0,
                hasTraceTitle: body?.textContent?.includes("请求") ?? false,
            };
        });
        assert(
            sectionSwitch.active.length === 1 && sectionSwitch.active[0] === "可观测" && sectionSwitch.switches === 1 && sectionSwitch.hasTraceTitle,
            failures,
            `切到可观测区段应挂载该区段的真实视图：${JSON.stringify(sectionSwitch)}`,
        );

        stage = "切到 Web 工具区段";
        await page.locator(".settings-nav-aside nav ul li button").filter({hasText: "Web 工具"}).first().click();
        await page.waitForTimeout(200);
        const webSection = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>('[aria-label="配置作用域"]')?.closest<HTMLElement>(".settings-view-root") ?? null;
            const body = root?.querySelector<HTMLElement>(".settings-detail-section") ?? null;
            const providerRows = body ? [...body.querySelectorAll("article")] : [];
            return {
                providers: providerRows.length,
                switches: body ? body.querySelectorAll('[role="switch"]').length : 0,
                moveButtons: body ? body.querySelectorAll('button[title*="上移"], button[title*="下移"]').length : 0,
                hasFallbackHint: (body?.textContent ?? "").includes("Fallback:"),
            };
        });
        assert(
            webSection.providers === 2 && webSection.switches === 4 && webSection.moveButtons === 4 && webSection.hasFallbackHint,
            failures,
            `切到 Web 工具区段应挂载该区段的真实表单：${JSON.stringify(webSection)}`,
        );

        stage = "切到向量嵌入区段";
        await page.locator(".settings-nav-aside nav ul li button").filter({hasText: "向量嵌入"}).first().click();
        await page.waitForTimeout(200);
        const embeddingSection = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>('[aria-label="配置作用域"]')?.closest<HTMLElement>(".settings-view-root") ?? null;
            const body = root?.querySelector<HTMLElement>(".settings-detail-section") ?? null;
            const grid = body?.querySelector<HTMLElement>(".embedding-grid") ?? null;
            const gridStyle = grid ? getComputedStyle(grid) : null;
            return {
                switches: body ? body.querySelectorAll('[role="switch"]').length : 0,
                inputs: body ? body.querySelectorAll("input").length : 0,
                textareas: body ? body.querySelectorAll("textarea").length : 0,
                columns: gridStyle ? gridStyle.gridTemplateColumns.split(" ").length : 0,
                hasBaseUrl: body?.textContent?.includes("Base URL") ?? false,
            };
        });
        assert(
            embeddingSection.switches === 1 && embeddingSection.inputs >= 5 && embeddingSection.textareas === 1 && embeddingSection.hasBaseUrl,
            failures,
            `切到向量嵌入区段应挂载该区段的真实表单：${JSON.stringify(embeddingSection)}`,
        );
        assert(embeddingSection.columns === 1 || embeddingSection.columns === 2, failures, `嵌入表单栅格应为一或两栏：${JSON.stringify(embeddingSection)}`);

        stage = "切到费用显示区段";
        await page.locator(".settings-nav-aside nav ul li button").filter({hasText: "费用显示"}).first().click();
        await page.waitForTimeout(200);
        const costSection = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>('[aria-label="配置作用域"]')?.closest<HTMLElement>(".settings-view-root") ?? null;
            const body = root?.querySelector<HTMLElement>(".settings-detail-section") ?? null;
            return {
                radios: body ? body.querySelectorAll('[role="radio"]').length : 0,
                hasRefresh: body?.textContent?.includes("刷新") ?? false,
                hasRate: /1 USD = [\d.]+ CNY/u.test(body?.textContent ?? ""),
            };
        });
        assert(
            costSection.radios === 2 && costSection.hasRefresh && costSection.hasRate,
            failures,
            `切到费用显示区段应挂载该区段的真实视图：${JSON.stringify(costSection)}`,
        );

        stage = "切到模型区段";
        await page.locator(".settings-nav-aside nav ul li button").filter({hasText: "模型设置"}).first().click();
        await page.waitForTimeout(200);
        const modelSection = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>('[aria-label="配置作用域"]')?.closest<HTMLElement>(".settings-view-root") ?? null;
            const body = root?.querySelector<HTMLElement>(".settings-detail-section") ?? null;
            return {
                providerRows: body ? body.querySelectorAll("[data-provider-row]").length : 0,
                savedModelRows: body ? body.querySelectorAll("[data-saved-model-row]").length : 0,
                passwordInputs: body ? body.querySelectorAll('input[type="password"]').length : 0,
                numberInputs: body ? body.querySelectorAll('input[type="number"]').length : 0,
                textareas: body ? body.querySelectorAll("textarea").length : 0,
                hasRailHeading: (body?.textContent ?? "").includes("Providers"),
            };
        });
        assert(
            modelSection.providerRows === 1 && modelSection.savedModelRows === 2 && modelSection.hasRailHeading,
            failures,
            `模型区段应渲染一个 Provider 导轨项与两个已保存模型行：${JSON.stringify(modelSection)}`,
        );
        assert(
            modelSection.passwordInputs === 1 && modelSection.numberInputs === 2 && modelSection.textareas === 1,
            failures,
            `模型区段应渲染 API Key、两个数字字段与请求扩展参数：${JSON.stringify(modelSection)}`,
        );

        stage = "模型区段对话框";
        await page.locator('.settings-detail-section button[title="编辑设置"]').first().click();
        await page.waitForTimeout(300);
        const editDialog = await page.evaluate(() => {
            const surfaces = [...document.querySelectorAll<HTMLElement>("[data-dialog-surface]")].filter((surface) => surface.getBoundingClientRect().width > 0);
            return {surfaces: surfaces.length, hasTabs: surfaces.some((surface) => (surface.textContent ?? "").includes("基本信息"))};
        });
        assert(
            editDialog.surfaces >= 1 && editDialog.hasTabs,
            failures,
            `点「编辑设置」应打开带页签的模型编辑对话框：${JSON.stringify(editDialog)}`,
        );

        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        const editDialogClosed = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-dialog-surface]")]
            .filter((surface) => surface.getBoundingClientRect().width > 0).length);
        assert(editDialogClosed === 0, failures, `Escape 应关闭模型编辑对话框：${String(editDialogClosed)}`);

        await page.locator(".settings-detail-section").getByText("从 Model Library 添加").first().click();
        await page.waitForTimeout(300);
        const libraryDialog = await page.evaluate(() => {
            const surfaces = [...document.querySelectorAll<HTMLElement>("[data-dialog-surface]")].filter((surface) => surface.getBoundingClientRect().width > 0);
            return {surfaces: surfaces.length, hasTitle: surfaces.some((surface) => (surface.textContent ?? "").includes("模型管理库"))};
        });
        assert(
            libraryDialog.surfaces >= 1 && libraryDialog.hasTitle,
            failures,
            `点「从 Model Library 添加」应打开模型管理库对话框：${JSON.stringify(libraryDialog)}`,
        );
        await page.keyboard.press("Escape");
        await page.waitForTimeout(250);

        stage = "切回 Agent Profile 区段";
        await page.locator(".settings-nav-aside nav ul li button").filter({hasText: "Agent Profile 模型"}).first().click();
        await page.waitForTimeout(200);

        stage = "切到启动作用域";
        await page.locator('[aria-label="配置作用域"] [role="radio"]').filter({hasText: "启动"}).first().click();
        await page.waitForTimeout(200);
        const bootScope = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>('[aria-label="配置作用域"]')?.closest<HTMLElement>(".settings-view-root") ?? null;
            const rows = [...(root?.querySelectorAll<HTMLElement>(".settings-nav-aside nav ul li button") ?? [])];
            const body = root?.querySelector<HTMLElement>(".settings-detail-section") ?? null;
            const example = body?.querySelector("pre") ?? null;
            const text = body?.textContent ?? "";
            return {
                sections: rows.length,
                active: rows.filter((row) => row.getAttribute("aria-current") === "page").map((row) => row.textContent?.trim().slice(0, 3) ?? ""),
                hasAuthKey: text.includes("auth.enabled"),
                examples: body ? body.querySelectorAll("pre").length : 0,
                exampleText: example?.textContent ?? "",
                hasStatusLabel: /当前已开启|当前已关闭|状态读取中/u.test(text),
            };
        });
        assert(
            bootScope.sections === 1 && bootScope.active.length === 1 && bootScope.active[0] === "密码保",
            failures,
            `启动作用域应只有密码保护区段且为当前项：${JSON.stringify(bootScope)}`,
        );
        assert(
            bootScope.hasAuthKey && bootScope.examples === 1 && bootScope.exampleText.includes("auth:") && bootScope.hasStatusLabel,
            failures,
            `密码保护区段应渲染 auth.enabled 状态与示例 YAML：${JSON.stringify(bootScope)}`,
        );

        stage = "切到本机作用域";
        await page.locator('[aria-label="配置作用域"] [role="radio"]').filter({hasText: "本机"}).first().click();
        await page.waitForTimeout(200);
        const browserScope = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>('[aria-label="配置作用域"]')?.closest<HTMLElement>(".settings-view-root") ?? null;
            const rows = [...(root?.querySelectorAll<HTMLElement>(".settings-nav-aside nav ul li button") ?? [])];
            return {sections: rows.length, labels: rows.map((row) => row.textContent?.trim().slice(0, 3) ?? "")};
        });
        assert(
            browserScope.sections === 2 && browserScope.labels.join(",") === "编辑器,桌面应",
            failures,
            `本机作用域应列出编辑器与桌面应用两个区段：${JSON.stringify(browserScope)}`,
        );

        stage = "切到编辑器区段";
        await page.locator(".settings-nav-aside nav ul li button").filter({hasText: "编辑器"}).first().click();
        await page.waitForTimeout(200);
        const editorSection = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>('[aria-label="配置作用域"]')?.closest<HTMLElement>(".settings-view-root") ?? null;
            const body = root?.querySelector<HTMLElement>(".settings-detail-section") ?? null;
            return {
                numberInputs: body ? body.querySelectorAll('input[type="number"]').length : 0,
                fontInputs: body ? body.querySelectorAll('input[placeholder="输入 CSS font-family"]').length : 0,
                fontSizeBounds: body ? body.querySelectorAll('input[min="12"][max="28"]').length : 0,
                lineHeightBounds: body ? body.querySelectorAll('input[min="1.2"][max="2.6"]').length : 0,
                contentWidthBounds: body ? body.querySelectorAll('input[min="520"][max="1280"]').length : 0,
                disabledNumberInputs: body ? body.querySelectorAll('input[type="number"][disabled]').length : 0,
                switches: body ? body.querySelectorAll('[role="switch"]').length : 0,
                textareas: body ? body.querySelectorAll("textarea").length : 0,
            };
        });
        assert(
            editorSection.numberInputs === 7
                && editorSection.fontSizeBounds === 1
                && editorSection.lineHeightBounds === 1
                && editorSection.contentWidthBounds === 1,
            failures,
            `编辑器区段应渲染七个带区间的数字字段：${JSON.stringify(editorSection)}`,
        );
        assert(
            editorSection.fontInputs === 2 && editorSection.switches === 5 && editorSection.textareas === 0,
            failures,
            `编辑器区段应有两处字体联想输入与五个开关：${JSON.stringify(editorSection)}`,
        );
        assert(
            editorSection.disabledNumberInputs === 1,
            failures,
            `段首缩进关闭时其缩进量输入框应保持可见但禁用：${JSON.stringify(editorSection)}`,
        );

        stage = "切到桌面应用区段";
        await page.locator(".settings-nav-aside nav ul li button").filter({hasText: "桌面应用"}).first().click();
        await page.waitForTimeout(200);
        const desktopSection = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>('[aria-label="配置作用域"]')?.closest<HTMLElement>(".settings-view-root") ?? null;
            const body = root?.querySelector<HTMLElement>(".settings-detail-section") ?? null;
            const range = body?.querySelector<HTMLInputElement>('input[type="range"]') ?? null;
            return {
                ranges: body ? body.querySelectorAll('input[type="range"]').length : 0,
                rangeMin: range?.getAttribute("min") ?? "",
                rangeMax: range?.getAttribute("max") ?? "",
                hasZoomLabel: (body?.textContent ?? "").includes("100%"),
                switches: body ? body.querySelectorAll('[role="switch"]').length : 0,
                comboboxes: body ? body.querySelectorAll('[role="combobox"]').length : 0,
            };
        });
        assert(
            desktopSection.ranges === 1 && desktopSection.rangeMin === "0.75" && desktopSection.rangeMax === "2",
            failures,
            `桌面应用区段应有一个 0.75–2 的缩放滑杆：${JSON.stringify(desktopSection)}`,
        );
        assert(
            desktopSection.hasZoomLabel && desktopSection.switches === 1 && desktopSection.comboboxes === 1,
            failures,
            `桌面应用区段应显示当前缩放百分比、一个托盘开关与一个关闭行为下拉：${JSON.stringify(desktopSection)}`,
        );

        stage = "切到项目作用域";
        await page.locator('[aria-label="配置作用域"] [role="radio"]').filter({hasText: "项目"}).first().click();
        await page.waitForTimeout(150);
        const project = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>('[aria-label="配置作用域"]')?.closest<HTMLElement>(".settings-view-root") ?? null;
            const checked = [...(root?.querySelectorAll('[aria-label="配置作用域"] [role="radio"]') ?? [])]
                .filter((scope) => scope.getAttribute("aria-checked") === "true")
                .map((scope) => scope.textContent?.trim() ?? "");
            const targetRow = root?.querySelector<HTMLElement>(".settings-nav-aside");
            const labels = [...(root?.querySelectorAll(".settings-detail-section h1, .settings-detail-section h2") ?? [])].map((heading) => heading.textContent?.trim() ?? "");
            return {
                checked,
                targetVisible: root?.textContent?.includes("C:/novels/长夜行") ?? false,
                railText: targetRow?.textContent?.trim() ?? "",
                labels,
            };
        });
        assert(
            project.checked.length === 1 && project.checked[0] === "项目" && project.targetVisible,
            failures,
            `切到项目作用域后应选中该档并显示配置目标：${JSON.stringify(project)}`,
        );

        stage = "切回全局作用域";
        await page.locator('[aria-label="配置作用域"] [role="radio"]').filter({hasText: "全局"}).first().click();
        await page.waitForTimeout(150);
        const back = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>('[aria-label="配置作用域"]')?.closest<HTMLElement>(".settings-view-root") ?? null;
            const checked = [...(root?.querySelectorAll('[aria-label="配置作用域"] [role="radio"]') ?? [])]
                .filter((scope) => scope.getAttribute("aria-checked") === "true")
                .map((scope) => scope.textContent?.trim() ?? "");
            return {
                checked,
                targetVisible: root?.textContent?.includes("C:/novels/长夜行") ?? false,
            };
        });
        assert(
            back.checked.length === 1 && back.checked[0] === "全局" && !back.targetVisible,
            failures,
            `切回全局后应隐藏项目目标行：${JSON.stringify(back)}`,
        );

        // 产品里模型编辑窗口是从设置窗口里开出来的：两层都是 DialogWindow，层级与 Esc 必须在真实浏览器里成立。
        stage = "模型对话框嵌在设置窗口里";
        await page.locator('[role="group"][aria-label="场景"] [role="radio"]').filter({hasText: "DialogWindow 内嵌"}).first().click();
        await page.waitForTimeout(400);
        await page.locator('[aria-label="配置作用域"]').first().waitFor({state: "visible", timeout: 10_000});
        await page.locator(".settings-nav-aside nav ul li button").filter({hasText: "模型设置"}).first().click();
        await page.waitForTimeout(300);
        const visibleSurfaceLayers = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-dialog-surface]")]
            .filter((surface) => surface.getBoundingClientRect().width > 0)
            .map((surface) => getComputedStyle(surface).zIndex));
        const outerLayers = await visibleSurfaceLayers();
        assert(
            outerLayers.length === 1 && outerLayers[0] === "8990",
            failures,
            `设置窗口本体应是 8990：${JSON.stringify(outerLayers)}`,
        );

        await page.locator('[data-dialog-surface] button[title="编辑设置"]').first().click();
        await page.waitForTimeout(400);
        const stackedLayers = await visibleSurfaceLayers();
        assert(
            stackedLayers.length === 2 && stackedLayers[0] === "8990" && stackedLayers[1] === "8992",
            failures,
            `从窗口里开出来的窗口应压在外层之上：${JSON.stringify(stackedLayers)}`,
        );

        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        const afterNestedEscape = await visibleSurfaceLayers();
        assert(
            afterNestedEscape.length === 1 && afterNestedEscape[0] === "8990",
            failures,
            `Escape 只应关掉最上面那个窗口：${JSON.stringify(afterNestedEscape)}`,
        );

        await page.keyboard.press("Escape");
        await page.waitForTimeout(250);

        console.log(`Settings view layout: ${JSON.stringify(layout)}`);
    } catch (error) {
        failures.push({kind: "assertion", message: `NovelIdeSettingsView smoke 在「${stage}」失败：${error instanceof Error ? error.message : String(error)}`});
    }
}
