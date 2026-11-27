/**
 * 一棵树的拖放在真实 Chrome 中的验收（docs/specs/ui/workbench-layout.md 输出 24 到 32、45、验收 1 到 3；手势会话的细则见
 * docs/specs/ui/layout-drag.md）：生产构建的 e2e 测试外壳，测试插件 `test.sample-views` 贡献六个视图（侧栏甲乙丙、右栏丁、
 * 面板戊己）。指针手势用 Playwright 的真实鼠标，等页面上可观察的变化，不按时长等待。
 *
 * 每个样例视图没写容器，是自己的隐式容器里唯一的分节（输出 40、41）：侧栏显示甲、右栏显示丁、底部面板显示戊，乙、丙、己的分节在文档里、
 * 不显示。区域里的分节只写标题、恰一个标签（输出 20），整块是前后两半（输出 25 第 7 行）；带标签条、能添加为标签的只剩浮动窗
 * （输出 25 第 0 行、39），要标签条、中央的用例先搭一个浮动窗（`floatOfTwo`）。
 *
 * 不在这里的：
 * - 落点判定的逐行规则（`nb-workbench-layout` 的 `layout-drop.test.ts`）、会话的取消路径（Escape、失去指针捕获、窗口失焦、拖动中的按键归会话、
 *   触摸起拖）：`lab-drag-session.e2e.ts`；这里只留视图来源走一遍的一条（ui/layout-drag 验收 1、4）；
 * - 内容在面板之间滑动的组件级判据：`lab-grid-panels.e2e.ts`，这里只留产品页上的一条（验收 1）；
 * - 编辑器标签在编辑组之间的拖动（固定分区、多行、合并同一标签）：`editor-area.e2e.ts`，这个外壳的编辑器是样例，没有标签；
 * - 容器的验收（拖空切容器、结构键、入口上并入）：`workbench-containers.e2e.ts`。
 */

import {mkdir, rm, writeFile} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Locator, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {CLIENT_IDENTITY_KEY} from "nbook/web/host/client-identity";

import {startProbeServer} from "./fixtures";
import {pressEntry} from "./support/press-entry";
import type {ProbeServer} from "./fixtures";

const A = "test.sample-views.alpha";
const B = "test.sample-views.beta";
const C = "test.sample-views.gamma";
const D = "test.sample-views.delta";
const E = "test.sample-views.omega";
const F = "test.sample-views.zeta";

const ghost = (page: Page) => page.locator("[data-workbench-drag-ghost]");
const feedback = (page: Page) => page.locator("[data-drop-kind]");
const line = (page: Page) => page.locator("[data-drop-feedback-line]");
const area = (page: Page) => page.locator("[data-drop-feedback-area]");
const label = (page: Page) => page.locator("[data-drop-feedback-label]");

/** 树里的叶外框。视图内容在内容层里，和叶外框是兄弟元素，不在 `[data-leaf]` 里面（输出 14）。 */
const LEAF = "[data-workbench-surface] > [data-grid-scope] > [data-leaf]";
const leaf = (page: Page, id: string) => page.locator(`${LEAF}[data-leaf="${id}"]`);
/** 区域隐藏了：按拖到零画（ui/workbench-layout 输出 11），那块外框还在、缩到面积为零。等到零也就等过渡走完了。 */
const shrunk = (page: Page, id: string) => expect.poll(async () => {
    const found = await leaf(page, id).boundingBox();
    return found === null ? 0 : Math.round(found.width * found.height);
}).toBe(0);
const head = (page: Page, panel: string) => page.locator(`[data-panel-head="${panel}"]`);
/** 浮动窗头里放标签的那一段：松手在它空着的右端是“插到末尾”，不会落在框架按钮上。 */
const band = (page: Page, panel: string) => page.locator(`[data-panel-band="${panel}"]`);
/**
 * 视图的标题：头上的标题按钮。底部面板并成一行时头不写标题，按下的入口就是它的标题（右键开“移动到”、拖它就是拖这个视图，
 * docs/specs/ui/workbench-layout.md 输出 47）；只在没有标题按钮时取到它。
 */
const tab = (page: Page, viewId: string) => page.locator(`[data-panel-tab="view:${viewId}"], [data-region-strip="panel"] [data-tool-view="${viewId}"][aria-pressed="true"]`);
/** 只含这个视图的活动栏入口（输出 22、41：入口是容器的，只含一个视图的入口写着它的视图 id）。 */
const entry = (page: Page, viewId: string) => page.locator(`[data-rail=sidebar] [data-tool-band] [data-tool-view="${viewId}"]`);

const frame = (page: Page, panel: string, command: string) => head(page, panel).locator(`[data-panel-action="nbook.view.${command}"]`);
/** 分节的标题行是展开、收起的开关（输出 20）：能收起时标题按钮带 `aria-expanded`。 */
const fold = (page: Page, panel: string) => head(page, panel).locator("[data-panel-tab][aria-expanded]");
const sample = (page: Page, viewId: string) => page.locator(`[data-sample-view="${viewId}"]`);
const content = (page: Page, viewId: string) => page.locator(`[data-content="view:${viewId}"]`);
const shell = (page: Page) => page.locator("[data-workbench-shell]");
const sidebarSash = (page: Page) => page.getByRole("separator", {name: `调整 section:${A} 与 center 的宽度`});
/** 视图的隐式容器（输出 41）。 */
const implicit = (viewId: string): string => `view:${viewId}`;

async function centerOf(locator: Locator): Promise<{x: number; y: number}> {
    const found = await locator.boundingBox();
    if (found === null) throw new Error("元素没有盒子");
    return {x: found.x + found.width / 2, y: found.y + found.height / 2};
}

/** 浮动窗头的标签带右端、最后一个标签之后空着的一点：落在它上面是“插到这块面板的末尾”。 */
async function endOfStrip(page: Page, panel: string): Promise<{x: number; y: number}> {
    const found = await band(page, panel).boundingBox();
    if (found === null) throw new Error(`${panel} 没有标签带`);
    return {x: found.x + found.width - 10, y: found.y + found.height / 2};
}

/** 面板外框里的一点：横向、纵向各按比例（面板头占着上面 32px，比例按整块外框算）。 */
async function inLeaf(page: Page, panel: string, fraction: {x: number; y: number}): Promise<{x: number; y: number}> {
    const found = await leaf(page, panel).boundingBox();
    if (found === null) throw new Error(`没有 ${panel} 的外框`);
    return {x: found.x + found.width * fraction.x, y: found.y + found.height * fraction.y};
}

/** 一次完整的指针拖放：拖到 `to` 松手，等拖影消失。 */
async function dropAt(page: Page, source: Locator, to: {x: number; y: number}): Promise<void> {
    await dragTo(page, source, to);
    await page.mouse.up();
    await expect(ghost(page)).toHaveCount(0);
}

/** 按下源、移过门槛，再分几步移到 `to`：拖动在这一步之后进行中，由调用方决定松手还是取消。 */
async function dragTo(page: Page, source: Locator, to: {x: number; y: number}): Promise<void> {
    const from = await centerOf(source);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y + 10, {steps: 2});
    await expect(ghost(page)).toBeVisible();
    await page.mouse.move(to.x, to.y, {steps: 8});
}

/** 这块面板头里的标签键，按显示顺序（只写标题的头就是那一个）。 */
const tabsOf = (page: Page, panel: string): Promise<string[]> => head(page, panel).locator("[data-panel-tab]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-panel-tab")!));

/** 标签所在面板的 id（面板头上写着）。 */
const panelOfTab = (page: Page, viewId: string): Promise<string> => tab(page, viewId).evaluate((element) => element.closest<HTMLElement>("[data-panel-head]")!.dataset.panelHead!);

/**
 * 视图所在面板的 id：内容项上写着它所在的叶（输出 14）。分节在区域之间移动时是同一块面板，id 不变（输出 27），
 * 所以“落到了别处”按它在哪个区域判（`regionOf`），不按面板 id。
 */
async function sectionOf(page: Page, viewId: string): Promise<string> {
    const id = await content(page, viewId).getAttribute("data-content-leaf");
    if (id === null) throw new Error(`${viewId} 不在任何面板里`);
    return id;
}

/** 视图显示在哪个区域：按它的外框和编辑组 g0 的相对位置（侧栏在左、右栏在右、底部面板在下）；浮动窗是 float。 */
async function regionOf(page: Page, viewId: string): Promise<string> {
    const panel = await sectionOf(page, viewId);
    if (await page.locator(`${LEAF}[data-leaf="${panel}"][data-float]`).count() > 0) return "float";
    const [view, editor] = [await leaf(page, panel).boundingBox(), await leaf(page, "g0").boundingBox()];
    if (view === null || editor === null) throw new Error(`量不到 ${viewId} 或编辑组`);
    if (view.x + view.width <= editor.x + 1) return "sidebar";
    if (view.x >= editor.x + editor.width - 1) return "auxiliarybar";
    return "panel";
}

/** 右栏这一列的宽：编辑组 g0 的右沿到窗口右沿。右栏的锚不画（输出 40），区域空了就是 0。 */
async function auxiliaryWidth(page: Page): Promise<number> {
    const editor = await leaf(page, "g0").boundingBox();
    if (editor === null) throw new Error("没有编辑组");
    return (page.viewportSize()?.width ?? 0) - (editor.x + editor.width);
}

const instanceOf = (page: Page, viewId: string): Promise<string | null> => sample(page, viewId).getAttribute("data-instance");

/** 每按一次键等下一帧渲染完再读提示文字：键盘的落点是下一帧才画出来的。 */
const labelText = (page: Page): Promise<string> => page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    return document.querySelector("[data-drop-feedback-label]")?.textContent ?? "";
});

/** 活动栏上段的入口，从上到下：容器 id，用户拖出来的容器（`custom:<UUID>`，输出 41）写成 `custom`。 */
const entriesOf = (page: Page): Promise<string[]> => page.locator("[data-rail=sidebar] [data-tool-band] [data-tool-entry]").evaluateAll((elements) => elements.map((element) => {
    const id = element.getAttribute("data-tool-entry")!;
    return id.startsWith("custom:") ? "custom" : id;
}));
/** 入口上沿往下 3px：两个入口之间的空位，落在这里是“在这个入口之前”（输出 45）。 */
async function aboveEntry(page: Page, viewId: string): Promise<{x: number; y: number}> {
    const box = (await entry(page, viewId).boundingBox())!;
    return {x: box.x + box.width / 2, y: box.y + 3};
}

test.describe("产品页：拖放", () => {
    let tmp = "";
    let server: ProbeServer;

    test.beforeAll(async () => {
        tmp = await createTestTmpRoot("neuro-book-e2e", "workbench-dnd");
        await mkdir(join(tmp, "state"), {recursive: true});
        // 产品的资源管理器视图会占住侧栏：这里只看测试插件的视图。
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views", NBOOK_EXCLUDE_PLUGINS: "nbook.explorer,nbook.editor,nbook.agent,nbook.bots,nbook.canon,nbook.plot"}});
    });

    test.afterAll(async () => {
        expect(await server.stop()).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 1440, height: 900}});

    test.afterEach(async () => {
        // 用例自己写的设置不带到下一个用例。
        await rm(join(tmp, "state", "settings.json"), {force: true});
    });

    /**
     * 本页客户端对 `workbench.layout` 的写入次数：在测试库上装审计触发器，数 records 的插入与更新。只数本页客户端的这一条
     * 记录，不依赖修订号怎么分配（一次保存还会先写模板记录，修订号一次走两步），别的记录与客户端的写入也不混进来。触发器在
     * 第一次取基线时装上，所以基线要在手势之前取。一次手势一次写入（Spec“状态与转换”）。
     */
    /** 这块面板在已保存的布局里隐藏了吗。隐藏是合并着存的：等它落盘再数写入，否则这一笔算到后面的拖放头上。 */
    async function hiddenInRecord(page: Page, panel: string): Promise<boolean> {
        const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
        const db = new DatabaseSync(join(tmp, "state", "storage", "user.sqlite"));
        try {
            const row = db.prepare("SELECT value FROM records WHERE owner = 'nbook.workbench' AND key = 'workbench.layout' AND client = ?1").get(client) as {value: string} | undefined;
            return row !== undefined && (JSON.parse(row.value) as {doc: {panels: Record<string, {hidden?: boolean}>}}).doc.panels[panel]?.hidden === true;
        } finally {
            db.close();
        }
    }

    async function writesOf(page: Page): Promise<number> {
        const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
        const db = new DatabaseSync(join(tmp, "state", "storage", "user.sqlite"));
        try {
            db.exec(`
                CREATE TABLE IF NOT EXISTS e2e_writes (owner TEXT NOT NULL, key TEXT NOT NULL, client TEXT NOT NULL);
                CREATE TRIGGER IF NOT EXISTS e2e_writes_insert AFTER INSERT ON records BEGIN INSERT INTO e2e_writes VALUES (NEW.owner, NEW.key, NEW.client); END;
                CREATE TRIGGER IF NOT EXISTS e2e_writes_update AFTER UPDATE ON records BEGIN INSERT INTO e2e_writes VALUES (NEW.owner, NEW.key, NEW.client); END;
            `);
            const row = db.prepare("SELECT COUNT(*) AS count FROM e2e_writes WHERE owner = 'nbook.workbench' AND key = 'workbench.layout' AND client = ?1").get(client) as {count: number};
            return Number(row.count);
        } finally {
            db.close();
        }
    }

    /**
     * 搭场景的操作落库之后的写入次数。写入合并在一小段时间里落库（`LAYOUT_SAVE_COALESCE_MS`）：隔一段比它长的时间读到同一个数，
     * 才算搭场景的写入都落完了，之后的手势从这个数起算。
     */
    async function settledWrites(page: Page): Promise<number> {
        let seen = -1;
        await expect.poll(async () => {
            const now = await writesOf(page);
            const quiet = now === seen;
            seen = now;
            return quiet;
        }, {intervals: [400]}).toBe(true);
        return seen;
    }

    /** 本页客户端存下的布局文档里的面板表；还没写过为 null。 */
    async function savedDoc(page: Page): Promise<{panels: Record<string, {hidden?: boolean; collapsed?: boolean; active?: string | null; tabs: unknown[]}>} | null> {
        const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
        const db = new DatabaseSync(join(tmp, "state", "storage", "user.sqlite"));
        try {
            const row = db.prepare("SELECT value FROM records WHERE owner = 'nbook.workbench' AND key = 'workbench.layout' AND client = ?1").get(client) as {value: string} | undefined;
            return row === undefined ? null : (JSON.parse(row.value) as {doc: {panels: Record<string, {hidden?: boolean; collapsed?: boolean; tabs: unknown[]}>}}).doc;
        } finally {
            db.close();
        }
    }

    async function open(page: Page): Promise<void> {
        await page.goto(new URL("/workbench", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(page.locator("[data-shell-focus-target=\"panel-toggle\"]")).toBeEnabled();
    }

    /** 经分节标题的右键菜单浮动一个视图（输出 23），返回窗的面板 id。 */
    async function floatViaMenu(page: Page, viewId: string): Promise<string> {
        await tab(page, viewId).click({button: "right"});
        await page.getByRole("menu").getByRole("menuitem", {name: "浮动", exact: true}).click();
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect.poll(() => regionOf(page, viewId)).toBe("float");
        return sectionOf(page, viewId);
    }

    /**
     * 搭一个戊、己两个标签的浮动窗，返回它的面板 id：带标签条的只剩浮动窗（输出 20、39）。戊浮出来之后底部面板切到己的容器
     * （输出 43），己的标题放到窗的正文上是添加为标签（输出 25 第 0 行），放下己是活动标签。
     */
    async function floatOfTwo(page: Page): Promise<string> {
        const window = await floatViaMenu(page, E);
        await expect(tab(page, F)).toBeVisible();
        // 戊的容器空了，底部面板切到己（输出 43）；开着动效时己那一节还在滑进来，等它停下再按，不然按在移动中的标题上。
        await expect(page.locator("[data-moving]")).toHaveCount(0);
        await dropAt(page, tab(page, F), await inLeaf(page, window, {x: 0.5, y: 0.6}));
        await expect.poll(() => tabsOf(page, window)).toEqual([`view:${E}`, `view:${F}`]);
        return window;
    }

    test("活动栏入口拖到浮动窗的标签条：拖动中源不动、有拖影与一条插入线；松手视图迁到窗里并激活，只写一次（输出 24、25 第 0 行、26、30、46；验收 1）", async ({page}) => {
        await open(page);
        const window = await floatOfTwo(page);
        const source = entry(page, C);
        const before = await source.boundingBox();
        const windowTabs = await tabsOf(page, window);
        const writes = await settledWrites(page);
        await dragTo(page, source, await endOfStrip(page, window));
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "strip");
        await expect(line(page)).toBeVisible();
        // 拖动源原地不动、尺寸不变（WorkbenchDragFeedback 的样式意图：按钮按下的缩放在拖动开始后撤掉）；用软断言，失败也让后面的判据照常跑。
        expect.soft(await source.boundingBox()).toEqual(before);
        expect(await writesOf(page)).toBe(writes);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect(head(page, window).locator(`[data-panel-tab="view:${C}"]`)).toHaveAttribute("aria-selected", "true");
        expect(await tabsOf(page, window)).toEqual([...windowTabs, `view:${C}`]);
        await expect(sample(page, C)).toBeVisible();
        // 丙是它的隐式容器唯一的成员：容器空了就没有入口（输出 41）。
        await expect(entry(page, C)).toHaveCount(0);
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test("浮动窗的一个标签拖到分节的后半：成为新分节，预览是那一半且等于提交的矩形；分节的标签拖走它就移除（输出 25 第 7 行、27、30、3；验收 2）", async ({page}, testInfo) => {
        await open(page);
        const window = await floatOfTwo(page);
        const delta = await sectionOf(page, D);
        const deltaBefore = (await leaf(page, delta).boundingBox())!;
        const count = Number(await shell(page).getAttribute("data-panel-count"));
        const writes = await settledWrites(page);
        // 右栏这一列只上下分：落在丁那一节的下半是后半，在它后面插一节，新的一节取它的一半（输出 27 的 half）。
        await dragTo(page, tab(page, F), await inLeaf(page, delta, {x: 0.5, y: 0.9}));
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "edge");
        await expect(area(page)).toBeVisible();
        const preview = (await area(page).boundingBox())!;
        expect(preview.y).toBeGreaterThanOrEqual(deltaBefore.y + deltaBefore.height / 2 - 8);
        expect(await writesOf(page)).toBe(writes);
        await page.screenshot({path: testInfo.outputPath("section-half.png")});
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect(shell(page)).toHaveAttribute("data-panel-count", String(count + 1));
        const created = await sectionOf(page, F);
        expect(created).not.toBe(delta);
        expect(await regionOf(page, F)).toBe("auxiliarybar");
        expect(await tabsOf(page, window)).toEqual([`view:${E}`]);
        // 预览是区域矩形四边内缩 6px 画出来的，提交后新块的外框就是那个矩形。
        const final = (await leaf(page, created).boundingBox())!;
        expect(Math.abs(preview.x - final.x - 6)).toBeLessThan(2);
        expect(Math.abs(preview.y - final.y - 6)).toBeLessThan(2);
        expect(Math.abs(preview.width - final.width + 12)).toBeLessThan(2);
        expect(Math.abs(preview.height - final.height + 12)).toBeLessThan(2);
        await expect.poll(() => writesOf(page)).toBe(writes + 1);

        // 分节的标签被拖走，分节移除（输出 3）：己放回浮动窗的正文，新的一节消失。
        await dropAt(page, tab(page, F), await inLeaf(page, window, {x: 0.5, y: 0.6}));
        await expect(shell(page)).toHaveAttribute("data-panel-count", String(count));
        await expect(leaf(page, created)).toHaveCount(0);
        expect(await tabsOf(page, window)).toEqual([`view:${E}`, `view:${F}`]);
    });

    test("分节拖到底部面板一节的前半：是同一块面板在整块移动，面板 id 与内容实例都不变；右栏空了，锚隐藏（输出 27、43；验收 10）", async ({page}) => {
        await open(page);
        const instance = await instanceOf(page, D);
        const delta = await sectionOf(page, D);
        const omega = await sectionOf(page, E);
        // 面板这一排左右分：戊那一节的左半是前半。
        await dropAt(page, tab(page, D), await inLeaf(page, omega, {x: 0.08, y: 0.6}));
        await expect.poll(() => regionOf(page, D)).toBe("panel");
        expect(await sectionOf(page, D)).toBe(delta);
        // 右栏一个容器都没有了：锚隐藏，编辑组占到窗口右沿（输出 43）。
        await expect.poll(() => auxiliaryWidth(page)).toBeLessThan(2);
        await expect.poll(async () => (await savedDoc(page))?.panels.auxiliarybar?.hidden).toBe(true);
        const moved = (await leaf(page, delta).boundingBox())!;
        const neighbour = (await leaf(page, omega).boundingBox())!;
        expect(moved.x + moved.width).toBeLessThanOrEqual(neighbour.x + 2);
        expect(Math.abs(moved.y - neighbour.y)).toBeLessThan(2);
        await expect(sample(page, D)).toBeVisible();
        expect(await instanceOf(page, D)).toBe(instance);

        // 同一排里换位置也是整块移动：拖到戊那一节的后半，id 不变，面板数不变。
        const count = await shell(page).getAttribute("data-panel-count");
        await dropAt(page, tab(page, D), await inLeaf(page, omega, {x: 0.92, y: 0.6}));
        await expect(shell(page)).toHaveAttribute("data-panel-count", count ?? "");
        expect(await sectionOf(page, D)).toBe(delta);
        await expect.poll(async () => (await leaf(page, delta).boundingBox())!.x).toBeGreaterThan((await leaf(page, omega).boundingBox())!.x);
        await expect(sample(page, D)).toBeVisible();
        expect(await instanceOf(page, D)).toBe(instance);
    });

    test("松手在源自己身上或原处：显示“原位”、不提交，也不触发那一下点击（输出 28；验收 3）", async ({page}) => {
        await open(page);
        let writes = await writesOf(page);
        // 分节放到自己身上：结构、归属、当前容器都不变。
        const own = tab(page, E);
        await dragTo(page, own, await centerOf(own));
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "noop");
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        expect(await writesOf(page)).toBe(writes);

        // 浮动窗里的激活标签放回自己的位置：结构、顺序、活动标签都不变；那一下点击被吞了，没有激活别的标签；之后的普通点击照常激活。
        const window = await floatOfTwo(page);
        await tab(page, F).click();
        await expect(tab(page, F)).toHaveAttribute("aria-selected", "true");
        writes = await settledWrites(page);
        await dragTo(page, tab(page, F), await centerOf(tab(page, F)));
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "noop");
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect(tab(page, F)).toHaveAttribute("aria-selected", "true");
        await expect(tab(page, E)).toHaveAttribute("aria-selected", "false");
        expect(await tabsOf(page, window)).toEqual([`view:${E}`, `view:${F}`]);
        expect(await writesOf(page)).toBe(writes);
        await tab(page, E).click();
        await expect(tab(page, E)).toHaveAttribute("aria-selected", "true");
        await expect.poll(() => writesOf(page)).toBe(writes + 1);

        // 验收 3：丁放到甲那一节的后半，同一列里两节；再把丁放到甲朝向它的那一半，结果和现在一样，什么都不提交。
        const alpha = await sectionOf(page, A);
        await dropAt(page, tab(page, D), await inLeaf(page, alpha, {x: 0.5, y: 0.9}));
        await expect.poll(() => regionOf(page, D)).toBe("sidebar");
        const delta = await sectionOf(page, D);
        const next = await settledWrites(page);
        const instance = await instanceOf(page, D);
        await dragTo(page, tab(page, D), await inLeaf(page, alpha, {x: 0.5, y: 0.9}));
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "noop");
        await expect(label(page)).toContainText("原位");
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        expect(await writesOf(page)).toBe(next);
        expect(await instanceOf(page, D)).toBe(instance);
        expect(await sectionOf(page, D)).toBe(delta);
    });

    test("键盘：浮动窗的标签上空格拿起，方向键逐个位置移动插入位（激活标签不变），Enter 只提交一次，焦点回到标签（输出 31；验收 9）", async ({page}) => {
        await open(page);
        const window = await floatOfTwo(page);
        await tab(page, E).click();
        const writes = await settledWrites(page);
        const source = tab(page, E);
        await expect(source).toHaveAttribute("aria-selected", "true");
        await source.focus();
        await page.keyboard.press("Space");
        await expect(ghost(page)).toBeVisible();
        // 拿起时停在原位：原位，带“原位”提示。
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "noop");
        // 方向键逐个位置往后：先经过自己后面的位置（还是原位），再到己的后面。
        for (let step = 0; step < 4 && (await feedback(page).getAttribute("data-drop-kind")) === "noop"; step += 1) {
            await page.keyboard.press("ArrowRight");
            await labelText(page);
        }
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "strip");
        await expect(tab(page, F)).toHaveAttribute("aria-selected", "false");
        expect(await writesOf(page)).toBe(writes);
        await page.keyboard.press("Enter");
        await expect(ghost(page)).toHaveCount(0);
        expect(await tabsOf(page, window)).toEqual([`view:${F}`, `view:${E}`]);
        await expect(source).toBeFocused();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test("键盘：分节的标题、活动栏入口、侧栏的标题各拿起一次；Tab 在区域之间循环，仍在拖动、没有写入；Escape 只取消，焦点回到来源（输出 31；验收 9）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const sources = [entry(page, A), tab(page, D), tab(page, E), tab(page, A)];
        for (const source of sources) {
            await source.focus();
            await page.keyboard.press("Space");
            await expect(ghost(page)).toBeVisible();
            // 区域：活动栏、三个区域的分节；工具视图没有编辑组这一站。循环一圈回到起点。
            for (let step = 0; step < 4; step += 1) {
                await page.keyboard.press("Tab");
                await expect(ghost(page)).toBeVisible();
            }
            await page.keyboard.press("Shift+Tab");
            await expect(ghost(page)).toBeVisible();
            expect(await writesOf(page)).toBe(writes);
            await page.keyboard.press("Escape");
            await expect(ghost(page)).toHaveCount(0);
            await expect(source).toBeFocused();
        }
        expect(await writesOf(page)).toBe(writes);
    });

    test("键盘：单个分节拿起后 Tab 能绕回第一个区域；从活动栏入口拿起也提示原位（输出 28、31、45；验收 9）", async ({page}) => {
        await open(page);
        // 这一刻的落点。可能没有落点，不用会等元素出现的定位器。
        const signature = (): Promise<string> => page.evaluate(() => {
            // 区域、插入线各取位置：两条入口条的第一个位置种类与文字相同，要靠线的位置分开。
            const box = document.querySelector("[data-drop-feedback-area]")?.getBoundingClientRect();
            const mark = document.querySelector("[data-drop-feedback-line]")?.getBoundingClientRect();
            const label = document.querySelector("[data-drop-feedback-label]")?.textContent ?? "";
            const at = (rect: DOMRect | undefined) => (rect === undefined ? "" : `${String(Math.round(rect.x))},${String(Math.round(rect.y))},${String(Math.round(rect.width))}`);
            return `${document.querySelector("[data-drop-kind]")?.getAttribute("data-drop-kind") ?? ""}|${at(box)}|${at(mark)}|${label}`;
        });
        // 右栏只有丁这一节：它自己的区域只有原位，以前这块区域是空的，Tab 走到它就卡住。
        // 区域有活动栏与两条入口条、各块面板和“浮动”，按 16 次足够绕回第一个。
        await tab(page, D).focus();
        await page.keyboard.press("Space");
        await expect(ghost(page)).toBeVisible();
        const seen: string[] = [];
        for (let step = 0; step < 16; step += 1) {
            await page.keyboard.press("Tab");
            await expect(ghost(page)).toBeVisible();
            seen.push(await signature());
        }
        const cycle = seen.slice(1).indexOf(seen[0]!) + 1;
        expect(cycle).toBeGreaterThan(1);
        // 一圈里每个区域只停一次：多列、重复列了区域时一圈里会有重复的落点。
        expect(new Set(seen.slice(0, cycle)).size).toBe(cycle);
        await page.keyboard.press("Escape");
        await expect(ghost(page)).toHaveCount(0);

        // 甲是侧栏里它那个容器唯一的视图：拿起时停在自己的入口上，是原处（输出 45）。
        await entry(page, A).focus();
        await page.keyboard.press("Space");
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "noop");
        await expect(label(page)).toContainText("原位");
        await page.keyboard.press("Escape");
    });

    test("键盘：分节的前后两半是落点，隐藏的区域不是（输出 29、31）", async ({page}) => {
        await open(page);
        // 分节没有隐藏按钮，隐藏是区域的事（输出 20）：用标题栏的布局按钮隐藏右栏。
        const delta = await sectionOf(page, D);
        await page.locator("[data-titlebar-layout=\"auxiliarybar\"]").click();
        await shrunk(page, delta);
        await tab(page, E).focus();
        await page.keyboard.press("Space");
        // 走遍区域与位置：分节的位置里要有前后两半（`edge`）。隐藏的右栏没有呈现，量不出位置，不是键盘的区域；走完、取消后它还隐藏着。
        const kinds = new Set<string>();
        for (let region = 0; region < 6; region += 1) {
            await page.keyboard.press("Tab");
            for (let stop = 0; stop < 5; stop += 1) {
                kinds.add(await page.evaluate(() => document.querySelector("[data-drop-kind]")?.getAttribute("data-drop-kind") ?? ""));
                await page.keyboard.press("ArrowRight");
            }
        }
        expect(kinds.has("edge")).toBe(true);
        await page.keyboard.press("Escape");
        await expect(ghost(page)).toHaveCount(0);
        await shrunk(page, delta);
    });

    test("拖影有图标与文字；经过浮动窗的标签条只有一条插入线，没有接收区域与入口高亮（输出 30）", async ({page}, testInfo) => {
        await open(page);
        const window = await floatOfTwo(page);
        await dragTo(page, tab(page, D), await endOfStrip(page, window));
        await expect(ghost(page)).toContainText("样例丁");
        await expect(ghost(page).locator("[class*='i-lucide-']")).toHaveCount(1);
        await expect(line(page)).toHaveCount(1);
        await expect(area(page)).toHaveCount(0);
        await expect(page.locator("[data-drop-feedback-entry]")).toHaveCount(0);
        await page.screenshot({path: testInfo.outputPath("strip-line.png")});
        await page.mouse.up();
        await expect(head(page, window).locator(`[data-panel-tab="view:${D}"]`)).toHaveAttribute("aria-selected", "true");
        await expect(sample(page, D)).toBeVisible();
    });

    test("收成标题行的分节：落在它的标题行上是前半，在它前面插一节，它自己还收着（输出 11、25 第 7 行、40）", async ({page}) => {
        await open(page);
        // 容器里有两节才能收起：先把丁放到甲那一节的后半。
        const alpha = await sectionOf(page, A);
        await dropAt(page, tab(page, D), await inLeaf(page, alpha, {x: 0.5, y: 0.9}));
        await expect.poll(() => regionOf(page, D)).toBe("sidebar");
        await fold(page, alpha).click();
        await expect.poll(async () => (await leaf(page, alpha).boundingBox())!.height).toBe(32);
        // 往区域里放视图只新建分节，不并进已有的分节（输出 40）：乙在甲的前面成一节，甲还是收着的。
        await dropAt(page, entry(page, B), await centerOf(head(page, alpha)));
        await expect.poll(() => regionOf(page, B)).toBe("sidebar");
        await expect(sample(page, B)).toBeVisible();
        const [beta, collapsed] = [(await leaf(page, await sectionOf(page, B)).boundingBox())!, (await leaf(page, alpha).boundingBox())!];
        expect(beta.y).toBeLessThan(collapsed.y);
        expect(collapsed.height).toBe(32);

        // 键盘：键盘的区域一节一个，按树序（乙、甲、丁）。收着的甲只有“前”一个停靠点，在它上面 Enter，戊落在乙和甲之间（输出 31）；
        // 停靠点不能借正文外缘的点，收着的正文是零高，往里 2px 已经是下一节。
        const column = {left: collapsed.x, right: collapsed.x + collapsed.width};
        const inColumn = (): Promise<boolean> => page.evaluate(async ({left, right}) => {
            await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
            const shown = [...document.querySelectorAll("[data-drop-feedback-area], [data-drop-feedback-line]")].map((element) => element.getBoundingClientRect()).find((rect) => rect.width > 0 || rect.height > 0);
            return shown !== undefined && shown.left + shown.width / 2 >= left && shown.left + shown.width / 2 <= right;
        }, column);
        await tab(page, E).focus();
        await page.keyboard.press("Space");
        await expect(ghost(page)).toBeVisible();
        for (let region = 0; region < 8 && !(await inColumn()); region += 1) await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        await page.keyboard.press("Enter");
        await expect(ghost(page)).toHaveCount(0);
        await expect.poll(() => regionOf(page, E)).toBe("sidebar");
        const [above, placed, still] = [(await leaf(page, await sectionOf(page, B)).boundingBox())!, (await leaf(page, await sectionOf(page, E)).boundingBox())!, (await leaf(page, alpha).boundingBox())!];
        expect(placed.y).toBeGreaterThan(above.y);
        expect(placed.y).toBeLessThan(still.y);
        expect(still.height).toBe(32);
    });

    test("标签并入另一个浮动窗：内容从旧窗滑到新窗，矩形严格在新旧之间，两个窗都不动，实例、输入保留（输出 15；验收 1）", async ({page}) => {
        // 看的是落点指示：实时布局没有区域，内容也不是这样滑过去。
        await writeFile(join(tmp, "state", "settings.json"), JSON.stringify({"nbook.workbench/dragFeel": "indicator"}));
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        // 分节没有中央（输出 25 第 7 行），添加为标签只在浮动窗上：来源是戊、己两个标签的窗里的戊，目标是丁浮出来的另一个窗。
        const source = await floatOfTwo(page);
        const target = await floatViaMenu(page, D);
        // 新开的窗和前一个在同一处附近：用移动把手的键盘把它往右挪 50 下（输出 39“键盘”），两个窗分开。
        const opened = (await leaf(page, target).boundingBox())!;
        await page.locator(`[data-float-chrome="${target}"] [data-float-move-handle]`).focus();
        for (let step = 0; step < 50; step += 1) await page.keyboard.press("ArrowRight");
        await expect.poll(async () => (await leaf(page, target).boundingBox())!.x).toBeGreaterThan(opened.x + 400);
        await expect(page.locator("[data-moving]")).toHaveCount(0);
        await tab(page, E).click();
        await expect(sample(page, E)).toBeVisible();
        await sample(page, E).locator("input").fill("戊的草稿");
        const instance = await instanceOf(page, E);
        // 放慢过渡令牌，才读得到中间帧。
        await page.addStyleTag({content: ":root { --motion-layout: 4000ms !important; }"});
        const before = (await content(page, E).boundingBox())!;
        const windows = [[source, (await leaf(page, source).boundingBox())!], [target, (await leaf(page, target).boundingBox())!]] as const;

        await dropAt(page, tab(page, E), await inLeaf(page, target, {x: 0.5, y: 0.6}));
        await expect(content(page, E)).toHaveAttribute("data-flying", "");
        await expect.poll(async () => (await content(page, E).boundingBox())!.x).toBeGreaterThan(before.x + 1);
        const during = (await content(page, E).boundingBox())!;
        // 两个窗都没动（差不到 1px：按像素对齐后的亚像素抖动不算）。
        for (const [id, rect] of windows) {
            const now = (await leaf(page, id).boundingBox())!;
            for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(now[key] - rect[key]), `${id}.${key}`).toBeLessThan(1);
        }
        await expect(content(page, E)).not.toHaveAttribute("data-flying", "");
        const after = (await content(page, E).boundingBox())!;
        expect(after.x).toBeCloseTo(windows[1][1].x, 0);
        expect(during.x).toBeGreaterThan(before.x);
        expect(during.x).toBeLessThan(after.x);
        expect(await instanceOf(page, E)).toBe(instance);
        await expect(sample(page, E).locator("input")).toHaveValue("戊的草稿");
        await expect(tab(page, E)).toHaveCount(1);
        expect(await panelOfTab(page, E)).toBe(target);
    });

    test("放下时高亮立刻消失，不留在原处，也不跟着内容走；内容自己滑过去（输出 15、30）", async ({page}) => {
        // 看的是落点指示：实时布局没有区域，内容也不是这样滑过去。
        await writeFile(join(tmp, "state", "settings.json"), JSON.stringify({"nbook.workbench/dragFeel": "indicator"}));
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        // 把动效都放慢：还有淡出或滑向结果的话，松手之后高亮会留很久；内容的飞行也看得见。
        await page.addStyleTag({content: ":root { --motion-layout: 4000ms !important; --motion-base: 3000ms !important; --motion-fast: 3000ms !important; }"});
        await dragTo(page, tab(page, D), await inLeaf(page, await sectionOf(page, E), {x: 0.08, y: 0.6}));
        await expect(area(page)).toBeVisible();
        await page.mouse.up();
        await expect(page.locator("[data-drop-feedback-area]")).toHaveCount(0, {timeout: 1000});
        await expect(page.locator("[data-grid-scope] [data-moving]").first()).toBeAttached();
    });

    /** 落点是下一帧才画出来的：等两帧再断言没有，免得断言在落点出现之前通过。 */
    const settled = (page: Page): Promise<unknown> => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    test("工具视图在编辑组上被拒绝：中央、四条边都没有反馈；状态栏与标题栏不在面板上，反馈是浮动打开（输出 25、26、39；验收 10）", async ({page}) => {
        await open(page);
        const source = entry(page, C);
        const rejected = [
            await inLeaf(page, "g0", {x: 0.5, y: 0.5}),
            await inLeaf(page, "g0", {x: 0.97, y: 0.3}),
            await inLeaf(page, "g0", {x: 0.03, y: 0.3}),
            await inLeaf(page, "g0", {x: 0.5, y: 0.03}),
            await inLeaf(page, "g0", {x: 0.5, y: 0.97}),
        ];
        const offPanels = [await centerOf(page.locator("[data-leaf=\"statusbar\"]")), await centerOf(page.locator("[data-shell-titlebar]"))];
        await dragTo(page, source, rejected[0]!);
        for (const point of rejected) {
            await page.mouse.move(point.x, point.y, {steps: 6});
            await settled(page);
            await expect(ghost(page)).toBeVisible();
            await expect(feedback(page)).toHaveCount(0);
            await expect(page.locator("html")).toHaveAttribute("data-drop-rejected", "");
        }
        for (const point of offPanels) {
            await page.mouse.move(point.x, point.y, {steps: 6});
            await settled(page);
            await expect(ghost(page)).toBeVisible();
            await expect(feedback(page)).toHaveAttribute("data-drop-kind", "float");
            await expect(page.locator("html")).not.toHaveAttribute("data-drop-rejected", "");
        }
        // 这里只看判定；松手浮动打开在 workbench-float.e2e.ts。
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        // 丙的容器不是侧栏的当前容器，它的分节不显示；入口还在，就是它还在侧栏的证明。
        await expect(entry(page, C)).toHaveCount(1);
    });

    test("分节没有窄带、没有中央：整块按区域的方向分前后两半，标题行算前半（输出 25 第 7 行、26；验收 10）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        /** 指针在 `fraction` 处时，落点是这一节的前半还是后半：按预览的区域在这一节中线的哪一边判。 */
        async function expectHalf(panel: string, fraction: {x: number; y: number}, axis: "x" | "y", half: "front" | "back"): Promise<void> {
            const box = (await leaf(page, panel).boundingBox())!;
            const point = await inLeaf(page, panel, fraction);
            await page.mouse.move(point.x, point.y, {steps: 6});
            await expect(feedback(page)).toHaveAttribute("data-drop-kind", "edge");
            await expect(label(page)).toContainText("拆到这一边");
            await expect(page.locator("html")).not.toHaveAttribute("data-drop-rejected", "");
            const middle = axis === "y" ? box.y + box.height / 2 : box.x + box.width / 2;
            await expect.poll(async () => {
                const shown = await area(page).boundingBox();
                if (shown === null) return "none";
                const [start, end] = axis === "y" ? [shown.y, shown.y + shown.height] : [shown.x, shown.x + shown.width];
                return end <= middle + 8 ? "front" : start >= middle - 8 ? "back" : "across";
            }, `${panel} 的 ${JSON.stringify(fraction)}`).toBe(half);
        }
        // 侧栏这一列只上下分：左右两边、正中偏上都是前半（上方），下面是后半；标题行算前半。
        const alpha = await sectionOf(page, A);
        await dragTo(page, tab(page, D), await inLeaf(page, alpha, {x: 0.5, y: 0.3}));
        await expectHalf(alpha, {x: 0.04, y: 0.3}, "y", "front");
        await expectHalf(alpha, {x: 0.96, y: 0.3}, "y", "front");
        await expectHalf(alpha, {x: 0.5, y: 0.3}, "y", "front");
        await expectHalf(alpha, {x: 0.04, y: 0.85}, "y", "back");
        await expectHalf(alpha, {x: 0.5, y: 0.97}, "y", "back");
        await expectHalf(alpha, {x: 0.5, y: 18 / 842}, "y", "front");
        await page.keyboard.press("Escape");
        await expect(ghost(page)).toHaveCount(0);

        // 面板这一排只左右分：左半是前、右半是后；标题行横跨两半，也按同一条竖线分（这一节高 200，标题行是上面 32px）。
        const omega = await sectionOf(page, E);
        await dragTo(page, entry(page, C), await inLeaf(page, omega, {x: 0.3, y: 0.3}));
        await expectHalf(omega, {x: 0.3, y: 0.3}, "x", "front");
        await expectHalf(omega, {x: 0.8, y: 0.06}, "x", "back");
        await expectHalf(omega, {x: 0.2, y: 0.06}, "x", "front");
        await expectHalf(omega, {x: 0.7, y: 0.3}, "x", "back");
        await expectHalf(omega, {x: 0.97, y: 0.9}, "x", "back");
        await page.keyboard.press("Escape");
        await expect(ghost(page)).toHaveCount(0);
        expect(await writesOf(page)).toBe(writes);
    });

    test("缝上：侧栏与编辑组之间不是缝落点，指针归侧栏那一节，按它的前后两半判，不会落到编辑组（输出 25、26；验收 10）", async ({page}) => {
        await open(page);
        const sash = (await sidebarSash(page).boundingBox())!;
        const alpha = (await leaf(page, await sectionOf(page, A)).boundingBox())!;
        const low = alpha.y + alpha.height * 0.8;
        // 来源是右栏的丁：缝两侧只有侧栏的分节接收工具视图，缝归它（输出 25 表下），是它的后半，不是编辑组的外缘。
        await dragTo(page, tab(page, D), {x: sash.x + sash.width / 2 - 2, y: low});
        for (const x of [sash.x + sash.width / 2 - 2, sash.x + sash.width / 2]) {
            await page.mouse.move(x, low, {steps: 4});
            await expect(feedback(page)).toHaveAttribute("data-drop-kind", "edge");
            await expect(label(page)).toContainText("拆到这一边");
            await expect(page.locator("html")).not.toHaveAttribute("data-drop-rejected", "");
            const preview = (await area(page).boundingBox())!;
            expect(preview.x + preview.width).toBeLessThanOrEqual(sash.x + sash.width);
        }
        await page.keyboard.press("Escape");
        await expect(ghost(page)).toHaveCount(0);
    });

    test("展开标记只给侧栏、右栏的分节，容器里只有一节时没有；底部面板的分节不折叠；框架按钮里没有收起（输出 20）", async ({page}) => {
        await open(page);
        const [alpha, omega] = [await sectionOf(page, A), await sectionOf(page, E)];
        await expect(fold(page, alpha)).toHaveCount(0);
        await expect(fold(page, omega)).toHaveCount(0);
        await dropAt(page, tab(page, D), await inLeaf(page, alpha, {x: 0.5, y: 0.92}));
        await expect.poll(() => regionOf(page, D)).toBe("sidebar");
        await expect(fold(page, alpha)).toHaveCount(1);
        await expect(head(page, alpha).locator("[data-panel-fold]")).toHaveCount(1);
        await expect(frame(page, alpha, "set-panel-collapsed")).toHaveCount(0);
        // 点标题收成标题行，再点标题展开（输出 20）：标题行是开关。
        await fold(page, alpha).click();
        await expect.poll(async () => (await leaf(page, alpha).boundingBox())!.height).toBe(32);
        await tab(page, A).click();
        await expect.poll(async () => (await leaf(page, alpha).boundingBox())!.height).toBeGreaterThan(32);
    });

    test("一列全部收起时垫底那一节下面的卡片底不是停靠的落点：和收起的分节下面原来那片空白一样，反馈是浮动打开，取消不写；它的标题行照旧是落点（输出 11、25 第 7 行）", async ({page}) => {
        await open(page);
        const alpha = await sectionOf(page, A);
        await dropAt(page, tab(page, D), await inLeaf(page, alpha, {x: 0.5, y: 0.92}));
        await expect.poll(() => regionOf(page, D)).toBe("sidebar");
        const delta = await sectionOf(page, D);
        await fold(page, alpha).click();
        await fold(page, delta).click();
        // 丁垫底：外框拉到这一列的底，比标题行高得多。
        await expect.poll(async () => (await leaf(page, delta).boundingBox())!.height).toBeGreaterThan(200);
        // 两次收起各写一次，等它们落盘再数：不然晚到的那次会算进下面的拖动里。
        const writes = await settledWrites(page);
        await dragTo(page, entry(page, C), await inLeaf(page, delta, {x: 0.5, y: 0.7}));
        await expect(ghost(page)).toBeVisible();
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "float");
        await page.keyboard.press("Escape");
        await expect(ghost(page)).toHaveCount(0);
        await page.mouse.up();
        expect(await writesOf(page)).toBe(writes);
        // 标题行是前半：落在丁的标题上，丙在它前面成一节，丁还收着。
        await dropAt(page, entry(page, C), await centerOf(head(page, delta)));
        await expect(sample(page, C)).toBeVisible();
        const [placed, still] = [(await leaf(page, await sectionOf(page, C)).boundingBox())!, (await leaf(page, delta).boundingBox())!];
        expect(placed.y).toBeLessThan(still.y);
        await expect(fold(page, delta)).toHaveAttribute("aria-expanded", "false");
    });

    test("键盘：从活动栏入口拿起，起点就在活动栏，方向键在入口与空位之间移动，Enter 只换序；当前容器与显隐不变（输出 22、31、45）", async ({page}) => {
        await open(page);
        const before = await entriesOf(page);
        expect(before.slice(0, 2)).toEqual([implicit(A), implicit(B)]);
        await entry(page, B).focus();
        await page.keyboard.press("Space");
        await expect(ghost(page)).toBeVisible();
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "noop");
        // 往上：先是乙自己上面的空位（还是原处），再是甲的入口，再是甲上面的空位。
        for (let step = 0; step < 4 && (await feedback(page).getAttribute("data-drop-kind")) !== "move-entry"; step += 1) {
            await page.keyboard.press("ArrowUp");
            await labelText(page);
        }
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-entry");
        await page.keyboard.press("Enter");
        await expect(ghost(page)).toHaveCount(0);
        await expect.poll(() => entriesOf(page)).toEqual([implicit(B), implicit(A), ...before.slice(2)]);
        await expect(entry(page, A)).toHaveAttribute("aria-pressed", "true");
        await expect(entry(page, B)).toHaveAttribute("aria-pressed", "false");
        await expect(sample(page, A)).toBeVisible();
    });

    test("面板头空白处按住拖动不起拖：整块面板不能拖，面板头的空白也不是 Tab 停靠点（输出 20、24；验收 10）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const count = await shell(page).getAttribute("data-panel-count");
        // 侧栏、底部面板的分节：头里标题右边（底部面板并成一行时头不写标题，从头的左缘起）、动作按钮左边之间空着的一点。
        const blanks: Array<{x: number; y: number}> = [];
        for (const viewId of [A, E]) {
            const section = await sectionOf(page, viewId);
            const title = (await tab(page, viewId).boundingBox())!;
            const own = (await head(page, section).boundingBox())!;
            const actions = (await head(page, section).locator("[data-panel-action]").first().boundingBox())!;
            const start = Math.max(title.x + title.width, own.x);
            expect(actions.x - start).toBeGreaterThan(16);
            blanks.push({x: (start + actions.x) / 2, y: own.y + own.height / 2});
        }
        for (const blank of blanks) {
            await page.mouse.move(blank.x, blank.y);
            await page.mouse.down();
            await page.mouse.move(blank.x + 40, blank.y + 40, {steps: 6});
            await settled(page);
            await expect(ghost(page)).toHaveCount(0);
            await page.mouse.up();
        }
        for (const viewId of [A, D, E]) expect(await head(page, await sectionOf(page, viewId)).evaluate((element) => element.tabIndex)).toBe(-1);
        await expect(shell(page)).toHaveAttribute("data-panel-count", count ?? "");
        expect(await writesOf(page)).toBe(writes);
    });

    test("收成标题行的分节：把标题拖到面板这一排，收起清掉、不是零宽，面板 id 不变（输出 11、27；验收 10）", async ({page}) => {
        await open(page);
        // 侧栏这一列里的分节才有标题行：把丁放到甲那一节的后半，再把它收成标题行。
        await dropAt(page, tab(page, D), await inLeaf(page, await sectionOf(page, A), {x: 0.5, y: 0.92}));
        await expect.poll(() => regionOf(page, D)).toBe("sidebar");
        const delta = await sectionOf(page, D);
        await fold(page, delta).click();
        await expect.poll(async () => (await leaf(page, delta).boundingBox())!.height).toBe(32);
        // 放到戊那一节的前半：整块移动，收起清掉，不会变成零宽。
        await dropAt(page, tab(page, D), await inLeaf(page, await sectionOf(page, E), {x: 0.08, y: 0.6}));
        await expect.poll(() => regionOf(page, D)).toBe("panel");
        expect(await sectionOf(page, D)).toBe(delta);
        await expect.poll(async () => (await leaf(page, delta).boundingBox())!.height).toBeGreaterThan(32);
        await expect.poll(async () => (await leaf(page, delta).boundingBox())!.width).toBeGreaterThan(100);
        await expect(sample(page, D)).toBeVisible();
    });

    test("工具区不接收：拖到面板头的框架按钮上没有落点反馈，松手不移动、不写（输出 25 末）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const button = frame(page, await sectionOf(page, E), "float");
        await expect(button).toBeVisible();
        await dragTo(page, entry(page, C), await centerOf(button));
        await expect(ghost(page)).toBeVisible();
        await expect(feedback(page)).toHaveCount(0);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect(entry(page, C)).toHaveCount(1);
        expect(await writesOf(page)).toBe(writes);
    });

    test("键盘拿起后直接 Enter 是原位：分节的标题、活动栏入口、侧栏标题都不移动、不写，焦点回到来源（输出 28、31；验收 9）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const [alpha, omega] = [await sectionOf(page, A), await sectionOf(page, E)];
        const entries = await entriesOf(page);
        for (const source of [tab(page, E), entry(page, A), tab(page, A)]) {
            await source.focus();
            await page.keyboard.press("Space");
            await expect(ghost(page)).toBeVisible();
            await page.keyboard.press("Enter");
            await expect(ghost(page)).toHaveCount(0);
            await expect(source).toBeFocused();
        }
        expect(await sectionOf(page, E)).toBe(omega);
        expect(await regionOf(page, E)).toBe("panel");
        expect(await sectionOf(page, A)).toBe(alpha);
        expect(await regionOf(page, A)).toBe("sidebar");
        expect(await entriesOf(page)).toEqual(entries);
        expect(await writesOf(page)).toBe(writes);
    });

    test("松手只提交显示过的落点：最后一次移动与松手落在同一帧、换到了没显示过的落点时不提交；落点没变时照常提交（输出 24；ui/layout-drag 输出 6）", async ({page}) => {
        await open(page);
        const source = entry(page, C);
        const shown = await inLeaf(page, await sectionOf(page, E), {x: 0.75, y: 0.6});
        const elsewhere = await inLeaf(page, await sectionOf(page, D), {x: 0.5, y: 0.3});
        // 这次移动与松手在同一个任务里派发：两者之间没有帧，会话来不及发布新落点。真实输入里快速甩动松手就是这种时序，
        // 用 Playwright 的鼠标做不出确定的“同一帧”，所以这两下用页面里的指针事件。
        const flick = (to: {x: number; y: number}) => page.evaluate(({x, y}) => {
            const init = {pointerId: 1, pointerType: "mouse", isPrimary: true, bubbles: true, clientX: x, clientY: y};
            document.dispatchEvent(new PointerEvent("pointermove", {...init, buttons: 1}));
            document.dispatchEvent(new PointerEvent("pointerup", {...init, button: 0, buttons: 0}));
        }, to);
        const writes = await writesOf(page);
        await dragTo(page, source, shown);
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "edge");
        await flick(elsewhere);
        await expect(ghost(page)).toHaveCount(0);
        await page.mouse.up();
        await expect(entry(page, C)).toHaveCount(1);
        expect(await writesOf(page)).toBe(writes);

        await dragTo(page, source, shown);
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "edge");
        await flick(shown);
        await expect(ghost(page)).toHaveCount(0);
        await page.mouse.up();
        await expect.poll(() => regionOf(page, C)).toBe("panel");
        await expect(sample(page, C)).toBeVisible();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test("“移动到”的“新容器”：视图搬进底部面板里新建的、只含它的容器，底部面板切到它；刷新后仍在同一块分节里（输出 23、35；验收 1）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        // 分节标题的右键是视图的“移动到”；活动栏入口的右键是容器的菜单（输出 44），不在这里用。
        await tab(page, A).click({button: "right"});
        await page.getByRole("menuitem", {name: "新容器（底部面板）", exact: true}).click();
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect.poll(() => regionOf(page, A)).toBe("panel");
        const created = await sectionOf(page, A);
        // 底部面板原来的容器（戊）不是当前容器了，它的分节停放。
        await expect(content(page, E)).toHaveAttribute("inert", "");
        // 新容器只有这一节：头并进底部面板的入口条，不写标题，入口写着它的标题（输出 20、47）；没有标签带。
        await expect(head(page, created).locator("[data-panel-tab]")).toHaveCount(0);
        await expect(head(page, created).locator('[role="tab"]')).toHaveCount(0);
        await expect(page.locator(`[data-region-strip="panel"] [data-tool-view="${A}"]`)).toHaveAttribute("aria-pressed", "true");
        await expect(sample(page, A)).toBeVisible();
        await expect.poll(() => writesOf(page)).toBeGreaterThan(writes);
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        expect(await sectionOf(page, A)).toBe(created);
        await expect(sample(page, A)).toBeVisible();
        // 活动栏只列侧栏的容器：甲的容器空了，入口不在了。
        await expect(entry(page, A)).toHaveCount(0);
    });

    test("右栏的视图放到活动栏两个入口之间：它是它容器唯一的视图，整个容器搬过来、入口在那里，侧栏切到它；右栏空了，锚隐藏；插入线是横线，只写一次（输出 22、43、45、46；验收 14）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const instance = await instanceOf(page, D);
        await dragTo(page, tab(page, D), await aboveEntry(page, B));
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-container");
        await expect(label(page)).toContainText("放在这里");
        const bar = (await line(page).boundingBox())!;
        expect(bar.width).toBeGreaterThan(bar.height);
        expect(await writesOf(page)).toBe(writes);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect.poll(() => entriesOf(page)).toEqual([implicit(A), implicit(D), implicit(B), implicit(C)]);
        await expect(entry(page, D)).toHaveAttribute("aria-pressed", "true");
        expect(await regionOf(page, D)).toBe("sidebar");
        await expect(sample(page, D)).toBeVisible();
        await expect.poll(() => auxiliaryWidth(page)).toBeLessThan(2);
        expect(await instanceOf(page, D)).toBe(instance);
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test("隐藏的区域不是落点：它原来的位置现在是编辑组，工具视图放不进去；要放进隐藏的区域用“移动到”（输出 23、26、29；验收 8）", async ({page}) => {
        await open(page);
        const delta = await sectionOf(page, D);
        const right = await inLeaf(page, delta, {x: 0.5, y: 0.5});
        await page.locator("[data-titlebar-layout=\"auxiliarybar\"]").click();
        await shrunk(page, delta);
        await settled(page);
        await dragTo(page, tab(page, E), right);
        await settled(page);
        await expect(feedback(page)).toHaveCount(0);
        await expect(page.locator("html")).toHaveAttribute("data-drop-rejected", "");
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await shrunk(page, delta);
        // “移动到”隐藏着的右栏里样例丁的容器：同一次写入把右栏显示出来，切到这个容器，戊是它最后一个分节（输出 23）。
        await tab(page, E).click({button: "right"});
        await page.getByRole("menuitem", {name: "样例丁", exact: true}).click();
        await expect(leaf(page, delta)).toBeVisible();
        await expect.poll(() => regionOf(page, E)).toBe("auxiliarybar");
        expect((await leaf(page, await sectionOf(page, E)).boundingBox())!.y).toBeGreaterThan((await leaf(page, delta).boundingBox())!.y);
        await expect.poll(() => hiddenInRecord(page, "auxiliarybar")).toBe(false);
    });

    test("侧栏隐藏时把视图放到活动栏：同一次写入把侧栏显示出来并切到装着它的容器（输出 22、45、46；验收 14）", async ({page}) => {
        await open(page);
        // 点当前容器按下着的入口，侧栏隐藏（输出 22）。
        const alpha = await sectionOf(page, A);
        await pressEntry(page, entry(page, A));
        await shrunk(page, alpha);
        await expect.poll(() => hiddenInRecord(page, "sidebar")).toBe(true);
        const writes = await settledWrites(page);
        await dragTo(page, tab(page, D), await aboveEntry(page, A));
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-container");
        await expect(label(page)).toContainText("放在这里");
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect.poll(() => regionOf(page, D)).toBe("sidebar");
        await expect(entry(page, D)).toHaveAttribute("aria-pressed", "true");
        await expect(sample(page, D)).toBeVisible();
        await expect(leaf(page, alpha)).toHaveCount(0);
        await expect.poll(() => entriesOf(page)).toEqual([implicit(D), implicit(A), implicit(B), implicit(C)]);
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
        expect((await savedDoc(page))?.panels.sidebar?.hidden).not.toBe(true);
    });

    test("在活动栏里拖一个不是当前容器的入口换序：顺序变了，当前容器与显隐都不变；放回原处是“原位”、不写（输出 22、28、45；验收 14）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        await dragTo(page, entry(page, C), await aboveEntry(page, A));
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-entry");
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect.poll(() => entriesOf(page)).toEqual([implicit(C), implicit(A), implicit(B)]);
        // 当前容器还是甲的，没有因为换序切到丙。
        await expect(entry(page, A)).toHaveAttribute("aria-pressed", "true");
        await expect(entry(page, C)).toHaveAttribute("aria-pressed", "false");
        await expect(sample(page, A)).toBeVisible();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);

        // 放回原处：丙拖到自己上面的空位，什么都不变。
        const next = await writesOf(page);
        await dragTo(page, entry(page, C), await aboveEntry(page, C));
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "noop");
        await expect(label(page)).toContainText("原位");
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        expect(await entriesOf(page)).toEqual([implicit(C), implicit(A), implicit(B)]);
        expect(await writesOf(page)).toBe(next);

        // 侧栏隐藏着换序：不显示它，落点是换位置。
        const alpha = await sectionOf(page, A);
        await pressEntry(page, entry(page, A));
        await shrunk(page, alpha);
        await expect.poll(() => hiddenInRecord(page, "sidebar")).toBe(true);
        const hiddenWrites = await settledWrites(page);
        await dragTo(page, entry(page, B), await aboveEntry(page, C));
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-entry");
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect.poll(() => entriesOf(page)).toEqual([implicit(B), implicit(C), implicit(A)]);
        await shrunk(page, alpha);
        await expect.poll(() => writesOf(page)).toBe(hiddenWrites + 1);
        expect((await savedDoc(page))?.panels.sidebar?.hidden).toBe(true);
    });

    test("键盘：工具视图拿起后，区域的循环从活动栏开始：Tab 绕到活动栏，方向键在入口与空位之间移动，Enter 放下，它容器唯一的视图整个容器搬过来、侧栏切到它（输出 22、31、45、46；验收 14）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        // 区域按树序排：活动栏、侧栏、面板、右栏，最后是“浮动”。丁在右栏里，拿起后第一下 Tab 到“浮动”，第二下绕回循环的起点，也就是活动栏。
        await tab(page, D).focus();
        await page.keyboard.press("Space");
        await expect(ghost(page)).toBeVisible();
        await page.keyboard.press("Tab");
        await labelText(page);
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "float");
        await page.keyboard.press("Tab");
        await labelText(page);
        // 活动栏的第一个位置是第一个入口之前的空位（输出 31）。丁是右栏里它那个容器唯一的视图：入口之间是整个容器搬过来（输出 45）。
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-container");
        const bandBox = (await page.locator("[data-rail=sidebar] [data-tool-band]").boundingBox())!;
        const first = (await line(page).boundingBox())!;
        expect(first.x).toBeGreaterThanOrEqual(bandBox.x);
        expect(first.x + first.width).toBeLessThanOrEqual(bandBox.x + bandBox.width);
        // 往后：先是甲的入口（并入，入口高亮、没有线），再是甲后面的空位，线往下走。
        await page.keyboard.press("ArrowDown");
        await labelText(page);
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "join-container");
        await page.keyboard.press("ArrowDown");
        await labelText(page);
        await expect(feedback(page)).toHaveAttribute("data-drop-kind", "move-container");
        await expect.poll(async () => (await line(page).boundingBox())!.y).toBeGreaterThan(first.y);
        expect(await writesOf(page)).toBe(writes);
        await page.keyboard.press("Enter");
        await expect(ghost(page)).toHaveCount(0);
        await expect.poll(() => regionOf(page, D)).toBe("sidebar");
        await expect(entry(page, D)).toHaveAttribute("aria-pressed", "true");
        await expect.poll(() => entriesOf(page)).toEqual([implicit(A), implicit(D), implicit(B), implicit(C)]);
        await expect(sample(page, D)).toBeVisible();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test.describe("缝与四周（输出 25 到 27、31）", () => {
        const sectors = (page: Page) => page.locator("[data-drop-sectors]");
        /** 把丙放到甲那一节的后半：侧栏这一列有两节。返回下面那节的 id。 */
        async function splitColumn(page: Page): Promise<string> {
            await dropAt(page, entry(page, C), await inLeaf(page, await sectionOf(page, A), {x: 0.5, y: 0.97}));
            await expect.poll(() => regionOf(page, C)).toBe("sidebar");
            return sectionOf(page, C);
        }
        const boxOf = async (page: Page, panel: string): Promise<{x: number; y: number; width: number; height: number}> => {
            const found = await leaf(page, panel).boundingBox();
            if (found === null) throw new Error(`没有 ${panel}`);
            return found;
        };
        const seamBetween = async (page: Page, upper: string, lower: string): Promise<{x: number; y: number}> => {
            const [top, bottom] = [await boxOf(page, upper), await boxOf(page, lower)];
            return {x: top.x + top.width / 2, y: (top.y + top.height + bottom.y) / 2};
        };

        test("缝是两节之间，前后两半只分本节：放到后半下面那节不动，放到缝上两节一起让", async ({page}) => {
            await open(page);
            const alpha = await sectionOf(page, A);
            const below = await splitColumn(page);
            const belowBefore = await boxOf(page, below);
            // 甲那一节的后半：只分甲，下面那节不动。
            await dragTo(page, entry(page, B), await inLeaf(page, alpha, {x: 0.5, y: 0.85}));
            expect(await labelText(page)).toBe("拆到这一边");
            await page.mouse.up();
            await expect(ghost(page)).toHaveCount(0);
            await expect.poll(() => regionOf(page, B)).toBe("sidebar");
            const fromHalf = await sectionOf(page, B);
            await expect.poll(async () => (await boxOf(page, below)).height).toBe(belowBefore.height);

            // 缝：放到拆出来的这节和下面那节之间，两节都让。甲的容器现在有几个视图，它的入口不能这样拖（输出 46），来源用右栏的丁。
            const [upperBefore, lowerBefore] = [await boxOf(page, fromHalf), await boxOf(page, below)];
            await dragTo(page, tab(page, D), await seamBetween(page, fromHalf, below));
            expect(await labelText(page)).toBe("放到两块之间");
            await expect(sectors(page)).toHaveCount(0);
            await page.mouse.up();
            await expect(ghost(page)).toHaveCount(0);
            const middle = await sectionOf(page, D);
            await expect.poll(async () => (await boxOf(page, fromHalf)).height).toBeLessThan(upperBefore.height);
            expect((await boxOf(page, below)).height).toBeLessThan(lowerBefore.height);
            const [upper, placed, lower] = [await boxOf(page, fromHalf), await boxOf(page, middle), await boxOf(page, below)];
            expect(placed.y).toBeGreaterThan(upper.y);
            expect(placed.y).toBeLessThan(lower.y);
        });

        test("骨架上的缝不是落点：侧栏与编辑区之间归侧栏那一节，是它的前后两半，不是两块之间", async ({page}) => {
            await open(page);
            const sash = await sidebarSash(page).boundingBox();
            if (sash === null) throw new Error("没有侧栏的边界");
            await dragTo(page, tab(page, E), {x: sash.x + sash.width / 2, y: sash.y + sash.height / 2});
            await expect(feedback(page)).toHaveAttribute("data-drop-kind", "edge");
            expect(await labelText(page)).toBe("拆到这一边");
            const preview = (await area(page).boundingBox())!;
            expect(preview.x + preview.width).toBeLessThanOrEqual(sash.x + sash.width);
            await page.keyboard.press("Escape");
            await page.mouse.up();
            await expect(ghost(page)).toHaveCount(0);
        });

        test("键盘也到得了缝：逐个位置走到“放到两块之间”，放下结果和指针一样", async ({page}) => {
            await open(page);
            const alpha = await sectionOf(page, A);
            const below = await splitColumn(page);
            await tab(page, E).focus();
            await page.keyboard.press("Space");
            await expect(ghost(page)).toBeVisible();
            let found = false;
            for (let region = 0; region < 8 && !found; region += 1) {
                await page.keyboard.press("Tab");
                for (let step = 0; step < 12 && !found; step += 1) {
                    found = (await labelText(page)) === "放到两块之间";
                    if (!found) await page.keyboard.press("ArrowDown");
                }
            }
            expect(found).toBe(true);
            await page.keyboard.press("Enter");
            await expect(ghost(page)).toHaveCount(0);
            const placed = await boxOf(page, await sectionOf(page, E));
            expect(placed.y).toBeGreaterThan((await boxOf(page, alpha)).y);
            expect(placed.y).toBeLessThan((await boxOf(page, below)).y);
        });
    });

    test.describe("同方向一起分（设置 dropSplit，输出 27）", () => {
        test("放到分节的前后两半时这一列都让；“移动到”进一个容器不跟设置走，只从相邻的分节取（输出 23）", async ({page}) => {
            const settingsFile = join(tmp, "state", "settings.json");
            await writeFile(settingsFile, JSON.stringify({"nbook.workbench/dropSplit": "shared"}));
            try {
                await open(page);
                const alpha = await sectionOf(page, A);
                await dropAt(page, entry(page, C), await inLeaf(page, alpha, {x: 0.5, y: 0.97}));
                await expect.poll(() => regionOf(page, C)).toBe("sidebar");
                const below = await sectionOf(page, C);
                await expect(page.locator("[data-moving]")).toHaveCount(0);
                const lowerBefore = await leaf(page, below).boundingBox();
                await dropAt(page, entry(page, B), await inLeaf(page, alpha, {x: 0.5, y: 0.85}));
                await expect.poll(async () => (await leaf(page, below).boundingBox())?.height ?? 0).toBeLessThan(lowerBefore?.height ?? 0);
                // 戊“移动到”样例甲的容器：成为最后一个分节，排在丙后面，只从丙取空间；甲、乙两节不动。比记录里的尺寸意图：
                // 屏幕上的像素是求解后取整的，多一块分节时余下的一两个像素可能落到别的块上，那不是“让出空间”。
                const beta = await sectionOf(page, B);
                await settledWrites(page);
                const intents = async (): Promise<number[]> => {
                    const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
                    const db = new DatabaseSync(join(tmp, "state", "storage", "user.sqlite"));
                    try {
                        const row = db.prepare("SELECT value FROM records WHERE owner = 'nbook.workbench' AND key = 'workbench.layout' AND client = ?1").get(client) as {value: string};
                        interface SizeNode {
                            readonly id: string;
                            readonly size: {readonly height: number};
                            readonly children?: ReadonlyArray<SizeNode>;
                        }
                        const found = new Map<string, number>();
                        const walk = (node: SizeNode): void => {
                            found.set(node.id, node.size.height);
                            node.children?.forEach(walk);
                        };
                        walk((JSON.parse(row.value) as {doc: {tree: {root: SizeNode}}}).doc.tree.root);
                        return [alpha, beta, below].map((id) => found.get(id) ?? Number.NaN);
                    } finally {
                        db.close();
                    }
                };
                const [alphaBefore, betaBefore, belowBefore] = await intents();
                const writes = await writesOf(page);
                await tab(page, E).click({button: "right"});
                await page.getByRole("menuitem", {name: "样例甲", exact: true}).click();
                await expect.poll(() => regionOf(page, E)).toBe("sidebar");
                await expect.poll(() => writesOf(page)).toBeGreaterThan(writes);
                await settledWrites(page);
                const [alphaAfter, betaAfter, belowAfter] = await intents();
                expect([alphaAfter, betaAfter]).toEqual([alphaBefore, betaBefore]);
                expect(belowAfter).toBeLessThan(belowBefore);
                expect((await leaf(page, await sectionOf(page, E)).boundingBox())!.y).toBeGreaterThan((await leaf(page, below).boundingBox())!.y);
            } finally {
                await rm(settingsFile, {force: true});
            }
        });
    });

    test("拖动源压在分隔线的命中带里：按下并拖动是调整大小，不出现拖影；同一个面板头上标题按下拖动才是拿起这个视图（输出 24；ui/layout-drag 验收 3）", async ({page}) => {
        await open(page);
        // 把丁放到甲那一节的后半：丁那一节的面板头顶边挨着它与甲之间的分隔线。
        await dropAt(page, tab(page, D), await inLeaf(page, await sectionOf(page, A), {x: 0.5, y: 0.92}));
        await expect.poll(() => regionOf(page, D)).toBe("sidebar");
        const panelHead = head(page, await sectionOf(page, D));
        await expect(panelHead).toBeVisible();
        const before = (await panelHead.boundingBox())!;
        // 面板头的顶边这一像素同时落在面板头上和命中带里：分隔线在上面。
        const x = before.x + before.width * 0.75;
        await page.mouse.move(x, before.y + 1);
        await page.mouse.down();
        await page.mouse.move(x, before.y + 41, {steps: 6});
        await expect.poll(async () => (await panelHead.boundingBox())!.y).toBeGreaterThan(before.y + 20);
        await expect(ghost(page)).toHaveCount(0);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);

        // 对照：标题上同样的拖动是拿起这个视图，面板头不被分隔线抢走。
        const title = await centerOf(tab(page, D));
        await page.mouse.move(title.x, title.y);
        await page.mouse.down();
        await page.mouse.move(title.x + 10, title.y + 10, {steps: 2});
        await expect(ghost(page)).toBeVisible();
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
    });

    test("视图的标签拖动中：方向键不切换标签；失去捕获、窗口失焦、焦点移出工作台都取消，拖影撤下、不写，回到来源松手不切换活动标签（ui/layout-drag 验收 1、4）", async ({page}) => {
        await open(page);
        const floating = await floatOfTwo(page);
        const tabsBefore = await tabsOf(page, floating);
        /** 按下、过门槛，拖动进行中。 */
        const grab = async (viewId: string): Promise<{x: number; y: number}> => {
            const from = await centerOf(tab(page, viewId));
            await page.mouse.move(from.x, from.y);
            await page.mouse.down();
            await page.mouse.move(from.x + 10, from.y + 10, {steps: 2});
            await expect(ghost(page)).toBeVisible();
            return from;
        };
        const twoFrames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        /** 取消之后回到按下的标签上松手：那一下 click 要被吞掉，活动标签还是 `active`。 */
        const releaseOnSource = async (from: {x: number; y: number}, active: string, writes: number): Promise<void> => {
            await expect(ghost(page)).toHaveCount(0);
            await page.mouse.move(from.x, from.y);
            await page.mouse.up();
            await twoFrames();
            await expect(tab(page, active)).toHaveAttribute("aria-selected", "true");
            expect(await tabsOf(page, floating)).toEqual(tabsBefore);
            expect(await writesOf(page)).toBe(writes);
        };

        // 方向键（验收 4）：焦点在活动的戊上，标签条是自动激活的，方向键没被拖动拦下就会切到己。
        await tab(page, E).click();
        await expect(tab(page, E)).toHaveAttribute("aria-selected", "true");
        let writes = await settledWrites(page);
        await grab(E);
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("ArrowLeft");
        await page.keyboard.press("End");
        await twoFrames();
        await expect(tab(page, E)).toHaveAttribute("aria-selected", "true");
        await expect(tab(page, F)).toHaveAttribute("aria-selected", "false");
        await expect(ghost(page)).toBeVisible();
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        expect(await writesOf(page)).toBe(writes);

        // 三种取消都拖不活动的己：松手时的 click 没被吞就会激活它。
        writes = await settledWrites(page);
        // 捕获的取得与释放都在下一个指针事件时才生效：先动一下让捕获真的到根上，释放之后再动一下让 `lostpointercapture` 派发出来。
        let from = await grab(F);
        await page.mouse.move(from.x + 11, from.y + 10);
        await page.locator(".workbench-shell-host").evaluate((host) => host.releasePointerCapture(1));
        await page.mouse.move(from.x + 12, from.y + 10);
        await releaseOnSource(from, E, writes);

        // 窗口失焦：无头 Chrome 没有真实的窗口失焦，派发窗口自己的 blur。
        from = await grab(F);
        await page.evaluate(() => window.dispatchEvent(new FocusEvent("blur")));
        await releaseOnSource(from, E, writes);

        from = await grab(F);
        await page.evaluate(() => {
            const outside = document.createElement("button");
            outside.dataset.outsideShell = "";
            document.body.append(outside);
            outside.focus();
        });
        await releaseOnSource(from, E, writes);
        await page.evaluate(() => document.querySelector("[data-outside-shell]")?.remove());
    });

    test.describe("落点分区（docs/specs/ui/workbench-layout.md“落点分区”）", () => {
        const sectors = (page: Page) => page.locator("[data-drop-sectors]");
        const sectorIds = (page: Page): Promise<Array<string | null>> => page.locator("[data-drop-sector]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-drop-sector")).sort());
        const activeSector = (page: Page) => page.locator("[data-drop-sector-active]");

        test("工具视图：列上的分节只有上下、排上的分节只有左右，没有中央；当前块跟着指针，它自己不写字；松手不留（输出 37）", async ({page}) => {
            await open(page);
            const delta = await sectionOf(page, D);
            await dragTo(page, tab(page, E), await inLeaf(page, delta, {x: 0.5, y: 0.97}));
            await expect(sectors(page)).toHaveCount(1);
            expect(await sectorIds(page)).toEqual(["bottom", "top"]);
            await expect(activeSector(page)).toHaveAttribute("data-drop-sector", "bottom");
            await expect(page.locator("[data-drop-sector-label=\"bottom\"]")).toHaveCount(0);
            await expect(page.locator("[data-drop-sector-label=\"top\"]")).toHaveCount(1);
            // 提示还在说这次落点：分区的字只有方向。
            await expect(label(page)).not.toHaveCount(0);

            const upper = await inLeaf(page, delta, {x: 0.5, y: 0.3});
            await page.mouse.move(upper.x, upper.y, {steps: 3});
            await expect(activeSector(page)).toHaveAttribute("data-drop-sector", "top");
            await page.keyboard.press("Escape");
            await page.mouse.up();
            await expect(ghost(page)).toHaveCount(0);
            await expect(sectors(page)).toHaveCount(0);

            const omega = await sectionOf(page, E);
            await dragTo(page, tab(page, D), await inLeaf(page, omega, {x: 0.97, y: 0.6}));
            await expect(sectors(page)).toHaveCount(1);
            expect(await sectorIds(page)).toEqual(["left", "right"]);
            await expect(activeSector(page)).toHaveAttribute("data-drop-sector", "right");
            // 放下的结果就是当前块说的：在戊那一节后面（右边）插一节。
            const before = await leaf(page, omega).boundingBox();
            await page.mouse.up();
            await expect(ghost(page)).toHaveCount(0);
            await expect(sectors(page)).toHaveCount(0);
            await expect.poll(() => regionOf(page, D)).toBe("panel");
            const moved = await sectionOf(page, D);
            await expect.poll(async () => ((await leaf(page, moved).boundingBox())?.x ?? 0) >= (before?.x ?? 0) + (before?.width ?? 0) / 2 - 1).toBe(true);
        });

        test("编辑组不接收工具视图、浮动窗的标签条上：没有分区；分节的标题行算前半，分区照画（输出 37）", async ({page}) => {
            await open(page);
            const window = await floatOfTwo(page);
            // 编辑组上避开浮动窗：窗盖着的地方算窗。
            const floatBox = (await leaf(page, window).boundingBox())!;
            const groupBox = (await leaf(page, "g0").boundingBox())!;
            const clear = [{x: 0.08, y: 0.9}, {x: 0.92, y: 0.9}, {x: 0.08, y: 0.1}, {x: 0.92, y: 0.1}].map((fraction) => ({x: groupBox.x + groupBox.width * fraction.x, y: groupBox.y + groupBox.height * fraction.y})).find((point) => point.x < floatBox.x || point.x > floatBox.x + floatBox.width || point.y < floatBox.y || point.y > floatBox.y + floatBox.height)!;
            await dragTo(page, tab(page, D), clear);
            await settled(page);
            await expect(sectors(page)).toHaveCount(0);
            const strip = await endOfStrip(page, window);
            await page.mouse.move(strip.x, strip.y, {steps: 3});
            await expect(feedback(page)).toHaveAttribute("data-drop-kind", "strip");
            await expect(sectors(page)).toHaveCount(0);
            const title = await centerOf(head(page, await sectionOf(page, A)));
            await page.mouse.move(title.x, title.y, {steps: 3});
            await expect(feedback(page)).toHaveAttribute("data-drop-kind", "edge");
            await expect(activeSector(page)).toHaveAttribute("data-drop-sector", "top");
            await page.keyboard.press("Escape");
            await page.mouse.up();
            await expect(ghost(page)).toHaveCount(0);
        });

        test("键盘：停在分节的落点上有分区，活动栏、标签条的停靠点上没有；Escape 后不留", async ({page}) => {
            await open(page);
            await tab(page, E).focus();
            await page.keyboard.press("Space");
            await expect(ghost(page)).toBeVisible();
            // 戊在底部面板里只有自己这一节，两半都是原处：按 Tab 换到别的区域，第一个位置就是那一节的前半。
            let seen = false;
            for (let step = 0; step < 12 && !seen; step += 1) {
                await page.keyboard.press("Tab");
                const kind = await page.evaluate(async () => {
                    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                    return document.querySelector("[data-drop-kind]")?.getAttribute("data-drop-kind") ?? "";
                });
                seen = kind === "edge";
                if (["strip", "new-container", "join-container", "move-entry", "move-container"].includes(kind)) await expect(sectors(page)).toHaveCount(0);
            }
            expect(seen).toBe(true);
            await expect(sectors(page)).toHaveCount(1);
            await expect(activeSector(page)).toHaveCount(1);
            await page.keyboard.press("Escape");
            await expect(ghost(page)).toHaveCount(0);
            await expect(sectors(page)).toHaveCount(0);
        });

        test("设置关掉：没有分区，落点照旧", async ({page}) => {
            const settingsFile = join(tmp, "state", "settings.json");
            await writeFile(settingsFile, JSON.stringify({"nbook.workbench/dropSectors": false}));
            try {
                await open(page);
                await dragTo(page, tab(page, D), await inLeaf(page, await sectionOf(page, E), {x: 0.5, y: 0.6}));
                await expect(feedback(page)).not.toHaveAttribute("data-drop-kind", "");
                await expect(area(page)).toHaveCount(1);
                await expect(sectors(page)).toHaveCount(0);
                await page.keyboard.press("Escape");
                await page.mouse.up();
                await expect(ghost(page)).toHaveCount(0);
            } finally {
                await rm(settingsFile, {force: true});
            }
        });
    });
});
