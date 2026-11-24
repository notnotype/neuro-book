/**
 * 桌面示例（`examples/desktop`）在真实浏览器里的行为。每个用例从空存档开始：缺省布局是桌面加底栏，四扇窗都浮动：
 * notes（40,40）420x300、calc（500,80）320x360、clock（860,60）300x220、files（200,400）480x300，坐标相对网格根；
 * 层叠次序同这个顺序，files 在最上。默认视口 1440x900，桌面叶是 1440 宽、803 高。
 *
 * 宽度、位置的断言带 1 像素的容差：三块平分是 477、478、477。
 *
 * 变异检查（各改坏一处、重新构建、只跑对应的用例，都失败；再用 `git show HEAD:<文件>` 恢复、重新构建）：
 * - `sourceAt` 不排除标题栏按钮：“按下后面的窗它到最上面；点标题栏上的按钮不起拖”失败（按钮上一拖就起拖，落点出现、点击被吞）。
 * - 边缘带不算越过桌面左缘的部分：“左侧有平铺窗时，拖过平铺窗的位置还是贴左缘”失败（落点停在 `move`）。
 * - 被挡时 `actionKey` 给 `null`：“视口窄到平铺不下”失败（窗弹回按下之前的位置，不在松手处）。
 * - `deskClamp` 不减桌面的原点：“左侧有平铺窗时……浮动窗被夹在平铺窗右边”失败（窗被推到桌面右边）。
 * - 缩放预览不与桌面求交：“向桌面外拉大”失败（预览的高度伸出桌面，松手后才被夹）。
 * - 按下抬升挂在冒泡阶段（手柄在 `pointerdown` 里阻止冒泡，收不到）：“按住后面那扇窗的缩放手柄”失败（窗没到最上面）。
 * - 移动把夹过的宽高写回模型：“视口缩小后浮动窗都在桌面里……”失败（变回大视口后 notes 还是缩小的 360 宽）。
 */

import {expect, test, type Page} from "@playwright/test";

import {boxOf, centerOf, dragTo, moveTo, pickUp, settled, twoFrames} from "./drag";
import {serveExample} from "./serve";

const KEY = "nb-layout-example:desktop";
const BACKUP = `${KEY}:backup`;

let server: Awaited<ReturnType<typeof serveExample>>;
test.beforeAll(async () => {
    server = await serveExample("desktop");
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
    await expect(page.locator("[data-leaf='files']")).toBeVisible();
});

type Rect = {x: number; y: number; width: number; height: number};

const frame = (page: Page, id: string) => page.locator(`[data-leaf="${id}"]`);
const title = (page: Page, id: string) => page.locator(`[data-window-title="${id}"]`);
const dock = (page: Page, id: string) => page.locator(`[data-window="${id}"]`);
const text = (page: Page, id: string) => page.locator(`[data-window-text="${id}"]`);
const action = (page: Page, id: string, name: string) => title(page, id).locator(`[data-window-action="${name}"]`);
const handle = (page: Page, id: string, which: string) => page.locator(`[data-float-chrome="${id}"] [data-float-handle="${which}"]`);
const moveHandle = (page: Page, id: string) => page.locator(`[data-float-chrome="${id}"] [data-float-move-handle]`);

/** 这一刻的矩形（视口坐标）；没有这块叶时是 null。不用 `boundingBox`：它会等元素出现。 */
async function rectNow(page: Page, id: string): Promise<Rect | null> {
    return page.evaluate((leaf) => {
        const element = document.querySelector(`[data-leaf="${leaf}"]`);
        if (element === null) return null;
        const {x, y, width, height} = element.getBoundingClientRect();
        return {x, y, width, height};
    }, id);
}

/** 等这块叶的矩形与 `want` 里给出的几项相差都不超过 1 像素。 */
async function expectRect(page: Page, id: string, want: Partial<Rect>): Promise<void> {
    await expect.poll(async () => {
        const box = await rectNow(page, id);
        if (box === null) return Number.POSITIVE_INFINITY;
        return Math.max(0, ...(Object.keys(want) as (keyof Rect)[]).map((key) => Math.abs(box[key] - want[key]!)));
    }, {message: `${id} 的矩形应接近 ${JSON.stringify(want)}`}).toBeLessThanOrEqual(1);
}

async function stateOf(page: Page, id: string): Promise<string | null> {
    return dock(page, id).getAttribute("data-window-state");
}

async function expectState(page: Page, id: string, state: string): Promise<void> {
    await expect(dock(page, id)).toHaveAttribute("data-window-state", state);
}

/** 层叠序：外框的 `z-index`，大的在上面。 */
async function zOf(page: Page, id: string): Promise<number> {
    return frame(page, id).evaluate((element) => Number(getComputedStyle(element).zIndex));
}

/** 桌面叶此刻的矩形（视口坐标）。 */
const deskBox = (page: Page) => boxOf(frame(page, "desktop"));

/** 存在 localStorage 里的存档。 */
async function saved(page: Page): Promise<{windows: Record<string, {mode: string; floatRect: Rect; before: string | null}>; order: string[]}> {
    return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY);
}

/** 把一扇浮动窗拖到桌面的左缘或右缘平铺，等平铺完成、过渡结束。 */
async function tile(page: Page, id: string, side: "left" | "right"): Promise<void> {
    const width = page.viewportSize()!.width;
    await dragTo(page, title(page, id), {x: side === "left" ? 10 : width - 10, y: 450}, `tile:${side}`);
    await expectState(page, id, `tiled-${side}`);
    await settled(page);
}

test("拖标题栏移动：松手后停在松手处；拖出桌面被夹住；起拖后 Escape 回到原处", async ({page}) => {
    const before = await boxOf(frame(page, "notes"));
    const from = await centerOf(title(page, "notes"));
    await dragTo(page, title(page, "notes"), {x: from.x + 100, y: from.y + 50}, "move");
    await settled(page);
    await expectRect(page, "notes", {x: before.x + 100, y: before.y + 50, width: 420, height: 300});
    // 宽高没动，位置写进了存档。
    expect((await saved(page)).windows.notes!.floatRect).toMatchObject({x: 140, y: 90, width: 420, height: 300});

    // 拖到桌面下沿以外：窗被夹在桌面里，底边停在桌面叶的底边。
    const desk = await deskBox(page);
    await dragTo(page, title(page, "clock"), {x: 700, y: desk.y + desk.height + 40}, "move");
    await settled(page);
    await expectRect(page, "clock", {y: desk.y + desk.height - 220, height: 220});

    // 起拖后 Escape：落点消失、窗回到原处，之后松手也不再移动它。
    const calc = await boxOf(frame(page, "calc"));
    const start = await centerOf(title(page, "calc"));
    await pickUp(page, title(page, "calc"));
    await moveTo(page, {x: start.x + 120, y: start.y + 80}, "move");
    await expectRect(page, "calc", {x: calc.x + 120, y: calc.y + 80});
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-drop]")).toHaveCount(0);
    await page.mouse.up();
    await settled(page);
    await expectRect(page, "calc", {x: calc.x, y: calc.y, width: 320, height: 360});
});

test("按下后面的窗它到最上面；点标题栏上的按钮不起拖，按钮照常生效", async ({page}) => {
    // 缺省 files 在最上、notes 在最下。
    expect(await zOf(page, "notes")).toBeLessThan(await zOf(page, "files"));
    await text(page, "notes").click({position: {x: 40, y: 20}});
    expect(await zOf(page, "notes")).toBeGreaterThan(await zOf(page, "files"));
    expect((await saved(page)).order.at(-1)).toBe("notes");
    // 点标题栏（不是正文）同样挪到最上面。
    await title(page, "calc").click({position: {x: 100, y: 16}});
    expect(await zOf(page, "calc")).toBeGreaterThan(await zOf(page, "notes"));

    // 在最小化按钮上按下、挪过起拖门槛、仍在按钮里松手：不起拖，窗没动，点击照常生效。
    const before = await boxOf(frame(page, "clock"));
    const button = await centerOf(action(page, "clock", "minimize"));
    await page.mouse.move(button.x, button.y);
    await page.mouse.down();
    await page.mouse.move(button.x + 7, button.y, {steps: 3});
    await twoFrames(page);
    await expect(page.locator("[data-drop]")).toHaveCount(0);
    await page.mouse.up();
    await expectState(page, "clock", "minimized");
    // 窗没有被拖着走：再打开它，仍在原处。
    await dock(page, "clock").click();
    await expectState(page, "clock", "floating");
    await settled(page);
    await expectRect(page, "clock", {x: before.x, y: before.y});
});

test("缩放：拖右下角手柄改大小，到最小尺寸停住；Escape 取消回到原尺寸", async ({page}) => {
    const corner = handle(page, "notes", "bottom-right");
    const at = await centerOf(corner);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 60, at.y + 40, {steps: 5});
    await expectRect(page, "notes", {x: 40, width: 480, height: 340});
    await page.mouse.up();
    await expectRect(page, "notes", {width: 480, height: 340});
    expect((await saved(page)).windows.notes!.floatRect).toMatchObject({width: 480, height: 340});

    // 往回拖得很远：停在最小尺寸 240x160。
    const again = await centerOf(corner);
    await page.mouse.move(again.x, again.y);
    await page.mouse.down();
    await page.mouse.move(again.x - 600, again.y - 400, {steps: 5});
    await expectRect(page, "notes", {width: 240, height: 160});
    await page.mouse.up();
    await expectRect(page, "notes", {width: 240, height: 160});

    // Escape：预览回到按下之前的尺寸。
    const last = await centerOf(corner);
    await page.mouse.move(last.x, last.y);
    await page.mouse.down();
    await page.mouse.move(last.x + 100, last.y + 80, {steps: 5});
    await expectRect(page, "notes", {width: 340, height: 240});
    await page.keyboard.press("Escape");
    await expectRect(page, "notes", {width: 240, height: 160});
    await page.mouse.up();
    await expectRect(page, "notes", {width: 240, height: 160});
});

test("向桌面外拉大：预览与松手后的矩形相同、不伸出桌面", async ({page}) => {
    const desk = await deskBox(page);
    const top = (await boxOf(frame(page, "notes"))).y;
    const corner = handle(page, "notes", "bottom-right");
    const at = await centerOf(corner);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    // 指针在桌面下沿以外（桌面叶下面是底栏）：预览的底边停在桌面叶的底边。
    await page.mouse.move(at.x + 200, desk.y + desk.height + 50, {steps: 6});
    await expectRect(page, "notes", {x: 40, width: 620, height: desk.y + desk.height - top});
    const preview = await boxOf(frame(page, "notes"));
    expect(preview.y + preview.height).toBeLessThanOrEqual(desk.y + desk.height + 1);
    await page.mouse.up();
    await settled(page);
    await expectRect(page, "notes", preview);
});

test("聚焦移动把手按方向键移动，Shift 是 1 像素", async ({page}) => {
    await moveHandle(page, "notes").focus();
    await page.keyboard.press("ArrowRight");
    await expectRect(page, "notes", {x: 50, y: (await boxOf(frame(page, "notes"))).y, width: 420});
    const top = (await boxOf(frame(page, "notes"))).y;
    await page.keyboard.press("Shift+ArrowDown");
    await expectRect(page, "notes", {x: 50, y: top + 1});
    expect((await saved(page)).windows.notes!.floatRect).toMatchObject({x: 50, y: 41, width: 420, height: 300});
    // 一直按到桌面左缘外：被夹住，宽高不变。
    for (let step = 0; step < 8; step += 1) await page.keyboard.press("ArrowLeft");
    await expectRect(page, "notes", {x: 0, width: 420, height: 300});
});

test("按住后面那扇窗的缩放手柄：它到最上面，缩放照常", async ({page}) => {
    expect(await zOf(page, "clock")).toBeLessThan(await zOf(page, "files"));
    const at = await centerOf(handle(page, "clock", "bottom-right"));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await expect.poll(() => zOf(page, "clock")).toBeGreaterThan(await zOf(page, "files"));
    await page.mouse.move(at.x + 30, at.y + 20, {steps: 4});
    await expectRect(page, "clock", {width: 330, height: 240});
    await page.mouse.up();
    await expectRect(page, "clock", {width: 330, height: 240});
});

test("最大化铺满桌面叶、再按恢复原矩形；最大化的窗没有手柄也拖不动", async ({page}) => {
    const before = await boxOf(frame(page, "notes"));
    const from = await centerOf(title(page, "notes"));
    // 先看到同样的拖法在浮动的窗上有落点，再断言最大化的窗没有。
    await pickUp(page, title(page, "notes"));
    await moveTo(page, {x: from.x + 60, y: from.y + 40}, "move");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-drop]")).toHaveCount(0);
    await page.mouse.up();
    await settled(page);

    await expect(handle(page, "notes", "bottom-right")).toHaveCount(1);
    await action(page, "notes", "maximize").click();
    await expectState(page, "notes", "maximized");
    const desk = await deskBox(page);
    await expectRect(page, "notes", desk);
    await expect(page.locator("[data-float-chrome='notes'] [data-float-handle]")).toHaveCount(0);

    await pickUp(page, title(page, "notes"));
    await page.mouse.move(from.x + 200, from.y + 100, {steps: 6});
    await twoFrames(page);
    await expect(page.locator("[data-drop]")).toHaveCount(0);
    await page.mouse.up();
    await expectRect(page, "notes", desk);

    await action(page, "notes", "maximize").click();
    await expectState(page, "notes", "floating");
    await expectRect(page, "notes", {x: before.x, y: before.y, width: 420, height: 300});
});

test("有平铺窗时最大化只铺满剩下的桌面", async ({page}) => {
    await tile(page, "calc", "left");
    const desk = await deskBox(page);
    expect(desk.x).toBeGreaterThan(300);
    await action(page, "notes", "maximize").click();
    await expectState(page, "notes", "maximized");
    await expectRect(page, "notes", desk);
});

test("最小化：底栏按钮状态变、点回原处；打的字还在；平铺的最小化后点回原来那一侧", async ({page}) => {
    const before = await boxOf(frame(page, "notes"));
    await text(page, "notes").fill("kept while minimized");
    await action(page, "notes", "minimize").click();
    await expectState(page, "notes", "minimized");
    // 窗不在画面上，正文停放在内容层里：实例还在，打的字也在。
    await expect(frame(page, "notes")).toHaveCount(0);
    await expect(text(page, "notes")).toHaveCount(1);
    await expect(text(page, "notes")).toBeHidden();
    await dock(page, "notes").click();
    await expectState(page, "notes", "floating");
    await settled(page);
    await expectRect(page, "notes", {x: before.x, y: before.y, width: 420, height: 300});
    await expect(text(page, "notes")).toHaveValue("kept while minimized");

    await tile(page, "notes", "left");
    await action(page, "notes", "minimize").click();
    await expectState(page, "notes", "minimized");
    await dock(page, "notes").click();
    await expectState(page, "notes", "tiled-left");
    await settled(page);
    const desk = await deskBox(page);
    await expectRect(page, "notes", {x: 0, y: desk.y, height: desk.height});
    await expect(text(page, "notes")).toHaveValue("kept while minimized");
});

test("平铺的窗最小化后，那一侧被占了就浮动", async ({page}) => {
    await tile(page, "notes", "left");
    await action(page, "notes", "minimize").click();
    await expectState(page, "notes", "minimized");
    await settled(page);
    await tile(page, "calc", "left");
    await dock(page, "notes").click();
    await expectState(page, "notes", "floating");
    await settled(page);
    await expectRect(page, "notes", {width: 420, height: 300});
    // 占着那一侧的 calc 没被换下。
    await expectState(page, "calc", "tiled-left");
});

test("关闭：点底栏重新打开，打的字没了", async ({page}) => {
    await text(page, "clock").fill("gone after closing");
    await action(page, "clock", "close").click();
    await expectState(page, "clock", "closed");
    await expect(frame(page, "clock")).toHaveCount(0);
    await expect(text(page, "clock")).toHaveCount(0);
    await dock(page, "clock").click();
    await expectState(page, "clock", "floating");
    await expect(text(page, "clock")).toHaveValue("");
    await settled(page);
    await expectRect(page, "clock", {x: 860, width: 300, height: 220});
    // 重新打开的窗在最上面。
    expect(await zOf(page, "clock")).toBeGreaterThan(await zOf(page, "files"));
});

test("拖到左缘：出现落点反馈，松手后窗占左边、正文里的字还在；另一扇贴右缘，三块平分", async ({page}) => {
    await text(page, "notes").fill("typed before tiling");
    await pickUp(page, title(page, "notes"));
    await moveTo(page, {x: 10, y: 450}, "tile:left");
    await expect(page.locator("[data-drop-feedback-area]")).toBeVisible();
    await expect(page.locator("[data-drop-feedback-label]")).toHaveText("Tile left");
    await page.mouse.up();
    await expectState(page, "notes", "tiled-left");
    await settled(page);
    const desk = await deskBox(page);
    await expectRect(page, "notes", {x: 0, y: desk.y, width: 718, height: desk.height});
    await expect(text(page, "notes")).toHaveValue("typed before tiling");
    // 取消平铺按钮在，最大化按钮没有。
    await expect(action(page, "notes", "untile")).toHaveCount(1);
    await expect(action(page, "notes", "maximize")).toHaveCount(0);

    await tile(page, "clock", "right");
    await expectRect(page, "notes", {x: 0, width: 477});
    await expectRect(page, "desktop", {width: 478});
    await expectRect(page, "clock", {width: 477});
});

test("左侧有平铺窗时，拖过平铺窗的位置还是贴左缘；浮动窗被夹在平铺窗右边", async ({page}) => {
    await tile(page, "notes", "left");
    const desk = await deskBox(page);
    // 桌面叶的左缘不在 0；calc 的缺省位置在它左边，画出来被夹到桌面里。
    await expectRect(page, "calc", {x: desk.x});
    // 指针越过桌面左缘（落在平铺窗上）也是 tile:left。拖 files：它在最上面，标题栏没被别的窗盖住。
    await pickUp(page, title(page, "files"));
    await moveTo(page, {x: 100, y: 450}, "tile:left");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-drop]")).toHaveCount(0);
    await page.mouse.up();
});

test("同一侧换窗：被换下的回到它的浮动矩形；取消平铺回到浮动", async ({page}) => {
    // 记下 notes 拖到左缘时画着的矩形：它就是平铺之前最后一次浮动的矩形。存档里的矩形相对网格根，桌面叶的左上角就是网格根的原点。
    const origin = await deskBox(page);
    await pickUp(page, title(page, "notes"));
    await moveTo(page, {x: 10, y: 450}, "tile:left");
    const dropped = await boxOf(frame(page, "notes"));
    await page.mouse.up();
    await expectState(page, "notes", "tiled-left");
    await settled(page);

    // 只剩 notes 一扇平铺时，再把 clock 贴到同一侧：notes 被换下，浮动在它的浮动矩形。
    await tile(page, "clock", "left");
    await expectState(page, "notes", "floating");
    const floatRect = (await saved(page)).windows.notes!.floatRect;
    expect(Math.abs(floatRect.x - (dropped.x - origin.x))).toBeLessThanOrEqual(1);
    expect(Math.abs(floatRect.y - (dropped.y - origin.y))).toBeLessThanOrEqual(1);
    expect(floatRect).toMatchObject({width: 420, height: 300});
    expect(await zOf(page, "notes")).toBeGreaterThan(await zOf(page, "files"));
    await expectState(page, "clock", "tiled-left");

    // 取消平铺：clock 回到浮动、在最上面。
    await action(page, "clock", "untile").click();
    await expectState(page, "clock", "floating");
    await settled(page);
    await expectRect(page, "clock", {width: 300, height: 220});
    expect(await zOf(page, "clock")).toBeGreaterThan(await zOf(page, "notes"));
    await expect(frame(page, "desktop")).toBeVisible();
    await expectRect(page, "desktop", {x: 0});
});

test("视口窄到平铺不下：落点是 blocked、写 Not enough room，松手不平铺、窗停在松手处", async ({page}) => {
    await page.setViewportSize({width: 700, height: 900});
    await settled(page);
    await tile(page, "notes", "left");
    const before = await boxOf(frame(page, "files"));
    const start = await centerOf(title(page, "files"));
    await pickUp(page, title(page, "files"));
    // 先到一个真落点、再换到被挡的：被挡的落点也要显示出来。
    await moveTo(page, {x: start.x, y: start.y + 300}, "move");
    await moveTo(page, {x: 690, y: start.y + 300}, "blocked:right");
    await expect(page.locator("[data-drop-feedback-label]")).toHaveText("Not enough room");
    await page.mouse.up();
    await expect(page.locator("[data-drop]")).toHaveCount(0);
    await settled(page);
    await expectState(page, "files", "floating");
    // 窗停在松手处（被夹进桌面），没有弹回按下之前。
    const after = await boxOf(frame(page, "files"));
    expect(after.y).toBeGreaterThan(before.y + 60);
    const desk = await deskBox(page);
    expect(after.x + after.width).toBeLessThanOrEqual(desk.x + desk.width + 1);
});

test("底栏上面那条分隔线拖不动，平铺之前与之后各试一次；平铺的窗与桌面之间的能拖", async ({page}) => {
    const dockSash = page.locator("[data-sash='root:0']");
    async function dragDockSash(): Promise<void> {
        const dockBefore = await boxOf(frame(page, "dock"));
        const at = await centerOf(dockSash);
        await page.mouse.move(at.x, at.y);
        await page.mouse.down();
        await page.mouse.move(at.x, at.y - 120, {steps: 6});
        await twoFrames(page);
        await page.mouse.up();
        await settled(page);
        await expectRect(page, "dock", {y: dockBefore.y, height: 56});
    }
    await expect(dockSash).toHaveAttribute("aria-disabled", "true");
    await dragDockSash();
    await tile(page, "notes", "left");
    await expect(dockSash).toHaveAttribute("aria-disabled", "true");
    await dragDockSash();

    // 对照：平铺的窗与桌面之间的分隔线拖得动，说明上面的“拖不动”不是拖法有问题。
    const side = page.locator("[data-sash^='tile-']");
    await expect(side).not.toHaveAttribute("aria-disabled", "true");
    const at = await centerOf(side);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 100, at.y, {steps: 6});
    await page.mouse.up();
    await settled(page);
    await expectRect(page, "notes", {width: 818});
});

test("移动、平铺、最小化之后重新载入都还原", async ({page}) => {
    await dragTo(page, title(page, "files"), {x: 700, y: 600}, "move");
    await settled(page);
    await tile(page, "calc", "right");
    await action(page, "clock", "minimize").click();
    await expectState(page, "clock", "minimized");
    await settled(page);
    const files = await rectNow(page, "files");
    const notes = await rectNow(page, "notes");

    await page.reload();
    await expect(page.locator("[data-leaf='files']")).toBeVisible();
    await expectState(page, "calc", "tiled-right");
    await expectState(page, "clock", "minimized");
    await expectState(page, "notes", "floating");
    await expectState(page, "files", "floating");
    await expectRect(page, "files", files!);
    await expectRect(page, "notes", notes!);
    await expectRect(page, "calc", {width: 718});
});

test("存档坏了：用缺省布局，原件放进备份键，状态行说明", async ({page}) => {
    const broken = JSON.stringify({version: 1, nonsense: true});
    await page.evaluate(([key, value]) => localStorage.setItem(key!, value!), [KEY, broken]);
    await page.reload();
    await expect(page.locator("[data-leaf='files']")).toBeVisible();
    for (const id of ["notes", "calc", "clock", "files"]) await expectState(page, id, "floating");
    await expectRect(page, "notes", {x: 40, width: 420, height: 300});
    expect(await page.evaluate((key) => localStorage.getItem(key), BACKUP)).toBe(broken);
    await expect(page.locator("[data-status]")).toContainText("backup");
    // 这一页照常使用、照常保存：新的存档不再是坏的那份。
    await action(page, "notes", "minimize").click();
    await expectState(page, "notes", "minimized");
    expect((await saved(page)).windows.notes!.mode).toBe("minimized");
    expect(await page.evaluate((key) => localStorage.getItem(key), BACKUP)).toBe(broken);
});

test("视口缩小后浮动窗都在桌面里；视口变回来窗回原处；窗比桌面大时松手不把缩小的宽高写回", async ({page}) => {
    const originals = new Map<string, Rect>();
    for (const id of ["notes", "calc", "clock", "files"]) originals.set(id, (await rectNow(page, id))!);
    await page.setViewportSize({width: 800, height: 600});
    await settled(page);
    await expect.poll(async () => (await deskBox(page)).width).toBe(800);
    const small = await deskBox(page);
    for (const id of ["notes", "calc", "clock", "files"]) {
        const box = (await rectNow(page, id))!;
        expect(box.x).toBeGreaterThanOrEqual(small.x - 1);
        expect(box.y).toBeGreaterThanOrEqual(small.y - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(small.x + small.width + 1);
        expect(box.y + box.height).toBeLessThanOrEqual(small.y + small.height + 1);
    }
    await page.setViewportSize({width: 1440, height: 900});
    await settled(page);
    for (const [id, rect] of originals) await expectRect(page, id, rect);

    // 视口比 notes（420 宽）还窄：画出来的是缩小的；拖一下之后变回大视口，notes 仍是 420 宽。
    await page.setViewportSize({width: 360, height: 700});
    await expect.poll(async () => (await deskBox(page)).width).toBe(360);
    await expectRect(page, "notes", {x: 0, width: 360});
    const at = await centerOf(title(page, "notes"));
    await dragTo(page, title(page, "notes"), {x: at.x, y: at.y + 60}, "move");
    await settled(page);
    await page.setViewportSize({width: 1440, height: 900});
    await settled(page);
    await expectRect(page, "notes", {width: 420, height: 300});
});
