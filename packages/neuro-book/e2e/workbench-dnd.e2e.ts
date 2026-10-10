/**
 * 外壳三拖放在真实 Chrome 中的验收（docs/specs/ui/workbench-shell.md 外壳三输出 19–23、验收 19–25）：生产构建的
 * e2e 测试外壳，测试插件 `test.sample-views` 贡献六个视图。指针手势用 Playwright 的真实鼠标，等页面上可观察的
 * 变化，不按时长等待。
 *
 * 不在这里的：落点判定的逐行规则（`views/drop.test.ts`）、意图与补丁（`views/dnd-model.test.ts`）、保存冲突
 * （`state/layout-store.test.ts`）。
 */

import {mkdir, rm} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Locator, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {CLIENT_IDENTITY_KEY} from "nbook/web/host/client-identity";

import {startProbeServer} from "./fixtures";
import type {ProbeServer} from "./fixtures";

const A = "test.sample-views.alpha";
const B = "test.sample-views.beta";
const C = "test.sample-views.gamma";
const D = "test.sample-views.delta";
const E = "test.sample-views.omega";
const F = "test.sample-views.zeta";

const ghost = (page: Page) => page.locator("[data-workbench-drag-ghost]");
const feedback = (page: Page) => page.locator("[data-drop-kind]");

const tabOf = (page: Page, part: string, containerId: string) => page.locator(`[data-switcher-band="${part}"] [data-switcher-entry="${containerId}"]`);
const host = (page: Page, containerId: string) => page.locator(`[data-container-host="${containerId}"]`);

async function centerOf(locator: Locator): Promise<{x: number; y: number}> {
    const box = (await locator.boundingBox())!;
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

/** 分节在内容区里的前半或后半（按容器的轴）里的一点。 */
async function halfOf(page: Page, viewId: string, side: "before" | "after"): Promise<{x: number; y: number}> {
    const section = page.locator(`[data-view-section="${viewId}"]`);
    const axis = await section.evaluate((element) => element.closest("[data-container-host]")?.getAttribute("data-container-axis"));
    const box = (await section.boundingBox())!;
    const ratio = side === "before" ? 0.25 : 0.75;
    return axis === "horizontal" ? {x: box.x + box.width * ratio, y: box.y + box.height / 2} : {x: box.x + box.width / 2, y: box.y + box.height * ratio};
}

/** 一次完整的指针拖放：拖到 `to` 松手，等拖影消失。 */
async function dropAt(page: Page, source: Locator, to: {x: number; y: number}): Promise<void> {
    await dragTo(page, source, to);
    await page.mouse.up();
    await expect(ghost(page)).toHaveCount(0);
}

/** 按下源、移过门槛，再分几步移到 `to`：拖动在这一步之后进行中，由调用方决定松手还是取消。 */
async function dragTo(page: Page, source: Locator, to: {x: number; y: number}): Promise<void> {
    const from = await centerOf(source);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y + 10, {steps: 2});
    await expect(ghost(page)).toBeVisible();
    await page.mouse.move(to.x, to.y, {steps: 8});
}

test.describe("产品页：拖放", () => {
    let tmp = "";
    let server: ProbeServer;

    test.beforeAll(async () => {
        tmp = await createTestTmpRoot("neuro-book-e2e", "workbench-dnd");
        await mkdir(join(tmp, "state"), {recursive: true});
        // 产品的资源管理器视图会占住侧栏：这里只看测试插件的视图。
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views", NBOOK_EXCLUDE_PLUGINS: "nbook.explorer,nbook.editor"}});
    });

    test.afterAll(async () => {
        expect(await server.stop()).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 1440, height: 900}});

    /**
     * 本页客户端对工作台定制记录的写入次数：在测试库上装审计触发器，数 records 的插入与更新。只数本页客户端的这一条
     * 记录，不依赖修订号怎么分配（Spec 只保证单调、不复用），别的记录与客户端的写入也不混进来。触发器在第一次取
     * 基线时装上，所以基线要在手势之前取。
     */
    async function writesOf(page: Page): Promise<number> {
        const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
        const db = new DatabaseSync(join(tmp, "state", "storage", "user.sqlite"));
        try {
            db.exec(`
                CREATE TABLE IF NOT EXISTS e2e_writes (owner TEXT NOT NULL, key TEXT NOT NULL, client TEXT NOT NULL);
                CREATE TRIGGER IF NOT EXISTS e2e_writes_insert AFTER INSERT ON records BEGIN INSERT INTO e2e_writes VALUES (NEW.owner, NEW.key, NEW.client); END;
                CREATE TRIGGER IF NOT EXISTS e2e_writes_update AFTER UPDATE ON records BEGIN INSERT INTO e2e_writes VALUES (NEW.owner, NEW.key, NEW.client); END;
            `);
            const row = db.prepare("SELECT COUNT(*) AS count FROM e2e_writes WHERE owner = 'nbook.workbench' AND key = 'views-customizations' AND client = ?1").get(client) as {count: number};
            return Number(row.count);
        } finally {
            db.close();
        }
    }

    async function open(page: Page): Promise<void> {
        await page.goto(new URL("/workbench", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(page.locator("[data-shell-focus-target=\"panel-toggle\"]")).toBeEnabled();
    }

    test("活动条目拖到右栏标签带：拖动中源不动、有拖影与插入线；松手整容器迁到右栏并选中，只写一次", async ({page}) => {
        await open(page);
        const entry = page.locator(`[data-activity-container="view:${C}"]`);
        const before = await entry.boundingBox();
        const tab = page.locator(`[data-tool-part="auxiliarybar"] [data-switcher-entry="view:${D}"]`);
        const tabBox = (await tab.boundingBox())!;
        const writes = await writesOf(page);
        await dragTo(page, entry, {x: tabBox.x + tabBox.width + 20, y: tabBox.y + tabBox.height / 2});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-container");
        await expect(page.locator("[data-drop-feedback-line]")).toBeVisible();
        expect(await entry.boundingBox()).toEqual(before);
        expect(await writesOf(page)).toBe(writes);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect(page.locator(`[data-tool-part="auxiliarybar"] [data-switcher-entry="view:${C}"]`)).toHaveAttribute("aria-selected", "true");
        await expect(entry).toHaveCount(0);
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test("整容器拖到另一个容器内容的边缘：整组并入命中叶的那一侧，预览是那一半；源容器消失", async ({page}, testInfo) => {
        await open(page);
        const content = (await host(page, `view:${E}`).boundingBox())!;
        // 面板横向：左半是“插到戊之前”。
        await dragTo(page, tabOf(page, "panel", `view:${F}`), {x: content.x + content.width * 0.2, y: content.y + content.height / 2});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "merge-container");
        const area = (await page.locator("[data-drop-feedback-area]").boundingBox())!;
        expect(area.x + area.width).toBeLessThanOrEqual(content.x + content.width / 2 + 1);
        await page.screenshot({path: testInfo.outputPath("content-half.png")});
        await page.mouse.up();
        await expect(host(page, `view:${E}`)).toHaveAttribute("data-container-mode", "multiple");
        await expect(tabOf(page, "panel", `view:${F}`)).toHaveCount(0);
        const sections = host(page, `view:${E}`).locator("[data-view-section]");
        await expect(sections).toHaveCount(2);
        expect(await sections.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-view-section")))).toEqual([F, E]);
    });

    test("视图标题拖到 ActivityBar 条目带：在插入位建一个只装它的新容器并选中，悬停条目的成员不变", async ({page}) => {
        await open(page);
        // 先把乙并进甲，侧栏的甲容器成 multiple，乙有自己的标题。
        const sidebar = (await page.locator('[data-tool-part="sidebar"]').boundingBox())!;
        await dragTo(page, page.locator(`[data-activity-container="view:${B}"]`), {x: sidebar.x + sidebar.width / 2, y: sidebar.y + sidebar.height * 0.9});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "merge-container");
        await page.mouse.up();
        await expect(host(page, `view:${A}`)).toHaveAttribute("data-container-mode", "multiple");

        const entryC = (await page.locator(`[data-activity-container="view:${C}"]`).boundingBox())!;
        // 落在丙条目的上半：插到丙之前。
        await dragTo(page, page.locator(`[data-drag-view="${B}"]`), {x: entryC.x + entryC.width / 2, y: entryC.y + 4});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "detach-view");
        await expect(page.locator("[data-drop-feedback-line]")).toBeVisible();
        await page.mouse.up();
        const ids = await page.locator('[data-switcher-band="sidebar"] [data-switcher-entry]').evaluateAll((elements) => elements.map((element) => element.getAttribute("data-switcher-entry")));
        expect(ids).toHaveLength(3);
        expect(ids[0]).toBe(`view:${A}`);
        expect(ids[1]).toMatch(/^custom:/u);
        expect(ids[2]).toBe(`view:${C}`);
        await expect(page.locator(`[data-activity-container="${ids[1]}"]`)).toHaveAttribute("aria-pressed", "true");
        await expect(host(page, `view:${A}`)).toHaveAttribute("data-container-mode", "single");
    });

    test("空 Part：右栏搬空后标签带与空正文常驻；视图拖进空正文建新容器、拖进空标签带同样建新容器", async ({page}) => {
        await open(page);
        const panelBand = (await page.locator('[data-switcher-band="panel"]').boundingBox())!;
        await dragTo(page, tabOf(page, "auxiliarybar", `view:${D}`), {x: panelBand.x + panelBand.width - 40, y: panelBand.y + panelBand.height / 2});
        await page.mouse.up();
        await expect(tabOf(page, "panel", `view:${D}`)).toBeVisible();
        const empty = page.locator('[data-empty-part="auxiliarybar"]');
        await expect(empty).toHaveText("将视图拖动到此处显示");
        const band = (await page.locator('[data-switcher-band="auxiliarybar"]').boundingBox())!;
        expect(band.width).toBeGreaterThan(40);

        const emptyBox = (await empty.boundingBox())!;
        await dragTo(page, tabOf(page, "panel", `view:${D}`), {x: emptyBox.x + emptyBox.width / 2, y: emptyBox.y + emptyBox.height / 2});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-container");
        await page.mouse.up();
        await expect(tabOf(page, "auxiliarybar", `view:${D}`)).toHaveAttribute("aria-selected", "true");
    });

    test("松手在源自己身上（原位，无操作）：不提交，也不触发那一下点击", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const tab = tabOf(page, "panel", `view:${F}`);
        await expect(tab).toHaveAttribute("aria-selected", "false");
        const center = await centerOf(tab);
        await dragTo(page, tab, center);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect(tab).toHaveAttribute("aria-selected", "false");
        expect(await writesOf(page)).toBe(writes);
        // 普通点击照常选中。
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
    });

    test("键盘：面板标签上空格拿起，方向键沿标签带移动插入位（标签带不切换），Enter 只提交一次，焦点回到标签", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const tabF = tabOf(page, "panel", `view:${F}`);
        const tabE = tabOf(page, "panel", `view:${E}`);
        await expect(tabE).toHaveAttribute("aria-selected", "true");
        await tabF.focus();
        await page.keyboard.press("Space");
        await expect(ghost(page)).toBeVisible();
        // 起点是自己的位置：原位，带插入线的无操作。
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "noop");
        await page.keyboard.press("ArrowLeft");
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-container");
        await expect(tabE).toHaveAttribute("aria-selected", "true");
        expect(await writesOf(page)).toBe(writes);
        await page.keyboard.press("Enter");
        await expect(ghost(page)).toHaveCount(0);
        const ids = await page.locator('[data-switcher-band="panel"] [data-switcher-entry]').evaluateAll((elements) => elements.map((element) => element.getAttribute("data-switcher-entry")));
        expect(ids).toEqual([`view:${F}`, `view:${E}`]);
        await expect(tabF).toBeFocused();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test("键盘：三个 Part 各拿起一次；Tab 换区后仍在拖动、没有写入；Escape 只取消，焦点回到源", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const sources = [
            page.locator(`[data-activity-container="view:${A}"]`),
            tabOf(page, "auxiliarybar", `view:${D}`),
            tabOf(page, "panel", `view:${E}`),
        ];
        for (const source of sources) {
            await source.focus();
            await page.keyboard.press("Space");
            await expect(ghost(page)).toBeVisible();
            for (let step = 0; step < 3; step += 1) {
                await page.keyboard.press("Tab");
                await expect(ghost(page)).toBeVisible();
            }
            await page.keyboard.press("Shift+Tab");
            await expect(ghost(page)).toBeVisible();
            expect(await writesOf(page)).toBe(writes);
            await page.keyboard.press("Escape");
            await expect(ghost(page)).toHaveCount(0);
            await expect(source).toBeFocused();
        }
        expect(await writesOf(page)).toBe(writes);
    });

    test("键盘：视图标题的把手拿起，Tab 到另一个容器的内容区，方向键选半区，Enter 并入", async ({page}) => {
        await open(page);
        // 先用键盘把乙的整个容器并进甲：甲成 multiple，各有标题把手。
        const sidebar = (await page.locator('[data-tool-part="sidebar"]').boundingBox())!;
        await dragTo(page, page.locator(`[data-activity-container="view:${B}"]`), {x: sidebar.x + sidebar.width / 2, y: sidebar.y + sidebar.height * 0.9});
        await page.mouse.up();
        await expect(host(page, `view:${A}`)).toHaveAttribute("data-container-mode", "multiple");
        const writes = await writesOf(page);
        const handle = page.locator(`[data-drag-view="${B}"] [data-drag-handle]`);
        await expect(handle).toHaveAccessibleName("拖动 样例乙");
        await handle.focus();
        await page.keyboard.press("Space");
        await expect(ghost(page)).toBeVisible();
        // 区域按 Part 的顺序：活动栏、侧栏内容、右栏标签带、右栏内容、面板……；从甲的内容区往后两个是右栏内容（丁）。
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-view");
        await page.keyboard.press("ArrowDown");
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-view");
        await page.keyboard.press("Enter");
        await expect(host(page, `view:${D}`)).toHaveAttribute("data-container-mode", "multiple");
        const sections = await host(page, `view:${D}`).locator("[data-view-section]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-view-section")));
        expect(sections).toEqual([D, B]);
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
        await expect(page.locator(`[data-drag-view="${B}"] [data-drag-handle]`)).toBeFocused();
    });

    test("三个 Part 搬空后各自的四条空落点路径（单视图、整容器 × 空正文、空条目带）都接收：建一个容器并选中", async ({browser}) => {
        // test-lint-allow fixed-wait: Playwright 的用例时限（十二条路径各开一个上下文），不是按时长等待
        test.setTimeout(120_000);
        type Setup = {readonly part: "sidebar" | "auxiliarybar" | "panel"; empty(page: Page): Promise<void>; view: string; container: (page: Page) => Locator};
        const setups: Setup[] = [
            {
                part: "sidebar",
                // 甲、乙、丙三个容器逐个并进右栏丁的末尾：侧栏空，右栏成 multiple。
                empty: async (page) => {
                    for (const id of [A, B, C]) await dropAt(page, page.locator(`[data-activity-container="view:${id}"]`), await halfOf(page, (await host(page, `view:${D}`).locator("[data-view-section]").last().getAttribute("data-view-section"))!, "after"));
                },
                view: A,
                container: (page) => tabOf(page, "panel", `view:${F}`),
            },
            {
                part: "auxiliarybar",
                empty: async (page) => dropAt(page, tabOf(page, "auxiliarybar", `view:${D}`), await halfOf(page, E, "after")),
                view: D,
                container: (page) => page.locator(`[data-activity-container="view:${C}"]`),
            },
            {
                part: "panel",
                empty: async (page) => {
                    await dropAt(page, tabOf(page, "panel", `view:${E}`), await halfOf(page, D, "after"));
                    await dropAt(page, tabOf(page, "panel", `view:${F}`), await halfOf(page, E, "after"));
                },
                view: E,
                container: (page) => page.locator(`[data-activity-container="view:${C}"]`),
            },
        ];
        for (const setup of setups) {
            for (const source of ["view", "container"] as const) {
                for (const target of ["body", "band"] as const) {
                    const context = await browser.newContext({viewport: {width: 1440, height: 900}});
                    const page = await context.newPage();
                    await open(page);
                    await setup.empty(page);
                    const entries = page.locator(`[data-switcher-band="${setup.part}"] [data-switcher-entry]`);
                    await expect(entries, `${setup.part} 搬空`).toHaveCount(0);
                    const drag = source === "view" ? page.locator(`[data-drag-view="${setup.view}"]`) : setup.container(page);
                    const area = page.locator(target === "body" ? `[data-empty-part="${setup.part}"]` : `[data-switcher-band="${setup.part}"]`);
                    await dragTo(page, drag, await centerOf(area));
                    await expect(feedback(page), `${setup.part} ${source}→${target}`).toHaveAttribute("data-drop-kind", source === "view" ? "detach-view" : "move-container");
                    await page.mouse.up();
                    await expect(entries, `${setup.part} ${source}→${target}`).toHaveCount(1);
                    const created = (await entries.first().getAttribute("data-switcher-entry"))!;
                    if (source === "view") expect(created).toMatch(/^custom:/u);
                    await expect(entries.first()).toHaveAttribute(setup.part === "sidebar" ? "aria-pressed" : "aria-selected", "true");
                    await context.close();
                }
            }
        }
    });

    test("拖影有图标与文字；经过 Switcher 只有一条插入线，没有接收区域与条目高亮；整容器跨区换轴", async ({page}, testInfo) => {
        await open(page);
        const band = (await page.locator('[data-switcher-band="sidebar"]').boundingBox())!;
        await dragTo(page, tabOf(page, "panel", `view:${F}`), {x: band.x + band.width / 2, y: band.y + band.height - 20});
        await expect(ghost(page)).toContainText("样例己");
        await expect(ghost(page).locator("[class*='i-lucide-']")).toHaveCount(1);
        await expect(page.locator("[data-drop-feedback-line]")).toHaveCount(1);
        await expect(page.locator("[data-drop-feedback-area]")).toHaveCount(0);
        await expect(page.locator("[data-drop-feedback-entry]")).toHaveCount(0);
        await page.screenshot({path: testInfo.outputPath("switcher-line.png")});
        await page.mouse.up();
        // 面板的横排容器到侧栏变纵排。
        await expect(page.locator(`[data-activity-container="view:${F}"]`)).toHaveAttribute("aria-pressed", "true");
        await expect(host(page, `view:${F}`)).toHaveAttribute("data-container-axis", "vertical");
    });

    test("全部可见视图收成细条：落点是细条之后的剩余区，拖入的视图展开、原有细条保持收起", async ({page}) => {
        await open(page);
        const sidebar = page.locator('[data-tool-part="sidebar"]');
        await dropAt(page, page.locator(`[data-activity-container="view:${B}"]`), await halfOf(page, A, "after"));
        for (const id of [A, B]) await page.locator(`[data-view-section="${id}"] [data-view-toggle]`).click();
        await expect(page.locator(`[data-view-section="${B}"]`)).toHaveAttribute("data-view-collapsed", "true");
        const box = (await sidebar.boundingBox())!;
        await dragTo(page, page.locator(`[data-activity-container="view:${C}"]`), {x: box.x + box.width / 2, y: box.y + box.height - 40});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "merge-container");
        const area = (await page.locator("[data-drop-feedback-area]").boundingBox())!;
        const strips = (await page.locator(`[data-view-section="${B}"]`).boundingBox())!;
        expect(area.y).toBeGreaterThanOrEqual(strips.y + strips.height - 1);
        await page.mouse.up();
        await expect(page.locator(`[data-view-section="${C}"]`)).toHaveAttribute("data-view-collapsed", "false");
        await expect(page.locator(`[data-view-section="${A}"]`)).toHaveAttribute("data-view-collapsed", "true");
        await expect(page.locator(`[data-view-section="${B}"]`)).toHaveAttribute("data-view-collapsed", "true");
    });

    test("多视图的面板容器搬到侧栏再搬回面板：成员顺序不变，轴随区域横转纵、纵转横", async ({page}) => {
        await open(page);
        await dropAt(page, tabOf(page, "panel", `view:${F}`), await halfOf(page, E, "after"));
        const sections = () => host(page, `view:${E}`).locator("[data-view-section]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-view-section")));
        expect(await sections()).toEqual([E, F]);
        await expect(host(page, `view:${E}`)).toHaveAttribute("data-container-axis", "horizontal");
        const band = (await page.locator('[data-switcher-band="sidebar"]').boundingBox())!;
        await dropAt(page, tabOf(page, "panel", `view:${E}`), {x: band.x + band.width / 2, y: band.y + band.height - 20});
        await expect(host(page, `view:${E}`)).toHaveAttribute("data-container-axis", "vertical");
        expect(await sections()).toEqual([E, F]);
        // 面板搬空后标签带常驻，整条带是一个落点。
        await expect(page.locator('[data-switcher-band="panel"] [data-switcher-entry]')).toHaveCount(0);
        await dropAt(page, page.locator(`[data-activity-container="view:${E}"]`), await centerOf(page.locator('[data-switcher-band="panel"]')));
        await expect(host(page, `view:${E}`)).toHaveAttribute("data-container-axis", "horizontal");
        expect(await sections()).toEqual([E, F]);
    });

    test("工具区不接收：拖到面板标签带里的“移动到”按钮上没有落点反馈，松手不移动、不写", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const entry = page.locator(`[data-activity-container="view:${C}"]`);
        const tools = page.locator('[data-switcher-band="panel"] [data-move-view]');
        await expect(tools).toBeVisible();
        await dragTo(page, entry, await centerOf(tools));
        await expect(ghost(page)).toBeVisible();
        await expect(feedback(page)).toHaveCount(0);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect(entry).toBeVisible();
        await expect(tabOf(page, "panel", `view:${C}`)).toHaveCount(0);
        expect(await writesOf(page)).toBe(writes);
    });

    test("指针拖动中按方向键与 End：标签带不切换；Escape 取消后释放指针捕获，键盘触发的点击照常生效", async ({page}) => {
        await open(page);
        const tabE = tabOf(page, "panel", `view:${E}`);
        const tabF = tabOf(page, "panel", `view:${F}`);
        await expect(tabE).toHaveAttribute("aria-selected", "true");
        const band = (await page.locator('[data-switcher-band="sidebar"]').boundingBox())!;
        await dragTo(page, tabE, {x: band.x + band.width / 2, y: band.y + band.height - 20});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-container");
        // 键归会话：标签带自己连这两下按键都收不到（只看选中与否不够，标签带收到键后可能因别的原因没切换）。
        await page.locator('[data-switcher-band="panel"] [role="tablist"]').evaluate((tablist) => {
            const seen: string[] = [];
            tablist.addEventListener("keydown", (event) => seen.push((event as KeyboardEvent).key));
            (window as unknown as {tablistKeys: string[]}).tablistKeys = seen;
        });
        await page.keyboard.press("End");
        await page.keyboard.press("ArrowRight");
        await expect(ghost(page)).toBeVisible();
        await expect(tabE).toHaveAttribute("aria-selected", "true");
        expect(await page.evaluate(() => (window as unknown as {tablistKeys: string[]}).tablistKeys)).toEqual([]);
        await page.keyboard.press("Escape");
        await expect(ghost(page)).toHaveCount(0);
        // 鼠标仍按着：捕获已释放，之后键盘在别的控件上触发的点击不被当成这次手势的尾巴吞掉。
        expect(await tabE.evaluate((element) => element.hasPointerCapture(1))).toBe(false);
        await tabF.focus();
        await page.keyboard.press("Enter");
        await expect(tabF).toHaveAttribute("aria-selected", "true");
        await page.mouse.up();
        await expect(tabE).toHaveAttribute("data-switcher-entry", `view:${E}`);
    });

    test("键盘拖动中打开命令面板：拖动取消，焦点与按键归面板", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const tabF = tabOf(page, "panel", `view:${F}`);
        await tabF.focus();
        await page.keyboard.press("Space");
        await expect(ghost(page)).toBeVisible();
        await page.keyboard.press("Control+Shift+P");
        const palette = page.getByRole("combobox");
        await expect(palette).toBeFocused();
        await expect(ghost(page)).toHaveCount(0);
        const active = await palette.getAttribute("aria-activedescendant");
        await page.keyboard.press("ArrowDown");
        await expect(palette).not.toHaveAttribute("aria-activedescendant", active ?? "");
        await page.keyboard.press("Escape");
        await expect(palette).toHaveCount(0);
        expect(await writesOf(page)).toBe(writes);
    });

    test("键盘拿起后直接 Enter 是原位：容器里第二个视图的标题把手与侧栏 single 的标题行都不移动、不写", async ({page}) => {
        await open(page);
        await dropAt(page, page.locator(`[data-activity-container="view:${B}"]`), await halfOf(page, A, "after"));
        const sections = () => host(page, `view:${A}`).locator("[data-view-section]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-view-section")));
        expect(await sections()).toEqual([A, B]);
        const writes = await writesOf(page);
        const handle = page.locator(`[data-drag-view="${B}"] [data-drag-handle]`);
        await handle.focus();
        await page.keyboard.press("Space");
        await expect(ghost(page)).toBeVisible();
        await page.keyboard.press("Enter");
        await expect(ghost(page)).toHaveCount(0);
        expect(await sections()).toEqual([A, B]);
        await expect(handle).toBeFocused();

        expect(await writesOf(page)).toBe(writes);

        await page.locator(`[data-activity-container="view:${C}"]`).click();
        const title = page.locator(`[data-tool-part="sidebar"] [data-drag-container="view:${C}"] [data-drag-handle]`);
        await expect(title).toBeVisible();
        const selected = await writesOf(page);
        await title.focus();
        await page.keyboard.press("Space");
        await expect(ghost(page)).toBeVisible();
        await page.keyboard.press("Enter");
        await expect(ghost(page)).toHaveCount(0);
        const order = await page.locator('[data-switcher-band="sidebar"] [data-switcher-entry]').evaluateAll((elements) => elements.map((element) => element.getAttribute("data-switcher-entry")));
        expect(order.indexOf(`view:${C}`)).toBe(order.length - 1);
        expect(await writesOf(page)).toBe(selected);
    });

    test("松手只提交显示过的动作：最后一次移动与松手落在同一帧、换到了没显示过的落点时不提交；落点没变时照常提交", async ({page}) => {
        await open(page);
        const entry = page.locator(`[data-activity-container="view:${C}"]`);
        const aux = (await page.locator('[data-switcher-band="auxiliarybar"]').boundingBox())!;
        const panel = (await page.locator('[data-switcher-band="panel"]').boundingBox())!;
        const shown = {x: aux.x + aux.width - 30, y: aux.y + aux.height / 2};
        // 这次移动与松手在同一个任务里派发：两者之间没有帧，会话来不及发布新落点。真实输入里快速甩动松手就是这种时序，
        // 用 Playwright 的鼠标做不出确定的“同一帧”，所以这两下用页面里的指针事件。
        const flick = (to: {x: number; y: number}) => page.evaluate(({x, y}) => {
            const init = {pointerId: 1, pointerType: "mouse", isPrimary: true, bubbles: true, clientX: x, clientY: y};
            document.dispatchEvent(new PointerEvent("pointermove", {...init, buttons: 1}));
            document.dispatchEvent(new PointerEvent("pointerup", {...init, button: 0, buttons: 0}));
        }, to);
        const writes = await writesOf(page);
        await dragTo(page, entry, shown);
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-container");
        await flick({x: panel.x + panel.width / 3, y: panel.y + panel.height / 2});
        await expect(ghost(page)).toHaveCount(0);
        await page.mouse.up();
        await expect(entry).toBeVisible();
        expect(await writesOf(page)).toBe(writes);

        await dragTo(page, entry, shown);
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-container");
        await flick(shown);
        await expect(ghost(page)).toHaveCount(0);
        await page.mouse.up();
        await expect(tabOf(page, "auxiliarybar", `view:${C}`)).toHaveAttribute("aria-selected", "true");
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test("“移动到”新建容器：视图搬进新建的自建容器并选中，刷新后仍在", async ({page}) => {
        await open(page);
        await page.locator(`[data-tool-part="sidebar"] [data-move-view="${A}"]`).click();
        await page.getByRole("menuitem", {name: /^新建容器（在面板）/u}).click();
        await expect(page.getByRole("menu")).toHaveCount(0);
        const created = page.locator('[data-switcher-band="panel"] [data-switcher-entry^="custom:"]');
        await expect(created).toHaveAttribute("aria-selected", "true");
        const id = await created.getAttribute("data-switcher-entry");
        await expect(host(page, id!).locator(`[data-view-section="${A}"]`)).toHaveCount(1);
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(host(page, id!).locator(`[data-view-section="${A}"]`)).toHaveCount(1);
        await expect(page.locator(`[data-activity-container="view:${A}"]`)).toHaveCount(0);
    });

    test.describe("半区与来源比例（视口加高，让最小尺寸不夹取）", () => {
        test.use({viewport: {width: 1440, height: 1700}});

        /** 本页客户端的工作台定制记录里的视图项。 */
        async function viewEntries(page: Page): Promise<Record<string, {height?: number; width?: number}>> {
            const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
            const db = new DatabaseSync(join(tmp, "state", "storage", "user.sqlite"));
            try {
                const row = db.prepare("SELECT value FROM records WHERE owner = 'nbook.workbench' AND key = 'views-customizations' AND client = ?1").get(client) as {value: string} | undefined;
                return (row === undefined ? {} : (JSON.parse(row.value) as {views?: Record<string, {height?: number; width?: number}>}).views) ?? {};
            } finally {
                db.close();
            }
        }

        /** 经“移动到”并入：不带半区，成员都没有尺寸记录，各占相同份额。 */
        async function moveVia(page: Page, scope: string, viewId: string, target: string): Promise<void> {
            await page.locator(`${scope} [data-move-view="${viewId}"]`).click();
            await page.getByRole("menuitem", {name: new RegExp(`^${target}`, "u")}).click();
            await expect(page.getByRole("menu")).toHaveCount(0);
        }

        /** 侧栏甲容器里 A、B、C、D 四个没有尺寸记录的视图（各 25%），面板戊容器里 E、F。 */
        async function fourAndTwo(page: Page): Promise<void> {
            for (const [id, scope] of [[B, '[data-tool-part="sidebar"]'], [C, '[data-tool-part="sidebar"]']] as const) {
                await page.locator(`[data-activity-container="view:${id}"]`).click();
                await moveVia(page, scope, id, "样例甲");
            }
            await moveVia(page, '[data-tool-part="auxiliarybar"]', D, "样例甲");
            await tabOf(page, "panel", `view:${F}`).click();
            await moveVia(page, '[data-switcher-band="panel"]', F, "样例戊");
            await expect(host(page, `view:${A}`).locator("[data-view-section]")).toHaveCount(4);
            await expect(host(page, `view:${E}`).locator("[data-view-section]")).toHaveCount(2);
            expect(await viewEntries(page)).not.toHaveProperty([D, "height"]);
        }

        async function sharesOf(page: Page, containerId: string): Promise<number[]> {
            const sizes = await host(page, containerId).locator("[data-view-section]").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
            const total = sizes.reduce((sum, size) => sum + size, 0);
            return sizes.map((size) => size / total);
        }

        test("A、B、C、D 各 25%，等比的 E、F 整组落到 D 的后缘：D 12.5%、E 与 F 各 6.25%，其余不变；记录只写命中叶与拖入成员", async ({page}) => {
            await open(page);
            await fourAndTwo(page);
            const sidebarTabs = await page.locator('[data-switcher-band="sidebar"] [data-switcher-entry]').count();

            await dragTo(page, tabOf(page, "panel", `view:${E}`), await halfOf(page, D, "after"));
            await expect(feedback(page)).toHaveAttribute("data-drop-kind", "merge-container");
            await expect(feedback(page)).toHaveAttribute("data-drop-count", "2");
            await page.mouse.up();
            await expect(host(page, `view:${A}`).locator("[data-view-section]")).toHaveCount(6);
            await expect.poll(async () => (await viewEntries(page))[D]?.height).toBe(120);
            const entries = await viewEntries(page);
            expect([entries[E]?.height, entries[F]?.height]).toEqual([60, 60]);
            for (const id of [A, B, C]) expect(entries[id]?.height).toBeUndefined();
            expect((await sharesOf(page, `view:${A}`)).map((share) => Math.round(share * 1000) / 10)).toEqual([25, 25, 25, 12.5, 6.3, 6.3]);
            // 目标标签数不增加（来源容器的标签在面板），六个视图同层都有自己的标题与收起开关。
            expect(await page.locator('[data-switcher-band="sidebar"] [data-switcher-entry]').count()).toBe(sidebarTabs);
            await expect(host(page, `view:${A}`).locator("[data-view-toggle]")).toHaveCount(6);
        });

        test("来源 E:F 由真实拖动边界调成 3:1 后整组落到 D 的后缘：E 9.375%、F 3.125%（按释放时来源的实测几何）", async ({page}) => {
            // F 只占 3.125%：侧栏内容要有 2048px 以上，F 才不被视图的最小尺寸（64px）夹取。
            await page.setViewportSize({width: 1440, height: 2500});
            await open(page);
            await fourAndTwo(page);
            // 面板横排：把 E、F 之间的边界拖到两者合宽的 3/4 处。
            const sash = page.getByRole("separator", {name: `调整 ${E} 与 ${F} 的宽度`});
            const e = (await page.locator(`[data-view-section="${E}"]`).boundingBox())!;
            const f = (await page.locator(`[data-view-section="${F}"]`).boundingBox())!;
            const bounds = (await sash.boundingBox())!;
            // 边界中心相对 E 右缘的偏移不变：E 的宽度要成为两者宽度和的 3/4。
            const target = e.x + (e.width + f.width) * 0.75 + (bounds.x + bounds.width / 2 - (e.x + e.width));
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
            await page.mouse.down();
            await page.mouse.move(target, bounds.y + bounds.height / 2, {steps: 6});
            await page.mouse.up();
            const widthOf = async (viewId: string) => (await page.locator(`[data-view-section="${viewId}"]`).boundingBox())!.width;
            // 指针拖动落在整像素上，比例只能接近 3:1；下面按释放时实测的比例核对，3:1 时就是 Spec 的 9.375% 与 3.125%。
            await expect.poll(async () => (await widthOf(E)) / ((await widthOf(E)) + (await widthOf(F)))).toBeCloseTo(0.75, 1);

            await dragTo(page, tabOf(page, "panel", `view:${E}`), await halfOf(page, D, "after"));
            await expect(feedback(page)).toHaveAttribute("data-drop-kind", "merge-container");
            const ratio = (await widthOf(E)) / ((await widthOf(E)) + (await widthOf(F)));
            await page.mouse.up();
            await expect(host(page, `view:${A}`).locator("[data-view-section]")).toHaveCount(6);
            await expect.poll(async () => (await viewEntries(page))[D]?.height).toBe(120);
            const entries = await viewEntries(page);
            // 来源比例取会话量的可见矩形，与这里的外框只差亚像素。
            expect(entries[E]?.height).toBeCloseTo(120 * ratio, 1);
            expect(entries[F]?.height).toBeCloseTo(120 * (1 - ratio), 1);
            const shares = await sharesOf(page, `view:${A}`);
            expect(shares.slice(0, 4).map((share) => Math.round(share * 1000) / 10)).toEqual([25, 25, 25, 12.5]);
            expect(shares[4]).toBeCloseTo(0.125 * ratio, 3);
            expect(shares[5]).toBeCloseTo(0.125 * (1 - ratio), 3);
        });
    });

    test("Escape 取消：拖影与预览消失，松手不写；窗口失焦同样取消", async ({page}) => {
        await open(page);
        const entry = page.locator(`[data-activity-container="view:${A}"]`);
        const panel = (await page.locator('[data-switcher-band="panel"]').boundingBox())!;
        const writes = await writesOf(page);
        await dragTo(page, entry, {x: panel.x + panel.width - 30, y: panel.y + panel.height / 2});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-container");
        await page.keyboard.press("Escape");
        await expect(ghost(page)).toHaveCount(0);
        await expect(feedback(page)).toHaveCount(0);
        await page.mouse.up();
        await expect(entry).toBeVisible();

        await dragTo(page, entry, {x: panel.x + panel.width - 30, y: panel.y + panel.height / 2});
        // 窗口失焦：无头浏览器里换不走真实焦点，派发窗口自己的 blur 事件（会话只听窗口这一种）。
        await page.evaluate(() => window.dispatchEvent(new FocusEvent("blur")));
        await expect(ghost(page)).toHaveCount(0);
        await page.mouse.up();
        expect(await writesOf(page)).toBe(writes);
        await expect(entry).toBeVisible();
    });
});
