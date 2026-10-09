/**
 * 编辑器区在真实 Chrome 中的验收（docs/specs/workbench/editor.md 场景 1、3、6、8、10、11）：生产构建的后端与前端，项目
 * `book` 先登记好，文件在真实目录里，Storage、项目子进程与文件监视都是真的。等页面上可观察的变化，不按时长等待。
 */

import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

/** 含方言、CRLF、`*` 列表、标准 ruby 与 frontmatter 的章节：编辑器的写法与它不同，用来看字节保持。 */
const DIALECT = [
    "---",
    "title: 第三章",
    "---",
    "",
    "# 第三章",
    "",
    "* 线索一",
    "* 线索二",
    "",
    "她念出<ruby>临川<rt>línchuān</rt></ruby>这个名字。",
    "",
    "她抬头<comment body=\"节奏\">看了他一眼</comment>。",
    "",
    "雨下了一整夜。",
    "",
].join("\r\n");

let tmp = "";
let projectDir = "";
let stateRoot = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "editor-area");
    projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    const files: Record<string, string> = {
        ".nbook/project.json": JSON.stringify({schema: 1, id}),
        "notes/a.md": "第一章\n",
        "notes/b.md": "第二章\n",
        "notes/c.md": "第三章\n",
        "notes/d.md": "第四章\n",
        "notes/e.md": "第五章\n",
        "data/f.json": "{\"f\": 1}\n",
        "notes/h.md": "甲\n",
        "moving/m.md": "迁\n",
        "moving/k.md": "复\n",
        "target/.keep": "",
        "notes/i.md": "乙\n",
        "notes/dialect.md": DIALECT,
        "data/g.json": "{\"g\": 2}\n",
    };
    for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(projectDir, path)), {recursive: true});
        await writeFile(join(projectDir, path), text);
    }
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const item = (page: Page, address: string) => page.locator(`[data-explorer-row="${address}"]`);
const tabs = (page: Page) => page.locator("[data-editor-tab]");
const labels = (page: Page) => page.locator("[data-editor-tab-label]");
/** 活动组里 Markdown 富文本的编辑区。 */
const prose = (page: Page) => page.locator("[data-editor-group-active] [data-editor-kind=\"markdown\"]:visible [data-editor-prose]");
/** 点进编辑区并把光标放到正文末尾。 */
async function atEnd(page: Page, editable = prose(page)): Promise<void> {
    await editable.click();
    await page.keyboard.press("Control+End");
}
const disk = (path: string): Promise<string> => readFile(join(projectDir, path), "utf8");

async function open(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(page.locator("[data-editor-area]")).toBeVisible();
    if (await item(page, "project://notes").getAttribute("aria-expanded") !== "true") await item(page, "project://notes").click();
    await expect(item(page, "project://notes/a.md")).toBeVisible();
}

/** 关掉页面上全部标签（用例之间不留会话）；dirty 的选“不保存”。 */
async function closeAll(page: Page): Promise<void> {
    for (let guard = 0; guard < 20 && await tabs(page).count() > 0; guard += 1) {
        await page.locator("[data-editor-tab-close]").first().click();
        const discard = page.locator("[data-editor-close-discard]");
        if (await discard.isVisible()) await discard.click();
    }
}

test("单击以预览打开、再单击替换预览、双击转正；编辑后 Ctrl+S 写盘，标签的未保存标记随之消失", async ({page}) => {
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/a.md").click();
    await expect(labels(page)).toHaveText(["a.md"]);
    await expect(tabs(page).first()).toHaveAttribute("data-editor-tab-preview", "");
    await expect(prose(page)).toHaveText("第一章");
    await item(page, "project://notes/b.md").click();
    await expect(labels(page)).toHaveText(["b.md"]);
    await item(page, "project://notes/b.md").dblclick();
    await expect(tabs(page).first()).not.toHaveAttribute("data-editor-tab-preview", "");
    await item(page, "project://notes/a.md").click();
    await expect(labels(page)).toHaveText(["b.md", "a.md"]);

    await atEnd(page);
    await page.keyboard.type("（续）");
    await expect(page.locator("[data-editor-tab][aria-selected=\"true\"]")).toHaveAttribute("data-editor-tab-dirty", "");
    // 编辑把预览标签转正。
    await expect(page.locator("[data-editor-tab][aria-selected=\"true\"]")).not.toHaveAttribute("data-editor-tab-preview", "");
    await page.keyboard.press("Control+s");
    await expect.poll(() => disk("notes/a.md")).toBe("第一章（续）\n");
    await expect(page.locator("[data-editor-tab][aria-selected=\"true\"]")).not.toHaveAttribute("data-editor-tab-dirty", "");

    // 另一个窗口打开同一文件，看到保存后的正文（files 验收 1 的第二个消费者）。
    const other = await page.context().newPage();
    await open(other);
    await item(other, "project://notes/a.md").click();
    await expect(prose(other)).toHaveText("第一章（续）");
    await other.close();
});

test("外部修改：不 dirty 时换成磁盘内容；dirty 时提示，保存得到冲突，重新载入后为磁盘内容", async ({page}) => {
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/c.md").dblclick();
    await expect(prose(page)).toHaveText("第三章");
    await writeFile(join(projectDir, "notes/c.md"), "第三章（外部一）\n");
    await expect(prose(page)).toHaveText("第三章（外部一）");

    await atEnd(page);
    await page.keyboard.type("我的");
    await writeFile(join(projectDir, "notes/c.md"), "第三章（外部二）\n");
    await expect(page.locator("[data-editor-banner]")).toContainText("磁盘上的文件已被修改");
    await page.keyboard.press("Control+s");
    await expect(page.locator("[data-editor-banner]")).toContainText("保存没有写入");
    expect(await disk("notes/c.md")).toBe("第三章（外部二）\n");
    await page.locator("[data-editor-banner-action=\"reload\"]").click();
    await expect(prose(page)).toHaveText("第三章（外部二）");
    await expect(page.locator("[data-editor-banner]")).toHaveCount(0);
});

test("关闭 dirty 标签先问：取消不关，不保存则丢弃；向右拆分后两组共用正文；刷新后组与标签恢复", async ({page}) => {
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/d.md").dblclick();
    await atEnd(page);
    await page.keyboard.type("草稿");
    await page.keyboard.press("Control+w");
    await expect(page.locator("[data-editor-close-dialog]")).toBeVisible();
    await page.locator("[data-editor-close-cancel]").click();
    await expect(labels(page)).toHaveText(["d.md"]);

    await prose(page).click();
    await page.keyboard.press("Control+\\");
    await expect(page.locator("[data-editor-group]")).toHaveCount(2);
    await expect(prose(page)).toHaveText("第四章草稿");
    await atEnd(page);
    await page.keyboard.type("！");
    await expect(page.locator("[data-editor-group]").first().locator("[data-editor-prose]")).toHaveText("第四章草稿！");

    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(page.locator("[data-editor-group]")).toHaveCount(2);
    await expect(page.locator("[data-editor-group]").first().locator("[data-editor-tab-label]")).toHaveText(["d.md"]);
    // 刷新丢掉了未保存的修改（不跨刷新保留草稿）：正文是磁盘上的。
    await expect(prose(page)).toHaveText("第四章");
    await closeAll(page);
    await expect(page.locator("[data-editor-group]")).toHaveCount(1);
});

test("有未保存的修改时离开页面先请求确认；保存之后不再请求", async ({page}) => {
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/b.md").dblclick();
    await atEnd(page);
    await page.keyboard.type("x");
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
        dialogs.push(dialog.type());
        void dialog.dismiss();
    });
    await page.close({runBeforeUnload: true});
    await expect.poll(() => dialogs).toEqual(["beforeunload"]);
    expect(page.isClosed()).toBe(false);
    await prose(page).click();
    await page.keyboard.press("Control+s");
    await expect.poll(() => disk("notes/b.md")).toBe("第二章x\n");
    // 磁盘写好了不等于回复到了：保存在途时离开同样要确认。等标签的未保存标记消失（保存完成）再离开。
    await expect(page.locator("[data-editor-tab][aria-selected=\"true\"]")).not.toHaveAttribute("data-editor-tab-dirty", "");
    await page.close({runBeforeUnload: true});
    await expect.poll(() => page.isClosed()).toBe(true);
    expect(dialogs).toEqual(["beforeunload"]);
});

test("Markdown：打开、切走、关闭都不改磁盘字节；编辑最后一段后保存，只有那一行变化（含 CRLF、列表标记、ruby 与 frontmatter）", async ({page}) => {
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/dialect.md").dblclick();
    await expect(prose(page)).toContainText("雨下了一整夜。");
    await item(page, "project://notes/h.md").click();
    await page.locator("[data-editor-tab-label]", {hasText: "dialect.md"}).click();
    await expect(prose(page)).toContainText("雨下了一整夜。");
    await closeAll(page);
    expect(await disk("notes/dialect.md")).toBe(DIALECT);

    await item(page, "project://notes/dialect.md").dblclick();
    // 最后一段是正文末尾：Ctrl+End 把光标放到它的末尾再接着写。
    await atEnd(page);
    await page.keyboard.type("天亮了。");
    await page.keyboard.press("Control+s");
    await expect.poll(() => disk("notes/dialect.md")).toBe(DIALECT.replace("雨下了一整夜。", "雨下了一整夜。天亮了。"));
    await closeAll(page);
});

test("Markdown：A 输入、切到 B 输入、回 A 撤销只作用于 A；重做回来", async ({page}) => {
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/h.md").dblclick();
    await atEnd(page);
    await page.keyboard.type("一");
    await item(page, "project://notes/i.md").dblclick();
    await atEnd(page);
    await page.keyboard.type("二");
    await page.locator("[data-editor-tab-label]", {hasText: "h.md"}).click();
    await expect(prose(page)).toHaveText("甲一");
    await prose(page).click();
    await page.keyboard.press("Control+z");
    await expect(prose(page)).toHaveText("甲");
    await page.keyboard.press("Control+Shift+z");
    await expect(prose(page)).toHaveText("甲一");
    await page.locator("[data-editor-tab-label]", {hasText: "i.md"}).click();
    await expect(prose(page)).toHaveText("乙二");
    await closeAll(page);
});

test("资源管理器的结算：未保存时剪切、保存、粘贴，标签跟到新路径、正文保留；复制先问；删除确认列出未保存的文档", async ({page}) => {
    await open(page);
    await closeAll(page);
    for (const folder of ["project://moving", "project://target"]) {
        if (await item(page, folder).getAttribute("aria-expanded") !== "true") await item(page, folder).click();
    }
    await item(page, "project://moving/m.md").dblclick();
    await atEnd(page);
    await page.keyboard.type("动");
    await item(page, "project://moving/m.md").click();
    await page.keyboard.press("Control+x");
    await prose(page).click();
    await page.keyboard.press("Control+s");
    await expect.poll(() => disk("moving/m.md")).toBe("迁动\n");
    await atEnd(page);
    await page.keyboard.type("再");
    await item(page, "project://target").click();
    await page.keyboard.press("Control+v");
    // 点目录会切换它的展开：按磁盘与标签核对，不看行。
    await expect.poll(() => disk("target/m.md").catch(() => "")).toBe("迁动\n");
    await expect(page.locator("[data-editor-tab-label]")).toHaveText(["m.md"]);
    await expect(page.locator("[data-editor-tab]").first()).toHaveAttribute("title", "project://target/m.md");
    await expect(prose(page)).toHaveText("迁动再");

    await item(page, "project://moving/k.md").dblclick();
    await atEnd(page);
    await page.keyboard.type("改");
    await item(page, "project://moving/k.md").click();
    await page.keyboard.press("Control+c");
    await item(page, "project://target").click();
    await page.keyboard.press("Control+v");
    await expect(page.locator("[data-explorer-dirty-copy]")).toContainText("project://moving/k.md");
    await page.locator("[data-explorer-dirty-copy-disk]").click();
    await expect.poll(() => disk("target/k.md").catch(() => "")).toBe("复\n");

    await item(page, "project://moving/k.md").click();
    await page.keyboard.press("Delete");
    await expect(page.locator("[data-explorer-delete-unsaved]")).toHaveText("project://moving/k.md");
    await page.getByRole("alertdialog").getByRole("button", {name: "取消"}).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(await disk("moving/k.md")).toBe("复\n");
    await closeAll(page);
});

/** Monaco 里当前模型的正文（视图行的文字，不含行号）。 */
const monacoText = (page: Page) => page.locator("[data-editor-kind=\"code\"]:visible .view-lines").evaluate((element) => [...element.querySelectorAll(".view-line")].sort((a, b) => Number.parseFloat((a as HTMLElement).style.top) - Number.parseFloat((b as HTMLElement).style.top)).map((line) => (line.textContent ?? "").replaceAll("\u00a0", " ")).join("\n"));

test("源码文件用 Monaco：第一次打开源码文件之前不加载它；输入后 Ctrl+S 写盘；A→B→A 后撤销只作用于 A", async ({page}) => {
    const monacoRequests: string[] = [];
    page.on("request", (request) => {
        if (/editor\.api|monaco/iu.test(request.url())) monacoRequests.push(request.url());
    });
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/a.md").dblclick();
    await expect(prose(page)).toBeVisible();
    expect(monacoRequests).toEqual([]);

    if (await item(page, "project://data").getAttribute("aria-expanded") !== "true") await item(page, "project://data").click();
    await item(page, "project://data/f.json").dblclick();
    const editor = page.locator("[data-editor-kind=\"code\"]:visible .monaco-editor");
    await expect(editor).toBeVisible();
    expect(monacoRequests.length).toBeGreaterThan(0);
    await expect.poll(() => monacoText(page)).toBe("{\"f\": 1}\n");
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("// f");
    await page.keyboard.press("Control+s");
    await expect.poll(() => disk("data/f.json")).toBe("{\"f\": 1}\n// f");

    await item(page, "project://data/g.json").dblclick();
    await expect.poll(() => monacoText(page)).toBe("{\"g\": 2}\n");
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("// g");
    await page.locator("[data-editor-tab-label]", {hasText: "f.json"}).click();
    await expect.poll(() => monacoText(page)).toBe("{\"f\": 1}\n// f");
    await editor.click();
    await page.keyboard.press("Control+z");
    // 撤销作用于 f 自己的历史：Monaco 按词撤掉最后输入的 “ f”。
    await expect.poll(() => monacoText(page)).toBe("{\"f\": 1}\n//");
    await page.locator("[data-editor-tab-label]", {hasText: "g.json"}).click();
    await expect.poll(() => monacoText(page)).toBe("{\"g\": 2}\n// g");
    await closeAll(page);
});

test("服务端重启：终态页列出未保存的正文", async ({page}) => {
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/e.md").dblclick();
    await atEnd(page);
    await page.keyboard.type("来不及保存");
    const port = new URL(server.url).port;
    expect(await server.stop()).toBe(0);
    server = await startProductServer(stateRoot, Number(port));
    await expect(page.locator("[data-browser-host-status=\"server-restarted\"], [data-browser-host-status=\"project-gone\"]")).toBeVisible({timeout: 30_000});
    await expect(page.locator("[data-host-rescued-item] code")).toHaveText("project://notes/e.md");
    await expect(page.locator("[data-host-rescued-item] textarea")).toHaveValue("第五章来不及保存\n");
});
