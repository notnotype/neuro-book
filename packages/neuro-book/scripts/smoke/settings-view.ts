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
            layout.sectionCount === 1 && layout.activeSections === 1,
            failures,
            `区段导航应只列出可渲染的区段并标出当前项：${JSON.stringify(layout)}`,
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
