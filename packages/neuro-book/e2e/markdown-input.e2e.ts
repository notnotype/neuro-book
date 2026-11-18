/**
 * Markdown 富文本里用户怎样输入（docs/specs/workbench/editor.md 输出 62、验收 34）：本机 Chrome 的真实键盘、输入法事件与鼠标，产品页、
 * 真实文件服务；判据是保存后磁盘上的原文。各种格式在边界打字的规则由 `MarkdownControl.dom.test.ts` 的“在格式的边界打字”一组
 * 逐条测（走编辑内核的输入入口）；这里只留那里测不到的：浏览器里光标与小块图标的关系、输入法组字、源码与富文本来回换。
 */

import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

let tmp = "";
let projectDir = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "markdown-input");
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
const prose = (page: Page) => page.locator("[data-editor-group-active] [data-editor-kind=\"nbook.editor.markdown\"]:visible [data-editor-prose]");
const disk = (path: string): Promise<string> => readFile(join(projectDir, path), "utf8");

/** 写一个文件、打开作品并用富文本打开它；每个用例用自己的文件，互不影响。 */
async function openFile(page: Page, path: string, text: string): Promise<void> {
    await mkdir(dirname(join(projectDir, path)), {recursive: true});
    await writeFile(join(projectDir, path), text);
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    // 恢复会话时文件夹的展开状态还在变：读到“收起”再点，可能正好把刚展开的收起来。要等到活动标签真是这个文件。
    const name = path.split("/").at(-1) as string;
    await expect(async () => {
        const folder = item(page, "project://notes");
        if (await folder.getAttribute("aria-expanded") !== "true") await folder.click();
        await item(page, `project://${path}`).dblclick({timeout: 3000});
        await expect(page.locator("[data-editor-group-head-active] [data-editor-tab]").filter({hasText: name})).toBeVisible({timeout: 3000});
    }).toPass();
    await expect(prose(page)).toBeVisible();
}

async function save(page: Page): Promise<void> {
    await page.keyboard.press("Control+s");
}

/** 打开 `path`（内容 `text`），把光标放到第一段的行首或行尾，按 `keys` 依次按键，再打 `typed`，保存。 */
async function typeInto(page: Page, path: string, text: string, at: "Home" | "End", keys: ReadonlyArray<string>, typed: string): Promise<void> {
    await openFile(page, path, text);
    await prose(page).locator("p").first().click();
    // 键要等正文拿到焦点再按：负载下点击之后编辑器还没聚焦时，按键落空。
    await expect(prose(page)).toBeFocused();
    await page.keyboard.press(at);
    for (const key of keys) await page.keyboard.press(key);
    if (typed !== "") await page.keyboard.type(typed);
    await save(page);
}

/** 输入法组字：先出拼音，再上屏汉字（Chrome 的 `Input.imeSetComposition` 与 `Input.insertText`，与真实输入法的事件顺序相同）。 */
async function compose(page: Page, pinyin: string, text: string): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    for (let length = 1; length <= pinyin.length; length += 1) {
        await cdp.send("Input.imeSetComposition", {text: pinyin.slice(0, length), selectionStart: length, selectionEnd: length});
    }
    await cdp.send("Input.insertText", {text});
    await cdp.detach();
}

test.describe("引用小块", () => {
    test("行尾打字写在链接后面", async ({page}) => {
        await typeInto(page, "notes/link-end.md", "[123](project://123)\n", "End", [], "后");
        await expect.poll(() => disk("notes/link-end.md")).toBe("[123](project://123)后\n");
    });

    test("从行首按一次右方向键越过一个字：图标不占一格", async ({page}) => {
        await typeInto(page, "notes/link-arrow.md", "[123](project://123)\n", "Home", ["ArrowRight"], "x");
        await expect.poll(() => disk("notes/link-arrow.md")).toBe("[1x23](project://123)\n");
    });

    test("行尾用输入法打字：上屏的字写在链接后面", async ({page}) => {
        await openFile(page, "notes/link-ime.md", "[123](project://123)\n");
        await prose(page).locator("p").first().click();
        await expect(prose(page)).toBeFocused();
        await page.keyboard.press("End");
        await compose(page, "hou", "后");
        await save(page);
        await expect.poll(() => disk("notes/link-ime.md")).toBe("[123](project://123)后\n");
    });
});

test("按快捷键打出的粗体、斜体、删除线在正文里看得出来，写回对应的写法", async ({page}) => {
    await typeInto(page, "notes/marks.md", "看\n", "End", ["Control+b"], "粗");
    await page.keyboard.press("Control+b");
    await page.keyboard.press("Control+i");
    await page.keyboard.type("斜");
    await page.keyboard.press("Control+i");
    await page.keyboard.press("Control+Shift+s");
    await page.keyboard.type("删");
    await save(page);
    await expect.poll(() => disk("notes/marks.md")).toBe("看**粗***斜*~~删~~\n");
    const style = (selector: string) => prose(page).locator(selector).evaluate((element) => {
        const computed = getComputedStyle(element);
        return {weight: Number(computed.fontWeight), style: computed.fontStyle, line: computed.textDecorationLine};
    });
    expect((await style("strong")).weight).toBeGreaterThanOrEqual(600);
    expect((await style("em")).style).toBe("italic");
    expect((await style("s")).line).toContain("line-through");
});

test("源码编辑器里写链接、换回富文本后接着打字：字写在链接后面（开发者 2026-10-16 报告的路径）", async ({page}) => {
    await openFile(page, "notes/source.md", "\n");
    const combobox = page.getByRole("combobox", {name: "输入命令，或输入 : 跳到某一行"});
    const picker = page.getByRole("combobox", {name: "选择打开这个文件的编辑器"});
    const reopen = async (editor: string): Promise<void> => {
        await expect(async () => {
            await page.keyboard.press("Control+Shift+P");
            await expect(combobox).toBeFocused({timeout: 500});
        }).toPass();
        await combobox.fill("用其它编辑器重新打开");
        await page.getByRole("option", {name: /用其它编辑器重新打开/u}).click();
        await expect(picker).toBeFocused();
        await page.getByRole("option", {name: new RegExp(editor, "u")}).click();
    };
    await reopen("源码编辑器");
    const monaco = page.locator("[data-editor-group-active] [data-editor-monaco] .monaco-editor textarea");
    await expect(monaco).toBeAttached();
    await page.locator("[data-editor-group-active] [data-editor-monaco] .view-lines").click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.type("[123](project://123)");
    await reopen("Markdown 编辑器");
    // 小块的末尾一个字另有一层收口的元素（`nb-chip-link--end`），所以按正文与第一个元素看。
    await expect(prose(page)).toHaveText("123");
    await expect(prose(page).locator("[data-reference-link=\"work\"]").first()).toBeVisible();
    await prose(page).click();
    await expect(prose(page)).toBeFocused();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("后");
    await save(page);
    await expect.poll(() => disk("notes/source.md")).toBe("[123](project://123)后\n");
});
