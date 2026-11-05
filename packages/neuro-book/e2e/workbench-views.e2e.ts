/**
 * 外壳二在真实 Chrome 中的验收（docs/specs/ui/workbench-shell.md 外壳二验收 14–18、26–31，docs/specs/workbench/views.md
 * 验收 1–5）：生产构建的 e2e 测试外壳与宿主测试入口，测试插件 `test.sample-views`（src/web/testing/sample-views.ts）
 * 贡献六个视图。等页面上可观察的变化，不按时长等待。
 *
 * 不在这里的：落位与意图合成的逐条规则（`views/model.test.ts`）、两个窗口与保存失败（`state/layout-store.test.ts`）、
 * 注册表与内核撤回的串行窗口（`views/registry.test.ts`）、命令的参数与过期（`commands/view-commands.test.ts`）。
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

const sample = (page: Page, viewId: string) => page.locator(`[data-sample-view="${viewId}"]`);

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

/** 经“移动到”菜单移动：`trigger` 是菜单按钮所在的范围（侧栏、右栏、面板或视图分节）。 */
async function moveVia(page: Page, scope: string, viewId: string, target: string): Promise<void> {
    await page.locator(`${scope} [data-move-view="${viewId}"]`).click();
    await page.getByRole("menuitem", {name: new RegExp(`^${target}`, "u")}).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
}

async function instanceOf(page: Page, viewId: string): Promise<{instance: string | null; generation: string | null; location: string | null}> {
    return sample(page, viewId).evaluate((element) => ({instance: element.getAttribute("data-instance"), generation: element.getAttribute("data-generation"), location: element.getAttribute("data-location")}));
}

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

    /** 本页的客户端身份：`local` 记录按它分行，后端由各用例共用，只看本用例这一行。 */
    async function clientOf(page: Page): Promise<string> {
        const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
        if (client === null) throw new Error("页面还没有客户端身份");
        return client;
    }

    /** 本页客户端的工作台定制记录：值与修订号；还没写过为 null 与 0。 */
    async function customizations(page: Page): Promise<{value: Record<string, unknown> | null; revision: number}> {
        const client = await clientOf(page);
        const db = new DatabaseSync(userDatabase());
        try {
            const row = db.prepare("SELECT value, revision FROM records WHERE owner = 'nbook.workbench' AND key = 'views-customizations' AND client = ?1").get(client) as {value: string; revision: number} | undefined;
            return row === undefined ? {value: null, revision: 0} : {value: JSON.parse(row.value) as Record<string, unknown>, revision: Number(row.revision)};
        } finally {
            db.close();
        }
    }

    /** 在本页客户端的工作台定制记录里加上隐藏 Sidebar（外壳二还没有隐藏它的界面）。 */
    async function hideSidebarInRecord(page: Page): Promise<void> {
        const client = await clientOf(page);
        const db = new DatabaseSync(userDatabase());
        try {
            const row = db.prepare("SELECT rowid AS id, value FROM records WHERE owner = 'nbook.workbench' AND key = 'views-customizations' AND client = ?1").get(client) as {id: number; value: string};
            const value = JSON.parse(row.value) as Record<string, unknown>;
            db.prepare("UPDATE records SET value = ?1 WHERE rowid = ?2").run(JSON.stringify({...value, hiddenParts: ["sidebar"]}), row.id);
        } finally {
            db.close();
        }
    }

    async function open(page: Page): Promise<void> {
        await page.goto(new URL("/workbench", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(page.locator("[data-shell-focus-target=\"panel-toggle\"]")).toBeEnabled();
    }

    test("面板拖到零后刷新、视图还没加载过：按住往外拉，松手前视图就加载并可见（外壳一输出 8）", async ({page}) => {
        await open(page);
        await expect(sample(page, E)).toBeVisible();
        const sash = page.getByRole("separator", {name: "调整 editor 与 panel 的高度"});
        const press = async (): Promise<{x: number; y: number}> => {
            const found = await sash.boundingBox();
            if (found === null) throw new Error("没有面板与编辑器之间的边界");
            const start = {x: found.x + found.width / 2, y: found.y + found.height / 2};
            await page.mouse.move(start.x, start.y);
            await page.mouse.down();
            return start;
        };
        let start = await press();
        await page.mouse.move(start.x, start.y + 700, {steps: 6});
        await page.mouse.up();
        await expect(sample(page, E)).toBeHidden();
        await page.reload();
        await open(page);
        // 刷新后面板仍拖到零：面板里的视图一次都没加载
        await expect(sample(page, E)).toHaveCount(0);
        start = await press();
        await page.mouse.move(start.x, start.y - 220, {steps: 10});
        await expect(sample(page, E)).toBeVisible();
        await page.mouse.up();
        await expect(sample(page, E)).toBeVisible();
    });

    test("侧栏拖到零与从零拉出：松手前活动栏就随之独立或与侧栏相连（外壳一输出 8、38）", async ({page}) => {
        await open(page);
        const activitybar = page.locator("[data-shell-card=\"activitybar\"]");
        await expect(activitybar).toHaveAttribute("data-shell-join", "start");
        const sash = page.getByRole("separator", {name: "调整 sidebar 与 panel-stack 的宽度"});
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

    test("标题动作与滚动条随鼠标显示：鼠标在外时动作透明、没有滑块、内容不让宽；移入、Tab 进入或菜单开着时动作可见；拖滑块按比例滚动（验收 9）", async ({page}) => {
        await open(page);
        await page.locator(`[data-activity-container="view:${B}"]`).click();
        const frame = page.locator(`[data-view-frame="${B}"]`);
        const scroller = frame.locator("[data-view-scroller]");
        const bar = frame.locator("[data-overlay-scrollbar]");
        const actions = page.locator('[data-tool-part="sidebar"] [data-hover-actions]');
        await expect(scroller).toBeVisible();

        // 鼠标在侧栏之外、焦点不在侧栏里。
        await page.mouse.move(1000, 400);
        await page.locator("body").evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await expect(actions).toHaveCSS("opacity", "0");
        await expect(bar).not.toHaveAttribute("data-shown");
        expect(await scroller.evaluate((element: HTMLElement) => element.offsetWidth - element.clientWidth)).toBe(0);
        expect(await scroller.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

        await frame.hover();
        await expect(actions).toHaveCSS("opacity", "1");
        await expect(bar).toHaveAttribute("data-shown", "");

        // 鼠标移开，焦点 Tab 到动作上：仍可见。
        await page.mouse.move(1000, 400);
        await actions.locator(`[data-move-view="${B}"]`).focus();
        await expect(actions).toHaveCSS("opacity", "1");
        // “移动到”的菜单开着、鼠标在菜单上：不消失。
        await actions.locator(`[data-move-view="${B}"]`).click();
        const menu = page.getByRole("menu");
        await expect(menu).toBeVisible();
        await menu.getByRole("menuitem").first().hover();
        await expect(actions).toHaveCSS("opacity", "1");
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);

        // 拖滑块：滑块走了多少比例，内容就滚多少比例。
        await frame.hover();
        const thumb = bar.locator("[data-overlay-scrollbar-thumb]");
        const box = await thumb.boundingBox();
        if (box === null) throw new Error("没有滑块");
        expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0);
        await page.mouse.move(box.x + box.width / 2, box.y + 4);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, box.y + 4 + 30, {steps: 4});
        await page.mouse.up();
        const moved = await scroller.evaluate((element) => ({scrollTop: element.scrollTop, range: element.scrollHeight - element.clientHeight, travel: element.clientHeight}));
        const track = await bar.evaluate((element) => element.getBoundingClientRect().height);
        const expected = (30 / (track - box.height)) * moved.range;
        expect(Math.abs(moved.scrollTop - expected)).toBeLessThanOrEqual(2);
    });

    test("全链路：视图按声明出现在默认位置，第一次有效可见才加载，代际为 1", async ({page}) => {
        await open(page);
        await expect(sample(page, A)).toBeVisible();
        expect(await instanceOf(page, A)).toMatchObject({generation: "1", location: "sidebar"});
        await expect(sample(page, D)).toBeVisible();
        await expect(sample(page, E)).toBeVisible();
        // 侧栏的乙、丙在没选中的容器里：还没加载。
        await expect(page.locator(`[data-view-frame="${B}"]`)).toHaveCount(0);
        await expect(page.locator("[data-activity-container]")).toHaveCount(3);
    });

    test("视图的内边距只有外框一个来源：fill 的样例甲与 scroll 的样例丁，第一行文字离各自外框的距离相同且不为零", async ({page}) => {
        await open(page);
        const offset = (viewId: string) => page.locator(`[data-view-frame="${viewId}"]`).evaluate((frame) => {
            const line = frame.querySelector("[data-sample-view] > :first-child");
            if (line === null) throw new Error("样例视图没有第一行");
            const outer = frame.getBoundingClientRect();
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

    test("编辑器槽：挂测试插件贡献的内容；面板最大化时停放（visible 为假）不重挂，还原后同一实例", async ({page}) => {
        await open(page);
        const area = page.locator("[data-sample-editor-area]");
        await expect(area).toHaveAttribute("data-visible", "true");
        await expect(page.locator("[data-shell-slot=\"editor\"] [data-sample-editor-area]")).toHaveCount(1);
        const instance = await area.getAttribute("data-instance");
        await page.locator("[data-panel-action=\"nbook.view.toggle-panel-maximized\"]").click();
        await expect(area).toHaveAttribute("data-visible", "false");
        await page.locator("[data-panel-action=\"nbook.view.toggle-panel-maximized\"]").click();
        await expect(area).toHaveAttribute("data-visible", "true");
        expect(await area.getAttribute("data-instance")).toBe(instance);
    });

    test("活动栏：选择互斥；再点当前项收起、再点又打开；Sidebar 被隐藏或拖到零时点容器同时打开它，拖到零的按记忆尺寸展开", async ({page}) => {
        await open(page);
        const item = (viewId: string) => page.locator(`[data-activity-container="view:${viewId}"]`);
        await expect(item(A)).toHaveAttribute("aria-pressed", "true");
        await item(B).click();
        await expect(item(B)).toHaveAttribute("aria-pressed", "true");
        await expect(item(A)).toHaveAttribute("aria-pressed", "false");
        await expect(sample(page, B)).toBeVisible();
        await expect(sample(page, A)).toBeHidden();

        // 隐藏 Sidebar（Part 显隐，外壳二还没有隐藏它的界面）：把本窗口刚写下的定制记录改成隐藏，刷新后生效。
        await expect.poll(async () => ((await customizations(page)).value?.selected as Record<string, string> | undefined)?.sidebar).toBe(`view:${B}`);
        await hideSidebarInRecord(page);
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(page.locator('[data-tool-part="sidebar"]')).toBeHidden();
        await expect(item(B)).toHaveAttribute("aria-pressed", "false");
        await item(B).click();
        await expect(page.locator('[data-tool-part="sidebar"]')).toBeVisible();
        await expect(item(B)).toHaveAttribute("aria-pressed", "true");

        // 拖到零：内容停放；点另一项切换并按记忆尺寸展开。
        const width = (await page.locator('[data-leaf="sidebar"]').boundingBox())!.width;
        const sash = page.getByRole("separator", {name: "调整 sidebar 与 panel-stack 的宽度"});
        await sash.focus();
        await page.keyboard.press("Enter");
        await expect(page.locator('[data-tool-part="sidebar"]')).toBeHidden();
        await item(C).click();
        await expect(sample(page, C)).toBeVisible();
        await expect.poll(async () => Math.round((await page.locator('[data-leaf="sidebar"]').boundingBox())!.width)).toBe(Math.round(width));

        // 再点当前项：收起；再点：以同一个容器、同样的宽度打开。
        await item(C).click();
        await expect(page.locator('[data-tool-part="sidebar"]')).toBeHidden();
        await expect(item(C)).toHaveAttribute("aria-pressed", "false");
        await item(C).click();
        await expect(sample(page, C)).toBeVisible();
        await expect(item(C)).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => Math.round((await page.locator('[data-leaf="sidebar"]').boundingBox())!.width)).toBe(Math.round(width));
    });

    test("移动到：乙并进甲的容器（single→multiple，乙的实例不变）；甲移到面板后操作甲的容器，乙不随甲走；重置后回到初始；刷新后一致", async ({page}) => {
        await open(page);
        const before = (await customizations(page)).revision;
        await page.locator(`[data-activity-container="view:${B}"]`).click();
        await sample(page, B).locator("input").fill("乙的草稿");
        const beta = await instanceOf(page, B);
        await moveVia(page, '[data-tool-part="sidebar"]', B, "样例甲");
        await expect(page.locator(`[data-container-host="view:${A}"]`)).toHaveAttribute("data-container-mode", "multiple");
        await expect(page.locator(`[data-activity-container="view:${B}"]`)).toHaveCount(0);
        expect(await instanceOf(page, B)).toEqual(beta);
        await expect(sample(page, B).locator("input")).toHaveValue("乙的草稿");

        // 甲移进面板的戊；view:甲 仍在，只剩乙，标题回落到乙。
        await moveVia(page, `[data-view-section="${A}"]`, A, "样例戊");
        await expect(page.locator(`[data-container-host="view:${E}"]`)).toHaveAttribute("data-container-mode", "multiple");
        await expect(page.locator(`[data-activity-container="view:${A}"]`)).toHaveAttribute("aria-label", "样例乙");
        await expect(page.locator(`[data-container-host="view:${A}"]`)).toHaveAttribute("data-container-mode", "single");
        // 操作 view:甲 的菜单（现在是乙的上提菜单）：把乙移进右栏的丁，乙走、甲不受影响。
        await moveVia(page, '[data-tool-part="sidebar"]', B, "样例丁");
        expect(await instanceOf(page, A)).toMatchObject({location: "panel"});
        expect(await instanceOf(page, B)).toMatchObject({location: "auxiliarybar", instance: beta.instance});

        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(page.locator(`[data-container-host="view:${D}"]`)).toHaveAttribute("data-container-mode", "multiple");
        await expect(page.locator(`[data-container-host="view:${E}"]`)).toHaveAttribute("data-container-mode", "multiple");

        await moveVia(page, `[data-view-section="${A}"]`, A, "重置位置");
        await moveVia(page, `[data-view-section="${B}"]`, B, "重置位置");
        await expect(page.locator("[data-activity-container]")).toHaveCount(3);
        expect((await customizations(page)).revision).toBeGreaterThan(before);
        expect((await customizations(page)).value?.views ?? {}).toEqual({});
    });

    test("命令面板的移动视图：先选视图、再选目标；取消任一步不写", async ({page}) => {
        await open(page);
        const before = (await customizations(page)).revision;
        await runCommand(page, "移动视图");
        await pick(page, "选择要移动的视图", "样例丙");
        // 第二步打开后再取消：Escape 早于它到达会落空。
        await expect(page.getByRole("combobox", {name: "移动到"})).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("combobox")).toHaveCount(0);
        expect((await customizations(page)).revision).toBe(before);

        await runCommand(page, "移动视图");
        await pick(page, "选择要移动的视图", "样例丙");
        await pick(page, "移动到", "样例丁");
        await expect(page.locator(`[data-container-host="view:${D}"]`)).toHaveAttribute("data-container-mode", "multiple");
        await expect.poll(async () => (await customizations(page)).revision).toBeGreaterThan(before);
    });

    test("命令面板的打开视图（views.md 输出 14）：选一个视图，所在的侧栏被隐藏时一并显示、选中它的容器；取消不写", async ({page}) => {
        await open(page);
        const item = (viewId: string) => page.locator(`[data-activity-container="view:${viewId}"]`);
        // 先在本窗口写下一份定制记录（切到乙），再把它改成隐藏侧栏，刷新后生效。
        await item(B).click();
        await expect.poll(async () => ((await customizations(page)).value?.selected as Record<string, string> | undefined)?.sidebar).toBe(`view:${B}`);
        await hideSidebarInRecord(page);
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(page.locator('[data-tool-part="sidebar"]')).toBeHidden();

        const before = (await customizations(page)).revision;
        await runCommand(page, "打开视图");
        await expect(page.getByRole("combobox", {name: "选择要打开的视图"})).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("combobox")).toHaveCount(0);
        expect((await customizations(page)).revision).toBe(before);

        await runCommand(page, "打开视图");
        await pick(page, "选择要打开的视图", "样例丙");
        await expect(page.locator('[data-tool-part="sidebar"]')).toBeVisible();
        await expect(item(C)).toHaveAttribute("aria-pressed", "true");
        await expect(sample(page, C)).toBeVisible();
    });

    test("收起：multiple 点标题行收起甲 → 乙移出后甲在 single 展开但记录不变 → 乙回来甲重新收起；面板横向收起成竖条、键盘展开", async ({page}) => {
        await open(page);
        await page.locator(`[data-activity-container="view:${B}"]`).click();
        await moveVia(page, '[data-tool-part="sidebar"]', B, "样例甲");
        const section = (viewId: string) => page.locator(`[data-view-section="${viewId}"]`);
        // 标题行整行可点：点标题文字，不点展开标记。
        await section(A).locator(".workbench-view-section__title").click();
        await expect(section(A)).toHaveAttribute("data-view-collapsed", "true");
        await expect.poll(async () => (((await customizations(page)).value?.views as Record<string, {collapsed?: boolean}> | undefined)?.[A]?.collapsed)).toBe(true);

        // 重置把乙送回自己的容器并选中它；切回甲的容器看。
        await moveVia(page, `[data-view-section="${B}"]`, B, "重置位置");
        await page.locator(`[data-activity-container="view:${A}"]`).click();
        await expect(page.locator(`[data-container-host="view:${A}"]`)).toHaveAttribute("data-container-mode", "single");
        await expect(section(A)).toHaveAttribute("data-view-collapsed", "false");
        await expect(sample(page, A)).toBeVisible();
        expect((((await customizations(page)).value?.views as Record<string, {collapsed?: boolean}>)[A])?.collapsed).toBe(true);

        await page.locator(`[data-activity-container="view:${B}"]`).click();
        await moveVia(page, '[data-tool-part="sidebar"]', B, "样例甲");
        await expect(section(A)).toHaveAttribute("data-view-collapsed", "true");

        // 面板横向：丁并进戊的容器，收起丁成 32px 竖条，键盘展开。
        await moveVia(page, '[data-tool-part="auxiliarybar"]', D, "样例戊");
        await section(D).locator("[data-view-toggle]").click();
        await expect(section(D)).toHaveAttribute("data-view-collapsed", "true");
        await expect.poll(async () => Math.round((await section(D).boundingBox())!.width)).toBe(32);
        await section(D).locator("[data-view-toggle]").focus();
        await page.keyboard.press("Enter");
        await expect(section(D)).toHaveAttribute("data-view-collapsed", "false");
        await expect(sample(page, D)).toBeVisible();
    });

    test("容器网格：拖动视图之间的边界只写主动视图的当前轴；键盘调整；Escape 取消不写", async ({page}) => {
        await open(page);
        await page.locator(`[data-activity-container="view:${B}"]`).click();
        await moveVia(page, '[data-tool-part="sidebar"]', B, "样例甲");
        const sash = page.getByRole("separator", {name: `调整 ${A} 与 ${B} 的高度`});
        await expect(sash).toBeVisible();
        const before = (await customizations(page)).revision;
        const heightOf = async (viewId: string) => (await page.locator(`[data-view-section="${viewId}"]`).boundingBox())!.height;
        const startA = await heightOf(A);
        const bounds = (await sash.boundingBox())!;
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 - 80, {steps: 5});
        await page.mouse.up();
        await expect.poll(async () => (await customizations(page)).revision).toBeGreaterThan(before);
        const views = (await customizations(page)).value?.views as Record<string, {height?: number; width?: number}>;
        expect(views[A]?.height).toBeCloseTo(startA - 80, 0);
        expect(views[A]?.width).toBeUndefined();

        const afterDrag = (await customizations(page)).revision;
        const baseline = [await heightOf(A), await heightOf(B)];
        await sash.focus();
        await page.keyboard.down("ArrowUp");
        await expect.poll(() => heightOf(A)).toBeLessThan(baseline[0]!);
        await page.keyboard.press("Escape");
        await page.keyboard.up("ArrowUp");
        await expect.poll(async () => [await heightOf(A), await heightOf(B)]).toEqual(baseline);
        expect((await customizations(page)).revision).toBe(afterDrag);

        await sash.focus();
        await page.keyboard.press("ArrowDown");
        await expect.poll(async () => (await customizations(page)).revision).toBeGreaterThan(afterDrag);
        expect(((await customizations(page)).value?.views as Record<string, {height?: number}>)[A]?.height).toBeCloseTo(startA - 70, 0);
    });

    test("实例保留：fill 与 scroll 两种视图在 1→2→1、跨容器、跨 Part、Part 拖到零再展开之后，输入、滚动与焦点都还在，实例不重建", async ({page}) => {
        await open(page);
        const fillScroll = sample(page, A).locator("[data-sample-scroll]");
        await sample(page, A).locator("input").fill("甲的草稿");
        await fillScroll.evaluate((element) => {
            element.scrollTop = 240;
        });
        const alpha = await instanceOf(page, A);
        // scroll 布局的视图由视图框负责滚动：滚动盒随实例一起搬动。
        const scrollerOf = (viewId: string) => page.locator(`[data-view-frame="${viewId}"] [data-view-scroller]`);
        await page.locator(`[data-activity-container="view:${B}"]`).click();
        await scrollerOf(B).evaluate((element) => {
            element.scrollTop = 200;
        });
        const beta = await instanceOf(page, B);

        await moveVia(page, '[data-tool-part="sidebar"]', B, "样例甲");
        await moveVia(page, `[data-view-section="${B}"]`, B, "样例戊");
        await moveVia(page, `[data-view-section="${B}"]`, B, "重置位置");
        await page.locator(`[data-activity-container="view:${A}"]`).click();
        await sample(page, A).locator("input").focus();
        await moveVia(page, '[data-tool-part="sidebar"]', A, "样例丁");
        await moveVia(page, `[data-view-section="${A}"]`, A, "重置位置");

        const sash = page.getByRole("separator", {name: "调整 sidebar 与 panel-stack 的宽度"});
        await sash.focus();
        await page.keyboard.press("Enter");
        await expect(page.locator('[data-tool-part="sidebar"]')).toBeHidden();
        await page.keyboard.press("Enter");
        await expect(sample(page, A)).toBeVisible();

        expect(await instanceOf(page, A)).toEqual(alpha);
        await expect(sample(page, A).locator("input")).toHaveValue("甲的草稿");
        await expect.poll(() => fillScroll.evaluate((element) => element.scrollTop)).toBe(240);
        await page.locator(`[data-activity-container="view:${B}"]`).click();
        expect(await instanceOf(page, B)).toEqual(beta);
        await expect.poll(() => scrollerOf(B).evaluate((element) => element.scrollTop)).toBe(200);

        // 焦点：命令面板关闭时把焦点还给乙的输入框，随后乙被搬到面板、再重置回来；两次搬动后焦点都还在它的输入框里。
        const input = sample(page, B).locator("input");
        await input.focus();
        await runCommand(page, "移动视图");
        await pick(page, "选择要移动的视图", "样例乙");
        await pick(page, "移动到", "样例戊");
        await expect(page.locator(`[data-container-host="view:${E}"]`)).toHaveAttribute("data-container-mode", "multiple");
        await expect(input).toBeFocused();
        await runCommand(page, "移动视图");
        await pick(page, "选择要移动的视图", "样例乙");
        await pick(page, "移动到", "重置位置");
        await expect(page.locator(`[data-container-host="view:${E}"]`)).toHaveAttribute("data-container-mode", "single");
        await expect(input).toBeFocused();
        expect(await instanceOf(page, B)).toEqual(beta);
    });

    test("入口激活失败：原位显示原因与重试，布局项保留；消除原因后重试，以新代次交付", async ({page}) => {
        await open(page);
        await moveVia(page, '[data-tool-part="auxiliarybar"]', D, "样例戊");
        await page.evaluate((key) => localStorage.setItem(key, "1"), SAMPLE_VIEWS_SWITCHES.failActivation);
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        const frame = page.locator(`[data-view-frame="${E}"]`);
        await expect(frame).toHaveAttribute("data-view-state", "entry-failed");
        await expect(frame).toContainText("样例视图入口按开关激活失败");
        // 布局项保留：丁仍在戊的容器里（声明在，只是没有交付）。
        await expect(page.locator(`[data-container-host="view:${E}"]`)).toHaveAttribute("data-container-mode", "multiple");

        await page.evaluate((key) => localStorage.removeItem(key), SAMPLE_VIEWS_SWITCHES.failActivation);
        await frame.locator("[data-view-retry-entry]").click();
        await expect(sample(page, E)).toBeVisible();
        expect(await instanceOf(page, E)).toMatchObject({generation: "1", location: "panel"});
        await expect(sample(page, D)).toBeVisible();
    });

    test("入口停止：组件卸载、原位显示停止原因，布局项保留；刷新后回到原位置", async ({page}) => {
        await open(page);
        await moveVia(page, '[data-tool-part="auxiliarybar"]', D, "样例戊");
        await expect(sample(page, D)).toBeVisible();
        await runCommand(page, "停止样例视图入口");
        await expect(page.locator(`[data-view-frame="${D}"]`)).toHaveAttribute("data-view-state", "entry-stopped");
        await expect(sample(page, D)).toHaveCount(0);
        await expect(page.locator(`[data-container-host="view:${E}"]`)).toHaveAttribute("data-container-mode", "multiple");
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(sample(page, D)).toBeVisible();
        expect(await instanceOf(page, D)).toMatchObject({location: "panel"});
    });

    test("加载失败与渲染出错：各自原位给出按钮，只有对应视图换代，同容器的视图不受影响", async ({page}) => {
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
        await page.locator(`[data-activity-container="view:${B}"]`).click();
        const beta = page.locator(`[data-view-frame="${B}"]`);
        await expect(beta).toHaveAttribute("data-view-state", "load-failed");

        await page.evaluate(([load, render]) => {
            localStorage.removeItem(load);
            localStorage.removeItem(render);
        }, [SAMPLE_VIEWS_SWITCHES.failLoad, SAMPLE_VIEWS_SWITCHES.failRender] as const);
        await beta.locator("[data-view-reload]").click();
        await expect(sample(page, B)).toBeVisible();
        expect(await instanceOf(page, B)).toMatchObject({generation: "2"});
        await page.locator(`[data-activity-container="view:${A}"]`).click();
        await delta.locator("[data-view-retry-render]").click();
        await expect(sample(page, D)).toBeVisible();
        expect(await instanceOf(page, D)).toMatchObject({generation: "2"});
        expect(await instanceOf(page, E)).toEqual(omega);
    });

    test("390 × 844：面板的单标签可用键盘聚焦，五个框架按钮都在视口内，键盘打开“移动到”、Escape 关闭并把焦点还给按钮，页面无横向溢出", async ({page}) => {
        await page.setViewportSize({width: 390, height: 844});
        await open(page);
        // 测试插件的面板里只有戊一个容器（外壳二不能新建容器）：多个标签的键盘切换由 nb-ui Tabs 的合同覆盖。
        await page.getByRole("tab", {name: "样例戊"}).focus();
        await expect(page.getByRole("tab", {name: "样例戊"})).toBeFocused();
        for (const action of ["set-panel-position", "set-panel-alignment", "set-panel-collapsed", "toggle-panel-maximized", "set-panel-hidden"]) {
            const button = page.locator(`[data-panel-action="nbook.view.${action}"]`);
            await expect(button).toBeVisible();
            const box = (await button.boundingBox())!;
            expect(box.x + box.width).toBeLessThanOrEqual(390);
        }
        const moveButton = page.locator(`[data-tool-part="panel"], .workbench-panel-surface`).locator(`[data-move-view="${E}"]`).first();
        await moveButton.focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("menu")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(moveButton).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    test("活动栏、工具区域、视图标题行与选中标记的颜色取主题 token 的解析值；部件自己不画外框、圆角与标题行底线；nbook 是卡片外壳、分栏之间是两端缩进的开放式分割线，macos 平铺、分栏线贯穿（外壳验收 41）", async ({page}) => {
        await open(page);
        await page.locator(`[data-activity-container="view:${B}"]`).click();
        await moveVia(page, '[data-tool-part="sidebar"]', B, "样例甲");
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
                ...read(".workbench-activity-bar", {"background-color": "--panel-surface"}),
                ...read(".workbench-activity-bar__item--active", {"color": "--accent-text", "background-color": "--bg-hover"}),
                ...read('[data-tool-part="sidebar"]', {"background-color": "--panel-surface"}),
                ...read(".workbench-view-section__title", {"color": "--text-secondary"}),
            ].filter((item) => item.own !== item.token);
        });
        await expect.poll(mismatches).toEqual([]);
        const drawn = await page.evaluate(() => [".workbench-activity-bar", '[data-tool-part="sidebar"]', '[data-tool-part="auxiliarybar"]', '[data-tool-part="auxiliarybar"] .workbench-tool-part__head', '[data-tool-part="auxiliarybar"] [role="tablist"]', '.workbench-panel-surface [role="tablist"]', ".workbench-view-section__head"].flatMap((selector) => {
            const style = getComputedStyle(document.querySelector(selector)!);
            const widths = ["top", "right", "bottom", "left"].map((side) => style.getPropertyValue(`border-${side}-width`));
            return widths.some((width) => width !== "0px") || style.borderRadius !== "0px" ? [{selector, widths, radius: style.borderRadius}] : [];
        }));
        expect(drawn).toEqual([]);

        // 外壳的分隔方式：卡片的矩形、圆角与相连处，标题栏底线与网格接缝的颜色；卡片里分栏之间的线（侧栏此刻是甲、乙两个分栏）。
        const shellLook = () => page.evaluate(() => {
            const card = (part: string) => document.querySelector(`[data-shell-card="${part}"]`)!;
            const box = (part: string) => card(part).getBoundingClientRect();
            const probe = document.createElement("div");
            probe.style.backgroundColor = "var(--divider)";
            document.body.append(probe);
            const divider = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return {
                titlebarBottom: document.querySelector("[data-workbench-titlebar]")!.getBoundingClientRect().bottom,
                activitybar: box("activitybar").toJSON() as DOMRect,
                sidebar: box("sidebar").toJSON() as DOMRect,
                editor: box("editor").toJSON() as DOMRect,
                editorRadius: getComputedStyle(card("editor")).borderTopLeftRadius,
                activityCorners: [getComputedStyle(card("activitybar")).borderTopLeftRadius, getComputedStyle(card("activitybar")).borderTopRightRadius],
                sidebarCorners: [getComputedStyle(card("sidebar")).borderTopLeftRadius, getComputedStyle(card("sidebar")).borderTopRightRadius],
                joinLine: getComputedStyle(card("activitybar"), "::after").backgroundColor,
                titlebarLine: getComputedStyle(document.querySelector("[data-workbench-titlebar]")!).borderBottomColor,
                seams: [...new Set([...document.querySelectorAll("[data-workbench-shell] .sash-seam")].filter((seam) => seam.closest("[data-container-host]") === null).map((seam) => getComputedStyle(seam).backgroundColor))],
                paneSeams: [...document.querySelectorAll("[data-container-host] .sash-seam")].map((seam) => {
                    const style = getComputedStyle(seam);
                    const [start, end] = (seam as HTMLElement).dataset.axis === "width" ? [style.top, style.bottom] : [style.left, style.right];
                    return {color: style.backgroundColor, start, end};
                }),
                divider,
            };
        });
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
        expect(nbook.paneSeams).toEqual([{color: nbook.divider, start: "10px", end: "10px"}]);

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
            expect(macos.paneSeams).toEqual([{color: macos.divider, start: "0px", end: "0px"}]);
        } finally {
            await rm(settings, {force: true});
        }
    });

    test("拖动边界的悬停线取主题 token：nbook 是 3px 实线、不发光、自由端缩进 16px，交汇处两条同时亮时连着，线芯设细时对齐接缝；macos 是贴满的 3px 实线", async ({page}) => {
        await open(page);
        const sidebarSash = page.locator('[data-sash="body:0"]');
        const panelSash = page.locator('[data-sash="panel-stack:0"]');
        await expect(sidebarSash).toBeVisible();
        await expect(panelSash).toBeVisible();
        // 线盒沿长轴的两端（相对分隔盒）与线芯：线芯的位置按线盒加 ::before 的偏移算，与静止接缝比。
        const lineOf = (key: string) => page.evaluate((sashKey) => {
            const sash = document.querySelector(`[data-sash="${sashKey}"]`)!;
            const line = sash.querySelector<HTMLElement>(".sash-line")!;
            const seam = sash.querySelector<HTMLElement>(".sash-seam")!.getBoundingClientRect();
            const box = line.getBoundingClientRect();
            const style = getComputedStyle(line);
            const core = getComputedStyle(line, "::before");
            const vertical = line.dataset.axis === "width";
            return {
                ends: vertical ? [style.top, style.bottom] : [style.left, style.right],
                coreSize: vertical ? core.width : core.height,
                coreAtSeam: vertical ? box.left + Number.parseFloat(core.left) - seam.left : box.top + Number.parseFloat(core.top) - seam.top,
                glow: core.boxShadow !== "none",
            };
        }, key);
        const centre = async (locator: typeof sidebarSash) => {
            const box = (await locator.boundingBox())!;
            return {x: box.x + box.width / 2, y: box.y + box.height / 2};
        };

        // 只悬停竖线（离交汇处远）：停够时长亮起，两端都是自由端
        const vertical = await centre(sidebarSash);
        const horizontal = await centre(panelSash);
        await page.mouse.move(vertical.x, (await sidebarSash.boundingBox())!.y + 120);
        await expect(sidebarSash).toHaveAttribute("data-sash-revealed", "true");
        expect(await lineOf("body:0")).toMatchObject({ends: ["16px", "16px"], coreSize: "3px", glow: false});
        // 主题把线芯设细时，细线芯对齐静止接缝（不在 3px 装饰带里居中，否则摊成两条半透明的线）
        await page.evaluate(() => document.documentElement.style.setProperty("--sash-line-size", "1px"));
        await page.setViewportSize({width: 1441, height: 900});
        await expect.poll(async () => (await lineOf("body:0")).coreSize).toBe("1px");
        expect((await lineOf("body:0")).coreAtSeam).toBeCloseTo(0, 3);
        await page.evaluate(() => document.documentElement.style.removeProperty("--sash-line-size"));
        await page.setViewportSize({width: 1440, height: 900});

        // 交汇处按下：两条一起亮，横线挨着竖线的左端连着，右端仍缩进
        await page.mouse.move(vertical.x, horizontal.y);
        await page.mouse.down();
        await expect(panelSash).toHaveAttribute("data-sash-active", "true");
        await expect(sidebarSash).toHaveAttribute("data-sash-active", "true");
        expect((await lineOf("panel-stack:0")).ends).toEqual(["0px", "16px"]);
        await page.mouse.up();

        const settings = join(tmp, "state", "settings.json");
        try {
            await writeFile(settings, JSON.stringify({"nbook.workbench/theme": "macos"}));
            await expect(page.locator("html")).toHaveAttribute("data-nb-theme", "macos");
            await page.mouse.move(vertical.x, (await sidebarSash.boundingBox())!.y + 160);
            await expect(sidebarSash).toHaveAttribute("data-sash-revealed", "true");
            const macos = await lineOf("body:0");
            expect(macos.ends).toEqual(["0px", "0px"]);
            expect(macos.coreSize).toBe("3px");
            expect(macos.glow).toBe(false);
        } finally {
            await rm(settings, {force: true});
        }
    });

    test("面板标签带变窄时逐级让位：完整 → 截断 → 选中的留标题其余只留图标 → 收进“更多”，选中的始终带标题；从“更多”选中后它回到标签带", async ({page}) => {
        await open(page);
        // 面板里三个容器：戊、己（长标题）与从右栏搬来的丁
        await moveVia(page, '[data-tool-part="auxiliarybar"]', D, "新建容器（在面板）");
        const band = page.locator('.workbench-panel-surface [data-tabs-level]');
        const level = () => band.getAttribute("data-tabs-level");
        const selectedLabel = () => page.locator('.workbench-panel-surface [role="tab"][aria-selected="true"]').innerText();
        await expect(page.locator('.workbench-panel-surface [role="tab"]')).toHaveCount(3);
        const seen = new Set<string>();
        for (const width of [1920, 1700, 1500, 1440, 1360, 1280, 1200, 1120, 1040, 980, 920, 860]) {
            await page.setViewportSize({width, height: 900});
            await expect.poll(async () => (await band.boundingBox())?.width ?? 0).toBeGreaterThan(0);
            const current = (await level())!;
            seen.add(current);
            // 选中的始终带标题
            expect((await selectedLabel()).trim().length).toBeGreaterThan(0);
            if (current === "3") {
                const more = page.locator('.workbench-panel-surface [data-tabs-more]');
                await expect(more).toBeVisible();
                const shown = await page.locator('.workbench-panel-surface [role="tab"]').count();
                await expect(more).toContainText(`更多 ${String(3 - shown)}`);
            }
        }
        expect([...seen].sort()).toEqual(["0", "1", "2", "3"]);
        // 最窄时键盘移到收起来的标签：它被选中、换到标签带里，焦点落在它身上
        const selectedTab = page.locator('.workbench-panel-surface [role="tab"][aria-selected="true"]');
        await selectedTab.focus();
        for (const key of ["Home", "End"]) {
            const before = await selectedTab.getAttribute("data-tab-value");
            await page.keyboard.press(key);
            await expect(selectedTab).not.toHaveAttribute("data-tab-value", before!);
            await expect(selectedTab).toBeFocused();
        }
        // 最窄时从“更多”选一个收起来的：它被选中，回到标签带（收起来的换成别的）
        await page.locator('.workbench-panel-surface [data-tabs-more]').click();
        const hiddenOne = page.getByRole("menu").getByRole("menuitem").first();
        const name = (await hiddenOne.innerText()).trim();
        await hiddenOne.click();
        await expect(page.locator('.workbench-panel-surface [role="tab"][aria-selected="true"]')).toContainText(name.slice(0, 2));
    });

    test("活动栏放不下时，末尾的条目收进底部的“更多”，选中的总在外面；从“更多”选中后它回到活动栏", async ({page}) => {
        await open(page);
        // 侧栏里放六个容器
        for (const [scope, viewId] of [['[data-tool-part="auxiliarybar"]', D], [".workbench-panel-surface", E], [".workbench-panel-surface", F]] as const) await moveVia(page, scope, viewId, "新建容器（在侧栏）");
        const entries = page.locator("[data-activity-container]");
        await expect(entries).toHaveCount(6);
        await expect(page.locator("[data-activity-more]")).toHaveCount(0);
        await page.setViewportSize({width: 1440, height: 300});
        const more = page.locator("[data-activity-more]");
        await expect(more).toBeVisible();
        await expect.poll(() => entries.count()).toBeLessThan(6);
        const shown = await entries.count();
        // 条目与“更多”都在活动栏里，不滚动
        const band = await page.locator('[data-switcher-band="sidebar"]').evaluate((element) => ({scroll: element.scrollHeight, client: element.clientHeight}));
        expect(band.scroll).toBeLessThanOrEqual(band.client);
        await more.click();
        const menu = page.getByRole("menu").getByRole("menuitem");
        await expect(menu).toHaveCount(6 - shown);
        await menu.last().click();
        const lastId = await page.evaluate(() => [...document.querySelectorAll("[data-activity-container]")].map((element) => element.getAttribute("data-activity-container")));
        await expect(page.locator('[data-activity-container][aria-pressed="true"]')).toHaveCount(1);
        expect(lastId.length).toBe(shown);
    });

    test("容器网格（Panel 横向）：拖动视图之间的边界只写宽度；收成 32px 竖条再展开回到记忆宽度", async ({page}) => {
        await open(page);
        await moveVia(page, '[data-tool-part="auxiliarybar"]', D, "样例戊");
        const sash = page.getByRole("separator", {name: `调整 ${E} 与 ${D} 的宽度`});
        await expect(sash).toBeVisible();
        const widthOf = async (viewId: string) => (await page.locator(`[data-view-section="${viewId}"]`).boundingBox())!.width;
        const startE = await widthOf(E);
        const bounds = (await sash.boundingBox())!;
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width / 2 - 60, bounds.y + bounds.height / 2, {steps: 5});
        await page.mouse.up();
        await expect.poll(async () => ((await customizations(page)).value?.views as Record<string, {width?: number}> | undefined)?.[E]?.width).toBeCloseTo(startE - 60, 0);
        expect(((await customizations(page)).value?.views as Record<string, {height?: number}>)[E]?.height).toBeUndefined();
        const remembered = await widthOf(D);
        await page.locator(`[data-view-section="${D}"] [data-view-toggle]`).click();
        await expect.poll(async () => Math.round(await widthOf(D))).toBe(32);
        await page.locator(`[data-view-section="${D}"] [data-view-toggle]`).click();
        await expect.poll(async () => Math.round(await widthOf(D))).toBe(Math.round(remembered));
    });

    test("focusedPart：焦点进到侧栏、面板时随之变化，焦点移到外壳之外的命令面板时保持", async ({page}) => {
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

    test("标签带：标签与内容面板互相关联；长标题标签与“移动到”、五个框架按钮在 840 宽下都完整可点；方向键切换面板的容器", async ({page}) => {
        await page.setViewportSize({width: 840, height: 900});
        await open(page);
        const tab = page.getByRole("tab", {name: "样例戊"});
        const panelId = await tab.getAttribute("aria-controls");
        expect(panelId).not.toBeNull();
        const panel = page.locator(`[id="${panelId!}"]`);
        await expect(panel).toHaveAttribute("role", "tabpanel");
        await expect(panel).toHaveAttribute("aria-labelledby", (await tab.getAttribute("id"))!);
        // 每个可点的东西：中心点命中的就是它自己。
        const hitsItself = (selector: string) => page.locator(selector).first().evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return rect.width > 0 && hit !== null && (hit === element || element.contains(hit));
        });
        await expect.poll(() => hitsItself(`.workbench-panel-surface [data-move-view="${E}"]`)).toBe(true);
        for (const action of ["set-panel-position", "set-panel-alignment", "set-panel-collapsed", "toggle-panel-maximized", "set-panel-hidden"]) {
            expect(await hitsItself(`[data-panel-action="nbook.view.${action}"]`), action).toBe(true);
        }
        expect(await tab.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(0);
        await tab.focus();
        await page.keyboard.press("ArrowRight");
        await expect(page.getByRole("tab", {name: /^样例己/u})).toBeFocused();
        await expect(sample(page, F)).toBeVisible();
        await expect(sample(page, E)).toBeHidden();
    });

    test("390 × 260：容器网格压到正文没有空间时，视图内容停放：不进 Tab 顺序、visible 为假；空间回来时实例不变", async ({page}) => {
        await open(page);
        await page.locator(`[data-activity-container="view:${B}"]`).click();
        await moveVia(page, '[data-tool-part="sidebar"]', B, "样例甲");
        const alpha = await instanceOf(page, A);
        await page.setViewportSize({width: 390, height: 260});
        await expect(page.locator("[data-workbench-shell]")).toHaveAttribute("data-shell-layout", "compact");
        await expect(page.locator(`[data-view-frame="${A}"]`)).toHaveCount(1);
        await expect.poll(() => page.locator(`[data-view-frame="${A}"]`).evaluate((element) => element.closest("[data-view-parking]") !== null)).toBe(true);
        await expect.poll(() => sample(page, A).getAttribute("data-visible")).toBe("false");
        // 从状态栏一路 Tab：焦点不会落进停放的样例输入。
        await page.locator("[data-shell-focus-target=\"panel-toggle\"]").focus();
        for (let step = 0; step < 30; step += 1) {
            await page.keyboard.press("Tab");
            expect(await page.evaluate(() => document.activeElement?.closest("[data-view-parking]") !== null)).toBe(false);
        }
        await page.setViewportSize({width: 1440, height: 900});
        await expect.poll(() => sample(page, A).getAttribute("data-visible")).toBe("true");
        expect(await instanceOf(page, A)).toEqual(alpha);
    });

    test("“移动到”菜单打开时视图换代（渲染出错后重试）：菜单关闭，旧点击无从发生", async ({page}) => {
        await open(page);
        await page.evaluate(([render, delta]) => localStorage.setItem(render, delta), [SAMPLE_VIEWS_SWITCHES.failRender, D] as const);
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        const frame = page.locator(`[data-view-frame="${D}"]`);
        await expect(frame).toHaveAttribute("data-view-state", "render-failed");
        await page.evaluate((render) => localStorage.removeItem(render), SAMPLE_VIEWS_SWITCHES.failRender);
        await page.locator(`[data-tool-part="auxiliarybar"] [data-move-view="${D}"]`).click();
        await expect(page.getByRole("menu")).toBeVisible();
        // 菜单开着时经页面重试（不移开焦点、不关菜单的 DOM 点击）。
        await frame.locator("[data-view-retry-render]").evaluate((element) => (element as HTMLButtonElement).click());
        await expect(sample(page, D)).toBeVisible();
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
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views,test.menus", NBOOK_EXCLUDE_PLUGINS: "nbook.explorer,nbook.editor,nbook.agent"}});
    });

    test.afterAll(async () => {
        expect(await server.stop()).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 1440, height: 900}});

    test("视图自己的按钮在前、贡献的在后；“⋯”里自己的 menu 动作在前、分隔线后是贡献的；贡献项执行时收到固定参数或这个视图实例", async ({page}) => {
        await page.goto(new URL("/workbench", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await page.locator(`[data-activity-container="view:${C}"]`).click();
        await expect(sample(page, C)).toBeVisible();
        const sidebar = page.locator('[data-tool-part="sidebar"]');
        // 丙自己的动作收进了“⋯”，所以标题行里的按钮只有贡献的那一个，后面是“⋯”与“移动到”。
        await expect(sidebar.locator("[data-title-action-key]")).toHaveCount(1);
        const button = sidebar.locator('[data-title-action-key="test.menus.view-button"]');
        await expect(button).toHaveAttribute("aria-label", "测试按钮");
        const order = await sidebar.locator("[data-title-action-key], [data-title-actions-more], [data-move-view]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-title-action-key") ?? (node.hasAttribute("data-title-actions-more") ? "more" : "move")));
        expect(order).toEqual(["test.menus.view-button", "more", "move"]);

        await sidebar.locator("[data-title-actions-more]").click();
        const menu = page.getByRole("menu");
        await expect(menu).toBeVisible();
        expect(await menu.locator('[role^="menuitem"], [role="separator"]').evaluateAll((nodes) => nodes.map((node) => (node.getAttribute("role") === "separator" ? "---" : (node.textContent ?? "").trim())))).toEqual(["样例的菜单动作", "---", "测试菜单项"]);
        await menu.getByRole("menuitem", {name: "测试菜单项"}).click();
        await expect(page.getByText(`收到 ${JSON.stringify({viewId: C, generation: Number(await sample(page, C).getAttribute("data-generation"))})}`)).toBeVisible();

        await button.click();
        await expect(page.getByText(`收到 ${JSON.stringify({from: "view-button"})}`)).toBeVisible();
    });
});
