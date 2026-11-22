/**
 * 并排看两张详情（docs/specs/story/viewer.md 输出 66、67、69）：Ctrl 点与右键“在旁边打开”、普通点击换哪一张、关一张、整块收起、
 * 两条线的拖动、窄档、地址。生产构建的网页，真实的 `nbstory serve`，100 章样例书，本机 Chrome。
 *
 * 详情一栏是网格里的一个分支（`details`），里面两块叶 `drawer`、`drawer2`；每张详情画在内容层，外壳带 `data-detail-index`（0 左 1 右）。
 * 每条用例的地址都写明人物卡的参数（按组取），不受上一条存下的阅读状态影响。
 */

import {expect, test, type Locator, type Page} from "@playwright/test";

import {login, makeLibrary, startServe, type StoryServer} from "./fixtures";

let server: StoryServer;
let cleanup: () => Promise<void>;

test.beforeAll(async () => {
    const library = await makeLibrary("side-by-side");
    cleanup = library.cleanup;
    server = await startServe(library.library);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    await cleanup();
});

test.beforeEach(async ({context}) => {
    await login(context, server);
});

const LIN = "苏天晴";
const NAN = "南嘉鱼";

async function open(page: Page, path: string): Promise<void> {
    await page.goto(`${server.base}${path}`);
    await expect(page.getByTestId("book-frame")).toBeVisible();
}
function leaf(page: Page, id: "main" | "drawer" | "drawer2"): Locator {
    return page.locator(`[data-testid='book-frame'] [data-leaf='${id}']`);
}
/** 一张详情的外壳（0 左 1 右）；关掉之后在过渡里留着的不算。 */
function card(page: Page, index: 0 | 1): Locator {
    return page.locator(`[data-content]:not([data-content-leaving]) [data-testid='drawer'][data-detail-index='${index}']`);
}
async function width(locator: Locator): Promise<number> {
    return Math.round((await locator.boundingBox())?.width ?? 0);
}
async function widths(page: Page) {
    return {main: await width(leaf(page, "main")), drawer: await width(leaf(page, "drawer")), drawer2: await width(leaf(page, "drawer2"))};
}
/** 主区里那个人的名字（总览页把主要人物写成可点的名字）。 */
function nameInMain(page: Page, label: string): Locator {
    return page.getByTestId("main").getByRole("button", {name: label, exact: true}).first();
}
async function openBeside(page: Page, label: string): Promise<void> {
    await nameInMain(page, label).click({modifiers: ["ControlOrMeta"]});
}
async function pref(page: Page): Promise<string | null> {
    return page.evaluate(() => localStorage.getItem("nbstory:drawer-width"));
}
async function drag(page: Page, handle: Locator, dx: number): Promise<void> {
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, {steps: 12});
    await page.mouse.up();
}
const mainSash = (page: Page) => page.getByRole("separator", {name: "调整 正文 与 详情 的宽度"});
const innerSash = (page: Page) => page.getByRole("separator", {name: "调整 左边的详情 与 右边的详情 的宽度"});
/** 过渡中的项（带 `data-moving`）；数到 0 就是走完了。 */
const settled = (page: Page) => page.locator("[data-testid='book-frame'] [data-moving]");
/** 每一项与期望差不超过 1 像素（拖动落账有取整）。 */
function near(actual: Record<string, number>, expected: Record<string, number>): boolean {
    return Object.entries(expected).every(([key, value]) => Math.abs((actual[key] ?? Number.NaN) - value) <= 1);
}
const activeElement = (page: Page) => page.evaluate(() => ({testid: document.activeElement?.getAttribute("data-testid") ?? null, index: document.activeElement?.getAttribute("data-detail-index") ?? null}));

test.describe("宽屏 1440", () => {
    test.use({viewport: {width: 1440, height: 900}});

    test("Ctrl 点名字开第二张：两张各 400、主区 449；再 Ctrl 点换掉不是最近的那张；对已开着的人 Ctrl 点只让它成为最近的", async ({page}) => {
        await open(page, "/book/fox/overview?at=38.57&entity=e1-1");
        await expect(card(page, 0).getByTestId("card-name")).toHaveText(LIN);
        await openBeside(page, NAN);
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(NAN);
        await expect.poll(() => widths(page)).toEqual({main: 449, drawer: 400, drawer2: 400});
        await expect(card(page, 1)).toHaveAttribute("aria-current", "true");
        await expect(card(page, 0)).toHaveAttribute("aria-label", "左边的详情");
        await expect(innerSash(page)).toBeVisible();
        // 对已开着的苏天晴 Ctrl 点：不新开，只让左边那张成为最近的。
        await openBeside(page, LIN);
        await expect(card(page, 0)).toHaveAttribute("aria-current", "true");
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(NAN);
    });

    test("普通点击换最近点过的那张；在右边那张里滚一下也算最近；卡内切页签外壳不重挂", async ({page}) => {
        await open(page, "/book/fox/overview?at=38.57&entity=e1-1&entity2=e8-2");
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(NAN);
        await card(page, 0).hover();
        await page.mouse.wheel(0, 40);
        await expect(card(page, 0)).toHaveAttribute("aria-current", "true");
        const shell = await card(page, 1).elementHandle();
        await card(page, 1).getByRole("tab", {name: /关系/u}).click();
        await expect(card(page, 1)).toHaveAttribute("aria-current", "true");
        expect(await shell!.evaluate((element) => element.isConnected)).toBe(true);
        await expect(page).toHaveURL(/tab2=relations/u);
    });

    test("名字右键“在旁边打开”", async ({page}) => {
        await open(page, "/book/fox/overview?at=38.57&entity=e1-1");
        await nameInMain(page, NAN).click({button: "right"});
        await page.getByRole("menuitem", {name: "在旁边打开"}).click();
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(NAN);
    });

    test("关右边那张：回到一张 400、主区 850，焦点在剩下那张；关左边那张：右边那张占满、位置不变、元素还连着；关最后一张焦点到主区", async ({page}) => {
        await open(page, "/book/fox/overview?at=38.57&entity=e1-1&entity2=e8-2");
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(NAN);
        await card(page, 1).getByRole("button", {name: "关闭"}).click();
        await expect.poll(() => widths(page)).toEqual({main: 850, drawer: 400, drawer2: 0});
        expect(await activeElement(page)).toEqual({testid: "drawer", index: "0"});

        await openBeside(page, NAN);
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(NAN);
        // 量位置要等过渡走完：开第二张时它从 0 长出来，内容跟着外框飞。
        await expect.poll(() => widths(page)).toEqual({main: 449, drawer: 400, drawer2: 400});
        await expect(settled(page)).toHaveCount(0);
        const right = await card(page, 1).elementHandle();
        const before = (await card(page, 1).boundingBox())!;
        await card(page, 0).getByRole("button", {name: "关闭"}).click();
        await expect(card(page, 0).getByTestId("card-name")).toHaveText(NAN);
        await expect.poll(() => widths(page)).toEqual({main: 850, drawer: 400, drawer2: 0});
        await expect(settled(page)).toHaveCount(0);
        const after = (await card(page, 0).boundingBox())!;
        expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
        expect(await right!.evaluate((element) => element.isConnected)).toBe(true);
        expect(await activeElement(page)).toEqual({testid: "drawer", index: "0"});

        await card(page, 0).getByRole("button", {name: "关闭"}).click();
        await expect.poll(() => width(leaf(page, "drawer"))).toBe(0);
        expect((await activeElement(page)).testid).toBe("main");
    });

    test("顶栏开关：两张一起收起，过渡中两张都还画着；再展开两张一起回来", async ({page}) => {
        await open(page, "/book/fox/overview?at=38.57&entity=e1-1&entity2=e8-2");
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(NAN);
        await page.evaluate(() => {
            const frames: number[] = [];
            (window as unknown as {__cards: number[]}).__cards = frames;
            const start = performance.now();
            const step = () => {
                const shown = [...document.querySelectorAll<HTMLElement>("[data-content] [data-testid='card-name']")].filter((element) => element.getBoundingClientRect().width > 0);
                const width = document.querySelector("[data-leaf='drawer']")?.getBoundingClientRect().width ?? 0;
                if (width > 0) frames.push(shown.length);
                if (performance.now() - start < 1500) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
        await page.getByTestId("toggle-drawer").click();
        await expect.poll(() => width(leaf(page, "drawer"))).toBe(0);
        const frames = await page.evaluate(() => (window as unknown as {__cards: number[]}).__cards);
        expect(frames.length).toBeGreaterThan(3);
        expect(frames.every((count) => count === 2)).toBe(true);
        await page.getByTestId("toggle-drawer").click();
        await expect.poll(() => widths(page)).toEqual({main: 449, drawer: 400, drawer2: 400});
        await expect(card(page, 0).getByTestId("card-name")).toHaveText(LIN);
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(NAN);
    });

    test("中间那条线：两张宽度变、偏好不变、拖到底停在 280；主区那条线：两张一起变宽、偏好记一张的宽度，点一下另一张不弹回；拖到 0 两张一起收起、拖开都回来", async ({page}) => {
        await open(page, "/book/fox/overview?at=38.57&entity=e1-1&entity2=e8-2");
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(NAN);
        const prefBefore = await pref(page);
        await drag(page, innerSash(page), 60);
        await expect.poll(() => widths(page)).toEqual({main: 449, drawer: 460, drawer2: 340});
        expect(await pref(page)).toBe(prefBefore);
        await drag(page, innerSash(page), 300);
        await expect.poll(async () => (await widths(page)).drawer2).toBe(280);

        await drag(page, innerSash(page), -120);
        await expect.poll(async () => near(await widths(page), {drawer: 400, drawer2: 400})).toBe(true);
        await drag(page, mainSash(page), -60);
        await expect.poll(async () => near(await widths(page), {main: 389, drawer: 430, drawer2: 430})).toBe(true);
        expect(Math.abs(Number(await pref(page)) - 430)).toBeLessThanOrEqual(1);
        const dragged = await widths(page);
        // 点一下左边那张（成为最近的）：张数没变，宽度不弹回偏好。
        await card(page, 0).getByTestId("card-name").click();
        await expect(card(page, 0)).toHaveAttribute("aria-current", "true");
        expect(await widths(page)).toEqual(dragged);

        await drag(page, mainSash(page), 1000);
        await expect.poll(() => width(leaf(page, "drawer"))).toBe(0);
        await expect(card(page, 0)).toHaveCount(0);
        await drag(page, mainSash(page), -700);
        await expect(card(page, 0).getByTestId("card-name")).toHaveText(LIN);
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(NAN);
    });

    /** 按住一张的名字那一行，拖到 `to`（视口坐标），中途停一下看反馈；`release` 为假时按 Escape 取消。 */
    async function dragHead(page: Page, from: 0 | 1, to: {x: number; y: number}, release = true): Promise<void> {
        const head = card(page, from).locator("[data-detail-handle]").first();
        const box = (await head.boundingBox())!;
        // 按在把手的空白处，不按在名字（名字不是按钮，但避开右边的按钮）。
        await page.mouse.move(box.x + 8, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, {steps: 15});
        if (release) await page.mouse.up();
    }
    const centerOf = async (locator: Locator) => {
        const box = (await locator.boundingBox())!;
        return {x: box.x + box.width / 2, y: box.y + box.height / 2};
    };

    test("拖右边那张的头到左边：落点盖在左边那张上、标题小块跟手，松手对调，元素还连着，地址跟着对调", async ({page}) => {
        await open(page, "/book/fox/overview?at=38.57&entity=e1-1&entity2=e8-2");
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(NAN);
        const moved = await card(page, 1).elementHandle();
        await dragHead(page, 1, await centerOf(card(page, 0)), false);
        await expect(page.locator("[data-drop-feedback-area]")).toBeVisible();
        await expect(page.getByTestId("swap-chip")).toContainText(NAN);
        await page.mouse.up();
        await expect(card(page, 0).getByTestId("card-name")).toHaveText(NAN);
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(LIN);
        expect(await moved!.evaluate((element) => element.isConnected)).toBe(true);
        await expect(card(page, 0)).toHaveAttribute("aria-current", "true");
        await expect(page).toHaveURL(/entity=e8-2&.*entity2=e1-1/u);
    });

    test("拖到自己那一栏、拖到主区松手都不动；Escape 取消；点头部的关闭按钮不起拖；只有一张时不起拖", async ({page}) => {
        await open(page, "/book/fox/overview?at=38.57&entity=e1-1&entity2=e8-2");
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(NAN);
        await dragHead(page, 1, await centerOf(card(page, 1)));
        await dragHead(page, 1, await centerOf(leaf(page, "main")));
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(NAN);
        await dragHead(page, 1, await centerOf(card(page, 0)), false);
        await expect(page.locator("[data-drop-feedback-area]")).toBeVisible();
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(NAN);
        await expect(page.getByTestId("swap-chip")).toHaveCount(0);

        const close = card(page, 1).getByRole("button", {name: "关闭"});
        const box = (await close.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x - 300, box.y + 40, {steps: 10});
        await expect(page.getByTestId("swap-chip")).toHaveCount(0);
        await page.mouse.up();

        await open(page, "/book/fox/overview?at=38.57&entity=e1-1");
        await expect(card(page, 0).getByTestId("card-name")).toHaveText(LIN);
        await dragHead(page, 0, await centerOf(leaf(page, "main")), false);
        await expect(page.getByTestId("swap-chip")).toHaveCount(0);
        await page.mouse.up();
    });

    test("不靠拖动的对调：人物卡“⋯”菜单里的“与另一张对调”", async ({page}) => {
        await open(page, "/book/fox/overview?at=38.57&entity=e1-1&entity2=e8-2");
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(NAN);
        await card(page, 1).getByTestId("card-revise-menu").click();
        await page.getByRole("menuitem", {name: "与另一张对调"}).click();
        await expect(card(page, 0).getByTestId("card-name")).toHaveText(NAN);
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(LIN);
    });

    test("地址带 entity2、tab2：刷新后仍并排，两张一样", async ({page}) => {
        await open(page, "/book/fox/overview?at=38.57&entity=e1-1&entity2=e8-2&tab2=records");
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(NAN);
        await page.reload();
        await expect(card(page, 0).getByTestId("card-name")).toHaveText(LIN);
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(NAN);
        await expect(page).toHaveURL(/entity2=e8-2&tab2=records/u);
    });

    test("两张开着没有横向溢出", async ({page}) => {
        await open(page, "/book/fox/overview?at=38.57&entity=e1-1&entity2=e8-2");
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(NAN);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
});

for (const viewport of [{width: 1280, height: 800}, {width: 1100, height: 800}]) {
    test.describe(`窗口 ${String(viewport.width)}`, () => {
        test.use({viewport});

        test("Ctrl 点照样并排：两张各不小于 280、主区 360（网格压缩），没有横向溢出", async ({page}) => {
            await open(page, "/book/fox/overview?at=38.57&entity=e1-1");
            await openBeside(page, NAN);
            await expect(card(page, 1).getByTestId("card-name")).toHaveText(NAN);
            await expect.poll(async () => (await widths(page)).main).toBe(360);
            const now = await widths(page);
            expect(now.drawer).toBeGreaterThanOrEqual(280);
            expect(now.drawer2).toBeGreaterThanOrEqual(280);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        });
    });
}

test.describe("平板 1024", () => {
    test.use({viewport: {width: 1024, height: 768}});

    test("只显示最近点过的那张；Ctrl 点等于普通打开；回到宽屏两张回来", async ({page}) => {
        await open(page, "/book/fox/overview?at=38.57&entity=e1-1&entity2=e8-2");
        await expect(page.getByTestId("drawer").getByTestId("card-name")).toHaveText(NAN);
        await expect(page.getByTestId("drawer")).toHaveCount(1);
        await page.getByTestId("drawer-scrim").click();
        await openBeside(page, LIN);
        await expect(page.getByTestId("drawer").getByTestId("card-name")).toHaveText(LIN);
        await page.setViewportSize({width: 1440, height: 900});
        await expect(card(page, 0).getByTestId("card-name")).toHaveText(LIN);
        await expect(card(page, 1).getByTestId("card-name")).toHaveText(NAN);
    });
});
