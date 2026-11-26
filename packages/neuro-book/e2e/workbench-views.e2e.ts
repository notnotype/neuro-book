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
import {panelRef} from "@notnotype/nb-workbench-layout";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {SAMPLE_VIEWS_RUN_EVENT, SAMPLE_VIEWS_SWITCHES} from "nbook/shared/testing/sample-views-contract";

import {CLIENT_IDENTITY_KEY} from "nbook/web/host/client-identity";

import {startProbeServer} from "./fixtures";
import {pressEntry} from "./support/press-entry";
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
/** 区域隐藏了：按拖到零画（ui/workbench-layout 输出 11），那块外框还在、缩到面积为零。等到零也就等过渡走完了。 */
const shrunk = (page: Page, id: string) => expect.poll(async () => {
    const found = await leaf(page, id).boundingBox();
    return found === null ? 0 : Math.round(found.width * found.height);
}).toBe(0);

async function box(page: Page, id: string): Promise<Box> {
    const found = await leaf(page, id).boundingBox();
    if (found === null) throw new Error(`没有 ${id} 的外框`);
    return found;
}

const sample = (page: Page, viewId: string) => page.locator(`[data-sample-view="${viewId}"]`);
const head = (page: Page, panel: string) => page.locator(`[data-panel-head="${panel}"]`);
/**
 * 视图的标题：头上的标题按钮。底部面板并成一行时头不写标题，按下的入口就是它的标题（右键开“移动到”、拖它就是拖这个视图，
 * docs/specs/ui/workbench-layout.md 输出 47）；只在没有标题按钮时取到它。
 */
const tab = (page: Page, viewId: string) => page.locator(`[data-panel-tab="view:${viewId}"], [data-region-strip="panel"] [data-tool-view="${viewId}"][aria-pressed="true"]`);
/** 视图所在分节的面板头：区域的锚不进呈现树，分节的头只写它那个视图的标题（输出 20、40），所以按视图找。 */
/** 视图所在分节的面板头：头里有它的标题；底部面板并成一行时头不写标题，是按下的入口是它的那条入口条里并进来的头（输出 47）。 */
const headOf = (page: Page, viewId: string) => page.locator(`[data-panel-head]:has([data-panel-tab="view:${viewId}"]), [data-region-strip="panel"]:has([data-tool-view="${viewId}"][aria-pressed="true"]) [data-panel-head]`);
/**
 * 活动栏里视图自己那个容器的入口（输出 22、41）：样例视图都没写容器，各是自己的隐式容器 `view:<视图 id>`。视图并进别的容器后
 * 这个容器没有成员，入口也就没有了。
 */
/** 活动栏里只含这个视图的入口；右栏、底部面板入口条上的入口也带 `data-tool-entry`，限定到活动栏上段。 */
const toolEntry = (page: Page, viewId: string) => page.locator(`[data-rail=sidebar] [data-tool-band] [data-tool-entry="view:${viewId}"]`);

const frame = (page: Page, panel: string, command: string) => head(page, panel).locator(`[data-panel-action="nbook.view.${command}"]`);
const frameOf = (page: Page, viewId: string, command: string) => headOf(page, viewId).locator(`[data-panel-action="nbook.view.${command}"]`);
/**
 * 区域挨着编辑区的那条边界。分隔线的名称里是两侧节点的 id：区域这一侧显示一个分节时是那个分节，显示几个时是区域的分支，
 * 所以只认编辑区那一侧。
 */
const sidebarSash = (page: Page) => page.getByRole("separator", {name: /^调整 \S+ 与 center 的宽度$/u});
const auxiliarySash = (page: Page) => page.getByRole("separator", {name: /^调整 center 与 \S+ 的宽度$/u});
const panelSash = (page: Page) => page.getByRole("separator", {name: /^调整 g0 与 \S+ 的高度$/u});

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

/** 容器的标题是视图的标题，也是第一步候选的名字，过滤不一定收敛到一项：按完整名称点那一项。 */
async function pickExact(page: Page, placeholder: string, label: string): Promise<void> {
    await expect(page.getByRole("combobox", {name: placeholder})).toBeFocused();
    await page.getByRole("option", {name: label, exact: true}).click();
}

/**
 * 让侧栏里视图自己的容器成为当前容器并可见：不是当前容器的分节不显示、没有标题 DOM（输出 42），切换点活动栏的入口；已经是
 * 当前容器再点入口是隐藏侧栏（输出 22），所以先看按下态。
 */
async function showView(page: Page, viewId: string): Promise<void> {
    const entry = toolEntry(page, viewId);
    if (await entry.getAttribute("aria-pressed") !== "true") await pressEntry(page, entry);
    await expect(entry).toHaveAttribute("aria-pressed", "true");
}

/**
 * 右键视图所在分节的标题，在菜单里选目标：移动视图的入口（输出 23），目标名是容器的标题（隐式容器写它的视图标题）、
 * “新容器（某区域）”、“浮动”或“重置位置”。
 * 活动栏入口的右键菜单是容器的（输出 44），不是视图的。视图自己的容器在侧栏、不是当前容器时分节没有标题 DOM，先切过去。
 */
async function moveViaMenu(page: Page, viewId: string, target: string): Promise<void> {
    if (await toolEntry(page, viewId).count() > 0) await showView(page, viewId);
    await tab(page, viewId).click({button: "right"});
    await page.getByRole("menuitem", {name: target, exact: true}).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
}

async function instanceOf(page: Page, viewId: string): Promise<{instance: string | null; generation: string | null; location: string | null}> {
    return sample(page, viewId).evaluate((element) => ({instance: element.getAttribute("data-instance"), generation: element.getAttribute("data-generation"), location: element.getAttribute("data-location")}));
}

/** 标签所在面板的 id（面板头上写着）。分节的 id 是布局起的（输出 40），要用它时按视图取。 */
const panelOfTab = async (page: Page, viewId: string): Promise<string> => (await headOf(page, viewId).getAttribute("data-panel-head"))!;

/**
 * 搭一个三个标签的浮动窗（戊、丁、己，按这个先后）并返回它的面板 id。区域里的分节只写标题，带标签条的只剩浮动窗（输出 20、39）：
 * 标签带的用例在它上面测。戊经“移动到”的“浮动”出来，丁、己的标题拖到窗的正文上是添加为标签（输出 25 第 0 行）。
 */
async function floatWithTabs(page: Page): Promise<string> {
    await moveViaMenu(page, E, "浮动");
    const window = page.locator(`${LEAF}[data-float]`);
    await expect(window).toHaveCount(1);
    for (const viewId of [D, F]) {
        const target = await window.boundingBox();
        const from = await tab(page, viewId).boundingBox();
        if (target === null || from === null) throw new Error("没有浮动窗或标题");
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, {steps: 2});
        await page.mouse.move(target.x + target.width / 2, target.y + target.height * 0.6, {steps: 8});
        await page.mouse.up();
        await expect(page.locator("[data-workbench-drag-ghost]")).toHaveCount(0);
    }
    const id = await panelOfTab(page, E);
    await expect(head(page, id).locator("[data-panel-tab]")).toHaveCount(3);
    return id;
}

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
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views", NBOOK_EXCLUDE_PLUGINS: "nbook.explorer,nbook.editor,nbook.agent,nbook.bots,nbook.canon,nbook.plot"}});
    });

    test.afterAll(async () => {
        expect(await server.stop()).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 1440, height: 900}});

    const userDatabase = (): string => join(tmp, "state", "storage", "user.sqlite");

    /** 记录里用到的字段。区域的锚没有标签，记着当前容器；分节记着它归哪个容器（输出 40）。 */
    interface SavedDoc {
        readonly panels: Readonly<Record<string, {readonly tabs: ReadonlyArray<{readonly kind: string; readonly viewId?: string}>; readonly active: string | null; readonly hidden?: boolean; readonly collapsed?: boolean; readonly container?: string; readonly activeContainer?: string; readonly entries?: ReadonlyArray<string>}>>;
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
        const aux = await panelOfTab(page, D);
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
        await expect.poll(async () => (await box(page, aux)).width).toBe(0);
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
        const side = await panelOfTab(page, A);
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
        await expect(page.locator(`[data-shell-card="${side}"]`)).toHaveAttribute("data-shell-join", "end");
        await page.mouse.up();
        await expect(activitybar).toHaveAttribute("data-shell-join", "start");
    });

    test("活动栏收起侧栏同拖到零：留着能拉开的边界；底部面板开着时，从活动栏、编辑区、面板的交汇处斜着拖，两条边界一起动，拉开时内容就出现，隐藏清掉（输出 11、12）", async ({page}) => {
        await open(page);
        const side = await panelOfTab(page, A);
        const vertical = sidebarSash(page);
        const horizontal = panelSash(page);
        await pressEntry(page, toolEntry(page, A));
        await expect.poll(async () => (await saved(page))?.doc.panels.sidebar?.hidden).toBe(true);
        await expect.poll(async () => (await box(page, side)).width).toBe(0);
        await expect(toolEntry(page, A)).not.toHaveAttribute("aria-pressed", "true");

        const line = await vertical.boundingBox();
        const row = await horizontal.boundingBox();
        if (line === null || row === null) throw new Error("侧栏隐藏后没有边界");
        const at = {x: line.x + line.width / 2, y: row.y + row.height / 2};
        await page.mouse.move(at.x, at.y);
        await page.mouse.down();
        await expect(vertical).toHaveAttribute("data-sash-active", "true");
        await expect(horizontal).toHaveAttribute("data-sash-active", "true");
        await page.mouse.move(at.x + 260, at.y - 80, {steps: 10});
        // 松手前内容就出现，入口跟着按下（输出 12、22）。
        await expect(sample(page, A)).toBeVisible();
        await page.mouse.up();
        await expect.poll(async () => (await box(page, side)).width).toBeGreaterThan(200);
        await expect.poll(async () => (await horizontal.boundingBox())?.y ?? 0).toBeLessThan(row.y - 60);
        await expect.poll(async () => (await saved(page))?.doc.panels.sidebar?.hidden).toBeUndefined();
        await expect(toolEntry(page, A)).toHaveAttribute("aria-pressed", "true");
    });

    test("面板头的动作与滚动条随鼠标显示：鼠标在外时动作透明、没有滑块、内容不让宽；移入、Tab 进入或菜单开着时动作可见；拖滑块按比例滚动（输出 20；views.md 验收 9）", async ({page}) => {
        await open(page);
        await showView(page, C);
        const view = page.locator(`[data-view-frame="${C}"]`);
        const scroller = view.locator("[data-view-scroller]");
        const bar = view.locator("[data-overlay-scrollbar]");
        // 丙自己声明了一个收进“⋯”的动作：面板头里的动作区只有“⋯”。
        const actions = headOf(page, C).locator("[data-hover-actions=\"\"]");
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
        await expect(page.locator("[data-rail=sidebar] [data-tool-band] [data-tool-entry]")).toHaveCount(3);
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
        await frameOf(page, E, "toggle-panel-maximized").click();
        await expect(area).toHaveAttribute("data-visible", "false");
        await frameOf(page, E, "toggle-panel-maximized").click();
        await expect(area).toHaveAttribute("data-visible", "true");
        expect(await area.getAttribute("data-instance")).toBe(instance);
    });

    test("活动栏：点不是当前容器的入口切到它；点当前容器的入口隐藏侧栏（不看焦点在哪），再点展开；按下态是当前容器且侧栏可见，至多一项；拖到零时点入口展开（输出 22、42；验收 14）", async ({page}) => {
        await open(page);
        const pressed = page.locator('[data-rail=sidebar] [data-tool-band] [data-tool-entry][aria-pressed="true"]');
        // 侧栏的三个样例视图各是自己的容器：一个容器一项，只有当前容器的那一项按下。
        await expect(toolEntry(page, A)).toHaveAttribute("aria-pressed", "true");
        await expect(pressed).toHaveCount(1);

        // 不是当前容器：切到它。原来那个容器的分节不显示，内容停放、不卸载（输出 42）。
        await sample(page, A).locator("input").focus();
        await pressEntry(page, toolEntry(page, B));
        await expect(toolEntry(page, B)).toHaveAttribute("aria-pressed", "true");
        await expect(pressed).toHaveCount(1);
        await expect(sample(page, B)).toBeVisible();
        await expect(sample(page, A)).toHaveAttribute("data-visible", "false");
        await parked(page, A);
        await expect(tab(page, A)).toHaveCount(0);
        const section = await panelOfTab(page, B);
        const width = (await box(page, section)).width;
        // 入口是拖动源，指针按下不取焦点：焦点原来在被切走的甲里，交给新容器的第一个分节（输出 42）。
        await expect.poll(() => focusedPanelOf(page)).toBe(section);

        // 当前容器、侧栏可见：隐藏侧栏。没有按下的入口了；焦点所在的分节看不见了，移到它那个容器的入口（输出 16）。
        await pressEntry(page, toolEntry(page, B));
        // 隐藏按拖到零画（输出 11）：那块还在，宽度为零。
        await expect.poll(async () => (await box(page, section)).width).toBe(0);
        await expect(pressed).toHaveCount(0);
        await expect(toolEntry(page, B)).toBeFocused();
        await expect.poll(async () => (await saved(page))?.doc.panels.sidebar).toMatchObject({hidden: true, activeContainer: `view:${B}`});
        // 隐藏之后点它：显示回来，宽度是原来的。
        await pressEntry(page, toolEntry(page, B));
        await expect(sample(page, B)).toBeVisible();
        await expect(toolEntry(page, B)).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => Math.round((await box(page, section)).width)).toBe(Math.round(width));
        // 焦点留在原处（输出 42）：不被显示出来的分节抢走。
        await expect(toolEntry(page, B)).toBeFocused();

        // 可见但焦点不在里面：照样是隐藏，没有“先聚焦”这一步。
        await sample(page, E).locator("input").focus();
        await expect.poll(() => focusedPanelOf(page)).toBe(await panelOfTab(page, E));
        await pressEntry(page, toolEntry(page, B));
        await expect.poll(async () => (await box(page, section)).width).toBe(0);
        // 侧栏隐藏着点另一个入口：切过去，同一次写入把侧栏显示出来。
        await pressEntry(page, toolEntry(page, A));
        await expect(sample(page, A)).toBeVisible();
        await expect(toolEntry(page, A)).toHaveAttribute("aria-pressed", "true");
        await expect(pressed).toHaveCount(1);
        await expect.poll(async () => (await saved(page))?.doc.panels.sidebar).toMatchObject({activeContainer: `view:${A}`});
        expect((await saved(page))?.doc.panels.sidebar?.hidden ?? false).toBe(false);
        await pressEntry(page, toolEntry(page, B));
        await expect(sample(page, B)).toBeVisible();

        // 拖到零：内容停放，没有按下的入口；点当前容器的入口是展开，不是隐藏。
        const toZero = async (): Promise<void> => {
            await sidebarSash(page).focus();
            await page.keyboard.press("Enter");
            await expect.poll(async () => (await box(page, section)).width).toBe(0);
            await expect(pressed).toHaveCount(0);
        };
        await toZero();
        await parked(page, B);
        await pressEntry(page, toolEntry(page, B));
        await expect(sample(page, B)).toBeVisible();
        await expect(toolEntry(page, B)).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => Math.round((await box(page, section)).width)).toBe(Math.round(width));
        // 拖到零时点另一个入口：切过去并展开，宽度是原来的。
        await toZero();
        await pressEntry(page, toolEntry(page, C));
        await expect(sample(page, C)).toBeVisible();
        await expect(toolEntry(page, C)).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => Math.round((await box(page, await panelOfTab(page, C))).width)).toBe(Math.round(width));
    });

    test("切换容器时焦点原来在被切走的分节里：交给新容器的第一个分节；键盘激活入口时焦点留在入口上（输出 42）", async ({page}) => {
        await open(page);
        // 焦点在甲的内容里，经命令打开丙：侧栏切到丙的容器，甲的内容停放，焦点进丙的分节，不落到页面上。
        await sample(page, A).locator("input").focus();
        await runCommand(page, "打开视图");
        await pick(page, "选择要打开的视图", "样例丙");
        await expect(sample(page, C)).toBeVisible();
        await expect.poll(() => focusedPanelOf(page)).toBe(await panelOfTab(page, C));
        // 键盘：焦点在入口上按回车，切过去，焦点还在这个入口上。
        await toolEntry(page, B).focus();
        await page.keyboard.press("Enter");
        await expect(sample(page, B)).toBeVisible();
        await expect(toolEntry(page, B)).toBeFocused();
    });

    test("活动栏一个容器一项，按入口顺序；只含一个视图的入口写着它的视图；视图并进别的容器后自己的入口消失，那个入口的悬停文字写出两个视图；重置位置后入口回到原来的位置（输出 22、41；验收 14）", async ({page}) => {
        await open(page);
        const entries = () => page.locator("[data-rail=sidebar] [data-tool-band] [data-tool-entry]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-tool-entry")));
        const containers = (...viewIds: string[]) => viewIds.map((viewId) => `view:${viewId}`);
        expect(await entries()).toEqual(containers(A, B, C));
        for (const viewId of [A, B, C]) await expect(toolEntry(page, viewId)).toHaveAttribute("data-tool-view", viewId);
        // 乙移进右栏样例丁的容器：成了那个容器的分节，自己的容器没有成员，入口消失（输出 41）；右栏的容器不在活动栏里。
        await moveViaMenu(page, B, "样例丁");
        await expect.poll(entries).toEqual(containers(A, C));
        await expect.poll(() => instanceOf(page, B)).toMatchObject({location: "auxiliarybar"});
        // 乙移进样例甲的容器：成为它最后一个分节，侧栏切到它。入口还是两个；这个入口含两个视图，不再写单个视图，悬停文字写出两个视图。
        await moveViaMenu(page, B, "样例甲");
        await expect.poll(() => instanceOf(page, B)).toMatchObject({location: "sidebar"});
        await expect.poll(entries).toEqual(containers(A, C));
        const current = page.locator('[data-rail=sidebar] [data-tool-band] [data-tool-entry][aria-pressed="true"]');
        await expect(current).toHaveCount(1);
        await expect(current).toHaveAttribute("data-tool-entry", `view:${A}`);
        expect(await current.getAttribute("data-tool-view")).toBeNull();
        const host = "样例甲";
        await expect(current).toHaveAccessibleName(host);
        // 提示的面里除了看得见的字还有给读屏的一份，所以比“包含”。
        await current.hover();
        await expect(page.locator(".nb-ui-tooltip-surface")).toContainText(`${host}：${host}、样例乙`);
        await page.mouse.move(700, 400);
        await expect(page.locator(".nb-ui-tooltip-surface")).toHaveCount(0);
        // 重置位置：乙回到自己的容器。隐式容器的 id 一直留在入口顺序里（输出 41：只有用户拖出来的容器空了才删掉），入口回到原来的位置；侧栏切到它。
        await moveViaMenu(page, B, "重置位置");
        await expect.poll(entries).toEqual(containers(A, B, C));
        await expect(toolEntry(page, B)).toHaveAttribute("aria-pressed", "true");
        await expect(toolEntry(page, B)).toHaveAttribute("data-tool-view", B);
    });

    test("侧栏这一列的头只写当前视图的标题：标题的描述说怎么拖，内容的名称是视图标题、不含“拖动”（输出 20、22；验收 14）", async ({page}) => {
        await open(page);
        const title = tab(page, A);
        await expect(title).toHaveCount(1);
        await expect(headOf(page, A).locator("h2 > button[data-panel-tab]")).toHaveCount(1);
        await expect(headOf(page, A).locator('[role="tab"]')).toHaveCount(0);
        await expect(title).toHaveAccessibleDescription(/拖动/u);
        // 内容的角色是 region，名称取自标题：视图标题，不带“拖动”的说明。
        await expect(page.getByRole("region", {name: "样例甲", exact: true})).toBeVisible();
        await expect(page.getByRole("region", {name: /拖动/u})).toHaveCount(0);
        await expect(sample(page, A)).toBeVisible();
    });

    test("头只写标题：右栏一个视图只写标题，放进第二个是又一个分节、各写各的标题，搬走又回去；活动栏隐藏时侧栏的头不变，切换经命令（输出 20、22；验收 14）", async ({page}) => {
        await open(page);
        const titleOnly = async (viewId: string): Promise<void> => {
            await expect(headOf(page, viewId).locator('[role="tab"]')).toHaveCount(0);
            await expect(headOf(page, viewId).locator("h2 > button[data-panel-tab]")).toHaveCount(1);
        };
        await titleOnly(D);
        await expect(headOf(page, D).locator(`[data-panel-tab="view:${D}"]`)).toBeVisible();
        await expect(page.locator(`[data-content="view:${D}"] [role="region"]`)).toHaveCount(1);
        // 甲进了右栏样例丁的容器：是又一个分节，两块各有自己的头，都只写标题，没有标签带（输出 20、40）。
        await moveViaMenu(page, A, "样例丁");
        await expect.poll(() => instanceOf(page, A)).toMatchObject({location: "auxiliarybar"});
        expect(await panelOfTab(page, A)).not.toBe(await panelOfTab(page, D));
        await titleOnly(A);
        await titleOnly(D);
        await moveViaMenu(page, A, "重置位置");
        await expect.poll(() => instanceOf(page, A)).toMatchObject({location: "sidebar"});
        await titleOnly(A);
        await titleOnly(D);
        // 活动栏隐藏时侧栏的头不变（输出 20）：还是只写标题，换容器经命令。
        await runCommand(page, "切换区域显隐");
        await pick(page, "选中后立即切换", "活动栏");
        await expect(page.locator("[data-rail=sidebar] [data-tool-band] [data-tool-entry]")).toHaveCount(0);
        await titleOnly(A);
        await runCommand(page, "打开视图");
        await pick(page, "选择要打开的视图", "样例丙");
        await expect(sample(page, C)).toBeVisible();
        await titleOnly(C);
    });

    test("声明消失的视图留在树上：标签写它的 id，内容是占位与原因，可以关闭；别的操作写回时不丢（输出 4；验收 13）", async ({page}) => {
        await open(page);
        // 让布局定下来：没动过布局时树跟着视图目录，没有记录可改。隐藏右栏是一次会保存的操作。
        const auxToggle = page.locator('[data-titlebar-layout="auxiliarybar"]');
        const side = await panelOfTab(page, A);
        await auxToggle.click();
        await expect.poll(() => saved(page).then((record) => record?.doc.panels.auxiliarybar?.hidden === true)).toBe(true);
        const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
        // 插件暂时缺失的样子：记录里有它的分节（在侧栏、自己的隐式容器里，是当前容器），目录里没有它的声明。
        const GONE = "section:test.gone";
        interface Node {
            id: string;
            ref?: string;
            children?: Node[];
        }
        const db = new DatabaseSync(userDatabase());
        try {
            const row = db.prepare("SELECT rowid AS id, value FROM records WHERE owner = 'nbook.workbench' AND key = 'workbench.layout' AND client = ?1").get(client) as {id: number; value: string};
            const value = JSON.parse(row.value) as {doc: {tree: {root: Node}; panels: Record<string, Record<string, unknown>>}};
            // 分节排在样例甲那个分节后面：同一列里多一个叶，尺寸照抄。
            const column = (node: Node): Node | null => (node.children?.some((child) => child.id === side) === true ? node : (node.children ?? []).map(column).find((found) => found !== null) ?? null);
            const siblings = column(value.doc.tree.root)!.children!;
            siblings.push({...siblings.find((child) => child.id === side)!, id: GONE, ref: panelRef(GONE)});
            value.doc.panels[GONE] = {role: "tool", tabs: [{kind: "view", viewId: "test.gone"}], active: "view:test.gone", container: "view:test.gone"};
            const anchor = value.doc.panels.sidebar!;
            anchor.entries = [...(anchor.entries as string[]), "view:test.gone"];
            anchor.activeContainer = "view:test.gone";
            db.prepare("UPDATE records SET value = ?1 WHERE rowid = ?2").run(JSON.stringify(value), row.id);
        } finally {
            db.close();
        }
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        const tab = page.locator(`[data-panel-head="${GONE}"] [data-panel-tab="view:test.gone"]`);
        await expect(tab).toContainText("test.gone");
        const missing = page.locator('[data-content="view:test.gone"] [data-view-missing]');
        await expect(missing).toContainText("test.gone");
        // 别的操作写回时它还在。
        await auxToggle.click();
        await expect.poll(() => saved(page).then((record) => record?.doc.panels.auxiliarybar?.hidden !== true)).toBe(true);
        expect((await saved(page))?.doc.panels[GONE]?.tabs).toContainEqual({kind: "view", viewId: "test.gone"});
        // 关闭：分节和占位都没了。它是当前容器唯一的分节，侧栏切到入口顺序里它前面的那个容器（输出 43）：样例丙。
        await missing.getByRole("button", {name: "关闭这个标签"}).click();
        await expect(tab).toHaveCount(0);
        await expect(headOf(page, C)).toBeVisible();
        await expect(sample(page, C)).toBeVisible();
    });

    test("移动到：右键菜单里把乙移进底部面板样例戊的容器（实例不变）；甲移进底部面板的新容器，乙不随甲走；重置位置后回到初始；刷新后一致（输出 23、14、41；验收 1、15）", async ({page}) => {
        await open(page);
        const before = await revisionOf(page);
        await showView(page, B);
        await sample(page, B).locator("input").fill("乙的草稿");
        const beta = await instanceOf(page, B);
        const alpha = await instanceOf(page, A);
        // 不是当前容器的分节没有头（输出 42），按内容项上写着的叶找分节，停放着也找得到。
        const containerOf = async (viewId: string): Promise<string | undefined> => {
            const section = await page.locator(`[data-content="view:${viewId}"]`).getAttribute("data-content-leaf");
            return section === null ? undefined : (await saved(page))?.doc.panels[section]?.container;
        };

        // 移进一个容器：成为它最后一个分节，底部面板切到它（输出 23）。
        await moveViaMenu(page, B, "样例戊");
        await expect(headOf(page, B)).toBeVisible();
        await expect(toolEntry(page, B)).toHaveCount(0);
        await expect.poll(() => instanceOf(page, B)).toEqual({...beta, location: "panel"});
        await expect(sample(page, B).locator("input")).toHaveValue("乙的草稿");
        await expect.poll(() => containerOf(B)).toBe(`view:${E}`);

        // 甲进底部面板的新容器：只含它的用户容器，底部面板切过去；乙留在样例戊的容器里不随甲走，停放、实例不变（输出 16、41）。
        await moveViaMenu(page, A, "新容器（底部面板）");
        await expect(sample(page, A)).toBeVisible();
        await expect.poll(() => containerOf(A)).toMatch(/^custom:/u);
        const created = (await containerOf(A))!;
        await expect.poll(async () => (await saved(page))?.doc.panels.panel?.activeContainer).toBe(created);
        expect(await instanceOf(page, A)).toEqual({...alpha, location: "panel"});
        await parked(page, B);
        expect(await instanceOf(page, B)).toMatchObject({location: "panel", instance: beta.instance});
        expect(await containerOf(B)).toBe(`view:${E}`);
        expect((await saved(page))!.revision).toBeGreaterThan(before);

        await page.reload();
        await open(page);
        await expect(sample(page, A)).toBeVisible();
        expect(await containerOf(A)).toBe(created);
        expect(await containerOf(B)).toBe(`view:${E}`);
        // 刷新之后实例从头编号：之后的“实例不变”按刷新后的比。
        const reloaded = await instanceOf(page, A);

        // 重置位置：甲回到自己的容器，用户容器空了不再存在，入口顺序里没有它（输出 41）；乙要先看得见才有标题可点：经“打开视图”切过去。
        await moveViaMenu(page, A, "重置位置");
        await expect.poll(async () => (await saved(page))?.doc.panels.panel?.entries).not.toContain(created);
        await runCommand(page, "打开视图");
        await pick(page, "选择要打开的视图", "样例乙");
        await expect(sample(page, B)).toBeVisible();
        await moveViaMenu(page, B, "重置位置");
        for (const viewId of [A, B, C]) await expect(toolEntry(page, viewId)).toHaveCount(1);
        // 初始位置的视图没有“重置位置”。
        await showView(page, C);
        await tab(page, C).click({button: "right"});
        await expect(page.getByRole("menuitem", {name: "重置位置", exact: true})).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect.poll(async () => Promise.all([A, B, C].map(containerOf))).toEqual([A, B, C].map((viewId) => `view:${viewId}`));
        expect(await instanceOf(page, A)).toMatchObject({instance: reloaded.instance, location: "sidebar"});
    });

    test("键盘：焦点在活动栏的入口上按菜单键打开容器的菜单；容器在声明的区域时只有“移到”；“重置”把容器搬回声明的区域（输出 16、44；验收 9）", async ({page}) => {
        await open(page);
        // 容器就在它声明的区域：只有“移到”另外两个区域，没有“重置”。Escape 关闭，焦点回到入口；右键也开同一个菜单。
        await toolEntry(page, C).focus();
        await toolEntry(page, C).press("ContextMenu");
        await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText(["移到右栏", "移到底部面板"]);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(toolEntry(page, C)).toBeFocused();
        await toolEntry(page, C).click({button: "right"});
        await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText(["移到右栏", "移到底部面板"]);
        await page.keyboard.press("Escape");

        // 要一个不在声明区域的容器：样例丁的容器声明在右栏。乙、丙移进底部面板后，侧栏只剩甲；甲“移到右栏”，侧栏空了，
        // 丁再从右栏的入口条“移到侧栏”：侧栏只有丁。
        for (const viewId of [B, C]) await moveViaMenu(page, viewId, "样例戊");
        await expect.poll(async () => (await saved(page))?.doc.panels[await panelOfTab(page, C)]?.container).toBe(`view:${E}`);
        await toolEntry(page, A).click({button: "right"});
        await page.getByRole("menuitem", {name: "移到右栏", exact: true}).click();
        await expect.poll(() => instanceOf(page, A)).toMatchObject({location: "auxiliarybar"});
        // 选完焦点去这个容器在新区域里的入口（输出 16、47、50）。
        await expect(page.locator(`[data-rail="auxiliarybar"] [data-tool-band] [data-tool-entry="view:${A}"]`)).toBeFocused();
        await page.locator(`[data-rail="auxiliarybar"] [data-tool-band] [data-tool-entry="view:${D}"]`).click({button: "right"});
        await page.getByRole("menuitem", {name: "移到侧栏", exact: true}).click();
        await expect.poll(() => instanceOf(page, D)).toMatchObject({location: "sidebar"});
        await expect(toolEntry(page, D)).toHaveAttribute("aria-pressed", "true");
        await expect(toolEntry(page, D)).toBeFocused();

        // 菜单键：“移到”两项之后是“重置”。Escape 关闭，焦点回到入口。
        await toolEntry(page, D).focus();
        await toolEntry(page, D).press("ContextMenu");
        await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText(["移到右栏", "移到底部面板", "重置"]);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(toolEntry(page, D)).toBeFocused();

        // 回车选“重置”：整个容器搬回右栏，排在入口顺序最后，右栏切到它；侧栏没有容器了，隐藏，活动栏没有入口。
        await toolEntry(page, D).press("ContextMenu");
        await expect(page.getByRole("menuitem", {name: "重置", exact: true})).toBeVisible();
        await page.getByRole("menuitem", {name: "重置", exact: true}).focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect.poll(() => instanceOf(page, D)).toMatchObject({location: "auxiliarybar"});
        await expect(sample(page, D)).toBeVisible();
        await expect(page.locator("[data-rail=sidebar] [data-tool-band] [data-tool-entry]")).toHaveCount(0);
        await expect.poll(async () => (await saved(page))?.doc.panels.sidebar?.hidden).toBe(true);
        expect((await saved(page))?.doc.panels.auxiliarybar).toMatchObject({activeContainer: `view:${D}`, entries: [`view:${A}`, `view:${D}`]});
        // 打开菜单的那个活动栏入口不在了：焦点到这个容器在右轨入口带上的入口（ui/workbench-layout 输出 50），不落到页面上（输出 16）。
        await expect(page.locator(`[data-rail="auxiliarybar"] [data-tool-band] [data-tool-entry="view:${D}"]`)).toBeFocused();
    });

    test("入口菜单的“移到”：整个容器搬过去，入口排在目标区域入口条的最后，目标区域切到它；目标隐藏着时同一次显示出来；底部面板并成一行的入口也有（输出 44、47）", async ({page}) => {
        await open(page);
        const panelEntry = (viewId: string) => page.locator(`[data-region-strip="panel"] [data-region-entry="view:${viewId}"]`);
        // 底部面板先隐藏。
        const toggle = page.locator('[data-titlebar-layout="panel"]');
        if ((await toggle.getAttribute("aria-pressed")) === "true") await toggle.click();
        await expect(toggle).toHaveAttribute("aria-pressed", "false");

        // 侧栏的入口：另外两个区域各一项。选“移到底部面板”：分节过去，底部面板显示出来、切到它，活动栏上没有这个入口了，焦点去它在入口条上的入口。
        await toolEntry(page, A).click({button: "right"});
        await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText(["移到右栏", "移到底部面板"]);
        await page.getByRole("menuitem", {name: "移到底部面板", exact: true}).click();
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect.poll(() => instanceOf(page, A)).toMatchObject({location: "panel"});
        await expect(sample(page, A)).toBeVisible();
        await expect(toggle).toHaveAttribute("aria-pressed", "true");
        await expect(toolEntry(page, A)).toHaveCount(0);
        await expect(panelEntry(A)).toBeFocused();
        await expect.poll(async () => (await saved(page))?.doc.panels.panel?.activeContainer).toBe(`view:${A}`);
        expect((await saved(page))?.doc.panels.panel?.hidden).toBeUndefined();

        // 它只有一节，并进了入口条：右键入口开视图的“移动到”，末尾接上容器的“移到”。选“移到右栏”：整个容器过去，焦点去它在右栏入口条上的入口。
        const auxEntry = (viewId: string) => page.locator(`[data-rail="auxiliarybar"] [data-tool-band] [data-tool-entry="view:${viewId}"]`);
        await panelEntry(A).click({button: "right"});
        await expect(page.getByRole("menuitem", {name: "新容器（侧栏）", exact: true})).toBeVisible();
        await expect(page.getByRole("menuitem", {name: "移到侧栏", exact: true})).toBeVisible();
        await page.getByRole("menuitem", {name: "移到右栏", exact: true}).click();
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect.poll(() => instanceOf(page, A)).toMatchObject({location: "auxiliarybar"});
        await expect(auxEntry(A)).toBeFocused();
        await expect.poll(async () => (await saved(page))?.doc.panels[await panelOfTab(page, A)]?.container).toBe(`view:${A}`);

        // 再搬进一个（乙），成了当前。甲从右栏回底部面板：入口顺序里已经有它（上一回留下的、在乙前面），要挪到乙后面。
        await toolEntry(page, B).click({button: "right"});
        await page.getByRole("menuitem", {name: "移到底部面板", exact: true}).click();
        await expect.poll(() => instanceOf(page, B)).toMatchObject({location: "panel"});
        await expect(panelEntry(B)).toBeFocused();
        await auxEntry(A).click({button: "right"});
        await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText(["移到侧栏", "移到底部面板", "重置"]);
        await page.getByRole("menuitem", {name: "移到底部面板", exact: true}).click();
        await expect.poll(() => instanceOf(page, A)).toMatchObject({location: "panel"});
        await expect(panelEntry(A)).toBeFocused();
        await expect.poll(async () => {
            const entries = (await saved(page))?.doc.panels.panel?.entries ?? [];
            return {last: entries.at(-1), bBeforeA: entries.indexOf(`view:${B}`) < entries.indexOf(`view:${A}`), once: entries.filter((id) => id === `view:${A}`).length};
        }).toEqual({last: `view:${A}`, bBeforeA: true, once: 1});

        // 右栏入口条上的入口：另外两个区域是侧栏与底部面板。
        await page.locator(`[data-rail="auxiliarybar"] [data-tool-band] [data-tool-entry="view:${D}"]`).click({button: "right"});
        await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText(["移到侧栏", "移到底部面板"]);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
    });

    test("键盘：分节标题上按菜单键打开“移动到”菜单，按 Escape 关闭，焦点回到标题，不落到页面上（输出 16、20、23）", async ({page}) => {
        await open(page);
        await showView(page, C);
        await tab(page, C).focus();
        await tab(page, C).press("ContextMenu");
        await expect(page.getByRole("menu")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(tab(page, C)).toBeFocused();
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
        // 目标是容器的标题：右栏样例丁的容器。丙成为它最后一个分节，右栏切到它（输出 23）。
        await pickExact(page, "移动到", "样例丁");
        await expect(headOf(page, C)).toBeVisible();
        await expect.poll(() => instanceOf(page, C)).toMatchObject({location: "auxiliarybar"});
        await expect.poll(async () => (await saved(page))?.doc.panels[await panelOfTab(page, C)]?.container).toBe(`view:${D}`);
        await expect.poll(() => revisionOf(page)).toBeGreaterThan(before);
    });

    test("命令面板的打开视图（views.md 输出 14）：选一个视图，所在的侧栏被隐藏时一并显示、激活它的标签；取消不写", async ({page}) => {
        await open(page);
        // 分节没有隐藏按钮，隐藏是区域的事（输出 20）：用标题栏的侧栏按钮。
        const side = await panelOfTab(page, A);
        await page.locator('[data-titlebar-layout="sidebar"]').click();
        await shrunk(page, side);
        await expect.poll(async () => (await saved(page))?.doc.panels.sidebar?.hidden).toBe(true);

        const before = await revisionOf(page);
        await runCommand(page, "打开视图");
        await expect(page.getByRole("combobox", {name: "选择要打开的视图"})).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("combobox")).toHaveCount(0);
        expect(await revisionOf(page)).toBe(before);

        await runCommand(page, "打开视图");
        await pick(page, "选择要打开的视图", "样例丙");
        await expect(tab(page, C)).toHaveCount(1);
        await expect(leaf(page, await panelOfTab(page, C))).toHaveCount(1);
        await expect(toolEntry(page, C)).toHaveAttribute("aria-pressed", "true");
        await expect(sample(page, C)).toBeVisible();
    });

    test("实例保留：fill 与 scroll 两种视图在切容器、移进别的容器、新容器、侧栏拖到零再展开之后，输入、滚动与焦点都还在，实例不重建（输出 14；验收 7）", async ({page}) => {
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

        // 切回再切走（侧栏换容器）。
        await showView(page, A);
        await showView(page, B);
        await moveViaMenu(page, B, "样例戊");
        await moveViaMenu(page, B, "重置位置");
        await showView(page, A);
        await sample(page, A).locator("input").focus();
        await moveViaMenu(page, A, "新容器（右栏）");
        await moveViaMenu(page, A, "重置位置");

        await showView(page, A);
        const section = await panelOfTab(page, A);
        await sidebarSash(page).focus();
        await page.keyboard.press("Enter");
        await expect.poll(async () => (await box(page, section)).width).toBe(0);
        await parked(page, A);
        await page.keyboard.press("Enter");
        await expect(sample(page, A)).toBeVisible();

        expect(await instanceOf(page, A)).toEqual(alpha);
        await expect(sample(page, A).locator("input")).toHaveValue("甲的草稿");
        await expect.poll(() => fillScroll.evaluate((element) => element.scrollTop)).toBe(240);
        await showView(page, B);
        expect(await instanceOf(page, B)).toEqual(beta);
        await expect.poll(() => scrollerOf(B).evaluate((element) => element.scrollTop)).toBe(200);

        // 焦点：命令面板关闭时把焦点还给乙的输入框，随后乙被命令移进底部面板样例戊的容器、再重置回来；两次搬动后焦点都还在它的输入框里。
        const input = sample(page, B).locator("input");
        await input.focus();
        await runCommand(page, "移动视图");
        await pick(page, "选择要移动的视图", "样例乙");
        await pickExact(page, "移动到", "样例戊");
        await expect(headOf(page, B)).toBeVisible();
        await expect.poll(() => instanceOf(page, B)).toMatchObject({location: "panel"});
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
        await moveViaMenu(page, D, "样例戊");
        // 丁成了底部面板样例戊那个容器的又一个分节，和戊一起显示；等这次移动落盘再刷新。
        const delta = await panelOfTab(page, D);
        await expect.poll(async () => (await saved(page))?.doc.panels[delta]?.container).toBe((await saved(page))?.doc.panels.panel?.activeContainer);
        await page.evaluate((key) => localStorage.setItem(key, "1"), SAMPLE_VIEWS_SWITCHES.failActivation);
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        const failed = page.locator(`[data-view-frame="${E}"]`);
        await expect(failed).toHaveAttribute("data-view-state", "entry-failed");
        await expect(failed).toContainText("样例视图入口按开关激活失败");
        // 布局项保留：丁仍在面板里（声明在，只是没有交付）。
        await expect(page.locator(`[data-panel-head="${delta}"] [data-panel-tab="view:${D}"]`)).toHaveCount(1);

        await page.evaluate((key) => localStorage.removeItem(key), SAMPLE_VIEWS_SWITCHES.failActivation);
        await failed.locator("[data-view-retry-entry]").click();
        await expect(sample(page, E)).toBeVisible();
        expect(await instanceOf(page, E)).toMatchObject({generation: "1", location: "panel"});
        await tab(page, D).click();
        await expect(sample(page, D)).toBeVisible();
    });

    test("入口停止：组件卸载、原位显示停止原因，标签仍在面板里；刷新后回到原位置（views.md 验收 4；布局验收 13）", async ({page}) => {
        await open(page);
        await moveViaMenu(page, D, "样例戊");
        await tab(page, D).click();
        await expect(sample(page, D)).toBeVisible();
        await runCommand(page, "停止样例视图入口");
        await expect(page.locator(`[data-view-frame="${D}"]`)).toHaveAttribute("data-view-state", "entry-stopped");
        await expect(sample(page, D)).toHaveCount(0);
        await expect(tab(page, D)).toHaveCount(1);
        expect((await saved(page))?.doc.panels[await panelOfTab(page, D)]?.container).toBe((await saved(page))?.doc.panels.panel?.activeContainer);
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
        await pressEntry(page, toolEntry(page, B));
        const beta = page.locator(`[data-view-frame="${B}"]`);
        await expect(beta).toHaveAttribute("data-view-state", "load-failed");

        await page.evaluate(([load, render]) => {
            localStorage.removeItem(load);
            localStorage.removeItem(render);
        }, [SAMPLE_VIEWS_SWITCHES.failLoad, SAMPLE_VIEWS_SWITCHES.failRender] as const);
        await beta.locator("[data-view-reload]").click();
        await expect(sample(page, B)).toBeVisible();
        expect(await instanceOf(page, B)).toMatchObject({generation: "2"});
        await pressEntry(page, toolEntry(page, A));
        await delta.locator("[data-view-retry-render]").click();
        await expect(sample(page, D)).toBeVisible();
        expect(await instanceOf(page, D)).toMatchObject({generation: "2"});
        expect(await instanceOf(page, E)).toEqual(omega);
    });

    test("390 × 844：无页面级横向溢出，活动栏在视口内可点，编辑组取得非负余量，放不下的面板被收走并给诊断（验收 18；输出 10）", async ({page}) => {
        await page.setViewportSize({width: 390, height: 844});
        await open(page);
        // 窄屏没有专门的呈现（w00026 t11 才有）：放不下的面板按顺序收走，只剩活动栏、编辑组与状态栏。
        // 诊断写被收走的分节：右栏的样例丁在里面（分节的 id 里带着它的视图 id）。
        await expect.poll(() => page.locator("[data-workbench-shell]").getAttribute("data-layout-diagnostics")).toContain(`收走 section:${D}`);
        await expect(toolEntry(page, A)).toBeVisible();
        const entryBox = (await toolEntry(page, A).boundingBox())!;
        expect(entryBox.x).toBeGreaterThanOrEqual(0);
        expect(entryBox.x + entryBox.width).toBeLessThanOrEqual(390);
        expect((await box(page, "g0")).width).toBeGreaterThanOrEqual(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        // 点被收走的面板里的视图：活动栏仍可点，页面仍不横向溢出。
        await pressEntry(page, toolEntry(page, A));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    test("活动栏、工具面板、面板头与选中标记的颜色取主题 token 的解析值；面板头、标签带与活动栏不画外框、圆角与底线；nbook 是卡片外壳、macos 平铺，工具面板之间的线按主题（输出 19；验收 16）", async ({page}) => {
        await open(page);
        // 区域的锚不画，卡片与面板头按分节的 id 标记（输出 40）：侧栏看样例甲那一节，右栏看样例丁那一节。
        const [side, aux] = [await panelOfTab(page, A), await panelOfTab(page, D)];
        // 按钮的颜色有过渡：等过渡走完，没有对不上的项为止。
        const mismatches = () => page.evaluate((side) => {
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
                ...read(".workbench-tool-strip__item--active", {"color": "--accent-text"}),
                // 按下的底色是条目区里一个独立的块（输出 22）。
                ...read("[data-tool-indicator]", {"background-color": "--bg-hover"}),
                ...read(`[data-shell-card="${CSS.escape(side)}"]`, {"background-color": "--panel-surface"}),
            ].filter((item) => item.own !== item.token);
        }, side);
        await expect.poll(mismatches).toEqual([]);
        const unframed = (selectors: readonly string[]) => page.evaluate((selectors) => selectors.flatMap((selector) => {
            const style = getComputedStyle(document.querySelector(selector)!);
            const widths = ["top", "right", "bottom", "left"].map((edge) => style.getPropertyValue(`border-${edge}-width`));
            return widths.some((width) => width !== "0px") || style.borderRadius !== "0px" ? [{selector, widths, radius: style.borderRadius}] : [];
        }), selectors);
        expect(await unframed([".workbench-tool-strip", `[data-panel-head="${side}"]`, `[data-panel-head="${aux}"]`])).toEqual([]);

        // 外壳的分隔方式：卡片的矩形、圆角与相连处，标题栏底线与网格接缝的颜色。
        const shellLook = () => page.evaluate((side) => {
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
                sidebar: rect(side).toJSON() as DOMRect,
                editor: rect("g0").toJSON() as DOMRect,
                editorRadius: getComputedStyle(card("g0")).borderTopLeftRadius,
                activityCorners: [getComputedStyle(card("activitybar")).borderTopLeftRadius, getComputedStyle(card("activitybar")).borderTopRightRadius],
                sidebarCorners: [getComputedStyle(card(side)).borderTopLeftRadius, getComputedStyle(card(side)).borderTopRightRadius],
                joinLine: getComputedStyle(card("activitybar"), "::after").backgroundColor,
                titlebarLine: getComputedStyle(document.querySelector("header[data-workbench-titlebar]")!).borderBottomColor,
                // 工具面板之间的线单算（下面）；其余边界的接缝颜色。
                seams: [...new Set([...document.querySelectorAll("[data-workbench-shell] .sash-seam")].filter((seam) => seam.closest('[data-sash-kind="panes"]') === null).map((seam) => getComputedStyle(seam).backgroundColor))],
                divider,
            };
        }, side);
        // 同一张卡片里几节之间的线：丙移进样例甲的容器，侧栏显示上下两个分节，一个容器一张卡片，两节之间是开放式分割线（取 `--shell-pane-divider`）。
        // 右栏、底部面板的入口条和下面分节之间也是同一张卡片里的缝，宽度为 0、不画线（ui/workbench-layout 输出 47）：只量画了线的。
        const paneSeams = () => page.evaluate(() => [...document.querySelectorAll('[data-sash-kind="panes"]')].flatMap((sash) => {
            const seam = sash.querySelector<HTMLElement>(".sash-seam");
            if (seam === null) return [];
            const style = getComputedStyle(seam);
            const [start, end] = seam.dataset.axis === "width" ? [style.top, style.bottom] : [style.left, style.right];
            return [{color: style.backgroundColor, start, end}];
        }));
        const stripSeams = () => page.evaluate(() => [...document.querySelectorAll('[data-sash-kind="panes"]')].filter((sash) => (sash.getAttribute("aria-label") ?? "").includes("strip:")).map((sash) => sash.querySelector(".sash-seam") === null));
        expect(await stripSeams()).not.toContain(false);
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

        await moveViaMenu(page, C, "样例甲");
        // nbook 画 `--divider`，沿长轴两端各缩进 10px，不碰卡片边（输出 19）。
        await expect.poll(paneSeams).toEqual([{color: nbook.divider, start: "10px", end: "10px"}]);
        // 两节拼成一张卡片、整列和活动栏相连：上面一节下面两个角、下面一节上面两个角是直的，左边都不留缝。
        const column = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-shell-join="end"]')]
            .map((card) => ({top: card.getBoundingClientRect().top, corners: ["top-left", "top-right", "bottom-right", "bottom-left"].map((corner) => getComputedStyle(card).getPropertyValue(`border-${corner}-radius`))}))
            .sort((a, b) => a.top - b.top).map((card) => card.corners));
        expect(column).toEqual([["0px", "12px", "0px", "0px"], ["0px", "0px", "12px", "0px"]]);

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

        // 工具面板的当前标签用正文色（输出 19）：区域里的分节只写标题，带标签条的只剩浮动窗（输出 20、39），在多标签的窗上看；
        // 标签带也不画外框与圆角。字重不断言：nb-ui 的 Tabs 所有标签同一字重，规格写的“加粗”见报告。
        await expect(page.locator("html")).not.toHaveAttribute("data-nb-theme", "macos");
        const float = await floatWithTabs(page);
        const current = `[data-panel-head="${float}"] [role="tab"][aria-selected="true"]`;
        const tabColour = () => page.evaluate((selector) => {
            const element = document.querySelector(selector)!;
            const probe = document.createElement("div");
            probe.style.color = "var(--text-main)";
            element.append(probe);
            const result = {own: getComputedStyle(element).color, token: getComputedStyle(probe).color};
            probe.remove();
            return result;
        }, current);
        await expect.poll(async () => {
            const {own, token} = await tabColour();
            return own === token;
        }).toBe(true);
        expect(await unframed([`[data-panel-head="${float}"] [role="tablist"]`])).toEqual([]);
    });

    test("拖动边界的悬停线取主题 token：nbook 是 3px 实线、不发光、自由端缩进 16px，交汇处两条同时亮时连着，线芯设细时对齐接缝；macos 是贴满的 3px 实线（输出 19）", async ({page}) => {
        await open(page);
        const sidebarLine = sidebarSash(page);
        const panelLine = panelSash(page);
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

    test("标签带变窄时逐级让位：完整 → 截断 → 选中的留标题其余只留图标 → 收进“更多”，选中的始终带标题；从“更多”选中后它回到标签带（输出 20；验收 15）", async ({page}) => {
        await open(page);
        // 带标签条的只剩浮动窗：三个标签，戊、丁与己（长标题）。窗的宽不随视口变，用右下角的手柄改它（输出 39 的“键盘”）。
        const window = await floatWithTabs(page);
        const band = page.locator(`[data-panel-head="${window}"] [data-tabs-level]`);
        const level = () => band.getAttribute("data-tabs-level");
        const tabs = page.locator(`[data-panel-head="${window}"] [role="tab"]`);
        const selectedTab = page.locator(`[data-panel-head="${window}"] [role="tab"][aria-selected="true"]`);
        await expect(tabs).toHaveCount(3);
        const resize = page.locator(`[data-float-handle="bottom-right"]`);
        const widthOf = async (): Promise<number> => (await leaf(page, window).boundingBox())?.width ?? 0;
        // 先放宽到头（窗不大于树区域），再每次窄 10px，直到收进“更多”。
        await resize.focus();
        for (let step = 0; step < 60; step += 1) await page.keyboard.press("ArrowRight");
        const seen = new Set<string>();
        for (let step = 0; step < 120 && !seen.has("3"); step += 1) {
            await expect.poll(async () => (await band.boundingBox())?.width ?? 0).toBeGreaterThan(0);
            const current = (await level())!;
            seen.add(current);
            // 选中的始终带标题
            expect((await selectedTab.innerText()).trim().length).toBeGreaterThan(0);
            if (current === "3") {
                const more = page.locator(`[data-panel-head="${window}"] [data-tabs-more]`);
                await expect(more).toBeVisible();
                const shown = await tabs.count();
                await expect(more).toContainText(`更多 ${String(3 - shown)}`);
                break;
            }
            // 窄到最小尺寸还没收进“更多”的话，这里等不到变窄。
            const width = await widthOf();
            await resize.focus();
            await page.keyboard.press("ArrowLeft");
            await expect.poll(widthOf).toBeLessThan(width);
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
        await page.locator(`[data-panel-head="${window}"] [data-tabs-more]`).click();
        const hiddenOne = page.getByRole("menu").getByRole("menuitem").first();
        const name = (await hiddenOne.innerText()).trim();
        await hiddenOne.click();
        await expect(selectedTab).toContainText(name.slice(0, 2));
    });

    test("活动栏放不下时，排在后面的入口收进底部的“更多”，当前容器的入口总在外面；从“更多”选中后它回到活动栏（输出 22；验收 14）", async ({page}) => {
        await open(page);
        const entries = page.locator("[data-rail=sidebar] [data-tool-band] [data-tool-entry]");
        await expect(entries).toHaveCount(3);
        await expect(page.locator("[data-tool-more]")).toHaveCount(0);
        // 当前容器换成入口顺序里最后一个：按先后收的话它最先被收走。
        await showView(page, C);
        // 280 高：活动栏只放得下一个入口加“更多”。当前容器的那一个在外面，排在它前面的两个收进去。
        await page.setViewportSize({width: 1440, height: 280});
        const more = page.locator("[data-tool-more]");
        await expect(more).toBeVisible();
        await expect.poll(() => entries.count()).toBeLessThan(3);
        const shown = await entries.count();
        await expect(toolEntry(page, C)).toBeVisible();
        await expect(toolEntry(page, C)).toHaveAttribute("aria-pressed", "true");
        // 入口与“更多”都在活动栏里，不滚动。
        const strip = await page.locator(".workbench-tool-strip__entries").evaluate((element) => ({scroll: element.scrollHeight, client: element.clientHeight}));
        expect(strip.scroll).toBeLessThanOrEqual(strip.client);
        await more.click();
        const menu = page.getByRole("menu").getByRole("menuitem");
        await expect(menu).toHaveCount(3 - shown);
        const picked = (await menu.last().innerText()).trim();
        await menu.last().click();
        // 选中的容器成为当前容器，它的入口回到活动栏外面一层；原来的当前容器让出位置。
        const entry = page.locator("[data-rail=sidebar] [data-tool-band] [data-tool-entry]").and(page.getByRole("button", {name: picked, exact: true}));
        await expect(entry).toHaveAttribute("aria-pressed", "true");
        await expect(toolEntry(page, C)).toHaveCount(0);
        await expect(entries).toHaveCount(shown);
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
        // 带标签条的只剩浮动窗（输出 20、39）。
        const window = await floatWithTabs(page);
        const order = (): Promise<string[]> => head(page, window).locator("[data-panel-tab]").evaluateAll((elements) => elements.map((element) => (element as HTMLElement).dataset.panelTab ?? ""));
        const before = await order();
        expect(before.length).toBeGreaterThan(1);
        const first = before[0]!;
        const firstTab = page.locator(`[data-panel-head="${window}"] [data-panel-tab="${first}"]`);
        await firstTab.click();
        await firstTab.focus();
        await page.keyboard.press("Alt+ArrowLeft");
        expect(await order()).toEqual(before);
        await page.keyboard.press("Alt+ArrowRight");
        await expect.poll(order).toEqual([before[1]!, first, ...before.slice(2)]);
        await expect(firstTab).toBeFocused();
        await expect(firstTab).toHaveAttribute("aria-selected", "true");
    });

    test("标签带：标签与内容互相关联；长标题标签与框架按钮在 840 宽下都完整可点；方向键切换标签（输出 20）", async ({page}) => {
        await page.setViewportSize({width: 840, height: 900});
        await open(page);
        // 每个可点的东西：中心点命中的就是它自己。
        const hitsItself = (selector: string) => page.locator(selector).first().evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return rect.width > 0 && hit !== null && (hit === element || element.contains(hit));
        });
        // 底部面板的当前容器只有戊一节：头并进入口条、不写标题，入口就是它的标题（输出 47）；框架按钮是“浮动”与“最大化”，
        // 分节不折叠、没有隐藏（隐藏是区域的事），入口与按钮都完整可点。
        const omegaHead = `[data-region-strip="panel"]:has([data-tool-view="${E}"][aria-pressed="true"]) [data-panel-head]`;
        await expect.poll(() => hitsItself(`[data-region-strip="panel"] [data-tool-view="${E}"]`)).toBe(true);
        for (const action of ["float", "toggle-panel-maximized"]) {
            expect(await hitsItself(`${omegaHead} [data-panel-action="nbook.view.${action}"]`), action).toBe(true);
        }
        // 标签带只在浮动窗上（输出 20、39）：戊、丁、己三个标签，框架按钮只有“回到停靠”。
        const window = await floatWithTabs(page);
        const omega = page.getByRole("tab", {name: "样例戊"});
        await omega.click();
        const panelId = await omega.getAttribute("aria-controls");
        expect(panelId).not.toBeNull();
        // 标签在面板头（外框里），它控制的内容在内容层：两边靠 DOM id 对上。
        const content = page.locator(`[id="${panelId!}"]`);
        await expect(content).toHaveAttribute("role", "tabpanel");
        await expect(content).toHaveAttribute("aria-labelledby", (await omega.getAttribute("id"))!);
        await expect.poll(() => hitsItself(`[data-panel-head="${window}"] [data-panel-tab="view:${E}"]`)).toBe(true);
        expect(await hitsItself(`[data-panel-head="${window}"] [data-panel-action="nbook.view.dock"]`), "dock").toBe(true);
        expect(await omega.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(0);
        await omega.focus();
        // 窗里是戊、丁、己：往右两下到长标题的己。
        await page.keyboard.press("ArrowRight");
        await expect(page.getByRole("tab", {name: "样例丁"})).toBeFocused();
        await page.keyboard.press("ArrowRight");
        await expect(page.getByRole("tab", {name: /^样例己/u})).toBeFocused();
        await expect(sample(page, F)).toBeVisible();
        await expect(sample(page, E)).toHaveAttribute("data-visible", "false");
    });

    test("390 × 260：放不下被收走的面板里，视图内容停放：不进 Tab 顺序、visible 为假，外壳根给出诊断；空间回来时实例不变（输出 10、16、17；验收 6、7）", async ({page}) => {
        await open(page);
        const alpha = await instanceOf(page, A);
        const side = await panelOfTab(page, A);
        await page.setViewportSize({width: 390, height: 260});
        await expect.poll(() => page.locator("[data-workbench-shell]").getAttribute("data-layout-diagnostics")).toContain(`收走 ${side}`);
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

    test("“移动到”菜单打开时视图换了容器（分节还是同一块面板，id 不变）：菜单关闭（输出 23）", async ({page}) => {
        await open(page);
        const section = await panelOfTab(page, D);
        await tab(page, D).click({button: "right"});
        await expect(page.getByRole("menu")).toBeVisible();
        // 菜单开着时经测试外壳执行命令（不移开焦点、不关菜单）：丁移进戊的容器。
        await page.evaluate(({name, detail}) => window.dispatchEvent(new CustomEvent(name, {detail})), {name: SAMPLE_VIEWS_RUN_EVENT, detail: {command: "nbook.view.move-view", args: {viewId: D, container: `view:${E}`}}});
        await expect.poll(() => instanceOf(page, D)).toMatchObject({location: "panel"});
        expect(await panelOfTab(page, D)).toBe(section);
        await expect(page.getByRole("menu")).toHaveCount(0);
    });
});

test.describe("产品页：别的插件给视图贡献的标题动作（docs/specs/workbench/views.md 输出 10、11，验收 8）", () => {
    let tmp = "";
    let server: ProbeServer;

    test.beforeAll(async () => {
        tmp = await createTestTmpRoot("neuro-book-e2e", "workbench-view-title");
        await mkdir(join(tmp, "state"), {recursive: true});
        // `test.menus` 往样例视图丙贡献按钮与“⋯”里的项；菜单项 id 归它，视图 id 归 `test.sample-views`。
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views,test.menus", NBOOK_EXCLUDE_PLUGINS: "nbook.explorer,nbook.editor,nbook.agent,nbook.bots,nbook.canon,nbook.plot"}});
    });

    test.afterAll(async () => {
        expect(await server.stop()).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 1440, height: 900}});

    test("视图自己的按钮在前、贡献的在后；“⋯”里自己的 menu 动作在前、分隔线后是贡献的；贡献项执行时收到固定参数或这个视图实例（输出 20）", async ({page}) => {
        await page.goto(new URL("/workbench", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await pressEntry(page, toolEntry(page, C));
        await expect(sample(page, C)).toBeVisible();
        const actions = headOf(page, C);
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
