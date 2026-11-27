/**
 * 一棵树的工作台表面（docs/specs/ui/workbench-layout.md 的“渲染”“面板头与活动栏”）：夹具是 `workbench/web/lab/WorkbenchSurfaceFixture.vue`，文档、呈现树、有效可见、活动栏条目都用产品的纯函数算。
 */

import {rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {LabDebugState} from "nbook/plugins/lab/shared/debug-api";

import {startDevSession} from "./fixtures";
import {pressEntry} from "./support/press-entry";
import type {DevSession} from "./fixtures";

let tmp = "";
let dev: DevSession;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-workbench-surface");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const labState = (page: Page) => page.evaluate(() => (window as unknown as {__nbLab?: {state(): LabDebugState}}).__nbLab?.state() ?? null);

async function open(page: Page, scene = "default", theme = "nbook"): Promise<void> {
    await page.setViewportSize({width: 1440, height: 800});
    await page.goto(`${dev.pageUrl}lab?c=WorkbenchSurface&s=${scene}&theme=${theme}&cw=light&vp=1400x720`);
    await expect.poll(async () => (await labState(page))?.ready).toBe(true);
    await expect(page.locator("[data-content='view:a']")).toBeVisible();
}

const act = (page: Page, name: string) => page.locator(`[data-surface-action="${name}"]`).click();
/** 区域隐藏了：按拖到零画（ui/workbench-layout 输出 11），那块外框还在、缩到面积为零。等到零也就等过渡走完了。 */
const shrunk = (page: Page, id: string) => expect.poll(async () => {
    const found = await page.locator(`[data-leaf='${id}']`).boundingBox();
    return found === null ? 0 : Math.round(found.width * found.height);
}).toBe(0);

const fixture = (page: Page) => page.locator(".workbench-surface-fixture");
const visibleTabs = async (page: Page) => ((await fixture(page).getAttribute("data-visible-tabs")) ?? "").split(" ").filter((tab) => tab !== "");
/** 活动栏入口：一个容器一个（输出 22、41）；这里的视图都没写容器，入口是隐式容器 `view:<视图 id>`。 */
const entry = (page: Page, viewId: string) => page.locator(`[data-tool-entry="view:${viewId}"]`);

/** 视图的分节：区域里一个视图一个分节（输出 40），id 是 `section:<视图 id>`。 */
const section = (viewId: string): string => `section:${viewId}`;
const frameButton = (page: Page, panel: string, action: string) => page.locator(`[data-panel-head="${panel}"] [data-panel-action="${action}"]`);
/** 能收成标题行的分节的标题：整行是展开、收起的开关（输出 20）。 */
const foldTitle = (page: Page, panel: string) => page.locator(`[data-panel-head="${panel}"] [data-panel-tab][aria-expanded]`);

const rectOf = (page: Page, selector: string) => page.evaluate((target) => {
    const {x, y, width, height} = document.querySelector(target)!.getBoundingClientRect();
    return {x, y, width, height};
}, selector);

test.describe("面板头", () => {
    test("分节的头 32px 一行，顺序是标题、视图动作、框架按钮；分节没有隐藏按钮（输出 20）", async ({page}) => {
        await open(page);
        const head = `[data-panel-head='${section("a")}']`;
        expect((await rectOf(page, head)).height).toBe(32);
        // 按画出来的位置比先后：标题、视图动作、框架按钮。
        const leftOf = (selector: string) => page.locator(`${head} ${selector}`).first().evaluate((element) => element.getBoundingClientRect().left);
        expect(await leftOf("[data-panel-tab]")).toBeLessThan(await leftOf("[data-view-action]"));
        expect(await leftOf("[data-view-action]")).toBeLessThan(await leftOf("[data-panel-action]"));
        // 只写标题：没有标签带。
        await expect(page.locator(`${head} [role='tablist']`)).toHaveCount(0);
        // 框架按钮只有最大化：收起不是按钮，是标题行（输出 20）。
        await expect(page.locator(`${head} [data-panel-action]`)).toHaveCount(1);
        // 隐藏是区域的事：哪个分节的头上都没有隐藏按钮。
        await act(page, "c-to-new-panel");
        await expect(page.locator("[data-panel-head]:has([data-panel-tab='view:c'])")).toBeVisible();
        await expect(page.locator("[data-panel-action='hide']")).toHaveCount(0);
    });

    test("内容是以标题命名的 region；切换容器换内容，实例不重建；右键标题发给宿主（输出 20、42）", async ({page}) => {
        await open(page);
        const title = page.locator("[data-panel-tab='view:a']");
        const region = page.locator("[data-content='view:a'] [role='region'], [data-content='view:a'][role='region']").first();
        await expect(region).toHaveCount(1);
        await expect(region).toHaveAccessibleName("视图 A");

        const instance = await page.locator("[data-content='view:a'] [data-structure-leaf]").getAttribute("data-structure-instance");
        await pressEntry(page, entry(page, "b"));
        await expect(page.locator("[data-content='view:b']")).toBeVisible();
        await expect(page.locator("[data-content='view:a']")).toBeHidden();
        await pressEntry(page, entry(page, "a"));
        await expect(page.locator("[data-content='view:a']")).toBeVisible();
        expect(await page.locator("[data-content='view:a'] [data-structure-leaf]").getAttribute("data-structure-instance")).toBe(instance);

        await title.click({button: "right"});
        await expect(fixture(page)).toHaveAttribute("data-last-menu", "view:a");
    });

    test("菜单键打开标题的菜单", async ({page}) => {
        await open(page);
        await page.locator("[data-panel-tab='view:a']").focus();
        await page.keyboard.press("ContextMenu");
        await expect(fixture(page)).toHaveAttribute("data-last-menu", "view:a");
    });

    test("视图动作随鼠标显示，范围是整块面板：外框和内容都算，别的面板不算", async ({page}) => {
        await open(page);
        const head = `[data-panel-head='${section("a")}']`;
        const action = page.locator(`${head} [data-hover-actions=""]`);
        const opacity = () => action.evaluate((element) => getComputedStyle(element).opacity);

        await page.locator("[data-content='view:c']").hover();
        await expect.poll(opacity).toBe("0");

        await page.locator("[data-content='view:a']").hover();
        await expect.poll(opacity).toBe("1");

        await page.locator(head).hover();
        await expect.poll(opacity).toBe("1");

        await page.locator("[data-content='view:c']").hover();
        await expect.poll(opacity).toBe("0");

        // 焦点在内容里时，指针走开也还显示。
        await page.locator("[data-content='view:a'] [data-structure-first]").focus();
        await expect.poll(opacity).toBe("1");
    });
});

test.describe("视图的标题区（docs/specs/workbench/views.md 输出 19）", () => {
    test("视图接管时三列：左右是视图的按钮、中间的标题按钮写视图给的文字且仍是拖动源，框架按钮在右列；区域的名称仍是视图标题", async ({page}) => {
        await open(page, "view-head");
        const head = page.locator("[data-panel-head]:has([data-panel-tab='view:c'])");
        const handle = head.locator("[data-panel-tab='view:c']");
        // 拖动描述由外壳给（这个夹具没给），是否带上由面板头的组件测试守着。
        await expect(handle).toHaveAccessibleName("第三章节奏调整");
        await expect(head.locator("[data-panel-head-start]").getByRole("button", {name: "新建对话"})).toBeVisible();
        await expect(head.locator("[data-panel-head-end]").getByRole("button", {name: "更多"})).toBeVisible();
        const leftOf = (locator: ReturnType<Page["locator"]>) => locator.first().evaluate((element) => element.getBoundingClientRect().left);
        expect(await leftOf(head.locator("[data-panel-head-end]"))).toBeLessThan(await leftOf(head.locator("[data-panel-action]")));
        const region = page.locator("[data-content='view:c'] [role='region'], [data-content='view:c'][role='region']").first();
        await expect(region).toHaveAccessibleName("视图 C");
        // 标题按整行居中：按钮中线离面板头中线不超过 1px。
        const centre = (box: {x: number; width: number} | null) => (box === null ? Number.NaN : box.x + box.width / 2);
        expect(Math.abs(centre(await handle.boundingBox()) - centre(await head.boundingBox()))).toBeLessThanOrEqual(1);
    });
});

test.describe("内容跟着视图走", () => {
    test("A 的容器搬到右栏：同一块分节、实例不重建，内容在它新的矩形里；右栏切到它，侧栏切到 B（输出 27、44）", async ({page}) => {
        await open(page);
        const instance = await page.locator("[data-content='view:a'] [data-structure-leaf]").getAttribute("data-structure-instance");
        await page.locator("[data-content='view:a'] [data-structure-input]").fill("写到一半");

        await act(page, "a-to-right");
        await expect(page.locator(`[data-panel-head='${section("a")}'] [data-panel-tab='view:a']`)).toBeVisible();
        await expect(page.locator("[data-content='view:a']")).toHaveAttribute("data-content-leaf", section("a"));
        expect(await page.locator("[data-content='view:a'] [data-structure-leaf]").getAttribute("data-structure-instance")).toBe(instance);
        await expect(page.locator("[data-content='view:a'] [data-structure-input]")).toHaveValue("写到一半");

        // 在右栏：在编辑组右边。
        const moved = await rectOf(page, `[data-leaf='${section("a")}']`);
        const editor = await rectOf(page, "[data-leaf='g1']");
        expect(moved.x).toBeGreaterThanOrEqual(editor.x + editor.width - 1);
        const content = await rectOf(page, "[data-content='view:a']");
        expect(content.x).toBe(moved.x);
        // 右栏的入口在右轨上（输出 50），没有顶上的入口条：A 的头画在它自己的叶里，内容在头的下面；右轨的入口带里 A 的容器按下着。
        await expect(page.locator("[data-region-strip='auxiliarybar']")).toHaveCount(0);
        await expect(page.locator(`[data-leaf='${section("a")}'] [data-panel-head='${section("a")}']`)).toHaveCount(1);
        expect(content.y).toBeGreaterThan(moved.y);
        await expect(page.locator("[data-rail=auxiliarybar] [data-tool-band] [data-tool-entry='view:a']")).toHaveAttribute("aria-pressed", "true");
        await expect.poll(() => visibleTabs(page)).toEqual(expect.arrayContaining(["view:a", "view:b"]));
        expect(await visibleTabs(page)).not.toContain("view:c");
    });
});

test.describe("有效可见", () => {
    test("只有当前容器的分节；收起、区域隐藏、被最大化盖住都不算，再回来（输出 17）", async ({page}) => {
        await open(page);
        expect(await visibleTabs(page)).toEqual(expect.arrayContaining(["view:a", "view:c", "view:e"]));
        expect(await visibleTabs(page)).not.toContain("view:b");
        expect(await visibleTabs(page)).not.toContain("view:d");

        // 收成标题行只给侧栏、右栏里不止一节的容器（输出 12、20）：D 成为 B 那个容器的第二节，侧栏切到 B。
        await act(page, "d-below-b");
        await expect.poll(() => visibleTabs(page)).toEqual(expect.arrayContaining(["view:b", "view:d"]));
        await foldTitle(page, section("b")).click();
        await expect.poll(() => visibleTabs(page)).not.toContain("view:b");
        expect((await rectOf(page, `[data-leaf='${section("b")}']`)).height).toBe(32);
        // 两节都收起：D 垫底、外框拉到底，仍不算可见（输出 11）。
        await foldTitle(page, section("d")).click();
        await expect.poll(() => visibleTabs(page)).not.toContain("view:d");
        expect((await rectOf(page, `[data-leaf='${section("d")}']`)).height).toBeGreaterThan(32);
        await foldTitle(page, section("d")).click();
        await foldTitle(page, section("b")).click();
        await expect.poll(() => visibleTabs(page)).toEqual(expect.arrayContaining(["view:b", "view:d"]));

        // 点当前容器按下着的入口：侧栏隐藏（输出 22）。
        await pressEntry(page, entry(page, "b"));
        await expect.poll(() => visibleTabs(page)).not.toContain("view:b");
        expect(await visibleTabs(page)).not.toContain("view:d");
        await shrunk(page, section("b"));

        await frameButton(page, section("c"), "maximize").click();
        await expect.poll(() => visibleTabs(page)).toEqual(["view:c"]);
        await frameButton(page, section("c"), "maximize").click();
        await expect.poll(() => visibleTabs(page)).toEqual(expect.arrayContaining(["view:c", "view:e"]));
    });

    test("从零拉回：按着拖的过程中内容就可见，按回零又不可见；往零拖过阈值时先不算不可见，松手才算（输出 12）", async ({page}) => {
        await open(page);
        const leaf = `[data-leaf='${section("a")}']`;
        const sidebar = await rectOf(page, leaf);
        const sashX = sidebar.x + sidebar.width;
        const y = sidebar.y + 200;

        // 往零拖，过了阈值还按着：视图仍算可见。
        await page.mouse.move(sashX, y);
        await page.mouse.down();
        await page.mouse.move(sidebar.x + 5, y, {steps: 8});
        expect(await visibleTabs(page)).toContain("view:a");
        await page.mouse.up();
        await expect.poll(() => visibleTabs(page)).not.toContain("view:a");
        expect((await rectOf(page, leaf)).width).toBe(0);

        // 拉回来：还按着就可见，文档还没写，所以入口也跟着按下。
        const zero = await rectOf(page, leaf);
        await page.mouse.move(zero.x, y);
        await page.mouse.down();
        await page.mouse.move(zero.x + 240, y, {steps: 8});
        await expect.poll(() => visibleTabs(page)).toContain("view:a");
        await expect(entry(page, "a")).toHaveAttribute("aria-pressed", "true");
        await page.mouse.move(zero.x, y, {steps: 8});
        await expect.poll(() => visibleTabs(page)).not.toContain("view:a");
        await page.mouse.move(zero.x + 240, y, {steps: 8});
        await page.mouse.up();
        await expect.poll(() => visibleTabs(page)).toContain("view:a");
        expect((await rectOf(page, leaf)).width).toBeGreaterThan(200);
    });
});

test.describe("活动栏", () => {
    test("一个容器一个入口，只列侧栏里的容器，按入口顺序；只有当前容器按下（输出 22、41、44）", async ({page}) => {
        await open(page);
        const ids = () => page.locator("[data-rail=sidebar] [data-tool-band] [data-tool-entry]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-tool-entry")));
        // 右栏的 C、D 与底部面板的 E 不在活动栏里。
        expect(await ids()).toEqual(["view:a", "view:b"]);
        await expect(entry(page, "a")).toHaveAttribute("aria-pressed", "true");
        await expect(entry(page, "b")).toHaveAttribute("aria-pressed", "false");
        // 容器搬到右栏后入口不在；搬回来排在入口顺序的最后（输出 44）。
        await act(page, "a-to-right");
        await expect.poll(ids).toEqual(["view:b"]);
        await expect(entry(page, "b")).toHaveAttribute("aria-pressed", "true");
        await act(page, "a-back");
        await expect.poll(ids).toEqual(["view:b", "view:a"]);
        // D 并进 B 的容器：入口数不变，侧栏切到 B。
        await act(page, "d-below-b");
        await expect.poll(ids).toEqual(["view:b", "view:a"]);
        await expect(entry(page, "b")).toHaveAttribute("aria-pressed", "true");
        await expect(entry(page, "a")).toHaveAttribute("aria-pressed", "false");
    });

    test("放到活动栏：入口最后新建一个只含它的用户容器，入口上并进那个容器；都切过去，空了的用户容器入口消失（输出 41、45）", async ({page}) => {
        await open(page);
        const ids = () => page.locator("[data-rail=sidebar] [data-tool-band] [data-tool-entry]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-tool-entry")));
        expect(await ids()).toEqual(["view:a", "view:b"]);
        // 右栏的 D 放到入口最后：多一个入口，侧栏切到它。
        await act(page, "d-new-entry");
        await expect.poll(ids).toEqual(["view:a", "view:b", "custom:lab"]);
        await expect(page.locator("[data-tool-entry='custom:lab']")).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("[data-content='view:d']")).toBeVisible();
        // D 再放到 A 的入口上：成为 A 的最后一个分节，侧栏切到 A，只含它的用户容器没了。
        await act(page, "d-into-a");
        await expect.poll(ids).toEqual(["view:a", "view:b"]);
        await expect(entry(page, "a")).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("[data-content='view:a']")).toBeVisible();
        await expect(page.locator("[data-content='view:d']")).toBeVisible();
        expect((await rectOf(page, "[data-content='view:d']")).y).toBeGreaterThan((await rectOf(page, "[data-content='view:a']")).y);
    });

    test("不是当前容器：切到它并显示；是当前容器且侧栏可见：隐藏侧栏，不看焦点在哪（输出 22、42）", async ({page}) => {
        await open(page);
        await pressEntry(page, entry(page, "b"));
        await expect(entry(page, "b")).toHaveAttribute("aria-pressed", "true");
        await expect(entry(page, "a")).toHaveAttribute("aria-pressed", "false");
        await expect(page.locator("[data-content='view:b']")).toBeVisible();

        // 焦点在别的面板里，点按下的入口也是隐藏，没有“先聚焦”这一步。
        await page.locator("[data-content='view:c'] [data-structure-first]").focus();
        await pressEntry(page, entry(page, "b"));
        await shrunk(page, section("b"));
        await expect(entry(page, "b")).toHaveAttribute("aria-pressed", "false");

        await pressEntry(page, entry(page, "b"));
        await expect(page.locator(`[data-leaf='${section("b")}']`)).toHaveCount(1);
        await expect(entry(page, "b")).toHaveAttribute("aria-pressed", "true");
    });

    test("含几个视图的入口：悬停文字写出容器里的各个视图，没有单一视图 id（输出 41、46）", async ({page}) => {
        await open(page);
        await expect(entry(page, "b")).toHaveAttribute("data-tool-view", "b");
        await act(page, "d-below-b");
        await expect(entry(page, "b")).not.toHaveAttribute("data-tool-view", /.*/u);
        await entry(page, "b").hover();
        await expect(page.locator(".nb-ui-tooltip-surface")).toContainText("视图 B、视图 D");
    });
});

test.describe("卡片按邻接算", () => {
    const paddingOf = (page: Page, panel: string) => page.locator(`[data-leaf='${panel}'] > .nb-grid-leaf > *`).evaluate((element) => {
        const style = getComputedStyle(element);
        return {top: Number.parseFloat(style.paddingTop), right: Number.parseFloat(style.paddingRight), bottom: Number.parseFloat(style.paddingBottom), left: Number.parseFloat(style.paddingLeft)};
    });

    test("贴窗体整缝，相邻半缝，活动栏与侧栏相连；内容和外框拼成一张卡片", async ({page}) => {
        await open(page, "cards");
        const sidebarId = section("a");
        const bar = await paddingOf(page, "activitybar");
        expect(bar.left).toBe(4);
        expect(bar.right).toBe(0);
        const sidebar = await paddingOf(page, sidebarId);
        expect(sidebar.left).toBe(0);
        expect(sidebar.top).toBe(4);
        expect(sidebar.right).toBeLessThan(2);
        await expect(page.locator("[data-shell-card='activitybar']")).toHaveAttribute("data-shell-join", "start");
        await expect(page.locator(`[data-shell-card='${sidebarId}']`)).toHaveAttribute("data-shell-join", "end");

        // 活动栏的卡片宽不变，叶宽加上缝。
        expect((await rectOf(page, "[data-shell-card='activitybar']")).width).toBe(48);

        // 内容的左右和卡片对齐，下边也是。
        const card = await rectOf(page, `[data-shell-card='${sidebarId}']`);
        const content = await rectOf(page, "[data-content='view:a'] .workbench-surface__content-clip");
        expect(content.x).toBe(card.x);
        expect(content.width).toBe(card.width);
        expect(content.y).toBe(card.y + 32);
        expect(content.y + content.height).toBe(card.y + card.height);
    });

    test("侧栏隐藏后活动栏不再相连；最大化时盖住的面板四边贴窗体", async ({page}) => {
        await open(page, "cards");
        // 分节没有隐藏按钮（输出 20）：点按下着的入口隐藏侧栏（输出 22）。
        await pressEntry(page, entry(page, "a"));
        await expect(page.locator("[data-shell-card='activitybar']")).not.toHaveAttribute("data-shell-join", /.+/);

        const panelId = section("e");
        await frameButton(page, panelId, "maximize").click();
        // 最大化不盖右轨（ui/workbench-layout 输出 13、50）：被最大化的面板右边挨着右轨：右缝是相邻的半缝，不是贴窗体的整缝 4，卡片与右轨之间留一条相邻缝。
        await expect.poll(async () => (await paddingOf(page, panelId)).right).toBe(2);
        const panel = await paddingOf(page, panelId);
        expect(panel.top).toBe(4);
        expect(panel.left).toBe(2);
        const [maximized, rail] = [await rectOf(page, `[data-shell-card='${panelId}']`), await rectOf(page, "[data-shell-card='rail:auxiliarybar']")];
        expect(rail.x - (maximized.x + maximized.width), "相邻两张卡片之间的缝").toBe(4);
    });

    test("分隔线按两侧是什么分种类：卡片主题里卡片之间、编辑组之间缝就是分界，不画线；一张卡片里几节之间画开放式分割线；平铺主题里三种都画（输出 19）", async ({page}) => {
        const seams = async () => {
            await act(page, "d-below-b");
            const color = (kind: string) => page.locator(`.nb-grid-sash[data-sash-kind="${kind}"] .sash-seam`).first().evaluate((element) => getComputedStyle(element).backgroundColor);
            return {shell: await color("shell"), editors: await color("editors"), panes: await color("panes")};
        };
        await open(page, "cards");
        const cards = await seams();
        expect({shell: cards.shell, editors: cards.editors}).toEqual({shell: "rgba(0, 0, 0, 0)", editors: "rgba(0, 0, 0, 0)"});
        expect(cards.panes).not.toBe("rgba(0, 0, 0, 0)");
        await open(page, "default", "macos");
        const flat = await seams();
        for (const color of Object.values(flat)) expect(color).not.toBe("rgba(0, 0, 0, 0)");
    });
});

test.describe("放不下", () => {
    test("工具面板全收走还放不下：只压编辑组，条的尺寸不变，焦点光晕不被裁（输出 5、10）", async ({page}) => {
        await page.setViewportSize({width: 1280, height: 720});
        await page.goto(`${dev.pageUrl}lab?c=WorkbenchSurface&s=default&theme=nbook&cw=light&vp=phone`);
        await expect.poll(async () => (await labState(page))?.ready).toBe(true);
        await expect(page.locator("[data-shell-card='activitybar']")).toBeVisible();
        // 两个编辑组的最小宽度加起来就超过手机画布了。活动栏的叶宽还是 48 加主题的缝（nbook 是 4）。
        await expect.poll(() => rectOf(page, "[data-leaf='activitybar']").then((rect) => rect.width)).toBe(52);
        const groups = await Promise.all(["g0", "g1"].map((id) => rectOf(page, `[data-leaf='${id}']`)));
        for (const group of groups) expect(group.width).toBeLessThan(220);
        const clipped = await page.evaluate(() => (window as unknown as {__nbLab: {measure(): {clippedFocus: ReadonlyArray<{selector: string}>}}}).__nbLab.measure().clippedFocus.map((item) => item.selector));
        expect(clipped).toEqual([]);
    });
});

test.describe("主题的场景图", () => {
    test("挂在侧栏和右栏的分节上，高度不足 300px 不画", async ({page}) => {
        await open(page);
        await page.evaluate(() => document.documentElement.setAttribute("data-nb-skin-scene", ""));
        const scene = (panel: string) => page.locator(`[data-shell-card="${panel}"]`).evaluate((element) => getComputedStyle(element, "::after").display);
        const content = (panel: string) => page.locator(`[data-shell-card="${panel}"]`).evaluate((element) => getComputedStyle(element, "::after").content);
        expect(await content(section("a"))).not.toBe("none");
        expect(await content(section("c"))).not.toBe("none");
        expect(await content(section("e"))).toBe("none");
        expect(await scene(section("a"))).not.toBe("none");

        // 侧栏切到 B 那个容器，里面上下两节：图只挂在区域最下面那节上（跟着区域走，不跟着视图走）；把下面那节拖矮到 300px 以下。
        await act(page, "d-below-b");
        const [upper, lower] = [section("b"), section("d")];
        await expect.poll(() => content(lower)).not.toBe("none");
        expect(await content(upper)).toBe("none");
        const split = await rectOf(page, `[data-leaf='${upper}']`);
        const column = await rectOf(page, `[data-leaf='${lower}']`);
        await page.mouse.move(split.x + 100, split.y + split.height);
        await page.mouse.down();
        await page.mouse.move(split.x + 100, column.y + column.height - 200, {steps: 6});
        await page.mouse.up();
        await expect.poll(() => rectOf(page, `[data-shell-card='${lower}']`).then((rect) => rect.height)).toBeLessThan(300);
        await expect.poll(() => scene(lower)).toBe("none");
    });
});
