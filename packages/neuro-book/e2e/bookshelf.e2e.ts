/**
 * 书架页在真实 Chrome 中的验收（docs/specs/workbench/bookshelf.md 验收 1、3、4、5、7、8、9、13）：生产构建的后端与前端，真实的项目目录、
 * 登记表、用户层配置与封面文件。项目 `book` 先登记好；第二个目录经“打开已有作品”的选择器登记；新作品建在缺省作品目录
 * （场地的 HOME 下的 Documents/NeuroBook）里。等页面上可观察的变化，不按时长等待。
 */

import {randomUUID} from "node:crypto";
import {access, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {expect, test} from "@playwright/test";
import {parse as parseJsonc} from "jsonc-parser";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

let tmp = "";
let stateRoot = "";
let bookDir = "";
let oldDir = "";
let home = "";
let server: ProductServer;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 255, 255, 63, 0, 5, 254, 2, 254, 167, 53, 129, 132, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "bookshelf");
    bookDir = join(tmp, "Book");
    oldDir = join(tmp, "Old Draft");
    stateRoot = join(tmp, "state");
    home = join(tmp, "home");
    const id = randomUUID();
    const files: Record<string, string> = {".nbook/project.json": JSON.stringify({schema: 1, id}), "notes/a.md": "第一章\n\n他把灯放低一些。\n"};
    for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(bookDir, path)), {recursive: true});
        await writeFile(join(bookDir, path), text);
    }
    await mkdir(join(oldDir, "notes"), {recursive: true});
    await writeFile(join(oldDir, "notes", "x.md"), "旧稿\n");
    await mkdir(join(home, "Documents"), {recursive: true});
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: bookDir}]}));
    // 服务端进程的主目录指到场地：缺省作品目录与 ~ 都落在它下面，不碰真实主目录。
    server = await startProductServer(stateRoot, {env: {HOME: home, XDG_CONFIG_HOME: join(home, ".config")}});
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const root = (page: Page) => page.locator("[data-workbench-root]");
const shelfPage = (page: Page) => page.locator("[data-bookshelf-page]");
const card = (page: Page, title: string) => page.locator("[data-book-card]", {hasText: title});
const desk = (page: Page) => page.locator("[data-shelf-desk]");

async function openShelf(page: Page): Promise<void> {
    await page.goto(new URL("/", server.url).href);
    await expect(root(page)).toHaveAttribute("data-rpc-state", "online");
    await expect(root(page)).toHaveAttribute("data-workbench-home", "nbook.projects.bookshelf");
    await expect(shelfPage(page)).toBeVisible();
    await expect(page.locator("[data-shelf-cards]")).toBeVisible();
}

/** 卡片右上角的“更多”：悬停后才出现。 */
async function more(page: Page, title: string, item: string): Promise<void> {
    await card(page, title).hover();
    await card(page, title).getByRole("button", {name: "更多操作"}).click();
    await page.getByRole("menuitem", {name: item}).click();
}

test("书架列出已登记的作品、尚未统计；案头没有写作记录时写提示；点卡片整页进入作品", async ({page}) => {
    await openShelf(page);
    await expect(card(page, "book")).toHaveCount(1);
    await expect(card(page, "book")).toContainText("尚未统计");
    await expect(desk(page)).toContainText("打开一部作品写几个字");
    await expect(desk(page)).toContainText("1 部作品");

    await card(page, "book").click();
    await page.waitForURL(/\?project=book$/u);
    await expect(page.locator("[data-workbench-project]")).toHaveAttribute("data-workbench-project", "book");
    await expect(root(page)).toHaveAttribute("data-rpc-state", "online");
});

test("网格末尾与列表末行的“新建作品”打开新建窗口；键盘在网格里 End 再 Enter 同样打开，选中的作品不变（验收 8）", async ({page}) => {
    await openShelf(page);
    const info = page.locator("[data-project-info]");
    await page.locator("[data-shelf-create-card]").click();
    await expect(info).toBeVisible();
    await page.locator("[data-project-cancel]").click();
    await expect(info).toHaveCount(0);

    const listbox = page.locator('[data-shelf-cards][role="listbox"]');
    await listbox.focus();
    await expect(card(page, "book")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(listbox).toHaveAttribute("aria-activedescendant", "book-card-create");
    await page.keyboard.press("Enter");
    await expect(info).toBeVisible();
    await page.locator("[data-project-cancel]").click();
    await expect(card(page, "book")).toHaveAttribute("aria-selected", "true");

    await page.getByRole("radio", {name: "列表"}).click();
    await page.locator("[data-shelf-create-row]").click();
    await expect(info).toBeVisible();
});

test("打开已有作品：经选择器输入路径进入并加入；编辑作品信息；从书架移除：书架随服务端的结果更新，目录不动", async ({page}) => {
    await openShelf(page);
    await page.locator("[data-shelf-add]").click();
    const picker = page.locator("[data-path-picker]");
    await expect(picker).toBeVisible();
    // 不存在的路径：在选择器里提示原因，窗口留着。
    await page.locator("[data-path-picker-type]").click();
    await page.locator("input[data-path-picker-input], [data-path-picker-input] input").fill(join(tmp, "nowhere"));
    await page.keyboard.press("Enter");
    await expect(picker.locator("[data-file-browser-error]")).toContainText("不存在");
    // 进入场地根，选中 Old Draft，加入。
    await page.locator("[data-path-picker-type]").click();
    await page.locator("input[data-path-picker-input], [data-path-picker-input] input").fill(tmp);
    await page.keyboard.press("Enter");
    await picker.locator(`[data-file-browser-entry="${oldDir}"]`).click();
    await expect(page.locator("[data-path-picker-summary]")).toContainText("Old Draft");
    await page.locator("[data-path-picker-confirm]").click();
    await expect(picker).toHaveCount(0);
    // 没写书名：卡片显示目录原名，不显示短名 old-draft。
    await expect(card(page, "Old Draft")).toHaveCount(1);
    await expect(card(page, "old-draft")).toHaveCount(0);
    await expect(card(page, "Old Draft")).toHaveAttribute("aria-selected", "true");

    await more(page, "Old Draft", "编辑信息");
    const window = page.locator("[data-project-info]");
    await expect(window).toBeVisible();
    await window.locator("input[data-project-title], [data-project-title] input").fill("北方以北");
    await window.locator("[data-project-description]").fill("一部旧稿。");
    await page.locator("[data-project-confirm]").click();
    await expect(window).toHaveCount(0);
    await expect(card(page, "北方以北")).toHaveCount(1);
    await expect(card(page, "北方以北")).toContainText("一部旧稿。");
    const identity = JSON.parse(await readFile(join(oldDir, ".nbook", "project.json"), "utf8")) as {title?: string; description?: string};
    expect(identity).toMatchObject({title: "北方以北", description: "一部旧稿。"});

    await more(page, "北方以北", "从书架移除");
    await expect(page.getByRole("alertdialog")).toContainText("北方以北");
    await page.getByRole("button", {name: "移除", exact: true}).click();
    await expect(card(page, "北方以北")).toHaveCount(0);
    await expect(card(page, "book")).toHaveCount(1);
    // 焦点回到书架。
    await expect(page.locator('[data-shelf-cards][role="listbox"]')).toBeFocused();
    const registry = JSON.parse(await readFile(join(stateRoot, "projects.json"), "utf8")) as {projects: Array<{name: string}>};
    expect(registry.projects.map((project) => project.name)).toEqual(["book"]);
    await access(join(oldDir, "notes", "x.md"));
});

test("新建作品：缺省放进文档目录下的 NeuroBook（建出来）、带封面；同名目录已存在时书名标红、原因在页脚", async ({page}) => {
    await openShelf(page);
    await page.locator("[data-shelf-create]").click();
    const window = page.locator("[data-project-info]");
    await expect(window).toBeVisible();
    const library = join(home, "Documents", "NeuroBook");
    await expect(window.locator("[data-project-location-input] input")).toHaveValue(library);
    await window.locator("input[data-project-title], [data-project-title] input").fill("长夜行");
    await expect(window.locator("[data-project-folder]")).toHaveText("/长夜行");
    await window.locator("[data-project-description]").fill("雪线以北的驿站。");
    await window.locator("[data-project-color] [data-color-swatch='#b8423a']").click();
    await window.locator("[data-project-cover-input]").setInputFiles({name: "cover.png", mimeType: "image/png", buffer: PNG});
    await page.locator("[data-project-confirm]").click();
    // 建好、写完封面之后直接打开新作品（输出 11）：整页进入它的工作台。
    await expect(page.locator("[data-workbench-project]")).toHaveCount(1);
    expect(new URL(page.url()).searchParams.get("project")).not.toBeNull();
    const identity = JSON.parse(await readFile(join(library, "长夜行", ".nbook", "project.json"), "utf8")) as {title?: string; color?: string; cover?: string};
    expect(identity).toMatchObject({title: "长夜行", color: "#b8423a", cover: "cover.png"});
    await access(join(library, "长夜行", "cover.png"));
    await openShelf(page);
    await expect(card(page, "长夜行")).toHaveCount(1);
    await expect(card(page, "长夜行")).toContainText("雪线以北的驿站。");
    await expect(card(page, "长夜行").locator("[data-book-cover] img")).toBeVisible();

    await page.locator("[data-shelf-create]").click();
    await expect(window).toBeVisible();
    const title = window.locator("input[data-project-title], [data-project-title] input");
    await title.fill("长夜行");
    await page.locator("[data-project-confirm]").click();
    // 书名标红并得到焦点，原因在页脚状态行（字段下不插字由 ProjectInfoDialog.dom.test.ts 核对）。
    await expect(page.locator("[data-dialog-status]")).toContainText("同名目录已存在");
    await expect(title).toHaveAttribute("aria-invalid", "true");
    await expect(title).toBeFocused();
    await page.locator("[data-project-cancel]").click();
    await expect(window).toHaveCount(0);
});

/** 页面上这一点最上面的元素是否在 `selector` 里：层级只能这样在真实排版里看。 */
async function onTopAt(page: Page, selector: string): Promise<boolean> {
    const box = await page.locator(selector).boundingBox();
    if (box === null) return false;
    return page.evaluate(({x, y, selector: inside}) => document.elementFromPoint(x, y)?.closest(inside) !== null, {x: box.x + box.width / 2, y: box.y + box.height / 2, selector});
}

test("新建作品的对话框：没改过点遮罩关闭、改过不关；选择器叠在上面，Esc 与点遮罩只关它；取色面板在对话框之上（验收 9）", async ({page}) => {
    await openShelf(page);
    const info = page.locator("[data-project-info]");
    const title = info.locator("input[data-project-title], [data-project-title] input");
    // 左上角在两个对话框之外，落在最上层的遮罩上。
    const clickOutside = () => page.mouse.click(8, 8);

    await page.locator("[data-shelf-create]").click();
    await expect(title).toBeFocused();
    await clickOutside();
    await expect(info).toHaveCount(0);

    await page.locator("[data-shelf-create]").click();
    await title.fill("未命名的书");
    await clickOutside();
    await expect(info).toBeVisible();

    const browse = page.locator("[data-project-browse]");
    const picker = page.locator("[data-path-picker]");
    await browse.click();
    await expect(picker).toBeVisible();
    expect(await onTopAt(page, "[data-path-picker]")).toBe(true);
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(info).toBeVisible();
    await expect(browse).toBeFocused();

    await browse.click();
    await expect(picker).toBeVisible();
    await clickOutside();
    await expect(picker).toHaveCount(0);
    await expect(info).toBeVisible();
    await expect(title).toHaveValue("未命名的书");

    await info.locator("[data-color-swatch='custom']").click();
    const panel = page.locator("[data-color-swatches-panel]");
    await expect(panel).toBeVisible();
    expect(await onTopAt(page, "[data-color-swatches-panel]")).toBe(true);
    const hex = panel.locator("input[data-color-panel-input]");
    const before = await hex.inputValue();
    const track = await panel.locator(".nb-color-panel__track").boundingBox();
    if (track === null) throw new Error("色相条没有排版");
    await page.mouse.move(track.x + 4, track.y + track.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width * 0.6, track.y + track.height / 2, {steps: 4});
    await page.mouse.up();
    await expect(hex).not.toHaveValue(before);
    // 第一次改值让选中项变成“自定义”：色板不能借机把焦点抢走、把面板关掉。
    await expect(panel).toHaveAttribute("data-state", "open");
    // Esc 先关取色面板，对话框还在，焦点回到“自定义”。
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(info).toBeVisible();
    await expect(info.locator("[data-color-swatch='custom']")).toBeFocused();

    await page.locator("[data-project-cancel]").click();
    await expect(info).toHaveCount(0);
});

test("设置的“作品”分区：没设时显示缺省目录；书架的齿轮打开设置；“更改…”的目录选择器叠在窗口上，Esc 只关选择器；选定的目录写进设置，恢复默认删掉（验收 13）；启动时打开写进设置、恢复默认删掉", async ({page}) => {
    await openShelf(page);
    const gear = page.locator("[data-shelf-settings]");
    await gear.click();
    const window = page.locator("[data-settings-window]");
    await expect(window).toBeVisible();
    await expect(gear).toHaveAttribute("aria-pressed", "true");
    await window.locator("[data-settings-nav='nbook.works']").click();
    await expect(window.locator("[data-settings-section='nbook.works']")).toContainText("作品目录");
    const library = page.locator("[data-works-library]");
    // 没设：显示服务端实际会用的缺省目录（场地 HOME 下的 Documents/NeuroBook）。
    const fallback = `${join(home, "Documents", "NeuroBook")}（缺省）`;
    await expect(library).toHaveText(fallback);

    const change = page.locator("[data-works-library-change]");
    const picker = page.locator("[data-path-picker]");
    await change.click();
    await expect(picker).toBeVisible();
    expect(await onTopAt(page, "[data-path-picker]")).toBe(true);
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(window).toBeVisible();
    await expect(change).toBeFocused();

    // 输入路径进入场地的 Documents，没选条目就“选定”当前目录。
    const chosen = join(home, "Documents");
    await change.click();
    await page.locator("[data-path-picker-type]").click();
    await page.locator("input[data-path-picker-input], [data-path-picker-input] input").fill(chosen);
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-path-picker-confirm]")).toBeEnabled();
    await page.locator("[data-path-picker-confirm]").click();
    await expect(picker).toHaveCount(0);
    await expect(library).toHaveText(chosen);
    const settingsFile = join(stateRoot, "settings.json");
    await expect.poll(async () => parseJsonc(await readFile(settingsFile, "utf8")) as unknown).toEqual({"nbook.projects/library": chosen});

    // 恢复默认：键从设置里删掉，回到没设（后面的用例要缺省的作品目录）。
    await page.locator("[data-settings-row='nbook.projects/library'] [data-settings-row-reset]").click();
    await expect(library).toHaveText(fallback);
    await expect.poll(async () => parseJsonc(await readFile(settingsFile, "utf8")) as unknown).toEqual({});

    // 启动时打开（projects.md 输出 23）：缺省“上次的作品”；点“书架”写进设置，恢复默认删掉。
    const startup = page.locator("[data-works-startup]");
    await expect(startup.locator("button[role='radio'][data-value='last-work']")).toHaveAttribute("aria-checked", "true");
    await startup.locator("button[role='radio'][data-value='shelf']").click();
    await expect.poll(async () => parseJsonc(await readFile(settingsFile, "utf8")) as unknown).toEqual({"nbook.projects/startupOpen": "shelf"});
    await page.locator("[data-settings-row='nbook.projects/startupOpen'] [data-settings-row-reset]").click();
    await expect.poll(async () => parseJsonc(await readFile(settingsFile, "utf8")) as unknown).toEqual({});
});

test.describe("窄屏", () => {
    test.use({viewport: {width: 390, height: 844}});

    test("只有列表视图，新鲜度说明可见，没有横向滚动", async ({page}) => {
        await page.goto(new URL("/", server.url).href);
        await expect(root(page)).toHaveAttribute("data-workbench-home", "nbook.projects.bookshelf");
        await expect(page.locator("[data-shelf-list]")).toBeVisible();
        await expect(page.locator("[data-shelf-cards]")).toHaveCount(0);
        // 新鲜度说明三种之一（前面的用例新建的作品已打开过、统计过）。
        await expect(page.locator("[data-shelf-list]")).toContainText(/统计于|尚未统计|正在统计/u);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
});
