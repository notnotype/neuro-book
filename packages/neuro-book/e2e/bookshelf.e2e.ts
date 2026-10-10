/**
 * 书架页在真实 Chrome 中的验收（docs/specs/workbench/bookshelf.md 验收 1–5）：生产构建的后端与前端，真实的项目目录、
 * 登记表与用户层配置。项目 `book` 先登记好；第二个目录用“加入已有目录”登记；新作品建在用例选的作品目录下。
 * 等页面上可观察的变化，不按时长等待。
 */

import {randomUUID} from "node:crypto";
import {access, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

let tmp = "";
let stateRoot = "";
let bookDir = "";
let oldDir = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "bookshelf");
    bookDir = join(tmp, "Book");
    oldDir = join(tmp, "Old Draft");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    const files: Record<string, string> = {".nbook/project.json": JSON.stringify({schema: 1, id}), "notes/a.md": "第一章\n\n他把灯放低一些。\n"};
    for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(bookDir, path)), {recursive: true});
        await writeFile(join(bookDir, path), text);
    }
    await mkdir(join(oldDir, "notes"), {recursive: true});
    await writeFile(join(oldDir, "notes", "x.md"), "旧稿\n");
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: bookDir}]}));
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const root = (page: Page) => page.locator("[data-workbench-root]");
const shelfPage = (page: Page) => page.locator("[data-bookshelf-page]");
const spine = (page: Page, title: string) => page.locator('[data-spine-shelf] [role="option"]', {hasText: title});
const titlePage = (page: Page) => page.locator("[data-shelf-title-page]");

async function openShelf(page: Page): Promise<void> {
    await page.goto(new URL("/", server.url).href);
    await expect(root(page)).toHaveAttribute("data-rpc-state", "online");
    await expect(root(page)).toHaveAttribute("data-workbench-home", "nbook.projects.bookshelf");
    await expect(shelfPage(page)).toBeVisible();
    await expect(page.locator("[data-spine-shelf]")).toBeVisible();
}

/** 命令面板的路径输入：按占位文字找到输入框，填路径，选中“……路径”那一项。 */
async function typePath(page: Page, placeholder: string, path: string, optionName: string): Promise<void> {
    const picker = page.getByRole("combobox", {name: placeholder});
    await expect(picker).toBeFocused();
    await picker.fill(path);
    await expect(page.getByRole("option", {name: optionName})).toBeVisible();
    await page.keyboard.press("Enter");
}

test("书架列出已登记的作品、尚未统计；扉页跟随选中；“打开”整页进入作品，“进入工作台”进入空工作台", async ({page}) => {
    await openShelf(page);
    await expect(spine(page, "book")).toHaveCount(1);
    await spine(page, "book").click();
    await expect(titlePage(page)).toContainText("book");
    await expect(titlePage(page)).toContainText("尚未统计");
    await expect(titlePage(page)).toContainText(bookDir);
    // 没有写作记录：继续写作换成欢迎文字。
    await expect(shelfPage(page)).toContainText("还没有写作记录");

    await titlePage(page).locator("[data-shelf-open]").click();
    await page.waitForURL(/\?project=book$/u);
    await expect(page.locator("[data-workbench-project]")).toHaveAttribute("data-workbench-project", "book");
    await expect(root(page)).toHaveAttribute("data-rpc-state", "online");

    await openShelf(page);
    await page.locator("[data-enter-workbench]").click();
    await page.waitForURL((url) => url.pathname === "/workbench");
    await expect(page.locator("[data-workbench-shell]")).toBeVisible();
    await expect(page.locator("[data-workbench-project]")).toHaveCount(0);
});

test("加入已有目录、编辑作品信息、从书架移除：书架随服务端的结果更新，目录不动", async ({page}) => {
    await openShelf(page);
    await page.locator("[data-shelf-add]").click();
    await typePath(page, "输入作品目录的路径（服务端上的路径）", oldDir, `加入 ${oldDir}`);
    await expect(spine(page, "old-draft")).toHaveCount(1);
    // 登记成功后它被选中，扉页显示它。
    await expect(titlePage(page)).toContainText(oldDir);

    await titlePage(page).getByRole("button", {name: "编辑信息"}).click();
    const dialog = page.locator("[data-project-info-dialog]");
    await expect(dialog).toBeVisible();
    await dialog.locator("[data-project-title]").fill("北方以北");
    await dialog.locator("[data-project-description]").fill("一部旧稿。");
    await page.getByRole("button", {name: "保存"}).click();
    await expect(dialog).toHaveCount(0);
    await expect(spine(page, "北方以北")).toHaveCount(1);
    await expect(titlePage(page)).toContainText("一部旧稿。");
    const identity = JSON.parse(await readFile(join(oldDir, ".nbook", "project.json"), "utf8")) as {title?: string; description?: string};
    expect(identity).toMatchObject({title: "北方以北", description: "一部旧稿。"});

    await titlePage(page).getByRole("button", {name: "从书架移除"}).click();
    await expect(page.getByRole("alertdialog")).toContainText("北方以北");
    await page.getByRole("button", {name: "移除", exact: true}).click();
    await expect(spine(page, "北方以北")).toHaveCount(0);
    await expect(spine(page, "book")).toHaveCount(1);
    // 焦点回到书架。
    await expect(page.locator('[data-spine-shelf] [role="listbox"]')).toBeFocused();
    const registry = JSON.parse(await readFile(join(stateRoot, "projects.json"), "utf8")) as {projects: Array<{name: string}>};
    expect(registry.projects.map((project) => project.name)).toEqual(["book"]);
    await access(join(oldDir, "notes", "x.md"));
});

test("新建作品：作品目录没设时先选目录并记住；同名目录已存在时提示改书名", async ({page}) => {
    await openShelf(page);
    const library = join(tmp, "library");
    await mkdir(library, {recursive: true});
    await page.locator("[data-shelf-create]").click();
    await typePath(page, "输入新作品所在的目录路径，以后新建都放在这里", library, `使用 ${library}`);
    const dialog = page.locator("[data-project-info-dialog]");
    await expect(dialog).toBeVisible();
    await dialog.locator("[data-project-title]").fill("长夜行");
    await dialog.locator("[data-project-description]").fill("雪线以北的驿站。");
    await page.getByRole("button", {name: "新建", exact: true}).click();
    await expect(dialog).toHaveCount(0);
    await expect(spine(page, "长夜行")).toHaveCount(1);
    await expect(titlePage(page)).toContainText(join(library, "长夜行"));
    const identity = JSON.parse(await readFile(join(library, "长夜行", ".nbook", "project.json"), "utf8")) as {title?: string};
    expect(identity.title).toBe("长夜行");
    // 作品目录已记住：再新建不再问目录，直接开对话框。
    await page.locator("[data-shelf-create]").click();
    await expect(dialog).toBeVisible();
    await dialog.locator("[data-project-title]").fill("长夜行");
    await page.getByRole("button", {name: "新建", exact: true}).click();
    await expect(dialog.locator("[data-project-info-error]")).toContainText("同名目录已存在");
    await page.getByRole("button", {name: "取消", exact: true}).click();
    await expect(dialog).toHaveCount(0);
});

test.describe("窄屏", () => {
    test.use({viewport: {width: 390, height: 844}});

    test("只有列表视图，新鲜度说明可见，没有横向滚动", async ({page}) => {
        await page.goto(new URL("/", server.url).href);
        await expect(root(page)).toHaveAttribute("data-workbench-home", "nbook.projects.bookshelf");
        await expect(page.locator("[data-shelf-list]")).toBeVisible();
        await expect(page.locator("[data-spine-shelf]")).toHaveCount(0);
        await expect(page.locator("[data-shelf-list]")).toContainText("尚未统计");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
});
