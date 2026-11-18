/**
 * 作者界面（设定侧）在真实 Chrome 与生产构建上的验收（docs/specs/canon/author-ui.md 验收 1、2、3、5 与 10 的“在改动记录里还原”）：
 * `scripts/canon-sample.ts` 生成星瑕样本作品（经产品的世界宿主逐次发布），登记成项目 `book`；世界服务、存储与项目子进程都是真的。
 * 用例共用一部作品、按顺序跑：前面的用例只读或改了又撤销，第 5 个场景最后才把那一笔改对。等页面上可观察的变化，不按时长等。
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
/** 数据分页（字段表）里一个字段的值。 */
const fieldValue = (page: Page, path: string) => entryPage(page).locator(`[data-field="${path}"] .canon-value`);
const positionSelect = (page: Page) => entryPage(page).getByRole("combobox", {name: "位置"});

/** 打开设定视图，展开“人物”分组（以及给了的上级条目），点开这个条目的页。 */
async function openEntry(page: Page, name: string, parents: readonly string[] = []): Promise<void> {
    // 活动栏的条目再点一次会把侧栏收起来：设定视图没显示时才点。
    if (!(await row(page, "人物").isVisible())) await tree(page).click();
    for (const folder of ["人物", ...parents]) {
        const item = row(page, folder);
        await expect(item).toBeVisible();
        if ((await item.getAttribute("aria-expanded")) !== "true") await item.click();
        await expect(item).toHaveAttribute("aria-expanded", "true");
    }
    await row(page, name).click();
    await expect(activeTabLabel(page)).toHaveText(name);
    // 读到了条目：页头的位置选择出现（文字分页里不一定有带值写法的值）。
    await expect(positionSelect(page)).toBeVisible();
}

async function choosePosition(page: Page, label: RegExp): Promise<void> {
    await positionSelect(page).click();
    await page.getByRole("option", {name: label}).click();
    await expect(positionSelect(page)).toHaveText(label);
}

test("验收 1：设定树与条目页：马甲在本体下面、标签标题与面包屑、换位置后值跟着变、存款的来历里估计的那笔是警告色", async ({page}) => {
    await open(page);
    await openEntry(page, "星瑕");
    await expect(crumbs(page)).toHaveText(["设定", "人物", "星瑕"]);
    await expect(positionSelect(page)).toHaveText(/第 3 章末尾/u);

    // 马甲“哥哥”挂在星瑕下面；它的面包屑多一级，点其中的“星瑕”回到星瑕的页。
    const star = row(page, "星瑕");
    if ((await star.getAttribute("aria-expanded")) !== "true") await star.click();
    await row(page, "哥哥").click();
    await expect(activeTabLabel(page)).toHaveText("哥哥");
    await expect(crumbs(page)).toHaveText(["设定", "人物", "星瑕", "哥哥"]);
    await crumbs(page).filter({hasText: "星瑕"}).click();
    await expect(activeTabLabel(page)).toHaveText("星瑕");

    const latest = await value(page, "panel.存款").innerText();
    await choosePosition(page, /第 1 章末尾/u);
    await expect(value(page, "panel.存款")).toHaveText("41,800");
    expect(latest).not.toBe("41,800");
    await entryPage(page).getByRole("tab", {name: "面板"}).click();
    await expect(entryPage(page).locator("[data-card=\"panel.存款\"]")).toContainText("41,800");
    await entryPage(page).getByRole("tab", {name: "文字"}).click();

    await choosePosition(page, /第 2 章末尾/u);
    await value(page, "panel.存款").click();
    const origins = entryPage(page).locator("[data-origin-list]");
    await expect(origins).toBeVisible();
    await expect(origins.locator("[data-origin-row]").last()).toContainText("初值");
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
    await choosePosition(page, /第 1 章末尾/u);
    await value(page, "panel.存款").click();
    await expect(entryPage(page).locator("[data-origin-list]")).toBeVisible();

    await openEntry(page, "星瑾");
    await expect(positionSelect(page)).toHaveText(/第 3 章末尾/u);
    await page.locator("[data-editor-tab]", {hasText: "星瑕"}).click();
    await expect(positionSelect(page)).toHaveText(/第 1 章末尾/u);
    await expect(entryPage(page).locator("[data-origin-list]")).toBeVisible();

    // 填了一半的就地改：切走再回来，确认条与填的字还在。
    await entryPage(page).getByRole("tab", {name: "人物"}).click();
    await entryPage(page).locator("[data-edit=\"character.性格\"]").click();
    const bar = entryPage(page).locator("[data-confirm-bar]");
    await bar.getByRole("textbox").fill("还没想好");
    await page.locator("[data-editor-tab]", {hasText: "星瑾"}).click();
    await expect(activeTabLabel(page)).toHaveText("星瑾");
    await page.locator("[data-editor-tab]", {hasText: "星瑕"}).click();
    await expect(entryPage(page).locator("[data-confirm-bar]").getByRole("textbox")).toHaveValue("还没想好");
    await entryPage(page).locator("[data-confirm-bar]").getByRole("button", {name: "取消"}).click();

    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    const labels = page.locator("[data-editor-tab-label]");
    await expect(labels.filter({hasText: /^星瑕$/u})).toHaveCount(1);
    await expect(labels.filter({hasText: /^星瑾$/u})).toHaveCount(1);
    await page.locator("[data-editor-tab]", {hasText: "星瑕"}).click();
    await expect(positionSelect(page)).toHaveText(/第 3 章末尾/u);
});

/** 从命令面板打开改动记录（底部面板的入口条做好之前，命令面板与回执页的面包屑是它的入口），等行出来。 */
async function showRevisions(page: Page): Promise<Locator> {
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("显示改动记录");
    await page.keyboard.press("Enter");
    const rows = page.locator("[data-revision-row]");
    await expect(rows.first()).toBeVisible();
    return rows;
}

test("验收 3：就地改一个只在初值设过的字段，预览写“改初值”；保存后有提示，看回执列出改前改后；撤销以后值回到原样、改动记录多了两条", async ({page}) => {
    await open(page);
    await openEntry(page, "星瑕");
    const revisions = await (await showRevisions(page)).count();
    await entryPage(page).getByRole("tab", {name: "人物"}).click();
    const before = await fieldValue(page, "character.性格").innerText();
    await entryPage(page).locator("[data-edit=\"character.性格\"]").click();
    const bar = entryPage(page).locator("[data-confirm-bar]");
    await bar.getByRole("textbox").fill("嘴硬心软");
    await expect(bar.locator("[data-confirm-preview]")).toContainText("改初值");
    await bar.getByRole("button", {name: "保存"}).click();
    await expect(fieldValue(page, "character.性格")).toHaveText("嘴硬心软");

    const notice = page.locator("[data-notice-bar]");
    await expect(notice).toBeVisible();
    await notice.getByRole("button", {name: "看回执"}).click();
    const receipt = page.locator("[data-receipt-page]");
    await expect(receipt).toBeVisible();
    await expect(receipt.locator("[data-receipt-item]", {hasText: "性格"})).toContainText("嘴硬心软");
    await expect(receipt.locator("[data-receipt-item]", {hasText: "性格"})).toContainText(before);

    await page.locator("[data-editor-tab]", {hasText: "星瑕"}).click();
    await page.locator("[data-notice-bar]").getByRole("button", {name: "撤销"}).click();
    const dialog = page.locator("[data-revert-dialog]");
    await expect(dialog).toBeVisible();
    await page.getByRole("dialog").getByRole("button", {name: "还原", exact: true}).click();
    await expect(dialog).toHaveCount(0);
    await expect(fieldValue(page, "character.性格")).toHaveText(before);
    const rows = await showRevisions(page);
    await expect(rows).toHaveCount(revisions + 2);
    await expect(rows.first()).toContainText("还原");
});

test("验收 10 的后一半：在改动记录里还原一次修订，条目页上的值回到原样", async ({page}) => {
    await open(page);
    await openEntry(page, "星瑕");
    await entryPage(page).getByRole("tab", {name: "人物"}).click();
    const field = fieldValue(page, "character.状态");
    const before = await field.innerText();
    await entryPage(page).locator("[data-edit=\"character.状态\"]").click();
    const bar = entryPage(page).locator("[data-confirm-bar]");
    await bar.getByRole("textbox").fill("在打工");
    await bar.getByRole("button", {name: "保存"}).click();
    await expect(field).toHaveText("在打工");

    const newest = (await showRevisions(page)).first();
    await newest.locator("[data-revision-revert]").click();
    await expect(page.locator("[data-revert-dialog]")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", {name: "还原", exact: true}).click();
    await expect(page.locator("[data-revert-dialog]")).toHaveCount(0);
    await expect(field).toHaveText(before);
});

test("验收 5：状态栏“待处理 1”点进去选中那一条；改这一笔开出变更详情页，改成对得上的数并保存，这一条与状态栏条目都消失", async ({page}) => {
    await open(page);
    // 状态栏另有一份量宽度用的副本（aria-hidden），按按钮的角色找只找到看得见的那一个。
    const count = page.getByRole("button").filter({hasText: /^待处理 1$/u});
    await expect(count).toBeVisible();
    await count.click();
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
    await bar.getByRole("spinbutton").or(bar.getByRole("textbox")).first().fill("-2000");
    await bar.getByRole("button", {name: "保存"}).click();

    await expect(page.locator("[data-pending-row]", {hasText: "存款对不上"})).toHaveCount(0);
    await expect(page.getByRole("button").filter({hasText: /^待处理 \d+$/u})).toHaveCount(0);
});
