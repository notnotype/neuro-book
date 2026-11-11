/**
 * Markdown 里的批注（docs/specs/workbench/markdown-editing.md 输出 28–35、验收 11–17）：本机 Chrome 的真实键盘、鼠标与输入法
 * 事件，产品页、真实文件服务；判据是看得见的卡片、页边的位置，和保存后磁盘上的原文。数据操作与状态机的规则由
 * `comments.dom.test.ts`、`MarkdownControl.dom.test.ts` 逐条测，这里只留要真实浏览器的：排版位置、宽度、真实的键位与输入法。
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

/** 点到被批注的文字上（波浪线的 `<comment>` 元素）：光标进批注。 */
async function clickComment(page: Page, text: string, focus = true): Promise<void> {
    await prose(page).locator("comment", {hasText: text}).first().click();
    // 只读的正文拿不到焦点。
    if (focus) await expect(prose(page)).toBeFocused();
}

/** 选中第一段里的第 `from` 到 `to` 个字：Home 之后按键，鼠标选区会受选区菜单与行内元素干扰。 */
async function selectInFirstParagraph(page: Page, from: number, to: number): Promise<void> {
    await prose(page).locator("p").first().click();
    await expect(prose(page)).toBeFocused();
    await page.keyboard.press("Home");
    for (let index = 0; index < from; index += 1) await page.keyboard.press("ArrowRight");
    for (let index = from; index < to; index += 1) await page.keyboard.press("Shift+ArrowRight");
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

    test("光标进批注出卡片：改意见、删除都写回文件；卡片按钮不夺走正文的焦点", async ({page}) => {
        await openFile(page, "notes/edit.md", TWO);
        await clickComment(page, "癸子丑");
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
        await clickComment(page, "癸子丑");
        await popoverCard(page).getByRole("button", {name: "编辑批注"}).click();
        await popoverCard(page).locator("textarea").fill("  ");
        await page.keyboard.press("Control+Enter");
        await expect(prose(page).locator("comment")).toHaveCount(2);
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/empty.md")).toBe(TWO);
    });
});

test.describe("光标进入才弹（验收 13）", () => {
    test("上一条、下一条跳到那条的开头；打字落在批注里、Esc 之后不弹", async ({page}) => {
        await openFile(page, "notes/enter.md", TWO);
        await clickComment(page, "癸子丑");
        await popoverCard(page).getByRole("button", {name: "下一条批注"}).click();
        await expect(popoverCard(page)).toContainText("第二条");
        await expect(popoverCard(page)).toContainText("第 2 条，共 2 条");
        await expect(popoverCard(page).getByRole("button", {name: "下一条批注"})).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(popoverCard(page)).toHaveCount(0);
        await page.keyboard.press("ArrowRight");
        await settle(page);
        await expect(popoverCard(page)).toHaveCount(0);
        // 在批注中间打字：不弹；之后按方向键仍不弹。
        await page.keyboard.type("字");
        await page.keyboard.press("ArrowLeft");
        await settle(page);
        await expect(popoverCard(page)).toHaveCount(0);
    });

    test("真实的输入法组字：组字中卡片收起、不弹，组字结束后仍不弹", async ({page}) => {
        await openFile(page, "notes/ime.md", TWO);
        await clickComment(page, "癸子丑");
        await expect(popoverCard(page)).toBeVisible();
        const client = await page.context().newCDPSession(page);
        await client.send("Input.imeSetComposition", {text: "ni", selectionStart: 2, selectionEnd: 2});
        await settle(page);
        await expect(popoverCard(page)).toHaveCount(0);
        await client.send("Input.imeSetComposition", {text: "你", selectionStart: 1, selectionEnd: 1});
        await settle(page);
        await expect(popoverCard(page)).toHaveCount(0);
        await client.send("Input.insertText", {text: "你"});
        await expect(prose(page)).toContainText("你");
        await settle(page);
        await expect(popoverCard(page)).toHaveCount(0);
    });

    test("块批注：卡片在这一块第一行下面，不管光标在块里哪一段", async ({page}) => {
        await openFile(page, "notes/block.md", "前文\n\n<comment body=\"整块的意见\">\n\n第一段\n\n第二段\n\n第三段\n\n</comment>\n\n后文\n");
        await prose(page).locator("p", {hasText: "第三段"}).click();
        await expect(popoverCard(page)).toContainText("整块的意见");
        const first = await prose(page).locator("p", {hasText: "第一段"}).boundingBox();
        const card = await popoverCard(page).boundingBox();
        if (first === null || card === null) throw new Error("取不到位置");
        // 卡片贴在第一段这一行的下面（放得下时在下面）：卡片顶边不早于第一段的下沿。
        expect(card.y).toBeGreaterThanOrEqual(first.y + first.height - 2);
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
        // 光标进批注：不出浮层，这一条的卡片展开（一条展开，其余是摘要）。
        await clickComment(page, "未申酉");
        await expect(popoverCard(page)).toHaveCount(0);
        await expect(marginItems(page).nth(1)).toHaveAttribute("data-mode", "view");
        await expect(marginItems(page).nth(0)).toHaveAttribute("data-mode", "compact");
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
        await clickComment(page, "癸子丑");
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

test.describe("只读（验收 16）", () => {
    test("文件被外部删除变只读：卡片没有编辑与删除，上一条、下一条照常", async ({page}) => {
        await openFile(page, "notes/readonly.md", TWO);
        await rm(join(projectDir, "notes/readonly.md"));
        await expect(activeGroup(page)).toContainText(/已被|删除|只读/);
        await clickComment(page, "癸子丑", false);
        await expect(popoverCard(page)).toContainText("第一条");
        await expect(popoverCard(page).getByRole("button", {name: "编辑批注"})).toHaveCount(0);
        await expect(popoverCard(page).getByRole("button", {name: "删除批注"})).toHaveCount(0);
        await expect(popoverCard(page).getByRole("button", {name: "下一条批注"})).toBeEnabled();
        // 只读的正文拿不到焦点，键盘事件不经过编辑器：Esc 也要收起卡片。
        await page.keyboard.press("Escape");
        await expect(popoverCard(page)).toHaveCount(0);
    });
});
