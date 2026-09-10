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
            layout.scopeCount === 4 && layout.scopeDisabled === 2,
            failures,
            `作用域选择器应给出四档并禁用未迁移的两档：${JSON.stringify(layout)}`,
        );
        assert(
            layout.sectionCount === 5 && layout.activeSections === 1,
            failures,
            `区段导航应列出五个已迁移区段并只标出一个当前项：${JSON.stringify(layout)}`,
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

        stage = "切回 Agent Profile 区段";
        await page.locator(".settings-nav-aside nav ul li button").filter({hasText: "Agent Profile 模型"}).first().click();
        await page.waitForTimeout(200);

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
        console.log(`Settings view layout: ${JSON.stringify(layout)}`);
    } catch (error) {
        failures.push({kind: "assertion", message: `NovelIdeSettingsView smoke 在「${stage}」失败：${error instanceof Error ? error.message : String(error)}`});
    }
}
