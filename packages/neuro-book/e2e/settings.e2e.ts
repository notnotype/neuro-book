/**
 * 配置在真实 Chrome 中的验收（docs/specs/settings/configuration.md 验收 2、3，docs/specs/theme/system.md 的“运行时流程”，
 * docs/specs/workbench/quick-open.md 的显示语言）：生产构建的外壳与后端；Lab 的那一条用真实的开发会话（Lab 只在开发
 * 模式加载）。设置文件在测试临时根下，外部修改直接写文件，等页面上可观察的变化，不按时长等待。
 */

import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
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

async function open(page: Page, path = "/"): Promise<void> {
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
const pageBackground = (page: Page) => page.locator(".nb-empty-workbench").evaluate((element) => getComputedStyle(element).backgroundColor);

/** 首页的背景、文字颜色与字体，以及同一位置上 `--bg-main`、`--text-main`、`--font-ui` 解析出的值（用探针元素求出）。 */
const pageTokens = (page: Page) => page.locator(".nb-empty-workbench").evaluate((element) => {
    const probe = document.createElement("div");
    probe.style.cssText = "background-color: var(--bg-main); color: var(--text-main); font-family: var(--font-ui)";
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
    await expect(b.getByText("工作台已就绪。没有打开项目。")).toBeVisible();

    await runCommand(a, "切换界面语言");
    await choose(a, "English");
    await expect.poll(() => html(b, "lang")).toBe("en-US");
    await expect(b.getByText("The workbench is ready. No project is open.")).toBeVisible();
    await expect(a.getByText("The workbench is ready. No project is open.")).toBeVisible();

    // 面板自己的文字按当前语言。
    await expect(async () => {
        await a.keyboard.press("Control+Shift+P");
        await expect(a.getByRole("combobox", {name: "Type a command, or : to go to a line"})).toBeFocused({timeout: 500});
    }).toPass();
    await a.keyboard.press("Escape");

    await b.reload();
    await expect(b.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
    await expect(b.getByText("The workbench is ready. No project is open.")).toBeVisible();

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
