/**
 * Markdown 里的批注（docs/specs/workbench/markdown-editing.md 输出 28–37、验收 11–20）：本机 Chrome 的真实键盘、鼠标与输入法
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

/** 鼠标停在被批注的文字上，等“看”卡片弹出来（真实的 400 毫秒，输出 30）。 */
async function hoverComment(page: Page, text: string): Promise<void> {
    await prose(page).locator("comment", {hasText: text}).first().hover();
    await expect(popoverCard(page)).toBeVisible();
}

/** 断言“没有弹出来”：悬停的计时是 400 毫秒，等过它再看；没有别的可观察信号能说明一个没发生的事。 */
const waitPastHover = (page: Page): Promise<void> =>
    // test-lint-allow fixed-wait: 断言“没有弹出来”，悬停计时是 400 毫秒，等过它再看
    page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 700)));

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

    test("鼠标停在批注上出卡片：改意见、删除都写回文件；卡片按钮不夺走正文的焦点", async ({page}) => {
        await openFile(page, "notes/edit.md", TWO);
        await hoverComment(page, "癸子丑");
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
        await hoverComment(page, "癸子丑");
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

test.describe("悬停才弹（验收 13）", () => {
    test("上一条、下一条跳到那条的开头；Esc 收起；点击与方向键走进批注、在批注里打字都不弹", async ({page}) => {
        await openFile(page, "notes/enter.md", TWO);
        await hoverComment(page, "癸子丑");
        await popoverCard(page).getByRole("button", {name: "下一条批注"}).click();
        await expect(popoverCard(page)).toContainText("第二条");
        await expect(popoverCard(page)).toContainText("第 2 条，共 2 条");
        await expect(popoverCard(page).getByRole("button", {name: "下一条批注"})).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(popoverCard(page)).toHaveCount(0);
        // 点进批注、方向键、打字：不弹（鼠标没有离开过批注，也没有新的悬停）。
        await clickComment(page, "癸子丑");
        await page.keyboard.press("ArrowRight");
        await page.keyboard.type("字");
        await page.keyboard.press("ArrowLeft");
        await waitPastHover(page);
        await expect(popoverCard(page)).toHaveCount(0);
    });

    test("点击收起卡片，同一次悬停不再弹；鼠标移开再回来才弹；移向卡片途中经过空白不收", async ({page}) => {
        await openFile(page, "notes/hover.md", TWO);
        await hoverComment(page, "癸子丑");
        const comment = await prose(page).locator("comment", {hasText: "癸子丑"}).boundingBox();
        if (comment === null) throw new Error("取不到位置");
        await page.mouse.down();
        await page.mouse.up();
        await expect(popoverCard(page)).toHaveCount(0);
        await page.mouse.move(comment.x + comment.width / 2 + 1, comment.y + comment.height / 2);
        await waitPastHover(page);
        await expect(popoverCard(page)).toHaveCount(0);
        await page.mouse.move(5, 5);
        await hoverComment(page, "癸子丑");
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

    test("卡片的左边缘对齐批注在这一行的起点、贴在这一行下面，不居中于鼠标", async ({page}) => {
        await openFile(page, "notes/align.md", TWO);
        const comment = await prose(page).locator("comment", {hasText: "癸子丑"}).boundingBox();
        if (comment === null) throw new Error("取不到位置");
        // 鼠标停在批注的右半边：卡片仍然左对齐批注的起点。
        await page.mouse.move(comment.x + comment.width - 3, comment.y + comment.height / 2);
        await expect(popoverCard(page)).toBeVisible();
        const card = await popoverCard(page).boundingBox();
        if (card === null) throw new Error("取不到卡片");
        expect(Math.abs(card.x - comment.x)).toBeLessThanOrEqual(4);
        expect(card.y).toBeGreaterThanOrEqual(comment.y + comment.height - 2);
        expect(card.y).toBeLessThan(comment.y + comment.height + 30);
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
        await prose(page).locator("p", {hasText: "第三段"}).hover();
        await expect(popoverCard(page)).toContainText("整块的意见");
        const third = await prose(page).locator("p", {hasText: "第三段"}).boundingBox();
        const card = await popoverCard(page).boundingBox();
        if (third === null || card === null) throw new Error("取不到位置");
        // 卡片贴在鼠标所在的这一行下面（放得下时在下面），左边与这一行的文字对齐。
        expect(card.y).toBeGreaterThanOrEqual(third.y + third.height - 2);
        expect(Math.abs(card.x - third.x)).toBeLessThanOrEqual(4);
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

test.describe("页边（验收 15）", () => {
    test("标签条的开关带条数；打开后稿纸左移、每条批注一张卡片且顶边对着批注、互不遮盖；重开页面开关还开着", async ({page}) => {
        await openFile(page, "notes/margin.md", TWO);
        await activeHead(page).hover();
        await expect(marginSwitch(page)).toHaveText("2");
        await expect(marginSwitch(page)).toHaveAttribute("aria-pressed", "false");
        const before = await prose(page).boundingBox();
        await marginSwitch(page).click();
        await expect(marginSwitch(page)).toHaveAttribute("aria-pressed", "true");
        await expect(marginItems(page)).toHaveCount(2);
        const after = await prose(page).boundingBox();
        if (before === null || after === null) throw new Error("取不到位置");
        expect(after.x).toBeLessThan(before.x - 100);
        // 顶边对着各自的批注，卡片之间不重叠，页边在稿纸右边。
        const boxes = await marginItems(page).evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON() as {x: number; y: number; width: number; height: number}));
        const first = await prose(page).locator("comment", {hasText: "癸子丑"}).boundingBox();
        const second = await prose(page).locator("comment", {hasText: "未申酉"}).boundingBox();
        if (first === null || second === null) throw new Error("取不到批注的位置");
        expect(Math.abs((boxes[0] as {y: number}).y - first.y)).toBeLessThanOrEqual(14);
        expect((boxes[1] as {y: number}).y).toBeGreaterThanOrEqual((boxes[0] as {y: number; height: number}).y + (boxes[0] as {height: number}).height);
        expect((boxes[0] as {x: number}).x).toBeGreaterThanOrEqual(after.x + after.width - 2);
        // 两条在同一行：第二张卡片被第一张推到下面，不是叠在同一高度。
        expect(Math.abs(second.y - first.y)).toBeLessThan(6);
        // 光标进批注：不出浮层，这一条是当前批注；各张卡片的外框尺寸不变（意见不超过 3 行），按钮占位不变，没有左边框一类的侧边色条（输出 33）。
        const sizes = async (): Promise<Array<[number, number]>> => marginItems(page).evaluateAll((elements) => elements.map((element) => [element.offsetWidth, element.offsetHeight] as [number, number]));
        const idleSizes = await sizes();
        const controls = async (): Promise<number[]> => marginItems(page).evaluateAll((elements) => elements.map((element) => (element.querySelector("[data-markdown-comment-controls]") as HTMLElement).getBoundingClientRect().height));
        const idleControls = await controls();
        expect(idleControls.every((height) => height > 0)).toBe(true);
        await clickComment(page, "未申酉");
        await expect(popoverCard(page)).toHaveCount(0);
        await expect(marginItems(page).nth(1)).toHaveAttribute("data-mode", "current");
        await expect(marginItems(page).nth(0)).toHaveAttribute("data-mode", "idle");
        await expect.poll(sizes).toEqual(idleSizes);
        expect(await controls()).toEqual(idleControls);
        const borders = await marginItems(page).evaluateAll((elements) => elements.map((element) => {
            const style = getComputedStyle(element);
            return [style.borderLeftWidth === style.borderTopWidth, style.borderLeftStyle === style.borderTopStyle, style.borderLeftColor === style.borderTopColor];
        }));
        expect(borders.flat().every(Boolean)).toBe(true);
        // 当前的卡片按钮显现，其余的不画（占位）。
        await expect(marginItems(page).nth(1).locator("[data-markdown-comment-controls]")).toBeVisible();
        await expect(marginItems(page).nth(0).locator("[data-markdown-comment-controls]")).toBeHidden();
        // 按作品记住：刷新页面后开关还是开着，页边还在。
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
        await expect(prose(page)).toBeVisible();
        await activeHead(page).hover();
        await expect(marginSwitch(page)).toHaveAttribute("aria-pressed", "true");
        await expect(marginItems(page)).toHaveCount(2);
        await marginSwitch(page).click();
        await expect(marginItems(page)).toHaveCount(0);
    });

    test("窗口变窄页边退回浮层，开关仍是按下的；够宽了页边回来，稿纸不被裁掉", async ({page}) => {
        await openFile(page, "notes/narrow.md", TWO);
        await activeHead(page).hover();
        await marginSwitch(page).click();
        await expect(marginItems(page)).toHaveCount(2);
        await page.setViewportSize({width: 1300, height: 1400});
        await expect(marginItems(page)).toHaveCount(0);
        await activeHead(page).hover();
        await expect(marginSwitch(page)).toHaveAttribute("aria-pressed", "true");
        await hoverComment(page, "癸子丑");
        await expect(popoverCard(page)).toContainText("第一条");
        await page.setViewportSize({width: 2400, height: 1400});
        await expect(marginItems(page)).toHaveCount(2);
        const group = await activeGroup(page).boundingBox();
        const paper = await prose(page).boundingBox();
        if (group === null || paper === null) throw new Error("取不到位置");
        expect(paper.x).toBeGreaterThanOrEqual(group.x);
        await activeHead(page).hover();
        await marginSwitch(page).click();
    });

    test("页边里加批注：待写的卡片按选区起点排进去，保存后成为一条", async ({page}) => {
        await openFile(page, "notes/margin-add.md", TWO);
        await activeHead(page).hover();
        await marginSwitch(page).click();
        await expect(marginItems(page)).toHaveCount(2);
        await selectInFirstParagraph(page, 2, 4);
        await page.keyboard.press("Control+Alt+KeyM");
        await expect(marginItems(page)).toHaveCount(3);
        await expect(marginItems(page).nth(0)).toHaveAttribute("data-mode", "write");
        await expect(popoverCard(page)).toHaveCount(0);
        // 待写的卡片与别的卡片同一个版式：高度差不多（输入一行时与一行意见的卡片一样高）。
        await page.keyboard.type("页边里写的");
        await page.keyboard.press("Control+Enter");
        await expect(marginItems(page)).toHaveCount(3);
        await expect(marginItems(page).nth(0)).not.toHaveAttribute("data-mode", "write");
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/margin-add.md")).toContain("甲乙<comment body=\"页边里写的\">丙丁</comment>戊己庚辛");
        await activeHead(page).hover();
        await marginSwitch(page).click();
    });
});

test.describe("页边的动画（验收 15）", () => {
    // 默认减少动态效果（应用的 playwright 配置）：测动画的用例开回来。
    test.beforeEach(async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
    });

    test("开关页边：稿纸平移是过渡，页边跟着稿纸走，卡片带入场动画、位置过渡与当前态过渡", async ({page}) => {
        await openFile(page, "notes/motion.md", TWO);
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
        await expect(marginItems(page)).toHaveCount(2);
        // 稳定之后页边的左边在稿纸右边缘外一个空。
        await expect.poll(async () => {
            const paper = await activeGroup(page).locator(".markdown-control").first().boundingBox();
            const margin = await page.locator("[data-markdown-comment-margin]").boundingBox();
            return paper === null || margin === null ? 999 : Math.abs(margin.x - (paper.x + paper.width) - 16);
        }).toBeLessThanOrEqual(3);
        // 卡片的动画与过渡是按令牌写的（时长不是 0），位置过渡只对已显示的卡片开。
        const styles = await marginItems(page).first().evaluate((element) => {
            const style = getComputedStyle(element);
            return {animation: style.animationName, animationDuration: style.animationDuration, transition: style.transitionProperty, transitionDuration: style.transitionDuration};
        });
        expect(styles.animation).toContain("markdown-comment-card-in");
        expect(styles.animationDuration).not.toBe("0s");
        expect(styles.transition).toContain("top");
        expect(styles.transition).toContain("box-shadow");
        expect(styles.transitionDuration).not.toBe("0s");
        // 当前态切换：底色渐变（过渡中的计算值介于两端之间），外框尺寸不变。
        const before = await marginItems(page).nth(1).evaluate((element) => getComputedStyle(element).backgroundColor);
        const frames = marginItems(page).nth(1).evaluate((element) => new Promise<string[]>((resolve) => {
            const seenColors: string[] = [];
            const started = performance.now();
            const tick = (): void => {
                seenColors.push(getComputedStyle(element).backgroundColor);
                if (performance.now() - started < 400) requestAnimationFrame(tick);
                else resolve(seenColors);
            };
            requestAnimationFrame(tick);
        }));
        await clickComment(page, "未申酉");
        const colors = await frames;
        expect(new Set(colors).size).toBeGreaterThan(2);
        expect(colors[0]).toBe(before);
        // 关页边：卡片淡出后摘掉。
        await activeHead(page).hover();
        await marginSwitch(page).click();
        await expect(marginItems(page)).toHaveCount(0);
    });

    test("新增一条批注：别的卡片滑到新位置（top 在过渡中），换文档与首次打开时卡片不从顶上滑下来", async ({page}) => {
        await openFile(page, "notes/motion-move.md", TWO);
        await activeHead(page).hover();
        await marginSwitch(page).click();
        await expect(marginItems(page)).toHaveCount(2);
        // 首次排好位置：每张卡片已经有 data-ready，且 top 就是终点（不从 0 滑下来）。
        await expect(marginItems(page).first()).toHaveAttribute("data-ready", "");
        const tops = await marginItems(page).evaluateAll((elements) => elements.map((element) => Number.parseFloat((element as HTMLElement).style.top)));
        expect(tops.every((top) => top > 50)).toBe(true);
        // 第一段末尾回车多出一段，后面的卡片整体往下一段的高度：位置不是一次跳到终点，采样能看到中间值。
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
