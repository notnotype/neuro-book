/**
 * 设置里的表情包页在真实 Chrome 里的验收（docs/specs/agent/stickers.md 验收 9、10 与输出 26 的方向键）：生产构建的后端与前端，表情包放在
 * 状态根的 `user/stickers/`，页面经真实的文件服务、远程调用与 HTTP 路由写它；模型是 Bun 子进程里的本机端点。等页面上可观察的变化，
 * 不按时长等待。
 */

import {execFileSync, spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {access, mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Locator, Page} from "@playwright/test";
import {unzipSync} from "fflate";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {localModelSettings} from "nbook/plugins/agent/testing/endpoint";

import {PACKAGE_ROOT, startProductServer, track} from "./fixtures";
import type {ProcessHandle, ProductServer} from "./fixtures";

/** 1×1 的 PNG：取图路由按字节判类型、按宽高核对，显示时按格子缩放。 */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

let tmp = "";
let stateRoot = "";
let server: ProductServer;
let endpoint: ProcessHandle & {control: string; child: ReturnType<typeof spawn>};
let photo: Buffer;

async function control(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${endpoint.control}${path}`, body === undefined ? {} : {method: "POST", body: JSON.stringify(body)});
    return response.json();
}
const script = (...replies: unknown[]) => control("/script", replies);
const lastRequest = async () => JSON.stringify((await control("/requests") as {messages: unknown[]}[]).at(-1)!.messages);

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "sticker-packs");
    const projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(projectDir, "第一章.md"), "雨越下越大。\n");
    await mkdir(stateRoot, {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    // 两个现成的表情包：`dog`（导入同名时用）与有三十张图的 `many`（方向键要有几行）。
    const stickers = join(stateRoot, "user", "stickers");
    await mkdir(join(stickers, "dog"), {recursive: true});
    await writeFile(join(stickers, "dog", "stickers.json"), JSON.stringify({title: "狗狗", stickers: [{file: "汪.png", common: true}]}));
    await writeFile(join(stickers, "dog", "汪.png"), PIXEL);
    await mkdir(join(stickers, "many"), {recursive: true});
    for (let index = 0; index < 30; index += 1) await writeFile(join(stickers, "many", `m${String(index).padStart(2, "0")}.png`), PIXEL);
    // 2000×1500 的 JPEG：测试进程是 Node，没有 `Bun.Image`，借 bun 现做一份。
    const jpegPath = join(tmp, "photo.jpg");
    execFileSync("bun", ["-e", `const pixel = Uint8Array.from(atob("${PIXEL.toString("base64")}"), (c) => c.charCodeAt(0)); await Bun.write(${JSON.stringify(jpegPath)}, await new Bun.Image(pixel).resize(2000, 1500).jpeg().bytes());`]);
    photo = await readFile(jpegPath);

    const child = spawn("bun", [join("e2e", "support", "agent-endpoint.ts")], {cwd: PACKAGE_ROOT, stdio: ["pipe", "pipe", "pipe"]});
    const handle = track(child);
    const [, baseUrl, controlUrl] = await handle.waitFor(/READY (\S+) (\S+)/u);
    endpoint = {...handle, control: controlUrl!, child};
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify({
        ...localModelSettings(baseUrl!),
        "nbook.agent/profileSettings": {"nbook.agent.main": {stickers: {added: ["user.cat"], removed: []}}},
    }));
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    endpoint.child.stdin?.end();
    await endpoint.exit;
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const stickersDir = (...parts: string[]) => join(stateRoot, "user", "stickers", ...parts);
const exists = (path: string) => access(path).then(() => true, () => false);
const tile = (page: Page, key: string): Locator => page.locator(`[data-grid-key^='${key}']`);
const rail = (page: Page, id: string): Locator => page.locator(`[data-sticker-rail-item='${id}']`);

/** 打开作品和设置窗口的“表情包”分区。 */
async function openPacks(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-explorer-row]").first()).toBeVisible();
    await expect(async () => {
        await page.keyboard.press("Control+,");
        await expect(page.locator("[data-settings-nav-current]")).toBeFocused({timeout: 500});
    }).toPass();
    await page.locator("[data-settings-window]").getByRole("button", {name: "表情包", exact: true}).click();
    await expect(page.locator("[data-sticker-packs-page]")).toBeVisible();
    await expect(rail(page, "user.dog")).toBeVisible();
}

test("验收 9：新建表情包、拖进（选）两张图（超限的缩小）、改名、导出、删除、再导入；写法在对话里显示成图，提示词的槽里有它", async ({page}) => {
    await openPacks(page);
    await page.locator("[data-sticker-rail] [data-sticker-create]").click();
    const dialog = page.locator("[data-sticker-name-dialog]");
    await dialog.locator("input[data-sticker-title]").fill("猫");
    await dialog.locator("input[data-sticker-folder]").fill("cat");
    await dialog.getByRole("button", {name: "新建", exact: true}).click();
    await expect(rail(page, "user.cat")).toHaveAttribute("aria-current", "page");
    await expect(page.locator("[data-sticker-empty]")).toBeVisible();

    // 经隐藏的文件输入加两张图：一张小的，一张 2000×1500 的 JPEG。
    await page.locator("[data-sticker-file]").setInputFiles([{name: "开心.png", mimeType: "image/png", buffer: PIXEL}, {name: "大图.jpg", mimeType: "image/jpeg", buffer: photo}]);
    await expect(tile(page, "s:开心")).toBeVisible();
    await expect(tile(page, "s:大图")).toBeVisible();
    await expect.poll(() => tile(page, "s:大图").locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(1024);
    expect(await readdir(stickersDir("cat"))).toEqual(expect.arrayContaining(["开心.png", "大图.jpg"]));

    // 把“大图”改名成“哇”：先补一份清单，再改清单；文件不改名。
    await tile(page, "s:大图").click();
    const name = page.locator("input[data-sticker-name]");
    await name.fill("哇");
    await name.press("Enter");
    await expect(tile(page, "s:大图")).toHaveAttribute("title", "哇");
    // 键随名字变了：属性栏还在、输入框还有焦点，没有弹回表情包。
    await expect(page.locator("[data-sticker-fields]")).toBeVisible();
    await expect(name).toBeFocused();
    const manifest = JSON.parse(await readFile(stickersDir("cat", "stickers.json"), "utf8")) as {title: string; stickers: Array<{file: string; name?: string; common?: boolean}>};
    expect(manifest.title).toBe("猫");
    expect(manifest.stickers.find((entry) => entry.file === "大图.jpg")).toMatchObject({name: "哇", common: true});
    expect(await exists(stickersDir("cat", "大图.jpg"))).toBe(true);

    // 导出：一个以包名命名的 zip，里面有清单与两张图。
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("[data-sticker-export]").click()]);
    expect(download.suggestedFilename()).toBe("cat.zip");
    const zipped = new Uint8Array(await readFile((await download.path())!));
    expect(Object.keys(unzipSync(zipped)).sort()).toEqual(["cat/stickers.json", "cat/大图.jpg", "cat/开心.png"]);

    // 删除表情包，再把导出的 zip 导回来。
    await page.locator("[data-sticker-more]").click();
    await page.getByRole("menuitem", {name: "删除表情包"}).click();
    await page.locator("[role='alertdialog']").getByRole("button", {name: "删除", exact: true}).click();
    await expect(rail(page, "user.cat")).toHaveCount(0);
    expect(await exists(stickersDir("cat"))).toBe(false);
    await page.locator("[data-sticker-zip]").setInputFiles({name: "cat.zip", mimeType: "application/zip", buffer: Buffer.from(zipped)});
    await expect(rail(page, "user.cat")).toHaveAttribute("aria-current", "page");
    expect((await readdir(stickersDir("cat"))).sort()).toEqual(["stickers.json", "大图.jpg", "开心.png"]);

    // 写法在对话里显示成图；提示词的槽里列出它（Profile 设置里已选了 user.cat）。
    await page.keyboard.press("Escape");
    await script("好:cat/哇:");
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("打开对话");
    await page.keyboard.press("Enter");
    const input = page.getByRole("textbox", {name: "消息输入框"});
    await expect(input).toBeVisible();
    await input.click();
    await page.keyboard.type("来一个");
    await page.keyboard.press("Enter");
    const image = page.locator(".nb-sticker[data-sticker=':cat/哇:'] img").first();
    await expect(image).toHaveAttribute("alt", ":cat/哇:");
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
    expect(await lastRequest()).toContain(":cat/哇:");
});

test("验收 10：导入的 zip 与已有的包同名时先问；另存为 dog-2，原来的 dog 不变", async ({page}) => {
    await openPacks(page);
    const before = await readFile(stickersDir("dog", "stickers.json"), "utf8");
    // 导出现有的 dog，再原样导入。
    await rail(page, "user.dog").click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("[data-sticker-export]").click()]);
    const bytes = await readFile((await download.path())!);
    await page.locator("[data-sticker-zip]").setInputFiles({name: "dog.zip", mimeType: "application/zip", buffer: bytes});
    const conflict = page.locator("[data-sticker-conflict]");
    await expect(conflict).toContainText("包名是 dog");
    await conflict.getByRole("button", {name: "另存为 dog-2"}).click();
    await expect(rail(page, "user.dog-2")).toHaveAttribute("aria-current", "page");
    expect(await readFile(stickersDir("dog", "stickers.json"), "utf8")).toBe(before);
    expect((await readdir(stickersDir("dog-2"))).sort()).toEqual(["stickers.json", "汪.png"]);
    expect((await readdir(stickersDir())).filter((entry) => entry.startsWith(".nbook-stickers-"))).toEqual([]);
});

test("输出 26：网格里上下方向键按当前组的列数移动，焦点跟着走", async ({page}) => {
    await openPacks(page);
    await rail(page, "user.many").click();
    const first = tile(page, "s:m00");
    await expect(first).toBeVisible();
    await first.click();
    // 一行几格：看第二格与第一格是否同一行。
    const columns = await page.evaluate(() => {
        const items = [...document.querySelectorAll<HTMLElement>("[data-grid-key]")];
        const top = items[0]!.getBoundingClientRect().top;
        return items.filter((item) => Math.abs(item.getBoundingClientRect().top - top) < 2).length;
    });
    expect(columns).toBeGreaterThan(1);
    await page.keyboard.press("ArrowDown");
    const expected = `m${String(columns).padStart(2, "0")}`;
    await expect(tile(page, `s:${expected}`)).toHaveAttribute("aria-selected", "true");
    await expect(tile(page, `s:${expected}`)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(first).toBeFocused();
});

test("改包名：对话框写警示，改完选中新包名、文件夹换了名", async ({page}) => {
    await openPacks(page);
    await page.locator("[data-sticker-rail] [data-sticker-create]").click();
    const dialog = page.locator("[data-sticker-name-dialog]");
    await dialog.locator("input[data-sticker-folder]").fill("before-rename");
    await dialog.getByRole("button", {name: "新建", exact: true}).click();
    await expect(rail(page, "user.before-rename")).toHaveAttribute("aria-current", "page");
    await page.locator("[data-sticker-more]").click();
    await page.getByRole("menuitem", {name: "改包名…"}).click();
    await expect(dialog).toContainText("用旧包名写的表情会认不出来");
    await dialog.locator("input[data-sticker-folder]").fill("after-rename");
    await dialog.getByRole("button", {name: "改成 after-rename"}).click();
    await expect(rail(page, "user.after-rename")).toHaveAttribute("aria-current", "page");
    await expect(rail(page, "user.before-rename")).toHaveCount(0);
    expect(await exists(stickersDir("after-rename"))).toBe(true);
    expect(await exists(stickersDir("before-rename"))).toBe(false);
});

test("网格里按 Esc 只回到表情包、设置窗口不关；再按一次才关窗口", async ({page}) => {
    await openPacks(page);
    await rail(page, "user.many").click();
    await tile(page, "s:m00").click();
    await expect(page.locator("[data-sticker-fields]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-sticker-fields]")).toHaveCount(0);
    await expect(page.locator("[data-settings-window]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-settings-window]")).toHaveCount(0);
});
