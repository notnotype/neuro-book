/**
 * 自动保存在真实 Chrome 中的验收（docs/specs/workbench/editor.md 输出 63，场景 35–39）：生产构建的后端与前端，文件在真实目录里。
 * 设置写进用户层的 `settings.json`；每个用例用自己的文件。等磁盘与页面上可观察的变化，不按时长等待（组字一例除外，见那里的说明）。
 */

import {randomUUID} from "node:crypto";
import {chmod, mkdir, readFile, rm, writeFile} from "node:fs/promises";
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
    tmp = await createTestTmpRoot("neuro-book-e2e", "editor-autosave");
    projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await mkdir(join(projectDir, "notes"), {recursive: true});
    await mkdir(join(projectDir, "locked"), {recursive: true});
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    server = await startProductServer(stateRoot);
});

test.afterEach(async () => {
    await rm(join(stateRoot, "settings.json"), {force: true});
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") {
        await chmod(join(projectDir, "locked"), 0o755);
        await rm(tmp, {recursive: true, force: true});
    }
});

const item = (page: Page, address: string) => page.locator(`[data-explorer-row="${address}"]`);
const prose = (page: Page) => page.locator("[data-editor-group-active] [data-editor-kind=\"nbook.editor.markdown\"]:visible [data-editor-prose]");
const code = (page: Page) => page.locator("[data-editor-group-active] [data-editor-kind=\"nbook.editor.code\"]:visible .monaco-editor");
const tab = (page: Page, name: string) => page.locator("[data-editor-tab]").filter({hasText: name});
const disk = (path: string): Promise<string> => readFile(join(projectDir, path), "utf8");
const settings = (values: Readonly<Record<string, unknown>>): Promise<void> => writeFile(join(stateRoot, "settings.json"), JSON.stringify(values));

/** 本页发出的文件写请求（保存）：用来数“保存了几次”，磁盘上看不出中间那一次。 */
function recordWrites(page: Page): string[] {
    const writes: string[] = [];
    page.on("websocket", (socket) => socket.on("framesent", (frame) => {
        if (typeof frame.payload !== "string" || !frame.payload.includes("\"type\":\"request\"")) return;
        const parsed = JSON.parse(frame.payload) as {type?: string; contract?: string; method?: string};
        if (parsed.type === "request" && parsed.contract?.startsWith("nbook.files/") === true && parsed.method === "write") writes.push(parsed.method);
    }));
    return writes;
}

async function openBook(page: Page, folder: string): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    const row = item(page, `project://${folder}`);
    await expect(row).toBeVisible();
    if (await row.getAttribute("aria-expanded") !== "true") await row.click();
}

/** 写好文件、打开作品并以正式标签打开它们，最后一个是活动标签。 */
async function openFiles(page: Page, files: Readonly<Record<string, string>>): Promise<void> {
    for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(projectDir, path)), {recursive: true});
        await writeFile(join(projectDir, path), text);
    }
    const paths = Object.keys(files);
    await openBook(page, dirname(paths[0]!));
    for (const path of paths) {
        await item(page, `project://${path}`).dblclick();
        await expect(tab(page, path.slice(path.lastIndexOf("/") + 1))).toHaveAttribute("aria-selected", "true");
    }
}

/** 把焦点从编辑器移到资源管理器：点一下文件夹那一行（它会展开或收起，用例之后不再用树里的行）。 */
async function leaveEditor(page: Page, folder: string): Promise<void> {
    await item(page, `project://${folder}`).click();
}

/** 点进 Markdown 正文、光标到末尾，再打字。 */
async function typeProse(page: Page, text: string): Promise<void> {
    await prose(page).locator("p").last().click();
    await expect(prose(page)).toBeFocused();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(text);
}

test("缺省是失焦时保存：输入后点资源管理器即落盘、圆点消失；换到另一个标签，换下的文件落盘；Ctrl+W 关闭不询问（场景 35）", async ({page}) => {
    await openFiles(page, {"notes/a35.md": "甲\n", "notes/b35.md": "乙\n"});
    await typeProse(page, "一");
    await expect(tab(page, "b35.md")).toHaveAttribute("data-editor-tab-dirty", "");
    await leaveEditor(page, "notes");
    await expect.poll(() => disk("notes/b35.md")).toBe("乙一\n");
    await expect(tab(page, "b35.md")).not.toHaveAttribute("data-editor-tab-dirty", "");

    await typeProse(page, "二");
    await tab(page, "a35.md").click();
    await expect.poll(() => disk("notes/b35.md")).toBe("乙一二\n");

    // 焦点一直在正文里按 Ctrl+W：没有失焦在前，关闭这一步自己保存。
    await typeProse(page, "三");
    await page.keyboard.press("Control+w");
    await expect(tab(page, "a35.md")).toHaveCount(0);
    await expect(page.locator("[data-editor-close-dialog]")).toHaveCount(0);
    await expect.poll(() => disk("notes/a35.md")).toBe("甲三\n");
});

test("设为关闭：失焦后仍未保存，关闭时照旧询问（场景 36）", async ({page}) => {
    await settings({"nbook.editor/autoSave": "off"});
    await openFiles(page, {"notes/a36.md": "甲\n"});
    await typeProse(page, "一");
    await leaveEditor(page, "notes");
    await expect(tab(page, "a36.md")).toHaveAttribute("data-editor-tab-dirty", "");
    await prose(page).click();
    await page.keyboard.press("Control+w");
    await expect(page.locator("[data-editor-close-dialog]")).toBeVisible();
    await page.locator("[data-editor-close-cancel]").click();
    await expect(tab(page, "a36.md")).toHaveAttribute("data-editor-tab-dirty", "");
    expect(await disk("notes/a36.md")).toBe("甲\n");
});

test("停手后：到点保存，焦点不用离开；输入法组字期间不保存，上屏后保存的是汉字（场景 37）", async ({page}) => {
    await settings({"nbook.editor/autoSave": "afterDelay", "nbook.editor/autoSaveDelay": 300});
    const writes = recordWrites(page);
    await openFiles(page, {"notes/a37.md": "甲\n"});
    await typeProse(page, "一");
    await expect.poll(() => disk("notes/a37.md")).toBe("甲一\n");
    await expect(prose(page)).toBeFocused();
    await expect.poll(() => writes.length).toBe(1);

    const cdp = await page.context().newCDPSession(page);
    for (const length of [1, 2, 3]) await cdp.send("Input.imeSetComposition", {text: "hou".slice(0, length), selectionStart: length, selectionEnd: length});
    // 组字停着不动，让页面的计时器走过自动保存本该到点的时刻（延迟 300 毫秒加控件的 150 毫秒）：要证明的是“到点也没有保存”，
    // 页面上没有别的可观察事件可等。
    // test-lint-allow fixed-wait: 证明计时到点时没有发出保存，只能让页面的计时器队列走过这个点
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1200)));
    expect(writes.length).toBe(1);
    expect(await disk("notes/a37.md")).toBe("甲一\n");
    await cdp.send("Input.insertText", {text: "后"});
    await cdp.detach();
    await expect.poll(() => disk("notes/a37.md")).toBe("甲一后\n");
    expect(writes.length).toBe(2);
});

test("源码编辑器：焦点进自己的查找框不算离开，回来接着打字、再点别处只保存一次（场景 38）", async ({page}) => {
    const writes = recordWrites(page);
    await openFiles(page, {"notes/a38.txt": "甲\n"});
    await code(page).locator(".view-lines").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("一");
    await page.keyboard.press("Control+f");
    await expect(code(page).locator(".find-widget textarea").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await page.keyboard.type("二");
    await leaveEditor(page, "notes");
    await expect.poll(() => disk("notes/a38.txt")).toBe("甲\n一二");
    // 查找框那一下要是保存了，这里会是两次（先“一”、后“一二”）。
    expect(writes.length).toBe(1);
});

test("窗口失焦时：应用内换焦点不保存；窗口失去焦点或页面隐藏时保存（场景 38）", async ({page}) => {
    await settings({"nbook.editor/autoSave": "onWindowChange"});
    const writes = recordWrites(page);
    await openFiles(page, {"notes/w38.md": "甲\n"});
    await typeProse(page, "一");
    await leaveEditor(page, "notes");
    await expect(tab(page, "w38.md")).toHaveAttribute("data-editor-tab-dirty", "");
    // 无头浏览器里没有真实的窗口切换：派发页面在窗口失焦时收到的事件。页面此刻有焦点，`document.hasFocus()` 为真，
    // 这一下 blur 等同于“焦点进了同页的内嵌页面”，不保存。
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {configurable: true, get: () => "hidden"});
        document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => disk("notes/w38.md")).toBe("甲一\n");
    expect(writes.length).toBe(1);
});

test("存不了的不硬存：磁盘已变化时只提示；保存失败后停下，“重试保存”成功后恢复（场景 39）", async ({page}) => {
    await openFiles(page, {"notes/a39.md": "甲\n"});
    await typeProse(page, "一");
    // 焦点还在正文里时外部改了文件：离开时不保存，磁盘上仍是外部的内容。
    await writeFile(join(projectDir, "notes/a39.md"), "外部\n");
    await expect(page.locator("[data-editor-banner]")).toContainText("磁盘上的文件已被修改");
    await leaveEditor(page, "notes");
    await expect(tab(page, "a39.md")).toHaveAttribute("data-editor-tab-dirty", "");
    expect(await disk("notes/a39.md")).toBe("外部\n");
});

test("保存失败后停下，组顶部有“重试保存”；恢复可写后重试成功，之后离开视图又会自动保存（场景 39）", async ({page}) => {
    const writes = recordWrites(page);
    await openFiles(page, {"locked/a39.md": "甲\n"});
    await chmod(join(projectDir, "locked"), 0o555);
    await typeProse(page, "一");
    await leaveEditor(page, "locked");
    const retry = page.getByRole("button", {name: "重试保存"});
    await expect(retry).toBeVisible();
    await expect.poll(() => writes.length).toBe(1);
    // 再输入、再离开：不重复尝试。
    await typeProse(page, "二");
    await leaveEditor(page, "locked");
    await expect(tab(page, "a39.md")).toHaveAttribute("data-editor-tab-dirty", "");

    await chmod(join(projectDir, "locked"), 0o755);
    await retry.click();
    await expect.poll(() => disk("locked/a39.md")).toBe("甲一二\n");
    await expect(retry).toHaveCount(0);
    expect(writes.length).toBe(2);
    await typeProse(page, "三");
    await leaveEditor(page, "locked");
    await expect.poll(() => disk("locked/a39.md")).toBe("甲一二三\n");
});
