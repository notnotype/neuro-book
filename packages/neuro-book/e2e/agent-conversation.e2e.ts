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

import {productPlugins} from "nbook/manifest";
import {localModelSettings} from "nbook/plugins/agent/testing/endpoint";
import {createPluginInventory} from "nbook/plugin-platform/backend/inventory";
import {NO_INSTALLED_PLUGINS} from "nbook/plugin-platform/backend/startup";
import {NEUROBOOK_PROFILE} from "nbook/plugin-platform-profile";

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

/**
 * 按状态换场景的一遍：用 `theme` 起一个服务，会话运行时场景变量换成 `working`，结束后换回 `idle`。`install` 是要装进来的
 * 主题插件（内置主题不用装）；模型端点与项目照旧。
 */
async function checkWorkingScene(page: Page, options: {readonly theme: string; readonly install?: string; readonly idle: RegExp; readonly working: RegExp}): Promise<void> {
    const root = join(tmp, `with-theme-${options.theme}`);
    await mkdir(join(root, "user"), {recursive: true});
    await writeFile(join(root, "projects.json"), await readFile(join(stateRoot, "projects.json")));
    if (options.install !== undefined) {
        const plugins = createPluginInventory({root: join(root, "plugins"), profile: NEUROBOOK_PROFILE, builtin: productPlugins, startup: NO_INSTALLED_PLUGINS, record: () => undefined});
        const installed = await plugins.install(join(PACKAGE_ROOT, options.install));
        if (!installed.ok) throw new Error(`安装失败：${JSON.stringify(installed)}`);
    }
    const base = JSON.parse(await readFile(join(stateRoot, "settings.json"), "utf8")) as Record<string, unknown>;
    await writeFile(join(root, "settings.json"), JSON.stringify({...base, "nbook.workbench/theme": options.theme, "nbook.workbench/appearance": "light"}));
    const themed = await startProductServer(root);
    const sceneVar = (): Promise<string> => page.evaluate(() => document.documentElement.style.getPropertyValue("--skin-scene"));
    try {
        await page.goto(new URL("/?project=book", themed.url).href);
        await expect(page.locator("[data-explorer-row]").first()).toBeVisible();
        await expect.poll(sceneVar).toMatch(options.idle);
        await page.keyboard.press("Control+Shift+P");
        await page.keyboard.type("打开对话");
        await page.keyboard.press("Enter");
        await expect(input(page)).toBeVisible();
        await newSession(page);
        await control("/hold");
        await script("好了");
        await send(page, "写一章");
        await control("/hold/arrived");
        await expect.poll(sceneVar).toMatch(options.working);
        await control("/hold/release");
        await expect(page.getByText("好了")).toBeVisible();
        await expect.poll(sceneVar).toMatch(options.idle);
        expect(await sceneVar()).not.toMatch(/working/u);
    } finally {
        await page.goto("about:blank");
        expect(await themed.stop()).toBe(0);
    }
}

test("按状态换场景（theme.skins 输出 17）：会话在运行时换成主题的工作态场景，结束后换回", async ({page}) => {
    // 暮色是装进来的示例主题插件，写了工作态场景。
    await checkWorkingScene(page, {theme: "example.theme-dusk.dusk", install: "plugin-sdk/examples/external/theme-dusk", idle: /dusk-day\.webp/u, working: /dusk-day-working\.webp/u});
});

test("按状态换场景（theme.skins 输出 11、17）：内置的书房也有工作态场景", async ({page}) => {
    // 内置素材经构建加了哈希（`study-day-<哈希>.webp`），空闲图的匹配要把 `-working` 排除。
    await checkWorkingScene(page, {theme: "nbook.theme-study.study", idle: /study-day-(?!working)[\w-]+\.webp/u, working: /study-day-working-[\w-]+\.webp/u});
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
    const editor = page.locator("[data-message-editor]").getByRole("textbox");
    await expect(editor).toContainText("原来的话");
    await script("第二版回复");
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("改过的话");
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

test("分支树：列表与图，图默认从上往下、能换方向；选别的分支切过去", async ({page}, testInfo) => {
    await script("第一版回复");
    await openConversation(page);
    await newSession(page);
    await send(page, "问一句");
    await expect(page.getByText("第一版回复")).toBeVisible();
    const assistant = page.locator(".acv-message[data-role='assistant']");
    await script("第二版回复");
    await assistant.hover();
    await assistant.getByRole("button", {name: "重新生成"}).click();
    await expect(page.getByText("第二版回复")).toBeVisible();

    await page.locator(".acv-header").getByRole("button", {name: "更多操作"}).click();
    await page.getByRole("menuitem", {name: "分支树"}).click();
    const tree = page.locator("[data-session-tree]");
    await expect(tree.locator("[data-tree-count]")).toContainText("1 处分叉");
    await expect(tree.locator("[data-tree-current]")).toContainText("第二版回复");
    await page.screenshot({path: testInfo.outputPath("tree-list.png")});

    await tree.locator("[data-tree-modes] button").last().click();
    await expect(tree.locator("[data-tree-canvas]")).toHaveAttribute("data-direction", "down");
    await page.screenshot({path: testInfo.outputPath("tree-graph-down.png")});
    await tree.locator("[data-tree-direction='right']").click();
    await expect(tree.locator("[data-tree-canvas]")).toHaveAttribute("data-direction", "right");
    await page.screenshot({path: testInfo.outputPath("tree-graph-right.png")});

    await tree.getByText("第一版回复").click();
    await tree.locator("[data-tree-activate]").click();
    await expect(tree).toHaveCount(0);
    await expect(page.getByText("第一版回复")).toBeVisible();
    await expect(page.getByText("第二版回复")).toHaveCount(0);
});

test("输入框：@ 引用项目文件；/rename、/model、/new；草稿切会话、刷新后还在；上方向键调历史", async ({page}) => {
    await script("回复");
    await openConversation(page);
    await newSession(page);
    await input(page).click();
    await page.keyboard.type("看看 @第三");
    const item = page.getByRole("option", {name: /第三章/u}).or(page.getByRole("menuitem", {name: /第三章/u})).first();
    await expect(item).toBeVisible();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(page.getByText("回复", {exact: true})).toBeVisible();
    const sent = await requests();
    expect(JSON.stringify(sent.at(-1)!.messages)).toContain("project://正文/第三章.md");

    await input(page).click();
    await page.keyboard.type("/rename 雨夜");
    await page.keyboard.press("Enter");
    await expect(page.locator(".acv-header__name")).toHaveText("雨夜");

    await input(page).click();
    await page.keyboard.type("/model 本机");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-model-picker-panel]")).toBeVisible();
    await expect(page.locator("[data-model-picker-search] input, input[data-model-picker-search]")).toHaveValue("本机");
    await page.keyboard.press("Escape");

    await input(page).click();
    await page.keyboard.press("ArrowUp");
    await expect(input(page)).toContainText("看看");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");

    await page.keyboard.type("没写完的字");
    await page.locator("[data-header-new]").click();
    await expect(page.locator(".acv-stream__empty")).toBeVisible();
    await expect(input(page)).not.toContainText("没写完的字");
    await page.locator(".acv-header__title--button").click();
    await page.getByRole("button", {name: /雨夜/u}).or(page.getByText("雨夜")).first().click();
    await expect(input(page)).toContainText("没写完的字");
    await page.reload();
    await expect(input(page)).toContainText("没写完的字");

    await input(page).click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await page.keyboard.type("/new");
    // 第一次回车选中菜单里的命令，第二次发出去。
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(page.locator(".acv-stream__empty")).toBeVisible();
    await expect(input(page)).not.toContainText("/new");
});

/** 1×1 的 PNG。 */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("附件：选图片上传，消息里显示；模型不能看图时请求里换成一行字；读取路由给图，带脚本的 SVG 进沙箱、超限被拒", async ({page}, testInfo) => {
    await script("收到图了");
    await openConversation(page);
    await newSession(page);
    await page.locator("[data-composer-action='attach']").waitFor();
    await page.locator(".acv-composer__file-input").setInputFiles({name: "封面.png", mimeType: "image/png", buffer: PNG});
    await expect(page.getByRole("list", {name: "附件"}).getByRole("listitem")).toHaveCount(1);
    await input(page).click();
    await page.keyboard.type("看这张");
    await page.keyboard.press("Enter");
    await expect(page.getByText("收到图了")).toBeVisible();
    await page.screenshot({path: testInfo.outputPath("attachment.png")});

    const sent = JSON.stringify((await requests()).at(-1)!.messages);
    // 本机端点的模型不支持图片：换成一行字，不报错；标签本身不进请求。
    expect(sent).toContain("当前模型不能看图");
    expect(sent).not.toContain("![image");

    const session = await page.evaluate(async () => {
        const names = performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => name.includes("/attachments"));
        return names.at(-1) ?? "";
    });
    expect(session).toContain("/api/nbook.agent/sessions/");
    const base = session.slice(0, session.indexOf("/attachments") + "/attachments".length);

    const image = await page.request.get(session);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toBe("image/png");
    expect(image.headers()["content-security-policy"]).toBe("sandbox");
    expect(image.headers()["x-content-type-options"]).toBe("nosniff");

    const svg = await page.request.post(base, {headers: {"Content-Type": "image/svg+xml", "X-Attachment-Name": encodeURIComponent("脚本.svg")}, data: "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"});
    expect(svg.status()).toBe(200);
    const uploaded = await svg.json() as {kind: string; uri: string; name: string};
    // 文件头不是图片：按普通文件存，读的时候只能下载。
    expect(uploaded).toMatchObject({kind: "file", name: "脚本.svg"});
    const read = await page.request.get(`${base}/${uploaded.uri.slice(uploaded.uri.lastIndexOf("/") + 1)}`);
    expect(read.headers()["content-type"]).toBe("application/octet-stream");
    expect(read.headers()["content-disposition"]).toContain("attachment");
    expect(read.headers()["content-security-policy"]).toBe("sandbox");

    // 分块上传没有 Content-Length：边读边数，超了就拒。
    const stream = new ReadableStream({
        start(controller) {
            for (let index = 0; index < 26; index += 1) controller.enqueue(new Uint8Array(1024 * 1024));
            controller.close();
        },
    });
    // 服务端读到超限就回 413 并断开：对方还在发的时候，客户端可能先看到连接断了。两种都算拒了。
    const tooLarge = await fetch(new URL(base, server.url), {method: "POST", body: stream, duplex: "half"} as RequestInit).then((response) => response.status, () => 413);
    expect(tooLarge).toBe(413);
    expect((await page.request.post(base.replace("/sessions/", "/sessions/no-such-"), {data: "x"})).status()).toBe(404);
    expect((await page.request.get(`${base}/..%2F..%2Fsession.jsonl`)).status()).toBeGreaterThanOrEqual(400);
});

test("Agent 模式：还没有会话时选计划；写作品被拦；写计划、批准并开始后切回；Shift+Tab 切换", async ({page}) => {
    await openConversation(page);
    await newSession(page);
    const mode = page.locator('[data-composer-action="mode"]');
    await expect(mode).toContainText("普通");
    await mode.click();
    await mode.click();
    await expect(mode).toContainText("计划");
    await expect(page.locator("[data-status-mode]")).toContainText("计划模式");
    await expect(page.locator('[data-composer-action="approval"]')).toHaveClass(/is-muted/u);

    await script(
        {tool: "write", args: {path: "project://正文/第三章.md", content: "不该写进去"}},
        {tool: "write", args: {path: "session://plan.md", content: "# 改第三章\n\n第一步：压缩回忆"}},
        {tool: "switch_mode", args: {mode: "normal"}},
        "开始实现",
    );
    await send(page, "规划一下第三章");
    await expect(page.locator("[data-mode-switch-plan]")).toContainText("第一步：压缩回忆");
    await page.locator("[data-mode-switch-approve]").click();
    await expect(page.getByText("开始实现")).toBeVisible();
    await expect(mode).toContainText("普通");
    await expect(page.locator("[data-status-mode]")).toHaveCount(0);
    const seen = JSON.stringify((await requests()).map((request) => request.messages));
    expect(seen).toContain("现在是计划模式");
    expect(seen).toContain("mode-blocked");

    await page.getByRole("textbox", {name: "消息输入框"}).click();
    await page.keyboard.press("Shift+Tab");
    await expect(mode).toContainText("讨论");
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
