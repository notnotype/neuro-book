/**
 * 侧轨 e2e 的公用辅助（docs/specs/ui/workbench-layout.md 输出 50）：只按元素标记约定定位，不读业务代码。标记约定见
 * `.agents/works/w00043-neurobot/tasks/t19-messages-view-ui-polish/plan.md` 的“测试分工”。右轨的元素只在右栏有成员容器时存在。
 *
 * 数据库路径由调用方给：每个用例文件自己起后端、自己有状态根。
 */

import {DatabaseSync} from "node:sqlite";

import {expect} from "@playwright/test";
import type {Locator, Page} from "@playwright/test";
import type {LayoutDoc} from "@notnotype/nb-workbench-layout";

import {CLIENT_IDENTITY_KEY} from "nbook/web/host/client-identity";

export interface Point {
    readonly x: number;
    readonly y: number;
}

/** 树里的叶外框：限定到外壳栅格的直接子级，编辑区自己的栅格里有同名的叶。 */
export const LEAF = "[data-workbench-surface] > [data-grid-scope] > [data-leaf]";
export const leaf = (page: Page, id: string): Locator => page.locator(`${LEAF}[data-leaf="${id}"]`);

export type RailRegion = "sidebar" | "auxiliarybar";

/** 侧轨的根。右轨不在时没有这个元素。 */
export const rail = (page: Page, region: RailRegion = "auxiliarybar"): Locator => page.locator(`[data-rail="${region}"]`);
/** 侧轨自己那张卡片：叶 id 是 `rail:<区域>`（输出 50），卡片按叶 id 标记，同现有的 `strip:auxiliarybar`。 */
export const railCard = (page: Page, region: RailRegion = "auxiliarybar"): Locator => page.locator(`[data-shell-card="rail:${region}"]`);
/** 入口带里的入口（唯一的落点带）。 */
export const railEntries = (page: Page, region: RailRegion = "auxiliarybar"): Locator => rail(page, region).locator("[data-tool-band] [data-tool-entry]");
export const railEntry = (page: Page, container: string, region: RailRegion = "auxiliarybar"): Locator => rail(page, region).locator(`[data-tool-band] [data-tool-entry="${container}"]`);
/** 只含这个视图的容器的入口（入口带上写着它那个视图的 id）。 */
export const railEntryOfView = (page: Page, viewId: string, region: RailRegion = "auxiliarybar"): Locator => rail(page, region).locator(`[data-tool-band] [data-tool-view="${viewId}"]`);
export const railSegment = (page: Page, segment: "main" | "foot", region: RailRegion = "auxiliarybar"): Locator => rail(page, region).locator(`[data-rail-segment="${segment}"]`);

/** 入口带上的入口，从上到下；用户容器的 id 是随机的，写成 `custom`。 */
export const railEntryIds = (page: Page, region: RailRegion = "auxiliarybar"): Promise<string[]> => railEntries(page, region).evaluateAll((elements) => elements.map((element) => {
    const id = element.getAttribute("data-tool-entry") ?? "";
    return id.startsWith("custom:") ? "custom" : id;
}));

/** 活动栏上段的入口：左轨的入口带（输出 22）。 */
export const barEntry = (page: Page, container: string): Locator => page.locator(`[data-rail="sidebar"] [data-tool-band] [data-tool-entry="${container}"]`);

export async function boxOf(locator: Locator): Promise<{x: number; y: number; width: number; height: number}> {
    const found = await locator.boundingBox();
    if (found === null) throw new Error("元素没有盒子");
    return found;
}

export async function centerOf(locator: Locator): Promise<Point> {
    const found = await boxOf(locator);
    return {x: found.x + found.width / 2, y: found.y + found.height / 2};
}

/** 卡片四个角的圆角半径（像素）。 */
export async function cornerRadii(card: Locator): Promise<{topLeft: number; topRight: number; bottomRight: number; bottomLeft: number}> {
    return card.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            topLeft: Number.parseFloat(style.borderTopLeftRadius),
            topRight: Number.parseFloat(style.borderTopRightRadius),
            bottomRight: Number.parseFloat(style.borderBottomRightRadius),
            bottomLeft: Number.parseFloat(style.borderBottomLeftRadius),
        };
    });
}

/** 两个入口之间的空位中点（纵轴上量，输出 45）。 */
export async function gapBetween(upper: Locator, lower: Locator): Promise<Point> {
    const [top, bottom] = [await boxOf(upper), await boxOf(lower)];
    return {x: top.x + top.width / 2, y: (top.y + top.height + bottom.y) / 2};
}

/** 面板外框里的一点：横向、纵向各按比例。 */
export async function inLeaf(page: Page, panel: string, fraction: Point): Promise<Point> {
    const found = await boxOf(leaf(page, panel));
    return {x: found.x + found.width * fraction.x, y: found.y + found.height * fraction.y};
}

/** 视图所在分节的面板 id：内容项上写着它所在的叶。 */
export async function sectionOf(page: Page, viewId: string): Promise<string> {
    const id = await page.locator(`[data-content="view:${viewId}"]`).getAttribute("data-content-leaf");
    if (id === null) throw new Error(`${viewId} 不在任何面板里`);
    return id;
}

/** 本页客户端存下的 `workbench.layout` 文档；还没写过为 null。 */
export async function savedDoc(page: Page, database: string): Promise<LayoutDoc | null> {
    const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
    if (client === null) throw new Error("页面还没有客户端身份");
    const db = new DatabaseSync(database);
    try {
        const row = db.prepare("SELECT value FROM records WHERE owner = 'nbook.workbench' AND key = 'workbench.layout' AND client = ?1").get(client) as {value: string} | undefined;
        return row === undefined ? null : (JSON.parse(row.value) as {doc: LayoutDoc}).doc;
    } finally {
        db.close();
    }
}

/** 本页客户端对 `workbench.layout` 的写入次数：在测试库上装审计触发器，第一次取基线时装上，所以基线要在手势之前取。 */
export async function layoutWrites(page: Page, database: string): Promise<number> {
    const client = await page.evaluate((key) => localStorage.getItem(key), CLIENT_IDENTITY_KEY);
    const db = new DatabaseSync(database);
    try {
        db.exec("CREATE TABLE IF NOT EXISTS layout_writes (client TEXT)");
        db.exec("CREATE TRIGGER IF NOT EXISTS count_layout_insert AFTER INSERT ON records WHEN NEW.owner = 'nbook.workbench' AND NEW.key = 'workbench.layout' BEGIN INSERT INTO layout_writes VALUES (NEW.client); END");
        db.exec("CREATE TRIGGER IF NOT EXISTS count_layout_update AFTER UPDATE ON records WHEN NEW.owner = 'nbook.workbench' AND NEW.key = 'workbench.layout' BEGIN INSERT INTO layout_writes VALUES (NEW.client); END");
        return (db.prepare("SELECT count(*) AS n FROM layout_writes WHERE client = ?1").get(client) as {n: number}).n;
    } finally {
        db.close();
    }
}

/**
 * 搭场景的操作落库之后的写入次数：写入合并在一小段时间里落库，隔一段比合并窗口长的时间读到同一个数，才算搭场景的写入都落完了，
 * 之后的手势从这个数起算。
 */
export async function settledWrites(page: Page, database: string): Promise<number> {
    let seen = -1;
    await expect.poll(async () => {
        const now = await layoutWrites(page, database);
        const quiet = now === seen;
        seen = now;
        return quiet;
    }, {intervals: [400]}).toBe(true);
    return seen;
}

export const ghost = (page: Page): Locator => page.locator("[data-workbench-drag-ghost]");
/** 落点指示：拖动中指针下有落点时存在，写着动作种类（`data-drop-kind`）。 */
export const dropFeedback = (page: Page): Locator => page.locator("[data-drop-kind]");

/** 按下源、移过门槛：拖动进行中，由调用方决定移到哪、松手还是取消。 */
export async function pickUp(page: Page, source: Locator): Promise<void> {
    const from = await centerOf(source);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y + 10, {steps: 2});
    await expect(ghost(page)).toBeVisible();
}

/**
 * 实时布局的拿起：减少动效时拖动一律落点指示，调用方先 `emulateMedia({reducedMotion: "no-preference"})`。实时布局没有拖影，
 * 落点的高亮画在入口上（`data-tool-merge`），所以等的是 `data-drag-feel=live`。
 */
export async function pickUpLive(page: Page, source: Locator): Promise<void> {
    const from = await centerOf(source);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y + 10, {steps: 2});
    await expect(page.locator("[data-workbench-surface]")).toHaveAttribute("data-drag-feel", "live");
}

export async function moveTo(page: Page, to: Point): Promise<void> {
    await page.mouse.move(to.x, to.y, {steps: 8});
}

export async function release(page: Page): Promise<void> {
    await page.mouse.up();
    await expect(ghost(page)).toHaveCount(0);
}

/** 取消这一场：Escape 之后再松手，松手不落到任何东西上。 */
export async function cancelDrag(page: Page): Promise<void> {
    await page.keyboard.press("Escape");
    await release(page);
}

/** 落点是下一帧才画出来的：等两帧再断言没有，免得断言在落点出现之前通过。 */
export async function expectNoFeedback(page: Page, where?: string): Promise<void> {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(dropFeedback(page), where).toHaveCount(0);
}

/** 一次完整的拖放：按下、移到 `to`、松手。 */
export async function dropAt(page: Page, source: Locator, to: Point): Promise<void> {
    await pickUp(page, source);
    await moveTo(page, to);
    await release(page);
}

/** 不在任何面板上的地方：标题栏。松手没有落点的视图浮动打开。 */
export const offPanels = (page: Page): Promise<Point> => centerOf(page.locator("[data-shell-titlebar]"));

/**
 * 当前焦点所在的“站”：侧轨写 `rail:<区域>`，别的写所在面板或叶的 id。F6 与读屏顺序按它比较（输出 18、50）。
 */
export const focusStop = (page: Page): Promise<string | null> => page.evaluate(() => {
    const owner = document.activeElement?.closest<HTMLElement>("[data-rail], [data-content-leaf], [data-leaf]") ?? null;
    if (owner === null) return null;
    if (owner.dataset.rail !== undefined) return `rail:${owner.dataset.rail}`;
    return owner.dataset.contentLeaf ?? owner.dataset.leaf ?? null;
});
