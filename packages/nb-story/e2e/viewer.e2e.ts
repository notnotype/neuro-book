/**
 * 查看器的验收（docs/specs/story/viewer.md 验收 1 到 8 与“状态与转换”的时序）：生产构建的网页，真实的 `nbstory serve`，
 * 100 章样例书，本机 Chrome。图画在 WebGL 画布上，读不到点和字：图的数据由核心库的测试覆盖，这里测画布与交互的外部效果。
 */

import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {expect, test, type Page} from "@playwright/test";

import {login, makeLibrary, readingState, runCli, startServe, type StoryServer} from "./fixtures";

let server: StoryServer;
let cleanup: () => Promise<void>;

test.beforeAll(async () => {
    const library = await makeLibrary("viewer");
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

async function open(page: Page, path: string): Promise<void> {
    await page.goto(`${server.base}${path}`);
    await expect(page.getByTestId("book-frame")).toBeVisible();
}

/** 页面主区与抽屉里的全部文字。 */
async function visibleText(page: Page): Promise<string> {
    return page.locator("body").innerText();
}

test("防剧透（验收 1）：第 7 章时各页没有心月狐与之后的章标题，拨到第 8 章后出现", async ({page}) => {
    const info = await (await page.context().request.post(`${server.base}/api/rpc/book.info`, {data: {book: "fox"}})).json() as {toc: {chapter: number; title: string}[]};
    const laterTitles = info.toc.filter(item => item.chapter > 7).map(item => item.title);
    // 图画在画布上读不到字：核对页面拿到的图数据里没有心月狐。
    const graphBodies: string[] = [];
    page.on("response", async response => {
        if (/\/api\/rpc\/graph\./u.test(response.url())) graphBodies.push(await response.text());
    });
    for (const path of ["relations", "book-graph"]) {
        await open(page, `/book/fox/${path}?at=7&perspective=reader`);
        await page.waitForLoadState("networkidle");
    }
    await page.getByRole("radio", {name: "按关联"}).click();
    await page.waitForLoadState("networkidle");
    await expect.poll(() => graphBodies.length).toBeGreaterThanOrEqual(3);
    for (const body of graphBodies) expect(body).not.toContain("心月狐");
    for (const path of ["overview", "roster", "secrets", "episodes", "timeline", "questions"]) {
        await open(page, `/book/fox/${path}?at=7`);
        await expect(page.getByTestId(`page-${path}`)).toBeVisible();
        await page.waitForLoadState("networkidle");
        const text = await visibleText(page);
        expect(text).not.toContain("心月狐");
        for (const title of laterTitles) expect(text, `${path} 里出现了第 8 章之后的标题“${title}”`).not.toContain(title);
    }
    await open(page, "/book/fox/source?at=7");
    await expect(page.locator('[data-chapter="8"]')).toHaveText(/未读/u);
    await expect(page.locator('[data-chapter="8"]')).toBeDisabled();
    await page.getByTestId("search-input").locator("input").fill("心月狐");
    await expect(page.getByTestId("search-results")).toContainText("共 0 条");

    await open(page, "/book/fox/secrets?at=8");
    await expect(page.getByTestId("secrets-matrix")).toContainText("心月狐就是苏天晴");
    await open(page, "/book/fox/source?at=8");
    await expect(page.locator('[data-chapter="8"]')).not.toHaveText(/未读/u);
});

test("回到上次（验收 2）：换一个浏览器配置打开回到同一画面；地址写明的部分优先", async ({page, browser}) => {
    await open(page, "/book/fox/relations?at=38.57&perspective=e1-1&entity=e8-2");
    await expect.poll(async () => (await readingState(page.context(), server)).view, {timeout: 10_000}).toEqual(expect.objectContaining({page: "relations", entity: "e8-2", perspective: "e1-1"}));
    expect((await readingState(page.context(), server)).position).toEqual({chapter: 38, paragraph: 57});
    await page.context().close();

    const other = await browser.newContext();
    await login(other, server);
    const next = await other.newPage();
    await next.goto(`${server.base}/book/fox`);
    await expect(next.getByTestId("page-relations")).toBeVisible();
    await expect(next).toHaveURL(/\/book\/fox\/relations\?at=38\.57&perspective=e1-1&entity=e8-2/u);
    await expect(next.getByTestId("card-name")).toHaveText("南嘉鱼");

    await next.goto(`${server.base}/book/fox/roster?at=7`);
    await expect(next.getByTestId("page-roster")).toBeVisible();
    await expect(next.getByTestId("reading-label")).toContainText("第 7 章");
    await other.close();
});

/** 等画布稳定：相隔 300ms 的两次轮询截图相同（WebGL 动画中连着两帧也可能一样，间隔太短会误判）。 */
async function settle(page: Page): Promise<void> {
    const graph = page.getByTestId("relation-graph");
    let previous: Buffer | null = null;
    await expect.poll(async () => {
        const current = await graph.screenshot();
        const same = previous !== null && current.equals(previous);
        previous = current;
        return same;
    }, {intervals: [300]}).toBe(true);
}

/** 用“在图里找”把镜头移到一个点上：命中的点被移到画布中央。 */
async function centerOn(page: Page, name: string): Promise<{x: number; y: number}> {
    const graph = page.getByTestId("relation-graph");
    await settle(page);
    const before = await graph.screenshot();
    await page.getByPlaceholder("在图里找").fill(name);
    await expect.poll(async () => !(await graph.screenshot()).equals(before)).toBe(true);
    await settle(page);
    const box = (await graph.boundingBox())!;
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

test("关系图挪阅读位置（输出 25，issue 268）：往后挪时新数据回来之前留着旧图、不出现“正在取”，数据到了图变；往前挪仍先清空，不把后文的图留在前面的位置上", async ({page}) => {
    await open(page, "/book/fox/relations?at=7&perspective=reader");
    const graph = page.getByTestId("relation-graph");
    await expect(graph.locator("canvas").first()).toBeVisible();
    await settle(page);
    const shown = await graph.screenshot();

    // 把图的请求扣住，只放行一次：挪动后到数据回来之前，页面停在什么样，就是被测的行为。
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/rpc/graph.relations", async route => {
        await gate;
        await route.continue();
    });
    await page.getByRole("button", {name: "下一章"}).click();
    await expect(page.getByText("截至第 8 章")).toBeVisible();
    await expect(page.getByText("正在取……")).toHaveCount(0);
    await expect(graph.locator("canvas").first()).toBeVisible();
    expect((await graph.screenshot()).equals(shown)).toBe(true);
    release();
    await expect.poll(async () => !(await graph.screenshot()).equals(shown)).toBe(true);
    await settle(page);
    await page.unroute("**/api/rpc/graph.relations");

    // 往前挪：旧图（第 8 章）不能留在第 7 章的位置上，先清空，新数据回来后重新画。
    let releaseBack: () => void = () => {};
    const gateBack = new Promise<void>(resolve => { releaseBack = resolve; });
    await page.route("**/api/rpc/graph.relations", async route => {
        await gateBack;
        await route.continue();
    });
    await page.getByRole("button", {name: "上一章"}).click();
    await expect(page.getByText("正在取……")).toBeVisible();
    await expect(graph.locator("canvas")).toHaveCount(0);
    releaseBack();
    await expect(graph.locator("canvas").first()).toBeVisible();
    await expect(page.getByText("正在取……")).toHaveCount(0);
    await page.unroute("**/api/rpc/graph.relations");
});

test("关系图（验收 3、输出 27）：页面上已有文字选区时拖动一个点照样能拖、不打开人物卡；单击只选中，双击打开人物卡；右键菜单与快捷键；打开认知层后图照常", async ({page}) => {
    await open(page, "/book/fox/relations?at=38&perspective=reader");
    await expect(page.getByTestId("relation-graph").locator("canvas").first()).toBeVisible();
    const center = await centerOn(page, "花铃");
    // 开发者试用时先选中了页面上的一行字再拖点，点拖不动（t04 反馈 12）：先造一个文字选区。
    await page.evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(document.querySelector(".story-page-title")!);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
    });
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 60, center.y + 40, {steps: 8});
    await page.mouse.up();
    await expect(page.getByTestId("entity-card")).toHaveCount(0);
    // 松手后马上再点会被 Sigma 当成双击（放大镜头）：等画布稳定（超过双击间隔）再点。
    await settle(page);
    // 在拖到的新位置上单击只选中、不开抽屉；按 Enter 打开的是花铃：说明点确实被拖过去了、也选中了它。
    await page.mouse.click(center.x + 60, center.y + 40);
    await expect(page.getByTestId("entity-card")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("card-name")).toHaveText("花铃");
    // F 切换“只看周边”。
    const neighborhood = page.getByRole("checkbox", {name: "只看选中的周边"});
    await page.keyboard.press("f");
    await expect(neighborhood).toBeChecked();
    await page.keyboard.press("f");
    await expect(neighborhood).not.toBeChecked();
    // 抽屉开着时单击另一个点，抽屉跟着换人。
    const other = await centerOn(page, "南小风");
    await page.mouse.click(other.x, other.y);
    await expect(page.getByTestId("card-name")).toHaveText("南小风");
    await page.getByTestId("entity-card").getByRole("button", {name: "关闭"}).click();
    await expect(page.getByTestId("entity-card")).toHaveCount(0);
    // 右键菜单：打开人物卡。关掉抽屉后画布变宽、点的屏幕位置变了，换一个人重新定位。
    const third = await centerOn(page, "白灵");
    await page.mouse.click(third.x, third.y, {button: "right"});
    await page.getByRole("menuitem", {name: /白灵的人物卡/u}).click();
    await expect(page.getByTestId("card-name")).toHaveText("白灵");
    await page.getByTestId("entity-card").getByRole("button", {name: "关闭"}).click();
    await settle(page);
    const beforeLayer = await page.getByTestId("relation-graph").screenshot();
    await page.locator('[data-layer="know"]').click();
    await expect(page.locator('[data-layer="know"]')).toHaveAttribute("aria-pressed", "true");
    // 打开认知层后按新的线重新排版：画面要变，并在动画结束后稳定下来。
    await expect.poll(async () => !(await page.getByTestId("relation-graph").screenshot()).equals(beforeLayer)).toBe(true);
    await settle(page);
    await expect(page.getByTestId("page-error")).toHaveCount(0);
});

test("关系图（输出 27，反馈 3）：在图里找可以按别名；右键点开菜单后移动鼠标，点不会跟着走", async ({page}) => {
    await open(page, "/book/fox/relations?at=38&perspective=reader");
    await expect(page.getByTestId("relation-graph").locator("canvas").first()).toBeVisible();
    // 页面打开时沿用抽屉里正开着的对象（上一个用例可能留着）：先关掉，下面“出现人物卡”才说明点选到了。
    const openCard = page.getByTestId("entity-card");
    if ((await openCard.count()) > 0) await openCard.getByRole("button", {name: "关闭"}).click();
    await expect(openCard).toHaveCount(0);
    // “心月狐”是别名，不是任何点的显示名：搜它也要让镜头移到那个点上。
    const center = await centerOn(page, "心月狐");
    await page.mouse.move(center.x, center.y);
    await page.mouse.down({button: "right"});
    await page.mouse.up({button: "right"});
    await expect(page.getByRole("menu")).toBeVisible();
    // 菜单开着，按住右键再移动鼠标：点不能被拖走。
    await page.mouse.move(center.x, center.y);
    await page.mouse.down({button: "right"});
    await page.mouse.move(center.x + 90, center.y + 60, {steps: 8});
    await page.mouse.up({button: "right"});
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await settle(page);
    // 点还在原处：在原处单击仍然选中它（落在空白处会取消选中），按 Enter 打开的是它的人物卡。
    await page.mouse.click(center.x, center.y);
    await page.keyboard.press("Enter");
    // 打开的是别名所属的人：苏天晴；点要是被右键拖走，原处单击落在空白处，这里不会出现人物卡。
    await expect(page.getByTestId("card-name")).toHaveText("苏天晴");
});

test("关系图（输出 27，反馈 3）：选中一个点后底部出浮条，写着怎么打开；点按钮打开人物卡，取消选中后浮条消失；右键菜单写“双击 / Enter”", async ({page}) => {
    await open(page, "/book/fox/relations?at=38&perspective=reader");
    await expect(page.getByTestId("relation-graph").locator("canvas").first()).toBeVisible();
    // 页面打开时沿用抽屉里正开着的对象（上一个用例可能留着）：不假设一开始没有浮条，只看选了白灵之后。
    const center = await centerOn(page, "白灵");
    await page.mouse.click(center.x, center.y);
    const bar = page.getByTestId("graph-selection-bar");
    await expect(bar).toContainText("已选中 白灵");
    await expect(bar).toContainText("双击或按 Enter 也能打开");
    await bar.getByRole("button", {name: "打开人物卡"}).click();
    await expect(page.getByTestId("card-name")).toHaveText("白灵");
    await bar.getByRole("button", {name: "取消选中"}).click();
    await expect(bar).toHaveCount(0);
    await page.getByTestId("entity-card").getByRole("button", {name: "关闭"}).click();
    await settle(page);
    // 右键菜单第一项写明双击也能打开。
    await page.getByPlaceholder("在图里找").fill("");
    const again = await centerOn(page, "南嘉鱼");
    await page.mouse.click(again.x, again.y, {button: "right"});
    await expect(page.getByRole("menuitem", {name: /南嘉鱼的人物卡/u})).toContainText("双击 / Enter");
});

test("收起抽屉后重画（验收 4）：画布铺满主区", async ({page}) => {
    await open(page, "/book/fox/relations?at=38&entity=e1-1&tab=relations");
    await expect(page.getByTestId("entity-card")).toBeVisible();
    const graph = page.getByTestId("relation-graph");
    const before = (await graph.boundingBox())!.width;
    await page.getByTestId("entity-card").getByRole("button", {name: "关闭"}).click();
    await expect(page.getByTestId("entity-card")).toHaveCount(0);
    await expect.poll(async () => (await graph.boundingBox())!.width).toBeGreaterThan(before + 200);
    const width = (await graph.boundingBox())!.width;
    await expect.poll(async () => (await graph.locator("canvas").first().boundingBox())!.width).toBeCloseTo(width, 0);
    // 重画过：画布上有点与线（截图不是一片底色）。
    const shot = await graph.screenshot();
    expect(new Set(Array.from({length: 400}, (_, index) => shot[Math.floor((shot.length * index) / 400)])).size).toBeGreaterThan(10);
});

test("视角（验收 5）：苏天晴视角下南嘉鱼与地狱猫不合并；读者视角下猫娘魔法少女与南嘉鱼可能是同一人", async ({page}) => {
    // 线上的字画在画布上读不到：核对页面画图用的数据里这两对的身份状态，再看横幅与人物卡。
    const graphs: {view: {perspective: string}; edges: {a: string; b: string; identity: string | null}[]}[] = [];
    page.on("response", async response => {
        if (response.url().endsWith("/api/rpc/graph.relations")) graphs.push(await response.json());
    });
    await open(page, "/book/fox/relations?at=38&perspective=e1-1");
    await expect.poll(() => graphs.find(graph => graph.view.perspective === "e1-1")?.edges.find(edge => edge.a === "e33-1" && edge.b === "e8-2")?.identity).toBe("unaware");
    // 视角说明平时只是一个小标记，点开看完整的不合并列表（输出 28）。
    await expect(page.getByTestId("perspective-banner")).toContainText("处不合并");
    await page.getByTestId("perspective-banner").click();
    await expect(page.getByTestId("perspective-detail")).toContainText("地狱猫与南嘉鱼");
    await page.keyboard.press("Escape");
    await open(page, "/book/fox/relations?at=38&perspective=reader");
    await expect(page.getByTestId("perspective-banner")).toHaveCount(0);
    await expect.poll(() => graphs.find(graph => graph.view.perspective === "reader")?.edges.find(edge => edge.a === "e30-1" && edge.b === "e8-2")?.identity).toBe("uncertain");
    // 双击猫娘魔法少女打开人物卡的关系页签，身份连接写在列表里。
    const center = await centerOn(page, "猫娘魔法少女");
    await page.mouse.dblclick(center.x, center.y);
    await expect(page.getByTestId("card-relations").getByTestId("identity")).toContainText("可能是同一人");
});

test("长列表（验收 6）：第 100 章苏天晴的记录 1 秒内出首屏，筛选与搜索 1 秒内更新，滚到底取到全部", async ({page}) => {
    await open(page, "/book/fox/overview?at=100");
    const started = Date.now();
    await page.goto(`${server.base}/book/fox/roster?at=100&entity=e1-1&tab=records`);
    await expect(page.getByTestId("record").first()).toBeVisible();
    // 计时含整页导航与外壳的取数，比 Spec 的“从打开记录页签起”更严。
    expect(Date.now() - started).toBeLessThan(1000);

    let t = Date.now();
    await page.getByRole("radio", {name: "不知道"}).click();
    await expect(page.getByTestId("record").first()).toContainText("不知道");
    expect(Date.now() - t).toBeLessThan(1000);

    t = Date.now();
    await page.getByTestId("entity-card").getByPlaceholder("按字搜").fill("南嘉鱼");
    await expect(page.getByTestId("record").first()).toContainText("南嘉鱼");
    expect(Date.now() - t).toBeLessThan(1000);

    await page.getByRole("radio", {name: "全部"}).click();
    await page.getByTestId("entity-card").getByPlaceholder("按字搜").fill("");
    const total = Number((await page.getByRole("radio", {name: /他知道的/u}).innerText()).match(/\d+/u)![0]);
    const list = page.getByTestId("entity-card").locator(".story-scroll-y");
    await expect.poll(async () => {
        await list.evaluate(element => element.scrollTo(0, element.scrollHeight));
        return page.getByTestId("record").count();
    }, {timeout: 30_000}).toBe(total);
});

test("宽度（验收 7）：宽屏与平板下各页无横向溢出；手机宽度能显示", async ({page}) => {
    const pages = ["overview", "relations", "book-graph", "roster", "secrets", "ledger", "questions", "timeline", "episodes", "source", "stats"];
    for (const width of [1440, 900]) {
        await page.setViewportSize({width, height: 900});
        for (const name of pages) {
            await open(page, `/book/fox/${name}?at=38&entity=e1-1`);
            await expect(page.getByTestId(`page-${name}`)).toBeVisible();
            await page.waitForLoadState("networkidle");
            // 外壳是 overflow: hidden，量文档的横向滚动量没有意义：逐个量页面、内容列、抽屉与顶栏自己是否放不下。
            const overflow = await page.evaluate(() =>
                [...document.querySelectorAll<HTMLElement>('[data-testid^="page-"], .story-page-body, [data-testid="drawer"], header, footer')]
                    .filter(element => element.scrollWidth > element.clientWidth + 1)
                    .map(element => `${element.dataset.testid ?? element.className}: ${element.scrollWidth} > ${element.clientWidth}`),
            );
            expect(overflow, `${name} @${width}`).toEqual([]);
        }
    }
    await page.setViewportSize({width: 390, height: 844});
    for (const name of pages) {
        await open(page, `/book/fox/${name}?at=38`);
        await expect(page.getByTestId(`page-${name}`)).toBeVisible();
    }
});

test("记录标记与段落概要（验收 8）", async ({page}) => {
    await open(page, "/book/fox/roster?at=38&entity=e1-1&tab=records");
    await page.getByRole("radio", {name: /关于他的/u}).click();
    await expect(page.getByTestId("entity-card")).toContainText("角色的说法");
    await open(page, "/book/fox/source?at=38.57");
    await page.getByTestId("toggle-beats").click();
    await expect(page.getByTestId("beat").first()).toBeVisible();
    await expect(page.locator('[data-testid="beat"][data-from="48"]')).toHaveCount(0);
    await expect(page.getByTestId("read-line")).toBeVisible();
});

test("记录等级（输出 56、57）：关于他的默认收起 3 级，顶部写“展开次要（N）”；展开后 3 级淡显照列、刷新后仍展开；抽屉与宽表格共用开关；点色块看依据；情节没有先验不画色块", async ({page}) => {
    const rpc = async <T,>(method: string, data: object) => (await (await page.context().request.post(`${server.base}/api/rpc/${method}`, {data: {book: "fox", at: {chapter: 20}, ...data}})).json()) as T;
    // e4-1 在第 20 章的说法一页取得完（每页 100 条），行数可以直接对。
    const all = await rpc<{total: number; tiers: [number, number, number]; items: {id: string}[]}>("entity.statements", {entity: "e4-1", limit: 500});
    const [, , minor] = all.tiers;
    expect(minor).toBeGreaterThan(0);
    expect(all.total).toBeLessThanOrEqual(100);
    await open(page, "/book/fox/roster?at=20&entity=e4-1&tab=records");
    const card = page.getByTestId("entity-card");
    await card.getByRole("radio", {name: /关于他的/u}).click();
    const bar = card.getByTestId("toggle-minor-records");
    const rows = card.locator('[data-testid="record"][data-tier]');
    await expect(bar).toHaveText(`展开次要（${minor}）`);
    await expect(rows).toHaveCount(all.total - minor);
    await expect(card.locator('[data-testid="record"][data-tier="3"]')).toHaveCount(0);
    await bar.click();
    await expect(bar).toHaveText(`收起次要（${minor}）`);
    await expect(rows).toHaveCount(all.total);
    await expect(card.locator('[data-testid="record"][data-tier="3"]')).toHaveCount(minor);
    // 展开后的 3 级淡一些。
    const colorOf = (tier: string) => card.locator(`[data-testid="record"][data-tier="${tier}"]`).first().evaluate(element => getComputedStyle(element).color);
    expect(await colorOf("3")).not.toBe(await colorOf("2"));
    // 展开与否记在浏览器偏好里。
    await page.reload();
    await card.getByRole("radio", {name: /关于他的/u}).click();
    await expect(bar).toHaveText(`收起次要（${minor}）`);
    // 依据：第一条说法的“后文又提到”与 tier.explain 的回响一致。
    const first = await rpc<{signals: {echo: {count: number}}}>("tier.explain", {id: all.items[0]!.id});
    await card.locator('[data-testid="record"]').first().getByTestId("tier-badge").click();
    const explain = page.getByTestId("tier-explain");
    await expect(explain).toContainText("后文引用");
    await expect(explain).toContainText(first.signals.echo.count > 0 ? /后文又提到\s*有/u : /后文又提到\s*没有/u);
    await expect(explain).toContainText("只看你读到的位置之前的内容");
    await page.keyboard.press("Escape");
    await expect(explain).toHaveCount(0);
    await bar.click();
    await expect(bar).toHaveText(`展开次要（${minor}）`);

    // 宽表格与抽屉共用一个开关。
    await card.getByTestId("open-wide").click();
    const wide = page.getByTestId("records-table");
    await wide.getByRole("radio", {name: /关于他的/u}).click();
    const wideBar = wide.getByTestId("toggle-minor-records");
    await expect(wideBar).toHaveText(`展开次要（${minor}）`);
    await expect(wide.locator('[data-testid="wide-record"][data-tier]')).toHaveCount(all.total - minor);
    await wideBar.click();
    await expect(wideBar).toHaveText(`收起次要（${minor}）`);
    await expect(wide.locator('[data-testid="wide-record"][data-tier="3"]')).toHaveCount(minor);
    await expect(bar).toHaveText(`收起次要（${minor}）`);
    await wideBar.click();
    await expect(bar).toHaveText(`展开次要（${minor}）`);

    // 人物页“其他”的折叠条照旧可切。
    await page.getByRole("button", {name: "回到页面"}).click();
    const others = page.getByTestId("toggle-minor");
    await expect(others).toHaveAttribute("aria-expanded", "false");
    await others.click();
    await expect(others).toHaveAttribute("aria-expanded", "true");
    await expect(others).toContainText("收起次要");

    // 样例书的情节没有先验：情节页不画色块。
    await open(page, "/book/fox/episodes?at=20");
    await expect(page.locator("article.episode").first()).toBeVisible();
    await expect(page.locator("article.episode [data-testid='tier-badge']")).toHaveCount(0);
});

test("记录等级的依据（输出 57）：平板宽度下抽屉是浮层，开着依据按 Escape 只关依据，再按一次才关抽屉", async ({page}) => {
    await page.setViewportSize({width: 900, height: 900});
    await open(page, "/book/fox/roster?at=20&entity=e4-1&tab=records");
    const drawer = page.getByTestId("drawer");
    await expect(drawer).toBeVisible();
    await drawer.getByRole("radio", {name: /关于他的/u}).click();
    await drawer.locator('[data-testid="record"]').first().getByTestId("tier-badge").click();
    const explain = page.getByTestId("tier-explain");
    await expect(explain).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(explain).toHaveCount(0);
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
});

test("时序：旧位置的请求晚到也不显示到新位置；地址里还不存在的对象被去掉并提示；抽屉跨宽度档内容不变", async ({page}) => {
    await open(page, "/book/fox/stats?at=30");
    await expect(page.getByTestId("visible-stats")).toBeVisible();
    // 第 7 章的统计请求压住 1.5 秒，期间拨到第 8 章：最后显示的必须是第 8 章的数字。
    await page.route("**/api/rpc/book.stats", async route => {
        const body = route.request().postDataJSON() as {at?: {chapter: number}};
        if (body.at?.chapter === 7) await new Promise(resolve => setTimeout(resolve, 1500)); // test-lint-allow fixed-wait: 人为延后一个真实请求的返回
        await route.continue();
    });
    const expected8 = await (await page.context().request.post(`${server.base}/api/rpc/book.stats`, {data: {book: "fox", at: {chapter: 8}}})).json() as {visible: {statements: number}};
    await page.goto(`${server.base}/book/fox/stats?at=7`);
    await expect(page.getByTestId("reading-label")).toContainText("第 7 章");
    const aborted = page.waitForEvent("requestfailed", request => request.url().endsWith("/api/rpc/book.stats"));
    await page.getByRole("button", {name: "下一章"}).click();
    await expect(page.getByTestId("reading-label")).toContainText("第 8 章");
    // 旧位置的请求被中止，不会再落到页面上。
    await aborted;
    await expect(page.getByTestId("visible-stats")).toContainText(String(expected8.visible.statements));
    // 往回拨：第 7 章的结果压着的时候，页面不留着第 8 章的数字，显示“正在取”。
    await page.getByRole("button", {name: "上一章"}).click();
    await expect(page.getByTestId("reading-label")).toContainText("第 7 章");
    await expect(page.getByTestId("visible-stats")).toHaveCount(0);
    await expect(page.getByText("正在取")).toBeVisible();
    await expect(page.getByTestId("visible-stats")).toBeVisible();
    await page.unroute("**/api/rpc/book.stats");

    await open(page, "/book/fox/roster?at=7&entity=e33-1");
    await expect(page.getByTestId("notice")).toContainText("还没出现");
    await expect(page.getByTestId("entity-card")).toHaveCount(0);

    await page.setViewportSize({width: 1440, height: 900});
    await open(page, "/book/fox/roster?at=38&entity=e12-5");
    await expect(page.getByTestId("card-name")).toHaveText("花铃");
    await page.setViewportSize({width: 900, height: 900});
    await expect(page.getByTestId("drawer-scrim")).toBeVisible();
    await expect(page.getByTestId("card-name")).toHaveText("花铃");
});

test("页面隐藏时立即保存：变化后马上关掉页面，重新读到最新位置", async ({page}) => {
    await open(page, "/book/fox/overview?at=20");
    await expect.poll(async () => (await readingState(page.context(), server)).position).toEqual({chapter: 20});
    await page.getByRole("button", {name: "下一章"}).click();
    await expect(page.getByTestId("reading-label")).toContainText("第 21 章");
    await page.close({runBeforeUnload: true});
    await expect.poll(async () => (await readingState(page.context(), server)).position).toEqual({chapter: 21});
});

test("命令行给出的查看器地址打开到同一人物卡与阅读位置（cli-skill 验收 3）", async ({page}) => {
    const run = await runCli(["card", "苏天晴", "--at", "38", "--library", server.library]);
    const url = /查看器：(\S+)$/u.exec(run.stdout.trim())![1]!;
    expect(url).not.toContain("token");
    await page.goto(url);
    await expect(page.getByTestId("card-name")).toHaveText("苏天晴");
    await expect(page.getByTestId("reading-label")).toContainText("第 38 章");
});

test("全局搜索的结果浮在页面上，不撑高顶栏；点外面关掉", async ({page}) => {
    await open(page, "/book/fox/overview?at=38");
    const before = (await page.getByTestId("book-frame").locator("> header").boundingBox())!.height;
    await page.getByTestId("search-input").locator("input").fill("南嘉鱼");
    await expect(page.getByTestId("search-results")).toContainText("对象");
    expect((await page.getByTestId("book-frame").locator("> header").boundingBox())!.height).toBe(before);
    await page.getByTestId("page-overview").click({position: {x: 20, y: 400}});
    await expect(page.getByTestId("search-results")).toHaveCount(0);
});

test("选中浮条（输出 27）：在图顶部不压图例与缩放按钮；进入全屏后仍在全屏的元素里；全书图隐藏该点的类型后浮条随之消失", async ({page}) => {
    await open(page, "/book/fox/relations?at=38&perspective=reader");
    await expect(page.getByTestId("relation-graph").locator("canvas").first()).toBeVisible();
    const card = page.getByTestId("entity-card");
    if ((await card.count()) > 0) await card.getByRole("button", {name: "关闭"}).click();
    const center = await centerOn(page, "白灵");
    await page.mouse.click(center.x, center.y);
    const bar = page.getByTestId("graph-selection-bar");
    await expect(bar).toContainText("已选中 白灵");
    // 浮条在图的上半部，不与右下的缩放按钮重叠。
    const graphBox = (await page.getByTestId("relation-graph").boundingBox())!;
    const barBox = (await bar.boundingBox())!;
    expect(barBox.y + barBox.height).toBeLessThan(graphBox.y + graphBox.height / 2);
    // 全屏：浮条是全屏元素的后代（真实的 Fullscreen API）。
    await page.getByRole("button", {name: "全屏"}).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.contains(document.querySelector("[data-testid=graph-selection-bar]")) ?? false)).toBe(true);
    await page.evaluate(() => document.exitFullscreen());
});

test("全书图（输出 27）：选中一个对象点后隐藏“对象”类型，点从图上消失，选中浮条也随之消失", async ({page}) => {
    await open(page, "/book/fox/book-graph?at=38&perspective=reader");
    await page.getByText("按关联", {exact: true}).click();
    const graph = page.locator(".story-graph");
    await expect(graph.locator("canvas").first()).toBeVisible();
    await page.getByPlaceholder("在图里找").fill("苏天晴");
    // 搜索把图移到匹配的点：等图上的点停下来（搜索命中后图中心的点就是它）再点中心。
    const box = (await graph.boundingBox())!;
    await expect(async () => {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await expect(page.getByTestId("graph-selection-bar")).toBeVisible({timeout: 500});
    }).toPass({timeout: 15_000});
    const bar = page.getByTestId("graph-selection-bar");
    await expect(bar).toContainText("已选中");
    await page.getByRole("button", {name: "对象", exact: true}).click();
    await expect(bar).toHaveCount(0);
});

test("关系图的控件选择刷新后保留（输出 22，反馈 4）：类别、连线层、排版、只看周边、显示无名角色都存进浏览器偏好；坏偏好回到缺省", async ({page}) => {
    await open(page, "/book/fox/relations?at=38&perspective=reader");
    await expect(page.getByTestId("relation-graph").locator("canvas").first()).toBeVisible();
    const coLayer = page.locator('[data-layer="co"]');
    await expect(coLayer).toHaveAttribute("aria-pressed", "true");
    await coLayer.click();
    await page.getByRole("button", {name: "物品", exact: true}).click();
    await page.getByText("应力", {exact: true}).click();
    await expect(page.getByTestId("relation-graph").locator("canvas").first()).toBeVisible();
    await page.getByText("同心", {exact: true}).click();
    await page.getByTestId("strong-only").click();
    await page.getByTestId("show-anonymous").click();
    await page.getByText("只看选中的周边", {exact: true}).click();
    await page.reload();
    await expect(page.getByTestId("relation-graph").locator("canvas").first()).toBeVisible();
    await expect(page.locator('[data-layer="co"]')).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", {name: "物品", exact: true})).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("checkbox", {name: "显示无名角色"})).toBeChecked();
    await expect(page.getByRole("checkbox", {name: "只看选中的周边"})).toBeChecked();
    await expect(page.getByRole("radio", {name: "同心"})).toBeChecked();
    await expect(page.getByRole("checkbox", {name: "只画最强的线"})).toBeChecked();
    // 偏好被改坏：回缺省，不报错。
    await page.evaluate(() => window.localStorage.setItem("nbstory:relations-view", "{坏的"));
    await page.reload();
    await expect(page.locator('[data-layer="co"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("checkbox", {name: "显示无名角色"})).not.toBeChecked();
    await expect(page.getByRole("checkbox", {name: "只画最强的线"})).not.toBeChecked();
    await expect(page.getByTestId("page-error")).toHaveCount(0);
});

test("导入记忆图文件（输出 54，t29）：导入页选 V9 的 JSON 导入后跳到新书；同 id 再导入报已存在；不是记忆图的文件报错", async ({page}) => {
    await login(page.context(), server);
    await page.goto(`${server.base}/import`);
    const sample = `${server.library}/../sample.json`;
    await page.getByTestId("graph-import-file").setInputFiles(sample);
    await expect(page.getByTestId("graph-import-name")).toContainText("sample.json");
    await page.getByTestId("graph-import-title").fill("网页导入的一本");
    await page.getByTestId("graph-import-submit").click();
    await expect(page).toHaveURL(/\/book\/web-dao-ru-de-yi-ben|\/book\/[^/]+/u);
    await expect(page.getByTestId("book-title")).toContainText("网页导入的一本");
    // 同书名再导入：书 id 相同，报已存在。
    await page.goto(`${server.base}/import`);
    await page.getByTestId("graph-import-file").setInputFiles(sample);
    await page.getByTestId("graph-import-title").fill("网页导入的一本");
    await page.getByTestId("graph-import-submit").click();
    await expect(page.getByTestId("graph-import-error")).toContainText("已有同 id 的书");
    // 不是记忆图的文件。
    await page.getByTestId("graph-import-file").setInputFiles({name: "bad.json", mimeType: "application/json", buffer: Buffer.from("{}")});
    await page.getByTestId("graph-import-title").fill("坏文件");
    await page.getByTestId("graph-import-submit").click();
    await expect(page.getByTestId("graph-import-error")).toContainText("不是 V9 记忆图文件");
});

test("删除一本书（输出 54，t29）：书架每本书有删除按钮，确认后这本书从书架消失；取消不删", async ({page}) => {
    const sample = `${server.library}/../sample.json`;
    expect((await runCli(["import", sample, "--title", "待删的书", "--id", "to-remove", "--library", server.library])).code).toBe(0);
    await login(page.context(), server);
    await page.goto(`${server.base}/`);
    const row = page.locator('[data-testid="shelf-row"][data-book="to-remove"]');
    await expect(row).toBeVisible();
    await row.getByTestId("shelf-remove").click();
    await expect(page.getByRole("alertdialog")).toContainText("待删的书");
    await page.getByRole("button", {name: "取消"}).click();
    await expect(row).toBeVisible();
    await row.getByTestId("shelf-remove").click();
    await page.getByRole("button", {name: "删除", exact: true}).click();
    await expect(row).toHaveCount(0);
    // 别的书不受影响。
    await expect(page.locator('[data-testid="shelf-row"][data-book="fox"]')).toBeVisible();
});

test("安装 Skill（输出 54，t29）：设置页点安装得到已安装、再点没有改动；内容被改过要点“换成随包的内容”才替换；装进用例自己的家目录", async ({page}) => {
    const home = await mkdtemp(join(tmpdir(), "nbstory-e2e-home-"));
    // 自己的书库与服务（一个书库同时只有一个服务）；家目录指到临时目录，不碰真实的用户目录。
    const mine = await makeLibrary("skill");
    const own = await startServe(mine.library, {HOME: home, USERPROFILE: home});
    try {
        await login(page.context(), own);
        await page.goto(`${own.base}/settings`);
        await page.getByTestId("skill-install-claude").click();
        await expect(page.getByTestId("skill-result-claude")).toContainText("已安装");
        await expect(page.getByTestId("skill-result-claude")).toContainText(join(home, ".claude", "skills", "nbstory"));
        await page.getByTestId("skill-install-claude").click();
        await expect(page.getByTestId("skill-result-claude")).toContainText("没有改动");
        await writeFile(join(home, ".claude", "skills", "nbstory", "SKILL.md"), "被改过\n");
        await page.getByTestId("skill-install-claude").click();
        await expect(page.getByTestId("skill-result-claude")).toContainText("内容不同");
        expect(await readFile(join(home, ".claude", "skills", "nbstory", "SKILL.md"), "utf8")).toBe("被改过\n");
        await page.getByTestId("skill-force-claude").click();
        await expect(page.getByTestId("skill-result-claude")).toContainText("已换成随包的内容");
        // Codex 那一行没动。
        await expect(page.getByTestId("skill-result-codex")).toHaveCount(0);
    } finally {
        await own.stop();
        await mine.cleanup();
        await rm(home, {recursive: true, force: true});
    }
});

test("明暗切换与设置入口（输出 34，t27）：书架、导入、设置页顶部都有明暗切换，同一份偏好；书页导航底部的设置入口打开设置页，返回回到原来的页", async ({page}) => {
    // 书库里有两本以上时才留在书架（只有一本时登录后会直接打开它）。
    const file = `${server.library}/../sample.json`;
    expect((await runCli(["import", file, "--title", "第三本", "--id", "fox3", "--library", server.library])).code).toBe(0);
    await login(page.context(), server);
    await page.goto(`${server.base}/`);
    await expect(page.getByTestId("library")).toBeVisible();
    await page.getByTestId("theme-menu").click();
    await page.getByRole("menuitemradio", {name: "暗色"}).click();
    await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "dark");
    // 设置页、导入页是同一份偏好：刷新后仍是暗色，这两页的控件也在。
    await page.goto(`${server.base}/settings`);
    await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "dark");
    const themeButton = page.getByTestId("settings-page").getByTestId("theme-menu");
    await expect(themeButton).toBeVisible();
    // 在设置页标题行的右端（class 要落到按钮上），不是紧贴标题。
    const head = (await page.locator(".settings-head").boundingBox())!;
    const button = (await themeButton.boundingBox())!;
    expect(head.x + head.width - (button.x + button.width)).toBeLessThan(4);
    await page.goto(`${server.base}/import`);
    await page.getByTestId("theme-menu").click();
    await page.getByRole("menuitemradio", {name: "亮色"}).click();
    await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "light");

    // 书页：导航底部的设置入口 → 设置页 → 返回回到这一页。
    await open(page, "/book/fox/relations?at=38&perspective=reader");
    await page.getByTestId("nav-settings").click();
    await expect(page.getByTestId("settings-page")).toBeVisible();
    await page.getByRole("button", {name: "返回"}).click();
    await expect(page).toHaveURL(/\/book\/fox\/relations/u);
});

test("外壳（输出 1、3、4、5、34、35）：第一次打开是全部读完；明暗切换并保持；书架入口与换书；没有页脚，保存失败提示在顶栏", async ({page}) => {
    // 另导入一本从没打开过的书：第一次打开读到抽取到的最后位置。
    const file = `${server.library}/../sample.json`;
    expect((await runCli(["import", file, "--title", "第二本", "--id", "fox2", "--library", server.library])).code).toBe(0);
    await open(page, "/book/fox2");
    await expect(page.getByTestId("reading-label")).toContainText("全部读完");
    await expect(page).toHaveURL(/at=100/u);
    await expect(page.getByTestId("reading-end")).toHaveCount(0);
    await expect(page.getByTestId("footer")).toHaveCount(0);

    await page.getByTestId("theme-menu").click();
    await page.getByRole("menuitemradio", {name: "暗色"}).click();
    await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "dark");
    await page.getByTestId("theme-menu").click();
    await page.getByRole("menuitemradio", {name: "亮色"}).click();
    await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "light");

    // 书名下拉换到另一本；书架入口回到书架，书架列出两本。
    await page.getByTestId("book-switcher").click();
    await page.getByRole("menuitem", {name: "转生反派萝莉，找茬魔法少女"}).click();
    await expect(page).toHaveURL(/\/book\/fox\//u);
    await page.getByTestId("go-shelf").click();
    await expect(page.getByTestId("library")).toContainText("第二本");
    await expect(page.getByTestId("library")).toContainText("转生反派萝莉，找茬魔法少女");

    // 保存失败：提示出现在顶栏。
    await open(page, "/book/fox2/overview?at=30");
    await page.route("**/api/rpc/reading.set", route => route.fulfill({status: 500, contentType: "application/json", body: JSON.stringify({code: "internal", message: "坏了"})}));
    await page.getByRole("button", {name: "下一章"}).click();
    await expect(page.locator("header").getByTestId("save-failed")).toBeVisible();
    await page.unroute("**/api/rpc/reading.set");
    expect((await runCli(["remove", "fox2", "--library", server.library])).code).toBe(0);
});

test("总览的入口（输出 8）：点主线到情节页只看这条主线；点秘密到秘密页并高亮那一行", async ({page}) => {
    await open(page, "/book/fox/overview?at=38&perspective=reader");
    const arc = page.getByTestId("overview-arc").first();
    const title = (await arc.textContent())!.trim();
    await arc.click();
    await expect(page.getByTestId("page-episodes")).toBeVisible();
    await expect(page.getByTestId("page-episodes").locator(".story-page-title")).toContainText(title);
    await page.getByRole("button", {name: "全书总览"}).click();
    await page.getByTestId("overview-secret").filter({hasText: "心月狐就是苏天晴"}).click();
    await expect(page.locator('tr.is-highlight[data-secret]')).toContainText("心月狐就是苏天晴");
});

test("全书图按章节（输出 30）：Ctrl 加滚轮只在水平方向放大，章节条的范围变窄；滚轮平移", async ({page}) => {
    await open(page, "/book/fox/book-graph?at=100&perspective=reader");
    const label = page.getByTestId("chapter-range-label");
    await expect(label).toHaveText("第 1 到 100 章");
    const box = (await page.getByTestId("storyline").locator("canvas").first().boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down("Control");
    for (let index = 0; index < 6; index += 1) await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await expect(label).not.toHaveText("第 1 到 100 章");
    const zoomed = await label.textContent();
    await page.mouse.wheel(0, 300);
    await expect(label).not.toHaveText(zoomed!);
});

test("往回拨到视角人物出场之前（输出 4）：换回读者视角并提示，页面不报错", async ({page}) => {
    // e47-5（导购员）第 47 章才出场：以他的视角在第 47 章打开关系图，再拨到第 46 章。
    await open(page, "/book/fox/relations?at=47&perspective=e47-5");
    await expect(page.getByTestId("relation-graph").locator("canvas").first()).toBeVisible();
    await page.getByRole("button", {name: "上一章"}).click();
    await expect(page.getByTestId("notice")).toContainText("已换回读者视角");
    await expect(page).toHaveURL(/perspective=reader/u);
    await expect(page.getByTestId("reading-label")).toContainText("第 46 章");
    await expect(page.getByTestId("page-error")).toHaveCount(0);
});
