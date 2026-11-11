/**
 * 视图容器在真实 Chrome 中的验收（docs/specs/ui/workbench-layout.md 输出 22、41、42，验收 24、28、30）：切换容器、区域拖到零之后点入口、
 * 有容器之前存的记录回落。生产构建的后端与前端；侧栏除了内置容器“项目”（会话、资源管理器两个分节），再用测试插件
 * `test.sample-views` 的样例视图当别的容器（它们没写容器，各是自己的隐式容器）。等页面上可观察的变化，不按时长等待。
 *
 * 不在这里的：
 * - 活动栏入口的点击、按下态、溢出、右键菜单与键盘：`workbench-views.e2e.ts`；
 * - 搬容器带着什么、入口顺序、一次提交：`state/containers.test.ts`、`state/layout-doc-store.test.ts`；
 * - 拖入口、入口条上的落点（输出 45、46）：还没做（w00026 t24 切片 4）。
 */

import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {barRef, GRID_SNAPSHOT_VERSION, panelRef, validateLayoutDoc} from "@notnotype/nb-layout";
import type {GridSnapshotNode, LayoutDoc} from "@notnotype/nb-layout";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {CLIENT_IDENTITY_KEY} from "nbook/web/host/client-identity";

import {startProbeServer, startProductServer} from "./fixtures";
import type {ProbeServer, ProductServer} from "./fixtures";

const SESSIONS = "nbook.agent.sessions";
const EXPLORER = "nbook.explorer";
const CONVERSATION = "nbook.agent.conversation";
/** 内置容器“项目”：会话与资源管理器声明在它里面。 */
const PROJECT_CONTAINER = "nbook.workbench.project";
const A = "test.sample-views.alpha";
const B = "test.sample-views.beta";

/** 树里的叶外框：限定到外壳栅格的直接子级，编辑区自己的栅格里有同名的叶。 */
const LEAF = "[data-workbench-surface] > [data-grid-scope] > [data-leaf]";
const leaf = (page: Page, id: string) => page.locator(`${LEAF}[data-leaf="${id}"]`);
async function box(page: Page, id: string): Promise<{x: number; y: number; width: number; height: number}> {
    const found = await leaf(page, id).boundingBox();
    if (found === null) throw new Error(`没有 ${id} 的外框`);
    return found;
}

const content = (page: Page, view: string) => page.locator(`[data-content="view:${view}"]`);
/** 视图所在分节的面板 id：分节的 id 是布局起的（输出 40），按视图取，内容项上写着它所在的叶。 */
async function sectionOf(page: Page, view: string): Promise<string> {
    const id = await content(page, view).getAttribute("data-content-leaf");
    if (id === null) throw new Error(`${view} 不在任何面板里`);
    return id;
}
const tab = (page: Page, view: string) => page.locator(`[data-panel-tab="view:${view}"]`);
const collapseButton = (page: Page, view: string) => page.locator(`[data-panel-head]:has([data-panel-tab="view:${view}"]) [data-panel-action="nbook.view.set-panel-collapsed"]`);
/** 活动栏里一个容器的入口（输出 22）；样例视图的容器是 `view:<视图 id>`。 */
const entry = (page: Page, container: string) => page.locator(`[data-tool-entry="${container}"]`);
const pressedEntries = (page: Page) => page.locator('[data-tool-entry][aria-pressed="true"]');
/** 侧栏挨着编辑区的那条边界：侧栏这一侧显示一个分节时是那个分节，显示几个时是区域的分支，所以只认编辑区那一侧。 */
const sidebarSash = (page: Page) => page.getByRole("separator", {name: /^调整 \S+ 与 (?:center|g0) 的宽度$/u});

/** 记录里各节点的尺寸意图。 */
function intentsOf(doc: LayoutDoc): Record<string, {width: number; height: number}> {
    const found: Record<string, {width: number; height: number}> = {};
    const walk = (node: GridSnapshotNode): void => {
        found[node.id] = node.size;
        if (node.kind === "branch") node.children.forEach(walk);
    };
    walk(doc.tree.root);
    return found;
}

/** 本页客户端在这个库里存下的 `workbench.layout`；还没写过为 null。 */
async function savedIn(page: Page, database: string): Promise<{readonly id: number; readonly doc: LayoutDoc} | null> {
    const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
    if (client === null) throw new Error("页面还没有客户端身份");
    const db = new DatabaseSync(database);
    try {
        const row = db.prepare("SELECT rowid AS id, value FROM records WHERE owner = 'nbook.workbench' AND key = 'workbench.layout' AND client = ?1").get(client) as {id: number; value: string} | undefined;
        return row === undefined ? null : {id: Number(row.id), doc: (JSON.parse(row.value) as {doc: LayoutDoc}).doc};
    } finally {
        db.close();
    }
}

test.describe("切换容器与拖到零（验收 24、28）", () => {
    let tmp = "";
    let server: ProbeServer;

    test.beforeAll(async () => {
        tmp = await createTestTmpRoot("neuro-book-e2e", "workbench-containers");
        await mkdir(join(tmp, "state"), {recursive: true});
        // 样例插件自己贡献编辑区的内容，和产品的编辑器只能留一个；这里不看编辑器。
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views", NBOOK_EXCLUDE_PLUGINS: "nbook.editor"}});
    });

    test.afterAll(async () => {
        expect(await server.stop()).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 1440, height: 900}});

    const saved = async (page: Page): Promise<LayoutDoc | null> => (await savedIn(page, join(tmp, "state", "storage", "user.sqlite")))?.doc ?? null;
    const sample = (page: Page, view: string) => page.locator(`[data-sample-view="${view}"]`);

    /** 每个用例一个新的浏览器上下文：客户端身份不同，布局记录互不影响。默认布局里侧栏的当前容器是“项目”。 */
    async function open(page: Page): Promise<void> {
        await page.goto(new URL("/workbench", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(page.locator("[data-shell-focus-target=\"panel-toggle\"]")).toBeEnabled();
        await expect(entry(page, PROJECT_CONTAINER)).toHaveAttribute("aria-pressed", "true");
    }

    /** 右键分节的标题，在“移动到”里选目标（输出 23）。 */
    async function moveViaMenu(page: Page, view: string, target: string): Promise<void> {
        await tab(page, view).click({button: "right"});
        await page.getByRole("menu").getByRole("menuitem", {name: target, exact: true}).click();
        await expect(page.getByRole("menu")).toHaveCount(0);
    }

    test("切到别的容器再切回来：两个分节的先后、高度与收起都是原样，实例、输入与滚动保留；记录里的尺寸意图前后相同（验收 24；输出 42）", async ({page}) => {
        await open(page);
        // 搭一个两个分节的容器：样例乙移到右栏再移进侧栏，成为侧栏当前容器（样例甲的）最后一个分节（输出 23）。
        await entry(page, `view:${B}`).click();
        await expect(sample(page, B)).toBeVisible();
        await moveViaMenu(page, B, "右栏");
        // 乙的容器空了，侧栏切到入口顺序里它前面的那个容器（输出 43）：样例甲。
        await expect(entry(page, `view:${A}`)).toHaveAttribute("aria-pressed", "true");
        await moveViaMenu(page, B, "侧栏");
        await expect(sample(page, A)).toBeVisible();
        await expect(sample(page, B)).toBeVisible();
        await expect(entry(page, `view:${A}`)).toHaveAttribute("aria-pressed", "true");
        const [upper, lower] = [await sectionOf(page, A), await sectionOf(page, B)];
        expect((await box(page, upper)).y).toBeLessThan((await box(page, lower)).y);

        // 调过高度：两个分节之间的边界往下三步。
        const initial = (await box(page, upper)).height;
        await page.getByRole("separator", {name: `调整 ${upper} 与 ${lower} 的高度`, exact: true}).focus();
        for (let step = 0; step < 3; step += 1) await page.keyboard.press("ArrowDown");
        await expect.poll(async () => (await box(page, upper)).height).toBe(initial + 30);
        // 输入与滚动。
        const scroller = sample(page, A).locator("[data-sample-scroll]");
        await scroller.evaluate((element) => {
            element.scrollTop = 120;
        });
        expect(await scroller.evaluate((element) => element.scrollTop)).toBe(120);
        const input = sample(page, B).locator("input");
        await input.fill("乙的草稿");
        const instances = async () => [await sample(page, A).getAttribute("data-instance"), await sample(page, B).getAttribute("data-instance")];
        const before = await instances();
        // 一个收成标题行：样例乙。
        await collapseButton(page, B).click();
        await expect.poll(async () => (await box(page, lower)).height).toBe(32);
        await expect.poll(async () => (await saved(page))?.panels[lower]?.collapsed).toBe(true);
        const heights = async () => [(await box(page, upper)).height, (await box(page, lower)).height];
        const expected = await heights();
        const record = await saved(page);
        expect(record?.panels.sidebar).toMatchObject({activeContainer: `view:${A}`});
        const intents = intentsOf(record!);

        // 切到“项目”：样例甲那个容器的分节不显示，内容停放、不卸载；记录里只换了当前容器，尺寸意图没动。
        await entry(page, PROJECT_CONTAINER).click();
        await expect(tab(page, SESSIONS)).toBeVisible();
        await expect(tab(page, A)).toHaveCount(0);
        await expect(content(page, A)).toHaveAttribute("inert", "");
        await expect(pressedEntries(page)).toHaveCount(1);
        await expect.poll(async () => (await saved(page))?.panels.sidebar?.activeContainer).toBe(PROJECT_CONTAINER);
        expect(intentsOf((await saved(page))!)).toEqual(intents);
        expect(await instances()).toEqual(before);

        // 切回来：原样。
        await entry(page, `view:${A}`).click();
        await expect(sample(page, A)).toBeVisible();
        await expect.poll(heights).toEqual(expected);
        expect((await box(page, upper)).y).toBeLessThan((await box(page, lower)).y);
        await expect(collapseButton(page, B)).toHaveAttribute("aria-pressed", "true");
        await expect(collapseButton(page, A)).toHaveAttribute("aria-pressed", "false");
        expect(await instances()).toEqual(before);
        await expect(input).toHaveValue("乙的草稿");
        await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(120);
        await expect.poll(async () => (await saved(page))?.panels.sidebar?.activeContainer).toBe(`view:${A}`);
        const after = (await saved(page))!;
        expect(intentsOf(after)).toEqual(intents);
        expect(after.panels[lower]?.collapsed).toBe(true);
        expect(after.panels[upper]?.collapsed ?? false).toBe(false);
    });

    test("侧栏拖过最小宽度：整个侧栏为零宽，点入口展开，两个分节的高度原样；只有一个分节的容器拖到零后，点别的入口再点回来是展开的（验收 28；输出 11、22）", async ({page}) => {
        await open(page);
        const [sessions, explorer] = [await sectionOf(page, SESSIONS), await sectionOf(page, EXPLORER)];
        const width = (await box(page, sessions)).width;
        const heights = async () => [(await box(page, sessions)).height, (await box(page, explorer)).height];
        const expanded = await heights();
        const widths = async () => [(await box(page, sessions)).width, (await box(page, explorer)).width];

        // 把侧栏与编辑区之间的边界拖过最小宽度：两个分节一起到零宽，不是哪一个分节收成标题行。
        const sash = (await sidebarSash(page).boundingBox())!;
        const y = sash.y + sash.height / 2;
        await page.mouse.move(sash.x + sash.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(0, y, {steps: 8});
        await page.mouse.up();
        await expect.poll(widths).toEqual([0, 0]);
        await expect(pressedEntries(page)).toHaveCount(0);
        await expect.poll(async () => (await saved(page))?.panels.sidebar?.collapsed).toBe(true);
        expect((await saved(page))?.panels[sessions]?.collapsed ?? false).toBe(false);
        expect((await saved(page))?.panels[explorer]?.collapsed ?? false).toBe(false);

        // 点“项目”的入口：它是当前容器，侧栏拖到零，所以是展开（输出 22），不是隐藏。两个分节的高度原样。
        await entry(page, PROJECT_CONTAINER).click();
        await expect.poll(widths).toEqual([width, width]);
        await expect.poll(heights).toEqual(expanded);
        await expect(entry(page, PROJECT_CONTAINER)).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => (await saved(page))?.panels.sidebar?.collapsed ?? false).toBe(false);

        // 只有一个分节的容器是当前容器：拖到零记在区域上，不是把这个分节收成标题行。
        await entry(page, `view:${A}`).click();
        await expect(sample(page, A)).toBeVisible();
        const single = await sectionOf(page, A);
        await sidebarSash(page).focus();
        await page.keyboard.press("Enter");
        await expect.poll(async () => (await box(page, single)).width).toBe(0);
        await expect.poll(async () => (await saved(page))?.panels.sidebar?.collapsed).toBe(true);
        // 点另一个入口：切过去并展开。
        await entry(page, PROJECT_CONTAINER).click();
        await expect.poll(widths).toEqual([width, width]);
        await expect(tab(page, SESSIONS)).toBeVisible();
        // 再点回来：侧栏是展开的，这个分节也没有收成标题行。
        await entry(page, `view:${A}`).click();
        await expect(sample(page, A)).toBeVisible();
        await expect(entry(page, `view:${A}`)).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => (await box(page, single)).width).toBe(width);
        expect((await box(page, single)).height).toBeGreaterThan(32);
        await expect.poll(async () => (await saved(page))?.panels.sidebar).toMatchObject({activeContainer: `view:${A}`});
        expect((await saved(page))?.panels.sidebar?.collapsed ?? false).toBe(false);
        expect((await saved(page))?.panels[single]?.collapsed ?? false).toBe(false);
    });
});

test.describe("有容器之前存的记录（验收 30）", () => {
    let tmp = "";
    let projectDir = "";
    let server: ProductServer;

    test.beforeAll(async () => {
        tmp = await createTestTmpRoot("neuro-book-e2e", "workbench-containers-legacy");
        projectDir = join(tmp, "Book");
        const stateRoot = join(tmp, "state");
        const id = randomUUID();
        const files: Record<string, string> = {".nbook/project.json": JSON.stringify({schema: 1, id}), "notes/a.md": "第一章\n", "notes/b.md": "第二章\n"};
        await mkdir(join(projectDir, ".nbook"), {recursive: true});
        await mkdir(join(projectDir, "notes"), {recursive: true});
        for (const [path, text] of Object.entries(files)) await writeFile(join(projectDir, path), text);
        await mkdir(join(stateRoot, "user"), {recursive: true});
        await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
        server = await startProductServer(stateRoot);
    });

    test.afterAll(async () => {
        expect(await server.stop()).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 1440, height: 900}});

    /** 绑定了作品的窗口，布局记录在作品的分区里。 */
    const projectDatabase = (): string => join(projectDir, ".nbook", "storage.sqlite");
    const saved = (page: Page) => savedIn(page, projectDatabase());
    const labels = (page: Page) => page.locator("[data-editor-tab-label]");
    const diagnostics = (page: Page) => page.locator("[data-workbench-shell]").getAttribute("data-layout-diagnostics");

    async function open(page: Page): Promise<void> {
        await page.goto(new URL("/?project=book", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
        await expect(page.locator("[data-editor-group]").first()).toBeVisible();
        await expect(page.locator("[data-shell-focus-target=\"panel-toggle\"]")).toBeEnabled();
    }

    /**
     * 有容器之前的记录的样子：三片具名面板自己装着视图的标签（侧栏两个标签，右栏当时隐藏着），树里是这三片面板的叶；编辑组照 `editor` 抄。
     */
    function beforeContainers(current: LayoutDoc): LayoutDoc {
        const size = {width: 300, height: 300};
        const panel = (id: string): GridSnapshotNode => ({kind: "leaf", id, ref: panelRef(id), size});
        const editor = current.panels.g0;
        if (editor === undefined) throw new Error("记录里没有编辑组 g0");
        return {
            version: current.version,
            floats: [],
            hiddenBars: [],
            currentEditor: "g0",
            tree: {version: GRID_SNAPSHOT_VERSION, root: {kind: "branch", id: "root", orientation: "vertical", size, children: [
                {kind: "branch", id: "body", orientation: "horizontal", size, children: [
                    {kind: "leaf", id: "activitybar", ref: barRef("activitybar"), size},
                    panel("sidebar"),
                    {kind: "branch", id: "center", orientation: "vertical", size, children: [panel("g0"), panel("panel")]},
                    panel("auxiliarybar"),
                ]},
                {kind: "leaf", id: "statusbar", ref: barRef("statusbar"), size},
            ]}},
            panels: {
                sidebar: {role: "tool", name: "sidebar", tabs: [{kind: "view", viewId: EXPLORER}, {kind: "view", viewId: SESSIONS}], active: `view:${EXPLORER}`},
                auxiliarybar: {role: "tool", name: "auxiliarybar", tabs: [{kind: "view", viewId: CONVERSATION}], active: `view:${CONVERSATION}`, hidden: true},
                panel: {role: "tool", name: "panel", tabs: [], active: null, hidden: true},
                g0: editor,
            },
        };
    }

    test("侧栏上有标签的旧记录、编辑组里开着两个文件：显示默认布局，两个编辑器标签还在，外壳根有诊断，没有“布局未读”；改一下布局保存成功，刷新后是改过的（验收 30）", async ({page}) => {
        await open(page);
        await page.locator('[data-explorer-row="project://notes"]').click();
        await page.locator('[data-explorer-row="project://notes/a.md"]').dblclick();
        await page.locator('[data-explorer-row="project://notes/b.md"]').dblclick();
        // 作品第一次在本窗口打开时欢迎页也自动打开（workbench.bookshelf 输出 20）。关掉它，编辑组里只开着两个文件：
        // 页面标签留在记录里的话，恢复时编辑器把它从布局里拿掉，这是一次布局改动，诊断就跟着没了。
        await expect(labels(page)).toHaveText(["欢迎", "a.md", "b.md"]);
        const welcome = await page.locator("[data-editor-tab]", {hasText: "欢迎"}).getAttribute("data-editor-tab");
        await page.locator(`[data-editor-tab-close="${welcome ?? ""}"]`).click();
        await expect(labels(page)).toHaveText(["a.md", "b.md"]);
        await expect.poll(async () => (await saved(page))?.doc.panels.g0?.tabs.length).toBe(2);

        // 把这条记录换成有容器之前的样子，开着的两个编辑器标签照抄。
        const stored = (await saved(page))!;
        const legacy = beforeContainers(stored.doc);
        expect(validateLayoutDoc(legacy).ok).toBe(true);
        const db = new DatabaseSync(projectDatabase());
        try {
            db.prepare("UPDATE records SET value = ?1 WHERE rowid = ?2").run(JSON.stringify({doc: legacy}), stored.id);
        } finally {
            db.close();
        }
        await page.reload();
        await open(page);

        // 默认布局：侧栏是“项目”的两个分节，各有自己的头；记录里隐藏着的右栏不跟过来。两个编辑器标签还在。
        await expect(entry(page, PROJECT_CONTAINER)).toHaveAttribute("aria-pressed", "true");
        await expect(tab(page, SESSIONS)).toBeVisible();
        await expect(tab(page, EXPLORER)).toBeVisible();
        expect(await sectionOf(page, SESSIONS)).not.toBe(await sectionOf(page, EXPLORER));
        await expect(tab(page, CONVERSATION)).toBeVisible();
        await expect(labels(page)).toHaveText(["a.md", "b.md"]);
        // 外壳根有诊断；不算读不了，状态栏没有“布局未读”。
        await expect.poll(() => diagnostics(page)).toContain("布局记录不合骨架");
        await expect(page.locator("[data-workbench-status-bar]")).not.toContainText("布局未读");

        // 改一下布局：隐藏右栏。保存成功，记录是带容器的样子。
        await page.locator('[data-titlebar-layout="auxiliarybar"]').click();
        await expect(tab(page, CONVERSATION)).toHaveCount(0);
        // 旧记录里右栏本来就隐藏着：等的是新写下的记录（锚上有当前容器），不是右栏的隐藏。
        await expect.poll(async () => (await saved(page))?.doc.panels.sidebar?.activeContainer).toBe(PROJECT_CONTAINER);
        const rewritten = (await saved(page))!.doc;
        expect(rewritten.panels.sidebar).toMatchObject({tabs: [], activeContainer: PROJECT_CONTAINER});
        expect(rewritten.panels.auxiliarybar?.hidden).toBe(true);
        expect(rewritten.panels.g0?.tabs).toHaveLength(2);
        await expect(page.locator("[data-workbench-status-bar]")).not.toContainText("布局未读");
        await expect.poll(() => diagnostics(page)).not.toContain("布局记录不合骨架");

        // 刷新后是改过的布局。
        await page.reload();
        await open(page);
        await expect(tab(page, SESSIONS)).toBeVisible();
        await expect(tab(page, CONVERSATION)).toHaveCount(0);
        await expect(labels(page)).toHaveText(["a.md", "b.md"]);
        expect(await diagnostics(page)).not.toContain("布局记录不合骨架");
    });
});
