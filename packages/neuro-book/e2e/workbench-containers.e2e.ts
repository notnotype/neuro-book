/**
 * 视图容器在真实 Chrome 中的验收（docs/specs/ui/workbench-layout.md 输出 22、41、42、43、45，验收 24、25、26、28、29、30、32）：切换容器、
 * 区域拖到零之后点入口、拖到活动栏（新建容器、并入）、当前容器拖空、拖动中容器被命令切走、有容器之前存的记录回落。生产构建的后端与前端；侧栏除了内置容器“项目”（资源管理器与测试插件 `test.project-view` 的视图两个分节），再用测试插件
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
import {GRID_SNAPSHOT_VERSION} from "@notnotype/nb-layout";
import {barRef, panelRef, validateLayoutDoc} from "@notnotype/nb-workbench-layout";
import type {GridSnapshotNode} from "@notnotype/nb-layout";
import type {LayoutDoc} from "@notnotype/nb-workbench-layout";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {CLIENT_IDENTITY_KEY} from "nbook/web/host/client-identity";
import {PROJECT_TEST_VIEW} from "nbook/shared/testing/project-view-contract";
import {SAMPLE_VIEWS_RUN_EVENT} from "nbook/shared/testing/sample-views-contract";

import {startProbeServer} from "./fixtures";
import {pressEntry} from "./support/press-entry";
import type {ProbeServer, ProductServer} from "./fixtures";

/** “项目”容器里资源管理器之外的第二个视图（测试插件 `test.project-view`，声明同以前的会话面板）。 */
const SESSIONS = PROJECT_TEST_VIEW;
const EXPLORER = "nbook.explorer";
const CONVERSATION = "nbook.agent.conversation";
/** 内置容器“项目”：资源管理器与测试视图声明在它里面。 */
const PROJECT_CONTAINER = "nbook.workbench.project";
const A = "test.sample-views.alpha";
const B = "test.sample-views.beta";
/** 样例丁：右栏里的又一个容器（只有它一个视图）。 */
const D = "test.sample-views.delta";

/** 树里的叶外框：限定到外壳栅格的直接子级，编辑区自己的栅格里有同名的叶。 */
const LEAF = "[data-workbench-surface] > [data-grid-scope] > [data-leaf]";
const leaf = (page: Page, id: string) => page.locator(`${LEAF}[data-leaf="${id}"]`);
async function box(page: Page, id: string): Promise<{x: number; y: number; width: number; height: number}> {
    const found = await leaf(page, id).boundingBox();
    if (found === null) throw new Error(`没有 ${id} 的外框`);
    return found;
}
/** 区域隐藏了：按拖到零画（ui/workbench-layout 输出 11），那块外框还在、缩到面积为零。等到零也就等过渡走完了。 */
const shrunk = (page: Page, id: string) => expect.poll(async () => {
    const found = await leaf(page, id).boundingBox();
    return found === null ? 0 : Math.round(found.width * found.height);
}).toBe(0);

const content = (page: Page, view: string) => page.locator(`[data-content="view:${view}"]`);
/** 视图所在分节的面板 id：分节的 id 是布局起的（输出 40），按视图取，内容项上写着它所在的叶。 */
async function sectionOf(page: Page, view: string): Promise<string> {
    const id = await content(page, view).getAttribute("data-content-leaf");
    if (id === null) throw new Error(`${view} 不在任何面板里`);
    return id;
}
const tab = (page: Page, view: string) => page.locator(`[data-panel-tab="view:${view}"]`);
/** 分节的标题行是展开、收起的开关（输出 20）：能收起时标题按钮带 `aria-expanded`。 */
const collapseButton = (page: Page, view: string) => page.locator(`[data-panel-head] [data-panel-tab="view:${view}"][aria-expanded]`);
/** 活动栏里一个容器的入口（输出 22）；样例视图的容器是 `view:<视图 id>`。右栏的右轨也有入口带，所以限定到左轨。 */
const entry = (page: Page, container: string) => page.locator(`[data-rail="sidebar"] [data-tool-band] [data-tool-entry="${container}"]`);
const pressedEntries = (page: Page) => page.locator('[data-rail="sidebar"] [data-tool-band] [data-tool-entry][aria-pressed="true"]');

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
        // 样例插件自己贡献编辑区的内容，和产品的编辑器只能留一个；这里不看编辑器。canon 与依赖它的剧情插件带着侧栏“设定”与
        // 底部面板的视图，会改变这里按样例插件假定的容器（同 workbench-views 的做法）。
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views,test.project-view", NBOOK_EXCLUDE_PLUGINS: "nbook.editor,nbook.canon,nbook.plot"}});
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

    /** 命令面板里执行一条命令（不带参数：面板类命令落在当前面板上）。 */
    async function runCommand(page: Page, title: string): Promise<void> {
        const combobox = page.getByRole("combobox", {name: "输入命令，或输入 : 跳到某一行"});
        await expect(async () => {
            await page.keyboard.press("Control+Shift+P");
            await expect(combobox).toBeFocused({timeout: 500});
        }).toPass();
        await combobox.fill(title);
        await page.getByRole("option", {name: new RegExp(title, "u")}).first().click();
    }

    const opacityOf = (locator: ReturnType<Page["locator"]>) => () => locator.evaluate((element) => getComputedStyle(element).opacity);
    const leftOf = (page: Page, selector: string): Promise<number> => page.locator(selector).first().evaluate((element) => element.getBoundingClientRect().left);

    /** 截一张图，读几个点的颜色（RGB）：滚动中卡片外有没有画东西，按像素看。 */
    async function colorsAt(page: Page, points: ReadonlyArray<readonly [number, number]>): Promise<number[][]> {
        const png = await page.screenshot();
        return page.evaluate(async ({data, points}) => {
            const image = new Image();
            image.src = `data:image/png;base64,${data}`;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            return points.map(([x, y]) => [...context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data].slice(0, 3));
        }, {data: png.toString("base64"), points});
    }
    const near = (a: number[] | undefined, b: number[] | undefined): boolean => a !== undefined && b !== undefined && a.every((value, index) => Math.abs(value - (b[index] ?? 0)) <= 6);
    /** 页面上的动画都送到终点（无限的照常播），等于过渡走完。 */
    const finishAnimations = (page: Page) => page.evaluate(() => {
        for (const animation of document.getAnimations()) {
            if (animation.effect?.getComputedTiming().endTime === Number.POSITIVE_INFINITY) animation.play();
            else animation.finish();
        }
    });
    /** 点了之后等两帧：网格在下一帧开始交换。 */
    const nextFrames = (page: Page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const clickOn = (page: Page, selector: string) => page.evaluate((selector) => document.querySelector<HTMLElement>(selector)!.click(), selector);

    /**
     * 底部面板的卡片：入口条叶的卡片在上，分节的卡片在下，拼成一张（输出 47；右栏的入口条改成了右轨，输出 50）。`stripBottom` 是入口条的底，也就是滚动的裁切窗的顶。
     * `gap` 是主题的缝宽，滚动中滑走的与换上来的之间隔它。
     */
    const regionCard = (page: Page, region: "panel", sections: ReadonlyArray<string>) => page.evaluate(({region, sections}) => {
        const strip = document.querySelector(`[data-shell-card="strip:${region}"]`)!.getBoundingClientRect();
        const rects = sections.map((id) => document.querySelector(`[data-shell-card="${id}"]`)!.getBoundingClientRect());
        const gap = Number.parseFloat(getComputedStyle(document.querySelector("[data-workbench-surface]")!).getPropertyValue("--shell-gap"));
        return {top: strip.top, stripBottom: strip.bottom, bottom: Math.max(...rects.map((rect) => rect.bottom)), left: strip.left, right: strip.right, gap};
    }, {region, sections});

    /**
     * 把页面上的动画停在过渡的某一刻，读这一刻滚动里的几样：两组外框的左缘、各外框里有没有头、入口条里并进来的是哪一节的头、静止的底、按下的块的左缘。
     * `track` 是要单独跟的外框（滚到一半点回来时看它从此刻接着走）。
     */
    const sliceAt = (page: Page, region: "panel", fraction: number, duration: number, track: string) => page.evaluate(({region, fraction, duration, track}) => {
        for (const animation of document.getAnimations()) {
            animation.pause();
            animation.currentTime = fraction * duration;
        }
        const frames = [...document.querySelectorAll<HTMLElement>("[data-workbench-surface] > [data-grid-scope] > [data-leaf][data-swap]")];
        const side = (name: string) => frames.filter((frame) => frame.dataset.swap === name);
        const rectOf = (element: Element | null) => {
            const rect = element?.getBoundingClientRect();
            return rect === undefined ? null : {top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right};
        };
        const strip = document.querySelector(`[data-region-strip="${region}"]`)!;
        return {
            in: Math.min(...side("in").map((frame) => frame.getBoundingClientRect().left)),
            out: Math.min(...side("out").map((frame) => frame.getBoundingClientRect().left)),
            inLeaves: side("in").map((frame) => frame.dataset.leaf!),
            outLeaves: side("out").map((frame) => frame.dataset.leaf!),
            headsIn: side("in").filter((frame) => frame.querySelector("[data-panel-head]") !== null).map((frame) => frame.dataset.leaf!),
            headsOut: side("out").filter((frame) => frame.querySelector("[data-panel-head]") !== null).map((frame) => frame.dataset.leaf!),
            outInert: side("out").every((frame) => frame.inert),
            stripHead: strip.querySelector<HTMLElement>("[data-panel-head]")?.dataset.panelHead ?? null,
            stripCard: rectOf(document.querySelector(`[data-shell-card="strip:${region}"]`)),
            tracked: rectOf(document.querySelector(`[data-workbench-surface] > [data-grid-scope] > [data-leaf="${track}"]`)),
            backdrop: rectOf(document.querySelector("[data-shell-swap-card]")),
            indicator: strip.querySelector("[data-region-indicator]")!.getBoundingClientRect().left,
            sliding: strip.querySelector("[data-region-indicator]")!.hasAttribute("data-sliding"),
        };
    }, {region, fraction, duration, track});

    /** 入口条里按下的块的左缘，与某个入口的左缘：静止时块就在按下的入口上。 */
    const regionIndicatorLeft = (page: Page, region: string) => leftOf(page, `[data-region-strip="${region}"] [data-region-indicator]`);
    const regionEntryLeft = (page: Page, region: string, container: string) => leftOf(page, `[data-region-strip="${region}"] [data-region-entry="${container}"]`);

    /**
     * 右栏切换容器的某一刻（输出 42、50）：把页面上的动画停在 `fraction` 处，读右栏这一组外框的上缘、右轨的卡片与按下的块。
     * 右轨的入口竖排，内容竖着滚：新容器从下面（排在后面时）进来。`track` 是单独跟的外框。
     */
    const railSliceAt = (page: Page, fraction: number, duration: number, track: string) => page.evaluate(({fraction, duration, track}) => {
        for (const animation of document.getAnimations()) {
            animation.pause();
            animation.currentTime = fraction * duration;
        }
        const frames = [...document.querySelectorAll<HTMLElement>("[data-workbench-surface] > [data-grid-scope] > [data-leaf][data-swap]")];
        const side = (name: string) => frames.filter((frame) => frame.dataset.swap === name);
        const rectOf = (element: Element | null) => {
            const rect = element?.getBoundingClientRect();
            return rect === undefined ? null : {top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right};
        };
        const railCard = document.querySelector<HTMLElement>('[data-shell-card="rail:auxiliarybar"]')!;
        const indicator = document.querySelector('[data-rail="auxiliarybar"] [data-tool-indicator]')!;
        return {
            in: Math.min(...side("in").map((frame) => frame.getBoundingClientRect().top)),
            out: Math.min(...side("out").map((frame) => frame.getBoundingClientRect().top)),
            inLeaves: side("in").map((frame) => frame.dataset.leaf!),
            outLeaves: side("out").map((frame) => frame.dataset.leaf!),
            outInert: side("out").every((frame) => frame.inert),
            railCard: rectOf(railCard),
            joined: document.querySelector('[data-rail="auxiliarybar"]')!.hasAttribute("data-rail-joined"),
            seam: railCard.dataset.shellJoinSeam ?? null,
            tracked: rectOf(document.querySelector(`[data-workbench-surface] > [data-grid-scope] > [data-leaf="${track}"]`)),
            backdrop: rectOf(document.querySelector("[data-shell-swap-card]")),
            indicator: new DOMMatrix(getComputedStyle(indicator).transform).f,
            sliding: indicator.hasAttribute("data-sliding"),
        };
    }, {fraction, duration, track});

    /** 右轨入口带里按下的块的位移（纵向）；静止时块就在按下的入口上。 */
    const railIndicatorAt = (page: Page) => page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('[data-rail="auxiliarybar"] [data-tool-indicator]')!).transform).f);
    /** 右轨入口相对入口带的纵向位置。 */
    const railEntryTop = (page: Page, container: string) => page.evaluate((container) => {
        const button = [...document.querySelectorAll<HTMLElement>('[data-rail="auxiliarybar"] [data-tool-entry]')].find((element) => element.dataset.toolEntry === container)!;
        return button.offsetTop;
    }, container);

    // 覆盖 ui/workbench-layout 输出 50（右栏的入口条改为右轨）：右栏卡片顶上不再有横向入口条，入口竖排在右轨的入口带里，对话的分节从卡片顶起、自己的叶里画头。
    test("右栏顶上没有横向入口条：入口在右轨的入口带里，一个容器一个入口、按下的恰一项，对话那一节顶到右栏卡片的顶（ui/workbench-layout 输出 50）", async ({page}) => {
        await open(page);
        await expect(page.locator('[data-region-strip="auxiliarybar"]')).toHaveCount(0);
        await expect(page.locator('[data-shell-card="strip:auxiliarybar"]')).toHaveCount(0);
        const entries = page.locator('[data-rail="auxiliarybar"] [data-tool-band] [data-tool-entry]');
        const count = await entries.count();
        expect(count).toBeGreaterThanOrEqual(2);
        await expect(page.locator('[data-rail="auxiliarybar"] [data-tool-entry][aria-pressed="true"]')).toHaveCount(1);
        await expect(entries.first()).toHaveAttribute("aria-pressed", "true");
        // 右轨与右栏同高同顶：右轨的卡片顶就是对话那一节的卡片顶（入口条这一行没有了）。
        const conversation = await sectionOf(page, CONVERSATION);
        const [railBox, sectionCard] = [(await page.locator('[data-shell-card="rail:auxiliarybar"]').boundingBox())!, (await page.locator(`[data-shell-card="${conversation}"]`).boundingBox())!];
        expect(Math.abs(railBox.y - sectionCard.y)).toBeLessThanOrEqual(1);

        // 资源管理器移进右栏的新容器：右栏切到它，入口带多一个入口。
        await moveViaMenu(page, EXPLORER, "新容器（右栏）");
        await expect(entries).toHaveCount(count + 1);
        await expect(page.locator('[data-rail="auxiliarybar"] [data-tool-entry][aria-pressed="true"]')).toHaveCount(1);
        await expect(content(page, EXPLORER)).not.toHaveAttribute("inert", "");
    });

    // 覆盖 ui/workbench-layout 输出 13、50：右栏拖到最窄时（区域至少 160，视图声明的更大最小值也算）右轨的入口都在卡片里、点得到，当前容器的入口总在外面。
    test("右栏拖到最窄时右轨：当前容器的入口在外面，右轨里每个按钮都在卡片里、点得到（ui/workbench-layout 输出 13、50）", async ({page}) => {
        await open(page);
        const conversation = await sectionOf(page, CONVERSATION);
        // 右栏拖到最窄：右栏左边那条线往右拖到比 160 再窄 10px，停在最小宽度上；拖得更远会过了收起的门槛、整块拖到零（输出 12），那就不是这里要看的。
        const frame = leaf(page, conversation);
        const before = (await frame.boundingBox())!;
        const handle = await page.evaluate((edge) => {
            const lines = [...document.querySelectorAll('[data-workbench-surface] [role="separator"]')].filter((element) => (element.getAttribute("aria-label") ?? "").endsWith("的宽度")).map((element) => element.getBoundingClientRect());
            const best = lines.sort((a, b) => Math.abs(a.right - edge) - Math.abs(b.right - edge))[0]!;
            return {x: best.left + best.width / 2, y: best.top + best.height / 2};
        }, before.x);
        await page.mouse.move(handle.x, handle.y);
        await page.mouse.down();
        await page.mouse.move(handle.x + before.width - 150, handle.y, {steps: 8});
        await page.mouse.up();
        await expect(page.locator("[data-workbench-surface] [data-moving]")).toHaveCount(0);
        const narrowest = Math.round((await frame.boundingBox())!.width);
        expect(narrowest).toBeGreaterThanOrEqual(160);
        expect(narrowest).toBeLessThanOrEqual(185);
        expect((await saved(page))?.panels.auxiliarybar?.collapsed).not.toBe(true);
        const rail = page.locator('[data-rail="auxiliarybar"]');
        await expect(rail.locator('[data-tool-entry][aria-pressed="true"]')).toBeVisible();
        const offenders = await rail.evaluate((root) => {
            const card = root.closest("[data-shell-card]")!.getBoundingClientRect();
            return [...root.querySelectorAll<HTMLElement>("button")].filter((button) => button.offsetParent !== null && button.closest("[aria-hidden='true']") === null).flatMap((button) => {
                const rect = button.getBoundingClientRect();
                const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                return rect.left >= card.left - 0.5 && rect.right <= card.right + 0.5 && hit !== null && button.contains(hit) ? [] : [button.getAttribute("aria-label") ?? button.textContent ?? "?"];
            });
        });
        expect(offenders).toEqual([]);
    });

    test("底部面板的入口条：入口写容器的标题，第一个入口的文字和分节头的标题文字离卡片左缘一样（ui/workbench-layout 输出 47）", async ({page}) => {
        await open(page);
        // 资源管理器移进底部面板的新容器，测试视图再移进它那个容器：底部面板这个容器左右两节，入口条只有入口，两节各自画头写标题。
        await moveViaMenu(page, EXPLORER, "新容器（底部面板）");
        await moveViaMenu(page, SESSIONS, "资源管理器");
        const strip = page.locator('[data-region-strip="panel"]');
        await expect(strip.locator("[data-panel-head]")).toHaveCount(0);
        await expect(strip.locator('[data-region-entry][aria-pressed="true"]')).toHaveText("资源管理器");
        const [explorer, sessions] = [await sectionOf(page, EXPLORER), await sectionOf(page, SESSIONS)];
        const first = (await box(page, explorer)).x < (await box(page, sessions)).x ? explorer : sessions;
        const entryInset = await leftOf(page, '[data-region-strip="panel"] [data-region-entry] .workbench-region-strip__title') - await leftOf(page, '[data-shell-card="strip:panel"]');
        const titleInset = await leftOf(page, `[data-panel-head="${first}"] .workbench-panel-head__label`) - await leftOf(page, `[data-shell-card="${first}"]`);
        expect(Math.abs(entryInset - titleInset), `入口文字 ${String(entryInset)}，分节标题 ${String(titleInset)}`).toBeLessThanOrEqual(1);
    });

    test("底部面板当前容器只有一节：头并进入口条、不写看得见的标题，按下的入口就是它的标题：内容区的名称照旧，右键这个入口开视图的“移动到”（ui/workbench-layout 输出 47）", async ({page}) => {
        await open(page);
        const toggle = page.locator('[data-titlebar-layout="panel"]');
        if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
        const strip = page.locator('[data-region-strip="panel"]');
        const omega = "test.sample-views.omega";
        const own = strip.locator(`[data-tool-view="${omega}"]`);
        if ((await own.getAttribute("aria-pressed")) !== "true") await own.click();
        await expect(own).toHaveAttribute("aria-pressed", "true");
        const section = await sectionOf(page, omega);
        await expect(strip.locator(`[data-panel-head="${section}"]`)).toHaveCount(1);
        await expect(strip.locator("[data-panel-tab]")).toHaveCount(0);
        await expect(page.getByRole("region", {name: "样例戊", exact: true})).toHaveCount(1);
        await own.click({button: "right"});
        await expect(page.getByRole("menu").getByRole("menuitem", {name: "新容器（右栏）", exact: true})).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
    });

    test("右栏当前容器有几节：各节在自己的叶里画头、能收起；全部收起时最后一节垫底到卡片的底，右轨不动，这一列的分隔线拖不动（ui/workbench-layout 输出 11、50）", async ({page}) => {
        await open(page);
        // 资源管理器移进右栏的新容器，测试视图再移进它那个容器：右栏这个容器两节（都不接管标题区，标题按钮就是开关）。
        await moveViaMenu(page, EXPLORER, "新容器（右栏）");
        await moveViaMenu(page, SESSIONS, "资源管理器");
        const [explorer, sessions] = [await sectionOf(page, EXPLORER), await sectionOf(page, SESSIONS)];
        await expect(page.locator('[data-region-strip="auxiliarybar"]')).toHaveCount(0);
        await expect(leaf(page, explorer).locator("[data-panel-head]")).toHaveCount(1);
        await expect(leaf(page, sessions).locator("[data-panel-head]")).toHaveCount(1);
        const railBox = (await page.locator('[data-shell-card="rail:auxiliarybar"]').boundingBox())!;
        const [first, second] = [await box(page, explorer), await box(page, sessions)];
        const [upperView, lowerView] = first.y < second.y ? [EXPLORER, SESSIONS] : [SESSIONS, EXPLORER];
        const [upper, lower] = first.y < second.y ? [explorer, sessions] : [sessions, explorer];
        const columnBottom = Math.max(first.y + first.height, second.y + second.height);
        await collapseButton(page, upperView).click();
        await collapseButton(page, lowerView).click();
        await expect.poll(async () => (await box(page, upper)).height).toBe(32);
        await expect.poll(async () => {
            const rect = await box(page, lower);
            return Math.round(rect.y + rect.height);
        }).toBe(Math.round(columnBottom));
        // 右轨不动，上面一节仍在右栏卡片的顶上。
        const stillRail = (await page.locator('[data-shell-card="rail:auxiliarybar"]').boundingBox())!;
        expect(stillRail).toEqual(railBox);
        expect(Math.abs((await page.locator(`[data-shell-card="${upper}"]`).boundingBox())!.y - railBox.y)).toBeLessThanOrEqual(1);
        await expect(content(page, lowerView)).toHaveAttribute("inert", "");
        // 两节之间的分隔线拖不动（展开靠点标题）。
        const between = page.getByRole("separator", {name: new RegExp(`调整 (?:${upper} 与 ${lower}|${lower} 与 ${upper}) 的`, "u")});
        await expect(between).toHaveAttribute("aria-disabled", "true");
    });

    test("分节的标题行是展开、收起的开关：点标题、Enter 切换，双击回到原样；全部收起时最后一节垫底、卡片满高、右下角是圆的，拖侧栏宽度时它的内容照旧停放（ui/workbench-layout 输出 11、20）", async ({page}) => {
        await open(page);
        const [sessions, explorer] = [await sectionOf(page, SESSIONS), await sectionOf(page, EXPLORER)];
        const before = [await box(page, sessions), await box(page, explorer)];
        const [upperView, lowerView] = before[0]!.y < before[1]!.y ? [SESSIONS, EXPLORER] : [EXPLORER, SESSIONS];
        const [upper, lower] = before[0]!.y < before[1]!.y ? [sessions, explorer] : [explorer, sessions];
        const tall = (await box(page, upper)).height;
        // 点标题收起、再点展开。
        await collapseButton(page, upperView).click();
        await expect.poll(async () => (await box(page, upper)).height).toBe(32);
        await expect(collapseButton(page, upperView)).toHaveAttribute("aria-expanded", "false");
        await collapseButton(page, upperView).click();
        await expect.poll(async () => (await box(page, upper)).height).toBe(tall);
        // Enter 是按钮的点击，同样切换；焦点在标题上。
        await collapseButton(page, upperView).focus();
        await page.keyboard.press("Enter");
        await expect.poll(async () => (await box(page, upper)).height).toBe(32);
        await expect(collapseButton(page, upperView)).toBeFocused();
        await page.keyboard.press("Enter");
        await expect.poll(async () => (await box(page, upper)).height).toBe(tall);
        // 双击切两次，回到原样：两次切换都发生了（先收起再展开），不是两次都没动。
        await collapseButton(page, upperView).evaluate((element) => {
            const seen: string[] = [];
            (window as unknown as {foldSeen: string[]}).foldSeen = seen;
            new MutationObserver(() => seen.push(element.getAttribute("aria-expanded") ?? "")).observe(element, {attributes: true, attributeFilter: ["aria-expanded"]});
        });
        await collapseButton(page, upperView).dblclick();
        await expect.poll(() => page.evaluate(() => (window as unknown as {foldSeen: string[]}).foldSeen)).toEqual(["false", "true"]);
        await expect.poll(async () => (await box(page, upper)).height).toBe(tall);

        // 全部收起：最后一节垫底，外框到这一列的底；卡片右下角是圆的（那一点是窗体底），标题行下面是卡片的底。
        const columnBottom = Math.max(...before.map((rect) => rect.y + rect.height));
        await collapseButton(page, upperView).click();
        await collapseButton(page, lowerView).click();
        await expect.poll(async () => {
            const rect = await box(page, lower);
            return Math.round(rect.y + rect.height);
        }).toBe(Math.round(columnBottom));
        await expect(content(page, lowerView)).toHaveAttribute("inert", "");
        await page.mouse.move(900, 600);
        const card = (await page.locator(`[data-shell-card="${lower}"]`).boundingBox())!;
        const colorsAt = async (points: ReadonlyArray<readonly [number, number]>): Promise<number[][]> => {
            const png = await page.screenshot();
            return page.evaluate(async ({data, points}) => {
                const image = new Image();
                image.src = `data:image/png;base64,${data}`;
                await image.decode();
                const canvas = document.createElement("canvas");
                canvas.width = image.width;
                canvas.height = image.height;
                const context = canvas.getContext("2d")!;
                context.drawImage(image, 0, 0);
                return points.map(([x, y]) => [...context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data].slice(0, 3));
            }, {data: png.toString("base64"), points});
        };
        const same = (a: number[] | undefined, b: number[] | undefined): boolean => a !== undefined && b !== undefined && a.every((value, index) => Math.abs(value - (b[index] ?? 0)) <= 3);
        const [cornerOut, cardMiddle, belowRows, ground] = await colorsAt([
            [card.x + card.width - 1.5, card.y + card.height - 1.5],
            [card.x + card.width / 2, card.y + card.height - 20],
            [card.x + card.width / 2, card.y + 80],
            [card.x + card.width + 2, card.y + card.height - 20],
        ]);
        expect(same(cardMiddle, belowRows), `标题行下面 ${String(belowRows)}，卡片底 ${String(cardMiddle)}`).toBe(true);
        expect(same(cardMiddle, ground), `卡片底 ${String(cardMiddle)} 不该是窗体底 ${String(ground)}`).toBe(false);
        expect(same(cornerOut, ground), `右下角外 ${String(cornerOut)}，窗体底 ${String(ground)}`).toBe(true);
        // 拖侧栏的宽度（别的手势的预览）：垫底的那一节内容照旧停放。
        const sash = (await sidebarSash(page).boundingBox())!;
        const y = sash.y + sash.height / 2;
        await page.mouse.move(sash.x + sash.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(sash.x + sash.width / 2 + 40, y, {steps: 4});
        await expect(content(page, lowerView)).toHaveAttribute("inert", "");
        await page.mouse.up();
        await expect(content(page, lowerView)).toHaveAttribute("inert", "");
        // 点上面那一节展开：它按份额长出来，垫底的那一节缩回标题行，这一列的上下边不动。
        const [top, bottom] = [(await box(page, upper)).y, (await box(page, lower)).y + (await box(page, lower)).height];
        await collapseButton(page, upperView).click();
        await expect.poll(async () => (await box(page, lower)).height).toBe(32);
        expect((await box(page, upper)).y).toBe(top);
        const settled = await box(page, lower);
        expect(settled.y + settled.height).toBe(bottom);
        await expect(content(page, upperView)).not.toHaveAttribute("inert", "");
    });

    test("面板头的样子：标记与资源管理器树第一层的展开箭头、标题与树的文字左缘对齐；标记与标题在头里竖直居中；收起前后不横移；按钮悬停才出，焦点在头里时出；最大化着还原按钮一直在（ui/workbench-layout 输出 20）", async ({page}) => {
        await open(page);
        const explorer = await sectionOf(page, EXPLORER);
        const measure = () => page.evaluate((panel) => {
            const rect = (element: Element | null) => {
                const found = element?.getBoundingClientRect();
                return found === undefined ? null : {left: found.left, top: found.top, bottom: found.bottom, center: (found.top + found.bottom) / 2};
            };
            const head = document.querySelector(`[data-panel-head="${panel}"]`)!;
            const twisty = document.querySelector("[data-explorer-twisty] > span");
            return {
                head: rect(head), chevron: rect(head.querySelector("span[data-panel-fold]")), label: rect(head.querySelector(".workbench-panel-head__label")),
                twisty: rect(twisty), treeLabel: rect(twisty?.closest("[data-explorer-twisty]")?.parentElement?.querySelector("[data-explorer-label]") ?? null),
            };
        }, explorer);
        const open1 = await measure();
        expect(open1.twisty).not.toBeNull();
        expect(Math.abs(open1.chevron!.left - open1.twisty!.left), `标记 ${String(open1.chevron!.left)}，树的箭头 ${String(open1.twisty!.left)}`).toBeLessThanOrEqual(1);
        expect(Math.abs(open1.label!.left - open1.treeLabel!.left), `标题 ${String(open1.label!.left)}，树的文字 ${String(open1.treeLabel!.left)}`).toBeLessThanOrEqual(1);
        expect(Math.abs(open1.chevron!.center - open1.head!.center)).toBeLessThanOrEqual(1);
        expect(Math.abs(open1.label!.center - open1.head!.center)).toBeLessThanOrEqual(1);
        // 收起前后标记与标题的横坐标不变。
        await collapseButton(page, EXPLORER).click();
        await expect.poll(async () => (await box(page, explorer)).height).toBe(32);
        const folded = await measure();
        expect([folded.chevron!.left, folded.label!.left]).toEqual([open1.chevron!.left, open1.label!.left]);
        await collapseButton(page, EXPLORER).click();
        await expect.poll(async () => (await box(page, explorer)).height).toBeGreaterThan(32);

        // 按钮悬停才出：指针在别处、焦点不在头里时透明；指针移到这块面板上显示。
        const frameActions = page.locator(`[data-panel-head="${explorer}"] [data-hover-actions="frame"]`);
        await page.locator("body").click({position: {x: 900, y: 500}});
        await page.mouse.move(900, 500);
        await expect.poll(() => frameActions.evaluate((element) => getComputedStyle(element).opacity)).toBe("0");
        await page.locator(`[data-panel-head="${explorer}"]`).hover({position: {x: 60, y: 16}});
        await expect.poll(() => frameActions.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
        // 焦点在头里（键盘）也显示。
        await page.mouse.move(900, 500);
        await collapseButton(page, EXPLORER).focus();
        await expect.poll(() => frameActions.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
        // 最大化着还原按钮一直在：它是这块面板此刻状态的唯一指示。最大化的面板盖住了整个表面，所以指针移到标题栏、焦点移出去，
        // 同一个头里的视图动作透明（证明不是悬停、焦点让它们显示），框架按钮仍然显示。
        await page.locator(`[data-panel-head="${explorer}"] [data-panel-action="nbook.view.toggle-panel-maximized"]`).click();
        await page.mouse.move(700, 8);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        const viewActions = page.locator(`[data-panel-head="${explorer}"] [data-hover-actions=""]`);
        await expect.poll(() => viewActions.evaluate((element) => getComputedStyle(element).opacity)).toBe("0");
        await expect.poll(() => frameActions.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
        // 还原之后同样的指针与焦点下，框架按钮回到透明。
        await page.locator(`[data-panel-head="${explorer}"] [data-panel-action="nbook.view.toggle-panel-maximized"]`).click();
        await page.mouse.move(700, 8);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await expect.poll(() => frameActions.evaluate((element) => getComputedStyle(element).opacity)).toBe("0");
    });

    test("切到别的容器再切回来：两个分节的先后、高度与收起都是原样，实例、输入与滚动保留；记录里的尺寸意图前后相同（验收 24；输出 42）", async ({page}) => {
        await open(page);
        // 搭一个两个分节的容器：样例乙移进样例甲的容器，成为它最后一个分节，侧栏切到这个容器（输出 23）。
        await pressEntry(page, entry(page, `view:${B}`));
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
        await pressEntry(page, entry(page, PROJECT_CONTAINER));
        await expect(tab(page, SESSIONS)).toBeVisible();
        await expect(tab(page, A)).toHaveCount(0);
        await expect(content(page, A)).toHaveAttribute("inert", "");
        await expect(pressedEntries(page)).toHaveCount(1);
        await expect.poll(async () => (await saved(page))?.panels.sidebar?.activeContainer).toBe(PROJECT_CONTAINER);
        expect(intentsOf((await saved(page))!)).toEqual(intents);
        expect(await instances()).toEqual(before);

        // 切回来：原样。
        await pressEntry(page, entry(page, `view:${A}`));
        await expect(sample(page, A)).toBeVisible();
        await expect.poll(heights).toEqual(expected);
        expect((await box(page, upper)).y).toBeLessThan((await box(page, lower)).y);
        await expect(collapseButton(page, B)).toHaveAttribute("aria-expanded", "false");
        await expect(collapseButton(page, A)).toHaveAttribute("aria-expanded", "true");
        expect(await instances()).toEqual(before);
        await expect(input).toHaveValue("乙的草稿");
        await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(120);
        await expect.poll(async () => (await saved(page))?.panels.sidebar?.activeContainer).toBe(`view:${A}`);
        const after = (await saved(page))!;
        expect(intentsOf(after)).toEqual(intents);
        expect(after.panels[lower]?.collapsed).toBe(true);
        expect(after.panels[upper]?.collapsed ?? false).toBe(false);
    });

    test("切回容器、侧栏从隐藏到显示：切回时整张卡片滚进来、隐藏显示时长出来缩回去，停放过的内容跟着外框走，每一帧都不超出外框；侧栏显示时整列从活动栏边上横着长出来，隐藏时整列留着缩回去（ui/nested-grid 输出 42、45 到 48、61 到 77、85）", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        const explorer = await sectionOf(page, EXPLORER);
        /** 在页面里点一下，逐帧量这一节的外框与内容，直到网格的过渡结束。只记内容看得见的帧。 */
        const framesAfter = (selector: string) => page.evaluate(async ({selector, leafId}) => {
            const rows: Array<{frameLeft: number; frameRight: number; frameWidth: number; frameTop: number; frameBottom: number; frameHeight: number; contentLeft: number; contentRight: number; contentTop: number; contentBottom: number; headRight: number; bodyRight: number; gapHit: boolean; cornerHit: boolean; innerHit: boolean; rightCornerHit: boolean}> = [];
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
                    const cardRight = leaf.right - Number.parseFloat(pad.paddingRight);
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
                        rightCornerHit: inLeaf(cardRight - 1, cardTop + 1),
                    });
                }
                if (frame > 2 && document.querySelector("[data-workbench-surface] [data-moving]") === null) break;
            }
            return rows;
        }, {selector, leafId: explorer});
        const expectInside = (rows: Awaited<ReturnType<typeof framesAfter>>, changes: "frameHeight" | "frameWidth" | "frameTop") => {
            const final = rows.at(-1)?.[changes] ?? 0;
            // 确实量到了过渡中间的帧，不是一下子到终点。
            expect(rows.some((row) => Math.abs(row[changes] - final) > 50)).toBe(true);
            for (const row of rows) {
                expect(row.contentTop).toBeGreaterThanOrEqual(row.frameTop - 1);
                expect(row.contentBottom).toBeLessThanOrEqual(row.frameBottom + 1);
                expect(row.contentLeft).toBeGreaterThanOrEqual(row.frameLeft - 1);
                expect(row.contentRight).toBeLessThanOrEqual(row.frameRight + 1);
            }
        };

        // 切到样例甲的容器，再切回“项目”：整张卡片竖着滚进来（输出 42），高度不变、上边在走。
        await pressEntry(page, entry(page, `view:${A}`));
        await expect(leaf(page, explorer)).toHaveCount(0);
        await expect(page.locator("[data-workbench-surface] [data-moving]")).toHaveCount(0);
        expectInside(await framesAfter(`[data-tool-entry="${PROJECT_CONTAINER}"]`), "frameTop");

        // 点当前容器的入口隐藏侧栏：整列作为一块缩回活动栏边上（按拖到零画，缩到零），每一帧全高、左边不动，内容被外框裁着，过渡结束前还画着。
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
        await shrunk(page, explorer);
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
        // 露出来的一截始终是一张完整的卡片（按外框的直角矩形裁时右上角是尖的）。“项目”两节，整列和活动栏相连（输出 19）：长出来的这段角接过去，
        // 左边贴着活动栏、没有缝，左上角是直的（伸到活动栏底下），右上角是圆的。
        const middle = showing.filter((row) => row.frameWidth > 60 && row.frameWidth < settled.frameWidth - 1);
        expect(middle.length).toBeGreaterThan(0);
        for (const row of middle) expect([row.gapHit, row.cornerHit, row.innerHit, row.rightCornerHit]).toEqual([true, true, true, false]);
    });

    test("活动栏与只有一节的侧栏相连：隐藏、显示时两张卡片画成一张，侧栏右边的两个圆角跟着它的右沿走，缩到零时正好成了活动栏的角；中间一直不露缝（ui/workbench-layout 输出 19）", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        const moving = page.locator("[data-workbench-surface] [data-moving]");
        const bar = page.locator('[data-shell-card="activitybar"]');
        await pressEntry(page, entry(page, `view:${A}`));
        await expect(moving).toHaveCount(0);
        const section = await sectionOf(page, A);
        await expect(bar).toHaveAttribute("data-shell-join", "start");
        await expect(page.locator(`[data-shell-card="${section}"]`)).toHaveAttribute("data-shell-join", "end");
        // 放慢到 6 秒，点下去之后把页面上的过渡都停住、拨到指定的时刻再截图：同一时刻量矩形、看像素。网格自己的计时按这个时长，6 秒内看完。
        await page.addStyleTag({content: ":root { --motion-layout: 6000ms !important; }"});
        const duration = 6000;
        const card = await bar.boundingBox();
        expect(card).not.toBeNull();
        const top = card!.y, bottom = card!.y + card!.height, middle = card!.y + card!.height / 2;

        /** 截一张活动栏到侧栏右边的图，读几个点的颜色（在页面里解码，不加依赖）。 */
        const colorsAt = async (points: ReadonlyArray<readonly [number, number]>): Promise<number[][]> => {
            const clip = {x: 0, y: top - 4, width: 520, height: bottom - top + 8};
            const png = await page.screenshot({clip});
            return page.evaluate(async ({data, points, clip}) => {
                const image = new Image();
                image.src = `data:image/png;base64,${data}`;
                await image.decode();
                const canvas = document.createElement("canvas");
                canvas.width = image.width;
                canvas.height = image.height;
                const context = canvas.getContext("2d")!;
                context.drawImage(image, 0, 0);
                return points.map(([x, y]) => [...context.getImageData(Math.floor(x - clip.x), Math.floor(y - clip.y), 1, 1).data].slice(0, 3));
            }, {data: png.toString("base64"), points, clip});
        };
        const near = (a: number[] | undefined, b: number[] | undefined): boolean => a !== undefined && b !== undefined && a.every((value, index) => Math.abs(value - (b[index] ?? 0)) <= 6);
        // 窗体底：活动栏左边那条整缝；卡片底：活动栏里中间一行的空处。
        const [ground, surface] = await colorsAt([[card!.x - 2, middle], [card!.x + 4, middle]]);
        expect(near(ground, surface)).toBe(false);

        /** 点一下入口，过渡停在这几个时刻：每个时刻量活动栏卡片、这一节外框的矩形，读短线的状态与几处像素。 */
        const sample = async (fractions: readonly number[]) => {
            await page.evaluate((selector) => {
                document.querySelector<HTMLElement>(selector)!.click();
            }, `[data-tool-entry="view:${A}"]`);
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const rows = [];
            for (const fraction of fractions) {
                const at = await page.evaluate(({fraction, duration, leafId}) => {
                    for (const animation of document.getAnimations()) {
                        animation.pause();
                        animation.currentTime = fraction * duration;
                    }
                    const barBox = document.querySelector('[data-shell-card="activitybar"]')!.getBoundingClientRect();
                    const leafBox = document.querySelector(`[data-workbench-surface] > [data-grid-scope] > [data-leaf="${leafId}"]`)?.getBoundingClientRect();
                    return {barRight: barBox.right, leafLeft: leafBox?.left ?? Number.NaN, leafRight: leafBox?.right ?? Number.NaN, cap: document.querySelector<HTMLElement>('[data-shell-card="activitybar"]')!.dataset.shellCap ?? null};
                }, {fraction, duration, leafId: section});
                const capRight = at.leafRight - 2;
                const [barCorner, gap, capCorner, ...row] = await colorsAt([
                    [at.barRight - 1.5, top + 1.5],
                    [at.barRight + 1, middle],
                    [capRight - 1.5, top + 1.5],
                    // 中间一行，从活动栏右边一点到侧栏外框的左边（侧栏的内容在外框里往左滑，不量它）。
                    ...Array.from({length: Math.max(0, Math.floor(Math.min(capRight - 3, at.leafLeft - 1) - (at.barRight - 6)))}, (_, index) => [at.barRight - 6 + index, middle] as const),
                ]);
                rows.push({...at, width: at.leafRight - at.leafLeft, barCorner, gap, capCorner, row});
            }
            await page.evaluate(() => {
                for (const animation of document.getAnimations()) {
                    if (animation.effect?.getComputedTiming().endTime === Number.POSITIVE_INFINITY) animation.play();
                    else animation.finish();
                }
            });
            return rows;
        };

        // 隐藏：活动栏一开始就是断开的样子（右边留半缝、角是圆的），但它的角和半缝被侧栏伸过来的那一截盖着，看到的是一张卡片；
        // 侧栏右上角一直是圆的，跟着右沿往左走。
        const hiding = await sample([0.04, 0.12, 0.3, 0.6, 0.95]);
        for (const row of hiding) {
            expect(near(row.capCorner, ground)).toBe(true);
            for (const pixel of row.row) expect(near(pixel, surface)).toBe(true);
            if (row.width >= 20) {
                expect(near(row.barCorner, surface)).toBe(true);
                expect(near(row.gap, surface)).toBe(true);
            }
        }
        expect(hiding.map((row) => row.cap)).toEqual(hiding.map(() => "leave"));
        expect(hiding.filter((row) => row.width >= 20).length).toBeGreaterThanOrEqual(2);
        await expect(moving).toHaveCount(0);
        await shrunk(page, section);
        expect(await bar.getAttribute("data-shell-join")).toBeNull();
        expect(await bar.getAttribute("data-shell-join-seam")).toBeNull();
        expect(await bar.getAttribute("data-shell-cap")).toBeNull();
        const hidden = await bar.boundingBox();
        const [hiddenCorner, hiddenGap] = await colorsAt([[hidden!.x + hidden!.width - 1.5, top + 1.5], [hidden!.x + hidden!.width + 1, middle]]);
        expect(near(hiddenCorner, ground)).toBe(true);
        expect(near(hiddenGap, ground)).toBe(true);

        // 显示：倒过来。长着的每一刻同样是一张卡片，侧栏右上角是圆的；长完了换回相连的画法，活动栏右上角是直的。
        const showing = await sample([0.04, 0.12, 0.3, 0.6, 0.95]);
        for (const row of showing) {
            expect(near(row.capCorner, ground)).toBe(true);
            for (const pixel of row.row) expect(near(pixel, surface)).toBe(true);
            if (row.width >= 20) {
                expect(near(row.barCorner, surface)).toBe(true);
                expect(near(row.gap, surface)).toBe(true);
            }
        }
        expect(showing.map((row) => row.cap)).toEqual(showing.map(() => "enter"));
        await expect(moving).toHaveCount(0);
        await expect(bar).toHaveAttribute("data-shell-join", "start");
        await expect(bar).toHaveAttribute("data-shell-join-seam", "end");
        expect(await bar.getAttribute("data-shell-cap")).toBeNull();
        const shown = await bar.boundingBox();
        const [shownCorner] = await colorsAt([[shown!.x + shown!.width - 1.5, top + 1.5]]);
        expect(near(shownCorner, surface)).toBe(true);

        // 切到另一个只有一节的容器：整张卡片滚过去（输出 42），活动栏前后都相连，过渡中也不换画法（换的话图标会左右挪）。
        await page.evaluate((selector) => document.querySelector<HTMLElement>(selector)!.click(), `[data-tool-entry="view:${B}"]`);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const switching = await page.evaluate(({duration}) => {
            for (const animation of document.getAnimations()) {
                animation.pause();
                animation.currentTime = 0.3 * duration;
            }
            const card = document.querySelector<HTMLElement>('[data-shell-card="activitybar"]')!;
            return {moving: document.querySelector("[data-workbench-surface] [data-moving]") !== null, join: card.dataset.shellJoin ?? null, cap: card.dataset.shellCap ?? null, right: card.getBoundingClientRect().right};
        }, {duration});
        await page.evaluate(() => {
            for (const animation of document.getAnimations()) {
                if (animation.effect?.getComputedTiming().endTime === Number.POSITIVE_INFINITY) animation.play();
                else animation.finish();
            }
        });
        expect(switching).toEqual({moving: true, join: "start", cap: null, right: shown!.x + shown!.width});
        await expect(moving).toHaveCount(0);
        await expect(entry(page, `view:${B}`)).toHaveAttribute("aria-pressed", "true");
    });

    test("一个容器一张卡片：“项目”的两节拼成一张、整列和活动栏相连，两节之间是两端缩进的线，线所在的那 1px 也是卡片，浅色深色都不露底、外框不断开（ui/workbench-layout 输出 19）", async ({page}) => {
        await open(page);
        const sections = [await sectionOf(page, SESSIONS), await sectionOf(page, EXPLORER)];
        const tops = await Promise.all(sections.map(async (id) => (await page.locator(`[data-shell-card="${id}"]`).boundingBox())!.y));
        const [upper, lower] = tops[0]! < tops[1]! ? sections : [...sections].reverse();
        const column = await page.evaluate(([upper, lower]) => {
            const card = (id: string) => document.querySelector<HTMLElement>(`[data-shell-card="${id}"]`)!;
            const radii = (id: string) => ["top-left", "top-right", "bottom-right", "bottom-left"].map((corner) => getComputedStyle(card(id)).getPropertyValue(`border-${corner}-radius`));
            return {upper: radii(upper), lower: radii(lower), joins: [card(upper).dataset.shellJoin, card(lower).dataset.shellJoin]};
        }, [upper!, lower!] as const);
        expect(column).toEqual({upper: ["0px", "12px", "0px", "0px"], lower: ["0px", "0px", "12px", "0px"], joins: ["end", "end"]});

        /** 截一块图，读几个点的颜色（在页面里解码，不加依赖）。 */
        const colorsAt = async (points: ReadonlyArray<readonly [number, number]>): Promise<number[][]> => {
            const png = await page.screenshot();
            return page.evaluate(async ({data, points}) => {
                const image = new Image();
                image.src = `data:image/png;base64,${data}`;
                await image.decode();
                const canvas = document.createElement("canvas");
                canvas.width = image.width;
                canvas.height = image.height;
                const context = canvas.getContext("2d")!;
                context.drawImage(image, 0, 0);
                return points.map(([x, y]) => [...context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data].slice(0, 3));
            }, {data: png.toString("base64"), points});
        };
        const same = (a: number[] | undefined, b: number[] | undefined): boolean => a !== undefined && b !== undefined && a.every((value, index) => Math.abs(value - (b[index] ?? 0)) <= 3);
        const check = async () => {
            const geometry = await page.evaluate(([upper]) => {
                // 侧栏两节之间那条线：入口条和下面分节之间的 0 宽的缝也是同一类，按名字认（名字里有上面那一节，是高度）。
                const sash = [...document.querySelectorAll<HTMLElement>('[data-workbench-surface] > [data-grid-scope] > [data-sash-kind="panes"]')].find((element) => (element.getAttribute("aria-label") ?? "").includes(upper) && (element.getAttribute("aria-label") ?? "").endsWith("的高度"))!.getBoundingClientRect();
                const card = document.querySelector<HTMLElement>(`[data-shell-card="${upper}"]`)!.getBoundingClientRect();
                return {sashY: sash.top + sash.height / 2, left: card.left, right: card.right};
            }, [upper!] as const);
            const {sashY, right, left} = geometry;
            // 线的右端缩进里（离卡片右边 3px）、线的中间、卡片右边外的第 1px（深色是外框，浅色是投影）、再往外 3px 的窗体底；
            // 各和上面一节底部同一列比（离线 6px，那里是空的卡片底）。
            const above = sashY - 6;
            const [endOnSash, endInCard, middleOnSash, middleInCard, ringOnSash, ringInCard, groundOnSash, groundInCard] = await colorsAt([
                [right - 3, sashY], [right - 3, above],
                [(left + right) / 2, sashY], [(left + right) / 2, above],
                [right + 0.5, sashY], [right + 0.5, above],
                [right + 3, sashY], [right + 3, above],
            ]);
            expect(same(endOnSash, endInCard), `线的右端 ${String(endOnSash)}，卡片 ${String(endInCard)}`).toBe(true);
            expect(same(middleOnSash, middleInCard), `线的中间 ${String(middleOnSash)}，卡片 ${String(middleInCard)}`).toBe(false);
            expect(same(ringOnSash, ringInCard), `线右边外的 1px ${String(ringOnSash)}，卡片右边外 ${String(ringInCard)}`).toBe(true);
            expect(same(groundOnSash, groundInCard), `窗体底 ${String(groundOnSash)}，${String(groundInCard)}`).toBe(true);
            // 线的左端和活动栏相连：卡片左边外的 8px 里（半缝与活动栏），线这一行和上面一节同一列一样，线不往活动栏上放投影。
            const leftward = [1, 3, 5, 7];
            const onBar = await colorsAt(leftward.flatMap((dx) => [[left - dx, sashY], [left - dx, above]] as const));
            for (const [index, dx] of leftward.entries()) {
                const [onSash, inCard] = [onBar[index * 2], onBar[index * 2 + 1]];
                expect(same(onSash, inCard), `卡片左边外 ${String(dx)}px：线这一行 ${String(onSash)}，上面 ${String(inCard)}`).toBe(true);
            }
        };
        await check();
        // 明暗按设置走（缺省浅色，不跟系统）：写设置文件切到深色，用完写回空设置，同一个服务上后面的用例照旧是浅色。
        const settings = join(tmp, "state", "settings.json");
        await writeFile(settings, JSON.stringify({"nbook.workbench/appearance": "dark"}));
        try {
            await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "dark");
            await check();
        } finally {
            await writeFile(settings, "{}");
        }
    });

    test("侧栏两节时角照样接过去：隐藏、显示的每一刻，两节之间那一行在活动栏与侧栏之间也不露底，侧栏右上角是圆的（ui/workbench-layout 输出 19）", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        const bar = page.locator('[data-shell-card="activitybar"]');
        const moving = page.locator("[data-workbench-surface] [data-moving]");
        await expect(bar).toHaveAttribute("data-shell-join", "start");
        const explorer = await sectionOf(page, EXPLORER);
        const sessions = await sectionOf(page, SESSIONS);
        const [explorerTop, sessionsTop] = await Promise.all([explorer, sessions].map(async (id) => (await page.locator(`[data-shell-card="${id}"]`).boundingBox())!.y));
        const upper = explorerTop! < sessionsTop! ? explorer : sessions;
        // 侧栏两节之间那条线（右栏、底部面板的入口条和下面分节之间也有一条 0 宽的同类缝，不要它）。
        const sash = await page.getByRole("separator", {name: new RegExp(`^调整 (?:${explorer} 与 ${sessions}|${sessions} 与 ${explorer}) 的高度$`, "u")}).boundingBox();
        const card = await bar.boundingBox();
        expect(sash).not.toBeNull();
        const divider = sash!.y + sash!.height / 2, middle = card!.y + card!.height / 2, top = card!.y;
        await page.addStyleTag({content: ":root { --motion-layout: 6000ms !important; }"});
        // 活动栏右边那条短线是有意画的，过渡中随着淡出、淡入，正好竖着穿过这一行：藏掉它，这一行读的是它下面的颜色。
        await page.addStyleTag({content: "[data-shell-join-seam]::after { display: none !important; }"});
        const duration = 6000;

        const [ground, surface] = await colorsAt(page, [[card!.x - 2, middle], [card!.x + 4, middle]]);
        expect(near(ground, surface)).toBe(false);

        /** 点一下入口，过渡停在这几个时刻：读两节之间那一行从活动栏里一点到侧栏外框左边的像素，和上面一节的右上角。 */
        const sample = async (fractions: readonly number[]) => {
            await page.evaluate((selector) => document.querySelector<HTMLElement>(selector)!.click(), `[data-tool-entry="${PROJECT_CONTAINER}"]`);
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const rows = [];
            for (const fraction of fractions) {
                const at = await page.evaluate(({fraction, duration, leafId}) => {
                    for (const animation of document.getAnimations()) {
                        animation.pause();
                        animation.currentTime = fraction * duration;
                    }
                    const barBox = document.querySelector('[data-shell-card="activitybar"]')!.getBoundingClientRect();
                    const leafBox = document.querySelector(`[data-workbench-surface] > [data-grid-scope] > [data-leaf="${leafId}"]`)!.getBoundingClientRect();
                    return {barRight: barBox.right, leafLeft: leafBox.left, leafRight: leafBox.right, cap: document.querySelector<HTMLElement>('[data-shell-card="activitybar"]')!.dataset.shellCap ?? null};
                }, {fraction, duration, leafId: upper});
                const span = Math.max(0, Math.floor(at.leafLeft + 2 - (at.barRight - 6)));
                const [capCorner, ...row] = await colorsAt(page, [
                    [at.leafRight - 3.5, top + 1.5],
                    ...Array.from({length: span}, (_, index) => [at.barRight - 6 + index, divider] as const),
                ]);
                rows.push({...at, width: at.leafRight - at.leafLeft, capCorner, row});
            }
            await page.evaluate(() => {
                for (const animation of document.getAnimations()) {
                    if (animation.effect?.getComputedTiming().endTime === Number.POSITIVE_INFINITY) animation.play();
                    else animation.finish();
                }
            });
            return rows;
        };
        // 先隐藏、再显示：网格自己的计时按放慢的时长，等它结束了再点下一次。
        for (const kind of ["leave", "enter"] as const) {
            const rows = await sample([0.1, 0.3, 0.6]);
            expect(rows.map((row) => row.cap)).toEqual(rows.map(() => kind));
            for (const row of rows) {
                expect(near(row.capCorner, ground), `${kind} 右上角 ${String(row.capCorner)}`).toBe(true);
                row.row.forEach((pixel, index) => expect(near(pixel, surface), `${kind} 两节之间那一行第 ${String(index)} 个 ${String(pixel)}`).toBe(true));
            }
            await expect(moving).toHaveCount(0);
        }
    });

    test("侧栏切换容器：卡片不动（外框、缝与右边两个圆角都在原处），里面的内容竖着滚过去，卡片外不画，活动栏一直相连、不换画法，按下的块和内容同时走；滚到一半点回来，从这一刻往回滚，结束时两节原样（ui/workbench-layout 输出 22、42；验收 33）", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        const bar = page.locator('[data-shell-card="activitybar"]');
        const sections = [await sectionOf(page, EXPLORER), await sectionOf(page, SESSIONS)];
        const homes = await Promise.all(sections.map((id) => box(page, id)));
        const [upper] = homes[0]!.y < homes[1]!.y ? sections : [...sections].reverse();
        const column = {top: Math.min(...homes.map((home) => home.y)), bottom: Math.max(...homes.map((home) => home.y + home.height)), center: homes[0]!.x + homes[0]!.width / 2};
        const status = await box(page, "statusbar");
        expect(status.y).toBeGreaterThanOrEqual(column.bottom - 1);
        // 这一列的卡片（两节拼成一张）与缝宽：滚动中卡片就在这里不动。
        const card = await page.evaluate((ids) => {
            const rects = ids.map((id) => document.querySelector(`[data-shell-card="${id}"]`)!.getBoundingClientRect());
            const gap = Number.parseFloat(getComputedStyle(document.querySelector("[data-workbench-surface]")!).getPropertyValue("--shell-gap"));
            return {top: Math.min(...rects.map((rect) => rect.top)), bottom: Math.max(...rects.map((rect) => rect.bottom)), left: rects[0]!.left, right: rects[0]!.right, gap};
        }, sections);
        expect(card.gap).toBeGreaterThan(0);
        const indicatorAt = () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector("[data-tool-indicator]")!).transform).f);
        const entryTop = async (container: string) => page.evaluate((container) => {
            const button = [...document.querySelectorAll<HTMLElement>("[data-tool-entry]")].find((element) => element.dataset.toolEntry === container)!;
            return button.offsetTop;
        }, container);
        const [fromEntry, toEntry] = [await entryTop(PROJECT_CONTAINER), await entryTop(`view:${B}`)];
        expect(toEntry).toBeGreaterThan(fromEntry);
        await expect.poll(indicatorAt).toBe(fromEntry);

        const statusPoint = [column.center, status.y + status.height / 2] as const;
        // 卡片上下的缝、右上与右下圆角外面的那一点：静止时是窗体底，滚动中也不变（卡片的边与角不动，内容不画到卡片外）。
        const still = [
            statusPoint,
            [column.center, card.top - card.gap / 2], [column.center, card.bottom + card.gap / 2],
            [card.right - 1.5, card.top + 1.5], [card.right - 1.5, card.bottom - 1.5],
        ] as const;
        const stillColors = await colorsAt(page, still);

        await page.addStyleTag({content: ":root { --motion-layout: 6000ms !important; }"});
        const duration = 6000;
        const click = (container: string) => page.evaluate((selector) => document.querySelector<HTMLElement>(selector)!.click(), `[data-tool-entry="${container}"]`);
        const started = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const pauseAt = (fraction: number) => page.evaluate(({fraction, duration, upper}) => {
            for (const animation of document.getAnimations()) {
                animation.pause();
                animation.currentTime = fraction * duration;
            }
            const frames = [...document.querySelectorAll<HTMLElement>("[data-workbench-surface] > [data-grid-scope] > [data-leaf][data-swap]")];
            const top = (side: string) => frames.filter((frame) => frame.dataset.swap === side).map((frame) => frame.getBoundingClientRect().top);
            const card = document.querySelector<HTMLElement>('[data-shell-card="activitybar"]')!;
            const upperFrame = document.querySelector(`[data-workbench-surface] > [data-grid-scope] > [data-leaf="${upper}"]`);
            return {
                in: Math.min(...top("in")), out: Math.min(...top("out")), upper: upperFrame?.getBoundingClientRect().top ?? null,
                outInert: frames.filter((frame) => frame.dataset.swap === "out").every((frame) => frame.inert),
                join: card.dataset.shellJoin ?? null, cap: card.dataset.shellCap ?? null, seam: card.dataset.shellJoinSeam ?? null,
                indicator: new DOMMatrix(getComputedStyle(document.querySelector("[data-tool-indicator]")!).transform).f,
                backdrop: (() => {
                    const rect = document.querySelector("[data-shell-swap-card]")?.getBoundingClientRect();
                    return rect === undefined ? null : {top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right};
                })(),
            };
        }, {fraction, duration, upper: upper!});
        const finish = () => page.evaluate(() => {
            for (const animation of document.getAnimations()) {
                if (animation.effect?.getComputedTiming().endTime === Number.POSITIVE_INFINITY) animation.play();
                else animation.finish();
            }
        });

        // 切到样例乙（入口在后面）：乙从下面进来，“项目”往上出去，两张卡片相距列高加一条缝，一起走。
        await click(`view:${B}`);
        await started();
        let step = 0;
        for (const fraction of [0, 0.1, 0.3]) {
            const at = await pauseAt(fraction);
            if (fraction === 0) {
                expect(at.out).toBeCloseTo(column.top, 0);
                step = at.in - at.out;
                // 一次滚“卡片的高加一条缝”：内容裁在卡片里，滑走的与换上来的之间隔一条缝。
                expect(step).toBeCloseTo(card.bottom - card.top + card.gap, 0);
            }
            expect(at.backdrop).not.toBeNull();
            for (const key of ["top", "bottom", "left", "right"] as const) expect(at.backdrop![key]).toBeCloseTo(card[key], 0);
            expect(at.in - at.out).toBeCloseTo(step, 0);
            expect({outInert: at.outInert, join: at.join, cap: at.cap, seam: at.seam}).toEqual({outInert: true, join: "start", cap: null, seam: "end"});
            if (fraction > 0) expect(at.indicator).toBeGreaterThan(fromEntry);
            expect(at.indicator).toBeLessThan(toEntry);
            const colors = await colorsAt(page, still);
            for (const [index, point] of still.entries()) {
                expect(near(colors[index], stillColors[index]), `滚到 ${String(fraction)} 时 (${point.join(", ")}) 是 ${String(colors[index])}，静止时 ${String(stillColors[index])}`).toBe(true);
            }
        }
        // 滑到四成点回“项目”：它从此刻的位置往回走，两张卡片不叠。
        const before = await pauseAt(0.4);
        await click(PROJECT_CONTAINER);
        await started();
        const restarted = await pauseAt(0);
        expect(restarted.upper).toBeCloseTo(before.upper!, 0);
        for (const fraction of [0.3, 0.7]) {
            const at = await pauseAt(fraction);
            expect(at.upper!).toBeGreaterThan(before.upper!);
            expect(at.out - at.in).toBeCloseTo(step, 0);
            expect(at.cap).toBeNull();
        }
        await finish();
        await expect(page.locator("[data-workbench-surface] [data-swap]")).toHaveCount(0);
        expect(await Promise.all(sections.map((id) => box(page, id)))).toEqual(homes);
        await expect(entry(page, PROJECT_CONTAINER)).toHaveAttribute("aria-pressed", "true");
        await expect.poll(indicatorAt).toBe(fromEntry);
        await expect(bar).toHaveAttribute("data-shell-join", "start");
    });

    // 覆盖 ui/workbench-layout 输出 42、50（右栏切换的样子同侧栏，入口竖排在右轨上）：卡片与右轨不动，内容在卡片里竖着滚过去，卡片外不画；右轨与右栏一直相连；
    // 按下的块和内容同时走；滚到一半点回来从这一刻往回滚。
    test("右栏切换容器：卡片与右轨不动，内容在卡片里竖着滚过去，卡片外不画，右轨一直相连；按下的块和内容同时走；滚到一半点回来从这一刻往回滚（ui/workbench-layout 输出 42、50）", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        const rail = page.locator('[data-rail="auxiliarybar"]');
        // 默认右栏有对话与样例丁两个容器、各一节，对话在前、按下着。
        const entryIds = await rail.locator("[data-tool-band] [data-tool-entry]").evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.toolEntry!));
        expect(entryIds.length).toBeGreaterThanOrEqual(2);
        const [from, to] = [entryIds[0]!, entryIds[1]!];
        await expect(rail.locator(`[data-tool-entry="${from}"]`)).toHaveAttribute("aria-pressed", "true");
        const conversation = await sectionOf(page, CONVERSATION);
        const home = await box(page, conversation);
        const card = await page.evaluate((id) => {
            const rect = document.querySelector(`[data-shell-card="${id}"]`)!.getBoundingClientRect();
            const gap = Number.parseFloat(getComputedStyle(document.querySelector("[data-workbench-surface]")!).getPropertyValue("--shell-gap"));
            return {top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, gap};
        }, conversation);
        expect(card.gap).toBeGreaterThan(0);
        const railBefore = (await page.locator('[data-shell-card="rail:auxiliarybar"]').boundingBox())!;
        const [fromTop, toTop] = [await railEntryTop(page, from), await railEntryTop(page, to)];
        expect(toTop).toBeGreaterThan(fromTop);
        await expect.poll(() => railIndicatorAt(page)).toBe(fromTop);
        // 卡片上下的缝、左上与左下圆角外面那一点：静止时是窗体底，滚动中也不变（内容裁在卡片里，不画到卡片外）。
        const center = (card.left + card.right) / 2;
        const still = [
            [center, card.top - card.gap / 2], [center, card.bottom + card.gap / 2],
            [card.left + 1.5, card.top + 1.5], [card.left + 1.5, card.bottom - 1.5],
        ] as const;
        const stillColors = await colorsAt(page, still);

        await page.addStyleTag({content: ":root { --motion-layout: 6000ms !important; }"});
        const duration = 6000;
        // 切到样例丁（入口在后面）：它从下面进来，对话往上出去，两组相距卡片的高加一条缝。
        await clickOn(page, `[data-rail="auxiliarybar"] [data-tool-entry="${to}"]`);
        await nextFrames(page);
        let step = 0;
        for (const fraction of [0, 0.1, 0.3]) {
            const at = await railSliceAt(page, fraction, duration, conversation);
            expect(at.outLeaves).toEqual([conversation]);
            expect(at.inLeaves).toHaveLength(1);
            if (fraction === 0) {
                expect(at.out).toBeCloseTo(home.y, 0);
                step = at.in - at.out;
                expect(step).toBeCloseTo(card.bottom - card.top + card.gap, 0);
            }
            expect(at.in - at.out).toBeCloseTo(step, 0);
            expect({outInert: at.outInert, joined: at.joined, seam: at.seam}).toEqual({outInert: true, joined: true, seam: "start"});
            // 对话滑出去时内容不跳。
            expect((await content(page, CONVERSATION).boundingBox())!.x).toBeCloseTo(home.x, 0);
            expect(at.railCard).toEqual({top: railBefore.y, bottom: railBefore.y + railBefore.height, left: railBefore.x, right: railBefore.x + railBefore.width});
            expect(at.backdrop).not.toBeNull();
            for (const key of ["top", "bottom", "left", "right"] as const) expect(at.backdrop![key]).toBeCloseTo(card[key], 0);
            expect(at.sliding).toBe(true);
            if (fraction > 0) expect(at.indicator).toBeGreaterThan(fromTop + 0.5);
            expect(at.indicator).toBeLessThan(toTop);
            const colors = await colorsAt(page, still);
            for (const [index, point] of still.entries()) {
                expect(near(colors[index], stillColors[index]), `滚到 ${String(fraction)} 时 (${point.join(", ")}) 是 ${String(colors[index])}，静止时 ${String(stillColors[index])}`).toBe(true);
            }
        }
        // 滑到四成点回对话：它从此刻的位置往回走。
        const before = await railSliceAt(page, 0.4, duration, conversation);
        await clickOn(page, `[data-rail="auxiliarybar"] [data-tool-entry="${from}"]`);
        await nextFrames(page);
        const restarted = await railSliceAt(page, 0, duration, conversation);
        expect(restarted.tracked!.top).toBeCloseTo(before.tracked!.top, 0);
        for (const fraction of [0.3, 0.7]) {
            const at = await railSliceAt(page, fraction, duration, conversation);
            expect(at.tracked!.top).toBeGreaterThan(before.tracked!.top);
            expect(at.out - at.in).toBeCloseTo(step, 0);
        }
        await finishAnimations(page);
        await expect(page.locator("[data-workbench-surface] [data-swap]")).toHaveCount(0);
        expect(await box(page, conversation)).toEqual(home);
        await expect.poll(() => railIndicatorAt(page)).toBe(fromTop);
        await expect(rail.locator("[data-tool-indicator]")).not.toHaveAttribute("data-sliding");
        await expect(rail).toHaveAttribute("data-rail-joined", "");
    });

    test("底部面板切换容器：从几节的容器切到一节的，头在点的那一刻并进入口条、离开的几节带着自己的头滑出去；切回来时入口条那一段空出来、新的头随内容滑进来，离开的那一节没有头；下划线和内容同时走，卡片外不画（ui/workbench-layout 输出 42、47）", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        // 资源管理器移进底部面板的新容器，测试视图再移进它那个容器：底部面板的当前容器左右两节，入口条里没有并进来的头。
        await moveViaMenu(page, EXPLORER, "新容器（底部面板）");
        await moveViaMenu(page, SESSIONS, "资源管理器");
        const strip = page.locator('[data-region-strip="panel"]');
        await expect(strip.locator("[data-panel-head]")).toHaveCount(0);
        await expect(page.locator("[data-workbench-surface] [data-moving]")).toHaveCount(0);
        const pressed = strip.locator('[data-region-entry][aria-pressed="true"]');
        await expect(pressed).toHaveText("资源管理器");
        const many = (await pressed.getAttribute("data-region-entry"))!;
        const one = (await strip.locator("[data-region-entry]", {hasText: "样例戊"}).getAttribute("data-region-entry"))!;
        const sections = [await sectionOf(page, EXPLORER), await sectionOf(page, SESSIONS)];
        const homes = await Promise.all(sections.map((id) => box(page, id)));
        const left = homes[0]!.x < homes[1]!.x ? sections[0]! : sections[1]!;
        const card = await regionCard(page, "panel", sections);
        const [manyLeft, oneLeft] = [await regionEntryLeft(page, "panel", many), await regionEntryLeft(page, "panel", one)];
        await expect.poll(() => regionIndicatorLeft(page, "panel")).toBeCloseTo(manyLeft, 0);
        // 下划线是按下的块的底边，宽同按下的入口。
        expect(await strip.locator("[data-region-indicator]").evaluate((element) => getComputedStyle(element).boxShadow)).toContain("inset");
        expect((await strip.locator("[data-region-indicator]").boundingBox())!.width).toBeCloseTo((await pressed.boundingBox())!.width, 0);
        const middle = (card.stripBottom + card.bottom) / 2;
        const still = [
            [card.left - card.gap / 2, middle], [card.right + card.gap / 2, middle], [(card.left + card.right) / 2, card.bottom + card.gap / 2],
            [card.left + 1.5, card.bottom - 1.5], [card.right - 1.5, card.bottom - 1.5],
        ] as const;
        const stillColors = await colorsAt(page, still);
        const duration = 6000;
        await page.addStyleTag({content: ":root { --motion-layout: 6000ms !important; }"});
        // 方向跟着入口条：样例戊排在新容器前面时从左边进来。
        const direction = oneLeft > manyLeft ? 1 : -1;
        const step = card.right - card.left + card.gap;

        await clickOn(page, `[data-region-strip="panel"] [data-region-entry="${one}"]`);
        await nextFrames(page);
        let entering = "";
        for (const fraction of [0, 0.3]) {
            const at = await sliceAt(page, "panel", fraction, duration, left);
            expect([...at.outLeaves].sort()).toEqual([...sections].sort());
            expect(at.inLeaves).toHaveLength(1);
            entering = at.inLeaves[0]!;
            if (fraction === 0) expect(at.out).toBeCloseTo(homes[0]!.x < homes[1]!.x ? homes[0]!.x : homes[1]!.x, 0);
            expect((at.in - at.out) * direction).toBeCloseTo(step, 0);
            // 样例戊只有一节：点的那一刻它的头就在入口条里，它自己的叶里没有头；离开的两节带着自己的头滑出去。
            expect(at.stripHead).toBe(entering);
            expect(at.headsIn).toEqual([]);
            expect([...at.headsOut].sort()).toEqual([...sections].sort());
            expect(at.stripCard).toEqual({top: card.top, bottom: card.stripBottom, left: card.left, right: card.right});
            for (const [key, value] of [["top", card.stripBottom], ["bottom", card.bottom], ["left", card.left], ["right", card.right]] as const) expect(at.backdrop![key]).toBeCloseTo(value, 0);
            if (fraction > 0) {
                expect(at.sliding).toBe(true);
                expect((at.indicator - manyLeft) * Math.sign(oneLeft - manyLeft)).toBeGreaterThan(0.5);
                expect((oneLeft - at.indicator) * Math.sign(oneLeft - manyLeft)).toBeGreaterThan(0.5);
            }
            const colors = await colorsAt(page, still);
            for (const [index, point] of still.entries()) {
                expect(near(colors[index], stillColors[index]), `滚到 ${String(fraction)} 时 (${point.join(", ")}) 是 ${String(colors[index])}，静止时 ${String(stillColors[index])}`).toBe(true);
            }
        }
        await finishAnimations(page);
        await expect(page.locator("[data-workbench-surface] [data-swap]")).toHaveCount(0);
        await expect.poll(() => regionIndicatorLeft(page, "panel")).toBeCloseTo(oneLeft, 0);

        // 切回几节的容器：点的那一刻入口条里那一段空出来，两节带着自己的头滑进来；样例戊滑出去时没有头，内容的上边不动。
        const oneContentTop = (await page.locator(`[data-content-leaf="${entering}"]`).first().boundingBox())!.y;
        await clickOn(page, `[data-region-strip="panel"] [data-region-entry="${many}"]`);
        await nextFrames(page);
        for (const fraction of [0, 0.3]) {
            const at = await sliceAt(page, "panel", fraction, duration, left);
            expect(at.outLeaves).toEqual([entering]);
            expect(at.stripHead).toBeNull();
            expect([...at.headsIn].sort()).toEqual([...sections].sort());
            expect(at.headsOut).toEqual([]);
            expect((await page.locator(`[data-content-leaf="${entering}"]`).first().boundingBox())!.y).toBeCloseTo(oneContentTop, 0);
            expect((at.out - at.in) * direction).toBeCloseTo(step, 0);
        }
        await finishAnimations(page);
        await expect(page.locator("[data-workbench-surface] [data-swap]")).toHaveCount(0);
        expect(await Promise.all(sections.map((id) => box(page, id)))).toEqual(homes);
        await expect.poll(() => regionIndicatorLeft(page, "panel")).toBeCloseTo(manyLeft, 0);
    });

    test("侧栏还在滚时点右栏的入口：侧栏这一刻直接到终点，右栏照常滚（ui/workbench-layout 输出 42；ui/nested-grid 输出 73）", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        const rail = page.locator('[data-rail="auxiliarybar"]');
        const to = (await rail.locator("[data-tool-band] [data-tool-entry]").nth(1).getAttribute("data-tool-entry"))!;
        const sidebar = [await sectionOf(page, EXPLORER), await sectionOf(page, SESSIONS)];
        await page.addStyleTag({content: ":root { --motion-layout: 6000ms !important; }"});
        await clickOn(page, `[data-tool-entry="view:${B}"]`);
        await nextFrames(page);
        // 侧栏在滚：“项目”的两节往上出去，样例乙那一节从下面进来。
        const beta = (await content(page, B).getAttribute("data-content-leaf"))!;
        const swapping = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-workbench-surface] > [data-grid-scope] > [data-leaf][data-swap]")].map((frame) => frame.dataset.leaf!).sort());
        expect(await swapping()).toEqual([...sidebar, beta].sort());
        await clickOn(page, `[data-rail="auxiliarybar"] [data-tool-entry="${to}"]`);
        await nextFrames(page);
        // 右栏开始滚的这一刻，侧栏已经不在交换里，样例乙那一节就在它的终点上。
        const at = await railSliceAt(page, 0.2, 6000, beta);
        expect(at.inLeaves).toHaveLength(1);
        expect((await swapping()).filter((id) => [...sidebar, beta].includes(id))).toEqual([]);
        await finishAnimations(page);
        await expect(page.locator("[data-workbench-surface] [data-swap]")).toHaveCount(0);
        const rest = await box(page, beta);
        for (const [key, value] of [["x", at.tracked!.left], ["y", at.tracked!.top], ["width", at.tracked!.right - at.tracked!.left], ["height", at.tracked!.bottom - at.tracked!.top]] as const) expect(rest[key]).toBeCloseTo(value, 0);
    });

    test("按下的块：页面打开时直接在位、不淡入；滑到一半点回来，从这一刻接着往回滑、不跳到终点；用命令换容器时内容不滚，块直接到位（ui/workbench-layout 输出 22、42）", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await page.addInitScript(() => {
            const host = window as unknown as {__indicatorFaded: boolean};
            host.__indicatorFaded = false;
            document.addEventListener("transitionrun", (event) => {
                if (event.propertyName === "opacity" && (event.target as Element).matches("[data-tool-indicator]")) host.__indicatorFaded = true;
            }, true);
        });
        await open(page);
        const run = (command: string, args: Record<string, unknown>) => page.evaluate(({name, detail}) => window.dispatchEvent(new CustomEvent(name, {detail})), {name: SAMPLE_VIEWS_RUN_EVENT, detail: {command, args}});
        const indicator = page.locator("[data-rail=sidebar] [data-tool-indicator]");
        const indicatorAt = () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector("[data-rail=sidebar] [data-tool-indicator]")!).transform).f);
        const entryTop = async (container: string) => page.evaluate((container) => {
            const button = [...document.querySelectorAll<HTMLElement>("[data-tool-entry]")].find((element) => element.dataset.toolEntry === container)!;
            return button.offsetTop;
        }, container);
        const [fromEntry, toEntry] = [await entryTop(PROJECT_CONTAINER), await entryTop(`view:${B}`)];
        expect(toEntry).toBeGreaterThan(fromEntry);
        await expect.poll(indicatorAt).toBe(fromEntry);
        expect(await page.evaluate(() => (window as unknown as {__indicatorFaded: boolean}).__indicatorFaded)).toBe(false);
        await page.addStyleTag({content: ":root { --motion-layout: 6000ms !important; }"});
        const click = (container: string) => page.evaluate((selector) => document.querySelector<HTMLElement>(selector)!.click(), `[data-tool-entry="${container}"]`);

        // 真实时间里滑（不暂停动画）：点样例乙，块走出一段后点回“项目”。之后的每一帧块都还在半路、一帧比一帧靠近“项目”。
        await click(`view:${B}`);
        await expect.poll(indicatorAt).toBeGreaterThan(fromEntry + (toEntry - fromEntry) / 5);
        await click(PROJECT_CONTAINER);
        const frames = await page.evaluate(() => new Promise<number[]>((resolve) => {
            const values: number[] = [];
            const sample = (): void => {
                values.push(new DOMMatrix(getComputedStyle(document.querySelector("[data-tool-indicator]")!).transform).f);
                if (values.length < 8) requestAnimationFrame(sample);
                else resolve(values);
            };
            requestAnimationFrame(sample);
        }));
        for (const [index, value] of frames.entries()) {
            expect(value, `点回后第 ${String(index)} 帧：${frames.join(", ")}`).toBeGreaterThan(fromEntry + 1);
            if (index > 0) expect(value, `点回后第 ${String(index)} 帧：${frames.join(", ")}`).toBeLessThanOrEqual(frames[index - 1]! + 0.5);
        }
        await expect(indicator).toHaveAttribute("data-sliding", "");
        await page.evaluate(() => {
            for (const animation of document.getAnimations()) {
                if (animation.effect?.getComputedTiming().endTime === Number.POSITIVE_INFINITY) animation.play();
                else animation.finish();
            }
        });
        await expect(indicator).not.toHaveAttribute("data-sliding");
        await expect.poll(indicatorAt).toBe(fromEntry);
        await expect(page.locator("[data-workbench-surface] [data-swap]")).toHaveCount(0);

        // 命令打开样例乙：侧栏切过去但不滚，块下一帧就在乙的入口上，没有在滑。
        await run("nbook.view.open", {viewId: B});
        await expect(entry(page, `view:${B}`)).toHaveAttribute("aria-pressed", "true");
        const after = await page.evaluate(() => new Promise<{swap: number; sliding: boolean; moving: number; at: number}>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => {
                const element = document.querySelector<HTMLElement>("[data-tool-indicator]")!;
                resolve({
                    swap: document.querySelectorAll("[data-workbench-surface] [data-swap]").length,
                    sliding: element.hasAttribute("data-sliding"),
                    moving: element.getAnimations().filter((animation) => (animation as Animation & {transitionProperty?: string}).transitionProperty === "transform").length,
                    at: new DOMMatrix(getComputedStyle(element).transform).f,
                });
            }));
        }));
        expect(after).toEqual({swap: 0, sliding: false, moving: 0, at: toEntry});
    });

    test("底部面板隐藏、显示：作为一块从底边缩下去、长上来，隐藏时缩到零（按拖到零画），过渡中不可交互、还画着；每一帧内容都紧贴面板头下面，不落后、不压住它（ui/nested-grid 输出 42、45 到 49、86）", async ({page}) => {
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
            const rows: Array<{frameTop: number; frameBottom: number; frameHeight: number; bodyTop: number; stripBottom: number | null; shrinking: boolean; bottomGapHit: boolean}> = [];
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
                    const strip = document.querySelector('[data-workbench-surface] > [data-grid-scope] > [data-leaf="strip:panel"]')?.getBoundingClientRect() ?? null;
                    rows.push({frameTop: rect.top, frameBottom: rect.bottom, frameHeight: rect.height, bodyTop: body.top, stripBottom: strip === null ? null : strip.bottom, shrinking: frameEl.hasAttribute("inert"), bottomGapHit});
                }
                if (frame > 2 && document.querySelector("[data-workbench-surface] [data-moving]") === null) break;
            }
            return rows;
        }, target);
        const inset = await page.evaluate((target) => {
            const frame = document.querySelector(`[data-workbench-surface] > [data-grid-scope] > [data-leaf="${target.leaf}"]`)!.getBoundingClientRect();
            return document.querySelector(`[data-workbench-surface] > [data-grid-scope] > [data-content="${CSS.escape(target.content)}"]`)!.getBoundingClientRect().top - frame.top;
        }, target);
        // 底部面板这个容器只有一节：它的头并在卡片顶上的入口条里（ui/workbench-layout 输出 47），叶里没有头，内容贴着外框的上边。
        expect(inset).toBe(0);
        /**
         * 下边不动；内容体的上边一直是外框的上边（按内容自己的矩形过渡时会落后）；头所在的入口条叶跟着一起走，它的下边就是这一节外框的上边，内容不压住它。
         */
        const expectSliding = (rows: Awaited<ReturnType<typeof film>>) => {
            const bottom = rows[0]!.frameBottom;
            for (const row of rows) {
                expect(row.frameBottom).toBeCloseTo(bottom, 0);
                expect(row.bodyTop - row.frameTop).toBeCloseTo(inset, 0);
                expect(row.stripBottom).not.toBeNull();
                expect(Math.abs(row.stripBottom! - row.frameTop)).toBeLessThanOrEqual(1);
            }
        };

        // 隐藏：缩下去的每一帧不可交互、还画着，确实量到了中间的帧；结束后高度为零。
        const hiding = await film();
        expect(hiding.some((row) => row.shrinking && row.frameHeight > 20 && row.frameHeight < hiding[0]!.frameHeight - 20)).toBe(true);
        expectSliding(hiding);
        await expect(moving).toHaveCount(0);
        await shrunk(page, target.leaf);

        // 显示：从底边长上来。下边的缝一直在。
        const showing = await film();
        const final = showing.at(-1)!.frameHeight;
        expect(showing.some((row) => row.frameHeight > 20 && row.frameHeight < final - 20)).toBe(true);
        expectSliding(showing);
        for (const row of showing.filter((row) => row.frameHeight > 20 && row.frameHeight < final - 1)) expect(row.bottomGapHit).toBe(false);
    });

    test("隐藏侧栏时缩回去的那段：焦点在侧栏里马上交出去；缩到一半又显示、长到一半又隐藏都停在对的样子，不留残影；减少动态效果时同一帧就没了（ui/nested-grid 输出 47、48、59）", async ({page}) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page);
        const explorer = await sectionOf(page, EXPLORER);
        const run = (command: string, args: Record<string, unknown>) => page.evaluate(({name, detail}) => window.dispatchEvent(new CustomEvent(name, {detail})), {name: SAMPLE_VIEWS_RUN_EVENT, detail: {command, args}});
        // 隐藏按拖到零画：缩回去的那段外框不可交互、还画着。
        const shrinking = page.locator(`${LEAF}[data-leaf="${explorer}"][inert]`);
        const settled = async () => {
            await expect(page.locator("[data-workbench-surface] [data-moving]")).toHaveCount(0);
            await expect(shrinking).toHaveCount(0);
        };

        // 焦点在资源管理器里，用命令隐藏侧栏：缩回去的这段它不可交互，焦点马上交出去，不留在里面。
        await content(page, EXPLORER).locator("[role=\"treeitem\"]").first().click();
        await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[data-content=\"view:nbook.explorer\"]") != null)).toBe(true);
        await run("nbook.view.set-part-hidden", {part: "sidebar", hidden: true});
        await expect(shrinking).toBeAttached();
        expect(await page.evaluate(() => document.activeElement?.closest("[data-content=\"view:nbook.explorer\"]") ?? null)).toBeNull();
        await settled();
        await shrunk(page, explorer);

        // 长到一半又隐藏：停在隐藏，缩到零。
        await run("nbook.view.set-part-hidden", {part: "sidebar", hidden: false});
        await expect.poll(async () => (await leaf(page, explorer).boundingBox())?.width ?? 0).toBeGreaterThan(0);
        await run("nbook.view.set-part-hidden", {part: "sidebar", hidden: true});
        await settled();
        await shrunk(page, explorer);

        // 缩到一半又显示：停在显示，宽度回到原样，内容看得见。
        await run("nbook.view.set-part-hidden", {part: "sidebar", hidden: false});
        await settled();
        const width = (await box(page, explorer)).width;
        await run("nbook.view.set-part-hidden", {part: "sidebar", hidden: true});
        await expect(shrinking).toBeAttached();
        await run("nbook.view.set-part-hidden", {part: "sidebar", hidden: false});
        await settled();
        expect((await box(page, explorer)).width).toBeCloseTo(width, 0);
        await expect(content(page, EXPLORER)).toBeVisible();

        // 缩到一半又有别的布局变化（显示底部面板）：侧栏接着缩完，不是当场没了。
        await run("nbook.view.set-part-hidden", {part: "panel", hidden: true});
        await settled();
        const during = await page.evaluate(async ({name, leafId}) => {
            const fire = (part: string, hidden: boolean) => window.dispatchEvent(new CustomEvent(name, {detail: {command: "nbook.view.set-part-hidden", args: {part, hidden}}}));
            const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const shrinking = () => document.querySelector(`[data-workbench-surface] > [data-grid-scope] > [data-leaf="${leafId}"][inert]`) !== null;
            fire("sidebar", true);
            await frames();
            const before = shrinking();
            fire("panel", false);
            await frames();
            return {before, after: shrinking()};
        }, {name: SAMPLE_VIEWS_RUN_EVENT, leafId: explorer});
        expect(during).toEqual({before: true, after: true});
        await settled();
        await shrunk(page, explorer);
        await run("nbook.view.set-part-hidden", {part: "sidebar", hidden: false});
        await settled();

        // 减少动态效果：没有过渡，隐藏那一帧就是零宽，也不留着画。
        await page.emulateMedia({reducedMotion: "reduce"});
        const after = await page.evaluate(async ({name, leafId}) => {
            window.dispatchEvent(new CustomEvent(name, {detail: {command: "nbook.view.set-part-hidden", args: {part: "sidebar", hidden: true}}}));
            await new Promise((resolve) => requestAnimationFrame(resolve));
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const frameEl = document.querySelector(`[data-workbench-surface] > [data-grid-scope] > [data-leaf="${leafId}"]`);
            return {width: frameEl?.getBoundingClientRect().width ?? 0, shrinking: frameEl?.hasAttribute("inert") === true};
        }, {name: SAMPLE_VIEWS_RUN_EVENT, leafId: explorer});
        expect(after).toEqual({width: 0, shrinking: false});
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
        await pressEntry(page, entry(page, PROJECT_CONTAINER));
        await expect.poll(widths).toEqual([width, width]);
        await expect.poll(heights).toEqual(expanded);
        await expect(entry(page, PROJECT_CONTAINER)).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => (await saved(page))?.panels.sidebar?.collapsed ?? false).toBe(false);

        // 只有一个分节的容器是当前容器：拖到零记在区域上，不是把这个分节收成标题行。
        await pressEntry(page, entry(page, `view:${A}`));
        await expect(sample(page, A)).toBeVisible();
        const single = await sectionOf(page, A);
        await sidebarSash(page).focus();
        await page.keyboard.press("Enter");
        await expect.poll(async () => (await box(page, single)).width).toBe(0);
        await expect.poll(async () => (await saved(page))?.panels.sidebar?.collapsed).toBe(true);
        // 点另一个入口：切过去并展开。
        await pressEntry(page, entry(page, PROJECT_CONTAINER));
        await expect.poll(widths).toEqual([width, width]);
        await expect(tab(page, SESSIONS)).toBeVisible();
        // 再点回来：侧栏是展开的，这个分节也没有收成标题行。
        await pressEntry(page, entry(page, `view:${A}`));
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
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views,test.project-view", NBOOK_EXCLUDE_PLUGINS: "nbook.editor,nbook.canon,nbook.plot"}});
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
    const entryIds = (page: Page): Promise<string[]> => page.locator('[data-rail="sidebar"] [data-tool-band] [data-tool-entry]').evaluateAll((elements) => elements.map((element) => {
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
        const placed = page.locator(`[data-rail="sidebar"] [data-tool-band] [data-tool-view="${EXPLORER}"]`);
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

    /** 右轨入口带上的入口，从上到下；用户容器的 id 是随机的，写成 `custom`。 */
    const stripIds = (page: Page): Promise<string[]> => page.locator('[data-rail="auxiliarybar"] [data-tool-band] [data-tool-entry]').evaluateAll((elements) => elements.map((element) => {
        const id = element.getAttribute("data-tool-entry") ?? "";
        return id.startsWith("custom:") ? "custom" : id;
    }));
    const stripEntry = (page: Page, container: string) => page.locator(`[data-rail="auxiliarybar"] [data-tool-band] [data-tool-entry="${container}"]`);
    const barEntry = (page: Page, container: string) => page.locator(`[data-rail="sidebar"] [data-tool-band] [data-tool-entry="${container}"]`);

    // 覆盖 ui/workbench-layout 输出 50（别的面板最大化时右轨不被盖住）、13：有面板最大化时右轨还在原处，入口带仍是落点。
    test("有面板最大化时，右轨不被盖住：指针落在右轨入口之间，落点还是入口带上的新建容器（ui/workbench-layout 输出 13、50）", async ({page}) => {
        await open(page);
        const railBox = (await page.locator('[data-shell-card="rail:auxiliarybar"]').boundingBox())!;
        // 最大化资源管理器那一节，再拖它自己的标题：最大化时是落点指示。
        await page.locator(`[data-panel-head="${await sectionOf(page, EXPLORER)}"] [data-panel-action="nbook.view.toggle-panel-maximized"]`).click();
        await expect(page.locator("[data-workbench-surface] [data-moving]")).toHaveCount(0);
        // 右栏被最大化盖住时右轨与右栏卡片不再相连，卡片窄 2 像素（少一半的相连缝）：右缘、顶与高度不动，入口带照旧。
        const maximizedRail = (await page.locator('[data-shell-card="rail:auxiliarybar"]').boundingBox())!;
        expect([maximizedRail.x + maximizedRail.width, maximizedRail.y, maximizedRail.height]).toEqual([railBox.x + railBox.width, railBox.y, railBox.height]);
        const [first, second] = [(await stripEntry(page, (await stripIds(page))[0]!).boundingBox())!, (await page.locator('[data-rail="auxiliarybar"] [data-tool-band] [data-tool-entry]').nth(1).boundingBox())!];
        const from = await centerOf(tab(page, EXPLORER));
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + 10, from.y + 10, {steps: 2});
        await page.mouse.move(first.x + first.width / 2, (first.y + first.height + second.y) / 2, {steps: 10});
        await expect(page.locator("[data-drop-feedback]")).toHaveAttribute("data-drop-kind", "new-container");
        await page.keyboard.press("Escape");
        await page.mouse.up();
    });

    test("右轨的入口带上：拖到两个入口之间，入口让开，右栏还是原来的容器、零写入；放下右栏多一个只含它的入口并切到它（输出 45、50）", async ({page}) => {
        await open(page);
        const before = await stripIds(page);
        expect(before).toHaveLength(2);
        const writes = await writesOf(page);
        const [first, second] = [(await stripEntry(page, before[0]!).boundingBox())!, (await stripEntry(page, before[1]!).boundingBox())!];
        const gap = {x: first.x + first.width / 2, y: (first.y + first.height + second.y) / 2};
        await lift(page, tab(page, EXPLORER));
        await page.mouse.move(gap.x, gap.y, {steps: 8});
        // 预览：被拖的视图在空位上显示成一个入口，别的入口让开；右栏显示的还是原来的容器。
        const placed = page.locator(`[data-rail="auxiliarybar"] [data-tool-band] [data-tool-view="${EXPLORER}"]`);
        await expect(placed).toHaveCount(1);
        await expect.poll(() => stripIds(page)).toEqual([before[0], "custom", before[1]]);
        await expect(stripEntry(page, before[0]!)).toHaveAttribute("aria-pressed", "true");
        expect(await writesOf(page)).toBe(writes);

        await page.mouse.up();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
        await expect.poll(() => stripIds(page)).toEqual([before[0], "custom", before[1]]);
        await expect(placed).toHaveAttribute("aria-pressed", "true");
        await expect(content(page, EXPLORER)).toBeVisible();
        expect((await saved(page))?.panels.auxiliarybar?.activeContainer).toMatch(/^custom:/u);
    });

    test("右轨入口带上只含一个视图的入口拖到活动栏两个入口之间：它的容器整个搬到侧栏、id 不变；预览里入口让开、侧栏不切，放下侧栏切到它（输出 46）", async ({page}) => {
        await open(page);
        const delta = `view:${D}`;
        await expect(stripEntry(page, delta)).toHaveCount(1);
        const before = await entryIds(page);
        const writes = await writesOf(page);
        const gap = await between(page, `view:${A}`, `view:${B}`);
        await lift(page, stripEntry(page, delta));
        await page.mouse.move(gap.x, gap.y, {steps: 8});
        await expect.poll(() => entryIds(page)).toEqual([PROJECT_CONTAINER, `view:${A}`, delta, ...before.slice(2)]);
        await expect(stripEntry(page, delta)).toHaveCount(0);
        await expect(barEntry(page, PROJECT_CONTAINER)).toHaveAttribute("aria-pressed", "true");
        expect(await writesOf(page)).toBe(writes);

        await page.mouse.up();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
        await expect(barEntry(page, delta)).toHaveAttribute("aria-pressed", "true");
        await expect(sample(page, D)).toBeVisible();
        const record = (await saved(page))!;
        expect(record.panels.sidebar?.activeContainer).toBe(delta);
        expect(record.panels[await sectionOf(page, D)]?.container).toBe(delta);
    });

    test("拖含几个视图的入口到右轨的入口带上：整个容器搬过去（落点指示），右栏切到它、两节都带着，活动栏少一个入口（输出 46）", async ({page}) => {
        await open(page);
        const writes = await writesOf(page);
        const last = (await page.locator('[data-rail="auxiliarybar"] [data-tool-band] [data-tool-entry]').last().boundingBox())!;
        const target = {x: last.x + last.width / 2, y: last.y + last.height * 0.8};
        // 含几个视图的入口不走实时布局（输出 46）：按下、过门槛就是落点指示。
        const from = await centerOf(barEntry(page, PROJECT_CONTAINER));
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + 10, from.y + 10, {steps: 2});
        await page.mouse.move(target.x, target.y, {steps: 10});
        await expect(page.locator("[data-drop-feedback]")).toHaveAttribute("data-drop-kind", "move-container");
        expect(await writesOf(page)).toBe(writes);
        await page.mouse.up();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
        await expect(stripEntry(page, PROJECT_CONTAINER)).toHaveAttribute("aria-pressed", "true");
        await expect(barEntry(page, PROJECT_CONTAINER)).toHaveCount(0);
        // 两节都在右栏这一列：过渡走完，外框的右缘就是右轨卡片的左缘（相连，不留缝）。
        await expect(page.locator("[data-workbench-surface] [data-moving]")).toHaveCount(0);
        const railLeft = (await page.locator('[data-shell-card="rail:auxiliarybar"]').boundingBox())!.x;
        for (const view of [EXPLORER, SESSIONS]) {
            const section = await box(page, await sectionOf(page, view));
            expect(Math.abs(section.x + section.width - railLeft)).toBeLessThanOrEqual(1);
        }
    });

    test("右轨入口带里换序：拖样例丁的入口到第一个入口前面，只改入口顺序，右栏的显隐与当前容器不变（输出 45、50）", async ({page}) => {
        await open(page);
        const before = await stripIds(page);
        const delta = `view:${D}`;
        expect(before).toEqual([before[0], delta]);
        const writes = await writesOf(page);
        const first = (await stripEntry(page, before[0]!).boundingBox())!;
        await lift(page, stripEntry(page, delta));
        await page.mouse.move(first.x + first.width / 2, first.y + 2, {steps: 10});
        // 来源是右栏里一个容器唯一的视图：这条入口带是它自己的，在里面跟手、不收起来源。
        await expect.poll(() => stripIds(page)).toEqual([delta, before[0]]);
        expect(await writesOf(page)).toBe(writes);
        await page.mouse.up();
        await expect.poll(() => writesOf(page)).toBe(writes + 1);
        await expect.poll(() => stripIds(page)).toEqual([delta, before[0]]);
        await expect(stripEntry(page, before[0]!)).toHaveAttribute("aria-pressed", "true");
    });

    // 覆盖 ui/workbench-layout 输出 38、50：右栏当前容器唯一的那一节拖走、来源收起之后，右栏还有别的成员容器，右轨一直在；Escape 原样、零写入。
    test("右栏当前容器唯一的那一节拖走、来源收起之后：右栏还有别的容器，右轨一直在；Escape 原样（输出 38、50）", async ({page}) => {
        await open(page);
        await stripEntry(page, `view:${D}`).click();
        // 切换写一次：等它落盘再数，不然这次写入会算进拖动里。
        await expect.poll(async () => (await saved(page))?.panels.auxiliarybar?.activeContainer).toBe(`view:${D}`);
        // 切换时内容竖着滚（输出 42）：滚完再拿标签，不然量到的位置在按下时已经变了。
        await expect(page.locator("[data-workbench-surface] [data-swap]")).toHaveCount(0);
        const writes = await writesOf(page);
        const title = page.locator(`[data-panel-head="${await sectionOf(page, D)}"] [data-panel-tab="view:${D}"]`);
        await lift(page, title);
        // 放到资源管理器的下半：来源收起，右栏当前的容器在预览里空了。
        const explorer = await box(page, await sectionOf(page, EXPLORER));
        await page.mouse.move(explorer.x + explorer.width / 2, explorer.y + explorer.height * 0.8, {steps: 10});
        await expect(surface(page)).toHaveAttribute("data-live-preview", /edge/u);
        await expect(page.locator('[data-rail="auxiliarybar"]')).toHaveCount(1);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(page.locator('[data-rail="auxiliarybar"]')).toHaveCount(1);
        await expect.poll(() => stripIds(page)).toHaveLength(2);
        await expect(stripEntry(page, `view:${D}`)).toHaveAttribute("aria-pressed", "true");
        expect(await writesOf(page)).toBe(writes);
    });

    test("当前容器只有一个视图、把它拖向右栏：预览里侧栏是空的、没有切到别的容器，活动栏仍接得住；Escape 原样、零写入；放下侧栏切到入口顺序上相邻的容器（验收 29；输出 38、43）", async ({page}) => {
        await open(page);
        await pressEntry(page, entry(page, `view:${A}`));
        await expect(sample(page, A)).toBeVisible();
        // 切换时整张卡片滚进来（输出 42）：滚完再拿标签，不然量到的位置在按下时已经变了。
        await expect(page.locator("[data-workbench-surface] [data-moving]")).toHaveCount(0);
        await expect.poll(async () => (await saved(page))?.panels.sidebar?.activeContainer).toBe(`view:${A}`);
        // 右栏落点：消息的容器不收别的视图（views 输出 22），落到样例丁那一节。先切到它，等切换的滚动走完、写入落盘再数写入。
        await pressEntry(page, stripEntry(page, `view:${D}`));
        await expect(page.locator("[data-workbench-surface] [data-moving]")).toHaveCount(0);
        await expect.poll(async () => (await saved(page))?.panels.auxiliarybar?.activeContainer).toBe(`view:${D}`);
        const writes = await writesOf(page);
        const right = await box(page, await sectionOf(page, D));
        const below = {x: right.x + right.width / 2, y: right.y + right.height * 0.8};

        await lift(page, tab(page, A));
        await page.mouse.move(below.x, below.y, {steps: 8});
        await expect(surface(page)).not.toHaveAttribute("data-live-preview", "none");
        // 侧栏空着：样例甲拿走了，也没有换成“项目”或样例乙。
        await expect(page.locator('[data-rail="sidebar"] [data-tool-band] [data-tool-entry][aria-pressed="true"]')).toHaveCount(0);
        await expect(tab(page, SESSIONS)).toHaveCount(0);
        await expect(tab(page, B)).toHaveCount(0);
        // 来源收起之后活动栏照样是落点（输出 38：判定按收起后的布局）：回到两个入口之间，空位里出现它的入口。
        // 这是它自己原来的空位，放回原处（输出 28、45）：预览是已提交的样子，入口按下、侧栏又是它。
        const gap = await between(page, PROJECT_CONTAINER, `view:${B}`);
        await page.mouse.move(gap.x, gap.y, {steps: 6});
        await expect(page.locator(`[data-rail="sidebar"] [data-tool-band] [data-tool-view="${A}"]`)).toHaveCount(1);
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
        // 右栏落点：消息的容器不收别的视图（views 输出 22），落到样例丁那一节。先切到它，等切换的滚动走完、写入落盘再数写入。
        await pressEntry(page, stripEntry(page, `view:${D}`));
        await expect(page.locator("[data-workbench-surface] [data-moving]")).toHaveCount(0);
        await expect.poll(async () => (await saved(page))?.panels.auxiliarybar?.activeContainer).toBe(`view:${D}`);
        const writes = await writesOf(page);
        const right = await box(page, await sectionOf(page, D));
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
        server = await startProbeServer(stateRoot, {env: {NBOOK_TEST_PLUGINS: "test.project-view"}});
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
        const conversation = await sectionOf(page, CONVERSATION);
        await page.locator('[data-titlebar-layout="auxiliarybar"]').click();
        await shrunk(page, conversation);
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
        await shrunk(page, conversation);
        await expect(labels(page)).toHaveText(["a.md", "b.md"]);
        expect(await diagnostics(page)).not.toContain("布局记录不合骨架");
    });
});
