/**
 * 对话界面在真实 Chrome 里的验收（docs/specs/agent/conversation.md 验收 1–6）：生产构建的后端与前端，项目与设置都是真的，模型是 Bun 子进程里的本机端点。
 * 等页面上可观察的变化，不按时长等待。
 */

import {spawn} from "node:child_process";
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
let projectDir = "";
let stateRoot = "";
let server: ProductServer;
let endpoint: ProcessHandle & {control: string; child: ReturnType<typeof spawn>};

async function control(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${endpoint.control}${path}`, body === undefined ? {} : {method: "POST", body: JSON.stringify(body)});
    return response.json();
}
const script = (...replies: unknown[]) => control("/script", replies);
const requests = async () => await control("/requests") as {messages: unknown[]; tools: string[]}[];

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "agent-conversation");
    projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await mkdir(join(projectDir, "正文"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(projectDir, "正文/第三章.md"), "雨越下越大。\n他没有回头。\n巷口的灯灭了。\n");
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

const input = (page: Page) => page.getByRole("textbox", {name: "消息输入框"});

/** 打开作品，经命令面板把对话带到前面。 */
async function openConversation(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-explorer-row]").first()).toBeVisible();
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("打开对话");
    await page.keyboard.press("Enter");
    await expect(input(page)).toBeVisible();
}

async function send(page: Page, text: string): Promise<void> {
    await input(page).click();
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
}

const newSession = async (page: Page): Promise<void> => {
    await page.locator("[data-header-new]").click();
    await expect(page.locator(".acv-stream__empty")).toBeVisible();
};

test("验收 1：发一条，看到回复与状态栏；刷新后回到同一会话", async ({page}) => {
    await script("这是回复。");
    await openConversation(page);
    await send(page, "你好");
    await expect(page.getByText("这是回复。")).toBeVisible();
    await expect(page.locator("[data-agent-status]")).toBeVisible();
    if (process.env.T17_SHOTS !== undefined) await page.screenshot({path: join(process.env.T17_SHOTS, "reply.png")});
    await expect(page.locator("[data-status-usage]")).toBeVisible();
    await page.reload();
    await expect(page.locator("[data-explorer-row]").first()).toBeVisible();
    await expect(page.getByText("这是回复。")).toBeVisible();
    await expect(page.getByRole("article").getByText("你好", {exact: true})).toBeVisible();
});

test("验收 2：Agent 改文件：向导显示 diff，收起再展开，批准后文件变了；拒绝并附言，模型收到这段话", async ({page}) => {
    await openConversation(page);
    await newSession(page);
    await script({tool: "edit", args: {path: "project://正文/第三章.md", old_string: "他没有回头。", new_string: "他回头看了一眼。"}}, "改好了");
    await send(page, "改第三章");
    const wizard = page.locator("[data-agent-wizard]");
    await expect(wizard.locator("del")).toContainText("没有");
    if (process.env.T17_SHOTS !== undefined) await page.screenshot({path: join(process.env.T17_SHOTS, "approval.png")});
    await expect(wizard.locator("ins").first()).toBeVisible();
    await expect(page.locator("[data-agent-composer]")).toBeHidden();
    await expect(page.locator("[data-status-phase]")).toHaveText("等你批准");

    await page.keyboard.press("Escape");
    await expect(page.locator("[data-wizard-collapsed]")).toBeVisible();
    await page.locator("[data-wizard-expand]").click();
    await wizard.locator("[data-approval-decision='allow']").click();
    await expect(page.getByText("改好了")).toBeVisible();
    await expect(wizard).toHaveCount(0);
    await expect(input(page)).toBeFocused();
    expect(await readFile(join(projectDir, "正文/第三章.md"), "utf8")).toContain("他回头看了一眼。");

    await script({tool: "edit", args: {path: "project://正文/第三章.md", old_string: "巷口的灯灭了。", new_string: "灯还亮着。"}}, "那就不改");
    await send(page, "再改一处");
    await wizard.locator("[data-approval-note] textarea, textarea[data-approval-note]").fill("这句不要动");
    await expect(wizard.locator("[data-approval-decision='allow']")).toBeDisabled();
    await wizard.locator("[data-approval-decision='deny']").click();
    await expect(page.getByText("那就不改")).toBeVisible();
    expect(JSON.stringify((await requests()).at(-1)!.messages)).toContain("这句不要动");
    expect(await readFile(join(projectDir, "正文/第三章.md"), "utf8")).toContain("巷口的灯灭了。");
});

test("一条回复多个调用：一起问，全部选完才提交，都批了才执行", async ({page}) => {
    await openConversation(page);
    await newSession(page);
    await script({tools: [{tool: "write", args: {path: "session://一.md", content: "一"}}, {tool: "write", args: {path: "session://二.md", content: "二"}}]}, "两个都处理了");
    await send(page, "写两个文件");
    const wizard = page.locator("[data-agent-wizard]");
    await expect(wizard.locator("[data-wizard-count]")).toHaveText("第 1 / 2 个");
    await expect(wizard.locator("[data-approval-submit]")).toBeDisabled();
    await wizard.locator("[data-approval-decision='allow']").click();
    await expect(wizard.locator("[data-wizard-count]")).toHaveText("第 2 / 2 个");
    await wizard.locator("[data-approval-decision='deny']").click();
    await wizard.locator("[data-approval-submit]").click();
    await expect(page.getByText("两个都处理了")).toBeVisible();
});

test("验收 3：提问：单选加其它、多选、表单各答一次，结果回到模型", async ({page}) => {
    await openConversation(page);
    await newSession(page);
    await script({tool: "ask", args: {questions: [
        {question: "视角？", options: [{label: "第一人称"}, {label: "第三人称"}]},
        {question: "哪些伏笔？", multiSelect: true, options: [{label: "钟声"}, {label: "父亲的表"}]},
        {question: "人物卡", options: [{label: "先不写"}, {label: "按我填的"}], form: {type: "object", required: ["name"], properties: {name: {type: "string", title: "名字"}}}},
    ]}}, "知道了");
    await send(page, "问我");
    const wizard = page.locator("[data-agent-wizard]");
    await wizard.locator("[data-question-other] input, input[data-question-other]").fill("第二人称");
    await wizard.locator("[data-question-step='next']").click();
    await wizard.getByText("钟声").click();
    await wizard.getByText("父亲的表").click();
    await wizard.locator("[data-question-step='next']").click();
    await wizard.getByRole("textbox", {name: "名字"}).fill("苏晴");
    await wizard.getByRole("textbox", {name: "名字"}).blur();
    await wizard.locator("[data-question-submit]").click();
    await expect(page.getByText("知道了")).toBeVisible();
    const sent = JSON.stringify((await requests()).at(-1)!.messages);
    expect(sent).toContain("第二人称");
    expect(sent).toContain("钟声");
    expect(sent).toContain("父亲的表");
    expect(sent).toContain("苏晴");
});

test("验收 4：两个窗口开同一会话，一个批准，另一个的向导消失", async ({page, context}) => {
    await openConversation(page);
    await newSession(page);
    await script("先说一句");
    await send(page, "开始");
    await expect(page.getByText("先说一句")).toBeVisible();
    const other = await context.newPage();
    await openConversation(other);
    await expect(other.getByText("先说一句")).toBeVisible();

    await script({tool: "write", args: {path: "session://同一个.md", content: "内容"}}, "好了");
    await send(page, "写");
    await expect(page.locator("[data-agent-wizard]")).toBeVisible();
    await expect(other.locator("[data-agent-wizard]")).toBeVisible();
    await other.locator("[data-approval-decision='allow']").click();
    await expect(page.locator("[data-agent-wizard]")).toHaveCount(0);
    await expect(page.getByText("好了")).toBeVisible();
    await other.close();
});

test("验收 5：服务端在运行中重启：重新加载后回到这个会话，显示中断的样子，回车继续", async ({page}) => {
    await openConversation(page);
    await newSession(page);
    await control("/hold");
    await script("不会看到这条");
    await send(page, "写一章");
    await control("/hold/arrived");
    await expect(page.locator("[data-status-phase]")).toBeVisible();
    const port = Number(new URL(server.url).port);
    expect(await server.stop()).toBe(0);
    server = await startProductServer(stateRoot, port);
    await control("/hold/release");
    await page.reload();
    await expect(page.getByText("写一章", {exact: true})).toBeVisible();
    const resume = page.locator("[data-composer-action='resume']");
    await expect(resume).toBeVisible();
    await script("接着写完了");
    await input(page).click();
    await page.keyboard.press("Enter");
    await expect(page.getByText("接着写完了")).toBeVisible();
    await expect(resume).toHaveCount(0);
});

test("验收 6：把对话打开到编辑区页面：能发消息", async ({page}) => {
    await openConversation(page);
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("在编辑区打开对话");
    await page.keyboard.press("Enter");
    await script("页面上的回复");
    const composers = page.getByRole("textbox", {name: "消息输入框"});
    await expect(composers.last()).toBeVisible();
    await composers.last().click();
    await page.keyboard.type("从页面发");
    await page.keyboard.press("Enter");
    await expect(page.getByText("页面上的回复")).toBeVisible();
});

test("状态栏的活动条目：等用户时显示，点一下切到那个会话", async ({page}) => {
    await openConversation(page);
    await newSession(page);
    await script({tool: "write", args: {path: "session://活动.md", content: "内容"}}, "好了");
    await send(page, "写");
    const item = page.locator("[data-workbench-item='nbook.agent.activity']");
    await expect(item).toContainText("1 等你处理");
    await newSession(page);
    await item.click();
    await expect(page.locator("[data-agent-wizard]")).toBeVisible();
    await page.locator("[data-approval-decision='deny']").click();
    await expect(page.getByText("好了")).toBeVisible();
    await expect(item).toHaveCount(0);
});
