/**
 * 一棵树的布局 store（docs/specs/ui/workbench-layout.md“状态与转换”“副作用与数据”，验收 5、11、12、13）：真实内核、真实 `nbook.storage` 与 SQLite。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {Database} from "bun:sqlite";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {effect} from "@vue/reactivity";
import type {DeepReadonly} from "@vue/reactivity";
import {Type} from "typebox";

import {GRID_SNAPSHOT_VERSION} from "@notnotype/nb-layout";
import {barRef, insertTab, isPanelShown, isSectionCollapsed, moveTabToEdge, moveTabToStrip, panelRef, regionNodeOf, removeTab, setContainerRail, setSiblingShares, validateLayoutDoc} from "@notnotype/nb-workbench-layout";
import type {LayoutDoc, LayoutResult, PanelName, TabRef} from "@notnotype/nb-workbench-layout";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld} from "nbook/plugins/storage/testing/world";
import {defineRecord} from "nbook/shared/storage";
import type {RecordDefinition, StorageService} from "nbook/shared/storage";

import {BUSY_LAYOUT_CATALOG, openLayoutDoc} from "../testing/layout-doc";
import {regionContainers, regionSections, viewSection} from "./containers";
import type {ContainerCatalog} from "./containers";
import {PANEL_HEAD_HEIGHT} from "./layout-constraints";
import type {ViewCatalog} from "../views/registry";
import {createLayoutPolicy} from "./layout-constraints";
import type {LayoutDocStore} from "./layout-doc-store";
import {fitsSkeleton, INITIAL_EDITOR_PANEL} from "./default-tree";
import {LAYOUT_DOC_RECORDS, LAYOUT_TEMPLATE_RECORD} from "./records";

const PLUGIN = "nbook.workbench";
const USER = LAYOUT_DOC_RECORDS.user;
const PROJECT = LAYOUT_DOC_RECORDS.project;
const POLICY = createLayoutPolicy();
const editorTab = (tabId: string): TabRef => ({kind: "tab", type: "nbook.editor", tabId});
/** 旧外壳留在用户存储里的记录：产品代码已不再定义它，这里按原来的键与分区造一份，验证新 store 不碰它。 */
const LEGACY_CUSTOMIZATIONS = defineRecord({key: "views-customizations", scope: "user", locality: "local", version: 1, schema: Type.Object({panel: Type.Object({position: Type.String()})})});

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-workbench", "layout-doc-store");
});

afterEach(async () => {
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function world(): Promise<StorageWorld> {
    counter += 1;
    const created = await storageWorld(join(tmp, `case-${String(counter)}`), []);
    worlds.push(created);
    return created;
}

async function read<T>(storage: StorageService, record: RecordDefinition<T>): Promise<unknown> {
    const opened = await storage.open(record);
    if (!opened.ok) throw new Error(`${opened.code} ${opened.detail}`);
    const snapshot = await opened.handle.read();
    return snapshot.status === "ok" ? snapshot.value : snapshot.status;
}

async function savedDoc(storage: StorageService, record: RecordDefinition<{doc: unknown}>): Promise<LayoutDoc> {
    const value = await read(storage, record) as {doc: unknown};
    const checked = validateLayoutDoc(value.doc);
    if (!checked.ok) throw new Error(checked.message);
    return checked.doc;
}

const settled = (store: LayoutDocStore) => waitUntil("保存完成", () => store.state.field.queue === 0);
/** 区域在呈现树里的节点：区域只显示一节、顶上又没有入口条时那一列塌成那一节的叶，id 不是文档里区域节点的 id，按锚找。 */
const presentedRegion = (store: LayoutDocStore, region: PanelName): string => [...store.actions.presentation().regionAnchors].find(([, anchor]) => anchor === region)?.[0] ?? "";
const hideAux = (store: LayoutDocStore) => store.actions.setPartHidden("auxiliarybar", true);
/** 视图所在的分节（面板 id）。 */
function sectionOf(store: LayoutDocStore, viewId: string): string {
    const section = viewSection(store.actions.document(), viewId);
    if (section === null) throw new Error(`${viewId} 不在区域里`);
    return section.panel;
}
/** 区域里出现的容器与各自的视图，按入口顺序。 */
const containersIn = (doc: DeepReadonly<LayoutDoc>, region: PanelName): ReadonlyArray<readonly [string, ReadonlyArray<string>]> => regionContainers(doc as LayoutDoc, region).map((container) => [container.id, container.views] as const);

describe("默认与记录", () => {
    it("没有记录：默认树，有视图的区域显示，视图各在自己的容器里，不写盘；校验通过", async () => {
        const w = await world();
        const {store, storage} = await openLayoutDoc(w, "w", "c");
        const doc = store.state.doc;
        expect(validateLayoutDoc(doc).ok).toBe(true);
        expect(doc.panels.sidebar?.hidden).toBeUndefined();
        expect(doc.panels.sidebar?.tabs).toEqual([]);
        expect(containersIn(doc, "sidebar")).toEqual([["view:test.side", ["test.side"]]]);
        expect(await read(storage, USER)).toBe("missing");
        expect(store.state.problems).toEqual([]);
    });

    it("没有容器的区域隐藏：第一次生成时才显示有视图的，之后新视图不把隐藏的区域打开（输出 4）", async () => {
        const w = await world();
        const {store} = await openLayoutDoc(w, "w", "c", false, new Map());
        expect(store.state.doc.panels.auxiliarybar?.hidden).toBe(true);
        // 改一下布局：从这时起文档已经有了。
        store.actions.setPartHidden("statusbar", true);
        const later: ViewCatalog = new Map([["test.aux", {title: {"zh-CN": "大纲", "en-US": "Outline"}, icon: "i", location: "auxiliarybar", layout: "scroll"}]]);
        store.actions.acceptViewCatalog(later);
        expect(containersIn(store.state.doc, "auxiliarybar")).toEqual([["view:test.aux", ["test.aux"]]]);
        expect(store.state.doc.panels.auxiliarybar).toMatchObject({hidden: true, activeContainer: "view:test.aux"});
    });

    it("没有记录时视图目录晚到：仍按第一次生成放，有视图的区域显示", async () => {
        const w = await world();
        const {store} = await openLayoutDoc(w, "w", "c", false, new Map());
        expect(store.state.doc.panels.sidebar?.hidden).toBe(true);
        store.actions.acceptViewCatalog(BUSY_LAYOUT_CATALOG);
        expect(store.state.doc.panels.sidebar?.hidden).toBeUndefined();
        expect(containersIn(store.state.doc, "sidebar")).toEqual([["view:test.side", ["test.side"]]]);
    });

    it("写了就能恢复；声明消失的视图留在文档里", async () => {
        const w = await world();
        const first = await openLayoutDoc(w, "a", "c");
        hideAux(first.store);
        await first.store.actions.save();
        await settled(first.store);
        const second = await openLayoutDoc(w, "b", "c", false, new Map());
        expect(second.store.state.doc.panels.auxiliarybar?.hidden).toBe(true);
        expect(containersIn(second.store.state.doc, "auxiliarybar")).toEqual([["view:test.aux", ["test.aux"]]]);
    });

    it("旧记录不读、不写、不删", async () => {
        const w = await world();
        const {store, storage} = await openLayoutDoc(w, "w", "c");
        const opened = await storage.open(LEGACY_CUSTOMIZATIONS);
        if (!opened.ok) throw new Error(opened.detail);
        const original = {panel: {position: "top"}};
        await opened.handle.save(original, {expect: null});
        hideAux(store);
        await store.actions.save();
        await settled(store);
        expect(store.state.doc.panels.panel?.hidden).toBeUndefined();
        expect(await read(storage, LEGACY_CUSTOMIZATIONS)).toEqual(original);
    });
});

describe("分区与动态标签", () => {
    it("未绑定项目的窗口：存盘去掉动态标签，显示还在；刷新后没有坏标签", async () => {
        const w = await world();
        const {store, storage} = await openLayoutDoc(w, "a", "c");
        store.actions.apply((doc) => insertTab(doc, {panel: INITIAL_EDITOR_PANEL, tab: editorTab("t1")}), {flush: true});
        await store.actions.save();
        await settled(store);
        expect(store.state.doc.panels[INITIAL_EDITOR_PANEL]?.tabs).toEqual([editorTab("t1")]);
        const saved = await savedDoc(storage, USER);
        expect(saved.panels[INITIAL_EDITOR_PANEL]?.tabs).toEqual([]);
        const again = await openLayoutDoc(w, "b", "c");
        expect(again.store.state.doc.panels[INITIAL_EDITOR_PANEL]?.tabs).toEqual([]);
    });

    it("绑定项目的窗口：记录在项目分区，动态标签留着；模板去掉动态标签", async () => {
        const w = await world();
        await w.project(1, []);
        const {store, storage} = await openLayoutDoc(w, "a", "c", true);
        store.actions.apply((doc) => insertTab(doc, {panel: INITIAL_EDITOR_PANEL, tab: editorTab("t1")}), {flush: true});
        await store.actions.save();
        await settled(store);
        expect((await savedDoc(storage, PROJECT)).panels[INITIAL_EDITOR_PANEL]?.tabs).toEqual([editorTab("t1")]);
        expect(await read(storage, USER)).toBe("missing");
        await waitUntil("模板写好", async () => (await read(storage, LAYOUT_TEMPLATE_RECORD)) !== "missing");
        expect((await savedDoc(storage, LAYOUT_TEMPLATE_RECORD)).panels[INITIAL_EDITOR_PANEL]?.tabs).toEqual([]);
    });

    it("新的布局记录取模板", async () => {
        const w = await world();
        await w.project(1, []);
        const first = await openLayoutDoc(w, "a", "c");
        hideAux(first.store);
        await first.store.actions.save();
        await waitUntil("模板写好", async () => (await read(first.storage, LAYOUT_TEMPLATE_RECORD)) !== "missing");
        const inProject = await openLayoutDoc(w, "b", "c", true);
        expect(await read(inProject.storage, PROJECT)).toBe("missing");
        expect(inProject.store.state.doc.panels.auxiliarybar?.hidden).toBe(true);
    });
});

describe("损坏与失败", () => {
    it("损坏、版本不支持：回落默认并诊断，原件不覆盖", async () => {
        for (const [column, value, code] of [["value", "{坏的", "corrupt"], ["version", 2, "unsupported-version"]] as const) {
            const w = await world();
            const first = await openLayoutDoc(w, "a", "c");
            hideAux(first.store);
            await first.store.actions.save();
            await settled(first.store);
            const db = new Database(w.userPath);
            db.query(`UPDATE records SET ${column} = ?1 WHERE owner = ?2 AND key = 'workbench.layout'`).run(value, PLUGIN);
            db.close();
            const second = await openLayoutDoc(w, "b", "c");
            expect(second.store.state.problems).toEqual([{kind: "unread", code}]);
            expect(second.store.state.doc.panels.auxiliarybar?.hidden).toBeUndefined();
            second.store.actions.setPartHidden("panel", true);
            await second.store.actions.save();
            expect(await read(second.storage, USER)).toBe(code);
        }
    });

    it("记录能解析但文档通不过校验：和损坏一样", async () => {
        const w = await world();
        const first = await openLayoutDoc(w, "a", "c");
        const opened = await first.storage.open(USER);
        if (!opened.ok) throw new Error(opened.detail);
        await opened.handle.save({doc: {version: 1, tree: "坏的"}}, {expect: null});
        const second = await openLayoutDoc(w, "b", "c");
        // 状态栏按码显示本地化的“损坏”，校验的码只在 detail 里（进诊断日志）。
        expect(second.store.state.problems).toEqual([{kind: "unread", code: "corrupt", detail: expect.stringMatching(/^invalid: /u)}]);
        expect(validateLayoutDoc(second.store.state.doc).ok).toBe(true);
        second.store.actions.setPartHidden("panel", true);
        await second.store.actions.save();
        expect(await read(second.storage, USER)).toEqual({doc: {version: 1, tree: "坏的"}});
    });

    /** 合法但不合骨架的文档：面板跑到了编辑组旁边（片 7c 之前能拖出来）。 */
    function outsideSkeleton(doc: LayoutDoc): LayoutDoc {
        const moved = moveTabToEdge(doc, {tab: "view:test.panel", target: {kind: "split", panel: "g0", edge: "right"}}, {...POLICY, accepts: () => true});
        if (!moved.ok) throw new Error(moved.message);
        return moved.doc;
    }

    it("记录合法但不合骨架：默认树，不算读不了，下次保存覆盖它，外壳根有诊断（验收 20）", async () => {
        const w = await world();
        const first = await openLayoutDoc(w, "a", "c");
        const shape = outsideSkeleton(JSON.parse(JSON.stringify(first.store.actions.document())) as LayoutDoc);
        const opened = await first.storage.open(USER);
        if (!opened.ok) throw new Error(opened.detail);
        await opened.handle.save({doc: shape}, {expect: null});
        const second = await openLayoutDoc(w, "b", "c");
        expect(second.store.state.problems).toEqual([]);
        expect(second.store.state.outsideSkeleton).toBe(true);
        expect(fitsSkeleton(second.store.actions.document())).toBe(true);
        second.store.actions.setPartHidden("panel", true);
        await second.store.actions.save();
        const saved = await savedDoc(second.storage, USER);
        expect(fitsSkeleton(saved)).toBe(true);
        expect(second.store.state.outsideSkeleton).toBe(false);
    });

    /**
     * 有容器之前存的记录：三片具名面板各装着视图（右栏当时隐藏着），编辑组里开着 `tabs`。位置合骨架，只是不合容器的规则。
     */
    function beforeContainers(tabs: ReadonlyArray<TabRef>, active: string | null): LayoutDoc {
        const size = {width: 100, height: 100};
        const leaf = (id: string) => ({kind: "leaf" as const, id, ref: panelRef(id), size});
        const named = (name: PanelName, viewId: string, hidden = false) => ({role: "tool" as const, name, tabs: [{kind: "view" as const, viewId}], active: `view:${viewId}`, ...(hidden ? {hidden} : {})});
        return {
            version: 1,
            floats: [],
            hiddenBars: [],
            currentEditor: INITIAL_EDITOR_PANEL,
            tree: {version: GRID_SNAPSHOT_VERSION, root: {kind: "branch", id: "root", orientation: "vertical", size, children: [
                {kind: "branch", id: "body", orientation: "horizontal", size, children: [
                    {kind: "leaf", id: "activitybar", ref: barRef("activitybar"), size},
                    leaf("sidebar"),
                    {kind: "branch", id: "center", orientation: "vertical", size, children: [leaf(INITIAL_EDITOR_PANEL), leaf("panel")]},
                    leaf("auxiliarybar"),
                ]},
                {kind: "leaf", id: "statusbar", ref: barRef("statusbar"), size},
            ]}},
            panels: {
                sidebar: named("sidebar", "test.side"),
                auxiliarybar: named("auxiliarybar", "test.aux", true),
                panel: named("panel", "test.panel"),
                [INITIAL_EDITOR_PANEL]: {role: "editor", tabs, active},
            },
        };
    }

    it("有容器之前存的记录：默认布局，开着的编辑器标签带进编辑组，不算读不了；改一下布局保存成功，刷新后是改过的（验收 30）", async () => {
        const w = await world();
        await w.project(1, []);
        const first = await openLayoutDoc(w, "a", "c", true);
        const stored = beforeContainers([editorTab("t1"), editorTab("t2")], "tab:t2");
        expect(validateLayoutDoc(stored).ok).toBe(true);
        const opened = await first.storage.open(PROJECT);
        if (!opened.ok) throw new Error(opened.detail);
        await opened.handle.save({doc: stored}, {expect: null});

        const second = await openLayoutDoc(w, "b", "c", true);
        expect(second.store.state.problems).toEqual([]);
        expect(second.store.state.outsideSkeleton).toBe(true);
        const doc = second.store.actions.document();
        expect(fitsSkeleton(doc)).toBe(true);
        expect(doc.panels[INITIAL_EDITOR_PANEL]).toMatchObject({tabs: [editorTab("t1"), editorTab("t2")], active: "tab:t2"});
        // 默认布局：视图各在自己的容器里，记录里隐藏着的右栏不跟过来。
        expect(containersIn(doc, "sidebar")).toEqual([["view:test.side", ["test.side"]]]);
        expect(doc.panels.auxiliarybar?.hidden).toBeUndefined();

        second.store.actions.setPartHidden("panel", true);
        await second.store.actions.save();
        await settled(second.store);
        expect(second.store.state.problems).toEqual([]);
        expect(second.store.state.outsideSkeleton).toBe(false);
        const saved = await savedDoc(second.storage, PROJECT);
        expect(fitsSkeleton(saved)).toBe(true);
        expect(saved.panels[INITIAL_EDITOR_PANEL]?.tabs).toEqual([editorTab("t1"), editorTab("t2")]);

        const third = await openLayoutDoc(w, "d", "c", true);
        expect(third.store.state.outsideSkeleton).toBe(false);
        expect(third.store.state.doc.panels.panel?.hidden).toBe(true);
        expect(third.store.state.doc.panels[INITIAL_EDITOR_PANEL]?.tabs).toEqual([editorTab("t1"), editorTab("t2")]);
    });

    it("有容器之前存的记录、视图目录在读完之后才交进来：还是默认布局，有视图的区域显示", async () => {
        const w = await world();
        const first = await openLayoutDoc(w, "a", "c");
        const opened = await first.storage.open(USER);
        if (!opened.ok) throw new Error(opened.detail);
        await opened.handle.save({doc: beforeContainers([], null)}, {expect: null});
        const second = await openLayoutDoc(w, "b", "c", false, new Map());
        expect(second.store.state.outsideSkeleton).toBe(true);
        second.store.actions.acceptViewCatalog(BUSY_LAYOUT_CATALOG);
        expect(second.store.state.doc.panels.sidebar?.hidden).toBeUndefined();
        expect(containersIn(second.store.state.doc, "panel")).toEqual([["view:test.panel", ["test.panel"]]]);
        expect(second.store.state.doc.panels.panel?.hidden).toBeUndefined();
    });

    it("没有记录、模板是有容器之前存的：当作没有模板", async () => {
        const w = await world();
        const first = await openLayoutDoc(w, "a", "c");
        const opened = await first.storage.open(LAYOUT_TEMPLATE_RECORD);
        if (!opened.ok) throw new Error(opened.detail);
        await opened.handle.save({doc: beforeContainers([], null)}, {expect: null});
        const second = await openLayoutDoc(w, "b", "c");
        expect(fitsSkeleton(second.store.actions.document())).toBe(true);
        expect(second.store.state.doc.panels.auxiliarybar?.hidden).toBeUndefined();
        expect(second.store.state.outsideSkeleton).toBe(false);
        expect(second.store.state.problems).toEqual([]);
    });

    it("没有记录、模板不合骨架：默认树，当作没有模板（验收 20）", async () => {
        const w = await world();
        const first = await openLayoutDoc(w, "a", "c");
        const shape = outsideSkeleton(JSON.parse(JSON.stringify(first.store.actions.document())) as LayoutDoc);
        const opened = await first.storage.open(LAYOUT_TEMPLATE_RECORD);
        if (!opened.ok) throw new Error(opened.detail);
        await opened.handle.save({doc: shape}, {expect: null});
        const second = await openLayoutDoc(w, "b", "c");
        expect(fitsSkeleton(second.store.actions.document())).toBe(true);
        expect(second.store.state.problems).toEqual([]);
    });

    it("写入的出口守骨架：哪个入口传来不合骨架的结果都被拒绝，文档不变", async () => {
        const w = await world();
        const {store} = await openLayoutDoc(w, "a", "c");
        const before = store.actions.document();
        const result = store.actions.apply((doc) => ({ok: true, doc: outsideSkeleton(doc)}));
        expect(result).toMatchObject({ok: false, code: "rejected"});
        expect(store.actions.document()).toBe(before);
    });

    it("移进一个容器：成为它最后一个分节，从前一个分节取一半；目标区域隐藏着就显示，切到这个容器；来源区域空了隐藏（输出 23、43）", async () => {
        const w = await world();
        const {store} = await openLayoutDoc(w, "a", "c");
        hideAux(store);
        const aux = sectionOf(store, "test.aux");
        const before = sizeIn(store.actions.document(), aux).height;
        expect(store.actions.moveView("test.side", {container: "view:test.aux"}).ok).toBe(true);
        const doc = store.actions.document();
        expect(containersIn(doc, "auxiliarybar")).toEqual([["view:test.aux", ["test.aux", "test.side"]]]);
        expect(doc.panels.auxiliarybar).toMatchObject({activeContainer: "view:test.aux"});
        expect(doc.panels.auxiliarybar?.hidden).toBeUndefined();
        expect(sizeIn(doc, aux).height + sizeIn(doc, sectionOf(store, "test.side")).height).toBeCloseTo(before, 5);
        expect(doc.panels.sidebar).toMatchObject({hidden: true, activeContainer: null});
        expect(fitsSkeleton(doc)).toBe(true);
    });

    it("移进区域里不是当前容器的那个容器：区域切过去，隐藏着、拖到零时同一次写入展开（输出 23）", async () => {
        const w = await world();
        const {store} = await openLayoutDoc(w, "a", "c");
        const side = sectionOf(store, "test.side");
        expect(store.actions.apply((doc) => moveTabToEdge(doc, {tab: "view:test.aux", target: {kind: "split", panel: side, edge: "bottom"}, container: "view:test.aux"}, POLICY)).ok).toBe(true);
        expect(store.actions.document().panels.sidebar?.activeContainer).toBe("view:test.side");
        store.actions.setCollapsed("sidebar", true);
        store.actions.setPartHidden("sidebar", true);
        expect(store.actions.document().panels.sidebar).toMatchObject({hidden: true, collapsed: true});
        expect(store.actions.moveView("test.panel", {container: "view:test.aux"}).ok).toBe(true);
        const doc = store.actions.document();
        expect(containersIn(doc, "sidebar")).toEqual([["view:test.side", ["test.side"]], ["view:test.aux", ["test.aux", "test.panel"]]]);
        expect(doc.panels.sidebar).toMatchObject({activeContainer: "view:test.aux"});
        expect(doc.panels.sidebar?.hidden).toBeUndefined();
        expect(doc.panels.sidebar?.collapsed).toBeUndefined();
        expect(fitsSkeleton(doc)).toBe(true);
    });

    it("新容器：在那个区域新建一个只含它的用户容器，入口排在最后并切过去；区域里原来一个容器都没有也一样，再移走时区域隐藏，别的区域尺寸不变（输出 23、43；验收 31）", async () => {
        const w = await world();
        const {store, storage} = await openLayoutDoc(w, "a", "c", false, new Map([...BUSY_LAYOUT_CATALOG].filter(([id]) => id !== "test.panel")));
        expect(store.actions.document().panels.panel).toMatchObject({hidden: true, activeContainer: null});
        const sizes = () => [regionSize(store.actions.document(), "sidebar"), regionSize(store.actions.document(), "auxiliarybar")];
        const before = sizes();

        expect(store.actions.moveView("test.aux", {newContainerIn: "panel"}).ok).toBe(true);
        const created = viewSection(store.actions.document(), "test.aux")?.container ?? "";
        expect(created).toMatch(/^custom:/u);
        expect(containersIn(store.actions.document(), "panel")).toEqual([[created, ["test.aux"]]]);
        expect(store.actions.document().panels.panel).toMatchObject({activeContainer: created, entries: [created]});
        expect(store.actions.document().panels.panel?.hidden).toBeUndefined();

        // 移回声明的容器（“重置位置”就是这一步）：用户容器空了不再存在，底部面板一个容器都没有，隐藏；保存成功。
        expect(store.actions.moveView("test.aux", {container: "view:test.aux"}).ok).toBe(true);
        expect(store.actions.document().panels.panel).toMatchObject({hidden: true, activeContainer: null, entries: []});
        expect(containersIn(store.actions.document(), "auxiliarybar")).toEqual([["view:test.aux", ["test.aux"]]]);
        expect(sizes()).toEqual(before);
        await settled(store);
        expect((await savedDoc(storage, USER)).panels.panel).toMatchObject({hidden: true, entries: []});

        // 区域里已经有容器：新容器排在入口顺序最后，成为当前容器。
        expect(store.actions.moveView("test.aux", {newContainerIn: "sidebar"}).ok).toBe(true);
        const second = viewSection(store.actions.document(), "test.aux")?.container ?? "";
        expect(store.actions.document().panels.sidebar).toMatchObject({entries: ["view:test.side", second], activeContainer: second});
        expect(store.actions.document().panels.auxiliarybar).toMatchObject({hidden: true, activeContainer: null});
    });

    it("目标容器既没有成员也没有声明、视图不在文档里：not-found，零写入；已经是目标容器最后一个分节且看得见：零写入（输出 23；commands.md 的 move-view）", async () => {
        const w = await world();
        const {store} = await openLayoutDoc(w, "a", "c");
        const before = store.actions.document();
        expect(store.actions.moveView("test.side", {container: "custom:gone"})).toMatchObject({ok: false, code: "not-found"});
        expect(store.actions.moveView("test.nowhere", {container: "view:test.aux"})).toMatchObject({ok: false, code: "not-found"});
        expect(store.actions.moveView("test.side", {container: "view:test.side"}).ok).toBe(true);
        expect(store.actions.document()).toBe(before);
        expect(store.state.field.queue).toBe(0);
    });

    it("空区域点“显示”：打开成一块空面板，写一次、算可见（开关能再关掉），存下来；拖走区域最后一节时区域随之隐藏（输出 11、36、43；ADR 0050）", async () => {
        const w = await world();
        const {store, storage} = await openLayoutDoc(w, "a", "c", false, new Map([...BUSY_LAYOUT_CATALOG].filter(([id]) => id !== "test.panel")));
        expect(store.actions.partVisible("panel")).toBe(false);
        expect(store.actions.setPartHidden("panel", false).ok).toBe(true);
        expect(store.actions.partVisible("panel")).toBe(true);
        expect(isPanelShown(store.actions.document(), "panel")).toBe(true);
        await waitUntil("打开的空区域写下来", async () => (await read(storage, USER)) !== "missing");
        expect((await savedDoc(storage, USER)).panels.panel?.hidden).toBeUndefined();
        expect(store.actions.setPartHidden("panel", true).ok).toBe(true);
        expect(store.actions.partVisible("panel")).toBe(false);

        // 放进一节再移走：这一次把区域拖空了，区域随之隐藏。
        expect(store.actions.setPartHidden("panel", false).ok).toBe(true);
        expect(store.actions.moveView("test.aux", {newContainerIn: "panel"}).ok).toBe(true);
        expect(isPanelShown(store.actions.document(), "panel")).toBe(false);
        expect(store.actions.moveView("test.aux", {container: "view:test.aux"}).ok).toBe(true);
        expect(store.actions.document().panels.panel?.hidden).toBe(true);
    });

    it("标签换一位：活动标签不变，到头了不动（输出 20）", async () => {
        // 区域里一个分节一个标签；几个标签的工具面板只有浮动窗。
        const w = await world();
        const {store} = await openLayoutDoc(w, "a", "c");
        expect((await store.actions.floatTab("view:test.side")).ok).toBe(true);
        const float = store.actions.document().floats[0]?.panel ?? "";
        expect(store.actions.apply((doc) => moveTabToStrip(doc, {tab: "view:test.panel", panel: float, index: 1}, POLICY)).ok).toBe(true);
        const tabs = (): ReadonlyArray<unknown> => store.actions.document().panels[float]?.tabs ?? [];
        const before = tabs();
        expect(before).toHaveLength(2);
        const active = store.actions.document().panels[float]?.active;
        expect(store.actions.reorderTab("view:test.panel", 1).ok).toBe(true);
        expect(tabs()).toEqual(before);
        expect(store.actions.reorderTab("view:test.panel", -1).ok).toBe(true);
        expect(tabs()).toEqual([before[1], before[0]]);
        expect(store.actions.document().panels[float]?.active).toBe(active);
    });

    it("点标题：分节收成标题行时一起展开（输出 11）", async () => {
        const w = await world();
        const {store} = await openLayoutDoc(w, "a", "c");
        const section = sectionOf(store, "test.side");
        // 区域只显示这一个分节时收不成标题行：拒绝，文档不变。
        const single = store.actions.document();
        expect(store.actions.setCollapsed(section, true)).toMatchObject({ok: false, code: "rejected"});
        expect(store.actions.document()).toBe(single);

        expect(store.actions.moveView("test.panel", {container: "view:test.side"}).ok).toBe(true);
        store.actions.setCollapsed(section, true);
        expect(store.actions.document().panels[section]?.collapsed).toBe(true);
        store.actions.activate("view:test.side");
        expect(store.actions.document().panels[section]?.collapsed).toBeUndefined();

        // 记录里留着收起、此刻却是唯一显示的分节：它没收起，点标题不动这条记录；另一个分节回来时它还是标题行。
        store.actions.setCollapsed(section, true);
        expect(store.actions.moveView("test.panel", {container: "view:test.panel"}).ok).toBe(true);
        store.actions.activate("view:test.side");
        expect(store.actions.document().panels[section]?.collapsed).toBe(true);
    });

    it("浮动窗回到停靠：视图各回声明的容器，一个标签一个分节，看得见的是窗的活动标签那个容器（输出 39）", async () => {
        const w = await world();
        const {store} = await openLayoutDoc(w, "a", "c");
        expect((await store.actions.floatTab("view:test.side")).ok).toBe(true);
        const float = store.actions.document().floats[0]?.panel ?? "";
        expect(store.actions.apply((doc) => moveTabToStrip(doc, {tab: "view:test.aux", panel: float, index: 1}, POLICY)).ok).toBe(true);
        expect(store.actions.document().panels.sidebar?.hidden).toBe(true);
        expect((await store.actions.dockFloat(float)).ok).toBe(true);
        const doc = store.actions.document();
        expect(doc.floats).toEqual([]);
        expect(containersIn(doc, "sidebar")).toEqual([["view:test.side", ["test.side"]]]);
        expect(containersIn(doc, "auxiliarybar")).toEqual([["view:test.aux", ["test.aux"]]]);
        expect(doc.panels.sidebar?.hidden).toBeUndefined();
        expect(doc.panels.auxiliarybar?.hidden).toBeUndefined();
        expect(fitsSkeleton(doc)).toBe(true);
    });

    it("浮动一个分节：成为只有它一个标签的窗，不再属于容器；回到停靠时回声明的容器，排在已有的分节后面（输出 39）", async () => {
        const w = await world();
        const {store} = await openLayoutDoc(w, "a", "c");
        expect(store.actions.moveView("test.panel", {container: "view:test.aux"}).ok).toBe(true);
        expect((await store.actions.floatTab("view:test.aux")).ok).toBe(true);
        const float = store.actions.document().floats[0]?.panel ?? "";
        const record = store.actions.document().panels[float];
        expect(record).toMatchObject({role: "tool", tabs: [{kind: "view", viewId: "test.aux"}], active: "view:test.aux"});
        expect(record?.container).toBeUndefined();
        expect(containersIn(store.actions.document(), "auxiliarybar")).toEqual([["view:test.aux", ["test.panel"]]]);

        expect((await store.actions.dockFloat(float)).ok).toBe(true);
        const doc = store.actions.document();
        expect(doc.floats).toEqual([]);
        expect(containersIn(doc, "auxiliarybar")).toEqual([["view:test.aux", ["test.panel", "test.aux"]]]);
        expect(doc.panels.auxiliarybar?.activeContainer).toBe("view:test.aux");
        expect(fitsSkeleton(doc)).toBe(true);
    });

    it("`editor.tabs` 保存失败：布局不写，状态栏有问题；再存成功就好了", async () => {
        const w = await world();
        const {store, storage} = await openLayoutDoc(w, "a", "c");
        let allow = false;
        let recovers = 0;
        store.actions.acceptSaveGate({pass: async () => allow, recover: async () => {
            recovers += 1;
            return allow;
        }});
        hideAux(store);
        await store.actions.save();
        expect(await read(storage, USER)).toBe("missing");
        expect(store.state.problems).toEqual([{kind: "unsaved", code: "save-gate"}]);
        // 重试还是过不去：照旧显示。保存本身不重试关卡，只有这个按钮才重试。
        expect(recovers).toBe(0);
        await store.actions.retry();
        expect(recovers).toBe(1);
        expect(store.state.problems).toEqual([{kind: "unsaved", code: "save-gate"}]);
        expect(await read(storage, USER)).toBe("missing");
        allow = true;
        // 状态栏的“重试”：布局自己没有待重试的，要再走一次关卡。
        await store.actions.retry();
        await settled(store);
        expect(store.state.problems).toEqual([]);
        expect((await savedDoc(storage, USER)).panels.auxiliarybar?.hidden).toBe(true);
    });

    it("放弃：开着的编辑器标签不跟着回滚，关掉的也不回来", async () => {
        const w = await world();
        await w.project(1, []);
        const {store, storage} = await openLayoutDoc(w, "a", "c", true);
        const panels = () => store.actions.document().panels;
        const editor = INITIAL_EDITOR_PANEL;
        store.actions.apply((current) => insertTab(current, {panel: editor, tab: editorTab("closed")}), {flush: true});
        await store.actions.save();
        await settled(store);
        expect((await savedDoc(storage, PROJECT)).panels[editor]?.tabs).toEqual([editorTab("closed")]);

        store.actions.apply((current) => removeTab(current, "tab:closed"));
        store.actions.apply((current) => insertTab(current, {panel: editor, tab: editorTab("open")}));
        hideAux(store);
        store.actions.discard();
        expect(panels()[editor]?.tabs).toEqual([editorTab("open")]);
        expect(panels()[editor]?.active).toBe("tab:open");
        expect(panels().auxiliarybar?.hidden).toBeUndefined();

        // 未绑定项目的窗口：已确认的文档里没有动态标签，开着的同样不丢。
        const unbound = (await openLayoutDoc(w, "b", "d")).store;
        unbound.actions.apply((current) => insertTab(current, {panel: INITIAL_EDITOR_PANEL, tab: editorTab("open")}));
        unbound.actions.discard();
        expect(unbound.actions.document().panels[INITIAL_EDITOR_PANEL]?.tabs).toEqual([editorTab("open")]);
    });

    it("放弃：显示回到已确认值", async () => {
        const w = await world();
        const {store} = await openLayoutDoc(w, "a", "c");
        hideAux(store);
        expect(store.state.doc.panels.auxiliarybar?.hidden).toBe(true);
        store.actions.discard();
        expect(store.state.doc.panels.auxiliarybar?.hidden).toBeUndefined();
    });
});

describe("多窗口", () => {
    it("另一窗口保存后本窗口显示不被强改；后保存的整棵胜出", async () => {
        const w = await world();
        const a = await openLayoutDoc(w, "a", "c");
        const b = await openLayoutDoc(w, "b", "c");
        hideAux(a.store);
        await a.store.actions.save();
        await settled(a.store);
        await waitUntil("b 收到", () => b.store.state.field.base?.status === "ok");
        b.store.actions.setPartHidden("panel", true);
        expect(b.store.state.doc.panels.auxiliarybar?.hidden).toBeUndefined();
        await b.store.actions.save();
        await settled(b.store);
        const saved = await savedDoc(a.storage, USER);
        expect(saved.panels.panel?.hidden).toBe(true);
        expect(saved.panels.auxiliarybar?.hidden).toBeUndefined();
        expect(b.store.state.problems).toEqual([]);
    });
});

describe("呈现事实", () => {
    const open = async () => {
        const w = await world();
        return openLayoutDoc(w, "a", "c");
    };

    it("最大化只在内存，不写盘；切标签不退出，结构操作退出；刷新不复活", async () => {
        const {store, storage} = await open();
        const side = sectionOf(store, "test.side");
        // 区域里最大化的是一个分节（输出 13）：锚自己不显示，不能最大化。
        expect(store.actions.toggleMaximized("sidebar")).toBe(false);
        expect(store.actions.toggleMaximized(side)).toBe(true);
        expect(store.state.maximized).toBe(side);
        expect(store.state.field.queue).toBe(0);
        expect(await read(storage, USER)).toBe("missing");
        store.actions.apply((doc) => insertTab(doc, {panel: INITIAL_EDITOR_PANEL, tab: editorTab("t1")}));
        expect(store.state.maximized).toBe(side);
        store.actions.setPartHidden("auxiliarybar", true);
        expect(store.state.maximized).toBe(side);
        const aux = sectionOf(store, "test.aux");
        store.actions.apply((doc) => moveFirstTabToEdge(doc, {kind: "split", panel: aux, edge: "bottom"}));
        expect(store.state.maximized).toBeNull();
    });

    it("最大化的分节：切走它所在的容器时退出（输出 13）", async () => {
        const {store} = await open();
        const side = sectionOf(store, "test.side");
        // 右栏的视图带着它的容器放进侧栏：侧栏有两个容器，当前的还是原来那个。
        expect(store.actions.apply((doc) => moveTabToEdge(doc, {tab: "view:test.aux", target: {kind: "split", panel: side, edge: "bottom"}, container: "view:test.aux"}, POLICY)).ok).toBe(true);
        expect(containersIn(store.actions.document(), "sidebar")).toEqual([["view:test.side", ["test.side"]], ["view:test.aux", ["test.aux"]]]);
        expect(store.actions.document().panels.sidebar?.activeContainer).toBe("view:test.side");
        expect(store.actions.toggleMaximized(side)).toBe(true);
        expect(store.state.maximized).toBe(side);
        // 把面板的视图放进另一个容器：侧栏切到那个容器，最大化着的分节不显示了。
        expect(store.actions.moveView("test.panel", {container: "view:test.aux"}).ok).toBe(true);
        expect(containersIn(store.actions.document(), "sidebar")).toEqual([["view:test.side", ["test.side"]], ["view:test.aux", ["test.aux", "test.panel"]]]);
        expect(store.actions.document().panels.sidebar?.activeContainer).toBe("view:test.aux");
        expect(store.state.maximized).toBeNull();
        expect(store.actions.partVisible("sidebar")).toBe(true);
    });

    it("区域的可见：隐藏、拖到零、被盖住、放不下被收走都不算，分节收成标题行算（输出 36）", async () => {
        const {store} = await open();
        const side = sectionOf(store, "test.side");
        expect(store.actions.partVisible("sidebar")).toBe(true);
        store.actions.setCollapsed(side, true);
        expect(store.actions.partVisible("sidebar")).toBe(true);
        store.actions.setCollapsed(side, false);
        // 区域拖到零记在锚上。
        store.actions.setCollapsed("sidebar", true);
        expect(store.actions.partVisible("sidebar")).toBe(false);
        store.actions.setCollapsed("sidebar", false);
        store.actions.toggleMaximized(side);
        expect(store.actions.partVisible("auxiliarybar")).toBe(false);
        expect(store.actions.partVisible("sidebar")).toBe(true);
        store.actions.toggleMaximized(side);
        store.actions.acceptExtent({width: 500, height: 800});
        expect(store.state.collapse.removed.has(sectionOf(store, "test.aux"))).toBe(true);
        expect(store.actions.partVisible("auxiliarybar")).toBe(false);
        store.actions.setPartHidden("sidebar", true);
        expect(store.actions.partVisible("sidebar")).toBe(false);
        expect(store.actions.partVisible("statusbar")).toBe(true);
    });

    it("放不下只改呈现：不写文档；放大回来；把最大化的面板收走时退出最大化", async () => {
        const {store} = await open();
        const before = store.state.doc;
        const aux = sectionOf(store, "test.aux");
        store.actions.toggleMaximized(aux);
        store.actions.acceptExtent({width: 500, height: 800});
        expect(store.state.projection.input.kind).toBe("branch");
        expect(JSON.stringify(store.state.projection.input)).not.toContain(aux);
        expect(store.state.doc).toBe(before);
        expect(store.state.field.queue).toBe(0);
        expect(store.state.maximized).toBeNull();
        store.actions.acceptExtent({width: 1440, height: 900});
        expect(JSON.stringify(store.state.projection.input)).toContain(aux);
    });

    it("结构操作之前把呈现尺寸写回意图；手势落账立刻存，区域拖到零记在锚上", async () => {
        const {store, storage} = await open();
        const [side, aux] = [sectionOf(store, "test.side"), sectionOf(store, "test.aux")];
        store.actions.acceptExtent({width: 1440, height: 900});
        // 吸收余量的节点：呈现尺寸就是这一刻的份额。保留像素的节点见下面“被压缩的尺寸不是意图”。
        store.actions.acceptPresented({g0: {width: 611, height: 600}});
        store.actions.setPartHidden("statusbar", true);
        expect(sizeIn(store.state.doc, "g0").width).toBe(611);
        // 侧栏只显示一个分节时，呈现树里代表区域的就是这个分节：尺寸写给区域；右栏顶上有入口条（输出 47），代表区域的是包装分支（id 是区域节点的）。
        // 拖到零都记在锚上，分节自己不变成标题行（输出 11）。
        const auxRegion = presentedRegion(store, "auxiliarybar");
        store.actions.commitGesture(store.state.presented, {[side]: {width: 222, height: 878}}, {[auxRegion]: true});
        await settled(store);
        const saved = await savedDoc(storage, USER);
        expect(regionSize(saved, "sidebar").width).toBe(222);
        expect(saved.panels.auxiliarybar?.collapsed).toBe(true);
        expect(saved.panels[aux]?.collapsed).toBeUndefined();
    });

    it("隐藏的区域按拖到零画（输出 11、12）：在呈现里、收起为零；隐藏着拖别的边界、再显示，回到原来的宽度；从它的边界拉开，隐藏一起清掉", async () => {
        const {store, storage} = await open();
        const side = sectionOf(store, "test.side");
        store.actions.acceptExtent({width: 1440, height: 900});
        const width = regionSize(store.state.doc, "sidebar").width;
        store.actions.setPartHidden("sidebar", true);
        expect(store.state.projection.regionAnchors.get(side)).toBe("sidebar");
        expect(JSON.stringify(store.state.projection.input)).toContain(side);

        // 隐藏着拖编辑区与右栏之间的边界：侧栏呈现为零，不写回意图。
        store.actions.commitGesture(store.state.presented, {[side]: {width: 0, height: 878}, g0: {width: 700, height: 600}}, {});
        expect(store.state.doc.panels.sidebar?.hidden).toBe(true);
        store.actions.setPartHidden("sidebar", false);
        expect(regionSize(store.state.doc, "sidebar").width).toBe(width);

        store.actions.setPartHidden("sidebar", true);
        // 从零拉开：手势报代表区域的节点展开。
        store.actions.commitGesture(store.state.presented, {[side]: {width: 260, height: 878}}, {[side]: false});
        await settled(store);
        const saved = await savedDoc(storage, USER);
        expect(saved.panels.sidebar?.hidden).toBeUndefined();
        expect(saved.panels.sidebar?.collapsed).toBeUndefined();
        expect(regionSize(saved, "sidebar").width).toBe(260);
    });

    it("实时布局的预览只给渲染用：已提交的文档、投影与可见性不变，尺寸不收，不写记录；撤下回到已提交的", async () => {
        const {store, storage} = await open();
        store.actions.acceptExtent({width: 1440, height: 900});
        store.actions.acceptPresented({g0: {width: 611, height: 600}});
        const committed = store.actions.document();
        const projection = store.actions.presentation();
        const visible = [...store.state.visibleTabs];
        const presented = store.state.presented;
        const removed = removeTab(committed, "view:test.side");
        if (!removed.ok) throw new Error("摘不掉");
        store.actions.setLivePreview(removed.doc);
        expect(store.actions.rendered()).toBe(removed.doc);
        expect(store.actions.renderedPresentation()).not.toBe(projection);
        expect(store.actions.document()).toBe(committed);
        expect(store.actions.presentation()).toBe(projection);
        expect([...store.state.visibleTabs]).toEqual(visible);
        store.actions.acceptPresented({g0: {width: 1, height: 1}});
        expect(store.state.presented).toEqual(presented);
        store.actions.setLivePreview(null);
        expect(store.actions.rendered()).toBe(committed);
        await settled(store);
        expect(await savedDoc(storage, USER).catch(() => null)).toBeNull();
    });

    it("手势把分节收成标题行：呈现的高度是标题行，不是意图；拉回时写的是这一列里几个分节的比例（输出 8、12）", async () => {
        const {store, storage} = await open();
        const side = sectionOf(store, "test.side");
        expect(store.actions.moveView("test.panel", {container: "view:test.side"}).ok).toBe(true);
        const lower = sectionOf(store, "test.panel");
        const before = sizeIn(store.actions.document(), lower).height;
        store.actions.commitGesture(store.state.presented, {[side]: {width: 260, height: 800 - PANEL_HEAD_HEIGHT}, [lower]: {width: 260, height: PANEL_HEAD_HEIGHT}}, {[lower]: true});
        await settled(store);
        const saved = await savedDoc(storage, USER);
        expect(saved.panels[lower]?.collapsed).toBe(true);
        expect(saved.panels.sidebar?.collapsed).toBeUndefined();
        expect(sizeIn(saved, lower).height).toBe(before);
        // 拉回时呈现的高度才是新的意图。
        store.actions.commitGesture(store.state.presented, {[side]: {width: 260, height: 500}, [lower]: {width: 260, height: 300}}, {[lower]: false});
        const doc = store.actions.document();
        expect(doc.panels[lower]?.collapsed).toBeUndefined();
        expect(sizeIn(doc, lower).height / sizeIn(doc, side).height).toBeCloseTo(300 / 500, 5);
    });

    it("放不下时被压缩的尺寸不是意图：切标签、别处的手势都不写，这块自己被拖了才写（输出 8；验收 6）", async () => {
        const {store} = await open();
        const [side, aux, lower] = [sectionOf(store, "test.side"), sectionOf(store, "test.aux"), sectionOf(store, "test.panel")];
        const widths = () => [regionSize(store.actions.document(), "sidebar").width, regionSize(store.actions.document(), "auxiliarybar").width];
        const before = widths();
        const squeezed = {[side]: {width: 160, height: 700}, [aux]: {width: 160, height: 700}, g0: {width: 300, height: 500}, [lower]: {width: 300, height: 200}};
        store.actions.acceptPresented(squeezed);
        store.actions.setPartHidden("statusbar", true);
        store.actions.activate("view:test.side");
        expect(widths()).toEqual(before);
        // 拖面板的高度：侧栏、右栏这次没动，还是压缩的结果。底部面板顶上有入口条，代表区域的是包装分支（输出 47）。
        const panelRegion = regionNodeOf(store.actions.document(), "panel")!.node.id;
        store.actions.commitGesture(store.state.presented, {...squeezed, g0: {width: 300, height: 400}, [lower]: {width: 300, height: 268}, [panelRegion]: {width: 300, height: 300}}, {});
        expect(widths()).toEqual(before);
        expect(regionSize(store.actions.document(), "panel").height).toBe(300);
        // 拖侧栏的边界：写。
        store.actions.commitGesture(store.state.presented, {...squeezed, [side]: {width: 200, height: 700}, g0: {width: 260, height: 400}, [lower]: {width: 260, height: 268}, [panelRegion]: {width: 260, height: 300}}, {});
        expect(regionSize(store.actions.document(), "sidebar").width).toBe(200);

        // “这次动没动”看手势开始时的尺寸（`before`），不看 store 记的 `presented`：实时预览期间 `presented` 不更新，可能和手势开始时的不同（输出 49）。
        // 这里 `presented` 与落账后的右栏都是 160，`before` 里是 150：右栏这次动了，要写。右栏顶上有入口条，代表区域的是包装分支（输出 47）。
        expect(before[1]).not.toBe(160);
        const auxRegion = presentedRegion(store, "auxiliarybar");
        const shown = {...squeezed, [auxRegion]: {width: 160, height: 700}};
        store.actions.acceptPresented(shown);
        store.actions.commitGesture({...shown, [auxRegion]: {width: 150, height: 700}}, {...shown, [side]: {width: 200, height: 700}}, {});
        expect(regionSize(store.actions.document(), "auxiliarybar").width).toBe(160);
    });

    it("最大化的分节被搬走、或要显示被它盖住的区域：退出最大化，不把工作台留在全都看不见的样子（输出 13）", async () => {
        const {store} = await open();
        const side = sectionOf(store, "test.side");
        store.actions.toggleMaximized(side);
        expect(store.state.maximized).toBe(side);
        expect(store.actions.moveView("test.side", {container: "view:test.aux"}).ok).toBe(true);
        expect(store.state.doc.panels.sidebar?.hidden).toBe(true);
        expect(store.state.maximized).toBeNull();
        expect(store.actions.partVisible("auxiliarybar")).toBe(true);

        store.actions.toggleMaximized(sectionOf(store, "test.aux"));
        expect(store.actions.partVisible("panel")).toBe(false);
        store.actions.setPartHidden("panel", false);
        expect(store.state.maximized).toBeNull();
        expect(store.actions.partVisible("panel")).toBe(true);
    });

    it("放回原处：不写盘", async () => {
        const {store} = await open();
        const before = store.state.doc;
        const result = store.actions.apply((doc) => ({ok: true, doc} as const));
        expect(result.ok).toBe(true);
        expect(store.state.doc).toBe(before);
        expect(store.state.field.queue).toBe(0);
    });
});

describe("视图容器：切换与搬动（输出 22、42、44）", () => {
    const declared = (name: string, location: "sidebar" | "auxiliarybar" | "panel", container?: string) => ({title: {"zh-CN": name, "en-US": name}, icon: `i-${name}`, location, layout: "scroll" as const, ...(container === undefined ? {} : {container})});
    const GROUP = "test.group";
    /** 侧栏：声明的容器“项目”装三个视图，另有一个视图在自己的容器里；右栏、底部面板各一个视图。 */
    const VIEWS: ViewCatalog = new Map([
        ["test.s1", declared("S1", "sidebar", GROUP)], ["test.s2", declared("S2", "sidebar", GROUP)], ["test.s3", declared("S3", "sidebar", GROUP)],
        ["test.s4", declared("S4", "sidebar")], ["test.x1", declared("X1", "auxiliarybar")], ["test.p1", declared("P1", "panel")],
    ]);
    const GROUPS: ContainerCatalog = new Map([[GROUP, {title: {"zh-CN": "项目", "en-US": "Project"}, icon: "i-group", location: "sidebar", order: -1}]]);
    const open = async () => {
        const w = await world();
        const opened = await openLayoutDoc(w, "a", "c", false, new Map());
        // 容器声明要先于视图目录交进来（见 `acceptViewContainers`）。
        opened.store.actions.acceptViewContainers(GROUPS);
        opened.store.actions.acceptViewCatalog(VIEWS);
        return opened;
    };
    const anchorOf = (store: LayoutDocStore, region: PanelName) => store.actions.document().panels[region];
    /** 从现在起文档提交了几次：一次动作只该让看文档的地方重算一次。 */
    const countCommits = (store: LayoutDocStore): {readonly count: () => number; readonly stop: () => void} => {
        let commits = -1;
        const runner = effect(() => {
            void store.state.doc;
            commits += 1;
        });
        return {count: () => commits, stop: () => runner.effect.stop()};
    };
    /** 三个分节的主轴意图调成 1：2：3。 */
    const shareOut = (store: LayoutDocStore, sections: ReadonlyArray<string>) => {
        const result = store.actions.apply((doc) => setSiblingShares(doc, sections.map((node, index) => ({node, share: index + 1}))));
        if (!result.ok) throw new Error(result.message);
    };

    it("默认：侧栏两个容器，声明的容器装着它的三个视图，是当前容器", async () => {
        const {store} = await open();
        expect(containersIn(store.actions.document(), "sidebar")).toEqual([[GROUP, ["test.s1", "test.s2", "test.s3"]], ["view:test.s4", ["test.s4"]]]);
        expect(anchorOf(store, "sidebar")).toMatchObject({activeContainer: GROUP});
    });

    it("让容器看得见：切到它，一次提交；分节的先后、大小、收成标题行都不动；已经看得见时零写入", async () => {
        const {store} = await open();
        const sections = ["test.s1", "test.s2", "test.s3"].map((id) => sectionOf(store, id));
        shareOut(store, sections);
        expect(store.actions.setCollapsed(sections[1] ?? "", true).ok).toBe(true);
        const heights = () => sections.map((id) => sizeIn(store.actions.document(), id).height);
        const before = heights();
        const tree = store.actions.document().tree;
        // 呈现尺寸和意图不成比例（例如被别的约束夹过）：切换不把它写回，尺寸意图一个都不动（输出 8、42）。
        store.actions.acceptPresented({[sections[0] ?? ""]: {width: 0, height: 50}, [sections[2] ?? ""]: {width: 0, height: 700}});
        const commits = countCommits(store);
        expect(store.actions.showContainer("view:test.s4").ok).toBe(true);
        expect(store.actions.document().tree).toEqual(tree);
        expect(commits.count()).toBe(1);
        expect(anchorOf(store, "sidebar")).toMatchObject({activeContainer: "view:test.s4"});
        expect(isPanelShown(store.actions.document(), sectionOf(store, "test.s4"))).toBe(true);
        expect(sections.some((id) => isPanelShown(store.actions.document(), id))).toBe(false);
        // 切回来：三个分节还是原来的先后与大小，第二个还收着。
        expect(store.actions.showContainer(GROUP).ok).toBe(true);
        expect(containersIn(store.actions.document(), "sidebar")).toEqual([[GROUP, ["test.s1", "test.s2", "test.s3"]], ["view:test.s4", ["test.s4"]]]);
        expect(heights()).toEqual(before);
        expect(store.actions.document().tree).toEqual(tree);
        expect(sections.map((id) => isSectionCollapsed(store.actions.document(), id))).toEqual([false, true, false]);
        const same = store.actions.document();
        expect(store.actions.showContainer(GROUP).ok).toBe(true);
        expect(store.actions.document()).toBe(same);
        expect(commits.count()).toBe(2);
        commits.stop();
        expect(store.actions.showContainer("custom:nobody")).toMatchObject({ok: false, code: "not-found"});
    });

    it("移进视图自己的容器、它已经是最后一节：就是点它的入口，只切过去，尺寸意图一个都不动；盖着的最大化退出（输出 23、42）", async () => {
        const {store} = await open();
        const sections = ["test.s1", "test.s2", "test.s3"].map((id) => sectionOf(store, id));
        shareOut(store, sections);
        // 呈现尺寸和意图不成比例：搬动会先写回意图，放到自己身后不是搬动，不写回。
        store.actions.acceptPresented({[sections[0] ?? ""]: {width: 0, height: 50}, [sections[2] ?? ""]: {width: 0, height: 700}});
        expect(store.actions.showContainer("view:test.s4").ok).toBe(true);
        const tree = store.actions.document().tree;
        const aux = sectionOf(store, "test.x1");
        expect(store.actions.toggleMaximized(aux)).toBe(true);
        expect(store.actions.moveView("test.s3", {container: GROUP}).ok).toBe(true);
        expect(anchorOf(store, "sidebar")).toMatchObject({activeContainer: GROUP});
        expect(store.actions.document().tree).toEqual(tree);
        expect(store.state.maximized).toBeNull();
    });

    it("移进一个写了别的容器的视图的隐式容器：view:<它> 既没有成员也没有声明，not-found，零写入（输出 41；commands.md 的 move-view）", async () => {
        const {store} = await open();
        const before = store.actions.document();
        expect(store.actions.moveView("test.x1", {container: "view:test.s1"})).toMatchObject({ok: false, code: "not-found"});
        expect(store.actions.document()).toBe(before);
        expect(store.state.field.queue).toBe(0);
    });

    it("让容器看得见：侧栏隐藏着、拖到零时同时展开，当前容器也一样", async () => {
        const {store} = await open();
        store.actions.setPartHidden("sidebar", true);
        expect(store.actions.partVisible("sidebar")).toBe(false);
        expect(store.actions.showContainer(GROUP).ok).toBe(true);
        expect(store.actions.partVisible("sidebar")).toBe(true);
        store.actions.setCollapsed("sidebar", true);
        expect(store.actions.partVisible("sidebar")).toBe(false);
        const commits = countCommits(store);
        expect(store.actions.showContainer("view:test.s4").ok).toBe(true);
        expect(commits.count()).toBe(1);
        commits.stop();
        expect(store.actions.partVisible("sidebar")).toBe(true);
        expect(anchorOf(store, "sidebar")).toMatchObject({activeContainer: "view:test.s4"});
        expect(anchorOf(store, "sidebar")?.collapsed).toBeUndefined();
    });

    it("让容器看得见：别的面板最大化着就退出，最大化的是这个容器的分节时不退", async () => {
        const {store} = await open();
        const aux = sectionOf(store, "test.x1");
        expect(store.actions.toggleMaximized(aux)).toBe(true);
        expect(store.actions.partVisible("sidebar")).toBe(false);
        expect(store.actions.showContainer(GROUP).ok).toBe(true);
        expect(store.state.maximized).toBeNull();
        expect(store.actions.partVisible("sidebar")).toBe(true);
        const first = sectionOf(store, "test.s1");
        expect(store.actions.toggleMaximized(first)).toBe(true);
        expect(store.actions.showContainer(GROUP).ok).toBe(true);
        expect(store.state.maximized).toBe(first);
    });

    it("搬容器：分节的先后、彼此的比例、收成标题行都带着；排到目标区域最后并成为当前容器；原区域换相邻的；一次提交并立刻存", async () => {
        const {store, storage} = await open();
        const sections = ["test.s1", "test.s2", "test.s3"].map((id) => sectionOf(store, id));
        const [first, second, third] = sections as [string, string, string];
        shareOut(store, sections);
        expect(store.actions.setCollapsed(second, true).ok).toBe(true);
        const commits = countCommits(store);
        expect(store.actions.moveContainer(GROUP, "auxiliarybar").ok).toBe(true);
        expect(commits.count()).toBe(1);
        commits.stop();
        const doc = store.actions.document();
        expect(containersIn(doc, "auxiliarybar")).toEqual([["view:test.x1", ["test.x1"]], [GROUP, ["test.s1", "test.s2", "test.s3"]]]);
        expect(anchorOf(store, "auxiliarybar")).toMatchObject({activeContainer: GROUP});
        expect(containersIn(doc, "sidebar")).toEqual([["view:test.s4", ["test.s4"]]]);
        expect(anchorOf(store, "sidebar")).toMatchObject({activeContainer: "view:test.s4"});
        expect(anchorOf(store, "sidebar")?.hidden).toBeUndefined();
        expect(sizeIn(doc, second).height / sizeIn(doc, first).height).toBeCloseTo(2, 5);
        expect(sizeIn(doc, third).height / sizeIn(doc, first).height).toBeCloseTo(3, 5);
        expect(sections.map((id) => isSectionCollapsed(doc, id))).toEqual([false, true, false]);
        expect(fitsSkeleton(doc)).toBe(true);
        await settled(store);
        const saved = await savedDoc(storage, USER);
        expect(containersIn(saved, "auxiliarybar")).toEqual([["view:test.x1", ["test.x1"]], [GROUP, ["test.s1", "test.s2", "test.s3"]]]);
        expect(saved.panels.auxiliarybar).toMatchObject({activeContainer: GROUP});
    });

    it("搬进底部面板：方向变了，分节平分，收成标题行的展开；搬回侧栏排到最后，还是当前容器", async () => {
        const {store} = await open();
        const sections = ["test.s1", "test.s2", "test.s3"].map((id) => sectionOf(store, id));
        const [first, second, third] = sections as [string, string, string];
        shareOut(store, sections);
        expect(store.actions.setCollapsed(second, true).ok).toBe(true);
        expect(store.actions.moveContainer(GROUP, "panel").ok).toBe(true);
        const doc = store.actions.document();
        expect(containersIn(doc, "panel")).toEqual([["view:test.p1", ["test.p1"]], [GROUP, ["test.s1", "test.s2", "test.s3"]]]);
        expect(anchorOf(store, "panel")).toMatchObject({activeContainer: GROUP});
        expect(sections.map((id) => isSectionCollapsed(doc, id))).toEqual([false, false, false]);
        expect(doc.panels[second]?.collapsed).toBeUndefined();
        expect(sizeIn(doc, second).width / sizeIn(doc, first).width).toBeCloseTo(1, 5);
        expect(sizeIn(doc, third).width / sizeIn(doc, first).width).toBeCloseTo(1, 5);

        expect(store.actions.moveContainer(GROUP, "sidebar").ok).toBe(true);
        expect(containersIn(store.actions.document(), "sidebar")).toEqual([["view:test.s4", ["test.s4"]], [GROUP, ["test.s1", "test.s2", "test.s3"]]]);
        expect(anchorOf(store, "sidebar")).toMatchObject({activeContainer: GROUP});
        expect(anchorOf(store, "panel")).toMatchObject({activeContainer: "view:test.p1"});
    });

    it("搬容器：目标区域隐藏着、拖到零就展开；搬走区域最后一个容器，区域隐藏；已经在那里零写入；没有成员的容器是 not-found", async () => {
        const {store} = await open();
        store.actions.setPartHidden("auxiliarybar", true);
        expect(store.actions.moveContainer("view:test.s4", "auxiliarybar").ok).toBe(true);
        expect(store.actions.partVisible("auxiliarybar")).toBe(true);
        expect(anchorOf(store, "auxiliarybar")).toMatchObject({activeContainer: "view:test.s4"});
        store.actions.setCollapsed("panel", true);
        expect(store.actions.moveContainer("view:test.s4", "panel").ok).toBe(true);
        expect(store.actions.partVisible("panel")).toBe(true);
        expect(anchorOf(store, "panel")?.collapsed).toBeUndefined();

        expect(store.actions.moveContainer("view:test.x1", "sidebar").ok).toBe(true);
        expect(containersIn(store.actions.document(), "auxiliarybar")).toEqual([]);
        expect(anchorOf(store, "auxiliarybar")).toMatchObject({hidden: true, activeContainer: null});
        expect(anchorOf(store, "sidebar")).toMatchObject({activeContainer: "view:test.x1"});

        const same = store.actions.document();
        expect(store.actions.moveContainer("view:test.x1", "sidebar").ok).toBe(true);
        expect(store.actions.document()).toBe(same);
        expect(store.actions.moveContainer("custom:nobody", "panel")).toMatchObject({ok: false, code: "not-found"});
        expect(store.actions.document()).toBe(same);
    });

    describe("侧轨意图（ui/workbench-layout 输出 50 的“展开”）", () => {
        const X1 = "view:test.x1";
        const expand = (store: LayoutDocStore, width: number) => {
            const result = store.actions.apply((doc) => setContainerRail(doc, {anchor: "auxiliarybar", container: X1, intent: {expanded: true, width}}));
            if (!result.ok) throw new Error(result.message);
        };

        it("经真实存储往返：存下的记录带着它，另一个窗口读进来还在", async () => {
            const w = await world();
            const first = await openLayoutDoc(w, "a", "c", false, new Map());
            first.store.actions.acceptViewContainers(GROUPS);
            first.store.actions.acceptViewCatalog(VIEWS);
            expand(first.store, 320);
            await first.store.actions.save();
            expect((await savedDoc(first.storage, USER)).panels.auxiliarybar?.rail).toEqual({[X1]: {expanded: true, width: 320}});

            const second = await openLayoutDoc(w, "b", "c", false, new Map());
            second.store.actions.acceptViewContainers(GROUPS);
            second.store.actions.acceptViewCatalog(VIEWS);
            expect(second.store.actions.document().panels.auxiliarybar?.rail).toEqual({[X1]: {expanded: true, width: 320}});
            expect(second.store.state.recordRepairs).toEqual([]);
        });

        it("记录里的坏值：读不进的那一项当缺省、布局照用，有一条修掉的说明；下次保存写回归一后的值，说明就没了", async () => {
            const w = await world();
            const first = await openLayoutDoc(w, "a", "c", false, new Map());
            first.store.actions.acceptViewContainers(GROUPS);
            first.store.actions.acceptViewCatalog(VIEWS);
            expand(first.store, 320);
            const stored = JSON.parse(JSON.stringify(first.store.actions.document())) as {panels: Record<string, {rail?: unknown}>};
            (stored.panels.auxiliarybar as {rail?: unknown}).rail = {[X1]: {expanded: "yes", width: 320}};
            const opened = await first.storage.open(USER);
            if (!opened.ok) throw new Error(opened.detail);
            await opened.handle.save({doc: stored}, {expect: null});

            const second = await openLayoutDoc(w, "b", "c", false, new Map());
            second.store.actions.acceptViewContainers(GROUPS);
            second.store.actions.acceptViewCatalog(VIEWS);
            expect(second.store.state.problems).toEqual([]);
            expect(second.store.state.recordRepairs).toHaveLength(1);
            expect(second.store.actions.document().panels.auxiliarybar?.rail).toEqual({[X1]: {width: 320}});
            second.store.actions.setPartHidden("panel", true);
            await second.store.actions.save();
            expect((await savedDoc(second.storage, USER)).panels.auxiliarybar?.rail).toEqual({[X1]: {width: 320}});
            expect(second.store.state.recordRepairs).toEqual([]);
        });

        it("“移到”带着它，“重置”回到声明的区域时清掉它", async () => {
            const {store} = await open();
            expand(store, 300);
            expect(store.actions.moveContainer(X1, "sidebar").ok).toBe(true);
            expect(anchorOf(store, "sidebar")?.rail).toEqual({[X1]: {expanded: true, width: 300}});
            expect(anchorOf(store, "auxiliarybar")?.rail).toBeUndefined();
            expect(store.actions.resetContainer(X1, "auxiliarybar").ok).toBe(true);
            expect(containersIn(store.actions.document(), "auxiliarybar").map(([id]) => id)).toEqual([X1]);
            expect(anchorOf(store, "auxiliarybar")?.rail).toBeUndefined();
            expect(anchorOf(store, "sidebar")?.rail).toBeUndefined();
        });
    });
});

/** 区域在骨架里占的那个节点的尺寸意图：区域里的分节在这个节点里面分。 */
function regionSize(doc: DeepReadonly<LayoutDoc>, region: PanelName): {width: number; height: number} {
    const hit = regionNodeOf(doc as LayoutDoc, region);
    if (hit === null) throw new Error(`没有 ${region}`);
    return hit.node.size;
}

function sizeIn(doc: DeepReadonly<LayoutDoc>, id: string): {width: number; height: number} {
    const walk = (node: DeepReadonly<LayoutDoc["tree"]["root"]>): {width: number; height: number} | null => {
        if (node.id === id) return node.size;
        if (node.kind === "leaf") return null;
        for (const child of node.children) {
            const found = walk(child);
            if (found !== null) return found;
        }
        return null;
    };
    const found = walk(doc.tree.root);
    if (found === null) throw new Error(`树里没有 ${id}`);
    return found;
}

/** 把侧栏的唯一标签拆到目标外缘：一次改变树结构的操作。 */
function moveFirstTabToEdge(doc: LayoutDoc, target: {readonly kind: "split"; readonly panel: string; readonly edge: "bottom"}): LayoutResult {
    return moveTabToEdge(doc, {tab: "view:test.side", target}, POLICY);
}
