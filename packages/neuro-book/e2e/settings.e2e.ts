/**
 * 配置在真实 Chrome 中的验收（docs/specs/settings/configuration.md 验收 2、3，docs/specs/theme/system.md 的“运行时流程”，
 * docs/specs/workbench/quick-open.md 的显示语言）：生产构建的外壳与后端；Lab 的那一条用真实的开发会话（Lab 只在开发
 * 模式加载）。设置文件在测试临时根下，外部修改直接写文件，等页面上可观察的变化，不按时长等待。
 */

import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import {parse as parseJsonc} from "jsonc-parser";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startDevSession, startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

let tmp = "";
let stateRoot = "";
let projectDir = "";
let server: ProductServer;

/** 用户层文件一开始的样子：带注释，验证写入后注释与其余内容保留。 */
const USER_FILE = "// 我的设置\n{\n    // 主题\n    \"nbook.workbench/theme\": \"nbook\"\n}\n";

const userFile = (): string => join(stateRoot, "settings.json");
const projectFile = (): string => join(projectDir, ".nbook", "settings.json");

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "settings");
    stateRoot = join(tmp, "state");
    projectDir = join(tmp, "Book");
    // 先登记好项目 `book`：身份文件与登记表按 docs/specs/runtime/projects.md 的格式写入，不经界面。
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await mkdir(stateRoot, {recursive: true});
    await writeFile(join(projectDir, ".nbook", "project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    await writeFile(userFile(), USER_FILE);
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 每个用例从同一份用户层、空的项目层开始；页面都在用例里新开。 */
test.beforeEach(async () => {
    await writeFile(userFile(), USER_FILE);
    await rm(projectFile(), {force: true});
});

function watchConsole(page: Page, problems: string[]): void {
    page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
}

async function open(page: Page, path = "/workbench"): Promise<void> {
    await page.goto(new URL(path, server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
    await expect(page.locator("[data-workbench-document]")).toHaveCount(1);
}

/** 打开命令面板（命令宿主随页面异步加载，按到面板出现为止），输入文字后按回车执行第一项。 */
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

/** 选择模式里选一项：输入文字过滤后按回车。 */
async function choose(page: Page, text: string): Promise<void> {
    const combobox = page.getByRole("combobox");
    await expect(combobox).toBeFocused();
    await combobox.fill(text);
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(combobox).toHaveCount(0);
}

const html = (page: Page, name: "lang" | "data-nb-theme" | "data-nb-appearance") => page.locator("html").getAttribute(name);
const pageBackground = (page: Page) => page.locator("[data-workbench-shell]").evaluate((element) => getComputedStyle(element).backgroundColor);

/** 首页的背景、文字颜色与字体，以及同一位置上外壳底色（主题的 `--shell-ground`，平铺的主题是面板底色）、`--text-main`、`--font-ui` 解析出的值（用探针元素求出）。 */
const pageTokens = (page: Page) => page.locator("[data-workbench-shell]").evaluate((element) => {
    const probe = document.createElement("div");
    probe.style.cssText = "background-color: var(--shell-ground, var(--panel-surface)); color: var(--text-main); font-family: var(--font-ui)";
    element.append(probe);
    const own = getComputedStyle(element);
    const token = getComputedStyle(probe);
    const result = {
        actual: [own.backgroundColor, own.color, own.fontFamily],
        tokens: [token.backgroundColor, token.color, token.fontFamily],
    };
    probe.remove();
    return result;
});

test("两个窗口：一处用命令面板切换界面语言，另一处即时换成英文；面板文字跟着换；刷新后保持；设置文件的注释保留", async ({browser}) => {
    const context = await browser.newContext();
    const a = await context.newPage();
    const b = await context.newPage();
    const problems: string[] = [];
    watchConsole(a, problems);
    watchConsole(b, problems);
    await open(a);
    await open(b);
    expect(await html(b, "lang")).toBe("zh-CN");
    await expect(b.getByText("显示所有命令")).toBeVisible();

    await runCommand(a, "切换界面语言");
    await choose(a, "English");
    await expect.poll(() => html(b, "lang")).toBe("en-US");
    await expect(b.getByText("Show All Commands")).toBeVisible();
    await expect(a.getByText("Show All Commands")).toBeVisible();

    // 面板自己的文字按当前语言。
    await expect(async () => {
        await a.keyboard.press("Control+Shift+P");
        await expect(a.getByRole("combobox", {name: "Type a command, or : to go to a line"})).toBeFocused({timeout: 500});
    }).toPass();
    await a.keyboard.press("Escape");

    await b.reload();
    await expect(b.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
    await expect(b.getByText("Show All Commands")).toBeVisible();

    const written = await readFile(userFile(), "utf8");
    expect(written).toContain("// 我的设置");
    expect(written).toContain("// 主题");
    expect(JSON.parse(written.replace(/\/\/.*$/gmu, ""))).toEqual({"nbook.workbench/theme": "nbook", "nbook.settings/locale": "en-US"});
    expect(problems).toEqual([]);
    await context.close();
});

test("外部改用户层文件后主题与页面底色变化；项目层覆盖主题时绑定窗口与未绑定窗口各自正确，切换主题在绑定窗口里改项目层", async ({browser}) => {
    const context = await browser.newContext();
    const free = await context.newPage();
    const bound = await context.newPage();
    await open(free);
    await expect.poll(() => html(free, "data-nb-theme")).toBe("nbook");
    const nbookBackground = await pageBackground(free);
    const nbookTokens = await pageTokens(free);
    expect(nbookTokens.actual).toEqual(nbookTokens.tokens);

    await writeFile(userFile(), "{\"nbook.workbench/theme\": \"macos\"}");
    await expect.poll(() => html(free, "data-nb-theme")).toBe("macos");
    await expect.poll(() => pageBackground(free)).not.toBe(nbookBackground);
    const tokens = await pageTokens(free);
    expect(tokens.actual).toEqual(tokens.tokens);

    await writeFile(projectFile(), "{\"nbook.workbench/theme\": \"nbook\"}");
    await open(bound, "/?project=book");
    await expect.poll(() => html(bound, "data-nb-theme")).toBe("nbook");
    expect(await html(free, "data-nb-theme")).toBe("macos");

    await runCommand(bound, "切换主题");
    await choose(bound, "macOS");
    await expect.poll(async () => JSON.parse(await readFile(projectFile(), "utf8")) as unknown).toEqual({"nbook.workbench/theme": "macos"});
    await expect.poll(() => html(bound, "data-nb-theme")).toBe("macos");
    // 用户层没有被这次切换改动。
    expect(JSON.parse(await readFile(userFile(), "utf8")) as unknown).toEqual({"nbook.workbench/theme": "macos"});
    await context.close();
});

test("明暗跟随系统：系统明暗变化时页面即时跟着变，配置仍是 system；改成显式明暗后不再跟随", async ({page}) => {
    await page.emulateMedia({colorScheme: "light"});
    await writeFile(userFile(), "{\"nbook.workbench/appearance\": \"system\"}");
    await open(page);
    await expect.poll(() => html(page, "data-nb-appearance")).toBe("light");
    await page.emulateMedia({colorScheme: "dark"});
    await expect.poll(() => html(page, "data-nb-appearance")).toBe("dark");
    expect(JSON.parse(await readFile(userFile(), "utf8")) as unknown).toEqual({"nbook.workbench/appearance": "system"});

    await writeFile(userFile(), "{\"nbook.workbench/appearance\": \"light\"}");
    await expect.poll(() => html(page, "data-nb-appearance")).toBe("light");
    await page.emulateMedia({colorScheme: "light"});
    await page.emulateMedia({colorScheme: "dark"});
    // 屏障：之后的一次配置变化生效时，前面的系统明暗变化事件早已派发完。
    await writeFile(userFile(), "{\"nbook.workbench/appearance\": \"light\", \"nbook.workbench/theme\": \"macos\"}");
    await expect.poll(() => html(page, "data-nb-theme")).toBe("macos");
    expect(await html(page, "data-nb-appearance")).toBe("light");
});

test("Lab 显示期间改产品主题：Lab 的文档根不变；回到产品页后按最新配置应用", async ({page}) => {
    const devRoot = join(tmp, "dev-state");
    await mkdir(devRoot, {recursive: true});
    const dev = await startDevSession(devRoot);
    try {
        await page.goto(`${dev.pageUrl}lab`);
        await expect(page.locator(".lab-root")).toBeVisible();
        const labTheme = await html(page, "data-nb-theme");
        const labAppearance = await html(page, "data-nb-appearance");

        await writeFile(join(devRoot, "settings.json"), "{\"nbook.workbench/theme\": \"macos\", \"nbook.workbench/appearance\": \"dark\"}");
        // 等服务端读到新配置：另开一个产品页看到 macos，说明已经推到窗口。
        const probe = await page.context().newPage();
        await probe.goto(dev.pageUrl);
        await expect.poll(() => html(probe, "data-nb-theme")).toBe("macos");
        await probe.close();
        expect(await html(page, "data-nb-theme")).toBe(labTheme);
        expect(await html(page, "data-nb-appearance")).toBe(labAppearance);

        await page.goto(dev.pageUrl);
        await expect.poll(() => html(page, "data-nb-theme")).toBe("macos");
        await expect.poll(() => html(page, "data-nb-appearance")).toBe("dark");
    } finally {
        dev.child.kill("SIGTERM");
        expect(await dev.exit).toBe(0);
    }
});

// ── 设置窗口（docs/specs/settings/settings-window.md 验收 1–4，ui/workbench-shell.md 验收 43–44，bookshelf.md 输出 1） ──

const settingsWindow = (page: Page) => page.locator("[data-settings-window]");
const workbenchGear = (page: Page) => page.locator("[data-activity-item='nbook.settings']");
const shelfGear = (page: Page) => page.locator("[data-shelf-settings]");
const row = (page: Page, key: string) => page.locator(`[data-settings-row="${key}"]`);
/** 设置文件按 JSONC 读：删掉一个键时写入路径保留注释，可能留下合法的尾随逗号。 */
const readSettings = async (path: string): Promise<unknown> => parseJsonc(await readFile(path, "utf8")) as unknown;

/** 按 `Ctrl+,`：命令宿主随页面异步加载，按到窗口出现（或已开着的窗口拿回焦点）为止。 */
async function pressOpenSettings(page: Page): Promise<void> {
    await expect(async () => {
        await page.keyboard.press("Control+,");
        await expect(page.locator("[data-settings-nav-current]")).toBeFocused({timeout: 500});
    }).toPass();
}

/** 设置窗口的面：`data-settings-window` 是面板里的内容。 */
const settingsSurface = (page: Page) => page.locator("[data-dialog-surface]:has([data-settings-window])");

test("点活动栏齿轮打开设置窗口：面从齿轮的方向展开、比终点更靠近齿轮；减少动态效果时第一帧就是终点", async ({page}) => {
    await page.setViewportSize({width: 1600, height: 900});
    await page.emulateMedia({reducedMotion: "no-preference"});
    await open(page, "/?project=book");
    // 放慢入场令牌：动画停在起点读矩形，不依赖时序。（Vue 的 scoped 样式会给关键帧名加哈希后缀，所以按前缀找动画。）
    await page.addStyleTag({content: ":root { --motion-dialog: 4000ms !important; --motion-dialog-leave: 3000ms !important; }"});
    const gear = await workbenchGear(page).boundingBox();
    if (gear === null) throw new Error("活动栏的设置齿轮不可见");
    const gearCenter = {x: gear.x + gear.width / 2, y: gear.y + gear.height / 2};

    await workbenchGear(page).click();
    await expect(settingsSurface(page)).toHaveCount(1);
    const run = await settingsSurface(page).evaluate((surface) => {
        const animation = surface.getAnimations().find((candidate) => (candidate as CSSAnimation).animationName.startsWith("nb-dialog-in"));
        if (animation === undefined) throw new Error("入场动画不存在");
        const centerOf = (rect: DOMRect) => ({x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width});
        // 停在第 0 毫秒读起点，再跳到终点读终点；两次读取之间没有绘制。
        animation.pause();
        animation.currentTime = 0;
        const start = centerOf(surface.getBoundingClientRect());
        animation.finish();
        const end = centerOf(surface.getBoundingClientRect());
        return {start, end, duration: animation.effect?.getTiming().duration};
    });
    const distance = (point: {x: number; y: number}): number => Math.hypot(point.x - gearCenter.x, point.y - gearCenter.y);
    expect(run.duration).toBe(4000);
    expect(distance(run.start)).toBeLessThan(distance(run.end));
    expect(run.start.width).toBeLessThan(run.end.width * 0.5);

    // 关闭：朝齿轮收回去，时长看得出来。
    await page.keyboard.press("Escape");
    const leaving = await settingsSurface(page).evaluate((surface) => {
        const animation = surface.getAnimations().find((candidate) => (candidate as CSSAnimation).animationName.startsWith("nb-dialog-out"));
        if (animation === undefined) throw new Error("退场动画不存在");
        const duration = animation.effect?.getTiming().duration;
        animation.pause();
        // 走到一半还看得清：收回是先慢后快，不是一按就没了。
        animation.currentTime = Number(duration) / 2;
        const halfway = Number(getComputedStyle(surface).opacity);
        animation.currentTime = Number(duration) - 1;
        const rect = surface.getBoundingClientRect();
        animation.finish();
        return {duration, halfway, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width};
    });
    expect(leaving.duration).toBe(3000);
    expect(leaving.halfway).toBeGreaterThan(0.6);
    expect(distance(leaving)).toBeLessThan(distance(run.end));
    expect(leaving.width).toBeLessThan(run.end.width * 0.5);
    await expect(settingsSurface(page)).toHaveCount(0);

    // 减少动态效果：重新载入（放慢令牌的样式随页面丢掉），第一帧就是终点。
    await page.emulateMedia({reducedMotion: "reduce"});
    await open(page, "/?project=book");
    await workbenchGear(page).click();
    await expect(settingsSurface(page)).toHaveCount(1);
    const settled = await settingsSurface(page).evaluate((surface) => ({
        transform: getComputedStyle(surface).transform,
        width: surface.getBoundingClientRect().width,
        offsetWidth: (surface as HTMLElement).offsetWidth,
        running: surface.getAnimations().some((animation) => animation.playState === "running"),
    }));
    expect(settled.transform).toBe("none");
    expect(settled.width).toBe(settled.offsetWidth);
    expect(settled.running).toBe(false);
});

test("浏览器窗口变化：没拖过的保持居中；拖过的放得下不动，放不下推回完整可见，放大不回原位，尺寸不改", async ({page}) => {
    await page.setViewportSize({width: 1600, height: 900});
    await open(page, "/?project=book");
    await pressOpenSettings(page);
    const box = async (): Promise<{x: number; y: number; width: number; height: number}> => {
        // 量面板：`data-settings-window` 是面板里的内容，四周还有边距。
        const found = await page.locator("[data-dialog-surface]:has([data-settings-window])").boundingBox();
        if (found === null) throw new Error("设置窗口不可见");
        return found;
    };
    const centerX = async (): Promise<number> => {
        const {x, width} = await box();
        return x + width / 2;
    };
    await expect.poll(centerX).toBeCloseTo(800, -1);
    const size = await box();

    await page.setViewportSize({width: 1200, height: 900});
    await expect.poll(centerX).toBeCloseTo(600, -1);

    await page.setViewportSize({width: 1600, height: 900});
    await expect.poll(centerX).toBeCloseTo(800, -1);
    const drag = await settingsWindow(page).locator("[data-dialog-drag]").first().boundingBox();
    if (drag === null) throw new Error("拖动区域不可见");
    await page.mouse.move(drag.x + 4, drag.y + 4);
    await page.mouse.down();
    await page.mouse.move(drag.x + 204, drag.y + 4, {steps: 5});
    await page.mouse.up();
    const dragged = await box();
    expect(dragged.x).toBeCloseTo(size.x + 200, -1);

    // 放得下：不动。
    await page.setViewportSize({width: Math.ceil(dragged.x + dragged.width + 20), height: 900});
    await expect.poll(async () => (await box()).x).toBe(dragged.x);
    // 放不下：推回完整可见。
    await page.setViewportSize({width: 1200, height: 900});
    await expect.poll(async () => {
        const {x, width} = await box();
        return x + width;
    }).toBe(1192);
    const pushed = await box();
    // 放大：不回原位。
    await page.setViewportSize({width: 1600, height: 900});
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect((await box()).x).toBe(pushed.x);

    // 比窗口还小：完整显示，关闭按钮看得见；放大后恢复原尺寸。
    await page.setViewportSize({width: 390, height: 500});
    await expect.poll(async () => {
        const {x, y, width, height} = await box();
        return x >= 0 && y >= 0 && x + width <= 390 && y + height <= 500;
    }).toBe(true);
    await expect(page.locator("[data-dialog-surface]:has([data-settings-window])").getByRole("button", {name: "关闭"})).toBeInViewport({ratio: 1});
    await page.setViewportSize({width: 1600, height: 900});
    await expect.poll(async () => (await box()).width).toBe(dragged.width);
    expect((await box()).height).toBe(dragged.height);
});

test("工作台活动栏的齿轮、书架的齿轮与 Ctrl+, 打开同一个窗口；再按 Ctrl+, 只聚焦，再点齿轮关闭；窗口开着时齿轮按下", async ({page}) => {
    const problems: string[] = [];
    watchConsole(page, problems);
    await open(page, "/?project=book");
    // 活动栏最下面：头像占位在上、齿轮在下。
    const bottom = page.locator("[data-activity-items] [data-activity-item]");
    await expect(bottom).toHaveCount(2);
    expect(await bottom.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-activity-item")))).toEqual(["nbook.workbench.profile", "nbook.settings"]);
    await expect(page.locator("[data-activity-item='nbook.workbench.profile']")).toHaveAttribute("aria-label", "个人资料尚未开放");
    await expect(workbenchGear(page)).toHaveAttribute("aria-pressed", "false");

    await workbenchGear(page).click();
    await expect(settingsWindow(page)).toHaveCount(1);
    await expect(workbenchGear(page)).toHaveAttribute("aria-pressed", "true");
    // 焦点挪到窗口里别处，再按打开设置的键：还是这一个窗口，焦点回到左栏的当前项。
    await row(page, "nbook.workbench/appearance").getByRole("radio", {name: "深色"}).focus();
    await pressOpenSettings(page);
    await expect(settingsWindow(page)).toHaveCount(1);
    await expect(page.locator("[data-settings-nav-current]")).toBeFocused();

    // 再点齿轮是关闭，齿轮回到没按下；再点又打开。
    await workbenchGear(page).click();
    await expect(settingsWindow(page)).toHaveCount(0);
    await expect(workbenchGear(page)).toHaveAttribute("aria-pressed", "false");
    await workbenchGear(page).click();
    await expect(settingsWindow(page)).toHaveCount(1);
    await expect(workbenchGear(page)).toHaveAttribute("aria-pressed", "true");

    // Esc 关窗口：焦点回到打开窗口之前的位置（第一次是点齿轮打开的），齿轮回到没按下；Ctrl+, 再打开同一个窗口。
    await page.keyboard.press("Escape");
    await expect(settingsWindow(page)).toHaveCount(0);
    await expect(workbenchGear(page)).toBeFocused();
    await expect(workbenchGear(page)).toHaveAttribute("aria-pressed", "false");
    await pressOpenSettings(page);
    await expect(settingsWindow(page)).toHaveCount(1);
    await expect(workbenchGear(page)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");

    // 书架：右上角的齿轮在头像左边，打开同一个窗口（首页也挂着设置浮层）。
    await open(page, "/");
    await expect(page.locator("[data-bookshelf-page]")).toBeVisible();
    await expect(shelfGear(page)).toHaveAttribute("aria-pressed", "false");
    await shelfGear(page).click();
    await expect(settingsWindow(page)).toHaveCount(1);
    await expect(shelfGear(page)).toHaveAttribute("aria-pressed", "true");
    await row(page, "nbook.workbench/appearance").getByRole("radio", {name: "深色"}).focus();
    await pressOpenSettings(page);
    await expect(settingsWindow(page)).toHaveCount(1);
    await expect(page.locator("[data-settings-nav-current]")).toBeFocused();
    // 没有绑定作品：没有“用户 | 本作品”。
    await expect(page.locator("[data-settings-tabs]")).toHaveCount(0);
    // 书架的齿轮再点也是关闭。
    await shelfGear(page).click();
    await expect(settingsWindow(page)).toHaveCount(0);
    await expect(shelfGear(page)).toHaveAttribute("aria-pressed", "false");
    expect(problems).toEqual([]);
});

test("用户标签改主题，两个页面即时变化；本作品标签单独设明暗后用户标签出现覆盖提示（写着书名），移除后消失", async ({browser}) => {
    const context = await browser.newContext();
    const a = await context.newPage();
    const b = await context.newPage();
    await open(a, "/?project=book");
    await open(b, "/?project=book");
    await workbenchGear(a).click();
    await expect(settingsWindow(a)).toBeVisible();

    // 主题的选项来自工作台的提供者（docs/specs/theme/skins.md 输出 1），是下拉。
    await row(a, "nbook.workbench/theme").getByRole("combobox").click();
    await a.getByRole("option", {name: "macOS"}).click();
    await expect.poll(() => html(a, "data-nb-theme")).toBe("macos");
    await expect.poll(() => html(b, "data-nb-theme")).toBe("macos");
    await expect.poll(() => readSettings(userFile())).toEqual({"nbook.workbench/theme": "macos"});

    await a.locator("[data-settings-tabs]").getByRole("radio", {name: "本作品"}).click();
    const appearance = row(a, "nbook.workbench/appearance");
    await expect(appearance).toHaveAttribute("data-settings-row-state", "inherit");
    await expect(appearance.locator("[data-settings-row-inherited]")).toHaveText("来自用户设置");
    // 沿用的行照常可改，改了就写进本作品层
    await appearance.getByRole("radio", {name: "深色"}).click();
    await expect(appearance).toHaveAttribute("data-settings-row-state", "edit");
    await expect.poll(() => readSettings(projectFile())).toEqual({"nbook.workbench/appearance": "dark"});
    await expect.poll(() => html(b, "data-nb-appearance")).toBe("dark");

    await a.locator("[data-settings-tabs]").getByRole("radio", {name: "用户"}).click();
    // 没写书名：书名是目录原名 Book（不是短名 book）。
    await expect(appearance.locator("[data-settings-row-overridden]")).toContainText("《Book》");

    await a.locator("[data-settings-tabs]").getByRole("radio", {name: "本作品"}).click();
    await appearance.locator("[data-settings-row-remove]").click();
    await expect(appearance).toHaveAttribute("data-settings-row-state", "inherit");
    await a.locator("[data-settings-tabs]").getByRole("radio", {name: "用户"}).click();
    await expect(appearance.locator("[data-settings-row-overridden]")).toHaveCount(0);
    await expect.poll(() => readSettings(projectFile())).toEqual({});
    await context.close();
});

test("改过的项有已修改标记；恢复默认后键从 settings.json 删掉，其余内容与注释不变", async ({page}) => {
    await open(page, "/?project=book");
    await workbenchGear(page).click();
    const appearance = row(page, "nbook.workbench/appearance");
    await expect(appearance).not.toHaveAttribute("data-settings-row-modified", "");
    await appearance.getByRole("radio", {name: "深色"}).click();
    await expect(appearance).toHaveAttribute("data-settings-row-modified", "");
    await expect.poll(() => readSettings(userFile())).toEqual({"nbook.workbench/theme": "nbook", "nbook.workbench/appearance": "dark"});

    await appearance.locator("[data-settings-row-reset]").click();
    await expect(appearance).not.toHaveAttribute("data-settings-row-modified", "");
    await expect.poll(() => readSettings(userFile())).toEqual({"nbook.workbench/theme": "nbook"});
    const written = await readFile(userFile(), "utf8");
    expect(written).toContain("// 我的设置");
    expect(written).toContain("// 主题");
});

test("用户层文件改坏：标题区出现警告、控件停用；点警告打开设置文件并把光标放在出错处；修好后警告消失、控件恢复", async ({page}) => {
    await open(page, "/?project=book");
    await workbenchGear(page).click();
    const macos = row(page, "nbook.workbench/appearance").getByRole("radio", {name: "深色"});
    await expect(macos).toBeEnabled();
    await writeFile(userFile(), "{\"nbook.workbench/theme\": \"nbook\",,}");
    const warning = page.locator("[data-settings-heading] [data-settings-layer-notice='invalid']");
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("设置文件格式有误");
    await expect(macos).toBeDisabled();
    await warning.click();
    await expect(page.locator("[data-settings-section='file']")).toBeVisible();
    const text = page.locator("[data-settings-file-text]");
    await expect(text).toBeFocused();
    // 标题区写出错位置；光标就在那一列。
    const fixing = page.locator("[data-settings-heading] [data-settings-layer-notice='fixing']");
    await expect(fixing).toContainText(/^第 1 行第 \d+ 列：.+，改好后保存$/u);
    const column = Number(/第 1 行第 (\d+) 列/u.exec((await fixing.textContent()) ?? "")?.[1]);
    expect(await text.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(column - 1);
    // 出错的那一行（第 1 行）在行号列上标出。
    await expect(page.locator("[data-settings-file-line][data-error]")).toHaveText("1");
    await writeFile(userFile(), USER_FILE);
    await expect(page.locator("[data-settings-layer-notice]")).toHaveCount(0);
    await page.locator("[data-settings-nav='nbook.appearance']").click();
    await expect(macos).toBeEnabled();
});

test("调整窗口大小后关掉再开、刷新页面仍是这个尺寸，每次打开居中；切换分区时尺寸不变", async ({page}) => {
    await open(page, "/?project=book");
    await workbenchGear(page).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const width = async (): Promise<number> => Math.round((await dialog.boundingBox())!.width);
    // 打开时窗口从略小处放大（nb-ui Dialog 的进场动画）：量尺寸与位置之前等它播完，否则量到的是缩放中的外框。
    const settled = (): Promise<unknown> => dialog.evaluate((element) => Promise.all(element.getAnimations({subtree: true}).map((animation) => animation.finished)));
    await settled();
    const before = await width();
    // 方向键一次 10px（nb-ui 浮动窗口），收窄两次。
    await dialog.locator("[data-dialog-resize='right']").focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect.poll(width).toBeLessThan(before);
    const resized = await width();
    await page.locator("[data-settings-nav='nbook.works']").click();
    expect(await width()).toBe(resized);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await workbenchGear(page).click();
    await expect(dialog).toBeVisible();
    await settled();
    expect(await width()).toBe(resized);
    // 收窄时左边不动、窗口偏到左边；位置不记，再打开时重新居中。
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    if (box === null || viewport === null) throw new Error("量不到窗口或视口");
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1);

    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
    await workbenchGear(page).click();
    await expect(dialog).toBeVisible();
    await settled();
    expect(await width()).toBe(resized);
});

test("窗口没有标题栏：按住顶上的空白、左栏顶上的空白、标题区的空白与标题文字都能拖动；按在搜索框上不拖；关闭按钮在右上角", async ({page}) => {
    await open(page, "/?project=book");
    await workbenchGear(page).click();
    const dialog = page.getByRole("dialog", {name: "设置"});
    await expect(dialog).toBeVisible();
    await dialog.evaluate((element) => Promise.all(element.getAnimations({subtree: true}).map((animation) => animation.finished)));
    await expect(dialog.locator("header.nb-dialog__header")).toHaveCount(0);
    const at = async (): Promise<{x: number; y: number}> => {
        const box = await dialog.boundingBox();
        if (box === null) throw new Error("量不到窗口");
        return {x: Math.round(box.x), y: Math.round(box.y)};
    };
    /** 从 (x, y) 按下、移动 (dx, dy) 后松开，返回窗口的位移。 */
    const drag = async (x: number, y: number, dx: number, dy: number): Promise<{dx: number; dy: number}> => {
        const before = await at();
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + dx / 2, y + dy / 2);
        await page.mouse.move(x + dx, y + dy);
        await page.mouse.up();
        const after = await at();
        return {dx: after.x - before.x, dy: after.y - before.y};
    };
    const center = async (selector: string): Promise<{x: number; y: number}> => {
        const box = await dialog.locator(selector).first().boundingBox();
        if (box === null) throw new Error(`量不到 ${selector}`);
        return {x: box.x + box.width / 2, y: box.y + box.height / 2};
    };

    // 窗口顶边往下 10px、水平居中：正文上方的留白
    const top = await at();
    const box = (await dialog.boundingBox())!;
    expect(await drag(top.x + box.width / 2, top.y + 10, 40, 30)).toEqual({dx: 40, dy: 30});
    // 左栏顶上：层标签与搜索框之间的空隙
    const tabs = await dialog.locator("[data-settings-tabs]").boundingBox();
    const search = await dialog.locator("[data-settings-search]").boundingBox();
    if (tabs === null || search === null) throw new Error("量不到层标签或搜索框");
    expect(await drag(tabs.x + tabs.width / 2, (tabs.y + tabs.height + search.y) / 2, -20, 10)).toEqual({dx: -20, dy: 10});
    // 标题文字
    const title = await center("[data-settings-heading] h2");
    expect(await drag(title.x, title.y, 15, -15)).toEqual({dx: 15, dy: -15});
    // 按在搜索框上是输入，不拖
    const input = await center("[data-settings-search] input");
    expect(await drag(input.x, input.y, 30, 30)).toEqual({dx: 0, dy: 0});
    // 焦点在输入框里时点一下标题区：输入框照常失焦（拖动区域不拦按下的默认动作）
    await expect(dialog.locator("[data-settings-search] input")).toBeFocused();
    await page.mouse.click(title.x, title.y);
    await expect(dialog.locator("[data-settings-search] input")).not.toBeFocused();
    const heading = await dialog.locator("[data-settings-heading]").boundingBox();
    if (heading === null) throw new Error("量不到标题区");
    // 标题区右端、说明之外的空白
    expect(await drag(heading.x + heading.width - 4, heading.y + heading.height / 2, 10, 10)).toEqual({dx: 10, dy: 10});

    // 关闭按钮照常关窗口
    await dialog.getByRole("button", {name: "关闭"}).click();
    await expect(dialog).toHaveCount(0);
});

test("关闭按钮浮在右上角：宽窗口、内容列贴近右缘的窗口、fill 视图与窄窗口里都不压内容；左栏顶边与标题区齐平", async ({page}) => {
    await open(page, "/?project=book");
    const dialog = page.getByRole("dialog", {name: "设置"});
    const box = async (selector: string) => {
        const found = await dialog.locator(selector).first().boundingBox();
        if (found === null) throw new Error(`量不到 ${selector}`);
        return found;
    };
    /** 标题区内容的右缘（去掉给关闭按钮让的右内边距）。 */
    const headingContentRight = (): Promise<number> => dialog.locator("[data-settings-heading]").first().evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.right - Number.parseFloat(getComputedStyle(element).paddingRight);
    });
    const openAt = async (width: number): Promise<void> => {
        await page.setViewportSize({width, height: 760});
        await workbenchGear(page).click();
        await expect(dialog).toBeVisible();
        await dialog.evaluate((element) => Promise.all(element.getAnimations({subtree: true}).map((animation) => animation.finished)));
    };
    const close = async () => box("button[aria-label='关闭']");

    // 窗口 960（内容列比 720 窄）与 868：标题区右缘离关闭按钮至少一档
    for (const width of [1300, 900]) {
        await openAt(width);
        expect(await headingContentRight()).toBeLessThanOrEqual((await close()).x - 8);
        expect(Math.abs((await box("[data-settings-tabs]")).y - (await box("[data-settings-heading]")).y)).toBeLessThanOrEqual(1);
        // fill 视图（设置文件）同样
        await dialog.locator("[data-settings-nav='file']").click();
        await expect(dialog.locator("[data-settings-file]")).toBeVisible();
        expect(await headingContentRight()).toBeLessThanOrEqual((await close()).x - 8);
        await dialog.getByRole("button", {name: "关闭"}).click();
        await expect(dialog).toHaveCount(0);
    }

    // 窄窗口：顶上那一行（层标签与搜索框）右端让位，标题区在它下面
    await openAt(600);
    const search = await box("[data-settings-search]");
    expect(search.x + search.width).toBeLessThanOrEqual((await close()).x - 8);
    expect((await box("[data-settings-heading]")).y).toBeGreaterThan((await close()).y + (await close()).height);
});

// ── 左栏与窄窗口（settings-window.md 输出 1、16）：要真实布局，DOM 测试量不到 ──

test("左栏：层标签在搜索框上方、每个有分区的组上方有组标题、分区一行一项；悬停与按下不缩放不位移", async ({page}) => {
    await open(page, "/?project=book");
    await workbenchGear(page).click();
    await expect(settingsWindow(page)).toBeVisible();
    const box = async (selector: string) => (await page.locator(selector).first().boundingBox())!;
    const tabs = await box("[data-settings-tabs]");
    const search = await box("[data-settings-search]");
    expect(tabs.y + tabs.height).toBeLessThanOrEqual(search.y);
    const labels = page.locator("[data-settings-nav-label]");
    // 三组都有分区：“写作助手”组是模型服务的两页。
    await expect(labels).toHaveText(["通用", "写作助手", "扩展"]);
    for (const label of await labels.all()) await expect(label).toBeVisible();
    const items = await page.locator("[data-settings-nav]").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
    expect(items.every((top, index) => index === 0 || top > items[index - 1]!)).toBe(true);
    // 整窗几何：左栏 176px 从窗口左缘起，竖分隔线紧贴其右，右边的内容区从分隔线右缘一直铺到窗口右缘。
    const side = await box(".settings-window__side");
    expect(Math.round(side.width)).toBe(176);
    const split = await box(".settings-window__split");
    const divider = await box(".settings-window__divider");
    const scroll = await box(".settings-window__scroll");
    // 外框带亚像素位置（窗口居中），按 1px 以内比较。
    const near = (actual: number, expected: number, what: string): void => expect(Math.abs(actual - expected), what).toBeLessThanOrEqual(1);
    near(side.x, split.x, "左栏贴窗口左缘");
    near(divider.x, side.x + side.width, "分隔线紧贴左栏");
    near(scroll.x, divider.x + divider.width, "内容区紧贴分隔线");
    near(scroll.x + scroll.width, split.x + split.width, "内容区铺到右缘");

    // 悬停、按下（没松开）：变换仍是 none，外框不动。
    const target = page.locator("[data-settings-nav='nbook.works']");
    // 打开时窗口从略小处放大（nb-ui Dialog 的进场动画）：播完再量，否则前后两次量的是缩放中的外框。
    await page.getByRole("dialog").evaluate((element) => Promise.all(element.getAnimations({subtree: true}).map((animation) => animation.finished)));
    const before = await target.boundingBox();
    await target.hover();
    await page.mouse.down();
    expect(await target.evaluate((element) => getComputedStyle(element).transform)).toBe("none");
    expect(await target.boundingBox()).toEqual(before);
    await page.mouse.up();
});

test("窄窗口：左栏变成顶上两行，层标签与搜索框并排、分区横排一行不显示组标题与图标；宽了再回到竖排", async ({page}) => {
    await page.setViewportSize({width: 560, height: 700});
    await open(page, "/?project=book");
    await workbenchGear(page).click();
    await expect(settingsWindow(page)).toBeVisible();
    const dialog = page.getByRole("dialog");
    expect((await dialog.boundingBox())!.width).toBeLessThan(600);
    const box = async (selector: string) => (await page.locator(selector).first().boundingBox())!;
    const tabs = await box("[data-settings-tabs]");
    const search = await box("[data-settings-search]");
    // 并排：同一行（纵向有重叠），标签在搜索框左边。
    expect(Math.abs(tabs.y + tabs.height / 2 - (search.y + search.height / 2))).toBeLessThanOrEqual(2);
    expect(tabs.x + tabs.width).toBeLessThanOrEqual(search.x);
    // 分区在这两行下面、同一行，横向放不下时自己滚（不换行）。
    const nav = await page.locator(".settings-window__nav").evaluate((element) => ({overflowX: getComputedStyle(element).overflowX, top: element.getBoundingClientRect().top}));
    expect(nav.overflowX).toBe("auto");
    expect(nav.top).toBeGreaterThanOrEqual(search.y + search.height);
    const tops = await page.locator("[data-settings-nav]").evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    for (const label of await page.locator("[data-settings-nav-label]").all()) await expect(label).toBeHidden();
    for (const icon of await page.locator(".settings-window__nav-icon").all()) await expect(icon).toBeHidden();

    // 页面宽了窗口跟着宽：回到宽窗口的竖排。
    await page.setViewportSize({width: 1280, height: 700});
    await expect.poll(async () => (await dialog.boundingBox())!.width).toBeGreaterThanOrEqual(600);
    await expect(page.locator("[data-settings-nav-label]").first()).toBeVisible();
    const wideTabs = await box("[data-settings-tabs]");
    const wideSearch = await box("[data-settings-search]");
    expect(wideTabs.y + wideTabs.height).toBeLessThanOrEqual(wideSearch.y);
});

// ── 搜索、设置文件视图（settings-window.md 输出 21、23）与 Lab“模型服务”（输出 20、22） ──

test("Ctrl+F 聚焦设置里的搜索框；搜到“明暗”直接改掉；Esc 先清空搜索、窗口不关", async ({page}) => {
    await open(page, "/?project=book");
    await workbenchGear(page).click();
    await page.keyboard.press("Control+f");
    const search = page.locator("[data-settings-search] input");
    await expect(search).toBeFocused();
    await search.fill("明暗");
    const appearance = row(page, "nbook.workbench/appearance");
    await expect(page.locator("[data-settings-row]")).toHaveCount(1);
    await appearance.getByRole("radio", {name: "深色"}).click();
    await expect.poll(() => readSettings(userFile())).toEqual({"nbook.workbench/theme": "nbook", "nbook.workbench/appearance": "dark"});
    await search.focus();
    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
    await expect(settingsWindow(page)).toBeVisible();
    await expect(page.locator("[data-settings-section='nbook.appearance']")).toBeVisible();
});

test("设置文件视图：看到带注释的全文，改主题后 Ctrl+S 保存，文件原样落盘、页面跟着变；别处把文件改坏后经它修好", async ({page}) => {
    const problems: string[] = [];
    watchConsole(page, problems);
    await open(page, "/?project=book");
    await workbenchGear(page).click();
    await page.locator("[data-settings-nav='file']").click();
    const text = page.locator("[data-settings-file-text]");
    await expect(text).toHaveValue(USER_FILE);
    const next = USER_FILE.replace("\"nbook\"", "\"macos\"");
    await text.fill(next);
    await text.press("Control+s");
    await expect.poll(() => readFile(userFile(), "utf8")).toBe(next);
    await expect.poll(() => html(page, "data-nb-theme")).toBe("macos");
    await expect(page.locator("[data-settings-file-actions]").getByRole("button", {name: "保存"})).toBeDisabled();

    await writeFile(userFile(), "{\"nbook.workbench/theme\": \"nbook\",,}");
    await expect(text).toHaveValue("{\"nbook.workbench/theme\": \"nbook\",,}");
    // 已在设置文件视图里：标题区不再给“打开”的按钮，写出错的位置。
    await expect(page.locator("[data-settings-layer-notice='fixing']")).toBeVisible();
    await text.fill("{\n    \"nbook.workbench/theme\": \"nbook\"\n    \"x\": 1\n}");
    await page.locator("[data-settings-file-actions]").getByRole("button", {name: "保存"}).click();
    await expect(page.locator("[data-settings-heading] [data-settings-layer-notice]")).toContainText(/^未保存：第 3 行第 5 列：/u);
    await expect(page.locator("[data-settings-file-line][data-error]")).toHaveText("3");
    await expect(page.locator("[data-settings-file-error]")).toContainText("第 3 行第 5 列");
    await text.fill(USER_FILE);
    await page.locator("[data-settings-file-actions]").getByRole("button", {name: "保存"}).click();
    await expect(page.locator("[data-settings-layer-notice]")).toHaveCount(0);
    expect(await readFile(userFile(), "utf8")).toBe(USER_FILE);
    expect(problems).toEqual([]);
});

test("Lab 左栏长标题：截断显示省略号，悬停时 Tooltip 给全名；没截断的分区聚焦也不出提示", async ({page}) => {
    const devRoot = join(tmp, "dev-long-titles");
    await mkdir(devRoot, {recursive: true});
    const dev = await startDevSession(devRoot);
    try {
        // Lab 的画布要够宽，窗口才是竖排的左栏（窄了分区横排、不截断）。
        await page.setViewportSize({width: 1600, height: 900});
        await page.goto(`${dev.pageUrl}lab?c=SettingsWindow&s=long-titles`);
        // 提示的面是 nb-ui 的 .nb-ui-tooltip-surface（传送到 body），里面除了看得见的字还有给读屏的一份，所以比“包含”。
        const tooltip = page.locator(".nb-ui-tooltip-surface");
        for (const [id, full] of [["example.snippets.long-zh", "人物关系、世界观与时间线的一致性检查"], ["example.snippets.long-en", "Manuscript Export Presets"]] as const) {
            const item = page.locator(`[data-settings-nav='${id}']`);
            const label = item.locator(".settings-window__nav-text");
            await expect(label).toHaveText(full);
            expect(await label.evaluate((element) => element.scrollWidth > element.clientWidth), `${full} 被截断`).toBe(true);
            // 窗口量过截断之后才放开提示（data-settings-nav-truncated）；在那之前悬停，Tooltip 不会补开。
            await expect(item).toHaveAttribute("data-settings-nav-truncated", "");
            await item.hover();
            await expect(tooltip).toContainText(full);
            await page.mouse.move(0, 0);
            await expect(tooltip).toHaveCount(0);
        }
        // 聚焦时提示不等延时（nb-ui Tooltip：hover 延迟、focus 即时）：先用截断的分区证明聚焦会出提示，再聚焦没截断的，过两帧仍没有提示。
        const frames = (): Promise<void> => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await page.locator("[data-settings-nav='example.snippets.long-zh']").focus();
        await expect(tooltip).toContainText("人物关系、世界观与时间线的一致性检查");
        await page.locator("[data-settings-nav='nbook.appearance']").focus();
        await expect(tooltip).toHaveCount(0);
        await frames();
        await expect(tooltip).toHaveCount(0);
    } finally {
        dev.child.kill("SIGTERM");
        expect(await dev.exit).toBe(0);
    }
});

test("Lab“模型服务”：打开时才激活；首屏是服务商列表，添加服务商在标题区；加一家没填好时保存被拒，填好后保存；有改动时切分区先确认", async ({page}) => {
    const devRoot = join(tmp, "dev-models");
    await mkdir(devRoot, {recursive: true});
    const dev = await startDevSession(devRoot);
    try {
        await page.goto(`${dev.pageUrl}lab?c=SettingsWindow&s=page-fill`);
        const models = page.locator("[data-sample-models]");
        await expect(models).toBeVisible();
        const heading = page.locator("[data-settings-heading]");
        const rows = models.locator("[data-settings-page-list-item]");
        await expect(rows).toHaveCount(2);
        await expect(rows.nth(0)).toContainText("DeepSeek");
        await expect(models.getByRole("list", {name: "模型服务"})).toBeVisible();
        // 首屏是列表：标题区没有返回，“添加服务商”在标题区右侧、不在页面正文里。
        await expect(heading.locator("[data-settings-heading-back]")).toHaveCount(0);
        await expect(models.locator("[data-sample-models-add]")).toHaveCount(0);
        const add = heading.locator("[data-sample-models-add]");
        await expect(add).toBeEnabled();
        // 新加的一家随即打开：标题区换成“‹ 模型服务”与它的标题，保存栏出现。
        await add.click();
        await expect(heading.locator("h2")).toHaveText("未命名的服务商");
        await expect(heading.locator("[data-settings-heading-back]")).toContainText("模型服务");
        await expect(heading.locator("[data-sample-models-add]")).toHaveCount(0);
        const bar = page.locator("[data-sample-models-bar]");
        await expect(bar.getByRole("button", {name: "保存"})).toBeEnabled();
        await bar.getByRole("button", {name: "保存"}).click();
        await expect(bar.locator("[data-settings-save-bar-note]")).toContainText("还没保存");
        const detail = models.locator("[data-sample-models-detail]");
        await detail.getByLabel("标识").fill("openai");
        await detail.getByLabel("名称").fill("OpenAI");
        await detail.getByLabel("接口地址").fill("https://api.openai.com/v1");
        await detail.getByLabel("超时").fill("30");
        await detail.getByLabel("超时").blur();
        await expect(heading.locator("h2")).toHaveText("OpenAI");
        await bar.getByRole("button", {name: "保存"}).click();
        await expect(bar.getByRole("button", {name: "保存"})).toBeDisabled();
        // 保存按钮停用后留不住焦点，页面把它放回详情里的第一个输入框。
        await expect(detail.getByLabel("标识")).toBeFocused();
        await heading.locator("[data-settings-heading-back]").click();
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(2)).toContainText("OpenAI");
        await expect(rows.nth(2)).toBeFocused();
        await expect(bar).toHaveCount(0);

        // 再打开这一家改名字，不保存就离开：先确认。
        await rows.nth(2).click();
        await detail.getByLabel("名称").fill("OpenAI 官方");
        await detail.getByLabel("名称").blur();
        await page.locator("[data-settings-nav='nbook.appearance']").click();
        const dialog = page.getByRole("alertdialog");
        await expect(dialog).toContainText("放弃未保存的更改？");
        await expect(dialog.getByRole("button", {name: "继续编辑"})).toBeFocused();
        await dialog.getByRole("button", {name: "继续编辑"}).click();
        await expect(dialog).toHaveCount(0);
        await expect(models).toBeVisible();
        await page.locator("[data-settings-nav='nbook.appearance']").click();
        await page.getByRole("alertdialog").getByRole("button", {name: "放弃"}).click();
        await expect(page.locator("[data-settings-section='nbook.appearance']")).toBeVisible();
        // 离开页面后标题区不再带着“‹ 模型服务”。
        await expect(heading.locator("[data-settings-heading-back]")).toHaveCount(0);
    } finally {
        dev.child.kill("SIGTERM");
        expect(await dev.exit).toBe(0);
    }
});
