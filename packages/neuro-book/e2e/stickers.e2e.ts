/**
 * 表情包在真实 Chrome 里的验收（docs/specs/agent/stickers.md 验收 1、2、5）：生产构建的后端与前端，表情包放在状态根的
 * `user/stickers/`，Profile 设置里给主创加上它；模型是 Bun 子进程里的本机端点。等页面上可观察的变化，不按时长等待。
 */

import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {localModelSettings} from "nbook/plugins/agent/testing/endpoint";

import {PACKAGE_ROOT, startProductServer, track} from "./fixtures";
import type {ProcessHandle, ProductServer} from "./fixtures";

/** 1×1 的 PNG：取图路由按字节判类型、按宽高核对，显示时按字高缩放。 */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

let tmp = "";
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
    const projectDir = join(tmp, "Book");
    const stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(projectDir, "第一章.md"), "雨越下越大。\n");
    await mkdir(join(stateRoot, "user", "stickers", "lyra"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    await writeFile(join(stateRoot, "user", "stickers", "lyra", "stickers.json"), JSON.stringify({title: "星璃", stickers: [
        {name: "开心", file: "happy.png", when: "被夸的时候", common: true},
        {name: "害羞", file: "shy.png", common: true},
    ]}));
    await writeFile(join(stateRoot, "user", "stickers", "lyra", "happy.png"), PIXEL);
    await writeFile(join(stateRoot, "user", "stickers", "lyra", "shy.png"), PIXEL);

    const child = spawn("bun", [join("e2e", "support", "agent-endpoint.ts")], {cwd: PACKAGE_ROOT, stdio: ["pipe", "pipe", "pipe"]});
    const handle = track(child);
    const [, baseUrl, controlUrl] = await handle.waitFor(/READY (\S+) (\S+)/u);
    endpoint = {...handle, control: controlUrl!, child};
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify({
        ...localModelSettings(baseUrl!),
        "nbook.agent/profileSettings": {"nbook.agent.main": {stickers: {added: ["user.lyra"], removed: []}}},
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

/** 回复里的一个表情：换成了图、图读得出来（取图路由给了图片字节）。 */
async function expectImage(page: Page, raw: string): Promise<void> {
    const image = page.locator(`.nb-sticker[data-sticker="${raw}"] img`).first();
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

    const sent = await lastRequest();
    expect(sent).toContain(":lyra/开心: — 被夸的时候");
    expect(sent).toContain("stickers://user.lyra/");

    // 验收 5：重新加载窗口，恢复的历史回复里的表情照样换成图（浏览器目录晚于对话建立也一样）。
    await page.reload();
    await expect(input(page)).toBeVisible();
    await expectImage(page, ":lyra/开心:");
});
