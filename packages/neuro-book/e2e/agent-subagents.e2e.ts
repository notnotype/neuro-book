/**
 * 子代理的 Smoke（docs/specs/agent/subagents.md 验收 1、2、4）：真实服务端、真实浏览器，本机假端点按会话分派脚本（子代理的第一条用户消息就是
 * 派它时的 `prompt`，所以父会话自己的话里不能含子代理的标记）。父会话用主创，子代理用临时帮手。
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
const scriptFor = (text: string, ...replies: unknown[]) => control("/scriptFor", {text, replies});
const holdFor = (text: string) => control("/holdFor", {text});
const heldArrived = (text: string) => control("/holdFor/arrived", {text});
const releaseHeld = (text: string) => control("/holdFor/release", {text});

const adhoc = (prompt: string, extra: Record<string, unknown> = {}) => ({tool: "agent_spawn", args: {profile: "nbook.agent.adhoc", prompt, initial: {role: "设定核对员"}, ...extra}});

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "agent-subagents");
    const projectDir = join(tmp, "Book");
    const stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await mkdir(join(projectDir, "正文"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(projectDir, "正文/第三章.md"), "雨越下越大。\n");
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));

    const child = spawn("bun", [join("e2e", "support", "agent-endpoint.ts")], {cwd: PACKAGE_ROOT, stdio: ["pipe", "pipe", "pipe"]});
    const handle = track(child);
    const [, baseUrl, controlUrl] = await handle.waitFor(/READY (\S+) (\S+)/u);
    endpoint = {...handle, control: controlUrl!, child};
    // 模型请求失败不重发：出错的子代理一次就收口。
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify({...localModelSettings(baseUrl!), "nbook.agent/modelRetries": 0}));
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
    // 头上的新建只在已有会话时才有：经命令面板新建，有没有会话都一样。
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("新建 Agent 会话");
    await page.keyboard.press("Enter");
    await expect(page.locator(".acv-stream__empty")).toBeVisible();
}

async function send(page: Page, text: string): Promise<void> {
    await input(page).click();
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
}

const card = (page: Page, name: string) => page.locator("[data-subagent-card]").filter({hasText: name});

test("验收 1：同一条回复派两个，并发跑；一个完成一个出错，两张卡各写结果，高度不随状态变", async ({page}) => {
    await openConversation(page);
    await scriptFor("查甲的设定", "甲没有矛盾。细节见第三章。");
    await scriptFor("查乙的设定", {status: 500});
    await holdFor("查甲的设定");
    await script({tools: [adhoc("查甲的设定", {name: "甲"}), adhoc("查乙的设定", {name: "乙"})]}, "都查完了");
    await send(page, "分头查");
    await heldArrived("查甲的设定");
    // 甲还在跑：它的卡在转圈，乙已经出错。
    await expect(card(page, "甲")).toHaveAttribute("data-state", "running");
    await expect(card(page, "乙")).toHaveAttribute("data-state", "failed");
    const runningHeight = (await card(page, "甲").boundingBox())!.height;
    await releaseHeld("查甲的设定");
    await expect(page.getByText("都查完了")).toBeVisible();
    // 这一轮结束后整轮收起，卡片在过程里：展开看。
    await page.locator("[data-turn-summary]").last().click();
    await expect(card(page, "甲")).toHaveAttribute("data-state", "done");
    await expect(card(page, "甲").locator("[data-subagent-line]")).toContainText("甲没有矛盾。");
    expect((await card(page, "甲").boundingBox())!.height).toBe(runningHeight);
    expect((await card(page, "乙").boundingBox())!.height).toBe(runningHeight);
    // 打开子会话：头的左边是返回，点了回到父会话。
    await card(page, "甲").locator("[data-subagent-open]").click();
    await page.locator("[data-header-back]").click();
    await page.locator("[data-turn-summary]").last().click();
    await expect(page.locator("[data-subagent-card]")).toHaveCount(2);
});

test("验收 2：子会话要审批，停在父会话输入框上方、标来源，输入框照常可用；在父会话批了子会话接着跑", async ({page}) => {
    await openConversation(page);
    await scriptFor("改人物卡", {tool: "write", args: {path: "user://人物卡.md", content: "苏晴：二十岁。"}}, "改好了。");
    await script(adhoc("改人物卡", {name: "人物卡", async: true}), "派出去了");
    await send(page, "派一个去改设定");
    const dock = page.locator("[data-agent-dock]");
    await expect(dock).toContainText("子代理「人物卡」");
    await expect(page.locator("[data-agent-wizard]")).toHaveCount(0);
    await expect(input(page)).toBeVisible();
    await expect(input(page)).toBeEnabled();
    // 停靠的面：只有很轻的一层阴影、圆角同输入框（design-language.md“停靠的面不用浮层的阴影档”）。
    const face = await dock.locator(".acv-wizard-frame").evaluate((element) => ({shadow: getComputedStyle(element).boxShadow, radius: getComputedStyle(element).borderTopLeftRadius}));
    const composerRadius = await page.locator(".acv-composer__frame").evaluate((element) => getComputedStyle(element).borderTopLeftRadius);
    expect(face.radius).toBe(composerRadius);
    // 一层（没有逗号分隔的第二层）、0 1px 2px；颜色是 `--shadow-color` 混出来的，写法随浏览器。
    expect(face.shadow).not.toContain("),");
    expect(face.shadow).toMatch(/ 0px 1px 2px 0px$/u);
    await dock.locator("[data-approval-decision='allow']").click();
    await expect(dock).toHaveCount(0);
    // 后台派出的子代理完成前这一轮不收起；完成后收起，展开看卡片。
    await expect(page.getByText("派出去了")).toBeVisible();
    await expect.poll(async () => (await page.locator("[data-subagent-card]").count()) === 0 || (await card(page, "人物卡").getAttribute("data-state")) === "done").toBe(true);
    if (await page.locator("[data-subagent-card]").count() === 0) await page.locator("[data-turn-summary]").last().click();
    await expect(card(page, "人物卡")).toHaveAttribute("data-state", "done");
});

test("验收 4：等子代理时用户插话，等待以 running 返回、插话送达；之后 wait 取到结果", async ({page}) => {
    await openConversation(page);
    await scriptFor("慢慢查", "查完了，没问题。");
    await holdFor("慢慢查");
    await script(adhoc("慢慢查", {name: "慢查"}), {tool: "wait", args: {}}, "收到结果了");
    await send(page, "派一个去核对");
    await heldArrived("慢慢查");
    await expect(card(page, "慢查")).toHaveAttribute("data-state", "running");
    // 运行中回车是插话（steer）。
    await send(page, "顺便看看第二章");
    await expect(card(page, "慢查").getByText("后台")).toBeVisible();
    await releaseHeld("慢慢查");
    await expect(page.getByText("收到结果了")).toBeVisible();
    await page.locator("[data-turn-summary]").last().click();
    await expect(card(page, "慢查")).toHaveAttribute("data-state", "done");
});
