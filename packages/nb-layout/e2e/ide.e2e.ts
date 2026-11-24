/**
 * IDE 工具窗示例（`examples/ide`）在真实浏览器里的行为。每个用例从空存档开始：缺省布局是左区展开显示 Project，
 * 右区与下区收着；左条有 Project、Structure、Bookmarks，右条有 Outline，下条有 Terminal、Problems。
 *
 * 分隔线的 id：`main:0` 左条与左区、`main:1` 左区与编辑区那一列、`main:2` 那一列与右区、`main:3` 右区与右条，
 * `center:0` 编辑区与下区，`root:0` 主区与下条。
 *
 * 变异检查（各改坏示例里的一处、重新构建、只跑对应用例，都要失败；恢复后重新构建再跑全部）：
 * MUTATIONS
 */

import {expect, test, type Locator, type Page} from "@playwright/test";

import {boxOf, centerOf, dragTo, settled, type Point} from "./drag";
import {serveExample} from "./serve";

const KEY = "nb-layout-example:ide";
const BACKUP = `${KEY}:backup`;

let server: Awaited<ReturnType<typeof serveExample>>;
test.beforeAll(async () => {
    server = await serveExample("ide");
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
    await expect(page.locator("[data-leaf='bottom-stripe']")).toBeVisible();
});

type Zone = "left" | "right" | "bottom";

const button = (page: Page, tool: string) => page.locator(`[data-tool-button="${tool}"]`);
const frame = (page: Page, id: string) => page.locator(`[data-leaf="${id}"]`);
const sash = (page: Page, id: string) => page.locator(`[data-sash="${id}"]`);
const head = (page: Page, zone: Zone) => page.locator(`[data-zone-head="${zone}"] .tool-head__title`);
const maximize = (page: Page) => page.locator("[data-action='maximize']");
const editorText = (page: Page) => page.locator("[data-editor-text='main.ts']");

/** 区在它那根轴上的尺寸（左右是宽，下区是高），收起时是 0。取整：过渡结束时可能差零点几。 */
async function sizeOf(page: Page, zone: Zone): Promise<number> {
    const box = await frame(page, zone).boundingBox();
    return Math.round((zone === "bottom" ? box?.height : box?.width) ?? 0);
}

async function expectSize(page: Page, zone: Zone, size: number): Promise<void> {
    await expect.poll(() => sizeOf(page, zone)).toBe(size);
}

async function expectPressed(page: Page, tool: string, pressed: boolean): Promise<void> {
    await expect(button(page, tool)).toHaveAttribute("aria-pressed", String(pressed));
}

async function stripOf(page: Page, zone: Zone): Promise<string[]> {
    return page.locator(`[data-tool-strip][data-strip="${zone}"] [data-tool-button]`).evaluateAll((elements) => elements.map((element) => (element as HTMLElement).dataset.toolButton!));
}

async function expectStrip(page: Page, zone: Zone, tools: string[]): Promise<void> {
    await expect.poll(() => stripOf(page, zone)).toEqual(tools);
}

/** 按住分隔线拖 `delta` 像素。 */
async function dragSash(page: Page, id: string, delta: Point): Promise<void> {
    await settled(page);
    const at = await centerOf(sash(page, id));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + delta.x, at.y + delta.y, {steps: 8});
    await page.mouse.up();
}

/** 插到按钮 `before` 前面的点：它靠条起点那一边往里 3 像素（插入位按按钮中线判，过了中线就是它后面）。 */
async function beforeTool(page: Page, zone: Zone, before: string): Promise<Point> {
    const box = await boxOf(button(page, before));
    return zone === "bottom" ? {x: box.x + 3, y: box.y + box.height / 2} : {x: box.x + box.width / 2, y: box.y + 3};
}

/** 排到条最后的点：条的外框里、最后一个按钮之后（空条也一样，整条都是落点）。 */
async function endOfStrip(page: Page, zone: Zone): Promise<Point> {
    const box = await boxOf(frame(page, `${zone}-stripe`));
    return zone === "bottom" ? {x: box.x + box.width - 20, y: box.y + box.height / 2} : {x: box.x + box.width / 2, y: box.y + box.height - 20};
}

/** 区的外框里没有可聚焦的东西，焦点要在 body 上，才说明快捷键不靠焦点在哪。 */
async function expectBodyFocused(page: Page): Promise<void> {
    await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);
}

test("开关工具窗：收着时展开显示它，显示别的时换成它，已显示它时收起，按钮的选中态跟着变", async ({page}) => {
    await expectSize(page, "left", 260);
    await expect(head(page, "left")).toHaveText("Project");
    await expectPressed(page, "project", true);

    await button(page, "structure").click();
    await expect(head(page, "left")).toHaveText("Structure");
    await expectPressed(page, "structure", true);
    await expectPressed(page, "project", false);
    await expectSize(page, "left", 260);

    await button(page, "structure").click();
    await expectSize(page, "left", 0);
    await expectPressed(page, "structure", false);
    // 收起时区显示的那个留着：再点它直接展开，不用重新选。
    await button(page, "structure").click();
    await expectSize(page, "left", 260);
    await expect(head(page, "left")).toHaveText("Structure");
    await expectPressed(page, "structure", true);

    await button(page, "outline").click();
    await expectSize(page, "right", 240);
    await expect(head(page, "right")).toHaveText("Outline");
    await button(page, "problems").click();
    await expectSize(page, "bottom", 200);
    await expect(head(page, "bottom")).toHaveText("Problems");
    await button(page, "terminal").click();
    await expect(head(page, "bottom")).toHaveText("Terminal");
    await expectPressed(page, "problems", false);
});

test("恢复宽度：拖宽后收起再展开、重新载入后按 Enter 收起再展开，都回到拖后的宽度；从收着拖开右区，它显示右条的第一个", async ({page}) => {
    await dragSash(page, "main:1", {x: 60, y: 0});
    await expectSize(page, "left", 320);
    await button(page, "project").click();
    await expectSize(page, "left", 0);
    await button(page, "project").click();
    await expectSize(page, "left", 320);

    // 重新载入后用 Enter 收起与展开：按钮的路径不管存不存恢复尺寸都会过，分隔线上的 Enter 才靠读档放回去的尺寸。
    await page.reload();
    await expectSize(page, "left", 320);
    await sash(page, "main:1").focus();
    await page.keyboard.press("Enter");
    await expectSize(page, "left", 0);
    await page.keyboard.press("Enter");
    await expectSize(page, "left", 320);

    // 右区收着、还没有显示哪一个：从分隔线拖开它，示例补上这一条的第一个。
    await expectSize(page, "right", 0);
    await expectPressed(page, "outline", false);
    await dragSash(page, "main:2", {x: -200, y: 0});
    await expect.poll(() => sizeOf(page, "right")).toBeGreaterThanOrEqual(160);
    await expect(head(page, "right")).toHaveText("Outline");
    await expectPressed(page, "outline", true);
});

test("排序与跨条：条上换位置、拖到别的条后在那里显示并展开、拖走正在显示的换成剩下的第一个；拖动后的那一下点击不触发按钮", async ({page}) => {
    await dragTo(page, button(page, "project"), await beforeTool(page, "left", "bookmarks"), "move:left:bookmarks");
    await expectStrip(page, "left", ["structure", "project", "bookmarks"]);
    // 松手后浏览器还会发一次 click：它落在被拖的按钮上，不能把正显示着的 Project 收起来。
    await expectPressed(page, "project", true);
    await expectSize(page, "left", 260);

    await dragTo(page, button(page, "structure"), await beforeTool(page, "right", "outline"), "move:right:outline");
    await expectStrip(page, "right", ["structure", "outline"]);
    await expectStrip(page, "left", ["project", "bookmarks"]);
    await expectSize(page, "right", 240);
    await expect(head(page, "right")).toHaveText("Structure");
    await expectPressed(page, "structure", true);
    // 左区原来显示的不是被拖走的这一个，不受影响。
    await expect(head(page, "left")).toHaveText("Project");

    // 下区显示着 Problems 时把它拖到左条：下区换成剩下的 Terminal，仍展开；Problems 在左区显示。
    await button(page, "problems").click();
    await expect(head(page, "bottom")).toHaveText("Problems");
    await dragTo(page, button(page, "problems"), await endOfStrip(page, "left"), "move:left:end");
    await expectStrip(page, "left", ["project", "bookmarks", "problems"]);
    await expect(head(page, "left")).toHaveText("Problems");
    await expect(head(page, "bottom")).toHaveText("Terminal");
    await expectSize(page, "bottom", 200);
    await expectPressed(page, "terminal", true);
    await expectPressed(page, "problems", true);
    // 打的字跟着按钮走：内容层按 key 留着同一个实例。
    await page.locator("[data-tool-text='terminal']").fill("kept while moving");
    await dragTo(page, button(page, "terminal"), await endOfStrip(page, "right"), "move:right:end");
    await expect(page.locator("[data-tool-text='terminal']")).toHaveValue("kept while moving");
    await expect(head(page, "right")).toHaveText("Terminal");
});

test("没有按钮的区：拖走最后一个时区收起，它的分隔线拖不动、Enter 也展不开；拖回一个就恢复", async ({page}) => {
    await button(page, "terminal").click();
    await expectSize(page, "bottom", 200);
    await dragTo(page, button(page, "terminal"), await endOfStrip(page, "right"), "move:right:end");
    // 拖走的是正显示的 Terminal：下区换成剩下的 Problems，仍展开。
    await expect(head(page, "bottom")).toHaveText("Problems");
    await expectStrip(page, "bottom", ["problems"]);
    await expectSize(page, "bottom", 200);
    await dragTo(page, button(page, "problems"), await endOfStrip(page, "right"), "move:right:end");
    await expectStrip(page, "bottom", []);
    await expectSize(page, "bottom", 0);

    // 有按钮的区的分隔线可以拖；没有按钮的区的这一条停用，指针与键盘都动不了它。
    await expect(sash(page, "main:1")).not.toHaveAttribute("aria-disabled", "true");
    await expect(sash(page, "center:0")).toHaveAttribute("aria-disabled", "true");
    const editor = await boxOf(frame(page, "editor"));
    await dragSash(page, "center:0", {x: 0, y: -150});
    await sash(page, "center:0").focus();
    await page.keyboard.press("Enter");
    await expectSize(page, "bottom", 0);
    expect(Math.round((await boxOf(frame(page, "editor"))).height)).toBe(Math.round(editor.height));

    // 空的下条整条都是落点：拖一个回去，下区展开显示它，分隔线恢复。
    await dragTo(page, button(page, "outline"), await endOfStrip(page, "bottom"), "move:bottom:end");
    await expectStrip(page, "bottom", ["outline"]);
    await expectSize(page, "bottom", 200);
    await expect(sash(page, "center:0")).not.toHaveAttribute("aria-disabled", "true");
});

test("条旁的分隔线拖不动：拖得动的那一条拖了，条旁的三条拖了不变", async ({page}) => {
    await dragSash(page, "main:1", {x: 40, y: 0});
    await expectSize(page, "left", 300);

    await button(page, "outline").click();
    await button(page, "terminal").click();
    await expectSize(page, "right", 240);
    await expectSize(page, "bottom", 200);
    const before = {
        leftStripe: await boxOf(frame(page, "left-stripe")),
        rightStripe: await boxOf(frame(page, "right-stripe")),
        bottomStripe: await boxOf(frame(page, "bottom-stripe")),
    };
    for (const id of ["main:0", "main:3", "root:0"]) await expect(sash(page, id)).toHaveAttribute("aria-disabled", "true");
    await dragSash(page, "main:0", {x: 40, y: 0});
    await dragSash(page, "main:3", {x: -40, y: 0});
    await dragSash(page, "root:0", {x: 0, y: -40});
    await expectSize(page, "left", 300);
    await expectSize(page, "right", 240);
    await expectSize(page, "bottom", 200);
    expect(await boxOf(frame(page, "left-stripe"))).toEqual(before.leftStripe);
    expect(await boxOf(frame(page, "right-stripe"))).toEqual(before.rightStripe);
    expect(await boxOf(frame(page, "bottom-stripe"))).toEqual(before.bottomStripe);
});

test("最大化：编辑区盖住三个区而三条还在；最大化时点按钮先退出最大化再打开；最大化时把按钮拖进别的条，放下时退出最大化并移动", async ({page}) => {
    await button(page, "outline").click();
    await expectSize(page, "right", 240);
    const normal = await boxOf(frame(page, "editor"));
    const stripes = [await boxOf(frame(page, "left-stripe")), await boxOf(frame(page, "right-stripe")), await boxOf(frame(page, "bottom-stripe"))];

    await maximize(page).click();
    await expect(maximize(page)).toHaveText("Restore");
    await expect.poll(async () => (await boxOf(frame(page, "editor"))).width).toBeGreaterThan(normal.width + 400);
    const wide = await boxOf(frame(page, "editor"));
    const left = await boxOf(frame(page, "left"));
    const right = await boxOf(frame(page, "right"));
    expect(wide.x).toBeLessThanOrEqual(left.x + 1);
    expect(wide.x + wide.width).toBeGreaterThanOrEqual(right.x + right.width - 1);
    expect([await boxOf(frame(page, "left-stripe")), await boxOf(frame(page, "right-stripe")), await boxOf(frame(page, "bottom-stripe"))]).toEqual(stripes);
    for (const tool of ["project", "outline", "terminal"]) await expect(button(page, tool)).toBeVisible();

    // 最大化时点按钮：先退出最大化，被盖住的区才看得见。
    await button(page, "terminal").click();
    await expect(maximize(page)).toHaveText("Maximize");
    await expectSize(page, "bottom", 200);
    await expect.poll(async () => Math.round((await boxOf(frame(page, "editor"))).width)).toBe(Math.round(normal.width));

    // 最大化时拖：落点照常，放下才退出最大化并移动。
    await maximize(page).click();
    await expect(maximize(page)).toHaveText("Restore");
    await dragTo(page, button(page, "bookmarks"), await endOfStrip(page, "right"), "move:right:end");
    await expect(maximize(page)).toHaveText("Maximize");
    await expectStrip(page, "right", ["outline", "bookmarks"]);
    await expect(head(page, "right")).toHaveText("Bookmarks");
});

test("快捷键与焦点：Alt+Shift+数字开关工具窗，Alt+Shift+M 最大化；点工具窗里点不到焦点的地方之后照样生效；Escape 回编辑区；关掉焦点所在的工具窗后焦点在编辑区", async ({page}) => {
    await page.keyboard.press("Alt+Shift+Digit5");
    await expectSize(page, "bottom", 200);
    await expect(head(page, "bottom")).toHaveText("Terminal");
    await page.keyboard.press("Alt+Shift+Digit6");
    await expect(head(page, "bottom")).toHaveText("Problems");
    await page.keyboard.press("Alt+Shift+Digit6");
    await expectSize(page, "bottom", 0);
    await page.keyboard.press("Alt+Shift+KeyM");
    await expect(maximize(page)).toHaveText("Restore");
    await page.keyboard.press("Alt+Shift+KeyM");
    await expect(maximize(page)).toHaveText("Maximize");

    // 焦点在编辑区时开关别的工具窗，焦点不被抢走。
    await editorText(page).click();
    await expect(editorText(page)).toBeFocused();
    await page.keyboard.press("Alt+Shift+Digit1");
    await expectSize(page, "left", 0);
    await expect(editorText(page)).toBeFocused();
    await page.keyboard.press("Alt+Shift+Digit1");
    await expectSize(page, "left", 260);

    // 点到工具窗里的一行字：它不能聚焦，焦点落到 body，快捷键还要生效。
    await page.locator("[data-tool-panel='project'] .panel__line").first().click();
    await expectBodyFocused(page);
    await page.keyboard.press("Alt+Shift+Digit2");
    await expect(head(page, "left")).toHaveText("Structure");

    // 焦点在工具窗里时 Escape 回编辑区。
    await page.locator("[data-tool-text='structure']").click();
    await expect(page.locator("[data-tool-text='structure']")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(editorText(page)).toBeFocused();

    // 关掉焦点所在的工具窗：快捷键、标题条上的隐藏按钮两条路，焦点都在编辑区。
    await page.locator("[data-tool-text='structure']").click();
    await page.keyboard.press("Alt+Shift+Digit2");
    await expectSize(page, "left", 0);
    await expect(editorText(page)).toBeFocused();
    await page.keyboard.press("Alt+Shift+Digit2");
    await expectSize(page, "left", 260);
    await page.locator("[data-tool-text='structure']").click();
    await page.locator("[data-zone-head='left'] [data-tool-hide]").click();
    await expectSize(page, "left", 0);
    await expect(editorText(page)).toBeFocused();
});

test("存取：改宽、排序、跨条、收起之后重新载入都还原；存档坏时用缺省布局、原件在备份键", async ({page}) => {
    await dragSash(page, "main:1", {x: 60, y: 0});
    await expectSize(page, "left", 320);
    await dragTo(page, button(page, "structure"), await beforeTool(page, "right", "outline"), "move:right:outline");
    await button(page, "problems").click();
    await expectSize(page, "bottom", 200);
    await button(page, "project").click();
    await expectSize(page, "left", 0);
    await maximize(page).click();
    await expect(maximize(page)).toHaveText("Restore");

    await page.reload();
    await expectStrip(page, "left", ["project", "bookmarks"]);
    await expectStrip(page, "right", ["structure", "outline"]);
    await expectStrip(page, "bottom", ["terminal", "problems"]);
    await expectSize(page, "left", 0);
    await expectSize(page, "right", 240);
    await expectSize(page, "bottom", 200);
    await expect(head(page, "right")).toHaveText("Structure");
    await expect(head(page, "bottom")).toHaveText("Problems");
    await expectPressed(page, "structure", true);
    await expectPressed(page, "problems", true);
    await expectPressed(page, "project", false);
    // 最大化只在内存，重新载入后不在。
    await expect(maximize(page)).toHaveText("Maximize");
    // 收着存下的区，展开回到收起前的宽度，不是缺省宽度。
    await button(page, "project").click();
    await expectSize(page, "left", 320);

    for (const broken of ["{not json", JSON.stringify({version: 1, zones: {}}), JSON.stringify({version: 2})]) {
        await page.evaluate(([key, value]) => localStorage.setItem(key!, value!), [KEY, broken]);
        await page.reload();
        await expectStrip(page, "left", ["project", "structure", "bookmarks"]);
        await expectSize(page, "left", 260);
        await expectSize(page, "right", 0);
        await expect(page.locator("[data-status]")).toContainText("default layout");
        expect(await page.evaluate((key) => localStorage.getItem(key), BACKUP)).toBe(broken);
        // 读档坏了之后还能照常用，并且之后的保存不再冒充原件。
        await button(page, "outline").click();
        await expectSize(page, "right", 240);
    }
});
