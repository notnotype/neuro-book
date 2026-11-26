/**
 * 右侧栏的侧轨（右轨）在真实 Chrome 中的验收：停靠在右栏的部分（docs/specs/ui/workbench-layout.md 输出 50 的“在不在”“三段”“落点”“相连与外观”
 * “焦点与读屏”，输出 22、45、18 在右轨上的指引；docs/specs/workbench/views.md 输出 22 的位置限制）。生产构建的 e2e 测试外壳与宿主测试入口：
 * 右栏是产品的消息视图（`nbook.agent.conversation`）加测试插件 `test.sample-views` 的样例丁两个容器，侧栏是“项目”加样例甲乙丙。
 *
 * 只按元素标记约定定位（`.agents/works/w00043-neurobot/tasks/t19-messages-view-ui-polish/plan.md` 的“测试分工”）：`data-rail`、
 * `data-rail-state`、`data-rail-joined`、`data-tool-band`、`data-rail-segment`、`data-tool-entry`。视图段里画什么属于消息视图，不在这里。
 *
 * 不在这里的（后面两段）：展开与预算（验收 36）、轨宽手柄、切换容器的布局过渡、焦点交接、意图不漂移（验收 35）；浮动窗里的视图段、
 * 浮出与归位的过渡（验收 37）；消息视图的收着与展开。
 *
 * 用例先于实现：业务代码落地之前这些用例是失败的，不为让它们过而改断言。
 */

import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {PROJECT_TEST_VIEW} from "nbook/shared/testing/project-view-contract";
import {SAMPLE_VIEWS_RUN_EVENT} from "nbook/shared/testing/sample-views-contract";

import {startProbeServer} from "./fixtures";
import {pressEntry} from "./support/press-entry";
import {
    LEAF,
    barEntry,
    boxOf,
    cancelDrag,
    centerOf,
    cornerRadii,
    dropFeedback,
    expectNoFeedback,
    focusStop,
    gapBetween,
    inLeaf,
    layoutWrites,
    leaf,
    moveTo,
    pickUp,
    pickUpLive,
    rail,
    railCard,
    railEntries,
    railEntry,
    railEntryIds,
    railEntryOfView,
    railSegment,
    release,
    savedDoc,
    sectionOf,
    settledWrites,
} from "./support/side-rail";
import type {Point} from "./support/side-rail";
import type {ProbeServer} from "./fixtures";

const EXPLORER = "nbook.explorer";
const SESSIONS = PROJECT_TEST_VIEW;
const CONVERSATION = "nbook.agent.conversation";
const PROJECT_CONTAINER = "nbook.workbench.project";
const A = "test.sample-views.alpha";
const D = "test.sample-views.delta";

/** 样例丁自己的隐式容器：右栏里排在消息后面，默认不是当前容器。 */
const DELTA_CONTAINER = `view:${D}`;

test.describe("产品页：右轨", () => {
    let tmp = "";
    let server: ProbeServer;

    test.beforeAll(async () => {
        tmp = await createTestTmpRoot("neuro-book-e2e", "workbench-side-rail");
        await mkdir(join(tmp, "state"), {recursive: true});
        // 同 workbench-containers：样例插件自己贡献编辑区的内容，和产品的编辑器只能留一个；canon 与剧情插件会改变按样例插件假定的容器。
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views,test.project-view", NBOOK_EXCLUDE_PLUGINS: "nbook.editor,nbook.canon,nbook.plot"}});
    });

    test.afterAll(async () => {
        expect(await server.stop()).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 1440, height: 900}});

    const database = (): string => join(tmp, "state", "storage", "user.sqlite");
    const saved = (page: Page) => savedDoc(page, database());
    const sample = (page: Page, view: string) => page.locator(`[data-sample-view="${view}"]`);
    const content = (page: Page, view: string) => page.locator(`[data-content="view:${view}"]`);
    const tab = (page: Page, view: string) => page.locator(`[data-panel-tab="view:${view}"]`);
    const regionToggle = (page: Page, region: "sidebar" | "auxiliarybar") => page.locator(`[data-titlebar-layout="${region}"]`);
    const panelToggle = (page: Page) => page.locator('[data-shell-focus-target="panel-toggle"]');
    const windows = (page: Page) => page.locator(`${LEAF}[data-float]`);
    /** 右栏挨着编辑区的那条边界（编辑区那一侧在底部面板显示着时是 `center`，没显示时是 `g0`）。 */
    const auxiliarySash = (page: Page) => page.getByRole("separator", {name: /^调整 (?:center|g0) 与 \S+ 的宽度$/u});

    /** 区域隐藏了：按拖到零画，那块外框还在、缩到面积为零。等到零也就等过渡走完了。 */
    const shrunk = (page: Page, id: string) => expect.poll(async () => {
        const found = await leaf(page, id).boundingBox();
        return found === null ? 0 : Math.round(found.width * found.height);
    }).toBe(0);

    /** 每个用例一个新的浏览器上下文：客户端身份不同，布局记录互不影响。 */
    async function open(page: Page): Promise<void> {
        await page.goto(new URL("/workbench", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(panelToggle(page)).toBeEnabled();
        await expect(barEntry(page, PROJECT_CONTAINER)).toHaveAttribute("aria-pressed", "true");
    }

    /** 页面上经测试外壳执行一条命令：不碰指针与焦点，也不依赖视图头上有没有按钮。 */
    const runCommand = (page: Page, command: string, args: Readonly<Record<string, unknown>>): Promise<void> => page.evaluate(
        ({name, detail}) => void window.dispatchEvent(new CustomEvent(name, {detail})),
        {name: SAMPLE_VIEWS_RUN_EVENT, detail: {command, args}},
    );

    /** 把视图浮成窗，等窗开出来，返回窗的面板 id。 */
    async function floatView(page: Page, viewId: string): Promise<string> {
        const before = await windows(page).count();
        await runCommand(page, "nbook.view.float", {tab: `view:${viewId}`});
        await expect(windows(page)).toHaveCount(before + 1);
        return sectionOf(page, viewId);
    }

    /** 右轨的卡片是独立的：四个角都和编辑组卡片一样圆（输出 50 的“相连与外观”），没有和区域卡片相连。 */
    async function expectStandalone(page: Page): Promise<void> {
        await expect(rail(page)).toHaveCount(1);
        await expect(page.locator('[data-rail="auxiliarybar"][data-rail-joined]')).toHaveCount(0);
        await expect(rail(page)).toHaveAttribute("data-rail-state", "collapsed");
        const round = (await cornerRadii(page.locator('[data-shell-card="g0"]'))).topLeft;
        expect(round).toBeGreaterThan(0);
        expect(await cornerRadii(railCard(page))).toEqual({topLeft: round, topRight: round, bottomRight: round, bottomLeft: round});
        // 区域隐藏或拖到零：当前容器的入口不按下，至多一项按下的规则落在“一项也没有”上（输出 50、22）。
        await expect(railEntries(page)).not.toHaveCount(0);
        await expect(rail(page).locator('[data-tool-entry][aria-pressed="true"]')).toHaveCount(0);
    }

    // 覆盖 ui/workbench-layout 输出 50“在不在”“三段”“相连与外观”：右栏有成员容器且显示着，右轨在右栏外侧、是 `navigation`、卡片宽 48，
    // 和右栏卡片相连（相连的两个角不圆、不留缝）；入口带里每个容器一个入口，按下的恰一项。
    test("右栏显示着：右轨在右栏外侧，和右栏卡片相连，入口带里右栏的两个容器各一项、按下的恰一项（输出 50）", async ({page}) => {
        await open(page);
        await expect(page.getByRole("navigation").and(rail(page))).toHaveCount(1);
        await expect(rail(page)).toHaveAttribute("data-rail-state", "collapsed");
        await expect(page.locator('[data-rail="auxiliarybar"][data-rail-joined]')).toHaveCount(1);
        // 入口带里每个有成员的容器一项：对话与样例丁；按下的是右栏当前容器（对话）。
        await expect(railEntries(page)).toHaveCount(2);
        await expect(railEntryOfView(page, CONVERSATION)).toHaveAttribute("aria-pressed", "true");
        await expect(railEntryOfView(page, D)).toHaveAttribute("aria-pressed", "false");
        await expect(rail(page).locator('[data-tool-entry][aria-pressed="true"]')).toHaveCount(1);

        const section = page.locator(`[data-shell-card="${await sectionOf(page, CONVERSATION)}"]`);
        const [aux, card] = [await boxOf(section), await boxOf(railCard(page))];
        expect(card.width).toBeCloseTo(48, 0);
        // 相连：不留缝，上下与右栏卡片齐。
        expect(Math.abs(card.x - (aux.x + aux.width))).toBeLessThanOrEqual(1);
        expect(Math.abs(card.y - aux.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(card.y + card.height - (aux.y + aux.height))).toBeLessThanOrEqual(1);
        const round = (await cornerRadii(page.locator('[data-shell-card="g0"]'))).topLeft;
        expect(round).toBeGreaterThan(0);
        expect(await cornerRadii(railCard(page))).toEqual({topLeft: 0, topRight: round, bottomRight: round, bottomLeft: 0});
        const auxCorners = await cornerRadii(section);
        expect([auxCorners.topRight, auxCorners.bottomRight]).toEqual([0, 0]);
    });

    // 覆盖 ui/workbench-layout 输出 50“在不在”“相连与外观”：右栏隐藏时右轨在，自己一张圆角卡片，当前容器的入口不按下；再显示回到相连。
    test("右栏隐藏（标题栏的开关）：右轨留着，自己一张圆角卡片，入口不按下；再显示回到相连（输出 50）", async ({page}) => {
        await open(page);
        const section = await sectionOf(page, CONVERSATION);
        await regionToggle(page, "auxiliarybar").click();
        await expect(regionToggle(page, "auxiliarybar")).toHaveAttribute("aria-pressed", "false");
        await shrunk(page, section);
        await expectStandalone(page);

        await regionToggle(page, "auxiliarybar").click();
        await expect(page.locator('[data-rail="auxiliarybar"][data-rail-joined]')).toHaveCount(1);
        await expect(railEntryOfView(page, CONVERSATION)).toHaveAttribute("aria-pressed", "true");
    });

    // 覆盖 ui/workbench-layout 输出 50“在不在”：右栏拖到零（区域的边界上按 Enter，同输出 11）时右轨照样在，是独立的圆角卡片，入口不按下。
    test("右栏拖到零：右轨留着，自己一张圆角卡片，入口不按下（输出 50）", async ({page}) => {
        await open(page);
        const section = await sectionOf(page, CONVERSATION);
        await auxiliarySash(page).focus();
        await page.keyboard.press("Enter");
        await shrunk(page, section);
        await expectStandalone(page);
    });

    // 覆盖 ui/workbench-layout 输出 50“在不在”：右栏的视图一个个浮出去，还有成员容器时右轨在，最后一个浮出、右栏没有成员时右轨跟着右栏收走。
    test("右栏唯一的视图浮出：右轨跟着右栏收走；右栏里还有别的容器时右轨在（输出 50）", async ({page}) => {
        await open(page);
        await floatView(page, D);
        await expect(rail(page)).toHaveCount(1);
        await expect(railEntries(page)).toHaveCount(1);
        await expect(railEntryOfView(page, CONVERSATION)).toHaveAttribute("aria-pressed", "true");

        await floatView(page, CONVERSATION);
        await expect(rail(page)).toHaveCount(0);
        // 左轨不受影响：它的显隐只看活动栏自己的开关。
        await expect(barEntry(page, PROJECT_CONTAINER)).toHaveAttribute("aria-pressed", "true");
    });

    // 覆盖 ui/workbench-layout 输出 50“在不在”与输出 48：用户显式打开的空右栏照常呈现、可落入，没有右轨。
    test("显式打开的空右栏没有右轨（输出 50、48）", async ({page}) => {
        await open(page);
        await floatView(page, D);
        await floatView(page, CONVERSATION);
        await expect(rail(page)).toHaveCount(0);
        // 右栏拖空后隐藏；开关把它作为空区域打开，写着提示。
        const empty = page.locator("[data-empty-region]");
        await expect(regionToggle(page, "auxiliarybar")).toHaveAttribute("aria-pressed", "false");
        await regionToggle(page, "auxiliarybar").click();
        await expect(regionToggle(page, "auxiliarybar")).toHaveAttribute("aria-pressed", "true");
        await expect(empty).toBeVisible();
        await expect(rail(page)).toHaveCount(0);
        await regionToggle(page, "auxiliarybar").click();
        await expect(empty).toBeHidden();
        await expect(rail(page)).toHaveCount(0);
    });

    // 覆盖 ui/workbench-layout 输出 50“三段”与输出 22 的入口规则在右轨上的写法：入口带的入口是带按下态的按钮，每个容器一项。
    test("入口带：每个容器一个入口，按下的是当前容器且区域可见，切换容器后按下态跟着走（输出 50、22）", async ({page}) => {
        await open(page);
        const [conversation, delta] = [railEntryOfView(page, CONVERSATION), railEntryOfView(page, D)];
        await expect(conversation).toHaveAttribute("aria-pressed", "true");
        await expect(delta).toHaveAttribute("aria-pressed", "false");
        await expect(content(page, CONVERSATION)).not.toHaveAttribute("inert", "");

        // 点另一个容器：切到它，区域还是显示着，右轨还和右栏卡片相连；按下态换到它，对话的内容停放。
        await pressEntry(page, delta);
        await expect(delta).toHaveAttribute("aria-pressed", "true");
        await expect(conversation).toHaveAttribute("aria-pressed", "false");
        await expect(sample(page, D)).toBeVisible();
        await expect(content(page, CONVERSATION)).toHaveAttribute("inert", "");
        await expect(page.locator('[data-rail="auxiliarybar"][data-rail-joined]')).toHaveCount(1);
        await expect.poll(async () => (await saved(page))?.panels.auxiliarybar?.activeContainer).toBe(DELTA_CONTAINER);
        expect((await saved(page))?.panels.auxiliarybar?.hidden).not.toBe(true);
    });

    // 覆盖 ui/workbench-layout 输出 50“三段”（点击同输出 22 的上段）：点当前容器按下着的入口，隐藏右栏、右轨留着；再点显示回来。
    test("点当前入口：隐藏右栏，右轨留着、入口不按下、焦点留在入口；再点显示右栏（输出 50、22）", async ({page}) => {
        await open(page);
        const conversation = railEntryOfView(page, CONVERSATION);
        const section = await sectionOf(page, CONVERSATION);
        // 键盘按下：入口按下时不抢焦点（鼠标按下不聚焦入口），焦点在入口上按 Enter 才有“留在入口”可言。
        await conversation.focus();
        await page.keyboard.press("Enter");
        await expect(conversation).toHaveAttribute("aria-pressed", "false");
        await shrunk(page, section);
        await expect.poll(async () => (await saved(page))?.panels.auxiliarybar?.hidden).toBe(true);
        await expectStandalone(page);
        await expect(conversation).toBeFocused();

        await pressEntry(page, conversation);
        await expect(conversation).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => (await saved(page))?.panels.auxiliarybar?.hidden).not.toBe(true);
        await expect(page.locator('[data-rail="auxiliarybar"][data-rail-joined]')).toHaveCount(1);
    });

    // 覆盖 ui/workbench-layout 输出 50“三段”（点击同输出 22 的上段：不是当前容器时切到它，区域隐藏或拖到零时同一次写入显示）。
    test("右栏隐藏或拖到零时点另一个容器的入口：同一次写入把右栏显示出来并切到它（输出 50、22）", async ({page}) => {
        await open(page);
        const section = await sectionOf(page, CONVERSATION);
        await regionToggle(page, "auxiliarybar").click();
        await shrunk(page, section);
        await expect.poll(async () => (await saved(page))?.panels.auxiliarybar?.hidden).toBe(true);
        const writes = await settledWrites(page, database());

        await pressEntry(page, railEntryOfView(page, D));
        await expect(railEntryOfView(page, D)).toHaveAttribute("aria-pressed", "true");
        await expect(sample(page, D)).toBeVisible();
        await expect.poll(() => layoutWrites(page, database())).toBe(writes + 1);
        const doc = (await saved(page))!;
        expect(doc.panels.auxiliarybar?.hidden).not.toBe(true);
        expect(doc.panels.auxiliarybar?.activeContainer).toBe(DELTA_CONTAINER);

        // 拖到零同样：区域在边界上收到零，点当前容器的入口把它显示回来。
        await auxiliarySash(page).focus();
        await page.keyboard.press("Enter");
        await shrunk(page, await sectionOf(page, D));
        await expect(railEntryOfView(page, D)).toHaveAttribute("aria-pressed", "false");
        await pressEntry(page, railEntryOfView(page, D));
        await expect(railEntryOfView(page, D)).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => (await boxOf(leaf(page, await sectionOf(page, D)))).width).toBeGreaterThan(100);
    });

    // 覆盖 ui/workbench-layout 输出 50“落点”与输出 45：落在两个入口之间新建一个只含它的容器，右栏切到它；预览里不切、零写入，放下写一次。
    test("拖一个工具视图到右轨两个入口之间：右栏多一个只含它的容器并切到它，预览里零写入（输出 50、45）", async ({page}) => {
        await open(page);
        const before = await railEntryIds(page);
        expect(before).toEqual([before[0], DELTA_CONTAINER]);
        const writes = await settledWrites(page, database());
        const gap = await gapBetween(railEntries(page).nth(0), railEntries(page).nth(1));
        await pickUp(page, tab(page, EXPLORER));
        await moveTo(page, gap);
        await expect(dropFeedback(page)).toHaveAttribute("data-drop-kind", "new-container");
        // 预览里右栏还是原来的容器，没有写入。
        await expect(railEntryOfView(page, CONVERSATION)).toHaveAttribute("aria-pressed", "true");
        expect(await layoutWrites(page, database())).toBe(writes);
        await release(page);

        await expect.poll(() => railEntryIds(page)).toEqual([before[0], "custom", DELTA_CONTAINER]);
        await expect.poll(() => layoutWrites(page, database())).toBe(writes + 1);
        const created = railEntries(page).nth(1);
        await expect(created).toHaveAttribute("aria-pressed", "true");
        await expect(content(page, EXPLORER)).toBeVisible();
        const doc = (await saved(page))!;
        expect(doc.panels.auxiliarybar?.activeContainer).toMatch(/^custom:/u);
        expect(doc.panels[await sectionOf(page, EXPLORER)]?.container).toBe(doc.panels.auxiliarybar?.activeContainer);
    });

    // 覆盖 ui/workbench-layout 输出 50“落点”与输出 45：落在一个入口上，这个入口高亮，放下成为那个容器最后一个分节，右栏切到它。
    test("拖一个工具视图到右轨的入口上：入口高亮，放下成为那个容器最后一个分节，右栏切到它（输出 50、45）", async ({page}) => {
        // 入口的并入高亮只在实时布局里有（落点指示的手感用覆盖层预览）：应用的 Playwright 配置缺省减少动态效果，这里开回来。
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        const writes = await settledWrites(page, database());
        const delta = railEntryOfView(page, D);
        await pickUpLive(page, tab(page, EXPLORER));
        await moveTo(page, await centerOf(delta));
        await expect(delta).toHaveAttribute("data-tool-merge", "");
        await expect(page.locator("[data-tool-merge]")).toHaveCount(1);
        // 预览里右栏不切。
        await expect(railEntryOfView(page, CONVERSATION)).toHaveAttribute("aria-pressed", "true");
        expect(await layoutWrites(page, database())).toBe(writes);
        await release(page);

        await expect.poll(() => layoutWrites(page, database())).toBe(writes + 1);
        await expect(page.locator("[data-tool-merge]")).toHaveCount(0);
        await expect(railEntries(page)).toHaveCount(2);
        await expect(railEntry(page, DELTA_CONTAINER)).toHaveAttribute("aria-pressed", "true");
        await expect(content(page, EXPLORER)).toBeVisible();
        await expect(sample(page, D)).toBeVisible();
        const doc = (await saved(page))!;
        expect(doc.panels[await sectionOf(page, EXPLORER)]?.container).toBe(DELTA_CONTAINER);
        expect(doc.panels.auxiliarybar?.activeContainer).toBe(DELTA_CONTAINER);
        // 资源管理器是从“项目”容器里拿走的：侧栏还是“项目”，里面剩测试视图。
        await expect(barEntry(page, PROJECT_CONTAINER)).toHaveAttribute("aria-pressed", "true");
        await expect(tab(page, SESSIONS)).toBeVisible();
    });

    // 覆盖 ui/workbench-layout 输出 50“焦点与读屏”与输出 18：F6 从左到右，左轨在左侧栏之前，右轨在右栏之后；右栏卡片顶上不再有入口条这一站。
    test("F6 与 Shift+F6：从左到右，右轨在右栏之后，右栏没有入口条这一站（输出 50、18）", async ({page}) => {
        await open(page);
        await panelToggle(page).focus();
        const stops: Array<string | null> = [];
        for (let step = 0; step < 24; step += 1) {
            await page.keyboard.press("F6");
            const at = await focusStop(page);
            if (stops.includes(at)) break;
            stops.push(at);
        }
        const conversation = await sectionOf(page, CONVERSATION);
        expect(stops, JSON.stringify(stops)).toContain("rail:sidebar");
        expect(stops, JSON.stringify(stops)).toContain(conversation);
        expect(stops, JSON.stringify(stops)).toContain("rail:auxiliarybar");
        expect(stops, JSON.stringify(stops)).not.toContain("strip:auxiliarybar");
        expect(stops.indexOf("rail:sidebar"), JSON.stringify(stops)).toBeLessThan(stops.indexOf(conversation));
        expect(stops.indexOf(conversation), JSON.stringify(stops)).toBeLessThan(stops.indexOf("rail:auxiliarybar"));

        // Shift+F6 反着走：从右轨回到右栏的分节。
        await panelToggle(page).focus();
        for (let step = 0; step < stops.length && await focusStop(page) !== "rail:auxiliarybar"; step += 1) await page.keyboard.press("F6");
        expect(await focusStop(page)).toBe("rail:auxiliarybar");
        await page.keyboard.press("Shift+F6");
        expect(await focusStop(page)).toBe(conversation);
    });

    // 覆盖 workbench/views.md 输出 22“位置限制”：别的视图拖进消息的容器没有落点（落在它的入口上、落在它的分节上），松手零写入、布局不变；
    // 同一个拖动落在别的容器的入口上是有落点的（对照）。
    test("拖别的视图进消息的容器：入口上、分节上都没有落点，松手零写入；落在样例丁的入口上有落点（views 输出 22）", async ({page}) => {
        await open(page);
        const writes = await settledWrites(page, database());
        const conversation = railEntryOfView(page, CONVERSATION);
        const delta = railEntryOfView(page, D);
        await pickUp(page, tab(page, EXPLORER));
        await moveTo(page, await centerOf(delta));
        await expect(dropFeedback(page)).toHaveAttribute("data-drop-kind", "join-container");

        await moveTo(page, await centerOf(conversation));
        await expectNoFeedback(page);
        // 落在消息自己那一节的前后半：同一个容器里再加一节，同样没有。
        const section = await sectionOf(page, CONVERSATION);
        await moveTo(page, await inLeaf(page, section, {x: 0.5, y: 0.85}));
        await expectNoFeedback(page);
        await moveTo(page, await inLeaf(page, section, {x: 0.5, y: 0.15}));
        await expectNoFeedback(page);
        await release(page);

        await expect(windows(page)).toHaveCount(0);
        expect(await layoutWrites(page, database())).toBe(writes);
        await expect(tab(page, EXPLORER)).toBeVisible();
        await expect(railEntries(page)).toHaveCount(2);
    });

    // 覆盖 workbench/views.md 输出 22“位置限制”：消息视图只停右栏，拖到左侧栏（活动栏的入口之间、侧栏的分节上）或底部面板（入口条上、分节上）
    // 都没有落点，松手零写入；同一个拖动换成样例丁的入口在活动栏与底部面板的入口条上是有落点的（对照）。
    test("拖消息视图到左侧栏或底部面板：没有落点，松手零写入、不开窗（views 输出 22）", async ({page}) => {
        await open(page);
        // 底部面板默认隐藏：把资源管理器移进去一个新容器，面板就显示了。
        await tab(page, EXPLORER).click({button: "right"});
        await page.getByRole("menuitem", {name: "新容器（底部面板）", exact: true}).click();
        await expect(page.getByRole("menu")).toHaveCount(0);
        const strip = page.locator('[data-region-strip="panel"]');
        await expect(strip).toBeVisible();
        const panelSection = await sectionOf(page, EXPLORER);
        await expect(content(page, EXPLORER)).not.toHaveAttribute("inert", "");
        const writes = await settledWrites(page, database());
        const barGap = () => gapBetween(barEntry(page, PROJECT_CONTAINER), barEntry(page, `view:${A}`));

        // 对照：样例丁（它容器的唯一视图，不受限）在这两处有落点。
        await pickUp(page, railEntryOfView(page, D));
        await moveTo(page, await barGap());
        await expect(dropFeedback(page)).toHaveAttribute("data-drop-kind", "move-container");
        await moveTo(page, await centerOf(strip));
        await expect(dropFeedback(page)).toHaveCount(1);
        await cancelDrag(page);
        expect(await layoutWrites(page, database())).toBe(writes);

        await pickUp(page, railEntryOfView(page, CONVERSATION));
        for (const [where, target] of [
            ["活动栏的入口之间", await barGap()],
            ["侧栏的分节", await inLeaf(page, await sectionOf(page, SESSIONS), {x: 0.5, y: 0.85})],
            ["底部面板的入口条", await centerOf(strip)],
            ["底部面板的分节", await inLeaf(page, panelSection, {x: 0.5, y: 0.7})],
        ] satisfies Array<[string, Point]>) {
            await moveTo(page, target);
            await expectNoFeedback(page, `消息视图拖到${where}`);
        }
        await release(page);

        await expect(windows(page)).toHaveCount(0);
        expect(await layoutWrites(page, database())).toBe(writes);
        await expect(railEntryOfView(page, CONVERSATION)).toHaveCount(1);
        await expect(barEntry(page, PROJECT_CONTAINER)).toHaveAttribute("aria-pressed", "true");
    });

    // 覆盖 workbench/views.md 输出 22“位置限制”：浮动时只能是唯一的标签，往消息的浮动窗加标签（窗的正文、窗顶）没有落点，松手零写入；
    // 同一个拖动落在别的浮动窗上是有落点的（对照）。
    test("往消息的浮动窗加标签：没有落点，松手零写入、窗里仍是消息一个标签；别的浮动窗接得住（views 输出 22）", async ({page}) => {
        await open(page);
        // 两个浮动窗叠着放，后开的盖住先开的：一个一个开、一个一个拖，窗里找一个没被盖住的点（网格扫一遍）。
        const inside = async (panel: string): Promise<Point> => {
            const found = await page.evaluate((id) => {
                const element = document.querySelector<HTMLElement>(`[data-leaf="${id}"]`);
                if (element === null) return null;
                const box = element.getBoundingClientRect();
                for (const fy of [0.6, 0.5, 0.7, 0.4, 0.8, 0.3]) {
                    for (const fx of [0.5, 0.3, 0.7, 0.2, 0.8]) {
                        const [x, y] = [box.x + box.width * fx, box.y + box.height * fy];
                        const owner = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-leaf], [data-content-leaf]");
                        if ((owner?.dataset.leaf ?? owner?.dataset.contentLeaf) === id) return {x, y};
                    }
                }
                return null;
            }, panel);
            expect(found, `${panel} 里没有没被盖住的点`).not.toBeNull();
            return found!;
        };

        // 对照：别的浮动窗（样例丁）接得住。
        const deltaWindow = await floatView(page, D);
        await pickUp(page, tab(page, EXPLORER));
        await moveTo(page, await inside(deltaWindow));
        await expect(dropFeedback(page)).toHaveCount(1);
        await cancelDrag(page);

        const conversationWindow = await floatView(page, CONVERSATION);
        const writes = await settledWrites(page, database());
        await pickUp(page, tab(page, EXPLORER));
        await moveTo(page, await inside(conversationWindow));
        await expectNoFeedback(page);
        // 窗顶的一条：别的窗在这里是“加到标签末尾”。
        const top = await boxOf(leaf(page, conversationWindow));
        await moveTo(page, {x: top.x + top.width / 2, y: top.y + 10});
        await expectNoFeedback(page);
        await release(page);

        expect(await layoutWrites(page, database())).toBe(writes);
        expect((await saved(page))?.panels[conversationWindow]?.tabs).toHaveLength(1);
        await expect(tab(page, EXPLORER)).toBeVisible();
    });

    // 覆盖 workbench/views.md 输出 22“位置限制”：所有改归属的操作在提交出口按当下文档判，命令直传（move-view）也拒绝、零写入、布局记录不变。
    // 先排被拒的命令，再排一条合法的命令（样例丁搬进侧栏的新容器）：它的写入落盘时，前面的命令都已经走完，写入次数只多这一条。
    test("命令直传也拒绝：把消息移进别的区域或别的容器、把别的视图移进消息的容器，零写入、布局记录不变（views 输出 22）", async ({page}) => {
        await open(page);
        const container = await railEntryOfView(page, CONVERSATION).getAttribute("data-tool-entry");
        expect(container).not.toBeNull();
        // 先写一次记录：默认布局不保存，没有记录就没有东西可比。
        await pressEntry(page, railEntryOfView(page, D));
        await expect.poll(async () => (await saved(page))?.panels.auxiliarybar?.activeContainer).toBe(DELTA_CONTAINER);
        const writes = await settledWrites(page, database());
        const [conversationSection, explorerSection] = [await sectionOf(page, CONVERSATION), await sectionOf(page, EXPLORER)];
        const before = (await saved(page))!;

        const rejected: Array<Readonly<Record<string, unknown>>> = [
            {viewId: CONVERSATION, newContainerIn: "sidebar"},
            {viewId: CONVERSATION, newContainerIn: "panel"},
            {viewId: CONVERSATION, container: PROJECT_CONTAINER},
            {viewId: CONVERSATION, container: DELTA_CONTAINER},
            {viewId: D, container: container!},
            {viewId: EXPLORER, container: container!},
        ];
        for (const args of rejected) await runCommand(page, "nbook.view.move-view", args);
        expect(await settledWrites(page, database()), "被拒的命令不写记录").toBe(writes);
        await runCommand(page, "nbook.view.move-view", {viewId: A, newContainerIn: "panel"});
        await expect(barEntry(page, `view:${A}`)).toHaveCount(0);
        await expect.poll(() => layoutWrites(page, database())).toBe(writes + 1);

        const after = (await saved(page))!;
        expect(after.panels[conversationSection]).toEqual(before.panels[conversationSection]);
        expect(after.panels[explorerSection]).toEqual(before.panels[explorerSection]);
        expect(after.panels.auxiliarybar).toEqual(before.panels.auxiliarybar);
        await expect(railEntryOfView(page, CONVERSATION)).toHaveCount(1);
        await expect(railEntries(page)).toHaveCount(2);
        await expect(tab(page, EXPLORER)).toBeVisible();
    });
});
