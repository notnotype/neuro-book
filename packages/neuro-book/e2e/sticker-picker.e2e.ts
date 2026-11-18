/**
 * 表情选择器与补全在真实 Chrome 里的验收（docs/specs/agent/stickers.md 验收 11、12）：生产构建的后端与前端，表情包放在状态根的
 * `user/stickers/`；模型是 Bun 子进程里的本机端点。等页面上可观察的变化，不按时长等待。
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

/** 64×64 的 PNG（透明底上一个圆）：行内小图按字高缩放，量竖直中心要有个像样的图。 */
const SQUARE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABFklEQVR42u2byxHDIAxEkSpIQS4mpaWYFJQO4ktOmbH5WBgk3p49Yfdp4WCHlBBCK0vuXOzz2r6lzz6eb3EPoCbwKCAye/DeIMRL8F4gxFtwaxDqObzF+uo5vIUP8RzcYktopPAt/jRS+BafmhaXRpt+rV+NGL7Gt0YNX+qfMyDy9Ety0IDo08/loQErTP8sFw0AAADW2P9H+WgAAAAAAAAAAAAAAAAAfrrrnxmj9J+PBgAAAPl9EnX/04AzANFacJSHBrRQizJ9GlACwHsLcv7V4ke8hq/aAt4glPrlDOhB1cv0mxowO4Raf5fCzPQZrXUwOmLRWcKbHIKjIVxdnxsjPcwte2eoJwhXt8YsgER/O43QJNoBXFKEaD4oZsoAAAAASUVORK5CYII=", "base64");

// 宽一点的窗口：右栏开着时 1280 宽的编辑器工具栏放到“图片”就收进“⋯”了，“表情”要直接露在工具栏上。
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
const lastRequest = async () => JSON.stringify((await control("/requests") as {messages: unknown[]}[]).at(-1)!.messages);

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "sticker-picker");
    projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(projectDir, "表情.md"), "写完啦\n\n今天很开心\n");
    await mkdir(join(stateRoot, "user", "stickers", "lyra"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    // 没有清单：每张图是一个表情，名字取文件名。
    for (const name of ["开心", "困", "害羞"]) await writeFile(join(stateRoot, "user", "stickers", "lyra", `${name}.png`), SQUARE);

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

/** `scope` 里的一个表情：换成了图、图读得出来。 */
async function expectImage(scope: Page | Locator, raw: string): Promise<Locator> {
    const image = scope.locator(`.nb-sticker[data-sticker="${raw}"] img`).first();
    await expect(image).toHaveAttribute("alt", raw);
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
    return image;
}

async function openFile(page: Page): Promise<Locator> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await page.locator("[data-explorer-row=\"project://表情.md\"]").dblclick();
    const prose = page.locator("[data-editor-group-active] [data-editor-kind=\"nbook.editor.markdown\"]:visible [data-editor-prose]");
    await expect(prose).toBeVisible();
    return prose;
}

/** 补全里我的 lyra 的“开心”（没有清单，包的标题就是文件夹名）；内置的星璃与半身版各有一条同名的。 */
const myHappy = (page: Page) => page.getByRole("option", {name: "开心 lyra", exact: true});

const editorStickerButton =(page: Page) => page.locator("[data-editor-group-active] .markdown-toolbar").getByRole("button", {name: "表情", exact: true});
const pickerCells = (page: Page) => page.locator("[data-state='open'] [data-sticker-picker-panel] [data-sticker-cell]");

test("验收 11：编辑器里打 `:开` 回车插入表情；工具栏的“表情”选一个；重开后“最近用过”记得先后", async ({page}) => {
    const file = join(projectDir, "表情.md");
    const prose = await openFile(page);
    await prose.locator("p").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(":开");
    // 内置的两套也有“开心”：补全里我的排在最前、默认高亮，回车插入的是它。
    const option = myHappy(page);
    await expect(option.locator("[data-suggestion-menu-image]")).toBeVisible();
    await expect(option).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expectImage(prose, ":lyra/开心:");
    await page.keyboard.press("Control+s");
    await expect.poll(() => readFile(file, "utf8")).toBe("写完啦:lyra/开心:\n\n今天很开心\n");

    // 工具栏的“表情”：锚在光标，点一下插在光标处、关上，焦点回正文。
    await prose.locator("p").nth(1).click();
    await page.keyboard.press("End");
    await editorStickerButton(page).click();
    await pickerCells(page).filter({has: page.locator("img")}).first().waitFor();
    await page.locator("[data-state='open'] [data-sticker-group='user.lyra'] [data-sticker-cell][data-sticker-raw=':lyra/困:']").click();
    await expect(pickerCells(page)).toHaveCount(0);
    await expect(prose).toBeFocused();
    await page.keyboard.press("Control+s");
    await expect.poll(() => readFile(file, "utf8")).toBe("写完啦:lyra/开心:\n\n今天很开心:lyra/困:\n");

    // 最近用过记在本机：重开窗口后第一组是“最近用过”，新的在前。
    await page.reload();
    await openFile(page);
    await editorStickerButton(page).click();
    const recent = page.locator("[data-state='open'] [data-sticker-group='recent'] [data-sticker-cell]");
    await expect(recent).toHaveCount(2);
    expect(await recent.evaluateAll((cells) => cells.map((cell) => (cell as HTMLElement).dataset.stickerRaw))).toEqual([":lyra/困:", ":lyra/开心:"]);
    await page.keyboard.press("Escape");
    await expect(pickerCells(page)).toHaveCount(0);
});

test("验收 12：输入框里打 `:kx` 选“开心”发出去是写法原文、消息里是行内小图且与文字对齐；只发一个表情的消息没有气泡、是大图", async ({page}) => {
    await script("收到", "好");
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-explorer-row]").first()).toBeVisible();
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("打开对话");
    await page.keyboard.press("Enter");
    await expect(input(page)).toBeVisible();

    await input(page).click();
    await page.keyboard.type("写完啦:kx");
    // 拼音库第一次搜索时才加载：等补全出现。
    const option = myHappy(page);
    await expect(option).toBeVisible();
    await expect(option).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expectImage(input(page), ":lyra/开心:");
    await page.keyboard.type("明天见");
    await page.keyboard.press("Enter");

    const sent = page.locator(".acv-user-bubble").filter({hasText: "写完啦"});
    const image = await expectImage(sent, ":lyra/开心:");
    expect(await lastRequest()).toContain("写完啦:lyra/开心:明天见");
    // 行内小图的竖直中心与同一行文字的中心相差不超过 2 像素（输出 44、45；按汉字字形的中心对齐）。
    const textCenter = await sent.evaluate((element) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            const at = (node.textContent ?? "").indexOf("写完啦");
            if (at < 0) continue;
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + 3);
            const box = range.getBoundingClientRect();
            return box.top + box.height / 2;
        }
        throw new Error("找不到文字");
    });
    const imageBox = await image.boundingBox();
    expect(Math.abs(imageBox!.y + imageBox!.height / 2 - textCenter)).toBeLessThanOrEqual(2);

    // 表情按钮：在 `+` 后面，点开选一个，直接发出。
    await input(page).click();
    await page.locator("[data-composer-toolbar='stickers']").click();
    // “最近用过”里也有它：点表情包那一组里的。
    await page.locator("[data-state='open'] [data-sticker-group='user.lyra'] [data-sticker-cell][data-sticker-raw=':lyra/开心:']").click();
    await expectImage(input(page), ":lyra/开心:");
    await page.keyboard.press("Enter");
    const bare = page.locator("[data-user-bare]");
    await expect(bare).toHaveCount(1);
    await expect(bare.locator(".nb-sticker-block .nb-sticker.has-image")).toHaveCount(1);
});
