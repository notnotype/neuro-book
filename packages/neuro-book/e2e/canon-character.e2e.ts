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
/** 就地改的编辑卡（输出 51）：短项浮在值旁边，成段的文字在原处展开。 */
const editorOf = (page: Page, path: string) => page.locator(`[data-field-editor="${path}"]`);
/** 页头的“在看”按钮（author-ui 输出 7）：写“在看”加当前位置。 */
const positionSelect = (page: Page) => entryPage(page).locator("[data-view-point]");

async function openEntry(page: Page, name: string): Promise<void> {
    if (!(await row(page, "人物").isVisible())) await tree(page).click();
    const folder = row(page, "人物");
    if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.click();
    await row(page, name).click();
    await expect(positionSelect(page)).toBeVisible();
}

test("验收 17 的前一半：空作品里新建人物，先看人物分页；短项在编辑卡里改、别的内容与保存按钮不动、看着最初时没有意图一行；成段的文字在原处展开、下一节整节往下让而不被盖住，贴着底边打开时整个滚进可见范围；成段的按 Escape、短项点外面都不存；加一项资料排在短资料末尾；上传立绘以后人物分页换成这张图", async ({page}) => {
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
    // 空作品里还没有剧情变更：经历与情节不出（author-ui 输出 9）。
    await expect(entryPage(page).getByRole("tab")).toHaveText([/^人物/u, /^形象/u, /^文字/u]);
    const card = entryPage(page).locator("[data-character-card]");
    await expect(card.locator("[data-fact='性别']")).toContainText("填写");
    await expect(card.locator("[data-portrait]")).toHaveAttribute("data-portrait", "no-image");

    // 性别：编辑卡里点建议值“女”、保存；别的内容没有移动（输出 51）。空作品没有章，看着的是最初：没有意图那一行、预览没有别的变化时不写。
    const background = card.locator("[data-passage='背景']");
    const before = await background.boundingBox();
    await valueOf(page, "character.性别").click();
    const gender = editorOf(page, "character.性别");
    await gender.getByRole("combobox").click();
    // 建议列表嵌在编辑卡里，不是传送出去的另一层。
    await gender.getByRole("listbox").getByRole("option", {name: "女"}).click();
    await expect(gender.getByRole("combobox")).toHaveValue("女");
    expect(await background.boundingBox()).toEqual(before);
    await expect(gender.locator("[data-edit-intent]")).toHaveCount(0);
    await expect(gender.locator("[data-edit-impact]")).toHaveCount(0);
    await expect(gender).not.toContainText("改最初的值");
    await gender.getByRole("button", {name: "保存"}).click();
    await expect(valueOf(page, "character.性别")).toHaveText("女");
    await expect(gender).toHaveCount(0);

    // 再打开：建议列表嵌在编辑卡里（页面上没有传送出去的另一层），打开时列出全部、当前值（女）那一项选中；打了字才筛。
    await valueOf(page, "character.性别").click();
    const suggest = gender.getByRole("combobox");
    await suggest.click();
    const listbox = gender.getByRole("listbox");
    await expect(listbox).toBeVisible();
    await expect(page.getByRole("listbox")).toHaveCount(1);
    const options = listbox.getByRole("option");
    const all = (await options.allInnerTexts()).map((name) => name.trim());
    expect(all.length).toBeGreaterThan(1);
    expect(all).toContain("女");
    await expect(listbox.locator("[aria-selected='true']")).toHaveCount(1);
    await expect(listbox.locator("[aria-selected='true']")).toHaveText("女");
    await suggest.fill("男");
    await expect.poll(() => options.count()).toBeLessThan(all.length);
    await suggest.fill("");
    await expect(options).toHaveCount(all.length);
    await gender.getByRole("button", {name: "取消"}).click();
    await expect(gender).toHaveCount(0);
    await expect(valueOf(page, "character.性别")).toHaveText("女");

    // 性格：编辑卡在原处展开，下一节（说话方式）整节往下让、没有被盖住；写一段、按 Escape 放弃，不存，下一节回到原位。
    const speech = card.locator("[data-passage='说话方式']");
    const inCard = () => speech.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const origin = element.closest("[data-character-card]")!.getBoundingClientRect();
        return {x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height};
    });
    // 它的标题中心点上的元素：是不是它自己（或它里面的）。
    const headingIsHit = () => speech.locator("h3").evaluate((heading) => {
        const {x, y, width, height} = heading.getBoundingClientRect();
        const hit = document.elementFromPoint(x + width / 2, y + height / 2);
        return hit !== null && heading.closest("[data-passage]")!.contains(hit);
    });
    const speechBefore = await inCard();
    await valueOf(page, "character.性格").click();
    const passage = editorOf(page, "character.性格");
    await passage.getByRole("textbox").fill("嘴硬心软，最怕被人看穿。");
    await expect.poll(async () => (await inCard()).y).toBeGreaterThan(speechBefore.y);
    expect((await inCard()).x).toBe(speechBefore.x);
    expect(await headingIsHit()).toBe(true);
    await passage.getByRole("textbox").press("Escape");
    await expect(passage).toHaveCount(0);
    await expect.poll(inCard).toEqual(speechBefore);
    await expect(valueOf(page, "character.性格")).toContainText("遇事怎么反应");

    // 最后一段（背景）贴着窗口底边时打开：编辑层向下长，打开时整个滚进可见范围，保存按钮不在窗口外（输出 51）。
    // 先把这一段滚到底边上再点（点击自己不会再滚）；看保存按钮的中心点上是不是它，不靠点击（点击会先把它滚出来）。
    await valueOf(page, "character.背景").evaluate((element) => element.scrollIntoView({block: "end"}));
    await valueOf(page, "character.背景").click();
    const last = editorOf(page, "character.背景");
    await expect(last.getByRole("textbox")).toBeFocused();
    await expect.poll(() => last.getByRole("button", {name: "保存"}).evaluate((button) => {
        const {x, y, width, height} = button.getBoundingClientRect();
        return document.elementFromPoint(x + width / 2, y + height / 2)?.closest("button") === button;
    })).toBe(true);
    await last.getByRole("textbox").press("Escape");
    await expect(last).toHaveCount(0);

    // 年龄：短项浮在值旁边；预览中与预览回来（没有别的变化时不占行）时保存按钮在同一个位置；点编辑卡外面放弃。
    await valueOf(page, "character.年龄").click();
    const age = editorOf(page, "character.年龄");
    await expect(age.locator("[data-edit-intent]")).toHaveCount(0);
    await expect(age).not.toContainText("改最初的值");
    await age.getByRole("textbox").fill("十七");
    // 预览中只有停顿的那 300 毫秒加一次往返：状态与位置在页面里同一刻读，不分两次。
    const saveAt = (previewing: boolean) => {
        const editor = document.querySelector("[data-field-editor='character.年龄']");
        const save = editor === null ? undefined : [...editor.querySelectorAll("button")].find((button) => button.textContent?.trim() === "保存");
        // 预览回来时编辑卡带 data-previewed；在等预览时没有。
        const previewed = editor?.querySelector("[data-previewed]") != null;
        if (save === undefined || previewed === previewing) return null;
        const {x, y} = save.getBoundingClientRect();
        return {x, y};
    };
    const during = await (await page.waitForFunction(saveAt, true)).jsonValue();
    const after = await (await page.waitForFunction(saveAt, false)).jsonValue();
    expect(after).toEqual(during);
    await entryPage(page).locator("h1").click();
    await expect(age).toHaveCount(0);
    await expect(valueOf(page, "character.年龄")).toHaveText("填写");

    // 添加一项资料：预设里点“种族”。
    await card.locator("[data-add-field]").click();
    await page.locator("[data-add-field-panel] [data-preset='种族']").click();
    await expect(card.locator("[data-fact='种族']")).toBeVisible();
    await expect(card.locator("[data-fact]").last()).toHaveAttribute("data-fact", "种族");

    // 形象分页：立绘的编辑卡里上传一张图，存进作品的图片文件夹，保存以后人物分页的立绘是这张图（输出 53）。
    await tab(page, "形象").click();
    await valueOf(page, "look.立绘").click();
    const portrait = editorOf(page, "look.立绘");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await portrait.locator("[data-image-file]").setInputFiles({name: "星瑾.png", mimeType: "image/png", buffer: png});
    await expect(portrait.getByRole("textbox", {name: "图片的路径"})).toHaveValue("插图/星瑾.png");
    expect(await readdir(join(blankDir, "插图"))).toContain("星瑾.png");
    await expect(portrait.locator("[data-edit-intent]")).toHaveCount(0);
    await portrait.getByRole("button", {name: "保存"}).click();
    await expect(entryPage(page).locator("[data-look-card] [data-canon-image='插图/星瑾.png']")).toHaveAttribute("data-image-state", "loaded");
    await tab(page, "人物").click();
    await expect(card.locator("[data-portrait='image'] [data-canon-image='插图/星瑾.png']")).toBeVisible();
});

test("验收 17 的后一半：衣柜里加一套“学院制服”，在第 3 章末尾点它的“换上”：现在穿的填好、预选“从第 3 章起”，保存以后穿着它、写“第 3 章改过”，提示写“现在穿的变成 学院制服”", async ({page}) => {
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
    // “换上”是剧情里发生的事：预选的是“从第 3 章起”，没填“发生了什么”。
    await expect(wearing.locator("[data-edit-intent]").getByRole("radio", {name: "从第 3 章起"})).toBeChecked();
    await expect(wearing.locator("[data-edit-note] input")).toHaveValue("");
    await expect(wearing).not.toContainText("记一条变更");
    await wearing.getByRole("button", {name: "保存"}).click();
    await expect(outfit).toContainText("穿着");
    await expect(look.locator("[data-fact='现在穿的']")).toContainText("第 3 章改过");
    await expect(page.locator("[data-notice-bar]")).toContainText("现在穿的变成 学院制服");
});
