/**
 * 表情的大图预览与按贴纸显示在真实 Chrome 里的验收（docs/specs/agent/stickers.md 输出 46、47）：生产构建的后端与前端，表情包放在
 * 状态根的 `user/stickers/`（64×64 的小图，看预览放大到 320）；模型是 Bun 子进程里的本机端点。焦点、模态对话框的焦点锁与弹层的
 * “焦点离开就收起”在 happy-dom 里不可信，放在这里测。等页面上可观察的变化，不按时长等待。
 */

import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Locator, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {localModelSettings} from "nbook/plugins/agent/testing/endpoint";

import {PACKAGE_ROOT, startProductServer, track} from "./fixtures";
import type {ProcessHandle, ProductServer} from "./fixtures";

/** 64×64 的 PNG（透明底上一个圆），同 sticker-picker.e2e.ts。 */
const SQUARE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABFklEQVR42u2byxHDIAxEkSpIQS4mpaWYFJQO4ktOmbH5WBgk3p49Yfdp4WCHlBBCK0vuXOzz2r6lzz6eb3EPoCbwKCAye/DeIMRL8F4gxFtwaxDqObzF+uo5vIUP8RzcYktopPAt/jRS+BafmhaXRpt+rV+NGL7Gt0YNX+qfMyDy9Ety0IDo08/loQErTP8sFw0AAADW2P9H+WgAAAAAAAAAAAAAAAAAfrrrnxmj9J+PBgAAAPl9EnX/04AzANFacJSHBrRQizJ9GlACwHsLcv7V4ke8hq/aAt4glPrlDOhB1cv0mxowO4Raf5fCzPQZrXUwOmLRWcKbHIKjIVxdnxsjPcwte2eoJwhXt8YsgER/O43QJNoBXFKEaD4oZsoAAAAASUVORK5CYII=", "base64");

// 宽一点的窗口：编辑器工具栏的“表情”要直接露在工具栏上（同 sticker-picker.e2e.ts）。
test.use({viewport: {width: 1920, height: 1000}});

let tmp = "";
let projectDir = "";
let stateRoot = "";
let server: ProductServer;
let endpoint: ProcessHandle & {control: string; child: ReturnType<typeof spawn>};

async function control(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${endpoint.control}${path}`, body === undefined ? {} : {method: "POST", body: JSON.stringify(body)});
    return response.json();
}
const script = (...replies: unknown[]) => control("/script", replies);

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "sticker-preview");
    projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(projectDir, "表情.md"), "前:lyra/开心:后\n\n今天很开心\n");
    await mkdir(join(stateRoot, "user", "stickers", "lyra"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    for (const name of ["开心", "困"]) await writeFile(join(stateRoot, "user", "stickers", "lyra", `${name}.png`), SQUARE);

    const child = spawn("bun", [join("e2e", "support", "agent-endpoint.ts")], {cwd: PACKAGE_ROOT, stdio: ["pipe", "pipe", "pipe"]});
    const handle = track(child);
    const [, baseUrl, controlUrl] = await handle.waitFor(/READY (\S+) (\S+)/u);
    endpoint = {...handle, control: controlUrl!, child};
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify(localModelSettings(baseUrl!)));
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    endpoint.child.stdin?.end();
    await endpoint.exit;
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const input = (page: Page) => page.getByRole("textbox", {name: "消息输入框"});
/** 预览对话框：nb-ui 的 ImagePreviewDialog，头部有“下载原图”。选择器面板也是 `role=dialog`，按下载按钮区分。 */
const previewDialog = (page: Page) => page.getByRole("dialog").filter({has: page.getByRole("link", {name: "下载原图"})});

/** `scope` 里的一个表情：换成了图、图读得出来。 */
async function expectImage(scope: Page | Locator, raw: string): Promise<Locator> {
    const image = scope.locator(`.nb-sticker[data-sticker="${raw}"] img`).first();
    await expect(image).toHaveAttribute("alt", raw);
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
    return image;
}

/** 预览里的图：读完后的显示宽度。 */
async function previewWidth(page: Page): Promise<number> {
    const image = previewDialog(page).locator("img");
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
    return Math.round((await image.boundingBox())!.width);
}

async function openConversation(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-explorer-row]").first()).toBeVisible();
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("打开对话");
    await page.keyboard.press("Enter");
    await expect(input(page)).toBeVisible();
}

async function openFile(page: Page): Promise<Locator> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await page.locator("[data-explorer-row=\"project://表情.md\"]").dblclick();
    const prose = page.locator("[data-editor-group-active] [data-editor-kind=\"nbook.editor.markdown\"]:visible [data-editor-prose]");
    await expect(prose).toBeVisible();
    return prose;
}

test("输出 46：对话里点回复与用户消息里的表情打开大图：标题“名字 · 包名”，64 像素的图放大到 320，复制的是写法；Esc 关上", async ({page, context}) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await script("写完啦:lyra/开心:明天见", "好");
    await openConversation(page);
    await input(page).click();
    await page.keyboard.type("今天怎么样");
    await page.keyboard.press("Enter");
    // 输入框还空着：页面上这个写法只在回复里。
    const reply = await expectImage(page, ":lyra/开心:");
    await reply.click();
    await expect(previewDialog(page)).toBeVisible();
    await expect(previewDialog(page)).toContainText("开心 · lyra");
    expect(await previewWidth(page)).toBe(320);
    await previewDialog(page).getByRole("button", {name: "复制写法"}).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(":lyra/开心:");
    await page.keyboard.press("Escape");
    await expect(previewDialog(page)).toHaveCount(0);

    // 用户消息：只发一个表情（没有气泡、是大图），点它同样打开。
    await input(page).fill(":lyra/困:");
    await page.keyboard.press("Enter");
    const sent = await expectImage(page.locator("[data-user-bare]").last(), ":lyra/困:");
    await sent.click();
    await expect(previewDialog(page)).toContainText("困 · lyra");
    await page.keyboard.press("Escape");
    await expect(previewDialog(page)).toHaveCount(0);
});

test("输出 46：编辑器里单击表情打开大图；关上后焦点回到正文，接着打的字落在这个表情后面", async ({page}) => {
    const file = join(projectDir, "表情.md");
    const prose = await openFile(page);
    const image = await expectImage(prose, ":lyra/开心:");
    await image.click();
    await expect(previewDialog(page)).toContainText("开心 · lyra");
    await page.keyboard.press("Escape");
    await expect(previewDialog(page)).toHaveCount(0);
    await expect(prose).toBeFocused();
    await page.keyboard.type("呀");
    await page.keyboard.press("Control+s");
    await expect.poll(() => readFile(file, "utf8")).toBe("前:lyra/开心:呀后\n\n今天很开心\n");
});

test("输出 46：选择器底部“查看大图”打开预览，面板不收起；Esc 先关预览、焦点回到打开前的搜索框，再按 Esc 才关面板", async ({page}) => {
    await openFile(page);
    const prose = page.locator("[data-editor-group-active] [data-editor-kind=\"nbook.editor.markdown\"]:visible [data-editor-prose]");
    await prose.locator("p").nth(1).click();
    await page.locator("[data-editor-group-active] .markdown-toolbar").getByRole("button", {name: "表情", exact: true}).click();
    const panel = page.locator("[data-state='open'] [data-sticker-picker-panel]");
    const cell = panel.locator("[data-sticker-group='user.lyra'] [data-sticker-cell][data-sticker-raw=':lyra/困:']");
    await cell.hover();
    const button = panel.getByRole("button", {name: "查看大图：困"});
    await button.click();
    await expect(previewDialog(page)).toContainText("困 · lyra");
    // 否定断言：对话框锁走焦点之后面板还在（删掉面板 onFocusout 里预览开着的判断，这里失败）。先看到对话框的复制按钮，再查面板。
    await expect(previewDialog(page).getByRole("button", {name: "复制写法"})).toBeVisible();
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(previewDialog(page)).toHaveCount(0);
    await expect(panel).toBeVisible();
    // 按钮按下时不抢焦点（同标签），焦点一直在打开面板时的搜索框：预览关上后回到这里，接着打字照常搜索。
    await expect(panel.locator("input")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
});

test("输出 47：表情包设成按贴纸显示，正文与输入框里夹在文字中的表情不重载就变成 120 像素高；关掉变回去", async ({page}) => {
    const prose = await openFile(page);
    const inline = await expectImage(prose, ":lyra/开心:");
    const height = async (image: Locator) => Math.round((await image.boundingBox())!.height);
    const small = await height(inline);
    expect(small).toBeLessThan(40);

    const settings = async (): Promise<void> => {
        await expect(async () => {
            await page.keyboard.press("Control+,");
            await expect(page.locator("[data-settings-nav-current]")).toBeFocused({timeout: 500});
        }).toPass();
        await page.locator("[data-settings-window]").getByRole("button", {name: "表情包", exact: true}).click();
        await page.locator("[data-sticker-rail-item='user.lyra']").click();
    };
    await settings();
    const toggle = page.locator("[data-pack-sticker-display]");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-settings-window]")).toHaveCount(0);
    await expect.poll(() => height(inline)).toBe(120);

    // 输入框：插入同一个包的表情，夹在文字里也是 120 像素；输入框不超过它的最大高度，内部滚动。
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("打开对话");
    await page.keyboard.press("Enter");
    await input(page).click();
    await page.keyboard.type("写完啦");
    await page.locator("[data-composer-toolbar='stickers']").click();
    await page.locator("[data-state='open'] [data-sticker-group='user.lyra'] [data-sticker-cell][data-sticker-raw=':lyra/开心:']").click();
    await page.keyboard.type("明天见");
    const composed = await expectImage(input(page), ":lyra/开心:");
    expect(await height(composed)).toBe(120);
    const box = (await input(page).boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(220);

    // 关掉：已显示的跟着变回行内小图。
    await settings();
    await page.locator("[data-pack-sticker-display]").click();
    await expect(page.locator("[data-pack-sticker-display]")).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Escape");
    await expect.poll(() => height(composed)).toBeLessThan(40);
});
