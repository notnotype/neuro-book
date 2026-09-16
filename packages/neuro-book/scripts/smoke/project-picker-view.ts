import type {Page} from "playwright-core";
import type {SmokeFailure} from "./agent-profile-nav";
import {assert, closeLeftoverDialogWindow} from "./agent-profile-nav";

const SCENE_GROUP = '[role="group"][aria-label="场景"]';
const COVER_ROUTE = "**/api/projects/cover**";

/** 1×1 透明 PNG：夹具封面请求的本地定格响应，见 `stubFixtureCoverRequests`。 */
const FIXTURE_COVER_PLACEHOLDER = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64",
);

/**
 * 验证首页书架视图（ProjectPickerView）在 Component Lab 中的受控渲染与交互。
 *
 * 场景与断言按当前 fixture（`app/component-lab/fixtures/index.ts` 的 `component: "ProjectPickerView"`）标定，
 * 场景切换一律用 SegmentedControl 的稳定 `data-value`（值即 fixture 场景 id），不再依赖会随改版换词的 label：
 * `default`（经典网格）、`compact`（密集列表）、`editorial`（宽幅图文）、`empty`（零项目空态）、
 * `create-dialog`（新建对话框）、`loading`（加载中）、`load-error`（加载失败）、`phone`（手机 390×844）。
 * fixture 的 `creating`（创建中，对话框内部状态）由 `ProjectPickerViewFixture.test.ts` 覆盖，此处不重复。
 *
 * 覆盖：经典网格的卡片数量、2:3 书封比例、零横向溢出、封面图像或排版回退、三种布局视图逐条列出作品、
 * 空态/加载态/错误态的主区域分支与手机 390 容器约束。
 */
export async function assertProjectPickerViewSmoke(page: Page, failures: SmokeFailure[]): Promise<void> {
    let stage = "准备";
    await stubFixtureCoverRequests(page);
    try {
        stage = "关闭遗留窗口";
        await closeLeftoverDialogWindow(page);

        stage = "选择组件与默认场景";
        await page.locator('.lab-columns > .nb-lab-panel--nav [role="treeitem"]').filter({hasText: /^ProjectPickerView$/u}).click();
        await selectScene(page, "default");
        await page.locator("[data-project-picker-view]").first().waitFor({state: "visible", timeout: 10_000});
        await page.waitForTimeout(150);

        stage = "经典网格的卡片数量、封面宽高比与横向溢出";
        const gridScene = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>("[data-project-picker-view]");
            const cards = [...(root?.querySelectorAll<HTMLElement>("[data-project-card]") ?? [])];
            const coverRect = cards[0]?.querySelector<HTMLElement>(".project-cover")?.getBoundingClientRect();

            return {
                cardCount: cards.length,
                hasFirstCover: Boolean(coverRect),
                coverRatio: coverRect && coverRect.width > 0 ? Math.round((coverRect.height / coverRect.width) * 100) / 100 : 0,
                overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
        });

        // 经典网格逐张陈列夹具的 14 部作品（`ProjectPickerViewFixture.vue` 的 SAMPLE_PROJECTS 长度，fixture 单测同样按 14 断言）。
        assert(gridScene.cardCount === 14, failures, `经典网格应陈列全部 14 张作品卡片：实际 ${gridScene.cardCount}`);
        assert(gridScene.hasFirstCover, failures, "经典网格的首张卡片应挂载书封容器");
        assert(
            Math.abs(gridScene.coverRatio - 1.5) < 0.1,
            failures,
            `书封比例应接近 2:3（1.5）：实际高宽比 ${gridScene.coverRatio}`,
        );
        assert(gridScene.overflow <= 0, failures, `经典网格不应发生横向溢出：${gridScene.overflow}px`);

        stage = "封面图像或排版回退覆盖每张卡片";
        const coverCoverage = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>("[data-project-picker-view]");
            const cards = [...(root?.querySelectorAll<HTMLElement>("[data-project-card]") ?? [])];

            return {
                cards: cards.length,
                withImage: cards.filter((card) => card.querySelector(".project-cover img") !== null).length,
                withFallback: cards.filter((card) => card.querySelector(".project-cover-fallback") !== null).length,
            };
        });
        // 夹具里 5 部作品带封面、9 部没有：两条分支都必须真的渲染，缺封面时不得留下裂图或空壳。
        assert(
            coverCoverage.cards === 14
                && coverCoverage.withImage + coverCoverage.withFallback === coverCoverage.cards
                && coverCoverage.withImage > 0
                && coverCoverage.withFallback > 0,
            failures,
            `所有卡片必须具备封面图像或优雅排版回退：${JSON.stringify(coverCoverage)}`,
        );

        stage = "切换到密集列表布局";
        await selectScene(page, "compact");
        const compactScene = await measureLayoutRows(page, "[data-classic-compact-view]");
        assert(
            compactScene.rows === 14 && compactScene.gridCards === 0,
            failures,
            `密集列表应逐行列出全部 14 部作品并替掉网格卡片：${JSON.stringify(compactScene)}`,
        );

        stage = "切换到宽幅图文布局";
        await selectScene(page, "editorial");
        const editorialScene = await measureLayoutRows(page, "[data-classic-editorial-view]");
        assert(
            editorialScene.rows === 14 && editorialScene.gridCards === 0,
            failures,
            `宽幅图文应逐行列出全部 14 部作品并替掉网格卡片：${JSON.stringify(editorialScene)}`,
        );

        stage = "切换到零项目空态场景";
        await selectScene(page, "empty");
        const emptyScene = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>("[data-project-picker-view]");
            return {
                cards: root?.querySelectorAll("[data-project-card]").length ?? -1,
                text: root?.textContent ?? "",
            };
        });
        assert(
            emptyScene.cards === 0 && emptyScene.text.includes("还没有作品"),
            failures,
            "零项目空态场景应展示空态标题且不渲染任何卡片",
        );

        stage = "切换到新建对话框场景";
        await selectScene(page, "create-dialog");
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
            "新建对话框场景应挂载带有可访问 label 绑定的标题与简介输入控件",
        );

        stage = "切换到加载中场景";
        await selectScene(page, "loading");
        const loadingScene = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>("[data-project-picker-view]");
            const status = root?.querySelector<HTMLElement>('[role="status"]') ?? null;
            return {
                cards: root?.querySelectorAll("[data-project-card]").length ?? -1,
                hasBusyStatus: status?.getAttribute("aria-busy") === "true",
                text: root?.textContent ?? "",
            };
        });
        assert(
            loadingScene.cards === 0 && loadingScene.hasBusyStatus && loadingScene.text.includes("正在读取书架"),
            failures,
            `加载中场景应展示 aria-busy 的加载区域且不渲染卡片：${JSON.stringify({cards: loadingScene.cards, hasBusyStatus: loadingScene.hasBusyStatus})}`,
        );

        stage = "切换到加载失败场景";
        await selectScene(page, "load-error");
        const loadErrorScene = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>("[data-project-picker-view]");
            const alert = root?.querySelector<HTMLElement>('[role="alert"]') ?? null;
            return {
                cards: root?.querySelectorAll("[data-project-card]").length ?? -1,
                text: alert?.textContent ?? "",
                retryLabel: alert?.querySelector("button")?.textContent?.trim() ?? "",
            };
        });
        assert(
            loadErrorScene.cards === 0
                && loadErrorScene.text.includes("读取书架失败")
                && loadErrorScene.text.includes("503 Service Unavailable")
                && loadErrorScene.retryLabel.includes("重试"),
            failures,
            `加载失败场景应展示错误标题、服务端错误详情与重试动作：${JSON.stringify({cards: loadErrorScene.cards, retryLabel: loadErrorScene.retryLabel})}`,
        );

        stage = "切换到手机 390×844 场景";
        await selectScene(page, "phone");
        const phoneScene = await page.evaluate(() => {
            const labSubject = document.querySelector<HTMLElement>("[data-lab-subject]");
            const subjectRect = labSubject?.getBoundingClientRect();
            return {
                hasSubject: Boolean(labSubject),
                subjectWidth: subjectRect ? Math.round(subjectRect.width) : 0,
                overflow: labSubject ? labSubject.scrollWidth - labSubject.clientWidth : -1,
            };
        });
        assert(
            phoneScene.hasSubject && phoneScene.subjectWidth > 0 && phoneScene.subjectWidth <= 390,
            failures,
            `手机场景容器宽度应被约束在 390px 范围内：实际 ${phoneScene.subjectWidth}px`,
        );
        assert(phoneScene.overflow <= 0, failures, `手机场景内容不应产生容器横向滚动溢出：${phoneScene.overflow}px`);
    } catch (error) {
        failures.push({
            kind: "assertion",
            message: `ProjectPickerView smoke 在阶段 [${stage}] 失败：${error instanceof Error ? error.message : String(error)}`,
        });
    } finally {
        await page.unroute(COVER_ROUTE).catch(() => undefined);
    }
}

/** 场景切换用稳定场景 id（`data-value` 即 fixture 场景 id），label 换词不会让断言失焦。 */
async function selectScene(page: Page, sceneId: string): Promise<void> {
    await page.locator(`${SCENE_GROUP} [role="radio"][data-value="${sceneId}"]`).first().click();
    await page.waitForTimeout(150);
}

/**
 * 密集列表与宽幅图文都不是卡片网格：按行标题（每行一个 `h3`）确认作品逐条列出，
 * 并确认网格卡片已经让位，避免只挂了个空壳视图也能过。
 */
async function measureLayoutRows(page: Page, viewSelector: string): Promise<{rows: number; gridCards: number}> {
    await page.locator(`[data-project-picker-view] ${viewSelector}`).first().waitFor({state: "visible", timeout: 10_000});
    await page.waitForTimeout(150);

    return await page.evaluate((selector) => {
        const root = document.querySelector<HTMLElement>("[data-project-picker-view]");
        return {
            rows: root?.querySelector<HTMLElement>(selector)?.querySelectorAll("h3").length ?? -1,
            gridCards: root?.querySelectorAll("[data-project-card]").length ?? -1,
        };
    }, viewSelector);
}

/**
 * 夹具的 `projectRoot` 是合成路径（`workspace/projects/<slug>`），不符合 `ProjectRootDtoSchema` 的
 * 「一级目录名」约束：真实 `/api/projects/cover` 会以 400 `INVALID_PROJECT_ROOT` 拒绝，而 smoke 的
 * console 监听把每条资源加载失败都记成失败。这里只把这类**契约非法**的夹具封面请求定格成一张固定图片；
 * 合法 `projectRoot` 的封面请求继续走真实端点，真实封面加载回归照旧暴露。
 */
async function stubFixtureCoverRequests(page: Page): Promise<void> {
    await page.route(COVER_ROUTE, async (route) => {
        const projectRoot = new URL(route.request().url()).searchParams.get("projectRoot") ?? "";
        if (!projectRoot.includes("/") && !projectRoot.includes("\\")) {
            await route.continue();
            return;
        }
        await route.fulfill({status: 200, contentType: "image/png", body: FIXTURE_COVER_PLACEHOLDER});
    });
}
