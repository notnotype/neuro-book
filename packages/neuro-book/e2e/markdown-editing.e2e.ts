/**
 * Markdown 的编辑命令与菜单（docs/specs/workbench/markdown-editing.md）：本机 Chrome 的真实键盘与鼠标，产品页、真实文件服务；
 * 判据是看得见的菜单与保存后磁盘上的原文。动作本身的规则由 `editing-actions.dom.test.ts` 逐条测，这里只留要真实浏览器的。
 */

import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
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
    tmp = await createTestTmpRoot("neuro-book-e2e", "markdown-editing");
    projectDir = join(tmp, "Book");
    const stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await mkdir(join(projectDir, "notes"), {recursive: true});
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const item = (page: Page, address: string) => page.locator(`[data-explorer-row="${address}"]`);
const activeGroup = (page: Page) => page.locator("[data-editor-group-active]");
const prose = (page: Page) => activeGroup(page).locator("[data-editor-kind=\"nbook.editor.markdown\"]:visible [data-editor-prose]");
const toolbarButton = (page: Page, name: string) => activeGroup(page).locator(".markdown-toolbar").getByRole("button", {name, exact: true});
const selectionMenu = (page: Page) => page.locator("[data-markdown-selection-menu]");
const disk = (path: string): Promise<string> => readFile(join(projectDir, path), "utf8");

async function openFile(page: Page, path: string, text: string): Promise<void> {
    await mkdir(dirname(join(projectDir, path)), {recursive: true});
    await writeFile(join(projectDir, path), text);
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    const folder = item(page, "project://notes");
    if (await folder.getAttribute("aria-expanded") !== "true") await folder.click();
    await item(page, `project://${path}`).dblclick();
    await expect(prose(page)).toBeVisible();
}

/** 点进第一段。键要等正文拿到焦点再按：负载下点击之后编辑器还没聚焦时，按键落空。 */
async function focusFirst(page: Page): Promise<void> {
    await prose(page).locator("p").first().click();
    await expect(prose(page)).toBeFocused();
}

/** 用鼠标选中第一段开头的一段：`release` 为假时停在拖动中。 */
async function dragSelect(page: Page, release = true): Promise<void> {
    const paragraph = prose(page).locator("p").first();
    const box = await paragraph.boundingBox();
    if (box === null) throw new Error("第一段不可见");
    const y = box.y + 12;
    await page.mouse.move(box.x + 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, y, {steps: 4});
    if (release) await page.mouse.up();
}

test.describe("工具栏", () => {
    test("点按钮加粗，勾选状态跟着变，光标留在正文", async ({page}) => {
        await openFile(page, "notes/toolbar-bold.md", "第一段文字\n");
        await focusFirst(page);
        await page.keyboard.press("Control+a");
        await toolbarButton(page, "粗体").click();
        await expect(toolbarButton(page, "粗体")).toHaveAttribute("aria-pressed", "true");
        await expect(prose(page)).toBeFocused();
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/toolbar-bold.md")).toBe("**第一段文字**\n");
    });

    test("版心变窄时收进“更多操作”，没有横向滚动", async ({page}) => {
        await openFile(page, "notes/toolbar-narrow.md", "字\n");
        const row = activeGroup(page).locator(".markdown-toolbar [role=\"toolbar\"]");
        await expect(toolbarButton(page, "清除格式")).toBeVisible();
        await page.setViewportSize({width: 760, height: 700});
        await expect(toolbarButton(page, "清除格式")).toHaveCount(0);
        await expect(toolbarButton(page, "更多操作")).toBeVisible();
        const {scrollWidth, clientWidth} = await row.evaluate((element) => ({scrollWidth: element.scrollWidth, clientWidth: element.clientWidth}));
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
        await toolbarButton(page, "更多操作").click();
        await expect(page.getByRole("menuitem", {name: "清除格式"})).toBeVisible();
    });

    test("“视图”菜单关掉后工具栏消失，再打开恢复", async ({page}) => {
        await openFile(page, "notes/toolbar-toggle.md", "字\n");
        const toolbar = activeGroup(page).locator(".markdown-toolbar");
        await expect(toolbar).toBeVisible();
        await page.keyboard.press("Control+Shift+P");
        await page.keyboard.type("工具栏");
        await page.keyboard.press("Enter");
        await expect(toolbar).toHaveCount(0);
        await page.keyboard.press("Control+Shift+P");
        await page.keyboard.type("工具栏");
        await page.keyboard.press("Enter");
        await expect(toolbar).toBeVisible();
    });
});

test.describe("选区菜单", () => {
    test("拖选中不出现，松手才出现", async ({page}) => {
        await openFile(page, "notes/selection-drag.md", "第一段文字有好多字在这里\n");
        await dragSelect(page, false);
        await expect(selectionMenu(page)).toHaveCount(0);
        await page.mouse.up();
        await expect(selectionMenu(page)).toBeVisible();
    });

    test("菜单里加粗写回；打字后收起", async ({page}) => {
        await openFile(page, "notes/selection-bold.md", "第一段文字有好多字在这里\n");
        await dragSelect(page);
        await selectionMenu(page).getByRole("button", {name: "粗体"}).click();
        await expect(selectionMenu(page).getByRole("button", {name: "粗体"})).toHaveAttribute("aria-pressed", "true");
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/selection-bold.md")).toContain("**");
        await page.keyboard.type("后");
        await expect(selectionMenu(page)).toHaveCount(0);
    });

    test("按 Esc 收起；键盘选完也出现", async ({page}) => {
        await openFile(page, "notes/selection-esc.md", "第一段文字\n");
        await focusFirst(page);
        await page.keyboard.press("Home");
        await page.keyboard.press("Shift+End");
        await expect(selectionMenu(page)).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(selectionMenu(page)).toHaveCount(0);
    });

    test("代码块里不出现", async ({page}) => {
        await openFile(page, "notes/selection-code.md", "```\ncode here\n```\n");
        await prose(page).locator("pre").click();
        await expect(prose(page)).toBeFocused();
        await page.keyboard.press("Home");
        await page.keyboard.press("Shift+End");
        await expect(selectionMenu(page)).toHaveCount(0);
    });

    test("注音：选区菜单里输入，回车写回", async ({page}) => {
        await openFile(page, "notes/selection-ruby.md", "汉字\n");
        await focusFirst(page);
        await page.keyboard.press("Control+a");
        await expect(selectionMenu(page)).toBeVisible();
        await selectionMenu(page).getByRole("button", {name: "注音"}).click();
        const input = page.getByRole("textbox", {name: "注音"});
        await expect(input).toBeFocused();
        await input.fill("hàn zì");
        await page.keyboard.press("Enter");
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/selection-ruby.md")).toBe("<ruby text=\"hàn zì\">汉字</ruby>\n");
    });
});
