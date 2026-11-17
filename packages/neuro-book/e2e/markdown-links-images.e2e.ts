/**
 * 链接与图片的插入（docs/specs/workbench/markdown-editing.md 输出 52–58、验收场景 27–30）：本机 Chrome 的真实键盘、鼠标与系统剪贴板
 * 接口，产品页、真实文件服务与真实的上传接口；判据是保存后磁盘上的原文与图片文件。动作、卡片与插件的细节由 nb-markdown 的
 * `image-paste.dom.test.ts`、`links-images.dom.test.ts` 与 neuro-book 的 `MarkdownMenus.dom.test.ts`、`MarkdownControl.dom.test.ts` 测；这里只留它们
 * 测不到的：真实键入的 Ctrl+K 与 Ctrl 点击、系统剪贴板里的位图经 Ctrl+V 进来、上传落到磁盘上的文件头与宽高、设置改变存放位置、
 * 文件被外部删除后的只读。未验证（留给真机）：桌面壳里系统选文件框开着时窗口失焦；Windows 截图、文件管理器复制文件、Word 里
 * 的图这几类真实剪贴板内容；超过 32 MiB 的粘贴（后端用例与 DOM 用例覆盖，这里不造几十兆的位图）。
 */

import {randomUUID} from "node:crypto";
import {mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {deflateSync} from "node:zlib";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

let tmp = "";
let projectDir = "";
let server: ProductServer;
/** 这一例写的文件（用完删）与要清掉的目录。 */
const written: string[] = [];
const dirs: string[] = [];

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "markdown-links-images");
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

test.afterEach(async () => {
    for (const path of written.splice(0)) await rm(join(projectDir, path), {force: true});
    for (const path of dirs.splice(0)) await rm(join(projectDir, path), {recursive: true, force: true});
    await rm(join(projectDir, ".nbook/settings.json"), {force: true});
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const item = (page: Page, address: string) => page.locator(`[data-explorer-row="${address}"]`);
const prose = (page: Page) => page.locator("[data-editor-group-active] [data-editor-kind=\"nbook.editor.markdown\"]:visible [data-editor-prose]");
const textPrompt = (page: Page) => page.locator("[data-markdown-text-prompt]");
const imageCard = (page: Page) => page.locator("[data-markdown-image-card]");
const toolbarButton = (page: Page, name: string) => page.locator(`[data-editor-group-active] .markdown-toolbar button[aria-label="${name}"]`);
const disk = (path: string): Promise<string> => readFile(join(projectDir, path), "utf8");
const names = (path: string): Promise<string[]> => readdir(join(projectDir, path)).catch(() => []);

/** 写一个文件（用完删）。 */
async function put(path: string, content: string | Buffer): Promise<void> {
    await mkdir(dirname(join(projectDir, path)), {recursive: true});
    await writeFile(join(projectDir, path), content);
    written.push(path);
}

/** 打开作品并用富文本打开 `path`（要先写好）；每个用例用自己的文件。 */
async function openFile(page: Page, path: string): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    // 恢复会话时文件夹的展开状态还在变：要等到活动标签真是这个文件。
    const name = path.split("/").at(-1) as string;
    await expect(async () => {
        const folder = item(page, "project://notes");
        if (await folder.getAttribute("aria-expanded") !== "true") await folder.click();
        await item(page, `project://${path}`).dblclick({timeout: 3000});
        await expect(page.locator("[data-editor-group-head-active] [data-editor-tab]").filter({hasText: name})).toBeVisible({timeout: 3000});
    }).toPass();
    await expect(prose(page)).toBeVisible();
}

/** ProseMirror 经 `selectionchange` 异步同步选区：先等页面里选中的字数对上、再等两帧，再按快捷键、粘贴或打字。 */
async function syncedSelection(page: Page, length: number): Promise<void> {
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().length ?? 0)).toBe(length);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** 光标放到第一段的行首，再往右 `skip` 个字、选 `length` 个字。 */
async function select(page: Page, skip: number, length: number): Promise<void> {
    await prose(page).locator("p").first().click();
    await expect(prose(page)).toBeFocused();
    await page.keyboard.press("Control+Home");
    for (let step = 0; step < skip; step += 1) await page.keyboard.press("ArrowRight");
    for (let step = 0; step < length; step += 1) await page.keyboard.press("Shift+ArrowRight");
    if (length > 0) await syncedSelection(page, length);
    else await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function save(page: Page): Promise<void> {
    await prose(page).focus();
    await page.keyboard.press("Control+s");
}

/** 一张纯色的 PNG（真实的文件头、IHDR、压缩数据与校验）：宽高写在 IHDR 里，测试据此核对存下来的文件。 */
function pngOf(width: number, height: number): Buffer {
    const table = Array.from({length: 256}, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
    });
    const crc = (bytes: Buffer): number => {
        let c = 0xffffffff;
        for (const byte of bytes) c = (table[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Buffer): Buffer => {
        const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
        const out = Buffer.alloc(body.length + 8);
        out.writeUInt32BE(data.length, 0);
        body.copy(out, 4);
        out.writeUInt32BE(crc(body), body.length + 4);
        return out;
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 2;
    // 每行一个过滤字节（0）加 RGB 三个字节。
    const rows = Buffer.alloc((width * 3 + 1) * height, 0x7f);
    for (let row = 0; row < height; row += 1) rows[row * (width * 3 + 1)] = 0;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

const dimensionsOf = (png: Buffer): {width: number; height: number} => ({width: png.readUInt32BE(16), height: png.readUInt32BE(20)});

/** 往系统剪贴板放一张位图（可以同时带文字与 HTML）：真实的剪贴板接口，页面要有焦点。 */
async function copyImage(page: Page, png: Buffer, extra: {text?: string; html?: string} = {}): Promise<void> {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {origin: new URL(server.url).origin});
    await page.evaluate(async ({base64, text, html}) => {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        const data: Record<string, Blob> = {"image/png": new Blob([bytes], {type: "image/png"})};
        if (text !== undefined) data["text/plain"] = new Blob([text], {type: "text/plain"});
        if (html !== undefined) data["text/html"] = new Blob([html], {type: "text/html"});
        await navigator.clipboard.write([new ClipboardItem(data)]);
    }, {base64: png.toString("base64"), text: extra.text, html: extra.html});
}

const PASTED = /^粘贴的图片 \d{8}-\d{6}(?: \d+)?\.png$/u;

test("场景 27：选中的字 Ctrl+K 加链接（写成相对地址）、光标在链接里改地址与去掉链接", async ({page}) => {
    await put("设定/林雪.md", "# 林雪\n");
    await put("notes/link-27.md", "见林雪的设定\n");
    await openFile(page, "notes/link-27.md");
    await select(page, 1, 2);
    await page.keyboard.press("Control+k");
    await expect(textPrompt(page)).toBeVisible();
    // 选区菜单让位；卡片开着时选中的字仍画成选中。
    await expect(page.locator("[data-markdown-selection-menu]")).toHaveCount(0);
    await expect(prose(page).locator(".nb-markdown-held-selection")).toHaveText("林雪");
    await textPrompt(page).locator("input").fill("project://设定/林雪.md");
    await page.keyboard.press("Enter");
    await expect(textPrompt(page)).toHaveCount(0);
    await expect(prose(page).locator("a")).toHaveText("林雪");
    await save(page);
    await expect.poll(() => disk("notes/link-27.md")).toBe("见[林雪](../设定/林雪.md)的设定\n");

    // 只选中链接中间的字再 Ctrl+K：预填整条链接的地址，改的是整条。
    await select(page, 2, 1);
    await page.keyboard.press("Control+k");
    await expect(textPrompt(page).locator("input")).toHaveValue("../设定/林雪.md");
    await textPrompt(page).locator("input").fill("../设定/雪.md");
    await page.keyboard.press("Enter");
    await save(page);
    await expect.poll(() => disk("notes/link-27.md")).toBe("见[林雪](../设定/雪.md)的设定\n");

    // 去掉链接：文字留着。
    await select(page, 2, 1);
    await page.keyboard.press("Control+k");
    await textPrompt(page).getByRole("button", {name: "去掉链接"}).click();
    await save(page);
    await expect.poll(() => disk("notes/link-27.md")).toBe("见林雪的设定\n");
});

test("场景 27：按住 Ctrl 点作品里的链接在编辑器区打开，不按 Ctrl 的单击只选中整条链接；外部网址新标签页打开", async ({page}) => {
    await put("设定/林雪.md", "# 林雪\n");
    await put("notes/link-open.md", "见[林雪](../设定/林雪.md)与[官网](https://example.com/)\n");
    await page.context().route("https://example.com/**", (route) => route.fulfill({contentType: "text/html", body: "<title>example</title>"}));
    await openFile(page, "notes/link-open.md");
    const tabs = page.locator("[data-editor-group-head-active] [data-editor-tab]");
    const before = await tabs.count();
    await prose(page).locator("a", {hasText: "林雪"}).click();
    await syncedSelection(page, 2);
    expect(await tabs.count()).toBe(before);
    await prose(page).locator("a", {hasText: "林雪"}).click({modifiers: ["Control"]});
    await expect(tabs.filter({hasText: "林雪.md"})).toBeVisible();
    // 回到原来的文件，按住 Ctrl 点外部网址：新标签页。
    await tabs.filter({hasText: "link-open.md"}).click();
    const popup = page.context().waitForEvent("page");
    await prose(page).locator("a", {hasText: "官网"}).click({modifiers: ["Control"]});
    expect((await popup).url()).toBe("https://example.com/");
});

test("场景 27：链接里夹着图片：改地址改的是整条（图片与后面的字一起），去掉链接也是整条", async ({page}) => {
    await put("notes/link-image.md", "见[前文![图](../插图/a.png)后文](https://old.com)吧\n");
    await openFile(page, "notes/link-image.md");
    // 光标在“前文”的两个字中间。
    await select(page, 2, 0);
    await page.keyboard.press("Control+k");
    await expect(textPrompt(page).locator("input")).toHaveValue("https://old.com");
    await textPrompt(page).locator("input").fill("https://new.com");
    await page.keyboard.press("Enter");
    await save(page);
    await expect.poll(() => disk("notes/link-image.md")).toBe("见[前文![图](../插图/a.png)后文](https://new.com)吧\n");
    await select(page, 2, 0);
    await page.keyboard.press("Control+k");
    await textPrompt(page).getByRole("button", {name: "去掉链接"}).click();
    await save(page);
    await expect.poll(() => disk("notes/link-image.md")).toBe("见前文![图](../插图/a.png)后文吧\n");
});

test("场景 27：只读文档里单击链接不被浏览器带走，按住 Ctrl 点外部链接只开一个新标签页（浏览器自己不跟随 <a target=_blank>）", async ({page}) => {
    await put("notes/link-readonly.md", "见[官网](https://example.com/)\n");
    await page.context().route("https://example.com/**", (route) => route.fulfill({contentType: "text/html", body: "<title>example</title>"}));
    await openFile(page, "notes/link-readonly.md");
    await rm(join(projectDir, "notes/link-readonly.md"));
    await expect(toolbarButton(page, "链接")).toBeDisabled();
    const pages: Page[] = [];
    page.context().on("page", (opened) => pages.push(opened));
    // 不按 Ctrl 的单击只选中，浏览器自己也不带走（只读时 `<a>` 是普通链接）；之后按住 Ctrl 点才打开，一共只开一个。
    await prose(page).locator("a", {hasText: "官网"}).click();
    await prose(page).locator("a", {hasText: "官网"}).click({modifiers: ["Control"]});
    await expect.poll(() => pages.length).toBe(1);
    // 第一个页面加载完，浏览器自己的那一次（如果有）也早已发出：仍只有一个。
    await (pages[0] as Page).waitForLoadState();
    expect(pages.length).toBe(1);
});

test("场景 29：表格单元格里用插图卡片选图（命令层也放行），图落在这个单元格里", async ({page}) => {
    dirs.push("插图");
    await put("插图/a.png", pngOf(4, 4));
    await put("notes/image-cell.md", "| 甲 | 乙 |\n| --- | --- |\n| 丙 | 丁 |\n");
    await openFile(page, "notes/image-cell.md");
    await prose(page).locator("td", {hasText: "丙"}).click();
    await page.keyboard.press("End");
    await toolbarButton(page, "图片").click();
    await expect(imageCard(page).locator("[data-markdown-image-row]")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(prose(page).locator("td .nb-markdown-image-node")).toHaveCount(1);
    await save(page);
    await expect.poll(() => disk("notes/image-cell.md")).toContain("丙![a](../插图/a.png)");
});

test("场景 27：光标在空行按 Ctrl+K 填网址，插入一段文字就是网址本身的链接", async ({page}) => {
    await put("notes/link-empty.md", "甲\n\n乙\n");
    await openFile(page, "notes/link-empty.md");
    // 在“甲”后面回车，得到一个空行。
    await prose(page).locator("p").first().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Control+k");
    await expect(prose(page).locator(".nb-markdown-held-caret")).toHaveCount(1);
    await textPrompt(page).locator("input").fill("https://example.com/a");
    await page.keyboard.press("Enter");
    await save(page);
    await expect.poll(() => disk("notes/link-empty.md")).toBe("甲\n\n[https\\://example.com/a](https://example.com/a)\n\n乙\n");
});

test("场景 28：粘贴截图存进作品根下的 插图/（文件头与宽高对得上），正文是指向它的相对地址；再粘贴一张是另一个名字", async ({page}) => {
    dirs.push("插图");
    await put("notes/paste.md", "甲乙\n");
    await openFile(page, "notes/paste.md");
    const png = pngOf(20, 10);
    await prose(page).locator("p").first().click();
    await page.keyboard.press("End");
    await copyImage(page, png);
    await page.keyboard.press("Control+v");
    await expect.poll(async () => (await names("插图")).filter((name) => PASTED.test(name)).length).toBe(1);
    const [first] = (await names("插图"));
    const stored = await readFile(join(projectDir, "插图", first as string));
    expect(stored.subarray(0, 8)).toEqual(png.subarray(0, 8));
    expect(dimensionsOf(stored)).toEqual({width: 20, height: 10});
    await expect(prose(page).locator(".nb-markdown-image-node")).toHaveCount(1);
    await expect(page.locator(".nb-markdown-image-uploading")).toHaveCount(0);
    await save(page);
    await expect.poll(() => disk("notes/paste.md")).toMatch(/^甲乙!\[\]\(<?\.\.\/插图\/粘贴的图片 \d{8}-\d{6}\.png>?\)\n$/u);
    await copyImage(page, pngOf(8, 8));
    await page.keyboard.press("Control+v");
    await expect.poll(async () => (await names("插图")).filter((name) => PASTED.test(name)).length).toBe(2);
    await expect(prose(page).locator(".nb-markdown-image-node")).toHaveCount(2);
});

test("场景 28：设置改成与当前文件同目录、当前文件旁的子目录，粘贴的图存到对应的目录", async ({page}) => {
    dirs.push("插图", "notes/图");
    await put("notes/paste-where.md", "甲乙\n");
    await writeFile(join(projectDir, ".nbook/settings.json"), JSON.stringify({"nbook.editor/imageLocation": "same"}));
    await openFile(page, "notes/paste-where.md");
    await prose(page).locator("p").first().click();
    await page.keyboard.press("End");
    await copyImage(page, pngOf(6, 6));
    await page.keyboard.press("Control+v");
    await expect.poll(async () => (await names("notes")).filter((name) => PASTED.test(name)).length).toBe(1);
    expect(await names("插图")).toEqual([]);
    written.push(...(await names("notes")).filter((name) => PASTED.test(name)).map((name) => `notes/${name}`));
    await writeFile(join(projectDir, ".nbook/settings.json"), JSON.stringify({"nbook.editor/imageLocation": "sibling", "nbook.editor/imageFolder": "图"}));
    await openFile(page, "notes/paste-where.md");
    await prose(page).locator("p").first().click();
    await page.keyboard.press("End");
    await copyImage(page, pngOf(6, 6));
    await page.keyboard.press("Control+v");
    await expect.poll(async () => (await names("notes/图")).filter((name) => PASTED.test(name)).length).toBe(1);
});

test("场景 28：剪贴板里有位图又有实质的文字（表格软件复制的单元格）：照原来的粘贴，作品里没有新文件", async ({page}) => {
    dirs.push("插图");
    await put("notes/paste-cells.md", "甲乙\n");
    await openFile(page, "notes/paste-cells.md");
    await prose(page).locator("p").first().click();
    await page.keyboard.press("End");
    await copyImage(page, pngOf(10, 10), {text: "丙\t丁", html: "<table><tr><td>丙</td><td>丁</td></tr></table>"});
    await page.keyboard.press("Control+v");
    await expect(prose(page)).toContainText("丙");
    expect(await names("插图")).toEqual([]);
});

test("场景 29：插图卡片：列出存放目录里的图（名字倒序），按名字找整部作品里的图，选了插入相对地址、说明取文件名；上传复制进存放目录、重名加序号；网址", async ({page}) => {
    dirs.push("插图", "资料");
    await put("插图/a.png", pngOf(4, 4));
    await put("插图/b.png", pngOf(4, 4));
    await put("插图/c.png", pngOf(4, 4));
    await put("资料/林雪.png", pngOf(4, 4));
    await put("notes/image-card.md", "甲乙\n");
    await openFile(page, "notes/image-card.md");
    await prose(page).locator("p").first().click();
    await page.keyboard.press("End");
    await toolbarButton(page, "图片").click();
    await expect(imageCard(page)).toBeVisible();
    await expect(imageCard(page).locator("[data-markdown-image-row] .markdown-image-card__name")).toHaveText(["c.png", "b.png", "a.png"]);
    // 按名字找：别的目录里的图也在。
    await imageCard(page).locator("input[data-markdown-image-query]").fill("林");
    await expect(imageCard(page).locator("[data-markdown-image-row] .markdown-image-card__name")).toHaveText(["林雪.png"]);
    await page.keyboard.press("Enter");
    await expect(imageCard(page)).toHaveCount(0);
    await save(page);
    await expect.poll(() => disk("notes/image-card.md")).toBe("甲乙![林雪](../资料/林雪.png)\n");

    // 上传：选本机文件（Playwright 的 `setInputFiles` 绕过系统的选文件框）；已有同名文件时存成 `a 2.png`。
    await toolbarButton(page, "图片").click();
    await imageCard(page).locator("[data-markdown-image-file]").setInputFiles({name: "a.png", mimeType: "image/png", buffer: pngOf(7, 5)});
    await expect.poll(() => names("插图")).toEqual(["a 2.png", "a.png", "b.png", "c.png"]);
    expect(dimensionsOf(await readFile(join(projectDir, "插图/a 2.png")))).toEqual({width: 7, height: 5});
    await expect(imageCard(page)).toHaveCount(0);
    await save(page);
    await expect.poll(() => disk("notes/image-card.md")).toBe("甲乙![林雪](../资料/林雪.png)![a 2](<../插图/a 2.png>)\n");

    // 网址：列表只有“插入网址的图片”，回车插入网址。
    await toolbarButton(page, "图片").click();
    await imageCard(page).locator("input[data-markdown-image-query]").fill("https://example.com/封面.png");
    await expect(imageCard(page).locator("[data-markdown-image-url]")).toBeVisible();
    await page.keyboard.press("Enter");
    await save(page);
    await expect.poll(() => disk("notes/image-card.md")).toContain("![封面](https://example.com/封面.png)");
});

test("场景 30：文件被外部删除后文档只读：Ctrl+K 不响应，链接与图片按钮置灰，粘贴截图照原来的粘贴、作品里没有新文件", async ({page}) => {
    dirs.push("插图");
    await put("notes/readonly.md", "见林雪\n");
    await openFile(page, "notes/readonly.md");
    await rm(join(projectDir, "notes/readonly.md"));
    // 外部删除：文档变只读（输出 58），工具栏的链接与图片按钮置灰。
    await expect(toolbarButton(page, "链接")).toBeDisabled();
    await expect(toolbarButton(page, "图片")).toBeDisabled();
    await prose(page).locator("p").first().click();
    await page.keyboard.press("Control+Home");
    for (let step = 0; step < 3; step += 1) await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Control+k");
    await expect(textPrompt(page)).toHaveCount(0);
    await copyImage(page, pngOf(6, 6));
    await page.keyboard.press("Control+v");
    await expect(imageCard(page)).toHaveCount(0);
    // 被接手的粘贴在按键处理里就放下占位（同步）：没有占位说明没有接手；再看目录里仍没有文件。
    await expect(page.locator(".nb-markdown-image-uploading")).toHaveCount(0);
    expect(await names("插图")).toEqual([]);
});
