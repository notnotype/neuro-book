/**
 * 工作台外壳一在真实 Chrome 中的验收（docs/specs/ui/workbench-shell.md 外壳一验收 1–6、8、11–13）：产品页用生产构建的
 * 外壳与后端；停放不卸载与 Lab 隔离用真实的开发会话（Lab 只在开发模式加载）。等页面上可观察的变化，不按时长等待。
 *
 * 不在这里的：四位置 × 四对齐的全部组合与降级的数值（`shell/layout.test.ts`）；坏记录（损坏、版本不支持）、断线与确定
 * 失败、只重试失败的那条记录、记录级放弃（`state/layout-store.test.ts` 在真实 Storage 上覆盖；这里只走一条真实写失败
 * 经状态栏重试的路径）；绑定项目与未绑定窗口的分区（`layout-store.test.ts`）；五条命令经命令注册表的可用性与参数
 * 校验（`commands/panel-commands.test.ts`）。
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

async function box(page: Page, part: string): Promise<Box> {
    const found = await page.locator(`[data-leaf="${part}"]`).boundingBox();
    if (found === null) throw new Error(`没有 ${part} 的落点`);
    return found;
}

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

/**
 * 选择模式里选一项。执行命令后面板先关再以选择模式打开，中间有一段过渡：等选择模式的输入框（名称是选择请求的占位）
 * 出现再输入，等过滤只剩目标一项再回车。
 */
async function choose(page: Page, text: string): Promise<void> {
    const combobox = page.getByRole("combobox", {name: "选中后立即生效"});
    await expect(combobox).toBeFocused();
    await combobox.fill(text);
    await expect(page.getByRole("option")).toHaveCount(1);
    await expect(page.getByRole("option")).toContainText(text);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("combobox")).toHaveCount(0);
}

const frame = (page: Page, command: string) => page.locator(`[data-panel-action="nbook.view.${command}"]`);
const sidebarSash = (page: Page) => page.getByRole("separator", {name: "调整 sidebar 与 panel-stack 的宽度"});

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

    /**
     * 工作台各条布局记录最新的修订号，以及整个分区最新的修订号（`all`）。修订号是分区共用的递增计数：一次保存让 `all`
     * 前进 1，被保存的那条记录的修订号等于新的 `all`。
     */
    function revisions(): Record<string, number> {
        const db = new DatabaseSync(userDatabase());
        try {
            const rows = db.prepare("SELECT key, MAX(revision) AS latest FROM records WHERE owner = 'nbook.workbench' GROUP BY key").all() as Array<{key: string; latest: number}>;
            const total = db.prepare("SELECT MAX(revision) AS latest FROM records").get() as {latest: number | null};
            return {...Object.fromEntries(rows.map((row) => [row.key, Number(row.latest)])), all: Number(total.latest ?? 0)};
        } finally {
            db.close();
        }
    }

    /** 本页客户端的工作台定制记录（`local`，按客户端分行）；还没写过为 null。 */
    async function customizations(page: Page): Promise<{shownParts?: string[]; panel?: {hidden?: boolean}} | null> {
        const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
        const db = new DatabaseSync(userDatabase());
        try {
            const row = db.prepare("SELECT value FROM records WHERE owner = 'nbook.workbench' AND key = 'views-customizations' AND client = ?1").get(client) as {value: string} | undefined;
            return row === undefined ? null : JSON.parse(row.value) as {shownParts?: string[]; panel?: {hidden?: boolean}};
        } finally {
            db.close();
        }
    }

    /**
     * 每个用例一个新的浏览器上下文：客户端身份不同，`local` 的布局记录互不影响。产品页的面板里没有视图，按输出 39 缺省不
     * 显示；右栏默认开着对话。这组验收测面板与两侧栏的相对位置，新客户端打开后经状态栏显示面板，等记录写完再返回，免得
     * 这次保存混进用例自己数的修订号。
     */
    async function open(page: Page): Promise<void> {
        await page.goto(new URL("/workbench", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(page.locator("[data-workbench-shell]")).toHaveAttribute("data-shell-layout", "split");
        // 记录读完前状态栏的面板按钮与边界都不可用：等按钮可用。
        const panelToggle = page.locator("[data-shell-focus-target=\"panel-toggle\"]");
        await expect(panelToggle).toBeEnabled();
        if ((await customizations(page)) !== null) return;
        await panelToggle.click();
        await expect.poll(async () => (await customizations(page))?.panel?.hidden === false).toBe(true);
    }

    test("面板的位置与对齐：经框架按钮与命令面板改；ActivityBar 始终在最左、面板不跨过它；justify 横跨两侧栏；刷新后恢复", async ({page}) => {
        await open(page);
        const activity = await box(page, "activitybar");
        let panel = await box(page, "panel");
        let editor = await box(page, "editor");
        expect(Math.abs(panel.x - editor.x)).toBeLessThan(1);
        expect(Math.abs(panel.width - editor.width)).toBeLessThan(1);
        expect(panel.x).toBeGreaterThanOrEqual(right(activity));
        expect(bottom(activity)).toBeCloseTo(bottom(panel), 0);

        await frame(page, "set-panel-position").click();
        await choose(page, "左侧");
        await expect.poll(async () => right(await box(page, "panel")) <= (await box(page, "editor")).x + 1).toBe(true);
        panel = await box(page, "panel");
        expect(panel.x).toBeGreaterThanOrEqual(right(activity));

        await runCommand(page, "面板位置");
        await choose(page, "底部");
        await runCommand(page, "面板对齐");
        await choose(page, "两端");
        await expect.poll(async () => Math.abs((await box(page, "panel")).x - (await box(page, "sidebar")).x)).toBeLessThan(1);
        expect(Math.abs(right(await box(page, "panel")) - right(await box(page, "auxiliarybar")))).toBeLessThan(1);
        expect((await box(page, "panel")).x).toBeGreaterThanOrEqual(right(activity));

        await runCommand(page, "面板位置");
        await choose(page, "顶部");
        await runCommand(page, "面板对齐");
        await choose(page, "靠右");
        const topRight = async (): Promise<boolean> => {
            const [p, e, aux] = [await box(page, "panel"), await box(page, "editor"), await box(page, "auxiliarybar")];
            return bottom(p) <= e.y + 1 && Math.abs(p.x - e.x) < 1 && Math.abs(right(p) - right(aux)) < 1;
        };
        await expect.poll(topRight).toBe(true);
        await page.reload();
        await open(page);
        await expect.poll(topRight).toBe(true);
        editor = await box(page, "editor");
        expect(editor.height).toBeGreaterThan(0);
    });

    test("隐藏、收起、最大化：形态互不等价；隐藏后焦点到“显示面板”，显示面板同时清除收起；最大化不落盘、换位置即清除", async ({page}) => {
        await open(page);
        await frame(page, "set-panel-collapsed").click();
        await expect.poll(async () => (await box(page, "panel")).height).toBe(32);
        await frame(page, "set-panel-collapsed").click();
        await expect.poll(async () => (await box(page, "panel")).height).toBe(200);

        await frame(page, "toggle-panel-maximized").click();
        await expect.poll(async () => (await box(page, "editor")).height).toBe(0);
        // 编辑器立刻停放，面板的高度随后以动画长满：等动画走完。
        await expect.poll(async () => (await box(page, "panel")).height).toBeGreaterThan(600);
        expect((await box(page, "sidebar")).width).toBe(340);
        await page.reload();
        await open(page);
        expect((await box(page, "panel")).height).toBe(200);

        await frame(page, "toggle-panel-maximized").click();
        await expect.poll(async () => (await box(page, "editor")).height).toBe(0);
        await runCommand(page, "面板位置");
        await choose(page, "顶部");
        await expect.poll(async () => (await box(page, "panel")).height).toBe(200);

        await frame(page, "set-panel-collapsed").click();
        await frame(page, "set-panel-hidden").focus();
        await page.keyboard.press("Enter");
        await expect(page.locator("[data-leaf=\"panel\"]")).toHaveCount(0);
        const toggle = page.locator("[data-shell-focus-target=\"panel-toggle\"]");
        await expect(toggle).toBeFocused();
        await expect(toggle).toHaveText("显示面板");
        await toggle.click();
        await expect.poll(async () => (await box(page, "panel")).height).toBe(200);
    });

    test("拖动边界：一次手势只提交一次、只写涉及的记录；越界停住、刷新恢复；键盘步长、Home/End；Escape 与拖动中改窗口零写入；拖到零留 1px，指针拉回与 Enter 恢复", async ({page}) => {
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
        // 默认侧栏 340（叶宽，卡片在 6px 留白里），上限 560。
        let before = revisions();
        await drag(400);
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(560);
        await expect.poll(() => revisions().all).toBe(before.all + 1);
        expect(revisions()["layout-sizes-side"]).toBe(before.all + 1);
        expect(revisions()["layout-sizes-panel"]).toBe(before["layout-sizes-panel"]);
        expect(revisions()["views-customizations"]).toBe(before["views-customizations"]);
        const afterDrag = revisions().all;
        await page.reload();
        await open(page);
        expect((await box(page, "sidebar")).width).toBe(560);

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
        await expect.poll(() => revisions().all).toBe(afterDrag + 6);

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

    test("最大化与拖到零时内容停放：Tab 进不去看不见的编辑器；面板拖到零后状态栏“显示面板”按记忆尺寸恢复", async ({page}) => {
        await open(page);
        await frame(page, "toggle-panel-maximized").click();
        await expect.poll(async () => (await box(page, "editor")).height).toBe(0);
        await expect(page.locator("[data-shell-slot=\"editor\"]")).toHaveCount(1);
        expect(await page.locator("[data-shell-slot=\"editor\"]").evaluate((element) => element.closest("[data-shell-parking]") !== null)).toBe(true);
        await frame(page, "toggle-panel-maximized").click();
        await expect.poll(async () => (await box(page, "editor")).height).toBeGreaterThan(0);

        await page.getByRole("separator", {name: "调整 editor 与 panel 的高度"}).focus();
        await page.keyboard.press("Enter");
        await expect.poll(async () => (await box(page, "panel")).height).toBe(0);
        expect(await page.locator("[data-shell-slot=\"panel\"]").evaluate((element) => element.closest("[data-shell-parking]") !== null)).toBe(true);
        const toggle = page.locator("[data-shell-focus-target=\"panel-toggle\"]");
        await expect(toggle).toHaveText("显示面板");
        await toggle.click();
        await expect.poll(async () => (await box(page, "panel")).height).toBe(200);
        await expect(toggle).toHaveText("隐藏面板");
    });

    test("面板上沿拖过 600 不停、拖到顶即最大化且不写尺寸、往下拖还原并保存；拖到零后往外拖，松手前内容就在（输出 4、7、8）", async ({page}) => {
        await open(page);
        const sash = page.getByRole("separator", {name: "调整 editor 与 panel 的高度"});
        const slotParked = (part: string) => page.locator(`[data-shell-slot="${part}"]`).evaluate((element) => element.closest("[data-shell-parking]") !== null);
        const press = async (): Promise<{x: number; y: number}> => {
            const found = await sash.boundingBox();
            if (found === null) throw new Error("没有面板与编辑器之间的边界");
            const start = {x: found.x + found.width / 2, y: found.y + found.height / 2};
            await page.mouse.move(start.x, start.y);
            await page.mouse.down();
            return start;
        };
        // 主体 842：editor 641、边界 1、面板 200。
        const before = revisions();
        let start = await press();
        await page.mouse.move(start.x, start.y - 450, {steps: 6});
        await expect.poll(async () => (await box(page, "panel")).height).toBe(650);
        await page.mouse.move(start.x, start.y - 620, {steps: 6});
        await expect.poll(async () => (await box(page, "editor")).height).toBe(0);
        await page.mouse.up();
        await expect.poll(slotParked.bind(null, "editor")).toBe(true);
        await expect(frame(page, "toggle-panel-maximized")).toHaveAttribute("aria-pressed", "true");
        expect((await box(page, "panel")).height).toBe(841);
        // 拖成最大化不写尺寸记录；最大化只在内存，刷新后面板回到原来的高度。
        expect(revisions()["layout-sizes-panel"]).toBe(before["layout-sizes-panel"]);
        await page.reload();
        await open(page);
        expect((await box(page, "panel")).height).toBe(200);

        // 从最大化往下拖过编辑器的最小高度：还原，面板高度跟着指针并保存一次。
        start = await press();
        await page.mouse.move(start.x, start.y - 620, {steps: 6});
        await page.mouse.up();
        await expect.poll(async () => (await box(page, "editor")).height).toBe(0);
        const maximized = revisions();
        start = await press();
        await page.mouse.move(start.x, start.y + 300, {steps: 6});
        await page.mouse.up();
        await expect.poll(async () => (await box(page, "editor")).height).toBe(300);
        expect((await box(page, "panel")).height).toBe(541);
        await expect(frame(page, "toggle-panel-maximized")).toHaveAttribute("aria-pressed", "false");
        await expect.poll(() => revisions()["layout-sizes-panel"]).toBe(maximized.all + 1);

        // 拖到零，再往外拖：松手前面板的内容已经搬回落点、看得见。
        start = await press();
        await page.mouse.move(start.x, start.y + 700, {steps: 6});
        await page.mouse.up();
        await expect.poll(async () => (await box(page, "panel")).height).toBe(0);
        expect(await slotParked("panel")).toBe(true);
        start = await press();
        await page.mouse.move(start.x, start.y - 200, {steps: 8});
        await expect.poll(async () => (await box(page, "panel")).height).toBeGreaterThan(150);
        await expect.poll(slotParked.bind(null, "panel")).toBe(false);
        await expect(page.locator("[data-shell-slot=\"panel\"]")).toBeVisible();
        // 按着拖回按下点：画面回到零，内容也回到停放区；再拉出来又出现
        await page.mouse.move(start.x, start.y, {steps: 8});
        await expect.poll(slotParked.bind(null, "panel")).toBe(true);
        await page.mouse.move(start.x, start.y - 200, {steps: 8});
        await expect.poll(slotParked.bind(null, "panel")).toBe(false);
        await page.mouse.up();
        expect(await slotParked("panel")).toBe(false);
    });

    test("外框过渡：开关侧栏时有，拖分隔线松手、改窗口尺寸时没有（docs/specs/ui/nested-grid.md 的“过渡”）", async ({page}) => {
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
        const sash = page.getByRole("separator", {name: "调整 sidebar 与 panel-stack 的宽度"});
        const box = (await sash.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + 200);
        await page.mouse.down();
        await page.mouse.move(box.x + 60, box.y + 200, {steps: 4});
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

    test("F6、Shift+F6 经命令在面板之间移动焦点（docs/specs/ui/nested-grid.md 的“移动焦点”）", async ({page}) => {
        await open(page);
        const part = () => page.evaluate(() => document.activeElement?.closest<HTMLElement>("[data-leaf]")?.dataset.leaf ?? null);
        await page.locator("[data-shell-focus-target=\"panel-toggle\"]").focus();
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

    test("保存失败：状态栏显示“布局未保存”，库恢复后点“重试”补上", async ({page}) => {
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

    test("紧凑呈现：390 宽下纵向排布、位置对齐最大化不可用；宽屏最大化 → 紧凑 → 宽屏不复活；页面无横向滚动", async ({page}) => {
        await open(page);
        await frame(page, "toggle-panel-maximized").click();
        await expect.poll(async () => (await box(page, "editor")).height).toBe(0);
        await page.setViewportSize({width: 390, height: 844});
        await expect(page.locator("[data-workbench-shell]")).toHaveAttribute("data-shell-layout", "compact");
        for (const command of ["set-panel-position", "set-panel-alignment", "toggle-panel-maximized"]) await expect(frame(page, command)).toBeDisabled();
        await expect(frame(page, "set-panel-hidden")).toBeEnabled();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
        await page.setViewportSize({width: 1440, height: 900});
        await expect(page.locator("[data-workbench-shell]")).toHaveAttribute("data-shell-layout", "split");
        await expect.poll(async () => (await box(page, "panel")).height).toBe(200);
        expect((await box(page, "editor")).height).toBeGreaterThan(0);
    });

    test("临界尺寸：840 宽分栏时编辑器与面板至少 272、五个框架按钮完整可见；390×260 时面板压缩、给其余 Part 留 120px；390×230 时退到标题头，显示与还原仍可完成", async ({page}) => {
        await open(page);
        const fullyVisible = async (): Promise<boolean> => {
            const panel = await box(page, "panel");
            const buttons = await page.locator("[data-panel-action]").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect()).map((rect) => ({x: rect.x, width: rect.width})));
            return buttons.length === 5 && buttons.every((button) => button.width > 0 && button.x >= panel.x - 0.5 && button.x + button.width <= panel.x + panel.width + 0.5);
        };
        await page.setViewportSize({width: 840, height: 900});
        await expect(page.locator("[data-workbench-shell]")).toHaveAttribute("data-shell-layout", "split");
        await expect.poll(async () => (await box(page, "editor")).width).toBeGreaterThanOrEqual(272);
        await expect.poll(fullyVisible).toBe(true);

        // 主体 202：面板压到 82，其余 Part 合计 120
        await page.setViewportSize({width: 390, height: 260});
        await expect(page.locator("[data-workbench-shell]")).toHaveAttribute("data-shell-layout", "compact");
        await expect.poll(async () => (await box(page, "panel")).height).toBe(82);
        // 主体 172：面板的最小高度 80 也放不下，退到标题头
        await page.setViewportSize({width: 390, height: 230});
        await expect.poll(async () => (await box(page, "panel")).height).toBe(32);
        expect((await box(page, "editor")).height).toBeGreaterThan(20);
        await expect(page.locator("[data-workbench-shell]")).toHaveAttribute("data-layout-diagnostics", /标题头/u);
        await frame(page, "set-panel-hidden").click();
        await expect(page.locator("[data-leaf=\"panel\"]")).toHaveCount(0);
        await page.locator("[data-shell-focus-target=\"panel-toggle\"]").click();
        await expect.poll(async () => (await box(page, "panel")).height).toBe(32);
        await expect.poll(fullyVisible).toBe(true);
    });

    test("同一客户端的两个窗口：一个改位置、一个改对齐，刷新后两项都在", async ({browser}) => {
        const context = await browser.newContext({viewport: {width: 1440, height: 900}});
        const a = await context.newPage();
        const b = await context.newPage();
        await open(a);
        await open(b);
        await runCommand(a, "面板位置");
        await choose(a, "顶部");
        await expect.poll(async () => bottom(await box(a, "panel")) <= (await box(a, "editor")).y + 1).toBe(true);
        await runCommand(b, "面板对齐");
        await choose(b, "两端");
        await expect.poll(async () => Math.abs((await box(b, "panel")).x - (await box(b, "sidebar")).x)).toBeLessThan(1);
        // 另一窗口保存后，本窗口的当前显示不被强改：a 仍是居中。
        expect(Math.abs((await box(a, "panel")).x - (await box(a, "editor")).x)).toBeLessThan(1);
        for (const page of [a, b]) {
            await page.reload();
            await open(page);
            await expect.poll(async () => {
                const [p, e, s] = [await box(page, "panel"), await box(page, "editor"), await box(page, "sidebar")];
                return bottom(p) <= e.y + 1 && Math.abs(p.x - s.x) < 1;
            }).toBe(true);
        }
        await context.close();
    });

    test("外壳、面板与状态栏的底色、文字颜色、字体与分隔线取主题 token 的解析值", async ({page}) => {
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
                ...read(".workbench-panel-surface", {"background-color": "--panel-surface"}),
                ...read(".workbench-panel-surface__title", {"color": "--text-secondary"}),
                ...read("[data-workbench-status-bar]", {"background-color": "--shell-chrome-surface", "border-top-color": "--shell-chrome-line", "color": "--text-secondary"}),
            ];
        });
        for (const {selector, property, own, token} of resolved) expect(own, `${selector} ${property}`).toBe(token);
        // 面板标题行不画底线（卡片与平铺都一样）；页面根不预留滚动条位置，外壳贴到视口右缘。
        expect(await page.locator(".workbench-panel-surface__head").evaluate((head) => getComputedStyle(head).borderBottomWidth)).toBe("0px");
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

    test("横向容器收成 32px 竖条：长标题在竖条里截断并带省略号，不伸出竖条底边，展开按钮仍在顶部", async ({page}) => {
        await page.goto(`${dev.pageUrl}lab?c=WorkbenchViewSection&s=horizontal-collapsed&vp=300x260`);
        await expect(page.locator("[data-lab-subject] [data-view-toggle]")).toBeVisible();
        const facts = await page.evaluate(() => {
            // 场景的标题是短的：换成放不下的长标题再量（只改文字，量的是布局）。
            const handle = document.querySelector(".workbench-view-section__handle")!;
            handle.textContent = "一个很长很长很长很长很长很长很长很长很长很长很长的视图标题";
            const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
            const head = box(".workbench-view-section__head");
            return {inside: box(".workbench-view-section__title").bottom <= head.bottom, ellipsis: getComputedStyle(handle).textOverflow === "ellipsis" && handle.scrollHeight > handle.clientHeight, toggleOnTop: box("[data-view-toggle]").top < box(".workbench-view-section__title").top};
        });
        expect(facts).toEqual({inside: true, ellipsis: true, toggleOnTop: true});
    });

    test("Lab 外壳场景里拖到顶即最大化、往下拖还原：松手后保持（场景接住了补丁里的最大化）", async ({page}) => {
        await page.goto(`${dev.pageUrl}lab?c=WorkbenchShellLayout&s=default`);
        await expect(page.locator("[data-shell-sample]")).toBeVisible();
        const sash = page.getByRole("separator", {name: "调整 editor 与 panel 的高度"});
        const editorParked = () => page.locator("[data-shell-slot=\"editor\"]").evaluate((element) => element.closest("[data-shell-parking]") !== null);
        const drag = async (dy: number): Promise<void> => {
            const found = await sash.boundingBox();
            if (found === null) throw new Error("没有面板与编辑器之间的边界");
            await page.mouse.move(found.x + found.width / 2, found.y + found.height / 2);
            await page.mouse.down();
            await page.mouse.move(found.x + found.width / 2, found.y + found.height / 2 + dy, {steps: 8});
            await page.mouse.up();
        };
        await drag(-2000);
        // 编辑器内容只在投影真的最大化时才停放：场景没接住补丁时投影仍是展开，内容不会进停放区。
        await expect.poll(editorParked).toBe(true);
        expect((await box(page, "editor")).height).toBe(0);
        await drag(300);
        await expect.poll(editorParked).toBe(false);
        expect((await box(page, "editor")).height).toBeGreaterThan(0);
    });

    test("同一场景里换位置、最大化、隐藏、紧凑往返：编辑器样例不重挂，输入与滚动保留", async ({page}) => {
        await page.goto(`${dev.pageUrl}lab?c=WorkbenchShellLayout&s=default`);
        const sample = page.locator("[data-shell-sample]");
        await expect(sample).toBeVisible();
        const identity = async () => [await sample.getAttribute("data-shell-sample"), await sample.getAttribute("data-created")];
        // 先确认探针有判别力：换场景会重挂整个 fixture，实例编号与创建次数都变大。
        const first = await identity();
        // 换组件再换回来：Lab 卸载再挂载 fixture，页面不重载，模块里的计数延续。
        const tree = (name: string) => page.locator('.lab-columns > .nb-lab-panel--nav [role="treeitem"]').filter({hasText: new RegExp(`^${name}$`, "u")});
        await tree("WorkbenchStatusBar").click();
        await expect(sample).toHaveCount(0);
        await tree("WorkbenchShellLayout").click();
        await expect(sample).toBeVisible();
        const before = await identity();
        expect(before).not.toEqual(first);
        await page.locator("[data-shell-sample-input] input").fill("草稿");
        const scroller = page.locator("[data-shell-sample-scroll]");
        await scroller.evaluate((element) => {
            element.scrollTop = 300;
        });
        const controls = page.locator("#lab-fixture-controls-target");
        // 最大化那一步编辑器内容停放（不可见）；停放中读不到滚动位置，还原后再核对。
        const steps: ReadonlyArray<readonly [() => Promise<void>, boolean]> = [
            [() => controls.getByRole("radio", {name: "左侧"}).click(), true],
            [() => controls.getByRole("button", {name: "最大化"}).click(), false],
            [() => controls.getByRole("button", {name: "还原"}).click(), true],
            [() => controls.getByRole("button", {name: "隐藏面板"}).click(), true],
            [() => controls.getByRole("button", {name: "显示面板"}).click(), true],
            [() => page.locator("button").filter({hasText: /^手机$/u}).click(), true],
            [() => page.locator("button").filter({hasText: /^随窗口$/u}).click(), true],
        ];
        for (const [step, visible] of steps) {
            await step();
            if (visible) await expect(sample).toBeVisible();
            else await expect(sample).toBeHidden();
            expect(await identity()).toEqual(before);
            await expect(page.locator("[data-shell-sample-input] input")).toHaveValue("草稿");
            if (visible) await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(300);
        }

        // 最大化时编辑器内容停放：从面板标题按 Tab，焦点不会进入看不见的样例输入。
        await controls.getByRole("button", {name: "最大化"}).click();
        await expect(sample).toBeHidden();
        await page.locator("[data-shell-focus-target=\"panel-title\"]").focus();
        await page.keyboard.press("Tab");
        expect(await page.evaluate(() => document.activeElement?.closest("[data-shell-parking]") !== null && document.activeElement?.closest("[data-shell-parking]") !== undefined)).toBe(false);
        await controls.getByRole("button", {name: "还原"}).click();
        await expect(sample).toBeVisible();
        expect(await identity()).toEqual(before);
    });

    test("直接打开 Lab：不打开、不订阅产品布局记录；打开产品页才会", async ({browser}) => {
        const context = await browser.newContext();
        const watch = async (path: string): Promise<string[]> => {
            const page = await context.newPage();
            const frames: string[] = [];
            page.on("websocket", (socket) => socket.on("framesent", (sent) => frames.push(String(sent.payload))));
            await page.goto(`${dev.pageUrl}${path}`);
            return frames;
        };
        const lab = await watch("lab?c=WorkbenchShellLayout&s=default");
        // 没有项目的 `/` 是书架页、不读布局记录（ui.workbench-shell 输出 36），空工作台在 `/workbench`。
        const product = await watch("workbench");
        await expect.poll(() => product.some((frame) => frame.includes("views-customizations"))).toBe(true);
        expect(lab.filter((frame) => frame.includes("views-customizations") || frame.includes("layout-sizes"))).toEqual([]);
        await context.close();
    });
});
