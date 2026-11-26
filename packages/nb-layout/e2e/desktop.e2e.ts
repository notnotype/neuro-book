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
 * - 实现审查之后又做的一轮（同样各改坏一处、只跑对应的用例）：
 *   - 状态行只显示一次性的状态、不回退到常驻的“这一页不保存”：“存档坏、备份也写不进”失败（成功的操作之后提示没了）。
 *   - 最小化与关闭之后不把焦点给底栏按钮：“最小化：底栏按钮状态变……”与“关闭：点底栏重新打开……”失败。
 *   - 底栏恢复放不下时不降级、照样平铺（模型单元测试里同一处也失败）：“平铺的窗最小化后点底栏，那一侧空着但视口窄到放不下”失败。
 * - 移动把夹过的宽高写回模型：“视口缩小后浮动窗都在桌面里……”失败（变回大视口后 notes 还是缩小的 360 宽）。
 * - 示例改用库的夹取、抬升、松手起点与 `animate` 之后的一轮（改的是库或示例，各改坏一处、重新构建、只跑对应的用例）：
 *   - `clampFloatRect` 不认区域的原点：“左侧有平铺窗时……浮动窗被夹在平铺窗右边”失败。
 *   - `resizeFloatRect` 忽略 `bounds.area`：“向桌面外拉大”失败。
 *   - 网格的手柄层恢复按 `floats` 的次序渲染：“聚焦最底下那扇窗的移动把手”失败（焦点丢了）。
 *   - 没做出能失败的变异：网格的 `float-raise` 只听冒泡阶段，“按住最底下的 notes 的缩放手柄”照过。手柄在 `pointerdown` 里阻止冒泡，
 *     但同时把焦点给自己，焦点进入照样请求抬升；只有按下（捕获阶段）那一次由 `NestedGrid.dom.test.ts` 按次数守着。
 *   - `decideMotion` 不并松手的起点（`releaseStarts`）：“松手到边缘：窗从松手的位置飞进那一侧”失败。
 *   - `settleFloatMoves` 不看 `animate`：“最大化与还原中途的矩形在两端之间”失败。
 *   - 桌面模型的 `resize` 写回整个矩形：“视口变窄后只拉高被夹的窗”失败（变回大视口后宽还是 360）。
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

/** 标题栏的按钮离窗的上边、右边各多远：库的缩放手柄带贴着窗的边往里 6px（上边 3px），按钮要在它们之外。 */
async function buttonGaps(page: Page, id: string): Promise<{top: number; right: number}> {
    return frame(page, id).evaluate((element) => {
        const box = element.getBoundingClientRect();
        const buttons = [...element.querySelectorAll("[data-window-action]")].map((button) => button.getBoundingClientRect());
        return {top: Math.min(...buttons.map((rect) => rect.top - box.top)), right: Math.min(...buttons.map((rect) => box.right - rect.right))};
    });
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
    for (const id of ["notes", "calc", "clock", "files"]) {
        const gaps = await buttonGaps(page, id);
        expect(gaps.top).toBeGreaterThanOrEqual(8);
        expect(gaps.right).toBeGreaterThanOrEqual(8);
        // 标题栏的样式与内容层让出的高度读同一个数：正文的顶边就是标题栏的底边，不盖住它、也不留缝。
        const bar = await boxOf(title(page, id));
        const body = await boxOf(text(page, id));
        expect(Math.abs(body.y - (bar.y + bar.height))).toBeLessThanOrEqual(1);
    }
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
    await expect.poll(async () => (await zOf(page, "notes")) - (await zOf(page, "files"))).toBeGreaterThan(0);
    expect((await saved(page)).order.at(-1)).toBe("notes");
    // 点标题栏（不是正文）同样挪到最上面。
    await title(page, "calc").click({position: {x: 100, y: 16}});
    await expect.poll(async () => (await zOf(page, "calc")) - (await zOf(page, "notes"))).toBeGreaterThan(0);

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

test("按住最底下的 notes 的缩放手柄：它到最上面，缩放照常", async ({page}) => {
    // notes 在最底下：抬升它要把别的三扇窗都排到它下面，手柄层不能因此搬节点，指针捕获也不能丢。
    expect(await zOf(page, "notes")).toBeLessThan(await zOf(page, "files"));
    const at = await centerOf(handle(page, "notes", "bottom-right"));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await expect.poll(async () => (await zOf(page, "notes")) - (await zOf(page, "files"))).toBeGreaterThan(0);
    await page.mouse.move(at.x + 30, at.y + 20, {steps: 4});
    await expectRect(page, "notes", {width: 450, height: 320});
    await page.mouse.up();
    await expectRect(page, "notes", {width: 450, height: 320});
    expect((await saved(page)).windows.notes!.floatRect).toMatchObject({width: 450, height: 320});
    expect((await saved(page)).order.at(-1)).toBe("notes");
});

test("聚焦最底下那扇窗的移动把手：它到最上面，焦点还在把手上", async ({page}) => {
    expect(await zOf(page, "notes")).toBeLessThan(await zOf(page, "files"));
    await moveHandle(page, "notes").focus();
    await expect.poll(async () => (await zOf(page, "notes")) - (await zOf(page, "files"))).toBeGreaterThan(0);
    expect((await saved(page)).order.at(-1)).toBe("notes");
    await twoFrames(page);
    await expect(moveHandle(page, "notes")).toBeFocused();
    // 焦点没丢，方向键照常移动这扇窗。
    await page.keyboard.press("ArrowRight");
    await expectRect(page, "notes", {x: 50, width: 420});
});

test("最大化与还原中途的矩形在两端之间：窗滑过去，不是一帧就到", async ({page}) => {
    // 过渡要真的在跑：时长为 0 时采样不到中间帧，用例会空过。
    await page.emulateMedia({reducedMotion: "no-preference"});
    const floating = await boxOf(frame(page, "notes"));
    const desk = await deskBox(page);
    /** 点 `name` 按钮之后逐帧记下 notes 的宽，直到过渡结束。 */
    async function widthsAfter(name: string): Promise<number[]> {
        await page.evaluate(() => {
            const win = window as unknown as {__widths: number[]; __sampling: boolean};
            win.__widths = [];
            win.__sampling = true;
            const sample = () => {
                const element = document.querySelector("[data-leaf='notes']");
                if (element !== null) win.__widths.push(element.getBoundingClientRect().width);
                if (win.__sampling) requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
        });
        await action(page, "notes", name).click();
        await expect(page.locator("[data-moving]").first()).toBeAttached();
        await settled(page);
        return page.evaluate(() => {
            const win = window as unknown as {__widths: number[]; __sampling: boolean};
            win.__sampling = false;
            return win.__widths;
        });
    }
    const between = (widths: number[]) => widths.filter((width) => width > floating.width + 20 && width < desk.width - 20);
    const growing = await widthsAfter("maximize");
    await expectState(page, "notes", "maximized");
    await expectRect(page, "notes", desk);
    expect(between(growing).length).toBeGreaterThan(0);
    const shrinking = await widthsAfter("maximize");
    await expectState(page, "notes", "floating");
    await expectRect(page, "notes", {x: floating.x, y: floating.y, width: 420, height: 300});
    expect(between(shrinking).length).toBeGreaterThan(0);
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
    await expect(dock(page, "notes")).toHaveAttribute("aria-label", "Notes, open");
    await action(page, "notes", "minimize").click();
    await expectState(page, "notes", "minimized");
    // 状态不只靠圆点的样式：按钮的名字带上它；标题栏的按钮随窗消失，焦点交给底栏上这扇窗的按钮。
    await expect(dock(page, "notes")).toHaveAttribute("aria-label", "Notes, minimized");
    await expect(dock(page, "notes")).toBeFocused();
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

test("平铺的窗最小化后点底栏，那一侧空着但视口窄到放不下：浮动，不留在最小化里", async ({page}) => {
    // 先贴 calc：notes 贴左后，calc 被夹到桌面左缘，标题栏会被 clock 盖住拖不到。
    await tile(page, "calc", "right");
    await tile(page, "notes", "left");
    await action(page, "notes", "minimize").click();
    await expectState(page, "notes", "minimized");
    await settled(page);
    // 窄到三块放不下（三个最小宽度 240 加分隔线），桌面加 calc 两块放得下。
    await page.setViewportSize({width: 700, height: 900});
    await settled(page);
    await dock(page, "notes").click();
    await expectState(page, "notes", "floating");
    await expect(frame(page, "notes")).toBeVisible();
    await expect(page.locator("[data-status]")).toHaveText("");
});

test("关闭：点底栏重新打开，打的字没了；键盘关掉平铺的窗，焦点同样给底栏按钮", async ({page}) => {
    await text(page, "clock").fill("gone after closing");
    await action(page, "clock", "close").click();
    await expectState(page, "clock", "closed");
    await expect(dock(page, "clock")).toHaveAttribute("aria-label", "Clock, closed");
    await expect(dock(page, "clock")).toBeFocused();
    await expect(frame(page, "clock")).toHaveCount(0);
    await expect(text(page, "clock")).toHaveCount(0);
    await dock(page, "clock").click();
    await expectState(page, "clock", "floating");
    await expect(text(page, "clock")).toHaveValue("");
    await settled(page);
    await expectRect(page, "clock", {x: 860, width: 300, height: 220});
    // 重新打开的窗在最上面。
    expect(await zOf(page, "clock")).toBeGreaterThan(await zOf(page, "files"));

    // 平铺的窗：聚焦标题栏的按钮、按回车关掉，焦点还是给底栏上这扇窗的按钮。
    await tile(page, "notes", "left");
    await expect(dock(page, "notes")).toHaveAttribute("aria-label", "Notes, tiled left");
    await action(page, "notes", "close").focus();
    await page.keyboard.press("Enter");
    await expectState(page, "notes", "closed");
    await expect(dock(page, "notes")).toBeFocused();
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

test("松手到边缘：窗从松手的位置飞进那一侧，不先跳回按下之前的位置；投影与圆角随过渡淡去", async ({page}) => {
    // 过渡要真的在跑：时长为 0 时采样不到中间帧，用例会空过。
    await page.emulateMedia({reducedMotion: "no-preference"});
    const pressed = await boxOf(frame(page, "notes"));
    await pickUp(page, title(page, "notes"));
    await moveTo(page, {x: 10, y: 450}, "tile:left");
    const dropped = await boxOf(frame(page, "notes"));
    // 松手后每一帧都记下窗外框的矩形，直到平铺完成、过渡结束。示例在松手的同一拍里改树，起点靠网格记着的最后偏移；
    // 采样本身会读布局、强制浏览器算样式，所以从松手那一刻之后才开始：它的 `pointerup` 监听挂在 window 的冒泡阶段，晚于示例的提交。
    // 投影与圆角按外框的计算样式读，不按 `data-float` 挑帧：从松手处出发时，外框还画成窗的那一次渲染在第一帧之前。
    await page.evaluate(() => {
        const win = window as unknown as {__frames: {y: number; height: number; radius: number; shadow: string}[]; __sampling: boolean};
        win.__frames = [];
        win.__sampling = true;
        const sample = () => {
            const element = document.querySelector("[data-leaf='notes']");
            if (element !== null) {
                const {y, height} = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                win.__frames.push({y, height, radius: Number.parseFloat(style.borderTopLeftRadius), shadow: style.boxShadow});
            }
            if (win.__sampling) requestAnimationFrame(sample);
        };
        window.addEventListener("pointerup", () => requestAnimationFrame(sample), {once: true});
    });
    await page.mouse.up();
    await expectState(page, "notes", "tiled-left");
    await expect(page.locator("[data-moving]").first()).toBeAttached();
    await settled(page);
    const frames = await page.evaluate(() => {
        const win = window as unknown as {__frames: {y: number; height: number; radius: number; shadow: string}[]; __sampling: boolean};
        win.__sampling = false;
        return win.__frames;
    });
    // 窗从松手处出发：松手处到按下之前的位置隔得远，所以“第一帧离哪个近”能区分两种起点。
    expect(Math.abs(dropped.y - pressed.y)).toBeGreaterThan(200);
    const first = frames.findIndex((each) => Math.abs(each.y - dropped.y) > 1);
    expect(first).toBeGreaterThanOrEqual(0);
    const start = frames[first]!;
    expect(Math.abs(start.y - dropped.y)).toBeLessThan(Math.abs(start.y - pressed.y));
    // 之后还有几帧才到终点：确实是在飞，不是一帧就到。
    expect(frames.length - first).toBeGreaterThanOrEqual(4);
    // 窗的投影与圆角随过渡淡去：松手后第一帧还是卡片，圆角一路只减不增，走完才没。
    expect(frames[0]!.radius).toBeGreaterThan(0);
    expect(frames[0]!.shadow).not.toBe("none");
    for (let index = 1; index < frames.length; index += 1) expect(frames[index]!.radius).toBeLessThanOrEqual(frames[index - 1]!.radius + 0.01);
    expect(frames.at(-1)!.radius).toBe(0);
    expect(frames.at(-1)!.shadow).toBe("none");
});

test("拖平铺窗与桌面之间的分隔线：浮动窗跟着让进桌面，手势不被打断，松手不跳", async ({page}) => {
    await tile(page, "notes", "left");
    // calc 原在 x=500，平铺之后被夹在桌面的左缘。
    await expectRect(page, "calc", {x: (await deskBox(page)).x});
    const side = page.locator("[data-sash^='tile-']");
    const at = await centerOf(side);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 100, at.y, {steps: 6});
    // 预览中桌面左缘右移 100，calc 跟着它。
    const previewDesk = await deskBox(page);
    await expectRect(page, "calc", {x: previewDesk.x});
    await page.evaluate(() => {
        const win = window as unknown as {__xs: number[]; __sampling: boolean};
        win.__xs = [];
        win.__sampling = true;
        const sample = () => {
            const element = document.querySelector("[data-leaf='calc']");
            if (element !== null) win.__xs.push(element.getBoundingClientRect().x);
            if (win.__sampling) requestAnimationFrame(sample);
        };
        window.addEventListener("pointerup", () => requestAnimationFrame(sample), {once: true});
    });
    await page.mouse.up();
    await settled(page);
    await twoFrames(page);
    const xs = await page.evaluate(() => {
        const win = window as unknown as {__xs: number[]; __sampling: boolean};
        win.__sampling = false;
        return win.__xs;
    });
    // 手势没被浮动窗的变化取消：分隔线停在松手处。
    await expectRect(page, "notes", {width: 818});
    await expectRect(page, "desktop", {x: previewDesk.x});
    // 松手之后每一帧 calc 都在预览时的位置，没有先跳回去再回来。
    expect(xs.length).toBeGreaterThan(0);
    for (const x of xs) expect(Math.abs(x - previewDesk.x)).toBeLessThanOrEqual(1);
});

test("视口变窄后只拉高被夹的窗：视口变回来，宽是记录的，高是拉过的", async ({page}) => {
    // 先把 notes 挪到最上面：视口窄了，别的窗被夹过来会盖住它的下边。
    await text(page, "notes").click({position: {x: 40, y: 20}});
    await page.setViewportSize({width: 360, height: 700});
    await expect.poll(async () => (await deskBox(page)).width).toBe(360);
    await expectRect(page, "notes", {x: 0, width: 360, height: 300});
    const at = await centerOf(handle(page, "notes", "bottom"));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x, at.y + 40, {steps: 4});
    await expectRect(page, "notes", {width: 360, height: 340});
    await page.mouse.up();
    await settled(page);
    expect((await saved(page)).windows.notes!.floatRect).toMatchObject({width: 420, height: 340});
    await page.setViewportSize({width: 1440, height: 900});
    await settled(page);
    await expectRect(page, "notes", {width: 420, height: 340});
});

test("视口矮到窗比最小高度还矮时横拖右边：高度不撑回最小尺寸，预览不盖住底栏", async ({page}) => {
    await page.setViewportSize({width: 1250, height: 220});
    await settled(page);
    const desk = await deskBox(page);
    const start = await boxOf(frame(page, "files"));
    // 前提：files 被夹到比最小高度 160 还矮。
    expect(start.height).toBeLessThan(160);
    const at = await centerOf(handle(page, "files", "right"));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 27, at.y, {steps: 4});
    await expectRect(page, "files", {x: start.x, y: start.y, width: start.width + 27, height: start.height});
    const preview = await boxOf(frame(page, "files"));
    expect(preview.y + preview.height).toBeLessThanOrEqual(desk.y + desk.height + 1);
    // 窗正下方的底栏上那一点命中的是底栏，不是 files。
    const bar = await boxOf(page.locator(".taskbar"));
    const hit = await page.evaluate(({x, y}) => {
        const element = document.elementFromPoint(x, y);
        return {files: element?.closest("[data-leaf='files']") != null, bar: element?.closest(".taskbar") != null};
    }, {x: preview.x + preview.width / 2, y: bar.y + bar.height / 2});
    expect(hit).toEqual({files: false, bar: true});
    await page.mouse.up();
    await settled(page);
    await expectRect(page, "files", {width: start.width + 27, height: start.height});
    // 只写回横向：记录的高还是 300。
    expect((await saved(page)).windows.files!.floatRect).toMatchObject({width: 480 + 27, height: 300});
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
    // 窗停在松手处：指针在桌面下沿以外，窗被夹到桌面的底边；右边不出桌面。没有弹回按下之前的位置。
    const desk = await deskBox(page);
    expect(before.y).toBeLessThan(desk.y + desk.height - 300 - 50);
    await expectRect(page, "files", {y: desk.y + desk.height - 300, height: 300});
    const after = await boxOf(frame(page, "files"));
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

test("存档坏、备份也写不进：这一页不再保存，提示一直挂着，成功的操作也清不掉它，原件留在主键", async ({page}) => {
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
    // 一次成功的操作（它会清掉一次性的状态）之后，常驻的说明还在；主键仍是坏档原文。
    await action(page, "notes", "minimize").click();
    await expectState(page, "notes", "minimized");
    await expect(page.locator("[data-status]")).toContainText("changes will not be kept");
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe("{not json");
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
    // 先把 notes 挪到最上面：视口窄了，别的窗被夹过来会盖住它的标题栏。
    await text(page, "notes").click({position: {x: 40, y: 20}});
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
