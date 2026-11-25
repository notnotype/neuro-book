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

/** 新建一段会话。头上的新建只在已有会话时才有（没选会话时头上没有它），所以经命令面板，两种情况一样。 */
const newSession = async (page: Page): Promise<void> => {
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("新建 Agent 会话");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-agent-welcome]")).toBeVisible();
};

/** 右栏对话视图所在面板头的标题按钮：视图接管标题区后，头的中间一列在它里面（conversation.md 输出 44）。 */
const CONVERSATION_VIEW = "nbook.agent.conversation";
const conversationHandle = (page: Page) => page.locator(`[data-panel-tab="view:${CONVERSATION_VIEW}"]`);
const panelHeadOf = (page: Page, viewId: string) => page.locator(`[data-panel-head]:has([data-panel-tab="view:${viewId}"])`);

test("宽版（conversation.md 输出 1–3、44）：右栏拖到 600 像素以上是两栏，列表栏常驻、对话的头画在聊天区上方、面板头写“消息”；会话一页点一行在同一个视图打开；收起列表栏后左边换成头像列", async ({page}) => {
    await page.setViewportSize({width: 1600, height: 900});
    await openConversation(page);
    await newSession(page);
    const root = page.locator("[data-messages-layout]");
    await expect(root).toHaveAttribute("data-messages-layout", "narrow");
    // 右栏左边那条竖分隔线：往左拖，右栏变宽。
    const view = (await page.locator(`[data-content="view:${CONVERSATION_VIEW}"]`).boundingBox())!;
    const sash = await page.locator("[data-workbench-surface] .nb-grid-sash").evaluateAll((elements, left) => elements.map((element) => element.getBoundingClientRect()).find((rect) => rect.height > rect.width && Math.abs(rect.right - left) < 24) ?? null, view.x);
    expect(sash).not.toBeNull();
    const x = sash!.x + sash!.width / 2;
    const y = sash!.y + sash!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - (720 - view.width), y, {steps: 8});
    await page.mouse.up();
    await expect(root).toHaveAttribute("data-messages-layout", "wide");
    await expect(page.locator("[data-messages-list-panel]")).toBeVisible();
    await expect(page.locator("[data-messages-strip]")).toBeHidden();
    // 头回到聊天区上方，面板头照常写视图标题。
    await expect(page.locator("[data-agent-head]")).toBeVisible();
    await expect(conversationHandle(page)).toHaveText("消息");
    // 会话一页点一行：聊天区换成那个会话，还是这一个视图。
    await page.locator("[data-messages-tab='sessions']").click();
    const rows = page.locator("[data-messages-list-panel] [data-panel-row]");
    await expect(rows.first()).toBeVisible();
    await rows.first().click();
    await expect(page.locator("[data-messages-chat] [data-agent-head]")).toBeVisible();
    // 拖列表栏右边的线：列表栏变宽。
    const listWidth = () => page.locator("[data-messages-list-panel]").evaluate((element) => (element as HTMLElement).offsetWidth);
    expect(await listWidth()).toBe(260);
    const line = (await root.getByRole("separator").boundingBox())!;
    await page.mouse.move(line.x + line.width / 2, line.y + line.height / 2);
    await page.mouse.down();
    await page.mouse.move(line.x + line.width / 2 + 40, line.y + line.height / 2, {steps: 6});
    await page.mouse.up();
    expect(Math.abs(await listWidth() - 300)).toBeLessThanOrEqual(1);
    // 收起列表栏：左边换成头像列，按它的按钮展开；展开后还是拖出来的宽度（宿主记着）。
    await page.locator("[data-messages-collapse]").click();
    await expect(page.locator("[data-messages-list-panel]")).toBeHidden();
    await expect(page.locator("[data-messages-strip]")).toBeVisible();
    await page.locator("[data-messages-toggle]").click();
    await expect(page.locator("[data-messages-list-panel]")).toBeVisible();
    await expect.poll(async () => Math.abs(await listWidth() - 300)).toBeLessThanOrEqual(1);
});

test("对话写在面板头上（conversation.md 输出 44）：窄版时头的三列在面板头里；按标题开列表抽屉，Esc 关掉回到标题", async ({page}) => {
    await openConversation(page);
    await newSession(page);
    const handle = conversationHandle(page);
    // 列表在消息视图的抽屉里（右栏默认宽度是窄版）。
    const sessions = page.locator("[data-messages-list-panel]");
    await expect(handle.locator("[data-header-title]")).toBeVisible();
    await expect(page.locator("[data-agent-head]")).toBeHidden();

    // 按标题开列表抽屉（标题按钮写 aria-expanded）；Esc 关掉，焦点回到标题。
    await handle.click();
    await expect(sessions).toBeVisible();
    await expect(handle).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(sessions).toBeHidden();
    await expect(handle).toBeFocused();
    await expect(handle).toHaveAttribute("aria-expanded", "false");
});

/** 指针拖一段：按下、过起拖门槛、再走到终点松开。 */
async function dragBy(page: Page, from: {x: number; y: number}, dx: number, dy: number): Promise<void> {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx / 4, from.y + dy / 4, {steps: 2});
    await page.mouse.move(from.x + dx, from.y + dy, {steps: 6});
    await page.mouse.up();
}

const centerOf = async (page: Page, selector: string): Promise<{x: number; y: number}> => {
    const box = (await page.locator(selector).first().boundingBox())!;
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
};

/** 这一点上最上面的元素在不在 `selector` 里：判断“看得见、点得到、没被盖住”，不靠 click（Playwright 会先把目标滚进裁切它的容器再点）。 */
const hitIn = (page: Page, at: {x: number; y: number}, selector: string): Promise<boolean> =>
    page.evaluate(({at, selector}) => document.elementFromPoint(at.x, at.y)?.closest(selector) != null, {at, selector});

test("浮动窗里自绘头（workbench/views.md 输出 19 的“自绘头”，conversation.md 消息视图）：没有面板头那一行，第一行同高顶到窗口顶；按钮盖在右上角；按空白、标题拖窗口，按钮上不起拖；空白处右键是“移动到”；标题按钮聚焦才显示；成了标签条时面板头回来，拿走后又自绘；宽版也一样", async ({page}) => {
    await openConversation(page);
    await newSession(page);
    await input(page).click();
    await page.keyboard.type("头搬家前写的字");
    const node = await page.locator(`[data-content="view:${CONVERSATION_VIEW}"]`).elementHandle();

    await panelHeadOf(page, CONVERSATION_VIEW).locator("[data-panel-action=\"nbook.view.float\"]").click();
    const chrome = page.locator("[data-float-chrome]");
    await expect(chrome).toHaveCount(1);
    const target = (await chrome.getAttribute("data-float-chrome"))!;
    const ownHead = page.locator(`[data-panel-head="${target}"][data-own-head]`);
    const agentHead = page.locator("[data-agent-head]");
    await expect(ownHead).toHaveCount(1);
    await expect(agentHead).toBeVisible();
    await expect(agentHead).toHaveAttribute("data-window-drag", "");
    await expect(page.locator(`[data-leaf="${target}"] [data-panel-head]`)).toHaveCount(0);
    // 鼠标操作之后程序把焦点放到标题按钮上（外壳还焦点、关“移动到”菜单都这样做）：它不冒出来压住视图的头，只有键盘聚焦才显示。
    const title = ownHead.locator("[data-panel-tab]");
    await title.evaluate((element) => element.focus());
    await expect(title).toBeFocused();
    await expect(title).toHaveCSS("opacity", "0");

    /** 窗口卡片、内容与第一行的几何。 */
    const rows = () => page.evaluate(({target, key}) => {
        const rect = (selector: string) => {
            const box = document.querySelector(selector)?.getBoundingClientRect();
            return box === undefined ? null : {top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height};
        };
        return {card: rect(`[data-shell-card="${target}"]`)!, content: rect(`[data-content="${key}"] [data-messages-host]`)!, head: rect("[data-agent-head]"), strip: rect("[data-messages-strip-head]"), switchRow: rect("[data-messages-list-panel] [data-messages-switch]"), layout: document.querySelector("[data-messages-layout]")?.getAttribute("data-messages-layout") ?? null};
    }, {target, key: `view:${CONVERSATION_VIEW}`});

    // 窄版：头像列顶上那一行与对话头同高 40、都顶到窗口顶，内容的上边就是卡片的上边。
    let geo = await rows();
    expect(geo.layout).toBe("narrow");
    expect(Math.abs(geo.content.top - geo.card.top)).toBeLessThan(1);
    expect(Math.abs(geo.head!.top - geo.card.top)).toBeLessThan(1);
    expect(Math.abs(geo.strip!.top - geo.card.top)).toBeLessThan(1);
    expect(Math.round(geo.head!.height)).toBe(40);
    expect(Math.round(geo.strip!.height)).toBe(40);
    // 上面两个角是窗口的圆角：角上那一点的各层里没有消息视图（最上面是窗口的缩放手柄，所以看全部各层，不只看最上面的）。
    const inCorner = (x: number, y: number) => page.evaluate(({x, y}) => document.elementsFromPoint(x, y).some((element) => element.closest("[data-messages-host]") !== null), {x, y});
    expect(await inCorner(geo.card.left + 1, geo.card.top + 1)).toBe(false);
    expect(await inCorner(geo.card.right - 1, geo.card.top + 1)).toBe(false);
    expect(await inCorner(geo.card.left + 20, geo.card.top + 20)).toBe(true);

    // “回到停靠”盖在右上角：悬停这块窗时看得见、点得到，对话头在右端让出了它的宽度。
    await page.mouse.move(geo.card.left + 100, geo.card.top + 150);
    const dock = ownHead.locator("[data-panel-action=\"nbook.view.dock\"]");
    const frameActions = ownHead.locator("[data-hover-actions=\"frame\"]");
    await expect(frameActions).toHaveCSS("opacity", "1");
    expect(await hitIn(page, await centerOf(page, `[data-panel-head="${target}"] [data-panel-action="nbook.view.dock"]`), "[data-panel-action=\"nbook.view.dock\"]")).toBe(true);
    const dockBox = (await dock.boundingBox())!;
    const headEnd = await agentHead.locator(".acv-head__end").boundingBox();
    expect(headEnd!.x + headEnd!.width).toBeLessThanOrEqual(dockBox.x);
    // 指针离开窗口、焦点也不在窗里：按钮淡出（焦点在窗里时照旧显示）。
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(geo.card.left - 40 > 0 ? geo.card.left - 40 : 5, 5);
    await expect(frameActions).toHaveCSS("opacity", "0");

    // 抽屉从对话头下面拉出，不盖住“回到停靠”。
    await page.locator("[data-messages-toggle]").click();
    const drawer = page.locator("[data-messages-list-panel]");
    await expect(drawer).toBeVisible();
    expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(geo.head!.bottom - 1);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();

    // 按住对话头的标题文字拖：整个窗跟着走。按住头像列的按钮拖：窗不动。
    // 后面把资源管理器拖出这个窗时松在空处，它自己成了一个窗：只量消息视图这一个。
    const windowAt = async () => (await page.locator(`[data-float-chrome="${target}"]`).boundingBox())!;
    const before = await windowAt();
    await dragBy(page, await centerOf(page, "[data-agent-head] [data-header-title]"), -60, 30);
    await expect.poll(async () => Math.round((await windowAt()).x - before.x)).toBe(-60);
    expect(Math.round((await windowAt()).y - before.y)).toBe(30);
    const moved = await windowAt();
    await dragBy(page, await centerOf(page, "[data-messages-toggle]"), 50, 40);
    await expect(page.locator("[data-workbench-dragging]")).toHaveCount(0);
    expect(await windowAt()).toEqual(moved);
    await page.keyboard.press("Escape");

    // 空白处右键是这个视图的“移动到”；标题文字上右键不开（留给浏览器）。
    geo = await rows();
    await page.mouse.click(geo.head!.left + 4, geo.head!.top + 20, {button: "right"});
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.locator("[data-agent-head] [data-header-title]").click({button: "right"});
    await expect(page.getByRole("menu")).toHaveCount(0);

    // 键盘：从视图里往回 Tab，先到“回到停靠”（焦点进了这一条，按钮显示），再到标题按钮：标题按钮平时不接指针，键盘聚焦时显示在左上角、点得到；
    // 它仍是拿起这个窗的入口，Enter 只激活、窄版也不开抽屉。
    const titleCenter = await centerOf(page, `[data-panel-head="${target}"] [data-panel-tab]`);
    expect(await hitIn(page, titleCenter, `[data-panel-head="${target}"] [data-panel-tab]`)).toBe(false);
    const focusedIs = (locator: typeof title) => locator.evaluate((element) => element === document.activeElement);
    await page.locator("[data-messages-toggle]").focus();
    for (let step = 0; step < 8 && !(await focusedIs(dock)); step += 1) await page.keyboard.press("Shift+Tab");
    await expect(dock).toBeFocused();
    await expect(frameActions).toHaveCSS("opacity", "1");
    for (let step = 0; step < 8 && !(await focusedIs(title)); step += 1) await page.keyboard.press("Shift+Tab");
    await expect(title).toBeFocused();
    await expect(title).toHaveCSS("opacity", "1");
    expect(await hitIn(page, titleCenter, `[data-panel-head="${target}"] [data-panel-tab]`)).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-messages-list-panel]")).toBeHidden();
    await expect(title).toBeFocused();
    // 空格拿起（出拖影），Esc 放下；菜单键开“移动到”。
    await page.keyboard.press("Space");
    await expect(page.locator("[data-workbench-drag-ghost]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-workbench-drag-ghost]")).toHaveCount(0);
    await title.focus();
    await title.press("ContextMenu");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await input(page).click();
    await expect(title).toHaveCSS("opacity", "0");

    // 资源管理器的分节拖到窗口顶上那一条：添加为标签，面板头回来、对话头回到普通画法（在内容里、在标签条下面）。
    const SESSIONS_VIEW = "nbook.explorer";
    geo = await rows();
    const from = (await page.locator(`[data-panel-tab="view:${SESSIONS_VIEW}"]`).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, {steps: 2});
    await expect(page.locator("[data-workbench-drag-ghost]")).toBeVisible();
    await page.mouse.move((geo.card.left + geo.card.right) / 2, geo.card.top + 20, {steps: 8});
    await page.mouse.up();
    await expect(page.locator("[data-workbench-drag-ghost]")).toHaveCount(0);
    await expect(panelHeadOf(page, CONVERSATION_VIEW).locator("[data-panel-tab]")).toHaveCount(2);
    await expect(ownHead).toHaveCount(0);
    await conversationHandle(page).click();
    await expect(agentHead).toBeVisible();
    await expect(agentHead).not.toHaveAttribute("data-window-drag", "");
    geo = await rows();
    expect(Math.round(geo.content.top - geo.card.top)).toBe(32);
    await expect(input(page)).toContainText("头搬家前写的字");
    expect(await page.locator(`[data-content="view:${CONVERSATION_VIEW}"]`).evaluate((element, other) => element === other, node)).toBe(true);
    // 头在内容里时列表照样开：头像列顶上的按钮开抽屉。
    await page.locator("[data-messages-toggle]").click();
    await expect(page.locator("[data-messages-list-panel]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-messages-list-panel]")).toBeHidden();

    // 把资源管理器拖走，窗里又只剩消息视图：又自绘头。
    const to = (await page.locator("[data-workbench-shell]").boundingBox())!;
    const tabBox = (await page.locator(`[data-panel-tab="view:${SESSIONS_VIEW}"]`).boundingBox())!;
    await page.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(tabBox.x + tabBox.width / 2 + 10, tabBox.y + tabBox.height / 2 + 10, {steps: 2});
    await expect(page.locator("[data-workbench-drag-ghost]")).toBeVisible();
    await page.mouse.move(to.x + 40, to.y + 12, {steps: 8});
    await page.mouse.up();
    await expect(page.locator("[data-workbench-drag-ghost]")).toHaveCount(0);
    await expect(ownHead).toHaveCount(1);
    await expect(agentHead).toHaveAttribute("data-window-drag", "");

    // 拉大到宽版：列表的切换行与对话头同一行、同高、顶到窗口顶；按切换行的空白拖窗口，按“会话”标签拖不动。
    const corner = await centerOf(page, `[data-float-chrome="${target}"] [data-float-handle="bottom-right"]`);
    await dragBy(page, corner, 360, 160);
    await expect(page.locator("[data-messages-layout]")).toHaveAttribute("data-messages-layout", "wide");
    geo = await rows();
    expect(Math.abs(geo.switchRow!.top - geo.card.top)).toBeLessThan(1);
    expect(Math.abs(geo.head!.top - geo.card.top)).toBeLessThan(1);
    expect(Math.round(geo.switchRow!.height)).toBe(40);
    expect(Math.round(geo.head!.height)).toBe(40);
    const wideBefore = await windowAt();
    const tabs = (await page.locator("[data-messages-list-panel] [role=\"tablist\"]").boundingBox())!;
    const sessionsTab = (await page.locator("[data-messages-tab=\"sessions\"]").boundingBox())!;
    await dragBy(page, {x: sessionsTab.x + sessionsTab.width / 2, y: sessionsTab.y + sessionsTab.height / 2}, 40, 20);
    expect(await windowAt()).toEqual(wideBefore);
    await dragBy(page, {x: sessionsTab.x + sessionsTab.width + 12, y: tabs.y + tabs.height / 2}, 40, 20);
    await expect.poll(async () => Math.round((await windowAt()).x - wideBefore.x)).toBe(40);
    await expect(input(page)).toContainText("头搬家前写的字");

    // 点“回到停靠”：窗没了，视图回到停靠位，面板头照常画、对话头不再是拖动区。
    geo = await rows();
    await page.mouse.move(geo.card.left + 200, geo.card.top + 200);
    const dockAt = await centerOf(page, `[data-panel-head="${target}"] [data-panel-action="nbook.view.dock"]`);
    expect(await hitIn(page, dockAt, "[data-panel-action=\"nbook.view.dock\"]")).toBe(true);
    await page.mouse.click(dockAt.x, dockAt.y);
    await expect(page.locator(`[data-float-chrome="${target}"]`)).toHaveCount(0);
    await expect(page.locator("[data-own-head]")).toHaveCount(0);
    await expect(agentHead).not.toHaveAttribute("data-window-drag", "");
    await expect(input(page)).toContainText("头搬家前写的字");
});

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

test("第一屏：没有消息时是欢迎、最近对话与主创的开场指令；点一条指令，输入框里是它（conversation.md 输出 41）", async ({page}) => {
    await script("回复。");
    await openConversation(page);
    await newSession(page);
    await send(page, "先聊一句");
    await expect(page.getByText("回复。")).toBeVisible();
    await newSession(page);
    const welcome = page.locator("[data-agent-welcome]");
    await expect(welcome.getByRole("heading", {name: "NeuroBook 创作工作区"})).toBeVisible();
    // 刚才那段会话出现在最近对话里（标题可能还没生成，按条数看）。
    await expect(welcome.locator("[data-welcome-session]").first()).toBeVisible();
    const starters = welcome.locator("[data-welcome-starter]");
    await expect(starters).toHaveCount(3);
    const text = (await starters.nth(1).innerText()).trim();
    await starters.nth(1).click();
    await expect(input(page)).toContainText(text);
    await expect(input(page)).toBeFocused();
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

/** 运行中 Ctrl 加回车排一条（排到这一轮之后）。 */
async function queue(page: Page, text: string): Promise<void> {
    await input(page).click();
    await page.keyboard.type(text);
    await page.keyboard.press("Control+Enter");
}

const queuedHead = (page: Page) => page.locator("[data-queued-head]");

test("验收 5：服务端在运行中重启：重新加载后回到这个会话，显示中断的样子，排着的话显示已暂停；回车先接着跑中断的那一轮，再发出排着的话", async ({page}) => {
    await openConversation(page);
    await newSession(page);
    await control("/hold");
    await script("不会看到这条");
    await send(page, "写一章");
    await control("/hold/arrived");
    await expect(page.locator("[data-status-phase]")).toBeVisible();
    await queue(page, "再加一段");
    await expect(page.locator("li[data-queued]")).toHaveCount(1);
    const port = Number(new URL(server.url).port);
    expect(await server.stop()).toBe(0);
    server = await startProductServer(stateRoot, port);
    await control("/hold/release");
    await page.reload();
    await expect(page.getByText("写一章", {exact: true})).toBeVisible();
    const resume = page.locator("[data-composer-action='resume']");
    await expect(resume).toBeVisible();
    await expect(queuedHead(page)).toContainText("已暂停 1 条");
    await expect(input(page).locator("[data-placeholder]").first()).toHaveAttribute("data-placeholder", /上次运行已中断，排队的话已暂停/u);
    // 接着跑的那次挂住：放行排着的话（第二步）时运行还在跑，排着的话进这次运行。
    await control("/hold");
    await script("接着写完了", "这一段也加好了");
    await input(page).click();
    await page.keyboard.press("Enter");
    await control("/hold/arrived");
    // 放行之后排着的话是就绪的，等这一轮结束被取走。
    await expect(queuedHead(page)).toHaveCount(0);
    await expect(page.locator("li[data-queued][data-held='true']")).toHaveCount(0);
    await control("/hold/release");
    await expect(page.getByText("接着写完了")).toBeVisible();
    await expect(page.getByText("这一段也加好了")).toBeVisible();
    await expect(page.locator("li[data-queued]")).toHaveCount(0);
    await expect(resume).toHaveCount(0);
});

test("验收 8：运行中排两条、点停止，两条显示已暂停；写一句回车，合成的一条先跑；停止键旁的箭头“停止并清空排队”清掉排着的话", async ({page}) => {
    await openConversation(page);
    await newSession(page);
    await control("/hold");
    await script("不会看到这条");
    await send(page, "开始");
    await control("/hold/arrived");
    await queue(page, "排一");
    await queue(page, "排二");
    await expect(page.locator("li[data-queued]")).toHaveCount(2);
    await page.locator("[data-composer-action='stop']").click();
    await control("/hold/release");
    await expect(queuedHead(page)).toContainText("已暂停 2 条");
    await expect(queuedHead(page)).toContainText("你停止了这一轮");
    await expect(page.locator("li[data-queued][data-held='true']")).toHaveCount(2);

    await script("三句一起处理了");
    await send(page, "新的一句");
    await expect(page.getByText("三句一起处理了")).toBeVisible();
    // 继续的几步之间只挡发送，输入框不失焦（interaction.continuing）。
    await expect(input(page)).toBeFocused();
    await expect(page.locator("li[data-queued]")).toHaveCount(0);
    const merged = await requests();
    expect(JSON.stringify(merged.at(-1)?.messages)).toContain("排一\\n\\n排二\\n\\n新的一句");

    await control("/hold");
    await script("不会看到这条");
    await send(page, "再来");
    await control("/hold/arrived");
    await queue(page, "要清掉的");
    await expect(page.locator("li[data-queued]")).toHaveCount(1);
    await page.locator("[data-composer-action='stop-more']").click();
    await page.getByRole("menuitem", {name: "停止并清空排队（1 条）"}).click();
    await expect(input(page)).toBeFocused();
    await control("/hold/release");
    await expect(page.locator("[data-composer-action='stop']")).toHaveCount(0);
    await expect(page.locator("li[data-queued]")).toHaveCount(0);
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

test("状态栏可自定义（conversation.md 输出 45、46）：右键勾选模型、“状态栏设置…”打开设置页，把模型上移到最前后顺序变，刷新还在", async ({page}) => {
    await script("好的。");
    await openConversation(page);
    await send(page, "先说一句");
    // 设置页的预览里也有一条状态栏：这里只取对话自己的那条。
    const status = page.locator("[data-agent-status]:not([data-status-line-preview] *)");
    const rightOrder = () => status.locator("[data-status-right] [data-status-item]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-status-item")));
    // 本机端点没有单价，费用项不画（有数据才画）：右边只有用量。
    await expect.poll(rightOrder).toEqual(["usage"]);
    await expect(status.locator("[data-status-model]")).toHaveCount(0);

    // 右键勾选：模型出现在右边最后。
    await status.click({button: "right", position: {x: 20, y: 10}});
    await page.getByRole("menuitemcheckbox", {name: "模型与推理档"}).click();
    await expect.poll(rightOrder).toEqual(["usage", "model"]);

    // 菜单最后一项打开设置，落在“状态栏”页；把“模型”上移两次到最前（设置页列全部项，含这里没有数据的费用）。
    await status.click({button: "right", position: {x: 20, y: 10}});
    await page.getByRole("menuitem", {name: "状态栏设置…"}).click();
    const settingsPage = page.locator("[data-status-line-page]");
    await expect(settingsPage).toBeVisible();
    const rows = () => settingsPage.locator("[data-sortable-section='right'] [data-status-row]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-status-row")));
    await expect.poll(rows).toEqual(["usage", "cost", "model"]);
    await settingsPage.locator("[data-status-row='model'] [data-status-move-up]").click();
    await expect.poll(rows).toEqual(["usage", "model", "cost"]);
    await settingsPage.locator("[data-status-row='model'] [data-status-move-up]").click();
    await expect.poll(rows).toEqual(["model", "usage", "cost"]);
    await expect.poll(rightOrder).toEqual(["model", "usage"]);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-settings-window]")).toHaveCount(0);

    // 设置存在用户层：刷新后还是这样。
    await page.reload();
    await expect(page.locator("[data-agent-status] [data-status-right]")).toBeVisible();
    await expect.poll(rightOrder).toEqual(["model", "usage"]);
});

test("模型选择器：面板与输入框同宽；选没绑定的角色出提示卡，“去绑定”打开角色页、焦点在这个角色上；绑定之后不刷新页面就恢复；状态栏窄时用量照样可见", async ({page}, testInfo) => {
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
    // 提示卡写出角色（conversation.md 输出 42），占位也是它。
    const card = page.locator("[data-notice-card]");
    await expect(card).toContainText("“深度”角色还没绑定模型");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(picker).toBeEnabled();
    await page.screenshot({path: testInfo.outputPath("notice-card.png")});

    // “去绑定”：设置窗口开在角色页，焦点落在“深度”这一行的模型下拉上（settings-pages.md 输出 18）。
    await card.locator("[data-availability-action='bind-role']").click();
    const settingsWindow = page.locator("[data-settings-window]");
    await expect(settingsWindow).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[data-role-row]")?.getAttribute("data-role-row") ?? null)).toBe("deep");
    await page.keyboard.press("Escape");
    await expect(settingsWindow).toHaveCount(0);

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

    await page.locator("[data-header-more]").click();
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

    await page.locator("[data-header-more]").click();
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
    await expect(page.locator("[data-header-title]")).toHaveText("雨夜");

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
    await expect(page.locator("[data-agent-welcome]")).toBeVisible();
    await expect(input(page)).not.toContainText("没写完的字");
    // 头写在面板头上（输出 44）：按面板头的标题开列表抽屉，会话一页里选。
    await conversationHandle(page).click();
    await page.locator("[data-messages-list-panel] [data-panel-row]", {hasText: "雨夜"}).click();
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
    await expect(page.locator("[data-agent-welcome]")).toBeVisible();
    await expect(input(page)).not.toContainText("/new");
});

/** 1×1 的 PNG。 */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("附件：选图片上传，消息里显示；模型不能看图时请求里换成一行字；读取路由给图，带脚本的 SVG 进沙箱、超限被拒", async ({page}, testInfo) => {
    await script("收到图了");
    await openConversation(page);
    await newSession(page);
    await page.locator("[data-composer-action='plus']").waitFor();
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
    // 模式只看工具栏的控件，状态栏不另标（modes.md 输出 13）。
    await expect(page.locator("[data-agent-status]")).not.toContainText("计划");
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
    const seen = JSON.stringify((await requests()).map((request) => request.messages));
    expect(seen).toContain("现在是计划模式");
    expect(seen).toContain("mode-blocked");

    await page.getByRole("textbox", {name: "消息输入框"}).click();
    await page.keyboard.press("Shift+Tab");
    await expect(mode).toContainText("讨论");
});

test("权限规则：以后都允许写进用户规则；设置页列出我的规则与这本书的规则，能删", async ({page}) => {
    const rulesFile = join(projectDir, ".nbook/permissions.json");
    await writeFile(rulesFile, JSON.stringify([{tool: "nbook.agent.shell", when: {type: "command", pattern: "git push *"}, action: "deny", reason: "先问我"}, {tool: "nbook.agent.write", action: "allow"}]));
    try {
        await openConversation(page);
        await newSession(page);
        // 同一批里两条：同一拍追加，两条都要存下。
        await script({tools: [{tool: "shell", args: {command: "mkdir 新目录"}}, {tool: "shell", args: {command: "touch 新目录/一"}}]}, "建好了");
        await send(page, "建个目录");
        await page.locator('[data-approval-decision="allow-always"]').click();
        await page.locator('[data-approval-decision="allow-always"]').click();
        await page.locator("[data-approval-submit]").click();
        await expect(page.getByText("建好了")).toBeVisible();
        const file = join(stateRoot, "settings.json");
        const remembered = ["mkdir *", "touch *"].map((pattern) => ({tool: "nbook.agent.shell", when: {type: "command", pattern}, action: "allow"}));
        await expect.poll(async () => (JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>)["nbook.agent/permissionRules"]).toEqual(remembered);

        await page.locator("[data-activity-item='nbook.settings']").click();
        await page.locator("[data-settings-nav='nbook.agent.permissions']").click();
        const rules = page.locator("[data-permission-rule]");
        await expect(rules).toHaveCount(2);
        await expect(rules.first()).toContainText("mkdir *");
        const project = page.locator("[data-permission-project]");
        await expect(project).toContainText("git push *");
        await expect(project).toContainText("先问我");
        // 项目层的放行不生效，页面要写明。
        await expect(project.locator(".is-ignored")).toHaveCount(1);

        // 连点两下：第二下在第一下的结果上算。
        const removeFirst = rules.first().getByRole("button", {name: "删除"});
        await removeFirst.click();
        await rules.first().getByRole("button", {name: "删除"}).click();
        await expect(rules).toHaveCount(0);
        await expect.poll(async () => (JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>)["nbook.agent/permissionRules"] ?? []).toEqual([]);
    } finally {
        await rm(rulesFile, {force: true});
    }
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

/** 摘要行（整轮、思维链）还没展开就点开；展开状态会被记住，重复点会收起。 */
async function expand(summary: ReturnType<Page["locator"]>): Promise<void> {
    if ((await summary.getAttribute("aria-expanded")) !== "true") await summary.click();
    await expect(summary).toHaveAttribute("aria-expanded", "true");
}

test("eval（eval.md 验收 2；agent-conversation-view“有子调用的调用”）：代码里调的写工具要批准，向导写明是 eval 里的调用；批准一次、拒绝一次，卡片运行中写已调用几次，结束后写读改了几个文件，改了的与被拒的两次露在卡片下；点开看得到输出", async ({page}) => {
    await openConversation(page);
    await newSession(page);
    const code = [
        "await tool.read({path: 'project://正文/第三章.md'});",
        "await tool.edit({path: 'project://正文/第三章.md', old_string: '巷口的灯灭了。', new_string: '巷口的灯还亮着。'});",
        "let second = '第二处改了';",
        "try { await tool.edit({path: 'project://正文/第三章.md', old_string: '雨越下越大。', new_string: '雨停了。'}); } catch (error) { second = `第二处没改：${error.code}`; }",
        "second",
    ].join("\n");
    await script({tool: "eval", args: {title: "改第三章的结尾", code}}, "代码跑完了");
    await send(page, "用代码改第三章");
    const wizard = page.locator("[data-agent-wizard]");
    const title = wizard.locator(".acv-wizard-frame__title");
    // eval 自己是执行档：先批准它，再处理代码里调的两次 edit（读是放行的）。
    await expect(title).toHaveText("调用工具 eval");
    await wizard.locator("[data-approval-decision='allow']").click();
    await expect(title).toHaveText("eval 里的调用：修改文件");
    await expect(wizard.locator("ins").first()).toContainText("还亮着");

    await expand(page.locator("[data-chain-summary]").last());
    const card = page.locator(".nb-collapsible-card").filter({hasText: "运行代码"});
    await expect(card).toContainText("已调用 2 次 · 编辑 project://正文/第三章.md");
    await wizard.locator("[data-approval-decision='allow']").click();
    // diff 逐字高亮：“雨越下越大”改成“雨停了”，标成新增的只有“停了”。
    await expect(wizard.locator("ins").first()).toContainText("停了");
    await expect(title).toHaveText("eval 里的调用：修改文件");
    await wizard.locator("[data-approval-decision='deny']").click();
    await expect(page.getByText("代码跑完了")).toBeVisible();
    const chapter = await readFile(join(projectDir, "正文/第三章.md"), "utf8");
    expect(chapter).toContain("巷口的灯还亮着。");
    expect(chapter).toContain("雨越下越大。");

    // 一轮结束后整轮收起：点开整轮与思维链再看卡片。
    await expand(page.locator("[data-turn-summary]").last());
    await expand(page.locator("[data-chain-summary]").last());
    await expect(card).toContainText("调用了 3 次工具 · 读了 1 个文件，改了 1 个");
    const rows = page.locator("[data-card-child]");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText("已被你拒绝");
    await card.locator("button").first().click();
    await expect(card.locator("[data-eval-output]")).toContainText("第二处没改：");
});
