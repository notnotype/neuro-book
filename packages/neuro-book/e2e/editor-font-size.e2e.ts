/**
 * 编辑器字号在真实 Chrome 中的验收（docs/specs/workbench/editor.md 输出 32、52 与“字号”输出）：Markdown 纸面的字体、字号、行距经
 * 用户层文件改；桌面里（页面前装一个壳的发送函数桩）Ctrl+滚轮在源码编辑器与 Markdown 编辑器上改对应的字号设置、防抖后写进
 * 用户层；浏览器里（没有桩）不接管、不改设置。生产构建的后端与前端，项目 `book` 先登记好。
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
let stateRoot = "";
let server: ProductServer;

const FILES: Readonly<Record<string, string>> = {
    "note.md": "# 标题\n\n正文一段。\n",
    "code/a.py": "def a():\n    return 1\n",
};

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "editor-font-size");
    const projectDir = join(tmp, "Book");
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

const settingsFile = (): string => join(stateRoot, "settings.json");
const writeUser = (values: Readonly<Record<string, unknown>>): Promise<void> => writeFile(settingsFile(), JSON.stringify(values, null, 4));
const userLayer = async (): Promise<Record<string, unknown>> => JSON.parse(await readFile(settingsFile(), "utf8").catch(() => "{}")) as Record<string, unknown>;

const item = (page: Page, address: string) => page.locator(`[data-explorer-row="${address}"]`);
const prose = (page: Page) => page.locator("[data-editor-group-active] .markdown-control__prose");
const monaco = (page: Page) => page.locator("[data-editor-group-active] [data-editor-monaco] .monaco-editor");
const markdownSize = (page: Page): Promise<string> => prose(page).evaluate((element) => getComputedStyle(element).fontSize);
const codeSize = (page: Page): Promise<string> => monaco(page).locator(".view-lines").evaluate((element) => getComputedStyle(element).fontSize);

async function openWorkbench(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(page.locator("[data-workbench-titlebar]")).toBeVisible();
}

async function openNote(page: Page): Promise<void> {
    await item(page, "project://note.md").dblclick();
    await expect(prose(page)).toContainText("正文一段");
}

async function openCode(page: Page): Promise<void> {
    if (await item(page, "project://code").getAttribute("aria-expanded") !== "true") await item(page, "project://code").click();
    await item(page, "project://code/a.py").dblclick();
    await expect(monaco(page).locator(".view-lines")).toContainText("return");
}

/** 桌面壳的桩：页面据此认为自己在桌面里（预加载在页面脚本之前装上发送函数）。 */
async function installShell(page: Page): Promise<void> {
    await page.addInitScript(() => {
        (window as unknown as {__electrobunSendToHost: (message: unknown) => void}).__electrobunSendToHost = () => undefined;
    });
}

/** 记下冒泡到窗口的 Ctrl+滚轮有没有被拦下：页面里谁也不拦时它是浏览器自己的缩放。 */
async function recordWheel(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const seen: boolean[] = [];
        (window as unknown as {__wheelPrevented: boolean[]}).__wheelPrevented = seen;
        window.addEventListener("wheel", (event) => seen.push(event.defaultPrevented));
    });
}

/** 在元素中心按住 Ctrl 滚一格（`deltaY` 为负是向上，放大）。 */
async function ctrlWheel(page: Page, target: ReturnType<Page["locator"]>, deltaY: number): Promise<void> {
    const box = await target.boundingBox();
    await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + Math.min((box?.height ?? 0) / 2, 120));
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, deltaY);
    await page.keyboard.up("Control");
}

test.beforeEach(async () => {
    await writeUser({});
});

test("Markdown 纸面：字体、字号、行距读用户层设置，改了立即跟着变；字体留空走皮肤与界面字体", async ({page}) => {
    await openWorkbench(page);
    await openNote(page);
    expect(await markdownSize(page)).toBe("17px");
    await writeUser({"nbook.editor/markdown.fontSize": 22, "nbook.editor/markdown.lineHeight": 250, "nbook.editor/markdown.fontFamily": "Georgia, serif"});
    await expect.poll(() => markdownSize(page)).toBe("22px");
    const style = await prose(page).evaluate((element) => ({lineHeight: getComputedStyle(element).lineHeight, family: getComputedStyle(element).fontFamily}));
    expect(style.lineHeight).toBe("55px");
    expect(style.family).toContain("Georgia");
    await writeUser({"nbook.editor/markdown.fontSize": 18});
    await expect.poll(() => markdownSize(page)).toBe("18px");
    expect((await prose(page).evaluate((element) => getComputedStyle(element).fontFamily))).not.toContain("Georgia");
});

test("桌面里：Ctrl+滚轮在 Markdown 编辑器与源码编辑器上改各自的字号，防抖后写进用户层；不满一档不换", async ({page}) => {
    await installShell(page);
    await openWorkbench(page);
    await openNote(page);
    // 不满一档（累积 60）：不换。
    await ctrlWheel(page, prose(page), -60);
    expect(await markdownSize(page)).toBe("17px");
    await ctrlWheel(page, prose(page), -60);
    await expect.poll(() => markdownSize(page)).toBe("18px");
    await expect.poll(userLayer).toEqual({"nbook.editor/markdown.fontSize": 18});
    // 缩小回缺省：用户层的键被删掉，不是写进缺省值。
    await ctrlWheel(page, prose(page), 100);
    await expect.poll(() => markdownSize(page)).toBe("17px");
    await expect.poll(userLayer).toEqual({});
    // 落在 Markdown 的工具栏上也改同一项（工具栏在控件的滚动容器之外）。
    const toolbar = page.locator("[data-editor-group-active] .markdown-toolbar");
    await expect(toolbar).toBeVisible();
    await ctrlWheel(page, toolbar, -100);
    await expect.poll(() => markdownSize(page)).toBe("18px");

    await openCode(page);
    expect(await codeSize(page)).toBe("14px");
    await ctrlWheel(page, monaco(page), -100);
    await expect.poll(() => codeSize(page)).toBe("15px");
    await expect.poll(userLayer).toEqual({"nbook.editor/markdown.fontSize": 18, "nbook.editor/code.fontSize": 15});
    // 源码编辑器里 Ctrl+滚轮不顺便把代码滚走（捕获阶段先拦下）。
    expect(await monaco(page).locator(".view-lines").evaluate((element) => (element.parentElement as HTMLElement).scrollTop ?? 0)).toBe(0);
});

test("浏览器里（没有壳）：Markdown 编辑器上的 Ctrl+滚轮不被拦、字号与设置都不变", async ({page}) => {
    await recordWheel(page);
    await openWorkbench(page);
    await openNote(page);
    await ctrlWheel(page, prose(page), -100);
    await ctrlWheel(page, prose(page), -100);
    expect(await markdownSize(page)).toBe("17px");
    expect(await userLayer()).toEqual({});
    expect((await page.evaluate(() => (window as unknown as {__wheelPrevented: boolean[]}).__wheelPrevented)).includes(true)).toBe(false);
});
