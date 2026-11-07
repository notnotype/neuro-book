/**
 * 工作台里的视图在真实 Chrome 中的验收（docs/specs/ui/workbench-layout.md 输出 1、4、12、14、17、19、20、22、23、35、36，验收 1、
 * 7、13 到 15、18；docs/specs/workbench/views.md 验收 1–5、8、9）：生产构建的 e2e 测试外壳与宿主测试入口，测试插件
 * `test.sample-views`（src/web/testing/sample-views.ts）贡献六个视图（侧栏三个、右栏一个、面板两个），每个视图是所在面板里的
 * 一个标签。等页面上可观察的变化，不按时长等待。
 *
 * 不在这里的：
 * - 几何、卡片、最大化盖住、从零拉回的细节：`lab-workbench-surface.e2e.ts`、`lab-grid-panels.e2e.ts`；拖放：`workbench-dnd.e2e.ts`；
 * - 相邻两块之间的边界只改这两块（输出 6、验收 4）：`lab-nested-grid.e2e.ts` 管手势，“拖它只改这两块”的表驱动单测待补
 *   （`project-doc`），产品页不再重复；
 * - 落位与意图合成的逐条规则、两个窗口与保存失败：`state/layout-doc-store.test.ts`、`workbench-shell.e2e.ts`；
 * - 注册表与内核撤回的串行窗口（`views/registry.test.ts`）、命令的参数与过期（`commands/view-commands.test.ts`）。
 */

import {mkdir, rm, writeFile} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {SAMPLE_VIEWS_SWITCHES} from "nbook/shared/testing/sample-views-contract";

import {CLIENT_IDENTITY_KEY} from "nbook/web/host/client-identity";

import {startProbeServer} from "./fixtures";
import type {ProbeServer} from "./fixtures";

const A = "test.sample-views.alpha";
const B = "test.sample-views.beta";
const C = "test.sample-views.gamma";
const D = "test.sample-views.delta";
const E = "test.sample-views.omega";
const F = "test.sample-views.zeta";

interface Box {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/**
 * 树里的叶外框。编辑组的内容里还有一层编辑区自己的栅格，它的 `data-leaf` 与外壳的叶同名，所以限定到外壳栅格的直接子级。
 * 视图内容在内容层里，和叶外框是兄弟元素，不在 `[data-leaf]` 里面（输出 14）。
 */
const LEAF = "[data-workbench-surface] > [data-grid-scope] > [data-leaf]";
const leaf = (page: Page, id: string) => page.locator(`${LEAF}[data-leaf="${id}"]`);

async function box(page: Page, id: string): Promise<Box> {
    const found = await leaf(page, id).boundingBox();
    if (found === null) throw new Error(`没有 ${id} 的外框`);
    return found;
}

const sample = (page: Page, viewId: string) => page.locator(`[data-sample-view="${viewId}"]`);
const head = (page: Page, panel: string) => page.locator(`[data-panel-head="${panel}"]`);
const tab = (page: Page, viewId: string) => page.locator(`[data-panel-tab="view:${viewId}"]`);
const toolEntry = (page: Page, viewId: string) => page.locator(`[data-tool-entry="${viewId}"]`);
const frame = (page: Page, panel: string, command: string) => head(page, panel).locator(`[data-panel-action="nbook.view.${command}"]`);
const sidebarSash = (page: Page) => page.getByRole("separator", {name: "调整 sidebar 与 center 的宽度"});
const auxiliarySash = (page: Page) => page.getByRole("separator", {name: "调整 center 与 auxiliarybar 的宽度"});

/** 内容被停放：不可交互（`inert`），不卸载（输出 16）。 */
const parked = (page: Page, viewId: string) => expect(page.locator(`[data-content="view:${viewId}"]`)).toHaveAttribute("inert", "");

/** 打开命令面板（命令宿主随页面异步加载，按到面板出现为止），输入命令后按回车执行第一项。 */
async function runCommand(page: Page, text: string): Promise<void> {
    const combobox = page.getByRole("combobox");
    await expect(async () => {
        await page.keyboard.press("Control+Shift+P");
        await expect(combobox).toBeFocused({timeout: 500});
    }).toPass();
    await combobox.fill(`>${text}`);
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Enter");
}

/** 选择模式里选一项：等这一步的输入框（名称是选择请求的占位）出现，过滤到只剩目标再回车。 */
async function pick(page: Page, placeholder: string, text: string): Promise<void> {
    const combobox = page.getByRole("combobox", {name: placeholder});
    await expect(combobox).toBeFocused();
    await combobox.fill(text);
    await expect(page.getByRole("option")).toHaveCount(1);
    await page.keyboard.press("Enter");
}

/** 目标面板的名字也是“新面板（挨着…）”的一部分，过滤不能收敛到一项：按完整名称点那一项。 */
async function pickExact(page: Page, placeholder: string, label: string): Promise<void> {
    await expect(page.getByRole("combobox", {name: placeholder})).toBeFocused();
    await page.getByRole("option", {name: label, exact: true}).click();
}

/**
 * 让侧栏这一列的视图可见并成为当前视图：它不是当前视图时没有标签 DOM（输出 22、23），切换只能点活动栏条目；已经是当前视图
 * 再点条目是隐藏，所以先看按下态。
 */
async function showView(page: Page, viewId: string): Promise<void> {
    const entry = toolEntry(page, viewId);
    if (await entry.getAttribute("aria-pressed") !== "true") await entry.click();
    await expect(entry).toHaveAttribute("aria-pressed", "true");
}

/**
 * 右键视图，在菜单里选目标：移动视图的入口（输出 23），目标名是面板名、“新面板（挨着 X）”或“重置位置”。侧栏这一列的视图
 * 右键活动栏条目（它们不一定有标签 DOM），别处的视图右键标签。
 */
async function moveViaMenu(page: Page, viewId: string, target: string): Promise<void> {
    const source = await toolEntry(page, viewId).count() > 0 ? toolEntry(page, viewId) : tab(page, viewId);
    await source.click({button: "right"});
    await page.getByRole("menuitem", {name: target, exact: true}).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
}

async function instanceOf(page: Page, viewId: string): Promise<{instance: string | null; generation: string | null; location: string | null}> {
    return sample(page, viewId).evaluate((element) => ({instance: element.getAttribute("data-instance"), generation: element.getAttribute("data-generation"), location: element.getAttribute("data-location")}));
}

/** 标签所在面板的 id（面板头上写着）。 */
const panelOfTab = (page: Page, viewId: string): Promise<string> => tab(page, viewId).evaluate((element) => element.closest<HTMLElement>("[data-panel-head]")!.dataset.panelHead!);

/** 焦点此刻在哪块面板里：外框（面板头）或内容项都指回面板 id；不在任何面板里是 null。 */
const focusedPanelOf = (page: Page): Promise<string | null> => page.evaluate(() => {
    const owner = document.activeElement?.closest<HTMLElement>("[data-content-leaf], [data-leaf]");
    return owner?.dataset.contentLeaf ?? owner?.dataset.leaf ?? null;
});

test.describe("产品页：测试插件贡献的视图", () => {
    let tmp = "";
    let server: ProbeServer;

    test.beforeAll(async () => {
        tmp = await createTestTmpRoot("neuro-book-e2e", "workbench-views");
        await mkdir(join(tmp, "state"), {recursive: true});
        // 产品的资源管理器视图会占住侧栏：这里只看测试插件的视图。
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views", NBOOK_EXCLUDE_PLUGINS: "nbook.explorer,nbook.editor,nbook.agent"}});
    });

    test.afterAll(async () => {
        expect(await server.stop()).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 1440, height: 900}});

    const userDatabase = (): string => join(tmp, "state", "storage", "user.sqlite");

    interface SavedDoc {
        readonly panels: Readonly<Record<string, {readonly tabs: ReadonlyArray<{readonly kind: string; readonly viewId?: string}>; readonly active: string | null; readonly hidden?: boolean; readonly collapsed?: boolean}>>;
    }

    /** 本页客户端存下的 `workbench.layout`（`local`，按客户端分行）；还没写过为 null。后端由各用例共用，只看本用例这一行。 */
    async function saved(page: Page): Promise<{revision: number; doc: SavedDoc} | null> {
        const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
        if (client === null) throw new Error("页面还没有客户端身份");
        const db = new DatabaseSync(userDatabase());
        try {
            const row = db.prepare("SELECT revision, value FROM records WHERE owner = 'nbook.workbench' AND key = 'workbench.layout' AND client = ?1").get(client) as {revision: number; value: string} | undefined;
            return row === undefined ? null : {revision: Number(row.revision), doc: (JSON.parse(row.value) as {doc: SavedDoc}).doc};
        } finally {
            db.close();
        }
    }

    /** 本页的布局记录修订号；还没写过是 0。 */
    const revisionOf = async (page: Page): Promise<number> => (await saved(page))?.revision ?? 0;

    async function open(page: Page): Promise<void> {
        await page.goto(new URL("/workbench", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(page.locator("[data-shell-focus-target=\"panel-toggle\"]")).toBeEnabled();
    }

    test("右栏拖到零后刷新、视图还没加载过：按住往外拉，松手前视图就加载并可见（输出 12、17）", async ({page}) => {
        await open(page);
        await expect(sample(page, D)).toBeVisible();
        const sash = auxiliarySash(page);
        const press = async (): Promise<{x: number; y: number}> => {
            const found = await sash.boundingBox();
            if (found === null) throw new Error("没有右栏的边界");
            const start = {x: found.x + found.width / 2, y: found.y + found.height / 2};
            await page.mouse.move(start.x, start.y);
            await page.mouse.down();
            return start;
        };
        let start = await press();
        await page.mouse.move(start.x + 330, start.y, {steps: 6});
        await page.mouse.up();
        await expect.poll(async () => (await box(page, "auxiliarybar")).width).toBe(0);
        await parked(page, D);
        await expect.poll(async () => (await saved(page))?.doc.panels.auxiliarybar?.collapsed).toBe(true);
        await page.reload();
        await open(page);
        // 刷新后右栏仍拖到零：里面的视图一次都没加载
        await expect(sample(page, D)).toHaveCount(0);
        start = await press();
        await page.mouse.move(start.x - 220, start.y, {steps: 10});
        await expect(sample(page, D)).toBeVisible();
        await page.mouse.up();
        await expect(sample(page, D)).toBeVisible();
    });

    test("侧栏拖到零与从零拉出：松手前活动栏就随之独立或与侧栏相连（输出 12、19）", async ({page}) => {
        await open(page);
        const activitybar = page.locator("[data-shell-card=\"activitybar\"]");
        await expect(activitybar).toHaveAttribute("data-shell-join", "start");
        const sash = sidebarSash(page);
        const found = await sash.boundingBox();
        if (found === null) throw new Error("没有侧栏的边界");
        const y = found.y + found.height / 2;
        await page.mouse.move(found.x + found.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(0, y, {steps: 8});
        await expect(activitybar).not.toHaveAttribute("data-shell-join");
        await page.mouse.up();
        await expect(activitybar).not.toHaveAttribute("data-shell-join");
        const zero = await sash.boundingBox();
        if (zero === null) throw new Error("侧栏拖到零后没有边界");
        await page.mouse.move(zero.x + zero.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(zero.x + 260, y, {steps: 10});
        await expect(sample(page, A)).toBeVisible();
        await expect(activitybar).toHaveAttribute("data-shell-join", "start");
        await expect(page.locator("[data-shell-card=\"sidebar\"]")).toHaveAttribute("data-shell-join", "end");
        await page.mouse.up();
        await expect(activitybar).toHaveAttribute("data-shell-join", "start");
    });

    test("面板头的动作与滚动条随鼠标显示：鼠标在外时动作透明、没有滑块、内容不让宽；移入、Tab 进入或菜单开着时动作可见；拖滑块按比例滚动（输出 20；views.md 验收 9）", async ({page}) => {
        await open(page);
        await showView(page, C);
        const view = page.locator(`[data-view-frame="${C}"]`);
        const scroller = view.locator("[data-view-scroller]");
        const bar = view.locator("[data-overlay-scrollbar]");
        // 丙自己声明了一个收进“⋯”的动作：面板头里的动作区只有“⋯”。
        const actions = head(page, "sidebar").locator("[data-hover-actions]");
        const more = actions.locator("[data-title-actions-more]");
        await expect(scroller).toBeVisible();

        // 鼠标在侧栏之外、焦点不在侧栏里。
        await page.mouse.move(1000, 400);
        await page.locator("body").evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await expect(actions).toHaveCSS("opacity", "0");
        await expect(bar).not.toHaveAttribute("data-shown");
        expect(await scroller.evaluate((element: HTMLElement) => element.offsetWidth - element.clientWidth)).toBe(0);
        expect(await scroller.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

        await view.hover();
        await expect(actions).toHaveCSS("opacity", "1");
        await expect(bar).toHaveAttribute("data-shown", "");

        // 鼠标移开，焦点 Tab 到动作上：仍可见。
        await page.mouse.move(1000, 400);
        await more.focus();
        await expect(actions).toHaveCSS("opacity", "1");
        // “⋯”的菜单开着、鼠标在菜单上：不消失。
        await more.click();
        const menu = page.getByRole("menu");
        await expect(menu).toBeVisible();
        await menu.getByRole("menuitem").first().hover();
        await expect(actions).toHaveCSS("opacity", "1");
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);

        // 拖滑块：滑块走了多少比例，内容就滚多少比例。
        await view.hover();
        const thumb = bar.locator("[data-overlay-scrollbar-thumb]");
        const thumbBox = await thumb.boundingBox();
        if (thumbBox === null) throw new Error("没有滑块");
        expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0);
        await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + 4);
        await page.mouse.down();
        await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + 4 + 30, {steps: 4});
        await page.mouse.up();
        const moved = await scroller.evaluate((element) => ({scrollTop: element.scrollTop, range: element.scrollHeight - element.clientHeight}));
        const track = await bar.evaluate((element) => element.getBoundingClientRect().height);
        const expected = (30 / (track - thumbBox.height)) * moved.range;
        expect(Math.abs(moved.scrollTop - expected)).toBeLessThanOrEqual(2);
    });

    test("全链路：视图按声明出现在默认位置，第一次有效可见才加载，代际为 1；活动栏只列侧栏这一列的视图（输出 1、4、17、22）", async ({page}) => {
        await open(page);
        await expect(sample(page, A)).toBeVisible();
        expect(await instanceOf(page, A)).toMatchObject({generation: "1", location: "sidebar"});
        await expect(sample(page, D)).toBeVisible();
        await expect(sample(page, E)).toBeVisible();
        // 侧栏的乙、丙是同一块面板里没激活的标签：还没加载。
        await expect(page.locator(`[data-view-frame="${B}"]`)).toHaveCount(0);
        await expect(page.locator(`[data-view-frame="${C}"]`)).toHaveCount(0);
        // 侧栏这一列的头只写当前视图：不是当前视图的标签没有 DOM（输出 22）。
        await expect(tab(page, B)).toHaveCount(0);
        await expect(tab(page, A)).toHaveCount(1);
        // 活动栏只列侧栏这一列的视图：右栏、面板的视图不在。
        await expect(page.locator("[data-tool-entry]")).toHaveCount(3);
        for (const viewId of [D, E, F]) await expect(toolEntry(page, viewId)).toHaveCount(0);
    });

    test("视图的内边距只有外框一个来源：fill 的样例甲与 scroll 的样例丁，第一行文字离各自外框的距离相同且不为零", async ({page}) => {
        await open(page);
        const offset = (viewId: string) => page.locator(`[data-view-frame="${viewId}"]`).evaluate((view) => {
            const line = view.querySelector("[data-sample-view] > :first-child");
            if (line === null) throw new Error("样例视图没有第一行");
            const outer = view.getBoundingClientRect();
            const inner = line.getBoundingClientRect();
            return {left: inner.left - outer.left, top: inner.top - outer.top};
        });
        await expect(sample(page, A)).toBeVisible();
        await expect(sample(page, D)).toBeVisible();
        const fill = await offset(A);
        expect(fill.left).toBeGreaterThan(0);
        expect(fill.top).toBeGreaterThan(0);
        expect(await offset(D)).toEqual(fill);
    });

    test("编辑组的内容：挂测试插件贡献的内容；别的面板最大化时停放（visible 为假）不重挂，还原后同一实例（输出 13、14、16、17）", async ({page}) => {
        await open(page);
        const area = page.locator("[data-sample-editor-area]");
        await expect(area).toHaveAttribute("data-visible", "true");
        // 编辑组的内容在内容层里，面板 id 是 g0。
        await expect(page.locator("[data-content=\"editor:g0\"] [data-workbench-editor-area]")).toHaveCount(1);
        await expect(page.locator("[data-content=\"editor:g0\"] [data-sample-editor-area]")).toHaveCount(1);
        const instance = await area.getAttribute("data-instance");
        await frame(page, "panel", "toggle-panel-maximized").click();
        await expect(area).toHaveAttribute("data-visible", "false");
        await frame(page, "panel", "toggle-panel-maximized").click();
        await expect(area).toHaveAttribute("data-visible", "true");
        expect(await area.getAttribute("data-instance")).toBe(instance);
    });

    test("活动栏：不可见时点它显示并聚焦，可见时点它隐藏所在的具名面板（不看焦点在哪）；按下态等于有效可见；拖到零时点它按记忆尺寸展开（输出 22；验收 14）", async ({page}) => {
        await open(page);
        // 活动栏只列侧栏这一列的视图，当前的那个按下。
        await expect(toolEntry(page, A)).toHaveAttribute("aria-pressed", "true");
        for (const viewId of [B, C]) await expect(toolEntry(page, viewId)).toHaveAttribute("aria-pressed", "false");

        // 不可见：显示所在面板、激活它。同一块面板里它取代原先激活的标签。
        await toolEntry(page, B).click();
        await expect(toolEntry(page, B)).toHaveAttribute("aria-pressed", "true");
        await expect(toolEntry(page, A)).toHaveAttribute("aria-pressed", "false");
        await expect(sample(page, B)).toBeVisible();
        await expect(sample(page, A)).toHaveAttribute("data-visible", "false");
        const width = (await box(page, "sidebar")).width;

        // 可见：隐藏所在的具名面板。
        await expect.poll(() => focusedPanelOf(page)).toBe("sidebar");
        await toolEntry(page, B).click();
        await expect(leaf(page, "sidebar")).toHaveCount(0);
        await expect(toolEntry(page, B)).toHaveAttribute("aria-pressed", "false");
        await expect.poll(async () => (await saved(page))?.doc.panels.sidebar?.hidden).toBe(true);
        // 隐藏之后点它：显示回来，按记忆尺寸。
        await toolEntry(page, B).click();
        await expect(sample(page, B)).toBeVisible();
        await expect(toolEntry(page, B)).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => Math.round((await box(page, "sidebar")).width)).toBe(Math.round(width));

        // 可见但焦点不在里面：照样是隐藏，没有“先聚焦”这一步。
        await sample(page, E).locator("input").focus();
        await expect.poll(() => focusedPanelOf(page)).toBe("panel");
        await toolEntry(page, B).click();
        await expect(leaf(page, "sidebar")).toHaveCount(0);
        await toolEntry(page, B).click();
        await expect(sample(page, B)).toBeVisible();

        // 拖到零：内容停放；点另一项显示并按记忆尺寸展开。
        await sidebarSash(page).focus();
        await page.keyboard.press("Enter");
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(0);
        await parked(page, B);
        await expect(toolEntry(page, B)).toHaveAttribute("aria-pressed", "false");
        await toolEntry(page, C).click();
        await expect(sample(page, C)).toBeVisible();
        await expect.poll(async () => Math.round((await box(page, "sidebar")).width)).toBe(Math.round(width));
        await expect(toolEntry(page, C)).toHaveAttribute("aria-pressed", "true");
    });

    test("活动栏只列侧栏这一列的视图，顺序是文档里的标签顺序：移到右栏后不在，移回来又在（输出 22；验收 14）", async ({page}) => {
        await open(page);
        const entries = () => page.locator("[data-tool-band] [data-tool-entry]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-tool-entry")));
        expect(await entries()).toEqual([A, B, C]);
        await moveViaMenu(page, B, "右栏");
        await expect.poll(entries).toEqual([A, C]);
        await expect(toolEntry(page, B)).toHaveCount(0);
        // 移回来排在末尾（文档里的标签顺序），不按视图声明的 order 回到原来的位置。
        await moveViaMenu(page, B, "侧栏");
        await expect.poll(entries).toEqual([A, C, B]);
        await expect(toolEntry(page, B)).toHaveAttribute("aria-pressed", "true");
    });

    test("侧栏这一列的头只写当前视图的标题：标题的描述说怎么拖，内容的名称是视图标题、不含“拖动”（输出 20、22；验收 14）", async ({page}) => {
        await open(page);
        const title = tab(page, A);
        await expect(title).toHaveCount(1);
        await expect(head(page, "sidebar").locator("h2 > button[data-panel-tab]")).toHaveCount(1);
        await expect(head(page, "sidebar").locator('[role="tab"]')).toHaveCount(0);
        await expect(title).toHaveAccessibleDescription(/拖动/u);
        // 内容的角色是 region，名称取自标题：视图标题，不带“拖动”的说明。
        await expect(page.getByRole("region", {name: "样例甲", exact: true})).toBeVisible();
        await expect(page.getByRole("region", {name: /拖动/u})).toHaveCount(0);
        await expect(sample(page, A)).toBeVisible();
    });

    test("头的样式按标签数：右栏一个视图只写标题，放进第二个变标签带，搬走又回去；活动栏隐藏后侧栏也画标签带，切换靠标签（输出 20、22；验收 14）", async ({page}) => {
        await open(page);
        const aux = head(page, "auxiliarybar");
        await expect(aux.locator('[role="tab"]')).toHaveCount(0);
        await expect(aux.locator(`[data-panel-tab="view:${D}"]`)).toBeVisible();
        await expect(page.locator(`[data-content="view:${D}"] [role="region"]`)).toHaveCount(1);
        await moveViaMenu(page, A, "右栏");
        await expect(aux.locator('[role="tab"]')).toHaveCount(2);
        await moveViaMenu(page, A, "侧栏");
        await expect(aux.locator('[role="tab"]')).toHaveCount(0);
        await expect(head(page, "panel").locator('[role="tab"]')).toHaveCount(2);
        await expect(head(page, "sidebar").locator('[role="tab"]')).toHaveCount(0);
        await runCommand(page, "切换区域显隐");
        await pick(page, "选中后立即切换", "活动栏");
        await expect(page.locator("[data-tool-entry]")).toHaveCount(0);
        await expect(head(page, "sidebar").locator('[role="tab"]')).toHaveCount(3);
        await expect(head(page, "sidebar").locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
        await tab(page, B).click();
        await expect(sample(page, B)).toBeVisible();
        await expect(tab(page, B)).toHaveAttribute("aria-selected", "true");
    });

    test("声明消失的视图留在树上：标签写它的 id，内容是占位与原因，可以关闭；别的操作写回时不丢（输出 4；验收 13）", async ({page}) => {
        await open(page);
        // 让布局定下来：没动过布局时树跟着视图目录，没有记录可改。
        const collapse = page.locator('[data-panel-head="panel"] [data-panel-action="nbook.view.set-panel-collapsed"]');
        await collapse.click();
        await expect.poll(() => saved(page).then((record) => record?.doc.panels.panel?.collapsed === true)).toBe(true);
        const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
        // 插件暂时缺失的样子：记录里有它的标签，目录里没有它的声明。
        const db = new DatabaseSync(userDatabase());
        try {
            const row = db.prepare("SELECT rowid AS id, value FROM records WHERE owner = 'nbook.workbench' AND key = 'workbench.layout' AND client = ?1").get(client) as {id: number; value: string};
            const value = JSON.parse(row.value) as {doc: {panels: Record<string, {tabs: Array<Record<string, string>>; active: string | null; collapsed?: boolean}>}};
            const sidebar = value.doc.panels.sidebar!;
            sidebar.tabs.push({kind: "view", viewId: "test.gone"});
            sidebar.active = "view:test.gone";
            db.prepare("UPDATE records SET value = ?1 WHERE rowid = ?2").run(JSON.stringify(value), row.id);
        } finally {
            db.close();
        }
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        const tab = page.locator('[data-panel-head="sidebar"] [data-panel-tab="view:test.gone"]');
        await expect(tab).toContainText("test.gone");
        const missing = page.locator('[data-content="view:test.gone"] [data-view-missing]');
        await expect(missing).toContainText("test.gone");
        // 别的操作写回时它还在。
        await collapse.click();
        await expect.poll(() => saved(page).then((record) => record?.doc.panels.panel?.collapsed !== true)).toBe(true);
        expect((await saved(page))?.doc.panels.sidebar?.tabs).toContainEqual({kind: "view", viewId: "test.gone"});
        // 关闭：标签和占位都没了，活动标签换到相邻的。
        await missing.getByRole("button", {name: "关闭这个标签"}).click();
        await expect(tab).toHaveCount(0);
        // 侧栏这一列的头只写当前视图的标题：活动标签换到相邻的，头里仍有一个标题。
        await expect(page.locator('[data-panel-head="sidebar"] [data-panel-tab]')).toHaveCount(1);
    });

    test("移动到：右键菜单里把乙移进面板（实例不变）；甲移到新面板，乙不随甲走；重置位置后回到初始；刷新后一致（输出 23、14；验收 1、15）", async ({page}) => {
        await open(page);
        const before = await revisionOf(page);
        await showView(page, B);
        await sample(page, B).locator("input").fill("乙的草稿");
        const beta = await instanceOf(page, B);
        const alpha = await instanceOf(page, A);
        await expect(page.locator("[data-workbench-shell]")).toHaveAttribute("data-panel-count", "4");

        await moveViaMenu(page, B, "面板");
        await expect(head(page, "panel").locator(`[data-panel-tab="view:${B}"]`)).toBeVisible();
        await expect(head(page, "sidebar").locator(`[data-panel-tab="view:${B}"]`)).toHaveCount(0);
        await tab(page, B).click();
        await expect.poll(() => instanceOf(page, B)).toEqual({...beta, location: "panel"});
        await expect(sample(page, B).locator("input")).toHaveValue("乙的草稿");

        // 甲移到挨着面板的新面板：甲单独在一块没有名字的面板里；乙留在面板里，不随甲走。
        await moveViaMenu(page, A, "新面板（挨着面板）");
        await expect(page.locator("[data-workbench-shell]")).toHaveAttribute("data-panel-count", "5");
        expect(["sidebar", "auxiliarybar", "panel", "g0"]).not.toContain(await panelOfTab(page, A));
        expect(await instanceOf(page, A)).toEqual({...alpha, location: null});
        expect(await instanceOf(page, B)).toMatchObject({location: "panel", instance: beta.instance});
        expect((await saved(page))!.revision).toBeGreaterThan(before);

        await page.reload();
        await open(page);
        await expect(head(page, "panel").locator(`[data-panel-tab="view:${B}"]`)).toBeVisible();
        expect(["sidebar", "auxiliarybar", "panel", "g0"]).not.toContain(await panelOfTab(page, A));
        await expect(page.locator("[data-workbench-shell]")).toHaveAttribute("data-panel-count", "5");

        // 重置位置：回到声明的具名面板；甲独占的无名面板随之消失。
        await moveViaMenu(page, A, "重置位置");
        await moveViaMenu(page, B, "重置位置");
        await expect(page.locator("[data-workbench-shell]")).toHaveAttribute("data-panel-count", "4");
        for (const viewId of [A, B, C]) await expect(toolEntry(page, viewId)).toHaveCount(1);
        // 初始位置的视图没有“重置位置”。
        await toolEntry(page, C).click({button: "right"});
        await expect(page.getByRole("menuitem", {name: "重置位置", exact: true})).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect.poll(async () => (await saved(page))?.doc.panels.sidebar?.tabs.map((item) => item.viewId).sort()).toEqual([A, B, C].sort());
    });

    test("键盘：焦点在活动栏条目上按菜单键打开“移动到”菜单，用键盘选一项移动（输出 23；验收 9、15）", async ({page}) => {
        await open(page);
        await toolEntry(page, C).focus();
        await toolEntry(page, C).press("ContextMenu");
        await expect(page.getByRole("menuitem", {name: "面板", exact: true})).toBeVisible();
        // 打开时焦点已在第一个可用项上：方向键移到“面板”，回车选中。
        await page.getByRole("menuitem", {name: "面板", exact: true}).focus();
        await page.keyboard.press("Enter");
        await expect(head(page, "panel").locator(`[data-panel-tab="view:${C}"]`)).toBeVisible();
    });

    test("键盘：菜单键打开的“移动到”菜单按 Escape 关闭，焦点回到打开它的条目，不落到页面上（输出 16、23）", async ({page}) => {
        await open(page);
        await toolEntry(page, C).focus();
        await toolEntry(page, C).press("ContextMenu");
        await expect(page.getByRole("menu")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(toolEntry(page, C)).toBeFocused();
    });

    test("命令面板的移动视图：先选视图、再选目标；取消任一步不写（输出 35）", async ({page}) => {
        await open(page);
        const before = await revisionOf(page);
        await runCommand(page, "移动视图");
        await pick(page, "选择要移动的视图", "样例丙");
        // 第二步打开后再取消：Escape 早于它到达会落空。
        await expect(page.getByRole("combobox", {name: "移动到"})).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("combobox")).toHaveCount(0);
        expect(await revisionOf(page)).toBe(before);

        await runCommand(page, "移动视图");
        await pick(page, "选择要移动的视图", "样例丙");
        await pickExact(page, "移动到", "右栏");
        await expect(head(page, "auxiliarybar").locator(`[data-panel-tab="view:${C}"]`)).toBeVisible();
        await expect.poll(() => revisionOf(page)).toBeGreaterThan(before);
    });

    test("命令面板的打开视图（views.md 输出 14）：选一个视图，所在的侧栏被隐藏时一并显示、激活它的标签；取消不写", async ({page}) => {
        await open(page);
        await frame(page, "sidebar", "set-part-hidden").click();
        await expect(leaf(page, "sidebar")).toHaveCount(0);
        await expect.poll(async () => (await saved(page))?.doc.panels.sidebar?.hidden).toBe(true);

        const before = await revisionOf(page);
        await runCommand(page, "打开视图");
        await expect(page.getByRole("combobox", {name: "选择要打开的视图"})).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("combobox")).toHaveCount(0);
        expect(await revisionOf(page)).toBe(before);

        await runCommand(page, "打开视图");
        await pick(page, "选择要打开的视图", "样例丙");
        await expect(leaf(page, "sidebar")).toHaveCount(1);
        await expect(tab(page, C)).toHaveCount(1);
        await expect(toolEntry(page, C)).toHaveAttribute("aria-pressed", "true");
        await expect(sample(page, C)).toBeVisible();
    });

    test("实例保留：fill 与 scroll 两种视图在切标签、移到别的面板、新面板、侧栏拖到零再展开之后，输入、滚动与焦点都还在，实例不重建（输出 14；验收 7）", async ({page}) => {
        await open(page);
        const fillScroll = sample(page, A).locator("[data-sample-scroll]");
        await sample(page, A).locator("input").fill("甲的草稿");
        await fillScroll.evaluate((element) => {
            element.scrollTop = 240;
        });
        const alpha = await instanceOf(page, A);
        // scroll 布局的视图由视图框负责滚动：滚动盒随实例一起搬动。
        const scrollerOf = (viewId: string) => page.locator(`[data-view-frame="${viewId}"] [data-view-scroller]`);
        await showView(page, B);
        await scrollerOf(B).evaluate((element) => {
            element.scrollTop = 200;
        });
        const beta = await instanceOf(page, B);

        // 切回再切走（同一面板里换标签）。
        await showView(page, A);
        await showView(page, B);
        await moveViaMenu(page, B, "面板");
        await moveViaMenu(page, B, "重置位置");
        await showView(page, A);
        await sample(page, A).locator("input").focus();
        await moveViaMenu(page, A, "新面板（挨着右栏）");
        await moveViaMenu(page, A, "重置位置");

        await showView(page, A);
        await sidebarSash(page).focus();
        await page.keyboard.press("Enter");
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(0);
        await parked(page, A);
        await page.keyboard.press("Enter");
        await expect(sample(page, A)).toBeVisible();

        expect(await instanceOf(page, A)).toEqual(alpha);
        await expect(sample(page, A).locator("input")).toHaveValue("甲的草稿");
        await expect.poll(() => fillScroll.evaluate((element) => element.scrollTop)).toBe(240);
        await showView(page, B);
        expect(await instanceOf(page, B)).toEqual(beta);
        await expect.poll(() => scrollerOf(B).evaluate((element) => element.scrollTop)).toBe(200);

        // 焦点：命令面板关闭时把焦点还给乙的输入框，随后乙被命令移到面板、再重置回来；两次搬动后焦点都还在它的输入框里。
        const input = sample(page, B).locator("input");
        await input.focus();
        await runCommand(page, "移动视图");
        await pick(page, "选择要移动的视图", "样例乙");
        await pickExact(page, "移动到", "面板");
        await expect(head(page, "panel").locator(`[data-panel-tab="view:${B}"]`)).toBeVisible();
        await expect(input).toBeFocused();
        await runCommand(page, "移动视图");
        await pick(page, "选择要移动的视图", "样例乙");
        await pick(page, "移动到", "重置位置");
        await expect(toolEntry(page, B)).toBeVisible();
        await expect(sample(page, B)).toBeVisible();
        await expect(input).toBeFocused();
        expect(await instanceOf(page, B)).toEqual(beta);
    });

    test("入口激活失败：原位显示原因与重试，标签仍在面板里；消除原因后重试，以新代次交付（views.md 验收 4；布局验收 13）", async ({page}) => {
        await open(page);
        await moveViaMenu(page, D, "面板");
        await tab(page, E).click();
        // 切标签合并着存：等它落盘再刷新，刷新后戊才是面板的活动标签。
        await expect.poll(async () => (await saved(page))?.doc.panels.panel?.active).toBe(`view:${E}`);
        await page.evaluate((key) => localStorage.setItem(key, "1"), SAMPLE_VIEWS_SWITCHES.failActivation);
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        const failed = page.locator(`[data-view-frame="${E}"]`);
        await expect(failed).toHaveAttribute("data-view-state", "entry-failed");
        await expect(failed).toContainText("样例视图入口按开关激活失败");
        // 布局项保留：丁仍在面板里（声明在，只是没有交付）。
        await expect(head(page, "panel").locator(`[data-panel-tab="view:${D}"]`)).toHaveCount(1);

        await page.evaluate((key) => localStorage.removeItem(key), SAMPLE_VIEWS_SWITCHES.failActivation);
        await failed.locator("[data-view-retry-entry]").click();
        await expect(sample(page, E)).toBeVisible();
        expect(await instanceOf(page, E)).toMatchObject({generation: "1", location: "panel"});
        await tab(page, D).click();
        await expect(sample(page, D)).toBeVisible();
    });

    test("入口停止：组件卸载、原位显示停止原因，标签仍在面板里；刷新后回到原位置（views.md 验收 4；布局验收 13）", async ({page}) => {
        await open(page);
        await moveViaMenu(page, D, "面板");
        await tab(page, D).click();
        await expect(sample(page, D)).toBeVisible();
        await runCommand(page, "停止样例视图入口");
        await expect(page.locator(`[data-view-frame="${D}"]`)).toHaveAttribute("data-view-state", "entry-stopped");
        await expect(sample(page, D)).toHaveCount(0);
        await expect(head(page, "panel").locator(`[data-panel-tab="view:${D}"]`)).toHaveCount(1);
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(sample(page, D)).toBeVisible();
        expect(await instanceOf(page, D)).toMatchObject({location: "panel"});
    });

    test("加载失败与渲染出错：各自原位给出按钮，只有对应视图换代，同面板的视图不受影响（views.md 输出 5）", async ({page}) => {
        await open(page);
        await page.evaluate(([load, render, beta, delta]) => {
            localStorage.setItem(load, beta);
            localStorage.setItem(render, delta);
        }, [SAMPLE_VIEWS_SWITCHES.failLoad, SAMPLE_VIEWS_SWITCHES.failRender, B, D] as const);
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        const omega = await instanceOf(page, E);
        const delta = page.locator(`[data-view-frame="${D}"]`);
        await expect(delta).toHaveAttribute("data-view-state", "render-failed");
        await expect(delta).toContainText("按开关渲染出错");
        await toolEntry(page, B).click();
        const beta = page.locator(`[data-view-frame="${B}"]`);
        await expect(beta).toHaveAttribute("data-view-state", "load-failed");

        await page.evaluate(([load, render]) => {
            localStorage.removeItem(load);
            localStorage.removeItem(render);
        }, [SAMPLE_VIEWS_SWITCHES.failLoad, SAMPLE_VIEWS_SWITCHES.failRender] as const);
        await beta.locator("[data-view-reload]").click();
        await expect(sample(page, B)).toBeVisible();
        expect(await instanceOf(page, B)).toMatchObject({generation: "2"});
        await toolEntry(page, A).click();
        await delta.locator("[data-view-retry-render]").click();
        await expect(sample(page, D)).toBeVisible();
        expect(await instanceOf(page, D)).toMatchObject({generation: "2"});
        expect(await instanceOf(page, E)).toEqual(omega);
    });

    test("390 × 844：无页面级横向溢出，活动栏在视口内可点，编辑组取得非负余量，放不下的面板被收走并给诊断（验收 18；输出 10）", async ({page}) => {
        await page.setViewportSize({width: 390, height: 844});
        await open(page);
        // 窄屏没有专门的呈现（w00026 t11 才有）：放不下的面板按顺序收走，只剩活动栏、编辑组与状态栏。
        await expect(page.locator("[data-workbench-shell]")).toHaveAttribute("data-layout-diagnostics", /auxiliarybar/u);
        await expect(toolEntry(page, A)).toBeVisible();
        const entryBox = (await toolEntry(page, A).boundingBox())!;
        expect(entryBox.x).toBeGreaterThanOrEqual(0);
        expect(entryBox.x + entryBox.width).toBeLessThanOrEqual(390);
        expect((await box(page, "g0")).width).toBeGreaterThanOrEqual(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        // 点被收走的面板里的视图：活动栏仍可点，页面仍不横向溢出。
        await toolEntry(page, A).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    test("活动栏、工具面板、面板头与选中标记的颜色取主题 token 的解析值；面板头、标签带与活动栏不画外框、圆角与底线；nbook 是卡片外壳、macos 平铺，工具面板之间的线按主题（输出 19；验收 16）", async ({page}) => {
        await open(page);
        // 按钮的颜色有过渡：等过渡走完，没有对不上的项为止。
        const mismatches = () => page.evaluate(() => {
            const read = (selector: string, pairs: Readonly<Record<string, string>>) => {
                const element = document.querySelector(selector)!;
                const probe = document.createElement("div");
                probe.style.cssText = Object.entries(pairs).map(([property, token]) => `${property}: var(${token}); border-style: solid`).join("; ");
                element.append(probe);
                const own = getComputedStyle(element);
                const expected = getComputedStyle(probe);
                const result = Object.keys(pairs).map((property) => ({selector, property, own: own.getPropertyValue(property), token: expected.getPropertyValue(property)}));
                probe.remove();
                return result;
            };
            return [
                ...read(".workbench-tool-strip", {"background-color": "--panel-surface"}),
                ...read(".workbench-tool-strip__item--active", {"color": "--accent-text", "background-color": "--bg-hover"}),
                ...read('[data-shell-card="sidebar"]', {"background-color": "--panel-surface"}),
                // 当前标签用正文色（输出 19）。字重不断言：nb-ui 的 Tabs 所有标签同一字重，规格写的“加粗”见报告。
                ...read('[data-panel-head="panel"] [role="tab"][aria-selected="true"]', {"color": "--text-main"}),
            ].filter((item) => item.own !== item.token);
        });
        await expect.poll(mismatches).toEqual([]);
        const drawn = await page.evaluate(() => [".workbench-tool-strip", '[data-panel-head="sidebar"]', '[data-panel-head="auxiliarybar"]', '[data-panel-head="panel"] [role="tablist"]', '[data-panel-head="panel"] [role="tablist"]'].flatMap((selector) => {
            const style = getComputedStyle(document.querySelector(selector)!);
            const widths = ["top", "right", "bottom", "left"].map((side) => style.getPropertyValue(`border-${side}-width`));
            return widths.some((width) => width !== "0px") || style.borderRadius !== "0px" ? [{selector, widths, radius: style.borderRadius}] : [];
        }));
        expect(drawn).toEqual([]);

        // 外壳的分隔方式：卡片的矩形、圆角与相连处，标题栏底线与网格接缝的颜色。
        const shellLook = () => page.evaluate(() => {
            const card = (part: string) => document.querySelector(`[data-shell-card="${part}"]`)!;
            const rect = (part: string) => card(part).getBoundingClientRect();
            const probe = document.createElement("div");
            probe.style.backgroundColor = "var(--divider)";
            document.body.append(probe);
            const divider = getComputedStyle(probe).backgroundColor;
            probe.remove();
            // `data-workbench-titlebar` 此刻同时在外壳的槽和标题栏的 header 上：量 header，它才画底线。
            return {
                titlebarBottom: document.querySelector("header[data-workbench-titlebar]")!.getBoundingClientRect().bottom,
                activitybar: rect("activitybar").toJSON() as DOMRect,
                sidebar: rect("sidebar").toJSON() as DOMRect,
                editor: rect("g0").toJSON() as DOMRect,
                editorRadius: getComputedStyle(card("g0")).borderTopLeftRadius,
                activityCorners: [getComputedStyle(card("activitybar")).borderTopLeftRadius, getComputedStyle(card("activitybar")).borderTopRightRadius],
                sidebarCorners: [getComputedStyle(card("sidebar")).borderTopLeftRadius, getComputedStyle(card("sidebar")).borderTopRightRadius],
                joinLine: getComputedStyle(card("activitybar"), "::after").backgroundColor,
                titlebarLine: getComputedStyle(document.querySelector("header[data-workbench-titlebar]")!).borderBottomColor,
                // 工具面板之间的线单算（下面）；其余边界的接缝颜色。
                seams: [...new Set([...document.querySelectorAll("[data-workbench-shell] .sash-seam")].filter((seam) => seam.closest('[data-sash-kind="panes"]') === null).map((seam) => getComputedStyle(seam).backgroundColor))],
                divider,
            };
        });
        // 工具面板之间的线：丙移到挨着侧栏的新面板，侧栏与它之间是一条工具面板之间的线（取 `--shell-pane-divider`）。
        const paneSeams = () => page.evaluate(() => [...document.querySelectorAll('[data-sash-kind="panes"]')].map((sash) => {
            const seam = sash.querySelector(".sash-seam")!;
            const style = getComputedStyle(seam);
            const [start, end] = (seam as HTMLElement).dataset.axis === "width" ? [style.top, style.bottom] : [style.left, style.right];
            return {color: style.backgroundColor, start, end};
        }));
        const nbook = await shellLook();
        expect(nbook.editorRadius).toBe("12px");
        expect(nbook.activityCorners).toEqual(["12px", "0px"]);
        expect(nbook.sidebarCorners).toEqual(["0px", "12px"]);
        expect(nbook.activitybar.left).toBeCloseTo(4, 0);
        expect(nbook.activitybar.width).toBeCloseTo(48, 0);
        expect(nbook.activitybar.top - nbook.titlebarBottom).toBeCloseTo(4, 0);
        expect(nbook.sidebar.left).toBeCloseTo(nbook.activitybar.right, 1);
        expect(nbook.editor.left - nbook.sidebar.right).toBeCloseTo(4, 0);
        expect(nbook.joinLine).toBe(nbook.divider);
        expect(nbook.titlebarLine).toBe("rgba(0, 0, 0, 0)");
        expect(nbook.seams).toEqual(["rgba(0, 0, 0, 0)"]);

        await moveViaMenu(page, C, "新面板（挨着侧栏）");
        await expect.poll(paneSeams).toEqual([{color: nbook.divider, start: "10px", end: "10px"}]);

        const settings = join(tmp, "state", "settings.json");
        try {
            await writeFile(settings, JSON.stringify({"nbook.workbench/theme": "macos"}));
            await expect(page.locator("html")).toHaveAttribute("data-nb-theme", "macos");
            const macos = await shellLook();
            expect(macos.editorRadius).toBe("0px");
            expect(macos.activitybar.left).toBe(0);
            expect(macos.activitybar.width).toBe(48);
            expect(macos.activitybar.top).toBe(macos.titlebarBottom);
            expect(macos.sidebar.left).toBe(macos.activitybar.right);
            expect(macos.editor.left - macos.sidebar.right).toBe(1);
            expect(macos.joinLine).toBe("rgba(0, 0, 0, 0)");
            expect(macos.titlebarLine).toBe(macos.divider);
            expect(macos.seams).toEqual([macos.divider]);
            await expect.poll(paneSeams).toEqual([{color: macos.divider, start: "0px", end: "0px"}]);
        } finally {
            await rm(settings, {force: true});
        }
    });

    test("拖动边界的悬停线取主题 token：nbook 是 3px 实线、不发光、自由端缩进 16px，交汇处两条同时亮时连着，线芯设细时对齐接缝；macos 是贴满的 3px 实线（输出 19）", async ({page}) => {
        await open(page);
        const sidebarLine = sidebarSash(page);
        const panelLine = page.getByRole("separator", {name: "调整 g0 与 panel 的高度"});
        await expect(sidebarLine).toBeVisible();
        await expect(panelLine).toBeVisible();
        // 线盒沿长轴的两端（相对分隔盒）与线芯：线芯的位置按线盒加 ::before 的偏移算，与静止接缝比。
        const lineOf = (sash: typeof sidebarLine) => sash.evaluate((element) => {
            const line = element.querySelector<HTMLElement>(".sash-line")!;
            const seam = element.querySelector<HTMLElement>(".sash-seam")!.getBoundingClientRect();
            const rect = line.getBoundingClientRect();
            const style = getComputedStyle(line);
            const core = getComputedStyle(line, "::before");
            const vertical = line.dataset.axis === "width";
            return {
                ends: vertical ? [style.top, style.bottom] : [style.left, style.right],
                coreSize: vertical ? core.width : core.height,
                coreAtSeam: vertical ? rect.left + Number.parseFloat(core.left) - seam.left : rect.top + Number.parseFloat(core.top) - seam.top,
                glow: core.boxShadow !== "none",
            };
        });
        const centre = async (locator: typeof sidebarLine) => {
            const found = (await locator.boundingBox())!;
            return {x: found.x + found.width / 2, y: found.y + found.height / 2};
        };

        // 只悬停竖线（离交汇处远）：停够时长亮起，两端都是自由端
        const vertical = await centre(sidebarLine);
        const horizontal = await centre(panelLine);
        await page.mouse.move(vertical.x, (await sidebarLine.boundingBox())!.y + 120);
        await expect(sidebarLine).toHaveAttribute("data-sash-revealed", "true");
        expect(await lineOf(sidebarLine)).toMatchObject({ends: ["16px", "16px"], coreSize: "3px", glow: false});
        // 主题把线芯设细时，细线芯对齐静止接缝（不在 3px 装饰带里居中，否则摊成两条半透明的线）
        await page.evaluate(() => document.documentElement.style.setProperty("--sash-line-size", "1px"));
        await page.setViewportSize({width: 1441, height: 900});
        await expect.poll(async () => (await lineOf(sidebarLine)).coreSize).toBe("1px");
        expect((await lineOf(sidebarLine)).coreAtSeam).toBeCloseTo(0, 3);
        await page.evaluate(() => document.documentElement.style.removeProperty("--sash-line-size"));
        await page.setViewportSize({width: 1440, height: 900});

        // 交汇处按下：两条一起亮，横线挨着竖线的左端连着，右端仍缩进
        await page.mouse.move(vertical.x, horizontal.y);
        await page.mouse.down();
        await expect(panelLine).toHaveAttribute("data-sash-active", "true");
        await expect(sidebarLine).toHaveAttribute("data-sash-active", "true");
        expect((await lineOf(panelLine)).ends).toEqual(["0px", "16px"]);
        await page.mouse.up();

        const settings = join(tmp, "state", "settings.json");
        try {
            await writeFile(settings, JSON.stringify({"nbook.workbench/theme": "macos"}));
            await expect(page.locator("html")).toHaveAttribute("data-nb-theme", "macos");
            await page.mouse.move(vertical.x, (await sidebarLine.boundingBox())!.y + 160);
            await expect(sidebarLine).toHaveAttribute("data-sash-revealed", "true");
            const macos = await lineOf(sidebarLine);
            expect(macos.ends).toEqual(["0px", "0px"]);
            expect(macos.coreSize).toBe("3px");
            expect(macos.glow).toBe(false);
        } finally {
            await rm(settings, {force: true});
        }
    });

    test("面板标签带变窄时逐级让位：完整 → 截断 → 选中的留标题其余只留图标 → 收进“更多”，选中的始终带标题；从“更多”选中后它回到标签带（输出 20；验收 15）", async ({page}) => {
        await open(page);
        // 面板里三个标签：戊、己（长标题）与从右栏移来的丁
        await moveViaMenu(page, D, "面板");
        const band = page.locator('[data-panel-head="panel"] [data-tabs-level]');
        const level = () => band.getAttribute("data-tabs-level");
        const tabs = page.locator('[data-panel-head="panel"] [role="tab"]');
        const selectedTab = page.locator('[data-panel-head="panel"] [role="tab"][aria-selected="true"]');
        await expect(tabs).toHaveCount(3);
        const seen = new Set<string>();
        for (const width of [1920, 1440, 1000, 900, 860, 800, 760, 700, 640, 600]) {
            await page.setViewportSize({width, height: 900});
            await expect.poll(async () => (await band.boundingBox())?.width ?? 0).toBeGreaterThan(0);
            const current = (await level())!;
            seen.add(current);
            // 选中的始终带标题
            expect((await selectedTab.innerText()).trim().length).toBeGreaterThan(0);
            if (current === "3") {
                const more = page.locator('[data-panel-head="panel"] [data-tabs-more]');
                await expect(more).toBeVisible();
                const shown = await tabs.count();
                await expect(more).toContainText(`更多 ${String(3 - shown)}`);
            }
        }
        expect([...seen].sort()).toEqual(["0", "1", "2", "3"]);
        // 最窄时键盘移到收起来的标签：它被选中、换到标签带里，焦点落在它身上
        await selectedTab.focus();
        for (const key of ["Home", "End"]) {
            const before = await selectedTab.getAttribute("data-panel-tab");
            await page.keyboard.press(key);
            await expect(selectedTab).not.toHaveAttribute("data-panel-tab", before!);
            await expect(selectedTab).toBeFocused();
        }
        // 最窄时从“更多”选一个收起来的：它被选中，回到标签带（收起来的换成别的）
        await page.locator('[data-panel-head="panel"] [data-tabs-more]').click();
        const hiddenOne = page.getByRole("menu").getByRole("menuitem").first();
        const name = (await hiddenOne.innerText()).trim();
        await hiddenOne.click();
        await expect(selectedTab).toContainText(name.slice(0, 2));
    });

    test("活动栏放不下时，末尾的条目收进底部的“更多”，有效可见的总在外面；从“更多”选中后它回到活动栏（输出 22；验收 14）", async ({page}) => {
        await open(page);
        // 活动栏只列侧栏这一列：把另外三个视图也搬进侧栏，凑够六个条目。
        for (const viewId of [D, E, F]) await moveViaMenu(page, viewId, "侧栏");
        const entries = page.locator("[data-tool-entry]");
        await expect(entries).toHaveCount(6);
        await expect(page.locator("[data-tool-more]")).toHaveCount(0);
        // 侧栏里当前的视图（最后搬进来的己）按下，其余没有。
        const pressed = page.locator('[data-tool-entry][aria-pressed="true"]');
        await expect(pressed).toHaveCount(1);
        const current = (await pressed.getAttribute("data-tool-entry"))!;
        // 340 高：活动栏放得下三个条目加“更多”，有效可见的那一个在外面，其余收进去。
        await page.setViewportSize({width: 1440, height: 340});
        const more = page.locator("[data-tool-more]");
        await expect(more).toBeVisible();
        await expect.poll(() => entries.count()).toBeLessThan(6);
        const shown = await entries.count();
        await expect(toolEntry(page, current)).toBeVisible();
        // 条目与“更多”都在活动栏里，不滚动
        const strip = await page.locator(".workbench-tool-strip__entries").evaluate((element) => ({scroll: element.scrollHeight, client: element.clientHeight}));
        expect(strip.scroll).toBeLessThanOrEqual(strip.client);
        await more.click();
        const menu = page.getByRole("menu").getByRole("menuitem");
        await expect(menu).toHaveCount(6 - shown);
        const picked = (await menu.last().innerText()).trim();
        await menu.last().click();
        // 选中的视图显示出来，按下，回到活动栏外面一层。
        const entry = page.locator("[data-tool-entry]").and(page.getByRole("button", {name: picked, exact: true}));
        await expect(entry).toHaveAttribute("aria-pressed", "true");
    });

    test("focusedPart：焦点进到侧栏、面板时随之变化，焦点移到外壳之外的命令面板时保持（输出 36）", async ({page}) => {
        await open(page);
        const focused = (viewId: string) => sample(page, viewId).getAttribute("data-focused-part");
        await sample(page, A).locator("input").focus();
        await expect.poll(() => focused(A)).toBe("ready:sidebar");
        await sample(page, E).locator("input").focus();
        await expect.poll(() => focused(E)).toBe("ready:panel");
        await expect(async () => {
            await page.keyboard.press("Control+Shift+P");
            await expect(page.getByRole("combobox")).toBeFocused({timeout: 500});
        }).toPass();
        expect(await focused(E)).toBe("ready:panel");
        await page.keyboard.press("Escape");
    });

    test("标签带：Alt 加方向键换一位，活动标签不变，焦点还在它上面；到头了不动（输出 20）", async ({page}) => {
        await open(page);
        const order = (): Promise<string[]> => head(page, "panel").locator("[data-panel-tab]").evaluateAll((elements) => elements.map((element) => (element as HTMLElement).dataset.panelTab ?? ""));
        const before = await order();
        expect(before.length).toBeGreaterThan(1);
        const first = before[0]!;
        const firstTab = page.locator(`[data-panel-head="panel"] [data-panel-tab="${first}"]`);
        await firstTab.click();
        await firstTab.focus();
        await page.keyboard.press("Alt+ArrowLeft");
        expect(await order()).toEqual(before);
        await page.keyboard.press("Alt+ArrowRight");
        await expect.poll(order).toEqual([before[1]!, first, ...before.slice(2)]);
        await expect(firstTab).toBeFocused();
        await expect(firstTab).toHaveAttribute("aria-selected", "true");
    });

    test("标签带：标签与内容互相关联；长标题标签与三个框架按钮在 840 宽下都完整可点；方向键切换面板的标签（输出 20）", async ({page}) => {
        await page.setViewportSize({width: 840, height: 900});
        await open(page);
        const omega = page.getByRole("tab", {name: "样例戊"});
        const panelId = await omega.getAttribute("aria-controls");
        expect(panelId).not.toBeNull();
        // 标签在面板头（外框里），它控制的内容在内容层：两边靠 DOM id 对上。
        const content = page.locator(`[id="${panelId!}"]`);
        await expect(content).toHaveAttribute("role", "tabpanel");
        await expect(content).toHaveAttribute("aria-labelledby", (await omega.getAttribute("id"))!);
        // 每个可点的东西：中心点命中的就是它自己。
        const hitsItself = (selector: string) => page.locator(selector).first().evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return rect.width > 0 && hit !== null && (hit === element || element.contains(hit));
        });
        await expect.poll(() => hitsItself(`[data-panel-head="panel"] [data-panel-tab="view:${E}"]`)).toBe(true);
        for (const action of ["set-panel-collapsed", "toggle-panel-maximized", "set-part-hidden"]) {
            expect(await hitsItself(`[data-panel-head="panel"] [data-panel-action="nbook.view.${action}"]`), action).toBe(true);
        }
        expect(await omega.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(0);
        await omega.focus();
        await page.keyboard.press("ArrowRight");
        await expect(page.getByRole("tab", {name: /^样例己/u})).toBeFocused();
        await expect(sample(page, F)).toBeVisible();
        await expect(sample(page, E)).toHaveAttribute("data-visible", "false");
    });

    test("390 × 260：放不下被收走的面板里，视图内容停放：不进 Tab 顺序、visible 为假，外壳根给出诊断；空间回来时实例不变（输出 10、16、17；验收 6、7）", async ({page}) => {
        await open(page);
        const alpha = await instanceOf(page, A);
        await page.setViewportSize({width: 390, height: 260});
        await expect(page.locator("[data-workbench-shell]")).toHaveAttribute("data-layout-diagnostics", /sidebar/u);
        await expect(page.locator(`[data-view-frame="${A}"]`)).toHaveCount(1);
        await parked(page, A);
        await expect.poll(() => sample(page, A).getAttribute("data-visible")).toBe("false");
        // 从状态栏一路 Tab：焦点不会落进停放的样例输入。
        await page.locator("[data-shell-focus-target=\"panel-toggle\"]").focus();
        for (let step = 0; step < 30; step += 1) {
            await page.keyboard.press("Tab");
            expect(await page.evaluate(() => document.activeElement?.closest("[inert]") ?? null)).toBeNull();
        }
        await page.setViewportSize({width: 1440, height: 900});
        await expect.poll(() => sample(page, A).getAttribute("data-visible")).toBe("true");
        expect(await instanceOf(page, A)).toEqual(alpha);
    });

    test("“移动到”菜单打开时视图换代（渲染出错后重试）：菜单关闭，旧点击无从发生（输出 23；验收 15）", async ({page}) => {
        await open(page);
        await page.evaluate(([render, delta]) => localStorage.setItem(render, delta), [SAMPLE_VIEWS_SWITCHES.failRender, D] as const);
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        const failed = page.locator(`[data-view-frame="${D}"]`);
        await expect(failed).toHaveAttribute("data-view-state", "render-failed");
        await page.evaluate((render) => localStorage.removeItem(render), SAMPLE_VIEWS_SWITCHES.failRender);
        const before = await revisionOf(page);
        await tab(page, D).click({button: "right"});
        await expect(page.getByRole("menu")).toBeVisible();
        // 菜单开着时经页面重试（不移开焦点、不关菜单的 DOM 点击）。
        await failed.locator("[data-view-retry-render]").evaluate((element) => (element as HTMLButtonElement).click());
        await expect(sample(page, D)).toBeVisible();
        await expect(page.getByRole("menu")).toHaveCount(0);
        expect(await revisionOf(page)).toBe(before);
    });
});

test.describe("产品页：别的插件给视图贡献的标题动作（docs/specs/workbench/views.md 输出 10、11，验收 8）", () => {
    let tmp = "";
    let server: ProbeServer;

    test.beforeAll(async () => {
        tmp = await createTestTmpRoot("neuro-book-e2e", "workbench-view-title");
        await mkdir(join(tmp, "state"), {recursive: true});
        // `test.menus` 往样例视图丙贡献按钮与“⋯”里的项；菜单项 id 归它，视图 id 归 `test.sample-views`。
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views,test.menus", NBOOK_EXCLUDE_PLUGINS: "nbook.explorer,nbook.editor,nbook.agent"}});
    });

    test.afterAll(async () => {
        expect(await server.stop()).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 1440, height: 900}});

    test("视图自己的按钮在前、贡献的在后；“⋯”里自己的 menu 动作在前、分隔线后是贡献的；贡献项执行时收到固定参数或这个视图实例（输出 20）", async ({page}) => {
        await page.goto(new URL("/workbench", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await toolEntry(page, C).click();
        await expect(sample(page, C)).toBeVisible();
        const actions = head(page, "sidebar");
        // 丙自己的动作收进了“⋯”，所以面板头里的按钮只有贡献的那一个，后面是“⋯”。
        await expect(actions.locator("[data-title-action-key]")).toHaveCount(1);
        const button = actions.locator('[data-title-action-key="test.menus.view-button"]');
        await expect(button).toHaveAttribute("aria-label", "测试按钮");
        const order = await actions.locator("[data-title-action-key], [data-title-actions-more]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-title-action-key") ?? "more"));
        expect(order).toEqual(["test.menus.view-button", "more"]);

        await actions.locator("[data-title-actions-more]").click();
        const menu = page.getByRole("menu");
        await expect(menu).toBeVisible();
        expect(await menu.locator('[role^="menuitem"], [role="separator"]').evaluateAll((nodes) => nodes.map((node) => (node.getAttribute("role") === "separator" ? "---" : (node.textContent ?? "").trim())))).toEqual(["样例的菜单动作", "---", "测试菜单项"]);
        await menu.getByRole("menuitem", {name: "测试菜单项"}).click();
        await expect(page.getByText(`收到 ${JSON.stringify({viewId: C, generation: Number(await sample(page, C).getAttribute("data-generation"))})}`)).toBeVisible();

        await button.click();
        await expect(page.getByText(`收到 ${JSON.stringify({from: "view-button"})}`)).toBeVisible();
    });
});
