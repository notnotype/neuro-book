/**
 * 工作台外壳一在真实 Chrome 中的验收（docs/specs/ui/workbench-shell.md 外壳一验收 1–6、8、11–13）：产品页用生产构建的
 * 外壳与后端；停放不卸载与 Lab 隔离用真实的开发会话（Lab 只在开发模式加载）。等页面上可观察的变化，不按时长等待。
 *
 * 不在这里的：四位置 × 四对齐的全部组合与降级的数值（`shell/layout.test.ts`）；坏记录、读取失败与保存失败的恢复
 * （`state/layout-store.test.ts` 在真实 Storage 上覆盖，状态栏的提示在组件测试）；绑定项目与未绑定窗口的分区
 * （`layout-store.test.ts`）。
 */

import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

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

    /** 每个用例一个新的浏览器上下文：客户端身份不同，`local` 的布局记录互不影响。 */
    async function open(page: Page): Promise<void> {
        await page.goto(server.url);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(page.locator("[data-workbench-shell]")).toHaveAttribute("data-shell-layout", "split");
        // 记录读完前状态栏的面板按钮与边界都不可用：等按钮可用。
        await expect(page.locator("[data-shell-focus-target=\"panel-toggle\"]")).toBeEnabled();
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
        expect((await box(page, "panel")).height).toBeGreaterThan(600);
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

    test("拖动边界：越界停在边界不弹回、松手保存、刷新恢复；键盘步长与 Escape 取消；拖到零留 1px 边界，Enter 恢复记忆尺寸", async ({page}) => {
        await open(page);
        const sash = sidebarSash(page);
        const at = async () => {
            const found = await sash.boundingBox();
            if (found === null) throw new Error("没有边界");
            return {x: found.x + found.width / 2, y: found.y + found.height / 2};
        };
        // 默认侧栏 340（叶宽，卡片在 6px 留白里），上限 560。
        let start = await at();
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x + 200, start.y, {steps: 5});
        await page.mouse.move(start.x + 400, start.y, {steps: 5});
        await page.mouse.up();
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(560);
        await page.reload();
        await open(page);
        expect((await box(page, "sidebar")).width).toBe(560);

        await sash.focus();
        await page.keyboard.press("ArrowLeft");
        await page.keyboard.press("Shift+ArrowLeft");
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(549);
        await page.keyboard.down("ArrowLeft");
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(539);
        await page.keyboard.press("Escape");
        await page.keyboard.up("ArrowLeft");
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(549);

        start = await at();
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x - 300, start.y, {steps: 5});
        await page.mouse.move(start.x - 600, start.y, {steps: 5});
        await page.mouse.up();
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(0);
        await expect(sash).toBeVisible();
        await page.reload();
        await open(page);
        expect((await box(page, "sidebar")).width).toBe(0);
        await sash.focus();
        await page.keyboard.press("Enter");
        await expect.poll(async () => (await box(page, "sidebar")).width).toBe(549);
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

    test("外壳、面板与状态栏的底色、文字与字体取主题 token 的解析值", async ({page}) => {
        await open(page);
        const resolved = await page.evaluate(() => {
            const read = (selector: string, styles: string) => {
                const element = document.querySelector(selector)!;
                const probe = document.createElement("div");
                probe.style.cssText = styles;
                element.append(probe);
                const result = {own: getComputedStyle(element).backgroundColor, token: getComputedStyle(probe).backgroundColor};
                probe.remove();
                return result;
            };
            return {
                shell: read("[data-workbench-shell]", "background-color: var(--bg-main)"),
                panel: read(".workbench-panel-surface", "background-color: var(--panel-surface)"),
                status: read("[data-workbench-status-bar]", "background-color: var(--bg-panel)"),
            };
        });
        for (const {own, token} of Object.values(resolved)) expect(own).toBe(token);
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

    test("同一场景里换位置、最大化、隐藏、紧凑往返：编辑器样例不重挂，输入与滚动保留", async ({page}) => {
        await page.goto(`${dev.pageUrl}lab?c=WorkbenchShellLayout&s=default`);
        const sample = page.locator("[data-shell-sample]");
        await expect(sample).toBeVisible();
        const identity = async () => [await sample.getAttribute("data-shell-sample"), await sample.getAttribute("data-unmounted")];
        const before = await identity();
        await page.locator("[data-shell-sample-input] input").fill("草稿");
        const scroller = page.locator("[data-shell-sample-scroll]");
        await scroller.evaluate((element) => {
            element.scrollTop = 300;
        });
        const controls = page.locator("#lab-fixture-controls-target");
        const steps: ReadonlyArray<() => Promise<void>> = [
            () => controls.getByRole("radio", {name: "左侧"}).click(),
            () => controls.getByRole("button", {name: "最大化"}).click(),
            () => controls.getByRole("button", {name: "还原"}).click(),
            () => controls.getByRole("button", {name: "隐藏面板"}).click(),
            () => controls.getByRole("button", {name: "显示面板"}).click(),
            () => page.locator("button").filter({hasText: /^手机$/u}).click(),
            () => page.locator("button").filter({hasText: /^随窗口$/u}).click(),
        ];
        for (const step of steps) {
            await step();
            await expect(sample).toBeVisible();
            expect(await identity()).toEqual(before);
            await expect(page.locator("[data-shell-sample-input] input")).toHaveValue("草稿");
            await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(300);
        }
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
        const product = await watch("");
        await expect.poll(() => product.some((frame) => frame.includes("views-customizations"))).toBe(true);
        expect(lab.filter((frame) => frame.includes("views-customizations") || frame.includes("layout-sizes"))).toEqual([]);
        await context.close();
    });
});
