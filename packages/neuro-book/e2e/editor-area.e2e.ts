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
const control = (page: Page) => page.locator("[data-editor-kind]:visible [data-editor-control]");
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
    await expect(control(page)).toHaveValue("第一章\n");
    await item(page, "project://notes/b.md").click();
    await expect(labels(page)).toHaveText(["b.md"]);
    await item(page, "project://notes/b.md").dblclick();
    await expect(tabs(page).first()).not.toHaveAttribute("data-editor-tab-preview", "");
    await item(page, "project://notes/a.md").click();
    await expect(labels(page)).toHaveText(["b.md", "a.md"]);

    await control(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type("（续）");
    await expect(page.locator("[data-editor-tab][aria-selected=\"true\"]")).toHaveAttribute("data-editor-tab-dirty", "");
    // 编辑把预览标签转正。
    await expect(page.locator("[data-editor-tab][aria-selected=\"true\"]")).not.toHaveAttribute("data-editor-tab-preview", "");
    await page.keyboard.press("Control+s");
    await expect.poll(() => disk("notes/a.md")).toBe("第一章\n（续）");
    await expect(page.locator("[data-editor-tab][aria-selected=\"true\"]")).not.toHaveAttribute("data-editor-tab-dirty", "");

    // 另一个窗口打开同一文件，看到保存后的正文（files 验收 1 的第二个消费者）。
    const other = await page.context().newPage();
    await open(other);
    await item(other, "project://notes/a.md").click();
    await expect(control(other)).toHaveValue("第一章\n（续）");
    await other.close();
});

test("外部修改：不 dirty 时换成磁盘内容；dirty 时提示，保存得到冲突，重新载入后为磁盘内容", async ({page}) => {
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/c.md").dblclick();
    await expect(control(page)).toHaveValue("第三章\n");
    await writeFile(join(projectDir, "notes/c.md"), "第三章（外部一）\n");
    await expect(control(page)).toHaveValue("第三章（外部一）\n");

    await control(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type("我的");
    await writeFile(join(projectDir, "notes/c.md"), "第三章（外部二）\n");
    await expect(page.locator("[data-editor-banner]")).toContainText("磁盘上的文件已被修改");
    await page.keyboard.press("Control+s");
    await expect(page.locator("[data-editor-banner]")).toContainText("保存没有写入");
    expect(await disk("notes/c.md")).toBe("第三章（外部二）\n");
    await page.locator("[data-editor-banner-action=\"reload\"]").click();
    await expect(control(page)).toHaveValue("第三章（外部二）\n");
    await expect(page.locator("[data-editor-banner]")).toHaveCount(0);
});

test("关闭 dirty 标签先问：取消不关，不保存则丢弃；向右拆分后两组共用正文；刷新后组与标签恢复", async ({page}) => {
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/d.md").dblclick();
    await control(page).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("草稿");
    await page.keyboard.press("Control+w");
    await expect(page.locator("[data-editor-close-dialog]")).toBeVisible();
    await page.locator("[data-editor-close-cancel]").click();
    await expect(labels(page)).toHaveText(["d.md"]);

    await control(page).click();
    await page.keyboard.press("Control+\\");
    await expect(page.locator("[data-editor-group]")).toHaveCount(2);
    const right = page.locator("[data-editor-group-active] [data-editor-control]");
    await expect(right).toHaveValue("第四章\n草稿");
    await right.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("！");
    await expect(page.locator("[data-editor-group]").first().locator("[data-editor-control]")).toHaveValue("第四章\n草稿！");

    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(page.locator("[data-editor-group]")).toHaveCount(2);
    await expect(page.locator("[data-editor-group]").first().locator("[data-editor-tab-label]")).toHaveText(["d.md"]);
    // 刷新丢掉了未保存的修改（不跨刷新保留草稿）：正文是磁盘上的。
    await expect(page.locator("[data-editor-group-active] [data-editor-control]")).toHaveValue("第四章\n");
    await closeAll(page);
    await expect(page.locator("[data-editor-group]")).toHaveCount(1);
});

test("有未保存的修改时离开页面先请求确认；保存之后不再请求", async ({page}) => {
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/b.md").dblclick();
    await control(page).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("x");
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
        dialogs.push(dialog.type());
        void dialog.dismiss();
    });
    await page.close({runBeforeUnload: true});
    await expect.poll(() => dialogs).toEqual(["beforeunload"]);
    expect(page.isClosed()).toBe(false);
    await control(page).click();
    await page.keyboard.press("Control+s");
    await expect.poll(() => disk("notes/b.md")).toBe("第二章\nx");
    await page.close({runBeforeUnload: true});
    await expect.poll(() => page.isClosed()).toBe(true);
    expect(dialogs).toEqual(["beforeunload"]);
});

test("服务端重启：终态页列出未保存的正文", async ({page}) => {
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/e.md").dblclick();
    await control(page).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("来不及保存");
    const port = new URL(server.url).port;
    expect(await server.stop()).toBe(0);
    server = await startProductServer(stateRoot, Number(port));
    await expect(page.locator("[data-browser-host-status=\"server-restarted\"], [data-browser-host-status=\"project-gone\"]")).toBeVisible({timeout: 30_000});
    await expect(page.locator("[data-host-rescued-item] code")).toHaveText("project://notes/e.md");
    await expect(page.locator("[data-host-rescued-item] textarea")).toHaveValue("第五章\n来不及保存");
});
