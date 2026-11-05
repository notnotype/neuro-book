/**
 * Markdown 的编辑命令与菜单（docs/specs/workbench/markdown-editing.md）：本机 Chrome 的真实键盘与鼠标，产品页、真实文件服务；
 * 判据是看得见的菜单与保存后磁盘上的原文。动作本身的规则由 `editing-actions.dom.test.ts` 逐条测，这里只留要真实浏览器的。
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
    tmp = await createTestTmpRoot("neuro-book-e2e", "markdown-editing");
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
const prose = (page: Page) => activeGroup(page).locator("[data-editor-kind=\"nbook.editor.markdown\"]:visible [data-editor-prose]");
const toolbarButton = (page: Page, name: string) => activeGroup(page).locator(".markdown-toolbar").getByRole("button", {name, exact: true});
const selectionMenu = (page: Page) => page.locator("[data-markdown-selection-menu]");
const disk = (path: string): Promise<string> => readFile(join(projectDir, path), "utf8");

async function openFile(page: Page, path: string, text: string): Promise<void> {
    await mkdir(dirname(join(projectDir, path)), {recursive: true});
    await writeFile(join(projectDir, path), text);
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    const folder = item(page, "project://notes");
    if (await folder.getAttribute("aria-expanded") !== "true") await folder.click();
    await item(page, `project://${path}`).dblclick();
    await expect(prose(page)).toBeVisible();
}

/** 点进第一段。键要等正文拿到焦点再按：负载下点击之后编辑器还没聚焦时，按键落空。 */
async function focusFirst(page: Page): Promise<void> {
    await prose(page).locator("p").first().click();
    await expect(prose(page)).toBeFocused();
}

/** 用鼠标选中第一段开头的一段：`release` 为假时停在拖动中。 */
async function dragSelect(page: Page, release = true): Promise<void> {
    const paragraph = prose(page).locator("p").first();
    const box = await paragraph.boundingBox();
    if (box === null) throw new Error("第一段不可见");
    const y = box.y + 12;
    await page.mouse.move(box.x + 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, y, {steps: 4});
    if (release) await page.mouse.up();
}

test.describe("工具栏", () => {
    test("点按钮加粗，勾选状态跟着变，光标留在正文", async ({page}) => {
        await openFile(page, "notes/toolbar-bold.md", "第一段文字\n");
        await focusFirst(page);
        await page.keyboard.press("Control+a");
        await toolbarButton(page, "粗体").click();
        await expect(toolbarButton(page, "粗体")).toHaveAttribute("aria-pressed", "true");
        await expect(prose(page)).toBeFocused();
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/toolbar-bold.md")).toBe("**第一段文字**\n");
    });

    test("版心变窄时收进“更多操作”，没有横向滚动", async ({page}) => {
        await openFile(page, "notes/toolbar-narrow.md", "字\n");
        const row = activeGroup(page).locator(".markdown-toolbar [role=\"toolbar\"]");
        await expect(toolbarButton(page, "清除格式")).toBeVisible();
        await page.setViewportSize({width: 760, height: 700});
        await expect(toolbarButton(page, "清除格式")).toHaveCount(0);
        await expect(toolbarButton(page, "更多操作")).toBeVisible();
        const {scrollWidth, clientWidth} = await row.evaluate((element) => ({scrollWidth: element.scrollWidth, clientWidth: element.clientWidth}));
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
        await toolbarButton(page, "更多操作").click();
        await expect(page.getByRole("menuitem", {name: "清除格式"})).toBeVisible();
    });

    test("“视图”菜单关掉后工具栏消失，再打开恢复", async ({page}) => {
        await openFile(page, "notes/toolbar-toggle.md", "字\n");
        const toolbar = activeGroup(page).locator(".markdown-toolbar");
        await expect(toolbar).toBeVisible();
        await page.keyboard.press("Control+Shift+P");
        await page.keyboard.type("工具栏");
        await page.keyboard.press("Enter");
        await expect(toolbar).toHaveCount(0);
        await page.keyboard.press("Control+Shift+P");
        await page.keyboard.type("工具栏");
        await page.keyboard.press("Enter");
        await expect(toolbar).toBeVisible();
    });
});

test.describe("选区菜单", () => {
    test("拖选中不出现，松手才出现", async ({page}) => {
        await openFile(page, "notes/selection-drag.md", "第一段文字有好多字在这里\n");
        await dragSelect(page, false);
        await expect(selectionMenu(page)).toHaveCount(0);
        await page.mouse.up();
        await expect(selectionMenu(page)).toBeVisible();
    });

    test("菜单里加粗写回；打字后收起", async ({page}) => {
        await openFile(page, "notes/selection-bold.md", "第一段文字有好多字在这里\n");
        await dragSelect(page);
        await selectionMenu(page).getByRole("button", {name: "粗体"}).click();
        await expect(selectionMenu(page).getByRole("button", {name: "粗体"})).toHaveAttribute("aria-pressed", "true");
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/selection-bold.md")).toContain("**");
        await page.keyboard.type("后");
        await expect(selectionMenu(page)).toHaveCount(0);
    });

    test("按 Esc 收起；键盘选完也出现", async ({page}) => {
        await openFile(page, "notes/selection-esc.md", "第一段文字\n");
        await focusFirst(page);
        await page.keyboard.press("Home");
        await page.keyboard.press("Shift+End");
        await expect(selectionMenu(page)).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(selectionMenu(page)).toHaveCount(0);
    });

    test("代码块里不出现", async ({page}) => {
        await openFile(page, "notes/selection-code.md", "```\ncode here\n```\n");
        await prose(page).locator("pre").click();
        await expect(prose(page)).toBeFocused();
        await page.keyboard.press("Home");
        await page.keyboard.press("Shift+End");
        await expect(selectionMenu(page)).toHaveCount(0);
    });

    test("注音：选区菜单里输入，回车写回", async ({page}) => {
        await openFile(page, "notes/selection-ruby.md", "汉字\n");
        await focusFirst(page);
        await page.keyboard.press("Control+a");
        await expect(selectionMenu(page)).toBeVisible();
        await selectionMenu(page).getByRole("button", {name: "注音"}).click();
        const input = page.getByRole("textbox", {name: "注音"});
        await expect(input).toBeFocused();
        await input.fill("hàn zì");
        await page.keyboard.press("Enter");
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/selection-ruby.md")).toBe("<ruby text=\"hàn zì\">汉字</ruby>\n");
    });
});

test.describe("斜杠菜单", () => {
    const slash = (page: Page) => page.locator("[data-suggestion-menu]");

    test("行首打 /，拼音首字母筛选，回车换成标题；撤销一步回到 /查询", async ({page}) => {
        await openFile(page, "notes/slash-heading.md", "\n");
        await prose(page).click();
        await expect(prose(page)).toBeFocused();
        await page.keyboard.type("/");
        await expect(slash(page)).toBeVisible();
        await expect(slash(page).getByRole("option", {name: "正文"})).toBeVisible();
        // 拼音库是按需加载的：等它到了再筛。
        await expect.poll(async () => {
            await page.keyboard.type("b");
            await page.keyboard.type("t");
            const shown = await slash(page).getByRole("option", {name: "标题 1"}).count();
            if (shown === 0) {
                await page.keyboard.press("Backspace");
                await page.keyboard.press("Backspace");
            }
            return shown;
        }).toBe(1);
        await page.keyboard.press("Enter");
        await expect(slash(page)).toHaveCount(0);
        await expect(prose(page).locator("h1")).toHaveCount(1);
        await page.keyboard.press("Control+z");
        await expect(prose(page).locator("p").first()).toHaveText("/bt");
    });

    test("Esc 收起，同一处不再打开；筛不出项时不显示，回车换行", async ({page}) => {
        await openFile(page, "notes/slash-esc.md", "\n");
        await prose(page).click();
        await expect(prose(page)).toBeFocused();
        await page.keyboard.type("/");
        await expect(slash(page)).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(slash(page)).toHaveCount(0);
        await page.keyboard.type("zzzz");
        await expect(slash(page)).toHaveCount(0);
        await page.keyboard.press("Enter");
        await expect(prose(page).locator("p")).toHaveCount(2);
    });

    test("输入法组字时不打开；行首的顿号也算", async ({page}) => {
        await openFile(page, "notes/slash-ime.md", "\n");
        await prose(page).click();
        await expect(prose(page)).toBeFocused();
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Input.imeSetComposition", {text: "/", selectionStart: 1, selectionEnd: 1});
        await expect(slash(page)).toHaveCount(0);
        await cdp.send("Input.insertText", {text: "、"});
        await cdp.detach();
        await expect(prose(page).locator("p").first()).toHaveText("、");
        await expect(slash(page)).toBeVisible();
    });

    test("代码块里不打开", async ({page}) => {
        await openFile(page, "notes/slash-code.md", "```\ncode\n```\n");
        await prose(page).locator("pre").click();
        await expect(prose(page)).toBeFocused();
        await page.keyboard.type(" /");
        await expect(slash(page)).toHaveCount(0);
    });
});

test.describe("块按钮", () => {
    const gutter = (page: Page) => activeGroup(page).locator("[data-markdown-gutter]");
    const slash = (page: Page) => page.locator("[data-suggestion-menu]");
    async function hover(page: Page, text: string): Promise<void> {
        await prose(page).getByText(text, {exact: false}).first().hover();
        await expect(gutter(page)).toBeVisible();
    }

    test("指针停在块上出现按钮，右缘离正文 14px", async ({page}) => {
        await openFile(page, "notes/gutter-pos.md", "第一段\n\n第二段\n");
        await hover(page, "第二段");
        const handle = await gutter(page).boundingBox();
        const text = await prose(page).boundingBox();
        expect(Math.round((text?.x ?? 0) - ((handle?.x ?? 0) + (handle?.width ?? 0)))).toBe(14);
    });

    test("点 + 放弃：文件字节不变", async ({page}) => {
        await openFile(page, "notes/gutter-plus.md", "第一段\n");
        await hover(page, "第一段");
        await gutter(page).getByRole("button", {name: "插入块"}).click();
        await expect(slash(page)).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(slash(page)).toHaveCount(0);
        await expect(prose(page).locator("p")).toHaveCount(1);
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/gutter-plus.md")).toBe("第一段\n");
    });

    test("点 + 选标题：新块是标题", async ({page}) => {
        await openFile(page, "notes/gutter-plus-pick.md", "第一段\n");
        await hover(page, "第一段");
        await gutter(page).getByRole("button", {name: "插入块"}).click();
        await slash(page).getByRole("option", {name: "标题 2"}).click();
        await expect(prose(page).locator("h2")).toHaveCount(1);
        await page.keyboard.type("新");
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/gutter-plus-pick.md")).toBe("第一段\n\n## 新\n");
    });

    test("块菜单：下移、副本、删除", async ({page}) => {
        await openFile(page, "notes/gutter-menu.md", "一\n\n二\n");
        const open = async (text: string) => {
            await hover(page, text);
            await gutter(page).getByRole("button", {name: "块菜单"}).click();
        };
        await open("一");
        await page.getByRole("menuitem", {name: "下移"}).click();
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/gutter-menu.md")).toBe("二\n\n一\n");
        await open("二");
        await page.getByRole("menuitem", {name: "创建副本"}).click();
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/gutter-menu.md")).toBe("二\n\n二\n\n一\n");
        await open("一");
        await page.getByRole("menuitem", {name: "删除"}).click();
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/gutter-menu.md")).toBe("二\n\n二\n");
    });

    test("块菜单：转换为标题；列表项的引用置灰", async ({page}) => {
        await openFile(page, "notes/gutter-convert.md", "一\n\n- 项\n");
        await hover(page, "一");
        await gutter(page).getByRole("button", {name: "块菜单"}).click();
        await page.getByRole("menuitem", {name: "转换为"}).click();
        await page.getByRole("menuitemcheckbox", {name: "标题 1"}).click();
        await expect(prose(page).locator("h1")).toHaveText("一");
        await hover(page, "项");
        await gutter(page).getByRole("button", {name: "块菜单"}).click();
        await page.getByRole("menuitem", {name: "转换为"}).click();
        await expect(page.getByRole("menuitemcheckbox", {name: "引用"})).toBeDisabled();
    });

    test("拖动手柄移动一块；按 Esc 取消后外部拖入不插入旧块", async ({page}) => {
        await openFile(page, "notes/gutter-drag.md", "一\n\n二\n\n三\n");
        await hover(page, "三");
        const handle = await gutter(page).getByRole("button", {name: "块菜单"}).boundingBox();
        const first = await prose(page).locator("p").first().boundingBox();
        if (handle === null || first === null) throw new Error("看不见");
        await page.mouse.move(handle.x + 9, handle.y + 12);
        await page.mouse.down();
        await page.mouse.move(handle.x + 12, handle.y - 8, {steps: 3});
        await page.mouse.move(first.x + 1, first.y + 1, {steps: 6});
        await page.mouse.up();
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/gutter-drag.md")).toBe("三\n\n一\n\n二\n");

        // 取消之后 `view.dragging` 要清掉：否则下面的拖入会把旧块当成要移动的内容。
        await hover(page, "二");
        const again = await gutter(page).getByRole("button", {name: "块菜单"}).boundingBox();
        if (again === null) throw new Error("看不见");
        await page.mouse.move(again.x + 9, again.y + 12);
        await page.mouse.down();
        await page.mouse.move(again.x + 12, again.y - 20, {steps: 4});
        await page.keyboard.press("Escape");
        await page.mouse.up();
        const dragging = await prose(page).evaluate((element) => {
            const dataTransfer = new DataTransfer();
            dataTransfer.setData("text/plain", "外来的字");
            const box = element.getBoundingClientRect();
            element.dispatchEvent(new DragEvent("drop", {bubbles: true, cancelable: true, dataTransfer, clientX: box.left + 2, clientY: box.top + 2}));
            return element.textContent ?? "";
        });
        expect(dragging).toContain("外来的字");
        await page.keyboard.press("Control+s");
        const written = await disk("notes/gutter-drag.md");
        expect(written.match(/二/gu)?.length).toBe(1);
        expect(written.match(/三/gu)?.length).toBe(1);
    });

    test("Alt+↑ 移动光标所在的块", async ({page}) => {
        await openFile(page, "notes/gutter-keys.md", "一\n\n二\n");
        await prose(page).getByText("二").click();
        await expect(prose(page)).toBeFocused();
        await page.keyboard.press("Alt+ArrowUp");
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/gutter-keys.md")).toBe("二\n\n一\n");
    });
});

test.describe("右键菜单", () => {
    async function rightClick(page: Page, text: string): Promise<void> {
        await prose(page).getByText(text, {exact: false}).first().click({button: "right"});
    }

    test("没有选区时剪切、复制置灰；点在选区内保留选区", async ({page}) => {
        await openFile(page, "notes/context-state.md", "一段文字\n");
        await rightClick(page, "一段文字");
        await expect(page.getByRole("menuitem", {name: "复制"})).toBeDisabled();
        await page.keyboard.press("Escape");
        await page.keyboard.press("Control+a");
        await rightClick(page, "一段文字");
        await expect(page.getByRole("menuitem", {name: "复制"})).toBeEnabled();
        const selected = await page.evaluate(() => getSelection()?.toString() ?? "");
        expect(selected).toContain("一段文字");
    });

    test("复制后粘贴，列表结构保留", async ({page, context}) => {
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        await openFile(page, "notes/context-copy.md", "- 一\n- 二\n\n段落\n");
        await prose(page).locator("li").first().click();
        await expect(prose(page)).toBeFocused();
        await page.keyboard.press("Control+a");
        await rightClick(page, "一");
        await page.getByRole("menuitem", {name: "复制"}).click();
        await prose(page).getByText("段落").click();
        await page.keyboard.press("End");
        await page.keyboard.press("Enter");
        await rightClick(page, "段落");
        await page.getByRole("menuitem", {name: /^粘贴\s*Ctrl\+V/u}).click();
        await expect.poll(() => prose(page).locator("li").count()).toBeGreaterThan(2);
    });

    test("权限被拒时给出通知，文档不变", async ({page}) => {
        await openFile(page, "notes/context-denied.md", "字\n");
        await page.evaluate(() => {
            Object.defineProperty(navigator, "clipboard", {configurable: true, value: {
                read: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
                readText: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
            }});
        });
        await rightClick(page, "字");
        await page.getByRole("menuitem", {name: /^粘贴\s*Ctrl\+V/u}).click();
        await expect(page.getByText("浏览器没有给读取剪贴板的权限，请用 Ctrl+V")).toBeVisible();
        await expect(prose(page).locator("p").first()).toHaveText("字");
    });
});
