/**
 * 作者界面（剧情侧）在真实 Chrome 与生产构建上的验收（docs/specs/plot/author-ui.md 验收 1 到 6）：`scripts/canon-sample.ts --plot`
 * 生成带剧情数据的星瑕样本（经产品的世界宿主逐次发布），登记成项目 `book`；世界服务、剧情插件与项目子进程都是真的。用例只读，
 * 换线的几条最后换回“按章节自动”。等页面上可观察的变化，不按时长等。
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
// 宽屏：编辑区要宽过 640 像素才画成表格（输出 6）；1280 宽时侧栏与右侧面板开着，编辑区不到 640。窄的版式由验收 6 量。
test.use({viewport: {width: 1440, height: 900}});

let tmp = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "plot-author");
    const projectDir = join(tmp, "Book");
    const stateRoot = join(tmp, "state");
    const {stdout} = await promisify(execFile)("bun", [join("scripts", "canon-sample.ts"), "--plot", projectDir], {cwd: PACKAGE_ROOT});
    const {projectId} = JSON.parse(stdout) as {projectId: string};
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id: projectId, name: "book", path: projectDir}]}));
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

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

const plotEntry = (page: Page) => page.locator("[data-tool-view=\"nbook.plot.sidebar\"]");
const sidebar = (page: Page) => page.locator("[data-plot-sidebar]");
const plotPage = (page: Page, table: "secrets" | "ledger" | "goals") => page.locator(`[data-plot-page="${table}"]`);
const entryPage = (page: Page) => page.locator("[data-entry-page]");
const activeTabLabel = (page: Page) => page.locator("[data-editor-tab][aria-selected=\"true\"] [data-editor-tab-label]");
const statusBar = (page: Page) => page.locator("[data-workbench-surface] > [data-grid-scope] > [data-leaf='statusbar']");
/** 状态栏的“故事线：……”。状态栏另有一份量宽度用的副本（aria-hidden），按按钮的角色找只找到看得见的那一个。 */
const lineItem = (page: Page) => statusBar(page).getByRole("button").filter({hasText: /^故事线：/u});
/** 页头的“在看”按钮与它的菜单（菜单传送到 body）。 */
const viewPoint = (page: Page) => entryPage(page).locator("[data-view-point]");
const viewMenu = (page: Page) => page.locator("[data-view-point-menu]");
const secretRow = (page: Page, name: string) => plotPage(page, "secrets").locator("[data-secret-row]", {hasText: name});
/** 表里一个人的那一格（按表头的名字取列）。 */
async function personCell(page: Page, secret: string, person: string): Promise<Locator> {
    const headers = await plotPage(page, "secrets").locator("thead th").allInnerTexts();
    const column = headers.findIndex((header) => header.trim() === person);
    expect(column).toBeGreaterThan(0);
    return secretRow(page, secret).locator("th, td").nth(column);
}

/** 显示侧栏“剧情”，点一张表。 */
async function openTable(page: Page, title: string): Promise<void> {
    if (!(await sidebar(page).isVisible())) await plotEntry(page).click();
    await sidebar(page).getByRole("button", {name: title, exact: true}).click();
    await expect(activeTabLabel(page)).toHaveText(title);
}

/** 从设定视图点开人物或秘密的条目页（秘密在主体下面）。 */
async function openEntry(page: Page, name: string, parents: readonly string[]): Promise<void> {
    const row = (label: string) => page.locator("[data-tree-id]").filter({hasText: new RegExp(`^${label}`, "u")}).first();
    if (!(await row(parents[0]!).isVisible())) await page.locator("[data-tool-view=\"nbook.canon.entries\"]").click();
    for (const folder of parents) {
        const item = row(folder);
        await expect(item).toBeVisible();
        // 展开只认点箭头：点行是打开那个条目（canon/author-ui 输出 5）。
        if ((await item.getAttribute("aria-expanded")) !== "true") await item.locator("[data-tree-toggle]").click();
        await expect(item).toHaveAttribute("aria-expanded", "true");
    }
    await row(name).click();
    await expect(activeTabLabel(page)).toHaveText(name);
    await expect(viewPoint(page)).toBeVisible();
}

const entryTab = (page: Page, name: string) => entryPage(page).getByRole("tab", {name: new RegExp(`^${name}`, "u")});

test("验收 1：活动栏有“剧情”；谁知道什么按主体分组，哥哥就是星瑕一行写星瑕知道、星瑾不知道、读者从第 1 章第 8 段起知道；“没打算怎么揭”只剩条数那么多行", async ({page}) => {
    await open(page);
    await expect(plotEntry(page)).toBeVisible();
    await openTable(page, "谁知道什么");
    const table = plotPage(page, "secrets");
    await expect(table.locator("[data-secret-row]")).toHaveCount(5);
    await expect(table.locator("th[scope=\"rowgroup\"]")).toHaveText(["关于星瑕", "关于父母"]);
    await expect(await personCell(page, "哥哥就是星瑕", "星瑕")).toHaveText("知道");
    await expect(await personCell(page, "哥哥就是星瑕", "星瑾")).toHaveText("不知道");
    await expect(secretRow(page, "哥哥就是星瑕").locator("[data-cell=\"reader\"]")).toHaveText("知道，第 1 章第 8 段起");

    const noPlan = table.getByRole("radio").filter({hasText: /^没打算怎么揭/u});
    const count = Number((await noPlan.innerText()).replace(/\D/gu, ""));
    await noPlan.click();
    await expect(noPlan).toHaveAttribute("aria-checked", "true");
    await expect(table.locator("[data-secret-row]")).toHaveCount(count);
    await expect(table.locator("[data-secret-row]")).toHaveText([/软禁处留着的是魔偶/u]);
});

test("验收 2：伏笔账本“还没收”不含收了与放弃的，“已放弃”里有放弃的那条，没打算的写“没有打算”；目标表有瞒着别人的目标与打架的对方，打开开关多出达成的", async ({page}) => {
    await open(page);
    await openTable(page, "伏笔账本");
    const ledger = plotPage(page, "ledger");
    const rows = ledger.locator("[data-ledger-row]");
    await expect(rows.first()).toBeVisible();
    await expect(rows.filter({hasText: "彗的五条建议"})).toHaveCount(0);
    await expect(rows.filter({hasText: "被划掉的第五条"})).toHaveCount(0);
    await expect(rows.filter({hasText: "星瑾不吃煎蛋"}).locator("[data-cell=\"next\"]")).toHaveText("没有打算");
    await ledger.getByRole("radio").filter({hasText: /^已放弃/u}).click();
    await expect(rows).toHaveText([/被划掉的第五条/u]);

    await openTable(page, "目标表");
    const goals = plotPage(page, "goals");
    const xia = goals.locator("[data-goal-group]", {has: page.getByRole("button", {name: "星瑕", exact: true})});
    await expect(xia.locator("[data-goal]", {hasText: "不让星瑾知道那几年的事"})).toContainText("瞒着别人");
    await expect(xia.locator("[data-goal]", {hasText: "不让星瑾知道那几年的事"})).toContainText("和这些打架：星瑾：弄清哥哥那几年去了哪");
    await expect(goals.getByText("把星瑾接回家")).toHaveCount(0);
    await goals.getByRole("switch", {name: "也列达成与放弃的"}).click();
    await expect(xia.locator("[data-goal]", {hasText: "把星瑾接回家"})).toBeVisible();
});

test("验收 3：星瑾的条目页有知道什么、目标与态度、经历；信错了写她以为的那句、忘了的写忘了，字段一节能改；换到第 1 章末尾，经历只列到第 1 章", async ({page}) => {
    await open(page);
    await openEntry(page, "星瑾", ["人物"]);
    for (const name of ["知道什么", "目标与态度", "经历"]) await expect(entryTab(page, name)).toBeVisible();
    await entryTab(page, "知道什么").click();
    const knowing = entryPage(page).locator("[data-knowing-view]");
    await expect(knowing.locator("[data-knowing-row]", {hasText: "那几年哥哥是被软禁"})).toContainText("信错了");
    await expect(knowing.locator("[data-knowing-row]", {hasText: "那几年哥哥是被软禁"})).toContainText("哥哥那几年不想回家，也不想管她");
    await expect(knowing.locator("[data-knowing-row]", {hasText: "星瑕做过魔法少女"})).toContainText("忘了");
    await expect(knowing.getByRole("button", {name: /^改/u}).first()).toBeVisible();

    await viewPoint(page).click();
    await viewMenu(page).getByRole("radio", {name: /第 1 章末尾/u}).click();
    await expect(viewMenu(page)).toHaveCount(0);
    await entryTab(page, "经历").click();
    const experience = entryPage(page).locator("[data-experience]");
    await expect(experience.locator("[data-experience-item]").first()).toBeVisible();
    await expect(experience.locator("h3")).toHaveText(["第 1 章", "前史"]);
});

test("验收 4：秘密“那几年哥哥是被软禁”的条目页有谁知道：顶上写保密，读者写怀疑与从哪一段起，和它有关的里有到期的决策且不可点", async ({page}) => {
    await open(page);
    await openEntry(page, "那几年哥哥是被软禁", ["人物", "星瑕"]);
    await entryTab(page, "谁知道").click();
    const view = entryPage(page).locator("[data-point-view]");
    await expect(view.getByText("保密", {exact: true}).first()).toBeVisible();
    await expect(view.locator("[data-point-reader]")).toHaveText(/^怀疑，从第 2 章第 10 段起：/u);
    const decision = view.locator("[data-point-related] li", {hasText: "什么时候让星瑾知道那几年的事"});
    await expect(decision).toContainText("还没定");
    await expect(decision).toContainText("第 3 章到期");
    await expect(decision.getByRole("button")).toHaveCount(0);
});

/**
 * 从现在起记下屏幕上的剧情页面或条目页里有没有出现过加载占位（读取中的 status）；返回读这个记号的函数。只量换线这一下：
 * 刚打开的页面第一次读本来就有占位。
 */
async function watchBusy(page: Page): Promise<() => Promise<boolean>> {
    const id = await page.evaluate(() => {
        const marks = ((window as unknown as {busyMarks?: boolean[]}).busyMarks ??= []);
        const at = marks.push(false) - 1;
        const observer = new MutationObserver(() => {
            if (document.querySelector("[data-plot-page] [aria-busy=\"true\"], [data-entry-page] [aria-busy=\"true\"]") !== null) marks[at] = true;
        });
        observer.observe(document.body, {subtree: true, childList: true, attributes: true});
        return at;
    });
    return () => page.evaluate((at) => (window as unknown as {busyMarks: boolean[]}).busyMarks[at]!, id);
}

async function pickLine(page: Page, name: RegExp | string): Promise<void> {
    await lineItem(page).click();
    await page.getByRole("option", {name}).click();
}

test("验收 5：状态栏选回溯线，状态栏写线名，谁知道什么与星瑾的知道什么换成子线上的值，没出现加载占位", async ({page}) => {
    await open(page);
    await openTable(page, "谁知道什么");
    await expect(await personCell(page, "那几年哥哥是被软禁", "星瑾")).toContainText("信错了");
    await expect(lineItem(page)).toHaveText("故事线：按章节自动");
    let busy = await watchBusy(page);
    await pickLine(page, /重来的那个晚上/u);
    await expect(lineItem(page)).toHaveText("故事线：重来的那个晚上");
    await expect(await personCell(page, "那几年哥哥是被软禁", "星瑾")).toHaveText("知道");
    expect(await busy()).toBe(false);

    // 星瑾的“知道什么”：子线上听星瑕说了；换回按章节自动，回到信错了，同样不闪占位。
    await openEntry(page, "星瑾", ["人物"]);
    await entryTab(page, "知道什么").click();
    const row = entryPage(page).locator("[data-knowing-row]", {hasText: "那几年哥哥是被软禁"});
    await expect(row).toContainText("听星瑕说");
    busy = await watchBusy(page);
    await pickLine(page, "按章节自动");
    await expect(lineItem(page)).toHaveText("故事线：按章节自动");
    await expect(row).toContainText("信错了");
    expect(await busy()).toBe(false);
});

test("验收 5 的页头：作品有两条线时，在“在看”里选一条线，按钮写线名且固定看它，状态栏跟着；选“按章节自动”回来", async ({page}) => {
    await open(page);
    await openEntry(page, "星瑾", ["人物"]);
    const view = viewPoint(page);
    // 有两条线时按钮在位置后面写线名；缺省按章节自动，不是固定看一条线。
    await expect(view).toContainText("主线");
    await expect(view).not.toHaveAttribute("data-pinned");
    await expect(lineItem(page)).toHaveText("故事线：按章节自动");

    await view.click();
    const menu = viewMenu(page);
    await expect(menu.locator("[data-line-option='']")).toHaveAttribute("aria-checked", "true");
    await menu.locator("[data-line-option]").filter({hasText: "重来的那个晚上"}).click();
    await expect(viewMenu(page)).toHaveCount(0);
    await expect(view).toContainText("重来的那个晚上");
    await expect(view).toHaveAttribute("data-pinned", "");
    await expect(lineItem(page)).toHaveText("故事线：重来的那个晚上");

    await view.click();
    await viewMenu(page).locator("[data-line-option='']").click();
    await expect(viewMenu(page)).toHaveCount(0);
    await expect(view).not.toHaveAttribute("data-pinned");
    await expect(lineItem(page)).toHaveText("故事线：按章节自动");
});

test("验收 5 的页头：作品里有计划中的情节时，“在看”菜单里有“算上计划中的情节”开关，拨开时菜单不关、按钮写“含计划”，拨回去不再写", async ({page}) => {
    await open(page);
    await openEntry(page, "星瑾", ["人物"]);
    const view = viewPoint(page);
    await expect(view).not.toContainText("含计划");
    await view.click();
    const plan = viewMenu(page).locator("[data-view-point-plan]");
    await expect(plan).toBeVisible();
    await plan.getByRole("switch").click();
    await expect(view).toContainText("含计划");
    await expect(viewMenu(page)).toBeVisible();
    await plan.getByRole("switch").click();
    await expect(view).not.toContainText("含计划");
    await expect(viewMenu(page)).toBeVisible();
});

/**
 * 页面或视图里会横着滚的地方：根自己、它里面 `overflow-x` 是 auto 或 scroll 的元素、它外面最近的那个滚动容器，内容比宽度宽的都算；
 * 再加上整页。空数组是没有（与 canon-author.e2e.ts 的同名函数同一个量法）。
 */
async function horizontalScrolls(root: Locator): Promise<string[]> {
    return root.first().evaluate((element) => {
        const scrolls = (node: Element) => ["auto", "scroll"].includes(getComputedStyle(node).overflowX);
        const candidates = [element, ...element.querySelectorAll("*")].filter((node) => node === element || scrolls(node));
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

/** 分段筛选的标签都完整显示（没被截断），选中的那一段有实底（换行的分段没有滑动指示块，选中项自己画底色）。 */
async function segmentsReadable(root: Locator): Promise<void> {
    const result = await root.getByRole("radiogroup").first().evaluate((group) => ({
        truncated: [...group.querySelectorAll("[role=\"radio\"] .truncate")].filter((label) => label.scrollWidth > label.clientWidth + 1).map((label) => label.textContent),
        checked: getComputedStyle(group.querySelector("[role=\"radio\"][aria-checked=\"true\"]")!).backgroundColor,
    }));
    expect(result.truncated).toEqual([]);
    expect(result.checked).not.toBe("rgba(0, 0, 0, 0)");
}

// 侧栏不在这里量：390 宽时工作台把侧栏让给编辑区。
test("验收 6：390 与 600 像素宽时三张表与四个分页都没有横向滚动，谁知道什么是一行一个秘密的列表", async ({page}) => {
    await open(page);
    const narrow = async (root: Locator, check?: () => Promise<void>): Promise<void> => {
        for (const width of [600, 390]) {
            await page.setViewportSize({width, height: 844});
            await expect(root.first()).toBeVisible();
            await check?.();
            expect(await horizontalScrolls(root), `${String(width)} 宽`).toEqual([]);
        }
        await page.setViewportSize({width: 1440, height: 900});
    };
    await openTable(page, "谁知道什么");
    await narrow(plotPage(page, "secrets"), async () => {
        await expect(plotPage(page, "secrets").locator("[data-secrets-list]")).toBeVisible();
        await expect(plotPage(page, "secrets").locator("[data-secrets-table]")).toHaveCount(0);
        await segmentsReadable(plotPage(page, "secrets"));
    });
    await openTable(page, "伏笔账本");
    await narrow(plotPage(page, "ledger"), () => segmentsReadable(plotPage(page, "ledger")));
    await openTable(page, "目标表");
    await narrow(plotPage(page, "goals"));
    // 分页量分页的内容（连同它外面的滚动容器，页头宽了也量得到）；分页的标签条本来就是横着滚的（nb-ui 的 Tabs），不算。
    const panel = entryPage(page).getByRole("tabpanel");
    await openEntry(page, "星瑾", ["人物"]);
    for (const tab of ["知道什么", "目标与态度", "经历"]) {
        await entryTab(page, tab).click();
        await narrow(panel);
    }
    await openEntry(page, "那几年哥哥是被软禁", ["人物", "星瑕"]);
    await entryTab(page, "谁知道").click();
    await narrow(panel);
});
