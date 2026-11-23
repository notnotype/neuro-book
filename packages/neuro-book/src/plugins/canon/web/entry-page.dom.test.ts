/**
 * 条目页（entry-page.ts、EntryPageHost.vue；docs/specs/canon/author-ui.md 输出 6 到 15、26、27，验收 1、2、7、13）接在进程内的
 * 真实世界上：canon 的浏览器入口照产品那样把页面交给编辑器的贡献点，测试插件（`testing/page-stand-in.ts`）扮演编辑器收下它，
 * 按编辑器的做法给每个标签一份 `context`。数据都经真实的世界服务发布。
 */

import {appendFile, mkdir, readdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {mount} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {reactive} from "vue";
import type {Component} from "vue";

import type {Entry, ReadPosition, StoryChangeDraft} from "@notnotype/nb-canon";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {EditorPageContext, EditorPageImplementation} from "nbook/plugins/editor/web/pages";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {CANON_BUDGET_BYTES} from "../shared/contracts";
import {countedClient} from "../testing/counted-client";
import {pageStandIn} from "../testing/page-stand-in";
import {change, nextId, person, publish} from "../testing/world-fixtures";
import {canonNodeWorld} from "../testing/node-world";
import type {CanonNodeWindow, CanonNodeWorld} from "../testing/node-world";
import {CANON_COMPONENTS_POINT} from "../shared/contracts";
import {ENTRY_PAGE} from "./commands";
import {ComponentViewRegistry} from "./component-views";
import EntryPage from "./components/EntryPage.vue";
import EntryText from "./components/EntryText.vue";
import EntryTree from "./components/EntryTree.vue";
import {createEntriesViewHost, entriesViewState} from "./entries-view";
import {createEntryPage, originsFetcher} from "./entry-page";
import {createNotices} from "./notices";
import {ENTRIES_VIEW_ID} from "./plugin";
import {createRevertRequests} from "./revert";
import {createTextDrafts} from "./text-drafts";
import type {EntryPageState} from "./entry-page";
import {canonCatalogs} from "./text";
import {createCanonWorld} from "./world";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});

let tmp: string;
let venue: CanonNodeWorld | null = null;
const cleanups: Array<() => void> = [];

beforeEach(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "entry-page");
    // 两章；活页夹清单要在世界打开前就在，章表第一次读就有。
    await mkdir(join(tmp, "Book", "manuscripts.binder"), {recursive: true});
    await writeFile(join(tmp, "Book", "manuscripts.binder", "binder.xml"), '<binder nextId="3"><chapter id="1" title="入学"/><chapter id="2" title="打工"/></binder>');
});

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    await venue?.close();
    venue = null;
    await rm(tmp, {recursive: true, force: true});
    document.body.innerHTML = "";
});

interface Opened {
    readonly wrapper: ReturnType<typeof mount>;
    readonly state: EntryPageState;
    remount(): ReturnType<typeof mount>;
}

async function setup(project: readonly PluginDefinition[] = []): Promise<{other: CanonNodeWindow; page: EditorPageImplementation<EntryPageState>; open: (id: string, state?: EntryPageState) => Promise<Opened>; tree: () => Promise<ReturnType<typeof mount>>}> {
    venue = await canonNodeWorld(tmp, {project});
    const editor = pageStandIn();
    await venue.window("mine", [editor.plugin]);
    const other = await venue.window("other");
    const page = editor.page<EntryPageState>(ENTRY_PAGE);
    const component: Component = await page.load();
    const open = async (id: string, given?: EntryPageState): Promise<Opened> => {
        // 同编辑器：每个标签一份 context，`state` 是 initialState 的响应式副本，切走再回来是同一个。
        const context: EditorPageContext<EntryPageState> = {recent: [], arg: id, state: given ?? reactive(page.initialState!(id))};
        const mountOnce = (): ReturnType<typeof mount> => {
            const wrapper = mount(component, {props: {context}, global: {provide: provideText(port)}, attachTo: document.body});
            cleanups.push(() => wrapper.unmount());
            return wrapper;
        };
        return {wrapper: mountOnce(), state: context.state, remount: mountOnce};
    };
    // 同一个浏览器入口交给工作台的设定视图：与页面共用窗口里那一份视图状态。
    const tree = async (): Promise<ReturnType<typeof mount>> => {
        const wrapper = mount(await editor.view(ENTRIES_VIEW_ID).implementation.load(), {global: {provide: provideText(port)}, attachTo: document.body});
        cleanups.push(() => wrapper.unmount());
        return wrapper;
    };
    return {other, page, open, tree};
}

const valueText = (wrapper: ReturnType<typeof mount>): string => wrapper.find("[data-value]").text();
/** 一行里各段的文字用空格隔开（段与段之间在页面上是间距，不是空格）。 */
const cells = (element: Element): string => [...element.children].map((child) => child.textContent?.replace(/\s+/gu, " ").trim() ?? "").filter((part) => part !== "").join(" ");
const originRows = (wrapper: ReturnType<typeof mount>): string[] => wrapper.findAll("[data-origin-row]").map((row) => cells(row.element));

describe("条目页", () => {
    it("页头、标签标题与面包屑；缺省位置是最新一章末尾；换位置后文字里的值跟着变", async () => {
        const {other, page, open} = await setup();
        const star = person("星瑕");
        const ids = await publish(other.canon, [star]);
        const id = ids[star.id]!;
        const brother = person("哥哥", {parent: id});
        const brotherId = (await publish(other.canon, [brother]))[brother.id]!;
        await publish(other.canon, [change(id, "1", "领了工资", 200), change(id, "2", "买了书", -300)]);

        const {wrapper, state} = await open(brotherId);
        await waitUntil("页头", () => wrapper.find("h1").exists() && wrapper.find("h1").text() === "哥哥");
        expect(page.title!(brotherId)).toBe("哥哥");
        expect(page.breadcrumbs!(brotherId)?.map((crumb) => crumb.label)).toEqual([{kind: "text", ns: "nbook.canon", key: "views.entries.title"}, "人物", "星瑕", "哥哥"]);
        expect(page.breadcrumbs!(brotherId)?.[0]?.command).toEqual({id: "nbook.view.open", args: {viewId: "nbook.canon.entries"}});
        expect(page.breadcrumbs!(brotherId)?.[2]?.command).toEqual({id: "nbook.canon.open-entry", args: {id}});

        const star2 = await open(id);
        await waitUntil("文字里的值", () => star2.wrapper.find("[data-value]").exists());
        expect(valueText(star2.wrapper)).toBe("900");
        expect(star2.wrapper.text()).toContain("第 2 章改过");
        expect(state.position).toBeNull();

        star2.state.position = "1:end";
        await waitUntil("第 1 章末尾的值", () => valueText(star2.wrapper) === "1,200");
        expect(star2.wrapper.text()).not.toContain("读取中");
    });

    it("点值才读来历：从新到旧，估计的依据写“估计”，初值在最后；再点收起", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        await publish(other.canon, [change(id, "1", "领了工资", 200), change(id, "2", "买了书", -300, {kind: "estimate", note: "书大概三百"})]);

        const {wrapper} = await open(id);
        await waitUntil("文字里的值", () => wrapper.find("[data-value]").exists());
        expect(wrapper.find("[data-origin-list]").exists()).toBe(false);
        await wrapper.get("[data-value]").trigger("click");
        await waitUntil("来历", () => originRows(wrapper).length === 3);
        expect(originRows(wrapper)).toEqual([
            "第 2 章 买了书 估计：书大概三百 −300 900 元 改这一笔",
            "第 1 章 领了工资 作者给的 +200 1,200 元 改这一笔",
            "初值 1,000 元",
        ]);
        expect(wrapper.find("[data-origin-row] .text-\\[var\\(--status-warning\\)\\]").text()).toBe("估计：书大概三百");
        await wrapper.get("[data-value]").trigger("click");
        expect(wrapper.find("[data-origin-list]").exists()).toBe(false);
    });

    it("展开着来历时：别处发布以后按已读的步数重读；换位置以后来历跟着换；换位置期间不出加载占位", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        await publish(other.canon, [change(id, "1", "领了工资", 200), change(id, "2", "买了书", -300)]);
        const {wrapper, state} = await open(id);
        await waitUntil("值", () => wrapper.find("[data-value]").exists() && valueText(wrapper) === "900");
        await wrapper.get("[data-value]").trigger("click");
        await waitUntil("来历", () => originRows(wrapper).length === 3);

        await publish(other.canon, [change(id, "2", "又买了笔", -50)]);
        await waitUntil("来历跟着更新", () => originRows(wrapper).length === 4);
        expect(originRows(wrapper)[0]).toBe("第 2 章 又买了笔 作者给的 −50 850 元 改这一笔");

        const seen: string[] = [];
        const observer = new MutationObserver(() => seen.push(wrapper.text()));
        observer.observe(wrapper.element, {subtree: true, childList: true, characterData: true});
        cleanups.push(() => observer.disconnect());
        state.position = "1:end";
        await waitUntil("值与来历都换成第 1 章末尾的", () => valueText(wrapper) === "1,200" && originRows(wrapper).length === 2);
        expect(originRows(wrapper)).toEqual(["第 1 章 领了工资 作者给的 +200 1,200 元 改这一笔", "初值 1,000 元"]);
        expect(seen.some((shown) => shown.includes("读取中"))).toBe(false);
    });

    it("标签标题与面包屑写缺省位置上的名字：换位置看到别的名字时，标题不跟着变", async () => {
        const {other, page, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const renamed = `tmp:${nextId()}`;
        await publish(other.canon, [{ref: {kind: "change", id: renamed}, after: {id: renamed, kind: "written", text: "改了名", at: {kind: "chapter", chapter: "2", key: 1}, told: [], involves: [id], lines: [], links: [], status: "active", by: {kind: "author"}, patches: [{op: "set", at: {entry: id, path: "entry.name"}, value: "星瑕（新名）"}]} satisfies StoryChangeDraft}]);
        const {wrapper, state} = await open(id);
        await waitUntil("缺省位置上的名字", () => wrapper.find("h1").exists() && wrapper.find("h1").text() === "星瑕（新名）");
        expect(page.title!(id)).toBe("星瑕（新名）");
        state.position = "initial";
        await waitUntil("初值的名字", () => wrapper.find("h1").text() === "星瑕");
        expect(page.title!(id)).toBe("星瑕（新名）");
        expect(page.breadcrumbs!(id)?.at(-1)?.label).toBe("星瑕（新名）");
    });

    it("来历很长时先列最近 20 步与初值一行，“再显示更早的”接着读", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        await publish(other.canon, Array.from({length: 25}, (_, index) => change(id, index < 12 ? "1" : "2", `第 ${String(index + 1)} 笔`, 10)));

        const {wrapper} = await open(id);
        await waitUntil("文字里的值", () => wrapper.find("[data-value]").exists());
        await wrapper.get("[data-value]").trigger("click");
        await waitUntil("第一页", () => originRows(wrapper).length === 21);
        expect(originRows(wrapper).at(-1)).toBe("初值 1,000 元");
        expect(wrapper.text()).toContain("再显示更早的（还有 5 步）");
        const more = wrapper.findAll("button").find((button) => button.text().startsWith("再显示更早的"))!;
        await more.trigger("click");
        await waitUntil("读完", () => originRows(wrapper).length === 26);
        expect(wrapper.text()).not.toContain("再显示更早的");
        // 读完以后最早那一笔的变化量按初值算出来了。
        expect(originRows(wrapper).at(-2)).toBe("第 1 章 第 1 笔 作者给的 +10 1,010 元 改这一笔");
    });

    it("标签的状态随标签：卸载再挂上还在；两个条目各有各的", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const sister = person("星瑾", {}, 50);
        const ids = await publish(other.canon, [star, sister]);
        await publish(other.canon, [change(ids[star.id]!, "1", "领了工资", 200)]);

        const first = await open(ids[star.id]!);
        await waitUntil("值", () => first.wrapper.find("[data-value]").exists());
        first.state.position = "1:start";
        await waitUntil("换了位置", () => valueText(first.wrapper) === "1,000");
        await first.wrapper.get("[data-value]").trigger("click");
        await waitUntil("来历", () => first.wrapper.find("[data-origin-list]").exists());
        first.wrapper.unmount();

        const second = await open(ids[sister.id]!);
        await waitUntil("星瑾的值", () => second.wrapper.find("[data-value]").exists() && valueText(second.wrapper) === "50");
        expect(second.state.position).toBeNull();

        const again = first.remount();
        await waitUntil("回来以后的值", () => again.find("[data-value]").exists() && valueText(again) === "1,000");
        expect(again.find("[data-origin-list]").exists()).toBe(true);
    });

    it("选着的那一章被删掉：位置回到缺省，并写一句“原来选的那一章已经不在了”；再换位置以后这句消失", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        await publish(other.canon, [change(id, "2", "买了书", -300)]);
        const {wrapper, state} = await open(id);
        await waitUntil("值", () => wrapper.find("[data-value]").exists() && valueText(wrapper) === "700");
        state.position = "1:end";
        await waitUntil("第 1 章末尾", () => valueText(wrapper) === "1,000");

        // 活页夹清单里拿掉第 1 章（宿主改章序，世界服务收到章表变了）。
        await writeFile(join(tmp, "Book", "manuscripts.binder", "binder.xml"), '<binder nextId="3"><chapter id="2" title="打工"/></binder>');
        await waitUntil("回到缺省位置", () => wrapper.text().includes("原来选的那一章已经不在了"), {timeoutMs: 10_000});
        expect(state.position).toBeNull();
        expect(valueText(wrapper)).toBe("700");
        state.position = "initial";
        await waitUntil("这句消失", () => !wrapper.text().includes("原来选的那一章已经不在了"));
    });

    it("情节分页：从新到旧，写它对这个条目的改动，分页名后是总条数；数据分页用字段表", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        await publish(other.canon, [change(id, "1", "领了工资", 200), change(id, "2", "买了书", -300)]);

        const {wrapper, state} = await open(id);
        await waitUntil("值", () => wrapper.find("[data-value]").exists());
        const tabs = () => wrapper.findAll("[role='tab']").map((tab) => tab.text().replace(/\s+/gu, ""));
        await waitUntil("情节的条数", () => tabs().includes("情节2"));
        expect(tabs()).toEqual(["文字", "人物", "面板", "情节2"]);

        state.tab = "plot";
        await waitUntil("情节", () => wrapper.findAll("[data-change]").length === 2);
        expect(wrapper.findAll("[data-change]").map((row) => row.text().replace(/\s+/gu, ""))).toEqual(["第2章买了书存款−300", "第1章领了工资存款+200"]);

        state.tab = "data:character";
        // 内置人物的字段按声明的顺序列出；条目数据里没写的（身体、现在的样子、性格）是未知。
        await waitUntil("人物的字段", () => wrapper.findAll("[data-field]").length === 6);
        expect(wrapper.get("[data-field='character.样子']").text()).toContain("未知");
        expect(wrapper.get("[data-field='character.外观']").text()).toContain("黑发");
        expect(wrapper.get("[data-field='character.状态']").text()).toContain("未知");

        state.tab = "data:panel";
        await waitUntil("面板的值卡与流水", () => wrapper.find("[data-card='panel.存款']").exists() && originRows(wrapper).length === 3);
        expect(wrapper.get("[data-card='panel.存款']").text()).toContain("900 元");
    });

    it("别处发布以后原地更新，不出加载占位；找不到、已删除、未出场", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const late = person("彗", {appears: {kind: "chapter", chapter: "2", key: 0}});
        const ids = await publish(other.canon, [star, late]);
        const id = ids[star.id]!;

        const {wrapper} = await open(id);
        await waitUntil("值", () => wrapper.find("[data-value]").exists() && valueText(wrapper) === "1,000");
        // 记下更新期间每一次 DOM 变化后的文字：重读期间不该有一刻是加载占位。
        const seen: string[] = [];
        const observer = new MutationObserver(() => seen.push(wrapper.text()));
        observer.observe(wrapper.element, {subtree: true, childList: true, characterData: true});
        cleanups.push(() => observer.disconnect());
        await publish(other.canon, [change(id, "2", "买了书", -300)]);
        await waitUntil("原地更新", () => valueText(wrapper) === "700");
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.some((shown) => shown.includes("读取中"))).toBe(false);

        const missing = await open("e:nothing");
        await waitUntil("找不到", () => missing.wrapper.text().includes("找不到这个条目"));

        const stored = await other.canon.call("object", {ref: {kind: "entry", id}});
        if (!stored.ok) throw new Error(JSON.stringify(stored.failure));
        await publish(other.canon, [{ref: {kind: "entry", id}, after: {...(stored.value.object as Entry), deleted: true}}]);
        await waitUntil("已删除", () => wrapper.text().includes("这个条目已删除"));
        expect(wrapper.find("h1").text()).toBe("星瑕");

        const unappeared = await open(ids[late.id]!);
        unappeared.state.position = "1:end";
        // 章标题来自章节文件名（活页夹约定），这里没有章节文件，所以只有序号。
        await waitUntil("未出场", () => unappeared.wrapper.text().includes("在第 1 章末尾还没出场"));
    });

    it("项目实例停止：页面顶上有“世界已断开”，内容留着", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper} = await open(id);
        await waitUntil("值", () => wrapper.find("[data-value]").exists());
        await venue!.endProject();
        await waitUntil("横幅", () => wrapper.text().includes("世界已断开"), {timeoutMs: 10_000});
        expect(wrapper.find("[data-value]").exists()).toBe(true);
    });

    it("条目页挂上时设定树选中它的条目：开了星瑕又开星瑾，切回星瑕的标签，选中的是星瑕", async () => {
        const {other, open, tree} = await setup();
        const star = person("星瑕");
        const sister = person("星瑾");
        const ids = await publish(other.canon, [star, sister]);
        const view = await tree();
        await waitUntil("分组", () => view.find('[data-tree-id="folder:人物"]').exists());
        await view.get('[data-tree-id="folder:人物"]').trigger("click");
        await waitUntil("条目出现", () => view.find(`[data-tree-id="${ids[sister.id]!}"]`).exists());
        const selected = (id: string) => view.get(`[data-tree-id="${id}"]`).attributes("aria-selected") === "true";

        // 编辑器只挂活动标签：开星瑾的页时星瑕的页卸载，切回来再挂上。
        const starPage = await open(ids[star.id]!);
        await waitUntil("选中星瑕", () => selected(ids[star.id]!));
        starPage.wrapper.unmount();
        const sisterPage = await open(ids[sister.id]!);
        await waitUntil("选中星瑾", () => selected(ids[sister.id]!) && !selected(ids[star.id]!));
        sisterPage.wrapper.unmount();
        starPage.remount();
        await waitUntil("切回星瑕", () => selected(ids[star.id]!) && !selected(ids[sister.id]!));
    });
});

describe("读取次数", () => {
    it("条目页开着、树展开两层时，别处一次发布引起的读取：每个在用的读取重读一次", async () => {
        venue = await canonNodeWorld(tmp);
        const mine = await venue.window("mine");
        const other = await venue.window("other");
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        await publish(other.canon, [person("哥哥", {parent: id})]);

        const counted = countedClient(mine.canon);
        const world = createCanonWorld(counted.client);
        cleanups.push(() => world.dispose());
        const page = createEntryPage({drafts: createTextDrafts({storage: null, world: () => world, call: counted.client.call}), world: () => world, fetchOrigins: originsFetcher((input) => counted.client.call("origins", input)), call: counted.client.call, views: new ComponentViewRegistry(), notices: createNotices(), revert: createRevertRequests(), execute: () => undefined, entriesView: "nbook.canon.entries"});
        const component = await page.load();
        const state = entriesViewState();
        state.expanded.value = ["folder:人物", id];
        const tree = mount(createEntriesViewHost(EntryTree, {world, state, open: () => undefined}), {global: {provide: provideText(port)}, attachTo: document.body});
        cleanups.push(() => tree.unmount());
        const entry = mount(component, {props: {context: {recent: [], arg: id, state: reactive(page.initialState!(id))}}, global: {provide: provideText(port)}, attachTo: document.body});
        cleanups.push(() => entry.unmount());
        await waitUntil("树与条目页", () => tree.text().includes("哥哥") && entry.find("[data-value]").exists() && valueText(entry) === "1,000");

        const before = counted.calls.length;
        await publish(other.canon, [change(id, "2", "买了书", -300)]);
        await waitUntil("条目页更新", () => valueText(entry) === "700");
        const reads = counted.calls.slice(before).map((call) => call.method).sort();
        // 树两层、条目页的章表、登记的类型、条目、渲染、情节第一页，加上读取层自己的 status：每个一次，不多读。
        expect(reads).toEqual(["changes", "chapters", "components", "entry", "render", "status", "tree", "tree"]);
    });

    it("换过的读取不再占着：换到读过的位置、离开文字分页以后，一次发布只重读在用的", async () => {
        venue = await canonNodeWorld(tmp);
        const mine = await venue.window("mine");
        const other = await venue.window("other");
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const counted = countedClient(mine.canon);
        const world = createCanonWorld(counted.client);
        cleanups.push(() => world.dispose());
        const page = createEntryPage({drafts: createTextDrafts({storage: null, world: () => world, call: counted.client.call}), world: () => world, fetchOrigins: originsFetcher((input) => counted.client.call("origins", input)), call: counted.client.call, views: new ComponentViewRegistry(), notices: createNotices(), revert: createRevertRequests(), execute: () => undefined, entriesView: "nbook.canon.entries"});
        const component = await page.load();
        const state = reactive(page.initialState!(id));
        const entry = mount(component, {props: {context: {recent: [], arg: id, state}}, global: {provide: provideText(port)}, attachTo: document.body});
        cleanups.push(() => entry.unmount());
        await waitUntil("值", () => entry.find("[data-value]").exists() && valueText(entry) === "1,000");

        // 缺省位置 → 第 1 章开头 → 回到缺省（读取层里还留着结果，一换上就读到了）；再离开文字分页。
        state.position = "1:start";
        await waitUntil("第 1 章开头读到", () => counted.calls.some((call) => call.method === "entry" && JSON.stringify(call.input).includes('"edge":"start"')));
        await waitUntil("第 1 章开头显示出来", () => entry.find("[data-value]").exists());
        state.position = null;
        state.tab = "plot";
        await waitUntil("情节分页", () => entry.find("[data-plot-list]").exists());

        const before = counted.calls.length;
        await publish(other.canon, [change(id, "2", "买了书", -300)]);
        await waitUntil("情节更新", () => entry.findAll("[data-change]").length === 1);
        const reads = counted.calls.slice(before).filter((call) => call.method === "entry" || call.method === "render");
        expect(reads.map((call) => call.method)).toEqual(["entry"]);
        expect(JSON.stringify(reads[0]!.input)).toContain('"edge":"end"');
    });
});

describe("写入", () => {
    /** 点一个字段的“改”，等确认条出来。 */
    const startEdit = async (wrapper: ReturnType<typeof mount>, path: string) => {
        await waitUntil(`${path} 的“改”`, () => wrapper.find(`[data-edit="${path}"]`).exists());
        await wrapper.get(`[data-edit="${path}"]`).trigger("click");
        await waitUntil("确认条", () => wrapper.find("[data-confirm-bar]").exists());
        return wrapper.get("[data-confirm-bar]");
    };
    const buttonByText = (wrapper: ReturnType<typeof mount>, label: string) => wrapper.findAll("button").find((button) => button.text() === label);

    it("改一个只在初值设过的字段：预览写“改初值”，保存后值变了、顶上有提示、焦点回到“改”；按计划时“改”不可用", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        await waitUntil("值", () => wrapper.find("[data-value]").exists());
        state.tab = "data:character";

        const bar = await startEdit(wrapper, "character.外观");
        expect(document.activeElement?.tagName).toBe("TEXTAREA");
        await bar.get("textarea").setValue("银发");
        await waitUntil("预览", () => wrapper.get("[data-confirm-preview]").text().includes("改初值"));
        await buttonByText(wrapper, "保存")!.trigger("click");
        await waitUntil("值变了", () => wrapper.get("[data-field='character.外观']").text().includes("银发"));
        expect(wrapper.find("[data-confirm-bar]").exists()).toBe(false);
        expect(wrapper.get("[data-notice-bar]").text()).toContain("改外观");
        await waitUntil("焦点回到“改”", () => document.activeElement?.getAttribute("data-edit") === "character.外观");

        // 取消与 Escape 一样收起确认条，焦点也回到那个“改”，不掉到页面外（输出 16、验收 11）。
        await startEdit(wrapper, "character.外观");
        await buttonByText(wrapper, "取消")!.trigger("click");
        await waitUntil("取消以后", () => !wrapper.find("[data-confirm-bar]").exists() && document.activeElement?.getAttribute("data-edit") === "character.外观");
        const again = await startEdit(wrapper, "character.外观");
        await again.get("textarea").trigger("keydown", {key: "Escape"});
        await waitUntil("Escape 以后", () => !wrapper.find("[data-confirm-bar]").exists() && document.activeElement?.getAttribute("data-edit") === "character.外观");

        state.planned = true;
        await waitUntil("按计划时不可用", () => wrapper.get("[data-edit='character.外观']").attributes("disabled") !== undefined);
        expect(wrapper.get("[data-edit='character.外观']").attributes("title")).toBe("先关掉按计划");
    });

    it("页头改名、改简介：确认条在页头之下，文字分页上也能改；保存后页头换了名字、顶上有提示", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper} = await open(id);
        const bar = await startEdit(wrapper, "entry.name");
        await bar.get("textarea").setValue("夜王");
        await waitUntil("预览", () => wrapper.get("[data-confirm-preview]").text().includes("改初值"));
        await buttonByText(wrapper, "保存")!.trigger("click");
        await waitUntil("名字变了", () => wrapper.get("h1").text() === "夜王");
        expect(wrapper.get("[data-notice-bar]").text()).toContain("改名字");
        const summary = await startEdit(wrapper, "entry.summary");
        await summary.get("textarea").setValue("第三魔法学院一年级");
        await waitUntil("预览", () => wrapper.find("[data-confirm-preview]").exists() && wrapper.get("[data-confirm-preview]").text().includes("改初值"));
        await buttonByText(wrapper, "保存")!.trigger("click");
        await waitUntil("简介", () => wrapper.text().includes("第三魔法学院一年级"));
    });

    it("页头的别名、加去一组设定、删除后恢复：都是一次改几处，结果在页上看得到", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        await waitUntil("别名一行", () => wrapper.find("[data-entry-aliases]").exists());
        await buttonByText(wrapper, "＋别名")!.trigger("click");
        const input = wrapper.get("[data-entry-aliases] input");
        await input.setValue("小瑕");
        await input.trigger("keydown", {key: "Enter"});
        await waitUntil("加上别名", () => wrapper.get("[data-entry-aliases]").text().includes("小瑕"));
        await wrapper.get("[data-entry-aliases] button[aria-label='去掉别名 小瑕']").trigger("click");
        await waitUntil("去掉别名", () => !wrapper.get("[data-entry-aliases]").text().includes("小瑕"));

        // 去掉人物这组设定：分页没了；再从“添加一组设定”加回来，标“恢复”，原来的数据还在。
        state.tab = "data:character";
        await waitUntil("人物分页", () => wrapper.find("[data-field='character.外观']").exists());
        // “更多”菜单是弹出层，这里直接发它选中后的事件；菜单本身的项在 EntryPage 的组件测试里。
        wrapper.findComponent(EntryPage).vm.$emit("remove-component");
        await waitUntil("确认对话框", () => document.body.querySelector("[role='dialog']")?.textContent?.includes("数据会保留") === true);
        [...document.body.querySelectorAll<HTMLButtonElement>("[role='dialog'] button")].find((button) => button.textContent?.trim() === "去掉")!.click();
        await waitUntil("人物分页没了", () => !wrapper.findAll("[role='tab']").some((tab) => tab.text().includes("人物")));
        wrapper.findComponent(EntryPage).vm.$emit("add-component");
        await waitUntil("添加对话框", () => document.body.querySelector("[role='dialog']")?.textContent?.includes("恢复“人物”") === true);
        [...document.body.querySelectorAll<HTMLButtonElement>("[role='dialog'] button")].find((button) => button.textContent?.trim() === "添加")!.click();
        await waitUntil("人物分页回来", () => wrapper.findAll("[role='tab']").some((tab) => tab.text().includes("人物")));

        // 删除以后的页面有“恢复”。
        wrapper.findComponent(EntryPage).vm.$emit("delete");
        await waitUntil("删除对话框", () => document.body.querySelector("[role='dialog']") !== null);
        [...document.body.querySelectorAll<HTMLButtonElement>("[role='dialog'] button")].find((button) => button.textContent?.trim() === "删除")!.click();
        await waitUntil("已删除", () => wrapper.find("[data-entry-restore]").exists());
        await wrapper.get("[data-entry-restore]").trigger("click");
        await waitUntil("恢复了", () => wrapper.find("[data-entry-aliases]").exists());
    });

    it("移动到……：上级用条目选择器按名字找，确认后条目挂到它下面（一次改几处的 place）", async () => {
        const {other, open} = await setup();
        const group = person("学院");
        const star = person("星瑕");
        const ids = await publish(other.canon, [group, star]);
        const {wrapper} = await open(ids[star.id]!);
        await waitUntil("页头", () => wrapper.find("h1").exists());
        wrapper.findComponent(EntryPage).vm.$emit("move");
        await waitUntil("移动对话框", () => document.body.querySelector("[data-move-dialog]") !== null);
        const picker = document.body.querySelector<HTMLInputElement>("[data-move-dialog] input[role='combobox']")!;
        picker.focus();
        picker.click();
        picker.value = "学院";
        picker.dispatchEvent(new Event("input", {bubbles: true}));
        await waitUntil("找到学院", () => [...document.body.querySelectorAll("[role='option']")].some((option) => option.textContent?.includes("学院")));
        await waitUntil("高亮落在学院", () => document.body.querySelector("[role='option'][data-highlighted]")?.textContent?.includes("学院") === true);
        picker.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        await waitUntil("选上了", () => picker.value === "学院");
        [...document.body.querySelectorAll<HTMLButtonElement>("[role='dialog'] button")].find((button) => button.textContent?.trim() === "移动")!.click();
        await waitUntil("挂到学院下面", async () => {
            const stored = await other.canon.call("object", {ref: {kind: "entry", id: ids[star.id]!}});
            return stored.ok && (stored.value.object as Entry).parent === ids[group.id];
        });
    });

    it("引用与图片字段也能就地改：引用用条目选择器（按 targets 筛），图片填路径与说明", async () => {
        // 项目里另装一个只贡献一种类型的插件：一个引用字段（只能指向人物）、一个图片字段。
        const rival: PluginDefinition = {id: "test.rival", entries: [], contributions: [{capability: CANON_COMPONENTS_POINT, id: "test.rival.card", declaration: {label: "对头", namespace: "rival", version: 1, fields: [{id: "对头", label: "对头", kind: "ref", targets: ["人物"]}, {id: "画像", label: "画像", kind: "image"}]}}]};
        const {other, open} = await setup([rival]);
        const star = {...person("星瑕"), type: "人物"};
        star.init.data.rival = {type: "test.rival.card", version: 1, enabled: true, fields: {对头: null, 画像: null}};
        const enemy = {...person("雾崎"), type: "人物"};
        const place = {...person("学院"), type: "地点"};
        const ids = await publish(other.canon, [star, enemy, place]);
        const {wrapper, state} = await open(ids[star.id]!);
        await waitUntil("值", () => wrapper.find("[data-value]").exists() || wrapper.find("[data-edit]").exists());
        state.tab = "data:rival";
        const bar = await startEdit(wrapper, "rival.对头");
        const input = bar.get("input[role='combobox']");
        await input.trigger("click");
        await waitUntil("只列人物", () => [...document.body.querySelectorAll("[role='option']")].map((option) => option.textContent ?? "").join("|").includes("雾崎"));
        expect([...document.body.querySelectorAll("[role='option']")].some((option) => option.textContent?.includes("学院"))).toBe(false);
        (input.element as HTMLInputElement).value = "雾崎";
        await input.trigger("input");
        await waitUntil("高亮雾崎", () => document.body.querySelector("[role='option'][data-highlighted]")?.textContent?.includes("雾崎") === true);
        await input.trigger("keydown", {key: "Enter"});
        await waitUntil("预览", () => wrapper.find("[data-confirm-preview]").exists() && wrapper.get("[data-confirm-preview]").text().includes("改初值"));
        await buttonByText(wrapper, "保存")!.trigger("click");
        await waitUntil("写进去了", async () => {
            const stored = await other.canon.call("object", {ref: {kind: "entry", id: ids[star.id]!}});
            return stored.ok && JSON.stringify((stored.value.object as Entry).init.data.rival?.fields.对头) === JSON.stringify({ref: ids[enemy.id]});
        });

        const image = await startEdit(wrapper, "rival.画像");
        const [path, caption] = image.findAll("[data-image-input] input");
        await path!.setValue("图片/雾崎.png");
        await caption!.setValue("黑衣");
        await waitUntil("预览", () => wrapper.find("[data-confirm-preview]").exists() && wrapper.get("[data-confirm-preview]").text().includes("改初值"));
        await buttonByText(wrapper, "保存")!.trigger("click");
        await waitUntil("图片写进去了", async () => {
            const stored = await other.canon.call("object", {ref: {kind: "entry", id: ids[star.id]!}});
            return stored.ok && JSON.stringify((stored.value.object as Entry).init.data.rival?.fields.画像) === JSON.stringify({图片: "图片/雾崎.png", 说明: "黑衣"});
        });
    });

    it("列表的元素：加一项（名字与子字段）、改一项的子字段、去掉一项；以条目为键的列表加一项时选指向的条目", async () => {
        // 项目里另装一个插件：一个普通列表（元素要有名字）、一个以条目为键的列表（键只能指向人物）。
        const bag: PluginDefinition = {id: "test.bag", entries: [], contributions: [{capability: CANON_COMPONENTS_POINT, id: "test.bag.card", declaration: {label: "随身", namespace: "bag", version: 1, fields: [
            {id: "物品", label: "物品", kind: "list", item: [{id: "数量", label: "数量", kind: "number"}]},
            {id: "关系", label: "关系", kind: "list", keyedBy: "ref", targets: ["人物"], item: [{id: "态度", label: "态度", kind: "enum", options: ["友好", "敌对"]}]},
        ]}}]};
        const {other, open} = await setup([bag]);
        const star = {...person("星瑕"), type: "人物"};
        star.init.data.bag = {type: "test.bag.card", version: 1, enabled: true, fields: {物品: [{id: "i1", label: "长剑", 数量: 1}], 关系: []}};
        const enemy = {...person("雾崎"), type: "人物"};
        const ids = await publish(other.canon, [star, enemy]);
        const stored = async () => {
            const read = await other.canon.call("object", {ref: {kind: "entry", id: ids[star.id]!}});
            if (!read.ok) throw new Error(JSON.stringify(read.failure));
            return (read.value.object as Entry).init.data.bag!.fields as Record<string, Array<Record<string, unknown>>>;
        };
        const dialogButton = (label: string) => [...document.body.querySelectorAll<HTMLButtonElement>("[role='dialog'] button")].find((button) => button.textContent?.trim() === label)!;
        const typeInto = (input: HTMLInputElement, value: string) => {
            input.value = value;
            input.dispatchEvent(new Event("input", {bubbles: true}));
        };
        const {wrapper, state} = await open(ids[star.id]!);
        await waitUntil("页头", () => wrapper.find("h1").exists());
        state.tab = "data:bag";
        await waitUntil("物品的“添加”", () => wrapper.find("[data-add-element='bag.物品']").exists());

        await wrapper.get("[data-add-element='bag.物品']").trigger("click");
        await waitUntil("元素对话框", () => document.body.querySelector("[data-element-dialog]") !== null);
        // 先不起名字就保存：对话框里写原因，不关。
        dialogButton("保存").click();
        await waitUntil("要名字", () => document.body.querySelector("[data-element-dialog] [role='alert']")?.textContent?.includes("给这一项起个名字") === true);
        const [name, count] = [...document.body.querySelectorAll<HTMLInputElement>("[data-element-dialog] input")];
        typeInto(name!, "盾");
        typeInto(count!, "2");
        await waitUntil("填进去了", () => count!.value === "2");
        dialogButton("保存").click();
        await waitUntil("加上了", async () => (await stored()).物品!.some((item) => item.label === "盾" && item.数量 === 2));
        await waitUntil("对话框关了", () => document.body.querySelector("[data-element-dialog]") === null || document.body.querySelector("[role='dialog']") === null);
        expect(wrapper.get("[data-notice-bar]").text()).toContain("给星瑕的物品加一项");

        await waitUntil("长剑的“改”", () => wrapper.find("[aria-label='改 长剑']").exists());
        await wrapper.get("[aria-label='改 长剑']").trigger("click");
        await waitUntil("对话框带着原值", () => document.body.querySelectorAll<HTMLInputElement>("[data-element-dialog] input")[1]?.value === "1");
        typeInto(document.body.querySelectorAll<HTMLInputElement>("[data-element-dialog] input")[1]!, "3");
        dialogButton("保存").click();
        await waitUntil("改了数量", async () => (await stored()).物品!.find((item) => item.id === "i1")?.数量 === 3);

        await waitUntil("盾的“去掉”", () => wrapper.find("[aria-label='去掉 盾']").exists());
        await wrapper.get("[aria-label='去掉 盾']").trigger("click");
        await waitUntil("去掉的确认", () => document.body.querySelector("[role='dialog']")?.textContent?.includes("去掉“盾”") === true);
        dialogButton("去掉").click();
        await waitUntil("去掉了", async () => !(await stored()).物品!.some((item) => item.label === "盾"));

        // 以条目为键：选指向的条目（只列人物），再给态度。
        await wrapper.get("[data-add-element='bag.关系']").trigger("click");
        await waitUntil("元素对话框", () => document.body.querySelector("[data-element-dialog] input[role='combobox']") !== null);
        const picker = document.body.querySelector<HTMLInputElement>("[data-element-dialog] input[role='combobox']")!;
        picker.focus();
        picker.click();
        typeInto(picker, "雾崎");
        await waitUntil("高亮雾崎", () => document.body.querySelector("[role='option'][data-highlighted]")?.textContent?.includes("雾崎") === true);
        picker.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        await waitUntil("选上了", () => picker.value === "雾崎");
        dialogButton("保存").click();
        await waitUntil("关系加上了", async () => (await stored()).关系!.some((item) => item.id === ids[enemy.id]));
    });

    /** 条目存下来的初值主文字，各块的原文。 */
    const initText = async (canon: CanonNodeWindow["canon"], id: string): Promise<string[]> => {
        const read = await canon.call("object", {ref: {kind: "entry", id}});
        if (!read.ok) throw new Error(JSON.stringify(read.failure));
        return (read.value.object as Entry).init.text.map((block) => block.source);
    };
    /** 这个位置上读到的各块原文。 */
    const textAt = async (canon: CanonNodeWindow["canon"], id: string, position: ReadPosition): Promise<string[]> => {
        const read = await canon.call("textBlocks", {id, position});
        if (!read.ok || read.value === null) throw new Error("读不到块");
        return read.value.blocks.map((block) => block.source);
    };
    /** 编辑视图里各块的输入框（没有编辑器插件的窗口里是普通文本框）。 */
    const areas = (wrapper: ReturnType<typeof mount>): HTMLTextAreaElement[] => wrapper.findAll("[data-text-block] textarea").map((area) => area.element as HTMLTextAreaElement);
    const typeInto = (area: HTMLTextAreaElement, value: string): void => {
        area.value = value;
        area.dispatchEvent(new Event("input", {bubbles: true}));
    };
    const dialogButton = (label: string) => [...document.body.querySelectorAll<HTMLButtonElement>("[role='dialog'] button, [role='alertdialog'] button")].find((button) => button.textContent?.trim() === label)!;
    const startEditing = async (wrapper: ReturnType<typeof mount>): Promise<void> => {
        await waitUntil("“编辑”或“开始写”", () => wrapper.find("[data-text-edit]").exists());
        await wrapper.get("[data-text-edit]").trigger("click");
        await waitUntil("编辑视图", () => wrapper.find("[data-text-editor]").exists() && areas(wrapper).length > 0);
    };

    it("主文字按块编辑（验收 16）：没有时“开始写”，写两段、从光标处拆开、提交成一条修订；编辑期间位置锁住、标签报告有未提交的内容", async () => {
        const {other, open, page} = await setup();
        const star = person("星瑕");
        star.init.text = [];
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        await waitUntil("文字分页也在", () => wrapper.findAll("[role='tab']").some((tab) => tab.text() === "文字"));
        // 没有主文字时缺省先看第一组设定。
        await waitUntil("缺省是一组设定", () => wrapper.find("[role='tab'][aria-selected='true']").exists() && wrapper.get("[role='tab'][aria-selected='true']").text() !== "文字");
        state.tab = "text";
        await waitUntil("还没有主文字", () => wrapper.find("[data-text-empty]").exists());
        expect(wrapper.get("[data-text-edit]").text()).toBe("开始写");

        await startEditing(wrapper);
        // 进来是一个空的块，还不算有改动：右边是“取消”，标签没有未提交的内容。
        expect([areas(wrapper).length, wrapper.find("[data-text-cancel]").exists(), wrapper.find("[data-text-count]").exists(), page.uncommitted!(id)]).toEqual([1, true, false, false]);
        expect(wrapper.find("[data-position-locked]").exists()).toBe(true);

        typeInto(areas(wrapper)[0]!, "星瑕是第三魔法学院的学生。\n\n她有 {panel.存款} 元。");
        await waitUntil("未提交 1 块", () => wrapper.find("[data-text-count]").exists() && wrapper.get("[data-text-count]").text() === "未提交 1 块");
        expect(page.uncommitted!(id)).toBe(true);
        // 暂存不是修订：世界里还没有。
        expect(await initText(other.canon, id)).toEqual([]);

        // 光标放在两段之间，拆开：前半留在原块，后半成新的一块。
        const first = areas(wrapper)[0]!;
        first.setSelectionRange("星瑕是第三魔法学院的学生。".length, "星瑕是第三魔法学院的学生。".length);
        await wrapper.get("[data-text-split]").trigger("click");
        await waitUntil("两块", () => areas(wrapper).length === 2);
        expect(areas(wrapper).map((area) => area.value)).toEqual(["星瑕是第三魔法学院的学生。", "她有 {panel.存款} 元。"]);

        await wrapper.get("[data-text-submit]").trigger("click");
        await waitUntil("发布了", async () => (await initText(other.canon, id)).length === 2);
        expect(await initText(other.canon, id)).toEqual(["星瑕是第三魔法学院的学生。", "她有 {panel.存款} 元。"]);
        await waitUntil("回到阅读视图", () => wrapper.find("[data-entry-text]").exists() && wrapper.get("[data-entry-text]").text().includes("第三魔法学院的学生"));
        await waitUntil("提示", () => wrapper.find("[data-notice-bar]").exists() && wrapper.get("[data-notice-bar]").text().includes("改星瑕的主文字"));
        expect([page.uncommitted!(id), wrapper.find("[data-position-locked]").exists(), wrapper.get("[data-text-edit]").text()]).toEqual([false, false, "编辑"]);
        const revisions = await other.canon.call("revisions", {filter: {entry: id}});
        expect(revisions.ok && revisions.value.items.map((item) => item.title)).toEqual(["改星瑕的主文字", "写入"]);

        // 标签的保存命令（Ctrl+S）调页面的 commit：同样提交。
        await startEditing(wrapper);
        typeInto(areas(wrapper)[1]!, "她有 {panel.存款} 元，都存在学院的柜子里。");
        await waitUntil("有改动", () => page.uncommitted!(id));
        await page.commit!(id);
        expect(await initText(other.canon, id)).toEqual(["星瑕是第三魔法学院的学生。", "她有 {panel.存款} 元，都存在学院的柜子里。"]);
    });

    it("并到上一块、删掉与恢复、放弃：放弃先问一句，确认以后回到阅读视图、世界不变", async () => {
        const {other, open, page} = await setup();
        const star = person("星瑕");
        star.init.text = [{id: "b1", source: "第一块。"}, {id: "b2", source: "第二块。"}, {id: "b3", source: "第三块。"}];
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        state.tab = "text";
        await startEditing(wrapper);
        const block = (key: string) => wrapper.get(`[data-text-block="${key}"]`);
        // 第一块前面没有块：并不了。
        expect(block("b1").get("[data-text-merge]").attributes("disabled")).toBeDefined();

        await block("b2").get("[data-text-merge]").trigger("click");
        await waitUntil("并进去了", () => areas(wrapper)[0]?.value === "第一块。\n\n第二块。");
        expect(block("b2").attributes("data-text-block-state")).toBe("removed");
        await block("b3").get("[data-text-remove]").trigger("click");
        await waitUntil("删掉了", () => block("b3").attributes("data-text-block-state") === "removed");
        expect(wrapper.get("[data-text-count]").text()).toBe("未提交 3 块");
        await block("b3").get("[data-text-restore]").trigger("click");
        await waitUntil("恢复了", () => block("b3").attributes("data-text-block-state") === "same");

        await wrapper.get("[data-text-submit]").trigger("click");
        await waitUntil("发布了", async () => (await initText(other.canon, id)).length === 2);
        expect(await initText(other.canon, id)).toEqual(["第一块。\n\n第二块。", "第三块。"]);

        // 再改一处、放弃：先问，确认以后世界不变、没有未提交的内容。
        await startEditing(wrapper);
        typeInto(areas(wrapper)[1]!, "不要了的改动");
        await waitUntil("有改动", () => wrapper.find("[data-text-discard]").exists());
        await wrapper.get("[data-text-discard]").trigger("click");
        await waitUntil("确认放弃", () => document.body.textContent?.includes("放弃没提交的修改？") === true);
        expect(wrapper.find("[data-text-editor]").exists()).toBe(true);
        dialogButton("放弃").click();
        await waitUntil("回到阅读视图", () => wrapper.find("[data-entry-text]").exists());
        expect([page.uncommitted!(id), await initText(other.canon, id)]).toEqual([false, ["第一块。\n\n第二块。", "第三块。"]]);
    });

    it("同一块两边都改了：提交时出对照，选“我的”以后以我的为准；别处改的是没碰的块不问，两处都在（验收 16）", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        star.init.text = [{id: "b1", source: "第一块。"}, {id: "b2", source: "第二块。"}];
        const id = (await publish(other.canon, [star]))[star.id]!;
        const elsewhere = async (block: string, value: string) => {
            const status = await other.canon.call("status", {});
            if (!status.ok) throw new Error("读不到");
            const result = await other.canon.call("editEntries", {input: {requestId: `elsewhere-${nextId()}`, by: {kind: "author"}, what: "edit", baseVersion: status.value.version, title: "别处改", ops: [{op: "set", at: {entry: id, path: `text[${block}]`}, value}]}});
            expect(result.ok).toBe(true);
        };
        const {wrapper, state} = await open(id);
        state.tab = "text";
        await startEditing(wrapper);
        typeInto(areas(wrapper)[0]!, "第一块（我的）。");
        await waitUntil("有改动", () => wrapper.find("[data-text-count]").exists());
        // 别处改了我没碰的第二块：不问，提交以后两处都在。
        await elsewhere("b2", "第二块（别处）。");
        await wrapper.get("[data-text-submit]").trigger("click");
        await waitUntil("发布了", async () => (await initText(other.canon, id))[0] === "第一块（我的）。");
        expect(await initText(other.canon, id)).toEqual(["第一块（我的）。", "第二块（别处）。"]);
        expect(document.body.querySelector("[data-text-conflicts]")).toBeNull();

        // 这回别处改的是我也改了的那一块。
        await startEditing(wrapper);
        typeInto(areas(wrapper)[0]!, "第一块（我的第二版）。");
        await waitUntil("有改动", () => wrapper.find("[data-text-count]").exists());
        await elsewhere("b1", "第一块（别处的第二版）。");
        await wrapper.get("[data-text-submit]").trigger("click");
        await waitUntil("对照", () => document.body.querySelector("[data-text-conflicts]") !== null);
        const picks = (name: string) => document.body.querySelector<HTMLButtonElement>(`[data-conflict="b1"] [data-pick="${name}"]`)!;
        expect([picks("theirs").textContent, picks("mine").textContent]).toEqual(["现在的第一块（别处的第二版）。", "我的第一块（我的第二版）。"]);
        expect(await initText(other.canon, id)).toEqual(["第一块（别处的第二版）。", "第二块（别处）。"]);
        // 没选就点提交：不发，页脚写一句。
        dialogButton("提交").click();
        await waitUntil("还有没选的", () => document.body.textContent?.includes("每一块都选了才能提交") === true);
        picks("mine").click();
        await waitUntil("选上了", () => picks("mine").getAttribute("aria-pressed") === "true");
        dialogButton("提交").click();
        await waitUntil("以我的为准", async () => (await initText(other.canon, id))[0] === "第一块（我的第二版）。");
        await waitUntil("回到阅读视图", () => wrapper.find("[data-entry-text]").exists());

        // 再来一次，这回选“现在的”：我对这一块的改动不要了，没有别的改动，不多出修订，回到阅读视图。
        await startEditing(wrapper);
        typeInto(areas(wrapper)[0]!, "第一块（我的第三版）。");
        await waitUntil("有改动", () => wrapper.find("[data-text-count]").exists());
        await elsewhere("b1", "第一块（别处的第三版）。");
        const before = await other.canon.call("status", {});
        await wrapper.get("[data-text-submit]").trigger("click");
        await waitUntil("对照", () => document.body.querySelector("[data-text-conflicts]") !== null);
        picks("theirs").click();
        await waitUntil("选上了", () => picks("theirs").getAttribute("aria-pressed") === "true");
        dialogButton("提交").click();
        await waitUntil("回到阅读视图", () => wrapper.find("[data-entry-text]").exists() && wrapper.get("[data-entry-text]").text().includes("别处的第三版"));
        const after = await other.canon.call("status", {});
        expect([await initText(other.canon, id), before.ok && after.ok && after.value.version === before.value.version]).toEqual([["第一块（别处的第三版）。", "第二块（别处）。"], true]);
    });

    it("被剧情改过的块只能改字：删、拆、并不可用并写原因，改的字写进那条剧情变更；新块不能插在剧情加出来的块前面", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        star.init.text = [{id: "b1", source: "第一块。"}, {id: "b2", source: "第二块。"}];
        const id = (await publish(other.canon, [star]))[star.id]!;
        const status = await other.canon.call("status", {});
        if (!status.ok) throw new Error("读不到");
        // 第 1 章：把第二块整块换掉，在第一块后面加一块。
        const story = await other.canon.call("editEntries", {input: {requestId: `story-${nextId()}`, by: {kind: "author"}, what: "edit", baseVersion: status.value.version, title: "第 1 章的剧情", intent: "story", position: {kind: "chapter", chapter: "1", edge: "end"}, ops: [{op: "set", at: {entry: id, path: "text[b2]"}, value: "第二块（剧情里变了）。"}, {op: "addBlock", entry: id, source: "剧情加的一块。", after: "b1"}]}});
        expect(story.ok).toBe(true);
        const {wrapper, state} = await open(id);
        state.tab = "text";
        await startEditing(wrapper);
        expect(areas(wrapper).map((area) => area.value)).toEqual(["第一块。", "剧情加的一块。", "第二块（剧情里变了）。"]);
        const block = (key: string) => wrapper.get(`[data-text-block="${key}"]`);
        const reason = "剧情改过这一块，只能改字";
        for (const key of ["b1", "b3", "b2"]) {
            expect({key, note: block(key).get("[data-text-note]").text(), remove: block(key).get("[data-text-remove]").attributes("title"), split: block(key).get("[data-text-split]").attributes("title")}).toEqual({key, note: "剧情改过", remove: reason, split: reason});
            expect(block(key).get("[data-text-remove]").attributes("disabled")).toBeDefined();
        }
        // 第一块后面紧挨着剧情加出来的块：放不了新块；剧情加的那一块后面可以。
        expect([block("b1").get("[data-text-add]").attributes("disabled") !== undefined, block("b3").get("[data-text-add]").attributes("disabled") !== undefined]).toEqual([true, false]);

        typeInto(areas(wrapper)[2]!, "第二块（作者把剧情里的这一版改了）。");
        await block("b3").get("[data-text-add]").trigger("click");
        await waitUntil("多了一块", () => areas(wrapper).length === 4);
        typeInto(areas(wrapper)[2]!, "紧跟在剧情加的那一块后面。");
        await wrapper.get("[data-text-submit]").trigger("click");
        await waitUntil("发布了", async () => (await textAt(other.canon, id, {kind: "chapter", chapter: "2", edge: "end"})).length === 4);
        expect(await textAt(other.canon, id, {kind: "chapter", chapter: "2", edge: "end"})).toEqual(["第一块。", "剧情加的一块。", "紧跟在剧情加的那一块后面。", "第二块（作者把剧情里的这一版改了）。"]);
        // 初值里：第二块没动（改的是剧情变更里的那一版），多了新加的设定块。
        expect(await initText(other.canon, id)).toEqual(["第一块。", "紧跟在剧情加的那一块后面。", "第二块。"]);
    });

    it("剧情的入口只在选了某一章时出现；“这一块在剧情里变了”保存时别处刚改过这一块：写明并列出现在的原文、不盖掉，再保存才记下；编辑期间没有剧情的入口", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        star.init.text = [{id: "b1", source: "第一块。"}];
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        state.tab = "text";
        state.position = "initial";
        await waitUntil("阅读视图", () => wrapper.find("[data-entry-text] [data-block]").exists());
        expect([wrapper.find("[data-block-actions]").exists(), wrapper.find("[data-story-add]").exists()]).toEqual([false, false]);
        state.position = "2:end";
        await waitUntil("剧情的入口", () => wrapper.find("[data-block-actions]").exists() && wrapper.find("[data-story-add]").exists());

        // 用键盘打开这一块的菜单，选“这一块在剧情里变了……”。
        const trigger = wrapper.get("[data-block-actions] button");
        expect(trigger.attributes("aria-label")).toBe("第 1 块在剧情里的变化");
        (trigger.element as HTMLElement).focus();
        await trigger.trigger("keydown", {key: "ArrowDown"});
        await waitUntil("菜单", () => document.body.querySelectorAll("[role='menuitem']").length === 2);
        const items = [...document.body.querySelectorAll<HTMLElement>("[role='menuitem']")];
        expect(items.map((item) => item.textContent?.trim())).toEqual(["这一块在剧情里变了……", "在剧情里删掉这一块……"]);
        items[0]!.click();
        await waitUntil("对话框", () => document.body.querySelector("[data-block-dialog] textarea") !== null);
        const area = document.body.querySelector<HTMLTextAreaElement>("[data-block-dialog] textarea")!;
        expect(area.value).toBe("第一块。");
        typeInto(area, "第一块（第 2 章以后）。");

        // 对话框开着时别处把这一块的设定改了。
        const status = await other.canon.call("status", {});
        if (!status.ok) throw new Error("读不到");
        expect((await other.canon.call("editEntries", {input: {requestId: `elsewhere-${nextId()}`, by: {kind: "author"}, what: "edit", baseVersion: status.value.version, title: "别处改", ops: [{op: "set", at: {entry: id, path: "text[b1]"}, value: "第一块（别处改了设定）。"}]}})).ok).toBe(true);
        dialogButton("保存").click();
        await waitUntil("写明被别处改了", () => document.body.querySelector("[role='dialog'] [role='alert']")?.textContent?.includes("刚被别处改了") === true);
        expect(document.body.querySelector("[data-block-now]")?.textContent).toBe("第一块（别处改了设定）。");
        expect(await textAt(other.canon, id, {kind: "chapter", chapter: "2", edge: "end"})).toEqual(["第一块（别处改了设定）。"]);
        expect(document.body.querySelector<HTMLTextAreaElement>("[data-block-dialog] textarea")!.value).toBe("第一块（第 2 章以后）。");

        dialogButton("保存").click();
        await waitUntil("记下了", async () => (await textAt(other.canon, id, {kind: "chapter", chapter: "2", edge: "end"}))[0] === "第一块（第 2 章以后）。");
        // 是第 2 章的剧情变化：第 1 章末尾读到的还是设定。
        expect(await textAt(other.canon, id, {kind: "chapter", chapter: "1", edge: "end"})).toEqual(["第一块（别处改了设定）。"]);

        // 编辑期间阅读视图不在页上，所以没有剧情的入口；取消以后它们回来。
        await startEditing(wrapper);
        expect([wrapper.find("[data-text-edit]").exists(), wrapper.find("[data-block-actions]").exists(), wrapper.find("[data-story-add]").exists()]).toEqual([false, false, false]);
        await wrapper.get("[data-text-cancel]").trigger("click");
        await waitUntil("剧情的入口回来", () => wrapper.find("[data-block-actions]").exists() && wrapper.find("[data-story-add]").exists());
    });

    it("别的调用方独占写入时：提交点不了、原因写在那一行；用保存命令提交也不发、写明原因；释放以后连按两次保存只发一次", async () => {
        const {other, open, page} = await setup();
        const star = person("星瑕");
        star.init.text = [{id: "b1", source: "第一块。"}];
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        state.tab = "text";
        await startEditing(wrapper);
        typeInto(areas(wrapper)[0]!, "第一块（改）。");
        await waitUntil("有改动", () => page.uncommitted!(id));

        const lease = await other.canon.hold("第 3 章记账");
        if (!lease.ok) throw new Error(JSON.stringify(lease.failure));
        await waitUntil("提交点不了", () => wrapper.get("[data-text-submit]").attributes("disabled") !== undefined);
        expect(wrapper.get("[data-text-submit-blocked]").text()).toContain("第 3 章记账");
        await page.commit!(id);
        await waitUntil("写明原因", () => wrapper.find("[data-text-message]").exists());
        // 原因照整批的说明显示，状态行里不再写一遍。
        expect([wrapper.get("[data-text-message]").text().includes("第 3 章记账"), wrapper.find("[data-text-submit-blocked]").exists()]).toEqual([true, false]);
        expect([await initText(other.canon, id), page.uncommitted!(id)]).toEqual([["第一块。"], true]);

        // 独占放开：原因没了，那句说明跟着收起。
        await lease.value.release();
        await waitUntil("能提交了", () => wrapper.get("[data-text-submit]").attributes("disabled") === undefined);
        await waitUntil("说明收起", () => !wrapper.find("[data-text-message]").exists());
        await Promise.all([page.commit!(id), page.commit!(id)]);
        expect(await initText(other.canon, id)).toEqual(["第一块（改）。"]);
        const revisions = await other.canon.call("revisions", {filter: {entry: id}});
        expect(revisions.ok && revisions.value.items.map((item) => item.title)).toEqual(["改星瑕的主文字", "写入"]);
    });

    it("条目在别处被删掉、稿还在：稿列在“已删除”下面，看得到、提交不可用并写原因，能放弃", async () => {
        const {other, open, page} = await setup();
        const star = person("星瑕");
        star.init.text = [{id: "b1", source: "第一块。"}];
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        state.tab = "text";
        await startEditing(wrapper);
        typeInto(areas(wrapper)[0]!, "还没提交的一块。");
        await waitUntil("有改动", () => page.uncommitted!(id));

        const status = await other.canon.call("status", {});
        if (!status.ok) throw new Error("读不到");
        expect((await other.canon.call("editEntries", {input: {requestId: `elsewhere-${nextId()}`, by: {kind: "author"}, what: "edit", baseVersion: status.value.version, title: "别处删", ops: [{op: "delete", entry: id}]}})).ok).toBe(true);
        await waitUntil("已删除", () => wrapper.text().includes("这个条目已删除"));
        await waitUntil("稿还列着", () => areas(wrapper).length === 1);
        expect([areas(wrapper)[0]!.value, page.uncommitted!(id)]).toEqual(["还没提交的一块。", true]);
        expect(wrapper.get("[data-text-submit]").attributes("disabled")).toBeDefined();
        expect(wrapper.get("[data-text-submit-blocked]").text()).toBe("条目已删除，恢复以后才能提交");
        await page.commit!(id);
        await waitUntil("写明原因", () => wrapper.find("[data-text-message]").exists());
        expect(wrapper.get("[data-text-message]").text()).toBe("条目已删除，恢复以后才能提交");

        await wrapper.get("[data-text-discard]").trigger("click");
        await waitUntil("确认放弃", () => document.body.textContent?.includes("放弃没提交的修改？") === true);
        dialogButton("放弃").click();
        await waitUntil("稿没了", () => !wrapper.find("[data-text-editor]").exists());
        expect([page.uncommitted!(id), wrapper.text().includes("这个条目已删除")]).toEqual([false, true]);
    });

    it("有稿时这一页停在稿开始的位置、按实际读：位置与“按计划”换了也不换读取；稿开始的那一章没了：只列动过的文字，只能放弃，放弃以后才跟到现在的位置", async () => {
        const {other, open, page} = await setup();
        const star = person("星瑕");
        star.init.text = [{id: "b1", source: "她有 {panel.存款} 元。"}, {id: "b2", source: "第二块。"}];
        const id = (await publish(other.canon, [star]))[star.id]!;
        await publish(other.canon, [change(id, "1", "领了工资", 200), change(id, "2", "买了书", -300)]);
        const {wrapper, state} = await open(id);
        state.tab = "text";
        state.position = "1:end";
        await waitUntil("第 1 章末尾的值", () => wrapper.find("[data-value]").exists() && valueText(wrapper) === "1,200");
        await startEditing(wrapper);
        expect(areas(wrapper).length).toBe(2);
        typeInto(areas(wrapper)[1]!, "改过的第二块。");
        await waitUntil("有改动", () => page.uncommitted!(id));

        // 标签的状态换了位置、开了“按计划”（页头的控件锁着，这里直接改状态：等于恢复出来的状态与稿不一致）。
        state.position = "2:end";
        state.planned = true;
        state.tab = "data:panel";
        await waitUntil("数据分页", () => wrapper.find("[data-edit='panel.存款']").exists());
        // 读的还是第 1 章末尾；按实际读，所以就地改可用（按计划时不可用）。
        expect([wrapper.text().includes("1,200"), wrapper.text().includes("900")]).toEqual([true, false]);
        expect(wrapper.get("[data-edit='panel.存款']").attributes("disabled")).toBeUndefined();

        // 活页夹里拿掉第 1 章：稿对不上世界了。
        await writeFile(join(tmp, "Book", "manuscripts.binder", "binder.xml"), '<binder nextId="3"><chapter id="2" title="打工"/></binder>');
        await waitUntil("章表变了", async () => {
            const chapters = await other.canon.call("chapters", {});
            return chapters.ok && chapters.value.items.length === 1;
        }, {timeoutMs: 10_000});
        state.tab = "text";
        await waitUntil("编辑视图", () => wrapper.find("[data-text-editor]").exists());
        await page.commit!(id);
        await waitUntil("写明原因", () => wrapper.find("[data-text-message]").exists());
        expect(wrapper.get("[data-text-message]").text()).toContain("开始编辑时的那一章已经不在了");
        // 只列动过的那一块，不能改、不能加块、不能提交。
        expect([areas(wrapper).map((area) => [area.value, area.readOnly]), wrapper.find("[data-text-add]").exists()]).toEqual([[["改过的第二块。", true]], false]);
        expect(wrapper.get("[data-text-submit]").attributes("disabled")).toBeDefined();

        await wrapper.get("[data-text-discard]").trigger("click");
        await waitUntil("确认放弃", () => document.body.textContent?.includes("放弃没提交的修改？") === true);
        dialogButton("放弃").click();
        await waitUntil("回到阅读视图，读现在的位置", () => wrapper.find("[data-value]").exists() && valueText(wrapper) !== "1,200");
        expect([page.uncommitted!(id), wrapper.find("[data-position-locked]").exists()]).toEqual([false, false]);
    });

    it("同一个条目在两个编辑组里各开一页：先挂的那一页卸载以后保存命令照样提交；一页都没挂时保存报没保存成功、稿还在", async () => {
        const {other, open, page} = await setup();
        const star = person("星瑕");
        star.init.text = [{id: "b1", source: "第一块。"}];
        const id = (await publish(other.canon, [star]))[star.id]!;
        const first = await open(id);
        const second = await open(id);
        first.state.tab = "text";
        second.state.tab = "text";
        await startEditing(second.wrapper);
        typeInto(areas(second.wrapper)[0]!, "第一块（改）。");
        await waitUntil("有改动", () => page.uncommitted!(id));

        second.wrapper.unmount();
        await waitUntil("另一页也在编辑", () => areas(first.wrapper).length === 1);
        await page.commit!(id);
        expect(await initText(other.canon, id)).toEqual(["第一块（改）。"]);

        await startEditing(first.wrapper);
        typeInto(areas(first.wrapper)[0]!, "第一块（再改）。");
        await waitUntil("有改动", () => page.uncommitted!(id));
        first.wrapper.unmount();
        await expect(page.commit!(id)).rejects.toThrow();
        expect([await initText(other.canon, id), page.uncommitted!(id)]).toEqual([["第一块（改）。"], true]);
    });

    it("点“编辑”时读不出块：人还在阅读视图，原因写在页头下面", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        state.tab = "text";
        await waitUntil("阅读视图", () => wrapper.find("[data-text-edit]").exists());
        await venue!.endProject();
        await waitUntil("横幅", () => wrapper.text().includes("世界已断开"), {timeoutMs: 10_000});
        // 断开以后“编辑”点不了；这里是点下去的那一刻刚断开：阅读视图已经发出了“编辑”。
        wrapper.findComponent(EntryText).vm.$emit("edit");
        await waitUntil("写明原因", () => wrapper.find("[data-entry-action-error]").exists());
        expect([wrapper.get("[data-entry-action-error]").text(), wrapper.find("[data-text-editor]").exists()]).toEqual(["读不到最新的文字", false]);
    });

    it("人物分页展开语义档的字段：来历下面能记一句，落在所选位置，值后面多一句", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        await waitUntil("页头", () => wrapper.find("h1").exists());
        state.tab = "data:character";
        await waitUntil("态度", () => wrapper.find("[data-field='character.态度'] [data-value]").exists() || wrapper.find("[data-field='character.态度'] button").exists());
        await wrapper.get("[data-field='character.态度'] button").trigger("click");
        await waitUntil("记一句的表单", () => wrapper.find("[data-record-form]").exists());
        expect(wrapper.findAll("[data-record-form] input")).toHaveLength(1);
        const form = wrapper.get("[data-record-form]");
        await form.get("input").setValue("对校长起了疑心");
        await form.trigger("submit");
        await waitUntil("记进去了", () => wrapper.find("[data-notice-bar]").exists() && wrapper.get("[data-notice-bar]").text().includes("对校长起了疑心"));
        await waitUntil("值后面多一句", () => wrapper.get("[data-field='character.态度']").text().includes("对校长起了疑心"));
    });

    it("累出来的数：写“这个数是几笔累出来的”、保存不可用；记一笔精确档以后值卡少了、流水多了一行", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        await publish(other.canon, [change(id, "1", "领了工资", 200), change(id, "2", "买了书", -300)]);
        const {wrapper, state} = await open(id);
        await waitUntil("值", () => wrapper.find("[data-value]").exists());
        state.tab = "data:panel";
        await waitUntil("流水", () => originRows(wrapper).length === 3);

        const bar = await startEdit(wrapper, "panel.存款");
        await bar.get("input").setValue("500");
        await waitUntil("累出来的数", () => wrapper.find("[data-confirm-bar] [role='alert']").exists() && wrapper.get("[data-confirm-bar] [role='alert']").text().includes("这个数是几笔累出来的"));
        expect(buttonByText(wrapper, "保存")!.attributes("disabled")).toBeDefined();
        await buttonByText(wrapper, "取消")!.trigger("click");

        const form = wrapper.get("[data-record-form]");
        const [what, delta] = form.findAll("input");
        await what!.setValue("捡到钱");
        await delta!.setValue("-200");
        await form.trigger("submit");
        await waitUntil("值卡少了 200", () => wrapper.get("[data-card='panel.存款']").text().includes("700 元"));
        await waitUntil("流水多了一行", () => originRows(wrapper).length === 4);
        expect(originRows(wrapper)[0]).toContain("捡到钱");
        expect(wrapper.get("[data-notice-bar]").text()).toContain("记了一笔：捡到钱");
        expect((wrapper.get("[data-record-form] input").element as HTMLInputElement).value).toBe("");
    });

    it("确认条开着时别处改了这个值：写“这个值刚刚变了”，再点保存就以新值为准写进去；切走再回来确认条与填的值还在", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const first = await open(id);
        await waitUntil("值", () => first.wrapper.find("[data-value]").exists());
        first.state.tab = "data:character";
        const bar = await startEdit(first.wrapper, "character.外观");
        await bar.get("textarea").setValue("银发");
        await waitUntil("预览", () => first.wrapper.get("[data-confirm-preview]").text().includes("改初值"));

        first.wrapper.unmount();
        const again = first.remount();
        await waitUntil("回来以后确认条还在", () => again.find("[data-confirm-bar] textarea").exists());
        expect((again.get("[data-confirm-bar] textarea").element as HTMLTextAreaElement).value).toBe("银发");

        const stored = await other.canon.call("object", {ref: {kind: "entry", id}});
        if (!stored.ok) throw new Error(JSON.stringify(stored.failure));
        const entry = stored.value.object as Entry;
        await publish(other.canon, [{...entry, init: {...entry.init, data: {...entry.init.data, character: {...entry.init.data.character!, fields: {...entry.init.data.character!.fields, 外观: "红发"}}}}}]);
        await waitUntil("这个值刚刚变了", () => again.find("[data-confirm-bar] [role='alert']").exists() && again.get("[data-confirm-bar] [role='alert']").text().includes("这个值刚刚变了"));
        await waitUntil("重新预览", () => again.get("[data-confirm-preview]").text().includes("改初值") && buttonByText(again, "保存")!.attributes("disabled") === undefined);
        await buttonByText(again, "保存")!.trigger("click");
        await waitUntil("写进去了", () => again.get("[data-field='character.外观']").text().includes("银发"));
    });

    it("别的调用方独占写入时“改”不可用，写着它申请时给的那句；它释放以后恢复", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        await waitUntil("值", () => wrapper.find("[data-value]").exists());
        state.tab = "data:character";
        await waitUntil("“改”", () => wrapper.find("[data-edit='character.外观']").exists());

        const lease = await other.canon.hold("第 3 章记账");
        if (!lease.ok) throw new Error(JSON.stringify(lease.failure));
        await waitUntil("不可用", () => wrapper.get("[data-edit='character.外观']").attributes("disabled") !== undefined);
        expect(wrapper.get("[data-edit='character.外观']").attributes("title")).toContain("第 3 章记账");
        await lease.value.release();
        await waitUntil("恢复", () => wrapper.get("[data-edit='character.外观']").attributes("disabled") === undefined);
    });

    it("填的字太长、一次调用装不下：确认条写“这次改动太大，分开改”，不能保存，填的字还在（输出 29）", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        await waitUntil("值", () => wrapper.find("[data-value]").exists());
        state.tab = "data:character";
        const bar = await startEdit(wrapper, "character.外观");
        const long = "长".repeat(Math.ceil(CANON_BUDGET_BYTES / 3) + 1);
        await bar.get("textarea").setValue(long);
        await waitUntil("太大", () => wrapper.get("[data-confirm-bar]").text().includes("这次改动太大，分开改"), {timeoutMs: 10_000});
        expect(buttonByText(wrapper, "保存")!.attributes("disabled")).toBeDefined();
        expect((wrapper.get("[data-confirm-bar] textarea").element as HTMLTextAreaElement).value).toBe(long);
    });

    it("删除条目：确认以后标签留着、显示“这个条目已删除”，顶上有提示", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper} = await open(id);
        await waitUntil("值", () => wrapper.find("[data-value]").exists());
        // “更多”是浮层菜单（经 Teleport），这里直接发页头的 delete 事件，确认对话框照常走。
        wrapper.findComponent(EntryPage).vm.$emit("delete");
        await waitUntil("确认对话框", () => document.body.textContent?.includes("删除“星瑕”？") ?? false);
        const confirm = [...document.body.querySelectorAll("button")].find((button) => button.textContent?.trim() === "删除")!;
        confirm.click();
        await waitUntil("已删除", () => wrapper.text().includes("这个条目已删除"));
        expect(wrapper.get("[data-notice-bar]").text()).toContain("删除“星瑕”");
    });
});

describe("世界只读（验收 8 的前一半）", () => {
    it("日志里有一行认不出的格式：重新打开以后页面顶上有横幅，“改”与“记一笔”都不可用", async () => {
        venue = await canonNodeWorld(tmp);
        const writer = await venue.window("writer");
        const star = person("星瑕");
        const id = (await publish(writer.canon, [star]))[star.id]!;
        const status = await writer.canon.call("status", {});
        if (!status.ok) throw new Error(JSON.stringify(status.failure));
        await venue.close();
        // 接在最后一段末尾写一行格式 1 的修订：重放读到它就停，世界只读（canon.project 输出 2、4）。
        const logDir = join(tmp, "Book", ".nbook", "world", "log");
        const segment = (await readdir(logDir)).filter((name) => name.endsWith(".jsonl")).sort().at(-1)!;
        await appendFile(join(logDir, segment), `${JSON.stringify({format: 1, version: status.value.version + 1})}\n`);

        const {open} = await setup();
        const {wrapper, state} = await open(id);
        await waitUntil("横幅", () => wrapper.text().includes("世界只读"));
        state.tab = "data:panel";
        await waitUntil("“改”", () => wrapper.find("[data-edit='panel.存款']").exists());
        expect(wrapper.get("[data-edit='panel.存款']").attributes("disabled")).toBeDefined();
        // 按钮在没填的时候本来就不可用，看输入框：只读时连输入都不让填。
        expect(wrapper.findAll("[data-record-form] input").map((input) => input.attributes("disabled") !== undefined)).toEqual([true, true]);
    });
});
