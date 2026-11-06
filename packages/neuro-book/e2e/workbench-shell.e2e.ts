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

import {CLIENT_IDENTITY_KEY} from "nbook/web/host/client-identity";

import {startDevSession, startProductServer} from "./fixtures";
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

async function box(page: Page, id: string): Promise<Box> {
    const found = await leaf(page, id).boundingBox();
    if (found === null) throw new Error(`没有 ${id} 的外框`);
    return found;
}

/** 所有叶外框的矩形（取整），用来比较“放大后回到原样”。 */
const leafRects = (page: Page): Promise<Record<string, number[]>> => page.evaluate((selector) => Object.fromEntries([...document.querySelectorAll(selector)].map((element) => {
    const {x, y, width, height} = element.getBoundingClientRect();
    return [element.getAttribute("data-leaf")!, [x, y, width, height].map(Math.round)];
})), LEAF);

/** 面板头里的框架按钮；`command` 是命令名（`nbook.view.` 之后的部分）。 */
const frame = (page: Page, panel: string, command: string) => page.locator(`[data-panel-head="${panel}"] [data-panel-action="nbook.view.${command}"]`);
const content = (page: Page, view: string) => page.locator(`[data-content="view:${view}"]`);
const editorContent = (page: Page) => page.locator('[data-content="editor:g0"]');
const sidebarSash = (page: Page) => page.getByRole("separator", {name: "调整 sidebar 与 center 的宽度"});
const panelSash = (page: Page) => page.getByRole("separator", {name: "调整 g0 与 panel 的高度"});
const panelToggle = (page: Page) => page.locator('[data-shell-focus-target="panel-toggle"]');

/** 内容被停放：不可交互（`inert`），保持最后的非零尺寸，不卸载（输出 16）。 */
const parked = (page: Page, selector: string) => expect(page.locator(selector)).toHaveAttribute("inert", "");
const unparked = (page: Page, selector: string) => expect(page.locator(selector)).not.toHaveAttribute("inert", "");

/**
 * 右键视图，在菜单里选目标面板：移动视图的入口（输出 23），目标名是面板名或“新面板（挨着 X）”。侧栏这一列的视图右键活动栏条目
 * （不是当前视图的标签没有 DOM，输出 22），别处的视图右键标签。
 */
async function moveViaMenu(page: Page, view: string, target: string): Promise<void> {
    const entry = page.locator(`[data-tool-entry="${view}"]`);
    await (await entry.count() > 0 ? entry : page.locator(`[data-panel-tab="view:${view}"]`)).click({button: "right"});
    await page.getByRole("menuitem", {name: target, exact: true}).click();
}

test.describe("产品页", () => {
    let tmp = "";
    let server: ProductServer;

    test.beforeAll(async () => {
        tmp = await createTestTmpRoot("neuro-book-e2e", "workbench-shell");
        await mkdir(join(tmp, "state"), {recursive: true});
        server = await startProductServer(join(tmp, "state"));
    });

    test.afterAll(async () => {
        expect(await server.stop()).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 1440, height: 900}});

    const userDatabase = (): string => join(tmp, "state", "storage", "user.sqlite");

    interface SavedDoc {
        readonly tree: {readonly root: SavedNode};
        readonly panels: Readonly<Record<string, {readonly collapsed?: boolean; readonly hidden?: boolean; readonly active?: string | null}>>;
    }
    type SavedNode = {readonly kind: "leaf"; readonly id: string; readonly size: {readonly width: number; readonly height: number}} | {readonly kind: "branch"; readonly children: readonly SavedNode[]};

    const sizeOf = (node: SavedNode, id: string): {width: number; height: number} | null => {
        if (node.kind === "leaf") return node.id === id ? node.size : null;
        for (const child of node.children) {
            const found = sizeOf(child, id);
            if (found !== null) return found;
        }
        return null;
    };

    /** 本页客户端存下的 `workbench.layout`（`local`，按客户端分行）；还没写过为 null。 */
    async function saved(page: Page): Promise<{revision: number; doc: SavedDoc} | null> {
        const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
        const db = new DatabaseSync(userDatabase());
        try {
            const row = db.prepare("SELECT revision, value FROM records WHERE owner = 'nbook.workbench' AND key = 'workbench.layout' AND client = ?1").get(client) as {revision: number; value: string} | undefined;
            return row === undefined ? null : {revision: Number(row.revision), doc: (JSON.parse(row.value) as {doc: SavedDoc}).doc};
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
     * 每个用例一个新的浏览器上下文：客户端身份不同，`local` 的布局记录互不影响。新客户端的面板默认不显示，打开后经状态栏
     * 显示面板，等记录写完再返回，免得这次保存混进用例自己数的修订号。
     */
    async function open(page: Page): Promise<void> {
        await page.goto(new URL("/workbench", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        // 记录读完前状态栏的面板按钮不可用：等按钮可用。
        const toggle = panelToggle(page);
        await expect(toggle).toBeEnabled();
        if ((await saved(page)) !== null) return;
        await toggle.click();
        await expect.poll(async () => (await saved(page)) !== null).toBe(true);
    }

    test("隐藏、收起、最大化：形态互不等价；收起或隐藏退出最大化；最大化不落盘；隐藏时焦点到活动栏条目；显示同时清除收起（输出 11、13、16；验收 5）", async ({page}) => {
        await open(page);
        await frame(page, "panel", "set-panel-collapsed").click();
        await expect.poll(async () => (await box(page, "panel")).height).toBe(32);
        // 先等收起写进记录，再展开，最后等展开也写进去：下面读到的修订号才是这两次写入之后的，不会被迟到的写入抬高。
        await expect.poll(async () => (await saved(page))?.doc.panels.panel?.collapsed).toBe(true);
        await frame(page, "panel", "set-panel-collapsed").click();
        await expect.poll(async () => (await box(page, "panel")).height).toBe(200);
        await expect.poll(async () => (await saved(page))?.doc.panels.panel?.collapsed ?? false).toBe(false);

        // 最大化盖住条以外的区域；别的面板还在原来的矩形里，内容停放。
        const before = await leafRects(page);
        const record = await saved(page);
        await frame(page, "panel", "toggle-panel-maximized").click();
        await expect(frame(page, "panel", "toggle-panel-maximized")).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => {
            const [panel, sidebar, aux, editor] = [await box(page, "panel"), await box(page, "sidebar"), await box(page, "auxiliarybar"), await box(page, "g0")];
            return panel.x <= sidebar.x + 0.5 && right(panel) >= right(aux) - 0.5 && panel.y <= editor.y + 0.5 && bottom(panel) >= bottom(editor) + 150;
        }).toBe(true);
        const covered = await leafRects(page);
        for (const id of ["sidebar", "g0", "auxiliarybar"]) expect(covered[id], id).toEqual(before[id]);
        await parked(page, '[data-content="editor:g0"]');
        await parked(page, '[data-content="view:nbook.explorer"]');
        // 最大化只在内存：记录不动，刷新后回到原来的高度。
        expect((await saved(page))?.revision).toBe(record?.revision);
        await page.reload();
        await open(page);
        expect((await box(page, "panel")).height).toBe(200);

        // 收起这个面板退出最大化，别的面板的内容恢复。
        await frame(page, "panel", "toggle-panel-maximized").click();
        await parked(page, '[data-content="editor:g0"]');
        await frame(page, "panel", "set-panel-collapsed").click();
        await expect(frame(page, "panel", "toggle-panel-maximized")).toHaveAttribute("aria-pressed", "false");
        await expect.poll(async () => (await box(page, "panel")).height).toBe(32);
        await unparked(page, '[data-content="editor:g0"]');
        await frame(page, "panel", "set-panel-collapsed").click();
        await expect.poll(async () => (await box(page, "panel")).height).toBe(200);

        // 收起后隐藏，再从状态栏显示：两个状态一起清掉（输出 11 的表）。
        await frame(page, "panel", "set-panel-collapsed").click();
        await frame(page, "panel", "set-part-hidden").focus();
        await page.keyboard.press("Enter");
        await expect(leaf(page, "panel")).toHaveCount(0);
        await expect(panelToggle(page)).toHaveText("显示面板");
        await panelToggle(page).click();
        await expect.poll(async () => (await box(page, "panel")).height).toBe(200);

        // 焦点在面板内容里时隐藏面板：视图在面板里，活动栏没有它的条目（只列侧栏这一列），焦点移到外壳根，不落在 body 上（输出 16）。
        await moveViaMenu(page, "nbook.agent.sessions", "面板");
        await expect(page.locator('[data-panel-head="panel"] [data-panel-tab="view:nbook.agent.sessions"]')).toBeVisible();
        await content(page, "nbook.agent.sessions").locator("input").first().focus();
        // 键盘用户在内容里没有走到隐藏按钮的路径可选（按钮在头里，焦点会先离开内容），所以用脚本点它，让焦点留在内容里被停放。
        await frame(page, "panel", "set-part-hidden").evaluate((button) => (button as HTMLElement).click());
        await expect(leaf(page, "panel")).toHaveCount(0);
        await expect(page.locator(".workbench-shell-host")).toBeFocused();

        // 侧栏的头随侧栏隐藏：侧栏里的视图有活动栏条目，焦点移到它的条目。
        await frame(page, "sidebar", "set-part-hidden").focus();
        await page.keyboard.press("Enter");
        await expect(leaf(page, "sidebar")).toHaveCount(0);
        await expect(page.locator('[data-tool-entry="nbook.explorer"]')).toBeFocused();
    });

    test("拖动边界：一次手势只提交一次；越界停住、刷新恢复；键盘步长、Home/End；Escape 与拖动中改窗口零写入；拖到零留 1px，指针拉回与 Enter 恢复（输出 8、9、11、12；验收 5）", async ({page}) => {
        await open(page);
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
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(560);
        await expect.poll(() => revisions().all).toBe(before.all + SAVE);
        expect(revisions().layout).toBe(before.all + SAVE);
        expect(sizeOf((await saved(page))!.doc.tree.root, "sidebar")?.width).toBe(560);
        await page.reload();
        await open(page);
        expect((await box(page, "sidebar")).width).toBe(560);
        const afterDrag = revisions().all;

        await sash.focus();
        await page.keyboard.press("ArrowLeft");
        await page.keyboard.press("Shift+ArrowLeft");
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(549);
        await page.keyboard.press("Home");
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(160);
        await page.keyboard.press("End");
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(560);
        await page.keyboard.press("ArrowLeft");
        await page.keyboard.press("Shift+ArrowLeft");
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(549);
        // 六次按键各结束一次手势，各保存一次。
        await expect.poll(() => revisions().all).toBe(afterDrag + 6 * SAVE);

        // 取消与上下文变化：预览回滚，记录不变。
        before = revisions();
        await page.keyboard.down("ArrowLeft");
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(539);
        await page.keyboard.press("Escape");
        await page.keyboard.up("ArrowLeft");
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(549);
        await drag(-100, () => page.setViewportSize({width: 1400, height: 900}));
        await page.setViewportSize({width: 1440, height: 900});
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(549);
        expect(revisions()).toEqual(before);

        // 拖到零：内容 0、边界 1px 还在；刷新后保持；从边界用指针拉回跟随指针；Enter 恢复记忆尺寸。
        await drag(-600);
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(0);
        await expect(sash).toBeVisible();
        await expect.poll(async () => (await saved(page))?.doc.panels.sidebar?.collapsed).toBe(true);
        await page.reload();
        await open(page);
        expect((await box(page, "sidebar")).width).toBe(0);
        await drag(300);
        await expect.poll(async () => (await box(page, "sidebar")).width).toBeGreaterThan(250);
        await drag(-600);
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(0);
        await sash.focus();
        await page.keyboard.press("Enter");
        await expect.poll(async () => (await box(page, "sidebar")).width).toBeGreaterThan(250);
    });

    test("最大化与拖到零时内容停放：看不见的内容不可交互；侧栏拖到零后标题栏按钮恢复；隐藏面板后状态栏“显示面板”按记忆尺寸恢复（输出 11、13、16；验收 5、7）", async ({page}) => {
        await open(page);
        // 最大化：被盖住的编辑组停放，Tab 走不进去。
        await frame(page, "panel", "toggle-panel-maximized").click();
        await parked(page, '[data-content="editor:g0"]');
        await expect(editorContent(page)).toHaveCount(1);
        await frame(page, "panel", "set-panel-collapsed").focus();
        for (let step = 0; step < 6; step++) {
            await page.keyboard.press("Tab");
            expect(await page.evaluate(() => document.activeElement?.closest('[data-content="editor:g0"]') ?? null)).toBeNull();
        }
        await frame(page, "panel", "toggle-panel-maximized").click();
        await unparked(page, '[data-content="editor:g0"]');

        // 横向分支拖到零：内容停放、保持实例；标题栏的侧栏按钮显示它。
        await sidebarSash(page).focus();
        await page.keyboard.press("Enter");
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(0);
        await parked(page, '[data-content="view:nbook.explorer"]');
        await expect(content(page, "nbook.explorer")).toHaveCount(1);
        await expect(page.locator('[data-titlebar-layout="sidebar"]')).toHaveAttribute("aria-pressed", "false");
        await page.locator('[data-titlebar-layout="sidebar"]').click();
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(340);
        await unparked(page, '[data-content="view:nbook.explorer"]');

        // 面板里有内容时，隐藏后经状态栏显示，回到记忆的尺寸。
        await moveViaMenu(page, "nbook.agent.sessions", "面板");
        await expect(page.locator('[data-panel-head="panel"] [data-panel-tab="view:nbook.agent.sessions"]')).toBeVisible();
        await frame(page, "panel", "set-part-hidden").click();
        await expect(leaf(page, "panel")).toHaveCount(0);
        const toggle = panelToggle(page);
        await expect(toggle).toHaveText("显示面板");
        await toggle.click();
        await expect.poll(async () => (await box(page, "panel")).height).toBe(200);
        await expect(toggle).toHaveText("隐藏面板");
    });

    test("纵向分支的边界：Enter 把面板收成标题行、内容停放，再按一次恢复记忆的尺寸（输出 11、12）", async ({page}) => {
        await open(page);
        await moveViaMenu(page, "nbook.agent.sessions", "面板");
        await expect(page.locator('[data-panel-head="panel"] [data-panel-tab="view:nbook.agent.sessions"]')).toBeVisible();
        await panelSash(page).focus();
        await page.keyboard.press("Enter");
        await expect.poll(async () => (await box(page, "panel")).height).toBe(32);
        await parked(page, '[data-content="view:nbook.agent.sessions"]');
        await page.keyboard.press("Enter");
        await expect.poll(async () => (await box(page, "panel")).height).toBe(200);
        await unparked(page, '[data-content="view:nbook.agent.sessions"]');
    });

    test("从零拉回：按着拖的过程中内容就出现，按回零内容回到停放，再拉出又出现，松手后保持（输出 12）", async ({page}) => {
        await open(page);
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
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(0);
        await parked(page, explorer);

        start = await press();
        await page.mouse.move(start.x + 200, start.y, {steps: 8});
        await expect.poll(async () => (await box(page, "sidebar")).width).toBeGreaterThan(150);
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
        expect((await box(page, "sidebar")).width).toBeGreaterThan(150);
    });

    test("外框过渡：开关侧栏时有，拖分隔线松手、改窗口尺寸时没有（输出 15；docs/specs/ui/nested-grid.md 的“过渡”）", async ({page}) => {
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

    test("F6、Shift+F6 经命令在面板之间移动焦点（输出 18；docs/specs/ui/nested-grid.md 的“移动焦点”）", async ({page}) => {
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
        expect((await box(page, "sidebar")).width).toBe(350);
    });

    test("放不下时只改呈现：窄到最小值时先压工具面板，再按右栏、面板、侧栏的顺序收走并给诊断，最后才压编辑组；文档不变，放大后回到原样（输出 6、10；验收 6）", async ({page}) => {
        await open(page);
        const original = await leafRects(page);
        const recorded = revisions();
        const diagnostics = page.locator("[data-workbench-shell]");
        const fullyVisible = async (): Promise<boolean> => {
            const panel = await box(page, "panel");
            const buttons = await page.locator('[data-panel-head="panel"] [data-panel-action]').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect()).map((rect) => ({x: rect.x, width: rect.width})));
            return buttons.length === 3 && buttons.every((button) => button.width > 0 && button.x >= panel.x - 0.5 && button.x + button.width <= panel.x + panel.width + 0.5);
        };

        // 840 宽：工具面板压到最小值以上，编辑组不小于 220，三个框架按钮完整可见。
        await page.setViewportSize({width: 840, height: 900});
        await expect.poll(async () => (await box(page, "g0")).width).toBeGreaterThanOrEqual(220);
        expect((await box(page, "sidebar")).width).toBeGreaterThanOrEqual(160);
        expect((await box(page, "auxiliarybar")).width).toBeGreaterThanOrEqual(160);
        await expect.poll(fullyVisible).toBe(true);

        // 放不下最小值的总和：右栏先收走。
        await page.setViewportSize({width: 590, height: 900});
        await expect(leaf(page, "auxiliarybar")).toHaveCount(0);
        await expect(diagnostics).toHaveAttribute("data-layout-diagnostics", /auxiliarybar/u);
        expect((await box(page, "g0")).width).toBeGreaterThanOrEqual(220);
        await parked(page, '[data-content="view:nbook.agent.conversation"]');

        // 高度放不下：面板在侧栏之前收走，编辑组留在可用的高度里。
        await page.setViewportSize({width: 590, height: 230});
        await expect(leaf(page, "panel")).toHaveCount(0);
        await expect(diagnostics).toHaveAttribute("data-layout-diagnostics", /panel/u);
        expect((await box(page, "g0")).height).toBeGreaterThanOrEqual(120);

        // 全程没有写文档；放大后收走的都回来，矩形回到原样。
        expect(revisions()).toEqual(recorded);
        await page.setViewportSize({width: 1440, height: 900});
        await expect.poll(() => leafRects(page)).toEqual(original);
        await expect(diagnostics).toHaveAttribute("data-layout-diagnostics", "");
        await unparked(page, '[data-content="view:nbook.agent.conversation"]');
        await expect.poll(fullyVisible).toBe(true);
    });

    test("窄的时候切个标签：被压缩的宽度不写进布局，放大后回到原样（输出 8；验收 6）", async ({page}) => {
        await open(page);
        const wide = (await box(page, "sidebar")).width;
        await page.setViewportSize({width: 840, height: 900});
        await expect.poll(async () => (await box(page, "sidebar")).width).toBeLessThan(wide);
        // 侧栏这一列的头只写当前视图，切到会话要点活动栏条目。
        await page.locator('[data-tool-entry="nbook.agent.sessions"]').click();
        await expect.poll(async () => (await saved(page))?.doc.panels.sidebar?.active).toBe("view:nbook.agent.sessions");
        expect(sizeOf((await saved(page))!.doc.tree.root, "sidebar")?.width).toBe(wide);
        await page.setViewportSize({width: 1440, height: 900});
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(wide);
    });

    test("同一客户端的两个窗口：各改一次布局，后保存的整棵胜出，另一窗口的显示不被强改；刷新后一致（验收 11）", async ({browser}) => {
        const context = await browser.newContext({viewport: {width: 1440, height: 900}});
        const a = await context.newPage();
        const b = await context.newPage();
        await open(a);
        await open(b);
        // a 先拉宽侧栏并保存；b 随后隐藏面板并保存。
        await sidebarSash(a).focus();
        await a.keyboard.press("ArrowRight");
        await expect.poll(async () => (await box(a, "sidebar")).width).toBe(350);
        await expect.poll(async () => sizeOf((await saved(a))!.doc.tree.root, "sidebar")?.width).toBe(350);
        const afterA = revisions().all;
        await frame(b, "panel", "set-part-hidden").click();
        await expect(leaf(b, "panel")).toHaveCount(0);
        await expect.poll(() => revisions().all).toBe(afterA + SAVE);
        await expect.poll(async () => (await saved(b))?.doc.panels.panel?.hidden).toBe(true);
        // b 保存后，a 的显示不被强改：面板还在。
        await expect(leaf(a, "panel")).toHaveCount(1);
        for (const page of [a, b]) {
            await page.reload();
            await open(page);
            await expect(leaf(page, "panel")).toHaveCount(0);
        }
        // 两个窗口读到的是同一份记录，布局一致。
        expect(await leafRects(a)).toEqual(await leafRects(b));
        await context.close();
    });

    test("外壳、面板与状态栏的底色、文字颜色、字体与分隔线取主题 token 的解析值（输出 19；验收 16）", async ({page}) => {
        await open(page);
        // 每块区域读计算样式，再在同一位置放一个探针读对应 token 的解析值，逐项对照。
        const resolved = await page.evaluate(() => {
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
                ...read('[data-shell-card="sidebar"]', {"background-color": "--panel-surface"}),
                ...read('[data-panel-head="panel"] h2', {"color": "--text-secondary"}),
                ...read("[data-workbench-status-bar]", {"background-color": "--shell-chrome-surface", "border-top-color": "--shell-chrome-line", "color": "--text-secondary"}),
            ];
        });
        for (const {selector, property, own, token} of resolved) expect(own, `${selector} ${property}`).toBe(token);
        // 面板头不画底线；页面根不预留滚动条位置，外壳贴到视口右缘。
        expect(await page.locator('[data-panel-head="panel"]').evaluate((head) => getComputedStyle(head).borderBottomWidth)).toBe("0px");
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
        const head = (panel: string, action: string) => page.locator(`[data-panel-head="${panel}"] [data-panel-action="${action}"]`);
        const settled = async (visible: boolean): Promise<void> => {
            expect(await instances()).toEqual(before);
            await expect(input).toHaveValue("草稿");
            if (visible) {
                await expect(page.locator(a)).toBeVisible();
                await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(300);
            }
        };

        // 并进右栏再回侧栏。
        await act("a-to-right");
        await page.locator("[data-panel-tab='view:a']").click();
        await expect(page.locator(a)).toHaveAttribute("data-content-leaf", "auxiliarybar");
        await settled(true);
        await act("a-back");
        await page.locator("[data-panel-tab='view:a']").click();
        await expect(page.locator(a)).toHaveAttribute("data-content-leaf", "sidebar");
        await settled(true);

        // 最大化别的面板：A 被盖住（内容停放，读不到滚动位置），还原后回来。
        await head("auxiliarybar", "maximize").click();
        await expect(page.locator(a)).toBeHidden();
        await settled(false);
        await head("auxiliarybar", "maximize").click();
        await settled(true);

        // 隐藏侧栏再从活动栏条目显示。
        await head("sidebar", "hide").click();
        await expect(page.locator(a)).toBeHidden();
        await settled(false);
        await page.locator('[data-tool-entry="a"]').click();
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
        await resizeTo(720);
        await expect(page.locator("[data-leaf='auxiliarybar']")).toHaveCount(0);
        expect(await visibleTabs()).toContain("view:a");
        await settled(true);
        await resizeTo(520);
        await expect.poll(visibleTabs).not.toContain("view:a");
        await settled(false);
        await resizeTo(1396);
        await expect.poll(visibleTabs).toEqual(wide);
        await expect(page.locator("[data-leaf='auxiliarybar']")).toHaveCount(1);
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
