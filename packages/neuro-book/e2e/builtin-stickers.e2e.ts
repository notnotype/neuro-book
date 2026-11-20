/**
 * 内置表情包在真实 Chrome 里的验收（docs/specs/agent/stickers.md 验收 13）：全新的状态根（没有用户的表情包），生产构建的后端从
 * 应用自带的目录读内置的星璃；主创默认的白名单里有它。复制到我的走表情包页，换图直接写状态根里的文件。模型是 Bun 子进程里的
 * 本机端点。等页面上可观察的变化，不按时长等待。
 */

import {execFileSync, spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {localModelSettings} from "nbook/plugins/agent/testing/endpoint";

import {PACKAGE_ROOT, startProductServer, track} from "./fixtures";
import type {ProcessHandle, ProductServer} from "./fixtures";

let tmp = "";
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
    tmp = await createTestTmpRoot("neuro-book-e2e", "builtin-stickers");
    const projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(projectDir, "第一章.md"), "雨越下越大。\n");
    await mkdir(stateRoot, {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    const child = spawn("bun", [join("e2e", "support", "agent-endpoint.ts")], {cwd: PACKAGE_ROOT, stdio: ["pipe", "pipe", "pipe"]});
    const handle = track(child);
    const [, baseUrl, controlUrl] = await handle.waitFor(/READY (\S+) (\S+)/u);
    endpoint = {...handle, control: controlUrl!, child};
    // 只配模型，不动 Profile 的表情包设置：主创用的是声明里默认的内置星璃。
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

async function openConversation(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-explorer-row]").first()).toBeVisible();
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("打开对话");
    await page.keyboard.press("Enter");
    await expect(input(page)).toBeVisible();
}

/** 发一句话，等回复里最后一个 `raw` 换成图、图读出来，交回图的原始宽度（内置的是 512，换过的图另有宽度）。 */
async function replyImageWidth(page: Page, text: string, raw: string): Promise<number> {
    await input(page).click();
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
    const image = page.locator(`.nb-sticker[data-sticker="${raw}"] img`).last();
    await expect(image).toHaveAttribute("alt", raw);
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
    return image.evaluate((element) => (element as HTMLImageElement).naturalWidth);
}

test("验收 13：全新的状态根里主创的槽列出内置星璃、回复显示成图；复制到我的、换图后同一写法显示我的那份，槽里内置的改写 id，表情包页标“被我的同名包盖住”", async ({page}) => {
    const manifest = JSON.parse(await readFile(join(PACKAGE_ROOT, "src", "plugins", "stickers", "builtin", "lyra", "stickers.json"), "utf8")) as {stickers: Array<{file: string}>};
    const names = manifest.stickers.map((item) => item.file.replace(/\.webp$/u, ""));

    await script(":lyra/开心:");
    await openConversation(page);
    expect(await replyImageWidth(page, "今天写完啦", ":lyra/开心:")).toBe(512);
    const before = await lastRequest();
    expect(before).toContain("stickers://builtin.lyra/");
    for (const name of names) expect(before).toContain(`:lyra/${name}:`);
    // 半身版不在主创默认的白名单里。
    expect(before).not.toContain("stickers://builtin.lyra-chibi/");

    // 表情包页：内置的在最后一组，只读，复制到我的。
    await expect(async () => {
        await page.keyboard.press("Control+,");
        await expect(page.locator("[data-settings-nav-current]")).toBeFocused({timeout: 500});
    }).toPass();
    await page.locator("[data-settings-window]").getByRole("button", {name: "表情包", exact: true}).click();
    await page.locator("[data-sticker-rail-item='builtin.lyra']").click();
    await expect(page.locator("[data-sticker-add]")).toHaveCount(0);
    await page.locator("[data-sticker-copy]").click();
    await expect(page.locator("[data-sticker-rail-item='user.lyra']")).toHaveAttribute("aria-current", "page");
    await expect(page.locator("[data-sticker-rail-item='builtin.lyra'] [data-sticker-rail-flag='shadowed']")).toBeVisible();

    // 换掉我的“开心”（复制过来的清单里它的文件是 kaixin.webp）：一张 64×64 的真 WebP（扩展名与字节相符才认）。测试进程是 Node，借 bun 现做。
    const webpPath = join(stateRoot, "user", "stickers", "lyra", "kaixin.webp");
    execFileSync("bun", ["-e", `const pixel = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0)); await Bun.write(${JSON.stringify(webpPath)}, await new Bun.Image(pixel).resize(64, 64).webp().bytes());`]);
    // 页面随目录的通知更新：网格里的图换成新的，说明目录已经重扫。
    await expect.poll(() => page.locator("[data-grid-key^='s:开心'] img").evaluate((element) => (element as HTMLImageElement).complete ? (element as HTMLImageElement).naturalWidth : 0)).toBe(64);

    await script(":lyra/开心:");
    await openConversation(page);
    expect(await replyImageWidth(page, "再来一个", ":lyra/开心:")).toBe(64);
    const after = await lastRequest();
    expect(after).toContain(":builtin.lyra/开心:");
    expect(after).toContain("stickers://builtin.lyra/");
});
