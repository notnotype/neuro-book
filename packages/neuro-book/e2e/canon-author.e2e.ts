/**
 * 作者界面（设定侧）在真实 Chrome 与生产构建上的验收（docs/specs/canon/author-ui.md 验收 1、2、3、5、11、14 与 10 的“在改动记录里还原”）：
 * `scripts/canon-sample.ts` 生成星瑕样本作品（经产品的世界宿主逐次发布），登记成项目 `book`；世界服务、存储与项目子进程都是真的。
 * 用例共用一部作品、按顺序跑：前面的用例只读、改了又还原或只改文字字段，验收 5 最后才把那一笔改对（它要状态栏有“待处理 1”）。
 * 等页面上可观察的变化，不按时长等。
 */

import {execFile} from "node:child_process";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {promisify} from "node:util";

import {expect, test} from "@playwright/test";
import type {Locator, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {PACKAGE_ROOT, startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";
import {selectTab} from "./support/entry-page";

test.describe.configure({mode: "serial"});

let tmp = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "canon-author");
    const projectDir = join(tmp, "Book");
    const stateRoot = join(tmp, "state");
    // 生成脚本用 Bun 跑（世界服务的存储只在 Bun 里用），标准输出是机器可读的结果。
    const {stdout} = await promisify(execFile)("bun", [join("scripts", "canon-sample.ts"), projectDir], {cwd: PACKAGE_ROOT});
    const {projectId} = JSON.parse(stdout) as {projectId: string};
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id: projectId, name: "book", path: projectDir}]}));
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

async function open(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
}

const tree = (page: Page) => page.locator("[data-tool-view=\"nbook.canon.entries\"]");
const row = (page: Page, name: string): Locator => page.locator("[data-tree-id]").filter({hasText: new RegExp(`^${name}`, "u")}).first();
/** 活动组里挂着的条目页（页面标签只在所在组的活动标签时挂载）。 */
const entryPage = (page: Page) => page.locator("[data-entry-page]");
const crumbs = (page: Page) => page.locator("[data-editor-page-breadcrumbs] [data-page-crumb]");
const activeTabLabel = (page: Page) => page.locator("[data-editor-tab][aria-selected=\"true\"] [data-editor-tab-label]");
/** 文字分页里带值写法的一个值（按地址）。 */
const value = (page: Page, path: string) => entryPage(page).locator(`[data-value$="|${path}"]`).first();
/** 人物、形象分页里一项的值（输出 49、50：值本身是按钮）。 */
const fieldValue = (page: Page, path: string) => entryPage(page).locator(`[data-edit="${path}"]`);
/** 专门界面里就地改的编辑器（输出 51）：短项在浮层里（传送到页面根上），成段的文字浮在原处。 */
const inlineEditor = (page: Page, path: string) => page.locator(`[data-field-editor="${path}"]`);
/** 切到文字分页：人物的条目打开时先看人物分页（输出 9）。 */
const textTab = (page: Page) => selectTab(entryPage(page).getByRole("tab", {name: "文字"}));
/** 条目页各分页的名字：只剩图标时取可访问名（`aria-label`），条数不算。 */
const tabNames = (page: Page): Promise<string[]> => entryPage(page).getByRole("tab").evaluateAll((tabs) => tabs.map((tab) => (tab.getAttribute("aria-label") ?? tab.textContent ?? "").replace(/\s*\d+$/u, "").trim()));
/** 页头的“在看”按钮（author-ui 输出 7）：写“在看”加当前位置，点开是故事线与剧情进度的菜单。 */
const positionSelect = (page: Page) => entryPage(page).locator("[data-view-point]");
/** “在看”的菜单（传送到 body）。 */
const viewMenu = (page: Page) => page.locator("[data-view-point-menu]");
const statusBar = (page: Page) => page.locator("[data-workbench-surface] > [data-grid-scope] > [data-leaf='statusbar']");
/** 状态栏的“待处理 N”。状态栏另有一份量宽度用的副本（aria-hidden），按按钮的角色找只找到看得见的那一个。 */
const pendingItem = (page: Page) => statusBar(page).getByRole("button").filter({hasText: /^待处理 \d+$/u});
/** 底部面板入口条上一个视图的入口。 */
const panelEntry = (page: Page, view: string) => page.locator(`[data-region-strip="panel"] [data-tool-view="${view}"]`);

/** 打开设定视图，展开“人物”分组（以及给了的上级条目），点开这个条目的页。 */
async function openEntry(page: Page, name: string, parents: readonly string[] = []): Promise<void> {
    // 活动栏的条目再点一次会把侧栏收起来：设定视图没显示时才点。
    if (!(await row(page, "人物").isVisible())) await tree(page).click();
    for (const folder of ["人物", ...parents]) {
        const item = row(page, folder);
        await expect(item).toBeVisible();
        // 展开只认点箭头：点行是打开那个条目（author-ui 输出 5）。
        if ((await item.getAttribute("aria-expanded")) !== "true") await item.locator("[data-tree-toggle]").click();
        await expect(item).toHaveAttribute("aria-expanded", "true");
    }
    await row(page, name).click();
    await expect(activeTabLabel(page)).toHaveText(name);
    // 读到了条目：页头的位置选择出现（文字分页里不一定有带值写法的值）。
    await expect(positionSelect(page)).toBeVisible();
}

async function choosePosition(page: Page, label: RegExp): Promise<void> {
    await positionSelect(page).click();
    await viewMenu(page).getByRole("radio", {name: label}).click();
    // 选了位置，菜单就关上。
    await expect(viewMenu(page)).toHaveCount(0);
    await expect(positionSelect(page)).toHaveText(label);
}

test("验收 1：设定树与条目页：马甲在本体下面、标签标题与面包屑、换位置后值跟着变、存款的来历里估计的那笔是警告色", async ({page}) => {
    await open(page);
    await openEntry(page, "星瑕");
    // 新作品第一次打开：待处理、改动记录不让底部面板默认显示（输出 33）。面板收起时入口条还在、高度为 0，入口按钮自己的盒子不空，
    // 不能按入口判断；状态栏的面板开关写着“显示面板”。
    await expect(statusBar(page).getByText("显示面板")).toBeVisible();
    await expect(page.locator("[data-pending-view]")).toHaveCount(0);
    await expect(crumbs(page)).toHaveText(["设定", "人物", "星瑕"]);
    await expect(positionSelect(page)).toHaveText(/第 3 章末尾/u);

    // 马甲“哥哥”挂在星瑕下面；它的面包屑多一级，点其中的“星瑕”回到星瑕的页。
    const star = row(page, "星瑕");
    if ((await star.getAttribute("aria-expanded")) !== "true") await star.locator("[data-tree-toggle]").click();
    await row(page, "哥哥").click();
    await expect(activeTabLabel(page)).toHaveText("哥哥");
    await expect(crumbs(page)).toHaveText(["设定", "人物", "星瑕", "哥哥"]);
    await crumbs(page).filter({hasText: "星瑕"}).click();
    await expect(activeTabLabel(page)).toHaveText("星瑕");
    // 人物的条目先看人物分页，形象跟在后面、文字在它们之后（输出 9）。
    await expect(entryPage(page).getByRole("tab", {selected: true})).toHaveText("人物");
    // 编辑区窄时没选中的分页只剩图标（author-ui 输出 9），名字在可访问名里。
    await expect.poll(() => tabNames(page)).toEqual(["人物", "形象", "文字", "数值", "经历", "情节"]);
    await textTab(page);

    const latest = await value(page, "panel.存款").innerText();
    await choosePosition(page, /第 1 章末尾/u);
    await expect(value(page, "panel.存款")).toHaveText("41,800");
    expect(latest).not.toBe("41,800");
    await selectTab(entryPage(page).getByRole("tab", {name: "数值"}));
    await expect(entryPage(page).locator("[data-card=\"panel.存款\"]")).toContainText("41,800");
    await selectTab(entryPage(page).getByRole("tab", {name: "文字"}));

    await choosePosition(page, /第 2 章末尾/u);
    await value(page, "panel.存款").click();
    const origins = entryPage(page).locator("[data-origin-list]");
    await expect(origins).toBeVisible();
    await expect(origins.locator("[data-origin-row]").last()).toContainText("最初");
    // 估计的那笔：依据写“估计”，用警告色。
    const estimate = origins.locator("[data-origin-row]", {hasText: "草莓蛋糕"}).getByText(/^估计/u);
    await expect(estimate).toBeVisible();
    const colors = await estimate.evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--status-warning)";
        element.parentElement!.append(probe);
        const expected = getComputedStyle(probe).color;
        probe.remove();
        return {actual: getComputedStyle(element).color, expected};
    });
    expect(colors.actual).toBe(colors.expected);
});

test("验收 2：两个条目页各有各的位置、展开的来历与填了一半的就地改；刷新后两个标签都在、标题是名字、位置回到缺省", async ({page}) => {
    await open(page);
    await openEntry(page, "星瑕");
    await textTab(page);
    await choosePosition(page, /第 1 章末尾/u);
    await value(page, "panel.存款").click();
    await expect(entryPage(page).locator("[data-origin-list]")).toBeVisible();

    await openEntry(page, "星瑾");
    await expect(positionSelect(page)).toHaveText(/第 3 章末尾/u);
    await choosePosition(page, /第 2 章末尾/u);
    await page.locator("[data-editor-tab]", {hasText: "星瑕"}).click();
    await expect(positionSelect(page)).toHaveText(/第 1 章末尾/u);
    await expect(entryPage(page).locator("[data-origin-list]")).toBeVisible();
    // 设定树跟着切过来的条目页选中。
    await expect(row(page, "星瑕")).toHaveAttribute("aria-selected", "true");
    await page.locator("[data-editor-tab]", {hasText: "星瑾"}).click();
    await expect(row(page, "星瑾")).toHaveAttribute("aria-selected", "true");
    await expect(row(page, "星瑕")).not.toHaveAttribute("aria-selected", "true");
    await page.locator("[data-editor-tab]", {hasText: "星瑕"}).click();

    // 填了一半的就地改：切走再回来，编辑与填的字还在、回到眼前（成段的文字在原文下方的浮层里，输出 51）。
    await selectTab(entryPage(page).getByRole("tab", {name: "人物"}));
    await entryPage(page).locator("[data-edit=\"character.性格\"]").click();
    await inlineEditor(page, "character.性格").getByRole("textbox").fill("还没想好");
    await page.locator("[data-editor-tab]", {hasText: "星瑾"}).click();
    await expect(activeTabLabel(page)).toHaveText("星瑾");
    await page.locator("[data-editor-tab]", {hasText: "星瑕"}).click();
    await expect(inlineEditor(page, "character.性格").getByRole("textbox")).toHaveValue("还没想好");
    // 页面从顶上重新挂上，开着的编辑把原文滚进窗口、跟着回到眼前（浮层是固定定位的，测试替作者滚不动它）。
    await expect(inlineEditor(page, "character.性格").getByRole("button", {name: "取消"})).toBeInViewport();
    await inlineEditor(page, "character.性格").getByRole("button", {name: "取消"}).click();

    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    const labels = page.locator("[data-editor-tab-label]");
    await expect(labels.filter({hasText: /^星瑕$/u})).toHaveCount(1);
    await expect(labels.filter({hasText: /^星瑾$/u})).toHaveCount(1);
    for (const name of ["星瑕", "星瑾"]) {
        await page.locator("[data-editor-tab]", {hasText: name}).click();
        await expect(activeTabLabel(page)).toHaveText(name);
        await expect(positionSelect(page)).toHaveText(/第 3 章末尾/u);
    }
});

/** 从命令面板打开改动记录（`nbook.canon.show-revisions`），等行出来。 */
async function showRevisions(page: Page): Promise<Locator> {
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("显示改动记录");
    await page.keyboard.press("Enter");
    const rows = page.locator("[data-revision-row]");
    await expect(rows.first()).toBeVisible();
    return rows;
}

test("验收 3：就地改一个只在初值设过的字段，意图写“从最初起”与“从第 3 章起”、缺省是前者；保存后有提示、写着“改年龄”与“记在最初”，指着它点还原以后值回到原样；还原的那一次查看详情列出改前改后，改动记录多了两条", async ({page}) => {
    await open(page);
    await openEntry(page, "星瑕");
    const revisions = await (await showRevisions(page)).count();
    await selectTab(entryPage(page).getByRole("tab", {name: "人物"}));
    // 用短项：它的编辑卡浮在值旁边，收起时页面不变高，量得出“提示出现时内容不动”（成段的文字在原处展开，收起时页面会变短）。
    const before = await fieldValue(page, "character.年龄").innerText();
    const next = before === "十七" ? "十八" : "十七";
    await entryPage(page).locator("[data-edit=\"character.年龄\"]").click();
    const bar = inlineEditor(page, "character.年龄");
    await bar.getByRole("textbox").fill(next);
    // 看着第 3 章末尾：意图二选一写“从<来源>起”，这个值只在最初设过，缺省是改设定；写回哪里的那句不再出现。
    const intent = bar.locator("[data-edit-intent]");
    await expect(intent.getByRole("radio", {name: "从最初起"})).toBeChecked();
    await expect(intent.getByRole("radio", {name: "从第 3 章起"})).not.toBeChecked();
    await expect(bar.locator("[data-edit-note]")).toHaveCount(0);
    await expect(bar).not.toContainText("改最初的值");
    const topBefore = (await entryPage(page).locator("[role='tabpanel']").boundingBox())!.y;
    await bar.getByRole("button", {name: "保存"}).click();
    await expect(fieldValue(page, "character.年龄")).toHaveText(next);

    // 提示浮在页面下方，出现时内容不动；6 秒后自己收起，指着它时不收：先指着再点（author-ui 输出 18）。
    const notice = page.locator("[data-notice-bar]");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("改年龄");
    await expect(notice.locator("[data-notice-where]")).toHaveText("记在最初");
    expect((await entryPage(page).locator("[role='tabpanel']").boundingBox())!.y).toBe(topBefore);
    await notice.hover();
    await notice.getByRole("button", {name: "还原"}).click();
    const dialog = page.locator("[data-revert-dialog]");
    await expect(dialog).toBeVisible();
    await page.getByRole("dialog").getByRole("button", {name: "还原", exact: true}).click();
    await expect(dialog).toHaveCount(0);
    await expect(fieldValue(page, "character.年龄")).toHaveText(before);

    // 还原成功以后提示换成还原的那一次；它的详情列出年龄从新值回到原来的样子。
    await expect(notice).toContainText("还原");
    await notice.hover();
    await notice.getByRole("button", {name: "查看详情"}).click();
    const receipt = page.locator("[data-receipt-page]");
    await expect(receipt).toBeVisible();
    await expect(receipt.locator("[data-receipt-item]", {hasText: "年龄"})).toContainText(next);
    // 样本里年龄原来空着（值上写“填写”），回执把空写成“（没有）”。
    await expect(receipt.locator("[data-receipt-item]", {hasText: "年龄"})).toContainText(before === "填写" ? "（没有）" : before);

    const rows = await showRevisions(page);
    await expect(rows).toHaveCount(revisions + 2);
    await expect(rows.first()).toContainText("还原");
});

test("验收 10 的后一半：在改动记录里还原一次修订，条目页上的值回到原样", async ({page}) => {
    await open(page);
    await openEntry(page, "星瑕");
    await selectTab(entryPage(page).getByRole("tab", {name: "人物"}));
    const field = fieldValue(page, "character.身份");
    const before = await field.innerText();
    await entryPage(page).locator("[data-edit=\"character.身份\"]").click();
    const bar = inlineEditor(page, "character.身份");
    await bar.getByRole("textbox").fill("在打工");
    await bar.getByRole("button", {name: "保存"}).click();
    await expect(field).toHaveText("在打工");

    // 从底部面板的入口条到改动记录：状态栏的“待处理 N”先把底部面板打开在待处理上，再点入口条上的“改动记录”。
    await pendingItem(page).click();
    await expect(page.locator("[data-pending-view]")).toBeVisible();
    await panelEntry(page, "nbook.canon.revisions").click();
    const newest = page.locator("[data-revision-row]").first();
    await expect(newest).toBeVisible();
    await newest.locator("[data-revision-revert]").click();
    await expect(page.locator("[data-revert-dialog]")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", {name: "还原", exact: true}).click();
    await expect(page.locator("[data-revert-dialog]")).toHaveCount(0);
    await expect(field).toHaveText(before);
});

test("验收 11：只用键盘改一个值：走到值、Enter、填、Tab 到“保存”、Enter，焦点回到值；再 Enter、Escape，编辑收起、焦点还在值上", async ({page}) => {
    await open(page);
    await openEntry(page, "星瑕");
    await selectTab(entryPage(page).getByRole("tab", {name: "形象"}));
    // 形象分页里值本身就是“改”（输出 51）：一个 Tab 停靠，Enter 打开浮在原处的编辑。
    const edit = fieldValue(page, "look.外貌");
    const before = await edit.innerText();
    await edit.focus();
    await expect(edit).toBeFocused();
    await page.keyboard.press("Enter");
    const box = inlineEditor(page, "look.外貌").getByRole("textbox");
    await expect(box).toBeFocused();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("银白长发");
    const save = inlineEditor(page, "look.外貌").getByRole("button", {name: "保存"});
    await expect(save).toBeEnabled();
    for (let presses = 0; presses < 4 && !(await save.evaluate((element) => element === document.activeElement)); presses += 1) await page.keyboard.press("Tab");
    await expect(save).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(fieldValue(page, "look.外貌")).toHaveText("银白长发");
    await expect(edit).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(box).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(inlineEditor(page, "look.外貌")).toHaveCount(0);
    await expect(edit).toBeFocused();
    expect(before).not.toBe("银白长发");
});

test("验收 7：页头的“在看”按钮写位置，只有主线时不写线；点“往前一处”按钮写前一处、页面上的值换成那时的，到头了不可用，悬停写要去哪", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await open(page);
    await openEntry(page, "星瑕");
    await textTab(page);
    const view = positionSelect(page);
    const prev = entryPage(page).locator("[data-view-point-prev]");
    const next = entryPage(page).locator("[data-view-point-next]");
    await expect(view).toHaveText(/^在看\s*第 3 章末尾$/u);
    const latest = await value(page, "panel.存款").innerText();

    // 末尾是最后一处：往后不可用，悬停写“已经是最后”；往前写要去哪。
    await expect(next).toBeDisabled();
    await expect(next).toHaveAttribute("title", "已经是最后");
    await expect(prev).toHaveAttribute("title", "往前一处：第 3 章开头");

    // 一处是一章的开头或末尾：往前依次是第 3 章开头、第 2 章末尾、第 2 章开头、第 1 章末尾，按钮跟着写。
    for (const label of ["第 3 章开头", "第 2 章末尾", "第 2 章开头", "第 1 章末尾"]) {
        await prev.click();
        await expect(view).toHaveText(new RegExp(`${label}$`, "u"));
    }
    // 页面上的值是第 1 章末尾那时的（与换位置得到的同一个数）。
    await expect(value(page, "panel.存款")).toHaveText("41,800");
    expect(latest).not.toBe("41,800");

    // 往后一处回来：往前不再被拦，回到第 3 章末尾时值也回来。
    for (const label of ["第 2 章开头", "第 2 章末尾", "第 3 章开头", "第 3 章末尾"]) {
        await next.click();
        await expect(view).toHaveText(new RegExp(`${label}$`, "u"));
    }
    await expect(value(page, "panel.存款")).toHaveText(latest);
    await expect(next).toBeDisabled();
});

test("验收 7：点开“在看”，剧情进度里一章一行、开头末尾两个按钮；选一章的“开头”，菜单关上、按钮写这一处；作品只有几章时没有搜索框", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await open(page);
    await openEntry(page, "星瑕");
    const view = positionSelect(page);
    await view.click();
    const menu = viewMenu(page);
    await expect(menu).toBeVisible();
    // 只有主线：没有“故事线”一段；三章，不到要搜的数量。
    await expect(menu.getByRole("radiogroup", {name: "故事线"})).toHaveCount(0);
    await expect(menu.locator("[data-view-point-search]")).toHaveCount(0);
    await expect(menu.locator("[data-chapter-row]")).toHaveCount(3);
    await expect(menu.getByRole("radio", {name: "最初"})).toBeVisible();
    // 当前位置那一个是选中的。
    await expect(menu.getByRole("radio", {name: "第 3 章末尾"})).toHaveAttribute("aria-checked", "true");

    const second = menu.locator("[data-chapter-row]").filter({hasText: "第 2 章"});
    await second.getByRole("radio", {name: "第 2 章开头"}).click();
    await expect(menu).toHaveCount(0);
    await expect(view).toHaveText(/第 2 章开头$/u);
    // 再点开：选中的是刚选的那一处。
    await view.click();
    await expect(viewMenu(page).getByRole("radio", {name: "第 2 章开头"})).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(viewMenu(page)).toHaveCount(0);
    await expect(view).toBeFocused();
});

/** 从改动记录里还原最新的一次修订（用例改过什么，最后都要还原，后面的用例读的是原样的作品）。 */
async function revertNewest(page: Page): Promise<void> {
    const rows = await showRevisions(page);
    await rows.first().locator("[data-revision-revert]").click();
    await expect(page.locator("[data-revert-dialog]")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", {name: "还原", exact: true}).click();
    await expect(page.locator("[data-revert-dialog]")).toHaveCount(0);
}

test("验收 51：在第 3 章末尾改一个只在最初设过的短项，选“从第 3 章起”并填“发生了什么”：保存后提示写这句话，情节分页里多一条写着这句话", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    const happened = "她开始打工还债";
    await open(page);
    await openEntry(page, "星瑕");
    await selectTab(entryPage(page).getByRole("tab", {name: "情节"}));
    await expect(entryPage(page).getByRole("tabpanel").getByText(happened)).toHaveCount(0);
    await selectTab(entryPage(page).getByRole("tab", {name: "人物"}));
    const before = await fieldValue(page, "character.身份").innerText();

    await entryPage(page).locator("[data-edit=\"character.身份\"]").click();
    const bar = inlineEditor(page, "character.身份");
    await bar.getByRole("textbox").first().fill("在打工");
    const intent = bar.locator("[data-edit-intent]");
    // 选“从最初起”（更正）时不问理由；选剧情里变了才露出选填的一行。那一行一直占着位置，切换意图时编辑卡高度不变；点了意图以后
    // 焦点回到值的输入框（输出 16）。
    await expect(bar.locator("[data-edit-note]")).toHaveCount(0);
    const heightBefore = (await bar.boundingBox())!.height;
    await intent.getByRole("radio", {name: "从第 3 章起"}).click();
    await expect(intent.getByRole("radio", {name: "从第 3 章起"})).toBeChecked();
    await expect(bar.getByRole("textbox").first()).toBeFocused();
    const note = bar.locator("[data-edit-note] input");
    await expect(note).toBeVisible();
    expect((await bar.boundingBox())!.height).toBe(heightBefore);
    await note.fill(happened);
    await bar.getByRole("button", {name: "保存"}).click();
    await expect(fieldValue(page, "character.身份")).toHaveText("在打工");

    // 这句话就是这次的修订标题，记在第 3 章。
    const notice = page.locator("[data-notice-bar]");
    await expect(notice).toContainText(happened);
    await expect(notice.locator("[data-notice-where]")).toContainText("第 3 章");
    await selectTab(entryPage(page).getByRole("tab", {name: "情节"}));
    await expect(entryPage(page).getByRole("tabpanel").getByText(happened).first()).toBeVisible();

    await revertNewest(page);
    // 还原以后回到人物分页看值。
    await selectTab(entryPage(page).getByRole("tab", {name: "人物"}));
    await expect(fieldValue(page, "character.身份")).toHaveText(before);
});

test("验收 51：选“从第 3 章起”不填“发生了什么”：修订与情节里那一条写“<字段>变成 <新值>”；改设定的标题仍是“改<字段>”", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await open(page);
    await openEntry(page, "星瑕");
    await selectTab(entryPage(page).getByRole("tab", {name: "人物"}));
    const before = await fieldValue(page, "character.身份").innerText();

    await entryPage(page).locator("[data-edit=\"character.身份\"]").click();
    const bar = inlineEditor(page, "character.身份");
    await bar.getByRole("textbox").first().fill("兼职");
    await bar.locator("[data-edit-intent]").getByRole("radio", {name: "从第 3 章起"}).click();
    await expect(bar.locator("[data-edit-note] input")).toHaveValue("");
    await bar.getByRole("button", {name: "保存"}).click();
    await expect(fieldValue(page, "character.身份")).toHaveText("兼职");
    await expect(page.locator("[data-notice-bar]")).toContainText("身份变成 兼职");
    await selectTab(entryPage(page).getByRole("tab", {name: "情节"}));
    await expect(entryPage(page).getByRole("tabpanel").getByText("身份变成 兼职").first()).toBeVisible();
    await revertNewest(page);
    // 还原以后回到人物分页看值。
    await selectTab(entryPage(page).getByRole("tab", {name: "人物"}));
    await expect(fieldValue(page, "character.身份")).toHaveText(before);

    // 改设定（从最初起）：标题照旧“改身份”。
    await selectTab(entryPage(page).getByRole("tab", {name: "人物"}));
    await entryPage(page).locator("[data-edit=\"character.身份\"]").click();
    await bar.getByRole("textbox").first().fill("在打工");
    await expect(bar.locator("[data-edit-intent]").getByRole("radio", {name: "从最初起"})).toBeChecked();
    await bar.getByRole("button", {name: "保存"}).click();
    await expect(page.locator("[data-notice-bar]")).toContainText("改身份");
    await revertNewest(page);
    await expect(fieldValue(page, "character.身份")).toHaveText(before);
});

test("验收 51：看“最初”时改一个值，没有意图那一行，也没有“发生了什么”", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await open(page);
    await openEntry(page, "星瑕");
    await choosePosition(page, /最初/u);
    await selectTab(entryPage(page).getByRole("tab", {name: "人物"}));
    await entryPage(page).locator("[data-edit=\"character.身份\"]").click();
    const bar = inlineEditor(page, "character.身份");
    await bar.getByRole("textbox").first().fill("先试试");
    await expect(bar.getByRole("button", {name: "保存"})).toBeVisible();
    await expect(bar.locator("[data-edit-intent]")).toHaveCount(0);
    await expect(bar.locator("[data-edit-note]")).toHaveCount(0);
    await bar.getByRole("textbox").first().press("Escape");
    await expect(bar).toHaveCount(0);
});

/**
 * 页面或视图里会横着滚的地方：根自己、它里面 `overflow-x` 是 auto 或 scroll 的元素、它外面最近的那个滚动容器，内容比宽度宽的都算；
 * 再加上整页。空数组是没有。横排的分页条放不下时本来就在自己里面横向滚动（author-ui 输出 9），不算。
 */
async function horizontalScrolls(root: Locator): Promise<string[]> {
    return root.first().evaluate((element) => {
        const scrolls = (node: Element) => ["auto", "scroll"].includes(getComputedStyle(node).overflowX);
        const candidates = [element, ...element.querySelectorAll("*")].filter((node) => node === element || (scrolls(node) && node.getAttribute("aria-label") !== "条目的分页"));
        for (let up = element.parentElement; up !== null; up = up.parentElement) {
            if (!scrolls(up)) continue;
            candidates.push(up);
            break;
        }
        const wide = candidates.filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => `${node.tagName.toLowerCase()}.${node.className} ${String(node.scrollWidth)}>${String(node.clientWidth)}`);
        if (document.documentElement.scrollWidth > window.innerWidth + 1) wide.push(`document ${String(document.documentElement.scrollWidth)}>${String(window.innerWidth)}`);
        return wide;
    });
}

// 设定视图不在这里量：390 宽时工作台把侧栏让给编辑区，点活动栏也不出来。
test("分页的排法（author-ui 输出 9）：编辑区够宽时在内容左边竖排、不横向滚动，窄了换回页头下面的横排；两种排法选中同一页，焦点在分页上的跟过去；名字一行写得下时不折行；标签带人物图标", async ({page}) => {
    await page.setViewportSize({width: 1920, height: 1000});
    await open(page);
    await openEntry(page, "星瑕");
    const nav = entryPage(page).locator("[data-entry-page-nav]");
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("tab")).not.toHaveCount(0);
    await selectTab(nav.getByRole("tab", {name: /^数值/u}));
    await expect(nav.getByRole("tab", {name: /^数值/u})).toHaveAttribute("aria-selected", "true");
    expect(await horizontalScrolls(entryPage(page))).toEqual([]);
    // 页头的名字（按钮带负外边距的浅底）一行写得下就是一行（workbench/editor 输出 53 的标签图标也在这一页上看）。
    const nameHeight = async () => (await entryPage(page).locator("[data-edit='entry.name']").boundingBox())!.height;
    expect(await nameHeight()).toBeLessThan(40);
    await expect(page.locator("[data-editor-tab-icon].i-lucide-user-round")).toBeVisible();

    await nav.getByRole("tab", {name: /^数值/u}).focus();
    await page.setViewportSize({width: 1440, height: 900});
    await expect(nav).toHaveCount(0);
    const panelTab = entryPage(page).getByRole("tab", {name: /^数值/u});
    await expect(panelTab).toHaveAttribute("aria-selected", "true");
    await expect(panelTab).toBeFocused();
    expect(await nameHeight()).toBeLessThan(40);

    // 编辑区的滚动条叠在内容上（OverlayScrollbar）：原生滚动条不画、不占宽度，内容在要滚与不要滚之间变时宽度不跳（nb-ui 界面开发规范“滚动条”）。
    const host = page.locator("[data-editor-page]");
    expect(await host.evaluate((element) => getComputedStyle(element).scrollbarWidth)).toBe("none");
    // 换分页有过渡（不减弱动效时）：记下内容那一层出现过进场的过渡类。
    await page.emulateMedia({reducedMotion: "no-preference"});
    await entryPage(page).locator("[role='tabpanel']").evaluate((panel) => {
        const seen = new Set<string>();
        (window as unknown as {tabTransitions: Set<string>}).tabTransitions = seen;
        new MutationObserver((records) => {
            for (const record of records) if (record.target instanceof Element) for (const name of record.target.classList) if (name.startsWith("entry-page-tab-")) seen.add(name);
        }).observe(panel, {subtree: true, attributes: true, attributeFilter: ["class"], childList: true});
    });
    // 滚过分页条以后换分页：新的一页从吸顶的页头下沿开始，不停在半中间。
    await selectTab(entryPage(page).getByRole("tab", {name: /^情节/u}));
    await expect(entryPage(page).getByRole("tab", {name: /^情节/u})).toHaveAttribute("aria-selected", "true");
    await host.evaluate((element) => element.scrollTo({top: element.scrollHeight}));
    await selectTab(entryPage(page).getByRole("tab", {name: /^人物/u}));
    await expect.poll(() => page.evaluate(() => [...(window as unknown as {tabTransitions: Set<string>}).tabTransitions].sort())).toEqual(expect.arrayContaining(["entry-page-tab-enter-active", "entry-page-tab-leave-active"]));
    await expect(entryPage(page).locator("[data-character-card]")).toBeVisible();
    const gap = () => entryPage(page).evaluate((root) => {
        const panel = root.querySelector("[role='tabpanel']")!.getBoundingClientRect().top;
        const header = root.querySelector("header")!.getBoundingClientRect().bottom;
        return Math.round(panel - header);
    });
    await expect.poll(gap).toBeGreaterThanOrEqual(0);
    expect(await gap()).toBeLessThan(40);
});

test("验收 14：390 像素宽时，条目页、回执页、变更详情页与待处理、改动记录两个视图都没有横向滚动；条目页的分页横排、每页写名字，放不下时在分页条里滑动，选中的一页看得见", async ({page}) => {
    await open(page);
    const narrow = async (root: Locator): Promise<void> => {
        await page.setViewportSize({width: 390, height: 844});
        await expect(root.first()).toBeVisible();
        expect(await horizontalScrolls(root)).toEqual([]);
        await page.setViewportSize({width: 1440, height: 900});
    };
    // 在宽屏上走到每一处，再换成 390 宽量。条目页的分页横排、放不下时在分页条里滑动：每页照旧写名字，选中的一页（最后的“情节”也是）
    // 变窄以后仍在看得见的范围里（中心点上是它自己；click 会先把它滚进来，看不出来）。
    await openEntry(page, "星瑕");
    const strip = entryPage(page).getByRole("tablist", {name: "条目的分页"});
    for (const tab of ["文字", "人物", "形象", "数值", "情节"]) {
        await selectTab(entryPage(page).getByRole("tab", {name: new RegExp(`^${tab}`, "u")}));
        await page.setViewportSize({width: 390, height: 844});
        const selected = strip.getByRole("tab", {selected: true});
        await expect(selected).toContainText(tab);
        await expect.poll(() => selected.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return hit !== null && element.contains(hit);
        })).toBe(true);
        await narrow(entryPage(page));
    }
    await page.setViewportSize({width: 390, height: 844});
    await expect.poll(() => strip.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    for (const label of await strip.getByRole("tab").allTextContents()) expect(label.trim()).not.toBe("");
    await page.setViewportSize({width: 1440, height: 900});
    await pendingItem(page).click();
    await expect(page.locator("[data-pending-detail]")).toBeVisible();
    await narrow(page.locator("[data-pending-view]"));
    await page.locator("[data-suspect-open]").first().click();
    await narrow(page.locator("[data-change-page]"));
    await panelEntry(page, "nbook.canon.revisions").click();
    await expect(page.locator("[data-revision-row]").first()).toBeVisible();
    await narrow(page.locator("[data-revisions-view]"));
    await page.locator("[data-revision-row]").first().locator("[data-revision-receipt]").click();
    await narrow(page.locator("[data-receipt-page]"));
});

test("验收 5：状态栏“待处理 1”点进去选中那一条；改这一笔开出变更详情页，改成对得上的数并保存，这一条与状态栏条目都消失", async ({page}) => {
    await open(page);
    await expect(pendingItem(page)).toHaveText("待处理 1");
    await pendingItem(page).click();
    // 入口条上的入口写同一个数（views.md 输出 17）。
    await expect(panelEntry(page, "nbook.canon.pending")).toContainText("1");
    const selected = page.locator("[data-pending-row][aria-current=\"true\"]");
    await expect(selected).toContainText("存款对不上");
    const detail = page.locator("[data-pending-detail]");
    await expect(detail.locator("[data-pending-detail-quote]")).toBeVisible();
    await expect(detail.locator("[data-suspect]").first()).toBeVisible();

    // 嫌疑里估计的那笔在前：草莓蛋糕记了 −300，正文写的余额要它是 −2,000。
    const cake = detail.locator("[data-suspect]", {hasText: "草莓蛋糕"});
    await cake.locator("[data-suspect-open]").click();
    const change = page.locator("[data-change-page]");
    await expect(change).toBeVisible();
    await change.locator("[data-edit-patch]").first().click();
    const bar = change.locator("[data-confirm-bar]");
    // 数的改动用数字输入（nb-ui 的 NumberInput：文字框加 inputmode="decimal"）。
    await bar.locator("input[inputmode=\"decimal\"]").fill("-2000");
    await bar.getByRole("button", {name: "保存"}).click();

    // 先看视图还在、“待处理”一组的数变成 0，再看那一行没有了；状态栏还在（别的条目照常），只是“待处理 N”不显示了。
    await expect(page.locator("[data-pending-group=\"pending\"] [data-pending-count]")).toHaveText("0");
    await expect(page.locator("[data-pending-row]", {hasText: "存款对不上"})).toHaveCount(0);
    await expect(statusBar(page)).toContainText("星瑕");
    await expect(pendingItem(page)).toHaveCount(0);
    await expect(panelEntry(page, "nbook.canon.pending")).not.toContainText("1");
});
