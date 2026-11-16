/**
 * 属性面板（docs/specs/workbench/markdown-editing.md 输出 39–51、验收场景 23–26）：本机 Chrome 的真实键盘与鼠标，产品页、
 * 真实文件服务；判据是保存后磁盘上的原文。面板各条规则的细节由 nb-markdown 的 `MarkdownProperties.dom.test.ts` 与
 * `MarkdownControl.dom.test.ts` 测；这里只留它们测不到的：真实键入的 `---`、正文与面板之间的焦点、撤销走工作台的快捷键、
 * 展开状态记在作品里（重新打开页面）、文件被删除后的只读。
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
const written: string[] = [];

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "markdown-properties");
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

test.afterEach(async () => {
    for (const path of written.splice(0)) await rm(join(projectDir, path), {force: true});
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const item = (page: Page, address: string) => page.locator(`[data-explorer-row="${address}"]`);
const prose = (page: Page) => page.locator("[data-editor-group-active] [data-editor-kind=\"nbook.editor.markdown\"]:visible [data-editor-prose]");
const panel = (page: Page) => page.locator("[data-editor-group-active] [data-markdown-properties]:visible");
const field = (page: Page, label: string) => panel(page).locator(`input[aria-label="${label}"]`);
const disk = (path: string): Promise<string> => readFile(join(projectDir, path), "utf8");

/** 写一个文件、打开作品并用富文本打开它；每个用例用自己的文件，用完删掉。 */
async function openFile(page: Page, path: string, text: string | null): Promise<void> {
    if (text !== null) {
        await mkdir(dirname(join(projectDir, path)), {recursive: true});
        await writeFile(join(projectDir, path), text);
        written.push(path);
    }
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    // 恢复会话时文件夹的展开状态还在变：要等到活动标签真是这个文件。
    const name = path.split("/").at(-1) as string;
    await expect(async () => {
        const folder = item(page, "project://notes");
        if (await folder.getAttribute("aria-expanded") !== "true") await folder.click();
        await item(page, `project://${path}`).dblclick({timeout: 3000});
        await expect(page.locator("[data-editor-group-head-active] [data-editor-tab]").filter({hasText: name})).toBeVisible({timeout: 3000});
    }).toPass();
    await expect(prose(page)).toBeVisible();
}

/** 光标放到正文第一段的行首。 */
async function caretAtStart(page: Page): Promise<void> {
    await prose(page).locator("p").first().click();
    await expect(prose(page)).toBeFocused();
    await page.keyboard.press("Control+Home");
}

const SAMPLE = "﻿---\r\n# 第十二章\r\n视角: 林雪\r\n时间: 2025-12-21\r\n地点: [青石镇, 北山]\r\n字数目标: 4000\r\n已定稿: false\r\n---\r\n雪是后半夜落下来的。\r\n";

test("场景 23：收起成摘要；改值、勾选、加一项只改这三行；在正文里撤销三次回到原样；展开状态记在作品里", async ({page}) => {
    await openFile(page, "notes/scene-23.md", SAMPLE);
    await expect(panel(page).locator("[data-property-summary]")).toHaveText("视角 林雪 · 时间 2025-12-21 · 地点 青石镇、北山 · 字数目标 4000 · 已定稿 否");
    await panel(page).locator("button[aria-expanded]").click();
    await field(page, "视角").fill("yes");
    await field(page, "视角").press("Enter");
    await panel(page).locator("[data-property-name=\"已定稿\"] label").click();
    const tags = panel(page).locator("[data-property-name=\"地点\"] [data-property-kind=\"list\"] input");
    await tags.click();
    await page.keyboard.type("渡口");
    await page.keyboard.press("Enter");
    await caretAtStart(page);
    await page.keyboard.press("Control+s");
    const changed = SAMPLE.replace("视角: 林雪", "视角: \"yes\"").replace("已定稿: false", "已定稿: true").replace("地点: [青石镇, 北山]", "地点: [青石镇, 北山, 渡口]");
    await expect.poll(() => disk("notes/scene-23.md")).toBe(changed);
    for (let step = 0; step < 3; step += 1) await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+s");
    await expect.poll(() => disk("notes/scene-23.md")).toBe(SAMPLE);
    // 重新打开页面：这个文件的面板仍展开；另一份带 frontmatter 的文件缺省收起。
    await openFile(page, "notes/scene-23.md", null);
    await expect(field(page, "视角")).toBeVisible();
    await openFile(page, "notes/scene-23-other.md", "---\n甲: 1\n---\n正文\n");
    await expect(panel(page).locator("[data-property-summary]")).toHaveText("甲 1");
});

test("场景 24：第一段开头打 --- 新建；名字回车到值；紧接着退格还原；不在第一块是分割线", async ({page}) => {
    await openFile(page, "notes/scene-24.md", "正文\n");
    await caretAtStart(page);
    await page.keyboard.type("---");
    await expect(field(page, "属性名")).toBeFocused();
    await expect(prose(page).locator("p").first()).toHaveText("正文");
    await page.keyboard.type("视角");
    await page.keyboard.press("Enter");
    await expect(field(page, "视角")).toBeFocused();
    await page.keyboard.type("林雪");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(prose(page)).toBeFocused();
    await page.keyboard.press("Control+s");
    await expect.poll(() => disk("notes/scene-24.md")).toBe("---\n视角: 林雪\n---\n正文\n");

    await openFile(page, "notes/scene-24-undo.md", "甲\n\n乙\n");
    await caretAtStart(page);
    await page.keyboard.type("---");
    // 焦点在空着的新属性名上：退格撤回这次新建，正文里还原成 ---。
    await expect(field(page, "属性名")).toBeFocused();
    await page.keyboard.press("Backspace");
    await expect(panel(page)).toHaveCount(0);
    await expect(prose(page)).toBeFocused();
    await expect(prose(page).locator("p").first()).toHaveText("---甲");
    await prose(page).locator("p").nth(1).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("---");
    await expect(prose(page).locator("hr")).toHaveCount(1);
    await expect(panel(page)).toHaveCount(0);
});

test("场景 25：表示不了的属性只读、点它打开源码；源码写错标出原因、不能切回；改好回到属性；独占一行的 --- 不写回", async ({page}) => {
    const raw = "---\n视角: 林雪\n人物:\n  林雪: 姐妹\n---\n正文\n";
    await openFile(page, "notes/scene-25.md", raw);
    await panel(page).locator("button[aria-expanded]").click();
    const complex = panel(page).locator("[data-property-name=\"人物\"]");
    await expect(complex.locator("[data-property-kind]")).toHaveText("林雪: 姐妹");
    await expect(complex.locator("[data-property-kind] input")).toHaveCount(0);
    await complex.getByRole("button", {name: "在源码里改 人物"}).click();
    const source = panel(page).locator("textarea");
    await expect(source).toBeFocused();
    expect(await source.evaluate((area: HTMLTextAreaElement) => area.selectionStart)).toBe("视角: 林雪\n".length);
    await source.fill("视角: [林雪\n人物:\n  林雪: 姐妹\n");
    await page.keyboard.press("Control+Enter");
    await expect(panel(page).getByRole("alert")).toContainText("YAML 写法有误");
    await expect(panel(page).locator("button[aria-pressed]")).toBeDisabled();
    await source.fill("视角: [林雪]\n人物:\n  林雪: 姐妹\n");
    await page.keyboard.press("Control+Enter");
    await expect(panel(page).locator("textarea")).toHaveCount(0);
    await panel(page).locator("button[aria-pressed]").click();
    await panel(page).locator("textarea").fill("视角: 林雪\n---\n人物: 沈舟\n");
    await page.keyboard.press("Control+Enter");
    await expect(panel(page).getByRole("alert")).toContainText("只写着 ---");
    await caretAtStart(page);
    await page.keyboard.press("Control+s");
    await expect.poll(() => disk("notes/scene-25.md")).toBe("---\n视角: [林雪]\n人物:\n  林雪: 姐妹\n---\n正文\n");
});

test("场景 26：上方向键进面板、Esc 回正文且写回；输入框里的 Ctrl+Z 只撤输入框；文件被删除后只读", async ({page}) => {
    await openFile(page, "notes/scene-26.md", "---\n视角: 林雪\n---\n正文\n");
    await panel(page).locator("button[aria-expanded]").click();
    // 正文先有一步可撤销的编辑：输入框里的 Ctrl+Z 若被当成编辑器的撤销，这一步会没了。
    await caretAtStart(page);
    await page.keyboard.type("改");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowUp");
    await expect(panel(page).getByRole("button", {name: "添加属性"})).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(field(page, "视角")).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type("与沈舟");
    await page.keyboard.press("Control+z");
    await expect(field(page, "视角")).not.toHaveValue("林雪与沈舟");
    await expect(prose(page).locator("p").first()).toHaveText("改正文");
    await field(page, "视角").fill("沈舟");
    await page.keyboard.press("Escape");
    await expect(prose(page)).toBeFocused();
    await page.keyboard.press("Control+s");
    await expect.poll(() => disk("notes/scene-26.md")).toBe("---\n视角: 沈舟\n---\n改正文\n");

    await rm(join(projectDir, "notes/scene-26.md"));
    await expect(panel(page).getByRole("button", {name: "添加属性"})).toHaveCount(0);
    await expect(field(page, "视角")).toHaveAttribute("readonly", "");
    await expect(panel(page).locator("button[aria-expanded]")).toBeEnabled();
});
