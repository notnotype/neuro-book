/**
 * 消息视图的侧轨版式在真实 Chrome 里的验收（docs/specs/agent/conversation.md 输出 44、57，docs/specs/workbench/views.md 输出 21、22，
 * docs/specs/ui/workbench-layout.md 输出 50）：生产构建的后端与前端，项目与设置是真的（首次启动建出星璃），模型是 Bun 子进程里的本机端点。
 * 只按元素标记约定定位（`.agents/works/w00043-neurobot/tasks/t19-messages-view-ui-polish/plan.md` 的“测试分工”），不读业务代码；
 * 等页面上可观察的变化，不按时长等待。
 *
 * 浮动窗里的视图段（顶格、回到停靠）属于片 6，不在这里。
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
import {rail, railSegment, savedDoc, sectionOf} from "./support/side-rail";

let tmp = "";
let server: ProductServer;
let endpoint: ProcessHandle & {control: string; child: ReturnType<typeof spawn>};

async function control(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${endpoint.control}${path}`, body === undefined ? {} : {method: "POST", body: JSON.stringify(body)});
    return response.json();
}
const script = (...replies: unknown[]) => control("/script", replies);

/** 建一个状态根：一个作品、指向本机端点的模型设置；没有任何会话。 */
async function prepareState(root: string, baseUrl: string): Promise<string> {
    const projectDir = join(root, "Book");
    const stateRoot = join(root, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(projectDir, "第一章.md"), "开头。\n");
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify(localModelSettings(baseUrl)));
    return stateRoot;
}

let endpointUrl = "";

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "agent-messages-rail");
    const child = spawn("bun", [join("e2e", "support", "agent-endpoint.ts")], {cwd: PACKAGE_ROOT, stdio: ["pipe", "pipe", "pipe"]});
    const handle = track(child);
    const [, baseUrl, controlUrl] = await handle.waitFor(/READY (\S+) (\S+)/u);
    endpoint = {...handle, control: controlUrl!, child};
    endpointUrl = baseUrl!;
    server = await startProductServer(await prepareState(tmp, endpointUrl));
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    endpoint.child.stdin?.end();
    await endpoint.exit;
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

// 作者界面的宽版：右栏展开到 260 之后编辑区与聊天区都放得下。
test.use({viewport: {width: 1440, height: 900}});

const CONVERSATION_VIEW = "nbook.agent.conversation";
const EXPLORER = "nbook.explorer";
const LYRA = "nbook.bots/lyra";

const chat = (page: Page) => page.locator("[data-messages-chat]");
const input = (page: Page) => chat(page).getByRole("textbox", {name: "消息输入框"});
const handle = (page: Page) => page.locator(`[data-panel-tab="view:${CONVERSATION_VIEW}"]`);
const segment = (page: Page) => rail(page).locator('[data-rail-segment="main"] [data-messages-segment]');
const contact = (page: Page, key = LYRA) => rail(page).locator(`[data-strip-contact="${key}"]`);
const sessions = (page: Page) => rail(page).locator("[data-strip-session]");
const newButton = (page: Page) => rail(page).locator("[data-messages-new-session]");
const openButton = (page: Page, tab: "bot" | "sessions") => railSegment(page, "foot").locator(`[data-messages-open="${tab}"]`);
const summary = (page: Page) => railSegment(page, "foot").locator("[data-messages-summary]");
const expandButton = (page: Page) => rail(page).locator("[data-rail-expand]");
const listPanel = (page: Page) => page.locator("[data-messages-list-panel]");
const botPage = (page: Page) => page.locator("[data-messages-page=bot]");
const sessionsPage = (page: Page) => page.locator("[data-messages-page=sessions]");
const botSearch = (page: Page) => botPage(page).getByRole("textbox");
const sessionsSearch = (page: Page) => sessionsPage(page).locator("[data-panel-search]");
const regionToggle = (page: Page) => page.locator('[data-titlebar-layout="auxiliarybar"]');

async function openWorkbench(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-explorer-row]").first()).toBeVisible();
    await expect(segment(page)).toHaveAttribute("data-messages-segment-state", "collapsed");
}

/** 经命令面板执行一条命令：不依赖右轨里的按钮在不在。 */
async function palette(page: Page, text: string): Promise<void> {
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
}

/** 新建一段会话，改成唯一的名字，返回它在右轨最近会话里的 id（新建的会话是当前，描边）。 */
async function createSession(page: Page, title: string): Promise<string> {
    const known = await sessions(page).evaluateAll((elements) => elements.map((element) => element.getAttribute("data-strip-session")));
    await newButton(page).click();
    await expect(page.locator("[data-agent-welcome]")).toBeVisible();
    // 新会话立即出现在最近会话里并成为当前：等描边落到一个原来没有的方块上（原来的当前会话在此之前一直是当前）。
    const current = sessions(page).and(page.locator("[aria-current]"));
    await expect.poll(async () => {
        const id = await current.first().getAttribute("data-strip-session", {timeout: 1000}).catch(() => null);
        return id !== null && !known.includes(id);
    }).toBe(true);
    const id = (await current.getAttribute("data-strip-session"))!;
    await input(page).click();
    await page.keyboard.type(`/rename ${title}`);
    await page.keyboard.press("Enter");
    await expect(handle(page).locator("[data-header-title]")).toHaveText(title);
    return id;
}

/** 点右轨里的星璃，等聊天区换成她的主对话。 */
async function openLyra(page: Page): Promise<void> {
    await contact(page).click();
    await expect(handle(page).locator("[data-header-title]")).toHaveText("星璃");
    await expect(input(page)).toBeVisible();
}

// 覆盖 conversation.md 输出 44、57：停靠时对话的头在面板头里，左列没有“新建”；新对话在右轨的视图段里。
test("停靠时头在面板头里、左列没有“新建”：按标题不开列表、不展开右轨；新对话在视图段里（输出 44、57）", async ({page}) => {
    await openWorkbench(page);
    await openLyra(page);
    await expect(page.locator("[data-agent-head]")).toBeHidden();
    await expect(page.locator("[data-header-new]")).toHaveCount(0);
    await expect(newButton(page)).toBeVisible();
    await handle(page).click();
    await expect(listPanel(page)).toHaveCount(0);
    await expect(rail(page)).toHaveAttribute("data-rail-state", "collapsed");
    // 切到普通会话之后头照旧在面板头里，仍没有“新建”。
    await newButton(page).click();
    await expect(page.locator("[data-agent-welcome]")).toBeVisible();
    await expect(page.locator("[data-agent-head]")).toBeHidden();
    await expect(page.locator("[data-header-new]")).toHaveCount(0);
});

// 覆盖 conversation.md 输出 57“收着”：bot、新对话与最近会话、底段；当前 bot 与当前会话 aria-current，切换时跟着换；每一项带 data-rail-item。
test("收着：bot、新对话、最近会话与底段；当前是 bot 时她 aria-current，新建会话后换成那个会话的方块", async ({page}) => {
    await openWorkbench(page);
    await openLyra(page);
    await expect(contact(page)).toHaveAttribute("aria-current", "true");
    await expect(rail(page).locator("[data-strip-session][aria-current]")).toHaveCount(0);
    await expect(newButton(page)).toBeVisible();
    await expect(openButton(page, "bot")).toHaveAttribute("aria-pressed", "false");
    await expect(openButton(page, "sessions")).toHaveAttribute("aria-pressed", "false");
    await expect(expandButton(page)).toHaveAttribute("aria-expanded", "false");
    const items = rail(page).locator("[data-strip-contact], [data-strip-session], [data-messages-new-session], [data-messages-open]");
    expect(await items.count()).toBeGreaterThanOrEqual(4);
    await expect(rail(page).locator("[data-strip-contact]:not([data-rail-item]), [data-strip-session]:not([data-rail-item]), [data-messages-new-session]:not([data-rail-item]), [data-messages-open]:not([data-rail-item])")).toHaveCount(0);

    const id = await createSession(page, "雨夜整理");
    await expect(contact(page)).not.toHaveAttribute("aria-current");
    await expect(rail(page).locator(`[data-strip-session="${id}"]`)).toHaveAttribute("aria-current", "true");
    // 点回星璃：当前换回她，会话的方块不再描边。
    await openLyra(page);
    await expect(contact(page)).toHaveAttribute("aria-current", "true");
    await expect(rail(page).locator(`[data-strip-session="${id}"]`)).not.toHaveAttribute("aria-current");
});

// 覆盖 conversation.md 输出 57“收着”（未读是数字徽标、汇总徽标写未读合计）：失焦时到的回复记为未读，bot 的头像与底段的汇总一起写 1，拿回焦点清零。
test("未读：窗口失焦时到的回复让星璃的头像与“全部 bot”的汇总徽标都写 1，拿回焦点后两处清零", async ({page}) => {
    await openWorkbench(page);
    await openLyra(page);
    await expect(summary(page)).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await script("失焦时到的回复。");
    await input(page).click();
    await page.keyboard.type("在吗");
    await page.keyboard.press("Enter");
    await expect(chat(page).getByText("失焦时到的回复。")).toBeVisible();
    await expect(contact(page)).toHaveAttribute("aria-label", "星璃，1 条未读");
    await expect(contact(page)).toContainText("1");
    await expect(summary(page)).toHaveText("1");
    await expect(summary(page)).not.toHaveAttribute("data-messages-summary-waiting");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(contact(page)).toHaveAttribute("aria-label", "星璃");
    await expect(summary(page)).toHaveCount(0);
});

// 覆盖 conversation.md 输出 57“收着”（等你处理是 warning 色、形状与未读不同；汇总徽标带 data-messages-summary-waiting）：星璃等批准时，头像带 data-strip-waiting、汇总带等你处理的标记。
test("等你处理：星璃等批准时，她的头像带 data-strip-waiting，汇总徽标带 data-messages-summary-waiting；批完后都消失", async ({page}) => {
    await openWorkbench(page);
    await openLyra(page);
    await script({tool: "write", args: {path: "session://草稿.md", content: "内容"}}, "好的。");
    await input(page).click();
    await page.keyboard.type("写个草稿");
    await page.keyboard.press("Enter");
    await expect(chat(page).locator("[data-agent-dock]")).toBeVisible();
    try {
        // 切到一个普通会话：等你处理的是星璃的主对话，不是当前这一个。
        await createSession(page, "另一段会话");
        await expect(contact(page)).toHaveAttribute("data-strip-waiting", /.*/u);
        await expect(summary(page)).toHaveAttribute("data-messages-summary-waiting", /.*/u);
        await expect(sessions(page).and(page.locator("[data-strip-waiting]"))).toHaveCount(0);
    } finally {
        await openLyra(page);
        await chat(page).locator("[data-approval-decision='deny']").click();
    }
    await expect(contact(page)).not.toHaveAttribute("data-strip-waiting");
    await expect(summary(page)).toHaveCount(0);
});

// 覆盖 conversation.md 输出 57“展开”：收着时点底段“全部 bot”展开右轨、切到 bot 页、聚焦这一页的搜索；展开后按钮按下。
test("收着时点“全部 bot”：展开右轨、切到 bot 页、聚焦搜索框，按钮按下", async ({page}) => {
    await openWorkbench(page);
    await openButton(page, "bot").click();
    await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
    await expect(segment(page)).toHaveAttribute("data-messages-segment-state", "expanded");
    await expect(listPanel(page)).toBeVisible();
    await expect(botPage(page)).toBeVisible();
    await expect(botSearch(page)).toBeFocused();
    await expect(openButton(page, "bot")).toHaveAttribute("aria-pressed", "true");
    await expect(openButton(page, "sessions")).toHaveAttribute("aria-pressed", "false");
    await expect(expandButton(page)).toHaveAttribute("aria-expanded", "true");
});

// 覆盖 conversation.md 输出 57“展开”：已展开时点另一个按钮只切页、按钮按下换过去，不聚焦搜索框；收着时点“会话历史”展开到会话页并聚焦会话页的搜索。
test("展开着时点另一个按钮只切页、不聚焦搜索；收起后点“会话历史”展开到会话页并聚焦搜索", async ({page}) => {
    await openWorkbench(page);
    await openButton(page, "bot").click();
    await expect(botSearch(page)).toBeFocused();
    await openButton(page, "sessions").click();
    await expect(sessionsPage(page)).toBeVisible();
    await expect(openButton(page, "sessions")).toHaveAttribute("aria-pressed", "true");
    await expect(openButton(page, "bot")).toHaveAttribute("aria-pressed", "false");
    await expect(sessionsSearch(page)).not.toBeFocused();
    await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");

    await expandButton(page).click();
    await expect(rail(page)).toHaveAttribute("data-rail-state", "collapsed");
    await expect(listPanel(page)).toHaveCount(0);
    await openButton(page, "sessions").click();
    await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
    await expect(sessionsPage(page)).toBeVisible();
    await expect(sessionsSearch(page)).toBeFocused();
});

// 覆盖 conversation.md 输出 57“展开”（搜索框里 Esc 先清空，已空时把焦点交回聊天输入框，不收起）：bot 页与会话页一样。
test("搜索框里 Esc：有字先清空，已空时焦点回到聊天输入框，右轨不收起（bot 页与会话页）", async ({page}) => {
    await openWorkbench(page);
    await openLyra(page);
    for (const [tab, search] of [["bot", botSearch], ["sessions", sessionsSearch]] as const) {
        // 展开着时点按钮只切页、不聚焦搜索框：每一页都从收着开始。
        if (await rail(page).getAttribute("data-rail-state") === "expanded") await expandButton(page).click();
        await expect(rail(page)).toHaveAttribute("data-rail-state", "collapsed");
        await openButton(page, tab).click();
        const box = search(page);
        await expect(box).toBeFocused();
        await page.keyboard.type("星");
        await expect(box).toHaveValue("星");
        await page.keyboard.press("Escape");
        await expect(box).toHaveValue("");
        await expect(box).toBeFocused();
        await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
        await page.keyboard.press("Escape");
        await expect(input(page)).toBeFocused();
        await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
        await expect(listPanel(page)).toBeVisible();
    }
});

// 覆盖 conversation.md 输出 57“展开”（搜索词两页各自保留）、AgentMessagesList：收起再展开，bot 页与会话页的搜索词都还在。
test("收起再展开：bot 页与会话页各自的搜索词还在", async ({page}) => {
    await openWorkbench(page);
    await openButton(page, "bot").click();
    await expect(botSearch(page)).toBeFocused();
    await page.keyboard.type("星璃");
    await openButton(page, "sessions").click();
    await sessionsSearch(page).click();
    await page.keyboard.type("雨夜");
    await expect(sessionsSearch(page)).toHaveValue("雨夜");

    await expandButton(page).click();
    await expect(listPanel(page)).toHaveCount(0);
    await openButton(page, "bot").click();
    await expect(botPage(page)).toBeVisible();
    await expect(botSearch(page)).toHaveValue("星璃");
    await openButton(page, "sessions").click();
    await expect(sessionsSearch(page)).toHaveValue("雨夜");
});

// 覆盖 conversation.md 输出 57“最近会话”：新建后立即出现，归档后消失；会话面板的搜索与过滤不影响它。右轨展开时画的是完整列表，方块只在收着时看得到，
// 所以每次在展开里动过搜索与过滤之后收起再数。
test("最近会话：新建后立即出现，归档后消失；会话面板里的搜索与“显示已归档”都不影响它", async ({page}) => {
    await openWorkbench(page);
    const before = await sessions(page).evaluateAll((elements) => elements.map((element) => element.getAttribute("data-strip-session")));
    const first = await createSession(page, "甲会话");
    expect(before).not.toContain(first);
    await expect(rail(page).locator(`[data-strip-session="${first}"]`)).toHaveCount(1);
    const second = await createSession(page, "乙会话");
    await expect(rail(page).locator(`[data-strip-session="${first}"]`)).toHaveCount(1);
    await expect(rail(page).locator(`[data-strip-session="${second}"]`)).toHaveAttribute("aria-current", "true");
    const withBoth = await sessions(page).count();

    /** 展开到会话页、改一下搜索框，再收起：会话面板的筛选留着（宿主持有）。 */
    async function searchSessions(text: string): Promise<void> {
        if (await rail(page).getAttribute("data-rail-state") === "collapsed") await openButton(page, "sessions").click();
        await expect(sessionsPage(page)).toBeVisible();
        await sessionsSearch(page).fill(text);
    }
    const collapse = async (): Promise<void> => {
        await expandButton(page).click();
        await expect(rail(page)).toHaveAttribute("data-rail-state", "collapsed");
    };

    // 搜“乙会话”：面板里只剩乙；收起后右轨的方块一个不少。
    await searchSessions("乙会话");
    const rows = sessionsPage(page).locator("[data-panel-row]");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("乙会话");
    await collapse();
    await expect(sessions(page)).toHaveCount(withBoth);
    await expect(rail(page).locator(`[data-strip-session="${first}"]`)).toHaveCount(1);
    // 搜一个没有的词：面板空了，方块仍在。
    await searchSessions("没有这个词");
    await expect(rows).toHaveCount(0);
    await collapse();
    await expect(sessions(page)).toHaveCount(withBoth);

    // 搜“甲会话”再归档甲：右轨的方块消失、乙还在。
    await searchSessions("甲会话");
    await expect(rows).toHaveCount(1);
    await rows.first().hover();
    await rows.first().locator("xpath=..").getByRole("button", {name: "更多"}).click();
    await page.getByRole("menuitem", {name: "归档"}).click();
    await collapse();
    await expect(rail(page).locator(`[data-strip-session="${first}"]`)).toHaveCount(0);
    await expect(rail(page).locator(`[data-strip-session="${second}"]`)).toHaveCount(1);
    // 打开“显示已归档”：面板里又有甲，右轨仍没有。
    await searchSessions("甲会话");
    await sessionsPage(page).getByRole("button", {name: "过滤"}).click();
    await page.getByRole("menuitemcheckbox", {name: "显示已归档"}).click();
    await expect(rows).toHaveCount(1);
    await collapse();
    await expect(rail(page).locator(`[data-strip-session="${first}"]`)).toHaveCount(0);
    await expect(sessions(page)).toHaveCount(withBoth - 1);
});

/** 把右栏藏起来：标题栏的右栏开关，等视图段退成弱描边（视图此刻不可见）。 */
async function hideRegion(page: Page): Promise<void> {
    await regionToggle(page).click();
    await expect(regionToggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(segment(page)).toHaveAttribute("data-rail-weak", /.*/u);
}

// 覆盖 conversation.md 输出 57“打开”：右栏隐藏时点右轨里的会话，右栏显示出来、在消息视图里打开，焦点交给聊天输入框。
test("揭示：右栏隐藏后点右轨里的会话，右栏回来、聊天区换成那个会话，焦点在输入框", async ({page}) => {
    await openWorkbench(page);
    const id = await createSession(page, "揭示用的会话");
    await openLyra(page);
    await hideRegion(page);
    await expect(input(page)).toBeHidden();
    await rail(page).locator(`[data-strip-session="${id}"]`).click();
    await expect(regionToggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(segment(page)).not.toHaveAttribute("data-rail-weak");
    await expect(handle(page).locator("[data-header-title]")).toHaveText("揭示用的会话");
    await expect(input(page)).toBeVisible();
    await expect(input(page)).toBeFocused();
});

// 覆盖 conversation.md 输出 57“打开”：右栏隐藏时点右轨里的 bot，显示右栏、打开她的主对话，打开之后焦点交给聊天输入框。
test("揭示：右栏隐藏后点右轨里的 bot，右栏回来、聊天区换成她的主对话，焦点在输入框", async ({page}) => {
    await openWorkbench(page);
    await createSession(page, "先开着别的");
    await hideRegion(page);
    await contact(page).click();
    await expect(regionToggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(handle(page).locator("[data-header-title]")).toHaveText("星璃");
    await expect(input(page)).toBeFocused();
});

// 覆盖 conversation.md 输出 57“打开”：右栏隐藏时点右轨里的“新对话”，显示右栏、新建并打开，焦点在聊天输入框。
test("揭示：右栏隐藏后点右轨里的“新对话”，右栏回来、出现新会话的第一屏，焦点在输入框", async ({page}) => {
    await openWorkbench(page);
    await openLyra(page);
    await hideRegion(page);
    await newButton(page).click();
    await expect(regionToggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-agent-welcome]")).toBeVisible();
    await expect(input(page)).toBeFocused();
});

// 覆盖 conversation.md 输出 57“打开”：别的面板最大化时点右轨里的会话，先退出最大化，再在消息视图里打开，焦点在输入框。
test("揭示：别的面板最大化时点右轨里的会话，退出最大化、聊天区换成那个会话、焦点在输入框", async ({page}) => {
    await openWorkbench(page);
    const id = await createSession(page, "最大化时点的会话");
    await openLyra(page);
    const maximize = page.locator(`[data-panel-head="${await sectionOf(page, EXPLORER)}"] [data-panel-action="nbook.view.toggle-panel-maximized"]`);
    await maximize.click();
    await expect(maximize).toHaveAttribute("aria-pressed", "true");
    // 右轨不被最大化盖住，方块点得到。
    await rail(page).locator(`[data-strip-session="${id}"]`).click();
    await expect(maximize).toHaveAttribute("aria-pressed", "false");
    await expect(handle(page).locator("[data-header-title]")).toHaveText("最大化时点的会话");
    await expect(input(page)).toBeVisible();
    await expect(input(page)).toBeFocused();
});

// 覆盖 conversation.md 输出 57“打开”（命令“搜索会话”等同“会话历史”）：展开到会话页并聚焦搜索；右栏隐藏时先把它显示出来。
test("命令“搜索会话”：展开右轨到会话页并聚焦搜索；右栏隐藏时先显示出来", async ({page}) => {
    await openWorkbench(page);
    await openLyra(page);
    await palette(page, "搜索会话");
    await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
    await expect(sessionsPage(page)).toBeVisible();
    await expect(sessionsSearch(page)).toBeFocused();
    await expect(openButton(page, "sessions")).toHaveAttribute("aria-pressed", "true");

    await expandButton(page).click();
    await expect(rail(page)).toHaveAttribute("data-rail-state", "collapsed");
    await hideRegion(page);
    await palette(page, "搜索会话");
    await expect(regionToggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
    await expect(sessionsSearch(page)).toBeFocused();
});

// 覆盖 conversation.md 输出 57 末句：没有打开会话、停在 bot 页时首屏盖层给一个按钮，等同“全部 bot”。盖层要“没有打开的会话”，共用的状态根里别的用例已经建过会话，所以用一个全新的。
test("没有打开会话、停在 bot 页：右轨收着时首屏盖层的按钮等同“全部 bot”，展开右轨到 bot 页并聚焦搜索", async ({page}) => {
    const root = await createTestTmpRoot("neuro-book-e2e", "agent-messages-rail-fresh");
    const fresh = await startProductServer(await prepareState(root, endpointUrl));
    try {
        await page.goto(new URL("/?project=book", fresh.url).href);
        await expect(page.locator("[data-explorer-row]").first()).toBeVisible();
        await expect(page.locator("[data-messages-pick-bot-open]")).toHaveCount(0);
        // 停在 bot 页的办法：展开到 bot 页再收起，页留在 bot。
        await openButton(page, "bot").click();
        await expect(botPage(page)).toBeVisible();
        await expandButton(page).click();
        await expect(rail(page)).toHaveAttribute("data-rail-state", "collapsed");
        const cover = page.locator("[data-messages-pick-bot-open]");
        await expect(cover).toBeVisible();
        await cover.click();
        await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
        await expect(botPage(page)).toBeVisible();
        await expect(botSearch(page)).toBeFocused();
        await expect(openButton(page, "bot")).toHaveAttribute("aria-pressed", "true");
    } finally {
        expect(await fresh.stop()).toBe(0);
        await rm(root, {recursive: true, force: true});
    }
});

// 覆盖 ui/workbench-layout.md 输出 50“预算”与验收 36（窗口 1100 宽放不下展开）、conversation.md 输出 57“展开”：窗口太窄时点“全部 bot”不展开，用户意图不改，视图段与列表不变。
test("窗口太窄：点“全部 bot”不展开（预算拒绝），按钮不按下、布局记录里没有展开意图，窗口变宽后可以展开", async ({page}) => {
    await page.setViewportSize({width: 1100, height: 900});
    await openWorkbench(page);
    await openButton(page, "bot").click();
    await expect(expandButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(rail(page)).toHaveAttribute("data-rail-state", "collapsed");
    await expect(segment(page)).toHaveAttribute("data-messages-segment-state", "collapsed");
    await expect(listPanel(page)).toHaveCount(0);
    await expect(openButton(page, "bot")).toHaveAttribute("aria-pressed", "false");
    expect(JSON.stringify((await savedDoc(page, join(tmp, "state", "storage", "user.sqlite")))?.panels.auxiliarybar?.rail ?? {})).not.toContain("expanded");
    // 窗口变宽之后可以展开。
    await page.setViewportSize({width: 1440, height: 900});
    await openButton(page, "bot").click();
    await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
});

// 覆盖 ui/workbench-layout.md 输出 50“预算”（被拒时按钮悬停与读屏给“窗口太窄”）：点“全部 bot”被拒后，右轨展开按钮带 data-rail-too-narrow。
test("窗口太窄：点“全部 bot”被拒后，右轨展开按钮带 data-rail-too-narrow 并写“窗口太窄”", async ({page}) => {
    await page.setViewportSize({width: 1100, height: 900});
    await openWorkbench(page);
    await openButton(page, "bot").click();
    await expect(expandButton(page)).toHaveAttribute("data-rail-too-narrow", /.*/u);
    await expect(expandButton(page)).toHaveAttribute("aria-description", "窗口太窄");
});
