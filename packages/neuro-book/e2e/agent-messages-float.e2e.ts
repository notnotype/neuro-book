/**
 * 消息视图在浮动窗里的验收（docs/specs/ui/workbench-layout.md 输出 51 与验收 37，docs/specs/workbench/views.md 输出 19、21，
 * docs/specs/agent/conversation.md 输出 57“浮动”）：生产构建的 e2e 测试外壳与宿主测试入口，右栏是产品的消息视图
 * （`nbook.agent.conversation`）加测试插件 `test.sample-views` 的样例丁，所以“右栏只有消息”与“右栏还有别的容器”两种都造得出。
 *
 * 只按元素标记约定定位（`.agents/works/w00043-neurobot/tasks/t19-messages-view-ui-polish/plan.md` 的“测试分工”），不读业务代码：
 * 窗是 `[data-float-chrome]`，视图段在 `[data-float-rail]` 里，“回到停靠”是 `[data-panel-action="nbook.view.dock"]`（宿主画、不在视图段之内）。
 * 等页面上可观察的变化，不按时长等待；默认减少动效，量几何的用例看到的是终点，测过渡的用例自己开回来。
 */

import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Locator, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {SAMPLE_VIEWS_RUN_EVENT} from "nbook/shared/testing/sample-views-contract";

import {startProbeServer} from "./fixtures";
import type {ProbeServer} from "./fixtures";
import {boxOf, centerOf, layoutWrites, rail, railEntryOfView, savedDoc, sectionOf, settledWrites} from "./support/side-rail";

const CONVERSATION = "nbook.agent.conversation";
const D = "test.sample-views.delta";
/** 视图段缺省展开宽 260 与收着的 48 之差（视图段声明：缺省 260，200–420）。 */
const GROWTH = 260 - 48;

let tmp = "";
let server: ProbeServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "agent-messages-float");
    await mkdir(join(tmp, "state"), {recursive: true});
    // 同 workbench-side-rail：样例插件自己贡献编辑区的内容，和产品的编辑器只能留一个；canon 与剧情插件会改变按样例插件假定的容器。
    server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views,test.project-view", NBOOK_EXCLUDE_PLUGINS: "nbook.editor,nbook.canon,nbook.plot"}});
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

// 作者界面的宽版：右栏展开到 260 之后编辑区与聊天区都放得下。
test.use({viewport: {width: 1440, height: 900}});

const database = (): string => join(tmp, "state", "storage", "user.sqlite");
const saved = (page: Page) => savedDoc(page, database());

const chromeOf = (page: Page, id: string): Locator => page.locator(`[data-float-chrome="${id}"]`);
const segment = (page: Page): Locator => page.locator("[data-float-rail] [data-messages-segment]");
const dockButton = (page: Page, id: string): Locator => page.locator(`[data-panel-head="${id}"] [data-panel-action="nbook.view.dock"]`);
const toggle = (page: Page): Locator => page.locator("[data-messages-segment-toggle]");
const railHandle = (page: Page): Locator => page.locator("[data-float-rail-handle]");
const agentHead = (page: Page): Locator => page.locator("[data-agent-head]");
const editorCard = (page: Page): Locator => page.locator('[data-shell-card="g0"]');
const botPage = (page: Page): Locator => page.locator("[data-messages-page=bot]");
const sessionsPage = (page: Page): Locator => page.locator("[data-messages-page=sessions]");
const botSearch = (page: Page): Locator => botPage(page).getByRole("textbox");
const sessionsSearch = (page: Page): Locator => sessionsPage(page).locator("[data-panel-search]");
const openButton = (page: Page, tab: "bot" | "sessions"): Locator => page.locator(`[data-messages-open="${tab}"]`);
const regionToggle = (page: Page): Locator => page.locator('[data-titlebar-layout="auxiliarybar"]');

/** 页面上经测试外壳执行一条命令：不碰指针与焦点。 */
const runCommand = (page: Page, command: string, args: Readonly<Record<string, unknown>>): Promise<void> => page.evaluate(
    ({name, detail}) => void window.dispatchEvent(new CustomEvent(name, {detail})),
    {name: SAMPLE_VIEWS_RUN_EVENT, detail: {command, args}},
);

/** 每个用例一个新的浏览器上下文：客户端身份不同，布局记录互不影响。 */
async function open(page: Page): Promise<void> {
    await page.goto(new URL("/workbench", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
    await expect(rail(page).locator('[data-rail-segment="main"] [data-messages-segment]')).toBeVisible();
}

/** 把消息视图浮成窗：等窗开出来、视图段画到窗的右边缘，返回窗的面板 id。 */
async function floatConversation(page: Page): Promise<string> {
    const before = await page.locator("[data-float-chrome]").count();
    await runCommand(page, "nbook.view.float", {tab: `view:${CONVERSATION}`});
    await expect(page.locator("[data-float-chrome]")).toHaveCount(before + 1);
    await expect(segment(page)).toHaveCount(1);
    return sectionOf(page, CONVERSATION);
}

/** 窗在页面上的矩形（呈现矩形：展开时包含展开多出的那段）。 */
const windowBox = (page: Page, id: string) => boxOf(chromeOf(page, id));

/** 保存的记录里第一扇窗的矩形与展开意图。 */
async function floatRecord(page: Page): Promise<{rect: unknown; rail: unknown}> {
    const float = (await saved(page))?.floats[0];
    return {rect: float?.rect, rail: float?.rail};
}

/** 这一点上最上面的元素在不在 `selector` 里：判断“没被盖住”，不靠 click（Playwright 会先滚进裁切它的容器再点）。 */
const hitIn = (page: Page, at: {x: number; y: number}, selector: string): Promise<boolean> =>
    page.evaluate(({at, selector}) => document.elementFromPoint(at.x, at.y)?.closest(selector) != null, {at, selector});

/** 指针拖一段：按下、过起拖门槛、再走到终点松开。 */
async function dragBy(page: Page, from: {x: number; y: number}, dx: number, dy: number): Promise<void> {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx / 4, from.y + dy / 4, {steps: 2});
    await page.mouse.move(from.x + dx, from.y + dy, {steps: 6});
    await page.mouse.up();
}

/** 几何相同（容差 1 像素）。 */
const expectSameBox = (actual: {x: number; y: number; width: number; height: number}, expected: {x: number; y: number; width: number; height: number}, where: string): void => {
    for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(actual[key] - expected[key]), `${where}：${key}`).toBeLessThanOrEqual(1);
};

/** 点展开按钮并等它按下；展开按钮是视图自己画的，不是侧轨的。 */
async function expand(page: Page): Promise<void> {
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
}

async function collapse(page: Page): Promise<void> {
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
}

// 覆盖 ui/workbench-layout 输出 51“顶格”、views 输出 19“自绘头”：窗右上角那一格只放宿主画的“回到停靠”，不在视图段之内，没被视图段或聊天头盖住；聊天头的内容都在它左边。
test("顶格：“回到停靠”在窗右上角那一格、最上面一层，不在视图段里；视图段在它下面，聊天头整个在它左边（输出 51）", async ({page}) => {
    await open(page);
    const id = await floatConversation(page);
    const dock = dockButton(page, id);
    await expect(dock).toHaveCount(1);
    const [win, button] = [await windowBox(page, id), await boxOf(dock)];
    const edge = await boxOf(page.locator("[data-float-rail]"));
    // 在右上角那一格：贯通窗宽的头那一行（高与自绘头同高 40）里、视图段那一列（收着时宽 48）里。
    expect(button.y + button.height).toBeLessThanOrEqual(win.y + 40);
    expect(button.x).toBeGreaterThanOrEqual(edge.x);
    expect(button.x + button.width).toBeLessThanOrEqual(win.x + win.width);
    // 没被盖住：这一点上最上面的就是它；它也不是视图段的一部分。
    const center = await centerOf(dock);
    expect(await hitIn(page, center, '[data-panel-action="nbook.view.dock"]')).toBe(true);
    expect(await dock.evaluate((element) => element.closest("[data-float-rail]") !== null)).toBe(false);
    // 对照：视图段按钮的中心点上最上面的不是它，判断不会空过。
    expect(await hitIn(page, await centerOf(toggle(page)), '[data-panel-action="nbook.view.dock"]')).toBe(false);
    // 视图段在它下面；聊天头的每个元素都在它左边，右端不为框架按钮留位之外还让给它。
    expect((await boxOf(segment(page))).y).toBeGreaterThanOrEqual(button.y + button.height);
    const headRight = await agentHead(page).evaluate((head) => Math.max(...[head, ...head.querySelectorAll("*")].map((element) => element.getBoundingClientRect().right)));
    expect(headRight).toBeLessThanOrEqual(button.x + 0.5);
    // 悬停写出去向。
    expect((await dock.getAttribute("aria-label")) ?? (await dock.getAttribute("title")) ?? "").not.toBe("");
});

// 覆盖 ui/workbench-layout 输出 51“矩形”：点视图段底下的展开按钮，窗的右边往右长（展开多出的那段）、左边与上下不动；收起后矩形回到展开前；记录矩形展开前后不改。
test("展开与收起：窗的右边往右长 212、左边与上下不动，收起后回到展开前（容差 1 像素），记录矩形不变；展开、收起、停靠、再浮出不漂移（输出 51）", async ({page}) => {
    await open(page);
    const id = await floatConversation(page);
    const before = await windowBox(page, id);
    await expect(toggle(page)).toHaveAccessibleName("展开");
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect.poll(async () => (await floatRecord(page)).rect).toBeDefined();
    const recorded = await floatRecord(page);

    await expand(page);
    await expect.poll(async () => Math.round((await windowBox(page, id)).width)).toBe(Math.round(before.width + GROWTH));
    const wide = await windowBox(page, id);
    expect(Math.abs(wide.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(wide.y - before.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(wide.height - before.height)).toBeLessThanOrEqual(1);
    // 展开的是视图段那一列：右边长了，视图段变宽到 260。
    expect(Math.round((await boxOf(page.locator("[data-float-rail]"))).width)).toBe(260);
    await expect.poll(async () => (await floatRecord(page)).rail).toMatchObject({expanded: true});
    expect((await floatRecord(page)).rect).toEqual(recorded.rect);

    await collapse(page);
    await expect.poll(async () => Math.round((await windowBox(page, id)).width)).toBe(Math.round(before.width));
    expectSameBox(await windowBox(page, id), before, "收起之后");
    await expect.poll(async () => (await floatRecord(page)).rail ?? {}).not.toMatchObject({expanded: true});
    expect((await floatRecord(page)).rect).toEqual(recorded.rect);

    // 多来几轮、再停靠与浮出：矩形都不漂移。
    for (let round = 0; round < 3; round += 1) {
        await expand(page);
        await collapse(page);
    }
    expectSameBox(await windowBox(page, id), before, "三轮展开收起之后");
    expect((await floatRecord(page)).rect).toEqual(recorded.rect);
    await expand(page);
    await dockButton(page, id).click();
    await expect(page.locator("[data-float-chrome]")).toHaveCount(0);
    await expect(rail(page).locator('[data-rail-segment="main"] [data-messages-segment]')).toBeVisible();
    // 停靠在右栏时展开意图跟着回到右轨（输出 50 的“意图跟着它的东西走”）。
    await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
    const again = await floatConversation(page);
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
    await collapse(page);
    await expect.poll(async () => (await floatRecord(page)).rail ?? {}).not.toMatchObject({expanded: true});
    expectSameBox(await windowBox(page, again), before, "停靠再浮出、收起之后");
    expect((await floatRecord(page)).rect).toEqual(recorded.rect);
});

// 覆盖 ui/workbench-layout 输出 51“矩形”（展开的窗按记录加展开多出的宽画）与输出 38 的整窗拖动跟手：展开着拿起整窗，拖动中与放下后都按展开的宽画，不先缩回收着的宽再弹回。
test("展开着拖动整窗：拖动中与放下后窗宽都是展开的宽，左上角跟着指针（输出 51）", async ({page}) => {
    await open(page);
    const id = await floatConversation(page);
    await expand(page);
    const before = await windowBox(page, id);
    const recorded = JSON.stringify((await floatRecord(page)).rect);
    const title = await centerOf(page.locator("[data-agent-head] [data-header-title]"));
    await page.mouse.move(title.x, title.y);
    await page.mouse.down();
    await page.mouse.move(title.x - 30, title.y + 10, {steps: 2});
    await page.mouse.move(title.x - 120, title.y + 40, {steps: 6});
    const during = await windowBox(page, id);
    expect(Math.abs(during.width - before.width), "拖动中").toBeLessThanOrEqual(1);
    expect(Math.abs(during.x - (before.x - 120)), "拖动中跟手").toBeLessThanOrEqual(1);
    await page.mouse.up();
    await expect.poll(async () => JSON.stringify((await floatRecord(page)).rect)).not.toBe(recorded);
    const after = await windowBox(page, id);
    expectSameBox(after, {...before, x: before.x - 120, y: before.y + 40}, "放下之后");
});

// 覆盖 ui/workbench-layout 输出 50 的“三段”、51 的“顶格”：收着时一列里的按钮（右轨上连容器入口与展开按钮；浮动窗里连“回到停靠”）中线对齐。
test("收着的一列按钮中线对齐：右轨的入口、头像、底段与展开按钮；浮动窗的“回到停靠”、头像、底段与展开按钮（输出 50、51）", async ({page}) => {
    await open(page);
    const centers = async (selector: string): Promise<number[]> => page.locator(selector).evaluateAll((elements) => elements
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => {
            const box = element.getBoundingClientRect();
            return box.x + box.width / 2;
        }));
    const docked = await centers('[data-rail="auxiliarybar"] [data-rail-item]:not([data-rail-handle])');
    expect(docked.length).toBeGreaterThanOrEqual(4);
    for (const x of docked) expect(Math.abs(x - docked[0]!), `右轨：${docked.join(", ")}`).toBeLessThanOrEqual(0.5);

    const id = await floatConversation(page);
    // “回到停靠”悬停窗口时才显示，但收着时也占位；中线照样量得到。
    const win = await windowBox(page, id);
    await page.mouse.move(win.x + 60, win.y + 60);
    const floating = await centers(`[data-float-rail] [data-rail-item], [data-panel-head="${id}"] [data-panel-action="nbook.view.dock"]`);
    expect(floating.length).toBeGreaterThanOrEqual(4);
    for (const x of floating) expect(Math.abs(x - floating[0]!), `浮动窗：${floating.join(", ")}`).toBeLessThanOrEqual(1);
});

// 覆盖 ui/workbench-layout 输出 39 的“记住矩形”：窗拉宽、拖低之后点“回到停靠”，再浮出是调过的矩形，刷新后再浮出还是它。
test("记住矩形：调过的窗归位后再浮出，位置与大小是调过的；刷新后再浮出还是它（输出 39）", async ({page}) => {
    await open(page);
    const id = await floatConversation(page);
    const chrome = chromeOf(page, id);
    const initial = await windowBox(page, id);
    await dragBy(page, await centerOf(chrome.locator('[data-float-handle="left"]')), -120, 0);
    await dragBy(page, await centerOf(chrome.locator('[data-float-handle="bottom"]')), 0, 80);
    const adjusted = await windowBox(page, id);
    // 拖动真的改了矩形：不然缺省矩形也满足后面的断言。
    expectSameBox(adjusted, {x: initial.x - 120, y: initial.y, width: initial.width + 120, height: initial.height + 80}, "调过之后");
    await expect.poll(async () => ((await floatRecord(page)).rect as {height?: number} | undefined)?.height).toBe(Math.round(adjusted.height));

    const win = await windowBox(page, id);
    await page.mouse.move(win.x + 60, win.y + 60);
    await dockButton(page, id).click();
    await expect(page.locator("[data-float-chrome]")).toHaveCount(0);
    const again = await floatConversation(page);
    expectSameBox(await windowBox(page, again), adjusted, "再浮出");

    await page.mouse.move(win.x + 60, win.y + 60);
    await dockButton(page, again).click();
    await expect(page.locator("[data-float-chrome]")).toHaveCount(0);
    await expect.poll(async () => JSON.stringify((await saved(page))?.floatRects ?? null)).toContain(`"width":${Math.round(adjusted.width)}`);
    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
    const reloaded = await floatConversation(page);
    expectSameBox(await windowBox(page, reloaded), adjusted, "刷新后再浮出");
});

// 覆盖 ui/workbench-layout 输出 51“矩形”（夹取）：窗贴着屏幕右边时展开，呈现位置整体往左挪、右边不出界、记录位置不改；收起后回到原来的位置。
test("靠右夹取：窗拖到贴屏幕右边再展开，整体往左挪、右边不出界，记录矩形不改；收起后回到原位（输出 51）", async ({page}) => {
    await open(page);
    const id = await floatConversation(page);
    const initial = JSON.stringify((await floatRecord(page)).rect);
    // 窗可以拖出一部分在屏幕外（夹取只保证抓得住），所以量好差、正好拖到右边贴着视口右边。
    const start = await windowBox(page, id);
    await dragBy(page, await centerOf(page.locator("[data-agent-head] [data-header-title]")), 1440 - (start.x + start.width), 0);
    await expect.poll(async () => JSON.stringify((await floatRecord(page)).rect)).not.toBe(initial);
    const edge = await windowBox(page, id);
    expect(Math.abs(edge.x + edge.width - 1440)).toBeLessThanOrEqual(1);
    const recorded = await floatRecord(page);

    await expand(page);
    await expect.poll(async () => Math.round((await windowBox(page, id)).width)).toBe(Math.round(edge.width + GROWTH));
    const shifted = await windowBox(page, id);
    // 整体往左挪：右边留在原处（没出界），左边向左多了展开的那段。
    expect(shifted.x + shifted.width).toBeLessThanOrEqual(1440);
    expect(Math.abs(shifted.x + shifted.width - (edge.x + edge.width))).toBeLessThanOrEqual(1);
    expect(Math.abs(shifted.x - (edge.x - GROWTH))).toBeLessThanOrEqual(1);
    expect(Math.abs(shifted.y - edge.y)).toBeLessThanOrEqual(1);
    expect((await floatRecord(page)).rect).toEqual(recorded.rect);
    // 视图段与“回到停靠”都在视口里、可达。
    expect((await boxOf(segment(page))).x + (await boxOf(segment(page))).width).toBeLessThanOrEqual(1440);
    expect(await hitIn(page, await centerOf(dockButton(page, id)), '[data-panel-action="nbook.view.dock"]')).toBe(true);

    await collapse(page);
    await expect.poll(async () => Math.round((await windowBox(page, id)).width)).toBe(Math.round(edge.width));
    expectSameBox(await windowBox(page, id), edge, "收起之后");
    expect((await floatRecord(page)).rect).toEqual(recorded.rect);
});

// 覆盖 ui/workbench-layout 输出 51“矩形”（宽度不够时按收着呈现，展开请求回报“窗口太窄”）与输出 50 的“被拒时给窗口太窄”：窗拉到最宽之后点展开不展开，按钮带标记；视口变宽后不自动展开，再点才展开。
test("窗口太窄：窗拉到最宽后点展开不展开、按钮带 data-rail-too-narrow 与“窗口太窄”；视口变宽后仍收着，再点才展开（输出 51）", async ({page}) => {
    await open(page);
    const id = await floatConversation(page);
    const chrome = chromeOf(page, id);
    // 把窗拉到最宽：左边手柄往左拖过头，宽度由夹取停在区域宽（窗的左边可以在屏幕外）。
    await dragBy(page, await centerOf(chrome.locator('[data-float-handle="left"]')), -1500, 0);
    await expect.poll(async () => Math.round((await windowBox(page, id)).width)).toBe(1440);
    const full = await windowBox(page, id);
    const recorded = await floatRecord(page);

    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("data-rail-too-narrow", /.*/u);
    await expect(toggle(page)).toHaveAttribute("aria-description", "窗口太窄");
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    expectSameBox(await windowBox(page, id), full, "被拒之后");
    expect((await floatRecord(page)).rail ?? {}).not.toMatchObject({expanded: true});
    expect((await floatRecord(page)).rect).toEqual(recorded.rect);

    // 视口变宽：放得下了，但不自动展开。
    await page.setViewportSize({width: 1920, height: 900});
    await expect.poll(async () => (await boxOf(page.locator("[data-workbench-surface]"))).width).toBeGreaterThan(1800);
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    expectSameBox(await windowBox(page, id), full, "视口变宽之后");
    expect((await floatRecord(page)).rail ?? {}).not.toMatchObject({expanded: true});
    // 对照：再点才展开（被拒不是点不动按钮）。
    await expand(page);
    await expect(toggle(page)).not.toHaveAttribute("data-rail-too-narrow");
    await expect.poll(async () => Math.round((await windowBox(page, id)).width)).toBe(Math.round(full.width + GROWTH));
});

// 覆盖 ui/workbench-layout 输出 51“矩形”（轨宽手柄：往左拖变宽、窗的右边不动、左边与手柄跟着指针、触界即停、Esc 取消、松手一次提交）与 `WorkbenchFloatRailHandle.md`：拖动中与松手后的几何、aria-valuenow、记录。
test("浮动窗轨宽：展开后往左拖手柄 40 像素，窗的右边不动、左边与手柄跟着走，松手后宽度留住、刷新还在；拖过头停在上限；Esc 回到拖前且零写入（输出 51）", async ({page}) => {
    await open(page);
    const id = await floatConversation(page);
    await expand(page);
    const handle = railHandle(page);
    await expect(handle).toHaveAttribute("role", "separator");
    await expect(handle).toHaveAttribute("aria-valuenow", "260");
    const before = await windowBox(page, id);
    const grip = await centerOf(handle);

    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x - 15, grip.y, {steps: 3});
    await page.mouse.move(grip.x - 40, grip.y, {steps: 5});
    // 拖动中：右边不动、左边往左 40，手柄一直在指针下；手柄自己带拖动标记（`data-workbench-dragging` 是网格拖放的，轨宽手势不写）；呈现的轨宽是 300。
    await expect(handle).toHaveAttribute("data-dragging", /.*/u);
    await expect(handle).toHaveAttribute("aria-valuenow", "300");
    const during = await windowBox(page, id);
    expect(Math.abs(during.x + during.width - (before.x + before.width))).toBeLessThanOrEqual(1);
    expect(Math.abs(during.x - (before.x - 40))).toBeLessThanOrEqual(1);
    expect(Math.abs((await centerOf(handle)).x - (grip.x - 40))).toBeLessThanOrEqual(2);
    await page.mouse.up();
    await expect(handle).not.toHaveAttribute("data-dragging");
    // 松手：几何留在 300，记录里是 300、记录矩形没动。
    await expect(handle).toHaveAttribute("aria-valuenow", "300");
    expectSameBox(await windowBox(page, id), during, "松手之后");
    await expect.poll(async () => (await floatRecord(page)).rail).toMatchObject({expanded: true, width: 300});
    const recorded = await floatRecord(page);
    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
    await expect(handle).toHaveAttribute("aria-valuenow", "300");
    expectSameBox(await windowBox(page, id), during, "刷新之后");
    expect(await floatRecord(page)).toEqual(recorded);

    // 拖过头：触界即停，停在声明的上限 420，右边仍不动。
    const handlePoint = await centerOf(handle);
    await page.mouse.move(handlePoint.x, handlePoint.y);
    await page.mouse.down();
    await page.mouse.move(handlePoint.x - 60, handlePoint.y, {steps: 4});
    await page.mouse.move(handlePoint.x - 400, handlePoint.y, {steps: 8});
    await expect(handle).toHaveAttribute("aria-valuenow", "420");
    const limit = await windowBox(page, id);
    expect(Math.abs(limit.x + limit.width - (before.x + before.width))).toBeLessThanOrEqual(1);
    await page.mouse.up();
    await expect(handle).toHaveAttribute("aria-valuenow", "420");

    // Esc：回到拖前，之后松手也不落账。
    const rest = await windowBox(page, id);
    const writes = await settledWrites(page, database());
    const at = await centerOf(handle);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 20, at.y, {steps: 3});
    await page.mouse.move(at.x + 60, at.y, {steps: 4});
    await expect(handle).toHaveAttribute("aria-valuenow", "360");
    await page.keyboard.press("Escape");
    await expect(handle).toHaveAttribute("aria-valuenow", "420");
    expectSameBox(await windowBox(page, id), rest, "Esc 之后");
    await page.mouse.move(at.x + 80, at.y, {steps: 3});
    await expect(handle).not.toHaveAttribute("data-dragging");
    await page.mouse.up();
    await expect(handle).toHaveAttribute("aria-valuenow", "420");
    expectSameBox(await windowBox(page, id), rest, "取消后松手");
    expect(await layoutWrites(page, database())).toBe(writes);
});

// 覆盖 `WorkbenchFloatRailHandle.md` 的键盘与双击：左右方向键每次 10 像素（往左变宽，窗的右边不动），Home 与双击回到缺省 260，每次一次提交。
test("浮动窗轨宽的键盘：左右方向键每次 10 像素，Home 与双击回缺省，窗的右边始终不动（输出 51）", async ({page}) => {
    await open(page);
    const id = await floatConversation(page);
    await expand(page);
    const handle = railHandle(page);
    const before = await windowBox(page, id);
    const right = before.x + before.width;
    await handle.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", "270");
    await page.keyboard.press("ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", "280");
    let now = await windowBox(page, id);
    expect(Math.abs(now.x + now.width - right)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.x - (before.x - 20))).toBeLessThanOrEqual(1);
    await page.keyboard.press("ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", "270");
    await expect.poll(async () => (await floatRecord(page)).rail).toMatchObject({expanded: true, width: 270});
    await page.keyboard.press("Home");
    await expect(handle).toHaveAttribute("aria-valuenow", "260");
    expectSameBox(await windowBox(page, id), before, "Home 之后");
    // 缺省宽在记录里不写 width。
    await expect.poll(async () => (await floatRecord(page)).rail).toEqual({expanded: true});
    await page.keyboard.press("ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", "270");
    await handle.dblclick();
    await expect(handle).toHaveAttribute("aria-valuenow", "260");
    now = await windowBox(page, id);
    expectSameBox(now, before, "双击之后");
});

// 覆盖 workbench/views.md 输出 21“焦点”与 ui/workbench-layout 输出 51：停靠与浮动之间搬动是同一个视图段实例，bot 页的搜索词、当前页都在，焦点在搜索框里搬完还在搜索框里；两页的搜索词各自保留。
test("搬动后状态（bot 页）：停靠时展开并输入搜索词，浮出后词与页都在、焦点仍在搜索框里（views 输出 21）", async ({page}) => {
    await open(page);
    await openButton(page, "bot").click();
    await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
    await expect(botSearch(page)).toBeFocused();
    await botSearch(page).fill("甲乙丙");
    // 命令不碰焦点：焦点在 bot 页的搜索框里浮出。
    await floatConversation(page);
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(botPage(page)).toBeVisible();
    await expect(botSearch(page)).toHaveValue("甲乙丙");
    await expect(page.locator("[data-messages-segment]")).toHaveCount(1);
    await expect(botSearch(page)).toBeFocused();
});

// 覆盖 workbench/views.md 输出 21“焦点”：焦点在会话页（宿主的会话面板）的搜索框里时，搬到窗里焦点还在那个框里。
test("搬动后状态（会话页）：焦点在会话页的搜索框里浮出，词、页、焦点都在（views 输出 21）", async ({page}) => {
    await open(page);
    await openButton(page, "sessions").click();
    await expect(sessionsPage(page)).toBeVisible();
    await sessionsSearch(page).fill("丁戊");
    await expect(sessionsSearch(page)).toBeFocused();
    await floatConversation(page);
    await expect(sessionsPage(page)).toBeVisible();
    await expect(sessionsSearch(page)).toHaveValue("丁戊");
    await expect(sessionsSearch(page)).toBeFocused();
});

// 覆盖 workbench/views.md 输出 21“焦点”：从窗里搬回右轨，页、两页各自的搜索词、焦点都还在。
test("搬动后状态（归位）：窗里展开着输入两页的搜索词，焦点在 bot 页的搜索框里归位，右轨展开、词、页、焦点都在（views 输出 21）", async ({page}) => {
    await open(page);
    await floatConversation(page);
    await expand(page);
    await openButton(page, "sessions").click();
    await expect(sessionsPage(page)).toBeVisible();
    await sessionsSearch(page).fill("丁戊");
    await openButton(page, "bot").click();
    await botSearch(page).fill("甲乙丙");
    await botSearch(page).focus();
    await runCommand(page, "nbook.view.dock", {panelId: await sectionOf(page, CONVERSATION)});
    await expect(page.locator("[data-float-chrome]")).toHaveCount(0);
    await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
    await expect(rail(page).locator("[data-messages-segment]")).toHaveCount(1);
    await expect(botPage(page)).toBeVisible();
    await expect(botSearch(page)).toHaveValue("甲乙丙");
    await expect(botSearch(page)).toBeFocused();
    await openButton(page, "sessions").click();
    await expect(sessionsSearch(page)).toHaveValue("丁戊");
});

/**
 * 在 `action` 做的时候每一帧记一次：页面上的视图段与列表各有几份、编辑区卡片多宽。
 * 先开动画再调用（默认减少动效，过渡一帧就到终点，取样看不到中间）。
 */
async function sampleFrames(page: Page, action: () => Promise<void>): Promise<{segments: number; lists: number; editor: number}[]> {
    await page.evaluate(() => {
        const win = window as unknown as {__frames: unknown[]; __done: boolean};
        win.__frames = [];
        win.__done = false;
        const started = performance.now();
        const tick = (): void => {
            win.__frames.push({
                segments: document.querySelectorAll("[data-messages-segment]").length,
                lists: document.querySelectorAll("[data-messages-list-panel]").length,
                editor: document.querySelector('[data-shell-card="g0"]')?.getBoundingClientRect().width ?? 0,
            });
            if (performance.now() - started < 1600) requestAnimationFrame(tick);
            else win.__done = true;
        };
        requestAnimationFrame(tick);
    });
    await action();
    await page.waitForFunction(() => (window as unknown as {__done: boolean}).__done);
    return page.evaluate(() => (window as unknown as {__frames: {segments: number; lists: number; editor: number}[]}).__frames);
}

// 覆盖 ui/workbench-layout 验收 37 与输出 51“过渡”：右栏只有消息时浮出，右栏与右轨一起收走、编辑区带过渡变宽，视图段随窗飞；归位反过来；全程（含中间帧）只有一份视图段、至多一份列表。
test("验收 37：右栏只有消息时浮出与归位，右栏与右轨一起收走又回来、编辑区带过渡变宽又变窄；每一帧都只有一份视图段", async ({page}) => {
    await open(page);
    // 右栏只留消息：样例丁先浮出去。
    await runCommand(page, "nbook.view.float", {tab: `view:${D}`});
    await expect(page.locator("[data-float-chrome]")).toHaveCount(1);
    await expect(rail(page)).toHaveCount(1);
    await page.emulateMedia({reducedMotion: "no-preference"});
    const docked = (await boxOf(editorCard(page))).width;
    await expect(regionToggle(page)).toHaveAttribute("aria-pressed", "true");

    const out = await sampleFrames(page, () => runCommand(page, "nbook.view.float", {tab: `view:${CONVERSATION}`}));
    await expect(page.locator("[data-float-chrome]")).toHaveCount(2);
    await expect(rail(page)).toHaveCount(0);
    await expect(page.locator('[data-shell-card="rail:auxiliarybar"]')).toHaveCount(0);
    await expect(regionToggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(segment(page)).toHaveCount(1);
    expect(out.every((frame) => frame.segments === 1), `浮出的每一帧一份视图段：${JSON.stringify(out.map((frame) => frame.segments))}`).toBe(true);
    expect(out.every((frame) => frame.lists <= 1)).toBe(true);
    const wide = (await boxOf(editorCard(page))).width;
    expect(wide).toBeGreaterThan(docked + 48);
    // 编辑区带过渡变宽：中间有处在两端之间的帧。
    expect(out.some((frame) => frame.editor > docked + 1 && frame.editor < wide - 1), "浮出时编辑区变宽有过渡").toBe(true);

    const windowId = await sectionOf(page, CONVERSATION);
    const back = await sampleFrames(page, () => dockButton(page, windowId).click());
    await expect(page.locator("[data-float-chrome]")).toHaveCount(1);
    await expect(rail(page)).toHaveCount(1);
    await expect(rail(page).locator("[data-messages-segment]")).toHaveCount(1);
    await expect(segment(page)).toHaveCount(0);
    expect(back.every((frame) => frame.segments === 1), `归位的每一帧一份视图段：${JSON.stringify(back.map((frame) => frame.segments))}`).toBe(true);
    expect(back.every((frame) => frame.lists <= 1)).toBe(true);
    expect(back.some((frame) => frame.editor > docked + 1 && frame.editor < wide - 1), "归位时编辑区变窄有过渡").toBe(true);
    await expect.poll(async () => Math.round((await boxOf(editorCard(page))).width)).toBe(Math.round(docked));
});

// 覆盖 ui/workbench-layout 验收 37 与输出 51“过渡”的后半：右栏还有别的容器时消息浮出，右轨留着（显示容器入口）、编辑区不变宽，视图段在窗里，页面上只有一份。
test("验收 37：右栏还有别的容器时浮出，右轨留着、入口还在，编辑区不变宽，视图段在窗里；归位后回到右轨", async ({page}) => {
    await open(page);
    await expect(railEntryOfView(page, D)).toHaveCount(1);
    const docked = (await boxOf(editorCard(page))).width;
    const windowId = await floatConversation(page);
    await expect(rail(page)).toHaveCount(1);
    await expect(railEntryOfView(page, D)).toHaveCount(1);
    await expect(railEntryOfView(page, CONVERSATION)).toHaveCount(0);
    await expect(page.locator("[data-messages-segment]")).toHaveCount(1);
    await expect(rail(page).locator("[data-messages-segment]")).toHaveCount(0);
    await expect(regionToggle(page)).toHaveAttribute("aria-pressed", "true");
    expect(Math.abs((await boxOf(editorCard(page))).width - docked)).toBeLessThanOrEqual(1);

    await dockButton(page, windowId).click();
    await expect(page.locator("[data-float-chrome]")).toHaveCount(0);
    await expect(rail(page).locator("[data-messages-segment]")).toHaveCount(1);
    await expect(page.locator("[data-messages-segment]")).toHaveCount(1);
    await expect(railEntryOfView(page, CONVERSATION)).toHaveCount(1);
});

interface WidthFrame {chat: number; win: number; railLeft: number; at: number}

/**
 * 在 `action` 做的时候逐帧（requestAnimationFrame）记聊天区宽、窗宽与视图段所在的轨的左边，直到窗宽离开 `from` 又停住 6 帧。
 * 窗宽停住之后再多采几帧，是为了让“过渡结束”靠可观察的几何判定，不按时长等。
 */
async function sampleWidths(page: Page, id: string, from: number, action: () => Promise<void>): Promise<WidthFrame[]> {
    await page.evaluate((chromeId) => {
        const win = window as unknown as {__widths: WidthFrame[]; __stop: boolean};
        win.__widths = [];
        win.__stop = false;
        const tick = (): void => {
            win.__widths.push({
                chat: document.querySelector("[data-messages-chat]")?.getBoundingClientRect().width ?? -1,
                win: document.querySelector(`[data-float-chrome="${chromeId}"]`)?.getBoundingClientRect().width ?? -1,
                railLeft: document.querySelector("[data-float-rail]")?.getBoundingClientRect().left ?? -1,
                at: Math.round(performance.now()),
            });
            if (!win.__stop) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }, id);
    await action();
    // 窗宽停住：最后 6 帧一样，并且已经离开起点（点击之后过渡开始之前的头几帧也是停住的，不算）。
    await page.waitForFunction(({from, away}) => {
        const frames = (window as unknown as {__widths: WidthFrame[]}).__widths;
        const last = frames.slice(-6);
        return last.length === 6 && last.every((frame) => Math.abs(frame.win - last[0].win) < 0.01) && Math.abs(last[0].win - from) > away;
    }, {from, away: GROWTH / 2});
    return page.evaluate(() => {
        const win = window as unknown as {__widths: WidthFrame[]; __stop: boolean};
        win.__stop = true;
        return win.__widths;
    });
}

// 在窗里量过渡，所以这一组把动效开回来（配置缺省是减少动效，那时展开收起一帧到位，没有中间帧可采）。
test.describe("过渡", () => {
    test.use({contextOptions: {reducedMotion: "no-preference"}});

    // 覆盖 ui/workbench-layout 输出 51“过渡”：展开、收起时窗宽过渡到位，过渡中聊天区宽度不变；视图段的轨宽手柄不在这里测（见上面几条）。
    test("过渡：展开与收起的每一帧聊天区宽度都不变，窗宽带过渡到位（输出 51）", async ({page}) => {
        await open(page);
        const id = await floatConversation(page);
        await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
        // 先等窗落定：浮出时窗的外框还在过渡，窗宽连续 10 帧不变才算数，起点才可信。
        await page.evaluate((chromeId) => new Promise<void>((resolve) => {
            let last = -1;
            let same = 0;
            const tick = (): void => {
                const width = document.querySelector(`[data-float-chrome="${chromeId}"]`)?.getBoundingClientRect().width ?? -1;
                same = width === last ? same + 1 : 0;
                last = width;
                if (same >= 10) resolve();
                else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        }), id);
        const rest = await windowBox(page, id);
        const chat = (await boxOf(page.locator("[data-messages-chat]"))).width;

        const check = (frames: WidthFrame[], from: number, to: number, where: string): void => {
            for (const frame of frames) expect(Math.abs(frame.chat - chat), `${where}：聊天区宽度逐帧不变，起点 ${chat}：${JSON.stringify(frames)}`).toBeLessThanOrEqual(1);
            // 视图段按新宽停在最终位置：它的左边从第一帧起就在终点位置上，窗的右边由它露出或盖住。
            for (const frame of frames) expect(Math.abs(frame.railLeft - frames[frames.length - 1].railLeft), `${where}：视图段左边逐帧不动：${JSON.stringify(frames)}`).toBeLessThanOrEqual(1);
            // 采样确实盖住了过渡：窗宽出现过中间值（一帧到位时上面两条会空过），终点是起点 ± GROWTH。只要求 1 个：负载高时主线程忙，
            // 过渡只剩一两帧（负载 13–15 时 10 遍里 5 遍只采到 2 个、1 遍 0 个），要求更多只是在量负载。
            const between = new Set(frames.map((frame) => Math.round(frame.win)).filter((width) => width > Math.min(from, to) + 1 && width < Math.max(from, to) - 1));
            expect(between.size, `${where}：窗宽的中间值 ${JSON.stringify([...between])}；${frames.length} 帧 ${JSON.stringify(frames.map((frame) => [frame.at, Math.round(frame.win)]))}`).toBeGreaterThanOrEqual(1);
            expect(Math.abs(frames[frames.length - 1].win - to), `${where}：终点窗宽`).toBeLessThanOrEqual(2);
        };

        const opening = await sampleWidths(page, id, rest.width, () => toggle(page).click());
        check(opening, rest.width, rest.width + GROWTH, "展开");
        await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");

        const closing = await sampleWidths(page, id, rest.width + GROWTH, () => toggle(page).click());
        check(closing, rest.width + GROWTH, rest.width, "收起");
        await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    });
});
