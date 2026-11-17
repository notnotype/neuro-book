/**
 * 欢迎页在真实 Chrome 中的验收（docs/specs/workbench/bookshelf.md 的“欢迎页”与验收 10–12，docs/specs/workbench/editor.md
 * 输出 33）：生产构建的后端与前端，项目 `book` 先登记好（带书名与简介），文件在真实目录里。每个用例一个新的浏览器上下文，
 * 也就是一个新客户端：这部作品对它来说都是第一次打开。
 */

import {randomUUID} from "node:crypto";
import {access, mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

let tmp = "";
let projectDir = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "welcome");
    projectDir = join(tmp, "Book");
    const stateRoot = join(tmp, "state");
    const id = randomUUID();
    const files: Record<string, string> = {
        ".nbook/project.json": JSON.stringify({schema: 1, id, title: "雾港", description: "灯塔熄灭的那一夜。"}),
        "大纲.md": "# 大纲\n",
        "设定/人物.md": "沈屿\n",
        "正文/第一章.md": "第一章\n",
    };
    for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(projectDir, path)), {recursive: true});
        await writeFile(join(projectDir, path), text);
    }
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

test.use({viewport: {width: 1440, height: 900}});

const welcome = (page: Page) => page.locator("[data-welcome-page]");
const labels = (page: Page) => page.locator("[data-editor-tab-label]");
const activeLabel = (page: Page) => page.locator("[data-editor-tab][aria-selected=\"true\"] [data-editor-tab-label]");
const exists = (path: string): Promise<boolean> => access(join(projectDir, path)).then(() => true, () => false);

async function open(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
}

test("作品第一次在本窗口打开：自动打开欢迎页，书名、简介、统计行、快捷入口与入门都在；刷新后不恢复（验收 10）", async ({page}) => {
    await open(page);
    await expect(welcome(page)).toBeVisible();
    await expect(labels(page)).toHaveText(["欢迎"]);
    await expect(page.locator("[data-welcome-title]")).toHaveText("雾港");
    await expect(page.locator("[data-welcome-description]")).toHaveText("灯塔熄灭的那一夜。");
    await expect(page.locator("[data-welcome-stats]")).toBeVisible();
    await expect(page.locator("[data-welcome-quick]")).toHaveText(["打开大纲", "打开设定"]);
    await expect(page.locator("[data-welcome-no-recent]")).toBeVisible();
    await expect(welcome(page)).toContainText("入门");

    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(page.locator("[data-editor-empty]")).toBeVisible();
    await expect(labels(page)).toHaveCount(0);
});

test("新建章节：在项目根建“新章节.md”并以正式标签打开；再建一次是“新章节 2.md”（验收 11）", async ({page}) => {
    await open(page);
    await page.locator("[data-welcome-new-chapter]").click();
    await expect(activeLabel(page)).toHaveText("新章节.md");
    await expect.poll(() => exists("新章节.md")).toBe(true);
    await expect(page.locator("[data-editor-tab][aria-selected=\"true\"]")).not.toHaveAttribute("data-editor-tab-preview", "");

    await page.locator("[data-editor-tab-label]", {hasText: "欢迎"}).click();
    await page.locator("[data-welcome-new-chapter]").click();
    await expect(activeLabel(page)).toHaveText("新章节 2.md");
    await expect.poll(() => exists("新章节 2.md")).toBe(true);
});

test("快捷入口、最近打开与“帮助 > 欢迎”：打开大纲打开文件，打开设定在资源管理器里展开并选中；打开过的文件进最近打开；菜单切回同一个欢迎页；回到书架（验收 12）", async ({page}) => {
    await open(page);
    await page.locator("[data-welcome-quick=\"project://大纲.md\"]").click();
    await expect(activeLabel(page)).toHaveText("大纲.md");

    await page.locator("[data-editor-tab-label]", {hasText: "欢迎"}).click();
    await expect(page.locator("[data-welcome-recent]")).toHaveText(["大纲.md"]);
    await page.locator("[data-welcome-quick=\"project://设定\"]").click();
    await expect(page.locator("[data-explorer-row=\"project://设定\"]")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("[data-explorer-row=\"project://设定\"]")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-explorer-row=\"project://设定/人物.md\"]")).toBeVisible();

    // 关掉欢迎页、切到大纲，再从“帮助”菜单打开：只有一个欢迎页。
    await page.locator("[data-editor-tab-label]", {hasText: "大纲.md"}).click();
    await page.locator("[data-workbench-titlebar] [role=\"menuitem\"]", {hasText: "帮助"}).click();
    await page.locator("[role=\"menu\"][data-state=\"open\"]").getByRole("menuitem", {name: "欢迎"}).click();
    await expect(activeLabel(page)).toHaveText("欢迎");
    await expect(labels(page)).toHaveText(["欢迎", "大纲.md"]);

    await page.locator("[data-welcome-shelf]").first().click();
    await page.waitForURL((url) => url.pathname === "/" && !url.searchParams.has("project"));
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-workbench-home", "nbook.projects.bookshelf");
});

test("标题栏回到书架的三个入口：作品下拉、文件菜单（排在“打开项目”之后）、标志（ui/workbench-shell 输出 28、29）", async ({page}) => {
    const atShelf = async (): Promise<void> => {
        await page.waitForURL((url) => url.pathname === "/" && !url.searchParams.has("project"));
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-workbench-home", "nbook.projects.bookshelf");
    };
    const titlebar = page.locator("[data-workbench-titlebar]");

    await open(page);
    await titlebar.locator("[data-titlebar-project]").click();
    const projectMenu = page.locator("[role=\"menu\"][data-state=\"open\"]");
    await expect(projectMenu.getByRole("menuitem")).toHaveText(["打开项目…", "回到书架"]);
    await projectMenu.getByRole("menuitem", {name: "回到书架"}).click();
    await atShelf();

    await open(page);
    await titlebar.locator("[role=\"menuitem\"]", {hasText: "文件"}).click();
    const fileMenu = page.locator("[role=\"menu\"][data-state=\"open\"]");
    const names = await fileMenu.getByRole("menuitem").allTextContents();
    expect(names.findIndex((name) => name.startsWith("回到书架"))).toBe(names.findIndex((name) => name.startsWith("打开项目")) + 1);
    await fileMenu.getByRole("menuitem", {name: "回到书架"}).click();
    await atShelf();

    await open(page);
    await titlebar.getByRole("button", {name: "回到书架"}).click();
    await atShelf();
});
