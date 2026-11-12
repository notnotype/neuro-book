/**
 * Markdown 里的批注（docs/specs/workbench/markdown-editing.md 输出 28–38、验收 11–22）：本机 Chrome 的真实键盘、鼠标与输入法
 * 事件，产品页、真实文件服务；判据是看得见的卡片、页边的位置与尺寸、过渡中的计算样式，和保存后磁盘上的原文。数据操作与状态机的规则由
 * `comments.dom.test.ts`、`MarkdownControl.dom.test.ts` 逐条测，这里只留要真实浏览器的：排版位置、宽度、真实的键位与输入法、动画。
 */

import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

// 窗口宽：编辑区放得下页边（版心加页边约 1032px 起）需要关掉右栏，或把视口拉得很宽。
test.use({viewport: {width: 2400, height: 1400}});

let tmp = "";
let projectDir = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "markdown-comments");
    projectDir = join(tmp, "Book");
    const stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await mkdir(join(projectDir, "notes"), {recursive: true});
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const item = (page: Page, address: string) => page.locator(`[data-explorer-row="${address}"]`);
const activeGroup = (page: Page) => page.locator("[data-editor-group-active]");
const activeHead = (page: Page) => page.locator("[data-editor-group-head-active]");
const prose = (page: Page) => activeGroup(page).locator("[data-editor-kind=\"nbook.editor.markdown\"]:visible [data-editor-prose]");
const disk = (path: string): Promise<string> => readFile(join(projectDir, path), "utf8");
/** 开着的浮层卡片（关上的要等退场动画结束才摘掉，按 `data-state` 判断）。 */
const popoverCard = (page: Page) => page.locator("[data-anchored-popover][data-state=\"open\"] [data-markdown-comment-layer]");
const marginItems = (page: Page) => page.locator("[data-markdown-comment-margin] .markdown-comment-margin__item");
const marginSwitch = (page: Page) => activeHead(page).locator("[data-title-action-key=\"own:comment-margin\"]");

async function openFile(page: Page, path: string, text: string): Promise<void> {
    await mkdir(dirname(join(projectDir, path)), {recursive: true});
    await writeFile(join(projectDir, path), text);
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    const name = path.split("/").at(-1) as string;
    await expect(async () => {
        const folder = item(page, "project://notes");
        if (await folder.getAttribute("aria-expanded") !== "true") await folder.click();
        await item(page, `project://${path}`).dblclick({timeout: 3000});
        await expect(activeHead(page).locator("[data-editor-tab]").filter({hasText: name})).toBeVisible({timeout: 3000});
    }).toPass();
    await expect(prose(page)).toBeVisible();
}

/** 等两帧：说“不出现”的断言前先让本该稍后才出现的东西有机会出现，免得它在回归时因为还没到而立即通过。 */
const settle = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

/** 点到被批注的文字上（波浪线的 `<comment>` 元素）：光标进批注。点击不弹卡片（输出 30）。 */
async function clickComment(page: Page, text: string, focus = true): Promise<void> {
    await prose(page).locator("comment", {hasText: text}).first().click();
    // 只读的正文拿不到焦点。
    if (focus) await expect(prose(page)).toBeFocused();
}

/** 按住 Ctrl 把鼠标停在被批注的文字上，等“看”卡片弹出来（悬停的，输出 30）。 */
async function hoverComment(page: Page, text: string): Promise<void> {
    await prose(page).locator("comment", {hasText: text}).first().hover({modifiers: ["Control"]});
    await expect(popoverCard(page)).toBeVisible();
}

/** 被批注的文字后面的小符号（输出 38）：紧跟在 `<comment>` 元素之后。 */
const markerAfter = (page: Page, text: string) => prose(page).locator("comment", {hasText: text}).first().locator("xpath=following-sibling::*[1][@data-comment-marker]");

/** 点这段批注后面的小符号，等“看”卡片弹出来（点开的）。 */
async function openByMarker(page: Page, text: string): Promise<void> {
    await markerAfter(page, text).click();
    await expect(popoverCard(page)).toBeVisible();
}

/** 断言“没有弹出来”：没有计时器，卡片的渲染要几帧；没有别的可观察信号能说明一个没发生的事，等一会再看。 */
const waitPastHover = (page: Page): Promise<void> =>
    // test-lint-allow fixed-wait: 断言“没有弹出来”，没有可等的信号，等过渲染的几帧再看
    page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 500)));

/**
 * 等浏览器的选区是 `length` 个字、编辑器也跟上了：ProseMirror 经 `selectionchange` 异步同步选区，按键之后立刻按快捷键或粘贴，它可能还停在上一个字
 * （机器忙时漏选最后一个字）。
 */
async function syncedSelection(page: Page, length: number): Promise<void> {
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().length ?? 0)).toBe(length);
    await settle(page);
}

/** 选中第一段里的第 `from` 到 `to` 个字：Home 之后按键，鼠标选区会受选区菜单与行内元素干扰。 */
async function selectInFirstParagraph(page: Page, from: number, to: number): Promise<void> {
    await prose(page).locator("p").first().click();
    await expect(prose(page)).toBeFocused();
    await page.keyboard.press("Home");
    for (let index = 0; index < from; index += 1) await page.keyboard.press("ArrowRight");
    for (let index = from; index < to; index += 1) await page.keyboard.press("Shift+ArrowRight");
    await syncedSelection(page, to - from);
}

const TWO = "甲乙丙丁戊己庚辛\n\n壬<comment body=\"第一条\">癸子丑</comment>寅卯辰巳午<comment body=\"第二条\">未申酉</comment>戌亥\n";
/** 页边按段排槽位：三条批注在三段里（第二条的下一段没有批注，第一条的下一段有），各一个槽位。 */
const PARAGRAPHS = "甲乙丙丁戊己庚辛\n\n壬<comment body=\"第一条\">癸子丑</comment>寅卯辰巳午\n\n未<comment body=\"第二条\">申酉</comment>戌亥\n\n这一段没有批注。\n\n末<comment body=\"第三条\">尾巴</comment>段\n";

test.describe("加、改、删（验收 11、12）", () => {
    test("Ctrl+Alt+M 在选区下方开卡片，打两行意见、Ctrl+Enter 保存，文件里是 body，撤销后没有批注", async ({page}) => {
        await openFile(page, "notes/add.md", "甲乙丙丁戊\n\n己庚辛\n");
        await selectInFirstParagraph(page, 1, 3);
        await page.keyboard.press("Control+Alt+KeyM");
        const field = popoverCard(page).locator("textarea");
        await expect(field).toBeFocused();
        // 原来的选区仍画成选中的样子（卡片里的输入拿走了正文的焦点）。
        await expect(prose(page).locator(".nb-markdown-held-selection")).toHaveText("乙丙");
        // 卡片的左边缘对齐选区的左边，在选区这一行的下面（输出 30）。
        const held = await prose(page).locator(".nb-markdown-held-selection").boundingBox();
        const written = await popoverCard(page).boundingBox();
        if (held === null || written === null) throw new Error("取不到位置");
        expect(Math.abs(written.x - held.x)).toBeLessThanOrEqual(4);
        expect(written.y).toBeGreaterThanOrEqual(held.y + held.height - 2);
        await page.keyboard.type("第一行");
        await page.keyboard.press("Enter");
        await page.keyboard.type("第二行");
        await page.keyboard.press("Control+Enter");
        await expect(prose(page).locator("comment")).toHaveText("乙丙");
        await expect(prose(page)).toBeFocused();
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/add.md")).toContain("甲<comment body=\"第一行&#10;第二行\">乙丙</comment>丁戊");
        await page.keyboard.press("Control+z");
        await expect(prose(page).locator("comment")).toHaveCount(0);
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/add.md")).toBe("甲乙丙丁戊\n\n己庚辛\n");
    });

    test("选区菜单与右键菜单里也有“批注”入口；没有选区时右键里的“添加批注”置灰", async ({page}) => {
        await openFile(page, "notes/entries.md", "甲乙丙丁戊\n");
        await selectInFirstParagraph(page, 0, 2);
        await page.locator("[data-markdown-selection-menu]").getByRole("button", {name: "添加批注"}).click();
        await expect(popoverCard(page).locator("textarea")).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(popoverCard(page)).toHaveCount(0);
        await prose(page).locator("p").first().click({button: "right"});
        await expect(page.getByRole("menuitem", {name: /添加批注/})).toBeDisabled();
        await page.keyboard.press("Escape");
    });

    test("点符号出卡片：改意见、删除都写回文件；卡片按钮不夺走正文的焦点", async ({page}) => {
        await openFile(page, "notes/edit.md", TWO);
        await openByMarker(page, "癸子丑");
        await expect(popoverCard(page)).toContainText("第一条");
        await expect(popoverCard(page)).toContainText("第 1 条，共 2 条");
        await popoverCard(page).getByRole("button", {name: "编辑批注"}).click();
        const field = popoverCard(page).locator("textarea");
        await expect(field).toBeFocused();
        await field.fill("改过的意见");
        await page.keyboard.press("Control+Enter");
        await expect(popoverCard(page)).toContainText("改过的意见");
        await expect(prose(page)).toBeFocused();
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/edit.md")).toContain("<comment body=\"改过的意见\">癸子丑</comment>");
        await expect.poll(() => disk("notes/edit.md")).toContain("<comment body=\"第二条\">未申酉</comment>");

        await popoverCard(page).getByRole("button", {name: "删除批注"}).click();
        await expect(prose(page).locator("comment")).toHaveCount(1);
        await expect(prose(page)).toBeFocused();
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/edit.md")).toBe("甲乙丙丁戊己庚辛\n\n壬癸子丑寅卯辰巳午<comment body=\"第二条\">未申酉</comment>戌亥\n");
    });

    test("空意见保存是取消，不删除原有的批注", async ({page}) => {
        await openFile(page, "notes/empty.md", TWO);
        await openByMarker(page, "癸子丑");
        await popoverCard(page).getByRole("button", {name: "编辑批注"}).click();
        await popoverCard(page).locator("textarea").fill("  ");
        await page.keyboard.press("Control+Enter");
        await expect(prose(page).locator("comment")).toHaveCount(2);
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/empty.md")).toBe(TWO);
    });

    test("块菜单的“批注”（验收 19）：段落写成行内批注，表格与代码块写成块批注，保存后读得回、撤销一步", async ({page}) => {
        await openFile(page, "notes/block-menu.md", "段落一\n\n| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n\n```\ncode\n```\n");
        const gutter = activeGroup(page).locator("[data-markdown-gutter]");
        const commentViaBlockMenu = async (hoverText: string, body: string): Promise<void> => {
            await prose(page).getByText(hoverText, {exact: false}).first().hover();
            await expect(gutter).toBeVisible();
            await gutter.getByRole("button", {name: "块菜单"}).click();
            await page.getByRole("menuitem", {name: /批注/}).click();
            await expect(popoverCard(page).locator("textarea")).toBeFocused();
            await page.keyboard.type(body);
            await page.keyboard.press("Control+Enter");
            await expect(popoverCard(page).locator("textarea")).toHaveCount(0);
        };
        await commentViaBlockMenu("段落一", "段落的意见");
        await expect(prose(page).locator("comment")).toHaveText("段落一");
        await commentViaBlockMenu("甲", "表格的意见");
        await expect(prose(page).locator(".nb-comment-block")).toHaveCount(1);
        await commentViaBlockMenu("code", "代码块的意见");
        await expect(prose(page).locator(".nb-comment-block")).toHaveCount(2);
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/block-menu.md")).toContain("<comment body=\"段落的意见\">段落一</comment>");
        await expect.poll(() => disk("notes/block-menu.md")).toMatch(/<comment body="表格的意见">\n\| 甲 \| 乙 \|[\s\S]*\n<\/comment>/);
        await expect.poll(() => disk("notes/block-menu.md")).toMatch(/<comment body="代码块的意见">\n```\ncode\n```\n<\/comment>/);
        // 空的段落没有文字可批注：块菜单里置灰。
        await page.keyboard.press("Control+End");
        await page.keyboard.press("Control+z");
        await page.keyboard.press("Control+z");
        await page.keyboard.press("Control+z");
        await expect(prose(page).locator("comment, .nb-comment-block")).toHaveCount(0);
    });
});

test.describe("打开方式（验收 13、21）", () => {
    test("按住 Ctrl 悬停：卡片立刻出现（不等）；先停在批注上再按下 Ctrl 同样出；松开 Ctrl 不收；不按 Ctrl 的悬停与点击不出；点击之后同一次悬停按 Ctrl 也不弹", async ({page}) => {
        await openFile(page, "notes/ctrl-hover.md", TWO);
        const comment = await prose(page).locator("comment", {hasText: "癸子丑"}).boundingBox();
        if (comment === null) throw new Error("取不到位置");
        // 没按 Ctrl：停在批注上不出。
        await page.mouse.move(comment.x + 3, comment.y + comment.height / 2);
        await waitPastHover(page);
        await expect(popoverCard(page)).toHaveCount(0);
        // 指针还停在批注上，按下 Ctrl：立刻出（没有计时器，上限比旧的 400 毫秒悬停计时短）。
        await page.keyboard.down("Control");
        await expect(popoverCard(page)).toBeVisible({timeout: 300});
        await expect(popoverCard(page)).toContainText("第一条");
        await page.keyboard.up("Control");
        await waitPastHover(page);
        await expect(popoverCard(page)).toBeVisible();
        // 指针移开：按 Ctrl 悬停出来的卡片收起。
        await page.mouse.move(5, 5);
        await expect(popoverCard(page)).toHaveCount(0);
        // 按住 Ctrl 再移上去：移到批注上就出。
        await page.keyboard.down("Control");
        await page.mouse.move(comment.x + comment.width - 3, comment.y + comment.height / 2);
        await expect(popoverCard(page)).toBeVisible({timeout: 300});
        await page.keyboard.up("Control");
        await page.mouse.move(5, 5);
        await expect(popoverCard(page)).toHaveCount(0);
        // 没按 Ctrl 点批注（光标进批注，是要编辑）：不出；指针还停在上面，之后按 Ctrl（复制、粘贴之类）也不弹，免得打扰编辑。
        await page.mouse.move(comment.x + 3, comment.y + comment.height / 2);
        await page.mouse.down();
        await page.mouse.up();
        await page.keyboard.down("Control");
        await waitPastHover(page);
        await expect(popoverCard(page)).toHaveCount(0);
        await page.keyboard.up("Control");
    });

    test("按住 Ctrl 点批注文字：弹出点开的卡片，光标与选区不动、不会选中整个块；指针离开也不收，Esc 收起", async ({page}) => {
        await openFile(page, "notes/ctrl-click.md", TWO);
        await prose(page).locator("p").first().click();
        await page.keyboard.press("Home");
        await expect(prose(page)).toBeFocused();
        const caret = (): Promise<string> => page.evaluate(() => `${window.getSelection()?.anchorNode?.textContent}@${window.getSelection()?.anchorOffset}`);
        const before = await caret();
        await prose(page).locator("comment", {hasText: "癸子丑"}).first().click({modifiers: ["Control"]});
        await expect(popoverCard(page)).toBeVisible();
        expect(await caret()).toBe(before);
        await expect(prose(page).locator(".ProseMirror-selectednode")).toHaveCount(0);
        await expect(prose(page)).toBeFocused();
        await page.mouse.move(5, 5);
        await waitPastHover(page);
        await expect(popoverCard(page)).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(popoverCard(page)).toHaveCount(0);
    });

    test("小符号：每条批注末尾一个，同处结束的合成一个带条数；点它出卡片，光标与焦点不动，指针离开不收，再点同一个收起", async ({page}) => {
        await openFile(page, "notes/markers.md", "甲<comment body=\"一\">乙</comment>丙\n\n丁<comment body=\"外\">戊<comment body=\"内\">己</comment></comment>庚\n");
        const markers = prose(page).locator("[data-comment-marker]");
        await expect(markers).toHaveCount(2);
        await expect(markers.nth(0)).not.toHaveAttribute("data-count", /.+/);
        await expect(markers.nth(1)).toHaveAttribute("data-count", "2");
        // 符号紧接在批注文字后面、占约一个字宽，在这一行里看得见。
        const first = await markers.nth(0).boundingBox();
        const comment = await prose(page).locator("comment", {hasText: "乙"}).first().boundingBox();
        if (first === null || comment === null) throw new Error("取不到位置");
        expect(first.x).toBeGreaterThanOrEqual(comment.x + comment.width - 1);
        expect(first.width).toBeGreaterThan(8);
        await prose(page).locator("p").nth(1).click();
        await expect(prose(page)).toBeFocused();
        const caret = (): Promise<string> => page.evaluate(() => `${window.getSelection()?.anchorNode?.textContent}@${window.getSelection()?.anchorOffset}`);
        const before = await caret();
        await markers.nth(0).click();
        await expect(popoverCard(page)).toBeVisible();
        await expect(popoverCard(page)).toContainText("一");
        expect(await caret()).toBe(before);
        await expect(prose(page)).toBeFocused();
        await page.mouse.move(5, 5);
        await waitPastHover(page);
        await expect(popoverCard(page)).toBeVisible();
        await markers.nth(0).click();
        await expect(popoverCard(page)).toHaveCount(0);
        // 条数 2 的符号：卡片里是同处结束的两条。
        await markers.nth(1).click();
        await expect(popoverCard(page).locator("[data-markdown-comment-body]")).toHaveText(["外", "内"]);
        // 点正文别处收起。
        await prose(page).locator("p").first().click();
        await expect(popoverCard(page)).toHaveCount(0);
    });

    test("小符号不进文件与撤销历史；页边打开后不画，关掉又出来；只读文档也画、点了出卡片", async ({page}) => {
        await openFile(page, "notes/markers-file.md", "甲<comment body=\"一\">乙</comment>丙\n");
        await expect(prose(page).locator("[data-comment-marker]")).toHaveCount(1);
        await prose(page).locator("p").first().click();
        await page.keyboard.press("End");
        await page.keyboard.type("字");
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/markers-file.md")).toBe("甲<comment body=\"一\">乙</comment>丙字\n");
        await page.keyboard.press("Control+z");
        await expect(prose(page).locator("p").first()).toContainText("甲乙丙");
        await expect(prose(page).locator("p").first()).not.toContainText("字");
        await activeHead(page).hover();
        await marginSwitch(page).click();
        await expect(marginItems(page)).toHaveCount(1);
        await expect(prose(page).locator("[data-comment-marker]:visible")).toHaveCount(0);
        await marginSwitch(page).click();
        await expect(marginItems(page)).toHaveCount(0);
        await expect(prose(page).locator("[data-comment-marker]:visible")).toHaveCount(1);
        await rm(join(projectDir, "notes/markers-file.md"));
        await expect(activeGroup(page)).toContainText(/已被|删除|只读/);
        await prose(page).locator("[data-comment-marker]").click();
        await expect(popoverCard(page)).toContainText("一");
        await expect(popoverCard(page).getByRole("button", {name: "编辑批注"})).toHaveCount(0);
    });

    test("上一条、下一条跳到那条的开头；Esc 收起；点击与方向键走进批注、在批注里打字都不弹", async ({page}) => {
        await openFile(page, "notes/enter.md", TWO);
        await openByMarker(page, "癸子丑");
        await popoverCard(page).getByRole("button", {name: "下一条批注"}).click();
        await expect(popoverCard(page)).toContainText("第二条");
        await expect(popoverCard(page)).toContainText("第 2 条，共 2 条");
        await expect(popoverCard(page).getByRole("button", {name: "下一条批注"})).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(popoverCard(page)).toHaveCount(0);
        // 点进批注、方向键、打字：不弹（没有按 Ctrl，也没有点符号）。
        await clickComment(page, "癸子丑");
        await page.keyboard.press("ArrowRight");
        await page.keyboard.type("字");
        await page.keyboard.press("ArrowLeft");
        await waitPastHover(page);
        await expect(popoverCard(page)).toHaveCount(0);
    });

    test("按 Ctrl 悬停出来的卡片：点击（没按 Ctrl）收起，同一次悬停不再弹；鼠标移开再回来才弹；移向卡片途中经过空白不收", async ({page}) => {
        await openFile(page, "notes/hover.md", TWO);
        await hoverComment(page, "癸子丑");
        const comment = await prose(page).locator("comment", {hasText: "癸子丑"}).boundingBox();
        if (comment === null) throw new Error("取不到位置");
        await page.mouse.down();
        await page.mouse.up();
        await expect(popoverCard(page)).toHaveCount(0);
        await page.keyboard.down("Control");
        await page.mouse.move(comment.x + comment.width / 2 + 1, comment.y + comment.height / 2);
        await waitPastHover(page);
        await expect(popoverCard(page)).toHaveCount(0);
        await page.mouse.move(5, 5);
        await page.mouse.move(comment.x + 4, comment.y + comment.height / 2);
        await expect(popoverCard(page)).toBeVisible();
        await page.keyboard.up("Control");
        // 移向卡片：先走到批注与卡片之间的空白，再进卡片；卡片不收。
        const card = await popoverCard(page).boundingBox();
        if (card === null) throw new Error("取不到卡片");
        await page.mouse.move(card.x + card.width / 2, comment.y + comment.height + 2, {steps: 3});
        await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2, {steps: 3});
        await waitPastHover(page);
        await expect(popoverCard(page)).toBeVisible();
        await page.mouse.move(5, 5);
        await expect(popoverCard(page)).toHaveCount(0);
    });

    test("卡片的左边缘对齐批注在这一行的起点、贴在这一行下面，不居中于鼠标；点符号开的也一样", async ({page}) => {
        await openFile(page, "notes/align.md", TWO);
        const comment = await prose(page).locator("comment", {hasText: "癸子丑"}).boundingBox();
        if (comment === null) throw new Error("取不到位置");
        // 按住 Ctrl、鼠标停在批注的右半边：卡片仍然左对齐批注的起点。
        await page.keyboard.down("Control");
        await page.mouse.move(comment.x + comment.width - 3, comment.y + comment.height / 2);
        await expect(popoverCard(page)).toBeVisible();
        await page.keyboard.up("Control");
        const card = await popoverCard(page).boundingBox();
        if (card === null) throw new Error("取不到卡片");
        expect(Math.abs(card.x - comment.x)).toBeLessThanOrEqual(4);
        expect(card.y).toBeGreaterThanOrEqual(comment.y + comment.height - 2);
        expect(card.y).toBeLessThan(comment.y + comment.height + 30);
        await page.keyboard.press("Escape");
        await expect(popoverCard(page)).toHaveCount(0);
        await page.mouse.move(5, 5);
        await markerAfter(page, "癸子丑").click();
        await expect(popoverCard(page)).toBeVisible();
        const fromMarker = await popoverCard(page).boundingBox();
        if (fromMarker === null) throw new Error("取不到卡片");
        expect(Math.abs(fromMarker.x - comment.x)).toBeLessThanOrEqual(4);
        expect(fromMarker.y).toBeGreaterThanOrEqual(comment.y + comment.height - 2);
    });

    test("真实的输入法组字：在批注里组字、结束都不弹卡片", async ({page}) => {
        await openFile(page, "notes/ime.md", TWO);
        await clickComment(page, "癸子丑");
        const client = await page.context().newCDPSession(page);
        await client.send("Input.imeSetComposition", {text: "ni", selectionStart: 2, selectionEnd: 2});
        await client.send("Input.imeSetComposition", {text: "你", selectionStart: 1, selectionEnd: 1});
        await client.send("Input.insertText", {text: "你"});
        await expect(prose(page)).toContainText("你");
        await waitPastHover(page);
        await expect(popoverCard(page)).toHaveCount(0);
    });

    test("块批注：卡片在鼠标所在那一行的下面，不管在块里哪一段，左边对齐这一行", async ({page}) => {
        await openFile(page, "notes/block.md", "前文\n\n<comment body=\"整块的意见\">\n\n第一段\n\n第二段\n\n第三段\n\n</comment>\n\n后文\n");
        await prose(page).locator("p", {hasText: "第三段"}).hover({modifiers: ["Control"]});
        await expect(popoverCard(page)).toContainText("整块的意见");
        const third = await prose(page).locator("p", {hasText: "第三段"}).boundingBox();
        const card = await popoverCard(page).boundingBox();
        if (third === null || card === null) throw new Error("取不到位置");
        // 卡片贴在鼠标所在的这一行下面（放得下时在下面），左边与这一行的文字对齐。
        expect(card.y).toBeGreaterThanOrEqual(third.y + third.height - 2);
        expect(Math.abs(card.x - third.x)).toBeLessThanOrEqual(4);
        await page.keyboard.press("Escape");
        // 块批注的小符号在块里最后一个文字之后：点它，卡片贴在最后一行下面。
        await prose(page).locator("[data-comment-marker]").click();
        await expect(popoverCard(page)).toContainText("整块的意见");
        const last = await prose(page).locator("p", {hasText: "第三段"}).boundingBox();
        const fromMarker = await popoverCard(page).boundingBox();
        if (last === null || fromMarker === null) throw new Error("取不到位置");
        expect(fromMarker.y).toBeGreaterThanOrEqual(last.y + last.height - 2);
    });

    test("重叠的批注：一张卡片里上下排每一条", async ({page}) => {
        await openFile(page, "notes/stack.md", "甲<comment body=\"外层\">乙<comment body=\"内层\">丙丁</comment></comment>戊\n");
        await hoverComment(page, "丙丁");
        await expect(popoverCard(page).locator("[data-markdown-comment-body]")).toHaveText(["外层", "内层"]);
    });
});

test.describe("替换批注文字（验收 18）", () => {
    const SENTENCE = "她抬头<comment body=\"节奏\">看了他一眼</comment>，转身。\n";
    /** 选中批注里的字：Home 之后按键，鼠标选区会受选区菜单与行内元素干扰。 */
    async function selectComment(page: Page, from: number, to: number): Promise<void> {
        await prose(page).locator("p").first().click();
        await expect(prose(page)).toBeFocused();
        await page.keyboard.press("Home");
        for (let index = 0; index < 3 + from; index += 1) await page.keyboard.press("ArrowRight");
        for (let index = from; index < to; index += 1) await page.keyboard.press("Shift+ArrowRight");
        await syncedSelection(page, to - from);
    }

    test("真实的按键：选中整句批注文字再打字，新字仍在批注里，意见不丢；撤销一步回来", async ({page}) => {
        await openFile(page, "notes/replace-keys.md", SENTENCE);
        await selectComment(page, 0, 5);
        await page.keyboard.type("abc");
        await expect(prose(page).locator("comment")).toHaveText("abc");
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/replace-keys.md")).toBe("她抬头<comment body=\"节奏\">abc</comment>，转身。\n");
        await page.keyboard.press("Control+z");
        await expect(prose(page).locator("comment")).toHaveText("看了他一眼");
    });

    test("选中后一半再打字：新字在批注里", async ({page}) => {
        await openFile(page, "notes/replace-part.md", SENTENCE);
        await selectComment(page, 3, 5);
        await page.keyboard.type("x");
        await expect(prose(page).locator("comment")).toHaveText("看了他x");
    });

    test("批注末尾打字在批注外；选区从批注中间一直选到批注后面的字再打字，新字也不在批注里", async ({page}) => {
        await openFile(page, "notes/replace-edge.md", SENTENCE);
        await prose(page).locator("p").first().click();
        await expect(prose(page)).toBeFocused();
        await page.keyboard.press("Home");
        for (let index = 0; index < 3 + 5; index += 1) await page.keyboard.press("ArrowRight");
        await page.keyboard.type("y");
        await expect(prose(page).locator("comment")).toHaveText("看了他一眼");
        await expect(prose(page).locator("p").first()).toContainText("看了他一眼y，");
        await page.keyboard.press("Home");
        for (let index = 0; index < 3 + 3; index += 1) await page.keyboard.press("ArrowRight");
        for (let index = 0; index < 4; index += 1) await page.keyboard.press("Shift+ArrowRight");
        await syncedSelection(page, 4);
        await page.keyboard.type("z");
        await expect(prose(page).locator("comment")).toHaveText("看了他");
    });

    test("一次提交一段字（输入法提交、粘贴这类）：选中整句后提交，新字仍在批注里", async ({page}) => {
        await openFile(page, "notes/replace-ime.md", SENTENCE);
        await selectComment(page, 0, 5);
        // CDP 的 `Input.imeSetComposition` 不会替换选区（Chrome 里真实的输入法会），所以这里只验证提交这一步：`Input.insertText` 替换选区。
        const client = await page.context().newCDPSession(page);
        await client.send("Input.insertText", {text: "你好"});
        await expect(prose(page).locator("comment")).toHaveText("你好");
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/replace-ime.md")).toBe("她抬头<comment body=\"节奏\">你好</comment>，转身。\n");
    });

    test("粘贴一段文字替换整句：新字仍在批注里，撤销一步回来", async ({page, context}) => {
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        await openFile(page, "notes/replace-paste.md", SENTENCE);
        await page.evaluate(() => navigator.clipboard.writeText("粘贴来的字"));
        await selectComment(page, 0, 5);
        await page.keyboard.press("Control+v");
        await expect(prose(page).locator("comment")).toHaveText("粘贴来的字");
        await page.keyboard.press("Control+z");
        await expect(prose(page).locator("comment")).toHaveText("看了他一眼");
    });

    test("Backspace 删掉整句：批注一起没了，撤销回来", async ({page}) => {
        await openFile(page, "notes/replace-delete.md", SENTENCE);
        await selectComment(page, 0, 5);
        await page.keyboard.press("Backspace");
        await expect(prose(page).locator("comment")).toHaveCount(0);
        await page.keyboard.press("Control+z");
        await expect(prose(page).locator("comment")).toHaveText("看了他一眼");
    });
});

/** 页边里各槽位的几何：卡片面（可见的）与槽位（占位）的位置和高度。 */
const slotBoxes = (page: Page) => marginItems(page).evaluateAll((elements) => elements.map((element) => {
    const surface = element.querySelector(".markdown-comment-margin__surface") as HTMLElement;
    const face = surface.getBoundingClientRect();
    const slot = element.getBoundingClientRect();
    return {y: face.y, x: face.x, width: face.width, height: face.height, slotY: slot.y, slotHeight: slot.height, mode: (element as HTMLElement).dataset.mode ?? "", expanded: (element as HTMLElement).hasAttribute("data-expanded")};
}));
const paragraphBox = (page: Page, text: string) => prose(page).locator("p", {hasText: text}).first().boundingBox();
const actionsOf = (page: Page, index: number) => marginItems(page).nth(index).locator(".markdown-comment-card__actions");
const surfaceOf = (page: Page, index: number) => marginItems(page).nth(index).locator(".markdown-comment-margin__surface");

test.describe("页边（验收 15、22）", () => {
    test("标签条的开关带条数；打开后稿纸左移，批注按段排槽位：顶边对着这一段的顶边、不小于段高、不高于两倍段高、互不遮盖；重开页面开关还开着", async ({page}) => {
        await openFile(page, "notes/margin.md", PARAGRAPHS);
        await activeHead(page).hover();
        await expect(marginSwitch(page)).toHaveText("3");
        await expect(marginSwitch(page)).toHaveAttribute("aria-pressed", "false");
        const before = await prose(page).boundingBox();
        await marginSwitch(page).click();
        await expect(marginSwitch(page)).toHaveAttribute("aria-pressed", "true");
        await expect(marginItems(page)).toHaveCount(3);
        await expect(marginItems(page).nth(2)).toHaveAttribute("data-ready", "");
        const after = await prose(page).boundingBox();
        if (before === null || after === null) throw new Error("取不到位置");
        expect(after.x).toBeLessThan(before.x - 100);
        // 稿纸平移与槽位的位置过渡结束之后量：槽位顶边对着各自这一段的顶边。
        const texts = ["癸子丑", "申酉", "尾巴"];
        await expect.poll(async () => {
            const boxes = await slotBoxes(page);
            const gaps: number[] = [];
            for (const [index, text] of texts.entries()) {
                const paragraph = await paragraphBox(page, text);
                gaps.push(paragraph === null ? 999 : Math.abs((boxes[index] as {y: number}).y - paragraph.y));
            }
            return Math.max(...gaps);
        }).toBeLessThanOrEqual(2);
        const boxes = await slotBoxes(page);
        for (const [index, text] of texts.entries()) {
            const paragraph = await paragraphBox(page, text);
            const box = boxes[index];
            if (paragraph === null || box === undefined) throw new Error("取不到位置");
            // 不小于这一段的高度（减去槽位之间的空），不高于两倍段高。
            expect(box.height).toBeGreaterThanOrEqual(paragraph.height - 6);
            expect(box.height).toBeLessThanOrEqual(2 * paragraph.height + 1);
            expect(box.x).toBeGreaterThanOrEqual(after.x + after.width - 2);
        }
        // 下一段有批注的槽位不借别人的地方：不高于这一段的高度（一行的短段放一行意见时稍高，最多一行）。
        const first = await paragraphBox(page, "癸子丑");
        if (first === null) throw new Error("取不到位置");
        expect((boxes[0] as {height: number}).height).toBeLessThanOrEqual(first.height + 40);
        // 互不遮盖。
        for (let index = 1; index < boxes.length; index += 1) expect((boxes[index] as {y: number}).y).toBeGreaterThanOrEqual((boxes[index - 1] as {y: number; height: number}).y + (boxes[index - 1] as {height: number}).height - 1);
        // 光标进批注：不出浮层，这一段是当前；各槽位的位置与尺寸不变，没有左边框一类的侧边色条（输出 33）。
        const geometry = async (): Promise<Array<[number, number, number]>> => (await slotBoxes(page)).map((box) => [Math.round(box.y), Math.round(box.width), Math.round(box.height)]);
        const idle = await geometry();
        await clickComment(page, "申酉");
        await expect(popoverCard(page)).toHaveCount(0);
        await expect(marginItems(page).nth(1)).toHaveAttribute("data-mode", "current");
        await expect(marginItems(page).nth(0)).toHaveAttribute("data-mode", "idle");
        await expect.poll(geometry).toEqual(idle);
        const borders = await marginItems(page).evaluateAll((elements) => elements.map((element) => {
            const style = getComputedStyle(element.querySelector(".markdown-comment-margin__surface") as HTMLElement);
            return [style.borderLeftWidth === style.borderTopWidth, style.borderLeftStyle === style.borderTopStyle, style.borderLeftColor === style.borderTopColor];
        }));
        expect(borders.flat().every(Boolean)).toBe(true);
        // 当前的卡片编辑、删除按钮显现，其余的不画；没有“第 i 条，共 n 条”。
        await expect(actionsOf(page, 1)).toBeVisible();
        await expect(actionsOf(page, 0)).toBeHidden();
        await expect(marginItems(page).nth(1)).not.toContainText("共 3 条");
        // 按作品记住：刷新页面后开关还是开着，页边还在。
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
        await expect(prose(page)).toBeVisible();
        await activeHead(page).hover();
        await expect(marginSwitch(page)).toHaveAttribute("aria-pressed", "true");
        await expect(marginItems(page)).toHaveCount(3);
        await marginSwitch(page).click();
        await expect(marginItems(page)).toHaveCount(0);
    });

    test("同一段几条批注合用一个槽位：右上角 1/3，点箭头切换并让光标到那条开头，光标走进别条时槽位自动切过去", async ({page}) => {
        await openFile(page, "notes/slot-pager.md", "一<comment body=\"甲意见\">二</comment><comment body=\"乙意见\">三</comment><comment body=\"丙意见\">四</comment>五\n");
        await activeHead(page).hover();
        await marginSwitch(page).click();
        await expect(marginItems(page)).toHaveCount(1);
        const slot = marginItems(page).first();
        await expect(slot.locator("[data-markdown-comment-pager]")).toHaveText("1/3");
        await expect(slot.locator("[data-markdown-comment-body]")).toHaveText("甲意见");
        await slot.getByRole("button", {name: "下一条批注"}).click();
        await expect(slot.locator("[data-markdown-comment-body]")).toHaveText("乙意见");
        await expect(slot.locator("[data-markdown-comment-pager]")).toHaveText("2/3");
        await expect(prose(page).locator(".nb-comment-current")).toHaveText("三");
        await expect(prose(page)).toBeFocused();
        // 光标走进第三条的文字：槽位自动切过去；走出来之后仍显示它。
        for (let index = 0; index < 3; index += 1) await page.keyboard.press("ArrowRight");
        await expect(slot.locator("[data-markdown-comment-pager]")).toHaveText("3/3");
        await expect(slot.locator("[data-markdown-comment-body]")).toHaveText("丙意见");
        await expect(slot.getByRole("button", {name: "下一条批注"})).toBeDisabled();
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("ArrowRight");
        await expect(slot).toHaveAttribute("data-mode", "idle");
        await expect(slot.locator("[data-markdown-comment-body]")).toHaveText("丙意见");
        await marginSwitch(page).click();
    });

    test("展开：点意见被省略的卡片，卡片在原处向下长到全文、槽位占位与别的槽位纹丝不动；Esc 收回；点编辑同样浮着写", async ({page}) => {
        const LONG = "这条意见很长很长，页边里放不下它：".repeat(6);
        await openFile(page, "notes/expand.md", `壬<comment body="${LONG}">癸子丑</comment>寅卯辰巳午\n\n未<comment body="第二条">申酉</comment>戌亥\n`);
        await activeHead(page).hover();
        await marginSwitch(page).click();
        await expect(marginItems(page)).toHaveCount(2);
        await expect(marginItems(page).nth(1)).toHaveAttribute("data-ready", "");
        await expect.poll(async () => (await slotBoxes(page)).length).toBe(2);
        const folded = await slotBoxes(page);
        // 意见被省略（行数限制）：正文里放不下的部分被裁掉。
        const clipped = await marginItems(page).first().locator("[data-markdown-comment-body]").evaluate((element) => element.scrollHeight > element.clientHeight + 1);
        expect(clipped).toBe(true);
        await marginItems(page).first().locator("[data-markdown-comment-body]").click();
        await expect(marginItems(page).first()).toHaveAttribute("data-expanded", "");
        await expect.poll(async () => (await slotBoxes(page))[0]?.height ?? 0).toBeGreaterThan((folded[0] as {height: number}).height + 20);
        const open = await slotBoxes(page);
        expect(open[0]?.slotHeight).toBe(folded[0]?.slotHeight);
        expect(open[0]?.slotY).toBe(folded[0]?.slotY);
        expect(open[1]?.y).toBe(folded[1]?.y);
        expect(open[1]?.height).toBe(folded[1]?.height);
        // 展开的卡片盖在后面的槽位上面（浮着）。
        const stacked = await page.evaluate(() => {
            const first = document.querySelectorAll("[data-markdown-comment-margin] .markdown-comment-margin__item")[0] as HTMLElement;
            return Number.parseInt(getComputedStyle(first).zIndex, 10);
        });
        expect(stacked).toBeGreaterThan(0);
        await page.keyboard.press("Escape");
        await expect(marginItems(page).first()).not.toHaveAttribute("data-expanded", "");
        await expect.poll(async () => Math.round((await slotBoxes(page))[0]?.height ?? 0)).toBe(Math.round((folded[0] as {height: number}).height));
        // 点编辑：同样浮着写，别的槽位不动；Esc 放弃后收回。
        await marginItems(page).first().getByRole("button", {name: "编辑批注"}).click({force: true});
        await expect(marginItems(page).first().locator("textarea")).toBeFocused();
        await expect(marginItems(page).first()).toHaveAttribute("data-mode", "write");
        const writing = await slotBoxes(page);
        expect(writing[0]?.slotHeight).toBe(folded[0]?.slotHeight);
        expect(writing[1]?.y).toBe(folded[1]?.y);
        await page.keyboard.press("Escape");
        await expect(marginItems(page).first().locator("textarea")).toHaveCount(0);
        await expect.poll(async () => Math.round((await slotBoxes(page))[0]?.height ?? 0)).toBe(Math.round((folded[0] as {height: number}).height));
        await marginSwitch(page).click();
    });

    test("窗口变窄页边退回浮层与小符号，开关仍是按下的；够宽了页边回来，稿纸不被裁掉", async ({page}) => {
        await openFile(page, "notes/narrow.md", PARAGRAPHS);
        await activeHead(page).hover();
        await marginSwitch(page).click();
        await expect(marginItems(page)).toHaveCount(3);
        await expect(prose(page).locator("[data-comment-marker]:visible")).toHaveCount(0);
        await page.setViewportSize({width: 1300, height: 1400});
        await expect(marginItems(page)).toHaveCount(0);
        await expect(prose(page).locator("[data-comment-marker]:visible")).toHaveCount(3);
        await activeHead(page).hover();
        await expect(marginSwitch(page)).toHaveAttribute("aria-pressed", "true");
        await openByMarker(page, "癸子丑");
        await expect(popoverCard(page)).toContainText("第一条");
        await page.setViewportSize({width: 2400, height: 1400});
        await expect(marginItems(page)).toHaveCount(3);
        const group = await activeGroup(page).boundingBox();
        const paper = await prose(page).boundingBox();
        if (group === null || paper === null) throw new Error("取不到位置");
        expect(paper.x).toBeGreaterThanOrEqual(group.x);
        await activeHead(page).hover();
        await marginSwitch(page).click();
    });

    test("页边里加批注：待写的槽位顶边对着选区所在的段，保存后成为一条并进这一段", async ({page}) => {
        await openFile(page, "notes/margin-add.md", PARAGRAPHS);
        await activeHead(page).hover();
        await marginSwitch(page).click();
        await expect(marginItems(page)).toHaveCount(3);
        await selectInFirstParagraph(page, 2, 4);
        await page.keyboard.press("Control+Alt+KeyM");
        await expect(marginItems(page)).toHaveCount(4);
        const pending = marginItems(page).filter({has: page.locator("textarea")});
        await expect(pending).toHaveAttribute("data-mode", "write");
        await expect(popoverCard(page)).toHaveCount(0);
        await expect(pending.locator("textarea")).toBeFocused();
        await expect.poll(async () => {
            const paragraph = await paragraphBox(page, "甲乙丙丁戊己庚辛");
            const box = await pending.locator(".markdown-comment-margin__surface").boundingBox();
            return paragraph === null || box === null ? 999 : Math.abs(box.y - paragraph.y);
        }).toBeLessThanOrEqual(2);
        await page.keyboard.type("页边里写的");
        await page.keyboard.press("Control+Enter");
        await expect(marginItems(page)).toHaveCount(4);
        await expect(marginItems(page).filter({has: page.locator("textarea")})).toHaveCount(0);
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/margin-add.md")).toContain("甲乙<comment body=\"页边里写的\">丙丁</comment>戊己庚辛");
        await activeHead(page).hover();
        await marginSwitch(page).click();
    });
});

test.describe("页边里的整块批注（验收 19）", () => {
    test("页边画着时块菜单给表格加批注：待写的卡片顶边对着这一块，保存后成为一条", async ({page}) => {
        await openFile(page, "notes/margin-block.md", "前文<comment body=\"已有的\">一句</comment>\n\n| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n\n后文\n");
        await activeHead(page).hover();
        await marginSwitch(page).click();
        await expect(marginItems(page)).toHaveCount(1);
        const gutter = activeGroup(page).locator("[data-markdown-gutter]");
        await prose(page).getByText("甲", {exact: false}).first().hover();
        await expect(gutter).toBeVisible();
        await gutter.getByRole("button", {name: "块菜单"}).click();
        await page.getByRole("menuitem", {name: /批注/}).click();
        await expect(marginItems(page)).toHaveCount(2);
        const pending = marginItems(page).filter({has: page.locator("textarea")});
        await expect(pending.locator("textarea")).toBeFocused();
        const table = await prose(page).locator("table").first().boundingBox();
        const card = await pending.locator(".markdown-comment-margin__surface").boundingBox();
        if (table === null || card === null) throw new Error("取不到位置");
        // 待写的卡片顶边对着这一块的顶（表格按行算一段，差不超过一行）。
        expect(Math.abs(card.y - table.y)).toBeLessThanOrEqual(34);
        await page.keyboard.type("表格的意见");
        await page.keyboard.press("Control+Enter");
        await expect(prose(page).locator(".nb-comment-block")).toHaveCount(1);
        await expect(marginItems(page)).toHaveCount(2);
        await activeHead(page).hover();
        await marginSwitch(page).click();
    });
});

test.describe("页边的动画（验收 15）", () => {
    // 默认减少动态效果（应用的 playwright 配置）：测动画的用例开回来。
    test.beforeEach(async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
    });

    test("开关页边：稿纸平移是过渡，页边跟着稿纸走，槽位带入场动画、位置与高度过渡，卡片面带当前态过渡", async ({page}) => {
        await openFile(page, "notes/motion.md", PARAGRAPHS);
        await activeHead(page).hover();
        // 在过渡里每帧采样滚动容器的右内边距（0 到 280 之间应有中间值）。
        const sampling = page.evaluate(() => new Promise<number[]>((resolve) => {
            const scroller = document.querySelector("[data-editor-control=\"markdown\"]") as HTMLElement;
            const seen: number[] = [];
            const started = performance.now();
            const tick = (): void => {
                seen.push(Number.parseFloat(getComputedStyle(scroller).paddingInlineEnd));
                if (performance.now() - started < 900) requestAnimationFrame(tick);
                else resolve(seen);
            };
            requestAnimationFrame(tick);
        }));
        await marginSwitch(page).click();
        const seen = await sampling;
        expect(seen.some((value) => value > 0 && value < 280)).toBe(true);
        expect(seen.at(-1)).toBe(280);
        await expect(marginItems(page)).toHaveCount(3);
        // 稳定之后页边的左边在稿纸右边缘外一个空。
        await expect.poll(async () => {
            const paper = await activeGroup(page).locator(".markdown-control").first().boundingBox();
            const margin = await page.locator("[data-markdown-comment-margin]").boundingBox();
            return paper === null || margin === null ? 999 : Math.abs(margin.x - (paper.x + paper.width) - 16);
        }).toBeLessThanOrEqual(3);
        // 槽位与卡片面的动画与过渡是按令牌写的（时长不是 0），位置与高度过渡只对已显示的槽位开。
        const styles = await marginItems(page).first().evaluate((element) => {
            const item = getComputedStyle(element);
            const face = getComputedStyle(element.querySelector(".markdown-comment-margin__surface") as HTMLElement);
            return {animation: item.animationName, animationDuration: item.animationDuration, itemTransition: item.transitionProperty, faceTransition: face.transitionProperty, faceDuration: face.transitionDuration};
        });
        expect(styles.animation).toContain("markdown-comment-card-in");
        expect(styles.animationDuration).not.toBe("0s");
        expect(styles.itemTransition).toContain("top");
        expect(styles.faceTransition).toContain("height");
        expect(styles.faceTransition).toContain("box-shadow");
        expect(styles.faceDuration).not.toBe("0s");
        // 当前态切换：卡片面的底色渐变（过渡中的计算值介于两端之间），外框尺寸不变。
        const before = await surfaceOf(page, 1).evaluate((element) => getComputedStyle(element).backgroundColor);
        const frames = surfaceOf(page, 1).evaluate((element) => new Promise<string[]>((resolve) => {
            const seenColors: string[] = [];
            const started = performance.now();
            const tick = (): void => {
                seenColors.push(getComputedStyle(element).backgroundColor);
                if (performance.now() - started < 400) requestAnimationFrame(tick);
                else resolve(seenColors);
            };
            requestAnimationFrame(tick);
        }));
        await clickComment(page, "申酉");
        const colors = await frames;
        expect(new Set(colors).size).toBeGreaterThan(2);
        expect(colors[0]).toBe(before);
        // 关页边：槽位淡出后摘掉。
        await activeHead(page).hover();
        await marginSwitch(page).click();
        await expect(marginItems(page)).toHaveCount(0);
    });

    test("展开与收回：卡片面的高度是过渡（采样能看到中间值），不是一下子跳到终点", async ({page}) => {
        const LONG = "这条意见很长很长，页边里放不下它：".repeat(6);
        await openFile(page, "notes/motion-expand.md", `壬<comment body="${LONG}">癸子丑</comment>寅卯辰巳午\n\n未<comment body="第二条">申酉</comment>戌亥\n`);
        await activeHead(page).hover();
        await marginSwitch(page).click();
        await expect(marginItems(page)).toHaveCount(2);
        await expect(marginItems(page).first()).toHaveAttribute("data-ready", "");
        const startHeight = (await slotBoxes(page))[0]?.height ?? 0;
        const sample = (): Promise<number[]> => surfaceOf(page, 0).evaluate((element) => new Promise<number[]>((resolve) => {
            const heights: number[] = [];
            const started = performance.now();
            const tick = (): void => {
                heights.push(element.getBoundingClientRect().height);
                if (performance.now() - started < 700) requestAnimationFrame(tick);
                else resolve(heights);
            };
            requestAnimationFrame(tick);
        }));
        const opening = sample();
        await marginItems(page).first().locator("[data-markdown-comment-body]").click();
        const grown = await opening;
        const endHeight = grown.at(-1) as number;
        expect(endHeight).toBeGreaterThan(startHeight + 20);
        expect(grown.some((height) => height > startHeight + 2 && height < endHeight - 2)).toBe(true);
        const closing = sample();
        await page.keyboard.press("Escape");
        const shrunk = await closing;
        expect(shrunk.some((height) => height > startHeight + 2 && height < endHeight - 2)).toBe(true);
        expect(Math.round(shrunk.at(-1) as number)).toBe(Math.round(startHeight));
        await marginSwitch(page).click();
    });

    test("删一条批注：它的槽位淡出（透明度经过中间值），不是一下子没有", async ({page}) => {
        await openFile(page, "notes/motion-leave.md", PARAGRAPHS);
        await activeHead(page).hover();
        await marginSwitch(page).click();
        await expect(marginItems(page)).toHaveCount(3);
        // 点批注：它成为当前，卡片上的按钮显现。
        await clickComment(page, "申酉");
        await expect(actionsOf(page, 1)).toBeVisible();
        const sampling = marginItems(page).nth(1).evaluate((element) => new Promise<number[]>((resolve) => {
            const seen: number[] = [];
            const started = performance.now();
            const tick = (): void => {
                seen.push(Number.parseFloat(getComputedStyle(element).opacity));
                if (element.isConnected && performance.now() - started < 3000) requestAnimationFrame(tick);
                else resolve(seen);
            };
            requestAnimationFrame(tick);
        }));
        await marginItems(page).nth(1).getByRole("button", {name: "删除批注"}).click();
        const seen = await sampling;
        expect(seen.some((value) => value > 0.05 && value < 0.95)).toBe(true);
        await expect(marginItems(page)).toHaveCount(2);
    });

    test("新增一段：别的槽位滑到新位置（top 在过渡中），换文档与首次打开时槽位不从顶上滑下来", async ({page}) => {
        await openFile(page, "notes/motion-move.md", PARAGRAPHS);
        await activeHead(page).hover();
        await marginSwitch(page).click();
        await expect(marginItems(page)).toHaveCount(3);
        // 首次排好位置：每个槽位已经有 data-ready，且 top 就是终点（不从 0 滑下来）。
        await expect(marginItems(page).first()).toHaveAttribute("data-ready", "");
        const tops = await marginItems(page).evaluateAll((elements) => elements.map((element) => Number.parseFloat((element as HTMLElement).style.top)));
        expect(tops.every((top) => top > 50)).toBe(true);
        // 第一段末尾回车多出一段，后面的槽位整体往下一段的高度：位置不是一次跳到终点，采样能看到中间值。
        const startTop = await marginItems(page).nth(1).evaluate((element) => element.getBoundingClientRect().top);
        await prose(page).locator("p").first().click();
        await page.keyboard.press("Control+Home");
        await page.keyboard.press("End");
        const sampling = marginItems(page).nth(1).evaluate((element) => new Promise<number[]>((resolve) => {
            const seenTops: number[] = [];
            const started = performance.now();
            const tick = (): void => {
                seenTops.push(element.getBoundingClientRect().top);
                if (performance.now() - started < 1200) requestAnimationFrame(tick);
                else resolve(seenTops);
            };
            requestAnimationFrame(tick);
        }));
        await page.keyboard.press("Enter");
        const seen = await sampling;
        const endTop = seen.at(-1) as number;
        expect(endTop).toBeGreaterThan(startTop + 10);
        expect(seen.some((top) => top > startTop + 2 && top < endTop - 2)).toBe(true);
    });
});

test.describe("批注的显示（验收 20）", () => {
    const OVERLAP = [
        "两层：<comment body=\"外层\"><comment body=\"内层\">同一段文字</comment>被外层盖着</comment>。",
        "",
        "三层：<comment body=\"一\"><comment body=\"二\">她看了<comment body=\"三\">他一眼</comment>，没说话</comment>，转身</comment>走了。",
        "",
        "<comment body=\"整段的意见\">",
        "",
        "块批注里的第一段，<comment body=\"其中一句\">这一句另有批注</comment>。",
        "",
        "块批注里的第二段。",
        "",
        "</comment>",
        "",
        "没有批注的段落，用来对照左缘。",
        "",
    ].join("\n");

    test("同一段上叠着的批注：嵌套的第 2、3 层把波浪线依次往下错开；块批注没有虚线左边框也没有缩进", async ({page}) => {
        await openFile(page, "notes/display.md", OVERLAP);
        // 看每段文字上叠着的几层批注（从最里层的元素往外数）：层数决定下划线偏移。哪条批注在哪一层由标记的先后定，这里不假设。
        const layers = await prose(page).evaluate((root) => {
            const chainAt = (text: string): number[] => {
                // 几层批注盖着同一段字时，里外几层的文字相同：取最深的那一个。
                const depth = (element: Element): number => (element === root || element.parentElement === null ? 0 : 1 + depth(element.parentElement));
                const innermost = [...root.querySelectorAll("comment")].filter((element) => element.textContent === text).sort((left, right) => depth(right) - depth(left))[0];
                if (innermost === undefined) throw new Error(`没有批注元素含 ${text}`);
                const offsets: number[] = [];
                for (let element: Element | null = innermost; element !== null && element !== root; element = element.parentElement) {
                    if (element.tagName !== "COMMENT" && !element.classList.contains("nb-comment-block")) continue;
                    const style = getComputedStyle(element);
                    offsets.push(Number.parseFloat(style.textUnderlineOffset) / Number.parseFloat(style.fontSize));
                }
                return offsets.sort((left, right) => left - right);
            };
            return {two: chainAt("同一段文字"), three: chainAt("他一眼"), inBlock: chainAt("这一句另有批注")};
        });
        expect(layers.two).toEqual([0.3, 0.6].map((value) => expect.closeTo(value, 2)));
        expect(layers.three).toEqual([0.3, 0.6, 0.9].map((value) => expect.closeTo(value, 2)));
        // 块批注里的行内批注：块是第 1 层，行内是第 2 层。
        expect(layers.inBlock).toEqual([0.3, 0.6].map((value) => expect.closeTo(value, 2)));
        const block = prose(page).locator(".nb-comment-block");
        const style = await block.evaluate((element) => ({borderLeft: getComputedStyle(element).borderLeftWidth, paddingLeft: getComputedStyle(element).paddingLeft}));
        expect(style).toEqual({borderLeft: "0px", paddingLeft: "0px"});
        const inside = await block.locator("p").first().boundingBox();
        const plain = await prose(page).locator("p", {hasText: "没有批注的段落"}).boundingBox();
        if (inside === null || plain === null) throw new Error("取不到位置");
        expect(Math.abs(inside.x - plain.x)).toBeLessThanOrEqual(1);
        // 块批注里段落之间的间隔与顶层段落之间的一样。
        const gaps = await prose(page).evaluate((root) => {
            const gap = (upper: Element, lower: Element): number => lower.getBoundingClientRect().top - upper.getBoundingClientRect().bottom;
            const top = [...root.children].filter((element) => element.tagName === "P");
            const inner = [...(root.querySelector(".nb-comment-block")?.children ?? [])];
            return {topLevel: gap(top[0] as Element, top[1] as Element), inBlock: gap(inner[0] as Element, inner[1] as Element)};
        });
        expect(Math.abs(gaps.inBlock - gaps.topLevel)).toBeLessThanOrEqual(1);
    });
});

test.describe("只读（验收 16）", () => {
    test("文件被外部删除变只读：卡片没有编辑与删除，上一条、下一条照常", async ({page}) => {
        await openFile(page, "notes/readonly.md", TWO);
        await rm(join(projectDir, "notes/readonly.md"));
        await expect(activeGroup(page)).toContainText(/已被|删除|只读/);
        await hoverComment(page, "癸子丑");
        await expect(popoverCard(page)).toContainText("第一条");
        await expect(popoverCard(page).getByRole("button", {name: "编辑批注"})).toHaveCount(0);
        await expect(popoverCard(page).getByRole("button", {name: "删除批注"})).toHaveCount(0);
        await expect(popoverCard(page).getByRole("button", {name: "下一条批注"})).toBeEnabled();
        // 只读的正文拿不到焦点，键盘事件不经过编辑器：Esc 也要收起卡片。
        await page.keyboard.press("Escape");
        await expect(popoverCard(page)).toHaveCount(0);
    });
});
