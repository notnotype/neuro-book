/**
 * 工作台外壳在真实 Chrome 中的验收（docs/specs/ui/workbench-layout.md 输出 6、8–13、15、16、18、19，验收 5–7、11、12、17）：
 * 产品页用生产构建的外壳与后端；Lab 隔离与实例保留用真实的开发会话（Lab 只在开发模式加载）。等页面上可观察的变化，
 * 不按时长等待。
 *
 * 不在这里的，由下面几处覆盖：
 * - 树的几何、卡片与缝、最大化盖住时别的面板矩形不变、从零拉回的细节：`lab-workbench-surface.e2e.ts`、`lab-grid-panels.e2e.ts`；
 *   键盘步长与 Escape 的细节：`lab-nested-grid.e2e.ts`。这里只留产品独有的：记录写入次数、刷新恢复、真实命令与菜单。
 * - 拖动视图与落点、活动栏条目、标签带：`workbench-dnd.e2e.ts`、`workbench-views.e2e.ts`。
 * - 坏记录（损坏、版本不支持）、断线与确定失败、记录级放弃：`state/layout-doc-store.test.ts` 在真实 Storage 上覆盖；
 *   这里只走一条真实写失败经状态栏重试的路径。
 * - 命令经命令注册表的可用性与参数校验：`commands/panel-commands.test.ts`、`part-commands.test.ts`、`view-commands.test.ts`。
 */

import {mkdir, rm} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {regionNodeOf} from "@notnotype/nb-workbench-layout";
import type {LayoutDoc, PanelName} from "@notnotype/nb-workbench-layout";

import {CLIENT_IDENTITY_KEY} from "nbook/web/host/client-identity";

import {startDevSession, startProbeServer} from "./fixtures";
import {PROJECT_TEST_VIEW} from "nbook/shared/testing/project-view-contract";
import type {DevSession, ProductServer} from "./fixtures";

interface Box {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

const right = (box: Box): number => box.x + box.width;
const bottom = (box: Box): number => box.y + box.height;

/**
 * 树里的叶外框。编辑组的内容里还有一层编辑区自己的栅格，它的 `data-leaf="g0"` 与外壳的叶同名，所以限定到外壳栅格的
 * 直接子级。
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

/** 底部面板这一块的高：顶上的入口条（ui/workbench-layout 输出 47）加分节，记忆的尺寸是这一整块的。 */
async function panelRegionHeight(page: Page, section: string): Promise<number> {
    return (await box(page, "strip:panel")).height + (await box(page, section)).height;
}

/** 所有叶外框的矩形（取整），用来比较“放大后回到原样”。 */
const leafRects = (page: Page): Promise<Record<string, number[]>> => page.evaluate((selector) => Object.fromEntries([...document.querySelectorAll(selector)].map((element) => {
    const {x, y, width, height} = element.getBoundingClientRect();
    return [element.getAttribute("data-leaf")!, [x, y, width, height].map(Math.round)];
})), LEAF);

/**
 * 默认布局（输出 1）：侧栏是容器“项目”的资源管理器与测试视图（测试插件 `test.project-view`，声明同以前的会话面板）两个分节，右栏是消息视图
 * 一个分节，底部面板没有容器。
 */
const SESSIONS = PROJECT_TEST_VIEW;
const EXPLORER = "nbook.explorer";
const CONVERSATION = "nbook.agent.conversation";
/** 内置容器“项目”：资源管理器与测试视图声明在它里面，活动栏上是一个入口（输出 22、41）。 */
const PROJECT_CONTAINER = "nbook.workbench.project";

const content = (page: Page, view: string) => page.locator(`[data-content="view:${view}"]`);
/**
 * 视图所在分节的面板 id。区域的锚不进呈现树，分节的 id 是布局起的（输出 40），所以按视图取：内容项上写着它所在的叶。
 */
async function sectionOf(page: Page, view: string): Promise<string> {
    const id = await content(page, view).getAttribute("data-content-leaf");
    if (id === null) throw new Error(`${view} 不在任何面板里`);
    return id;
}
/** 视图所在分节的外框。区域只在挨着编辑区的方向上伸缩，所以侧栏、右栏的宽与底部面板的高，量区域里任何一个分节都一样。 */
const sectionBox = async (page: Page, view: string): Promise<Box> => box(page, await sectionOf(page, view));
/** 视图所在分节的面板头：分节的头只写它那个视图的标题（输出 20）。 */
/** 视图所在分节的面板头：头里有它的标题；底部面板并成一行时头不写标题，是按下的入口是它的那条入口条里并进来的头（输出 47）。 */
const headOf = (page: Page, view: string) => page.locator(`[data-panel-head]:has([data-panel-tab="view:${view}"]), [data-region-strip="panel"]:has([data-tool-view="${view}"][aria-pressed="true"]) [data-panel-head]`);
/** 分节头里的框架按钮；`command` 是命令名（`nbook.view.` 之后的部分）。 */
const frame = (page: Page, view: string, command: string) => headOf(page, view).locator(`[data-panel-action="nbook.view.${command}"]`);
/** 分节的标题行是展开、收起的开关（输出 20）：能收起时标题按钮带 `aria-expanded`。 */
const fold = (page: Page, view: string) => headOf(page, view).locator("[data-panel-tab][aria-expanded]");
const editorContent = (page: Page) => page.locator('[data-content="editor:g0"]');
/**
 * 区域挨着编辑区的那条边界。分隔线的名称里是两侧节点的 id：区域这一侧显示一个分节时是那个分节，显示几个时是区域的分支，
 * 所以只认编辑区那一侧；编辑区那一侧在底部面板显示着时是中间那一列（`center`），没显示时只剩编辑组（`g0`）。
 */
const sidebarSash = (page: Page) => page.getByRole("separator", {name: /^调整 \S+ 与 (?:center|g0) 的宽度$/u});
const panelSash = (page: Page) => page.getByRole("separator", {name: /^调整 g0 与 \S+ 的高度$/u});
const panelToggle = (page: Page) => page.locator('[data-shell-focus-target="panel-toggle"]');
/** 标题栏里显示或隐藏一个区域的按钮：分节没有隐藏按钮，隐藏是区域的事（输出 20）。 */
const regionToggle = (page: Page, region: PanelName) => page.locator(`[data-titlebar-layout="${region}"]`);
/** “显示面板”总在状态栏最右，右侧没有条目时也是（ui/workbench-shell.md 输出 35）。 */
const expectToggleAtRight = async (page: Page): Promise<void> => {
    const bar = (await page.locator("[data-workbench-status-bar]").boundingBox())!;
    const toggle = (await panelToggle(page).boundingBox())!;
    expect(bar.x + bar.width - (toggle.x + toggle.width)).toBeLessThan(16);
};

/** 内容被停放：不可交互（`inert`），保持最后的非零尺寸，不卸载（输出 16）。 */
const parked = (page: Page, selector: string) => expect(page.locator(selector)).toHaveAttribute("inert", "");
const unparked = (page: Page, selector: string) => expect(page.locator(selector)).not.toHaveAttribute("inert", "");

/**
 * 右键视图所在分节的标题，在菜单里选目标：移动视图的入口（输出 23），目标名是容器的标题或“新容器（某区域）”。活动栏入口的
 * 右键菜单是容器的（输出 44），不是视图的。
 */
async function moveViaMenu(page: Page, view: string, target: string): Promise<void> {
    await page.locator(`[data-panel-tab="view:${view}"]`).click({button: "right"});
    await page.getByRole("menuitem", {name: target, exact: true}).click();
}

test.describe("产品页", () => {
    let tmp = "";
    let server: ProductServer;

    test.beforeAll(async () => {
        tmp = await createTestTmpRoot("neuro-book-e2e", "workbench-shell");
        await mkdir(join(tmp, "state"), {recursive: true});
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.project-view"}});
    });

    test.afterAll(async () => {
        expect(await server.stop()).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 1440, height: 900}});

    const userDatabase = (): string => join(tmp, "state", "storage", "user.sqlite");

    /** 记录里一个区域的尺寸意图：区域有分节时记在区域的分支上，没有时记在锚上。 */
    const regionSize = (doc: LayoutDoc, region: PanelName): {width: number; height: number} | null => regionNodeOf(doc, region)?.node.size ?? null;

    /** 本页客户端存下的 `workbench.layout`（`local`，按客户端分行）；还没写过为 null。 */
    async function saved(page: Page): Promise<{revision: number; doc: LayoutDoc} | null> {
        const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
        const db = new DatabaseSync(userDatabase());
        try {
            const row = db.prepare("SELECT revision, value FROM records WHERE owner = 'nbook.workbench' AND key = 'workbench.layout' AND client = ?1").get(client) as {revision: number; value: string} | undefined;
            return row === undefined ? null : {revision: Number(row.revision), doc: (JSON.parse(row.value) as {doc: LayoutDoc}).doc};
        } finally {
            db.close();
        }
    }

    /**
     * 布局记录最新的修订号，以及整个分区最新的修订号（`all`）。修订号是分区共用的递增计数：一次保存先写
     * `workbench.layout-template` 再写 `workbench.layout`，所以让 `all` 前进 2，`workbench.layout` 的修订号等于新的 `all`。
     * 用 `all` 数保存次数，别的记录混进来也会让它多走，正好把“只写了该写的”一并盯住。
     */
    function revisions(): {layout: number; all: number} {
        const db = new DatabaseSync(userDatabase());
        try {
            const layout = db.prepare("SELECT MAX(revision) AS latest FROM records WHERE owner = 'nbook.workbench' AND key = 'workbench.layout'").get() as {latest: number | null};
            const total = db.prepare("SELECT MAX(revision) AS latest FROM records").get() as {latest: number | null};
            return {layout: Number(layout.latest ?? 0), all: Number(total.latest ?? 0)};
        } finally {
            db.close();
        }
    }

    /** 一次保存让修订号前进的步数（模板记录一条、布局记录一条）。 */
    const SAVE = 2;

    /**
     * 每个用例一个新的浏览器上下文：客户端身份不同，`local` 的布局记录互不影响。新客户端没有记录，默认布局不保存，第一次改动
     * 才写；底部面板没有容器，默认隐藏（输出 1）。
     */
    async function open(page: Page): Promise<void> {
        await page.goto(new URL("/workbench", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        // 记录读完前状态栏的面板按钮不可用：等按钮可用。
        await expect(panelToggle(page)).toBeEnabled();
    }

    /**
     * 把会话移进底部面板的新容器，等这次写入落盘：底部面板默认隐藏（里面只有不让区域显示的通知、后台任务，views.md 输出 18），
     * 要看它得先放一个视图进去（输出 23：新容器的同一次写入把区域显示出来、切到它）。返回这个分节的面板 id。
     */
    async function sessionsToPanel(page: Page): Promise<string> {
        await moveViaMenu(page, SESSIONS, "新容器（底部面板）");
        await expect(headOf(page, SESSIONS)).toBeVisible();
        await expect.poll(async () => (await saved(page))?.doc.panels.panel?.activeContainer ?? null).not.toBeNull();
        return sectionOf(page, SESSIONS);
    }

    test("隐藏、收成标题行、最大化：形态互不等价；最大化着点标题只激活、还原后点标题收起；最大化不落盘；显示区域不动分节的收起；隐藏时焦点到活动栏条目（输出 11、13、16；验收 5）", async ({page}) => {
        await open(page);
        await expectToggleAtRight(page);
        // 侧栏的两个分节上下排：资源管理器收成标题行，高度等于面板头，记在分节自己的记录上。
        const explorer = await sectionOf(page, EXPLORER);
        const expanded = (await box(page, explorer)).height;
        await fold(page, EXPLORER).click();
        await expect.poll(async () => (await box(page, explorer)).height).toBe(32);
        // 先等收起写进记录，再展开，最后等展开也写进去：下面读到的修订号才是这两次写入之后的，不会被迟到的写入抬高。
        await expect.poll(async () => (await saved(page))?.doc.panels[explorer]?.collapsed).toBe(true);
        await fold(page, EXPLORER).click();
        await expect.poll(async () => (await box(page, explorer)).height).toBe(expanded);
        await expect.poll(async () => (await saved(page))?.doc.panels[explorer]?.collapsed ?? false).toBe(false);

        // 最大化盖住条以外的区域；别的面板还在原来的矩形里，内容停放。
        const before = await leafRects(page);
        const others = [await sectionOf(page, SESSIONS), "g0", await sectionOf(page, CONVERSATION)];
        const record = await saved(page);
        await frame(page, EXPLORER, "toggle-panel-maximized").click();
        await expect(frame(page, EXPLORER, "toggle-panel-maximized")).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => {
            const over = await box(page, explorer);
            return others.every((id) => {
                const [x, y, width, height] = before[id]!;
                return over.x <= x! + 0.5 && right(over) >= x! + width! - 0.5 && over.y <= y! + 0.5 && bottom(over) >= y! + height! - 0.5;
            });
        }).toBe(true);
        const covered = await leafRects(page);
        for (const id of others) expect(covered[id], id).toEqual(before[id]);
        await parked(page, '[data-content="editor:g0"]');
        await parked(page, `[data-content="view:${CONVERSATION}"]`);
        // 最大化只在内存：记录不动，刷新后回到原来的高度。
        expect((await saved(page))?.revision).toBe(record?.revision);
        await page.reload();
        await open(page);
        expect((await box(page, explorer)).height).toBe(expanded);

        // 最大化着标题前没有展开标记，点标题只激活、不收起（还原靠还原按钮，输出 20）；还原之后点标题收起，别的面板的内容恢复。
        await frame(page, EXPLORER, "toggle-panel-maximized").click();
        await parked(page, '[data-content="editor:g0"]');
        await expect(fold(page, EXPLORER)).toHaveCount(0);
        await headOf(page, EXPLORER).locator("[data-panel-tab]").click();
        await expect(frame(page, EXPLORER, "toggle-panel-maximized")).toHaveAttribute("aria-pressed", "true");
        await frame(page, EXPLORER, "toggle-panel-maximized").click();
        await unparked(page, '[data-content="editor:g0"]');
        await fold(page, EXPLORER).click();
        await expect.poll(async () => (await box(page, explorer)).height).toBe(32);

        // 分节收成标题行时隐藏区域，再显示：区域回来，分节的收起不动（输出 11 的表）。
        await regionToggle(page, "sidebar").click();
        await shrunk(page, explorer);
        await expect.poll(async () => (await saved(page))?.doc.panels.sidebar?.hidden).toBe(true);
        await regionToggle(page, "sidebar").click();
        await expect.poll(async () => (await box(page, explorer)).height).toBe(32);
        await fold(page, EXPLORER).click();
        await expect.poll(async () => (await box(page, explorer)).height).toBe(expanded);

        // 底部面板隐藏后从状态栏显示，回到原来的高度。
        const sessions = await sessionsToPanel(page);
        const height = (await box(page, sessions)).height;
        await expect(panelToggle(page)).toHaveText("隐藏面板");
        await panelToggle(page).click();
        await shrunk(page, sessions);
        await expect(panelToggle(page)).toHaveText("显示面板");
        await panelToggle(page).click();
        await expect.poll(async () => (await box(page, sessions)).height).toBe(height);

        // 焦点在面板内容里时隐藏面板：视图在面板里，活动栏没有它的条目（只列侧栏这一列），焦点移到外壳根，不落在 body 上（输出 16）。
        await content(page, SESSIONS).locator("input").first().focus();
        // 用脚本点状态栏的按钮：真的去点会先把焦点从内容里移走，这里要它留在内容里被停放。
        await panelToggle(page).evaluate((button) => (button as HTMLElement).click());
        await shrunk(page, sessions);
        await expect(page.locator(".workbench-shell-host")).toBeFocused();

        // 焦点在侧栏分节的头里时隐藏侧栏：头随侧栏隐藏，焦点移到活动栏里这个分节所在容器（“项目”）的入口（输出 16）。
        await frame(page, EXPLORER, "toggle-panel-maximized").focus();
        await regionToggle(page, "sidebar").evaluate((button) => (button as HTMLElement).click());
        await shrunk(page, explorer);
        await expect(page.locator(`[data-tool-entry="${PROJECT_CONTAINER}"]`)).toBeFocused();
    });

    test("右栏拖空后还能打开：唯一的视图浮出，右栏隐藏；开关打开空右栏、写着提示，开关能再关掉；把视图拖进去，整个容器搬过去；再浮出，右栏随之隐藏（输出 11、36、43、45；ADR 0050；views 输出 22）", async ({page}) => {
        await open(page);
        // 区域里有分节时锚不进呈现树：按具名面板名选不到叶（“边界与兼容”的标记）。
        await expect(leaf(page, "sidebar")).toHaveCount(0);
        await expect(leaf(page, "auxiliarybar")).toHaveCount(0);
        const toggle = regionToggle(page, "auxiliarybar");
        // 消息视图只能停右栏或浮动（views 输出 22）：把右栏拖空用“浮动打开”，不能搬进侧栏。
        const containerBefore = (await saved(page))?.doc.panels[await sectionOf(page, CONVERSATION)]?.container ?? null;
        await moveViaMenu(page, CONVERSATION, "浮动");
        await expect(toggle).toHaveAttribute("aria-pressed", "false");
        await shrunk(page, "auxiliarybar");
        const containerOf = async (): Promise<string | null> => (await saved(page))?.doc.panels[await sectionOf(page, CONVERSATION)]?.container ?? null;
        const container = containerBefore ?? (await containerOf());

        // 打开：一块空面板，没有头，正中一句提示；开关是按下的，再点一次关掉。
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-pressed", "true");
        const empty = page.locator("[data-empty-region]");
        await expect(empty).toHaveText("把视图拖到这里");
        // 空区域打开着时锚就是那块空面板（输出 48）。
        await expect(leaf(page, "auxiliarybar")).toHaveCount(1);
        await expect(leaf(page, "auxiliarybar").locator("[data-panel-head]")).toHaveCount(0);
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-pressed", "false");
        // 关掉按拖到零画：空面板还在、缩到零，提示看不见。
        await shrunk(page, "auxiliarybar");
        await expect(empty).toBeHidden();
        await toggle.click();
        await expect(empty).toBeVisible();

        // 对话在单标签窗里，拿标题拖是整窗拖动：经过打开着的空区域不停靠，没有落点指示（输出 39、48）。消息视图在窗里自绘头，标题按钮平时不接指针
        // （views 输出 19）：从“回到停靠”往回 Tab 一次到它，键盘聚焦时它显示在左上角、点得到。
        const title = headOf(page, CONVERSATION).locator("[data-panel-tab]");
        await frame(page, CONVERSATION, "dock").focus();
        await page.keyboard.press("Shift+Tab");
        await expect(title).toBeFocused();
        await expect(title).toHaveCSS("opacity", "1");
        const from = (await title.boundingBox())!;
        const target = (await leaf(page, "auxiliarybar").boundingBox())!;
        const windowBefore = (await page.locator("[data-float-chrome]").boundingBox())!;
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, {steps: 3});
        await page.mouse.move(target.x + target.width / 2, target.y + target.height / 3, {steps: 8});
        // 窗跟着指针走（证明这一场确实在拖），指针下是空区域却没有落点。
        await expect.poll(async () => (await page.locator("[data-float-chrome]").boundingBox())!.x).toBeGreaterThan(windowBefore.x + 100);
        await expect(page.locator("[data-drop-feedback-label]")).toHaveCount(0);
        await expect(page.locator("[data-drop-kind]")).toHaveCount(0);
        await page.mouse.up();
        await expect(empty).toBeVisible();
        // 整个容器搬进去的办法是“回到停靠”（窗被拖到了屏幕边上，按钮在视口外，用键盘）：对话是它容器唯一的视图，容器 id 不变（输出 45）。
        await frame(page, CONVERSATION, "dock").focus();
        await page.keyboard.press("Enter");
        await expect(empty).toHaveCount(0);
        await expect(content(page, CONVERSATION)).toBeVisible();
        // 没有写过容器的视图停在它的隐式容器里，容器 id 是 `view:<视图 id>`；回到停靠把它写成区域的当前容器。
        await expect.poll(async () => (await saved(page))?.doc.panels.auxiliarybar?.activeContainer).toBe(container ?? `view:${CONVERSATION}`);

        // 再浮出：这一次把右栏拖空了，右栏随之隐藏。
        await moveViaMenu(page, CONVERSATION, "浮动");
        await expect(toggle).toHaveAttribute("aria-pressed", "false");
        await expect.poll(async () => (await saved(page))?.doc.panels.auxiliarybar?.hidden).toBe(true);
    });

    test("拖动边界：一次手势只提交一次；越界停住、刷新恢复；键盘步长、Home/End；Escape 与拖动中改窗口零写入；拖到零留 1px，指针拉回与 Enter 恢复（输出 8、9、11、12；验收 5）", async ({page}) => {
        await open(page);
        // 侧栏的宽量它的一个分节：两个分节同宽，就是区域的宽。
        const side = await sectionOf(page, EXPLORER);
        const sash = sidebarSash(page);
        const at = async () => {
            const found = await sash.boundingBox();
            if (found === null) throw new Error("没有边界");
            return {x: found.x + found.width / 2, y: found.y + found.height / 2};
        };
        const drag = async (dx: number, between?: () => Promise<void>): Promise<void> => {
            const start = await at();
            await page.mouse.move(start.x, start.y);
            await page.mouse.down();
            await page.mouse.move(start.x + dx / 2, start.y, {steps: 5});
            await between?.();
            await page.mouse.move(start.x + dx, start.y, {steps: 5});
            await page.mouse.up();
        };
        // 默认侧栏 340（叶宽，卡片在留白里），上限 560。一次手势落账一次：修订号前进一次保存的步数。
        let before = revisions();
        await drag(400);
        await expect.poll(async () => (await box(page, side)).width).toBe(560);
        await expect.poll(() => revisions().all).toBe(before.all + SAVE);
        expect(revisions().layout).toBe(before.all + SAVE);
        expect(regionSize((await saved(page))!.doc, "sidebar")?.width).toBe(560);
        await page.reload();
        await open(page);
        expect((await box(page, side)).width).toBe(560);
        const afterDrag = revisions().all;

        await sash.focus();
        await page.keyboard.press("ArrowLeft");
        await page.keyboard.press("Shift+ArrowLeft");
        await expect.poll(async () => (await box(page, side)).width).toBe(549);
        await page.keyboard.press("Home");
        await expect.poll(async () => (await box(page, side)).width).toBe(160);
        await page.keyboard.press("End");
        await expect.poll(async () => (await box(page, side)).width).toBe(560);
        await page.keyboard.press("ArrowLeft");
        await page.keyboard.press("Shift+ArrowLeft");
        await expect.poll(async () => (await box(page, side)).width).toBe(549);
        // 六次按键各结束一次手势，各保存一次。
        await expect.poll(() => revisions().all).toBe(afterDrag + 6 * SAVE);

        // 取消与上下文变化：预览回滚，记录不变。
        before = revisions();
        await page.keyboard.down("ArrowLeft");
        await expect.poll(async () => (await box(page, side)).width).toBe(539);
        await page.keyboard.press("Escape");
        await page.keyboard.up("ArrowLeft");
        await expect.poll(async () => (await box(page, side)).width).toBe(549);
        await drag(-100, () => page.setViewportSize({width: 1400, height: 900}));
        await page.setViewportSize({width: 1440, height: 900});
        await expect.poll(async () => (await box(page, side)).width).toBe(549);
        expect(revisions()).toEqual(before);

        // 拖到零：内容 0、边界 1px 还在；刷新后保持；从边界用指针拉回跟随指针；Enter 恢复记忆尺寸。
        await drag(-600);
        await expect.poll(async () => (await box(page, side)).width).toBe(0);
        await expect(sash).toBeVisible();
        await expect.poll(async () => (await saved(page))?.doc.panels.sidebar?.collapsed).toBe(true);
        await page.reload();
        await open(page);
        expect((await box(page, side)).width).toBe(0);
        await drag(300);
        await expect.poll(async () => (await box(page, side)).width).toBeGreaterThan(250);
        await drag(-600);
        await expect.poll(async () => (await box(page, side)).width).toBe(0);
        await sash.focus();
        await page.keyboard.press("Enter");
        await expect.poll(async () => (await box(page, side)).width).toBeGreaterThan(250);
    });

    test("最大化与拖到零时内容停放：看不见的内容不可交互；侧栏拖到零后标题栏按钮恢复；隐藏面板后状态栏“显示面板”按记忆尺寸恢复（输出 11、13、16；验收 5、7）", async ({page}) => {
        await open(page);
        const side = await sectionOf(page, EXPLORER);
        // 最大化：被盖住的编辑组停放，Tab 走不进去。
        await frame(page, EXPLORER, "toggle-panel-maximized").click();
        await parked(page, '[data-content="editor:g0"]');
        await expect(editorContent(page)).toHaveCount(1);
        await frame(page, EXPLORER, "toggle-panel-maximized").focus();
        for (let step = 0; step < 6; step++) {
            await page.keyboard.press("Tab");
            expect(await page.evaluate(() => document.activeElement?.closest('[data-content="editor:g0"]') ?? null)).toBeNull();
        }
        await frame(page, EXPLORER, "toggle-panel-maximized").click();
        await unparked(page, '[data-content="editor:g0"]');

        // 侧栏拖到零：内容停放、保持实例；标题栏的侧栏按钮显示它。
        await sidebarSash(page).focus();
        await page.keyboard.press("Enter");
        await expect.poll(async () => (await box(page, side)).width).toBe(0);
        await parked(page, '[data-content="view:nbook.explorer"]');
        await expect(content(page, "nbook.explorer")).toHaveCount(1);
        await expect(page.locator('[data-titlebar-layout="sidebar"]')).toHaveAttribute("aria-pressed", "false");
        await page.locator('[data-titlebar-layout="sidebar"]').click();
        await expect.poll(async () => (await box(page, side)).width).toBe(340);
        await unparked(page, '[data-content="view:nbook.explorer"]');

        // 面板里有内容时，隐藏后经状态栏显示，回到记忆的尺寸。
        const sessions = await sessionsToPanel(page);
        const toggle = panelToggle(page);
        await expect(toggle).toHaveText("隐藏面板");
        await toggle.click();
        await shrunk(page, sessions);
        await expect(toggle).toHaveText("显示面板");
        await toggle.click();
        await expect.poll(() => panelRegionHeight(page, sessions)).toBe(200);
        await expect(toggle).toHaveText("隐藏面板");
    });

    test("侧栏里分节之间的边界：Enter 把分节收成标题行、内容停放，再按一次回到意图；兄弟吸收让出的高度、展开后回到原高（输出 11、12）", async ({page}) => {
        await open(page);
        const [explorer, sessions] = [await sectionOf(page, EXPLORER), await sectionOf(page, SESSIONS)];
        const [upper, lower] = (await box(page, explorer)).y < (await box(page, sessions)).y ? [explorer, sessions] : [sessions, explorer];
        // 收的是边界前面的那一块。
        const upperView = upper === sessions ? SESSIONS : EXPLORER;
        const expanded = (await box(page, upper)).height;
        const lowerBefore = (await box(page, lower)).height;
        const between = page.getByRole("separator", {name: `调整 ${upper} 与 ${lower} 的高度`, exact: true});
        await between.focus();
        await page.keyboard.press("Enter");
        await expect.poll(async () => (await box(page, upper)).height).toBe(32);
        await expect.poll(async () => (await box(page, lower)).height).toBeCloseTo(lowerBefore + expanded - 32, 0);
        await parked(page, `[data-content="view:${upperView}"]`);
        await expect.poll(async () => (await saved(page))?.doc.panels[upper]?.collapsed).toBe(true);
        await page.keyboard.press("Enter");
        await expect.poll(async () => (await box(page, upper)).height).toBe(expanded);
        await expect.poll(async () => (await box(page, lower)).height).toBeCloseTo(lowerBefore, 0);
        await unparked(page, `[data-content="view:${upperView}"]`);
    });

    test("底部面板挨着编辑区的边界：Enter 把整个区域拖到零、内容停放，边界还在，再按一次恢复记忆的尺寸（输出 11、12）", async ({page}) => {
        await open(page);
        const sessions = await sessionsToPanel(page);
        await panelSash(page).focus();
        await page.keyboard.press("Enter");
        await expect.poll(() => panelRegionHeight(page, sessions)).toBe(0);
        await expect(panelSash(page)).toBeVisible();
        await parked(page, `[data-content="view:${SESSIONS}"]`);
        await expect.poll(async () => (await saved(page))?.doc.panels.panel?.collapsed).toBe(true);
        await page.keyboard.press("Enter");
        await expect.poll(() => panelRegionHeight(page, sessions)).toBe(200);
        await unparked(page, `[data-content="view:${SESSIONS}"]`);
    });

    test("侧栏这一列全部收成标题行：页面大小不变，标题行排在上面，最后一节垫底、卡片满高，内容照旧停放，这一列的分隔线拖不动；点标题展开能回来（输出 11）", async ({page}) => {
        await open(page);
        // 默认的侧栏就是上下两个分节（输出 1）。
        const [sessions, explorer] = [await sectionOf(page, SESSIONS), await sectionOf(page, EXPLORER)];
        const editor = await box(page, "g0");
        const before = [await box(page, sessions), await box(page, explorer)];
        const [upperView, lowerView] = before[0]!.y < before[1]!.y ? [SESSIONS, EXPLORER] : [EXPLORER, SESSIONS];
        const [upper, lower] = before[0]!.y < before[1]!.y ? [sessions, explorer] : [explorer, sessions];
        const columnBottom = Math.max(...before.map((rect) => rect.y + rect.height));
        await fold(page, upperView).click();
        await fold(page, lowerView).click();
        await expect.poll(async () => (await box(page, upper)).height).toBe(32);
        // 最下面那一节垫底：外框拉到这一列的底，卡片满高；它仍是收起的，内容停放，标题前的标记朝右。
        await expect.poll(async () => {
            const rect = await box(page, lower);
            return rect.y + rect.height;
        }).toBeCloseTo(columnBottom, 0);
        await expect.poll(async () => (await saved(page))?.doc.panels[lower]?.collapsed).toBe(true);
        await parked(page, `[data-content="view:${lowerView}"]`);
        await expect(fold(page, lowerView)).toHaveAttribute("aria-expanded", "false");
        // 编辑组不动：列收起不是整行变矮。
        expect(await box(page, "g0")).toEqual(editor);
        // 这一列两节之间的分隔线拖不动（展开靠点标题），线照画。
        const panes = page.locator('[data-workbench-surface] [data-sash-kind="panes"]').first();
        await expect(panes).toHaveAttribute("aria-disabled", "true");
        const [upperBefore, lowerBefore] = [await box(page, upper), await box(page, lower)];
        const line = (await panes.boundingBox())!;
        await page.mouse.move(line.x + line.width / 2, line.y + line.height / 2);
        await page.mouse.down();
        await page.mouse.move(line.x + line.width / 2, line.y + line.height / 2 + 120, {steps: 6});
        await page.mouse.up();
        expect([await box(page, upper), await box(page, lower)]).toEqual([upperBefore, lowerBefore]);
        await expect.poll(async () => (await saved(page))?.doc.panels[upper]?.collapsed).toBe(true);
        await fold(page, upperView).click();
        await expect.poll(async () => (await box(page, upper)).height).toBeGreaterThan(400);
        expect((await box(page, lower)).height).toBe(32);
        await expect(panes).not.toHaveAttribute("aria-disabled", "true");
    });

    test("从零拉回：按着拖的过程中内容就出现，按回零内容回到停放，再拉出又出现，松手后保持（输出 12）", async ({page}) => {
        await open(page);
        const side = await sectionOf(page, EXPLORER);
        const sash = sidebarSash(page);
        const explorer = '[data-content="view:nbook.explorer"]';
        const press = async (): Promise<{x: number; y: number}> => {
            const found = await sash.boundingBox();
            if (found === null) throw new Error("没有侧栏的边界");
            const start = {x: found.x + found.width / 2, y: found.y + 200};
            await page.mouse.move(start.x, start.y);
            await page.mouse.down();
            return start;
        };
        let start = await press();
        await page.mouse.move(start.x - 600, start.y, {steps: 6});
        await page.mouse.up();
        await expect.poll(async () => (await box(page, side)).width).toBe(0);
        await parked(page, explorer);

        start = await press();
        await page.mouse.move(start.x + 200, start.y, {steps: 8});
        await expect.poll(async () => (await box(page, side)).width).toBeGreaterThan(150);
        // 松手之前内容就已经搬出停放区、看得见。
        await unparked(page, explorer);
        await expect(page.locator(explorer)).toBeVisible();
        // 按着拖回按下点：画面回到零，内容也回到停放；再拉出来又出现。
        await page.mouse.move(start.x, start.y, {steps: 8});
        await parked(page, explorer);
        await page.mouse.move(start.x + 200, start.y, {steps: 8});
        await unparked(page, explorer);
        await page.mouse.up();
        await unparked(page, explorer);
        expect((await box(page, side)).width).toBeGreaterThan(150);
    });

    test("外框过渡：开关侧栏时有，拖分隔线松手、改窗口尺寸时没有（输出 15；docs/specs/ui/nested-grid.md 输出 35）", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        const moving = page.locator("[data-moving]");
        const twoFrames = (): Promise<unknown> => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

        await page.locator('[data-titlebar-layout="sidebar"]').click();
        await expect(moving.first()).toBeAttached();
        await expect(moving).toHaveCount(0);
        await page.locator('[data-titlebar-layout="sidebar"]').click();
        await expect(moving.first()).toBeAttached();
        await expect(moving).toHaveCount(0);

        // 外壳落账后还有第二次发布：它不能在松手后再滑一次。
        const sash = sidebarSash(page);
        const found = (await sash.boundingBox())!;
        await page.mouse.move(found.x + found.width / 2, found.y + 200);
        await page.mouse.down();
        await page.mouse.move(found.x + 60, found.y + 200, {steps: 4});
        expect(await moving.count()).toBe(0);
        await page.mouse.up();
        await twoFrames();
        expect(await moving.count()).toBe(0);
        await twoFrames();
        expect(await moving.count()).toBe(0);

        await page.setViewportSize({width: 1300, height: 760});
        await twoFrames();
        expect(await moving.count()).toBe(0);
    });

    test("F6、Shift+F6 经命令在面板之间移动焦点（输出 18；docs/specs/ui/nested-grid.md 输出 129）", async ({page}) => {
        await open(page);
        // 内容与外框是兄弟元素：焦点在内容里时认内容指回的面板，在面板头里时认外框。
        const part = () => page.evaluate(() => {
            const owner = document.activeElement?.closest<HTMLElement>("[data-content-leaf], [data-leaf]");
            return owner?.dataset.contentLeaf ?? owner?.dataset.leaf ?? null;
        });
        await panelToggle(page).focus();
        const start = await part();
        await page.keyboard.press("F6");
        const first = await part();
        expect(first).not.toBeNull();
        expect(first).not.toBe(start);
        await page.keyboard.press("F6");
        const second = await part();
        expect(second).not.toBe(first);
        await page.keyboard.press("Shift+F6");
        expect(await part()).toBe(first);
    });

    // 覆盖 ui/workbench-layout 输出 18、50：F6 的站点里右栏的入口条没有了，右轨在右栏的分节之后，底部面板的入口条仍在它的分节之前。
    test("F6 也停在活动栏、右轨与底部面板的入口条上：右轨在右栏的分节之后，底部面板的入口条在它的分节之前（输出 18、50）", async ({page}) => {
        await open(page);
        for (const region of ["auxiliarybar", "panel"] as const) {
            if (await regionToggle(page, region).getAttribute("aria-pressed") !== "true") await regionToggle(page, region).click();
        }
        await expect(page.locator('[data-rail="auxiliarybar"]')).toBeVisible();
        await expect(page.locator('[data-region-strip="auxiliarybar"]')).toHaveCount(0);
        await expect(page.locator('[data-region-strip="panel"]')).toBeVisible();
        const part = () => page.evaluate(() => {
            const owner = document.activeElement?.closest<HTMLElement>("[data-content-leaf], [data-leaf]");
            return owner?.dataset.contentLeaf ?? owner?.dataset.leaf ?? null;
        });
        // 从标题栏起按 F6 走一圈，记下每一站。
        await panelToggle(page).focus();
        const stops: Array<string | null> = [];
        for (let step = 0; step < 24; step += 1) {
            await page.keyboard.press("F6");
            const at = await part();
            if (stops.includes(at)) break;
            stops.push(at);
        }
        const conversation = await sectionOf(page, CONVERSATION);
        expect(stops).toContain("activitybar");
        // 入口条与右轨都是一站。底部面板缺省那一节（后台任务）是空列表，没有可聚焦的东西，F6 跳过它；底部面板的入口条排在区域的分节之前是投影的树序
        //（layout-project.test.ts），右轨排在右栏之后；F6 按树序走，这里在右栏逐站核对一次。
        expect(stops, JSON.stringify(stops)).toContain("strip:panel");
        expect(stops, JSON.stringify(stops)).not.toContain("strip:auxiliarybar");
        expect(stops.indexOf("rail:auxiliarybar"), JSON.stringify(stops)).toBeGreaterThanOrEqual(0);
        expect(stops.indexOf("rail:auxiliarybar"), JSON.stringify(stops)).toBeGreaterThan(stops.indexOf(conversation));
        // Shift+F6 反着走：从右轨回到右栏的分节。
        await panelToggle(page).focus();
        for (let step = 0; step < stops.length && await part() !== "rail:auxiliarybar"; step += 1) await page.keyboard.press("F6");
        expect(await part()).toBe("rail:auxiliarybar");
        await page.keyboard.press("Shift+F6");
        expect(await part()).toBe(conversation);
    });

    test("保存失败：状态栏显示“布局未保存”，库恢复后点“重试”补上（验收 12）", async ({page}) => {
        await open(page);
        const rename = (from: string, to: string): void => {
            const db = new DatabaseSync(userDatabase());
            try {
                db.exec(`ALTER TABLE ${from} RENAME TO ${to}`);
            } finally {
                db.close();
            }
        };
        rename("records", "records_away");
        try {
            await sidebarSash(page).focus();
            await page.keyboard.press("ArrowRight");
            await expect(page.locator("[data-status-problem]")).toContainText("布局未保存");
        } finally {
            rename("records_away", "records");
        }
        await page.getByRole("button", {name: "重试"}).click();
        await expect(page.locator("[data-status-problem]")).toHaveCount(0);
        await page.reload();
        await open(page);
        expect((await sectionBox(page, EXPLORER)).width).toBe(350);
    });

    test("放不下时只改呈现：窄到最小值时先压工具面板，再按右栏、面板、侧栏的顺序收走并给诊断，最后才压编辑组；文档不变，放大后回到原样（输出 6、10；验收 6、34）", async ({page}) => {
        // 网格的诊断经窗口的诊断写到控制台（验收 34）：浏览器出口的文字是“时间 [级别] 事件: 消息”，消息以码开头。
        const grid: Array<{type: string; text: string}> = [];
        page.on("console", (entry) => {
            if (entry.text().includes("workbench.grid:")) grid.push({type: entry.type(), text: entry.text()});
        });
        await open(page);
        // 底部面板默认隐藏：先放一个视图进去，三个区域才都有分节可收。
        const panel = await sessionsToPanel(page);
        const [side, aux] = [await sectionOf(page, EXPLORER), await sectionOf(page, CONVERSATION)];
        const original = await leafRects(page);
        const recorded = revisions();
        const diagnostics = page.locator("[data-workbench-shell]");
        const fullyVisible = async (): Promise<boolean> => {
            const frameBox = await box(page, panel);
            const buttons = await headOf(page, SESSIONS).locator("[data-panel-action]").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect()).map((rect) => ({x: rect.x, width: rect.width})));
            // 底部面板的分节只有浮动、最大化两个框架按钮：不折叠，隐藏是区域的事（输出 20）。
            return buttons.length === 2 && buttons.every((button) => button.width > 0 && button.x >= frameBox.x - 0.5 && button.x + button.width <= frameBox.x + frameBox.width + 0.5);
        };

        // 840 宽：工具面板压到最小值以上，编辑组不小于 220，框架按钮完整可见。
        await page.setViewportSize({width: 840, height: 900});
        await expect.poll(async () => (await box(page, "g0")).width).toBeGreaterThanOrEqual(220);
        expect((await box(page, side)).width).toBeGreaterThanOrEqual(160);
        expect((await box(page, aux)).width).toBeGreaterThanOrEqual(160);
        await expect.poll(fullyVisible).toBe(true);

        // 放不下最小值的总和：右栏先收走。
        await page.setViewportSize({width: 590, height: 900});
        await expect(leaf(page, aux)).toHaveCount(0);
        await expect.poll(() => diagnostics.getAttribute("data-layout-diagnostics")).toContain(`收走 ${aux}`);
        expect((await box(page, "g0")).width).toBeGreaterThanOrEqual(220);
        await parked(page, '[data-content="view:nbook.agent.conversation"]');
        await expect.poll(() => grid.some((entry) => entry.type === "debug" && entry.text.includes("over-constrained"))).toBe(true);

        // 高度放不下：面板在侧栏之前收走，编辑组留在可用的高度里。
        await page.setViewportSize({width: 590, height: 230});
        await expect(leaf(page, panel)).toHaveCount(0);
        await expect.poll(() => diagnostics.getAttribute("data-layout-diagnostics")).toContain(`收走 ${panel}`);
        expect((await box(page, "g0")).height).toBeGreaterThanOrEqual(120);

        // 全程没有写文档；放大后收走的都回来，矩形回到原样。
        expect(revisions()).toEqual(recorded);
        await page.setViewportSize({width: 1440, height: 900});
        await expect.poll(() => leafRects(page)).toEqual(original);
        await expect(diagnostics).toHaveAttribute("data-layout-diagnostics", "");
        await unparked(page, '[data-content="view:nbook.agent.conversation"]');
        await expect.poll(fullyVisible).toBe(true);
        // 放不下是可以预期的降级：整个过程没有网格的警告与错误。
        expect(grid.filter((entry) => entry.type === "warning" || entry.type === "error")).toEqual([]);
    });

    test("窄的时候收起一个分节：被压缩的宽度不写进布局，放大后回到原样（输出 8；验收 6）", async ({page}) => {
        await open(page);
        const [side, sessions] = [await sectionOf(page, EXPLORER), await sectionOf(page, SESSIONS)];
        const wide = (await box(page, side)).width;
        await page.setViewportSize({width: 840, height: 900});
        await expect.poll(async () => (await box(page, side)).width).toBeLessThan(wide);
        // 窄的时候做一次会保存的操作：收起会话这个分节。
        await fold(page, SESSIONS).click();
        await expect.poll(async () => (await saved(page))?.doc.panels[sessions]?.collapsed).toBe(true);
        expect(regionSize((await saved(page))!.doc, "sidebar")?.width).toBe(wide);
        await page.setViewportSize({width: 1440, height: 900});
        await expect.poll(async () => (await box(page, side)).width).toBe(wide);
    });

    test("同一客户端的两个窗口：各改一次布局，后保存的整棵胜出，另一窗口的显示不被强改；刷新后一致（验收 11）", async ({browser}) => {
        const context = await browser.newContext({viewport: {width: 1440, height: 900}});
        const a = await context.newPage();
        const b = await context.newPage();
        await open(a);
        await open(b);
        const [side, aux] = [await sectionOf(a, EXPLORER), await sectionOf(a, CONVERSATION)];
        // a 先拉宽侧栏并保存；b 随后隐藏右栏并保存（底部面板默认就隐藏着）。
        await sidebarSash(a).focus();
        await a.keyboard.press("ArrowRight");
        await expect.poll(async () => (await box(a, side)).width).toBe(350);
        await expect.poll(async () => regionSize((await saved(a))!.doc, "sidebar")?.width).toBe(350);
        const afterA = revisions().all;
        await regionToggle(b, "auxiliarybar").click();
        await shrunk(b, aux);
        await expect.poll(() => revisions().all).toBe(afterA + SAVE);
        await expect.poll(async () => (await saved(b))?.doc.panels.auxiliarybar?.hidden).toBe(true);
        // b 保存后，a 的显示不被强改：右栏还在。
        await expect(leaf(a, aux)).toHaveCount(1);
        for (const page of [a, b]) {
            await page.reload();
            await open(page);
            await shrunk(page, aux);
        }
        // 两个窗口读到的是同一份记录，布局一致。
        expect(await leafRects(a)).toEqual(await leafRects(b));
        await context.close();
    });

    test("外壳、面板与状态栏的底色、文字颜色、字体与分隔线取主题 token 的解析值（输出 19；验收 16）", async ({page}) => {
        await open(page);
        const side = await sectionOf(page, EXPLORER);
        // 每块区域读计算样式，再在同一位置放一个探针读对应 token 的解析值，逐项对照。
        const resolved = await page.evaluate((section) => {
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
                ...read("[data-workbench-shell]", {"background-color": "--shell-ground", "color": "--text-main", "font-family": "--font-ui"}),
                ...read(`[data-shell-card="${section}"]`, {"background-color": "--panel-surface"}),
                // 展开着的分节标题是主字色，收成标题行时退成次要字色（输出 20，w00026 t29）。
                ...read(`[data-panel-head="${section}"] h2`, {"color": "--text-main"}),
                ...read("[data-workbench-status-bar]", {"background-color": "--shell-chrome-surface", "border-top-color": "--shell-chrome-line", "color": "--text-secondary"}),
            ];
        }, side);
        for (const {selector, property, own, token} of resolved) expect(own, `${selector} ${property}`).toBe(token);
        // 面板头不画底线；页面根不预留滚动条位置，外壳贴到视口右缘。
        expect(await headOf(page, EXPLORER).evaluate((head) => getComputedStyle(head).borderBottomWidth)).toBe("0px");
        expect(await page.evaluate(() => window.innerWidth - document.querySelector("[data-workbench-shell]")!.getBoundingClientRect().right)).toBe(0);
    });
});

test.describe("Lab", () => {
    let tmp = "";
    let dev: DevSession;

    test.beforeAll(async () => {
        tmp = await createTestTmpRoot("neuro-book-e2e", "workbench-shell-lab");
        dev = await startDevSession(join(tmp, "state"));
    });

    test.afterAll(async () => {
        dev.child.kill("SIGTERM");
        expect(await dev.exit).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 2300, height: 1100}});

    test("同一场景里移动、最大化、隐藏、放不下被收走再回来：视图实例不重挂，输入与滚动保留（输出 11、13、14；验收 7）", async ({page}) => {
        await page.goto(`${dev.pageUrl}lab?c=WorkbenchSurface&s=default&vp=1400x720`);
        const fixture = page.locator(".workbench-surface-fixture");
        await expect(fixture).toBeVisible();
        const a = '[data-content="view:a"]';
        const input = page.locator(`${a} [data-structure-input]`);
        await expect(input).toBeVisible();
        // 视图实例按挂载顺序编号：谁被重挂，编号就会变。
        const instances = () => page.locator("[data-content] [data-structure-instance]").evaluateAll((elements) => elements.map((element) => `${element.closest("[data-content]")?.getAttribute("data-content")}=${element.getAttribute("data-structure-instance")}`).sort());
        const before = await instances();
        expect(before.some((item) => item.startsWith("view:a="))).toBe(true);
        await input.fill("草稿");
        const scroller = page.locator(`${a} [data-structure-scroll]`);
        await scroller.evaluate((element) => {
            element.scrollTop = 300;
        });
        const act = (name: string) => page.locator(`[data-surface-action="${name}"]`).click();
        // 夹具的五个视图各是自己的容器：分节的头按它那个视图找，活动栏的入口按容器 id。
        const head = (view: string, action: string) => page.locator(`[data-panel-head]:has([data-panel-tab="view:${view}"]) [data-panel-action="${action}"]`);
        // 右栏、底部面板入口条上的入口也带 `data-tool-entry`：这里说的是活动栏的入口。
        const entry = (view: string) => page.locator(`[data-rail=sidebar] [data-tool-band] [data-tool-entry="view:${view}"]`);
        const left = async (selector: string): Promise<number> => (await page.locator(selector).boundingBox())?.x ?? Number.NaN;
        const settled = async (visible: boolean): Promise<void> => {
            expect(await instances()).toEqual(before);
            await expect(input).toHaveValue("草稿");
            if (visible) {
                await expect(page.locator(a)).toBeVisible();
                await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(300);
            }
        };

        // A 的容器整个搬到右栏再搬回侧栏（输出 44）：搬过去右栏切到它，它在编辑组右边，活动栏没有它的入口；搬回来入口回来、是当前容器。
        await act("a-to-right");
        await expect(entry("a")).toHaveCount(0);
        await expect.poll(async () => (await left(a)) > (await left("[data-leaf='g1']"))).toBe(true);
        await settled(true);
        await act("a-back");
        await expect(entry("a")).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => (await left(a)) < (await left("[data-leaf='g0']"))).toBe(true);
        await settled(true);

        // 最大化别的面板：A 被盖住（内容停放，读不到滚动位置），还原后回来。A 的容器搬走后，右栏切到入口顺序里它前面的那个容器（输出 43）：D。
        await expect(head("d", "maximize")).toBeVisible();
        await head("d", "maximize").click();
        await expect(page.locator(a)).toBeHidden();
        await settled(false);
        await head("d", "maximize").click();
        await settled(true);

        // 点当前容器的入口隐藏侧栏，再点它显示（输出 22）。
        await entry("a").click();
        await expect(page.locator(a)).toBeHidden();
        await settled(false);
        await entry("a").click();
        await settled(true);

        // 画布窄到放不下：右栏先收走，再收侧栏（A 随之不可见）；画布变回宽，两者回来。画布宽度靠拖舞台右缘的把手改。
        const surfaceWidth = async (): Promise<number> => (await page.locator("[data-workbench-surface]").boundingBox())!.width;
        const resizeTo = async (target: number): Promise<void> => {
            // 画布在舞台里居中，两侧同时伸缩，拖把手一格画布宽度变两格；把手也随画布换位置，所以按量到的宽度逐步逼近。
            for (let attempt = 0; attempt < 4 && Math.abs((await surfaceWidth()) - target) > 20; attempt++) {
                const handle = (await page.getByRole("separator", {name: "调整宽度"}).boundingBox())!;
                const x = handle.x + handle.width / 2;
                const y = handle.y + handle.height / 2;
                await page.mouse.move(x, y);
                await page.mouse.down();
                await page.mouse.move(x + (target - (await surfaceWidth())) / 2, y, {steps: 4});
                await page.mouse.up();
            }
            expect(Math.abs((await surfaceWidth()) - target)).toBeLessThanOrEqual(20);
        };
        const visibleTabs = async () => ((await fixture.getAttribute("data-visible-tabs")) ?? "").split(" ").filter((tab) => tab !== "");
        const wide = await visibleTabs();
        expect(wide).toContain("view:a");
        const auxiliary = await page.locator('[data-content="view:d"]').getAttribute("data-content-leaf");
        expect(auxiliary).not.toBeNull();
        // 焦点所在的面板最后收（输出 10）。点入口不把焦点带进分节（输出 42），上面最后聚焦的是右栏的头：把焦点放回 A 里，收的先后才是右栏、侧栏。
        await input.focus();
        await resizeTo(720);
        await expect(page.locator(`[data-leaf="${auxiliary}"]`)).toHaveCount(0);
        expect(await visibleTabs()).toContain("view:a");
        await settled(true);
        await resizeTo(520);
        await expect.poll(visibleTabs).not.toContain("view:a");
        await settled(false);
        await resizeTo(1396);
        await expect.poll(visibleTabs).toEqual(wide);
        await expect(page.locator(`[data-leaf="${auxiliary}"]`)).toHaveCount(1);
        await settled(true);
    });

    test("直接打开 Lab：不打开、不订阅产品布局记录；打开产品页才会（验收 17）", async ({browser}) => {
        const context = await browser.newContext();
        const watch = async (path: string): Promise<string[]> => {
            const page = await context.newPage();
            const frames: string[] = [];
            page.on("websocket", (socket) => socket.on("framesent", (sent) => frames.push(String(sent.payload))));
            await page.goto(`${dev.pageUrl}${path}`);
            return frames;
        };
        const lab = await watch("lab?c=WorkbenchSurface&s=default");
        // 没有项目的 `/` 是书架页、不读布局记录，空工作台在 `/workbench`。
        const product = await watch("workbench");
        await expect.poll(() => product.some((frame) => frame.includes("workbench.layout"))).toBe(true);
        expect(lab.filter((frame) => frame.includes("workbench.layout") || frame.includes("editor.tabs"))).toEqual([]);
        await context.close();
    });
});
