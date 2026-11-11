/**
 * 条目页（entry-page.ts、EntryPageHost.vue；docs/specs/canon/author-ui.md 输出 6 到 15、26、27，验收 1、2、7、13）接在进程内的
 * 真实世界上：canon 的浏览器入口照产品那样把页面交给编辑器的贡献点，测试插件扮演编辑器收下它，按编辑器的做法给每个标签一份
 * `context`。数据都经真实的世界服务发布。
 */

import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {mount} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {reactive} from "vue";
import type {Component} from "vue";

import type {Entry, StoryChangeDraft, WriteRequest} from "@notnotype/nb-canon";
import type {ContributionHandle, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {completeEditorPageDeclaration, EDITOR_PAGES_POINT, validateEditorPageContribution} from "nbook/plugins/editor/shared/contracts";
import type {EditorPageDeclaration} from "nbook/plugins/editor/shared/contracts";
import type {EditorPageContext, EditorPageImplementation} from "nbook/plugins/editor/web/pages";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {CanonClient} from "../shared/contracts";
import {countedClient} from "../testing/counted-client";
import {canonNodeWorld} from "../testing/node-world";
import type {CanonNodeWindow, CanonNodeWorld} from "../testing/node-world";
import {ENTRY_PAGE} from "./commands";
import {ComponentViewRegistry} from "./component-views";
import EntryTree from "./components/EntryTree.vue";
import {createEntriesViewHost, entriesViewState} from "./entries-view";
import {createEntryPage, originsFetcher} from "./entry-page";
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

let sequence = 0;
const next = (): string => String(++sequence);

/** 发布一次；条目直接给，别的对象给写入项。 */
async function publish(canon: CanonClient, given: ReadonlyArray<Entry | WriteRequest["puts"][number]>): Promise<Record<string, string>> {
    const puts = given.map((item) => ("init" in item ? {ref: {kind: "entry" as const, id: item.id}, after: item} : item));
    const status = await canon.call("status", {});
    if (!status.ok) throw new Error(JSON.stringify(status.failure));
    const result = await canon.publish({requestId: `req-${next()}`, by: {kind: "author"}, what: "edit", title: "写入", baseVersion: status.value.version, puts});
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return result.value.ids;
}

function person(name: string, extra: Partial<Entry> = {}, money = 1000): Entry {
    return {
        id: `tmp:${next()}`, type: "nbook.canon.person", parent: null, folder: "人物", order: sequence,
        init: {
            name, aliases: [], summary: `${name}的简介`, text: [{id: "b1", source: "她有 {panel.存款} 元。"}],
            data: {
                character: {type: "nbook.canon.person", version: 1, enabled: true, fields: {外观: "黑发", 状态: null, 态度: null}},
                panel: {type: "nbook.canon.panel", version: 1, enabled: true, fields: {存款: money}, declared: [{id: "存款", label: "存款", kind: "number", unit: "元"}]},
            },
        },
        ...extra,
    };
}

function change(entry: string, chapter: string, text: string, delta: number, basis?: StoryChangeDraft["patches"][number]["basis"]): WriteRequest["puts"][number] {
    const id = `tmp:${next()}`;
    const after: StoryChangeDraft = {
        id, kind: "written", text, at: {kind: "chapter", chapter, key: sequence}, told: [], involves: [entry], lines: [], links: [], status: "active", by: {kind: "author"},
        patches: [{op: "add", at: {entry, path: "panel.存款"}, value: delta, ...(basis === undefined ? {} : {basis})}],
    };
    return {ref: {kind: "change", id}, after};
}

/** 扮演编辑器的测试插件：收下 canon 交来的页面实现。 */
function editorStandIn(): {readonly plugin: PluginDefinition; page(): EditorPageImplementation<EntryPageState>} {
    const handles = new Map<string, ContributionHandle<EditorPageDeclaration, EditorPageImplementation>>();
    return {
        plugin: {
            id: "test.editor",
            contributionPoints: [{id: EDITOR_PAGES_POINT, implementation: "required", complete: completeEditorPageDeclaration, validate: validateEditorPageContribution}],
            entries: [{
                id: "browser", location: "browser", activationEvents: ["onStartup"], receives: [EDITOR_PAGES_POINT],
                activate: () => ({receivers: {[EDITOR_PAGES_POINT]: {published: (handle) => void handles.set(handle.id, handle as never), revoke: (handle) => void handles.delete(handle.id)}}}),
            }],
        },
        page: () => {
            const handle = handles.get(ENTRY_PAGE);
            if (handle === undefined) throw new Error("canon 没有交条目页");
            return handle.implementation() as unknown as EditorPageImplementation<EntryPageState>;
        },
    };
}

interface Opened {
    readonly wrapper: ReturnType<typeof mount>;
    readonly state: EntryPageState;
    remount(): ReturnType<typeof mount>;
}

async function setup(): Promise<{other: CanonNodeWindow; page: EditorPageImplementation<EntryPageState>; open: (id: string, state?: EntryPageState) => Promise<Opened>}> {
    venue = await canonNodeWorld(tmp);
    const editor = editorStandIn();
    await venue.window("mine", [editor.plugin]);
    const other = await venue.window("other");
    const page = editor.page();
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
    return {other, page, open};
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
        const renamed = `tmp:${next()}`;
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
        await waitUntil("人物的字段", () => wrapper.findAll("[data-field]").length === 3);
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
        const page = createEntryPage({world: () => world, fetchOrigins: originsFetcher((input) => counted.client.call("origins", input)), views: new ComponentViewRegistry(), execute: () => undefined, entriesView: "nbook.canon.entries"});
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
        const page = createEntryPage({world: () => world, fetchOrigins: originsFetcher((input) => counted.client.call("origins", input)), views: new ComponentViewRegistry(), execute: () => undefined, entriesView: "nbook.canon.entries"});
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
