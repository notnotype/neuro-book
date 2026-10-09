/**
 * 外壳二在真实 Chrome 中的验收（docs/specs/ui/workbench-shell.md 外壳二验收 14–18、26–31，docs/specs/workbench/views.md
 * 验收 1–5）：生产构建的 e2e 测试外壳与宿主测试入口，测试插件 `test.sample-views`（src/web/testing/sample-views.ts）
 * 贡献六个视图。等页面上可观察的变化，不按时长等待。
 *
 * 不在这里的：落位与意图合成的逐条规则（`views/model.test.ts`）、两个窗口与保存失败（`state/layout-store.test.ts`）、
 * 注册表与内核撤回的串行窗口（`views/registry.test.ts`）、命令的参数与过期（`commands/view-commands.test.ts`）。
 */

import {mkdir, rm} from "node:fs/promises";
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
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views", NBOOK_EXCLUDE_PLUGINS: "nbook.explorer,nbook.editor"}});
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
        await page.goto(server.url);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(page.locator("[data-shell-focus-target=\"panel-toggle\"]")).toBeEnabled();
    }

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

    test("活动栏：选择互斥；Sidebar 被隐藏或拖到零时点容器同时打开它，拖到零的按记忆尺寸展开", async ({page}) => {
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

    test("收起：multiple 收起甲 → 乙移出后甲在 single 展开但记录不变 → 乙回来甲重新收起；面板横向收起成竖条、键盘展开", async ({page}) => {
        await open(page);
        await page.locator(`[data-activity-container="view:${B}"]`).click();
        await moveVia(page, '[data-tool-part="sidebar"]', B, "样例甲");
        const section = (viewId: string) => page.locator(`[data-view-section="${viewId}"]`);
        await section(A).locator("[data-view-toggle]").click();
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
        const scrollerOf = (viewId: string) => page.locator(`[data-view-frame="${viewId}"] [data-reka-scroll-area-viewport]`);
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

    test("活动栏、工具区域卡片、视图标题行与选中标记的颜色取主题 token 的解析值", async ({page}) => {
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
                ...read(".workbench-activity-bar", {"background-color": "--panel-surface", "border-top-color": "--panel-outline"}),
                ...read(".workbench-activity-bar__item--active", {"color": "--accent-text", "background-color": "--bg-hover"}),
                ...read('[data-tool-part="sidebar"]', {"background-color": "--panel-surface", "border-top-color": "--panel-outline"}),
                ...read('[data-tool-part="auxiliarybar"] .workbench-tool-part__head', {"border-bottom-color": "--divider"}),
                ...read(".workbench-view-section__head", {"border-bottom-color": "--divider"}),
                ...read(".workbench-view-section__title", {"color": "--text-secondary"}),
            ].filter((item) => item.own !== item.token);
        });
        await expect.poll(mismatches).toEqual([]);
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