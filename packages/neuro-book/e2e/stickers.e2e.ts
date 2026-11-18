/**
 * 表情包在真实 Chrome 里的验收（docs/specs/agent/stickers.md 验收 1、2、4、5、8）：生产构建的后端与前端，表情包放在状态根的
 * `user/stickers/`，Profile 设置里给主创加上它；模型是 Bun 子进程里的本机端点。等页面上可观察的变化，不按时长等待。
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

/** 1×1 的 PNG：取图路由按字节判类型、按宽高核对，显示时按字高缩放。 */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

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
    tmp = await createTestTmpRoot("neuro-book-e2e", "stickers");
    projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(projectDir, "第一章.md"), "雨越下越大。\n");
    await mkdir(join(stateRoot, "user", "stickers", "lyra"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    await writeFile(join(stateRoot, "user", "stickers", "lyra", "stickers.json"), JSON.stringify({title: "星璃", stickers: [
        {name: "开心", file: "happy.png", description: "被夸的时候", common: true},
        {name: "害羞", file: "shy.png", common: true},
    ]}));
    await writeFile(join(stateRoot, "user", "stickers", "lyra", "happy.png"), PIXEL);
    await writeFile(join(stateRoot, "user", "stickers", "lyra", "shy.png"), PIXEL);
    // 验收 8：没有清单的表情包，只有图片与一个别的文件。
    const cat = join(stateRoot, "user", "stickers", "cat");
    await mkdir(cat, {recursive: true});
    for (const file of ["开心.png", "困.png", "1.png"]) await writeFile(join(cat, file), PIXEL);
    await writeFile(join(cat, "readme.txt"), "猫猫表情");

    const child = spawn("bun", [join("e2e", "support", "agent-endpoint.ts")], {cwd: PACKAGE_ROOT, stdio: ["pipe", "pipe", "pipe"]});
    const handle = track(child);
    const [, baseUrl, controlUrl] = await handle.waitFor(/READY (\S+) (\S+)/u);
    endpoint = {...handle, control: controlUrl!, child};
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify({
        ...localModelSettings(baseUrl!),
        "nbook.agent/profileSettings": {"nbook.agent.main": {stickers: {added: ["user.lyra", "user.cat"], removed: []}}},
    }));
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

/** `scope` 里的一个表情：换成了图、图读得出来（取图路由给了图片字节）。 */
async function expectImage(scope: Page | Locator, raw: string): Promise<void> {
    const image = scope.locator(`.nb-sticker[data-sticker="${raw}"] img`).first();
    await expect(image).toHaveAttribute("alt", raw);
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
}

test("验收 1、2：提示词里有白名单里的常用表情；回复里的表情显示成图，句子里的是行内小图，单独一段的是大图，认不出的留原文", async ({page}) => {
    await script("今天写完啦:lyra/开心:明天见。\n\n:lyra/害羞:\n\n时间 10:30:00，:lyra/没有:");
    await openConversation(page);
    await input(page).click();
    await page.keyboard.type("写完了");
    await page.keyboard.press("Enter");

    await expectImage(page, ":lyra/开心:");
    await expectImage(page, ":lyra/害羞:");
    await expect(page.locator(".nb-sticker-block .nb-sticker[data-sticker=':lyra/害羞:']")).toHaveCount(1);
    await expect(page.locator(".nb-sticker-block .nb-sticker[data-sticker=':lyra/开心:']")).toHaveCount(0);
    await expect(page.locator(".nb-sticker[data-sticker=':lyra/没有:']")).toHaveText(":lyra/没有:");
    await expect(page.getByText("时间 10:30:00", {exact: false})).toBeVisible();
    // 行内小图不撑高这一行：带图的一段与只有文字的一段一样高（两段都只有一行）。
    const height = (raw: string) => page.locator(`p:has(> .nb-sticker[data-sticker="${raw}"])`).evaluate((element) => element.getBoundingClientRect().height);
    expect(Math.abs(await height(":lyra/开心:") - await height(":lyra/没有:"))).toBeLessThan(0.5);

    const sent = await lastRequest();
    expect(sent).toContain(":lyra/开心: — 被夸的时候");
    expect(sent).toContain("stickers://user.lyra/");

    // 验收 5：重新加载窗口，恢复的历史回复里的表情照样换成图（浏览器目录晚于对话建立也一样）。
    await page.reload();
    await expect(input(page)).toBeVisible();
    await expectImage(page, ":lyra/开心:");
});

test("验收 8：只有图片的文件夹也是表情包，名字取文件名、都进提示词，回复里显示成图", async ({page}) => {
    await script("喵:cat/开心:");
    await openConversation(page);
    await input(page).click();
    await page.keyboard.type("来只猫");
    await page.keyboard.press("Enter");
    await expectImage(page, ":cat/开心:");
    // 按文件名的码元顺序，没有说明的只写写法；当不了名字的 1.png 不列。
    const sent = await lastRequest();
    expect(sent).toContain("stickers://user.cat/");
    expect(sent).toContain(":cat/困:\\n:cat/开心:");
    expect(sent).not.toContain(":cat/1:");
});

test("输出 18：清单里加了表情，浏览器的目录经通知更新，之后的回复里新表情显示成图", async ({page}) => {
    await openConversation(page);
    await writeFile(join(stateRoot, "user", "stickers", "lyra", "stickers.json"), JSON.stringify({title: "星璃", stickers: [
        {name: "开心", file: "happy.png", description: "被夸的时候", common: true},
        {name: "害羞", file: "shy.png", common: true},
        {name: "比心", file: "heart.png"},
    ]}));
    await writeFile(join(stateRoot, "user", "stickers", "lyra", "heart.png"), PIXEL);
    // 服务端重扫完（取图路由认得新图）才发：先发会按旧目录显示原文。目录变了的通知在重扫完时就发出，浏览器取新目录的那次调用
    // 早于这条消息与模型的回复。
    await expect.poll(async () => (await fetch(new URL("/api/nbook.stickers/image/user.lyra/heart.png", server.url))).status).toBe(200);
    await script(":lyra/比心:");
    await input(page).click();
    await page.keyboard.type("比个心");
    await page.keyboard.press("Enter");
    await expectImage(page, ":lyra/比心:");
});

test("验收 4：编辑器里表情是一个整体，别处打字只改打字处；打出写法变成表情，紧接着退格还原、写回时开头的冒号转义", async ({page}) => {
    const file = join(projectDir, "表情.md");
    await writeFile(file, "好:lyra/开心:和_斜体_\n");
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await page.locator("[data-explorer-row=\"project://表情.md\"]").dblclick();
    const prose = page.locator("[data-editor-group-active] [data-editor-kind=\"nbook.editor.markdown\"]:visible [data-editor-prose]");
    await expect(prose).toBeVisible();
    // 只在编辑器里找：右栏恢复的对话里也有这个表情。
    await expectImage(prose, ":lyra/开心:");

    // 光标从“好”后面按一次右方向键就跨过表情（输出 21）。
    await prose.locator("p").first().click();
    await expect(prose).toBeFocused();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("呀");
    await page.keyboard.press("Control+s");
    await expect.poll(() => readFile(file, "utf8")).toBe("好:lyra/开心:呀和_斜体_\n");

    // 新的一行打出写法变成表情节点（输出 22），保存后是原文。
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type(":lyra/害羞:");
    await expect(prose.locator(".nb-sticker[data-sticker=':lyra/害羞:']")).toHaveCount(1);
    // 退格一次删掉整个表情（输出 21）；再打一遍，留着。
    await page.keyboard.press("Space");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await expect(prose.locator(".nb-sticker[data-sticker=':lyra/害羞:']")).toHaveCount(0);
    await page.keyboard.type(":lyra/害羞:");
    await expect(prose.locator(".nb-sticker[data-sticker=':lyra/害羞:']")).toHaveCount(1);

    // 打出写法后紧接着退格：还原成打出的文字，写回时开头的冒号转义（输出 22、23）。
    await page.keyboard.press("Enter");
    await page.keyboard.type(":abc:");
    await expect(prose.locator(".nb-sticker[data-sticker=':abc:']")).toHaveCount(1);
    await page.keyboard.press("Backspace");
    await expect(prose.locator(".nb-sticker[data-sticker=':abc:']")).toHaveCount(0);
    await page.keyboard.press("Control+s");
    await expect.poll(() => readFile(file, "utf8")).toBe("好:lyra/开心:呀和_斜体_\n\n:lyra/害羞:\n\n\\:abc:\n");
});
