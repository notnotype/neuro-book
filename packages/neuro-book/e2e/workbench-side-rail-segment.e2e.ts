/**
 * 右侧栏侧轨的视图段在真实 Chrome 中的验收（docs/specs/ui/workbench-layout.md 输出 22、42、50 的“展开”“预算”“轨宽手柄”“切换容器”“焦点与读屏”，
 * 验收 35、36；docs/specs/workbench/views.md 输出 21、22）：用受限的测试视图 `test.sample-views.rail`（样例庚）。它在页面开关
 * `test.sample-views/with-rail` 为 "1" 时贡献、声明了视图段（缺省 260，范围 200 到 420，聊天下限 320），借到右轨时往 `main` 送三个会话按钮、
 * 往 `foot` 送一个，视图自己的内容写 `data-sample-rail`（借用状态）与 `data-sample-rail-expanded`。开关在插件创建时读，所以用 `addInitScript` 在加载前写。
 *
 * 元素标记约定见 `.agents/works/w00043-neurobot/tasks/t19-messages-view-ui-polish/plan.md` 的“测试分工”。
 * 后端：同 `workbench-side-rail.e2e.ts`（测试插件 `test.sample-views`、`test.project-view`，排除编辑器、设定与剧情插件），右栏是消息、样例丁、样例庚三个容器。
 *
 * 不在这里：浮动窗里的视图段与浮出、归位的过渡，消息视图自己的收着与展开（后面的片）。
 */

import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Locator, Page} from "@playwright/test";
import type {GridSnapshotNode} from "@notnotype/nb-layout";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {PROJECT_TEST_VIEW} from "nbook/shared/testing/project-view-contract";
import {SAMPLE_RAIL_BOUNDS, SAMPLE_VIEW_IDS, SAMPLE_VIEWS_RUN_EVENT, SAMPLE_VIEWS_SWITCHES} from "nbook/shared/testing/sample-views-contract";

import {startProbeServer} from "./fixtures";
import {pressEntry} from "./support/press-entry";
import {
    LEAF,
    barEntry,
    boxOf,
    cancelDrag,
    centerOf,
    dropFeedback,
    expectNoFeedback,
    focusStop,
    gapBetween,
    inLeaf,
    layoutWrites,
    leaf,
    moveTo,
    pickUp,
    rail,
    railCard,
    railEntries,
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
const D = SAMPLE_VIEW_IDS.delta;
const RAIL = SAMPLE_VIEW_IDS.rail;
const A = SAMPLE_VIEW_IDS.alpha;
/** 样例庚自己的隐式容器：记录里的展开意图按它记。 */
const RAIL_CONTAINER = `view:${RAIL}`;
/** 视图段声明的缺省展开宽度与上下限（卡片宽）。 */
const {width: DEFAULT_WIDTH, minimum: MIN_WIDTH, maximum: MAX_WIDTH} = SAMPLE_RAIL_BOUNDS;
/** 收着时的卡片宽。 */
const COLLAPSED_WIDTH = 48;

test.describe("产品页：右轨的视图段", () => {
    let tmp = "";
    let server: ProbeServer;

    test.beforeAll(async () => {
        tmp = await createTestTmpRoot("neuro-book-e2e", "workbench-side-rail-segment");
        await mkdir(join(tmp, "state"), {recursive: true});
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views,test.project-view", NBOOK_EXCLUDE_PLUGINS: "nbook.editor,nbook.canon,nbook.plot"}});
    });

    test.afterAll(async () => {
        expect(await server.stop()).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 1440, height: 900}});

    const database = (): string => join(tmp, "state", "storage", "user.sqlite");
    const saved = (page: Page) => savedDoc(page, database());
    const content = (page: Page, view: string) => page.locator(`[data-content="view:${view}"]`);
    const tab = (page: Page, view: string) => page.locator(`[data-panel-tab="view:${view}"]`);
    const regionToggle = (page: Page, region: "sidebar" | "auxiliarybar") => page.locator(`[data-titlebar-layout="${region}"]`);
    const panelToggle = (page: Page) => page.locator('[data-shell-focus-target="panel-toggle"]');
    const windows = (page: Page) => page.locator(`${LEAF}[data-float]`);
    /** 右栏挨着编辑区的那条边界。 */
    const auxiliarySash = (page: Page) => page.getByRole("separator", {name: /^调整 (?:center|g0) 与 \S+ 的宽度$/u});

    const expandButton = (page: Page): Locator => rail(page).locator("[data-rail-expand]");
    const handle = (page: Page): Locator => rail(page).locator("[data-rail-handle]");
    /** 样例庚自己的内容：借用状态与展开状态。 */
    const sampleRail = (page: Page): Locator => page.locator("[data-sample-rail]");
    const railItem = (page: Page, name: string): Locator => rail(page).locator(`[data-sample-rail-item="${name}"]`);
    const railWidth = async (page: Page): Promise<number> => (await boxOf(railCard(page))).width;
    const editorWidth = async (page: Page): Promise<number> => (await boxOf(leaf(page, "g0"))).width;

    /** 展开意图：记录里右栏锚上按容器记的 `rail`（输出 50 的“展开”）。 */
    const intentOf = async (page: Page): Promise<{expanded?: true; width?: number} | undefined> => (await saved(page))?.panels.auxiliarybar?.rail?.[RAIL_CONTAINER];

    /** 树里各节点的尺寸意图（拖分隔线才改这些，展开、轨宽不改）。 */
    async function sizesOf(page: Page): Promise<Record<string, string>> {
        const found: Record<string, string> = {};
        const walk = (node: GridSnapshotNode): void => {
            found[node.id] = JSON.stringify(node.size);
            if (node.kind === "branch") node.children.forEach(walk);
        };
        walk((await saved(page))!.tree.root);
        return found;
    }

    /**
     * 开页：样例庚开关在页面加载前写进 `localStorage`，右栏切到样例庚，等它的视图段借到右轨。每个用例一个新的浏览器上下文，客户端身份不同、布局记录互不影响。
     * 点样例庚的入口写一次记录，所以后面可以读到记录。
     */
    async function open(page: Page, options: {readonly bounds?: Readonly<Record<string, number>>} = {}): Promise<void> {
        await page.addInitScript(({switches}) => {
            for (const [key, value] of Object.entries(switches)) localStorage.setItem(key, value);
        }, {switches: {[SAMPLE_VIEWS_SWITCHES.withRail]: "1", ...(options.bounds === undefined ? {} : {[SAMPLE_VIEWS_SWITCHES.railBounds]: JSON.stringify(options.bounds)})}});
        await page.goto(new URL("/workbench", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(panelToggle(page)).toBeEnabled();
        await expect(barEntry(page, PROJECT_CONTAINER)).toHaveAttribute("aria-pressed", "true");
        await pressEntry(page, railEntryOfView(page, RAIL));
        await expect(railEntryOfView(page, RAIL)).toHaveAttribute("aria-pressed", "true");
        await expect(sampleRail(page)).toHaveAttribute("data-sample-rail", "rail");
        await expect(railSegment(page, "main")).toBeVisible();
    }

    /** 页面上经测试外壳执行一条命令：不碰指针与焦点。 */
    const runCommand = (page: Page, command: string, args: Readonly<Record<string, unknown>>): Promise<void> => page.evaluate(
        ({name, detail}) => void window.dispatchEvent(new CustomEvent(name, {detail})),
        {name: SAMPLE_VIEWS_RUN_EVENT, detail: {command, args}},
    );

    /** 两帧：布局的求解与呈现在下一帧才落到元素上。 */
    const settleFrames = (page: Page): Promise<unknown> => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    /** 点展开按钮并等右轨展开（卡片宽到缺省）。 */
    async function expand(page: Page): Promise<void> {
        await expandButton(page).click();
        await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
        await expect.poll(() => railWidth(page)).toBeCloseTo(DEFAULT_WIDTH, 0);
    }

    // 覆盖 ui/workbench-layout 输出 50“展开”“三段”与 workbench/views 输出 21：展开按钮展开右轨：状态、按钮、右轨卡片变宽、编辑区让出同样的宽、右栏的宽不变、视图收到展开；
    // 记录只写一次，按容器记在右栏的锚上；再点收起，回到原样，记录里这一项没了。
    test("点展开按钮：右轨展开到缺省宽，编辑区让出，右栏的宽不变，视图收到展开；再点收起，记录里的展开意图随之清掉（输出 50）", async ({page}) => {
        await open(page);
        await expect(rail(page)).toHaveAttribute("data-rail-state", "collapsed");
        await expect(expandButton(page)).toHaveAttribute("aria-expanded", "false");
        await expect(sampleRail(page)).toHaveAttribute("data-sample-rail-expanded", "false");
        await expect(handle(page)).toHaveCount(0);
        const section = leaf(page, await sectionOf(page, RAIL));
        const before = {rail: await railWidth(page), editor: await editorWidth(page), section: (await boxOf(section)).width};
        expect(before.rail).toBeCloseTo(COLLAPSED_WIDTH, 0);
        const writes = await settledWrites(page, database());

        await expandButton(page).click();
        await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
        await expect(expandButton(page)).toHaveAttribute("aria-expanded", "true");
        await expect(sampleRail(page)).toHaveAttribute("data-sample-rail-expanded", "true");
        await expect(page.locator("[data-sample-rail-list]")).toBeVisible();
        await expect(handle(page)).toHaveCount(1);
        await expect.poll(() => railWidth(page)).toBeCloseTo(DEFAULT_WIDTH, 0);
        // 编辑区让出展开多出来的宽；右栏分节的宽不变（聊天区宽度在编辑组让得出时不变）。
        await expect.poll(() => editorWidth(page)).toBeCloseTo(before.editor - (DEFAULT_WIDTH - COLLAPSED_WIDTH), 0);
        expect((await boxOf(section)).width).toBeCloseTo(before.section, 0);
        await expect.poll(() => layoutWrites(page, database())).toBe(writes + 1);
        expect(await intentOf(page)).toEqual({expanded: true});
        // 展开的列表有按钮的焦点：点展开按钮焦点留在按钮上。
        await expect(expandButton(page)).toBeFocused();

        await expandButton(page).click();
        await expect(rail(page)).toHaveAttribute("data-rail-state", "collapsed");
        await expect(expandButton(page)).toHaveAttribute("aria-expanded", "false");
        await expect(sampleRail(page)).toHaveAttribute("data-sample-rail-expanded", "false");
        await expect(handle(page)).toHaveCount(0);
        await expect.poll(() => railWidth(page)).toBeCloseTo(COLLAPSED_WIDTH, 0);
        await expect.poll(() => editorWidth(page)).toBeCloseTo(before.editor, 0);
        await expect.poll(() => layoutWrites(page, database())).toBe(writes + 2);
        expect(await intentOf(page)).toBeUndefined();
    });

    // 覆盖 ui/workbench-layout 输出 50“展开”：展开状态按容器记：样例庚展开着，切到别的容器时右轨按收着呈现、记录不改；切回来仍是展开。
    test("展开状态按容器记：切到没有视图段的容器时右轨按收着呈现、记录不改，切回样例庚仍是展开（输出 50）", async ({page}) => {
        await open(page);
        await expand(page);
        await pressEntry(page, railEntryOfView(page, D));
        await expect(railEntryOfView(page, D)).toHaveAttribute("aria-pressed", "true");
        await expect(rail(page)).toHaveAttribute("data-rail-state", "collapsed");
        await expect(expandButton(page)).toHaveCount(0);
        await expect(handle(page)).toHaveCount(0);
        await expect.poll(() => railWidth(page)).toBeCloseTo(COLLAPSED_WIDTH, 0);
        expect(await intentOf(page)).toEqual({expanded: true});

        await pressEntry(page, railEntryOfView(page, RAIL));
        await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
        await expect.poll(() => railWidth(page)).toBeCloseTo(DEFAULT_WIDTH, 0);
        await expect(sampleRail(page)).toHaveAttribute("data-sample-rail-expanded", "true");
    });

    // 覆盖 ui/workbench-layout 输出 50“预算”与验收 36：窗口窄下来，编辑组先让，让不出时右栏这次呈现成窄一点（不写意图），连聊天区压到下限也不够时按收着呈现、
    // 按钮写“窗口太窄”并带 `data-rail-too-narrow`、`aria-expanded=false`；窗口变宽自动恢复，布局记录里的展开意图一直不变。
    test("窗口窄到给不出展开的宽：先压右栏，再按收着呈现、按钮写“窗口太窄”；窗口变宽恢复，记录里的意图不改（验收 36；输出 50）", async ({page}) => {
        // 请求最大宽 420，下限与聊天下限放小：窗口窄下来时，“压右栏”这一段够宽，扫描一定落得进去。
        await open(page, {bounds: {width: MAX_WIDTH, minimum: MIN_WIDTH, maximum: MAX_WIDTH, chatMinimum: 200}});
        await expect(rail(page)).toHaveAttribute("data-rail-state", "collapsed");
        const section = leaf(page, await sectionOf(page, RAIL));
        const collapsedRight = (await boxOf(section)).width;
        await expandButton(page).click();
        await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
        await expect.poll(() => railWidth(page)).toBeCloseTo(MAX_WIDTH, 0);
        const intent = await intentOf(page);
        expect(intent?.expanded).toBe(true);
        const writes = await settledWrites(page, database());

        // 从 1440 一路收窄：每一步记下状态、右栏分节的宽与卡片宽。窗口窄到 640 以下时右栏整个让位（分节不在了），扫描停在 700。
        const rows: Array<{width: number; state: string | null; tooNarrow: boolean; expanded: string | null; right: number; card: number}> = [];
        for (let width = 1440; width >= 700; width -= 40) {
            await page.setViewportSize({width, height: 900});
            await settleFrames(page);
            await expect.poll(async () => (await boxOf(railCard(page))).width).toBeGreaterThan(0);
            const state = await rail(page).getAttribute("data-rail-state");
            rows.push({
                width,
                state,
                tooNarrow: (await expandButton(page).getAttribute("data-rail-too-narrow")) !== null,
                expanded: await expandButton(page).getAttribute("aria-expanded"),
                right: Math.round((await boxOf(section)).width),
                card: Math.round(await railWidth(page)),
            });
        }
        const log = JSON.stringify(rows);
        // 窗口够宽时：编辑区让出，右栏不变，卡片宽是请求的宽。
        expect(rows[0], log).toMatchObject({state: "expanded", right: Math.round(collapsedRight), card: MAX_WIDTH});
        // 中间：编辑组让到最小后右栏这次呈现成窄一点（预算压右栏，不写意图）；再窄时卡片宽按“48 加能让出的宽”给，不小于下限、不大于请求的宽。
        const squeezed = rows.filter((row) => row.state === "expanded" && row.right < Math.round(collapsedRight) - 1);
        expect(squeezed.length, log).toBeGreaterThan(0);
        for (const row of rows.filter((row) => row.state === "expanded")) {
            expect(row.card, log).toBeGreaterThanOrEqual(MIN_WIDTH);
            expect(row.card, log).toBeLessThanOrEqual(MAX_WIDTH);
        }
        // 最窄：按收着呈现，按钮写“窗口太窄”。
        const refused = rows.filter((row) => row.state === "collapsed");
        expect(refused.length, log).toBeGreaterThan(0);
        for (const row of refused) expect(row, log).toMatchObject({tooNarrow: true, expanded: "false", card: COLLAPSED_WIDTH});
        // 一旦给不出就不再回来（随窗口变窄单调）。
        const firstRefused = rows.findIndex((row) => row.state === "collapsed");
        expect(rows.slice(firstRefused).every((row) => row.state === "collapsed"), log).toBe(true);
        await expect(expandButton(page)).toHaveAttribute("aria-description", "窗口太窄");
        // 布局记录里的意图不因预算改变，期间零写入。
        expect(await intentOf(page)).toEqual(intent);
        expect(await layoutWrites(page, database())).toBe(writes);

        await page.setViewportSize({width: 1440, height: 900});
        await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
        await expect(expandButton(page)).not.toHaveAttribute("data-rail-too-narrow");
        await expect(expandButton(page)).toHaveAttribute("aria-expanded", "true");
        await expect.poll(async () => Math.round((await boxOf(section)).width)).toBe(Math.round(collapsedRight));
        expect(await intentOf(page)).toEqual(intent);
        expect(await layoutWrites(page, database())).toBe(writes);
    });

    // 覆盖 ui/workbench-layout 输出 50“轨宽手柄”：拖动跟手（卡片、aria-valuenow、编辑区一起变），触到上下限就停，松手只提交一次、只写轨宽。
    test("拖轨宽手柄：跟手、触界即停；拖动中零写入，松手一次提交且只写轨宽（输出 50）", async ({page}) => {
        await open(page);
        await expand(page);
        await expect(handle(page)).toHaveAttribute("role", "separator");
        await expect(handle(page)).toHaveAttribute("aria-valuenow", String(DEFAULT_WIDTH));
        await expect(handle(page)).toHaveAttribute("aria-valuemin", String(MIN_WIDTH));
        await expect(handle(page)).toHaveAttribute("aria-valuemax", String(MAX_WIDTH));
        const writes = await settledWrites(page, database());
        const sizes = await sizesOf(page);
        const editorBefore = await editorWidth(page);
        const start = await centerOf(handle(page));

        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        // 往左拖 60：轨宽加 60，编辑区少 60，拖动中零写入。
        await page.mouse.move(start.x - 60, start.y, {steps: 6});
        await expect(handle(page)).toHaveAttribute("aria-valuenow", String(DEFAULT_WIDTH + 60));
        await expect.poll(() => railWidth(page)).toBeCloseTo(DEFAULT_WIDTH + 60, 0);
        await expect.poll(() => editorWidth(page)).toBeCloseTo(editorBefore - 60, 0);
        expect(await layoutWrites(page, database())).toBe(writes);
        // 拖过上限：停在上限，再往左也不变。
        await page.mouse.move(start.x - 400, start.y, {steps: 6});
        await expect(handle(page)).toHaveAttribute("aria-valuenow", String(MAX_WIDTH));
        await expect.poll(() => railWidth(page)).toBeCloseTo(MAX_WIDTH, 0);
        await page.mouse.move(start.x - 500, start.y, {steps: 2});
        await expect(handle(page)).toHaveAttribute("aria-valuenow", String(MAX_WIDTH));
        // 往右拖过下限：停在下限。
        await page.mouse.move(start.x + 300, start.y, {steps: 8});
        await expect(handle(page)).toHaveAttribute("aria-valuenow", String(MIN_WIDTH));
        await expect.poll(() => railWidth(page)).toBeCloseTo(MIN_WIDTH, 0);
        expect(await layoutWrites(page, database())).toBe(writes);
        await page.mouse.up();

        await expect.poll(() => layoutWrites(page, database())).toBe(writes + 1);
        expect(await intentOf(page)).toEqual({expanded: true, width: MIN_WIDTH});
        // 只写轨宽：树里各节点的尺寸意图原样。
        expect(await sizesOf(page)).toEqual(sizes);
        await expect(handle(page)).toHaveAttribute("aria-valuenow", String(MIN_WIDTH));
        await expect.poll(() => railWidth(page)).toBeCloseTo(MIN_WIDTH, 0);
    });

    // 覆盖 ui/workbench-layout 输出 50“轨宽手柄”：Esc 取消整场手势：宽度回到按下时的值、零写入；手势结束后的松手不提交。
    test("拖轨宽手柄时按 Esc：整场取消，宽度回到按下时、零写入（输出 50）", async ({page}) => {
        await open(page);
        await expand(page);
        const writes = await settledWrites(page, database());
        const start = await centerOf(handle(page));
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x - 50, start.y, {steps: 5});
        await expect(handle(page)).toHaveAttribute("aria-valuenow", String(DEFAULT_WIDTH + 50));
        await page.keyboard.press("Escape");
        await expect(handle(page)).toHaveAttribute("aria-valuenow", String(DEFAULT_WIDTH));
        await expect.poll(() => railWidth(page)).toBeCloseTo(DEFAULT_WIDTH, 0);
        // 取消之后指针继续动、再松手也不改。
        await page.mouse.move(start.x - 90, start.y, {steps: 3});
        await page.mouse.up();
        await settleFrames(page);
        await expect(handle(page)).toHaveAttribute("aria-valuenow", String(DEFAULT_WIDTH));
        expect(await layoutWrites(page, database())).toBe(writes);
        expect(await intentOf(page)).toEqual({expanded: true});
    });

    // 覆盖 ui/workbench-layout 输出 50“轨宽手柄”：键盘方向键每次 10 像素（每次一次提交）、Home 与双击回缺省；`aria-valuenow` 随之变，焦点留在手柄上。
    test("轨宽手柄的键盘：方向键每次 10 像素，Home 与双击回缺省，每次一次提交，焦点留在手柄上（输出 50）", async ({page}) => {
        await open(page);
        await expand(page);
        await handle(page).focus();
        let writes = await settledWrites(page, database());
        const valueNow = async (): Promise<number> => Number(await handle(page).getAttribute("aria-valuenow"));
        const press = async (key: string, expected: number): Promise<void> => {
            await page.keyboard.press(key);
            await expect.poll(valueNow).toBe(expected);
            await expect.poll(() => railWidth(page)).toBeCloseTo(expected, 0);
            writes += 1;
            await expect.poll(() => layoutWrites(page, database())).toBe(writes);
            await expect(handle(page)).toBeFocused();
        };
        // 右轨的手柄在轨的左边：往左是变宽。两个方向各按一次，量到的是每次 10。
        await press("ArrowLeft", DEFAULT_WIDTH + 10);
        await press("ArrowLeft", DEFAULT_WIDTH + 20);
        expect(await intentOf(page)).toEqual({expanded: true, width: DEFAULT_WIDTH + 20});
        await press("ArrowRight", DEFAULT_WIDTH + 10);
        // Home 回缺省：缺省宽度时记录里不写 width。
        await press("Home", DEFAULT_WIDTH);
        expect(await intentOf(page)).toEqual({expanded: true});
        // 双击回缺省。
        await press("ArrowLeft", DEFAULT_WIDTH + 10);
        await handle(page).dblclick();
        await expect.poll(valueNow).toBe(DEFAULT_WIDTH);
        await expect.poll(() => layoutWrites(page, database())).toBe(writes + 1);
        expect(await intentOf(page)).toEqual({expanded: true});
        // 触到下限、上限就停：到顶后再按不变、不写。
        await handle(page).focus();
        for (let step = 0; step < 8; step += 1) await page.keyboard.press("ArrowRight");
        await expect.poll(valueNow).toBe(MIN_WIDTH);
        await page.keyboard.press("ArrowRight");
        await settleFrames(page);
        expect(await valueNow()).toBe(MIN_WIDTH);
    });

    // 覆盖 ui/workbench-layout 验收 35：展开、收起、拖轨宽、拖右栏与编辑区的分隔线、隐藏右栏、最大化别的面板各一次，每一步之后右栏的宽度意图不变
    // （只有轨宽手柄改 `rail` 的宽；拖分隔线只加上拖动的那一段），聊天区（右栏分节）的宽度在编辑组让得出时不变。
    test("意图不漂移：展开、收起、拖轨宽、隐藏右栏、最大化各一次，布局记录里右栏的宽度意图不变；拖分隔线只加上拖动的那一段（验收 35）", async ({page}) => {
        await open(page);
        const section = leaf(page, await sectionOf(page, RAIL));
        // 右栏的宽度意图：区域节点与它里面各分节的尺寸。别的节点（根、编辑区）的记录值随窗口与显隐的重算变，不是右栏的意图。
        // 只比宽度：高度随窗口与显隐重算（根节点的高度在隐藏右栏后也变），不是右栏的宽度意图。
        const intentOfRight = async (): Promise<Record<string, number>> => {
            const all = await sizesOf(page);
            return Object.fromEntries(Object.entries(all)
                .filter(([id]) => id === "auxiliarybar" || id === "region:auxiliarybar" || id.startsWith("section:test.sample-views.rail") || id === "section:nbook.agent.conversation" || id === "section:test.sample-views.delta")
                .map(([id, size]) => [id, (JSON.parse(size) as {width: number}).width]));
        };
        const sizes = await intentOfRight();
        expect(Object.keys(sizes).length).toBeGreaterThanOrEqual(4);
        const rightWidth = (await boxOf(section)).width;
        const unchanged = async (step: string): Promise<void> => {
            await settledWrites(page, database());
            expect(await intentOfRight(), `${step} 之后右栏的尺寸意图`).toEqual(sizes);
        };

        await expandButton(page).click();
        await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
        await unchanged("展开");
        expect((await boxOf(section)).width).toBeCloseTo(rightWidth, 0);

        const start = await centerOf(handle(page));
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x - 40, start.y, {steps: 4});
        await page.mouse.up();
        await expect.poll(async () => (await intentOf(page))?.width).toBe(DEFAULT_WIDTH + 40);
        await unchanged("拖轨宽");
        expect((await boxOf(section)).width).toBeCloseTo(rightWidth, 0);

        // 隐藏、显示右栏：区域的显隐不改尺寸意图。
        await regionToggle(page, "auxiliarybar").click();
        await expect.poll(async () => (await saved(page))?.panels.auxiliarybar?.hidden).toBe(true);
        await unchanged("隐藏右栏");
        await regionToggle(page, "auxiliarybar").click();
        await expect.poll(async () => (await saved(page))?.panels.auxiliarybar?.hidden).not.toBe(true);
        await unchanged("显示右栏");
        expect(await intentOf(page)).toEqual({expanded: true, width: DEFAULT_WIDTH + 40});

        // 最大化侧栏里的资源管理器再还原。
        const toggleMaximize = page.locator(`[data-panel-head="${await sectionOf(page, EXPLORER)}"] [data-panel-action="nbook.view.toggle-panel-maximized"]`);
        await toggleMaximize.click();
        await expect(toggleMaximize).toHaveAttribute("aria-pressed", "true");
        await toggleMaximize.click();
        await expect(toggleMaximize).toHaveAttribute("aria-pressed", "false");
        await unchanged("最大化");

        await expandButton(page).click();
        await expect(rail(page)).toHaveAttribute("data-rail-state", "collapsed");
        // 收起只清掉 expanded；轨宽是用户拖出来的，照记。
        await expect.poll(async () => (await intentOf(page))).toEqual({width: DEFAULT_WIDTH + 40});
        await unchanged("收起");
        expect((await boxOf(section)).width).toBeCloseTo(rightWidth, 0);

        // 拖右栏与编辑区的分隔线：意图只加上拖动的那一段，轨宽的意图不动。
        await expandButton(page).click();
        await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
        await expect.poll(async () => (await intentOf(page))).toEqual({expanded: true, width: DEFAULT_WIDTH + 40});
        await unchanged("再展开");
        const sash = await centerOf(auxiliarySash(page));
        await page.mouse.move(sash.x, sash.y);
        await page.mouse.down();
        await page.mouse.move(sash.x - 30, sash.y, {steps: 5});
        await page.mouse.up();
        await expect.poll(async () => Math.round((await boxOf(section)).width)).toBe(Math.round(rightWidth + 30));
        await settledWrites(page, database());
        // 只加上拖动的那一段：右栏区域与当前容器的这一节各加 30，别的节点（别的容器的分节、右栏的锚）不动。
        const dragged = await intentOfRight();
        expect(dragged, JSON.stringify({sizes, dragged})).toEqual({...sizes, "region:auxiliarybar": sizes["region:auxiliarybar"]! + 30, [`section:${RAIL}`]: sizes[`section:${RAIL}`]! + 30});
        // 轨宽的意图不因拖分隔线改变。
        expect(await intentOf(page)).toEqual({expanded: true, width: DEFAULT_WIDTH + 40});
    });

    // 覆盖 ui/workbench-layout 输出 42、50“切换容器”：两端有效轨宽相同时照输出 42 原地滚动：卡片与右轨不动，新容器从入口顺序的那一头进来（竖着）。
    test("切换容器（两端轨宽都是 48）：右轨不动，内容竖着滚过去，排在后面的从下面进来、排在前面的从上面进来（输出 42、50）", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        const ids = await railEntries(page).evaluateAll((elements) => elements.map((element) => element.getAttribute("data-tool-entry")!));
        expect(ids.indexOf(RAIL_CONTAINER)).toBeGreaterThan(ids.indexOf(`view:${D}`));
        await page.addStyleTag({content: ":root { --motion-layout: 6000ms !important; }"});
        const railBefore = await boxOf(railCard(page));

        const slice = (fraction: number) => page.evaluate((fraction) => {
            for (const animation of document.getAnimations()) {
                animation.pause();
                animation.currentTime = fraction * 6000;
            }
            const frames = [...document.querySelectorAll<HTMLElement>("[data-workbench-surface] > [data-grid-scope] > [data-leaf][data-swap]")];
            const top = (side: string) => frames.filter((frame) => frame.dataset.swap === side).map((frame) => frame.getBoundingClientRect().top);
            return {in: Math.min(...top("in")), out: Math.min(...top("out")), count: frames.length};
        }, fraction);
        const finish = () => page.evaluate(() => {
            for (const animation of document.getAnimations()) {
                if (animation.effect?.getComputedTiming().endTime === Number.POSITIVE_INFINITY) animation.play();
                else animation.finish();
            }
        });

        // 样例庚在样例丁之后：切到样例丁，样例丁从上面进来（in 在 out 之上）。
        await railEntryOfView(page, D).evaluate((button) => (button as HTMLElement).click());
        await settleFrames(page);
        const toDelta = await slice(0.3);
        expect(toDelta.count).toBeGreaterThan(1);
        expect(toDelta.in).toBeLessThan(toDelta.out);
        expect(await boxOf(railCard(page))).toEqual(railBefore);
        await expect(rail(page)).toHaveAttribute("data-rail-joined", "");
        await finish();
        await expect(page.locator("[data-workbench-surface] [data-swap]")).toHaveCount(0);

        // 再切回样例庚：它排在后面，从下面进来。
        await railEntryOfView(page, RAIL).evaluate((button) => (button as HTMLElement).click());
        await settleFrames(page);
        const toRail = await slice(0.3);
        expect(toRail.in).toBeGreaterThan(toRail.out);
        expect(await boxOf(railCard(page))).toEqual(railBefore);
        await finish();
        await expect(page.locator("[data-workbench-surface] [data-swap]")).toHaveCount(0);
        await expect(sampleRail(page)).toHaveAttribute("data-sample-rail", "rail");
    });

    // 覆盖 ui/workbench-layout 输出 50“切换容器”：两端有效轨宽不同（展开着的样例庚与收着的样例丁）时整次切换走一次布局过渡，入口的按下底块照常滑。
    test("切换容器（两端轨宽不同）：右轨宽度走一次布局过渡，按下的底块照常滑；切回来展开恢复（输出 50）", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        await expand(page);
        await page.addStyleTag({content: ":root { --motion-layout: 3000ms !important; }"});
        const indicator = rail(page).locator("[data-tool-indicator]");
        await page.evaluate(() => {
            const host = window as unknown as {__railProbe: {widths: number[]}};
            host.__railProbe = {widths: []};
            const sample = (): void => {
                const card = document.querySelector('[data-shell-card="rail:auxiliarybar"]');
                if (card !== null) host.__railProbe.widths.push(card.getBoundingClientRect().width);
                requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
        });
        await railEntryOfView(page, D).evaluate((button) => (button as HTMLElement).click());
        await expect(railEntryOfView(page, D)).toHaveAttribute("aria-pressed", "true");
        await expect(indicator).toHaveAttribute("data-sliding", "");
        await expect.poll(() => railWidth(page), {timeout: 10_000}).toBeCloseTo(COLLAPSED_WIDTH, 0);
        const probe = await page.evaluate(() => (window as unknown as {__railProbe: {widths: number[]}}).__railProbe);
        // 轨宽是过渡出来的：中间有大于 48、小于展开宽的帧。
        expect(probe.widths.some((width) => width > COLLAPSED_WIDTH + 2 && width < DEFAULT_WIDTH - 2), JSON.stringify(probe.widths)).toBe(true);

        await pressEntry(page, railEntryOfView(page, RAIL));
        await expect(rail(page)).toHaveAttribute("data-rail-state", "expanded");
        await expect.poll(() => railWidth(page), {timeout: 10_000}).toBeCloseTo(DEFAULT_WIDTH, 0);
    });

    // 覆盖 ui/workbench-layout 输出 50“焦点与读屏”、输出 22：右轨整条是一个 Tab 停靠（roving tabindex），上下方向键、Home、End 在条里走：入口、视图段的各项、底段、展开按钮按这个顺序。
    test("键盘：右轨整条一个 Tab 停靠，方向键、Home、End 在入口、视图段各项、底段、展开按钮之间走（输出 50）", async ({page}) => {
        await open(page);
        const items = rail(page).locator("[data-rail-item]");
        const total = await items.count();
        expect(total).toBeGreaterThanOrEqual(8);
        await expect(rail(page).locator('[data-rail-item][tabindex="0"]')).toHaveCount(1);
        await expect(rail(page).locator('[data-rail-item]:not([tabindex="0"])')).toHaveCount(total - 1);
        // 按下的入口（当前容器）是停靠项。
        const stop = rail(page).locator('[data-rail-item][tabindex="0"]');
        await expect(stop).toHaveAttribute("data-tool-entry", RAIL_CONTAINER);

        const nameOf = (): Promise<string> => page.evaluate(() => {
            const element = document.activeElement as HTMLElement | null;
            if (element === null) return "none";
            return element.dataset.toolEntry ?? (element.dataset.sampleRailItem !== undefined ? `item:${element.dataset.sampleRailItem}` : element.hasAttribute("data-sample-rail-foot") ? "foot" : element.hasAttribute("data-rail-expand") ? "expand" : element.hasAttribute("data-rail-handle") ? "handle" : element.tagName);
        });
        await stop.focus();
        await page.keyboard.press("Home");
        const first = await nameOf();
        expect(first).toBe((await railEntries(page).first().getAttribute("data-tool-entry"))!);
        const visited = [first];
        for (let step = 1; step < total; step += 1) {
            await page.keyboard.press("ArrowDown");
            visited.push(await nameOf());
        }
        expect(visited, JSON.stringify(visited)).toEqual([...(await railEntries(page).evaluateAll((elements) => elements.map((element) => element.getAttribute("data-tool-entry")!))), "item:一", "item:二", "item:三", "foot", "expand"]);
        await page.keyboard.press("Home");
        expect(await nameOf()).toBe(first);
        await page.keyboard.press("End");
        expect(await nameOf()).toBe("expand");
        await page.keyboard.press("ArrowUp");
        expect(await nameOf()).toBe("foot");
        // 停靠项跟着焦点走：整条仍只有一个 `tabindex=0`。
        await expect(rail(page).locator('[data-rail-item][tabindex="0"]')).toHaveCount(1);

        // Tab 走出右轨（一个停靠），Shift+Tab 回到右轨时落在上次的项上。
        await page.keyboard.press("Tab");
        expect(await focusStop(page)).not.toBe("rail:auxiliarybar");
        await page.keyboard.press("Shift+Tab");
        expect(await focusStop(page)).toBe("rail:auxiliarybar");
        expect(await nameOf()).toBe("foot");
    });

    // 覆盖 ui/workbench-layout 输出 22、50“焦点与读屏”：左轨（活动栏）同一个模型：整条一个 Tab 停靠，不再每个入口一个。
    test("键盘：左轨整条一个 Tab 停靠，上下方向键在入口之间走，Tab 走出左轨（输出 22、50）", async ({page}) => {
        await open(page);
        const items = rail(page, "sidebar").locator("[data-rail-item]");
        const total = await items.count();
        expect(total).toBeGreaterThanOrEqual(5);
        await expect(rail(page, "sidebar").locator('[data-rail-item][tabindex="0"]')).toHaveCount(1);
        await expect(rail(page, "sidebar").locator('[data-rail-item]:not([tabindex="0"])')).toHaveCount(total - 1);
        const stop = rail(page, "sidebar").locator('[data-rail-item][tabindex="0"]');
        await expect(stop).toHaveAttribute("data-tool-entry", PROJECT_CONTAINER);
        await stop.focus();
        await page.keyboard.press("ArrowDown");
        await expect(barEntry(page, `view:${A}`)).toBeFocused();
        await expect(rail(page, "sidebar").locator('[data-rail-item][tabindex="0"]')).toHaveCount(1);
        await page.keyboard.press("Home");
        await expect(barEntry(page, PROJECT_CONTAINER)).toBeFocused();
        await page.keyboard.press("Tab");
        expect(await focusStop(page)).not.toBe("rail:sidebar");
    });

    // 覆盖 ui/workbench-layout 输出 18、50：F6 把右轨当作一站：从右栏的分节按一次进右轨，再按一次离开右轨。
    test("F6：右轨是一站，进去一次、再按离开（输出 18、50）", async ({page}) => {
        await open(page);
        const section = await sectionOf(page, RAIL);
        await page.locator(`[data-content="view:${RAIL}"]`).evaluate((element) => (element.querySelector<HTMLElement>("[tabindex], button, input") ?? element).focus());
        // 从标题栏起走到右栏的分节，再按一次进右轨。
        await panelToggle(page).focus();
        for (let step = 0; step < 24 && await focusStop(page) !== section; step += 1) await page.keyboard.press("F6");
        expect(await focusStop(page)).toBe(section);
        await page.keyboard.press("F6");
        expect(await focusStop(page)).toBe("rail:auxiliarybar");
        await page.keyboard.press("F6");
        expect(await focusStop(page)).not.toBe("rail:auxiliarybar");
    });

    // 覆盖 ui/workbench-layout 输出 50“焦点与读屏”：焦点在视图段里的项上，视图段被撤回（右栏切到别的容器）时，焦点交给当前容器的入口或展开按钮，不掉到页面上。
    test("焦点交接：焦点在视图段的项上，视图段撤走时焦点留在右轨里，不掉到 body（输出 50）", async ({page}) => {
        await open(page);
        await railItem(page, "二").focus();
        await expect(railItem(page, "二")).toBeFocused();
        await runCommand(page, "nbook.view.open", {viewId: D});
        await expect(railEntryOfView(page, D)).toHaveAttribute("aria-pressed", "true");
        await expect(railItem(page, "二")).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => {
            const active = document.activeElement;
            return {inBody: active === null || active === document.body, inRail: active?.closest('[data-rail="auxiliarybar"]') !== null};
        })).toEqual({inBody: false, inRail: true});
        // 焦点交给当前容器的入口。
        await expect(railEntryOfView(page, D)).toBeFocused();
    });

    // 覆盖 ui/workbench-layout 输出 50“展开”：视图加载失败时布局记录里的展开意图不改，也没有加载骨架留下；视图自己显示失败与“重新加载”。
    test("视图加载失败：布局记录里的展开意图不改，没有加载骨架留着，视图区显示失败（输出 50）", async ({page}) => {
        await open(page);
        await expand(page);
        const intent = await intentOf(page);
        expect(intent).toEqual({expanded: true});
        await page.evaluate(({key, view}) => localStorage.setItem(key, view), {key: SAMPLE_VIEWS_SWITCHES.failLoad, view: RAIL});
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(railEntryOfView(page, RAIL)).toHaveAttribute("aria-pressed", "true");
        await expect(content(page, RAIL)).toContainText("视图加载失败");
        await expect(sampleRail(page)).toHaveCount(0);
        await expect(rail(page).locator("[data-rail-loading]")).toHaveCount(0);
        expect(await intentOf(page)).toEqual(intent);
    });

    // 覆盖 ui/workbench-layout 输出 50“展开”：视图加载中保留视图段的骨架（`data-rail-loading`），厚度不变。样例庚的加载是立刻完成的，没有办法让它停在“加载中”，
    // 所以这里只观察切换那一刻骨架有没有出现过（页面加载前装的变动监听记下）：出现过就核对它在视图段里，没出现过时只核对视图段随后借到。
    test("视图段加载中：骨架在视图段里，随后被视图的内容取代（输出 50）", async ({page}) => {
        await page.addInitScript(() => {
            const seen: Array<{inMain: boolean; width: number}> = [];
            (window as unknown as {__skeletons: typeof seen}).__skeletons = seen;
            new MutationObserver((records) => {
                for (const record of records) {
                    for (const node of record.addedNodes) {
                        if (!(node instanceof HTMLElement)) continue;
                        const skeleton = node.matches("[data-rail-loading]") ? node : node.querySelector<HTMLElement>("[data-rail-loading]");
                        if (skeleton !== null) seen.push({inMain: skeleton.closest('[data-rail-segment="main"]') !== null, width: skeleton.getBoundingClientRect().width});
                    }
                }
            }).observe(document, {subtree: true, childList: true});
        });
        await open(page);
        await expect(rail(page).locator("[data-rail-loading]")).toHaveCount(0);
        const seen = await page.evaluate(() => (window as unknown as {__skeletons: Array<{inMain: boolean; width: number}>}).__skeletons);
        for (const skeleton of seen) expect(skeleton.inMain).toBe(true);
        test.info().annotations.push({type: "skeleton-observed", description: String(seen.length)});
    });

    // 覆盖 ui/workbench-layout 输出 50“落点”：视图段与底段是拒绝区，松手是取消、不开新窗、零写入；同一个拖动在入口带上有落点（对照）。
    for (const segment of ["main", "foot"] as const) {
        test(`拖到样例庚借来的${segment === "main" ? "视图段" : "底段"}上松手是取消：没有落点指示、不开新窗、零写入（输出 50）`, async ({page}) => {
            await open(page);
            const writes = await settledWrites(page, database());
            const before = await railEntries(page).evaluateAll((elements) => elements.map((element) => element.getAttribute("data-tool-entry")));
            await pickUp(page, tab(page, EXPLORER));
            // 对照：同一个拖动在入口带两个入口之间有落点，换到视图段或底段上就没有了。
            await moveTo(page, await gapBetween(railEntries(page).nth(0), railEntries(page).nth(1)));
            await expect(dropFeedback(page)).toHaveAttribute("data-drop-kind", "new-container");
            await moveTo(page, await centerOf(railSegment(page, segment)));
            await expectNoFeedback(page);
            await expect(page.locator("[data-tool-merge]")).toHaveCount(0);
            await release(page);

            await expect(windows(page)).toHaveCount(0);
            expect(await layoutWrites(page, database())).toBe(writes);
            expect(await railEntries(page).evaluateAll((elements) => elements.map((element) => element.getAttribute("data-tool-entry")))).toEqual(before);
            await expect(tab(page, EXPLORER)).toBeVisible();
        });
    }

    // 覆盖 workbench/views 输出 22“位置限制”：别的视图拖进样例庚的容器（入口上、它那一节的前后半）没有落点，松手零写入；同一个拖动落在样例丁的入口上有落点（对照）。
    test("拖别的视图进样例庚的容器：入口上、分节上都没有落点，松手零写入（views 输出 22）", async ({page}) => {
        await open(page);
        const writes = await settledWrites(page, database());
        await pickUp(page, tab(page, EXPLORER));
        await moveTo(page, await centerOf(railEntryOfView(page, D)));
        await expect(dropFeedback(page)).toHaveAttribute("data-drop-kind", "join-container");
        await moveTo(page, await centerOf(railEntryOfView(page, RAIL)));
        await expectNoFeedback(page);
        await expect(page.locator("[data-tool-merge]")).toHaveCount(0);
        const section = await sectionOf(page, RAIL);
        for (const y of [0.85, 0.15]) {
            await moveTo(page, await inLeaf(page, section, {x: 0.5, y}));
            await expectNoFeedback(page);
        }
        await release(page);
        await expect(windows(page)).toHaveCount(0);
        expect(await layoutWrites(page, database())).toBe(writes);
        await expect(tab(page, EXPLORER)).toBeVisible();
    });

    // 覆盖 workbench/views 输出 22“位置限制”：样例庚只能停右栏，拖到左侧栏（活动栏入口之间、侧栏分节）或底部面板（入口条、分节）都没有落点，松手零写入；样例丁在同样的位置有落点（对照）。
    test("拖样例庚到左侧栏或底部面板：没有落点，松手零写入、不开窗（views 输出 22）", async ({page}) => {
        await open(page);
        // 底部面板默认隐藏：把资源管理器移进一个新容器，面板就显示了。
        await tab(page, EXPLORER).click({button: "right"});
        await page.getByRole("menuitem", {name: "新容器（底部面板）", exact: true}).click();
        await expect(page.getByRole("menu")).toHaveCount(0);
        const strip = page.locator('[data-region-strip="panel"]');
        await expect(strip).toBeVisible();
        const panelSection = await sectionOf(page, EXPLORER);
        const writes = await settledWrites(page, database());
        const barGap = () => gapBetween(barEntry(page, PROJECT_CONTAINER), barEntry(page, `view:${A}`));

        await pickUp(page, railEntryOfView(page, D));
        await moveTo(page, await barGap());
        await expect(dropFeedback(page)).toHaveAttribute("data-drop-kind", "move-container");
        await moveTo(page, await centerOf(strip));
        await expect(dropFeedback(page)).toHaveCount(1);
        await cancelDrag(page);
        expect(await layoutWrites(page, database())).toBe(writes);

        await pickUp(page, railEntryOfView(page, RAIL));
        for (const target of [
            await barGap(),
            await inLeaf(page, await sectionOf(page, SESSIONS), {x: 0.5, y: 0.85}),
            await centerOf(strip),
            await inLeaf(page, panelSection, {x: 0.5, y: 0.7}),
        ] satisfies Point[]) {
            await moveTo(page, target);
            await expectNoFeedback(page);
        }
        await release(page);
        await expect(windows(page)).toHaveCount(0);
        expect(await layoutWrites(page, database())).toBe(writes);
        await expect(railEntryOfView(page, RAIL)).toHaveCount(1);
    });

    // 覆盖 workbench/views 输出 22“位置限制”：样例庚浮出后只能是窗里唯一的标签，往它的窗加标签（窗的正文、窗顶）没有落点，松手零写入；别的浮动窗在同一个拖动下接得住（对照）。
    test("往样例庚的浮动窗加标签：没有落点，松手零写入、窗里仍是一个标签；别的浮动窗接得住（views 输出 22）", async ({page}) => {
        await open(page);
        const floatView = async (viewId: string): Promise<string> => {
            const before = await windows(page).count();
            await runCommand(page, "nbook.view.float", {tab: `view:${viewId}`});
            await expect(windows(page)).toHaveCount(before + 1);
            return sectionOf(page, viewId);
        };
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
        const deltaWindow = await floatView(D);
        await pickUp(page, tab(page, EXPLORER));
        await moveTo(page, await inside(deltaWindow));
        await expect(dropFeedback(page)).toHaveCount(1);
        await cancelDrag(page);

        const railWindow = await floatView(RAIL);
        const writes = await settledWrites(page, database());
        await pickUp(page, tab(page, EXPLORER));
        await moveTo(page, await inside(railWindow));
        await expectNoFeedback(page);
        const top = await boxOf(leaf(page, railWindow));
        await moveTo(page, {x: top.x + top.width / 2, y: top.y + 10});
        await expectNoFeedback(page);
        await release(page);

        expect(await layoutWrites(page, database())).toBe(writes);
        expect((await saved(page))?.panels[railWindow]?.tabs).toHaveLength(1);
        await expect(tab(page, EXPLORER)).toBeVisible();
    });

    // 覆盖 workbench/views 输出 22“位置限制”：所有改归属的操作在提交出口按当下文档判，命令直传（move-view）也拒绝：样例庚搬去别的区域或别的容器、
    // 别的视图搬进它的容器，零写入、布局记录不变。最后一条合法的命令（样例戊搬进底部面板的新容器）证明命令通道没坏，且写入只多这一条。
    test("命令直传也拒绝：把样例庚移进别的区域或别的容器、把别的视图移进它的容器，零写入、布局记录不变（views 输出 22）", async ({page}) => {
        await open(page);
        const before = (await saved(page))!;
        const [railSection, explorerSection] = [await sectionOf(page, RAIL), await sectionOf(page, EXPLORER)];
        const writes = await settledWrites(page, database());
        const rejected: Array<Readonly<Record<string, unknown>>> = [
            {viewId: RAIL, newContainerIn: "sidebar"},
            {viewId: RAIL, newContainerIn: "panel"},
            {viewId: RAIL, container: PROJECT_CONTAINER},
            {viewId: D, container: RAIL_CONTAINER},
            {viewId: EXPLORER, container: RAIL_CONTAINER},
        ];
        for (const args of rejected) await runCommand(page, "nbook.view.move-view", args);
        expect(await settledWrites(page, database()), "被拒的命令不写记录").toBe(writes);
        const unchangedDoc = (await saved(page))!;
        expect(unchangedDoc.panels[railSection]).toEqual(before.panels[railSection]);
        expect(unchangedDoc.panels[explorerSection]).toEqual(before.panels[explorerSection]);
        expect(unchangedDoc.panels.auxiliarybar).toEqual(before.panels.auxiliarybar);

        await runCommand(page, "nbook.view.move-view", {viewId: A, newContainerIn: "panel"});
        await expect(barEntry(page, `view:${A}`)).toHaveCount(0);
        await expect.poll(() => layoutWrites(page, database())).toBe(writes + 1);
        await expect(railEntryOfView(page, RAIL)).toHaveCount(1);
        await expect(tab(page, EXPLORER)).toBeVisible();
    });

    // 覆盖 workbench/views 输出 22“位置限制”：“移动到”菜单里没有这些目标：样例庚的菜单没有侧栏、底部面板的目标；别的视图的菜单没有样例庚的容器。
    test("“移动到”菜单：样例庚的菜单里没有侧栏、底部面板的目标，别的视图的菜单里没有样例庚（views 输出 22）", async ({page}) => {
        await open(page);
        await tab(page, RAIL).click({button: "right"});
        const menu = page.getByRole("menu");
        await expect(menu).toBeVisible();
        const own = await menu.getByRole("menuitem").allTextContents();
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
        for (const target of ["新容器（侧栏）", "新容器（底部面板）", "资源管理器", "样例甲", "样例乙", "样例丙", "样例戊"]) expect(own, JSON.stringify(own)).not.toContain(target);
        // 对照：资源管理器的菜单有这些目标（至少侧栏、底部面板的新容器），但没有样例庚。
        await tab(page, EXPLORER).click({button: "right"});
        await expect(menu).toBeVisible();
        const other = await menu.getByRole("menuitem").allTextContents();
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
        expect(other, JSON.stringify(other)).toContain("新容器（底部面板）");
        expect(other, JSON.stringify(other)).not.toContain("样例庚");
    });
});
