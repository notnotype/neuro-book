/**
 * 书架的统计与继续写作在真实 Chrome 中的验收（docs/specs/workbench/bookshelf.md 验收 1、2；docs/specs/workbench/editor.md
 * 验收 15）：e2e 测试外壳与宿主测试入口起的真实后端，项目子进程跑项目宿主的测试入口（装着产品的项目插件，统计在里面算）。
 * 宽限期用短的启动参数，等后端输出项目入口关闭的那一行再看书架。
 */

import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {DatabaseSync} from "node:sqlite";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {CLIENT_IDENTITY_KEY} from "nbook/web/host/client-identity";

import {startProbeServer} from "./fixtures";
import type {ProbeServer} from "./fixtures";

const GRACE_MS = 1500;
/** 项目探针的项目入口关闭时打印的一行（`src/project/testing/probe-plugin.ts`）。 */
const PROJECT_PROBE_CLOSED_LINE = "remote-probe project entry closed";

let tmp = "";
let bookDir = "";
let server: ProbeServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "bookshelf-stats");
    bookDir = join(tmp, "Book");
    const stateRoot = join(tmp, "state");
    const id = randomUUID();
    const files: Record<string, string> = {
        ".nbook/project.json": JSON.stringify({schema: 1, id, title: "长夜行"}),
        "notes/a.md": "第一章\n\n他把灯放低一些。\n",
        "notes/b.md": "第二章\n",
    };
    for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(bookDir, path)), {recursive: true});
        await writeFile(join(bookDir, path), text);
    }
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: bookDir}]}));
    server = await startProbeServer(stateRoot, {env: {NBOOK_PROJECT_GRACE_MS: String(GRACE_MS)}});
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const root = (page: Page) => page.locator("[data-workbench-root]");
const prose = (page: Page) => page.locator("[data-editor-group-active] [data-editor-kind=\"nbook.editor.markdown\"]:visible [data-editor-prose]");
const activeTab = (page: Page) => page.locator("[data-editor-tab][aria-selected=\"true\"]");

async function openBook(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(root(page)).toHaveAttribute("data-rpc-state", "online");
    await expect(page.locator("[data-workbench-project]")).toHaveAttribute("data-workbench-project", "book");
}

/** 本页客户端的标签记录里 a.md 的标签记下的光标（项目分区的 `editor.tabs`，按客户端分行）。 */
async function savedCursor(page: Page): Promise<unknown> {
    const client = await page.evaluate((identity) => localStorage.getItem(identity), CLIENT_IDENTITY_KEY);
    const db = new DatabaseSync(join(bookDir, ".nbook", "storage.sqlite"));
    try {
        const row = db.prepare("SELECT value FROM records WHERE owner = 'nbook.editor' AND key = 'editor.tabs' AND client = ?1").get(client) as {value: string} | undefined;
        const record = row === undefined ? null : JSON.parse(row.value) as {tabs: Record<string, {address?: string; cursor?: unknown}>};
        return Object.values(record?.tabs ?? {}).find((tab) => tab.address === "project://notes/a.md")?.cursor ?? null;
    } finally {
        db.close();
    }
}

async function openShelf(page: Page): Promise<void> {
    await page.goto(new URL("/", server.url).href);
    await expect(root(page)).toHaveAttribute("data-workbench-home", "nbook.projects.bookshelf");
    await expect(page.locator("[data-shelf-cards]")).toBeVisible();
}

test("写过字、关掉窗口并等作品停止后，书架显示字数、片段与“统计于某时”；继续写作回到那个文件的末尾，刷新后不再定位", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await openBook(page);
    const notes = page.locator('[data-explorer-row="project://notes"]');
    if (await notes.getAttribute("aria-expanded") !== "true") await notes.click();
    await page.locator('[data-explorer-row="project://notes/a.md"]').dblclick();
    await expect(prose(page)).toContainText("他把灯放低一些");
    await prose(page).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("雪落在灯罩上。");
    await expect(prose(page)).toContainText("雪落在灯罩上。");
    await page.keyboard.press("Control+S");
    await expect(activeTab(page)).not.toHaveAttribute("data-editor-tab-dirty", "");

    // 关掉窗口：宽限期满后项目停止，停止时写最后一次统计。
    await page.goto("about:blank");
    await server.waitFor(new RegExp(`\\[project book#1\\] ${PROJECT_PROBE_CLOSED_LINE}`, "u"));

    await openShelf(page);
    const desk = page.locator("[data-shelf-desk]");
    await expect(desk).toContainText("长夜行");
    await expect(desk).toContainText("雪落在灯罩上");
    await expect(desk).toContainText("字");
    const book = page.locator("[data-book-card]", {hasText: "长夜行"});
    await expect(book).toContainText("统计于");
    await expect(book).toContainText("2 篇");

    await desk.locator("[data-continue]").click();
    await page.waitForURL((url) => url.searchParams.get("project") === "book" && !url.searchParams.has("open") && !url.searchParams.has("at"));
    await expect(activeTab(page)).toContainText("a.md");
    await expect(prose(page)).toContainText("雪落在灯罩上。");
    await expect(prose(page)).toBeFocused();
    await page.keyboard.type("化成水。");
    await expect(prose(page)).toContainText("雪落在灯罩上。化成水。");

    // 光标挪到开头、记下之后刷新：回到记下的光标（editor.md 输出 30），不再按继续写作定位到末尾。先等输入交给文档（标签
    // 变成未保存）：紧跟在输入后面的 Ctrl+Home 可能被吞掉，光标留在末尾。
    await expect(activeTab(page)).toHaveAttribute("data-editor-tab-dirty", "");
    await page.keyboard.press("Control+Home");
    await expect.poll(() => savedCursor(page)).toEqual({offset: 1});
    await page.reload();
    await expect(root(page)).toHaveAttribute("data-rpc-state", "online");
    await expect(activeTab(page)).toContainText("a.md");
    await expect(prose(page)).toContainText("他把灯放低一些");
    expect(new URL(page.url()).searchParams.has("open")).toBe(false);
    await expect(prose(page)).toBeFocused();
    await page.keyboard.type("序");
    await expect.poll(async () => (await prose(page).textContent())?.startsWith("序第一章")).toBe(true);
});
