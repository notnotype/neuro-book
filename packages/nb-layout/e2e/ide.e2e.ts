/**
 * IDE 工具窗示例（`examples/ide`）在真实浏览器里的行为。每个用例从空存档开始：缺省布局是左区展开显示 Project，
 * 右区与下区收着；左条有 Project、Structure、Bookmarks，右条有 Outline，下条有 Terminal、Problems。
 *
 * 分隔线的 id：`main:0` 左条与左区、`main:1` 左区与编辑区那一列、`main:2` 那一列与右区、`main:3` 右区与右条，
 * `center:0` 编辑区与下区，`root:0` 主区与下条。条旁的三条（`main:0`、`main:3`、`root:0`）宽 0：库画成不可交互的接缝。
 *
 * 变异检查（各改坏示例里的一处、重新构建、只跑对应用例，都要失败；恢复后重新构建再跑全部）：
 * - 没有按钮的区的分隔线可以拖（`sashLocked` 里去掉按区判断的那一句）：“没有按钮的区”用例失败，它的分隔线没有 `aria-disabled`。
 * - 条旁的分隔线给了宽度（`sashSize` 里条旁那几条也给 `SASH_SIZE`）：“条旁的分隔线”用例失败，条旁的分隔线没有 `data-disabled`。
 * - 最大化期间点按钮不先退出（`toggleTool` 里去掉 `maximized = false`）：“最大化”用例失败，点完按钮标题条上仍是 Restore。
 * - 区展开而 `shown` 为空时不补第一个（`reconcile` 里去掉补的那一句）：“恢复宽度”用例失败，拖开的右区标题是空的。
 * - 读档不按存下的尺寸建树（`fromSaved` 里区的 `size` 换成缺省尺寸）：“存取”用例失败，收着存下的左区展开后是 260 不是 320。
 * - 原位算落点（`resolveDrop` 里去掉 `isOwnPosition` 那一句）：“同一条里换位置”用例失败，拖回自己前面时 `data-drop`
 *   是 `move:bottom:terminal` 而不是 `none`；模型层的落点单元测试也失败。
 * - 隐藏按钮在区收着时也画（`v-if` 读 `shown` 而不是 `open`）：“读档时就收着的区”用例失败，收着的区面板头里有隐藏按钮。
 * - 状态行只显示一次性的话（去掉一直在的那句）：“备份也写不进去”用例失败，成功的操作之后状态行是空的。
 *
 * 两项“拖不动”的变异：去掉停用，并且临时注释掉用例里 `aria-disabled`、`data-disabled` 的断言，看“拖不动”的尺寸断言
 * 自己能不能失败：
 * - 条旁的分隔线：用例仍然通过。它不去拖条旁的线，尺寸断言证明的是拖别的线时条钉得住（条是刚性的）；能证明“接缝生效”
 *   的只有 `data-disabled` 那几句。
 * - 没有按钮的区的分隔线：用例同样通过。区锁着，库的手势展不开它，Enter 也跳过它；“拖不动”靠 `aria-disabled` 那一句，
 *   锁本身由库与模型的单元测试守。
 *
 * “拖动后回到自己身上松手”用例：库在拖动会话里把指针捕获到承载盒上，松手后的 click 因此落在承载盒而不是按钮，按钮的
 * 点击处理本来就收不到它；单独关掉库里的吞 click（`takeClick` 恒为否），用例仍通过，实测过。单独去掉指针捕获（吞 click 仍在）
 * 也通过，两样都去掉才失败，Project 被点了一下而收起。所以这条用例守的是整体行为，不是其中某一道。
 */

import {expect, test, type Page} from "@playwright/test";

import {boxOf, centerOf, dragTo, moveTo, pickUp, settled, twoFrames, type Point} from "./drag";
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
    // 手势落账与过渡都要几帧：“拖不动”的用例随后断言尺寸没变，不等的话在任何变化开始之前就会通过。
    await twoFrames(page);
    await settled(page);
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

    // 重新载入后用 Enter 收起与展开：分隔线上的 Enter 与按钮一样回到尺寸意图，这一段验证读档放回的意图两条路都认。
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

test("排序与跨条：条上换位置、拖到别的条后在那里显示并展开、拖走正在显示的换成剩下的第一个", async ({page}) => {
    await dragTo(page, button(page, "project"), await beforeTool(page, "left", "bookmarks"), "move:left:bookmarks");
    await expectStrip(page, "left", ["structure", "project", "bookmarks"]);
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

test("同一条里换位置，横向的下条也一样；拖回原位没有落点，松手不变", async ({page}) => {
    // 下条是横向的：落点按横轴判。
    await dragTo(page, button(page, "problems"), await beforeTool(page, "bottom", "terminal"), "move:bottom:terminal");
    await expectStrip(page, "bottom", ["problems", "terminal"]);
    // 先到一个真落点、等它显示出来，再一步跳到自己前面（插在自己前面就是原位）：落点变成 none，松手不变。
    await pickUp(page, button(page, "terminal"));
    await moveTo(page, await beforeTool(page, "bottom", "problems"), "move:bottom:problems");
    await moveTo(page, await beforeTool(page, "bottom", "terminal"), "none", 1);
    await page.mouse.up();
    await expect(page.locator("[data-drop]")).toHaveCount(0);
    await expectStrip(page, "bottom", ["problems", "terminal"]);
    // 最后一个拖到自己的条尾：也是原位。
    await pickUp(page, button(page, "terminal"));
    await moveTo(page, await beforeTool(page, "bottom", "problems"), "move:bottom:problems");
    await moveTo(page, await endOfStrip(page, "bottom"), "none", 1);
    await page.mouse.up();
    await expect(page.locator("[data-drop]")).toHaveCount(0);
    await expectStrip(page, "bottom", ["problems", "terminal"]);

    // 竖向的左条：插在自己后面那个按钮前面也是原位。
    await pickUp(page, button(page, "structure"));
    await moveTo(page, await beforeTool(page, "left", "project"), "move:left:project");
    await moveTo(page, await beforeTool(page, "left", "bookmarks"), "none", 1);
    await page.mouse.up();
    await expect(page.locator("[data-drop]")).toHaveCount(0);
    await expectStrip(page, "left", ["project", "structure", "bookmarks"]);
});

test("拖动后回到自己身上松手：按钮不被触发，区的开合不变", async ({page}) => {
    await expectPressed(page, "project", true);
    await expectSize(page, "left", 260);
    // 按下、挪过起拖门槛、到过一个真落点、再回到自己身上松手：按下与松手落在同一个按钮上，浏览器照常发 click，
    // 库要把这一次 click 吞掉，不然 Project 被当成点了一下而收起。
    await pickUp(page, button(page, "project"));
    await moveTo(page, await beforeTool(page, "left", "bookmarks"), "move:left:bookmarks");
    await moveTo(page, await centerOf(button(page, "project")), "none", 1);
    await page.mouse.up();
    await expect(page.locator("[data-drop]")).toHaveCount(0);
    await twoFrames(page);
    await settled(page);
    await expectPressed(page, "project", true);
    await expectSize(page, "left", 260);
    await expectStrip(page, "left", ["project", "structure", "bookmarks"]);
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
    await twoFrames(page);
    await settled(page);
    await expectSize(page, "bottom", 0);
    expect(Math.round((await boxOf(frame(page, "editor"))).height)).toBe(Math.round(editor.height));

    // 空的下条整条都是落点：拖一个回去，下区展开显示它，分隔线恢复。
    await dragTo(page, button(page, "outline"), await endOfStrip(page, "bottom"), "move:bottom:end");
    await expectStrip(page, "bottom", ["outline"]);
    await expectSize(page, "bottom", 200);
    await expect(sash(page, "center:0")).not.toHaveAttribute("aria-disabled", "true");
});

test("读档时就收着的区：面板头没有隐藏按钮，展开之后才有", async ({page}) => {
    await button(page, "project").click();
    await expectSize(page, "left", 0);
    await page.reload();
    await expectSize(page, "left", 0);
    // 面板头在叶里（零宽），隐藏按钮不在：Tab 走不到它，按下去也不会反过来展开区。
    await expect(page.locator("[data-zone-head='left']")).toHaveCount(1);
    await expect(page.locator("[data-zone-head='left'] [data-tool-hide]")).toHaveCount(0);
    await button(page, "project").click();
    await expectSize(page, "left", 260);
    await expect(page.locator("[data-zone-head='left'] [data-tool-hide]")).toHaveCount(1);
});

test("存档坏而备份也写不进去：状态行一直写着这一页不再保存，后面成功的操作清不掉它，原件留在主键", async ({page}) => {
    const broken = "{not json";
    await page.evaluate(([key, value]) => localStorage.setItem(key!, value!), [KEY, broken]);
    // 只让写备份键失败：其它键照常，才能看出“不再保存”是示例自己的决定而不是存储坏了。
    await page.addInitScript(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key: string, value: string) {
            if (key.endsWith(":backup")) throw new Error("quota");
            original.call(this, key, value);
        };
    });
    await page.reload();
    await expect(page.locator("[data-status]")).toContainText("changes will not be kept");
    // 一次成功的操作：状态行不能被清掉，布局照常能用。
    await button(page, "outline").click();
    await expectSize(page, "right", 240);
    await twoFrames(page);
    await expect(page.locator("[data-status]")).toContainText("changes will not be kept");
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(broken);
    expect(await page.evaluate((key) => localStorage.getItem(key), BACKUP)).toBeNull();
});

test("条旁的分隔线是接缝：拖得动的那一条拖了，条旁的三条宽 0、不可交互，条的厚度不变", async ({page}) => {
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
    // 宽 0 的分隔线库画成接缝（`data-disabled`），没有命中带可按，不再去拖它。
    for (const id of ["main:0", "main:3", "root:0"]) {
        await expect(sash(page, id)).toHaveAttribute("data-disabled", "true");
        await expect(sash(page, id)).toHaveAttribute("aria-disabled", "true");
    }
    // 再拖一次拖得动的那一条：条的厚度不变（推到条上的情形由模型测试的级联一条守）。
    await dragSash(page, "main:1", {x: -40, y: 0});
    await expectSize(page, "left", 260);
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
        expect(await page.evaluate((key) => localStorage.getItem(key), BACKUP)).toBe(broken);
        expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).not.toBe(broken);
    }
});
