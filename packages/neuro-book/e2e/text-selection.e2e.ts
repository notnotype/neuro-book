/**
 * 文字能否选中在真实 Chrome 里的验收（docs/specs/runtime/browser-host.md 输出 12 的“文字选择”）：桌面壳里（像预加载脚本那样在
 * `<html>` 上设 `data-desktop-frame`）界面框架的文字不能选中、内容可选；浏览器里没有全局规则，框架控件各自写了不可选。
 * 生产构建的后端与前端，项目 `book` 先登记好。
 *
 * 判法：找到含某段文案的文本节点，把选区设成整个节点，读 `Selection.toString()`，即用户能复制走的文字。不可选的读出空串
 * （`Range.toString()` 不看这一点）。先断言节点存在，读出空串才算数。不对整块区域 `selectAllChildren`：根上默认不可选时，Chromium
 * 会按区域首尾落在哪类元素上挪动选区端点，读数时有时无（t22 实测）。另有一条真实指针双击，覆盖起选区本身。
 */

import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Locator, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import {markFirstRunSeen} from "./support/desktop-shell";
import type {ProductServer} from "./fixtures";

let tmp = "";
let server: ProductServer;

test.beforeAll(async ({browser}) => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "text-selection");
    const projectDir = join(tmp, "Book");
    const stateRoot = join(tmp, "state");
    const id = randomUUID();
    const files: Record<string, string | Uint8Array> = {
        ".nbook/project.json": JSON.stringify({schema: 1, id}),
        // 原样的 HTML 块与行内 HTML 在编辑器里是不可编辑的原子节点（`contenteditable=false`）。
        "note.md": "# 标题\n\n正文一段，有些文字。\n\n<div>原样块文字</div>\n\n行内 <kbd>键</kbd> 文字。\n",
        "manual.pdf": new Uint8Array(64 * 1024).fill(0x25),
    };
    for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(projectDir, path)), {recursive: true});
        await writeFile(join(projectDir, path), content);
    }
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    server = await startProductServer(stateRoot);
    // 首次启动向导会在桌面窗口里弹出、挡住用例：先在这个状态根上记下看过（desktop-shell 输出 34）。
    await markFirstRunSeen(browser, server.url, stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 像桌面壳的预加载脚本那样：只读的能力标记、`<html>` 上的属性；发送函数是空的。 */
async function installFrame(page: Page): Promise<void> {
    await page.addInitScript(() => {
        Object.defineProperty(window, "__nbookDesktopFrame", {value: 1, writable: false, configurable: false, enumerable: false});
        const mark = (): boolean => document.documentElement !== null && (document.documentElement.setAttribute("data-desktop-frame", ""), true);
        if (!mark()) {
            const observer = new MutationObserver(() => void (mark() && observer.disconnect()));
            observer.observe(document, {childList: true});
        }
        (window as unknown as {__electrobunSendToHost: (message: unknown) => void}).__electrobunSendToHost = () => undefined;
    });
}

/** 区域里第一个含 `needle` 的文本节点整个选中后，用户能复制走的文字；没有这样的节点时是 `null`。读完清掉选区。 */
const copyable = (region: Locator, needle: string): Promise<string | null> => region.first().evaluate((root, wanted) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (!(node.textContent ?? "").includes(wanted)) continue;
        const selection = getSelection()!;
        selection.setBaseAndExtent(node, 0, node, node.textContent!.length);
        const text = selection.toString();
        selection.removeAllRanges();
        return text;
    }
    return null;
}, needle);

// 先等文字出现（`toContainText` 读的是文字内容，与能不能选无关），再读选区：有的区域由懒激活的插件晚一步画出来。
async function expectSelectable(region: Locator, needle: string): Promise<void> {
    await expect(region.first()).toContainText(needle);
    expect(await copyable(region, needle), `“${needle}”应当可选`).toContain(needle);
}

async function expectNotSelectable(region: Locator, needle: string): Promise<void> {
    await expect(region.first()).toContainText(needle);
    expect(await copyable(region, needle), `“${needle}”应当不可选（且在页面上）`).toBe("");
}

const item = (page: Page, address: string) => page.locator(`[data-explorer-row="${address}"]`);
const prose = (page: Page) => page.locator("[data-editor-group-active] .markdown-control__prose");

async function openNote(page: Page): Promise<void> {
    await page.setViewportSize({width: 1400, height: 900});
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await item(page, "project://note.md").dblclick();
    await expect(prose(page)).toContainText("正文一段");
    await expect(prose(page).locator("[data-nb-raw-block]")).toContainText("原样块文字");
}

async function openSettings(page: Page): Promise<Locator> {
    await page.keyboard.press("Control+,");
    const window = page.locator("[data-settings-window]");
    await expect(window.locator(".settings-row__description").first()).toBeVisible();
    return window;
}

/**
 * 工作台的框架文字（清点时的真实字符串）：面板头、状态栏在改动之前就不可选；编辑器标签、面包屑、Markdown 工具栏是本 Task 在浏览器里
 * 补的；会话面板的空态说明没有自己声明，只有桌面的全局规则管它。
 */
const tabLabel = (page: Page) => page.locator("[data-editor-tab-label]", {hasText: "note.md"});
const crumbs = (page: Page) => page.locator("[data-editor-breadcrumbs]");
const blockType = (page: Page) => page.locator(".markdown-block-type");
const sessionPanel = (page: Page) => page.locator("[data-agent-session-panel]");
/** 会话面板在右轨的完整列表里（conversation.md 输出 57）：点底段“会话历史”展开右轨才有。 */
const openSessionPanel = async (page: Page): Promise<void> => {
    await page.locator('[data-messages-open="sessions"]').click();
    await expect(sessionPanel(page)).toBeVisible();
};

async function expectWorkbenchChrome(page: Page): Promise<void> {
    await expectNotSelectable(tabLabel(page), "note.md");
    await expectNotSelectable(crumbs(page), "note.md");
    await expectNotSelectable(blockType(page), (await blockType(page).innerText()).trim());
    await expectNotSelectable(page.locator(".workbench-panel-head__label", {hasText: "资源管理器"}), "资源管理器");
    await expectNotSelectable(page.locator("[data-workbench-status-bar]"), "显示面板");
}

async function expectSettingsChrome(window: Locator): Promise<void> {
    await expectNotSelectable(window.locator(".settings-window__nav"), "写作助手");
    await expectNotSelectable(window.locator(".settings-list-section__group-title"), (await window.locator(".settings-list-section__group-title").first().innerText()).trim());
}

test("桌面：工作台里框架文字不可选，正文与其中不可编辑的原样块可选", async ({page}) => {
    await installFrame(page);
    await openNote(page);
    await expectSelectable(prose(page), "正文一段");
    await expectSelectable(prose(page), "原样块文字");
    await expectSelectable(prose(page), "<kbd>");
    await expectWorkbenchChrome(page);
    await openSessionPanel(page);
    await expect(sessionPanel(page)).toContainText("没有会话");
    await expectNotSelectable(sessionPanel(page), "没有会话");
});

test("桌面：设置窗口里设置名与说明可选，左侧导航与小组标题不可选；搜索框照常能输入、全选", async ({page}) => {
    await installFrame(page);
    await openNote(page);
    const window = await openSettings(page);
    await expectSelectable(window.locator(".settings-row__description"), (await window.locator(".settings-row__description").first().innerText()).trim());
    await expectSelectable(window.locator(".settings-row__title"), (await window.locator(".settings-row__title").first().innerText()).trim());
    await expectSettingsChrome(window);

    const search = window.getByRole("searchbox").or(window.locator("input[type=search]")).first();
    await search.fill("主题");
    await search.press("Control+A");
    expect(await search.evaluate((input) => [(input as HTMLInputElement).selectionStart, (input as HTMLInputElement).selectionEnd])).toEqual([0, 2]);
});

test("桌面：错误提示（`role=alert`）可选：打不开的二进制文件的说明", async ({page}) => {
    await installFrame(page);
    await openNote(page);
    await item(page, "project://manual.pdf").dblclick();
    const alert = page.locator("[data-editor-group-active] [data-editor-unavailable=\"binary\"]");
    await expect(alert).toContainText("不能在这里打开");
    await expectSelectable(alert, "不能在这里打开");
});

test("桌面：宿主页（页面不存在）的文字可选，双击能选中词", async ({page}) => {
    await installFrame(page);
    await page.goto(new URL("/nope", server.url).href);
    const heading = page.locator("[data-page-not-found] h1");
    await expect(heading).toBeVisible();
    const title = (await heading.innerText()).trim();
    await expectSelectable(heading, title);

    // 真实指针：双击标题第一个字所在的位置（取文字自己的矩形，不取包围盒中心），选区落在标题里。
    const point = await heading.evaluate((element) => {
        const range = document.createRange();
        range.setStart(element.firstChild!, 0);
        range.setEnd(element.firstChild!, 1);
        const rect = range.getClientRects()[0]!;
        return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
    });
    await page.mouse.dblclick(point.x, point.y);
    const picked = (await page.evaluate(() => getSelection()!.toString())).trim();
    expect(picked).not.toBe("");
    expect(title).toContain(picked);
});

test("桌面：首次启动向导里位置的路径可选，标题不可选", async ({page}) => {
    await installFrame(page);
    await page.goto(server.url);
    await expect(page.locator("[data-bookshelf-page]")).toBeVisible();
    await page.keyboard.press("Control+Shift+P");
    const palette = page.getByRole("combobox", {name: "输入命令，或输入 : 跳到某一行"});
    await expect(palette).toBeVisible();
    await palette.fill("打开桌面版欢迎向导");
    await expect(page.locator("[role=option]").filter({hasText: "打开桌面版欢迎向导"})).toHaveCount(1);
    await page.keyboard.press("Enter");
    const wizard = page.locator("[data-first-run-wizard]");
    for (const step of ["2", "3", "4"]) {
        await page.locator("[data-first-run-primary]").click();
        await expect(wizard).toHaveAttribute("data-step", step);
    }
    const library = page.locator("[data-place='library'] .first-run__path");
    await expect(library).not.toHaveText("");
    await expectSelectable(library, (await library.innerText()).trim());
    await expectNotSelectable(wizard.locator(".first-run__title"), "准备好了");
});

test("浏览器：没有全局规则，会话面板空态文字可选；编辑器标签、面包屑、工具栏、设置导航、书架卡片各自不可选", async ({page}) => {
    await openNote(page);
    await expectSelectable(prose(page), "正文一段");
    await openSessionPanel(page);
    await expectSelectable(sessionPanel(page), "没有会话");
    await expectWorkbenchChrome(page);

    const window = await openSettings(page);
    await expectSelectable(window.locator(".settings-row__description"), (await window.locator(".settings-row__description").first().innerText()).trim());
    await expectSettingsChrome(window);
    await page.keyboard.press("Escape");

    await page.goto(new URL("/", server.url).href);
    const card = page.locator("[data-bookshelf-page] [data-book-card]");
    await expect(card).toContainText("Book");
    await expectNotSelectable(card, "Book");
    await expectNotSelectable(page.locator("[data-bookshelf-page] .bookshelf-page__shelf-title"), "书架");
});
