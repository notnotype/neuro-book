/**
 * `nbook.markdown` 交出的组件在真实浏览器里的验收，用真实的 `bun run dev` 里的 Lab 场景：
 * - Markdown 展示器（docs/specs/ui/markdown-display.md 验收场景 1、2）：组件测试（`MarkdownDisplay.dom.test.ts`）证明更新只替换
 *   变了的块；这里证明真实的帧调度下流式能播完，以及长对话改宽度时排版只算看得见的消息。
 * - Composer 的编辑组件（docs/specs/ui/prompt-editor.md 输出 2、4、5、6、7、10、12、13）：组件测试里按键与输入是合成的，这里用真实键盘
 *   打字、回车、方向键与退格，粘贴用 Lab 的“模拟”按钮（剪贴板事件）。候选菜单是 nb-ui 的 SuggestionMenu，传送到了 `body`，
 *   不在 Lab 舞台里，按角色在整页里找。
 */

import {rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {LabDebugState} from "nbook/plugins/lab/shared/debug-api";

import {startDevSession} from "./fixtures";
import type {DevSession} from "./fixtures";

let tmp = "";
let dev: DevSession;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-markdown");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const labState = (page: Page) => page.evaluate(() => (window as unknown as {__nbLab?: {state(): LabDebugState}}).__nbLab?.state() ?? null);

test("场景 1：流式播到结束，提示块的元素始终是同一个、保持折叠，结束后去掉光标", async ({page}) => {
    await page.goto(`${dev.pageUrl}lab?c=MarkdownDisplay&s=streaming&vp=1200x900`);
    await expect.poll(() => labState(page)).toMatchObject({ready: true, scene: "streaming"});
    const display = page.locator("[data-lab-stage] [data-markdown-display]");
    await expect(display.locator(".nb-callout")).toHaveCount(1, {timeout: 20_000});
    // 提示块自己还在追加时内容在变，按输出 6 会被替换；等它后面的一块出现、它不再变了，再记下它的元素。
    await expect(display).toContainText("改写示例", {timeout: 20_000});
    await display.locator(".nb-callout").evaluate((element) => {
        (window as unknown as {__callout: Element}).__callout = element;
    });
    await expect(display.locator(".nb-markdown-display__cursor")).toHaveCount(0, {timeout: 30_000});
    await expect(display).toContainText("写作手册");
    expect(await display.locator(".nb-callout").evaluate((element) => element === (window as unknown as {__callout: Element}).__callout && element.getAttribute("data-callout-folded") === "true")).toBe(true);
});

test("输出 2：普通 Markdown 的粗体、斜体、删除线、四级标题与分割线有各自的样子（应用的全局样式重置清掉了浏览器自带的）", async ({page}) => {
    await page.goto(`${dev.pageUrl}lab?c=MarkdownDisplay&s=plain&vp=1200x900`);
    await expect.poll(() => labState(page)).toMatchObject({ready: true, scene: "plain"});
    const display = page.locator("[data-lab-stage] [data-markdown-display]");
    const style = (selector: string) => display.locator(selector).first().evaluate((element) => {
        const computed = getComputedStyle(element);
        const body = getComputedStyle(element.closest("[data-markdown-display]") ?? element);
        return {weight: Number(computed.fontWeight), bodyWeight: Number(body.fontWeight), style: computed.fontStyle, line: computed.textDecorationLine, border: computed.borderTopWidth};
    });
    const strong = await style("strong");
    expect(strong.weight).toBeGreaterThan(strong.bodyWeight);
    expect((await style("em")).style).toBe("italic");
    expect((await style("del, s")).line).toContain("line-through");
    const heading = await style("h4");
    expect(heading.weight).toBeGreaterThan(heading.bodyWeight);
    expect((await style("hr")).border).not.toBe("0px");
});

test("场景 2：100 条消息的长对话，宽度来回改 40 次，每次改完强制布局的耗时中位数在 5 毫秒以内", async ({page}) => {
    await page.goto(`${dev.pageUrl}lab?c=MarkdownDisplay&s=conversation&vp=1200x900`);
    await expect.poll(() => labState(page)).toMatchObject({ready: true, scene: "conversation"});
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll("[data-lab-stage] [data-markdown-display]")].filter((element) => element.childElementCount > 0).length), {timeout: 30_000}).toBe(100);
    const median = await page.evaluate(() => {
        const list = document.querySelector("[data-lab-stage] [data-markdown-display]")?.parentElement;
        if (list === null || list === undefined) throw new Error("没有找到消息列表");
        const times: number[] = [];
        for (let index = 0; index < 40; index += 1) {
            const start = performance.now();
            list.style.width = index % 2 === 0 ? "520px" : "760px";
            void list.offsetHeight;
            times.push(performance.now() - start);
        }
        return times.sort((a, b) => a - b)[20] as number;
    });
    expect(median).toBeLessThan(5);
});

const prose = (page: Page) => page.locator("[data-lab-stage] .ProseMirror");
/** 组件交出的文字（与 `change` 的值同一个来源：编辑器的 `getText`）。 */
const promptText = (page: Page) => prose(page).evaluate((element) => (element as HTMLElement & {editor: {getText(options: {blockSeparator: string}): string}}).editor.getText({blockSeparator: "\n"}));

async function openPrompt(page: Page, scene: string): Promise<void> {
    await page.goto(`${dev.pageUrl}lab?c=PromptEditor&s=${scene}&vp=1200x900`);
    await expect.poll(() => labState(page)).toMatchObject({ready: true, scene});
    await expect(prose(page)).toBeVisible();
}

test("PromptEditor 真实按键：手打的技能写完才变小块，退格删整枚；回车发送后正文清空，上方向键调出刚发的一条", async ({page}) => {
    await openPrompt(page, "empty");
    await prose(page).click();
    await page.keyboard.type("$review");
    await expect(prose(page).locator("[data-inline-chip='skill']")).toHaveCount(0);
    await page.keyboard.type("er ");
    await expect(prose(page).locator("[data-inline-chip='skill']")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await expect(prose(page).locator("[data-inline-chip='skill']")).toHaveCount(0);
    expect(await promptText(page)).toBe("");
    await page.keyboard.type("$writer 看第三章");
    await page.keyboard.press("Enter");
    await expect.poll(() => promptText(page)).toBe("");
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => promptText(page)).toBe("$writer 看第三章");
    await expect(prose(page).locator("[data-inline-chip='skill']")).toHaveCount(1);
});

test("PromptEditor `@` 菜单：打 ` @第一` 出候选，回车确认得到以 `/` 开头的作品根地址，显示为引用小块", async ({page}) => {
    await openPrompt(page, "empty");
    await prose(page).click();
    await page.keyboard.type("看 @第一");
    const option = page.locator("[role='option']", {hasText: "第一章 雨夜"});
    await expect(option).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(option).toHaveCount(0);
    expect(await promptText(page)).toBe("看 [第一章 雨夜](/正文/第一章.md) ");
    await expect(prose(page).locator("[data-inline-chip='reference']")).toContainText("第一章 雨夜");
});

/** 正文区的 aria-activedescendant 指向的那一项，与挂高亮的那一项是同一个元素。 */
async function expectActiveOption(page: Page, label: string): Promise<void> {
    const highlighted = page.locator("[data-suggestion-menu] [data-highlighted]");
    await expect(highlighted).toHaveCount(1);
    await expect(highlighted).toContainText(label);
    expect(await prose(page).getAttribute("aria-activedescendant")).toBe(await highlighted.getAttribute("id"));
}

test("PromptEditor `/` 菜单（输出 5、13）：贴着外框上方、与外框同宽、没有按键提示；方向键跳过禁用项并循环，Tab 确认", async ({page}) => {
    await openPrompt(page, "empty");
    await prose(page).click();
    await page.keyboard.type("/");
    const menu = page.locator("[data-suggestion-menu]");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("option")).toHaveCount(4);
    await expect(menu.locator("kbd"), "没有按键提示").toHaveCount(0);
    expect(await prose(page).getAttribute("aria-controls")).toBe(await menu.getByRole("listbox").getAttribute("id"));
    const frame = (await page.locator("[data-lab-stage] [data-prompt-editor]").boundingBox())!;
    const box = (await menu.boundingBox())!;
    expect(box.y + box.height, "在外框上方").toBeLessThanOrEqual(frame.y);
    expect(Math.abs(box.width - frame.width), "与外框同宽").toBeLessThanOrEqual(1);
    await expect(menu.getByRole("option", {name: /clear/})).toHaveAttribute("aria-disabled", "true");
    // 按在标题行上不夺走正文的焦点，菜单不关。
    await menu.getByText("命令", {exact: true}).click();
    await expect(prose(page)).toBeFocused();
    await expect(menu).toBeVisible();

    await expectActiveOption(page, "/plan");
    await page.keyboard.press("ArrowDown");
    await expectActiveOption(page, "/compact");
    await page.keyboard.press("ArrowDown");
    await expectActiveOption(page, "/rename");
    await page.keyboard.press("ArrowDown");
    await expectActiveOption(page, "/plan");
    await page.keyboard.press("Tab");
    await expect(menu).toHaveCount(0);
    expect(await promptText(page)).toBe("/plan ");
    await expect(prose(page)).toBeFocused();
});

test("PromptEditor 菜单（输出 5）：只有禁用项时回车照常发送；技能先“正在加载”再出项；点项确认且正文不失焦", async ({page}) => {
    await openPrompt(page, "empty");
    await prose(page).click();
    await page.keyboard.type("/clear");
    await expect(page.locator("[data-suggestion-menu] [role='option']")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect.poll(() => promptText(page), {message: "回车发送，正文清空"}).toBe("");

    await page.keyboard.type("$");
    const menu = page.locator("[data-suggestion-menu]");
    await expect(menu.locator("[data-suggestion-menu-loading]")).toContainText("正在加载");
    const writer = menu.getByRole("option", {name: /writer/});
    await expect(writer).toBeVisible();
    await expect(menu.locator("[data-suggestion-menu-loading]")).toHaveCount(0);
    await writer.click();
    await expect(prose(page)).toBeFocused();
    expect(await promptText(page)).toBe("$writer ");
});

test("PromptEditor 输入历史（输出 10、13）：Ctrl+R 后直接打字过滤，方向键选择，回车替换正文并回到正文；Escape 不改正文；搜索框可以点", async ({page}) => {
    await openPrompt(page, "empty");
    await prose(page).click();
    await page.keyboard.type("草稿");
    await page.keyboard.press("Control+r");
    const search = page.getByRole("combobox", {name: "搜索已发送的内容"});
    await expect(search).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(search).toHaveCount(0);
    expect(await promptText(page), "Escape 不改正文").toBe("草稿");
    await expect(prose(page)).toBeFocused();

    await page.keyboard.press("Control+r");
    await expect(search).toBeFocused();
    await page.keyboard.type("第");
    const options = page.locator("[data-suggestion-menu] [role='option']");
    await expect(options).toHaveCount(4);
    await page.keyboard.press("ArrowDown");
    const highlighted = page.locator("[data-suggestion-menu] [data-highlighted]");
    expect(await search.getAttribute("aria-activedescendant")).toBe(await highlighted.getAttribute("id"));
    const chosen = (await highlighted.textContent())?.trim() ?? "";

    // 点进搜索框把光标移到开头：焦点留在搜索框，菜单不关。
    const box = (await search.boundingBox())!;
    await page.mouse.click(box.x + 2, box.y + box.height / 2);
    await expect(search).toBeFocused();
    expect(await search.evaluate((element) => (element as HTMLInputElement).selectionStart)).toBe(0);

    await page.keyboard.press("Enter");
    await expect(search).toHaveCount(0);
    await expect(prose(page)).toBeFocused();
    // 过滤后第二条是 PROMPT_LAB_RECALL 的第二条（长消息），整条替换正文。
    expect(chosen.startsWith("这是一段会折成好几行的长消息")).toBe(true);
    await expect.poll(() => promptText(page)).toBe("这是一段会折成好几行的长消息：请通读第三章，把林默在钟表铺里等人的那一段改得更紧张一些，减少他对店内陈设的长篇观察，增加门外脚步声与座钟报时交错出现的细节，最后让学徒推门进来的时刻正好落在第十二下钟声上，并且保持第一人称视角不变。");
});

test("PromptEditor 界面语言（输出 12）：英文界面里加载提示与输入历史的文字是英文", async ({page}) => {
    await openPrompt(page, "english");
    await prose(page).click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    await page.keyboard.type("$");
    await expect(page.locator("[data-suggestion-menu-loading]")).toContainText("Loading");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+r");
    await expect(page.getByRole("combobox", {name: "Search sent messages"})).toBeFocused();
    await expect(page.locator("[data-suggestion-menu]")).toContainText("Input history");
});

test("PromptEditor 粘贴分档：30 行成为粘贴块，150 行转为文件附件、上传完成后写回附件的写法", async ({page}) => {
    await openPrompt(page, "empty");
    await page.locator("[data-lab-action='paste-medium']").click();
    await expect(page.locator("[data-lab-stage] [data-prompt-paste]")).toHaveCount(1);
    expect(await promptText(page)).toMatch(/^<paste id="1">\nline 001: clock\.tick\(0\);[\s\S]*\n<\/paste>\n$/u);
    await page.locator("[data-lab-action='paste-large']").click();
    await expect(page.locator("[data-lab-stage] [data-prompt-card-state='ready']")).toHaveCount(1, {timeout: 10_000});
    await expect.poll(() => promptText(page)).toContain("[file #2 · paste-2.txt](session://attachments/paste-2.txt)");
});
