/**
 * 作者与 Agent 都能改设定（w00039 t37）在真实 Chrome 与生产构建上的验收：从一部空作品起步，作者经设定视图的空状态新建人物、就地改字段、
 * 加主文字与别名（docs/specs/canon/author-ui.md）；Agent 经 `canon_write` 建条目（docs/specs/canon/agent-tools.md 输出 6、10），条目页上
 * 出 Agent 提示，作者从提示撤销。模型是 Bun 子进程里的本机端点，按脚本回工具调用；世界服务、存储与项目子进程都是真的。
 * 用例共用一部作品、按顺序跑：第二条用第一条建的星瑕。等页面上可观察的变化，不按时长等。
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

test("作者从空作品起步：空状态里新建人物，条目页上改外观、加一段主文字、加别名", async ({page}) => {
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
    await entryPage(page).locator("[data-add-block]").click();
    await dialog(page).getByRole("textbox", {name: "这一段的源文字（Markdown）"}).fill("星瑕是第三魔法学院的一年级学生。");
    await dialog(page).getByRole("button", {name: "保存"}).click();
    await expect(entryPage(page).locator("[data-entry-text]")).toContainText("一年级学生");
    await expect(page.locator("[data-notice-bar]")).toContainText("给星瑕加一段主文字");

    await entryPage(page).getByRole("button", {name: "＋别名"}).click();
    await entryPage(page).locator("[data-entry-aliases] input").fill("小瑕");
    await page.keyboard.press("Enter");
    await expect(entryPage(page).locator("[data-entry-aliases]")).toContainText("小瑕");
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
