/**
 * 人物与形象两个分页在真实 Chrome 与生产构建上的验收（docs/specs/canon/author-ui.md 验收 17，输出 4、9、37、49 到 53）：一部空作品
 * 从“新建人物”起步，在人物分页就地改、加一项、在形象分页上传立绘；星瑕样本（`scripts/canon-sample.ts`）上在衣柜里加一套、
 * 换上（390 宽时两个分页不横向滚动由 `canon-author.e2e.ts` 的验收 14 量）。世界服务、文件服务、存储与项目子进程都是真的；等页面上
 * 可观察的变化，不按时长等。
 */

import {execFile} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdir, readdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {promisify} from "node:util";

import {expect, test} from "@playwright/test";
import type {Locator, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {PACKAGE_ROOT, startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

test.describe.configure({mode: "serial"});
// 作者界面在 1280 宽时编辑区不到 640 像素，条目页落到窄版。
test.use({viewport: {width: 1440, height: 900}});

let tmp = "";
let blankDir = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "canon-character");
    const stateRoot = join(tmp, "state");
    // 一部空作品（从“新建人物”起步）与星瑕样本（有章、有形象）。
    blankDir = join(tmp, "Blank");
    const blankId = randomUUID();
    await mkdir(join(blankDir, ".nbook"), {recursive: true});
    await writeFile(join(blankDir, ".nbook/project.json"), JSON.stringify({schema: 1, id: blankId}));
    const bookDir = join(tmp, "Book");
    const {stdout} = await promisify(execFile)("bun", [join("scripts", "canon-sample.ts"), bookDir], {cwd: PACKAGE_ROOT});
    const {projectId} = JSON.parse(stdout) as {projectId: string};
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id: blankId, name: "blank", path: blankDir}, {id: projectId, name: "book", path: bookDir}]}));
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 每个用例收集页面错误与控制台的错误，结束时断言没有。 */
let errors: string[] = [];
test.beforeEach(({page}) => {
    errors = [];
    page.on("pageerror", (error) => errors.push(`${error.name}: ${error.message}`));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });
});
test.afterEach(() => {
    expect(errors).toEqual([]);
});

async function open(page: Page, project: string): Promise<void> {
    await page.goto(new URL(`/?project=${project}`, server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
}

const tree = (page: Page) => page.locator("[data-tool-view=\"nbook.canon.entries\"]");
const row = (page: Page, name: string): Locator => page.locator("[data-tree-id]").filter({hasText: new RegExp(`^${name}`, "u")}).first();
const entryPage = (page: Page) => page.locator("[data-entry-page]");
const tab = (page: Page, name: string) => entryPage(page).getByRole("tab", {name: new RegExp(`^${name}`, "u")});
/** 人物、形象分页里一项的值（值本身是按钮，输出 49、50）。 */
const valueOf = (page: Page, path: string) => entryPage(page).locator(`[data-edit="${path}"]`);
/** 就地改的编辑器（输出 51）：短项在浮层里（传送到页面根上），成段的文字浮在原处。 */
const editorOf = (page: Page, path: string) => page.locator(`[data-field-editor="${path}"]`);
const positionSelect = (page: Page) => entryPage(page).getByRole("combobox", {name: "位置"});

async function openEntry(page: Page, name: string): Promise<void> {
    if (!(await row(page, "人物").isVisible())) await tree(page).click();
    const folder = row(page, "人物");
    if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.click();
    await row(page, name).click();
    await expect(positionSelect(page)).toBeVisible();
}

test("验收 17 的前一半：空作品里新建人物，先看人物分页；短项在浮层里改、别的内容不动；成段的按 Escape、短项点外面都不存；加一项资料；上传立绘以后人物分页换成这张图", async ({page}) => {
    await open(page, "blank");
    const empty = page.locator("[data-entries-empty]");
    // 设定视图没显示时点活动栏把它打开（已显示时再点会收起侧栏）。
    if (!(await empty.isVisible())) await tree(page).click();
    await expect(empty).toBeVisible();
    await empty.getByRole("button", {name: "新建人物"}).click();
    // 新建对话框里人物与形象两组已经勾上（输出 4、37）。
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("checkbox", {name: "人物"})).toBeChecked();
    await expect(dialog.getByRole("checkbox", {name: "形象"})).toBeChecked();
    await page.locator("[data-new-entry] input").first().fill("星瑾");
    await dialog.getByRole("button", {name: "新建", exact: true}).click();
    await expect(tab(page, "人物")).toHaveAttribute("aria-selected", "true");
    await expect(entryPage(page).getByRole("tab")).toHaveText([/^人物/u, /^形象/u, /^文字/u, /^经历/u, /^情节/u]);
    const card = entryPage(page).locator("[data-character-card]");
    await expect(card.locator("[data-fact='性别']")).toContainText("填写");
    await expect(card.locator("[data-portrait]")).toHaveAttribute("data-portrait", "no-image");

    // 性别：浮层里点建议值“女”、保存；别的内容没有移动（输出 51）。
    const background = card.locator("[data-passage='背景']");
    const before = await background.boundingBox();
    await valueOf(page, "character.性别").click();
    const gender = editorOf(page, "character.性别");
    await gender.getByRole("combobox").click();
    await page.getByRole("option", {name: "女"}).click();
    await expect(gender.getByRole("combobox")).toHaveValue("女");
    expect(await background.boundingBox()).toEqual(before);
    await expect(gender.locator("[data-confirm-preview]")).toContainText("改初值");
    await gender.getByRole("button", {name: "保存"}).click();
    await expect(valueOf(page, "character.性别")).toHaveText("女");
    await expect(gender).toHaveCount(0);

    // 背景：编辑层浮在原处；写一段、按 Escape 放弃，不存。
    await valueOf(page, "character.背景").click();
    const passage = editorOf(page, "character.背景");
    await passage.getByRole("textbox").fill("六岁那年失去了父母。");
    await passage.getByRole("textbox").press("Escape");
    await expect(passage).toHaveCount(0);
    await expect(valueOf(page, "character.背景")).toContainText("从哪里来");

    // 年龄：短项在浮层里，点浮层外面放弃。
    await valueOf(page, "character.年龄").click();
    const age = editorOf(page, "character.年龄");
    await age.getByRole("textbox").fill("十七");
    await entryPage(page).locator("h1").click();
    await expect(age).toHaveCount(0);
    await expect(valueOf(page, "character.年龄")).toHaveText("填写");

    // 添加一项资料：预设里点“种族”。
    await card.locator("[data-add-field]").click();
    await page.locator("[data-add-field-panel] [data-preset='种族']").click();
    await expect(card.locator("[data-fact='种族']")).toBeVisible();

    // 形象分页：立绘的浮层里上传一张图，存进作品的图片文件夹，保存以后人物分页的立绘是这张图（输出 53）。
    await tab(page, "形象").click();
    await valueOf(page, "look.立绘").click();
    const portrait = editorOf(page, "look.立绘");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await portrait.locator("[data-image-file]").setInputFiles({name: "星瑾.png", mimeType: "image/png", buffer: png});
    await expect(portrait.getByRole("textbox", {name: "图片的路径"})).toHaveValue("插图/星瑾.png");
    expect(await readdir(join(blankDir, "插图"))).toContain("星瑾.png");
    await expect(portrait.locator("[data-confirm-preview]")).toContainText("改初值");
    await portrait.getByRole("button", {name: "保存"}).click();
    await expect(entryPage(page).locator("[data-look-card] [data-canon-image='插图/星瑾.png']")).toHaveAttribute("data-image-state", "loaded");
    await tab(page, "人物").click();
    await expect(card.locator("[data-portrait='image'] [data-canon-image='插图/星瑾.png']")).toBeVisible();
});

test("验收 17 的后一半：衣柜里加一套“学院制服”，在第 3 章末尾点它的“换上”：现在穿的填好、预选“剧情里变了”，保存以后穿着它、写“第 3 章改过”", async ({page}) => {
    await open(page, "book");
    await openEntry(page, "星瑕");
    await expect(positionSelect(page)).toHaveText(/第 3 章末尾/u);
    await tab(page, "形象").click();
    const look = entryPage(page).locator("[data-look-card]");
    await look.locator("[data-outfit-add]").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", {name: "名字"}).fill("学院制服");
    await dialog.getByRole("button", {name: "保存"}).click();
    const outfit = look.locator("[data-outfit]").filter({hasText: "学院制服"});
    await expect(outfit).toBeVisible();

    await outfit.locator("[data-put-on]").click();
    const wearing = editorOf(page, "look.现在穿的");
    await expect(wearing.getByRole("combobox")).toHaveValue("学院制服");
    await expect(wearing.getByRole("radio", {name: "剧情里变了"})).toBeChecked();
    await expect(wearing.locator("[data-confirm-preview]")).toContainText("记一条变更");
    await wearing.getByRole("button", {name: "保存"}).click();
    await expect(outfit).toContainText("穿着");
    await expect(look.locator("[data-fact='现在穿的']")).toContainText("第 3 章改过");
});
