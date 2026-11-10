/**
 * 一棵树的布局 store（docs/specs/ui/workbench-layout.md“状态与转换”“副作用与数据”，验收 5、11、12、13）：真实内核、真实 `nbook.storage` 与 SQLite。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {Database} from "bun:sqlite";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import type {DeepReadonly} from "@vue/reactivity";
import {Type} from "typebox";

import {barRef, GRID_SNAPSHOT_VERSION, insertTab, moveTabToEdge, panelRef, regionNodeOf, removeTab, validateLayoutDoc} from "@notnotype/nb-layout";
import type {LayoutDoc, LayoutResult, PanelName, TabRef} from "@notnotype/nb-layout";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld} from "nbook/plugins/storage/testing/world";
import {defineRecord} from "nbook/shared/storage";
import type {RecordDefinition, StorageService} from "nbook/shared/storage";

import {BUSY_LAYOUT_CATALOG, openLayoutDoc} from "../testing/layout-doc";
import {regionContainers, viewSection} from "./containers";
import {PANEL_HEAD_HEIGHT} from "./layout-constraints";
import type {ViewCatalog} from "../views/registry";
import {createLayoutPolicy} from "./layout-constraints";
import type {LayoutDocStore} from "./layout-doc-store";
import {fitsSkeleton, INITIAL_EDITOR_PANEL} from "./default-tree";
import {sidebarColumnPanels} from "./layout-present";
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
    if (!checked.ok) throw new Error(checked.detail);
    return checked.doc;
}

const settled = (store: LayoutDocStore) => waitUntil("保存完成", () => store.state.field.queue === 0);
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
        expect(second.store.state.problems[0]?.kind).toBe("unread");
        expect(validateLayoutDoc(second.store.state.doc).ok).toBe(true);
        second.store.actions.setPartHidden("panel", true);
        await second.store.actions.save();
        expect(await read(second.storage, USER)).toEqual({doc: {version: 1, tree: "坏的"}});
    });

    /** 合法但不合骨架的文档：面板跑到了编辑组旁边（片 7c 之前能拖出来）。 */
    function outsideSkeleton(doc: LayoutDoc): LayoutDoc {
        const moved = moveTabToEdge(doc, {tab: "view:test.panel", target: {kind: "split", panel: "g0", edge: "right"}}, {...POLICY, accepts: () => true});
        if (!moved.ok) throw new Error(moved.detail);
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

    it("“移动到”的新面板：挨着侧栏的分节放下面，是侧栏当前容器的又一个分节；搬空的区域隐藏；编辑组是 rejected，不存在的是 not-found（输出 23、35、43）", async () => {
        const w = await world();
        const {store} = await openLayoutDoc(w, "a", "c");
        const inSide = store.actions.moveView("test.panel", {newPanelNextTo: sectionOf(store, "test.side")});
        if (!inSide.ok) throw new Error(inSide.detail);
        expect(sidebarColumnPanels(store.actions.document())).toHaveLength(2);
        expect(containersIn(store.actions.document(), "sidebar")).toEqual([["view:test.side", ["test.side", "test.panel"]]]);
        expect(store.actions.document().panels.panel).toMatchObject({hidden: true, activeContainer: null});
        expect(fitsSkeleton(store.actions.document())).toBe(true);
        expect(store.actions.moveView("test.side", {newPanelNextTo: INITIAL_EDITOR_PANEL})).toMatchObject({ok: false, code: "rejected"});
        expect(store.actions.moveView("test.side", {newPanelNextTo: "nowhere"})).toMatchObject({ok: false, code: "not-found"});
    });

    it("新面板挨着一块不在当前容器里的分节：进那块分节的容器，区域切过去并显示（输出 23）", async () => {
        const w = await world();
        const {store} = await openLayoutDoc(w, "a", "c");
        const side = sectionOf(store, "test.side");
        expect(store.actions.apply((doc) => moveTabToEdge(doc, {tab: "view:test.aux", target: {kind: "split", panel: side, edge: "bottom"}, container: "view:test.aux"}, POLICY)).ok).toBe(true);
        expect(store.actions.document().panels.sidebar?.activeContainer).toBe("view:test.side");
        store.actions.setPartHidden("sidebar", true);
        expect(store.actions.moveView("test.panel", {newPanelNextTo: sectionOf(store, "test.aux")}).ok).toBe(true);
        const doc = store.actions.document();
        expect(containersIn(doc, "sidebar")).toEqual([["view:test.side", ["test.side"]], ["view:test.aux", ["test.aux", "test.panel"]]]);
        expect(doc.panels.sidebar).toMatchObject({activeContainer: "view:test.aux"});
        expect(doc.panels.sidebar?.hidden).toBeUndefined();
        expect(fitsSkeleton(doc)).toBe(true);
    });

    it("移到一个区域：成为它当前容器最后一个分节，区域隐藏着就显示（输出 23）", async () => {
        const w = await world();
        const {store} = await openLayoutDoc(w, "a", "c");
        hideAux(store);
        expect(store.actions.moveView("test.side", "auxiliarybar").ok).toBe(true);
        const doc = store.actions.document();
        expect(containersIn(doc, "auxiliarybar")).toEqual([["view:test.aux", ["test.aux", "test.side"]]]);
        expect(doc.panels.auxiliarybar?.hidden).toBeUndefined();
        expect(doc.panels.sidebar).toMatchObject({hidden: true, activeContainer: null});
        expect(fitsSkeleton(doc)).toBe(true);
    });

    it("移到一个容器都没有的区域：进它自己的容器，区域显示；重置位置回到声明的容器（输出 23）", async () => {
        const w = await world();
        const {store} = await openLayoutDoc(w, "a", "c", false, new Map([...BUSY_LAYOUT_CATALOG].filter(([id]) => id !== "test.panel")));
        expect(store.actions.document().panels.panel?.hidden).toBe(true);
        expect(store.actions.moveView("test.side", "panel").ok).toBe(true);
        expect(containersIn(store.actions.document(), "panel")).toEqual([["view:test.side", ["test.side"]]]);
        expect(store.actions.document().panels.panel).toMatchObject({activeContainer: "view:test.side"});
        expect(store.actions.document().panels.panel?.hidden).toBeUndefined();
        expect(store.actions.moveView("test.side", "auxiliarybar").ok).toBe(true);
        expect(store.actions.resetView("test.side").ok).toBe(true);
        expect(containersIn(store.actions.document(), "sidebar")).toEqual([["view:test.side", ["test.side"]]]);
        expect(store.actions.document().panels.sidebar?.hidden).toBeUndefined();
    });

    it("标签换一位：活动标签不变，到头了不动（输出 20）", async () => {
        // 区域里一个分节一个标签；几个标签的工具面板只有浮动窗。
        const w = await world();
        const {store} = await openLayoutDoc(w, "a", "c");
        expect((await store.actions.floatTab("view:test.side")).ok).toBe(true);
        const float = store.actions.document().floats[0]?.panel ?? "";
        expect(store.actions.moveView("test.panel", float).ok).toBe(true);
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

        expect(store.actions.moveView("test.panel", {newPanelNextTo: section}).ok).toBe(true);
        store.actions.setCollapsed(section, true);
        expect(store.actions.document().panels[section]?.collapsed).toBe(true);
        store.actions.activate("view:test.side");
        expect(store.actions.document().panels[section]?.collapsed).toBeUndefined();

        // 记录里留着收起、此刻却是唯一显示的分节：它没收起，点标题不动这条记录；另一个分节回来时它还是标题行。
        store.actions.setCollapsed(section, true);
        expect(store.actions.resetView("test.panel").ok).toBe(true);
        store.actions.activate("view:test.side");
        expect(store.actions.document().panels[section]?.collapsed).toBe(true);
    });

    it("浮动窗回到停靠：视图各回声明的容器，一个标签一个分节，看得见的是窗的活动标签那个容器（输出 39）", async () => {
        const w = await world();
        const {store} = await openLayoutDoc(w, "a", "c");
        expect((await store.actions.floatTab("view:test.side")).ok).toBe(true);
        const float = store.actions.document().floats[0]?.panel ?? "";
        expect(store.actions.moveView("test.aux", float).ok).toBe(true);
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
        expect(store.actions.moveView("test.panel", sectionOf(store, "test.aux")).ok).toBe(true);
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
        // 区域只显示一个分节时，呈现树里代表区域的就是这个分节：尺寸写给区域，拖到零记在锚上，分节自己不变成标题行（输出 11）。
        store.actions.commitGesture({[side]: {width: 222, height: 878}}, {[aux]: true});
        await settled(store);
        const saved = await savedDoc(storage, USER);
        expect(regionSize(saved, "sidebar").width).toBe(222);
        expect(saved.panels.auxiliarybar?.collapsed).toBe(true);
        expect(saved.panels[aux]?.collapsed).toBeUndefined();
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
        expect(store.actions.moveView("test.panel", {newPanelNextTo: side}).ok).toBe(true);
        const lower = sectionOf(store, "test.panel");
        const before = sizeIn(store.actions.document(), lower).height;
        store.actions.commitGesture({[side]: {width: 260, height: 800 - PANEL_HEAD_HEIGHT}, [lower]: {width: 260, height: PANEL_HEAD_HEIGHT}}, {[lower]: true});
        await settled(store);
        const saved = await savedDoc(storage, USER);
        expect(saved.panels[lower]?.collapsed).toBe(true);
        expect(saved.panels.sidebar?.collapsed).toBeUndefined();
        expect(sizeIn(saved, lower).height).toBe(before);
        // 拉回时呈现的高度才是新的意图。
        store.actions.commitGesture({[side]: {width: 260, height: 500}, [lower]: {width: 260, height: 300}}, {[lower]: false});
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
        // 拖面板的高度：侧栏、右栏这次没动，还是压缩的结果。
        store.actions.commitGesture({...squeezed, g0: {width: 300, height: 400}, [lower]: {width: 300, height: 300}}, {});
        expect(widths()).toEqual(before);
        expect(regionSize(store.actions.document(), "panel").height).toBe(300);
        // 拖侧栏的边界：写。
        store.actions.commitGesture({...squeezed, [side]: {width: 200, height: 700}, g0: {width: 260, height: 400}, [lower]: {width: 260, height: 300}}, {});
        expect(regionSize(store.actions.document(), "sidebar").width).toBe(200);
    });

    it("最大化的分节被搬走、或要显示被它盖住的区域：退出最大化，不把工作台留在全都看不见的样子（输出 13）", async () => {
        const {store} = await open();
        const side = sectionOf(store, "test.side");
        store.actions.toggleMaximized(side);
        expect(store.state.maximized).toBe(side);
        expect(store.actions.moveView("test.side", "auxiliarybar").ok).toBe(true);
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
