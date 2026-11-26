/**
 * 标签编组示例（`examples/tabbed-panels`）在真实浏览器里的行为。每个用例从空存档开始：缺省布局是侧栏加三个编组，
 * group-1 有 README.md、main.ts、App.vue、model.ts，group-2 有 notes.txt、todo.txt，group-3 有 styles.css、index.html。
 */

import {expect, test, type Page} from "@playwright/test";

import {boxOf, centerOf, dragTo, moveTo, pickUp, settled, twoFrames, type Point} from "./drag";
import {serveExample} from "./serve";

const KEY = "nb-layout-example:tabbed-panels";
const BACKUP = `${KEY}:backup`;

let server: Awaited<ReturnType<typeof serveExample>>;
test.beforeAll(async () => {
    server = await serveExample("tabbed-panels");
});
test.afterEach(() => {
    expect(pageErrors).toEqual([]);
});
test.afterAll(async () => {
    await server.close();
});
/** 页面里的脚本错误与控制台报错：每个用例结束时都要是空的。 */
let pageErrors: string[] = [];
test.beforeEach(async ({page}) => {
    pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") pageErrors.push(message.text());
    });
    await page.goto(server.url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator("[data-leaf='group-3']")).toBeVisible();
});

const strip = (page: Page, group: string) => page.locator(`[data-tab-strip][data-group="${group}"]`);
const tab = (page: Page, group: string, name: string) => strip(page, group).locator(`[data-tab="${name}"]`);
const tabButton = (page: Page, group: string, name: string) => tab(page, group, name).getByRole("tab");
const frame = (page: Page, id: string) => page.locator(`[data-leaf="${id}"]`);

async function tabsOf(page: Page, group: string): Promise<string[]> {
    return strip(page, group).locator("[data-tab]").evaluateAll((elements) => elements.map((element) => (element as HTMLElement).dataset.tab!));
}

async function expectTabs(page: Page, group: string, tabs: string[], active?: string): Promise<void> {
    await expect.poll(() => tabsOf(page, group)).toEqual(tabs);
    if (active !== undefined) await expect(tabButton(page, group, active)).toHaveAttribute("aria-selected", "true");
}

/** 编组正文（叶外框去掉 32 像素高的标签条）上的点：中央，或离某条边 8 像素。 */
async function bodyPoint(page: Page, group: string, where: "center" | "left" | "right" | "top" | "bottom"): Promise<Point> {
    const box = await boxOf(frame(page, group));
    const top = box.y + 32;
    const midX = box.x + box.width / 2;
    const midY = (top + box.y + box.height) / 2;
    if (where === "left") return {x: box.x + 8, y: midY};
    if (where === "right") return {x: box.x + box.width - 8, y: midY};
    if (where === "top") return {x: midX, y: top + 8};
    if (where === "bottom") return {x: midX, y: box.y + box.height - 8};
    return {x: midX, y: midY};
}

/** 插到标签 `before` 前面的点：它的左缘往里 3 像素（插入位按标签中线判，过了中线就是它后面）。 */
async function beforeTab(page: Page, group: string, before: string): Promise<Point> {
    const box = await boxOf(tab(page, group, before));
    return {x: box.x + 3, y: box.y + box.height / 2};
}

async function groupIds(page: Page): Promise<string[]> {
    return page.locator("[data-tab-strip]").evaluateAll((elements) => elements.map((element) => (element as HTMLElement).dataset.group!).sort());
}

/** 先挪 `group-3` 的 styles.css 进 group-2，group-3 只剩 index.html 一个标签。 */
async function makeSingleTabGroup(page: Page): Promise<void> {
    await dragTo(page, tab(page, "group-3", "styles.css"), await bodyPoint(page, "group-2", "center"), "into:group-2");
    await expectTabs(page, "group-3", ["index.html"]);
}

test("缺省布局：侧栏加三个编组，点标签切换正文，方向键在标签之间走", async ({page}) => {
    await expect(frame(page, "explorer")).toBeVisible();
    await expectTabs(page, "group-1", ["README.md", "main.ts", "App.vue", "model.ts"], "README.md");
    await expectTabs(page, "group-2", ["notes.txt", "todo.txt"], "notes.txt");
    await expectTabs(page, "group-3", ["styles.css", "index.html"], "styles.css");
    await tabButton(page, "group-1", "main.ts").click();
    await expect(tabButton(page, "group-1", "main.ts")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[id='panel-main.ts']")).toBeVisible();
    await expect(page.locator("[id='panel-README.md']")).toBeHidden();
    await page.keyboard.press("ArrowRight");
    await expect(tabButton(page, "group-1", "App.vue")).toBeFocused();
    await expect(tabButton(page, "group-1", "App.vue")).toHaveAttribute("aria-selected", "true");
});

test("把标签拖进别的编组的标签条：插在那里、成为选中，来源选右邻，打的字跟着走", async ({page}) => {
    await page.locator("[data-panel-text='README.md']").fill("kept while moving");
    await dragTo(page, tab(page, "group-1", "README.md"), await beforeTab(page, "group-2", "todo.txt"), "insert:group-2:todo.txt");
    await expectTabs(page, "group-2", ["notes.txt", "README.md", "todo.txt"], "README.md");
    await expectTabs(page, "group-1", ["main.ts", "App.vue", "model.ts"], "main.ts");
    await expect(page.locator("[data-panel-text='README.md']")).toHaveValue("kept while moving");
    // 按下标签时焦点在它的按钮上，挪过去之后焦点跟着它，不掉到 body。
    await expect(tabButton(page, "group-2", "README.md")).toBeFocused();
});

test("同一条标签条里换位置；拖回原位没有落点，松手不变", async ({page}) => {
    await dragTo(page, tab(page, "group-1", "main.ts"), await beforeTab(page, "group-1", "model.ts"), "insert:group-1:model.ts");
    await expectTabs(page, "group-1", ["README.md", "App.vue", "main.ts", "model.ts"]);
    // 先到一个真落点，再一步跳回自己左缘：插在自己前面就是原位。
    await pickUp(page, tab(page, "group-1", "main.ts"));
    await moveTo(page, await beforeTab(page, "group-1", "README.md"), "insert:group-1:README.md");
    await moveTo(page, await beforeTab(page, "group-1", "main.ts"), "none", 1);
    await page.mouse.up();
    await expectTabs(page, "group-1", ["README.md", "App.vue", "main.ts", "model.ts"]);
});

test("标签条放不下时横向滚动：滚到中间，拖过最后一个看得见的标签，放在第一个滚出去的前面，插入线也画在那里", async ({page}) => {
    // 窗口收窄，group-1 再收下另外两个编组各一个标签：六个标签放不下，滚到中间时后面还有滚出去的。
    await page.setViewportSize({width: 1000, height: 800});
    await settled(page);
    await dragTo(page, tab(page, "group-2", "notes.txt"), await bodyPoint(page, "group-1", "center"), "into:group-1");
    await dragTo(page, tab(page, "group-3", "styles.css"), await bodyPoint(page, "group-1", "center"), "into:group-1");
    await expectTabs(page, "group-1", ["README.md", "main.ts", "App.vue", "model.ts", "notes.txt", "styles.css"]);

    // 来源取别的编组的标签，先拿起来再量：按下时焦点进它的按钮，量目标用的 `boxOf` 也会把元素滚进视野，都会挪动 group-1 的标签条。
    await pickUp(page, tab(page, "group-3", "index.html"));
    // 滚到中间，再按此刻的矩形找最后一个看得见的标签和紧跟它的滚出去的标签：不写死名字，换了字体也成立。
    const layout = await strip(page, "group-1").evaluate((element) => {
        element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2;
        const view = element.getBoundingClientRect();
        const tabs = [...element.querySelectorAll<HTMLElement>("[data-tab]")].map((each) => ({id: each.dataset.tab!, rect: each.getBoundingClientRect()}));
        const lastVisible = tabs.findLastIndex((each) => each.rect.left < view.right && each.rect.right > view.left);
        return {overflows: element.scrollWidth > element.clientWidth, scrollLeft: element.scrollLeft, view: {right: view.right}, tabs, lastVisible};
    });
    expect(layout.overflows).toBe(true);
    expect(layout.scrollLeft).toBeGreaterThan(0);
    const last = layout.tabs[layout.lastVisible]!;
    const hidden = layout.tabs[layout.lastVisible + 1];
    // 紧跟着的整个在标签条右缘之外：这一条测的就是它。
    expect(hidden).toBeDefined();
    expect(hidden!.rect.left).toBeGreaterThanOrEqual(layout.view.right);

    // 指针在最后一个看得见的标签的可见部分的后半。
    const visibleRight = Math.min(last.rect.right, layout.view.right);
    await moveTo(page, {x: visibleRight - 3, y: (last.rect.top + last.rect.bottom) / 2}, `insert:group-1:${hidden!.id}`);
    // 线贴最后一个看得见的标签的后缘，挨着标签条右缘时夹在右缘之内（线宽 2）。
    const line = await page.locator("[data-drop-feedback-line]").boundingBox();
    expect(line).not.toBeNull();
    expect(Math.abs(line!.x - Math.min(visibleRight, layout.view.right - 2))).toBeLessThanOrEqual(1);
    await page.mouse.up();
    await expect(page.locator("[data-drop]")).toHaveCount(0);

    const order = layout.tabs.map((each) => each.id);
    order.splice(layout.lastVisible + 1, 0, "index.html");
    await expectTabs(page, "group-1", order, "index.html");
});

test("拖到编组正文中央：移进那个编组、排在最后、成为选中", async ({page}) => {
    await dragTo(page, tab(page, "group-2", "notes.txt"), await bodyPoint(page, "group-3", "center"), "into:group-3");
    await expectTabs(page, "group-3", ["styles.css", "index.html", "notes.txt"], "notes.txt");
    await expectTabs(page, "group-2", ["todo.txt"], "todo.txt");
});

test("拖到边缘拆分：右边拆出新编组、单标签的来源消失；拖到下边缘，下面拆出新编组", async ({page}) => {
    await makeSingleTabGroup(page);
    await dragTo(page, tab(page, "group-3", "index.html"), await bodyPoint(page, "group-2", "right"), "split:group-2:right");
    await expect(frame(page, "group-3")).toHaveCount(0);
    await expectTabs(page, "group-4", ["index.html"], "index.html");
    expect((await boxOf(frame(page, "group-4"))).x).toBeGreaterThan((await boxOf(frame(page, "group-2"))).x);

    await dragTo(page, tab(page, "group-1", "model.ts"), await bodyPoint(page, "group-2", "bottom"), "split:group-2:bottom");
    await expectTabs(page, "group-5", ["model.ts"]);
    const upper = await boxOf(frame(page, "group-2"));
    const lower = await boxOf(frame(page, "group-5"));
    expect(lower.y).toBeGreaterThan(upper.y);
    expect(Math.round(lower.x)).toBe(Math.round(upper.x));
});

test("一直往最右边拆，到放不下时落点写 Not enough room、松手不拆", async ({page}) => {
    let splits = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
        await settled(page);
        const groups = await groupIds(page);
        // 来源总取自还有两个以上标签的编组：拖走之后来源不消失，总宽不变。
        const counts = await Promise.all(groups.map(async (id) => [id, (await tabsOf(page, id)).length] as const));
        const source = counts.find(([, count]) => count >= 2)![0];
        const boxes = await Promise.all(groups.map(async (id) => [id, await boxOf(frame(page, id))] as const));
        const rightmost = boxes.reduce((best, each) => (each[1].x > best[1].x ? each : best))[0];
        const moving = (await tabsOf(page, source)).at(-1)!;
        await pickUp(page, tab(page, source, moving));
        await moveTo(page, await bodyPoint(page, rightmost, "right"), new RegExp(`^(split|blocked):${rightmost}:right$`));
        const blocked = (await page.locator("[data-drop]").getAttribute("data-drop"))!.startsWith("blocked");
        // 反馈的药丸上写着原因（另有一份给读屏的 live 区域，同样的字）。
        if (blocked) await expect(page.locator(".nb-layout-drop-indicator-label__text")).toHaveText("Not enough room");
        await page.mouse.up();
        if (blocked) {
            await twoFrames(page);
            expect(await groupIds(page)).toEqual(groups);
            break;
        }
        await expect.poll(async () => (await groupIds(page)).length).toBe(groups.length + 1);
        splits += 1;
    }
    expect(splits).toBeGreaterThanOrEqual(2);
    expect(splits).toBeLessThan(8);
});

test("不是落点的地方：单标签编组拖到自己的边、自己的正文、侧栏、分隔线，松手都不变", async ({page}) => {
    await makeSingleTabGroup(page);
    const sash = page.locator("[data-sash-kind], [role='separator']").filter({visible: true});
    const g2 = await boxOf(frame(page, "group-2"));
    const g3 = await boxOf(frame(page, "group-3"));
    const sashes = await sash.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON() as DOMRect));
    const between = sashes.find((rect) => rect.left >= g2.x + g2.width - 2 && rect.right <= g3.x + 2)!;
    const targets: Point[] = [
        await bodyPoint(page, "group-3", "right"),
        await bodyPoint(page, "group-3", "center"),
        await centerOf(frame(page, "explorer")),
        {x: between.left + between.width / 2, y: between.top + between.height / 2},
    ];
    for (const target of targets) {
        await pickUp(page, tab(page, "group-3", "index.html"));
        await moveTo(page, await bodyPoint(page, "group-2", "center"), "into:group-2");
        await moveTo(page, target, "none", 1);
        await page.mouse.up();
        await expectTabs(page, "group-3", ["index.html"]);
        await expectTabs(page, "group-2", ["notes.txt", "todo.txt", "styles.css"]);
    }
});

test("取消：等落点出现后按 Escape，反馈消失、松手不变；同一条路径不按 Escape 就移过去了", async ({page}) => {
    const target = await bodyPoint(page, "group-2", "center");
    await pickUp(page, tab(page, "group-1", "README.md"));
    await moveTo(page, target, "into:group-2");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-drop]")).toHaveCount(0);
    await page.mouse.up();
    await expectTabs(page, "group-1", ["README.md", "main.ts", "App.vue", "model.ts"]);

    await dragTo(page, tab(page, "group-1", "README.md"), target, "into:group-2");
    await expectTabs(page, "group-2", ["notes.txt", "todo.txt", "README.md"]);
});

test("在关闭按钮上按下拖动不起拖", async ({page}) => {
    await settled(page);
    const close = tab(page, "group-1", "main.ts").locator("[data-tab-close]");
    const from = await centerOf(close);
    const to = await bodyPoint(page, "group-2", "center");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, {steps: 8});
    await twoFrames(page);
    await expect(page.locator("[data-drop]")).toHaveCount(0);
    await page.mouse.up();
    await expectTabs(page, "group-1", ["README.md", "main.ts", "App.vue", "model.ts"]);
});

test("关闭标签：编组关空后消失、焦点落到前一个编组；Delete 也能关；最后一个标签关不掉", async ({page}) => {
    await tab(page, "group-2", "todo.txt").locator("[data-tab-close]").click();
    await expectTabs(page, "group-2", ["notes.txt"]);
    await tab(page, "group-2", "notes.txt").locator("[data-tab-close]").click();
    await expect(frame(page, "group-2")).toHaveCount(0);
    await expect(tabButton(page, "group-1", "README.md")).toBeFocused();

    await tabButton(page, "group-3", "styles.css").click();
    await page.keyboard.press("Delete");
    await expect(tabButton(page, "group-3", "index.html")).toBeFocused();
    await page.keyboard.press("Delete");
    await expect(frame(page, "group-3")).toHaveCount(0);
    await expect(tabButton(page, "group-1", "README.md")).toBeFocused();

    for (const next of ["main.ts", "App.vue", "model.ts"]) {
        await page.keyboard.press("Delete");
        await expect(tabButton(page, "group-1", next)).toBeFocused();
    }
    await expect(tab(page, "group-1", "model.ts").locator("[data-tab-close]")).toHaveCount(0);
    await page.keyboard.press("Delete");
    await expect(page.locator("[data-status]")).toHaveText("The last tab cannot be closed");
    await expectTabs(page, "group-1", ["model.ts"]);
});

test("存取：侧栏的宽度与收起、拆分都在重新载入后还原；载入之后还能再拆", async ({page}) => {
    const explorer = frame(page, "explorer");
    const sash = page.getByRole("separator").first();
    const at = await centerOf(sash);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 80, at.y, {steps: 8});
    await page.mouse.up();
    await expect.poll(async () => Math.round((await boxOf(explorer)).width)).toBe(320);
    await page.reload();
    await expect.poll(async () => Math.round((await boxOf(explorer)).width)).toBe(320);

    await page.getByRole("button", {name: "Hide explorer"}).click();
    await expect.poll(async () => Math.round((await explorer.boundingBox())?.width ?? 0)).toBe(0);
    await page.reload();
    await expect(page.getByRole("button", {name: "Show explorer"})).toBeVisible();
    await expect.poll(async () => Math.round((await explorer.boundingBox())?.width ?? 0)).toBe(0);
    await page.getByRole("button", {name: "Show explorer"}).click();
    await expect.poll(async () => Math.round((await boxOf(explorer)).width)).toBe(320);

    await dragTo(page, tab(page, "group-1", "model.ts"), await bodyPoint(page, "group-3", "right"), "split:group-3:right");
    await page.reload();
    await expectTabs(page, "group-4", ["model.ts"]);
    await dragTo(page, tab(page, "group-1", "App.vue"), await bodyPoint(page, "group-4", "bottom"), "split:group-4:bottom");
    await expectTabs(page, "group-5", ["App.vue"]);
});

test("读档失败：用缺省布局、状态行说明、原件原样留在备份键里", async ({page}) => {
    // 先让示例存一次，拿到一份真的存档再改坏。
    await tabButton(page, "group-1", "main.ts").click();
    const saved = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), KEY))!) as {groups: Record<string, {tabs: string[]}>};
    const missingGroup = structuredClone(saved);
    delete missingGroup.groups["group-2"];
    const duplicated = structuredClone(saved);
    duplicated.groups["group-2"]!.tabs.push("README.md");
    for (const broken of ["{not json", JSON.stringify(missingGroup), JSON.stringify(duplicated)]) {
        await page.evaluate(([key, value]) => localStorage.setItem(key!, value!), [KEY, broken]);
        await page.reload();
        await expect(page.locator("[data-status]")).toContainText("the original is kept as a backup");
        await expectTabs(page, "group-1", ["README.md", "main.ts", "App.vue", "model.ts"], "README.md");
        await expectTabs(page, "group-2", ["notes.txt", "todo.txt"]);
        expect(await page.evaluate((key) => localStorage.getItem(key), BACKUP)).toBe(broken);
    }
});

test("存档坏、备份也写不进：这一页不再保存，提示一直挂着，原件留在主键", async ({page}) => {
    // 让写备份键抛错（像存储满了）；其余照常。在页面脚本之前装上，读档时就生效。
    await page.addInitScript((backup) => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key: string, value: string) {
            if (key === backup) throw new DOMException("full", "QuotaExceededError");
            original.call(this, key, value);
        };
    }, BACKUP);
    await page.evaluate((key) => localStorage.setItem(key, "{not json"), KEY);
    await page.reload();
    await expect(page.locator("[data-status]")).toContainText("changes will not be kept");
    await tabButton(page, "group-1", "main.ts").click();
    await expect(tabButton(page, "group-1", "main.ts")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-status]")).toContainText("changes will not be kept");
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe("{not json");
});

test("F6 与 Shift+F6 在侧栏与编组之间移动焦点", async ({page}) => {
    await page.locator(".explorer__file").first().focus();
    await page.keyboard.press("F6");
    await expect(tabButton(page, "group-1", "README.md")).toBeFocused();
    await page.keyboard.press("F6");
    await expect(tabButton(page, "group-2", "notes.txt")).toBeFocused();
    await page.keyboard.press("Shift+F6");
    await expect(tabButton(page, "group-1", "README.md")).toBeFocused();
});
