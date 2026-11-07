/**
 * 源码编辑器的排版设置在真实 Chrome 中的验收（docs/specs/workbench/editor.md 输出 52 的“代码编辑器”小组）：生产构建的
 * 后端与前端，项目 `book` 先登记好，文件在真实目录里，设置经用户层文件改（拥有者监视文件）。缩进看的是行为：在文件末尾的
 * 空行按 Tab、保存，读磁盘上插入了什么。等页面上可观察的变化，不按时长等待。
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
let stateRoot = "";
let server: ProductServer;

/**
 * 三种缩进的文件，末尾都留一个空行给 Tab。每个文件只按一次 Tab：按过之后末行不再是空行，下一次插入多少取决于光标所在的
 * 列，看不出用的是哪份设置。
 */
const TWO = "def a():\n  return 1\n";
const FILES: Readonly<Record<string, string>> = {
    "code/two.py": TWO,
    "code/four.py": "def a():\n    return 1\n",
    "code/tabs.go": "func a() {\n\treturn\n}\n",
    "code/current.py": TWO,
    "code/parked.py": TWO,
    "code/again.py": TWO,
};

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "editor-code-settings");
    projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    for (const [path, content] of Object.entries({".nbook/project.json": JSON.stringify({schema: 1, id}), ...FILES})) {
        await mkdir(dirname(join(projectDir, path)), {recursive: true});
        await writeFile(join(projectDir, path), content);
    }
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const item = (page: Page, address: string) => page.locator(`[data-explorer-row="${address}"]`);
const editor = (page: Page) => page.locator("[data-editor-group-active] [data-editor-monaco] .monaco-editor");
const disk = (path: string): Promise<string> => readFile(join(projectDir, path), "utf8");

async function openFile(page: Page, path: string): Promise<void> {
    if (await item(page, "project://code").getAttribute("aria-expanded") !== "true") await item(page, "project://code").click();
    await item(page, `project://${path}`).dblclick();
    await expect(page.locator("[data-editor-group-head-active] [data-editor-tab][aria-selected=\"true\"]")).toContainText(path.split("/").at(-1)!);
    await expect(editor(page).locator(".view-lines")).toContainText("return");
}

/** 在文件末尾的空行按一次 Tab 并保存，返回这一行多出来的内容。 */
async function tabAtEnd(page: Page, path: string): Promise<string> {
    const before = await disk(path);
    await editor(page).locator(".view-lines").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Control+s");
    await expect.poll(() => disk(path)).not.toBe(before);
    return (await disk(path)).slice(before.length);
}

const fontSize = (page: Page): Promise<string> => editor(page).locator(".view-lines").evaluate((element) => getComputedStyle(element).fontSize);

/**
 * 写用户层文件，等它生效：拥有者监视文件、合并之后才重读，缩进的变化看不见，所以每次连字号一起改，字号变了就是这份
 * 设置到了。
 */
async function setUserSettings(page: Page, values: Readonly<Record<string, unknown>>, size: number): Promise<void> {
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify({...values, "nbook.editor/code.fontSize": size}, null, 4));
    await expect.poll(() => fontSize(page)).toBe(`${String(size)}px`);
}

test("缺省推测缩进：两格、四格与制表符的文件里 Tab 各插入自己的缩进；关掉推测后当前与停放的文件都按 Tab 宽度插空格，再打开推测时重新推测", async ({page}) => {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");

    await openFile(page, "code/two.py");
    expect(await tabAtEnd(page, "code/two.py")).toBe("  ");
    await openFile(page, "code/four.py");
    expect(await tabAtEnd(page, "code/four.py")).toBe("    ");
    await openFile(page, "code/tabs.go");
    expect(await tabAtEnd(page, "code/tabs.go")).toBe("\t");
    // 两个文件先打开过（按缺省设置推测成两格），停放着。
    await openFile(page, "code/parked.py");
    await openFile(page, "code/again.py");
    await openFile(page, "code/current.py");

    // 改设置：编辑器实例不重建（同一个 DOM 元素上的标记还在）。当前的文件立即用新设置，停放的文件显示时用。
    await editor(page).evaluate((element) => {
        (element as HTMLElement & {nbProbe?: boolean}).nbProbe = true;
    });
    await setUserSettings(page, {"nbook.editor/code.detectIndentation": false, "nbook.editor/code.tabSize": 3}, 15);
    expect(await tabAtEnd(page, "code/current.py")).toBe("   ");
    expect(await editor(page).evaluate((element) => (element as HTMLElement & {nbProbe?: boolean}).nbProbe === true)).toBe(true);
    await openFile(page, "code/parked.py");
    expect(await tabAtEnd(page, "code/parked.py")).toBe("   ");

    // 再打开推测：停放的文件显示时按内容重新推测。
    await setUserSettings(page, {}, 16);
    await openFile(page, "code/again.py");
    expect(await tabAtEnd(page, "code/again.py")).toBe("  ");
});

test("字号、行号、缩略图、换行即时生效，编辑器不重建", async ({page}) => {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await openFile(page, "code/four.py");
    await setUserSettings(page, {}, 14);
    await expect(editor(page).locator(".line-numbers").first()).toBeVisible();
    // 关着时 Monaco 也渲染缩略图的元素，只是不显示。
    await expect(editor(page).locator(".minimap")).toBeHidden();
    await editor(page).evaluate((element) => {
        (element as HTMLElement & {nbProbe?: boolean}).nbProbe = true;
    });

    await setUserSettings(page, {"nbook.editor/code.lineNumbers": "off", "nbook.editor/code.minimap": true}, 22);
    await expect(editor(page).locator(".line-numbers")).toHaveCount(0);
    await expect(editor(page).locator(".minimap")).toBeVisible();
    expect(await editor(page).evaluate((element) => (element as HTMLElement & {nbProbe?: boolean}).nbProbe === true)).toBe(true);
});
