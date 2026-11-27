/**
 * 条目页（entry-page.ts、EntryPageHost.vue；docs/specs/canon/author-ui.md 输出 6 到 15、26、27，验收 1、2、7、13）接在进程内的
 * 真实世界上：canon 的浏览器入口照产品那样把页面交给编辑器的贡献点，测试插件（`testing/page-stand-in.ts`）扮演编辑器收下它，
 * 按编辑器的做法给每个标签一份 `context`。数据都经真实的世界服务发布。
 */

import {appendFile, mkdir, readdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {DOMWrapper, mount} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {defineComponent, h, nextTick, reactive, ref} from "vue";
import type {Component, PropType} from "vue";

import type {Entry, StoryChangeDraft} from "@notnotype/nb-canon";
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
import {CANON_COMPONENT_VIEWS_POINT, CANON_COMPONENTS_POINT} from "../shared/contracts";
import {ENTRY_PAGE} from "./commands";
import {ComponentViewRegistry} from "./component-views";
import type {ComponentViewContext} from "./component-views";
import EntryPage from "./components/entry-page/EntryPage.vue";
import EntryText from "./components/text/EntryText.vue";
import EntryTree from "./components/entries/EntryTree.vue";
import {createEntriesViewHost, entriesViewState} from "./entries-view";
import {createEntryPage, ENTRY_PAGE_ICON, originsFetcher} from "./entry-page";
import AddComponentDialog from "./components/entry-page/AddComponentDialog.vue";
import type {ChecklistItem} from "./components/entry-page/component-checklist";
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

async function setup(project: readonly PluginDefinition[] = [], browser: readonly PluginDefinition[] = []): Promise<{other: CanonNodeWindow; page: EditorPageImplementation<EntryPageState>; open: (id: string, state?: EntryPageState) => Promise<Opened>; tree: () => Promise<ReturnType<typeof mount>>}> {
    venue = await canonNodeWorld(tmp, {project});
    const editor = pageStandIn();
    await venue.window("mine", [editor.plugin, ...browser]);
    const other = await venue.window("other");
    const page = editor.page<EntryPageState>(ENTRY_PAGE);
    const component: Component = await page.load();
    const open = async (id: string, given?: EntryPageState): Promise<Opened> => {
        // 同编辑器：每个标签一份 context，`state` 是 initialState 的响应式副本，切走再回来是同一个。
        const context: EditorPageContext<EntryPageState> = {recent: [], arg: id, state: given ?? reactive(page.initialState!(id))};
        const mountOnce = (): ReturnType<typeof mount> => {
            // 过渡用真的（测试工具缺省把 `Transition` 换成直接画出子节点的替身）：阅读视图与编辑视图在一个先出后进的过渡里换，
            // 退场收不了尾时换上来的那一个永远不出现，替身看不到这种事。
            const wrapper = mount(component, {props: {context}, global: {provide: provideText(port), stubs: {transition: false}}, attachTo: document.body});
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
/** 看得见的字：逐个节点取，块与块之间一个空格；只给读屏的（`sr-only`，例如来历里的“变化”“结果”）不算。 */
const cells = (element: Element): string => [...element.childNodes].map((node) => {
    if (node instanceof Element) return node.classList.contains("sr-only") ? "" : cells(node);
    return node.nodeType === Node.TEXT_NODE ? node.textContent?.replace(/\s+/gu, " ").trim() ?? "" : "";
}).filter((part) => part !== "").join(" ");
const originRows = (wrapper: ReturnType<typeof mount>): string[] => wrapper.findAll("[data-origin-row]").map((row) => cells(row.element));

describe("条目页", () => {
    it("标签的图标按条目的种类（workbench/editor 输出 53）：人物是人像，种类没登记图标的是书签；还没读到条目时不给（交给编辑器记着的）", async () => {
        const {other, page, open} = await setup();
        const star = person("星瑕", {type: "人物"});
        const odd = person("钥匙", {type: "法器"});
        const ids = await publish(other.canon, [star, odd]);
        expect(page.icon!(ids[star.id]!)).toBeNull();
        const starPage = await open(ids[star.id]!);
        await waitUntil("人物的页头", () => starPage.wrapper.find("h1").exists() && starPage.wrapper.find("h1").text() === "星瑕");
        expect(page.icon!(ids[star.id]!)).toBe("i-lucide-user-round");
        const oddPage = await open(ids[odd.id]!);
        await waitUntil("法器的页头", () => oddPage.wrapper.find("h1").exists() && oddPage.wrapper.find("h1").text() === "钥匙");
        expect(page.icon!(ids[odd.id]!)).toBe(ENTRY_PAGE_ICON);
    });

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
            "第 2 章 −300 900 元 改这一笔 买了书 估计：书大概三百",
            "第 1 章 +200 1,200 元 改这一笔 领了工资 作者给的",
            "最初 1,000 元",
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
        expect(originRows(wrapper)[0]).toBe("第 2 章 −50 850 元 改这一笔 又买了笔 作者给的");

        const seen: string[] = [];
        const observer = new MutationObserver(() => seen.push(wrapper.text()));
        observer.observe(wrapper.element, {subtree: true, childList: true, characterData: true});
        cleanups.push(() => observer.disconnect());
        state.position = "1:end";
        await waitUntil("值与来历都换成第 1 章末尾的", () => valueText(wrapper) === "1,200" && originRows(wrapper).length === 2);
        expect(originRows(wrapper)).toEqual(["第 1 章 +200 1,200 元 改这一笔 领了工资 作者给的", "最初 1,000 元"]);
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
        expect(originRows(wrapper).at(-1)).toBe("最初 1,000 元");
        expect(wrapper.text()).toContain("再显示更早的（还有 5 步）");
        const more = wrapper.findAll("button").find((button) => button.text().startsWith("再显示更早的"))!;
        await more.trigger("click");
        await waitUntil("读完", () => originRows(wrapper).length === 26);
        expect(wrapper.text()).not.toContain("再显示更早的");
        // 读完以后最早那一笔的变化量按初值算出来了。
        expect(originRows(wrapper).at(-2)).toBe("第 1 章 +10 1,010 元 改这一笔 第 1 笔 作者给的");
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
        expect(tabs()).toEqual(["文字", "人物", "数值", "情节2"]);

        state.tab = "plot";
        await waitUntil("情节", () => wrapper.findAll("[data-change]").length === 2);
        expect(wrapper.findAll("[data-change]").map((row) => row.text().replace(/\s+/gu, ""))).toEqual(["第2章买了书存款−300", "第1章领了工资存款+200"]);

        state.tab = "data:character";
        // 人物分页用它的专门界面（输出 49）：条目数据里没写的（性别、身份等）写“填写”。
        await waitUntil("人物的界面", () => wrapper.find("[data-character-card]").exists());
        expect(wrapper.get("[data-fact='性别']").text()).toContain("填写");
        expect(wrapper.get("[data-edit='character.性格']").text()).toContain("黑发");
        expect(wrapper.get("[data-fact='身份']").text()).toContain("填写");

        state.tab = "data:panel";
        await waitUntil("面板的值卡与流水", () => wrapper.find("[data-card='panel.存款']").exists() && originRows(wrapper).length === 3);
        expect(wrapper.get("[data-card='panel.存款']").text()).toContain("900 元");
    });

    it("设定组分页能换着看（选中的分页再点开看法菜单）：“AI视图”是按“在看”读到的这一组那一节，“原始视图”是初值与改过这一组的变更，分页上写着现在的看法；换分页回到用户视图（输出 9、54）", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        await publish(other.canon, [change(id, "1", "领了工资", 200), change(id, "2", "买了书", -300)]);
        const {wrapper, state} = await open(id);
        state.tab = "data:panel";
        await waitUntil("数值的卡片", () => wrapper.find("[data-card='panel.存款']").exists());
        const selectedTab = () => wrapper.get("[role='tab'][aria-selected='true']");
        const look = async (label: "用户视图" | "AI视图" | "原始视图"): Promise<void> => {
            await selectedTab().trigger("click");
            await waitUntil("看法菜单", () => document.body.querySelector("[role='menuitemradio']") !== null);
            [...document.body.querySelectorAll<HTMLElement>("[role='menuitemradio']")].find((item) => item.textContent?.trim() === label)!.click();
            await waitUntil("菜单收起", () => document.body.querySelector("[role='menuitemradio']") === null);
        };

        await look("AI视图");
        await waitUntil("AI视图", () => wrapper.find("[data-agent-text]").exists());
        expect(selectedTab().text()).toContain("AI视图");
        const agent = wrapper.get("[data-agent-text]").text();
        expect(agent).toContain("【数值】");
        expect(agent).toContain("- 存款 = 900");
        // 只有这一组：人物那一节不在这里。
        expect(agent).not.toContain("性格");
        expect(wrapper.get("[data-agent-view]").text()).toContain("在看：第 2 章末尾");

        await look("原始视图");
        await waitUntil("原始视图", () => wrapper.find("[data-raw-changes]").exists() && wrapper.get("[data-raw-changes]").text().includes("剧情变更（2 条）"));
        expect(wrapper.get("[data-raw-initial]").text()).toContain("1000");
        expect(wrapper.get("[data-raw-changes]").text()).toContain("领了工资");
        expect(wrapper.get("[data-raw-changes]").text()).toContain("买了书");

        // 换到人物分页回到用户视图，分页上不写看法；人物这一组没有剧情变更改过。
        state.tab = "data:character";
        await waitUntil("人物的卡片", () => wrapper.find("[data-character-card]").exists());
        expect(wrapper.find("[data-raw-view]").exists()).toBe(false);
        expect(selectedTab().text()).not.toContain("视图");
        await look("原始视图");
        await waitUntil("人物的原始数据", () => wrapper.find("[data-raw-changes]").exists() && wrapper.get("[data-raw-changes]").text().includes("没有剧情变更改过这组设定"));
        expect(wrapper.get("[data-raw-initial]").text()).toContain("黑发");
    });

    it("人物条目：种类登记的默认设定组排在“文字”前面、打开时先看人物；“添加设定组”里适用于人物的排在前面，有人物的预设，一次加几组是一条修订（输出 9、38）", async () => {
        // 一个不写适用种类的类型，id 排在内置的前面：没有按种类排时它会是下拉里的第一项。
        const badge: PluginDefinition = {id: "a.test", entries: [], contributions: [{capability: CANON_COMPONENTS_POINT, id: "a.test.badge", declaration: {label: "徽章", namespace: "badge", version: 1, fields: [{id: "图案", label: "图案", kind: "text"}]}}]};
        const {other, open} = await setup([badge]);
        const star = person("星瑕", {type: "人物"});
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        const tabs = () => wrapper.findAll("[role='tab']").map((tab) => tab.text().replace(/\s+/gu, ""));
        // 作品里还没有剧情变更：没有“情节”（输出 9）。
        await waitUntil("分页", () => tabs().includes("文字") && tabs().includes("数值"));
        expect(tabs()).toEqual(["人物", "文字", "数值"]);
        await waitUntil("先看人物", () => wrapper.find("[role='tab'][aria-selected='true']").exists() && wrapper.get("[role='tab'][aria-selected='true']").text() === "人物");

        // “＋”里能加的：适用于人物的（形象）在前，其余（徽章）接在后面。
        const addable = () => (wrapper.findComponent(EntryPage).props("addable") as readonly {label: string}[]).map((item) => item.label);
        await waitUntil("能加的组", () => addable().includes("徽章"));
        expect(addable()).toEqual(["形象", "徽章"]);
        // “添加设定组”对话框：登记了的全部类型，按登记它的插件分组（别的插件的徽章归“插件”），标出条目上已经有的（输出 38）。
        const dialog = () => wrapper.findComponent(AddComponentDialog);
        const listed = () => new Map((dialog().props("items") as readonly ChecklistItem[]).map((entry) => [entry.label, `${entry.group}${entry.present ? " 已有" : ""}${entry.kinds.includes("人物") ? " 适用" : ""}`]));
        await waitUntil("对话框的各项", () => listed().has("徽章"));
        expect(["人物", "形象", "数值", "徽章"].map((label) => listed().get(label))).toEqual(["canon 已有 适用", "canon 适用", "canon 已有 适用", "other"]);
        expect(dialog().props("kind")).toBe("人物");

        // 点“＋”开对话框：人物的两个预设；勾形象与徽章，“添加 2 组”一次写入、一条修订，关上以后切到先勾的形象。
        const body = new DOMWrapper(document.body);
        await wrapper.get("[data-add-component]").trigger("click");
        await waitUntil("对话框", () => body.find("[data-add-component-list]").exists());
        expect(body.findAll("[data-checklist-presets] button").map((button) => button.text())).toEqual(["基本", "主要角色"]);
        // 写入被拒（打开以后别处已经加上了其中一组，这一页还没读到）：整批不收，按被拒的那一项（这里是第二项）指名，对话框不关、
        // 原因写在状态行。界面上已添加的勾不上，这里直接交给宿主一批。
        dialog().vm.$emit("add", ["a.test.badge", "nbook.canon.panel"]);
        await waitUntil("指名的失败", () => document.body.querySelector("[role='dialog']")?.textContent?.includes("“数值”这组设定已经加上了") === true);
        expect(body.find("[data-add-component-list]").exists()).toBe(true);
        expect(tabs()).toEqual(["人物", "文字", "数值"]);
        // 开着的时候写不了了（换到算上计划）：对话框关上；回来再开。
        state.planned = true;
        await waitUntil("写不了时关上", () => !body.find("[data-add-component-list]").exists());
        state.planned = false;
        await waitUntil("“＋”回来", () => wrapper.find("[data-add-component]").exists());
        // 浏览器里点按钮先把焦点放到它上面，对话框关上时还给它。
        (wrapper.get("[data-add-component]").element as HTMLElement).focus();
        await wrapper.get("[data-add-component]").trigger("click");
        await waitUntil("对话框", () => body.find("[data-add-component-list]").exists());
        await body.get("[data-checklist-item='nbook.canon.look']").trigger("click");
        await body.get("[data-checklist-item='a.test.badge']").trigger("click");
        expect(body.get("[data-add-submit]").text()).toBe("添加 2 组");
        await body.get("[data-add-submit]").trigger("click");
        await waitUntil("切到形象", () => wrapper.find("[role='tab'][aria-selected='true']").exists() && wrapper.get("[role='tab'][aria-selected='true']").text() === "形象");
        expect(tabs()).toEqual(["人物", "形象", "文字", "数值", "徽章"]);
        await waitUntil("对话框关上", () => !body.find("[data-add-component-list]").exists());
        expect(wrapper.get("[data-notice-bar]").text()).toContain("加上“形象”和“徽章”这几组设定");
        // 能加的都加上了：“＋”没了，焦点交给选中的分页，不掉到页面外。
        expect(wrapper.find("[data-add-component]").exists()).toBe(false);
        await waitUntil("焦点在选中的分页", () => document.activeElement === wrapper.get("[role='tab'][aria-selected='true']").element);

        // 种类不是人物的条目：分页照旧，文字在前。
        const item = person("魔杖", {type: "物品"});
        const itemId = (await publish(other.canon, [item]))[item.id]!;
        const other2 = await open(itemId);
        const tabs2 = () => other2.wrapper.findAll("[role='tab']").map((tab) => tab.text().replace(/\s+/gu, ""));
        await waitUntil("物品的分页", () => tabs2().includes("文字") && tabs2().includes("数值"));
        expect(tabs2()).toEqual(["文字", "人物", "数值"]);
    });

    it("人物条目有没提交的主文字稿时，打开页面选“文字”、直接在编辑里（输出 9、45）", async () => {
        const {other, open} = await setup();
        const star = person("星瑕", {type: "人物"});
        const id = (await publish(other.canon, [star]))[star.id]!;
        const sourceArea = (wrapper: ReturnType<typeof mount>): HTMLTextAreaElement | null => (wrapper.element as Element).querySelector<HTMLTextAreaElement>("[data-text-source] textarea");
        const first = await open(id);
        first.state.tab = "text";
        await waitUntil("“编辑”", () => first.wrapper.find("[data-text-edit]").exists());
        await first.wrapper.get("[data-text-edit]").trigger("click");
        await waitUntil("编辑视图", () => sourceArea(first.wrapper) !== null);
        const area = sourceArea(first.wrapper)!;
        area.value = "还没写完的一段";
        area.dispatchEvent(new Event("input", {bubbles: true}));
        await waitUntil("有稿", () => first.wrapper.find("[data-text-discard]").exists());
        first.wrapper.unmount();

        // 新开一个标签（没选过分页）：人物分页排在文字前面，但有稿时先看文字。
        const second = await open(id);
        await waitUntil("选中文字、在编辑里", () => second.wrapper.find("[role='tab'][aria-selected='true']").exists() && second.wrapper.get("[role='tab'][aria-selected='true']").text() === "文字" && sourceArea(second.wrapper)?.value === "还没写完的一段");
        expect(second.state.tab).toBe("text");
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
        await waitUntil("未出场", () => unappeared.wrapper.text().includes("这时还没出场"));
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
        // 树两层、条目页的章表、登记的类型、条目、渲染、情节第一页、作品里有没有计划（时间点的勾选项，输出 7）、有没有剧情变更
        // （“情节”出不出，输出 9），加上读取层自己的 status：每个一次，不多读。
        expect(reads).toEqual(["changes", "changes", "changes", "chapters", "components", "entry", "render", "status", "tree", "tree"]);
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
        state.tab = "data:panel";
        // 这里没有登记专门界面：面板分页是通用字段表。
        const money = (): string => entry.find("[role='tabpanel']").text();
        await waitUntil("面板分页", () => entry.find("[data-edit='panel.存款']").exists() && money().includes("1,000"));

        const before = counted.calls.length;
        await publish(other.canon, [change(id, "2", "买了书", -300)]);
        await waitUntil("值更新", () => money().includes("700"));
        const reads = counted.calls.slice(before).filter((call) => call.method === "entry" || call.method === "render");
        expect(reads.map((call) => call.method)).toEqual(["entry"]);
        expect(JSON.stringify(reads[0]!.input)).toContain('"edge":"end"');
    });
});

describe("写入", () => {
    /** 点一个字段的“改”，等确认条出来。 */
    /** 改一个值：通用字段表出页面顶上的确认条，人物、形象的专门界面在值下方的浮层里就地改（输出 51）；两处里面是同一份输入与预览。 */
    const EDITOR = "[data-confirm-bar], [data-inline-editor]";
    /** 整个页面，含传送到 body 末尾的浮层：就地改的编辑器在锚在值下方的浮层里（输出 51），挂载的组件里找不到。 */
    const everywhere = () => new DOMWrapper(document.body);
    const startEdit = async (wrapper: ReturnType<typeof mount>, path: string) => {
        await waitUntil(`${path} 的“改”`, () => wrapper.find(`[data-edit="${path}"]`).exists());
        await wrapper.get(`[data-edit="${path}"]`).trigger("click");
        await waitUntil("确认条或就地改", () => everywhere().find(EDITOR).exists());
        return everywhere().get(EDITOR);
    };
    const buttonByText = (wrapper: ReturnType<typeof mount> | DOMWrapper<Element>, label: string) => wrapper.findAll("button").find((button) => button.text() === label);

    it("改一个只在初值设过的字段：二选一写“从最初起”，没有别的变化时不写预览；保存后值变了、顶上有提示、焦点回到“改”；按计划时“改”不可用", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        await waitUntil("值", () => wrapper.find("[data-value]").exists());
        state.tab = "data:character";

        const bar = await startEdit(wrapper, "character.性格");
        expect(document.activeElement?.tagName).toBe("TEXTAREA");
        await bar.get("textarea").setValue("银发");
        await waitUntil("预览", () => everywhere().find("[data-previewed]").exists());
        // 二选一写落点（输出 16）：只在最初设过的值，改设定是“从最初起”；没有别的变化时不写预览那一行。
        expect(everywhere().get("[data-edit-intent]").text()).toContain("从最初起");
        expect(everywhere().find("[data-edit-impact]").exists()).toBe(false);
        await buttonByText(everywhere(), "保存")!.trigger("click");
        await waitUntil("值变了", () => wrapper.get("[data-edit='character.性格']").text().includes("银发"));
        await waitUntil("编辑收起", () => !everywhere().find(EDITOR).exists());
        expect(wrapper.get("[data-notice-bar]").text()).toContain("改性格");
        // 提示写出这次写回的位置：只在初值设过的字段，改的是最初的值（输出 18）。
        expect(wrapper.get("[data-notice-where]").text()).toBe("记在最初");
        await waitUntil("焦点回到“改”", () => document.activeElement?.getAttribute("data-edit") === "character.性格");

        // 取消与 Escape 一样收起编辑，焦点也回到那个值，不掉到页面外（输出 16、51，验收 11）。
        await startEdit(wrapper, "character.性格");
        await buttonByText(everywhere(), "取消")!.trigger("click");
        await waitUntil("取消以后", () => !everywhere().find(EDITOR).exists() && document.activeElement?.getAttribute("data-edit") === "character.性格");
        const again = await startEdit(wrapper, "character.性格");
        await again.get("textarea").trigger("keydown", {key: "Escape"});
        await waitUntil("Escape 以后", () => !everywhere().find(EDITOR).exists() && document.activeElement?.getAttribute("data-edit") === "character.性格");

        state.planned = true;
        await waitUntil("按计划时不可用", () => wrapper.get("[data-edit='character.性格']").attributes("disabled") !== undefined);
        expect(wrapper.get("[data-edit='character.性格']").attributes("title")).toBe("先不算计划");
    });

    it("确认条开着时换了时间点：预览按新的位置重取，保存后的提示写新的那一章", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        await waitUntil("值", () => wrapper.find("[data-value]").exists());
        state.tab = "data:character";
        state.position = "1:end";
        const bar = await startEdit(wrapper, "character.性格");
        await bar.get("textarea").setValue("银发");
        state.edit = {...state.edit!, intent: "story"};
        await waitUntil("预览", () => everywhere().find("[data-previewed]").exists() && everywhere().get("[data-edit-intent]").text().includes("从第 1 章起"));
        state.position = "2:end";
        // 换了位置：二选一跟着写新的那一章，预览作废、按新的位置重取（重取回来之前保存不可用）。
        await waitUntil("新的预览", () => everywhere().get("[data-edit-intent]").text().includes("从第 2 章起") && everywhere().find("[data-previewed]").exists());
        await buttonByText(everywhere(), "保存")!.trigger("click");
        await waitUntil("提示", () => wrapper.find("[data-notice-where]").exists());
        expect(wrapper.get("[data-notice-where]").text()).toBe("记在第 2 章");
    });

    it("二选一写落点：值来自哪一章就写“从第 N 章起”，同一章时写“改第 N 章那一笔 | 第 N 章里又变了”；剧情里变了写的“发生了什么”是修订标题与情节里那一条的文字，不填写“性格变成 新值”", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        await waitUntil("值", () => wrapper.find("[data-value]").exists());
        state.tab = "data:character";
        const segments = () => everywhere().get("[data-edit-intent]").findAll("button").map((button) => button.text());
        const saveStory = async (position: string, value: string, note: string): Promise<void> => {
            state.position = position;
            const bar = await startEdit(wrapper, "character.性格");
            await bar.get("textarea").setValue(value);
            await everywhere().get("[data-edit-intent]").findAll("button")[1]!.trigger("click");
            await waitUntil("发生了什么", () => everywhere().find("[data-edit-note] input").exists());
            if (note !== "") await everywhere().get("[data-edit-note] input").setValue(note);
            await waitUntil("预览", () => everywhere().find("[data-previewed]").exists());
            await buttonByText(everywhere(), "保存")!.trigger("click");
            await waitUntil("编辑收起", () => !everywhere().find(EDITOR).exists());
        };

        // 只在最初设过：从最初起 | 从第 1 章起。剧情里变了、写一句发生了什么：提示写这句话。
        state.position = "1:end";
        await startEdit(wrapper, "character.性格");
        expect(segments()).toEqual(["从最初起", "从第 1 章起"]);
        await buttonByText(everywhere(), "取消")!.trigger("click");
        await saveStory("1:end", "嘴硬心软", "开始照顾妹妹");
        await waitUntil("提示", () => wrapper.find("[data-notice-bar]").exists());
        expect(wrapper.get("[data-notice-bar]").text()).toContain("开始照顾妹妹");

        // 值来自第 1 章：在第 2 章改，改设定写“从第 1 章起”；在第 1 章改，两项写那一笔与又变了。
        state.position = "2:end";
        await startEdit(wrapper, "character.性格");
        // 换了位置以后条目按新的位置重读，读回来之前二选一按手上的值写；等它读回来。
        await waitUntil("从第 1 章起", () => JSON.stringify(segments()) === JSON.stringify(["从第 1 章起", "从第 2 章起"]));
        await buttonByText(everywhere(), "取消")!.trigger("click");
        state.position = "1:end";
        await startEdit(wrapper, "character.性格");
        await waitUntil("同一章", () => JSON.stringify(segments()) === JSON.stringify(["改第 1 章那一笔", "第 1 章里又变了"]));
        await buttonByText(everywhere(), "取消")!.trigger("click");

        // 不填发生了什么：标题与情节里那一条写“性格变成 新值”。
        await saveStory("2:end", "温柔", "");
        await waitUntil("提示", () => wrapper.find("[data-notice-bar]").exists() && wrapper.get("[data-notice-bar]").text().includes("性格变成 温柔"));
        state.tab = "plot";
        await waitUntil("情节", () => wrapper.findAll("[data-change]").length === 2);
        expect(wrapper.findAll("[data-change]").map((row) => row.text().replace(/\s+/gu, ""))).toEqual([expect.stringContaining("性格变成温柔"), expect.stringContaining("开始照顾妹妹")]);

    });

    it("值来自核对点（语义档的起点）：改设定写不回核对点，二选一退回“改设定”，同一章也不写“那一笔”", async () => {
        const {other, open} = await setup();
        const moon = person("月影");
        const panel = moon.init.data.panel as {fields: Record<string, unknown>; declared: unknown[]};
        panel.fields.好感 = 10;
        panel.declared.push({id: "好感", label: "好感", kind: "number", precision: "semantic"});
        const id = (await publish(other.canon, [moon]))[moon.id]!;
        const checkId = `tmp:${nextId()}`;
        await publish(other.canon, [{ref: {kind: "check", id: checkId}, after: {id: checkId, at: {entry: id, path: "panel.好感"}, value: 50, told: {source: "note", quote: "好感 50"}, place: {kind: "chapter", chapter: "1", key: Number(nextId())}}}]);
        const {wrapper, state} = await open(id);
        await waitUntil("值", () => wrapper.find("[data-value]").exists());
        state.tab = "data:panel";
        state.position = "1:end";
        const segments = () => everywhere().get("[data-edit-intent]").findAll("button").map((button) => button.text());
        await startEdit(wrapper, "panel.好感");
        await waitUntil("核对点来的值", () => JSON.stringify(segments()) === JSON.stringify(["改设定", "从第 1 章起"]));
    });

    it("页头改名、改简介：点名字本身在原处出浮层（与短项同一种），不出确认条；保存后页头换了名字、有提示，焦点回到名字", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper} = await open(id);
        const editorOf = (path: string): Element | null => document.body.querySelector(`[data-field-editor="${path}"]`);
        const fill = (path: string, value: string): void => {
            const field = editorOf(path)!.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea")!;
            field.value = value;
            field.dispatchEvent(new Event("input", {bubbles: true}));
        };
        const save = (path: string): void => [...editorOf(path)!.querySelectorAll("button")].find((button) => button.textContent?.trim() === "保存")!.click();

        await waitUntil("名字按钮", () => wrapper.find("[data-edit='entry.name']").exists());
        await wrapper.get("[data-edit='entry.name']").trigger("click");
        await waitUntil("浮层里的编辑器", () => editorOf("entry.name") !== null);
        expect(wrapper.find("[data-confirm-bar]").exists()).toBe(false);
        fill("entry.name", "夜王");
        await waitUntil("预览", () => editorOf("entry.name")?.querySelector("[data-previewed]") != null);
        save("entry.name");
        await waitUntil("名字变了", () => wrapper.get("h1").text() === "夜王");
        expect(wrapper.get("[data-notice-bar]").text()).toContain("改名字");
        await waitUntil("焦点回到名字", () => document.activeElement?.getAttribute("data-edit") === "entry.name");

        await wrapper.get("[data-edit='entry.summary']").trigger("click");
        await waitUntil("简介的编辑器", () => editorOf("entry.summary") !== null);
        fill("entry.summary", "第三魔法学院一年级");
        await waitUntil("预览", () => editorOf("entry.summary")?.querySelector("[data-previewed]") != null);
        save("entry.summary");
        await waitUntil("简介", () => wrapper.get("[data-edit='entry.summary']").text() === "第三魔法学院一年级");
    });

    it("页头的别名、加去一组设定、删除后恢复：都是一次改几处，结果在页上看得到", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        await waitUntil("别名一行", () => wrapper.find("[data-entry-aliases]").exists());
        await buttonByText(wrapper, "添加别名")!.trigger("click");
        const input = wrapper.get("[data-entry-aliases] input");
        await input.setValue("小瑕");
        await input.trigger("keydown", {key: "Enter"});
        await waitUntil("加上别名", () => wrapper.get("[data-entry-aliases]").text().includes("小瑕"));
        await wrapper.get("[data-entry-aliases] button[aria-label='去掉别名 小瑕']").trigger("click");
        await waitUntil("去掉别名", () => !wrapper.get("[data-entry-aliases]").text().includes("小瑕"));

        // 去掉人物这组设定：分页没了；再从“添加一组设定”加回来，标“恢复”，原来的数据还在。
        state.tab = "data:character";
        await waitUntil("人物分页", () => wrapper.find("[data-edit='character.性格']").exists());
        // “更多”菜单是弹出层，这里直接发它选中后的事件；菜单本身的项在 EntryPage 的组件测试里。
        wrapper.findComponent(EntryPage).vm.$emit("remove-component");
        await waitUntil("确认对话框", () => document.body.querySelector("[role='dialog']")?.textContent?.includes("数据会保留") === true);
        [...document.body.querySelectorAll<HTMLButtonElement>("[role='dialog'] button")].find((button) => button.textContent?.trim() === "去掉")!.click();
        await waitUntil("人物分页没了", () => !wrapper.findAll("[role='tab']").some((tab) => tab.text().includes("人物")));
        // 分页条末尾的“＋”列出能加的组，去掉过的写“恢复”；点一项就加上（输出 38）。菜单是弹出层，这里看交给它的项、直接发它
        // 选中后的事件。加上以后等分页出现再切过去。
        const addable = () => wrapper.findComponent(EntryPage).props("addable") as readonly {value: string; label: string}[];
        await waitUntil("能恢复人物", () => addable().some((item) => item.label === "恢复“人物”"));
        wrapper.findComponent(EntryPage).vm.$emit("add-open");
        wrapper.findComponent(EntryPage).vm.$emit("add-component", "nbook.canon.person");
        await waitUntil("人物分页回来、切过去了", () => wrapper.findAll("[role='tab']").some((tab) => tab.text().includes("人物") && tab.attributes("aria-selected") === "true"));
        expect(document.body.querySelector("[role='dialog']")).toBeNull();

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
        await waitUntil("预览", () => everywhere().find("[data-previewed]").exists());
        await buttonByText(everywhere(), "保存")!.trigger("click");
        await waitUntil("写进去了", async () => {
            const stored = await other.canon.call("object", {ref: {kind: "entry", id: ids[star.id]!}});
            return stored.ok && JSON.stringify((stored.value.object as Entry).init.data.rival?.fields.对头) === JSON.stringify({ref: ids[enemy.id]});
        });

        const image = await startEdit(wrapper, "rival.画像");
        const [path, caption] = image.findAll("[data-image-input] input");
        await path!.setValue("图片/雾崎.png");
        await caption!.setValue("黑衣");
        await waitUntil("预览", () => everywhere().find("[data-previewed]").exists());
        await buttonByText(everywhere(), "保存")!.trigger("click");
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
        // 改条目本身（加一项）不写位置。
        expect(wrapper.find("[data-notice-where]").exists()).toBe(false);

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
    /** 编辑视图里整篇的输入框（没有编辑器插件的窗口里是普通文本框）；没有编辑视图时为 null。 */
    const sourceArea = (wrapper: ReturnType<typeof mount>): HTMLTextAreaElement | null => (wrapper.find("[data-text-source] textarea").element as HTMLTextAreaElement | undefined) ?? null;
    /** 编辑视图里的输入框，没有就报错：断言之前先确认它在。 */
    const area = (wrapper: ReturnType<typeof mount>): HTMLTextAreaElement => {
        const found = sourceArea(wrapper);
        if (found === null) throw new Error("没有编辑视图");
        return found;
    };
    const typeInto = (area: HTMLTextAreaElement, value: string): void => {
        area.value = value;
        area.dispatchEvent(new Event("input", {bubbles: true}));
    };
    const dialogButton = (label: string) => [...document.body.querySelectorAll<HTMLButtonElement>("[role='dialog'] button, [role='alertdialog'] button")].find((button) => button.textContent?.trim() === label)!;
    const startEditing = async (wrapper: ReturnType<typeof mount>): Promise<void> => {
        await waitUntil("“编辑”或“开始写”", () => wrapper.find("[data-text-edit]").exists());
        await wrapper.get("[data-text-edit]").trigger("click");
        await waitUntil("编辑视图", () => wrapper.find("[data-text-editor]").exists() && sourceArea(wrapper) !== null);
    };
    /** 别处对这个条目发布一次编辑（`ops` 里的 entry 都是这个条目）。 */
    const editElsewhere = async (canon: CanonNodeWindow["canon"], ops: readonly Record<string, unknown>[], extra: Record<string, unknown> = {}): Promise<void> => {
        const status = await canon.call("status", {});
        if (!status.ok) throw new Error("读不到");
        const result = await canon.call("editEntries", {input: {requestId: `elsewhere-${nextId()}`, by: {kind: "author"}, what: "edit", baseVersion: status.value.version, title: "别处改", ops, ...extra}} as never);
        expect(result.ok).toBe(true);
    };

    it("主文字整篇编辑（验收 16）：没有时“开始写”，写两段（中间空一行）、提交成一条修订、世界里是一块；编辑期间位置锁住、标签报告有未提交的内容", async () => {
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
        // 进来是一个空的输入框，还不算有改动：右边是“取消”，状态行没有“有未提交的修改”，标签没有未提交的内容。
        expect([area(wrapper).value, wrapper.find("[data-text-cancel]").exists(), wrapper.find("[data-text-dirty]").exists(), page.uncommitted!(id)]).toEqual(["", true, false, false]);
        expect(wrapper.find("[data-view-point-locked]").exists()).toBe(true);

        const whole = `星瑕是第三魔法学院的学生。\n\n她有 <V of="panel.存款" /> 元。`;
        typeInto(area(wrapper), whole);
        await waitUntil("有未提交的修改", () => wrapper.find("[data-text-dirty]").exists() && wrapper.get("[data-text-dirty]").text() === "有未提交的修改");
        expect(page.uncommitted!(id)).toBe(true);
        // 暂存不是修订：世界里还没有。
        expect(await initText(other.canon, id)).toEqual([]);

        await wrapper.get("[data-text-submit]").trigger("click");
        await waitUntil("发布了", async () => (await initText(other.canon, id)).length === 1);
        // 两段连成整篇写进一块。
        expect(await initText(other.canon, id)).toEqual([whole]);
        await waitUntil("回到阅读视图", () => wrapper.find("[data-entry-text]").exists() && wrapper.get("[data-entry-text]").text().includes("第三魔法学院的学生"));
        await waitUntil("提示", () => wrapper.find("[data-notice-bar]").exists() && wrapper.get("[data-notice-bar]").text().includes("改星瑕的主文字"));
        expect([page.uncommitted!(id), wrapper.find("[data-view-point-locked]").exists(), wrapper.get("[data-text-edit]").text()]).toEqual([false, false, "编辑"]);
        const revisions = await other.canon.call("revisions", {filter: {entry: id}});
        expect(revisions.ok && revisions.value.items.map((item) => item.title)).toEqual(["改星瑕的主文字", "写入"]);

        // 标签的保存命令（Ctrl+S）调页面的 commit：同样提交。
        await startEditing(wrapper);
        expect(area(wrapper).value).toBe(whole);
        const longer = `星瑕是第三魔法学院的学生。\n\n她有 <V of="panel.存款" /> 元，都存在学院的柜子里。`;
        typeInto(area(wrapper), longer);
        await waitUntil("有改动", () => page.uncommitted!(id));
        await page.commit!(id);
        expect(await initText(other.canon, id)).toEqual([longer]);
    });

    it("放弃：多块的主文字进编辑是连起来的整篇，改了字以后放弃先问一句，确认以后回到阅读视图、世界不变", async () => {
        const {other, open, page} = await setup();
        const star = person("星瑕");
        star.init.text = [{id: "b1", source: "第一块。"}, {id: "b2", source: "第二块。"}, {id: "b3", source: "第三块。"}];
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        state.tab = "text";
        await startEditing(wrapper);
        expect(area(wrapper).value).toBe("第一块。\n\n第二块。\n\n第三块。");

        typeInto(area(wrapper), "不要了的改动");
        await waitUntil("有改动", () => wrapper.find("[data-text-discard]").exists());
        await wrapper.get("[data-text-discard]").trigger("click");
        await waitUntil("确认放弃", () => document.body.textContent?.includes("放弃没提交的修改？") === true);
        expect(wrapper.find("[data-text-editor]").exists()).toBe(true);
        dialogButton("放弃").click();
        await waitUntil("回到阅读视图", () => wrapper.find("[data-entry-text]").exists());
        expect([page.uncommitted!(id), await initText(other.canon, id)]).toEqual([false, ["第一块。", "第二块。", "第三块。"]]);
    });

    it("输出 48，编辑时的预览：进编辑旁边就有，是输入框里的整篇照此刻的数据画的；打字、别处改了值都跟着变；写得不对时写出行、留着上一次的；关掉就没有这一栏", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        state.tab = "text";
        await startEditing(wrapper);
        const pane = () => wrapper.find("[data-text-preview]");
        await waitUntil("预览读到", () => pane().exists() && pane().text().includes("她有 1,000 元。"));
        // 预览里的值只是文字；页面放宽成两栏的宽度；预览不算阅读视图。
        expect([pane().findAll("button").length, wrapper.get("[data-entry-page]").attributes("data-wide"), wrapper.find("[data-entry-text]").exists()]).toEqual([0, "", false]);

        typeInto(area(wrapper), `她有 <V of="panel.存款" /> 元，都存着。`);
        await waitUntil("预览跟着打的字变", () => pane().text().includes("她有 1,000 元，都存着。"));
        await editElsewhere(other.canon, [{op: "set", at: {entry: id, path: "panel.存款"}, value: 250}]);
        await waitUntil("别处改了值，预览跟着变", () => pane().text().includes("她有 250 元，都存着。"));

        typeInto(area(wrapper), '她有 <V of="panel.存款" 元');
        await waitUntil("写得不对", () => wrapper.find("[data-text-preview-note]").exists());
        expect([wrapper.get("[data-text-preview-note]").text().startsWith("第 1 行第 "), pane().text().includes("她有 250 元，都存着。"), wrapper.find("[data-text-problem]").exists()]).toEqual([true, true, false]);
        typeInto(area(wrapper), `她有 <V of="panel.存款" /> 元。`);
        await waitUntil("改对了", () => !wrapper.find("[data-text-preview-note]").exists() && pane().text().includes("她有 250 元。"));

        await wrapper.get("[data-text-preview-toggle]").trigger("click");
        await waitUntil("预览栏收起", () => !pane().exists());
        expect([state.preview, wrapper.get("[data-entry-page]").attributes("data-wide"), area(wrapper).value]).toEqual([false, undefined, `她有 <V of="panel.存款" /> 元。`]);
    });

    it("别处也改了主文字：提交时出一条对照，选“我的”以后以我的为准、选“现在的”放弃我的；别处改的是这个条目的字段或别的条目时不问，直接发布（验收 16）", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        star.init.text = [{id: "b1", source: "第一块。"}, {id: "b2", source: "第二块。"}];
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        state.tab = "text";
        await startEditing(wrapper);
        typeInto(area(wrapper), "第一块（我的）。\n\n第二块。");
        await waitUntil("有改动", () => wrapper.find("[data-text-dirty]").exists());
        // 别处改了这个条目的一个字段、又加了别的条目：主文字没人动，不问，提交以后都在。
        await editElsewhere(other.canon, [{op: "set", at: {entry: id, path: "character.性格"}, value: "银发"}]);
        await publish(other.canon, [person("别人")]);
        await wrapper.get("[data-text-submit]").trigger("click");
        await waitUntil("发布了", async () => (await initText(other.canon, id))[0] === "第一块（我的）。\n\n第二块。");
        expect(await initText(other.canon, id)).toEqual(["第一块（我的）。\n\n第二块。"]);
        expect(document.body.querySelector("[data-text-conflicts]")).toBeNull();
        const stored = await other.canon.call("object", {ref: {kind: "entry", id}});
        expect(stored.ok && (stored.value.object as Entry).init.data.character?.fields.性格).toBe("银发");
        await waitUntil("回到阅读视图", () => wrapper.find("[data-entry-text]").exists());

        // 这回别处改的是主文字（多块的主文字提交以后是一块，id 还是第一块的）。
        await startEditing(wrapper);
        typeInto(area(wrapper), "第一块（我的第二版）。\n\n第二块。");
        await waitUntil("有改动", () => wrapper.find("[data-text-dirty]").exists());
        await editElsewhere(other.canon, [{op: "set", at: {entry: id, path: "text[b1]"}, value: "第一块（别处的第二版）。"}]);
        await wrapper.get("[data-text-submit]").trigger("click");
        await waitUntil("对照", () => document.body.querySelector("[data-text-conflicts]") !== null);
        // 整篇只问一条。
        expect([...document.body.querySelectorAll("[data-conflict]")].map((item) => item.getAttribute("data-conflict"))).toEqual(["whole"]);
        const picks = (name: string) => document.body.querySelector<HTMLButtonElement>(`[data-conflict="whole"] [data-pick="${name}"]`)!;
        expect([picks("theirs").textContent, picks("mine").textContent]).toEqual(["现在的第一块（别处的第二版）。", "我的第一块（我的第二版）。\n\n第二块。"]);
        expect(await initText(other.canon, id)).toEqual(["第一块（别处的第二版）。"]);
        // 没选就点提交：不发，页脚写一句。
        dialogButton("提交").click();
        await waitUntil("还没选", () => document.body.textContent?.includes("选了才能提交") === true);
        picks("mine").click();
        await waitUntil("选上了", () => picks("mine").getAttribute("aria-pressed") === "true");
        dialogButton("提交").click();
        await waitUntil("以我的为准", async () => (await initText(other.canon, id))[0] === "第一块（我的第二版）。\n\n第二块。");
        await waitUntil("回到阅读视图", () => wrapper.find("[data-entry-text]").exists());

        // 再来一次，这回选“现在的”：我的改动不要了，没有别的改动，不多出修订，回到阅读视图。
        await startEditing(wrapper);
        typeInto(area(wrapper), "第一块（我的第三版）。");
        await waitUntil("有改动", () => wrapper.find("[data-text-dirty]").exists());
        await editElsewhere(other.canon, [{op: "set", at: {entry: id, path: "text[b1]"}, value: "第一块（别处的第三版）。"}]);
        const before = await other.canon.call("status", {});
        await wrapper.get("[data-text-submit]").trigger("click");
        await waitUntil("对照", () => document.body.querySelector("[data-text-conflicts]") !== null);
        picks("theirs").click();
        await waitUntil("选上了", () => picks("theirs").getAttribute("aria-pressed") === "true");
        dialogButton("提交").click();
        await waitUntil("回到阅读视图", () => wrapper.find("[data-entry-text]").exists() && wrapper.get("[data-entry-text]").text().includes("别处的第三版"));
        const after = await other.canon.call("status", {});
        expect([await initText(other.canon, id), before.ok && after.ok && after.value.version === before.value.version]).toEqual([["第一块（别处的第三版）。"], true]);
    });

    it("主文字里有被剧情改过的块：点“编辑”留在阅读视图，页头下面写着现在不能在这里改，没有编辑视图；阅读视图没有每块的剧情入口", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        star.init.text = [{id: "b1", source: "第一块。"}, {id: "b2", source: "第二块。"}];
        const id = (await publish(other.canon, [star]))[star.id]!;
        // 第 1 章：把第二块整块换掉，在第一块后面加一块。
        await editElsewhere(other.canon, [{op: "set", at: {entry: id, path: "text[b2]"}, value: "第二块（剧情里变了）。"}, {op: "addBlock", entry: id, source: "剧情加的一块。", after: "b1"}], {intent: "story", position: {kind: "chapter", chapter: "1", edge: "end"}});
        const {wrapper, state} = await open(id);
        state.tab = "text";
        // 选了某一章：以前每一块有剧情菜单、文末有“在剧情里加一块”，现在都没有。
        state.position = "2:end";
        await waitUntil("阅读视图", () => wrapper.find("[data-entry-text] [data-block]").exists() && wrapper.get("[data-entry-text]").text().includes("剧情加的一块"));
        expect([wrapper.find("[data-block-actions]").exists(), wrapper.find("[data-story-add]").exists()]).toEqual([false, false]);

        await wrapper.get("[data-text-edit]").trigger("click");
        await waitUntil("写明原因", () => wrapper.find("[data-page-error]").exists());
        expect([wrapper.get("[data-page-error]").text(), wrapper.find("[data-text-editor]").exists(), wrapper.find("[data-entry-text]").exists()]).toEqual(["这个条目的文字里有随剧情变的段落，现在不能在这里改", false, true]);
    });


    it("别的调用方独占写入时：提交点不了、原因写在那一行；用保存命令提交也不发、写明原因；释放以后连按两次保存只发一次", async () => {
        const {other, open, page} = await setup();
        const star = person("星瑕");
        star.init.text = [{id: "b1", source: "第一块。"}];
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        state.tab = "text";
        await startEditing(wrapper);
        typeInto(area(wrapper), "第一块（改）。");
        await waitUntil("有改动", () => page.uncommitted!(id));

        const lease = await other.canon.hold("第 3 章记账");
        if (!lease.ok) throw new Error(JSON.stringify(lease.failure));
        await waitUntil("提交点不了", () => wrapper.get("[data-text-submit]").attributes("disabled") !== undefined);
        expect(wrapper.get("[data-text-submit-blocked]").text()).toContain("第 3 章记账");
        await page.commit!(id);
        await waitUntil("写明原因", () => wrapper.find("[data-text-message]").exists());
        // 原因照整批的说明显示，状态行里不再写一遍（那一句淡出以后才从页面上拿掉）。
        expect(wrapper.get("[data-text-message]").text()).toContain("第 3 章记账");
        await waitUntil("状态行里那一句收起", () => !wrapper.find("[data-text-submit-blocked]").exists());
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
        typeInto(area(wrapper), "还没提交的整篇。");
        await waitUntil("有改动", () => page.uncommitted!(id));

        await editElsewhere(other.canon, [{op: "delete", entry: id}]);
        await waitUntil("已删除", () => wrapper.text().includes("这个条目已删除"));
        await waitUntil("稿还列着", () => sourceArea(wrapper) !== null);
        expect([area(wrapper).value, page.uncommitted!(id)]).toEqual(["还没提交的整篇。", true]);
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

    it("有稿时这一页停在稿开始的位置、按实际读：位置与“按计划”换了也不换读取；稿开始的那一章没了：输入框只读地显示稿里的整篇，只能放弃，放弃以后才跟到现在的位置", async () => {
        const {other, open, page} = await setup();
        const star = person("星瑕");
        star.init.text = [{id: "b1", source: `她有 <V of="panel.存款" /> 元。`}, {id: "b2", source: "第二块。"}];
        const id = (await publish(other.canon, [star]))[star.id]!;
        await publish(other.canon, [change(id, "1", "领了工资", 200), change(id, "2", "买了书", -300)]);
        const {wrapper, state} = await open(id);
        state.tab = "text";
        state.position = "1:end";
        await waitUntil("第 1 章末尾的值", () => wrapper.find("[data-value]").exists() && valueText(wrapper) === "1,200");
        await startEditing(wrapper);
        expect(area(wrapper).value).toBe(`她有 <V of="panel.存款" /> 元。\n\n第二块。`);
        const edited = `她有 <V of="panel.存款" /> 元。\n\n改过的第二块。`;
        typeInto(area(wrapper), edited);
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
        // 输入框只读地显示稿里的整篇，没有“插入”，不能提交。
        expect([area(wrapper).value, area(wrapper).readOnly, wrapper.find("[data-text-insert]").exists()]).toEqual([edited, true, false]);
        expect(wrapper.get("[data-text-submit]").attributes("disabled")).toBeDefined();

        await wrapper.get("[data-text-discard]").trigger("click");
        await waitUntil("确认放弃", () => document.body.textContent?.includes("放弃没提交的修改？") === true);
        dialogButton("放弃").click();
        await waitUntil("回到阅读视图，读现在的位置", () => wrapper.find("[data-value]").exists() && valueText(wrapper) !== "1,200");
        expect([page.uncommitted!(id), wrapper.find("[data-view-point-locked]").exists()]).toEqual([false, false]);
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
        typeInto(area(second.wrapper), "第一块（改）。");
        await waitUntil("有改动", () => page.uncommitted!(id));

        second.wrapper.unmount();
        await waitUntil("另一页也在编辑", () => sourceArea(first.wrapper) !== null);
        await page.commit!(id);
        expect(await initText(other.canon, id)).toEqual(["第一块（改）。"]);

        await startEditing(first.wrapper);
        typeInto(area(first.wrapper), "第一块（再改）。");
        await waitUntil("有改动", () => page.uncommitted!(id));
        first.wrapper.unmount();
        await expect(page.commit!(id)).rejects.toThrow();
        expect([await initText(other.canon, id), page.uncommitted!(id)]).toEqual([["第一块（改）。"], true]);
    });

    it(`“插入”：条目启用了有字段的设定组时，选一个字段，输入框里光标处多出 <V of="命名空间.字段" />，焦点回到输入框`, async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        star.init.text = [{id: "b1", source: "她有钱。"}];
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        state.tab = "text";
        await startEditing(wrapper);
        const input = area(wrapper);
        input.focus();
        input.setSelectionRange(2, 2);

        // 打开 nb-ui 的下拉菜单：聚焦触发器、按向下键。
        await waitUntil("“插入”", () => wrapper.find("[data-text-insert]").exists());
        const trigger = wrapper.get("[data-text-insert]").element as HTMLElement;
        trigger.focus();
        trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}));
        await waitUntil("菜单", () => document.body.querySelector("[role='menuitem']") !== null);
        const item = [...document.body.querySelectorAll<HTMLElement>("[role='menuitem']")].find((candidate) => candidate.textContent?.trim().endsWith("存款"));
        expect(item?.textContent?.trim()).toBe("数值 · 存款");
        item!.click();
        await waitUntil("写进输入框", () => input.value === '她有<V of="panel.存款" />钱。');
        expect(document.activeElement).toBe(input);
        await waitUntil("算作有改动", () => wrapper.find("[data-text-dirty]").exists());
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
        await waitUntil("写明原因", () => wrapper.find("[data-page-error]").exists());
        expect([wrapper.get("[data-page-error]").text(), wrapper.find("[data-text-editor]").exists()]).toEqual(["读不到最新的文字", false]);
    });

    it("人物分页展开语义档的字段：来历下面能记一句，落在所选位置，值后面多一句", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        await waitUntil("页头", () => wrapper.find("h1").exists());
        state.tab = "data:character";
        // 语义档的项点了展开细节（输出 51）：之前记下的各句与“记一句”。
        await waitUntil("现在的状态", () => wrapper.find("[data-condition='现在的状态']").exists());
        await wrapper.get("[data-condition='现在的状态']").trigger("click");
        await waitUntil("记一句的表单", () => wrapper.find("[data-condition-detail] [data-record-form]").exists());
        expect(wrapper.findAll("[data-condition-detail] [data-record-form] input")).toHaveLength(1);
        const form = wrapper.get("[data-condition-detail] [data-record-form]");
        await form.get("input").setValue("对校长起了疑心");
        await form.trigger("submit");
        await waitUntil("记进去了", () => wrapper.find("[data-notice-bar]").exists() && wrapper.get("[data-notice-bar]").text().includes("对校长起了疑心"));
        await waitUntil("细节里多一句", () => wrapper.get("[data-condition-detail]").text().includes("对校长起了疑心"));
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
        expect(buttonByText(everywhere(), "保存")!.attributes("disabled")).toBeDefined();
        await buttonByText(everywhere(), "取消")!.trigger("click");

        const form = wrapper.get("[data-record-form]");
        const [what, delta] = form.findAll("input");
        await what!.setValue("捡到钱");
        await delta!.setValue("-200");
        await form.trigger("submit");
        await waitUntil("值卡少了 200", () => wrapper.get("[data-card='panel.存款']").text().includes("700 元"));
        await waitUntil("流水多了一行", () => originRows(wrapper).length === 4);
        expect(originRows(wrapper)[0]).toContain("捡到钱");
        expect(wrapper.get("[data-notice-bar]").text()).toContain("记了一笔：捡到钱");
        expect(wrapper.get("[data-notice-where]").text()).toBe("记在第 2 章");
        expect((wrapper.get("[data-record-form] input").element as HTMLInputElement).value).toBe("");
    });

    it("确认条开着时别处改了这个值：写“这个值刚刚变了”，再点保存就以新值为准写进去；切走再回来确认条与填的值还在", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const first = await open(id);
        await waitUntil("值", () => first.wrapper.find("[data-value]").exists());
        first.state.tab = "data:character";
        const bar = await startEdit(first.wrapper, "character.性格");
        await bar.get("textarea").setValue("银发");
        await waitUntil("预览", () => everywhere().find("[data-previewed]").exists());

        first.wrapper.unmount();
        const again = first.remount();
        await waitUntil("回来以后编辑还在", () => everywhere().find("[data-inline-editor] textarea").exists());
        expect((everywhere().get("[data-inline-editor] textarea").element as HTMLTextAreaElement).value).toBe("银发");

        const stored = await other.canon.call("object", {ref: {kind: "entry", id}});
        if (!stored.ok) throw new Error(JSON.stringify(stored.failure));
        const entry = stored.value.object as Entry;
        await publish(other.canon, [{...entry, init: {...entry.init, data: {...entry.init.data, character: {...entry.init.data.character!, fields: {...entry.init.data.character!.fields, 性格: "红发"}}}}}]);
        await waitUntil("这个值刚刚变了", () => everywhere().find("[data-inline-editor] [role='alert']").exists() && everywhere().get("[data-inline-editor] [role='alert']").text().includes("这个值刚刚变了"));
        // 就地改的那两行这时只写原因；保存在新的预览回来以后才可用。
        await waitUntil("重新预览", () => buttonByText(everywhere(), "保存")!.attributes("disabled") === undefined);
        await buttonByText(everywhere(), "保存")!.trigger("click");
        await waitUntil("写进去了", () => again.get("[data-edit='character.性格']").text().includes("银发"));
    });

    it("别的调用方独占写入时“改”不可用，写着它申请时给的那句；它释放以后恢复", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        await waitUntil("值", () => wrapper.find("[data-value]").exists());
        state.tab = "data:character";
        await waitUntil("“改”", () => wrapper.find("[data-edit='character.性格']").exists());

        const lease = await other.canon.hold("第 3 章记账");
        if (!lease.ok) throw new Error(JSON.stringify(lease.failure));
        await waitUntil("不可用", () => wrapper.get("[data-edit='character.性格']").attributes("disabled") !== undefined);
        expect(wrapper.get("[data-edit='character.性格']").attributes("title")).toContain("第 3 章记账");
        await lease.value.release();
        await waitUntil("恢复", () => wrapper.get("[data-edit='character.性格']").attributes("disabled") === undefined);
    });

    it("填的字太长、一次调用装不下：确认条写“这次改动太大，分开改”，不能保存，填的字还在（输出 29）", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        await waitUntil("值", () => wrapper.find("[data-value]").exists());
        state.tab = "data:character";
        const bar = await startEdit(wrapper, "character.性格");
        const long = "长".repeat(Math.ceil(CANON_BUDGET_BYTES / 3) + 1);
        await bar.get("textarea").setValue(long);
        await waitUntil("太大", () => everywhere().get(EDITOR).text().includes("这次改动太大，分开改"), {timeoutMs: 10_000});
        expect(buttonByText(everywhere(), "保存")!.attributes("disabled")).toBeDefined();
        expect((everywhere().get(`${EDITOR.split(", ")[1]} textarea`).element as HTMLTextAreaElement).value).toBe(long);
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

describe("专门界面的接口（输出 51 与输入一节的 context）", () => {
    /** 一种允许实例字段的类型“徽章”，与给它交的专门界面：每个字段一个值按钮，点了就地改；另把 context 的几项写在页上。 */
    const BADGE = {label: "徽章", namespace: "badge", version: 1, instanceFields: true, fields: [{id: "图案", label: "图案", kind: "text", suggestions: ["龙", "虎"]}, {id: "介绍", label: "介绍", kind: "text"}]};
    const project: PluginDefinition = {id: "test.badge", entries: [], contributions: [{capability: CANON_COMPONENTS_POINT, id: "test.badge.card", declaration: BADGE}]};
    /** 关掉 `editors` 时不挂 `FieldEditor`（退回确认条）；`twice` 时同一路径挂两份。 */
    const editors = ref(true);
    const twice = ref(false);
    const BadgeView = defineComponent({
        props: {context: {type: Object as PropType<ComponentViewContext>, required: true}},
        setup(props) {
            const anchors = ref<Record<string, HTMLElement | null>>({});
            const result = ref("");
            return () => {
                const context = props.context;
                const Editor = context.FieldEditor!;
                return h("div", {"data-badge": ""}, [
                    ...context.declarations.map((field) => h("div", {key: field.id, class: "relative"}, [
                        h("button", {"data-edit": `badge.${field.id}`, ref: (element: unknown) => void (anchors.value[field.id] = element as HTMLElement | null), onClick: () => context.edit(field.id, {inline: true})}, String(context.fields[field.id]?.value ?? "填写")),
                        editors.value ? h(Editor, {path: field.id, anchor: anchors.value[field.id] ?? null}) : null,
                        editors.value && twice.value ? h(Editor, {key: "second", path: field.id, anchor: anchors.value[field.id] ?? null}) : null,
                    ])),
                    h("p", {"data-other": ""}, ["nbook.canon.panel", "nbook.canon.look", "nbook.canon.person", "x.missing"].map((type) => context.other!(type).status).join("|")),
                    h("p", {"data-labels": ""}, context.declarations.map((field) => field.label).join("|")),
                    h("p", {"data-editing": ""}, String(context.editing ?? "")),
                    h("p", {"data-result": ""}, result.value),
                    h("button", {"data-add-look": "", onClick: async () => void (result.value = JSON.stringify(await context.addComponent!("nbook.canon.look")))}, "加形象"),
                    h("button", {"data-add-field": "", onClick: async () => void (result.value = JSON.stringify(await context.fieldAdd!({label: "种族", kind: "text"})))}, "加种族"),
                    h("button", {"data-add-taken": "", onClick: async () => {
                        const outcome = await context.fieldAdd!({label: "图案", kind: "text"});
                        result.value = outcome.ok ? "ok" : "refused";
                    }}, "加重名"),
                    h("button", {"data-remove-field": "", onClick: async () => void (result.value = JSON.stringify(await context.fieldRemove!("种族")))}, "去掉种族"),
                    h("button", {"data-rename-field": "", onClick: async () => void (result.value = JSON.stringify(await context.fieldRename!("种族", "血统")))}, "种族改名"),
                    h("button", {"data-restore-field": "", onClick: async () => void (result.value = JSON.stringify(await context.fieldRestore!("种族")))}, "恢复种族"),
                    h("button", {"data-show-missing": "", onClick: () => context.showTab!("x.missing")}, "切到没有的分页"),
                    h("p", {"data-removed": ""}, (context.removedFields ?? []).map((field) => field.label).join("|")),
                ]);
            };
        },
    });
    const browser: PluginDefinition = {
        id: "test.badge",
        entries: [{
            id: "browser", location: "browser", activationEvents: ["onStartup"],
            contributions: [{capability: CANON_COMPONENT_VIEWS_POINT, id: "test.badge.card", declaration: {title: "徽章", uses: ["nbook.canon.panel", "nbook.canon.look", "x.missing"]}}],
            activate: () => ({contributions: {[CANON_COMPONENT_VIEWS_POINT]: {"test.badge.card": {load: () => Promise.resolve(BadgeView)}}}}),
        }],
    };

    async function badgePage() {
        editors.value = true;
        twice.value = false;
        const {other, open} = await setup([project], [browser]);
        const star = person("星瑕");
        star.init.data.badge = {type: "test.badge.card", version: 1, enabled: true, fields: {图案: "龙", 介绍: null}, declared: []};
        const id = (await publish(other.canon, [star]))[star.id]!;
        const opened = await open(id);
        opened.state.tab = "data:badge";
        await waitUntil("徽章的界面", () => opened.wrapper.find("[data-badge]").exists());
        return {...opened, other, id};
    }
    const editorOf = (path: string): Element | null => document.body.querySelector(`[data-field-editor="${path}"]`);
    const buttonByText = (wrapper: ReturnType<typeof mount>, label: string) => wrapper.findAll("button").find((button) => button.text() === label);

    it("就地改：挂着编辑器时不出确认条，在浮层里改、保存（值没改时保存不可用）；Escape 放弃；没挂编辑器时退回确认条；同一路径挂两份卸一份照旧", async () => {
        const {wrapper, state} = await badgePage();
        await wrapper.get("[data-edit='badge.图案']").trigger("click");
        await waitUntil("浮层里的编辑器", () => editorOf("badge.图案") !== null);
        expect(wrapper.find("[data-confirm-bar]").exists()).toBe(false);
        expect(wrapper.get("[data-editing]").text()).toBe("图案");
        const saveOf = (path: string) => [...editorOf(path)!.querySelectorAll("button")].find((button) => button.textContent?.trim() === "保存")!;
        // 打开时填的就是现在的值：预览回来了也没有可存的（输出 16）。
        await waitUntil("预览", () => editorOf("badge.图案")?.querySelector("[data-previewed]") != null);
        expect(saveOf("badge.图案").disabled).toBe(true);
        // 有建议值的文字：输入框加候选，值就是输入框里的字。
        const input = editorOf("badge.图案")!.querySelector<HTMLInputElement>("[data-suggest-input] input")!;
        input.value = "凤";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        await waitUntil("改了以后保存可用", () => editorOf("badge.图案")?.querySelector("[data-previewed]") != null && !saveOf("badge.图案").disabled);
        saveOf("badge.图案").click();
        await waitUntil("保存了、编辑器收起", () => wrapper.get("[data-edit='badge.图案']").text() === "凤" && editorOf("badge.图案") === null);
        expect(state.edit).toBeNull();

        await wrapper.get("[data-edit='badge.介绍']").trigger("click");
        await waitUntil("编辑器", () => editorOf("badge.介绍") !== null);
        editorOf("badge.介绍")!.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await waitUntil("放弃了", () => state.edit === null && editorOf("badge.介绍") === null);

        // 焦点不在输入框里时，落到页面上的 Escape（浮层自己的监听）也是放弃：下面组字那一段的否定断言靠它才有意义。
        await wrapper.get("[data-edit='badge.图案']").trigger("click");
        await waitUntil("编辑器", () => editorOf("badge.图案") !== null);
        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await waitUntil("页面上的 Escape 放弃了", () => state.edit === null && editorOf("badge.图案") === null);

        // 输入法组字中按 Escape 不算放弃。
        await wrapper.get("[data-edit='badge.图案']").trigger("click");
        await waitUntil("编辑器", () => editorOf("badge.图案") !== null);
        const composing = editorOf("badge.图案")!.querySelector<HTMLInputElement>("[data-suggest-input] input")!;
        composing.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
        composing.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, isComposing: true}));
        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, isComposing: true}));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(state.edit?.path).toBe("badge.图案");
        composing.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
        composing.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await waitUntil("组字结束后 Escape 放弃", () => state.edit === null);

        editors.value = false;
        await wrapper.get("[data-edit='badge.介绍']").trigger("click");
        await waitUntil("确认条", () => wrapper.find("[data-confirm-bar]").exists());
        await buttonByText(wrapper, "取消")!.trigger("click");

        editors.value = true;
        twice.value = true;
        await wrapper.get("[data-edit='badge.介绍']").trigger("click");
        await waitUntil("编辑器", () => document.body.querySelectorAll("[data-field-editor='badge.介绍']").length > 0);
        twice.value = false;
        await waitUntil("卸掉一份", () => document.body.querySelectorAll("[data-field-editor='badge.介绍']").length === 1);
        expect(wrapper.find("[data-confirm-bar]").exists()).toBe(false);
    });

    it("就地改：保存在途时 Escape 与“取消”都不算放弃；这时点了另一个值，保存回来以后那一份留着；草稿所在的字段被去掉时草稿清掉，不退回确认条", async () => {
        const {wrapper, state} = await badgePage();
        await wrapper.get("[data-edit='badge.介绍']").trigger("click");
        await waitUntil("编辑器", () => editorOf("badge.介绍") !== null);
        const input = editorOf("badge.介绍")!.querySelector("input")!;
        input.value = "一枚旧徽章";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        await waitUntil("预览", () => editorOf("badge.介绍")?.querySelector("[data-previewed]") != null);
        const buttons = () => [...editorOf("badge.介绍")!.querySelectorAll("button")];
        buttons().find((button) => button.textContent?.trim() === "保存")!.click();
        // 保存的请求已经发出（`saving` 在点下去的同一刻就是真）：这时的 Escape 与“取消”都不放弃。
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        buttons().find((button) => button.textContent?.trim() === "取消")!.click();
        expect(state.edit?.path).toBe("badge.介绍");
        // 还在保存时点了“图案”：保存回来只收起“介绍”那一份，“图案”的编辑留着。
        (wrapper.get("[data-edit='badge.图案']").element as HTMLButtonElement).click();
        expect(state.edit?.path).toBe("badge.图案");
        await waitUntil("保存了", () => wrapper.get("[data-edit='badge.介绍']").text() === "一枚旧徽章");
        await waitUntil("“介绍”的编辑器收起", () => editorOf("badge.介绍") === null);
        expect(state.edit?.path).toBe("badge.图案");
        expect(editorOf("badge.图案")).not.toBeNull();
        editorOf("badge.图案")!.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await waitUntil("放弃了“图案”", () => state.edit === null);

        await wrapper.get("[data-add-field]").trigger("click");
        await waitUntil("加上种族", () => wrapper.find("[data-edit='badge.种族']").exists());
        await wrapper.get("[data-edit='badge.种族']").trigger("click");
        await waitUntil("编辑器", () => editorOf("badge.种族") !== null);
        await wrapper.get("[data-remove-field]").trigger("click");
        await waitUntil("去掉了", () => wrapper.get("[data-removed]").text() === "种族");
        expect(state.edit).toBeNull();
        expect(wrapper.find("[data-confirm-bar]").exists()).toBe(false);
    });

    it("context：别的组只认 uses 列了的，没加过、加上以后、去掉以后，没登记的；加一项、重名被拒、改名、去掉以后列在去掉过的里、恢复；切到没有的分页什么也不做", async () => {
        const {wrapper, state, other, id} = await badgePage();
        await waitUntil("别的组", () => wrapper.get("[data-other]").text() === "present|absent|absent|unavailable");
        await wrapper.get("[data-add-look]").trigger("click");
        await waitUntil("加上形象", () => wrapper.get("[data-other]").text() === "present|present|absent|unavailable");
        const status = await other.canon.call("status", {});
        if (!status.ok) throw new Error("读不到");
        const removed = await other.canon.call("editEntries", {input: {requestId: "remove-look", by: {kind: "author"}, what: "edit", baseVersion: status.value.version, title: "去掉形象", ops: [{op: "component", entry: id, type: "nbook.canon.look", action: "remove"}]}} as never);
        expect(removed.ok).toBe(true);
        await waitUntil("去掉过形象", () => wrapper.get("[data-other]").text() === "present|removed|absent|unavailable");
        await wrapper.get("[data-show-missing]").trigger("click");
        expect(state.tab).toBe("data:badge");

        await wrapper.get("[data-add-field]").trigger("click");
        await waitUntil("加上种族", () => wrapper.findAll("[data-edit]").some((button) => button.attributes("data-edit") === "badge.种族"));
        await wrapper.get("[data-add-taken]").trigger("click");
        await waitUntil("重名被拒", () => wrapper.get("[data-result]").text() === "refused");
        await wrapper.get("[data-rename-field]").trigger("click");
        await waitUntil("改了名", () => wrapper.get("[data-labels]").text() === "图案|介绍|血统");
        await wrapper.get("[data-remove-field]").trigger("click");
        await waitUntil("去掉过的", () => wrapper.get("[data-removed]").text() === "血统");
        expect(wrapper.findAll("[data-edit]").some((button) => button.attributes("data-edit") === "badge.种族")).toBe(false);
        await wrapper.get("[data-restore-field]").trigger("click");
        await waitUntil("恢复了", () => wrapper.get("[data-labels]").text() === "图案|介绍|血统" && wrapper.get("[data-removed]").text() === "");
    });
});

describe("人物与形象两个分页（输出 49 到 52）", () => {
    const LOOK = {type: "nbook.canon.look", version: 1, enabled: true, declared: [], fields: {
        立绘: {图片: "插图/星瑕.png", 说明: "立绘"},
        外貌: null,
        服装: [{id: "i1", label: "便装", 样子: "连帽衫", 图片: null}, {id: "i2", label: "学院制服", 样子: "藏青外套", 图片: null}],
        现在穿的: "便装",
    }};

    it("短项填完立刻回车：预览还没回来也保存进去，不吞掉这一下（输出 51）", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        state.tab = "data:character";
        await waitUntil("身份", () => wrapper.find("[data-edit='character.身份']").exists());
        await wrapper.get("[data-edit='character.身份']").trigger("click");
        const editor = (): Element | null => document.body.querySelector("[data-field-editor='character.身份']");
        await waitUntil("浮层", () => editor()?.querySelector("input") !== null && editor()?.querySelector("input") !== undefined);
        const input = editor()!.querySelector<HTMLInputElement>("input")!;
        input.value = "学生";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        // 回车是下一个键盘事件（真实输入里不会和这次输入在同一段同步代码里）；离 300 毫秒的预览停顿还远。
        await nextTick();
        expect(editor()!.querySelector("[data-previewed]")).toBeNull();
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        await waitUntil("存进去、浮层收起", () => wrapper.get("[data-edit='character.身份']").text().includes("学生") && editor() === null);
        expect(state.edit).toBeNull();
    });

    it("短项回车：预览说有别的变化（多了一条待处理）时不存，停在预览上，再按一次才存；回车以后又打字，回车作废（输出 51）", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const character = star.init.data.character!;
        star.init.data.character = {...character, fields: {...character.fields, 身高: 160}, declared: [{id: "身高", label: "身高", kind: "number", unit: "厘米"}]};
        const id = (await publish(other.canon, [star]))[star.id]!;
        // 第 2 章正文写身高 160：现在对得上，改成别的数就多一条“核对点不符”。
        const checkId = `tmp:${nextId()}`;
        await publish(other.canon, [{ref: {kind: "check", id: checkId}, after: {id: checkId, at: {entry: id, path: "character.身高"}, value: 160, told: {source: "note", quote: "身高 160"}, place: {kind: "chapter", chapter: "2", key: 1}}}]);
        const {wrapper, state} = await open(id);
        state.tab = "data:character";
        const editorOf = (path: string): Element | null => document.body.querySelector(`[data-field-editor='${path}']`);
        const type = async (path: string, value: string): Promise<HTMLInputElement> => {
            await waitUntil(path, () => wrapper.find(`[data-edit='${path}']`).exists());
            if (editorOf(path) === null) await wrapper.get(`[data-edit='${path}']`).trigger("click");
            await waitUntil("浮层", () => editorOf(path)?.querySelector("input") != null);
            const input = editorOf(path)!.querySelector<HTMLInputElement>("input")!;
            input.value = value;
            input.dispatchEvent(new Event("input", {bubbles: true}));
            await nextTick();
            return input;
        };
        const enter = (input: HTMLInputElement): void => void input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));

        const height = await type("character.身高", "170");
        enter(height);
        await waitUntil("预览写出多了的待处理", () => editorOf("character.身高")?.textContent?.includes("多了 1 条待处理") === true);
        expect(wrapper.get("[data-edit='character.身高']").text()).toContain("160");
        expect(state.edit).not.toBeNull();
        // 作者看过了，再按一次回车才存。
        enter(height);
        await waitUntil("存进去、浮层收起", () => wrapper.get("[data-edit='character.身高']").text().includes("170") && editorOf("character.身高") === null);

        // 回车以后、预览回来之前又改了字：那一下回车作废，新的预览回来也不存。
        const identity = await type("character.身份", "学生");
        enter(identity);
        await type("character.身份", "学生会长");
        await waitUntil("新的预览", () => editorOf("character.身份")?.querySelector("[data-previewed]") != null);
        // 预览回来的同一刻要是发出了保存，“保存”就已经不可用（保存在途）；它可用，说明没有替作者存。
        const save = [...editorOf("character.身份")!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "保存")!;
        expect(save.disabled).toBe(false);
        expect(wrapper.get("[data-edit='character.身份']").text()).not.toContain("学生");
    });

    it("立绘读自形象：有图时点了切到形象分页；没有形象这一组时点一下就加上形象、切到形象分页并打开立绘的选图（输出 49）", async () => {
        const {other, open} = await setup();
        const withLook = person("星瑕");
        withLook.init.data.look = structuredClone(LOOK);
        const without = person("星瑾");
        const ids = await publish(other.canon, [withLook, without]);
        const first = await open(ids[withLook.id]!);
        first.state.tab = "data:character";
        await waitUntil("立绘", () => first.wrapper.find("[data-portrait='image'] [data-canon-image='插图/星瑕.png']").exists());
        await first.wrapper.get("[data-portrait]").trigger("click");
        await waitUntil("切到形象分页", () => first.state.tab === "data:look" && first.wrapper.find("[data-look-card]").exists());

        const second = await open(ids[without.id]!);
        second.state.tab = "data:character";
        await waitUntil("没有形象：添加立绘", () => second.wrapper.find("[data-portrait='absent']").exists());
        await second.wrapper.get("[data-portrait]").trigger("click");
        // 一次到位：加上形象、等它的分页出现后切过去，立绘的选图（锚在立绘上的就地改浮层）已经开着。
        await waitUntil("切到形象分页、选图开着", () => second.state.tab === "data:look" && document.body.querySelector("[data-field-editor='look.立绘']") !== null);
        expect(second.state.edit?.path).toBe("look.立绘");
    });

    it("形象分页：点某一套的“换上”，现在穿的的编辑里填好这一套、预选“剧情里变了”，保存以后在所选位置上换了，旁边写“第 2 章改过”", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        star.init.data.look = structuredClone(LOOK);
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        state.tab = "data:look";
        await waitUntil("衣柜", () => wrapper.find("[data-put-on='i2']").exists());
        expect(wrapper.get("[data-outfit='i1']").text()).toContain("穿着");
        await wrapper.get("[data-put-on='i2']").trigger("click");
        const editor = (): Element | null => document.body.querySelector("[data-field-editor='look.现在穿的']");
        await waitUntil("现在穿的的编辑", () => editor()?.querySelector("input") !== null && editor()?.querySelector("input") !== undefined);
        expect(editor()!.querySelector<HTMLInputElement>("[data-suggest-input] input")!.value).toBe("学院制服");
        expect(state.edit).toMatchObject({path: "look.现在穿的", intent: "story", value: "学院制服"});
        await waitUntil("预览", () => editor()?.querySelector("[data-previewed]") != null);
        [...editor()!.querySelectorAll("button")].find((button) => button.textContent?.trim() === "保存")!.click();
        await waitUntil("换上了", () => wrapper.get("[data-outfit='i2']").text().includes("穿着") && wrapper.get("[data-fact='现在穿的']").text().includes("第 2 章改过"));
        // “剧情里变了”在所选位置记一条变更：提示写那一章。
        expect(wrapper.get("[data-notice-where]").text()).toBe("记在第 2 章");

        // 现在穿的的建议值是衣柜里各套的名字：清空输入框、聚焦时全列出来。
        await wrapper.get("[data-edit='look.现在穿的']").trigger("click");
        await waitUntil("现在穿的的编辑", () => editor()?.querySelector("[data-suggest-input] input") != null);
        const field = editor()!.querySelector<HTMLInputElement>("[data-suggest-input] input")!;
        field.value = "";
        field.dispatchEvent(new Event("input", {bubbles: true}));
        field.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        await waitUntil("建议值", () => [...document.body.querySelectorAll("[role='option']")].map((option) => option.textContent?.trim()).join("|") === "便装|学院制服");
    });

    it("添加一项资料：点预设“种族”加上一项，是自己加的（行尾有“更多”），预设里不再列它", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        state.tab = "data:character";
        await waitUntil("人物分页", () => wrapper.find("[data-add-field]").exists());
        await wrapper.get("[data-add-field]").trigger("click");
        await waitUntil("预设", () => document.body.querySelector("[data-preset='种族']") !== null);
        (document.body.querySelector("[data-preset='种族']") as HTMLElement).click();
        await waitUntil("加上了种族", () => wrapper.find("[data-fact='种族'] [data-more='种族']").exists());
        expect(document.body.querySelector("[data-preset='种族']")).toBeNull();
    });

    it("成段的文字：编辑层是原文下方的浮层、原文留着；点编辑层外面不收起，再点原文只回到输入框，填的字都还在（切走再回来也在，输出 7、51）；按 Escape 放弃，值不变", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        state.tab = "data:character";
        await waitUntil("性格", () => wrapper.find("[data-edit='character.性格']").exists());
        const before = wrapper.get("[data-passage='性格']").text();
        const editor = (): Element | null => document.body.querySelector("[data-field-editor='character.性格']");
        await wrapper.get("[data-edit='character.性格']").trigger("click");
        await waitUntil("编辑层", () => editor()?.querySelector("textarea") != null);
        const area = editor()!.querySelector("textarea")!;
        area.value = "嘴硬心软";
        area.dispatchEvent(new Event("input", {bubbles: true}));
        // 编辑层在浮层里，不在原文那一节里：原文留着、看得到（不藏起来）。
        expect(wrapper.get("[data-passage='性格']").element.contains(editor())).toBe(false);
        expect(wrapper.get("[data-passage='性格']").text()).toBe(before);
        // 点别处（后一段的原文）不放弃，作者切到别的标签再回来时它还在。照浏览器的先后：先按下，焦点再移到点的那个按钮上
        // （在 happy-dom 里只发 pointerdown，短项的浮层也不会收起，这一条就测不出“点外面不收起”）。
        const outside = wrapper.get<HTMLElement>("[data-edit='character.说话方式']").element;
        outside.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        outside.focus();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await nextTick();
        expect(state.edit?.path).toBe("character.性格");
        expect(editor()?.querySelector("textarea")?.value).toBe("嘴硬心软");
        // 再点原文：不重开（重开会换回原文），焦点回到输入框。
        (document.activeElement as HTMLElement | null)?.blur();
        await wrapper.get("[data-edit='character.性格']").trigger("click");
        await nextTick();
        expect(editor()?.querySelector("textarea")?.value).toBe("嘴硬心软");
        expect(document.activeElement).toBe(editor()?.querySelector("textarea"));
        editor()!.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await waitUntil("放弃了", () => state.edit === null && editor() === null);
        expect(wrapper.get("[data-passage='性格']").text()).toBe(before);
    });

    it("现在的状态：点开是细节，点“改起点”时编辑浮层锚在这一行下方、细节收起，不出页面顶上的确认条", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        state.tab = "data:character";
        await waitUntil("现在的状态", () => wrapper.find("[data-condition='现在的状态']").exists());
        await wrapper.get("[data-condition='现在的状态']").trigger("click");
        await waitUntil("细节", () => wrapper.find("[data-condition-detail] [data-edit='character.现在的状态']").exists());
        await wrapper.get("[data-condition-detail] [data-edit='character.现在的状态']").trigger("click");
        await waitUntil("编辑层", () => document.body.querySelector("[data-field-editor='character.现在的状态'] textarea") !== null);
        expect(wrapper.find("[data-confirm-bar]").exists()).toBe(false);
        await waitUntil("细节收起", () => !wrapper.find("[data-condition-detail]").exists());
    });

    it("自己加的列表（Agent 能加别的种类）卡片画不了：在人物分页下面的通用字段表里，不从这一页消失", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const character = star.init.data.character!;
        star.init.data.character = {...character, declared: [{id: "随身物", label: "随身物", kind: "list", item: [{id: "说明", label: "说明", kind: "text"}]}], fields: {...character.fields, 随身物: [{id: "e1", label: "怀表", 说明: "旧的"}]}};
        const id = (await publish(other.canon, [star]))[star.id]!;
        const {wrapper, state} = await open(id);
        state.tab = "data:character";
        await waitUntil("通用字段表", () => wrapper.find("[data-character-view] [data-field-table]").exists() && wrapper.get("[data-character-view] [data-field-table]").text().includes("怀表"));
        expect(wrapper.find("[data-fact='随身物']").exists()).toBe(false);
    });
});
