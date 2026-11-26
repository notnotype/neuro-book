/**
 * 消息视图与书房里 bot 的验收（docs/specs/bots/view.md 验收 1–4）：生产构建的后端与前端，状态根是全新的（首次启动建出星璃），
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

/** 右栏的消息视图：聊天区加借给右轨的视图段（收着时是 bot 头像列，对话的头在面板头上）。 */
const MESSAGES = "nbook.agent.conversation";
const contact = (page: Page) => page.locator("[data-rail=\"auxiliarybar\"] [data-strip-contact='nbook.bots/lyra']");
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

test("验收 3：窗口没有焦点时到的回复记为未读：头像列写计数，状态栏写新消息；窗口拿回焦点后两处都清零", async ({page}) => {
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
    // 没有可写的时这一条不画：按“含新消息的条目”数，不按条目在不在。
    await expect(page.locator("[data-workbench-item='nbook.agent.activity']", {hasText: "新消息"})).toHaveCount(0);
});

/** 未读线后面紧跟的那一轮的文字：线画在含第一条未读回复的那一轮之前（agent/conversation.md 输出 55）。 */
const afterUnreadLine = (scope: ReturnType<Page["locator"]>) => scope.locator("[data-unread-divider]").evaluate((line) => line.nextElementSibling?.textContent ?? "");

test("验收 2：未读线只标打开时就未读的回复：失焦时到的这次不画，切走再回来画在那一轮前、第一轮前有“今天”；拿回焦点后角标清零线还在，看着时到的不多画", async ({page}) => {
    await openBot(page);
    await expect(contact(page)).toHaveAttribute("aria-label", "星璃");
    // 看着时说的一句：之后单独跑这一条时会话里也有消息。
    await script("在的。");
    await send(page, "你好");
    await expect(chat(page).getByText("在的。")).toBeVisible();
    await expect(chat(page).locator("[data-day-divider]").first()).toHaveText("今天");
    await expect(chat(page).locator("[data-unread-divider]")).toHaveCount(0);

    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await script("你先忙，回来再看。");
    await send(page, "我去改稿");
    await expect(chat(page).getByText("你先忙，回来再看。")).toBeVisible();
    await expect(contact(page)).toHaveAttribute("aria-label", "星璃，1 条未读");
    // 开着时到的不画线：线在这次打开时就定了。
    await expect(chat(page).locator("[data-unread-divider]")).toHaveCount(0);

    // 切到一个普通会话再点回她：这是又一次打开。普通会话里没有线。
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("新建 Agent 会话");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-agent-welcome]")).toBeVisible();
    await expect(chat(page).locator("[data-day-divider]")).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await contact(page).click();
    await expect(chat(page).getByText("你先忙，回来再看。")).toBeVisible();
    await expect(chat(page).locator("[data-unread-divider]")).toHaveText("以下是新消息");
    expect(await afterUnreadLine(chat(page))).toContain("你先忙，回来再看。");
    await expect(contact(page)).toHaveAttribute("aria-label", "星璃");
    await expect(chat(page).locator("[data-unread-divider]")).toHaveCount(1);

    await script("好的，我在。");
    await send(page, "回来了");
    await expect(chat(page).getByText("好的，我在。")).toBeVisible();
    await expect(chat(page).locator("[data-unread-divider]")).toHaveCount(1);
    expect(await afterUnreadLine(chat(page))).toContain("你先忙，回来再看。");
});

/** 1×1 的 PNG：书房的面板里发附件用。 */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

/** 书房（`/`，没有绑定作品）案头的看板娘与从右边滑出的面板（agent/conversation.md 输出 54）。 */
const mascot = (page: Page) => page.locator("[data-desk-companion-button]");
const panel = (page: Page) => page.getByRole("dialog", {name: "星璃"});
const deskInput = (page: Page) => panel(page).getByRole("textbox", {name: "消息输入框"});

async function openShelf(page: Page): Promise<void> {
    // 作者界面的宽版：内容列居中、看板娘在案头右端。
    await page.setViewportSize({width: 1440, height: 900});
    await page.goto(new URL("/", server.url).href);
    await expect(page.locator("[data-shelf-desk]")).toBeVisible();
}

async function deskSend(page: Page, text: string): Promise<void> {
    await deskInput(page).click();
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
}

test("验收 4：书房里点看板娘，右边滑出她的主对话、书房不压暗；看着时到的回复不算未读，失焦时到的算：关上后看板娘带计数与那句话，拿回焦点再打开清零", async ({page}) => {
    await openShelf(page);
    // 前面的用例都看过了：从没有未读开始。
    await expect(mascot(page)).toHaveAttribute("aria-label", "星璃");
    await expect(page.locator("[data-desk-badge]")).toHaveCount(0);
    await mascot(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).locator("[data-header-title]")).toHaveText("星璃");
    await expect(deskInput(page)).toBeFocused();
    // 不压暗：没有遮罩，书架左边点得到的还是书架。
    const shelfPoint = await page.evaluate(() => (document.elementFromPoint(200, 450)?.closest("[data-bookshelf-page]") ?? null) !== null);
    expect(shelfPoint).toBe(true);

    await script("书房里也能聊。");
    await deskSend(page, "你好");
    await expect(panel(page).getByText("书房里也能聊。")).toBeVisible();

    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await script("你回书架了吗？");
    await deskSend(page, "回头见");
    await expect(panel(page).getByText("你回书架了吗？")).toBeVisible();
    // 看着时到的那句已交“看到”：只多出失焦时到的这一句。
    await expect(mascot(page)).toHaveAttribute("aria-label", "星璃，1 条未读");

    // 输入框里按 Esc 关面板，焦点回到看板娘；角标与气泡露出来。
    await deskInput(page).click();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await expect(mascot(page)).toBeFocused();
    await expect(page.locator("[data-desk-badge]")).toHaveText("1");
    await expect(page.locator("[data-desk-bubble]")).toContainText("你回书架了吗？");
    // 案头窄于 720px（看板娘缩到 96px）：气泡放不下，只留角标。
    await page.setViewportSize({width: 700, height: 900});
    await expect(page.locator("[data-desk-bubble]")).toBeHidden();
    await expect(page.locator("[data-desk-badge]")).toHaveText("1");
    await page.setViewportSize({width: 1440, height: 900});
    await expect(page.locator("[data-desk-bubble]")).toBeVisible();

    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await mascot(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(mascot(page)).toHaveAttribute("aria-label", "星璃");
    // 面板每打开一次重新定未读线：关着时没看到的那句前面有线（agent/conversation.md 输出 55）。
    await expect(panel(page).locator("[data-unread-divider]")).toHaveCount(1);
    expect(await afterUnreadLine(panel(page))).toContain("你回书架了吗？");
    await panel(page).locator("[data-header-close]").click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator("[data-desk-badge]")).toHaveCount(0);
    // 再打开：都看过了，没有线。
    await mascot(page).click();
    await expect(panel(page).getByText("你回书架了吗？")).toBeVisible();
    await expect(panel(page).locator("[data-day-divider]").first()).toBeVisible();
    await expect(panel(page).locator("[data-unread-divider]")).toHaveCount(0);
    await panel(page).locator("[data-header-close]").click();
    await expect(panel(page)).toHaveCount(0);
});

test("验收 4：书房的面板里（没有作品）发附件、@ 菜单压在面板上、文字能拖选", async ({page}) => {
    await openShelf(page);
    await mascot(page).click();
    await expect(deskInput(page)).toBeFocused();

    await script("收到图了");
    await panel(page).locator(".acv-composer__file-input").setInputFiles({name: "封面.png", mimeType: "image/png", buffer: PNG});
    await expect(panel(page).getByRole("list", {name: "附件"}).getByRole("listitem")).toHaveCount(1);
    await deskSend(page, "看这张");
    const reply = panel(page).getByText("收到图了");
    await expect(reply).toBeVisible();

    // 拖选回复里的字：面板没有拖动手势，选区里有字。
    const box = (await reply.boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, {steps: 5});
    await page.mouse.up();
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toContain("收到图");
    await expect(panel(page)).toBeVisible();

    // @ 菜单是页面浮层档，压在面板（侧面板档）上：菜单中心点命中的是菜单。
    await deskInput(page).click();
    await page.keyboard.type("@");
    const menu = page.locator("[data-suggestion-menu]");
    await expect(menu).toBeVisible();
    // 菜单在面板的范围里（不然命中菜单说明不了它压在面板上）。
    const panelLeft = await panel(page).evaluate((node) => node.getBoundingClientRect().left);
    expect((await menu.boundingBox())!.x).toBeGreaterThanOrEqual(panelLeft);
    const hit = await menu.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    });
    expect(hit).toBe(true);
    // 菜单开着时 Esc 只收菜单，面板还在。
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(panel(page)).toBeVisible();
});

test("验收 4：桌面窗口外框下，面板让出窗口按钮那一行：头上的“关闭”在 36px 之下", async ({page}) => {
    // 只设外框的属性（不装壳的能力标记，免得首次启动向导挡住）：面板的上沿取 `--nb-side-panel-inset-top`。
    await page.addInitScript(() => {
        const mark = (): boolean => document.documentElement !== null && (document.documentElement.setAttribute("data-desktop-frame", ""), true);
        if (!mark()) {
            const observer = new MutationObserver(() => void (mark() && observer.disconnect()));
            observer.observe(document, {childList: true});
        }
    });
    await openShelf(page);
    await mascot(page).click();
    const close = panel(page).locator("[data-header-close]");
    await expect(close).toBeVisible();
    const top = await panel(page).evaluate((node) => node.getBoundingClientRect().top);
    expect(top).toBe(36);
    expect((await close.boundingBox())!.y).toBeGreaterThanOrEqual(36);
});
