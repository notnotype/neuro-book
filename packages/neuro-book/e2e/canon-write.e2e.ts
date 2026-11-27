/**
 * 作者与 Agent 都能改设定（w00039 t37、t28）在真实 Chrome 与生产构建上的验收：从一部空作品起步，作者经设定视图的空状态新建人物、
 * 就地改字段、按块写主文字（暂存、刷新后还在、提交、冲突时逐条选）与加别名（docs/specs/canon/author-ui.md，验收 16）；Agent 经
 * `canon_write` 建条目（docs/specs/canon/agent-tools.md 输出 6、10），条目页上出 Agent 提示，作者从提示还原。模型是 Bun 子进程里的
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
import {selectTab} from "./support/entry-page";

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
/** 人物分页里一项的值（author-ui 输出 49：值本身是按钮）。 */
const fieldValue = (page: Page, path: string) => entryPage(page).locator(`[data-edit="${path}"]`);
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

/** 编辑视图里整篇源文字的输入框（Monaco 进入视野才建：先等它建好再点）。 */
const textSource = (page: Page) => entryPage(page).locator("[data-text-source]");
async function focusSource(page: Page): Promise<void> {
    await expect(textSource(page).locator("[data-code-input-stage=\"ready\"]")).toBeVisible();
    await textSource(page).locator(".monaco-editor").click();
}
/** 输入框里的文字：Monaco 把空格画成不换行空格，两种都认。 */
const sourceText = (page: Page) => textSource(page).locator(".view-lines");
/** 输入框里文字正好是 `text` 的第一个记号：Monaco 按记号的种类给类名 `mtkN`，没有着色的是 `mtk1`。 */
const sourceToken = (page: Page, text: string) => textSource(page).locator(".view-lines span > span").filter({hasText: new RegExp(`^${text}$`, "u")}).first();
const dirtyLabel = (page: Page) => entryPage(page).locator("[data-text-dirty]");
const tabDot = (page: Page) => page.locator("[data-editor-tab][aria-selected=\"true\"][data-editor-tab-dirty]");

test("作者从空作品起步：空状态里新建人物，条目页上改性格、开始写主文字并用 Ctrl+S 提交、加别名", async ({page}) => {
    await open(page);
    const empty = page.locator("[data-entries-empty]");
    await showTree(page, empty);
    await expect(empty).toContainText("还没有设定");
    await empty.getByRole("button", {name: "新建人物"}).click();
    await page.locator("[data-new-entry] input").first().fill("星瑕");
    await dialog(page).getByRole("button", {name: "新建", exact: true}).click();
    await expect(activeTabLabel(page)).toHaveText("星瑕");
    await expect(page.locator("[data-notice-bar]")).toContainText("新建“星瑕”");

    // 新建人物带人物与形象两组，先看人物分页（author-ui 输出 4、9、37）；性格未知，点它在原处就地改（输出 51）。
    // 空作品里还没有剧情变更：经历与情节不出（author-ui 输出 9）。
    await expect(entryPage(page).getByRole("tab")).toHaveText([/^人物/u, /^形象/u, /^文字/u]);
    await expect(entryPage(page).getByRole("tab", {selected: true})).toHaveText("人物");
    await entryPage(page).locator("[data-edit=\"character.性格\"]").click();
    const bar = page.locator("[data-field-editor=\"character.性格\"]");
    await bar.getByRole("textbox").fill("银白长发");
    // 空作品没有章，看着的是最初：没有意图那一行，预览没有别的变化时不写，也不写写回哪里。
    await expect(bar.locator("[data-edit-intent]")).toHaveCount(0);
    await expect(bar).not.toContainText("改最初的值");
    await bar.getByRole("button", {name: "保存"}).click();
    await expect(fieldValue(page, "character.性格")).toHaveText("银白长发");

    await selectTab(entryPage(page).getByRole("tab", {name: "文字"}));
    await expect(entryPage(page).locator("[data-text-empty]")).toHaveText("还没有主文字");
    await entryPage(page).getByRole("button", {name: "开始写"}).click();
    // 进来是一个空的输入框；还没写字时标签没有未保存的圆点。
    await expect(textSource(page)).toHaveCount(1);
    await expect(tabDot(page)).toHaveCount(0);
    await focusSource(page);
    await page.keyboard.type("星瑕是第三魔法学院的一年级学生。");
    await expect(dirtyLabel(page)).toHaveText("有未提交的修改");
    await expect(tabDot(page)).toHaveCount(1);
    // “插入”把字段的写法放在光标处，焦点回到输入框、光标在写法后面：接着打的字跟在它后面。
    await entryPage(page).locator("[data-text-insert]").click();
    await page.getByRole("menuitem", {name: "人物 · 性格"}).click();
    await expect(sourceText(page)).toContainText('一年级学生。<V of="character.性格" />');
    await page.keyboard.type("是她的样子。");
    await expect(sourceText(page)).toContainText('<V of="character.性格" />是她的样子。');
    // 旁边的预览是输入框里的整篇照此刻的数据画的（author-ui 输出 48）：插入的写法显示成性格当时的值；预览里的值不是按钮。
    const preview = entryPage(page).locator("[data-text-preview]");
    await expect(preview).toContainText("一年级学生。银白长发是她的样子。");
    // 打字时不弹补全，回车总是换行（workbench/editor 输出 69）：新一行打“是”，文档里有以它开头的词（“是她的样子。”），弹了补全的话
    // 回车会把这一行换成那个词、不换行。看预览里的三行；再删回去。
    await page.keyboard.press("Enter");
    await page.keyboard.type("是");
    await page.keyboard.press("Enter");
    await page.keyboard.type("末");
    await expect(preview).toContainText("银白长发是她的样子。 是 末");
    for (let index = 0; index < 4; index += 1) await page.keyboard.press("Backspace");
    await expect(preview).not.toContainText("末");
    await expect(preview.getByRole("button")).toHaveCount(0);
    // 编辑区窄于 880 像素（1440 的窗口、两边的侧栏都开着）时预览排在输入框下面；窗口拉宽以后左右各半、预览栏在右边。
    const boxes = async () => ({source: (await textSource(page).boundingBox())!, preview: (await preview.boundingBox())!});
    await expect.poll(async () => {
        const now = await boxes();
        return now.preview.y >= now.source.y + now.source.height && now.preview.x < now.source.x + now.source.width;
    }).toBe(true);
    await page.setViewportSize({width: 1920, height: 900});
    await expect.poll(async () => {
        const now = await boxes();
        return now.preview.x >= now.source.x + now.source.width;
    }).toBe(true);
    // 预览栏吸顶的位置跟着页头的高度（条目页量出来交给它的）：页头底边再让开 12 像素。
    const headerHeight = Math.round((await entryPage(page).locator("header").boundingBox())!.height);
    await expect.poll(() => preview.evaluate((element) => getComputedStyle(element).top)).toBe(`${String(headerHeight + 12)}px`);
    const sourceBox = (await boxes()).source;
    // 源文字按条目的写法着色：花括号里的字段名（含中文）有自己的颜色（没着色的记号是 `mtk1`）。
    await expect(sourceToken(page, "character")).toHaveClass(/\bmtk(?!1\b)\d+\b/u);
    await expect(sourceToken(page, "性格")).toHaveClass(/\bmtk(?!1\b)\d+\b/u);
    // “预览”是开关：关掉以后没有预览栏，输入框占满；再打开又有。
    await entryPage(page).locator("[data-text-preview-toggle]").click();
    await expect(preview).toHaveCount(0);
    await expect.poll(async () => (await textSource(page).boundingBox())!.width).toBeGreaterThan(sourceBox.width + 100);
    await entryPage(page).locator("[data-text-preview-toggle]").click();
    await expect(preview).toContainText("银白长发是她的样子。");
    await page.setViewportSize({width: 1440, height: 900});
    await focusSource(page);
    // Tab 离开输入框（不留在框里缩进）；再回到输入框里。
    await page.keyboard.press("Tab");
    await expect(entryPage(page).locator("[data-text-source]:focus-within")).toHaveCount(0);
    await focusSource(page);
    // 焦点在代码输入框里按 Ctrl+S：经“保存”命令提交这一页，只提交一次。
    await page.keyboard.press("Control+s");
    // 提交以后在阅读视图里看结果：插入的写法显示成性格当时的值。
    await expect(entryPage(page).locator("[data-entry-text]")).toContainText("一年级学生。银白长发是她的样子。");
    await expect(page.locator("[data-notice-bar]")).toContainText("改星瑕的主文字");
    await expect(tabDot(page)).toHaveCount(0);
    await expect(entryPage(page).locator("[data-entry-text] [data-block]")).toHaveCount(1);

    await entryPage(page).getByRole("button", {name: "添加别名"}).click();
    await entryPage(page).locator("[data-entry-aliases] input").fill("小瑕");
    await page.keyboard.press("Enter");
    await expect(entryPage(page).locator("[data-entry-aliases]")).toContainText("小瑕");
});

test("主文字的稿（验收 16）：加一段，刷新以后标签带圆点、直接在编辑里、改的字还在；提交成一条修订、主文字是一块，从提示还原", async ({page}) => {
    await open(page);
    await openEntry(page, "人物", "星瑕");
    await selectTab(entryPage(page).getByRole("tab", {name: "文字"}));
    await entryPage(page).getByRole("button", {name: "编辑", exact: true}).click();
    await expect(textSource(page)).toHaveCount(1);
    // 空作品没有章、也没有计划：“在看”不出，编辑期间也就没有要锁的（有章时见本文件最后一条）。
    await expect(entryPage(page).locator("[data-view-point]")).toHaveCount(0);
    await focusSource(page);
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("她住在旧城区。");
    await expect(sourceText(page)).toContainText("她住在旧城区。");
    await expect(dirtyLabel(page)).toHaveText("有未提交的修改");
    await expect(entryPage(page).locator("[data-text-saved=\"saved\"]")).toBeVisible();

    await open(page);
    await expect(tabDot(page)).toHaveCount(1);
    await expect(textSource(page)).toHaveCount(1);
    await expect(sourceText(page)).toContainText("她住在旧城区。");
    // 暂存不是修订：还没提交，别的读取看不到。

    await entryPage(page).getByRole("button", {name: "提交", exact: true}).click();
    // 整篇写进一块：两段在同一块里。
    await expect(entryPage(page).locator("[data-entry-text] [data-block]")).toHaveCount(1);
    await expect(entryPage(page).locator("[data-entry-text]")).toContainText("她住在旧城区。");
    await expect(tabDot(page)).toHaveCount(0);
    const notice = page.locator("[data-notice-bar]");
    await expect(notice).toContainText("改星瑕的主文字");
    // 提示 6 秒后自己收起，指着它时不收（author-ui 输出 18）。
    await notice.hover();
    await notice.getByRole("button", {name: "还原"}).click();
    await expect(page.locator("[data-revert-dialog]")).toBeVisible();
    await dialog(page).getByRole("button", {name: "还原", exact: true}).click();
    await expect(page.locator("[data-revert-dialog]")).toHaveCount(0);
    await expect(entryPage(page).locator("[data-entry-text] [data-block]")).toHaveCount(1);
    await expect(entryPage(page).locator("[data-entry-text]")).not.toContainText("她住在旧城区。");
});

test("长的主文字左右分屏（author-ui 输出 48）：打字以后预览栏滚到光标那一段；页面往下滚时预览栏吸在页头下面，不被盖住也不伸出去", async ({page}) => {
    // 两边的侧栏都开着时，窗口要这么宽编辑区才放得下两栏。
    await page.setViewportSize({width: 1920, height: 900});
    await open(page);
    await openEntry(page, "人物", "星瑕");
    await selectTab(entryPage(page).getByRole("tab", {name: "文字"}));
    await entryPage(page).getByRole("button", {name: "编辑", exact: true}).click();
    await focusSource(page);
    await page.keyboard.press("Control+End");
    // 一次写进八十段：源文字与预览都比看得到的区域高。
    await page.keyboard.insertText(Array.from({length: 80}, (_item, index) => `\n\n第 ${String(index + 1)} 段的文字。`).join(""));
    const preview = entryPage(page).locator("[data-text-preview]");
    await expect(preview).toContainText("第 80 段的文字。");
    await page.keyboard.type("末尾接着写的字");
    const last = preview.locator("p", {hasText: "末尾接着写的字"});
    await expect(last).toHaveCount(1);
    // 预览栏自己滚到了光标所在的那一段：它在栏里看得到的范围内（排版有不到一个像素的小数，留 1 像素）。
    await expect.poll(async () => {
        const [pane, target] = [(await preview.boundingBox())!, (await last.boundingBox())!];
        return target.y >= pane.y - 1 && target.y + target.height <= pane.y + pane.height + 1;
    }).toBe(true);
    expect(await preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    // 页面往下滚（滚轮在输入框上：输入框不自己滚，交给页面）：预览栏吸在页头底边下面 12 像素，整栏都在视口里。
    await textSource(page).hover();
    await page.mouse.wheel(0, 1200);
    const header = entryPage(page).locator("header");
    await expect.poll(async () => {
        const [head, pane] = [(await header.boundingBox())!, (await preview.boundingBox())!];
        return [Math.round(pane.y - (head.y + head.height)), pane.y + pane.height <= 900];
    }).toEqual([12, true]);

    // 不留稿：放弃。
    await entryPage(page).locator("[data-text-discard]").click();
    await page.getByRole("alertdialog").getByRole("button", {name: "放弃", exact: true}).click();
    await expect(entryPage(page).locator("[data-entry-text]")).toBeVisible();
    await expect(tabDot(page)).toHaveCount(0);
});

test("别处也改了主文字（验收 16）：另一个窗口先提交，这边提交时出对照；选“现在的”就照别处的那一版", async ({page, browser}) => {
    await open(page);
    await openEntry(page, "人物", "星瑕");
    await selectTab(entryPage(page).getByRole("tab", {name: "文字"}));
    await entryPage(page).getByRole("button", {name: "编辑", exact: true}).click();
    await focusSource(page);
    await page.keyboard.press("Control+End");
    await page.keyboard.type("（这边改的）");
    await expect(entryPage(page).locator("[data-text-saved=\"saved\"]")).toBeVisible();

    // 另一份浏览器配置的窗口（稿是各自的）也改主文字并提交。
    const context = await browser.newContext({viewport: {width: 1440, height: 900}});
    const other = await context.newPage();
    try {
        await open(other);
        await openEntry(other, "人物", "星瑕");
        await selectTab(entryPage(other).getByRole("tab", {name: "文字"}));
        await entryPage(other).getByRole("button", {name: "编辑", exact: true}).click();
        await focusSource(other);
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

test("编辑器加载不了时（workbench/editor 输出 69）：输入框退回普通文本框，照样能改、能提交", async ({page}) => {
    // 拦掉 Monaco 的分包：这一页里它加载不了。
    await page.route("**/assets/editor.all-*.js", (route) => route.abort());
    await open(page);
    await openEntry(page, "人物", "星瑕");
    await selectTab(entryPage(page).getByRole("tab", {name: "文字"}));
    await entryPage(page).getByRole("button", {name: "编辑", exact: true}).click();
    const fallback = textSource(page).locator("[data-code-input-fallback]");
    await expect(fallback).toBeVisible();
    await expect(textSource(page).locator("[data-code-input-failure]")).toBeVisible();
    // 进编辑时焦点要进输入框：编辑器没建成，焦点落在退回的文本框里、光标在文末，直接打字。
    await expect(fallback).toBeFocused();
    await page.keyboard.type("（文本框里改的）");
    await expect(dirtyLabel(page)).toHaveText("有未提交的修改");
    // 退回的文本框里“插入”同样落在光标处。
    await entryPage(page).locator("[data-text-insert]").click();
    await page.getByRole("menuitem", {name: "人物 · 性格"}).click();
    await expect(fallback).toHaveValue(/（文本框里改的）<V of="character\.性格" \/>$/u);
    await expect(fallback).toBeFocused();
    await entryPage(page).getByRole("button", {name: "提交", exact: true}).click();
    await expect(entryPage(page).locator("[data-entry-text]")).toContainText("（文本框里改的）");
    await expect(tabDot(page)).toHaveCount(0);
    // 被拦掉的请求在控制台里各有一条“加载失败”，是这条用例自己造的。
    errors = errors.filter((message) => !message.includes("Failed to load resource") && !message.includes("Failed to fetch dynamically imported module"));
});

test("Agent 用 canon_write 建条目：批准后树里有它、读得到初值；条目页开着时 Agent 又改了，页上出 Agent 提示，从提示还原", async ({page}) => {
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

    // 一次写入建学院与挂在它下面的雾崎（`$代号` 引用同一批里新建的），带性格初值与一段主文字。
    await script({tool: "canon_write", args: {title: "建学院与雾崎", edits: [
        {op: "create", key: "school", name: "第三魔法学院", kind: "组织"},
        {op: "create", name: "雾崎", kind: "人物", parent: "$school", components: ["人物"], fields: {"人物.性格": "一身黑衣"}, text: "雾崎是星瑕的对头。"},
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
    // 有子条目的条目点行是打开它，展开只认点箭头（author-ui 输出 5）。
    await row(page, "第三魔法学院").locator("[data-tree-toggle]").click();
    await expect(row(page, "雾崎")).toBeVisible();
    await row(page, "雾崎").click();
    await expect(activeTabLabel(page)).toHaveText("雾崎");
    // 人物的条目先看人物分页（author-ui 输出 9），主文字在“文字”里。
    await selectTab(entryPage(page).getByRole("tab", {name: "文字"}));
    await expect(entryPage(page).locator("[data-entry-text]")).toContainText("星瑕的对头");
    await selectTab(entryPage(page).getByRole("tab", {name: "人物"}));
    await expect(fieldValue(page, "character.性格")).toHaveText("一身黑衣");

    // 雾崎的页开着：Agent 再建一个条目，页上另出一行 Agent 提示；从提示还原，那个条目没了。
    await script({tool: "canon_write", args: {title: "建校长", edits: [{op: "create", name: "校长", kind: "人物", parent: "第三魔法学院"}]}}, "又建了一个");
    await input.click();
    await page.keyboard.type("再建一个校长");
    await page.keyboard.press("Enter");
    await wizard.locator("[data-approval-decision='allow']").click();
    await expect(page.getByText("又建了一个")).toBeVisible();
    const notice = page.locator("[data-agent-notice]");
    await expect(notice).toContainText("建校长");
    await expect(row(page, "校长")).toBeVisible();
    await notice.getByRole("button", {name: "还原"}).click();
    await expect(page.locator("[data-revert-dialog]")).toBeVisible();
    await dialog(page).getByRole("button", {name: "还原", exact: true}).click();
    await expect(page.locator("[data-revert-dialog]")).toHaveCount(0);
    await expect(row(page, "校长")).toHaveCount(0);
    await expect(row(page, "雾崎")).toBeVisible();
    // 还原过的那一次不能再还原（再点会进“连同依赖一起还原”，等于把 Agent 的改动重做回来）；焦点回到同一个按钮上。
    const undo = notice.locator("[data-agent-undo]");
    await expect(undo).toHaveText("已还原");
    await expect(undo).toHaveAttribute("aria-disabled", "true");
    await expect(undo).toBeFocused();
});

test("稿开始的那一章被删以后刷新（输出 46）：页面照常读得出来，编辑里是稿里的整篇、不能改，只能放弃", async ({page}) => {
    // 给作品加一章：条目页缺省读这一章末尾，稿就开在这里。
    const binder = join(tmp, "Book", "manuscripts.binder");
    await mkdir(binder, {recursive: true});
    await writeFile(join(binder, "binder.xml"), '<binder nextId="2"><chapter id="1" title="入学"/></binder>');
    await open(page);
    await openEntry(page, "人物", "星瑕");
    const position = entryPage(page).locator("[data-view-point]");
    await expect(position).toContainText("第 1 章末尾");
    await selectTab(entryPage(page).getByRole("tab", {name: "文字"}));
    await entryPage(page).getByRole("button", {name: "编辑", exact: true}).click();
    await focusSource(page);
    await page.keyboard.press("Control+End");
    await page.keyboard.type("（第 1 章里改的）");
    await expect(entryPage(page).locator('[data-text-saved="saved"]')).toBeVisible();
    // 有没提交的主文字时“在看”锁着：根上有标记、按钮与前后一步都不可用（输出 46）。
    await expect(entryPage(page).locator("[data-view-point-locked]")).toHaveCount(1);
    await expect(position).toBeDisabled();
    await expect(entryPage(page).locator("[data-view-point-prev]")).toBeDisabled();
    await expect(entryPage(page).locator("[data-view-point-next]")).toBeDisabled();

    // 活页夹里拿掉这一章；等世界看到（没有章了，只剩“最初”一个位置，“在看”不再出）再刷新。
    await writeFile(join(binder, "binder.xml"), '<binder nextId="2"></binder>');
    await expect(position).toHaveCount(0);
    await open(page);
    await expect(tabDot(page)).toHaveCount(1);
    await expect(entryPage(page).locator("h1")).toHaveText("星瑕");
    await expect(entryPage(page).locator("[data-text-message]")).toContainText("开始编辑时的那一章已经不在了");
    await expect(textSource(page)).toHaveCount(1);
    await expect(textSource(page)).toContainText("（第 1 章里改的）");
    await expect(entryPage(page).locator("[data-text-insert]")).toHaveCount(0);
    await expect(entryPage(page).getByRole("button", {name: "提交", exact: true})).toBeDisabled();

    await entryPage(page).locator("[data-text-discard]").click();
    await page.getByRole("alertdialog").getByRole("button", {name: "放弃", exact: true}).click();
    await expect(entryPage(page).locator("[data-entry-text]")).toBeVisible();
    await expect(entryPage(page).locator("[data-entry-text]")).not.toContainText("（第 1 章里改的）");
    await expect(tabDot(page)).toHaveCount(0);
});
