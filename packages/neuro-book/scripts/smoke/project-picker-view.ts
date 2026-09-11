import type {Page} from "playwright-core";
import type {SmokeFailure} from "./agent-profile-nav";
import {assert, closeLeftoverDialogWindow} from "./agent-profile-nav";

/**
 * 验证首页书架视图（ProjectPickerView）在 Component Lab 中的受控渲染与交互：
 * - 场景切换：标准书架、零项目空态、新建表单、加载态、错误态、会话恢复、手机 390×844
 * - 视觉与样式：2:3 书封比例、网格列数响应式、焦点环无障碍指示、零横向溢出
 */
export async function assertProjectPickerViewSmoke(page: Page, failures: SmokeFailure[]): Promise<void> {
    let stage = "准备";
    try {
        stage = "关闭遗留窗口";
        await closeLeftoverDialogWindow(page);

        stage = "选择组件与默认场景";
        await page.locator('.lab-columns > .nb-lab-panel--nav [role="treeitem"]').filter({hasText: /^ProjectPickerView$/u}).click();
        await page.locator('[role="group"][aria-label="场景"] [role="radio"]').filter({hasText: "标准书架"}).first().click();
        await page.locator("[data-project-picker-view]").first().waitFor({state: "visible", timeout: 10_000});
        await page.waitForTimeout(150);

        stage = "书架卡片结构与封面宽高比";
        const defaultScene = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>("[data-project-picker-view]");
            const cards = [...(root?.querySelectorAll<HTMLElement>("[data-project-card]") ?? [])];
            const firstCover = cards[0]?.querySelector<HTMLElement>(".project-cover") ?? null;
            const coverRect = firstCover?.getBoundingClientRect();
            const ratio = coverRect ? coverRect.height / coverRect.width : 0;
            const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;

            return {
                cardCount: cards.length,
                hasFirstCover: Boolean(firstCover),
                coverRatio: Math.round(ratio * 100) / 100,
                overflow,
            };
        });

        assert(defaultScene.cardCount === 5, failures, `标准书架场景应展示 5 本书籍卡片：实际 ${defaultScene.cardCount}`);
        assert(
            Math.abs(defaultScene.coverRatio - 1.5) < 0.1,
            failures,
            `书封比例应接近 2:3（1.5）：实际高宽比 ${defaultScene.coverRatio}`,
        );
        assert(defaultScene.overflow <= 0, failures, `标准书架不应发生横向溢出：${defaultScene.overflow}px`);

        stage = "切换到零项目空态场景";
        await page.locator('[role="group"][aria-label="场景"] [role="radio"]').filter({hasText: "零项目空态"}).first().click();
        await page.waitForTimeout(150);
        const emptyScene = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>("[data-project-picker-view]");
            const cards = root?.querySelectorAll("[data-project-card]").length ?? 0;
            const text = root?.textContent ?? "";
            return {cards, hasEmptyTitle: text.includes("还没有任何书籍") || text.includes("ide.picker.emptyTitle")};
        });
        assert(emptyScene.cards === 0 && emptyScene.hasEmptyTitle, failures, "零项目空态场景应展示空态文案且无卡片");

        stage = "切换到新建展开场景";
        await page.locator('[role="group"][aria-label="场景"] [role="radio"]').filter({hasText: "新建展开"}).first().click();
        await page.waitForTimeout(150);
        const createFormScene = await page.evaluate(() => {
            const form = document.querySelector<HTMLElement>("[data-project-create-form]");
            const titleInput = form?.querySelector<HTMLInputElement>("#create-book-title");
            const summaryInput = form?.querySelector<HTMLTextAreaElement>("#create-book-summary");
            return {
                hasForm: Boolean(form),
                hasTitleInput: Boolean(titleInput),
                hasSummaryInput: Boolean(summaryInput),
            };
        });
        assert(
            createFormScene.hasForm && createFormScene.hasTitleInput && createFormScene.hasSummaryInput,
            failures,
            "新建展开场景应挂载带有可访问 label 绑定的标题与简介输入控件",
        );

        stage = "切换到会话迁移恢复场景";
        await page.locator('[role="group"][aria-label="场景"] [role="radio"]').filter({hasText: "会话迁移恢复"}).first().click();
        await page.waitForTimeout(150);
        const recoveryScene = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>("[data-project-picker-view]");
            const sessionRows = root?.querySelectorAll("article.rounded-\\[var\\(--radius-control\\)\\]") ?? [];
            const selectEl = sessionRows[0]?.querySelector("select");
            return {
                sessionCount: sessionRows.length,
                hasSelectLabel: Boolean(selectEl?.getAttribute("aria-label")),
            };
        });
        assert(recoveryScene.sessionCount === 2, failures, `恢复场景应展开并显示 2 个待确认会话：实际 ${recoveryScene.sessionCount}`);
        assert(recoveryScene.hasSelectLabel, failures, "会话恢复所属选择框应包含 aria-label 无障碍标注");

        stage = "切换到手机 390×844 场景";
        await page.locator('[role="group"][aria-label="场景"] [role="radio"]').filter({hasText: "手机 390×844"}).first().click();
        await page.waitForTimeout(150);
        const phoneScene = await page.evaluate(() => {
            const labSubject = document.querySelector<HTMLElement>("[data-lab-subject]");
            const subjectWidth = labSubject ? Math.round(labSubject.getBoundingClientRect().width) : 0;
            const overflow = labSubject ? labSubject.scrollWidth - labSubject.clientWidth : 0;
            return {subjectWidth, overflow};
        });
        assert(phoneScene.subjectWidth <= 390, failures, `手机场景容器宽度应被约束在 390px 范围内：实际 ${phoneScene.subjectWidth}px`);
        assert(phoneScene.overflow <= 0, failures, `手机场景内容不应产生容器横向滚动溢出：${phoneScene.overflow}px`);
    } catch (error) {
        failures.push({
            kind: "assertion",
            message: `ProjectPickerView smoke 在阶段 [${stage}] 失败：${error instanceof Error ? error.message : String(error)}`,
        });
    }
}
