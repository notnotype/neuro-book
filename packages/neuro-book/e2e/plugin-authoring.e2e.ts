/**
 * 仓库外写插件（docs/specs/runtime/plugin-api.md 的“作者工具”与验收 12，plugin-install.md 的安装、启停与卸载）：用生成的
 * SDK 包在临时目录里 `create`、`build`（Bun 运行包里的命令），在设置窗口的插件页安装产物、重启；模板的侧栏视图显示设置项的
 * 问候语，命令面板里的命令让视图里的计数加一，改设置项后视图跟着变；禁用、卸载各在重启后生效。“重启”是有序停止服务端再在
 * 同一个状态根上起一个新进程。
 *
 * 消失类的判据先确认窗口已就绪、并有一条肯定的判据（插件行在、状态是已禁用或已不列出），否则页面还没画完时“看不到”也会成立。
 */

import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {authorDirectory, cliOf} from "../plugin-sdk/testing/author";

import {PACKAGE_ROOT, startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

const PLUGIN = "my.hello-world";
const VIEW = `view:${PLUGIN}.hello`;

let tmp = "";
let stateRoot = "";
let author = "";
let server: ProductServer | null = null;

/** 运行命令，失败时带上全部输出抛错；成功时返回标准输出。 */
async function run(command: string, args: ReadonlyArray<string>, cwd: string): Promise<string> {
    const child = spawn(command, args, {cwd, stdio: ["ignore", "pipe", "pipe"]});
    let stdout = "";
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const code = await new Promise<number>((resolve) => child.on("exit", (exit) => resolve(exit ?? 1)));
    if (code !== 0) throw new Error(`${command} ${args.join(" ")} 失败：\n${output}`);
    return stdout;
}

test.beforeAll(async () => {
    // 生成 SDK 包（打包与声明文件）要半分钟上下。
    test.setTimeout(240_000);
    tmp = await createTestTmpRoot("neuro-book-e2e", "plugin-authoring");
    stateRoot = join(tmp, "state");
    const book = join(tmp, "Book");
    const id = randomUUID();
    await mkdir(join(book, ".nbook"), {recursive: true});
    await mkdir(stateRoot, {recursive: true});
    await writeFile(join(book, ".nbook", "project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: book}]}));

    // 作者的那一边：生成 SDK 包的 tarball（命令最后一行打印它的路径），在仓库外的目录里装上它，用 Bun 运行包里的命令生成、构建。
    const tarball = (await run("bun", ["plugin-sdk/pack.ts", join(tmp, "sdk")], PACKAGE_ROOT)).trim().split("\n").at(-1)!;
    author = await authorDirectory(join(tmp, "hello-world"), tarball);
    await run("bun", [cliOf(author), "create", "."], author);
    await run("bun", [cliOf(author), "build"], author);
});

test.afterAll(async () => {
    if (server !== null) expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 先让页面离开：页面开着时停服务端，配置层断开会记一条警告，那是重启本身的结果。 */
async function restart(page: Page): Promise<void> {
    await page.goto("about:blank");
    if (server !== null) expect(await server.stop()).toBe(0);
    server = await startProductServer(stateRoot);
}

async function openWorkbench(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server!.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
}

async function openSettings(page: Page, section: string): Promise<void> {
    await page.locator("[data-activity-item='nbook.settings']").click();
    await expect(page.locator("[data-settings-window]")).toBeVisible();
    await page.locator(`[data-settings-nav="${section}"]`).click();
}

/**
 * 显示模板的视图。活动栏条目点一下已经聚焦的视图会隐藏它，所以只在它没按下时点。
 */
async function showView(page: Page): Promise<void> {
    const container = page.locator(`[data-tool-entry='${VIEW.slice("view:".length)}']`);
    await expect(container).toBeVisible();
    if ((await container.getAttribute("aria-pressed")) !== "true") await container.click();
    await expect(container).toHaveAttribute("aria-pressed", "true");
}

/** 打开命令面板（命令宿主随页面异步加载，按到面板出现为止），输入文字，等第一项就是要的命令再按回车。 */
async function runCommand(page: Page, text: string): Promise<void> {
    const combobox = page.getByRole("combobox");
    await expect(async () => {
        await page.keyboard.press("Control+Shift+P");
        await expect(combobox).toBeFocused({timeout: 500});
    }).toPass();
    await combobox.fill(`>${text}`);
    await expect(page.getByRole("option").first()).toContainText(text);
    await page.keyboard.press("Enter");
}

const pluginRow = (page: Page) => page.locator(`[data-plugin-row="${PLUGIN}"]`);

test("仓库外 create、build 的插件：安装、重启后视图显示设置里的问候语，命令让计数加一，改设置后视图跟着变；禁用、卸载各在重启后生效", async ({page}) => {
    // 四次重启服务端。
    test.setTimeout(180_000);
    await restart(page);
    await openWorkbench(page);
    await openSettings(page, "nbook.plugins.installed");
    await page.locator("[data-plugin-path] input, input[data-plugin-path]").first().fill(join(author, "dist"));
    await page.locator("[data-plugin-install]").click();
    await page.getByRole("dialog", {name: "安装插件"}).getByRole("button", {name: "安装"}).click();
    await expect(pluginRow(page).locator("[data-plugin-pending='install']")).toBeVisible();

    await restart(page);
    await openWorkbench(page);
    await showView(page);
    // 落在模板视图组件画出来的元素上：入口代码装载失败时工作台照样画出视图的外框，只是里面是错误摘要。
    const view = page.locator("[data-hello-view]");
    await expect(view.locator("[data-hello-greeting]")).toHaveText("你好");
    await expect(view.locator("[data-hello-count]")).toHaveText("已经打过 0 次招呼");
    await runCommand(page, "Hello World：打个招呼");
    await expect(view.locator("[data-hello-count]")).toHaveText("已经打过 1 次招呼");

    await openSettings(page, `${PLUGIN}.main`);
    const greeting = page.locator(`[data-settings-row="${PLUGIN}/greeting"] input`);
    await greeting.fill("早上好");
    await greeting.press("Enter");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-settings-window]")).toHaveCount(0);
    await expect(view.locator("[data-hello-greeting]")).toHaveText("早上好");

    // 禁用：先显示“重启后禁用”，重启后视图的容器不再出现，插件行还在。
    await openSettings(page, "nbook.plugins.installed");
    await pluginRow(page).locator("[data-plugin-toggle]").click();
    await expect(pluginRow(page).locator("[data-plugin-pending='disable']")).toBeVisible();
    await restart(page);
    await openWorkbench(page);
    // 先有一条肯定的判据：活动栏已经画出内置的资源管理器，模板视图的容器才算真的没有。
    await expect(page.locator("[data-tool-entry='nbook.explorer']")).toBeVisible();
    await expect(page.locator(`[data-tool-entry='${VIEW.slice("view:".length)}']`)).toHaveCount(0);
    await openSettings(page, "nbook.plugins.installed");
    await expect(pluginRow(page)).toBeVisible();
    await expect(pluginRow(page).locator("[data-plugin-pending]")).toHaveCount(0);

    // 卸载：重启后插件页不再列出它。
    await pluginRow(page).locator("[data-plugin-uninstall]").click();
    await page.getByRole("dialog", {name: "卸载插件"}).getByRole("button", {name: "卸载"}).click();
    await expect(pluginRow(page).locator("[data-plugin-pending='uninstall']")).toBeVisible();
    await restart(page);
    await openWorkbench(page);
    await openSettings(page, "nbook.plugins.installed");
    await expect(page.locator("[data-plugin-row='nbook.settings']")).toBeVisible();
    await expect(pluginRow(page)).toHaveCount(0);
});
