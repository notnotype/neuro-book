/**
 * 实时布局（docs/specs/ui/workbench-layout.md“实时布局”）在真实浏览器里：邻居真实让位、预览不写记录、松手提交指针下的候选、取消回原样。应用的 Playwright 配置缺省减少动态效果，那时一律落点指示，所以这里每个用例开回来。
 */

import {mkdir, rm, writeFile} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Locator, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {CLIENT_IDENTITY_KEY} from "nbook/web/host/client-identity";

import {startProbeServer} from "./fixtures";
import type {ProbeServer} from "./fixtures";

const E = "test.sample-views.omega";
const F = "test.sample-views.zeta";
const AUXILIARY_VIEW = "test.sample-views.delta";

const ghost = (page: Page) => page.locator("[data-workbench-drag-ghost]");
const surface = (page: Page) => page.locator("[data-workbench-surface]");
const leaf = (page: Page, id: string) => page.locator(`[data-workbench-surface] > [data-grid-scope] > [data-leaf="${id}"]`);
/** 区域隐藏了：按拖到零画（ui/workbench-layout 输出 11），那块外框还在、缩到面积为零。等到零也就等过渡走完了。 */
const shrunk = (page: Page, id: string) => expect.poll(async () => {
    const found = await leaf(page, id).boundingBox();
    return found === null ? 0 : Math.round(found.width * found.height);
}).toBe(0);
/**
 * 视图的标题：头上的标题按钮。底部面板并成一行时头不写标题，按下的入口就是它的标题（右键开“移动到”、拖它就是拖这个视图，
 * docs/specs/ui/workbench-layout.md 输出 47）；只在没有标题按钮时取到它。
 */
const tab = (page: Page, viewId: string) => page.locator(`[data-panel-tab="view:${viewId}"], [data-region-strip="panel"] [data-tool-view="${viewId}"][aria-pressed="true"]`);
const panelOfTab = (page: Page, viewId: string): Promise<string> => tab(page, viewId).evaluate((element) => element.closest<HTMLElement>("[data-panel-head]")!.dataset.panelHead!);
/**
 * 视图所在面板的 id：内容项上写着它所在的叶（输出 14）。每个样例视图是自己的隐式容器里唯一的分节（输出 40），分节在区域之间移动时
 * 是同一块面板，id 不变（输出 27），所以“落到了别处”按它在哪个区域判（`regionOf`），不按面板 id。
 */
async function sectionOf(page: Page, viewId: string): Promise<string> {
    const id = await page.locator(`[data-content="view:${viewId}"]`).getAttribute("data-content-leaf");
    if (id === null) throw new Error(`${viewId} 不在任何面板里`);
    return id;
}
/** 视图显示在哪个区域：按它的内容和编辑组 g0 的相对位置（侧栏在左、右栏在右、底部面板在下）；浮动窗是 float。 */
async function regionOf(page: Page, viewId: string): Promise<string> {
    const panel = await sectionOf(page, viewId);
    if (await page.locator(`[data-workbench-surface] > [data-grid-scope] > [data-leaf="${panel}"][data-float]`).count() > 0) return "float";
    const [view, editor] = [await leaf(page, panel).boundingBox(), await leaf(page, "g0").boundingBox()];
    if (view === null || editor === null) throw new Error(`量不到 ${viewId} 或编辑组`);
    if (view.x + view.width <= editor.x + 1) return "sidebar";
    if (view.x >= editor.x + editor.width - 1) return "auxiliarybar";
    return "panel";
}
/** 经分节标题的右键菜单浮动一个视图（输出 23），返回窗的面板 id。 */
async function floatViaMenu(page: Page, viewId: string): Promise<string> {
    await tab(page, viewId).click({button: "right"});
    await page.getByRole("menu").getByRole("menuitem", {name: "浮动", exact: true}).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect.poll(() => regionOf(page, viewId)).toBe("float");
    return sectionOf(page, viewId);
}

async function centerOf(locator: Locator): Promise<{x: number; y: number}> {
    const found = await locator.boundingBox();
    if (found === null) throw new Error("没有矩形");
    return {x: found.x + found.width / 2, y: found.y + found.height / 2};
}

async function inLeaf(page: Page, panel: string, fraction: {x: number; y: number}): Promise<{x: number; y: number}> {
    const found = await leaf(page, panel).boundingBox();
    if (found === null) throw new Error(`没有 ${panel} 的外框`);
    return {x: found.x + found.width * fraction.x, y: found.y + found.height * fraction.y};
}

/** 外框的过渡走完：量几何之前等它（docs/testing/README.md“e2e 量几何先等它稳定”）。 */
const settled = (page: Page): Promise<void> => expect(page.locator("[data-moving]")).toHaveCount(0);
const content = (page: Page, viewId: string) => page.locator(`[data-content="view:${viewId}"]`);
/** 这块面板的头里看得见的标签：只写标题的头就是那一个。 */
const headTabsOf = (page: Page, panel: string): Promise<Array<string | null>> => page.locator(`[data-panel-head="${panel}"] [data-panel-tab]`).evaluateAll((elements) => elements.map((element) => element.getAttribute("data-panel-tab")));
/** 标签条里被拖的那个标签的外框（`translate` 写在它上面）：显示没有、横向在哪。 */
const sortedFrameOf = (locator: Locator): Promise<{visible: boolean; left: number; right: number}> => locator.evaluate((element) => {
    const frame = element.parentElement as HTMLElement;
    const box = frame.getBoundingClientRect();
    return {visible: getComputedStyle(frame).visibility === "visible", left: box.left, right: box.right};
});
/** 这个标签所在的那一行标签条。 */
const rowOf = (locator: Locator): Promise<{left: number; right: number}> => locator.evaluate((element) => {
    const box = (element.closest("[data-tab-row]") as Element).getBoundingClientRect();
    return {left: box.left, right: box.right};
});
/**
 * 右栏这一列的宽：编辑组 g0 的右沿到窗口右沿（右栏在编辑组右边）。分节在区域之间移动时是同一块面板、id 不变（输出 27），
 * 预览里丁那一节搬进侧栏后叶还在，量它自己的叶分不出“右栏收起了”，所以量这一列。
 */
const auxiliaryWidth = async (page: Page): Promise<number> => {
    const editor = await leaf(page, "g0").boundingBox();
    if (editor === null) throw new Error("没有编辑组");
    return (page.viewportSize()?.width ?? 0) - (editor.x + editor.width);
};
const widthOf = async (page: Page, panel: string): Promise<number> => {
    await settled(page);
    return (await leaf(page, panel).boundingBox())?.width ?? 0;
};

/** 按下、过门槛，拖动进行中，由调用方决定松手还是取消。 */
async function lift(page: Page, source: Locator): Promise<void> {
    const from = await centerOf(source);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y + 10, {steps: 2});
    await expect(surface(page)).toHaveAttribute("data-drag-feel", "live");
}

test.describe("实时布局", () => {
    let tmp = "";
    let server: ProbeServer;

    test.beforeAll(async () => {
        tmp = await createTestTmpRoot("neuro-book-e2e", "workbench-live-drag");
        await mkdir(join(tmp, "state"), {recursive: true});
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views", NBOOK_EXCLUDE_PLUGINS: "nbook.explorer,nbook.editor,nbook.agent,nbook.bots,nbook.canon,nbook.plot"}});
    });

    test.afterAll(async () => {
        expect(await server.stop()).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 1440, height: 900}});

    /** 本页客户端对 `workbench.layout` 的写入次数（同 `workbench-dnd.e2e.ts`）。 */
    async function writesOf(page: Page): Promise<number> {
        const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
        const db = new DatabaseSync(join(tmp, "state", "storage", "user.sqlite"));
        try {
            db.exec("CREATE TABLE IF NOT EXISTS layout_writes (client TEXT)");
            db.exec(`CREATE TRIGGER IF NOT EXISTS count_layout_insert AFTER INSERT ON records WHEN NEW.owner = 'nbook.workbench' AND NEW.key = 'workbench.layout' BEGIN INSERT INTO layout_writes VALUES (NEW.client); END`);
            db.exec(`CREATE TRIGGER IF NOT EXISTS count_layout_update AFTER UPDATE ON records WHEN NEW.owner = 'nbook.workbench' AND NEW.key = 'workbench.layout' BEGIN INSERT INTO layout_writes VALUES (NEW.client); END`);
            return (db.prepare("SELECT count(*) AS n FROM layout_writes WHERE client = ?1").get(client) as {n: number}).n;
        } finally {
            db.close();
        }
    }

    /** 写入次数停下来不变（两次读之间隔 400ms）之后的值：点击之类的写入是异步落库的。同 `workbench-dnd.e2e.ts`。 */
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

    /**
     * 搭一个戊、己两个标签的浮动窗，返回它的面板 id。区域里的分节只写标题、恰一个标签（输出 20、40），带标签条的只剩浮动窗：
     * 要“来源那块还有别的标签”“落到别人的标签条上”的用例在它上面测。戊浮出来之后底部面板切到己的容器（输出 43），
     * 己的标题拖到窗的正文上是添加为标签（输出 25 第 0 行）。
     */
    async function floatOfTwo(page: Page): Promise<string> {
        const window = await floatViaMenu(page, E);
        await expect(tab(page, F)).toBeVisible();
        // 底部面板切容器时外框在过渡：等停下再量己的标题，免得按在过渡中间的位置上没拿起来。
        await settled(page);
        const body = await inLeaf(page, window, {x: 0.5, y: 0.6});
        await lift(page, tab(page, F));
        await page.mouse.move(body.x, body.y, {steps: 6});
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect.poll(() => headTabsOf(page, window)).toEqual([`view:${E}`, `view:${F}`]);
        await settled(page);
        return window;
    }

    async function open(page: Page): Promise<void> {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await page.goto(new URL("/workbench", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(page.locator("[data-shell-focus-target=\"panel-toggle\"]")).toBeEnabled();
    }

    test("拖到面板这一排的右边：拖动中邻居真实让位，不写记录；松手一次写入，结果就是预览的样子", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        // 底部面板这一排只有戊那一节：把右栏的丁放到它的后半，在它后面插一节（输出 25 第 7 行），戊让出一半。
        const omega = await sectionOf(page, E);
        const before = await widthOf(page, omega);
        await lift(page, tab(page, AUXILIARY_VIEW));
        const target = await inLeaf(page, omega, {x: 0.97, y: 0.6});
        await page.mouse.move(target.x, target.y, {steps: 6});
        await expect(surface(page)).not.toHaveAttribute("data-live-preview", "none");
        // 预览换树之后布局下一拍才发布，过渡这时才开始：先等宽度真的变了。
        await expect.poll(async () => (await leaf(page, omega).boundingBox())?.width ?? 0).toBeLessThan(before - 40);
        const previewWidth = await widthOf(page, omega);
        expect(await writesOf(page)).toBe(writes);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
        await expect(surface(page)).toHaveAttribute("data-drag-feel", "indicator");
        await expect(surface(page)).toHaveAttribute("data-live-preview", "none");
        expect(await regionOf(page, AUXILIARY_VIEW)).toBe("panel");
        expect(await widthOf(page, omega)).toBeCloseTo(previewWidth, 0);
    });

    test("来源是那块面板最后一个视图：落到别处时它收起；它原来的位置这时是编辑组，回去不是原位、不展开；Esc 回原样（输出 38）", async ({page}) => {
        await open(page);
        const delta = await sectionOf(page, AUXILIARY_VIEW);
        expect(await headTabsOf(page, delta)).toEqual([`view:${AUXILIARY_VIEW}`]);
        const writes = await writesOf(page);
        const home = await centerOf(leaf(page, delta));
        await lift(page, tab(page, AUXILIARY_VIEW));
        // 拿起的是它唯一的视图：还没落到别处、没收起之前，原位是空位，标题头不留在原地。
        await page.mouse.move(home.x, home.y + 40, {steps: 4});
        await expect(page.locator("[data-lifted]")).toHaveCount(1);
        await expect(ghost(page)).toHaveCount(0);
        await expect(page.locator(`[data-panel-head="${delta}"]`)).toHaveCount(0);
        await expect(leaf(page, delta)).toHaveCount(1);
        // 侧栏甲那一节的后半（分节没有中央，整块是前后两半，输出 25 第 7 行）。
        const target = await inLeaf(page, await sectionOf(page, "test.sample-views.alpha"), {x: 0.5, y: 0.75});
        await page.mouse.move(target.x, target.y, {steps: 6});
        await expect(surface(page)).not.toHaveAttribute("data-live-preview", "none");
        await expect.poll(() => auxiliaryWidth(page)).toBeLessThan(2);
        // 回到它原来的位置：那里现在是编辑组，工具视图放不进去，是来源收起的样子，不是放回原处。
        await page.mouse.move(home.x, home.y, {steps: 12});
        await expect(surface(page)).toHaveAttribute("data-live-preview", "source-removed");
        await settled(page);
        expect(await auxiliaryWidth(page)).toBeLessThan(2);
        expect(await writesOf(page)).toBe(writes);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect.poll(() => auxiliaryWidth(page)).toBeGreaterThan(100);
        expect(await writesOf(page)).toBe(writes);
    });

    test("同一个容器里拖走前一节再回到原处：来源展开回原位、后一节让出位置，松手不写；松手后马上再按，照常拿起（输出 38）", async ({page}) => {
        await open(page);
        const [A, B] = ["test.sample-views.alpha", "test.sample-views.beta"];
        // 搭一个两节的容器：乙移进甲的容器，排在甲后面（输出 23）。
        await page.locator(`[data-tool-entry="view:${B}"]`).click();
        await tab(page, B).click({button: "right"});
        await page.getByRole("menu").getByRole("menuitem", {name: "样例甲", exact: true}).click();
        await expect(page.getByRole("menu")).toHaveCount(0);
        const [alpha, beta] = [await sectionOf(page, A), await sectionOf(page, B)];
        await expect(leaf(page, beta)).toHaveCount(1);
        await settled(page);
        const [alphaBox, betaBox] = [(await leaf(page, alpha).boundingBox())!, (await leaf(page, beta).boundingBox())!];
        const head = await centerOf(tab(page, A));
        const writes = await writesOf(page);

        await lift(page, tab(page, A));
        // 先落到别处（右栏丁那一节的后半）：来源收起，乙占满这一列。
        const away = await inLeaf(page, await sectionOf(page, AUXILIARY_VIEW), {x: 0.5, y: 0.8});
        await page.mouse.move(away.x, away.y, {steps: 8});
        await expect.poll(async () => (await leaf(page, beta).boundingBox())?.y).toBeLessThan(alphaBox.y + 2);
        // 回到原处：来源展开回原位，乙让回原来的位置；这是原位，不是落点。
        await page.mouse.move(alphaBox.x + alphaBox.width / 2, alphaBox.y + alphaBox.height / 2, {steps: 8});
        await expect(surface(page)).toHaveAttribute("data-live-preview", "in-place");
        await expect.poll(async () => Math.round((await leaf(page, beta).boundingBox())?.y ?? 0)).toBe(Math.round(betaBox.y));
        await expect(leaf(page, alpha)).toHaveCount(1);

        // 松手后马上在甲的标题上再按（开发者 2026-11-12 的步骤）：回到原处时已经展开，松手时甲的外框就在原位，照常拿起。
        await page.mouse.up();
        await page.mouse.move(head.x, head.y);
        await page.mouse.down();
        await page.mouse.move(head.x + 10, head.y + 10, {steps: 2});
        await expect(surface(page)).toHaveAttribute("data-drag-feel", "live");
        await page.mouse.move(away.x, away.y, {steps: 8});
        await expect.poll(async () => (await leaf(page, beta).boundingBox())?.y).toBeLessThan(alphaBox.y + 2);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        expect(await writesOf(page)).toBe(writes);
    });

    test("候选还没预览就松手：提交指针下的候选", async ({page}) => {
        await open(page);
        // 戊从底部面板放到右栏丁那一节的后半。
        await lift(page, tab(page, E));
        const target = await inLeaf(page, await sectionOf(page, AUXILIARY_VIEW), {x: 0.5, y: 0.75});
        await page.mouse.move(target.x, target.y);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect.poll(() => regionOf(page, E)).toBe("auxiliarybar");
    });

    test("移动与松手在同一个任务里到（候选一帧都没显示过）：还是提交指针下的候选", async ({page}) => {
        await open(page);
        // 戊从底部面板放到右栏丁那一节的后半。
        await lift(page, tab(page, E));
        const target = await inLeaf(page, await sectionOf(page, AUXILIARY_VIEW), {x: 0.5, y: 0.75});
        // 两次 Playwright 调用之间浏览器可能已经跑过一帧，分不出“与最后显示的相同才提交”：在页面里同一个任务派发。
        await page.evaluate(({x, y}) => {
            for (const type of ["pointermove", "pointerup"]) window.dispatchEvent(new PointerEvent(type, {bubbles: true, pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: x, clientY: y, button: type === "pointerup" ? 0 : -1, buttons: type === "pointerup" ? 0 : 1}));
        }, target);
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect.poll(() => regionOf(page, E)).toBe("auxiliarybar");
    });

    test("拿起时上一次布局变化的过渡还在走：判定按终点的矩形", async ({page}) => {
        await open(page);
        const omega = await sectionOf(page, E);
        // 戊那一节的后半：放下是在它后面插一节。
        const finalPanel = await inLeaf(page, omega, {x: 0.75, y: 0.5});
        const toggle = page.locator("[data-shell-focus-target=\"panel-toggle\"]");
        await toggle.click();
        await shrunk(page, omega);
        await settled(page);
        // 放慢过渡：面板还在长的时候拿起。过渡中间的矩形里指针下是别的面板（或者没有面板）。
        await page.addStyleTag({content: ":root { --motion-layout: 5000ms !important; }"});
        await toggle.click();
        await expect.poll(() => page.locator("[data-moving]").count()).toBeGreaterThan(0);
        // 面板这一排在动，拖右栏的视图。
        await lift(page, tab(page, AUXILIARY_VIEW));
        await page.mouse.move(finalPanel.x, finalPanel.y, {steps: 3});
        // 预览键是数组里的 JSON 串，引号带转义：只认“edge”和戊那一节的 id。
        await expect(surface(page)).toHaveAttribute("data-live-preview", new RegExp(`edge.*${omega.replaceAll(".", "\\.")}`, "u"));
        await page.keyboard.press("Escape");
        await page.mouse.up();
    });

    test("拖到面板外松手：卡片写“浮动打开”，内容从卡片飞到浮动窗，是同一个节点；面板上被拒绝时不写，光标是禁止", async ({page}) => {
        await open(page);
        const content = page.locator(`[data-content="view:${AUXILIARY_VIEW}"]`);
        const node = await content.elementHandle();
        await lift(page, tab(page, AUXILIARY_VIEW));
        // 先在自己那一节停到原位的预览摆出来，再到被拒绝的地方：等够 150ms 预览换成来源收起，被拒绝一直在。
        await expect(surface(page)).toHaveAttribute("data-live-preview", "in-place");
        const rejected = await inLeaf(page, "g0", {x: 0.5, y: 0.5});
        await page.mouse.move(rejected.x, rejected.y, {steps: 6});
        await expect(page.locator("html")).toHaveAttribute("data-drop-rejected", "");
        await expect(page.locator("[data-drag-card-hint]")).toHaveText("不能放在这里");
        await expect(surface(page)).toHaveAttribute("data-live-preview", "source-removed");
        await expect(page.locator("html")).toHaveAttribute("data-drop-rejected", "");
        await expect(page.locator("[data-drag-card-hint]")).toHaveText("不能放在这里");
        const target = await centerOf(page.locator("[data-shell-titlebar]"));
        await page.mouse.move(target.x, target.y, {steps: 6});
        await expect(page.locator("[data-lifted]")).toHaveCount(1);
        await expect(surface(page)).toHaveAttribute("data-live-preview", /float/);
        await expect(page.locator("[data-drag-card-hint]")).toHaveText("浮动打开");
        const card = await page.locator("[data-lifted]").boundingBox();
        if (card === null) throw new Error("没有卡片");
        // 松手后逐帧量新窗的外框与把手：它们和内容一起从卡片长到终点，不先画在终点。
        await page.evaluate(() => {
            const host = window as unknown as {__floatSamples: Array<{frame: number; chrome: number}>};
            host.__floatSamples = [];
            const sample = (): void => {
                const frame = document.querySelector("[data-workbench-surface] > [data-grid-scope] > [data-leaf][data-float]");
                const chrome = document.querySelector("[data-float-chrome]");
                if (frame !== null && chrome !== null) host.__floatSamples.push({frame: frame.getBoundingClientRect().width, chrome: chrome.getBoundingClientRect().width});
                if (host.__floatSamples.length < 40) requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
        });
        await page.mouse.up();
        await expect(page.locator("[data-lifted]")).toHaveCount(0);
        await expect(page.locator("[data-workbench-surface] > [data-grid-scope] > [data-leaf][data-float]")).toHaveCount(1);
        await expect.poll(() => page.evaluate(() => (window as unknown as {__floatSamples: unknown[]}).__floatSamples.length)).toBe(40);
        const samples = await page.evaluate(() => (window as unknown as {__floatSamples: Array<{frame: number; chrome: number}>}).__floatSamples);
        const [first, last] = [samples[0]!, samples.at(-1)!];
        expect(Math.abs(first.frame - card.width)).toBeLessThan(40);
        expect(Math.abs(first.chrome - first.frame)).toBeLessThan(2);
        expect(last.frame - first.frame).toBeGreaterThan(40);
        expect(await content.evaluate((element, other) => element === other, node)).toBe(true);
        // 布局记录这个文件的用例共用：放回去。
        await page.locator(`[data-panel-head="${await panelOfTab(page, AUXILIARY_VIEW)}"] [data-panel-action="nbook.view.dock"]`).click();
        await expect.poll(() => regionOf(page, AUXILIARY_VIEW)).toBe("auxiliarybar");
    });

    test("取消：布局回原样，不写记录", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const omega = await sectionOf(page, E);
        const before = await widthOf(page, omega);
        await lift(page, tab(page, AUXILIARY_VIEW));
        const target = await inLeaf(page, omega, {x: 0.97, y: 0.6});
        await page.mouse.move(target.x, target.y, {steps: 6});
        await expect(surface(page)).not.toHaveAttribute("data-live-preview", "none");
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(ghost(page)).toHaveCount(0);
        await expect(surface(page)).toHaveAttribute("data-live-preview", "none");
        expect(await widthOf(page, omega)).toBeCloseTo(before, 0);
        expect(await regionOf(page, AUXILIARY_VIEW)).toBe("auxiliarybar");
        expect(await writesOf(page)).toBe(writes);
    });

    test("撕下标签：一拖出标签条就拿起紧凑的卡片，窗接着显示另一个标签；拖回自己的正文是添加为标签，松手回到原来的位置、成为活动标签，内容一直是同一个节点（输出 38）", async ({page}) => {
        await open(page);
        // 要标签条与正文都在的来源：两个标签的浮动窗，拖后一个（己）；先让戊活动，松手要激活己。
        const panel = await floatOfTwo(page);
        await tab(page, E).click();
        await expect(tab(page, E)).toHaveAttribute("aria-selected", "true");
        await settled(page);
        const writes = await settledWrites(page);
        const node = await content(page, F).elementHandle();
        const same = (): Promise<boolean> => content(page, F).evaluate((element, other) => element === other, node);
        const home = await centerOf(tab(page, F));
        await lift(page, tab(page, F));
        const body = await inLeaf(page, panel, {x: 0.5, y: 0.6});
        await page.mouse.move(body.x, body.y, {steps: 4});
        const card = page.locator("[data-lifted]");
        await expect(card).toHaveCount(1);
        expect(await same()).toBe(true);
        await expect(ghost(page)).toHaveCount(0);
        await expect(page.locator("[data-drag-card-head]")).toHaveCount(1);
        // 撕下：窗里只剩戊，正文是戊，不是空的。
        await expect.poll(() => headTabsOf(page, panel)).toEqual([`view:${E}`]);
        await expect(content(page, E)).toBeVisible();
        // 自己的正文中央和别的面板的中央一样：盖一层，不写字。
        const merge = page.locator("[data-live-merge]");
        await expect(merge).toHaveAttribute("data-live-merge-panel", panel);
        await expect(merge).toHaveText("");
        const look = await card.evaluate((element) => {
            const style = getComputedStyle(element);
            return {events: style.pointerEvents, z: style.zIndex};
        });
        expect(look.events).toBe("none");
        expect(Number(look.z)).toBeGreaterThan(3);
        // 缺省一离开标签条就是紧凑的卡片，指针还在来源面板里也是。
        await expect.poll(async () => (await card.boundingBox())?.width ?? 0).toBeLessThanOrEqual(381);
        // 卡片里的内容按卡片的大小排版，不是拿起时的大小被裁出左上角：内容体和卡片一样宽，底边对齐。
        const cardBody = card.locator(":scope > .nb-grid-content__body");
        await expect.poll(async () => {
            const [outer, inner] = [await card.boundingBox(), await cardBody.boundingBox()];
            return outer === null || inner === null ? Infinity : Math.max(Math.abs(outer.width - inner.width), Math.abs(outer.y + outer.height - (inner.y + inner.height)));
        }).toBeLessThanOrEqual(1);
        // 卡片缩完：抓住的点还在指针下。
        await expect.poll(async () => {
            const box = await card.boundingBox();
            return box !== null && box.x <= body.x && body.x <= box.x + box.width && box.y <= body.y && body.y <= box.y + box.height;
        }).toBe(true);
        // 回到自己标签条它原来的位置：卡片收回，己回到条里跟手；再拖出来又撕下。
        await page.mouse.move(home.x, home.y, {steps: 8});
        await expect(card).toHaveCount(0);
        await expect.poll(() => headTabsOf(page, panel)).toEqual([`view:${E}`, `view:${F}`]);
        await expect.poll(() => sortedFrameOf(tab(page, F))).toMatchObject({visible: true});
        await page.mouse.move(body.x, body.y, {steps: 8});
        await expect(card).toHaveCount(1);
        await expect.poll(() => headTabsOf(page, panel)).toEqual([`view:${E}`]);
        await expect(merge).toHaveAttribute("data-live-merge-panel", panel);
        // 离开（侧栏甲那一节的后半）再回来，仍是添加为标签。
        const away = await inLeaf(page, await sectionOf(page, "test.sample-views.alpha"), {x: 0.5, y: 0.75});
        await page.mouse.move(away.x, away.y, {steps: 6});
        await expect(merge).toHaveCount(0);
        await page.mouse.move(body.x, body.y, {steps: 8});
        await expect(merge).toHaveAttribute("data-live-merge-panel", panel);
        expect(await writesOf(page)).toBe(writes);
        await page.mouse.up();
        await expect(card).toHaveCount(0);
        await settled(page);
        expect(await same()).toBe(true);
        expect(await headTabsOf(page, panel)).toEqual([`view:${E}`, `view:${F}`]);
        await expect(tab(page, F)).toHaveAttribute("aria-selected", "true");
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test.describe("设置离开面板才缩小（dragCardShrink）", () => {
        const settingsFile = (): string => join(tmp, "state", "settings.json");
        test.beforeEach(async () => {
            await writeFile(settingsFile(), JSON.stringify({"nbook.workbench/dragCardShrink": "panel"}));
        });
        test.afterEach(async () => {
            await rm(settingsFile(), {force: true});
        });

        test("离开标签条撕下一张卡片：内容是同一个节点，还在来源面板里是面板原大小；离开来源面板后缩小，抓住的点在指针下；取消后回到原处", async ({page}) => {
            await open(page);
            // 分节的标题不是标签条，按住就拿起（输出 20）：要“还在标签条里不拿起”，从浮动窗的标签条拖。
            const from = await floatOfTwo(page);
            const source = tab(page, E);
            const node = await content(page, E).elementHandle();
            await lift(page, source);
            // 还在标签条里：不拿起。
            await expect(page.locator("[data-lifted]")).toHaveCount(0);
            const inside = await inLeaf(page, from, {x: 0.5, y: 0.5});
            await page.mouse.move(inside.x, inside.y, {steps: 3});
            const card = page.locator("[data-lifted]");
            await expect(card).toHaveCount(1);
            expect(await card.evaluate((element, other) => element === other, node)).toBe(true);
            // 还在来源面板里：卡片是面板原大小，不是缩成的 380×260。卡片按布局里的面板矩形摆，和叶元素的盒差几个像素（卡片外沿），所以差 6px 以内算同样大。
            const home = await leaf(page, from).boundingBox();
            if (home === null || (home.width <= 390 && home.height <= 270)) throw new Error(`来源面板 ${String(home?.width)}×${String(home?.height)} 不比小卡大，分不出原大小与缩小后的卡片`);
            await expect.poll(async () => {
                const box = await card.boundingBox();
                return box === null ? Infinity : Math.max(Math.abs(box.width - home.width), Math.abs(box.height - home.height));
            }).toBeLessThanOrEqual(6);
            // 离开来源面板：缩到小卡，抓住的点还在指针下。
            const away = {x: inside.x + 500, y: inside.y};
            await page.mouse.move(away.x, away.y, {steps: 4});
            await expect.poll(async () => (await card.boundingBox())?.width ?? 0).toBeLessThanOrEqual(385);
            const box = await card.boundingBox();
            expect(away.x).toBeGreaterThanOrEqual(box?.x ?? 0);
            expect(away.x).toBeLessThanOrEqual((box?.x ?? 0) + (box?.width ?? 0));
            expect(away.y).toBeGreaterThanOrEqual(box?.y ?? 0);
            expect(away.y).toBeLessThanOrEqual((box?.y ?? 0) + (box?.height ?? 0));
            await page.keyboard.press("Escape");
            await page.mouse.up();
            await expect(page.locator("[data-lifted]")).toHaveCount(0);
            await expect(content(page, E)).not.toHaveAttribute("data-lifted", "");
            await settled(page);
            expect(await content(page, E).evaluate((element, other) => element === other, node)).toBe(true);
        });
    });

    test("预览不改可见性，读屏文字按语义变；拖到面板边上有空位，不画分区", async ({page}) => {
        await open(page);
        const instanceCount = () => page.locator("[data-sample-view]").count();
        // 视图是异步挂上的：先等这一刻看得见的三个（侧栏的甲、右栏的丁、底部面板当前容器的戊）都在，再数，不然数到的是还没挂完的。
        for (const view of ["test.sample-views.alpha", AUXILIARY_VIEW, E]) await expect(page.locator(`[data-sample-view="${view}"]`)).toHaveCount(1);
        const instances = await instanceCount();
        // 右栏的丁放到底部面板戊那一节的后半。
        await lift(page, tab(page, AUXILIARY_VIEW));
        const target = await inLeaf(page, await sectionOf(page, E), {x: 0.97, y: 0.6});
        await page.mouse.move(target.x, target.y, {steps: 6});
        await expect(surface(page)).not.toHaveAttribute("data-live-preview", "none");
        expect(await instanceCount()).toBe(instances);
        await expect(page.locator("[data-drag-live-status]")).not.toHaveText("");
        await expect(page.locator("[data-live-slot]")).toHaveCount(1);
        await expect(page.locator("[data-drop-sectors]")).toHaveCount(0);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(page.locator("[data-live-slot]")).toHaveCount(0);
    });

    test("松手时内容从卡片的位置飞到叶，内容体一次到终点宽度：不先压成小卡再长回去，也不从别处起飞", async ({page}) => {
        await open(page);
        // 右栏的丁放到底部面板戊那一节的后半。
        await lift(page, tab(page, AUXILIARY_VIEW));
        const target = await inLeaf(page, await sectionOf(page, E), {x: 0.97, y: 0.6});
        await page.mouse.move(target.x, target.y, {steps: 6});
        await expect(surface(page)).not.toHaveAttribute("data-live-preview", "none");
        await settled(page);
        const card = page.locator(".nb-grid-content[data-lifted]");
        const key = await card.getAttribute("data-content");
        const start = await card.boundingBox();
        if (key === null || start === null) throw new Error("没有拿起的卡片");
        await page.evaluate(() => {
            const widths: number[] = [];
            const points: Array<{x: number; y: number}> = [];
            const probe = window as unknown as {__widths: number[]; __points: typeof points; __frames: number};
            probe.__widths = widths;
            probe.__points = points;
            probe.__frames = 0;
            const sample = (): void => {
                probe.__frames += 1;
                const frame = document.querySelector(".nb-grid-content[data-lifted], .nb-grid-content[data-flying]");
                if (frame !== null) {
                    const rect = frame.getBoundingClientRect();
                    points.push({x: rect.x, y: rect.y});
                    widths.push(Math.round((frame.querySelector(":scope > .nb-grid-content__body") ?? frame).getBoundingClientRect().width));
                }
                if (probe.__frames < 30) requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
        });
        await page.mouse.up();
        await expect.poll(() => page.evaluate(() => (window as unknown as {__frames: number}).__frames)).toBe(30);
        const {widths, points} = await page.evaluate(() => {
            const probe = window as unknown as {__widths: number[]; __points: Array<{x: number; y: number}>};
            return {widths: probe.__widths, points: probe.__points};
        });
        // 只有拿起时的宽与终点的宽：中间值说明内容体跟着外框走了（先压成小卡再逐帧长回去）。
        expect(new Set(widths).size).toBeLessThanOrEqual(2);
        // 每一帧都在卡片与终点之间：跟手的位置在 transform 上，落地换回 left/top 时不能从网格的左上角起飞。
        await expect(page.locator(".nb-grid-content[data-flying]")).toHaveCount(0);
        const end = await page.locator(`.nb-grid-content[data-content="${key}"]`).boundingBox();
        if (end === null) throw new Error("落地后找不到内容");
        expect(points.length).toBeGreaterThan(2);
        for (const point of points) {
            expect(point.x).toBeGreaterThanOrEqual(Math.min(start.x, end.x) - 2);
            expect(point.x).toBeLessThanOrEqual(Math.max(start.x, end.x) + 2);
            expect(point.y).toBeGreaterThanOrEqual(Math.min(start.y, end.y) - 2);
            expect(point.y).toBeLessThanOrEqual(Math.max(start.y, end.y) + 2);
        }
    });

    test("标签条里不拿起卡片：被拖的标签自己沿条跟手、夹在条里，没有拖影，预览马上换；离开才撕下", async ({page}) => {
        await open(page);
        // 带标签条的只剩浮动窗（输出 20、39）。
        const panel = await floatOfTwo(page);
        const tabs = page.locator(`[data-panel-head="${panel}"] [data-panel-tab]`);
        expect(await tabs.count()).toBeGreaterThan(1);
        const other = tabs.filter({hasNot: page.locator(`[data-panel-tab="view:${E}"]`)}).first();
        await tab(page, E).click();
        await lift(page, tab(page, E));
        const otherBox = await other.boundingBox();
        if (otherBox === null) throw new Error("没有别的标签");
        await page.mouse.move(otherBox.x + 2, otherBox.y + otherBox.height / 2, {steps: 4});
        await expect(page.locator("[data-lifted]")).toHaveCount(0);
        await expect(surface(page)).not.toHaveAttribute("data-live-preview", "none");
        await expect(ghost(page)).toHaveCount(0);
        // 标签自己在指针下（横向）：留着的位置就是它，显示出来跟手。
        await expect.poll(() => sortedFrameOf(tab(page, E))).toMatchObject({visible: true});
        await expect.poll(async () => {
            const frame = await sortedFrameOf(tab(page, E));
            return frame.left <= otherBox.x + 2 && otherBox.x + 2 <= frame.right;
        }).toBe(true);
        // 指针到标签条的最左端：抓住的点在标签中间，不夹的话标签有一半出了条；夹住时左沿贴着条的左端。
        // 行首 4px 压在窗左缘 6px 的缩放把手下面（不接收，指针到那里就离开了标签条、撕下），停在把手右边。
        const row = await rowOf(tab(page, E));
        await page.mouse.move(row.left + 8, otherBox.y + otherBox.height / 2, {steps: 6});
        await expect(page.locator("[data-lifted]")).toHaveCount(0);
        await expect.poll(async () => (await sortedFrameOf(tab(page, E))).left).toBeGreaterThanOrEqual(row.left - 1);
        expect((await sortedFrameOf(tab(page, E))).left).toBeLessThan(row.left + 4);
        // 离开标签条：撕下。
        const away = await inLeaf(page, panel, {x: 0.5, y: 0.6});
        await page.mouse.move(away.x, away.y, {steps: 3});
        await expect(page.locator("[data-lifted]")).toHaveCount(1);
        await expect(ghost(page)).toHaveCount(0);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(page.locator("[data-lifted]")).toHaveCount(0);
    });

    test("长出新块时是空位：不画头，放下才有（输出 38）", async ({page}) => {
        await open(page);
        // 来源要在别的标签旁边，拿走它，来源那块的头还在：从戊、己两个标签的浮动窗里拖己。
        await floatOfTwo(page);
        const heads = await page.locator("[data-panel-head]").count();
        const node = await content(page, F).elementHandle();
        await lift(page, tab(page, F));
        // 右栏丁那一节的后半：在它后面长出一节。
        const target = await inLeaf(page, await sectionOf(page, AUXILIARY_VIEW), {x: 0.5, y: 0.9});
        await page.mouse.move(target.x, target.y, {steps: 6});
        await expect(surface(page)).toHaveAttribute("data-live-preview", /edge/u);
        await expect(page.locator("[data-live-slot]")).toBeVisible();
        // 新块的头、标题都还没有：头的数量不变，来源的标签哪儿都没有。
        await expect(page.locator("[data-panel-head]")).toHaveCount(heads);
        await expect(tab(page, F)).toHaveCount(0);
        // 让出的位置什么都不画：卡片没有底、没有投影，缺省没有边框，露出窗体底。
        const slotCard = page.locator("[data-shell-slot]");
        await expect(slotCard).toHaveCount(1);
        const paint = await slotCard.evaluate((element) => {
            const computed = getComputedStyle(element);
            const slot = getComputedStyle(document.querySelector("[data-live-slot]") as Element);
            return {background: computed.backgroundColor, shadow: computed.boxShadow, border: slot.borderTopColor, fill: slot.backgroundColor};
        });
        expect(paint).toEqual({background: "rgba(0, 0, 0, 0)", shadow: "none", border: "rgba(0, 0, 0, 0)", fill: "rgba(0, 0, 0, 0)"});
        await page.mouse.up();
        await expect(tab(page, F)).toHaveCount(1);
        await expect(page.locator("[data-panel-head]")).toHaveCount(heads + 1);
        expect(await content(page, F).evaluate((element, other) => element === other, node)).toBe(true);
    });

    test("并入是目标不动、盖一层：头和活动标签不变，内容是同一个节点；放下才变（输出 38）", async ({page}) => {
        await open(page);
        // 分节没有中央（输出 25 第 7 行），添加为标签只在浮动窗的正文上：来源是戊、己两个标签的窗里的戊，目标是丁浮出来的另一个窗。
        const source = await floatOfTwo(page);
        const other = await floatViaMenu(page, AUXILIARY_VIEW);
        // 新开的窗和前一个在同一处（松手处或居中）：用移动把手的键盘把它往右挪 50 下（输出 39“键盘”），两个窗不重叠。
        const before = (await leaf(page, other).boundingBox())!;
        await page.locator(`[data-float-chrome="${other}"] [data-float-move-handle]`).focus();
        for (let step = 0; step < 50; step += 1) await page.keyboard.press("ArrowRight");
        await expect.poll(async () => (await leaf(page, other).boundingBox())!.x).toBeGreaterThan(before.x + 400);
        await settled(page);
        // 在浮动窗上按下会把它提到最上（`raiseFloat`，是一次写入，不属于拖动）：先点一下来源窗里戊的标签把它提上来。
        await tab(page, E).click();
        // 挪窗、提窗的写入合并在一小段时间里落库（`LAYOUT_SAVE_COALESCE_MS`）：等写入次数隔一段合并时间不再变，再记拖动前的数。
        let seen = -1;
        await expect.poll(async () => {
            const now = await writesOf(page);
            const quiet = now === seen;
            seen = now;
            return quiet;
        }, {intervals: [400]}).toBe(true);
        const writes = await writesOf(page);
        const node = await content(page, E).elementHandle();
        const headBefore = await headTabsOf(page, other);
        await lift(page, tab(page, E));
        const target = await inLeaf(page, other, {x: 0.5, y: 0.6});
        await page.mouse.move(target.x, target.y, {steps: 6});
        const merge = page.locator("[data-live-merge]");
        await expect(merge).toHaveAttribute("data-live-merge-panel", other);
        await expect(merge).toHaveText("");
        await settled(page);
        expect(await headTabsOf(page, other)).toEqual(headBefore);
        // 来源那块还有一个标签，头不跟着变成只写标题：按已提交的文档算（输出 20）。
        await expect(page.locator(`[data-panel-head="${source}"] [role="tab"]`)).not.toHaveCount(0);
        // 盖住整块面板：头也算。
        const [cover, frame] = [await merge.boundingBox(), await leaf(page, other).boundingBox()];
        expect(Math.abs((cover?.x ?? 0) - (frame?.x ?? 0))).toBeLessThanOrEqual(1);
        expect(Math.abs((cover?.height ?? 0) - (frame?.height ?? 0))).toBeLessThanOrEqual(1);
        const style = await merge.evaluate((element) => {
            const computed = getComputedStyle(element);
            return {background: computed.backgroundColor, shadow: computed.boxShadow};
        });
        expect(style.background).not.toBe("rgba(0, 0, 0, 0)");
        expect(style.shadow).toContain("2px");
        expect(await content(page, E).evaluate((element, other) => element === other, node)).toBe(true);
        expect(await writesOf(page)).toBe(writes);
        await page.mouse.up();
        await expect(merge).toHaveCount(0);
        await expect.poll(() => panelOfTab(page, E)).toBe(other);
        expect(await content(page, E).evaluate((element, other) => element === other, node)).toBe(true);
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test("别人的标签条上被吸收：卡片收回，预览是放下的样子，零写入；离开卡片回来，目标恢复；放下就是预览的样子（输出 38）", async ({page}) => {
        await open(page);
        // 别人的标签条：带标签条的只剩浮动窗（输出 20、39），丁落到戊、己两个标签的窗上。
        const window = await floatOfTwo(page);
        const writes = await writesOf(page);
        const node = await content(page, AUXILIARY_VIEW).elementHandle();
        const head = page.locator(`[data-panel-head="${window}"]`);
        const activeBefore = await head.locator("[data-panel-tab][aria-selected=\"true\"]").getAttribute("data-panel-tab");
        await lift(page, tab(page, AUXILIARY_VIEW));
        const strip = await head.locator("[data-panel-tab]").first().boundingBox();
        if (strip === null) throw new Error("面板没有标签");
        // 第一个标签的左四分之一：插到它前面。不贴着窗的左沿，那里是浮动窗改大小的把手，不接收落点。
        const before = {x: strip.x + strip.width / 4, y: strip.y + strip.height / 2};
        await page.mouse.move(before.x, before.y, {steps: 6});
        const card = page.locator("[data-lifted]");
        const placed = head.locator(`[data-panel-tab="view:${AUXILIARY_VIEW}"]`);
        await expect(placed).toHaveCount(1);
        await expect(card).toHaveCount(0);
        await expect(ghost(page)).toHaveCount(0);
        await expect(page.locator("[data-live-merge]")).toHaveCount(0);
        // 它自己在这条标签条里跟手，是这块面板的活动标签；内容是同一个节点。
        await expect.poll(() => sortedFrameOf(placed)).toMatchObject({visible: true});
        await expect(placed).toHaveAttribute("aria-selected", "true");
        expect(await content(page, AUXILIARY_VIEW).evaluate((element, other) => element === other && element.isConnected, node)).toBe(true);
        expect(await writesOf(page)).toBe(writes);
        // 离开标签条：卡片回来；预览换走之后目标恢复。
        const away = await inLeaf(page, window, {x: 0.5, y: 0.6});
        await page.mouse.move(away.x, away.y, {steps: 3});
        await expect(card).toHaveCount(1);
        await expect(ghost(page)).toHaveCount(0);
        await expect(head.locator("[data-panel-tab][aria-selected=\"true\"]")).toHaveAttribute("data-panel-tab", activeBefore ?? "");
        // 回去，放下。
        await page.mouse.move(before.x, before.y, {steps: 3});
        await expect(card).toHaveCount(0);
        await page.mouse.up();
        await expect.poll(() => panelOfTab(page, AUXILIARY_VIEW)).toBe(window);
        await expect(head.locator("[data-panel-tab]").first()).toHaveAttribute("data-panel-tab", `view:${AUXILIARY_VIEW}`);
        expect(await content(page, AUXILIARY_VIEW).evaluate((element, other) => element === other, node)).toBe(true);
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test("活动栏也是标签条：别处的视图放到两个入口之间被吸收，入口让位，零写入；Esc 回原样；它是右栏一个容器唯一的视图，放下整个容器搬到侧栏、id 不变（输出 22、38、45、46）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const entries = page.locator("[data-rail=sidebar] [data-tool-band] [data-tool-entry]");
        // 入口列的是容器（输出 22）：样例丁是右栏里它那个容器唯一的视图，落在入口之间是整个容器搬过来，入口是它原来的容器（输出 45）。
        const order = (): Promise<string[]> => entries.evaluateAll((elements) => elements.map((element) => {
            const id = (element as HTMLElement).dataset.toolEntry ?? "";
            return id.startsWith("custom:") ? "custom" : id;
        }));
        const before = await order();
        const first = await entries.first().boundingBox();
        if (first === null || before.length === 0) throw new Error("活动栏没有入口");
        await lift(page, tab(page, AUXILIARY_VIEW));
        // 第一个入口的上沿：入口之间（第一个之前），不是入口上（输出 45）。
        await page.mouse.move(first.x + first.width / 2, first.y + 2, {steps: 6});
        const placed = page.locator(`[data-rail=sidebar] [data-tool-band] [data-tool-view="${AUXILIARY_VIEW}"]`);
        await expect(placed).toHaveCount(1);
        await expect(page.locator("[data-lifted]")).toHaveCount(0);
        await expect(ghost(page)).toHaveCount(0);
        await expect.poll(() => placed.evaluate((element) => getComputedStyle(element.closest(".workbench-tool-strip__frame") as Element).visibility)).toBe("visible");
        await expect.poll(order).toEqual([`view:${AUXILIARY_VIEW}`, ...before]);
        expect(await writesOf(page)).toBe(writes);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect.poll(order).toEqual(before);
        expect(await writesOf(page)).toBe(writes);
        await settled(page);
        await lift(page, tab(page, AUXILIARY_VIEW));
        await page.mouse.move(first.x + first.width / 2, first.y + 2, {steps: 6});
        await expect(placed).toHaveCount(1);
        await page.mouse.up();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
        await expect.poll(order).toEqual([`view:${AUXILIARY_VIEW}`, ...before]);
        // 放下才切：侧栏切到这个容器，入口按下（输出 45）。
        await expect(placed).toHaveAttribute("aria-pressed", "true");
        expect(await regionOf(page, AUXILIARY_VIEW)).toBe("sidebar");
    });

    test("侧栏隐藏时放到活动栏：预览里侧栏不展开，条目照样让位；放下才展开并装着它（输出 22、38）", async ({page}) => {
        await open(page);
        // 分节没有隐藏按钮（输出 20）：点当前容器按下着的入口，侧栏隐藏（输出 22）。
        const alpha = await sectionOf(page, "test.sample-views.alpha");
        await page.locator("[data-rail=sidebar] [data-tool-band] [data-tool-entry][aria-pressed=\"true\"]").click();
        await shrunk(page, alpha);
        await settled(page);
        const writes = await writesOf(page);
        const first = await page.locator("[data-rail=sidebar] [data-tool-band] [data-tool-entry]").first().boundingBox();
        if (first === null) throw new Error("活动栏没有条目");
        await lift(page, tab(page, AUXILIARY_VIEW));
        await page.mouse.move(first.x + first.width / 2, first.y + 2, {steps: 6});
        await expect(page.locator(`[data-rail=sidebar] [data-tool-band] [data-tool-view="${AUXILIARY_VIEW}"]`)).toHaveCount(1);
        await settled(page);
        await shrunk(page, alpha);
        expect(await writesOf(page)).toBe(writes);
        await page.mouse.up();
        // 侧栏显示出来，切到装着丁的新容器（输出 45）。
        await expect.poll(() => regionOf(page, AUXILIARY_VIEW)).toBe("sidebar");
        await expect(leaf(page, alpha)).toHaveCount(0);
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
    });

    test("活动栏里换序：别的图标滑开（真的播了过渡），被拖的图标自己竖着跟手，没有拖影；按下的块在它占着的那一格", async ({page}) => {
        await open(page);
        const entries = page.locator("[data-rail=sidebar] [data-tool-band] [data-tool-entry]");
        expect(await entries.count()).toBeGreaterThan(1);
        const second = await entries.nth(1).boundingBox();
        if (second === null) throw new Error("没有第二个条目");
        await page.evaluate(() => {
            const host = window as unknown as {__toolMoved: boolean};
            host.__toolMoved = false;
            new MutationObserver((records) => {
                if (records.some((record) => (record.target as Element).classList.contains("workbench-tool-strip__frame--moving"))) host.__toolMoved = true;
            }).observe(document.querySelector("[data-rail=sidebar] [data-tool-band]") as Element, {subtree: true, attributes: true, attributeFilter: ["class"]});
        });
        const firstId = await entries.first().getAttribute("data-tool-entry");
        await expect(entries.first()).toHaveAttribute("aria-pressed", "true");
        const bandTop = (await page.locator("[data-rail=sidebar] [data-tool-band]").boundingBox())!.y;
        await lift(page, entries.first());
        await expect(page.locator("[data-lifted]")).toHaveCount(0);
        await page.mouse.move(second.x + second.width / 2, second.y + second.height - 2, {steps: 6});
        await expect.poll(() => page.evaluate(() => (window as unknown as {__toolMoved: boolean}).__toolMoved)).toBe(true);
        await expect(ghost(page)).toHaveCount(0);
        const dragged = page.locator(`[data-rail=sidebar] [data-tool-band] [data-tool-entry="${firstId}"]`);
        await expect.poll(async () => {
            const box = await dragged.boundingBox();
            const y = second.y + second.height - 2;
            return box !== null && box.y <= y && y <= box.y + box.height;
        }).toBe(true);
        // 抓住的点在指针下：按在图标中间拿起的，指针不在它的上沿（这个入口的视图也是侧栏里一节的标题，按它的矩形算抓点会夹成 0，图标挂在指针下面）。
        // 按下的块在被拖的入口占着的那一格（第二格），不跟着按钮外层的 `translate` 量成 0。
        expect(await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector("[data-tool-indicator]")!).transform).f)).toBeCloseTo(second.y - bandTop, 0);
        const grabbed = await dragged.boundingBox();
        expect(grabbed).not.toBeNull();
        expect((second.y + second.height - 2 - (grabbed?.y ?? 0)) / (grabbed?.height ?? 1)).toBeGreaterThan(0.25);
        await expect(page.locator("[data-lifted]")).toHaveCount(0);
        await page.keyboard.press("Escape");
        await page.mouse.up();
    });

    test("活动栏里慢慢经过邻居入口：停在它上面它高亮、就在指针下，入口不动、来源不收起；松手并进那个容器（输出 38、45）", async ({page}) => {
        await open(page);
        const entries = page.locator("[data-rail=sidebar] [data-tool-band] [data-tool-entry]");
        expect(await entries.count()).toBeGreaterThan(2);
        const firstId = (await entries.nth(0).getAttribute("data-tool-entry")) ?? "";
        const secondId = (await entries.nth(1).getAttribute("data-tool-entry")) ?? "";
        const before = await Promise.all([0, 1, 2].map((index) => entries.nth(index).boundingBox()));
        const second = before[1];
        if (second === null || second === undefined) throw new Error("没有第二个入口");
        const writes = await writesOf(page);
        // 第一个入口是侧栏当前容器唯一的视图：活动栏是它自己的入口条。
        await lift(page, entries.first());
        const over = {x: second.x + second.width / 2, y: second.y + second.height / 2};
        await page.mouse.move(over.x, over.y, {steps: 8});
        const merged = page.locator(`[data-rail=sidebar] [data-tool-band] [data-tool-entry="${secondId}"][data-tool-merge]`);
        await expect(merged).toHaveCount(1);
        // 来源没收起：它的入口还在，入口都没挪，高亮的就是指针下面那个。
        await expect(entries).toHaveCount(before.length);
        for (const [index, box] of before.entries()) expect((await entries.nth(index).boundingBox())?.y).toBe(box?.y);
        const box = await merged.boundingBox();
        expect(box !== null && box.y <= over.y && over.y <= box.y + box.height).toBe(true);
        expect(await writesOf(page)).toBe(writes);
        await page.mouse.up();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
        // 并进第二个容器：第一个入口跟着它唯一的视图走了，侧栏切到第二个容器。
        await expect(page.locator(`[data-rail=sidebar] [data-tool-band] [data-tool-entry="${firstId}"]`)).toHaveCount(0);
        await expect(page.locator(`[data-rail=sidebar] [data-tool-band] [data-tool-entry="${secondId}"]`)).toHaveAttribute("aria-pressed", "true");
    });

    test("来源收起之后再回到活动栏、停在别的入口上：来源不画回来，高亮的就是指针下那个；松手并进它（输出 38、45）", async ({page}) => {
        await open(page);
        const entries = page.locator("[data-rail=sidebar] [data-tool-band] [data-tool-entry]");
        const count = await entries.count();
        expect(count).toBeGreaterThan(2);
        const firstId = (await entries.nth(0).getAttribute("data-tool-entry")) ?? "";
        const secondId = (await entries.nth(1).getAttribute("data-tool-entry")) ?? "";
        // 第一个入口是侧栏当前容器唯一的视图：拖它就是拖这个视图。
        const source = await sectionOf(page, (await entries.nth(0).getAttribute("data-tool-view")) ?? "");
        const writes = await writesOf(page);
        await lift(page, entries.first());
        // 先停到右栏那一节的后半：来源收起，它的入口没了、下面的入口上移（预览里它那一节摆在右栏，分节换区域时 id 不变）。
        const away = await inLeaf(page, await sectionOf(page, AUXILIARY_VIEW), {x: 0.5, y: 0.8});
        await page.mouse.move(away.x, away.y, {steps: 8});
        await expect(entries).toHaveCount(count - 1);
        // 收起之后再量第二个入口，停到它中间。
        const second = await page.locator(`[data-rail=sidebar] [data-tool-band] [data-tool-entry="${secondId}"]`).boundingBox();
        if (second === null) throw new Error("没有第二个入口");
        const over = {x: second.x + second.width / 2, y: second.y + second.height / 2};
        await page.mouse.move(over.x, over.y, {steps: 8});
        const merged = page.locator(`[data-rail=sidebar] [data-tool-band] [data-tool-entry="${secondId}"][data-tool-merge]`);
        await expect(merged).toHaveCount(1);
        await expect(entries).toHaveCount(count - 1);
        await expect(leaf(page, source)).toHaveCount(0);
        const box = await merged.boundingBox();
        expect(box !== null && box.y <= over.y && over.y <= box.y + box.height).toBe(true);
        expect(await writesOf(page)).toBe(writes);
        await page.mouse.up();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
        await expect(page.locator(`[data-rail=sidebar] [data-tool-band] [data-tool-entry="${firstId}"]`)).toHaveCount(0);
        await expect(page.locator(`[data-rail=sidebar] [data-tool-band] [data-tool-entry="${secondId}"]`)).toHaveAttribute("aria-pressed", "true");
    });

    test("中途窗口变了：整场取消", async ({page}) => {
        await open(page);
        // 右栏的丁放到底部面板戊那一节的后半。
        await lift(page, tab(page, AUXILIARY_VIEW));
        const target = await inLeaf(page, await sectionOf(page, E), {x: 0.97, y: 0.6});
        await page.mouse.move(target.x, target.y, {steps: 6});
        await expect(surface(page)).not.toHaveAttribute("data-live-preview", "none");
        await page.setViewportSize({width: 1300, height: 800});
        // 指针一动就判定：窗口变化的事件先于布局发布，那一次还看不出来。
        await page.mouse.move(target.x - 2, target.y);
        await page.mouse.move(target.x - 4, target.y);
        await expect(surface(page)).toHaveAttribute("data-drag-feel", "indicator");
        await expect(surface(page)).toHaveAttribute("data-live-preview", "none");
        await page.mouse.up();
        expect(await regionOf(page, AUXILIARY_VIEW)).toBe("auxiliarybar");
    });

    test("键盘拖动是落点指示", async ({page}) => {
        await open(page);
        await tab(page, E).focus();
        await page.keyboard.press("Space");
        await expect(ghost(page)).toBeVisible();
        await expect(surface(page)).toHaveAttribute("data-drag-feel", "indicator");
        await page.keyboard.press("Escape");
        await expect(ghost(page)).toHaveCount(0);
    });
});
