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
import {boxOf, rail, railSegment, savedDoc, sectionOf} from "./support/side-rail";

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

// 作者界面的宽版：右栏展开到 300 之后编辑区与聊天区都放得下。
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
/** 展开收起按钮：视图画的，收着与展开是同一个元素（输出 50、57）。 */
const expandButton = (page: Page) => rail(page).locator("[data-rail-toggle]");
/** 展开时列表底部的导航：取代了顶上的页签行。 */
const nav = (page: Page) => page.locator("[data-messages-nav]");
const navTab = (page: Page, tab: "bot" | "sessions") => nav(page).locator(`[data-messages-tab="${tab}"]`);
const navSummary = (page: Page) => nav(page).locator("[data-messages-summary]");
const listPanel = (page: Page) => page.locator("[data-messages-list-panel]");
const botPage = (page: Page) => page.locator("[data-messages-page=bot]");
const sessionsPage = (page: Page) => page.locator("[data-messages-page=sessions]");
const botSearch = (page: Page) => botPage(page).getByRole("textbox");
/** 会话页的搜索：`data-panel-search` 是搜索框的外框（里面有过滤按钮），输入框在里面。 */
const sessionsSearchBox = (page: Page) => sessionsPage(page).locator("[data-panel-search]");
const sessionsSearch = (page: Page) => sessionsSearchBox(page).locator("input");
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
    // 底段的两项只是打开列表的按钮：没有按下态（页签的选中在展开后的底部导航上）。
    await expect(openButton(page, "bot")).not.toHaveAttribute("aria-pressed");
    await expect(openButton(page, "sessions")).not.toHaveAttribute("aria-pressed");
    await expect(expandButton(page)).toHaveAttribute("aria-expanded", "false");
    const items = rail(page).locator("[data-strip-contact], [data-strip-session], [data-messages-new-session], [data-messages-open], [data-rail-toggle]");
    expect(await items.count()).toBeGreaterThanOrEqual(5);
    await expect(rail(page).locator("[data-strip-contact]:not([data-rail-item]), [data-strip-session]:not([data-rail-item]), [data-messages-new-session]:not([data-rail-item]), [data-messages-open]:not([data-rail-item]), [data-rail-toggle]:not([data-rail-item])")).toHaveCount(0);

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

// 覆盖 conversation.md 输出 57“展开”：收着时点底段“全部 bot”展开右轨、切到 bot 页、聚焦这一页的搜索；展开后底部导航的 Bot 项被选中，底段不再可见。
test("收着时点“全部 bot”：展开右轨、切到 bot 页、聚焦搜索框，底部导航的 Bot 项被选中", async ({page}) => {
    await openWorkbench(page);
    await openButton(page, "bot").click();
    await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
    await expect(segment(page)).toHaveAttribute("data-messages-segment-state", "expanded");
    await expect(listPanel(page)).toBeVisible();
    await expect(botPage(page)).toBeVisible();
    await expect(botSearch(page)).toBeFocused();
    await expect(navTab(page, "bot")).toHaveAttribute("aria-selected", "true");
    await expect(navTab(page, "sessions")).toHaveAttribute("aria-selected", "false");
    await expect(expandButton(page)).toHaveAttribute("aria-expanded", "true");
    // 展开时底段（视图段收着时的项）看不见，页上没有第二处点得到的“全部 bot”。
    await expect(openButton(page, "bot")).toBeHidden();
});

// 覆盖 conversation.md 输出 57“展开”：已展开时点底部导航的另一项只切页、选中换过去，不聚焦搜索框；收着时点“会话历史”展开到会话页并聚焦会话页的搜索。
test("展开着时点导航的另一项只切页、不聚焦搜索；收起后点“会话历史”展开到会话页并聚焦搜索", async ({page}) => {
    await openWorkbench(page);
    await openButton(page, "bot").click();
    await expect(botSearch(page)).toBeFocused();
    await navTab(page, "sessions").click();
    await expect(sessionsPage(page)).toBeVisible();
    await expect(botPage(page)).toBeHidden();
    await expect(navTab(page, "sessions")).toHaveAttribute("aria-selected", "true");
    await expect(navTab(page, "bot")).toHaveAttribute("aria-selected", "false");
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
    await navTab(page, "sessions").click();
    await sessionsSearch(page).click();
    await page.keyboard.type("雨夜");
    await expect(sessionsSearch(page)).toHaveValue("雨夜");

    await expandButton(page).click();
    await expect(listPanel(page)).toHaveCount(0);
    await openButton(page, "bot").click();
    await expect(botPage(page)).toBeVisible();
    await expect(botSearch(page)).toHaveValue("星璃");
    await navTab(page, "sessions").click();
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
    await expect(navTab(page, "sessions")).toHaveAttribute("aria-selected", "true");

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
        await expect(navTab(page, "bot")).toHaveAttribute("aria-selected", "true");
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
    await expect(navTab(page, "bot")).toHaveCount(0);
    expect(JSON.stringify((await savedDoc(page, join(tmp, "state", "storage", "user.sqlite")))?.panels.auxiliarybar?.rail ?? {})).not.toContain("expanded");
    // 窗口变宽之后可以展开。
    await page.setViewportSize({width: 1440, height: 900});
    await openButton(page, "bot").click();
    await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
});

// 覆盖 ui/workbench-layout.md 输出 50“预算”（被拒时按钮悬停与读屏给“窗口太窄”）：点“全部 bot”被拒后，视图画的展开按钮带 data-rail-too-narrow。
test("窗口太窄：点“全部 bot”被拒后，展开按钮带 data-rail-too-narrow 并写“窗口太窄”", async ({page}) => {
    await page.setViewportSize({width: 1100, height: 900});
    await openWorkbench(page);
    await openButton(page, "bot").click();
    await expect(expandButton(page)).toHaveAttribute("data-rail-too-narrow", /.*/u);
    await expect(expandButton(page)).toHaveAttribute("aria-description", "窗口太窄");
});

/** 这一点上最上面的元素在不在 `selector` 里：判断“没被盖住”，不靠 click（Playwright 会先滚进裁切它的容器再点）。 */
const hitIn = (page: Page, at: {x: number; y: number}, selector: string): Promise<boolean> =>
    page.evaluate(({at, selector}) => document.elementFromPoint(at.x, at.y)?.closest(selector) != null, {at, selector});

// 覆盖 conversation.md 输出 57“展开”：列表顶上没有页签行，底部是导航，Bot、会话两项是 tab，当前页被选中；点另一项切页，方向键与 Home、End 换页。
test("底部导航：展开后列表底部是 Bot、会话两个 tab，顶上没有页签行；点另一项切页，方向键换页", async ({page}) => {
    await openWorkbench(page);
    await openButton(page, "bot").click();
    await expect(botPage(page)).toBeVisible();
    await expect(page.locator("[data-messages-switch]")).toHaveCount(0);
    await expect(nav(page).getByRole("tab")).toHaveCount(2);
    await expect(navTab(page, "bot")).toHaveAttribute("role", "tab");
    await expect(navTab(page, "sessions")).toHaveAttribute("role", "tab");
    await expect(navTab(page, "bot")).toHaveAttribute("aria-selected", "true");
    await expect(navTab(page, "sessions")).toHaveAttribute("aria-selected", "false");
    // 导航在列表的底部：页在它上面，它的下缘就是列表的下缘。
    const [list, navBox, pageBox] = [await boxOf(listPanel(page)), await boxOf(nav(page)), await boxOf(botPage(page))];
    expect(pageBox.y + pageBox.height).toBeLessThanOrEqual(navBox.y + 1);
    expect(Math.abs(navBox.y + navBox.height - (list.y + list.height))).toBeLessThanOrEqual(2);
    expect(navBox.x).toBeGreaterThanOrEqual(list.x - 1);
    expect(navBox.x + navBox.width).toBeLessThanOrEqual(list.x + list.width + 1);

    await navTab(page, "sessions").click();
    await expect(sessionsPage(page)).toBeVisible();
    await expect(botPage(page)).toBeHidden();
    await expect(navTab(page, "sessions")).toHaveAttribute("aria-selected", "true");
    await expect(navTab(page, "bot")).toHaveAttribute("aria-selected", "false");
    // 导航跟着页走，不随页换位置。
    expect(Math.abs((await boxOf(nav(page))).y - navBox.y)).toBeLessThanOrEqual(1);

    // 方向键换页（焦点跟着选中的 tab）。
    await navTab(page, "sessions").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(navTab(page, "bot")).toHaveAttribute("aria-selected", "true");
    await expect(botPage(page)).toBeVisible();
    await expect(navTab(page, "bot")).toBeFocused();
    await page.keyboard.press("End");
    await expect(navTab(page, "sessions")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(navTab(page, "bot")).toHaveAttribute("aria-selected", "true");
});

// 覆盖 conversation.md 输出 57“展开”（汇总徽标：中性色数字，有等你处理时带 data-messages-summary-waiting）：展开后 Bot 项上写未读合计；拿回焦点清零。
test("导航上的未读合计：窗口失焦时到的回复让 Bot 项写 1、不带等你处理的标记，拿回焦点后清零", async ({page}) => {
    await openWorkbench(page);
    await openLyra(page);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await script("导航上看的回复。");
    await input(page).click();
    await page.keyboard.type("在吗");
    await page.keyboard.press("Enter");
    await expect(chat(page).getByText("导航上看的回复。")).toBeVisible();
    await openButton(page, "bot").click();
    await expect(navTab(page, "bot")).toBeVisible();
    await expect(navSummary(page)).toHaveText("1");
    await expect(navSummary(page)).not.toHaveAttribute("data-messages-summary-waiting");
    // 合计在 Bot 项上，不在会话项上。
    await expect(navTab(page, "bot").locator("[data-messages-summary]")).toHaveCount(1);
    await expect(navTab(page, "sessions").locator("[data-messages-summary]")).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(navSummary(page)).toHaveCount(0);
});

// 覆盖 conversation.md 输出 57“展开”：星璃等批准时，展开后导航 Bot 项上的合计带 data-messages-summary-waiting；批完后消失。
test("导航上等你处理：星璃等批准时，Bot 项的汇总带 data-messages-summary-waiting；批完后消失", async ({page}) => {
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
        await openButton(page, "bot").click();
        await expect(navSummary(page)).toHaveAttribute("data-messages-summary-waiting", /.*/u);
        await expandButton(page).click();
        await expect(rail(page)).toHaveAttribute("data-rail-state", "collapsed");
    } finally {
        await openLyra(page);
        await chat(page).locator("[data-approval-decision='deny']").click();
    }
    await openButton(page, "bot").click();
    await expect(navTab(page, "bot")).toBeVisible();
    await expect(navSummary(page)).toHaveCount(0);
});

// 覆盖 ui/workbench-layout.md 输出 50“展开时的版式”、conversation.md 输出 57“展开”：右栏只有消息一个容器时，展开后入口带不可见（收着时在、轴是竖的），收起后回来；
// 底段（视图段收着时的项）展开时不可见、也聚焦不进去。
test("展开时的版式（右栏只有消息）：入口带不可见、底段不可见且不可聚焦，没有窄列；收起后入口带回来", async ({page}) => {
    await openWorkbench(page);
    const band = rail(page).locator("[data-tool-band]");
    await expect(band).toBeVisible();
    await expect(band).toHaveAttribute("data-tool-band-axis", "y");
    await expect(railSegment(page, "foot")).toBeVisible();
    const collapsedWidth = (await boxOf(rail(page))).width;

    await openButton(page, "bot").click();
    await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
    await expect(band).toBeHidden();
    await expect(railSegment(page, "foot")).toBeHidden();
    await expect(openButton(page, "bot")).toBeHidden();
    await expect(openButton(page, "sessions")).toBeHidden();
    // 不可 Tab：藏起来的元素聚焦不上。
    expect(await openButton(page, "bot").evaluate((element) => {
        (element as HTMLElement).focus();
        return document.activeElement === element;
    })).toBe(false);
    // 没有 48 宽的窄列：列表从轨的左缘起，按钮之外一整块都是它。
    const [railBox, listBox] = [await boxOf(rail(page)), await boxOf(listPanel(page))];
    expect(railBox.width).toBeGreaterThan(collapsedWidth + 200);
    expect(railBox.x + railBox.width - (listBox.x + listBox.width)).toBeLessThanOrEqual(2);
    expect(listBox.x - railBox.x).toBeLessThanOrEqual(2);

    await expandButton(page).click();
    await expect(rail(page)).toHaveAttribute("data-rail-state", "collapsed");
    await expect(band).toBeVisible();
    await expect(band).toHaveAttribute("data-tool-band-axis", "y");
    await expect(railSegment(page, "foot")).toBeVisible();
});

// 覆盖 ui/workbench-layout.md 输出 50“三段”“展开时的版式”、conversation.md 输出 57“收着”“展开”：展开收起按钮收着时是视图段中段的第一项（带 data-rail-item）；
// 展开后是同一个元素、在列表右上角、不带 data-rail-item，焦点留在它上面，Tab 可达；列表第一行（两页的搜索行）不被它盖住。
test("展开收起按钮：收着时是中段第一项；展开后是同一个元素、在列表右上角、焦点留着，搜索行不被它盖住", async ({page}) => {
    await openWorkbench(page);
    const toggle = expandButton(page);
    await expect(toggle).toHaveCount(1);
    await expect(toggle).toHaveAttribute("data-messages-segment-toggle", /.*/u);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    // 收着：在中段里、中段第一个入侧轨工具条的项。
    await expect(railSegment(page, "main").locator("[data-rail-toggle]")).toHaveCount(1);
    await expect(toggle).toHaveAttribute("data-rail-item", /.*/u);
    expect(await railSegment(page, "main").locator("[data-rail-item]").first().evaluate((element) => element.hasAttribute("data-rail-toggle"))).toBe(true);
    const node = await toggle.elementHandle();

    await toggle.click();
    await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    // 同一个元素，焦点留在它上面；展开后它是列表区里的普通按钮（不进侧轨的纵向工具条）、Tab 可达。
    expect(await toggle.evaluate((element, other) => element === other, node)).toBe(true);
    await expect(toggle).toBeFocused();
    await expect(toggle).not.toHaveAttribute("data-rail-item");
    await expect(toggle).not.toHaveAttribute("tabindex", "-1");
    // 按钮只展开、不指定页：先选定 bot 页再量。
    await navTab(page, "bot").click();
    // 在列表区的右上角。
    await expect(botPage(page)).toBeVisible();
    const list = await boxOf(listPanel(page));
    const at = await boxOf(toggle);
    expect(at.x).toBeGreaterThanOrEqual(list.x);
    expect(at.x + at.width).toBeLessThanOrEqual(list.x + list.width + 1);
    expect(at.x + at.width / 2).toBeGreaterThan(list.x + list.width * 0.75);
    expect(at.y).toBeGreaterThanOrEqual(list.y - 1);
    expect(at.y + at.height).toBeLessThanOrEqual(list.y + 64);
    const center = {x: at.x + at.width / 2, y: at.y + at.height / 2};
    // 搜索行不被它盖住：按钮中心上最上面的是按钮，搜索框右缘不超过按钮左缘（两页都是）。
    expect(await hitIn(page, center, "[data-rail-toggle]")).toBe(true);
    expect((await boxOf(botSearch(page))).x + (await boxOf(botSearch(page))).width).toBeLessThanOrEqual(at.x + 0.5);
    await navTab(page, "sessions").click();
    await expect(sessionsPage(page)).toBeVisible();
    expect(await toggle.evaluate((element, other) => element === other, node)).toBe(true);
    expect(await hitIn(page, center, "[data-rail-toggle]")).toBe(true);
    for (const row of [sessionsSearchBox(page), sessionsPage(page).locator("[data-panel-create]")]) {
        const box = await boxOf(row);
        expect(box.x + box.width).toBeLessThanOrEqual(at.x + 0.5);
    }
    // 对照：判据会失败——按钮左边那一点上最上面的不是按钮。
    expect(await hitIn(page, {x: at.x - 40, y: center.y}, "[data-rail-toggle]")).toBe(false);

    // 再点收起：还是同一个元素，焦点在它上面，回到中段第一项。
    await toggle.click();
    await expect(rail(page)).toHaveAttribute("data-rail-state", "collapsed");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(await toggle.evaluate((element, other) => element === other, node)).toBe(true);
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute("data-rail-item", /.*/u);
    expect(await railSegment(page, "main").locator("[data-rail-item]").first().evaluate((element) => element.hasAttribute("data-rail-toggle"))).toBe(true);
});

// 覆盖 agent/conversation.md 输出 3 的 planned 部分：会话面板顶上一行只有搜索框（提示“搜索”）与新建，过滤按钮在搜索框里的右端，没有作品范围按钮；
// 范围是过滤菜单最上面一组单选，“全部作品”计入过滤按钮上的条数，“清除过滤条件”回到当前作品。
test("会话面板的搜索行：只有搜索与新建，过滤按钮在搜索框里；范围在过滤菜单里，选“全部作品”条数加一，清除后回到当前作品", async ({page}) => {
    await openWorkbench(page);
    await openButton(page, "sessions").click();
    await expect(sessionsPage(page)).toBeVisible();
    const filter = sessionsPage(page).locator("[data-panel-filter]");
    const count = sessionsPage(page).locator("[data-panel-filter-count]");
    await expect(sessionsSearch(page)).toHaveAttribute("placeholder", "搜索");
    await expect(sessionsPage(page).locator("[data-panel-create]")).toBeVisible();
    await expect(sessionsPage(page).locator("[data-panel-scope]")).toHaveCount(0);
    // 过滤按钮在搜索框里的右端：垂直上在搜索框的范围内，水平上在搜索框中线的右边、新建按钮的左边。
    const [search, filterBox, create] = [await boxOf(sessionsSearchBox(page)), await boxOf(filter), await boxOf(sessionsPage(page).locator("[data-panel-create]"))];
    expect(filterBox.y + filterBox.height / 2).toBeGreaterThanOrEqual(search.y);
    expect(filterBox.y + filterBox.height / 2).toBeLessThanOrEqual(search.y + search.height);
    expect(filterBox.x + filterBox.width / 2).toBeGreaterThan(search.x + search.width / 2);
    expect(filterBox.x + filterBox.width).toBeLessThanOrEqual(create.x + 1);
    await expect(count).toHaveCount(0);

    const scope = (name: "当前作品" | "全部作品") => page.getByRole("menuitemradio", {name});
    /** 菜单点完一项可能收起：没开着就再点过滤按钮。 */
    const menu = async (): Promise<void> => {
        if (!await scope("全部作品").isVisible()) await filter.click();
        await expect(scope("全部作品")).toBeVisible();
    };
    await menu();
    await expect(scope("当前作品")).toHaveAttribute("aria-checked", "true");
    await expect(scope("全部作品")).toHaveAttribute("aria-checked", "false");
    // 范围在菜单最上面：两个单选都在“显示已归档”的上面。
    const archived = page.getByRole("menuitemcheckbox", {name: "显示已归档"});
    expect((await boxOf(scope("全部作品"))).y).toBeLessThan((await boxOf(archived)).y);

    await scope("全部作品").click();
    await expect(count).toHaveText("1");
    await menu();
    await expect(scope("全部作品")).toHaveAttribute("aria-checked", "true");
    await expect(scope("当前作品")).toHaveAttribute("aria-checked", "false");
    await archived.click();
    await expect(count).toHaveText("2");

    await menu();
    await page.getByRole("menuitem", {name: "清除过滤条件"}).click();
    await expect(count).toHaveCount(0);
    await menu();
    await expect(scope("当前作品")).toHaveAttribute("aria-checked", "true");
    await expect(archived).toHaveAttribute("aria-checked", "false");
});

/** 从现在起视图段根上 `data-messages-moving` 被加上的次数（MutationObserver 不漏同一个任务里加了又去掉的）。 */
async function watchMoving(page: Page): Promise<() => Promise<number>> {
    await page.evaluate(() => {
        const store = globalThis as unknown as {__movingAdded: number};
        store.__movingAdded = 0;
        new MutationObserver((records) => {
            for (const record of records) if (record.oldValue === null && (record.target as Element).hasAttribute("data-messages-segment")) store.__movingAdded += 1;
        }).observe(document.body, {attributes: true, subtree: true, attributeFilter: ["data-messages-moving"], attributeOldValue: true});
    });
    return () => page.evaluate(() => (globalThis as unknown as {__movingAdded: number}).__movingAdded);
}

// 覆盖 conversation.md 输出 57“展开”的过渡与 ui-development 的“状态变化有动效”：点按钮展开、收起时视图段在动（`data-messages-moving`），动完清掉；
// 减少动态效果时从不出现、直接到位。同一个监听先在减少动效下走一遍，再开回动效走一遍：后一半证明监听抓得到，前一半的“零次”才不是空过。
test("展开收起的过渡：动效开着时视图段在动、动完清掉，连点也收得住；减少动态效果时从不出现", async ({page}) => {
    await openWorkbench(page);
    const moved = await watchMoving(page);
    await openButton(page, "bot").click();
    await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
    await expect(botPage(page)).toBeVisible();
    await expandButton(page).click();
    await expect(rail(page)).toHaveAttribute("data-rail-state", "collapsed");
    await expect(openButton(page, "bot")).toBeVisible();
    await expect(listPanel(page)).toHaveCount(0);
    expect(await moved(), "减少动态效果时不动").toBe(0);

    await page.emulateMedia({reducedMotion: "no-preference"});
    await openButton(page, "bot").click();
    await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
    await expect.poll(moved, {message: "展开时在动"}).toBeGreaterThan(0);
    await expect(segment(page)).not.toHaveAttribute("data-messages-moving");
    const afterExpand = await moved();
    await expandButton(page).click();
    await expect(rail(page)).toHaveAttribute("data-rail-state", "collapsed");
    await expect.poll(moved, {message: "收起时在动"}).toBeGreaterThan(afterExpand);
    await expect(segment(page)).not.toHaveAttribute("data-messages-moving");
    await expect(listPanel(page)).toHaveCount(0);
    await expect(openButton(page, "bot")).toBeVisible();

    // 连点：展开刚开始就收起，取消上一次、从当前位置回去；最后收着，标记清掉，离场的列表也拿掉。
    await expandButton(page).click();
    await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
    await expandButton(page).click();
    await expect(rail(page)).toHaveAttribute("data-rail-state", "collapsed");
    await expect(segment(page)).not.toHaveAttribute("data-messages-moving");
    await expect(listPanel(page)).toHaveCount(0);
    await expect(expandButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(expandButton(page)).toBeFocused();
});
