/**
 * 一棵树的拖放在真实 Chrome 中的验收（docs/specs/ui/workbench-layout.md 输出 24 到 32、验收 1 到 3；手势会话的细则见
 * docs/specs/ui/layout-drag.md）：生产构建的 e2e 测试外壳，测试插件 `test.sample-views` 贡献六个视图（侧栏甲乙丙、右栏丁、
 * 面板戊己）。指针手势用 Playwright 的真实鼠标，等页面上可观察的变化，不按时长等待。
 *
 * 不在这里的：
 * - 落点判定的逐行规则（`nb-layout` 的 `layout-drop.test.ts`）、会话的取消路径（Escape、失去指针捕获、窗口失焦、拖动中的按键归会话、
 *   触摸起拖）：`lab-drag-session.e2e.ts`；
 * - 内容在面板之间滑动的组件级判据：`lab-grid-panels.e2e.ts`，这里只留产品页上的一条（验收 1）；
 * - 编辑器标签的拖动（工作台的编辑区还是原来的 `EditorArea`，标签拖动不变），片 7b 并进来之后另写。
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
const line = (page: Page) => page.locator("[data-drop-feedback-line]");
const area = (page: Page) => page.locator("[data-drop-feedback-area]");
const label = (page: Page) => page.locator("[data-drop-feedback-label]");

/**
 * 树里的叶外框。编辑组的内容里还有一层编辑区自己的栅格，它的 `data-leaf` 与外壳的叶同名，所以限定到外壳栅格的直接子级。
 * 视图内容在内容层里，和叶外框是兄弟元素，不在 `[data-leaf]` 里面（输出 14）。
 */
const LEAF = "[data-workbench-surface] > [data-grid-scope] > [data-leaf]";
const leaf = (page: Page, id: string) => page.locator(`${LEAF}[data-leaf="${id}"]`);
const head = (page: Page, panel: string) => page.locator(`[data-panel-head="${panel}"]`);
/** 面板头里放标签的那一段：松手在它空着的右端是“插到末尾”，不会落在框架按钮上。 */
const band = (page: Page, panel: string) => page.locator(`[data-panel-band="${panel}"]`);
const tab = (page: Page, viewId: string) => page.locator(`[data-panel-tab="view:${viewId}"]`);
const entry = (page: Page, viewId: string) => page.locator(`[data-tool-entry="${viewId}"]`);
const frame = (page: Page, panel: string, command: string) => head(page, panel).locator(`[data-panel-action="nbook.view.${command}"]`);
const sample = (page: Page, viewId: string) => page.locator(`[data-sample-view="${viewId}"]`);
const content = (page: Page, viewId: string) => page.locator(`[data-content="view:${viewId}"]`);
const shell = (page: Page) => page.locator("[data-workbench-shell]");
const sidebarSash = (page: Page) => page.getByRole("separator", {name: "调整 sidebar 与 center 的宽度"});

async function centerOf(locator: Locator): Promise<{x: number; y: number}> {
    const found = await locator.boundingBox();
    if (found === null) throw new Error("元素没有盒子");
    return {x: found.x + found.width / 2, y: found.y + found.height / 2};
}

/** 面板头的标签带右端、最后一个标签之后空着的一点：落在它上面是“插到这块面板的末尾”。 */
async function endOfStrip(page: Page, panel: string): Promise<{x: number; y: number}> {
    const found = await band(page, panel).boundingBox();
    if (found === null) throw new Error(`${panel} 没有标签带`);
    return {x: found.x + found.width - 10, y: found.y + found.height / 2};
}

/** 面板外框里的一点：横向、纵向各按比例（面板头占着上面 32px，比例按整块外框算）。 */
async function inLeaf(page: Page, panel: string, fraction: {x: number; y: number}): Promise<{x: number; y: number}> {
    const found = await leaf(page, panel).boundingBox();
    if (found === null) throw new Error(`没有 ${panel} 的外框`);
    return {x: found.x + found.width * fraction.x, y: found.y + found.height * fraction.y};
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

/** 这块面板头里的标签键，按显示顺序。 */
const tabsOf = (page: Page, panel: string): Promise<string[]> => head(page, panel).locator("[data-panel-tab]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-panel-tab")!));

/** 标签所在面板的 id（面板头上写着）。 */
const panelOfTab = (page: Page, viewId: string): Promise<string> => tab(page, viewId).evaluate((element) => element.closest<HTMLElement>("[data-panel-head]")!.dataset.panelHead!);

const instanceOf = (page: Page, viewId: string): Promise<string | null> => sample(page, viewId).getAttribute("data-instance");

/** 每按一次键等下一帧渲染完再读提示文字：键盘的落点是下一帧才画出来的。 */
const labelText = (page: Page): Promise<string> => page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    return document.querySelector("[data-drop-feedback-label]")?.textContent ?? "";
});

test.describe("产品页：拖放", () => {
    let tmp = "";
    let server: ProbeServer;

    test.beforeAll(async () => {
        tmp = await createTestTmpRoot("neuro-book-e2e", "workbench-dnd");
        await mkdir(join(tmp, "state"), {recursive: true});
        // 产品的资源管理器视图会占住侧栏：这里只看测试插件的视图。
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views", NBOOK_EXCLUDE_PLUGINS: "nbook.explorer,nbook.editor,nbook.agent"}});
    });

    test.afterAll(async () => {
        expect(await server.stop()).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 1440, height: 900}});

    /**
     * 本页客户端对 `workbench.layout` 的写入次数：在测试库上装审计触发器，数 records 的插入与更新。只数本页客户端的这一条
     * 记录，不依赖修订号怎么分配（一次保存还会先写模板记录，修订号一次走两步），别的记录与客户端的写入也不混进来。触发器在
     * 第一次取基线时装上，所以基线要在手势之前取。一次手势一次写入（Spec“状态与转换”）。
     */
    /** 这块面板在已保存的布局里隐藏了吗。隐藏是合并着存的：等它落盘再数写入，否则这一笔算到后面的拖放头上。 */
    async function hiddenInRecord(page: Page, panel: string): Promise<boolean> {
        const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
        const db = new DatabaseSync(join(tmp, "state", "storage", "user.sqlite"));
        try {
            const row = db.prepare("SELECT value FROM records WHERE owner = 'nbook.workbench' AND key = 'workbench.layout' AND client = ?1").get(client) as {value: string} | undefined;
            return row !== undefined && (JSON.parse(row.value) as {doc: {panels: Record<string, {hidden?: boolean}>}}).doc.panels[panel]?.hidden === true;
        } finally {
            db.close();
        }
    }

    async function writesOf(page: Page): Promise<number> {
        const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
        const db = new DatabaseSync(join(tmp, "state", "storage", "user.sqlite"));
        try {
            db.exec(`
                CREATE TABLE IF NOT EXISTS e2e_writes (owner TEXT NOT NULL, key TEXT NOT NULL, client TEXT NOT NULL);
                CREATE TRIGGER IF NOT EXISTS e2e_writes_insert AFTER INSERT ON records BEGIN INSERT INTO e2e_writes VALUES (NEW.owner, NEW.key, NEW.client); END;
                CREATE TRIGGER IF NOT EXISTS e2e_writes_update AFTER UPDATE ON records BEGIN INSERT INTO e2e_writes VALUES (NEW.owner, NEW.key, NEW.client); END;
            `);
            const row = db.prepare("SELECT COUNT(*) AS count FROM e2e_writes WHERE owner = 'nbook.workbench' AND key = 'workbench.layout' AND client = ?1").get(client) as {count: number};
            return Number(row.count);
        } finally {
            db.close();
        }
    }

    /** 本页客户端存下的布局文档里的面板表；还没写过为 null。 */
    async function savedDoc(page: Page): Promise<{panels: Record<string, {hidden?: boolean; collapsed?: boolean; tabs: unknown[]}>} | null> {
        const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
        const db = new DatabaseSync(join(tmp, "state", "storage", "user.sqlite"));
        try {
            const row = db.prepare("SELECT value FROM records WHERE owner = 'nbook.workbench' AND key = 'workbench.layout' AND client = ?1").get(client) as {value: string} | undefined;
            return row === undefined ? null : (JSON.parse(row.value) as {doc: {panels: Record<string, {hidden?: boolean; collapsed?: boolean; tabs: unknown[]}>}}).doc;
        } finally {
            db.close();
        }
    }

    async function open(page: Page): Promise<void> {
        await page.goto(new URL("/workbench", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(page.locator("[data-shell-focus-target=\"panel-toggle\"]")).toBeEnabled();
    }

    test("活动栏条目拖到右栏的标签条：拖动中源不动、有拖影与一条插入线；松手视图迁到右栏并激活，只写一次（输出 24、25 第 3 行、26、30；验收 1）", async ({page}) => {
        await open(page);
        const source = entry(page, C);
        const before = await source.boundingBox();
        const writes = await writesOf(page);
        await dragTo(page, source, await endOfStrip(page, "auxiliarybar"));
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "strip");
        await expect(feedback(page)).toHaveAttribute("data-drop-count", "1");
        await expect(line(page)).toBeVisible();
        // 拖动源原地不动、尺寸不变（WorkbenchDragFeedback 的样式意图：按钮按下的缩放在拖动开始后撤掉）；用软断言，失败也让后面的判据照常跑。
        expect.soft(await source.boundingBox()).toEqual(before);
        expect(await writesOf(page)).toBe(writes);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect(head(page, "auxiliarybar").locator(`[data-panel-tab="view:${C}"]`)).toHaveAttribute("aria-selected", "true");
        await expect(head(page, "sidebar").locator(`[data-panel-tab="view:${C}"]`)).toHaveCount(0);
        expect(await tabsOf(page, "auxiliarybar")).toEqual([`view:${D}`, `view:${C}`]);
        await expect(sample(page, C)).toBeVisible();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test("标签拖到另一块面板的外缘：多标签的面板拆出新块，预览是那一半且等于提交的矩形；拆出的无名面板把最后一个标签拖走就消失（输出 25 第 5 行、27、30、3；验收 2）", async ({page}, testInfo) => {
        await open(page);
        await expect(shell(page)).toHaveAttribute("data-panel-count", "4");
        const panelBefore = (await leaf(page, "panel").boundingBox())!;
        const writes = await writesOf(page);
        // 面板在纵向分支里，它的左缘对面没有同一分支的兄弟：拆这一块，新块取一半。
        await dragTo(page, tab(page, F), await inLeaf(page, "panel", {x: 0.08, y: 0.6}));
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "edge");
        await expect(area(page)).toBeVisible();
        const preview = (await area(page).boundingBox())!;
        expect(preview.x + preview.width).toBeLessThanOrEqual(panelBefore.x + panelBefore.width / 2 + 8);
        expect(await writesOf(page)).toBe(writes);
        await page.screenshot({path: testInfo.outputPath("edge-half.png")});
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect(shell(page)).toHaveAttribute("data-panel-count", "5");
        const created = await panelOfTab(page, F);
        expect(created).not.toBe("panel");
        expect(await tabsOf(page, "panel")).toEqual([`view:${E}`]);
        // 预览是区域矩形四边内缩 6px 画出来的，提交后新块的外框就是那个矩形。
        const final = (await leaf(page, created).boundingBox())!;
        expect(Math.abs(preview.x - final.x - 6)).toBeLessThan(2);
        expect(Math.abs(preview.y - final.y - 6)).toBeLessThan(2);
        expect(Math.abs(preview.width - final.width + 12)).toBeLessThan(2);
        expect(Math.abs(preview.height - final.height + 12)).toBeLessThan(2);
        await expect.poll(() => writesOf(page)).toBe(writes + 1);

        // 无名面板拖空即移除（输出 3）：己放回面板的标签条，新块消失。
        await dropAt(page, tab(page, F), await endOfStrip(page, "panel"));
        await expect(shell(page)).toHaveAttribute("data-panel-count", "4");
        await expect(leaf(page, created)).toHaveCount(0);
        expect(await tabsOf(page, "panel")).toEqual([`view:${E}`, `view:${F}`]);
    });

    test("只有一个标签的面板拖到别的面板的外缘：是同一块面板在移动，面板 id 与内容实例都不变（输出 27）", async ({page}) => {
        await open(page);
        const instance = await instanceOf(page, D);
        await dropAt(page, tab(page, D), await inLeaf(page, "panel", {x: 0.08, y: 0.6}));
        await expect(shell(page)).toHaveAttribute("data-panel-count", "4");
        expect(await panelOfTab(page, D)).toBe("auxiliarybar");
        // 右栏现在在面板的左边，两者并排。
        const aux = (await leaf(page, "auxiliarybar").boundingBox())!;
        const panel = (await leaf(page, "panel").boundingBox())!;
        expect(aux.x + aux.width).toBeLessThanOrEqual(panel.x + 2);
        expect(Math.abs(aux.y - panel.y)).toBeLessThan(2);
        await expect(sample(page, D)).toBeVisible();
        expect(await instanceOf(page, D)).toBe(instance);
    });

    test("松手在源自己身上或原处的边缘：显示“原位”、不提交，也不触发那一下点击（输出 28；验收 3）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        // 激活标签放回自己的位置：结构、顺序、标签集合、活动标签都不变。
        const source = tab(page, E);
        await expect(source).toHaveAttribute("aria-selected", "true");
        await dragTo(page, source, await centerOf(source));
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "noop");
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect(source).toHaveAttribute("aria-selected", "true");
        expect(await writesOf(page)).toBe(writes);
        // 那一下点击被吞了，没有激活别的标签；之后的普通点击照常激活。
        await expect(tab(page, F)).toHaveAttribute("aria-selected", "false");
        await tab(page, F).click();
        await expect(tab(page, F)).toHaveAttribute("aria-selected", "true");
        await expect.poll(() => writesOf(page)).toBe(writes + 1);

        // 验收 3：只有一个标签的右栏紧贴着中间一列，拖到它自己贴着的那条边上，结果和现在一样，什么都不提交。
        const next = await writesOf(page);
        const instance = await instanceOf(page, D);
        await dragTo(page, tab(page, D), await inLeaf(page, "auxiliarybar", {x: 0.04, y: 0.6}));
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "noop");
        await expect(label(page)).toContainText("原位");
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        expect(await writesOf(page)).toBe(next);
        expect(await instanceOf(page, D)).toBe(instance);
    });

    test("键盘：面板标签上空格拿起，方向键逐个位置移动插入位（激活标签不变），Enter 只提交一次，焦点回到标签（输出 31；验收 9）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const source = tab(page, E);
        await expect(source).toHaveAttribute("aria-selected", "true");
        await source.focus();
        await page.keyboard.press("Space");
        await expect(ghost(page)).toBeVisible();
        // 拿起时停在原位：原位，带“原位”提示。
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "noop");
        // 方向键逐个位置往后：先经过自己后面的位置（还是原位），再到己的后面。
        for (let step = 0; step < 4 && (await feedback(page).getAttribute("data-drop-kind")) === "noop"; step += 1) {
            await page.keyboard.press("ArrowRight");
            await labelText(page);
        }
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "strip");
        await expect(tab(page, F)).toHaveAttribute("aria-selected", "false");
        expect(await writesOf(page)).toBe(writes);
        await page.keyboard.press("Enter");
        await expect(ghost(page)).toHaveCount(0);
        expect(await tabsOf(page, "panel")).toEqual([`view:${F}`, `view:${E}`]);
        await expect(source).toBeFocused();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test("键盘：标签、活动栏条目、面板头各拿起一次；Tab 在区域之间循环，仍在拖动、没有写入；Escape 只取消，焦点回到来源（输出 31；验收 9）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const sources = [entry(page, A), tab(page, D), tab(page, E), head(page, "panel")];
        for (const source of sources) {
            await source.focus();
            await page.keyboard.press("Space");
            await expect(ghost(page)).toBeVisible();
            // 区域：三块工具面板、编辑组，再是预备区（此刻没有）；循环一圈回到起点。
            for (let step = 0; step < 4; step += 1) {
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

    test("键盘：单标签面板拿起后 Tab 能绕回第一个区域；从活动栏条目拿起也提示原位（输出 28、31；验收 9）", async ({page}) => {
        await open(page);
        // 这一刻的落点。可能没有落点，不用会等元素出现的定位器。
        const signature = (): Promise<string> => page.evaluate(() => {
            const box = document.querySelector("[data-drop-feedback-area]")?.getBoundingClientRect();
            const label = document.querySelector("[data-drop-feedback-label]")?.textContent ?? "";
            return `${document.querySelector("[data-drop-kind]")?.getAttribute("data-drop-kind") ?? ""}|${box === undefined ? "" : `${String(box.x)},${String(box.width)}`}|${label}`;
        });
        // 只有一个标签的面板：它自己的区域只有原位一个位置，以前这块区域是空的，Tab 走到它就卡住。
        await tab(page, D).focus();
        await page.keyboard.press("Space");
        await expect(ghost(page)).toBeVisible();
        const seen: string[] = [];
        for (let step = 0; step < 6; step += 1) {
            await page.keyboard.press("Tab");
            await expect(ghost(page)).toBeVisible();
            seen.push(await signature());
        }
        const cycle = seen.slice(1).indexOf(seen[0]!) + 1;
        expect(cycle).toBeGreaterThan(1);
        await page.keyboard.press("Escape");
        await expect(ghost(page)).toHaveCount(0);

        await entry(page, A).focus();
        await page.keyboard.press("Space");
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "noop");
        await expect(label(page)).toContainText("原位");
        await page.keyboard.press("Escape");
    });

    test("键盘：编辑组的外缘压在预备区底下时，两个落点各是各的：外缘是拆分，预备区是显示（输出 29、31）", async ({page}) => {
        await open(page);
        await frame(page, "auxiliarybar", "set-part-hidden").click();
        await expect(leaf(page, "auxiliarybar")).toHaveCount(0);
        await tab(page, E).focus();
        await page.keyboard.press("Space");
        await expect(page.locator('[data-reveal-zone="auxiliarybar"]')).toBeVisible();
        // 走遍区域与位置：编辑组的位置里要有外缘（`edge`），预备区是 `reveal`，二者都到得了。
        const kinds = new Set<string>();
        for (let region = 0; region < 6; region += 1) {
            await page.keyboard.press("Tab");
            for (let stop = 0; stop < 5; stop += 1) {
                kinds.add(await page.evaluate(() => document.querySelector("[data-drop-kind]")?.getAttribute("data-drop-kind") ?? ""));
                await page.keyboard.press("ArrowRight");
            }
        }
        expect(kinds.has("edge")).toBe(true);
        expect(kinds.has("reveal")).toBe(true);
        await page.keyboard.press("Escape");
        await expect(ghost(page)).toHaveCount(0);
    });

    test("键盘：面板头空白处拿起整块面板，Tab 到另一块面板，方向键换位置，Enter 放下；右栏搬空后隐藏，留在树里（输出 3、24、31）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        await head(page, "auxiliarybar").focus();
        await page.keyboard.press("Space");
        await expect(ghost(page)).toBeVisible();
        await expect(feedback(page)).toHaveAttribute("data-drop-count", "1");
        // 拿起时在右栏自己的位置；Tab 到别的区域后，方向键逐个位置往下，直到“添加为标签”（整块面板放到别的面板中央，等于它的标签）。
        await page.keyboard.press("Tab");
        for (let step = 0; step < 12 && !(await labelText(page)).includes("添加为标签"); step += 1) await page.keyboard.press("ArrowDown");
        await expect(label(page)).toContainText("添加为标签");
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "center");
        expect(await writesOf(page)).toBe(writes);
        await page.keyboard.press("Enter");
        await expect(ghost(page)).toHaveCount(0);
        // 右栏的标签进了别的面板；右栏拖空即隐藏，但留在树里（记住它的位置）。
        await expect(leaf(page, "auxiliarybar")).toHaveCount(0);
        expect(await panelOfTab(page, D)).not.toBe("auxiliarybar");
        await expect.poll(async () => (await savedDoc(page))?.panels.auxiliarybar?.hidden).toBe(true);
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test("拖影有图标与文字；经过另一块面板的标签条只有一条插入线，没有接收区域与条目高亮（输出 30）", async ({page}, testInfo) => {
        await open(page);
        const strip = (await band(page, "sidebar").boundingBox())!;
        await dragTo(page, tab(page, F), {x: strip.x + strip.width - 10, y: strip.y + strip.height / 2});
        await expect(ghost(page)).toContainText("样例己");
        await expect(ghost(page).locator("[class*='i-lucide-']")).toHaveCount(1);
        await expect(line(page)).toHaveCount(1);
        await expect(area(page)).toHaveCount(0);
        await expect(page.locator("[data-drop-feedback-entry]")).toHaveCount(0);
        await page.screenshot({path: testInfo.outputPath("strip-line.png")});
        await page.mouse.up();
        await expect(head(page, "sidebar").locator(`[data-panel-tab="view:${F}"]`)).toHaveAttribute("aria-selected", "true");
        await expect(sample(page, F)).toBeVisible();
    });

    test("面板收成标题行：从别的面板拖进它的标签条，同一次写入把它展开；面板里自己换序不展开（输出 11、27）", async ({page}) => {
        await open(page);
        const panel = leaf(page, "panel");
        await frame(page, "panel", "set-panel-collapsed").click();
        await expect.poll(async () => (await panel.boundingBox())!.height).toBe(32);
        await dropAt(page, entry(page, C), await endOfStrip(page, "panel"));
        await expect(tab(page, C)).toHaveAttribute("aria-selected", "true");
        await expect.poll(async () => (await panel.boundingBox())!.height).toBeGreaterThan(32);
        await expect(sample(page, C)).toBeVisible();

        // 收起之后在它自己的标签条里换序：不展开。
        await frame(page, "panel", "set-panel-collapsed").click();
        await expect.poll(async () => (await panel.boundingBox())!.height).toBe(32);
        const first = await centerOf(tab(page, E));
        await dropAt(page, tab(page, C), {x: first.x - 10, y: first.y});
        await expect.poll(() => tabsOf(page, "panel")).toEqual([`view:${C}`, `view:${E}`, `view:${F}`]);
        expect((await panel.boundingBox())!.height).toBe(32);
    });

    test("右栏与面板都隐藏时拖动：浮出两块预备区，真实落点照常优先；放到右栏的预备区，右栏显示并装着拖进来的视图，只写一次；拖动结束预备区消失（输出 29；验收 8）", async ({page}) => {
        await open(page);
        for (const panel of ["auxiliarybar", "panel"]) await frame(page, panel, "set-part-hidden").click();
        await expect(leaf(page, "auxiliarybar")).toHaveCount(0);
        await expect(leaf(page, "panel")).toHaveCount(0);
        await expect.poll(() => hiddenInRecord(page, "panel")).toBe(true);
        await expect.poll(() => hiddenInRecord(page, "auxiliarybar")).toBe(true);
        const zone = (part: string) => page.locator(`[data-reveal-zone="${part}"]`);
        const writes = await writesOf(page);
        await dragTo(page, entry(page, C), await inLeaf(page, "sidebar", {x: 0.5, y: 0.5}));
        await expect(zone("auxiliarybar")).toBeVisible();
        await expect(zone("panel")).toBeVisible();
        await expect(zone("sidebar")).toHaveCount(0);
        // 侧栏是显示着的面板，是真实落点（来源自己的面板，所以是“原位”）：预备区不抢它。
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "noop");
        // 右栏的预备区盖在编辑组上：编辑组的中央不接收工具视图，不是落点，所以指针停在预备区中央时落点是预备区。
        const to = await centerOf(zone("auxiliarybar"));
        await page.mouse.move(to.x, to.y, {steps: 6});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "reveal");
        await expect(label(page)).toContainText("放到右栏");
        await expect(zone("auxiliarybar")).toHaveAttribute("data-reveal-active", "true");
        await page.mouse.up();
        await expect(tab(page, C)).toHaveAttribute("aria-selected", "true");
        expect(await panelOfTab(page, C)).toBe("auxiliarybar");
        await expect(sample(page, C)).toBeVisible();
        await expect(page.locator("[data-reveal-zone]")).toHaveCount(0);
        await expect(leaf(page, "panel")).toHaveCount(0);
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    /** 把侧栏拖宽到上限，返回此刻的宽度：隐藏或拖到零之后预备区、按钮恢复都按这个记住的宽度。 */
    async function widenSidebar(page: Page): Promise<number> {
        const found = (await sidebarSash(page).boundingBox())!;
        await page.mouse.move(found.x + found.width / 2, found.y + found.height / 2);
        await page.mouse.down();
        await page.mouse.move(found.x + found.width / 2 + 260, found.y + found.height / 2, {steps: 6});
        await page.mouse.up();
        await expect.poll(async () => (await leaf(page, "sidebar").boundingBox())!.width).toBeGreaterThan(500);
        return Math.round((await leaf(page, "sidebar").boundingBox())!.width);
    }

    test("侧栏拖到零：预备区按记住的宽度浮出，盖住的真实落点照常优先；放到预备区，侧栏按记忆宽度回来并激活它，只写一次（输出 25 末、29；验收 8）", async ({page}) => {
        await open(page);
        const wide = await widenSidebar(page);
        const found = (await sidebarSash(page).boundingBox())!;
        await page.mouse.move(found.x + found.width / 2, found.y + found.height / 2);
        await page.mouse.down();
        await page.mouse.move(found.x - 1000, found.y + found.height / 2, {steps: 6});
        await page.mouse.up();
        await expect.poll(async () => (await leaf(page, "sidebar").boundingBox())!.width).toBe(0);
        const writes = await writesOf(page);

        await dragTo(page, entry(page, E), {x: 300, y: 400});
        const zone = page.locator('[data-reveal-zone="sidebar"]');
        await expect(zone).toBeVisible();
        expect(Math.round((await zone.boundingBox())!.width)).toBe(wide);
        // 预备区盖在编辑组上：编辑组让位，落点是预备区（输出 29）。
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "reveal");
        await expect(label(page)).toContainText("放到侧栏");
        // 预备区盖住了面板的左边一段：工具面板上的真实落点优先（这一点在面板的中央，来源就在这块面板里，所以是原位）。
        const body = await inLeaf(page, "panel", {x: 0.4, y: 0.7});
        await page.mouse.move(body.x, body.y, {steps: 6});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "noop");
        await page.mouse.move(300, 400, {steps: 6});
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "reveal");
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect.poll(async () => Math.round((await leaf(page, "sidebar").boundingBox())!.width)).toBe(wide);
        await expect(entry(page, E)).toHaveAttribute("aria-pressed", "true");
        await expect(sample(page, E)).toBeVisible();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test("侧栏隐藏后键盘拿起面板的标签：Tab 经过可见落点后到预备区，Enter 放进去，侧栏按记忆宽度回来并激活它（输出 29、31；验收 8、9）", async ({page}) => {
        await open(page);
        const wide = await widenSidebar(page);
        await frame(page, "sidebar", "set-part-hidden").click();
        await expect(leaf(page, "sidebar")).toHaveCount(0);
        const writes = await writesOf(page);
        await tab(page, E).focus();
        await page.keyboard.press("Space");
        await expect(page.locator('[data-reveal-zone="sidebar"]')).toBeVisible();
        // Tab 的个数取决于此刻有几块区域，不写死：按到提示变成“放到侧栏”为止。
        for (let step = 0; step < 8 && !(await labelText(page)).includes("放到侧栏"); step += 1) await page.keyboard.press("Tab");
        await expect(label(page)).toContainText("放到侧栏");
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "reveal");
        expect(await writesOf(page)).toBe(writes);
        await page.keyboard.press("Enter");
        await expect(ghost(page)).toHaveCount(0);
        await expect.poll(async () => Math.round((await leaf(page, "sidebar").boundingBox())!.width)).toBe(wide);
        await expect(entry(page, E)).toHaveAttribute("aria-pressed", "true");
        await expect(sample(page, E)).toBeVisible();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test("标签并入已有面板：内容从旧面板滑到新面板，矩形严格在新旧之间，两块面板都不动，实例、输入保留（输出 15；验收 1）", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        // 放慢过渡令牌，才读得到中间帧。
        await page.addStyleTag({content: ":root { --motion-layout: 4000ms !important; }"});
        await tab(page, B).click();
        await expect(sample(page, B)).toBeVisible();
        await sample(page, B).locator("input").fill("乙的草稿");
        const instance = await instanceOf(page, B);
        const before = (await content(page, B).boundingBox())!;
        const sidebar = (await leaf(page, "sidebar").boundingBox())!;
        const aux = (await leaf(page, "auxiliarybar").boundingBox())!;

        await dropAt(page, tab(page, B), await endOfStrip(page, "auxiliarybar"));
        await expect(content(page, B)).toHaveAttribute("data-flying", "");
        await expect.poll(async () => (await content(page, B).boundingBox())!.x).toBeGreaterThan(before.x + 1);
        const during = (await content(page, B).boundingBox())!;
        // 两块面板都没动（差不到 1px：按像素对齐后的亚像素抖动不算）。
        for (const [id, rect] of [["sidebar", sidebar], ["auxiliarybar", aux]] as const) {
            const now = (await leaf(page, id).boundingBox())!;
            for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(now[key] - rect[key]), `${id}.${key}`).toBeLessThan(1);
        }
        await expect(content(page, B)).not.toHaveAttribute("data-flying", "");
        const after = (await content(page, B).boundingBox())!;
        expect(after.x).toBeCloseTo(aux.x, 0);
        expect(during.x).toBeGreaterThan(before.x);
        expect(during.x).toBeLessThan(after.x);
        expect(await instanceOf(page, B)).toBe(instance);
        await expect(sample(page, B).locator("input")).toHaveValue("乙的草稿");
        await expect(head(page, "sidebar").locator(`[data-panel-tab="view:${B}"]`)).toHaveCount(0);
    });

    test("放下时高亮立刻消失，不留在原处，也不跟着内容走；内容自己滑过去（输出 15、30）", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        // 把动效都放慢：还有淡出或滑向结果的话，松手之后高亮会留很久；内容的飞行也看得见。
        await page.addStyleTag({content: ":root { --motion-layout: 4000ms !important; --motion-base: 3000ms !important; --motion-fast: 3000ms !important; }"});
        await dragTo(page, tab(page, F), await inLeaf(page, "panel", {x: 0.08, y: 0.6}));
        await expect(area(page)).toBeVisible();
        await page.mouse.up();
        await expect(page.locator("[data-drop-feedback-area]")).toHaveCount(0, {timeout: 1000});
        await expect(page.locator("[data-grid-scope] [data-moving]").first()).toBeAttached();
    });

    test("工具视图拖到编辑组的外缘：拆到编辑组旁边，内容实例不变；活动栏条目拖过去一样（输出 24、26；验收 10、14）", async ({page}) => {
        await open(page);
        const instance = await instanceOf(page, D);
        await dropAt(page, entry(page, D), await inLeaf(page, "g0", {x: 0.97, y: 0.3}));
        const moved = (await leaf(page, await panelOfTab(page, D)).boundingBox())!;
        const editor = (await leaf(page, "g0").boundingBox())!;
        expect(editor.x + editor.width).toBeLessThanOrEqual(moved.x + 2);
        await expect(sample(page, D)).toBeVisible();
        expect(await instanceOf(page, D)).toBe(instance);
    });

    test("没有落点的地方：拖到活动栏、编辑组的中央，工具视图被拒绝，松手不提交（输出 25 第 1 行、26；验收 10、14）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const source = entry(page, C);
        await dragTo(page, source, await centerOf(entry(page, B)));
        await expect(ghost(page)).toBeVisible();
        await expect(feedback(page)).toHaveCount(0);
        await page.mouse.move(...Object.values(await inLeaf(page, "g0", {x: 0.5, y: 0.5})) as [number, number], {steps: 6});
        await expect(feedback(page)).toHaveCount(0);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        expect(await panelOfTab(page, C)).toBe("sidebar");
        expect(await writesOf(page)).toBe(writes);
    });

    test("工具区不接收：拖到面板头的框架按钮上没有落点反馈，松手不移动、不写（输出 25 末）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const button = frame(page, "panel", "set-panel-collapsed");
        await expect(button).toBeVisible();
        await dragTo(page, entry(page, C), await centerOf(button));
        await expect(ghost(page)).toBeVisible();
        await expect(feedback(page)).toHaveCount(0);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect(tab(page, C)).toHaveCount(1);
        expect(await panelOfTab(page, C)).toBe("sidebar");
        expect(await writesOf(page)).toBe(writes);
    });

    test("键盘拿起后直接 Enter 是原位：标签、活动栏条目、面板头都不移动、不写，焦点回到来源（输出 28、31；验收 9）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const before = await tabsOf(page, "panel");
        // 来源都是各自面板的激活标签：放回原处连激活标签也不变。
        for (const source of [tab(page, E), entry(page, A), head(page, "panel")]) {
            await source.focus();
            await page.keyboard.press("Space");
            await expect(ghost(page)).toBeVisible();
            await page.keyboard.press("Enter");
            await expect(ghost(page)).toHaveCount(0);
            await expect(source).toBeFocused();
        }
        expect(await tabsOf(page, "panel")).toEqual(before);
        expect(await panelOfTab(page, A)).toBe("sidebar");
        expect(await writesOf(page)).toBe(writes);
    });

    test("松手只提交显示过的落点：最后一次移动与松手落在同一帧、换到了没显示过的落点时不提交；落点没变时照常提交（输出 24；ui/layout-drag 输出 6）", async ({page}) => {
        await open(page);
        const source = entry(page, C);
        const shown = await endOfStrip(page, "auxiliarybar");
        const panelStrip = (await band(page, "panel").boundingBox())!;
        // 这次移动与松手在同一个任务里派发：两者之间没有帧，会话来不及发布新落点。真实输入里快速甩动松手就是这种时序，
        // 用 Playwright 的鼠标做不出确定的“同一帧”，所以这两下用页面里的指针事件。
        const flick = (to: {x: number; y: number}) => page.evaluate(({x, y}) => {
            const init = {pointerId: 1, pointerType: "mouse", isPrimary: true, bubbles: true, clientX: x, clientY: y};
            document.dispatchEvent(new PointerEvent("pointermove", {...init, buttons: 1}));
            document.dispatchEvent(new PointerEvent("pointerup", {...init, button: 0, buttons: 0}));
        }, to);
        const writes = await writesOf(page);
        await dragTo(page, source, shown);
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "strip");
        await flick({x: panelStrip.x + panelStrip.width / 3, y: panelStrip.y + panelStrip.height / 2});
        await expect(ghost(page)).toHaveCount(0);
        await page.mouse.up();
        expect(await panelOfTab(page, C)).toBe("sidebar");
        expect(await writesOf(page)).toBe(writes);

        await dragTo(page, source, shown);
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "strip");
        await flick(shown);
        await expect(ghost(page)).toHaveCount(0);
        await page.mouse.up();
        await expect(tab(page, C)).toHaveAttribute("aria-selected", "true");
        expect(await panelOfTab(page, C)).toBe("auxiliarybar");
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test("“移动到”的“新面板”：视图搬进新建的无名面板并激活，刷新后仍在同一块面板里（输出 23、35；验收 1）", async ({page}) => {
        await open(page);
        await tab(page, A).click({button: "right"});
        await page.getByRole("menuitem", {name: "新面板（挨着面板）", exact: true}).click();
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(shell(page)).toHaveAttribute("data-panel-count", "5");
        const created = await panelOfTab(page, A);
        expect(["sidebar", "auxiliarybar", "panel", "g0"]).not.toContain(created);
        await expect(tab(page, A)).toHaveAttribute("aria-selected", "true");
        await expect(sample(page, A)).toBeVisible();
        await expect.poll(() => writesOf(page)).toBeGreaterThan(0);
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        expect(await panelOfTab(page, A)).toBe(created);
        await expect(sample(page, A)).toBeVisible();
        // 活动栏列全部工具视图，不管它停在哪：甲的条目还在。
        await expect(entry(page, A)).toHaveCount(1);
    });

    test("拖动源压在分隔线的命中带里：按下并拖动是调整大小，不出现拖影；同一个面板头中部按下拖动才是拿起整块面板（输出 24；ui/layout-drag 验收 3）", async ({page}) => {
        await open(page);
        // 把己拖到侧栏的下缘，拆出一块无名面板：它的面板头顶边挨着它与侧栏之间的分隔线。
        await dropAt(page, tab(page, F), await inLeaf(page, "sidebar", {x: 0.5, y: 0.92}));
        const created = await panelOfTab(page, F);
        expect(created).not.toBe("panel");
        const panelHead = head(page, created);
        await expect(panelHead).toBeVisible();
        const before = (await panelHead.boundingBox())!;
        // 面板头的顶边这一像素同时落在面板头上和命中带里：分隔线在上面。
        const x = before.x + before.width * 0.75;
        await page.mouse.move(x, before.y + 1);
        await page.mouse.down();
        await page.mouse.move(x, before.y + 41, {steps: 6});
        await expect.poll(async () => (await panelHead.boundingBox())!.y).toBeGreaterThan(before.y + 20);
        await expect(ghost(page)).toHaveCount(0);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);

        // 对照：面板头中部同样的拖动是拿起整块面板，面板头不被分隔线抢走。
        const moved = (await panelHead.boundingBox())!;
        await page.mouse.move(x, moved.y + moved.height / 2);
        await page.mouse.down();
        await page.mouse.move(x + 10, moved.y + moved.height / 2 + 10, {steps: 2});
        await expect(ghost(page)).toBeVisible();
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
    });
});
