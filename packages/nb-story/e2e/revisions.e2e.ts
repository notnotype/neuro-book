/**
 * 图的修订的真实浏览器验收（docs/specs/story/viewer.md 输出 58 到 62、验收 14）：生产构建的网页、真实的 `nbstory serve`、
 * 100 章样例书。样例书第 30 章第 61 段有一条候选身份说法 s30-13（e30-1 与 e10-1）；第 21、27 章各有一条已被后文确认的候选。
 * 每个用例开始前撤销所有修订、清掉存下的阅读状态，用例之间互不依赖。
 */

import {expect, test, type Page} from "@playwright/test";

import {login, makeLibrary, startServe, type StoryServer} from "./fixtures";

let server: StoryServer;
let cleanup: () => Promise<void>;

test.beforeAll(async () => {
    const library = await makeLibrary("revisions");
    cleanup = library.cleanup;
    server = await startServe(library.library);
});
test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    await cleanup();
});
test.beforeEach(async ({context, page}) => {
    await login(context, server);
    const listed = await rpc<{items: {id: string; undoable: boolean}[]}>(page, "revisions.list", {at: {chapter: 100}, state: "processed", limit: 500});
    for (const item of listed.items) if (item.undoable) await rpc(page, "revisions.undo", {revision: item.id});
    await rpc(page, "reading.set", {position: {chapter: 1}, view: null});
});

async function open(page: Page, path: string): Promise<void> {
    await page.goto(`${server.base}${path}`);
    await expect(page.getByTestId("book-frame")).toBeVisible();
}
async function rpc<T>(page: Page, method: string, params: Record<string, unknown>): Promise<T> {
    const response = await page.context().request.post(`${server.base}/api/rpc/${method}`, {data: {book: "fox", ...params}});
    expect(response.ok(), `${method} ${await response.text()}`).toBe(true);
    return (await response.json()) as T;
}
type Counts = {counts: {pending: number; adopted: number; rejected: number; closed: number; stale: number}};
/** 对象在这个阅读位置的种类（人物卡给的）。 */
const KIND_AT = async (page: Page, chapter: number, paragraph: number, entity: string) => (await rpc<{kind: string}>(page, "entity.card", {at: {chapter, paragraph}, entity})).kind;

test("人物卡上就地确认：候选块带依据原文，确认后头部“同一身份”标“你确认的”、角标消失，撤销后回来；刷新后修订还在（输出 59、62）", async ({page}) => {
    await open(page, "/book/fox/roster?at=30.61&entity=e30-1");
    const block = page.getByTestId("candidate-block");
    await expect(block).toBeVisible();
    await expect(block).toContainText("猫娘眯起眼睛");
    await expect(block).toContainText("确认后从第 30 章第 61 段起生效");
    await expect(page.getByTestId("revisions-badge")).toHaveText("1");
    await page.getByTestId("candidate-confirm").click();
    await expect(page.getByTestId("candidate-done")).toContainText("已确认");
    await expect(page.getByTestId("candidate-confirm")).toHaveCount(0);
    await expect(page.getByTestId("card-identities")).toContainText("你确认的");
    await expect(page.getByTestId("revisions-badge")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("card-identities")).toContainText("你确认的");
    await page.getByRole("tab", {name: /记录/u}).click();
    await page.getByRole("radio", {name: /关于他的/u}).click();
    await expect(page.getByTestId("statement-mark").first()).toHaveText("你确认的");
    await open(page, "/book/fox/roster?at=30.61&entity=e30-1");
    await expect(page.getByTestId("candidate-confirm")).toHaveCount(0);
    expect((await rpc<Counts>(page, "revisions.list", {at: {chapter: 30, paragraph: 61}})).counts).toMatchObject({adopted: 1, pending: 0});
});

test("人物卡“同一身份”里断开确定的连接：点一次驳回一条说法，两个对象还有别的连线时仍在，都断开后消失，撤销带回；记录进已驳回（输出 64）", async ({page}) => {
    await open(page, "/book/fox/roster?at=30.61&entity=e1-1");
    const identities = page.getByTestId("card-identities");
    const unlink = page.getByRole("button", {name: "断开与狐狐的连接"});
    await expect(identities).toContainText("狐狐");
    await unlink.click();
    await expect(page.getByTestId("identity-unlinked")).toContainText("已断开：狐狐");
    await expect(unlink).toBeVisible();
    await unlink.click();
    await expect(identities).not.toContainText("狐狐");
    expect((await rpc<Counts>(page, "revisions.list", {at: {chapter: 30, paragraph: 61}})).counts).toMatchObject({rejected: 2});
    await page.getByTestId("identity-unlink-undo").click();
    await expect(identities).toContainText("狐狐");
    expect((await rpc<Counts>(page, "revisions.list", {at: {chapter: 30, paragraph: 61}})).counts).toMatchObject({rejected: 1});
});

test("导航角标按阅读位置算：第 29 章时没有角标、待确认页写“没有需要确认的”，读到第 30 章第 61 段出现（输出 58）", async ({page}) => {
    await open(page, "/book/fox/revisions?at=29");
    await expect(page.getByText("没有需要确认的")).toBeVisible();
    await expect(page.getByTestId("revisions-badge")).toHaveCount(0);
    await open(page, "/book/fox/revisions?at=30.61");
    await expect(page.getByTestId("revisions-badge")).toHaveText("1");
    await expect(page.locator('[data-revision="st:s30-13"]')).toBeVisible();
});

test("待确认页：卡片带依据原文，点一句话打开人物卡且那条候选高亮；驳回后到已处理（带时间），撤销后回到待确认；来源筛选后的空态（输出 58）", async ({page}) => {
    await open(page, "/book/fox/revisions?at=30.61");
    const card = page.locator('[data-revision="st:s30-13"]');
    await expect(card).toBeVisible();
    await expect(card.locator(".evidence-quote")).toContainText("猫娘眯起眼睛");
    await card.getByTestId("revision-summary").click();
    await expect(page.getByTestId("entity-card")).toBeVisible();
    await expect(page.locator('[data-statement="st:s30-13"]')).toHaveClass(/is-focused/u);
    await page.getByRole("radio", {name: "我的"}).click();
    await expect(page.getByText("没有需要确认的")).toBeVisible();
    await page.getByRole("radio", {name: "全部"}).click();
    await card.getByTestId("revision-reject").click();
    await expect(page.getByTestId("revisions-last")).toContainText("已驳回");
    await expect(card).toHaveCount(0);
    await page.getByRole("tab", {name: /已处理/u}).click();
    const rejected = page.locator('article[data-state="rejected"]');
    await expect(rejected).toBeVisible();
    await expect(rejected.getByTestId("revision-time")).not.toBeEmpty();
    await expect(page.locator('article[data-state="closed"]')).toHaveCount(2);
    await rejected.getByTestId("revision-undo").click();
    await page.getByRole("tab", {name: /待确认/u}).click();
    await expect(card).toBeVisible();
});

test("“⋯”菜单改对象种类：不预选种类，依据段必选；依据之前的阅读位置仍是马甲、之后是人物（输出 60、验收 14）", async ({page}) => {
    await open(page, "/book/fox/roster?at=3.30&entity=e3-2");
    expect(await KIND_AT(page, 3, 30, "e3-2")).toBe("persona");
    await page.getByTestId("card-revise-menu").click();
    await page.getByRole("menuitem", {name: /改对象种类/u}).click();
    const dialog = page.getByTestId("revise-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("revise-submit")).toBeDisabled();
    await dialog.locator("[data-ref]").first().click();
    await expect(page.getByTestId("revise-submit")).toBeDisabled();
    await dialog.getByText("人物", {exact: true}).click();
    await expect(page.getByTestId("revise-effects")).toContainText("按人物算");
    const chosen = (await dialog.locator("[data-ref]").first().getAttribute("data-ref"))!;
    const [chapter, paragraph] = chosen.split(".").map(Number) as [number, number];
    await page.getByTestId("revise-submit").click();
    await expect(dialog).toHaveCount(0);
    expect(await KIND_AT(page, chapter, paragraph - 1, "e3-2")).toBe("persona");
    expect(await KIND_AT(page, chapter, paragraph, "e3-2")).toBe("person");
    await page.getByTestId("card-revise-menu").click();
    await expect(page.getByRole("menuitem", {name: "这个对象的修订（1）"})).toBeVisible();
});

test("对本来就是人物的对象改种类：选项里没有“人物”、也没有预选，选了依据段仍不能提交，点一个种类后才能（输出 60）", async ({page}) => {
    await open(page, "/book/fox/roster?at=30.61&entity=e1-1");
    await page.getByTestId("card-revise-menu").click();
    await page.getByRole("menuitem", {name: /改对象种类/u}).click();
    const dialog = page.getByTestId("revise-dialog");
    await expect(dialog.getByText("现在是人物，改成")).toBeVisible();
    await expect(dialog.getByText("人物", {exact: true})).toHaveCount(0);
    await dialog.locator("[data-ref]").first().click();
    await expect(page.getByTestId("revise-submit")).toBeDisabled();
    await dialog.getByText("组织", {exact: true}).click();
    await expect(page.getByTestId("revise-submit")).toBeEnabled();
});

test("连到另一个对象：搜、选、选依据，写成“就是”；人物卡的记录里标“你加的”；“这个对象的修订（N）”只看这个对象的、能撤销（输出 59、60）", async ({page}) => {
    await open(page, "/book/fox/roster?at=10.30&entity=e3-2");
    await page.getByTestId("card-revise-menu").click();
    await page.getByRole("menuitem", {name: /连到另一个对象/u}).click();
    const dialog = page.getByTestId("revise-dialog");
    await page.getByPlaceholder("按名字或称呼搜").fill("苏天晴");
    await page.locator('[data-entity="e1-1"]').click();
    await dialog.getByText("就是（确定）").click();
    await dialog.locator("[data-ref]").first().click();
    await page.getByTestId("revise-submit").click();
    await expect(dialog).toHaveCount(0);
    expect((await rpc<Counts>(page, "revisions.list", {at: {chapter: 10, paragraph: 30}})).counts.adopted).toBe(1);
    await page.getByRole("tab", {name: /记录/u}).click();
    await page.getByRole("radio", {name: /关于他的/u}).click();
    await expect(page.getByTestId("statement-mark").filter({hasText: "你加的"})).toBeVisible();
    await page.getByTestId("card-revise-menu").click();
    await page.getByRole("menuitem", {name: "这个对象的修订（1）"}).click();
    await expect(page.getByTestId("revisions-entity-filter")).toBeVisible();
    await page.getByRole("tab", {name: /已处理/u}).click();
    const mine = page.locator('article[data-state="adopted"]');
    await expect(mine).toHaveCount(1);
    await mine.getByTestId("revision-undo").click();
    await expect(mine).toHaveCount(0);
});

test("挪称呼：选称呼、选对象、选依据；依据之后人物卡的称呼表多了它，之前没有（输出 60、验收 14）", async ({page}) => {
    await open(page, "/book/fox/roster?at=3.30&entity=e1-1");
    await page.getByTestId("card-revise-menu").click();
    await page.getByRole("menuitem", {name: /某个称呼属于别的对象/u}).click();
    const dialog = page.getByTestId("revise-dialog");
    await dialog.locator('[data-name="狐狐"]').click();
    await page.getByPlaceholder("按名字或称呼搜").fill("风信子");
    await page.locator('[data-entity="e3-2"]').click();
    const chosen = (await dialog.locator("[data-ref]").first().getAttribute("data-ref"))!;
    await dialog.locator("[data-ref]").first().click();
    await page.getByTestId("revise-submit").click();
    await expect(dialog).toHaveCount(0);
    const [chapter, paragraph] = chosen.split(".").map(Number) as [number, number];
    const names = async (at: {chapter: number; paragraph: number}) => (await rpc<{names: {text: string}[]}>(page, "entity.card", {at, entity: "e3-2"})).names.map(name => name.text);
    expect(chapter).toBe(3);
    expect(await names({chapter: 3, paragraph: 30})).toContain("狐狐");
    expect(await names({chapter: 3, paragraph: paragraph - 1})).not.toContain("狐狐");
});

test("手写的依据位置晚于阅读位置：对话框写出原因、不能提交；服务端拒绝的（不存在的段）写在页脚、对话框不关闭（输出 60、62）", async ({page}) => {
    await open(page, "/book/fox/roster?at=3&entity=e3-2");
    await page.getByTestId("card-revise-menu").click();
    await page.getByRole("menuitem", {name: /改对象种类/u}).click();
    const dialog = page.getByTestId("revise-dialog");
    await dialog.getByText("人物", {exact: true}).click();
    await page.getByPlaceholder("例如 5.75").fill("4.5");
    await expect(page.locator("[data-dialog-status]")).toContainText("晚于现在的阅读位置");
    await expect(page.getByTestId("revise-submit")).toBeDisabled();
    await page.getByPlaceholder("例如 5.75").fill("3.999");
    await page.getByTestId("revise-submit").click();
    await expect(page.locator("[data-dialog-status-error]")).toContainText("第 3 章没有第 999 段");
    await expect(dialog).toBeVisible();
});

test("手机宽度：待确认页单列、“更多”带点且完整导航里有“待确认”；点卡片上的一句话从底部拉起人物卡并能确认（输出 61）", async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await open(page, "/book/fox/revisions?at=30.61");
    const card = page.locator('[data-revision="st:s30-13"]');
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByTestId("revisions-dot")).toBeVisible();
    await page.getByRole("button", {name: /更多/u}).click();
    await expect(page.getByRole("navigation", {name: "页面"}).getByText("待确认")).toBeVisible();
    await page.getByRole("navigation", {name: "页面"}).getByText("待确认").click();
    await card.getByTestId("revision-summary").click();
    await expect(page.getByTestId("drawer")).toBeVisible();
    await page.getByTestId("candidate-confirm").click();
    await expect(page.getByTestId("candidate-done")).toBeVisible();
});
