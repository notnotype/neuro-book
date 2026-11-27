/**
 * “设定”视图的宿主（entries-view.ts；docs/specs/canon/author-ui.md 输出 1 到 3、5、27）接在进程内的真实世界服务上：分组、
 * 展开时才读那一层、别处发布后原地更新且展开状态保留、点了打开条目、没绑定项目、世界断开；新建条目与空状态的“新建人物”（输出 4、37）。
 */

import {rm} from "node:fs/promises";

import {mount} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {nextTick, ref} from "vue";
import type {Ref} from "vue";

import type {Entry, WriteRequest} from "@notnotype/nb-canon";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {ViewContext} from "nbook/plugins/workbench/web/contracts";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {BUILTIN_ENTRY_KINDS} from "../shared/components";
import type {CanonClient} from "../shared/contracts";
import {mergeEntryKinds} from "../shared/entry-kinds";
import {countedClient} from "../testing/counted-client";
import {canonNodeWorld} from "../testing/node-world";
import type {CanonNodeWindow, CanonNodeWorld} from "../testing/node-world";
import EntryTree from "./components/entries/EntryTree.vue";
import NewEntryDialog from "./components/entries/NewEntryDialog.vue";
import {createEntriesViewHost, entriesViewState, startNewEntry} from "./entries-view";
import type {EntriesViewState} from "./entries-view";
import {createNotices} from "./notices";
import {canonCatalogs} from "./text";
import {createCanonWorld} from "./world";
import type {CanonWorld} from "./world";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});

let tmp: string;
let venue: CanonNodeWorld | null = null;
const cleanups: Array<() => void> = [];

beforeEach(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "entries-view");
});

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    await venue?.close();
    venue = null;
    await rm(tmp, {recursive: true, force: true});
    document.body.innerHTML = "";
});

let sequence = 0;
function person(name: string, extra: Partial<Entry> = {}): Entry {
    return {id: `tmp:${String(++sequence)}`, type: "nbook.canon.person", parent: null, folder: "人物", order: sequence, init: {name, aliases: [], summary: "", text: [], data: {character: {type: "nbook.canon.person", version: 1, enabled: true, fields: {外观: null, 状态: null, 态度: null}}}}, ...extra};
}

async function publish(canon: CanonClient, entries: Entry[]): Promise<Record<string, string>> {
    const status = await canon.call("status", {});
    if (!status.ok) throw new Error(JSON.stringify(status.failure));
    const request: WriteRequest = {requestId: `req-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: "写入", baseVersion: status.value.version, puts: entries.map((entry) => ({ref: {kind: "entry", id: entry.id}, after: entry}))};
    const result = await canon.publish(request);
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return result.value.ids;
}

async function setup(kinds = () => mergeEntryKinds(BUILTIN_ENTRY_KINDS)): Promise<{world: CanonWorld; other: CanonNodeWindow; state: EntriesViewState; opened: string[]; parents: () => Array<string | null>; view: (visible?: Ref<boolean>) => ReturnType<typeof mount>}> {
    venue = await canonNodeWorld(tmp);
    const mine = await venue.window("mine");
    const other = await venue.window("other");
    const {client, calls} = countedClient(mine.canon);
    /** `tree` 读取各读了哪个父条目。 */
    const parents = (): Array<string | null> => calls.filter((call) => call.method === "tree").map((call) => (call.input as {parent: string | null}).parent);
    const world = createCanonWorld(client);
    cleanups.push(() => world.dispose());
    const state = entriesViewState();
    const opened: string[] = [];
    const notices = createNotices();
    const host = createEntriesViewHost(EntryTree, {world, state, open: (id) => opened.push(id), create: {dialog: NewEntryDialog, call: client.call, notices, kinds}});
    return {
        world, other, state, opened, parents,
        // 给了 `visible` 时按工作台的做法给一份 `context`；不给时宿主按可见算。
        view: (visible) => {
            const context: ViewContext | undefined = visible === undefined ? undefined : {id: "nbook.canon.entries", generation: 1, visible, location: ref("sidebar")};
            const wrapper = mount(host, {props: context === undefined ? {} : {context}, global: {provide: provideText(port)}, attachTo: document.body});
            cleanups.push(() => wrapper.unmount());
            return wrapper;
        },
    };
}

const rowTexts = (wrapper: ReturnType<typeof mount>): string[] => wrapper.findAll("[role='treeitem']").map((row) => row.text());

describe("设定视图", () => {
    it("根下按分组列出；有子条目的展开时才读那一层；别处发布以后原地更新，展开状态还在", async () => {
        const {other, state, parents, view} = await setup();
        const star = person("星瑕");
        const ids = await publish(other.canon, [star, person("学院", {folder: "地点"})]);
        await publish(other.canon, [person("哥哥", {parent: ids[star.id]!})]);

        const wrapper = view();
        await waitUntil("根这一层", () => rowTexts(wrapper).join("|") === "人物|地点");
        state.expanded.value = ["folder:人物", "folder:地点"];
        await waitUntil("分组展开", () => rowTexts(wrapper).join("|") === "人物|星瑕|地点|学院");
        expect(parents()).not.toContain(ids[star.id]);

        state.expanded.value = [...state.expanded.value, ids[star.id]!];
        await waitUntil("读到星瑕下面那一层", () => rowTexts(wrapper).join("|") === "人物|星瑕|哥哥|地点|学院");
        expect(parents()).toContain(ids[star.id]);

        await publish(other.canon, [person("白灵")]);
        await waitUntil("新条目出现在人物下", () => rowTexts(wrapper).join("|") === "人物|星瑕|哥哥|白灵|地点|学院");
        expect(state.expanded.value).toContain(ids[star.id]);
    });

    it("视图停放时别处发布不重读；回到前台先显示留着的，同时重读（输出 26）", async () => {
        const {world, other, state, parents, view} = await setup();
        await publish(other.canon, [person("星瑕")]);
        const visible = ref(true);
        const wrapper = view(visible);
        await waitUntil("根这一层", () => rowTexts(wrapper).join("|") === "人物");
        state.expanded.value = ["folder:人物"];
        await waitUntil("分组展开", () => rowTexts(wrapper).join("|") === "人物|星瑕");

        visible.value = false;
        await nextTick();
        const read = parents().length;
        await publish(other.canon, [person("白灵")]);
        const version = (await other.canon.call("status", {}));
        if (!version.ok) throw new Error(JSON.stringify(version.failure));
        // 读取层收到这次发布、重读完状态时，要重读的读取已经和状态一起发出去了。
        await waitUntil("读取层知道了新版本", () => world.status.value.data?.version === version.value.version);
        expect(parents()).toHaveLength(read);

        visible.value = true;
        await nextTick();
        expect(rowTexts(wrapper).join("|")).toBe("人物|星瑕");
        await waitUntil("回到前台以后重读", () => rowTexts(wrapper).join("|") === "人物|星瑕|白灵");
    });

    it("点条目打开它的条目页，并成为选中项", async () => {
        const {other, state, opened, view} = await setup();
        const star = person("星瑕");
        const ids = await publish(other.canon, [star]);
        state.expanded.value = ["folder:人物"];
        const wrapper = view();
        await waitUntil("条目出现", () => rowTexts(wrapper).includes("星瑕"));
        await wrapper.get(`[data-tree-id="${ids[star.id]!}"]`).trigger("click");
        expect(opened).toEqual([ids[star.id]]);
        await waitUntil("选中", () => wrapper.get(`[data-tree-id="${ids[star.id]!}"]`).attributes("aria-selected") === "true");
    });

    it("项目实例停止：树上面有“世界已断开”与“重试”，树留着", async () => {
        const {other, state, view} = await setup();
        await publish(other.canon, [person("星瑕")]);
        state.expanded.value = ["folder:人物"];
        const wrapper = view();
        await waitUntil("条目出现", () => rowTexts(wrapper).includes("星瑕"));
        await venue!.endProject();
        await waitUntil("横幅", () => wrapper.text().includes("世界已断开"), {timeoutMs: 10_000});
        expect(wrapper.find("button").text()).toBe("重试");
        expect(rowTexts(wrapper)).toContain("星瑕");
    });

    it("窗口没有绑定项目：只有一句“打开作品后可用”", () => {
        const host = createEntriesViewHost(EntryTree, {world: null, state: entriesViewState(), open: () => undefined});
        const wrapper = mount(host, {global: {provide: provideText(port)}});
        cleanups.push(() => wrapper.unmount());
        expect(wrapper.text()).toBe("打开作品后可用");
    });

    it("新建条目：在“星瑕”下面建一个启用面板的物品，树里出现它、打开它的条目页；名字为空时“新建”不可用", async () => {
        const {other, state, opened, view} = await setup();
        const star = person("星瑕");
        const ids = await publish(other.canon, [star]);
        const starId = ids[star.id]!;
        state.expanded.value = ["folder:人物"];
        const wrapper = view();
        await waitUntil("条目出现", () => rowTexts(wrapper).includes("星瑕"));

        startNewEntry(state, starId);
        await waitUntil("对话框", () => document.body.querySelector("[data-new-entry]") !== null);
        const dialog = (): Element => document.body.querySelector("[role='dialog']")!;
        const create = (): HTMLButtonElement => [...dialog().querySelectorAll("button")].find((button) => button.textContent?.trim() === "新建")!;
        expect(create().disabled).toBe(true);
        const [name, kind] = [...dialog().querySelectorAll("input")] as HTMLInputElement[];
        const type = (input: HTMLInputElement, value: string): void => {
            input.value = value;
            input.dispatchEvent(new Event("input", {bubbles: true}));
        };
        // 一个控件一次：对话框是受控的，每次改动以宿主写回的草稿为准，同一拍里连改两个控件后一个会盖掉前一个。
        type(name!, "魔杖");
        await waitUntil("名字写进草稿", () => state.creating.value?.name === "魔杖");
        type(kind!, "物品");
        await waitUntil("登记的类型", () => dialog().textContent?.includes("数值") ?? false);
        dialog().querySelector<HTMLElement>("[data-checklist-item='nbook.canon.panel']")!.click();
        await waitUntil("“新建”可用", () => !create().disabled);
        create().click();

        await waitUntil("打开了它的条目页", () => opened.length === 1);
        await waitUntil("树里出现在星瑕下面", () => rowTexts(wrapper).join("|") === "人物|星瑕|魔杖");
        expect(state.creating.value).toBeNull();
        const stored = await other.canon.call("object", {ref: {kind: "entry", id: opened[0]!}});
        if (!stored.ok) throw new Error(JSON.stringify(stored.failure));
        expect(stored.value.object).toMatchObject({type: "物品", folder: "物品", parent: starId, init: {name: "魔杖", data: {panel: {type: "nbook.canon.panel", enabled: true}}}});
    });

    it("空作品里点“新建人物”：种类是人物，勾上人物与形象两组；新建以后条目上启用的是这两组", async () => {
        const {opened, view, other} = await setup();
        const wrapper = view();
        await waitUntil("空状态", () => wrapper.find("[data-entries-empty]").exists());
        const person = wrapper.get("[data-entries-empty]").findAll("button").find((button) => button.text() === "新建人物")!;
        await person.trigger("click");
        const dialog = (): Element => document.body.querySelector("[role='dialog']")!;
        // 登记的类型是对话框开了才读的：读到以后勾选补上人物与形象。
        const checked = (): string[] => [...dialog().querySelectorAll<HTMLElement>("[role='option'][aria-selected='true']")].map((option) => option.textContent?.trim() ?? "");
        await waitUntil("人物与形象勾上", () => document.body.querySelector("[data-new-entry]") !== null && checked().sort().join("|") === ["人物", "形象"].sort().join("|"));
        const [name, kind] = [...dialog().querySelectorAll("input")] as HTMLInputElement[];
        expect(kind!.value).toBe("人物");
        // 种类的候选：登记的四个在前。
        expect([...dialog().querySelectorAll("[data-new-entry-kinds] button")].map((button) => button.textContent?.trim())).toEqual(["人物", "组织", "地点", "物品"]);
        name!.value = "星瑾";
        name!.dispatchEvent(new Event("input", {bubbles: true}));
        const create = (): HTMLButtonElement => [...dialog().querySelectorAll("button")].find((button) => button.textContent?.trim() === "新建")!;
        await waitUntil("“新建”可用", () => !create().disabled);
        create().click();
        await waitUntil("打开了它的条目页", () => opened.length === 1);
        const stored = await other.canon.call("object", {ref: {kind: "entry", id: opened[0]!}});
        if (!stored.ok) throw new Error(JSON.stringify(stored.failure));
        const entry = stored.value.object as Entry;
        expect(entry).toMatchObject({type: "人物", folder: "人物", init: {name: "星瑾"}});
        expect(Object.keys(entry.init.data)).toEqual(["character", "look"]);
    });

    it("“人物”这个种类没登记时，空状态里没有“新建人物”", async () => {
        const {view} = await setup(() => mergeEntryKinds(BUILTIN_ENTRY_KINDS.filter((item) => item.declaration.kind !== "人物")));
        const wrapper = view();
        await waitUntil("空状态", () => wrapper.find("[data-entries-empty]").exists());
        expect(wrapper.get("[data-entries-empty]").findAll("button").map((button) => button.text())).toEqual(["新建条目"]);
    });

    it("种类的候选：登记的种类排在作品里用过的词前面，同一个词只列一次", async () => {
        const {other, state, view} = await setup();
        await publish(other.canon, [person("魔杖", {type: "法器", folder: "法器"}), person("短剑", {type: "物品", folder: "物品"})]);
        state.expanded.value = ["folder:法器", "folder:物品"];
        const wrapper = view();
        await waitUntil("条目出现", () => rowTexts(wrapper).includes("魔杖") && rowTexts(wrapper).includes("短剑"));
        startNewEntry(state, null);
        await waitUntil("对话框", () => document.body.querySelector("[data-new-entry-kinds]") !== null);
        expect([...document.body.querySelectorAll("[data-new-entry-kinds] button")].map((button) => button.textContent?.trim())).toEqual(["人物", "组织", "地点", "物品", "法器"]);
    });
});
