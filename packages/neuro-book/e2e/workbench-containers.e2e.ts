/**
 * 视图容器在真实 Chrome 中的验收（docs/specs/ui/workbench-layout.md 输出 22、41、42、43、45，验收 24、25、26、28、29、30、32）：切换容器、
 * 区域拖到零之后点入口、拖到活动栏（新建容器、并入）、当前容器拖空、拖动中容器被命令切走、有容器之前存的记录回落。生产构建的后端与前端；侧栏除了内置容器“项目”（会话、资源管理器两个分节），再用测试插件
 * `test.sample-views` 的样例视图当别的容器（它们没写容器，各是自己的隐式容器）。等页面上可观察的变化，不按时长等待。
 *
 * 不在这里的：
 * - 活动栏入口的点击、按下态、溢出、右键菜单与键盘：`workbench-views.e2e.ts`；
 * - 搬容器带着什么、入口顺序、一次提交：`state/containers.test.ts`、`state/layout-doc-store.test.ts`；
 * - 入口条上落点的判定（入口上、入口之间、原处）与键盘停靠点的位置：`web/entry-drop.test.ts`。
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
import {SAMPLE_VIEWS_RUN_EVENT} from "nbook/shared/testing/sample-views-contract";

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
        // 搭一个两个分节的容器：样例乙移进样例甲的容器，成为它最后一个分节，侧栏切到这个容器（输出 23）。
        await entry(page, `view:${B}`).click();
        await expect(sample(page, B)).toBeVisible();
        await moveViaMenu(page, B, "样例甲");
        await expect(entry(page, `view:${B}`)).toHaveCount(0);
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

    test("切回容器、侧栏从隐藏到显示：停放过的内容跟着外框一起长出来，每一帧都不超出外框；侧栏显示时整列从活动栏边上横着长出来，隐藏时整列留着缩回去（ui/nested-grid 的内容层与过渡）", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        const explorer = await sectionOf(page, EXPLORER);
        /** 在页面里点一下，逐帧量这一节的外框与内容，直到网格的过渡结束。只记内容看得见的帧。 */
        const framesAfter = (selector: string) => page.evaluate(async ({selector, leafId}) => {
            const rows: Array<{frameLeft: number; frameRight: number; frameWidth: number; frameTop: number; frameBottom: number; frameHeight: number; contentLeft: number; contentRight: number; contentTop: number; contentBottom: number; headRight: number; bodyRight: number; gapHit: boolean; cornerHit: boolean; innerHit: boolean}> = [];
            document.querySelector<HTMLElement>(selector)!.click();
            for (let frame = 0; frame < 90; frame += 1) {
                await new Promise((resolve) => requestAnimationFrame(resolve));
                const frameEl = document.querySelector(`[data-workbench-surface] > [data-grid-scope] > [data-leaf="${leafId}"]`);
                const leaf = frameEl?.getBoundingClientRect();
                const content = document.querySelector<HTMLElement>("[data-content=\"view:nbook.explorer\"]");
                if (frameEl != null && leaf !== undefined && content !== null && getComputedStyle(content).visibility === "visible") {
                    const rect = content.getBoundingClientRect();
                    // 外框、内容外层是裁切框；面板头与内容体是里面最终尺寸的那层，看得见的东西跟着它走。
                    const head = frameEl.querySelector(":scope > [data-leaf-content]")!.getBoundingClientRect();
                    const body = content.querySelector(":scope > .nb-grid-content__body")!.getBoundingClientRect();
                    // 露出来的那一截是不是一张完整的卡片：按命中看（裁切也挡命中）。卡片看得见的左上角是外框的左上角加卡片的内边距。
                    const card = frameEl.querySelector<HTMLElement>("[data-shell-card]")!;
                    const pad = getComputedStyle(card.parentElement!);
                    const radius = Number.parseFloat(getComputedStyle(card).borderTopLeftRadius);
                    const cardLeft = leaf.left + Number.parseFloat(pad.paddingLeft);
                    const cardTop = leaf.top + Number.parseFloat(pad.paddingTop);
                    const inLeaf = (x: number, y: number): boolean => {
                        const hit = document.elementFromPoint(x, y);
                        return hit !== null && (frameEl.contains(hit) || hit.closest(`[data-content-leaf="${leafId}"]`) !== null);
                    };
                    rows.push({
                        frameLeft: leaf.left, frameRight: leaf.right, frameWidth: leaf.width, frameTop: leaf.top, frameBottom: leaf.bottom, frameHeight: leaf.height,
                        contentLeft: rect.left, contentRight: rect.right, contentTop: rect.top, contentBottom: rect.bottom, headRight: head.right, bodyRight: body.right,
                        gapHit: inLeaf((leaf.left + cardLeft) / 2, leaf.top + leaf.height / 2),
                        cornerHit: inLeaf(cardLeft + 1, cardTop + 1),
                        innerHit: inLeaf(cardLeft + radius, cardTop + radius),
                    });
                }
                if (frame > 2 && document.querySelector("[data-workbench-surface] [data-moving]") === null) break;
            }
            return rows;
        }, {selector, leafId: explorer});
        const expectInside = (rows: Awaited<ReturnType<typeof framesAfter>>, grows: "frameHeight" | "frameWidth") => {
            const final = rows.at(-1)?.[grows] ?? 0;
            // 确实量到了过渡中间的帧，不是一下子到终点。
            expect(rows.some((row) => row[grows] < final - 50)).toBe(true);
            for (const row of rows) {
                expect(row.contentTop).toBeGreaterThanOrEqual(row.frameTop - 1);
                expect(row.contentBottom).toBeLessThanOrEqual(row.frameBottom + 1);
                expect(row.contentLeft).toBeGreaterThanOrEqual(row.frameLeft - 1);
                expect(row.contentRight).toBeLessThanOrEqual(row.frameRight + 1);
            }
        };

        // 切到样例甲的容器，再切回“项目”。
        await entry(page, `view:${A}`).click();
        await expect(leaf(page, explorer)).toHaveCount(0);
        await expect(page.locator("[data-workbench-surface] [data-moving]")).toHaveCount(0);
        expectInside(await framesAfter(`[data-tool-entry="${PROJECT_CONTAINER}"]`), "frameHeight");

        // 点当前容器的入口隐藏侧栏：整列留着、作为一块缩回活动栏边上，每一帧全高、左边不动，内容被外框裁着；过渡结束才摘掉。
        // 面板头与内容贴着外框在动的右边，整块往左平移出去，不是停在原地被外框像幕布一样盖上。
        await expect(page.locator("[data-workbench-surface] [data-moving]")).toHaveCount(0);
        const hiding = await framesAfter(`[data-tool-entry="${PROJECT_CONTAINER}"]`);
        const start = hiding[0]!;
        expect(hiding.some((row) => row.frameWidth > 50 && row.frameWidth < start.frameWidth - 50)).toBe(true);
        for (const row of hiding) {
            expect(row.frameHeight).toBeCloseTo(start.frameHeight, 0);
            expect(row.frameLeft).toBeCloseTo(start.frameLeft, 0);
            expect(row.contentLeft).toBeGreaterThanOrEqual(row.frameLeft - 1);
            expect(row.contentRight).toBeLessThanOrEqual(row.frameRight + 1);
            expect(row.headRight).toBeCloseTo(row.frameRight, 0);
            expect(row.bodyRight).toBeCloseTo(row.frameRight, 0);
        }
        await expect(leaf(page, explorer)).toHaveCount(0);
        await expect(page.locator("[data-workbench-surface] [data-moving]")).toHaveCount(0);
        await expect(content(page, EXPLORER)).toBeHidden();

        // 再点一次显示。
        const showing = await framesAfter(`[data-tool-entry="${PROJECT_CONTAINER}"]`);
        expectInside(showing, "frameWidth");
        // 整列作为一块横着长：每一帧都是全高、左边贴着活动栏，不是列里的几节各自竖着长（那样整列一开始就是全宽，压在还没让开的编辑区上）。
        // 面板头与内容贴着外框的右边，整块从左边平移进来。
        const settled = showing.at(-1)!;
        for (const row of showing) {
            expect(row.frameHeight).toBeCloseTo(settled.frameHeight, 0);
            expect(row.frameLeft).toBeCloseTo(settled.frameLeft, 0);
            expect(row.headRight).toBeCloseTo(row.frameRight, 0);
            expect(row.bodyRight).toBeCloseTo(row.frameRight, 0);
        }
        // 露出来的一截始终是一张完整的卡片：和活动栏之间的缝还在，左上角是圆的（按外框的直角矩形裁时，卡片在左边被直着切掉，缝没了、角是尖的）。
        const middle = showing.filter((row) => row.frameWidth > 60 && row.frameWidth < settled.frameWidth - 1);
        expect(middle.length).toBeGreaterThan(0);
        for (const row of middle) expect([row.gapHit, row.cornerHit, row.innerHit]).toEqual([false, false, true]);
    });

    test("活动栏与只有一节的侧栏相连：隐藏侧栏时两张卡片一直连着缩回去，这一节摘掉后活动栏才断开；显示时一开始就相连（ui/workbench-layout 输出 19）", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        const moving = page.locator("[data-workbench-surface] [data-moving]");
        const bar = page.locator('[data-shell-card="activitybar"]');
        await entry(page, `view:${A}`).click();
        await expect(moving).toHaveCount(0);
        const section = await sectionOf(page, A);
        await expect(bar).toHaveAttribute("data-shell-join", "start");
        await expect(page.locator(`[data-shell-card="${section}"]`)).toHaveAttribute("data-shell-join", "end");
        /** 点一下入口，逐帧记这一节的外框还在不在、活动栏相连没有，直到网格的过渡结束。 */
        const film = () => page.evaluate(async ({selector, leafId}) => {
            const rows: Array<{present: boolean; barJoin: string | null}> = [];
            document.querySelector<HTMLElement>(selector)!.click();
            for (let frame = 0; frame < 90; frame += 1) {
                await new Promise((resolve) => requestAnimationFrame(resolve));
                const present = document.querySelector(`[data-workbench-surface] > [data-grid-scope] > [data-leaf="${leafId}"]`) !== null;
                rows.push({present, barJoin: document.querySelector<HTMLElement>('[data-shell-card="activitybar"]')!.dataset.shellJoin ?? null});
                if (frame > 2 && document.querySelector("[data-workbench-surface] [data-moving]") === null) break;
            }
            return rows;
        }, {selector: `[data-tool-entry="view:${A}"]`, leafId: section});

        // 隐藏：这一节留着缩回去的每一帧，活动栏都还相连（按呈现算的话第一帧就断开了，缩回去的那节贴着它的一边却是直的）；摘掉之后才断开。
        const hiding = await film();
        expect(hiding.filter((row) => row.present).length).toBeGreaterThan(2);
        for (const row of hiding.filter((row) => row.present)) expect(row.barJoin).toBe("start");
        await expect(moving).toHaveCount(0);
        await expect(leaf(page, section)).toHaveCount(0);
        expect(await bar.getAttribute("data-shell-join")).toBeNull();

        // 显示：长出来的每一帧都相连。
        const showing = await film();
        expect(showing.filter((row) => row.present).length).toBeGreaterThan(2);
        for (const row of showing.filter((row) => row.present)) expect(row.barJoin).toBe("start");
    });

    test("底部面板隐藏、显示：作为一块从底边缩下去、长上来，隐藏时留着、过渡结束才摘掉；每一帧内容都紧贴面板头下面，不落后、不压住它（ui/nested-grid 的过渡与内容层）", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        const toggle = page.locator('[data-titlebar-layout="panel"]');
        const moving = page.locator("[data-workbench-surface] [data-moving]");
        if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
        await expect(toggle).toHaveAttribute("aria-pressed", "true");
        await expect(moving).toHaveCount(0);
        // 底部面板那一节：显示着的内容里最靠下的那块。
        const target = await page.evaluate(() => {
            const contents = [...document.querySelectorAll<HTMLElement>("[data-workbench-surface] > [data-grid-scope] > [data-content]")].filter((element) => getComputedStyle(element).visibility === "visible");
            const lowest = contents.sort((left, right) => right.getBoundingClientRect().top - left.getBoundingClientRect().top)[0]!;
            return {content: lowest.dataset.content!, leaf: lowest.dataset.contentLeaf!};
        });
        /** 点一下开关，逐帧量这一节的外框与内容体，直到网格的过渡结束。只记外框还在、内容看得见的帧。 */
        const film = () => page.evaluate(async (target) => {
            const rows: Array<{frameTop: number; frameBottom: number; frameHeight: number; bodyTop: number; leaving: boolean; bottomGapHit: boolean}> = [];
            document.querySelector<HTMLElement>('[data-titlebar-layout="panel"]')!.click();
            for (let frame = 0; frame < 90; frame += 1) {
                await new Promise((resolve) => requestAnimationFrame(resolve));
                const frameEl = document.querySelector(`[data-workbench-surface] > [data-grid-scope] > [data-leaf="${target.leaf}"]`);
                const content = document.querySelector<HTMLElement>(`[data-workbench-surface] > [data-grid-scope] > [data-content="${CSS.escape(target.content)}"]`);
                if (frameEl !== null && content !== null && getComputedStyle(content).visibility === "visible") {
                    const rect = frameEl.getBoundingClientRect();
                    const body = content.querySelector(":scope > .nb-grid-content__body")!.getBoundingClientRect();
                    // 卡片下边的缝里那一点不属于这块叶（裁切也挡命中）：按外框的直角矩形裁时，内容一直画到外框的下边，缝没了、两个下角是尖的。
                    const padBottom = Number.parseFloat(getComputedStyle(frameEl.querySelector<HTMLElement>("[data-shell-card]")!.parentElement!).paddingBottom);
                    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.bottom - padBottom / 2);
                    const bottomGapHit = hit !== null && (frameEl.contains(hit) || hit.closest(`[data-content-leaf="${target.leaf}"]`) !== null);
                    rows.push({frameTop: rect.top, frameBottom: rect.bottom, frameHeight: rect.height, bodyTop: body.top, leaving: frameEl.hasAttribute("data-leaving"), bottomGapHit});
                }
                if (frame > 2 && document.querySelector("[data-workbench-surface] [data-moving]") === null) break;
            }
            return rows;
        }, target);
        const inset = await page.evaluate((target) => {
            const frame = document.querySelector(`[data-workbench-surface] > [data-grid-scope] > [data-leaf="${target.leaf}"]`)!.getBoundingClientRect();
            return document.querySelector(`[data-workbench-surface] > [data-grid-scope] > [data-content="${CSS.escape(target.content)}"]`)!.getBoundingClientRect().top - frame.top;
        }, target);
        expect(inset).toBeGreaterThan(0);
        /** 下边不动；内容体的上边一直是外框的上边加面板头（按内容自己的矩形过渡时会落后，最多压住面板头一整条）。 */
        const expectSliding = (rows: Awaited<ReturnType<typeof film>>) => {
            const bottom = rows[0]!.frameBottom;
            for (const row of rows) {
                expect(row.frameBottom).toBeCloseTo(bottom, 0);
                expect(row.bodyTop - row.frameTop).toBeCloseTo(inset, 0);
            }
        };

        // 隐藏：留着缩下去，确实量到了中间的帧；结束后叶没了。
        const hiding = await film();
        expect(hiding.some((row) => row.leaving && row.frameHeight > 20 && row.frameHeight < hiding[0]!.frameHeight - 20)).toBe(true);
        expectSliding(hiding);
        await expect(moving).toHaveCount(0);
        await expect(page.locator(`[data-workbench-surface] > [data-grid-scope] > [data-leaf="${target.leaf}"]`)).toHaveCount(0);

        // 显示：从底边长上来。下边的缝一直在。
        const showing = await film();
        const final = showing.at(-1)!.frameHeight;
        expect(showing.some((row) => row.frameHeight > 20 && row.frameHeight < final - 20)).toBe(true);
        expectSliding(showing);
        for (const row of showing.filter((row) => row.frameHeight > 20 && row.frameHeight < final - 1)) expect(row.bottomGapHit).toBe(false);
    });

    test("隐藏侧栏时缩回去的那段：焦点在侧栏里马上交出去；缩到一半又显示、长到一半又隐藏都停在对的样子，不留残影；减少动态效果时同一帧就没了（ui/nested-grid 的过渡）", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        const explorer = await sectionOf(page, EXPLORER);
        const run = (command: string, args: Record<string, unknown>) => page.evaluate(({name, detail}) => window.dispatchEvent(new CustomEvent(name, {detail})), {name: SAMPLE_VIEWS_RUN_EVENT, detail: {command, args}});
        const leaving = page.locator("[data-workbench-surface] [data-leaving]");
        const settled = async () => {
            await expect(page.locator("[data-workbench-surface] [data-moving]")).toHaveCount(0);
            await expect(leaving).toHaveCount(0);
        };

        // 焦点在资源管理器里，用命令隐藏侧栏：缩回去的这段它不可交互，焦点马上交出去，不留在里面。
        await content(page, EXPLORER).locator("[role=\"treeitem\"]").first().click();
        await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[data-content=\"view:nbook.explorer\"]") != null)).toBe(true);
        await run("nbook.view.set-part-hidden", {part: "sidebar", hidden: true});
        await expect(leaving.first()).toBeAttached();
        expect(await page.evaluate(() => document.activeElement?.closest("[data-content=\"view:nbook.explorer\"]") ?? null)).toBeNull();
        await settled();
        await expect(leaf(page, explorer)).toHaveCount(0);

        // 长到一半又隐藏：停在隐藏，没有留着的叶。
        await run("nbook.view.set-part-hidden", {part: "sidebar", hidden: false});
        await expect(leaf(page, explorer)).toHaveCount(1);
        await run("nbook.view.set-part-hidden", {part: "sidebar", hidden: true});
        await settled();
        await expect(leaf(page, explorer)).toHaveCount(0);

        // 缩到一半又显示：停在显示，宽度回到原样，内容看得见。
        await run("nbook.view.set-part-hidden", {part: "sidebar", hidden: false});
        await settled();
        const width = (await box(page, explorer)).width;
        await run("nbook.view.set-part-hidden", {part: "sidebar", hidden: true});
        await expect(leaving.first()).toBeAttached();
        await run("nbook.view.set-part-hidden", {part: "sidebar", hidden: false});
        await settled();
        expect((await box(page, explorer)).width).toBeCloseTo(width, 0);
        await expect(content(page, EXPLORER)).toBeVisible();

        // 减少动态效果：没有过渡，隐藏那一帧叶就没了，也不留着。
        await page.emulateMedia({reducedMotion: "reduce"});
        const after = await page.evaluate(async ({name, leafId}) => {
            window.dispatchEvent(new CustomEvent(name, {detail: {command: "nbook.view.set-part-hidden", args: {part: "sidebar", hidden: true}}}));
            await new Promise((resolve) => requestAnimationFrame(resolve));
            await new Promise((resolve) => requestAnimationFrame(resolve));
            return {leaf: document.querySelector(`[data-workbench-surface] > [data-grid-scope] > [data-leaf="${leafId}"]`) !== null, leaving: document.querySelector("[data-workbench-surface] [data-leaving]") !== null};
        }, {name: SAMPLE_VIEWS_RUN_EVENT, leafId: explorer});
        expect(after).toEqual({leaf: false, leaving: false});
    });

    test("打开视图命令：切到视图所在的容器；区域拖到零或隐藏着时同一次写入展开（输出 35；views.md 输出 14）", async ({page}) => {
        await open(page);
        const run = (command: string, args: Record<string, unknown>) => page.evaluate(({name, detail}) => window.dispatchEvent(new CustomEvent(name, {detail})), {name: SAMPLE_VIEWS_RUN_EVENT, detail: {command, args}});
        const width = (await box(page, await sectionOf(page, SESSIONS))).width;
        // 侧栏拖到零：记在区域的锚上（输出 11）。
        const sash = (await sidebarSash(page).boundingBox())!;
        const y = sash.y + sash.height / 2;
        await page.mouse.move(sash.x + sash.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(0, y, {steps: 8});
        await page.mouse.up();
        await expect.poll(async () => (await saved(page))?.panels.sidebar?.collapsed).toBe(true);
        await expect(pressedEntries(page)).toHaveCount(0);

        // 打开样例乙：侧栏切到它的容器并展开。
        await run("nbook.view.open", {viewId: B});
        await expect(sample(page, B)).toBeVisible();
        await expect(entry(page, `view:${B}`)).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => (await box(page, await sectionOf(page, B))).width).toBe(width);
        await expect.poll(async () => (await saved(page))?.panels.sidebar).toMatchObject({activeContainer: `view:${B}`});
        expect((await saved(page))?.panels.sidebar?.collapsed ?? false).toBe(false);

        // 侧栏隐藏着：打开样例甲，显示侧栏并切到甲的容器。
        await run("nbook.view.set-part-hidden", {part: "sidebar", hidden: true});
        await expect.poll(async () => (await saved(page))?.panels.sidebar?.hidden).toBe(true);
        await expect(content(page, B)).toHaveAttribute("inert", "");
        await run("nbook.view.open", {viewId: A});
        await expect(sample(page, A)).toBeVisible();
        await expect(entry(page, `view:${A}`)).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => (await saved(page))?.panels.sidebar).toMatchObject({activeContainer: `view:${A}`});
        expect((await saved(page))?.panels.sidebar?.hidden ?? false).toBe(false);
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
        // 两个条件一起等：按 Enter 收起时立刻存过一份“当前容器是甲、收起”，之后两次点入口合并着存，只等当前容器会被那份旧记录直接满足。
        await expect.poll(async () => {
            const sidebar = (await saved(page))?.panels.sidebar;
            return {activeContainer: sidebar?.activeContainer, collapsed: sidebar?.collapsed ?? false};
        }).toEqual({activeContainer: `view:${A}`, collapsed: false});
        expect((await saved(page))?.panels[single]?.collapsed ?? false).toBe(false);
    });
});

test.describe("拖到活动栏与当前容器拖空（验收 25、26、29、32；输出 38、43、45）", () => {
    let tmp = "";
    let server: ProbeServer;

    test.beforeAll(async () => {
        tmp = await createTestTmpRoot("neuro-book-e2e", "workbench-containers-drag");
        await mkdir(join(tmp, "state"), {recursive: true});
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views", NBOOK_EXCLUDE_PLUGINS: "nbook.editor"}});
    });

    test.afterAll(async () => {
        expect(await server.stop()).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 1440, height: 900}});

    const database = (): string => join(tmp, "state", "storage", "user.sqlite");
    const saved = async (page: Page): Promise<LayoutDoc | null> => (await savedIn(page, database()))?.doc ?? null;
    const sample = (page: Page, view: string) => page.locator(`[data-sample-view="${view}"]`);
    const surface = (page: Page) => page.locator("[data-workbench-surface]");
    /** 活动栏上段的入口，从上到下；用户容器的 id 是随机的，写成 `custom`。 */
    const entryIds = (page: Page): Promise<string[]> => page.locator("[data-tool-band] [data-tool-entry]").evaluateAll((elements) => elements.map((element) => {
        const id = element.getAttribute("data-tool-entry") ?? "";
        return id.startsWith("custom:") ? "custom" : id;
    }));

    /** 本页客户端对 `workbench.layout` 的写入次数（同 `workbench-live-drag.e2e.ts`）。 */
    async function writesOf(page: Page): Promise<number> {
        const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
        const db = new DatabaseSync(database());
        try {
            db.exec("CREATE TABLE IF NOT EXISTS layout_writes (client TEXT)");
            db.exec(`CREATE TRIGGER IF NOT EXISTS count_layout_insert AFTER INSERT ON records WHEN NEW.owner = 'nbook.workbench' AND NEW.key = 'workbench.layout' BEGIN INSERT INTO layout_writes VALUES (NEW.client); END`);
            db.exec(`CREATE TRIGGER IF NOT EXISTS count_layout_update AFTER UPDATE ON records WHEN NEW.owner = 'nbook.workbench' AND NEW.key = 'workbench.layout' BEGIN INSERT INTO layout_writes VALUES (NEW.client); END`);
            return (db.prepare("SELECT count(*) AS n FROM layout_writes WHERE client = ?1").get(client) as {n: number}).n;
        } finally {
            db.close();
        }
    }

    /** 实时布局：应用的 Playwright 配置缺省减少动态效果，那时一律落点指示，这里开回来。 */
    async function open(page: Page): Promise<void> {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await page.goto(new URL("/workbench", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(page.locator("[data-shell-focus-target=\"panel-toggle\"]")).toBeEnabled();
        await expect(entry(page, PROJECT_CONTAINER)).toHaveAttribute("aria-pressed", "true");
    }

    async function centerOf(locator: ReturnType<Page["locator"]>): Promise<{x: number; y: number}> {
        const found = await locator.boundingBox();
        if (found === null) throw new Error("没有矩形");
        return {x: found.x + found.width / 2, y: found.y + found.height / 2};
    }

    /** 按下、过门槛，拖动进行中，由调用方决定松手还是取消。 */
    async function lift(page: Page, source: ReturnType<Page["locator"]>): Promise<void> {
        const from = await centerOf(source);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + 10, from.y + 10, {steps: 2});
        await expect(surface(page)).toHaveAttribute("data-drag-feel", "live");
    }

    /** 两个入口之间的间距中点。 */
    async function between(page: Page, upper: string, lower: string): Promise<{x: number; y: number}> {
        const [top, bottom] = [await entry(page, upper).boundingBox(), await entry(page, lower).boundingBox()];
        if (top === null || bottom === null) throw new Error("没有入口");
        return {x: top.x + top.width / 2, y: (top.y + top.height + bottom.y) / 2};
    }

    test("拖到两个入口之间：入口滑开留出位置，侧栏还是原来的容器，零写入；放下多一个只含它的入口，侧栏切到它，写一次（验收 25）", async ({page}) => {
        await open(page);
        const before = await entryIds(page);
        expect(before.slice(0, 3)).toEqual([PROJECT_CONTAINER, `view:${A}`, `view:${B}`]);
        const writes = await writesOf(page);
        const gap = await between(page, `view:${A}`, `view:${B}`);
        await lift(page, tab(page, EXPLORER));
        await page.mouse.move(gap.x, gap.y, {steps: 8});
        // 预览：被拖的视图在空位上显示成一个入口，别的入口让开；侧栏显示的还是“项目”。
        const placed = page.locator(`[data-tool-band] [data-tool-view="${EXPLORER}"]`);
        await expect(placed).toHaveCount(1);
        await expect.poll(() => entryIds(page)).toEqual([PROJECT_CONTAINER, `view:${A}`, "custom", ...before.slice(2)]);
        await expect.poll(() => placed.evaluate((element) => getComputedStyle(element.closest(".workbench-tool-strip__frame") as Element).visibility)).toBe("visible");
        await expect(entry(page, PROJECT_CONTAINER)).toHaveAttribute("aria-pressed", "true");
        await expect(tab(page, SESSIONS)).toBeVisible();
        expect(await writesOf(page)).toBe(writes);

        await page.mouse.up();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
        await expect.poll(() => entryIds(page)).toEqual([PROJECT_CONTAINER, `view:${A}`, "custom", ...before.slice(2)]);
        await expect(placed).toHaveAttribute("aria-pressed", "true");
        await expect(content(page, EXPLORER)).toBeVisible();
        await expect(tab(page, SESSIONS)).toHaveCount(0);
        const record = (await saved(page))!;
        const created = record.panels.sidebar?.activeContainer ?? "";
        expect(created).toMatch(/^custom:/u);
        expect(record.panels[await sectionOf(page, EXPLORER)]?.container).toBe(created);
    });

    test("拖含几个视图的入口：分节、编辑组、状态栏上都没有落点，松手零写入、不开窗；只能在活动栏里换序，显隐与当前容器不变；键盘同样（验收 14；输出 46）", async ({page}) => {
        await open(page);
        const before = await entryIds(page);
        expect(before.slice(0, 3)).toEqual([PROJECT_CONTAINER, `view:${A}`, `view:${B}`]);
        const writes = await writesOf(page);
        const project = entry(page, PROJECT_CONTAINER);
        // “项目”有会话、资源管理器两个视图，入口不是哪个视图的拖动源。
        await expect(project).not.toHaveAttribute("data-tool-view");
        const dropKind = page.locator("[data-drag-feedback][data-drop-kind]");
        const nothingShown = async (): Promise<void> => {
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await expect(dropKind).toHaveCount(0);
            await expect(page.locator("html")).not.toHaveAttribute("data-drop-rejected", "");
        };
        const from = await centerOf(project);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + 10, from.y + 10, {steps: 2});
        await expect(page.locator("html")).toHaveAttribute("data-workbench-dragging", "");
        // 这一场是落点指示，不走实时布局（输出 38）。
        await expect(surface(page)).toHaveAttribute("data-drag-feel", "indicator");
        for (const target of [content(page, CONVERSATION), leaf(page, "g0"), page.locator("[data-leaf=\"statusbar\"]")]) {
            const at = await centerOf(target);
            await page.mouse.move(at.x, at.y, {steps: 6});
            await nothingShown();
        }
        await page.mouse.up();
        await expect(page.locator("html")).not.toHaveAttribute("data-workbench-dragging", "");
        await expect(page.locator("[data-leaf][data-float]")).toHaveCount(0);
        expect(await writesOf(page)).toBe(writes);

        // 在活动栏里换到样例乙后面：入口顺序变了，侧栏还显示“项目”，入口仍按下。
        const gap = await between(page, `view:${B}`, before[3] ?? `view:${B}`);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + 10, from.y + 10, {steps: 2});
        await page.mouse.move(gap.x, gap.y, {steps: 8});
        await expect(dropKind).toHaveAttribute("data-drop-kind", "move-entry");
        await page.mouse.up();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
        await expect.poll(() => entryIds(page)).toEqual([`view:${A}`, `view:${B}`, PROJECT_CONTAINER, ...before.slice(3)]);
        await expect(project).toHaveAttribute("aria-pressed", "true");
        await expect(tab(page, SESSIONS)).toBeVisible();

        // 键盘：空格拿起，只有入口之间能停，Enter 放下，焦点回到入口。
        await project.focus();
        await page.keyboard.press("Space");
        await expect(page.locator("html")).toHaveAttribute("data-workbench-dragging", "");
        await page.keyboard.press("ArrowUp");
        await page.keyboard.press("ArrowUp");
        await expect(dropKind).toHaveAttribute("data-drop-kind", "move-entry");
        await page.keyboard.press("Enter");
        await expect.poll(() => writesOf(page)).toBe(writes + 2);
        expect((await entryIds(page)).indexOf(PROJECT_CONTAINER)).toBeLessThan(2);
        await expect(project).toBeFocused();
        await expect(project).toHaveAttribute("aria-pressed", "true");
    });

    test("拖到一个入口上：这个入口高亮，侧栏不切；放下侧栏切到那个容器，视图是它最后一个分节（验收 26）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        await lift(page, tab(page, EXPLORER));
        const target = await centerOf(entry(page, `view:${A}`));
        await page.mouse.move(target.x, target.y, {steps: 8});
        await expect(entry(page, `view:${A}`)).toHaveAttribute("data-tool-merge", "");
        await expect(page.locator("[data-tool-merge]")).toHaveCount(1);
        await expect(entry(page, PROJECT_CONTAINER)).toHaveAttribute("aria-pressed", "true");
        await expect(tab(page, SESSIONS)).toBeVisible();
        expect(await writesOf(page)).toBe(writes);

        await page.mouse.up();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
        await expect(page.locator("[data-tool-merge]")).toHaveCount(0);
        await expect(entry(page, `view:${A}`)).toHaveAttribute("aria-pressed", "true");
        await expect(sample(page, A)).toBeVisible();
        await expect(content(page, EXPLORER)).toBeVisible();
        const [upper, lower] = [await sectionOf(page, A), await sectionOf(page, EXPLORER)];
        expect((await box(page, upper)).y).toBeLessThan((await box(page, lower)).y);
        expect((await saved(page))?.panels[lower]?.container).toBe(`view:${A}`);
    });

    test("当前容器只有一个视图、把它拖向右栏：预览里侧栏是空的、没有切到别的容器，活动栏仍接得住；Escape 原样、零写入；放下侧栏切到入口顺序上相邻的容器（验收 29；输出 38、43）", async ({page}) => {
        await open(page);
        await entry(page, `view:${A}`).click();
        await expect(sample(page, A)).toBeVisible();
        await expect.poll(async () => (await saved(page))?.panels.sidebar?.activeContainer).toBe(`view:${A}`);
        const writes = await writesOf(page);
        const right = await box(page, await sectionOf(page, CONVERSATION));
        const below = {x: right.x + right.width / 2, y: right.y + right.height * 0.8};

        await lift(page, tab(page, A));
        await page.mouse.move(below.x, below.y, {steps: 8});
        await expect(surface(page)).not.toHaveAttribute("data-live-preview", "none");
        // 侧栏空着：样例甲拿走了，也没有换成“项目”或样例乙。
        await expect(page.locator("[data-tool-entry][aria-pressed=\"true\"]")).toHaveCount(0);
        await expect(tab(page, SESSIONS)).toHaveCount(0);
        await expect(tab(page, B)).toHaveCount(0);
        // 来源收起之后活动栏照样是落点（输出 38：判定按收起后的布局）：回到两个入口之间，空位里出现它的入口。
        // 这是它自己原来的空位，放回原处（输出 28、45）：预览是已提交的样子，入口按下、侧栏又是它。
        const gap = await between(page, PROJECT_CONTAINER, `view:${B}`);
        await page.mouse.move(gap.x, gap.y, {steps: 6});
        await expect(page.locator(`[data-tool-band] [data-tool-view="${A}"]`)).toHaveCount(1);
        await expect(entry(page, `view:${A}`)).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("[data-drag-live-status]")).toHaveText("原位");
        expect(await writesOf(page)).toBe(writes);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(entry(page, `view:${A}`)).toHaveAttribute("aria-pressed", "true");
        await expect(sample(page, A)).toBeVisible();
        expect(await writesOf(page)).toBe(writes);

        await lift(page, tab(page, A));
        await page.mouse.move(below.x, below.y, {steps: 8});
        await expect(surface(page)).not.toHaveAttribute("data-live-preview", "none");
        await page.mouse.up();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
        // 样例甲的容器搬空了：侧栏切到入口顺序里它前面的“项目”（输出 43）。
        await expect(entry(page, PROJECT_CONTAINER)).toHaveAttribute("aria-pressed", "true");
        await expect(tab(page, SESSIONS)).toBeVisible();
        await expect(entry(page, `view:${A}`)).toHaveCount(0);
        await expect(sample(page, A)).toBeVisible();
        // 内容飞到结果、列宽跟着重排时矩形还在变：等它停在右栏。
        await expect.poll(async () => (await box(page, await sectionOf(page, A))).x).toBeGreaterThan(right.x - 1);
    });

    test("拖动中用命令打开另一个容器里的视图：这一场取消、拖动本身零写入，侧栏切到命令指定的容器（验收 32）", async ({page}) => {
        await open(page);
        const home = await sectionOf(page, EXPLORER);
        const writes = await writesOf(page);
        const right = await box(page, await sectionOf(page, CONVERSATION));
        await lift(page, tab(page, EXPLORER));
        await page.mouse.move(right.x + right.width / 2, right.y + right.height * 0.8, {steps: 8});
        await expect(surface(page)).not.toHaveAttribute("data-live-preview", "none");
        await page.evaluate(({name, view}) => window.dispatchEvent(new CustomEvent(name, {detail: {command: "nbook.view.open", args: {viewId: view}}})), {name: SAMPLE_VIEWS_RUN_EVENT, view: B});
        // 命令已经提交；屏幕上还是这一场的预览，指针动之前不重判（入口的按下态读的是预览），所以这里看记录，不看入口。
        await expect.poll(async () => (await saved(page))?.panels.sidebar?.activeContainer).toBe(`view:${B}`);
        // 指针一动就判定（同 `workbench-live-drag.e2e.ts` 的“中途窗口变了”）：判定时比结构键，变了整场取消。
        const point = {x: right.x + right.width / 2, y: right.y + right.height * 0.8};
        await page.mouse.move(point.x - 2, point.y);
        await page.mouse.move(point.x - 4, point.y);
        await expect(surface(page)).toHaveAttribute("data-drag-feel", "indicator");
        await expect(surface(page)).toHaveAttribute("data-live-preview", "none");
        await page.mouse.up();
        await expect(entry(page, `view:${B}`)).toHaveAttribute("aria-pressed", "true");
        // 只有命令切换容器那一次写入；资源管理器还在“项目”里原来那一节。
        await expect.poll(async () => (await saved(page))?.panels.sidebar?.activeContainer).toBe(`view:${B}`);
        expect(await writesOf(page)).toBe(writes + 1);
        const record = (await saved(page))!;
        expect(record.panels[home]?.tabs).toEqual([{kind: "view", viewId: EXPLORER}]);
        expect(record.panels[home]?.container).toBe(PROJECT_CONTAINER);
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
