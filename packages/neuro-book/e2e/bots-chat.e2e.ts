/**
 * 消息视图里 bot 的验收（docs/specs/bots/view.md 验收 1、2）：生产构建的后端与前端，状态根是全新的（首次启动建出星璃），
 * 模型是 Bun 子进程里的本机端点。等页面上可观察的变化，不按时长等待。
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

let tmp = "";
let server: ProductServer;
let endpoint: ProcessHandle & {control: string; child: ReturnType<typeof spawn>};

async function control(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${endpoint.control}${path}`, body === undefined ? {} : {method: "POST", body: JSON.stringify(body)});
    return response.json();
}
const script = (...replies: unknown[]) => control("/script", replies);
const requests = async () => await control("/requests") as {messages: unknown[]}[];

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "bots-chat");
    const projectDir = join(tmp, "Book");
    const stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(projectDir, "第一章.md"), "开头。\n");
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
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

/** 右栏的消息视图（右栏默认宽度下是窄版：头像列加聊天区，对话的头在面板头上）。 */
const MESSAGES = "nbook.agent.conversation";
const contact = (page: Page) => page.locator("[data-strip-contact='nbook.bots/lyra']");
const chat = (page: Page) => page.locator("[data-messages-chat]");
const handle = (page: Page) => page.locator(`[data-panel-tab="view:${MESSAGES}"]`);
const input = (page: Page) => chat(page).getByRole("textbox", {name: "消息输入框"});

async function openBot(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-explorer-row]").first()).toBeVisible();
    await contact(page).click();
    await expect(handle(page).locator("[data-header-title]")).toHaveText("星璃");
    await expect(input(page)).toBeVisible();
}

async function send(page: Page, text: string): Promise<void> {
    await input(page).click();
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
}

test("验收 1：消息视图的头像列点星璃，顶栏是星璃与头像；说一句得到回复；等审批时停靠区里有审批、输入框可用，这时再发一句，审批以拒绝结算、她接着处理这句", async ({page}) => {
    await openBot(page);
    // 产品的默认布局：右栏是消息视图；左侧栏的“项目”容器里没有以前的会话面板（它并进了消息视图，conversation.md 输出 2）。
    await expect(page.locator(`[data-content="view:${MESSAGES}"]`)).toBeVisible();
    await expect(page.locator('[data-content="view:nbook.agent.sessions"]')).toHaveCount(0);
    const avatar = handle(page).locator("[data-header-avatar]");
    await expect(avatar).toBeVisible();
    await expect.poll(() => avatar.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    // 不能新建、换会话：头上没有新建。
    await expect(page.locator("[data-header-new]")).toHaveCount(0);

    await script("你好呀，Master。");
    await send(page, "你好");
    await expect(chat(page).getByText("你好呀，Master。")).toBeVisible();

    await script({tool: "write", args: {path: "session://草稿.md", content: "内容"}}, "好的，不写了。");
    await send(page, "帮我写个草稿");
    const dock = chat(page).locator("[data-agent-dock]");
    await expect(dock).toBeVisible();
    await expect(chat(page).locator("[data-agent-wizard]")).toHaveCount(0);
    await expect(input(page)).toBeVisible();
    await expect(chat(page).getByText("发出会拒绝 1 项等你处理的事。")).toBeVisible();
    await send(page, "算了，先别写");
    await expect(dock).toHaveCount(0);
    await expect(chat(page).getByText("好的，不写了。")).toBeVisible();
    await expect(chat(page).getByText("发出会拒绝 1 项等你处理的事。")).toHaveCount(0);
    // 拒绝的结果与这句一起进了下一次请求。
    expect(JSON.stringify((await requests()).at(-1)!.messages)).toContain("算了，先别写");
});

test("验收 2：她等你批准时切到别的会话，状态栏活动条目点进去在消息视图里打开她的主对话，回到 bot 档", async ({page}) => {
    await openBot(page);
    await script({tool: "write", args: {path: "session://二.md", content: "内容"}}, "好了。");
    await send(page, "写一个");
    await expect(chat(page).locator("[data-agent-dock]")).toBeVisible();
    // 新建一个普通会话：聊天区换成它，会话档。
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("新建 Agent 会话");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-agent-welcome]")).toBeVisible();
    await expect(chat(page).locator("[data-agent-dock]")).toHaveCount(0);
    const item = page.locator("[data-workbench-item='nbook.agent.activity']");
    await expect(item).toContainText("1 等你处理");
    await item.click();
    await expect(handle(page).locator("[data-header-title]")).toHaveText("星璃");
    await expect(chat(page).locator("[data-agent-dock]")).toBeVisible();
    await chat(page).locator("[data-approval-decision='deny']").click();
    await expect(chat(page).getByText("好了。")).toBeVisible();
});

test("验收 2：窗口没有焦点时到的回复记为未读：头像列与 bot 标签写计数，状态栏写新消息；窗口拿回焦点后清零", async ({page}) => {
    await openBot(page);
    await expect(contact(page)).toHaveAttribute("aria-label", "星璃");
    // 窗口失焦：视图仍可见，但不算看到（bots/view.md 输出 4）。
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await script("你还在吗？");
    await send(page, "在吗");
    await expect(chat(page).getByText("你还在吗？")).toBeVisible();
    await expect(contact(page)).toHaveAttribute("aria-label", "星璃，1 条未读");
    await expect(page.locator("[data-workbench-item='nbook.agent.activity']")).toContainText("1 条新消息");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(contact(page)).toHaveAttribute("aria-label", "星璃");
});
