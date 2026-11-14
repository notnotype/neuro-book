/**
 * 桌面窗口的关闭前询问在真实浏览器里的验收（docs/specs/runtime/browser-host.md 输出 9、10 与场景 15 的页面一侧，
 * docs/specs/workbench/editor.md 输出 66 与场景 46）：生产构建的后端与前端，本机 Chrome。壳由页面里的一个假发送函数代替：
 * `addInitScript` 装上 `window.__electrobunSendToHost` 记下页面回的消息，询问用与壳相同的方式派发 `nbook-desktop` 事件
 * （形状见 src/shared/desktop-bridge.ts，壳一侧见 desktop/src/bun/index.ts）。层、对话框与挡输入只能在真实浏览器里判：
 * happy-dom 的 `inert` 没有阻断行为。
 */

import {randomUUID} from "node:crypto";
import {chmod, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

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
    tmp = await createTestTmpRoot("neuro-book-e2e", "desktop-close");
    projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await mkdir(join(projectDir, "notes"), {recursive: true});
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    server = await startProductServer(stateRoot);
});

test.afterEach(async () => {
    await chmod(join(projectDir, "notes"), 0o755);
    await rm(join(stateRoot, "settings.json"), {force: true});
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const item = (page: Page, address: string) => page.locator(`[data-explorer-row="${address}"]`);
const prose = (page: Page) => page.locator("[data-editor-group-active] [data-editor-kind=\"nbook.editor.markdown\"]:visible [data-editor-prose]");
const tab = (page: Page, name: string) => page.locator("[data-editor-tab]").filter({hasText: name});
const layer = (page: Page) => page.locator("[data-close-layer]");
const windowDialog = (page: Page) => page.locator("[data-editor-window-close-dialog]");
const disk = (path: string): Promise<string> => readFile(join(projectDir, path), "utf8");

/** 页面发给假壳的关闭前询问的消息（更新提示的 `page-ready` 等不在内，见 desktop-update.e2e.ts）。 */
const sent = async (page: Page): Promise<unknown[]> => (await page.evaluate(() => (window as unknown as {__shellSent: unknown[]}).__shellSent)).filter((message) => (message as {type: string}).type.startsWith("close-"));
const answers = async (page: Page): Promise<unknown[]> => (await sent(page)).filter((message) => (message as {type: string}).type === "close-answer");

/** 像壳那样在页面里派发一条消息。 */
async function shell(page: Page, detail: unknown): Promise<void> {
    await page.evaluate((value) => window.dispatchEvent(new CustomEvent("nbook-desktop", {detail: value})), detail);
}

async function installShell(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const messages: unknown[] = [];
        (window as unknown as {__shellSent: unknown[]}).__shellSent = messages;
        (window as unknown as {__electrobunSendToHost: (message: unknown) => void}).__electrobunSendToHost = (message) => void messages.push(message);
    });
}

/** 写好文件、打开作品并以正式标签打开它，点进正文末尾打字。 */
async function editFile(page: Page, path: string, text: string, typed: string): Promise<void> {
    await writeFile(join(projectDir, path), text);
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    const folder = item(page, "project://notes");
    await expect(folder).toBeVisible();
    if (await folder.getAttribute("aria-expanded") !== "true") await folder.click();
    await item(page, `project://${path}`).dblclick();
    const name = path.slice(path.lastIndexOf("/") + 1);
    await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
    await prose(page).locator("p").last().click();
    await expect(prose(page)).toBeFocused();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(typed);
    await expect(tab(page, name)).toHaveAttribute("data-editor-tab-dirty", "");
}

test("编辑中关窗（自动保存关着）：接下、盖层、编辑器询问；询问期间快捷键与被盖住的正文都不生效；取消后焦点回到正文；全部保存失败说明、成功才同意（编辑器场景 46）", async ({page}) => {
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify({"nbook.editor/autoSave": "off"}));
    await installShell(page);
    await editFile(page, "notes/a46.md", "甲\n", "一");

    await shell(page, {type: "close-query", generation: 1, reason: "window"});
    await expect.poll(() => sent(page)).toEqual([{type: "close-ack", generation: 1}]);
    await expect(layer(page)).toBeVisible();
    await expect(windowDialog(page)).toBeVisible();
    await expect(page.locator("[data-editor-window-close-files]")).toContainText("notes/a46.md");

    // 焦点在对话框里按保存、关标签、命令面板：都不执行。
    await page.keyboard.press("Control+s");
    await page.keyboard.press("Control+w");
    await page.keyboard.press("Control+Shift+P");
    await expect(page.getByRole("combobox", {name: "输入命令，或输入 : 跳到某一行"})).toHaveCount(0);
    await expect(tab(page, "a46.md")).toHaveCount(1);
    await expect(page.locator("[data-editor-close-dialog]")).toHaveCount(0);
    expect(await disk("notes/a46.md")).toBe("甲\n");
    // 正文被盖住：它所在的位置最上面是遮罩，点下去到不了正文（点遮罩等于取消询问，见下面的 Escape）。
    const box = await prose(page).boundingBox();
    if (box === null) throw new Error("正文没有位置");
    expect(await page.evaluate(({x, y}) => document.elementFromPoint(x, y)?.closest("[data-editor-prose]") === null, {x: box.x + box.width / 2, y: box.y + 10})).toBe(true);
    await expect(prose(page)).not.toBeFocused();

    // Escape 关掉编辑器的询问等于取消：回答 deny、撤层、焦点回到正文，接着打字有效。
    await page.keyboard.press("Escape");
    await expect.poll(() => answers(page)).toEqual([{type: "close-answer", generation: 1, answer: "deny"}]);
    await expect(layer(page)).toHaveCount(0);
    await expect(prose(page)).toBeFocused();
    await page.keyboard.type("二");
    await expect(prose(page)).toContainText("甲一二");

    // 存不了：全部保存之后换成失败说明，知道了之后不关。
    await chmod(join(projectDir, "notes"), 0o555);
    await shell(page, {type: "close-query", generation: 2, reason: "window"});
    await page.locator("[data-editor-window-close-save]").click();
    await expect(windowDialog(page)).toContainText("没能保存");
    await page.locator("[data-editor-window-close-cancel]").click();
    await expect.poll(async () => (await answers(page)).at(-1)).toEqual({type: "close-answer", generation: 2, answer: "deny"});
    expect(await disk("notes/a46.md")).toBe("甲\n");

    // 恢复后全部保存：存好才同意，层留着等窗口关掉。
    await chmod(join(projectDir, "notes"), 0o755);
    await shell(page, {type: "close-query", generation: 3, reason: "window"});
    await page.locator("[data-editor-window-close-save]").click();
    await expect.poll(async () => (await answers(page)).at(-1)).toEqual({type: "close-answer", generation: 3, answer: "allow"});
    expect(await disk("notes/a46.md")).toBe("甲一二\n");
    await expect(layer(page)).toBeVisible();
});

test("询问前开着的命令面板在询问期间点不到；壳结束询问（close-end）后撤层、编辑器的询问收起、页面照旧", async ({page}) => {
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify({"nbook.editor/autoSave": "off"}));
    await installShell(page);
    await editFile(page, "notes/b15.md", "乙\n", "一");
    const combobox = page.getByRole("combobox", {name: "输入命令，或输入 : 跳到某一行"});
    await expect(async () => {
        await page.keyboard.press("Control+Shift+P");
        await expect(combobox).toBeFocused({timeout: 500});
    }).toPass();

    await shell(page, {type: "close-query", generation: 5, reason: "window"});
    await expect(windowDialog(page)).toBeVisible();
    // 面板要么随焦点离开收起了，要么还画着却在 inert 的子树里：都用不了。
    expect(await page.evaluate(() => [...document.querySelectorAll("[role='combobox']")].every((element) => element.closest("[inert]") !== null))).toBe(true);

    await shell(page, {type: "close-end", generation: 5});
    await expect(layer(page)).toHaveCount(0);
    await expect(windowDialog(page)).toHaveCount(0);
    expect(await answers(page)).toEqual([]);
    await expect(tab(page, "b15.md")).toHaveAttribute("data-editor-tab-dirty", "");
});

test("关最后一个窗口（quit）：经服务端的在跑的工作接口取工作，没有工作、也没有要保存的就直接同意，不提示", async ({page}) => {
    await installShell(page);
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    const work = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/runtime/work");
    await shell(page, {type: "close-query", generation: 1, reason: "quit"});
    expect((await work).status()).toBe(200);
    await expect.poll(() => answers(page)).toEqual([{type: "close-answer", generation: 1, answer: "allow"}]);
    await expect(page.locator("[data-close-prompt]")).toHaveCount(0);
});
