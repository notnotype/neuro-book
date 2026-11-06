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
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify(localModelSettings(baseUrl!, {compactionRole: true})));
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

test("模型选择器：面板与输入框同宽；选没绑定的角色说明原因；绑定之后不刷新页面就恢复；状态栏窄时留缓存与费用", async ({page}, testInfo) => {
    await openConversation(page);
    await send(page, "先说一句");
    await expect(page.locator("[data-agent-status]")).toBeVisible();
    const picker = page.locator("[data-model-picker]");
    await picker.click();
    const panel = page.locator("[data-model-picker-panel]");
    await expect(panel).toBeVisible();
    const frame = await page.locator(".acv-composer__frame").boundingBox();
    const box = await panel.boundingBox();
    expect(Math.abs(box!.width - frame!.width)).toBeLessThan(2);
    await page.screenshot({path: testInfo.outputPath("picker-roles.png")});
    const before = box!.height;
    await panel.locator("[data-model-picker-pages] button").last().click();
    await expect(panel.locator("[data-model-picker-search]")).toBeVisible();
    expect((await panel.boundingBox())!.height).toBe(before);
    await page.screenshot({path: testInfo.outputPath("picker-models.png")});
    await panel.locator("[data-model-picker-pages] button").first().click();

    await panel.locator("[data-model-picker-role='role:deep']").click();
    await expect(panel).toBeVisible();
    await expect(page.locator("[data-composer-availability]")).toContainText("绑定");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(picker).toBeEnabled();

    const file = join(stateRoot, "settings.json");
    const settings = JSON.parse(await readFile(file, "utf8")) as Record<string, {items: {id: string; model: string | null}[]}>;
    settings["nbook.models/roles"]!.items.find((role) => role.id === "deep")!.model = "local/m";
    await writeFile(file, JSON.stringify(settings));
    await expect(page.locator("[data-composer-availability]")).toHaveCount(0, {timeout: 30_000});
    await expect(picker).toContainText("深度");

    await script("绑好了");
    await send(page, "现在能发了");
    await expect(page.getByText("绑好了")).toBeVisible();
    await page.setViewportSize({width: 900, height: 800});
    await expect(page.locator("[data-status-usage]")).toBeVisible();
    await page.screenshot({path: testInfo.outputPath("status-narrow.png")});
});

test("上下文详情：点圆环打开，看到组成；展开系统提示词；也能从顶栏菜单打开", async ({page}, testInfo) => {
    await script("回复一句");
    await openConversation(page);
    await send(page, "问一句");
    await expect(page.getByText("回复一句")).toBeVisible();
    await page.locator("[data-agent-status] button[data-context-meter]").click();
    const inspector = page.locator("[data-context-inspector]");
    await expect(inspector.locator("[data-context-estimated]")).toBeVisible();
    await expect(inspector.locator("[data-context-area='history']")).toBeVisible();
    await inspector.locator("[data-context-system] summary").click();
    await expect(inspector.locator("[data-context-system] pre")).not.toBeEmpty();
    await page.screenshot({path: testInfo.outputPath("inspector.png")});
    await page.keyboard.press("Escape");
    await expect(inspector).toHaveCount(0);

    await page.locator(".acv-header").getByRole("button", {name: "更多操作"}).click();
    await page.getByRole("menuitem", {name: "上下文详情"}).click();
    await expect(page.locator("[data-context-inspector] [data-context-estimated]")).toBeVisible();
    await page.locator("[data-context-refresh]").click();
    await expect(page.locator("[data-context-inspector] [data-context-estimated]")).toBeVisible();
});

test("改写历史：编辑重发开新分支，切换器切回原来的；重试", async ({page}) => {
    await script("第一版回复");
    await openConversation(page);
    await newSession(page);
    await send(page, "原来的话");
    await expect(page.getByText("第一版回复")).toBeVisible();

    const user = page.locator(".acv-message[data-role='user']");
    await user.hover();
    await user.getByRole("button", {name: "编辑"}).click();
    const editor = page.locator("[data-message-editor] textarea");
    await expect(editor).toHaveValue("原来的话");
    await script("第二版回复");
    await editor.fill("改过的话");
    await page.keyboard.press("Enter");
    await expect(page.getByText("第二版回复")).toBeVisible();
    await expect(page.getByText("第一版回复")).toHaveCount(0);

    await user.hover();
    await expect(user.locator(".agent-message-actions__branch-label")).toContainText("2/2");
    await user.getByRole("button", {name: "上一个分支"}).click();
    await expect(page.getByText("第一版回复")).toBeVisible();
    await expect(page.getByText("第二版回复")).toHaveCount(0);

    await script("重试的回复");
    const assistant = page.locator(".acv-message[data-role='assistant']");
    await assistant.hover();
    await assistant.getByRole("button", {name: "重新生成"}).click();
    await expect(page.getByText("重试的回复")).toBeVisible();
    await assistant.hover();
    await expect(assistant.locator(".agent-message-actions__branch-label")).toContainText("2/2");
});

test("压缩：/compact 带要求，出现带详情的分隔线，点开看到方法与要求；菜单里没有还没做的命令", async ({page}) => {
    await script("答一", "摘要正文");
    await openConversation(page);
    await newSession(page);
    await send(page, "第一问");
    await expect(page.getByText("答一")).toBeVisible();
    await input(page).click();
    await page.keyboard.type("/");
    await expect(page.getByRole("option", {name: /compact/u})).toBeVisible();
    await expect(page.getByRole("option", {name: /clear/u})).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await send(page, "/compact 保留人名");
    const divider = page.locator("[data-divider]");
    await expect(divider).toBeVisible();
    await divider.getByRole("button").click();
    await expect(page.locator("[data-compaction-detail]")).toContainText("沿用对话模型摘要");
    await expect(page.locator("[data-compaction-detail]")).toContainText("保留人名");
    await expect(page.getByText("摘要正文")).toBeVisible();
    // 压缩的运行不属于任何一轮：上一轮的回复还在，没有被改成“已停止”。
    await expect(page.getByText("答一")).toBeVisible();
    await expect(page.getByText("已停止")).toHaveCount(0);
});
