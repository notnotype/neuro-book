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

import {startProbeServer, startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

// 资源管理器的树是虚拟列表，用例的文件都在 notes 下：窗口高一些，靠后的文件也有行可以点（每例的文件用完就删，见 `openFile`）。
// 右栏默认开着对话（400 宽）：版心要在编辑区里放得下通栏的工具栏，视口留够宽。
test.use({viewport: {width: 1700, height: 1800}});

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
/** 活动组的头（标签条与标题动作）：在工作台的外框里，不在 `[data-editor-group]` 里面。 */
const activeHead = (page: Page) => page.locator("[data-editor-group-head-active]");
const prose = (page: Page) => activeGroup(page).locator("[data-editor-kind=\"nbook.editor.markdown\"]:visible [data-editor-prose]");
const toolbarButton = (page: Page, name: string) => activeGroup(page).locator(".markdown-toolbar").getByRole("button", {name, exact: true});
const selectionMenu = (page: Page) => page.locator("[data-markdown-selection-menu]");
const disk = (path: string): Promise<string> => readFile(join(projectDir, path), "utf8");

/**
 * 这一例经 `openFile` 写下的文件，用完删掉：资源树是虚拟列表，只渲染视口附近的行。每例都往 notes 写自己的文件，积多了排在后面的
 * 文件没有行，按行就点不到（w00025 t17：整份跑到“拆分后”那一例时，split.md 前面排着 37 个文件）。
 */
const written: string[] = [];
test.afterEach(async () => {
    for (const path of written.splice(0)) await rm(join(projectDir, path), {force: true});
});

async function openFile(page: Page, path: string, text: string): Promise<void> {
    await mkdir(dirname(join(projectDir, path)), {recursive: true});
    await writeFile(join(projectDir, path), text);
    written.push(path);
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    // 恢复会话时文件夹的展开状态还在变：读到“收起”再点，可能正好把刚展开的收起来。要等到活动标签真是这个文件。
    const name = path.split("/").at(-1) as string;
    await expect(async () => {
        const folder = item(page, "project://notes");
        if (await folder.getAttribute("aria-expanded") !== "true") await folder.click();
        await item(page, `project://${path}`).dblclick({timeout: 3000});
        await expect(activeHead(page).locator("[data-editor-tab]").filter({hasText: name})).toBeVisible({timeout: 3000});
    }).toPass();
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

    test("下拉菜单选了一项后焦点回正文，可以接着打字", async ({page}) => {
        // 下面测关闭动画结束后的焦点：配置默认减少动态效果，要开回来。
        await page.emulateMedia({reducedMotion: "no-preference"});
        await openFile(page, "notes/toolbar-dropdown.md", "字\n");
        await focusFirst(page);
        await page.keyboard.press("End");
        await activeGroup(page).locator(".markdown-toolbar").getByRole("button", {name: "块类型"}).click();
        await page.getByRole("menuitemcheckbox", {name: "标题 2"}).click();
        await expect(prose(page).locator("h2")).toHaveCount(1);
        await expect(prose(page)).toBeFocused();
        // 菜单的关闭动画结束后焦点也不被抢走。
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(prose(page)).toBeFocused();
        await toolbarButton(page, "更多操作").click();
        await page.getByRole("menuitem", {name: "分割线"}).click();
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(prose(page)).toBeFocused();
        await page.keyboard.type("后");
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/toolbar-dropdown.md")).toContain("后");
    });

    test("版心变窄时收进“更多操作”，没有横向滚动", async ({page}) => {
        await openFile(page, "notes/toolbar-narrow.md", "字\n");
        const row = activeGroup(page).locator(".markdown-toolbar [role=\"toolbar\"]");
        await expect(toolbarButton(page, "清除格式")).toBeVisible();
        await page.setViewportSize({width: 620, height: 700});
        await expect(toolbarButton(page, "清除格式")).toHaveCount(0);
        await expect(toolbarButton(page, "更多操作")).toBeVisible();
        const {scrollWidth, clientWidth} = await row.evaluate((element) => ({scrollWidth: element.scrollWidth, clientWidth: element.clientWidth}));
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
        await toolbarButton(page, "更多操作").click();
        await expect(page.getByRole("menuitem", {name: "清除格式"})).toBeVisible();
    });

    test("文字颜色是拆分按钮：左半边用上次的颜色（第一次是红色），箭头开色板，选了记住，刷新后仍记得（输出 1）", async ({page}) => {
        await openFile(page, "notes/toolbar-color.md", "一二三\n");
        const bar = activeGroup(page).locator(".markdown-toolbar [data-markdown-color-bar]").first();
        await expect(bar).toHaveCSS("background-color", "rgb(239, 68, 68)");
        await focusFirst(page);
        await page.keyboard.press("Control+a");
        await toolbarButton(page, "文字颜色").click();
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/toolbar-color.md")).toBe("<span style=\"color: #ef4444\">一二三</span>\n");

        // 选区还在、选区菜单本来开着：工具栏的色板开着时选区菜单收起，不盖住色板。
        await toolbarButton(page, "选择文字颜色").click();
        await expect(selectionMenu(page)).toHaveCount(0);
        await page.locator("[data-color-swatch=\"#0ea5e9\"]").click();
        await expect(bar).toHaveCSS("background-color", "rgb(14, 165, 233)");
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/toolbar-color.md")).toBe("<span style=\"color: #0ea5e9\">一二三</span>\n");

        // 刷新页面、换一个文件：仍是上次的颜色，左半边直接用它。
        await openFile(page, "notes/toolbar-color-2.md", "四五\n");
        await expect(bar).toHaveCSS("background-color", "rgb(14, 165, 233)");
        await focusFirst(page);
        await page.keyboard.press("Control+a");
        await toolbarButton(page, "文字颜色").click();
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/toolbar-color-2.md")).toBe("<span style=\"color: #0ea5e9\">四五</span>\n");
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

test.describe("工具栏的位置", () => {
    const settings = (): string => join(tmp, "state", "settings.json");
    test.afterEach(async () => {
        await rm(settings(), {force: true});
    });

    test("缺省通栏：占满这一列，在面包屑下面，按钮居中、和版心同一条中轴", async ({page}) => {
        await openFile(page, "notes/place-full.md", "字\n");
        const toolbar = await activeGroup(page).locator(".markdown-toolbar").boundingBox();
        const crumbs = await activeGroup(page).locator("[data-editor-breadcrumbs]").boundingBox();
        const group = await activeGroup(page).boundingBox();
        expect(toolbar?.x).toBe(crumbs?.x);
        expect(toolbar?.width).toBe(group?.width);
        expect((toolbar?.y ?? 0)).toBeGreaterThanOrEqual((crumbs?.y ?? 0) + (crumbs?.height ?? 0));
        const buttons = await activeGroup(page).locator(".markdown-toolbar").getByRole("button").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()).map(({left, right}) => ({left, right})));
        const middle = ((buttons[0]?.left ?? 0) + (buttons.at(-1)?.right ?? 0)) / 2;
        const text = await prose(page).boundingBox();
        expect(Math.abs(middle - ((text?.x ?? 0) + (text?.width ?? 0) / 2))).toBeLessThan(8);
    });

    test("并入面包屑：同一行，切到源码编辑器时不留着", async ({page}) => {
        await writeFile(settings(), JSON.stringify({"nbook.editor/markdownToolbarPlacement": "merged"}));
        await writeFile(join(projectDir, "notes/place-code.txt"), "code\n");
        await openFile(page, "notes/place-merged.md", "字\n");
        const toolbar = activeGroup(page).locator(".markdown-toolbar");
        await expect(toolbar).toBeVisible();
        const bar = await toolbar.boundingBox();
        const crumbs = await activeGroup(page).locator("[data-editor-breadcrumbs]").boundingBox();
        expect(Math.abs((bar?.y ?? 0) + (bar?.height ?? 0) / 2 - ((crumbs?.y ?? 0) + (crumbs?.height ?? 0) / 2))).toBeLessThan(4);
        expect((bar?.x ?? 0)).toBeGreaterThanOrEqual((crumbs?.x ?? 0) + (crumbs?.width ?? 0) - 1);
        await toolbarButton(page, "粗体").waitFor();
        await item(page, "project://notes/place-code.txt").dblclick();
        await expect(toolbar).toHaveCount(0);
    });

    test("底部浮条：按钮能用，滚到底时不挡最后一行", async ({page}) => {
        await writeFile(settings(), JSON.stringify({"nbook.editor/markdownToolbarPlacement": "bottom"}));
        const paragraphs = Array.from({length: 40}, (_, index) => `第 ${String(index)} 段`).join("\n\n");
        await openFile(page, "notes/place-bottom.md", `${paragraphs}\n`);
        const toolbar = activeGroup(page).locator(".markdown-toolbar");
        await expect(toolbar).toBeVisible();
        const last = prose(page).locator("p").last();
        await last.scrollIntoViewIfNeeded();
        await activeGroup(page).locator("[data-editor-control=\"markdown\"]").evaluate((element) => element.scrollTo({top: element.scrollHeight}));
        await expect.poll(async () => {
            const bar = await toolbar.boundingBox();
            const text = await last.boundingBox();
            return (text?.y ?? 0) + (text?.height ?? 0) <= (bar?.y ?? 0);
        }).toBe(true);
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

    test("块类型在最前面：选“标题 2”后这一段变成标题，焦点回正文（输出 6）", async ({page}) => {
        // 测关闭动画结束后的焦点：配置默认减少动态效果，要开回来。
        await page.emulateMedia({reducedMotion: "no-preference"});
        await openFile(page, "notes/selection-block.md", "第一段文字\n");
        await focusFirst(page);
        await page.keyboard.press("Home");
        await page.keyboard.press("Shift+End");
        const trigger = selectionMenu(page).getByRole("button", {name: /块类型/u});
        await expect(trigger).toHaveAccessibleName("块类型：正文");
        await trigger.click();
        // 焦点在下拉里时选区菜单仍算有焦点。
        await expect(selectionMenu(page)).toBeVisible();
        await page.getByRole("menuitemcheckbox", {name: "标题 2"}).click();
        await expect(prose(page).locator("h2")).toHaveText("第一段文字");
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(prose(page)).toBeFocused();
        await expect(trigger).toHaveAccessibleName("块类型：标题 2");
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/selection-block.md")).toBe("## 第一段文字\n");
    });

    test("高亮是拆分按钮：左半边第一次是黄色，色板里点已选的黄色也上色；色板开着时菜单留着，选了记住（输出 6）", async ({page}) => {
        await openFile(page, "notes/selection-highlight.md", "一二三\n");
        await focusFirst(page);
        await page.keyboard.press("Control+a");
        const bar = selectionMenu(page).locator("[data-markdown-color-bar]").nth(1);
        await expect(bar).toHaveCSS("background-color", "rgb(254, 249, 195)");
        const palette = selectionMenu(page).getByRole("button", {name: "选择高亮颜色"});
        // 色板里标着已选的是上次的颜色（第一次是黄色）：点它照样上色、色板收起。
        await palette.click();
        await page.locator("[data-color-swatch=\"#fef9c3\"]").click();
        await expect(page.locator("[data-color-swatch=\"#fef9c3\"]")).toHaveCount(0);
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/selection-highlight.md")).toBe("<mark style=\"background-color: #fef9c3\">一二三</mark>\n");
        await palette.click();
        await expect(selectionMenu(page)).toBeVisible();
        await page.locator("[data-color-swatch=\"#dbeafe\"]").click();
        await expect(prose(page)).toBeFocused();
        await expect(bar).toHaveCSS("background-color", "rgb(219, 234, 254)");
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/selection-highlight.md")).toBe("<mark style=\"background-color: #dbeafe\">一二三</mark>\n");
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

    test("切标签回来恢复的选区不弹菜单；组件重挂后菜单照常", async ({page}) => {
        await openFile(page, "notes/selection-restore.md", "第一段文字\n");
        await writeFile(join(projectDir, "notes/selection-other.md"), "别的\n");
        await focusFirst(page);
        await page.keyboard.press("Control+a");
        await expect(selectionMenu(page)).toBeVisible();
        await item(page, "project://notes/selection-other.md").dblclick();
        await expect(selectionMenu(page)).toHaveCount(0);
        await page.locator("[data-editor-tab]").filter({hasText: "selection-restore.md"}).click();
        await expect(prose(page)).toContainText("第一段文字");
        await prose(page).focus();
        await expect(selectionMenu(page)).toHaveCount(0);

        // 拆分让这一组的控件重挂：编辑器实例接着用，菜单要重新接上。
        await page.locator("[data-editor-group-head-active] [data-title-action-key=\"own:split-right\"]").click();
        await expect(page.locator("[data-editor-group]")).toHaveCount(2);
        const left = page.locator("[data-editor-group]").first();
        await left.locator("[data-editor-prose] p").first().click();
        await expect(left.locator("[data-editor-prose]")).toBeFocused();
        await page.keyboard.press("Control+a");
        await expect(selectionMenu(page)).toBeVisible();
    });

    test("注音的输入框：点别处时收起", async ({page}) => {
        await openFile(page, "notes/selection-prompt.md", "汉字\n");
        await focusFirst(page);
        await page.keyboard.press("Control+a");
        await selectionMenu(page).getByRole("button", {name: "注音"}).click();
        const input = page.getByRole("textbox", {name: "注音"});
        await expect(input).toBeFocused();
        await prose(page).locator("p").first().click();
        await expect(input).toHaveCount(0);
    });

    test("代码块里不出现", async ({page}) => {
        await openFile(page, "notes/selection-code.md", "```\ncode here\n```\n");
        await prose(page).locator("pre").click();
        await expect(prose(page)).toBeFocused();
        await page.keyboard.press("Home");
        await page.keyboard.press("Shift+End");
        await expect(selectionMenu(page)).toHaveCount(0);
    });

    test("注音：选区菜单里打开卡片，写的时候选区仍画着，回车写回（输出 9）", async ({page}) => {
        await openFile(page, "notes/selection-ruby.md", "汉字\n");
        await focusFirst(page);
        await page.keyboard.press("Control+a");
        await expect(selectionMenu(page)).toBeVisible();
        await selectionMenu(page).getByRole("button", {name: "注音"}).click();
        const input = page.getByRole("textbox", {name: "注音"});
        await expect(input).toBeFocused();
        await expect(input).toHaveValue("");
        // 新加注音没有移除按钮。
        await expect(page.locator("[data-markdown-text-prompt]").getByRole("button")).toHaveCount(1);
        // 焦点在卡片里，浏览器不画正文的选区：正文自己画，与浏览器画的选区同是主题的选区色。
        const held = prose(page).locator(".nb-markdown-held-selection");
        await expect(held).toHaveText("汉字");
        const colors = await held.evaluate((element) => {
            const probe = document.createElement("div");
            probe.style.backgroundColor = "var(--selection-bg)";
            document.body.append(probe);
            const expected = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return {held: getComputedStyle(element).backgroundColor, native: getComputedStyle(element, "::selection").backgroundColor, expected};
        });
        expect(colors).toEqual({held: colors.expected, native: colors.expected, expected: colors.expected});
        await input.fill("hàn zì");
        await page.keyboard.press("Enter");
        await expect(held).toHaveCount(0);
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/selection-ruby.md")).toBe("<ruby text=\"hàn zì\">汉字</ruby>\n");
    });

    test("已有注音：点注音小字打开修改；选中时注音按钮按下，卡片预填、可以移除；清空回车不移除（输出 9）", async ({page}) => {
        await openFile(page, "notes/selection-ruby-edit.md", "前<ruby text=\"zhù yīn\">注音</ruby>后\n");
        const input = page.getByRole("textbox", {name: "注音"});
        const card = page.locator("[data-markdown-text-prompt]");
        await prose(page).locator(".nb-ruby-text").click();
        await expect(input).toBeFocused();
        await expect(input).toHaveValue("zhù yīn");
        await expect(prose(page).locator(".nb-markdown-held-selection")).toHaveText("注音");
        await input.fill("zhuyin");
        await card.getByRole("button", {name: "确定"}).click();
        await expect(input).toHaveCount(0);
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/selection-ruby-edit.md")).toBe("前<ruby text=\"zhuyin\">注音</ruby>后\n");

        // 选区盖住注音的一部分也算有注音。
        await focusFirst(page);
        await page.keyboard.press("Home");
        await page.keyboard.press("Shift+ArrowRight");
        await page.keyboard.press("Shift+ArrowRight");
        const rubyButton = selectionMenu(page).getByRole("button", {name: "注音"});
        await expect(rubyButton).toHaveAttribute("aria-pressed", "true");
        await rubyButton.click();
        await expect(input).toHaveValue("zhuyin");
        await input.fill("");
        await page.keyboard.press("Enter");
        await expect(input).toHaveCount(0);
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/selection-ruby-edit.md")).toBe("前<ruby text=\"zhuyin\">注音</ruby>后\n");

        await rubyButton.click();
        await card.getByRole("button", {name: "移除注音"}).click();
        await expect(input).toHaveCount(0);
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/selection-ruby-edit.md")).toBe("前注音后\n");
    });

    test("卡片开着时点另一段注音的小字：卡片换到那一段、重新预填，读音相同也一样（输出 9）", async ({page}) => {
        await openFile(page, "notes/selection-ruby-switch.md", "<ruby text=\"lín\">林</ruby>和<ruby text=\"lín\">霖</ruby>\n");
        const input = page.getByRole("textbox", {name: "注音"});
        const rubies = prose(page).locator(".nb-ruby-text");
        await rubies.nth(0).click();
        await expect(input).toHaveValue("lín");
        await input.fill("改了一半");
        await rubies.nth(1).click();
        await expect(input).toBeFocused();
        await expect(input).toHaveValue("lín");
        await expect(prose(page).locator(".nb-markdown-held-selection")).toHaveText("霖");
        await input.fill("lín2");
        await page.keyboard.press("Enter");
        await expect(input).toHaveCount(0);
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/selection-ruby-switch.md")).toBe("<ruby text=\"lín\">林</ruby>和<ruby text=\"lín2\">霖</ruby>\n");
    });

    test("注音是一个整体：拖选不带注音小字，从注音中间加粗时整段注音一起加粗（输出 26、场景 7）", async ({page}) => {
        await openFile(page, "notes/selection-whole-ruby.md", "前文<ruby text=\"zhù yīn\">注音</ruby>后文\n");
        const base = prose(page).locator(".nb-ruby-base");
        const box = await base.boundingBox();
        if (box === null) throw new Error("注音不可见");
        // 从“注”与“音”之间按下，拖到“后文”的中间：经过注音小字所在的那一行。
        const y = box.y + box.height / 2;
        await page.mouse.move(box.x + box.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width + 20, y, {steps: 6});
        await page.mouse.up();
        await expect(selectionMenu(page)).toBeVisible();
        expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).not.toContain("zhù");
        await page.keyboard.press("Control+b");
        await expect(prose(page).locator("rt")).toHaveCount(1);
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/selection-whole-ruby.md")).toBe("前文**<ruby text=\"zhù yīn\">注音</ruby>后**文\n");
    });

    test("含注音的行里 Home、End 与加 Shift 的选区到真正的行首行尾，折行的段落每一行都对（输出 27、场景 10）", async ({page}) => {
        const wrapped = "她抬头看了他一眼，远处站着<ruby text=\"hàn zì\">汉字</ruby>先生，" + "手里拿着一本很厚的书，一页一页地翻着，像是在找什么东西，又像是只想让时间过得慢一点。".repeat(6);
        await openFile(page, "notes/ruby-line-edges.md", `前<ruby text="lín xī">林汐</ruby>后，一行。\n\n${wrapped}\n`);
        const selected = () => page.evaluate(() => window.getSelection()?.toString() ?? "");
        // 一行的段落：注音在行中间，行尾在注音之后。
        await prose(page).locator("p").nth(0).click({position: {x: 3, y: 10}});
        await expect(prose(page)).toBeFocused();
        await page.keyboard.press("Home");
        await page.keyboard.press("Shift+End");
        expect(await selected()).toBe("前林汐后，一行。");
        await page.keyboard.press("End");
        await page.keyboard.press("Shift+Home");
        expect(await selected()).toBe("前林汐后，一行。");

        // 折行的段落：按渲染出来的行（逐字取矩形）认每一行的文字与位置，注音的小字不算。
        const lines = await prose(page).locator("p").nth(1).evaluate((paragraph) => {
            const found: Array<{text: string; top: number}> = [];
            const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
                if (node.parentElement?.closest(".nb-ruby-text") != null) continue;
                for (let index = 0; index < node.length; index += 1) {
                    const range = document.createRange();
                    range.setStart(node, index);
                    range.setEnd(node, index + 1);
                    const rect = range.getBoundingClientRect();
                    if (rect.height === 0) continue;
                    const last = found.at(-1);
                    if (last === undefined || rect.top > last.top + 12) found.push({text: "", top: rect.top});
                    (found.at(-1) as {text: string}).text += node.data[index];
                }
            }
            const origin = paragraph.getBoundingClientRect().top;
            return found.map((line) => ({text: line.text, y: line.top - origin}));
        });
        expect(lines.length).toBeGreaterThan(2);
        expect(lines[0]?.text).toContain("汉字");
        for (const line of lines) {
            await prose(page).locator("p").nth(1).click({position: {x: 40, y: line.y + 8}});
            await page.keyboard.press("Home");
            await page.keyboard.press("Shift+End");
            expect(await selected()).toBe(line.text);
            // 行尾的光标画在这一行的末尾：再往回选到行首，选中的还是这一整行。
            await page.keyboard.press("End");
            await page.keyboard.press("Shift+Home");
            expect(await selected()).toBe(line.text);
        }
    });

    test("选区菜单淡入、淡出，淡出时停在原处；斜杠菜单只淡入（设计语言“浮层入退场的编排是固定的”）", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await openFile(page, "notes/selection-motion.md", "第一段文字，长一些，好在别处点。\n\n第二段\n");
        // 把浮层的时长放慢到 3 秒：退场期间来得及量，也分得清“立即拿掉”和“淡出”。
        await page.addStyleTag({content: ":root { --motion-fast: 3000ms !important; }"});
        // 变量的原文与计算值写法不同（`.23` 与 `0.23`）：放到一个元素上，取计算后的写法来比。
        const easeLayout = await page.evaluate(() => {
            const probe = document.createElement("div");
            probe.style.animationTimingFunction = "var(--ease-layout)";
            document.body.append(probe);
            const value = getComputedStyle(probe).animationTimingFunction;
            probe.remove();
            return value;
        });
        const surface = page.locator("[data-anchored-popover]");
        const motion = () => surface.evaluate((element) => ({
            name: getComputedStyle(element).animationName,
            easing: getComputedStyle(element).animationTimingFunction,
            state: element.getAttribute("data-state"),
            // 定位写在原语外包的那一层上。
            at: (element.parentElement as HTMLElement).style.transform,
        }));
        await dragSelect(page);
        await expect(selectionMenu(page)).toBeVisible();
        const opened = await motion();
        expect(opened).toMatchObject({name: "nb-popover-in", easing: easeLayout, state: "open"});
        // 点到第二段：选区换成那里的光标，菜单淡出，淡出期间不跟着跳。
        await prose(page).locator("p").nth(1).click();
        expect(await motion()).toMatchObject({name: "nb-popover-out", state: "closed", at: opened.at});
        await expect(surface).toHaveCount(0, {timeout: 10_000});

        await page.keyboard.press("End");
        await page.keyboard.press("Enter");
        await page.keyboard.type("/");
        const slash = page.locator("[data-suggestion-menu]");
        await expect(slash).toBeVisible();
        expect(await slash.evaluate((element) => getComputedStyle(element).animationName)).toBe("nb-popover-in");
        await page.keyboard.press("Escape");
        // 只入场：关上就拿掉，不等 3 秒的淡出。
        await expect(slash).toHaveCount(0, {timeout: 1000});
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

    test("光标所在的块常显按钮：指针不在也有，打字时跟着，选中内容时不显示，失焦时收起", async ({page}) => {
        await openFile(page, "notes/gutter-caret.md", "第一段\n\n第二段\n");
        await prose(page).getByText("第二段").click();
        await expect(prose(page)).toBeFocused();
        await page.mouse.move(5, 5);
        await expect(gutter(page)).toBeVisible();
        const second = await prose(page).locator("p").nth(1).boundingBox();
        const atSecond = await gutter(page).boundingBox();
        expect(Math.abs((atSecond?.y ?? 0) - (second?.y ?? 0))).toBeLessThan(16);

        await page.keyboard.press("ArrowUp");
        const first = await prose(page).locator("p").first().boundingBox();
        await expect.poll(async () => Math.abs(((await gutter(page).boundingBox())?.y ?? 0) - (first?.y ?? 0))).toBeLessThan(16);

        await page.keyboard.press("End");
        await page.keyboard.press("Enter");
        await page.keyboard.type("新");
        const third = await prose(page).locator("p").nth(1).boundingBox();
        await expect.poll(async () => Math.abs(((await gutter(page).boundingBox())?.y ?? 0) - (third?.y ?? 0))).toBeLessThan(16);

        await page.keyboard.press("Shift+Home");
        await expect(gutter(page)).toHaveCount(0);
        await page.keyboard.press("End");
        await expect(gutter(page)).toBeVisible();

        await gutter(page).getByRole("button", {name: "块菜单"}).click();
        await expect(page.getByRole("menuitem", {name: "创建副本"})).toBeVisible();
        await page.keyboard.press("Escape");

        await item(page, "project://notes").click();
        await expect(gutter(page)).toHaveCount(0);
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

    test("点 + 后用输入法打字：块不被删掉，放弃时才删", async ({page}) => {
        await openFile(page, "notes/gutter-plus-ime.md", "第一段\n");
        await hover(page, "第一段");
        await gutter(page).getByRole("button", {name: "插入块"}).click();
        await expect(slash(page)).toBeVisible();
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Input.imeSetComposition", {text: "b", selectionStart: 1, selectionEnd: 1});
        await expect(prose(page).locator("p")).toHaveCount(2);
        await expect(slash(page)).toHaveCount(0);
        await cdp.send("Input.imeSetComposition", {text: "", selectionStart: 0, selectionEnd: 0});
        await cdp.detach();
        await expect(prose(page).locator("p")).toHaveCount(2);
    });

    test("点 + 后筛不出项再退回：放弃时这一块还是被删掉", async ({page}) => {
        await openFile(page, "notes/gutter-plus-none.md", "第一段\n");
        await hover(page, "第一段");
        await gutter(page).getByRole("button", {name: "插入块"}).click();
        await expect(slash(page)).toBeVisible();
        await page.keyboard.type("zz");
        await expect(slash(page)).toHaveCount(0);
        await page.keyboard.press("Backspace");
        await page.keyboard.press("Backspace");
        await expect(slash(page)).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(prose(page).locator("p")).toHaveCount(1);
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/gutter-plus-none.md")).toBe("第一段\n");
    });

    test("折叠的提示块：手柄在块旁边，块菜单能用", async ({page}) => {
        await openFile(page, "notes/gutter-fold.md", "一\n\n> [!NOTE]- 折叠\n> 内容\n");
        const callout = prose(page).locator("[data-callout]");
        await callout.hover();
        await expect(gutter(page)).toBeVisible();
        const handle = await gutter(page).boundingBox();
        const box = await callout.boundingBox();
        expect(Math.abs((handle?.y ?? 0) - (box?.y ?? 0))).toBeLessThan(40);
        await gutter(page).getByRole("button", {name: "块菜单"}).click();
        await page.getByRole("menuitem", {name: "删除"}).click();
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/gutter-fold.md")).toBe("一\n");
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
        // 菜单收起之后焦点才回到正文：这之前的 Ctrl+A 按在菜单上。
        await expect(page.getByRole("menu")).toHaveCount(0);
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

    test("点在选区外时光标移到点击处；点在分割线上不出错", async ({page}) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await openFile(page, "notes/context-outside.md", "第一段\n\n---\n\n第二段\n");
        await focusFirst(page);
        await page.keyboard.press("Home");
        await page.keyboard.press("Shift+End");
        await expect(selectionMenu(page)).toBeVisible();
        await prose(page).getByText("第二段").click({button: "right"});
        await expect(page.getByRole("menuitem", {name: "全选"})).toBeVisible();
        await page.keyboard.press("Escape");
        expect(await page.evaluate(() => getSelection()?.toString() ?? "")).toBe("");
        await page.keyboard.type("后");
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/context-outside.md")).toContain("第二段后");
        await prose(page).locator("hr").click({button: "right"});
        await expect(page.getByRole("menuitem", {name: "全选"})).toBeVisible();
        expect(errors).toEqual([]);
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

test.describe("拆分后", () => {
    test("工具栏显示自己这一组的状态；右键点别的组时它变成活动组", async ({page}) => {
        await openFile(page, "notes/split.md", "**粗**\n\n普通\n");
        await prose(page).locator("strong").click();
        await expect(prose(page)).toBeFocused();
        await expect(toolbarButton(page, "粗体")).toHaveAttribute("aria-pressed", "true");
        await page.locator("[data-editor-group-head-active] [data-title-action-key=\"own:split-right\"]").click();
        await expect(page.locator("[data-editor-group]")).toHaveCount(2);
        const groups = page.locator("[data-editor-group]");
        const right = groups.nth(1);
        await right.locator("[data-editor-prose]").getByText("普通").click();
        await expect(right).toHaveAttribute("data-editor-group-active", "");
        await expect(right.locator(".markdown-toolbar").getByRole("button", {name: "粗体", exact: true})).toHaveAttribute("aria-pressed", "false");
        const left = groups.nth(0);
        await expect(left.locator(".markdown-toolbar").getByRole("button", {name: "粗体", exact: true})).toHaveAttribute("aria-pressed", "true");
        await left.locator("[data-editor-prose]").getByText("普通").click({button: "right"});
        await expect(left).toHaveAttribute("data-editor-group-active", "");
    });
});

test.describe("只读", () => {
    test("文件被外部删除后：工具栏置灰且版面不跳，没有块按钮，右键只有复制与全选", async ({page}) => {
        await openFile(page, "notes/readonly.md", "字\n");
        const toolbar = activeGroup(page).locator(".markdown-toolbar");
        const before = await toolbar.boundingBox();
        await expect(toolbarButton(page, "粗体")).toBeEnabled();
        await rm(join(projectDir, "notes/readonly.md"));
        await expect(toolbarButton(page, "粗体")).toBeDisabled();
        const after = await toolbar.boundingBox();
        expect(after?.height).toBe(before?.height);
        await prose(page).locator("p").first().hover();
        await expect(activeGroup(page).locator("[data-markdown-gutter]")).toHaveCount(0);
        await prose(page).locator("p").first().click({button: "right"});
        await expect(page.getByRole("menuitem", {name: "全选"})).toBeVisible();
        await expect(page.getByRole("menuitem", {name: "复制"})).toBeVisible();
        await expect(page.getByRole("menuitem", {name: "剪切"})).toHaveCount(0);
    });
});

test.describe("插件贡献的菜单项", () => {
    let probe: Awaited<ReturnType<typeof startProbeServer>>;
    let root = "";

    test.beforeAll(async () => {
        root = await createTestTmpRoot("neuro-book-e2e", "markdown-editing-contrib");
        const book = join(root, "Book");
        const stateRoot = join(root, "state");
        const id = randomUUID();
        await mkdir(join(book, ".nbook"), {recursive: true});
        await mkdir(join(stateRoot, "user"), {recursive: true});
        await writeFile(join(book, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
        await writeFile(join(book, "a.md"), "第一段文字\n");
        await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: book}]}));
        probe = await startProbeServer(stateRoot, {env: {NBOOK_TEST_PLUGINS: "test.menus"}});
    });
    test.afterAll(async () => {
        expect(await probe.stop()).toBe(0);
        if (root !== "") await rm(root, {recursive: true, force: true});
    });

    test("五个位置都有，排在内置项之后，点了收到活动标签的地址", async ({page}) => {
        const received = `收到 ${JSON.stringify({address: "project://a.md"})}`;
        await page.setViewportSize({width: 1860, height: 900});
        await page.goto(new URL("/?project=book", probe.url).href);
        await item(page, "project://a.md").dblclick();
        await expect(prose(page)).toBeVisible();
        const notice = page.getByText(received);

        // 工具栏：通栏时放得下，排在内置按钮之后。
        const toolbar = activeGroup(page).locator(".markdown-toolbar");
        const titles = await toolbar.getByRole("button").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("title")));
        expect(titles.indexOf("测试工具栏项")).toBeGreaterThan(titles.indexOf("清除格式"));
        await toolbar.getByRole("button", {name: "测试工具栏项"}).click();
        await expect(notice.first()).toBeVisible();

        // 选区菜单
        await prose(page).locator("p").first().click();
        await expect(prose(page)).toBeFocused();
        await page.keyboard.press("Control+a");
        await expect(selectionMenu(page).getByRole("button", {name: "测试选区项"})).toBeVisible();

        // 右键
        await prose(page).locator("p").first().click({button: "right"});
        await expect(page.getByRole("menuitem", {name: "测试右键项目"})).toBeVisible();
        await page.keyboard.press("Escape");

        // 块菜单
        await prose(page).locator("p").first().hover();
        await activeGroup(page).locator("[data-markdown-gutter]").getByRole("button", {name: "块菜单"}).click();
        await expect(page.getByRole("menuitem", {name: "测试块菜单项"})).toBeVisible();
        await page.keyboard.press("Escape");

        // 斜杠菜单
        await prose(page).locator("p").first().click();
        await page.keyboard.press("End");
        await page.keyboard.type(" /测试");
        await expect(page.locator("[data-suggestion-menu]").getByRole("option", {name: "测试斜杠项"})).toBeVisible();
    });
});
