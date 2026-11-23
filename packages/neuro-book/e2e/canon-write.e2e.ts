/**
 * 作者与 Agent 都能改设定（w00039 t37、t28）在真实 Chrome 与生产构建上的验收：从一部空作品起步，作者经设定视图的空状态新建人物、
 * 就地改字段、按块写主文字（暂存、刷新后还在、提交、冲突时逐条选）与加别名（docs/specs/canon/author-ui.md，验收 16）；Agent 经
 * `canon_write` 建条目（docs/specs/canon/agent-tools.md 输出 6、10），条目页上出 Agent 提示，作者从提示撤销。模型是 Bun 子进程里的
 * 本机端点，按脚本回工具调用；世界服务、存储与项目子进程都是真的。
 * 用例共用一部作品、按顺序跑：后面的用前面建的星瑕。等页面上可观察的变化，不按时长等。
 */

import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Locator, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {localModelSettings} from "nbook/plugins/agent/testing/endpoint";

import {PACKAGE_ROOT, startProductServer, track} from "./fixtures";
import type {ProcessHandle, ProductServer} from "./fixtures";

test.describe.configure({mode: "serial"});
// 作者界面在 1280 宽时编辑区不到 640 像素，条目页落到窄版。
test.use({viewport: {width: 1440, height: 900}});

let tmp = "";
let server: ProductServer;
let endpoint: ProcessHandle & {control: string; child: ReturnType<typeof spawn>};

async function control(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${endpoint.control}${path}`, body === undefined ? {} : {method: "POST", body: JSON.stringify(body)});
    return response.json();
}
const script = (...replies: unknown[]) => control("/script", replies);

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "canon-write");
    const projectDir = join(tmp, "Book");
    const stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));

    const child = spawn("bun", [join("e2e", "support", "agent-endpoint.ts")], {cwd: PACKAGE_ROOT, stdio: ["pipe", "pipe", "pipe"]});
    const handle = track(child);
    const [, baseUrl, controlUrl] = await handle.waitFor(/READY (\S+) (\S+)/u);
    endpoint = {...handle, control: controlUrl!, child};
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify(localModelSettings(baseUrl!)));
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    endpoint.child.stdin?.end();
    await endpoint.exit;
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
const entryPage = (page: Page) => page.locator("[data-entry-page]");
const activeTabLabel = (page: Page) => page.locator("[data-editor-tab][aria-selected=\"true\"] [data-editor-tab-label]");
const fieldValue = (page: Page, path: string) => entryPage(page).locator(`[data-field="${path}"] .canon-value`);
const dialog = (page: Page) => page.getByRole("dialog");

/** 设定视图没显示时点活动栏把它打开（已显示时再点会收起侧栏）。 */
async function showTree(page: Page, visible: Locator): Promise<void> {
    if (!(await visible.isVisible())) await tree(page).click();
    await expect(visible).toBeVisible();
}

/** 展开分组，点开条目的页。 */
async function openEntry(page: Page, folder: string, name: string): Promise<void> {
    await showTree(page, row(page, folder));
    const item = row(page, folder);
    if ((await item.getAttribute("aria-expanded")) !== "true") await item.click();
    await row(page, name).click();
    await expect(activeTabLabel(page)).toHaveText(name);
    await expect(entryPage(page).locator("h1")).toHaveText(name);
}

/** 编辑视图里的各块、与一块里的代码输入框（Monaco 进入视野才建：先等它建好再点）。 */
const textBlocks = (page: Page) => entryPage(page).locator("[data-text-block]");
async function focusBlock(page: Page, index: number): Promise<void> {
    const block = textBlocks(page).nth(index);
    await expect(block.locator("[data-code-input-stage=\"ready\"]")).toBeVisible();
    await block.locator(".monaco-editor").click();
}
/** 一块里的文字：Monaco 把空格画成不换行空格，两种都认。 */
const blockText = (page: Page, index: number) => textBlocks(page).nth(index).locator(".view-lines");
const tabDot = (page: Page) => page.locator("[data-editor-tab][aria-selected=\"true\"][data-editor-tab-dirty]");

test("作者从空作品起步：空状态里新建人物，条目页上改外观、开始写主文字并用 Ctrl+S 提交、加别名", async ({page}) => {
    await open(page);
    const empty = page.locator("[data-entries-empty]");
    await showTree(page, empty);
    await expect(empty).toContainText("还没有设定");
    await empty.getByRole("button", {name: "新建人物"}).click();
    await page.locator("[data-new-entry] input").first().fill("星瑕");
    await dialog(page).getByRole("button", {name: "新建", exact: true}).click();
    await expect(activeTabLabel(page)).toHaveText("星瑕");
    await expect(page.locator("[data-notice-bar]")).toContainText("新建“星瑕”");

    // 没有主文字时缺省先看人物这组设定；外观未知，按钮写“填写”或“改”都是同一个入口。
    await entryPage(page).getByRole("tab", {name: "人物"}).click();
    await entryPage(page).locator("[data-edit=\"character.外观\"]").click();
    const bar = entryPage(page).locator("[data-confirm-bar]");
    await bar.getByRole("textbox").fill("银白长发");
    await expect(bar.locator("[data-confirm-preview]")).toContainText("改初值");
    await bar.getByRole("button", {name: "保存"}).click();
    await expect(fieldValue(page, "character.外观")).toHaveText("银白长发");

    await entryPage(page).getByRole("tab", {name: "文字"}).click();
    await expect(entryPage(page).locator("[data-text-empty]")).toHaveText("还没有主文字");
    await entryPage(page).getByRole("button", {name: "开始写"}).click();
    // 进来是一个空的块，焦点在里面；还没写字时标签没有未保存的圆点。
    await expect(textBlocks(page)).toHaveCount(1);
    await expect(tabDot(page)).toHaveCount(0);
    await focusBlock(page, 0);
    await page.keyboard.type("星瑕是第三魔法学院的一年级学生。");
    await expect(entryPage(page).locator("[data-text-count]")).toHaveText("未提交 1 块");
    await expect(tabDot(page)).toHaveCount(1);
    // 焦点在代码输入框里按 Ctrl+S：经“保存”命令提交这一页，只提交一次。
    await page.keyboard.press("Control+s");
    await expect(entryPage(page).locator("[data-entry-text]")).toContainText("一年级学生");
    await expect(page.locator("[data-notice-bar]")).toContainText("改星瑕的主文字");
    await expect(tabDot(page)).toHaveCount(0);
    await expect(entryPage(page).locator("[data-entry-text] [data-block]")).toHaveCount(1);

    await entryPage(page).getByRole("button", {name: "＋别名"}).click();
    await entryPage(page).locator("[data-entry-aliases] input").fill("小瑕");
    await page.keyboard.press("Enter");
    await expect(entryPage(page).locator("[data-entry-aliases]")).toContainText("小瑕");
});

test("主文字的稿（验收 16）：从光标处拆成两块，刷新以后标签带圆点、直接在编辑里、改的字还在；提交成一条修订，从提示撤销", async ({page}) => {
    await open(page);
    await openEntry(page, "人物", "星瑕");
    await entryPage(page).getByRole("tab", {name: "文字"}).click();
    await entryPage(page).getByRole("button", {name: "编辑", exact: true}).click();
    await expect(textBlocks(page)).toHaveCount(1);
    // 编辑期间位置锁在开始编辑的地方。
    await expect(entryPage(page).locator("[data-position-locked]")).toHaveCount(1);
    await focusBlock(page, 0);
    await page.keyboard.press("Control+End");
    await page.keyboard.type("她住在旧城区。");
    // 光标退到“她”前面，从这里拆开：后半成新的一块，焦点跟过去。
    for (let step = 0; step < "她住在旧城区。".length; step += 1) await page.keyboard.press("ArrowLeft");
    await textBlocks(page).nth(0).getByRole("button", {name: "从光标处拆开"}).click();
    await expect(textBlocks(page)).toHaveCount(2);
    await expect(blockText(page, 0)).toHaveText("星瑕是第三魔法学院的一年级学生。");
    await expect(blockText(page, 1)).toHaveText("她住在旧城区。");
    await expect(entryPage(page).locator("[data-text-count]")).toHaveText("未提交 1 块");
    await expect(entryPage(page).locator("[data-text-saved=\"saved\"]")).toBeVisible();

    await open(page);
    await expect(tabDot(page)).toHaveCount(1);
    await expect(textBlocks(page)).toHaveCount(2);
    await expect(blockText(page, 1)).toHaveText("她住在旧城区。");
    // 暂存不是修订：还没提交，别的读取看不到。

    await entryPage(page).getByRole("button", {name: "提交", exact: true}).click();
    await expect(entryPage(page).locator("[data-entry-text] [data-block]")).toHaveCount(2);
    await expect(entryPage(page).locator("[data-entry-text]")).toContainText("她住在旧城区。");
    await expect(tabDot(page)).toHaveCount(0);
    const notice = page.locator("[data-notice-bar]");
    await expect(notice).toContainText("改星瑕的主文字");
    await notice.getByRole("button", {name: "撤销"}).click();
    await expect(page.locator("[data-revert-dialog]")).toBeVisible();
    await dialog(page).getByRole("button", {name: "还原", exact: true}).click();
    await expect(page.locator("[data-revert-dialog]")).toHaveCount(0);
    await expect(entryPage(page).locator("[data-entry-text] [data-block]")).toHaveCount(1);
    await expect(entryPage(page).locator("[data-entry-text]")).not.toContainText("她住在旧城区。");
});

test("同一块两边都改了（验收 16）：另一个窗口先提交，这边提交时出对照；选“现在的”就照别处的那一版，选“我的”以我的为准", async ({page, browser}) => {
    await open(page);
    await openEntry(page, "人物", "星瑕");
    await entryPage(page).getByRole("tab", {name: "文字"}).click();
    await entryPage(page).getByRole("button", {name: "编辑", exact: true}).click();
    await focusBlock(page, 0);
    await page.keyboard.press("Control+End");
    await page.keyboard.type("（这边改的）");
    await expect(entryPage(page).locator("[data-text-saved=\"saved\"]")).toBeVisible();

    // 另一份浏览器配置的窗口（稿是各自的）改同一块并提交。
    const context = await browser.newContext({viewport: {width: 1440, height: 900}});
    const other = await context.newPage();
    try {
        await open(other);
        await openEntry(other, "人物", "星瑕");
        await entryPage(other).getByRole("tab", {name: "文字"}).click();
        await entryPage(other).getByRole("button", {name: "编辑", exact: true}).click();
        await focusBlock(other, 0);
        await other.keyboard.press("Control+End");
        await other.keyboard.type("（别处改的）");
        await entryPage(other).getByRole("button", {name: "提交", exact: true}).click();
        await expect(entryPage(other).locator("[data-entry-text]")).toContainText("（别处改的）");
    } finally {
        await context.close();
    }

    await entryPage(page).getByRole("button", {name: "提交", exact: true}).click();
    const conflicts = page.locator("[data-text-conflicts]");
    await expect(conflicts).toBeVisible();
    await expect(conflicts.locator("[data-pick=\"theirs\"]")).toContainText("（别处改的）");
    await expect(conflicts.locator("[data-pick=\"mine\"]")).toContainText("（这边改的）");
    await conflicts.locator("[data-pick=\"theirs\"]").click();
    await dialog(page).getByRole("button", {name: "提交", exact: true}).click();
    // 选“现在的”以后这边没有改动了：不多出修订，回到阅读视图，读到别处的那一版。
    await expect(entryPage(page).locator("[data-entry-text]")).toContainText("（别处改的）");
    await expect(entryPage(page).locator("[data-entry-text]")).not.toContainText("（这边改的）");
    await expect(tabDot(page)).toHaveCount(0);
});

test("Agent 用 canon_write 建条目：批准后树里有它、读得到初值；条目页开着时 Agent 又改了，页上出 Agent 提示，从提示撤销", async ({page}) => {
    await open(page);
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("打开对话");
    await page.keyboard.press("Enter");
    const input = page.getByRole("textbox", {name: "消息输入框"});
    await expect(input).toBeVisible();
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("新建 Agent 会话");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-agent-welcome]")).toBeVisible();

    // 一次写入建学院与挂在它下面的雾崎（`$代号` 引用同一批里新建的），带外观初值与一段主文字。
    await script({tool: "canon_write", args: {title: "建学院与雾崎", edits: [
        {op: "create", key: "school", name: "第三魔法学院", kind: "组织"},
        {op: "create", name: "雾崎", kind: "人物", parent: "$school", components: ["人物"], fields: {"人物.外观": "一身黑衣"}, text: "雾崎是星瑕的对头。"},
    ]}}, "建好了");
    await input.click();
    await page.keyboard.type("建学院和雾崎");
    await page.keyboard.press("Enter");
    const wizard = page.locator("[data-agent-wizard]");
    await wizard.locator("[data-approval-decision='allow']").click();
    await expect(page.getByText("建好了")).toBeVisible();

    await showTree(page, row(page, "组织"));
    await row(page, "组织").click();
    await expect(row(page, "第三魔法学院")).toBeVisible();
    await row(page, "第三魔法学院").click();
    await expect(row(page, "雾崎")).toBeVisible();
    await row(page, "雾崎").click();
    await expect(activeTabLabel(page)).toHaveText("雾崎");
    await expect(entryPage(page).locator("[data-entry-text]")).toContainText("星瑕的对头");
    await entryPage(page).getByRole("tab", {name: "人物"}).click();
    await expect(fieldValue(page, "character.外观")).toHaveText("一身黑衣");

    // 雾崎的页开着：Agent 再建一个条目，页上另出一行 Agent 提示；从提示撤销，那个条目没了。
    await script({tool: "canon_write", args: {title: "建校长", edits: [{op: "create", name: "校长", kind: "人物", parent: "第三魔法学院"}]}}, "又建了一个");
    await input.click();
    await page.keyboard.type("再建一个校长");
    await page.keyboard.press("Enter");
    await wizard.locator("[data-approval-decision='allow']").click();
    await expect(page.getByText("又建了一个")).toBeVisible();
    const notice = page.locator("[data-agent-notice]");
    await expect(notice).toContainText("建校长");
    await expect(row(page, "校长")).toBeVisible();
    await notice.getByRole("button", {name: "撤销"}).click();
    await expect(page.locator("[data-revert-dialog]")).toBeVisible();
    await dialog(page).getByRole("button", {name: "还原", exact: true}).click();
    await expect(page.locator("[data-revert-dialog]")).toHaveCount(0);
    await expect(row(page, "校长")).toHaveCount(0);
    await expect(row(page, "雾崎")).toBeVisible();
    // 撤销过的那一次不能再撤销（再点会进“连同依赖一起还原”，等于把 Agent 的改动重做回来）；焦点回到同一个按钮上。
    const undo = notice.locator("[data-agent-undo]");
    await expect(undo).toHaveText("已撤销");
    await expect(undo).toHaveAttribute("aria-disabled", "true");
    await expect(undo).toBeFocused();
});
