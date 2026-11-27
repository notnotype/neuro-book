/**
 * 作者与 Agent 都能改设定（w00039 t37、t28）在真实 Chrome 与生产构建上的验收：从一部空作品起步，作者经设定视图的空状态新建人物、
 * 就地改字段、整篇写主文字（富文本与源文字两种模式，暂存、刷新后还在、提交、冲突时逐条选）与加别名（docs/specs/canon/author-ui.md，验收 16）；Agent 经
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

/** 富文本输入框（author-ui 输出 48）与它里面能打字的那一层：只认 `data-rich-input` 与 `contenteditable`，不猜编辑器的类名。 */
const richInput = (page: Page) => entryPage(page).locator("[data-rich-input]");
const richEditable = (page: Page) => entryPage(page).locator("[data-rich-input][contenteditable=\"true\"], [data-rich-input] [contenteditable=\"true\"]").first();
async function focusRich(page: Page): Promise<void> {
    await expect(richEditable(page)).toBeVisible();
    await richEditable(page).click();
}
/** 富文本里的小块（`kind`：value、calc、if、ref、image、raw）。 */
const chip = (page: Page, kind: string) => richInput(page).locator(`[data-entry-chip="${kind}"]`);

/** 状态行左区的“富文本 / 源文字”切换（`data-text-mode` 写当前的模式，输出 39）；按钮不猜角色，按字找。 */
const modeSwitch = (page: Page) => entryPage(page).locator("[data-text-mode]");
async function setMode(page: Page, mode: "rich" | "source"): Promise<void> {
    if ((await modeSwitch(page).getAttribute("data-text-mode")) !== mode) {
        await modeSwitch(page).getByText(mode === "rich" ? "富文本" : "源文字", {exact: true}).click();
    }
    await expect(modeSwitch(page)).toHaveAttribute("data-text-mode", mode);
    if (mode === "source") await expect(textSource(page).locator("[data-code-input-stage=\"ready\"], [data-code-input-fallback]").first()).toBeVisible();
    else await expect(richInput(page)).toBeVisible();
}

/**
 * “插入”菜单里插一个字段的值（输出 48）：菜单项可能直接列“设定组 · 字段”，也可能先点“值”再列字段，两种写法都认；
 * 菜单没出来之前不数菜单项，免得把“还没画出来”当成“没有‘值’这一项”。
 */
async function insertValue(page: Page, field: RegExp): Promise<void> {
    await entryPage(page).locator("[data-text-insert]").click();
    await expect(page.getByRole("menuitem").first()).toBeVisible();
    const group = page.getByRole("menuitem", {name: "值", exact: true});
    if ((await group.count()) > 0) await group.click();
    await page.getByRole("menuitem", {name: field}).click();
}
/** 小块的浮层（传送到 body，不在条目页里）：`kind` 同 `data-entry-chip`。里面的输入框与按钮按 `data-chip-field`、`data-chip-action` 找。 */
const chipPopover = (page: Page, kind: string) => page.locator(`[data-chip-popover="${kind}"]`);
const chipField = (page: Page, kind: string, field: string) => chipPopover(page, kind).locator(`[data-chip-field="${field}"]`);
const chipAction = (page: Page, kind: string, action: string) => chipPopover(page, kind).locator(`[data-chip-action="${action}"]`);
/** `{`、`@` 弹出的列表顶上的搜索框所在的块。 */
const chipMenu = (page: Page) => page.locator("[data-chip-menu]");
/** 源文字输入框里的整篇文字：Monaco 把空格画成不换行空格，换回普通空格再比。 */
const sourceNormalized = (page: Page) => sourceText(page).evaluate((element) => (element as HTMLElement).innerText.replaceAll(String.fromCharCode(0xa0), " "));
/** 进到星瑕的编辑，焦点在富文本里、光标在文末新起的一段。 */
async function editStarFlaw(page: Page): Promise<void> {
    await open(page);
    await openEntry(page, "人物", "星瑕");
    await selectTab(entryPage(page).getByRole("tab", {name: "文字"}));
    await entryPage(page).getByRole("button", {name: "编辑", exact: true}).click();
    await focusRich(page);
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
}
/** 不留稿：放弃，回到阅读视图。 */
async function discardDraft(page: Page): Promise<void> {
    await entryPage(page).locator("[data-text-discard]").click();
    await page.getByRole("alertdialog").getByRole("button", {name: "放弃", exact: true}).click();
    await expect(entryPage(page).locator("[data-entry-text]")).toBeVisible();
    await expect(tabDot(page)).toHaveCount(0);
}
const dirtyLabel = (page: Page) => entryPage(page).locator("[data-text-dirty]");
const tabDot = (page: Page) => page.locator("[data-editor-tab][aria-selected=\"true\"][data-editor-tab-dirty]");

test("作者从空作品起步：空状态里新建人物，条目页上改性格、从“写点什么…”开始写主文字并用 Ctrl+S 提交、加别名", async ({page}) => {
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
    await expect(entryPage(page).locator("[data-text-empty]")).toHaveText("写点什么…");
    await entryPage(page).getByRole("button", {name: "开始写"}).click();
    // 进来缺省是富文本、一个空的输入框；还没写字时标签没有未保存的圆点（author-ui 输出 39、48）。
    await expect(richInput(page)).toHaveCount(1);
    await expect(modeSwitch(page)).toHaveAttribute("data-text-mode", "rich");
    await expect(textSource(page)).toHaveCount(0);
    await expect(tabDot(page)).toHaveCount(0);
    // 编辑时没有预览（输出 48）：没有预览栏，也没有“预览”开关。
    await expect(entryPage(page).locator("[data-text-preview]")).toHaveCount(0);
    await expect(entryPage(page).locator("[data-text-preview-toggle]")).toHaveCount(0);
    await focusRich(page);
    await page.keyboard.type("星瑕是第三魔法学院的一年级学生。");
    await expect(dirtyLabel(page)).toHaveText("有未提交的修改");
    await expect(tabDot(page)).toHaveCount(1);
    // 验收 16：写第二段，从“插入”里选“值”的字段，光标处出现取值小块、显示此刻的值；焦点回到输入框、光标在小块后面：接着打的字跟在它后面。
    await page.keyboard.press("Enter");
    await page.keyboard.type("她的样子是");
    await expect(chip(page, "value")).toHaveCount(0);
    await insertValue(page, /性格$/u);
    await expect(chip(page, "value")).toHaveCount(1);
    await expect(chip(page, "value")).toContainText("银白长发");
    await page.keyboard.type("。");
    await expect(richInput(page)).toContainText("星瑕是第三魔法学院的一年级学生。");
    await expect(richInput(page)).toContainText("她的样子是");
    await expect(richInput(page)).toContainText("。");
    // 切到源文字：插入的值写成标签，按条目的写法着色（花括号里的字段名含中文，没着色的记号是 `mtk1`）。
    await setMode(page, "source");
    await expect(sourceText(page)).toContainText('<V of="character.性格" />');
    await expect(sourceToken(page, "character")).toHaveClass(/\bmtk(?!1\b)\d+\b/u);
    await expect(sourceToken(page, "性格")).toHaveClass(/\bmtk(?!1\b)\d+\b/u);
    // 打字时不弹补全，回车总是换行（workbench/editor 输出 69）：新一行打“是”，文档里有以它开头的词（“是”开头的字），弹了补全的话
    // 回车会把这一行换成那个词、不换行。数行：打“是”回车“末”多出两行；再删回去。
    await focusSource(page);
    await page.keyboard.press("Control+End");
    const lines = textSource(page).locator(".view-line");
    const linesBefore = await lines.count();
    await page.keyboard.press("Enter");
    await page.keyboard.type("是");
    await page.keyboard.press("Enter");
    await page.keyboard.type("末");
    await expect(lines).toHaveCount(linesBefore + 2);
    for (let index = 0; index < 4; index += 1) await page.keyboard.press("Backspace");
    await expect(lines).toHaveCount(linesBefore);
    // Tab 离开输入框（不留在框里缩进）；再回到输入框里。
    await page.keyboard.press("Tab");
    await expect(entryPage(page).locator("[data-text-source]:focus-within")).toHaveCount(0);
    await focusSource(page);
    // 焦点在代码输入框里按 Ctrl+S：经“保存”命令提交这一页，只提交一次。
    await page.keyboard.press("Control+s");
    // 提交以后在阅读视图里看结果：两段，插入的值显示成性格当时的值。
    await expect(entryPage(page).locator("[data-entry-text]")).toContainText("一年级学生。");
    await expect(entryPage(page).locator("[data-entry-text]")).toContainText("她的样子是银白长发。");
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
    await expect(richInput(page)).toHaveCount(1);
    // 空作品没有章、也没有计划：“在看”不出，编辑期间也就没有要锁的（有章时见本文件最后一条）。
    await expect(entryPage(page).locator("[data-view-point]")).toHaveCount(0);
    await focusRich(page);
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("她住在旧城区。");
    await expect(richInput(page)).toContainText("她住在旧城区。");
    await expect(dirtyLabel(page)).toHaveText("有未提交的修改");
    await expect(entryPage(page).locator("[data-text-saved=\"saved\"]")).toBeVisible();

    await open(page);
    await expect(tabDot(page)).toHaveCount(1);
    // 刷新以后直接进编辑，模式回到缺省的富文本（输出 45）。
    await expect(richInput(page)).toHaveCount(1);
    await expect(modeSwitch(page)).toHaveAttribute("data-text-mode", "rich");
    await expect(richInput(page)).toContainText("她住在旧城区。");
    // 暂存不是修订：还没提交，别的读取看不到。

    await entryPage(page).getByRole("button", {name: "提交", exact: true}).click();
    // 整篇写进一块：几段在同一块里。
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

test("进编辑不改版面（author-ui 输出 39、48）：没有预览栏，内容列不放宽，左侧分页的排法与阅读时相同", async ({page}) => {
    // 取几种窗口宽度：旧版编辑要排两栏预览，放得下时内容列放宽、放不下时分页换成横排，新版阅读与编辑应当一样。
    const widths = [1440, 1680, 1920];
    await open(page);
    await openEntry(page, "人物", "星瑕");
    await selectTab(entryPage(page).getByRole("tab", {name: "文字"}));
    await expect(entryPage(page).locator("[data-entry-text]")).toBeVisible();
    // 分页条排成竖排还是横排看第一、第二个分页的相对位置；内容列看分页内容的宽度。
    const layout = async () => {
        const tabs = entryPage(page).getByRole("tab");
        const [first, second, panel, list] = [
            await tabs.nth(0).boundingBox(),
            await tabs.nth(1).boundingBox(),
            await entryPage(page).locator("[role='tabpanel']").boundingBox(),
            await entryPage(page).getByRole("tablist").first().boundingBox(),
        ];
        // 宽度刚变、版面还在重排时量不到：交回 null，调用方继续等。
        if (first === null || second === null || panel === null || list === null) return null;
        return {vertical: second.y > first.y + first.height / 2, panelWidth: Math.round(panel.width), listX: Math.round(list.x), listWidth: Math.round(list.width)};
    };
    const reading = new Map<number, Awaited<ReturnType<typeof layout>>>();
    for (const width of widths) {
        await page.setViewportSize({width, height: 900});
        // 宽度变了以后版面要等一帧才跟上：两次量到同样的才算稳。
        let last = await layout();
        await expect.poll(async () => {
            const now = await layout();
            const same = now !== null && JSON.stringify(now) === JSON.stringify(last);
            last = now;
            return same;
        }).toBe(true);
        reading.set(width, last);
    }

    await entryPage(page).getByRole("button", {name: "编辑", exact: true}).click();
    await expect(richInput(page)).toHaveCount(1);
    await expect(entryPage(page).locator("[data-text-preview]")).toHaveCount(0);
    await expect(entryPage(page).locator("[data-text-preview-toggle]")).toHaveCount(0);
    for (const width of widths) {
        await page.setViewportSize({width, height: 900});
        await expect.poll(layout, {message: `视口宽 ${String(width)} 时编辑的版面应与阅读时相同`}).toEqual(reading.get(width));
    }
    // 切到源文字也一样：输入框占满内容列，没有第二栏。
    await setMode(page, "source");
    await expect(entryPage(page).locator("[data-text-preview]")).toHaveCount(0);
    await expect.poll(layout).toEqual(reading.get(widths.at(-1)!));

    // 没有改动：按钮写“取消”（没有东西可丢时不叫“放弃”），回到阅读视图，不问。
    await entryPage(page).locator("[data-text-cancel]").click();
    await expect(entryPage(page).locator("[data-entry-text]")).toBeVisible();
    await expect(tabDot(page)).toHaveCount(0);
});

test("模式切换（author-ui 输出 39、48）：切到源文字再切回内容不变；源文字里写坏一个标签，切回富文本被拦下、写原因，输入框下面写第几行，改好以后切得回去", async ({page}) => {
    await open(page);
    await openEntry(page, "人物", "星瑕");
    await selectTab(entryPage(page).getByRole("tab", {name: "文字"}));
    await entryPage(page).getByRole("button", {name: "编辑", exact: true}).click();
    await expect(modeSwitch(page)).toHaveAttribute("data-text-mode", "rich");
    await focusRich(page);
    await page.keyboard.press("Control+End");
    await page.keyboard.type("（切换用）");
    await expect(richInput(page)).toContainText("（切换用）");
    // 前面的用例留下的主文字里有一个取值小块：往返以后文字与小块都要在。
    await expect(chip(page, "value")).toHaveCount(1);
    const chipCount = await richInput(page).locator("[data-entry-chip]").count();
    const richText = () => richEditable(page).innerText();
    const before = await richText();

    await setMode(page, "source");
    await expect(sourceText(page)).toContainText("（切换用）");
    await expect(sourceText(page)).toContainText('<V of="character.性格" />');
    await expect(entryPage(page).locator("[data-source-problem]")).toHaveCount(0);
    await setMode(page, "rich");
    await expect(richInput(page).locator("[data-entry-chip]")).toHaveCount(chipCount);
    await expect(chip(page, "value")).toContainText("银白长发");
    await expect.poll(richText).toBe(before);
    await expect(entryPage(page).locator("[data-mode-problem]")).toHaveCount(0);

    // 在源文字里改过再切回来：改的字带回富文本。
    await setMode(page, "source");
    await focusSource(page);
    await page.keyboard.press("Control+End");
    await page.keyboard.type("（源文字里加的）");
    await setMode(page, "rich");
    await expect(richInput(page)).toContainText("（源文字里加的）");

    // 写坏一个标签：少了收尾的 `<V of="character.性格"`（rendering 输出 1 的 tag-malformed）。整篇是“第一段。”、空行、坏标签：坏的在第 3 行。
    // 用 insertText 一次写入，免得 Monaco 替引号和括号自动补全。
    await setMode(page, "source");
    await focusSource(page);
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText('第一段。\n\n<V of="character.性格"');
    const problem = entryPage(page).locator("[data-source-problem]");
    await expect(problem).toBeVisible();
    await expect(problem).toHaveAttribute("data-line", "3");
    await expect(problem).toHaveAttribute("data-column", /^\d+$/u);
    // 切回富文本：被拦下，模式没变、原因写在切换旁边；输入框里的字还在。
    await modeSwitch(page).getByText("富文本", {exact: true}).click();
    await expect(entryPage(page).locator("[data-mode-problem]")).toBeVisible();
    await expect(modeSwitch(page)).toHaveAttribute("data-text-mode", "source");
    await expect(richInput(page)).toHaveCount(0);
    await expect(sourceText(page)).toContainText('<V of="character.性格"');

    // 改好以后：输入框下面的原因消失，切得回去。
    await focusSource(page);
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText("改好了。");
    await expect(problem).toHaveCount(0);
    await setMode(page, "rich");
    await expect(entryPage(page).locator("[data-mode-problem]")).toHaveCount(0);
    await expect(richInput(page)).toContainText("改好了。");

    // 不留稿：放弃。
    await entryPage(page).locator("[data-text-discard]").click();
    await page.getByRole("alertdialog").getByRole("button", {name: "放弃", exact: true}).click();
    await expect(entryPage(page).locator("[data-entry-text]")).toBeVisible();
    await expect(tabDot(page)).toHaveCount(0);
});

test("状态行（author-ui 输出 32、39）：切换模式时右区的放弃与提交不动；390 宽时状态行是两行，第一行状态与放弃、提交，第二行左区", async ({page}) => {
    await open(page);
    await openEntry(page, "人物", "星瑕");
    await selectTab(entryPage(page).getByRole("tab", {name: "文字"}));
    await entryPage(page).getByRole("button", {name: "编辑", exact: true}).click();
    await focusRich(page);
    await page.keyboard.press("Control+End");
    await page.keyboard.type("（状态行用）");
    // 有改动：“放弃”“提交”都在、状态写已暂存；等暂存写完，免得量到状态文字变宽的中间态。
    await expect(entryPage(page).locator('[data-text-saved="saved"]')).toBeVisible();
    const submit = entryPage(page).getByRole("button", {name: "提交", exact: true});
    const discard = entryPage(page).locator("[data-text-discard]");
    const spots = async () => ({submit: await submit.boundingBox(), discard: await discard.boundingBox()});
    const frames = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

    const rich = await spots();
    expect(rich.submit).not.toBeNull();
    expect(rich.discard).not.toBeNull();
    // 左区的控件在两种模式下不全相同，右区不动：切完以后输入框画好了再量，再等两帧确认不是量在过渡中间。
    await setMode(page, "source");
    await frames();
    await expect.poll(spots).toEqual(rich);
    await frames();
    expect(await spots()).toEqual(rich);
    await setMode(page, "rich");
    await frames();
    await expect.poll(spots).toEqual(rich);
    await frames();
    expect(await spots()).toEqual(rich);

    // 宽屏时左区的“插入”与右区的“提交”在同一行（状态行按自己的宽度换行，1440 视口两侧侧栏都开时内容列放不下，用 1920）。
    await page.setViewportSize({width: 1920, height: 900});
    const centerY = async (locator: Locator) => {
        const box = (await locator.boundingBox())!;
        return box.y + box.height / 2;
    };
    const insert = entryPage(page).locator("[data-text-insert]");
    await expect.poll(async () => Math.abs((await centerY(insert)) - (await centerY(submit)))).toBeLessThan(8);

    // 390 宽：固定两行。
    await page.setViewportSize({width: 390, height: 844});
    const rowOne = entryPage(page).locator('[data-text-bar-row="1"]');
    const rowTwo = entryPage(page).locator('[data-text-bar-row="2"]');
    await expect(entryPage(page).locator("[data-text-bar-row]")).toHaveCount(2);
    await expect(rowOne.getByRole("button", {name: "提交", exact: true})).toBeVisible();
    await expect(rowOne.locator("[data-text-discard]")).toBeVisible();
    await expect(rowOne.locator('[data-text-saved="saved"]')).toBeVisible();
    await expect(rowTwo.locator("[data-text-insert]")).toBeVisible();
    await expect(rowTwo.locator("[data-text-mode]")).toBeVisible();
    await expect.poll(async () => (await rowTwo.boundingBox())!.y > (await rowOne.boundingBox())!.y + (await rowOne.boundingBox())!.height - 1).toBe(true);
    // 切到源文字，两行的排法不变。
    await setMode(page, "source");
    await expect(entryPage(page).locator("[data-text-bar-row]")).toHaveCount(2);
    await expect(rowOne.getByRole("button", {name: "提交", exact: true})).toBeVisible();
    await expect(rowTwo.locator("[data-text-insert]")).toBeVisible();

    // 不留稿：放弃。
    await discard.click();
    await page.getByRole("alertdialog").getByRole("button", {name: "放弃", exact: true}).click();
    await expect(entryPage(page).locator("[data-entry-text]")).toBeVisible();
    await expect(tabDot(page)).toHaveCount(0);
});

test("计算小块（author-ui 输出 48）：用 { 插一个计算，点它改式子、应用以后值变了；写坏式子应用不落、写原因、输入框里的字还在", async ({page}) => {
    await editStarFlaw(page);
    await page.keyboard.type("算一个：");
    await expect(chip(page, "calc")).toHaveCount(0);
    await page.keyboard.type("{");
    await expect(chipMenu(page)).toBeVisible();
    await page.getByRole("option", {name: /计算/u}).click();
    // 新插的计算先在浮层里写，应用以后才进文档。
    const popover = chipPopover(page, "calc");
    await expect(popover).toBeVisible();
    await expect(chip(page, "calc")).toHaveCount(0);
    await chipField(page, "calc", "expr").fill("character.性格 == '银白长发' ? 1 : 2");
    await chipAction(page, "calc", "apply").click();
    await expect(popover).toHaveCount(0);
    const calc = chip(page, "calc");
    await expect(calc).toHaveCount(1);
    await expect(calc).toHaveAttribute("data-chip-state", "value");
    await expect(calc).toContainText("1");

    // 点小块开浮层，改式子、应用：小块的值变了。
    await calc.click();
    await expect(popover).toBeVisible();
    await expect(calc).toHaveAttribute("aria-expanded", "true");
    const expr = chipField(page, "calc", "expr");
    await expect(expr).toHaveValue("character.性格 == '银白长发' ? 1 : 2");
    await expr.fill("character.性格 == '银白长发' ? 3 : 4");
    await chipAction(page, "calc", "apply").click();
    await expect(popover).toHaveCount(0);
    await expect(calc).toHaveAttribute("data-chip-state", "value");
    await expect(calc).toContainText("3");

    // 写坏式子：应用不落，浮层不关、写原因，输入框里的字还在，小块还是 3。
    await calc.click();
    await expect(popover).toBeVisible();
    await expr.fill("character.性格 == ");
    await chipAction(page, "calc", "apply").click();
    const problem = popover.locator("[data-chip-problem]");
    await expect(problem).toBeVisible();
    await expect(problem).not.toHaveText("");
    await expect(popover).toBeVisible();
    await expect(expr).toHaveValue("character.性格 == ");
    await expect(calc).toContainText("3");
    // 自己关上浮层（Esc）：没应用的字丢掉，文档里还是应用过的那一版。
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(calc).toContainText("3");
    await setMode(page, "source");
    await expect.poll(() => sourceNormalized(page)).toContain(`<V expr="character.性格 == '银白长发' ? 3 : 4" />`);
    expect(await sourceNormalized(page)).not.toContain("character.性格 == \" />");
    await discardDraft(page);
});

test("条件小块（author-ui 输出 48）：用 { 插一个条件，点它改一支的文字、加“否则如果”，应用以后切到源文字看整篇写法是一行", async ({page}) => {
    await editStarFlaw(page);
    await page.keyboard.type("{");
    await expect(chipMenu(page)).toBeVisible();
    await page.getByRole("option", {name: /条件/u}).click();
    const popover = chipPopover(page, "if");
    await expect(popover).toBeVisible();
    // 新条件是“如果”加“否则”两支，判断写在第 0 支。
    await expect(chipField(page, "if", "test-0")).toBeVisible();
    await expect(chipField(page, "if", "branch-0")).toBeVisible();
    await expect(chipField(page, "if", "branch-1")).toBeVisible();
    await expect(chipField(page, "if", "test-1")).toHaveCount(0);
    await chipField(page, "if", "test-0").fill("1 == 1");
    await chipField(page, "if", "branch-0").fill("甲");
    await chipField(page, "if", "branch-1").fill("乙");
    await chipAction(page, "if", "apply").click();
    await expect(popover).toHaveCount(0);
    const condition = chip(page, "if");
    await expect(condition).toHaveCount(1);
    // 判断成立：生效的是第 0 支，正文里只画这一支。
    await expect(condition).toHaveAttribute("data-chip-state", "value");
    await expect(condition).toHaveAttribute("data-chip-branch", "0");
    // 没生效的支在 DOM 里但是隐藏的：按看得见的字（innerText）判断。
    await expect(condition).toContainText("甲", {useInnerText: true});
    await expect(condition).not.toContainText("乙", {useInnerText: true});

    // 点开改：第 0 支的文字、加一个“否则如果”（加在“否则”之前，原来的“否则”成了第 2 支）。
    await condition.click();
    await expect(popover).toBeVisible();
    await expect(chipField(page, "if", "branch-0")).toHaveValue("甲");
    await chipField(page, "if", "branch-0").fill("丙");
    await chipAction(page, "if", "add-branch").click();
    await expect(chipField(page, "if", "test-1")).toBeVisible();
    await expect(chipField(page, "if", "branch-2")).toHaveValue("乙");
    await chipField(page, "if", "test-1").fill("1 == 2");
    await chipField(page, "if", "branch-1").fill("丁");
    await chipAction(page, "if", "apply").click();
    await expect(popover).toHaveCount(0);
    await expect(condition).toHaveCount(1);
    await expect(condition).toContainText("丙", {useInnerText: true});

    // 切到源文字：整个条件在一行里。判断写得短、视口放宽，一行排得下（输入框会自动折行，折开的两段是两个视觉行）。
    await page.setViewportSize({width: 1920, height: 900});
    await setMode(page, "source");
    const written = `<If test="1 == 1">丙<ElseIf test="1 == 2" />丁<Else />乙</If>`;
    await expect.poll(() => sourceNormalized(page)).toContain(written);
    // 同一行：包含开标签的那一行也含闭标签。
    const lines = textSource(page).locator(".view-line");
    await expect(lines.filter({hasText: "<If test="})).toHaveCount(1);
    expect(await lines.filter({hasText: "<If test="}).first().evaluate((element) => (element as HTMLElement).innerText.replaceAll(String.fromCharCode(0xa0), " "))).toContain("</If>");
    await discardDraft(page);
});

test("键盘（author-ui 输出 30、48）：光标在取值小块前面按右方向键选中它，Enter 开浮层，Escape 关上、焦点回到编辑区、小块仍选中", async ({page}) => {
    await open(page);
    await openEntry(page, "人物", "星瑕");
    await selectTab(entryPage(page).getByRole("tab", {name: "文字"}));
    await entryPage(page).getByRole("button", {name: "编辑", exact: true}).click();
    await focusRich(page);
    // 最后一段是“她的样子是”加取值小块加“。”：到段首，右移五个字停在小块前面。
    await expect(chip(page, "value")).toHaveCount(1);
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Home");
    const selected = richInput(page).locator(".ProseMirror-selectednode");
    await expect(selected).toHaveCount(0);
    for (let step = 0; step < 5; step += 1) await page.keyboard.press("ArrowRight");
    // 还没越过小块：它没被选中。再按一下：先选中它，不是直接跨过去。
    await expect(selected).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveAttribute("data-entry-chip", "value");

    await page.keyboard.press("Enter");
    const popover = chipPopover(page, "value");
    await expect(popover).toBeVisible();
    await expect(chip(page, "value")).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(chip(page, "value")).toHaveAttribute("aria-expanded", "false");
    // 焦点回到编辑区，小块仍是选中的。
    await expect.poll(() => richInput(page).evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await expect(selected).toHaveCount(1);
    // 没有改动：按钮是“取消”，直接回到阅读视图。
    await entryPage(page).locator("[data-text-cancel]").click();
    await expect(entryPage(page).locator("[data-entry-text]")).toBeVisible();
    await expect(tabDot(page)).toHaveCount(0);
});

test("{ 与 @（author-ui 输出 48）：{ 弹字段列表，打字筛到一个、回车插入取值小块；{ 再 Esc 补回一个字面的 {；@ 弹条目列表，选一个插入条目引用", async ({page}) => {
    await editStarFlaw(page);
    await page.keyboard.type("插字段：");
    const valuesBefore = await chip(page, "value").count();
    await page.keyboard.type("{");
    await expect(chipMenu(page)).toBeVisible();
    // 列表弹出以后焦点交给顶上的搜索框，接着打的字落在那里、不进正文。
    await expect(chipMenu(page).locator("input")).toBeFocused();
    await page.keyboard.type("性格");
    await expect(page.getByRole("option")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(chipMenu(page)).toHaveCount(0);
    await expect(chip(page, "value")).toHaveCount(valuesBefore + 1);
    await expect(chip(page, "value").last()).toContainText("银白长发");
    await expect(richEditable(page)).not.toContainText("性格");

    // 插进来的小块此刻是选中的（接着打字会替掉它，见本文件最后一条）：右移一下，光标落在它后面。
    await page.keyboard.press("ArrowRight");
    // 再打一个 {，按 Esc：列表关上，正文里多一个字面的 {，焦点回到编辑区，没有多出小块。
    await expect(richEditable(page)).not.toContainText("{");
    await page.keyboard.type("{");
    await expect(chipMenu(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(chipMenu(page)).toHaveCount(0);
    await expect(richEditable(page)).toContainText("{");
    await expect(chip(page, "value")).toHaveCount(valuesBefore + 1);
    await expect.poll(() => richInput(page).evaluate((element) => element.contains(document.activeElement))).toBe(true);

    // @：条目列表，打字找到星瑕，选了插入条目引用。
    await expect(chip(page, "ref")).toHaveCount(0);
    await page.keyboard.type("@");
    await expect(chipMenu(page)).toBeVisible();
    await expect(chipMenu(page).locator("input")).toBeFocused();
    await page.keyboard.type("星瑕");
    const option = page.getByRole("option", {name: /星瑕/u}).first();
    await expect(option).toBeVisible();
    await option.click();
    await expect(chipMenu(page)).toHaveCount(0);
    await expect(chip(page, "ref")).toHaveCount(1);
    await expect(chip(page, "ref")).toContainText("星瑕");
    await discardDraft(page);
});

test("别处也改了主文字（验收 16）：另一个窗口先提交，这边提交时出对照；选“现在的”就照别处的那一版", async ({page, browser}) => {
    await open(page);
    await openEntry(page, "人物", "星瑕");
    await selectTab(entryPage(page).getByRole("tab", {name: "文字"}));
    await entryPage(page).getByRole("button", {name: "编辑", exact: true}).click();
    await focusRich(page);
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
        await focusRich(other);
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
    // 缺省进富文本（不用 Monaco）；源文字模式才用代码输入框，它加载不了时退回普通文本框。
    await expect(richInput(page)).toHaveCount(1);
    await setMode(page, "source");
    const fallback = textSource(page).locator("[data-code-input-fallback]");
    await expect(fallback).toBeVisible();
    await expect(textSource(page).locator("[data-code-input-failure]")).toBeVisible();
    // 点进退回的文本框、光标移到文末，直接打字。
    await fallback.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("（文本框里改的）");
    await expect(dirtyLabel(page)).toHaveText("有未提交的修改");
    // 退回的文本框里“插入”同样落在光标处。
    await insertValue(page, /性格$/u);
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
    await focusRich(page);
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
    // 只读的稿按这个标签记下的模式（缺省富文本）画：输入框只读、小块不能改（输出 46、48）。
    await expect(richInput(page)).toHaveCount(1);
    await expect(richInput(page)).toHaveAttribute("data-readonly", /.*/u);
    await expect(richInput(page)).toContainText("（第 1 章里改的）");
    await expect(entryPage(page).locator("[data-text-insert]")).toHaveCount(0);
    await expect(entryPage(page).getByRole("button", {name: "提交", exact: true})).toBeDisabled();

    await entryPage(page).locator("[data-text-discard]").click();
    await page.getByRole("alertdialog").getByRole("button", {name: "放弃", exact: true}).click();
    await expect(entryPage(page).locator("[data-entry-text]")).toBeVisible();
    await expect(entryPage(page).locator("[data-entry-text]")).not.toContainText("（第 1 章里改的）");
    await expect(tabDot(page)).toHaveCount(0);
});

test("{ 插入以后接着打字（author-ui 输出 48）：刚插的取值小块留着，打的字跟在它后面，同“插入”菜单插入以后一样", async ({page}) => {
    await editStarFlaw(page);
    await page.keyboard.type("先写：");
    const before = await chip(page, "value").count();
    await page.keyboard.type("{");
    await expect(chipMenu(page).locator("input")).toBeFocused();
    await page.keyboard.type("性格");
    await expect(page.getByRole("option")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(chip(page, "value")).toHaveCount(before + 1);
    // 不挪光标直接打字：小块还在，字在它后面。
    await page.keyboard.type("再写");
    await expect(richEditable(page)).toContainText("再写");
    await expect(chip(page, "value")).toHaveCount(before + 1);
    await discardDraft(page);
});
