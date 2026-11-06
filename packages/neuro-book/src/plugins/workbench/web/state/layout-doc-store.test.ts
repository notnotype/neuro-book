/**
 * 一棵树的布局 store（docs/specs/ui/workbench-layout.md“状态与转换”“副作用与数据”，验收 5、11、12、13）：真实内核、真实 `nbook.storage` 与 SQLite。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {Database} from "bun:sqlite";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import type {DeepReadonly} from "@vue/reactivity";
import {Type} from "typebox";

import {insertTab, moveTabToEdge, removeTab, validateLayoutDoc} from "@notnotype/nb-layout";
import type {LayoutDoc, LayoutResult, TabRef} from "@notnotype/nb-layout";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld} from "nbook/plugins/storage/testing/world";
import {defineRecord} from "nbook/shared/storage";
import type {RecordDefinition, StorageService} from "nbook/shared/storage";

import {openLayoutDoc} from "../testing/layout-doc";
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

describe("默认与记录", () => {
    it("没有记录：默认树，有视图的具名面板显示，不写盘；校验通过", async () => {
        const w = await world();
        const {store, storage} = await openLayoutDoc(w, "w", "c");
        const doc = store.state.doc;
        expect(validateLayoutDoc(doc).ok).toBe(true);
        expect(doc.panels.sidebar?.hidden).toBeUndefined();
        expect(doc.panels.sidebar?.tabs).toEqual([{kind: "view", viewId: "test.side"}]);
        expect(await read(storage, USER)).toBe("missing");
        expect(store.state.problems).toEqual([]);
    });

    it("空的具名面板隐藏：第一次生成时才显示有视图的，之后新视图不把隐藏的面板打开", async () => {
        const w = await world();
        const {store} = await openLayoutDoc(w, "w", "c", false, new Map());
        expect(store.state.doc.panels.auxiliarybar?.hidden).toBe(true);
        store.actions.setPartHidden("sidebar", false);
        const later: ViewCatalog = new Map([["test.aux", {title: {"zh-CN": "大纲", "en-US": "Outline"}, icon: "i", location: "auxiliarybar", layout: "scroll"}]]);
        store.actions.acceptViewCatalog(later);
        expect(store.state.doc.panels.auxiliarybar?.tabs).toEqual([{kind: "view", viewId: "test.aux"}]);
        expect(store.state.doc.panels.auxiliarybar?.hidden).toBe(true);
    });

    it("写了就能恢复；声明消失的视图留在文档里", async () => {
        const w = await world();
        const first = await openLayoutDoc(w, "a", "c");
        hideAux(first.store);
        await first.store.actions.save();
        await settled(first.store);
        const second = await openLayoutDoc(w, "b", "c", false, new Map());
        expect(second.store.state.doc.panels.auxiliarybar?.hidden).toBe(true);
        expect(second.store.state.doc.panels.auxiliarybar?.tabs).toEqual([{kind: "view", viewId: "test.aux"}]);
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

    it("“移动到”的新面板：这一列放下面，这一排放右边；编辑组是 rejected，不存在的是 not-found（输出 23、35）", async () => {
        const w = await world();
        const {store} = await openLayoutDoc(w, "a", "c");
        const inSide = store.actions.moveView("test.panel", {newPanelNextTo: "sidebar"});
        if (!inSide.ok) throw new Error(inSide.detail);
        expect(sidebarColumnPanels(store.actions.document())).toHaveLength(2);
        expect(fitsSkeleton(store.actions.document())).toBe(true);
        expect(store.actions.moveView("test.side", {newPanelNextTo: INITIAL_EDITOR_PANEL})).toMatchObject({ok: false, code: "rejected"});
        expect(store.actions.moveView("test.side", {newPanelNextTo: "nowhere"})).toMatchObject({ok: false, code: "not-found"});
    });

    it("标签换一位：活动标签不变，到头了不动（输出 20）", async () => {
        const w = await world();
        const {store} = await openLayoutDoc(w, "a", "c");
        expect(store.actions.moveView("test.panel", "sidebar").ok).toBe(true);
        const tabs = (): ReadonlyArray<unknown> => store.actions.document().panels.sidebar?.tabs ?? [];
        const before = tabs();
        const active = store.actions.document().panels.sidebar?.active;
        expect(store.actions.reorderTab("view:test.panel", 1).ok).toBe(true);
        expect(tabs()).toEqual(before);
        expect(store.actions.reorderTab("view:test.panel", -1).ok).toBe(true);
        expect(tabs()).toEqual([before[1], before[0]]);
        expect(store.actions.document().panels.sidebar?.active).toBe(active);
    });

    it("点标签：面板收成标题行时一起展开（输出 11）", async () => {
        const w = await world();
        const {store} = await openLayoutDoc(w, "a", "c");
        store.actions.setCollapsed("sidebar", true);
        expect(store.actions.document().panels.sidebar?.collapsed).toBe(true);
        store.actions.activate("view:test.side");
        expect(store.actions.document().panels.sidebar?.collapsed).toBeUndefined();
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
        expect(store.actions.toggleMaximized("sidebar")).toBe(true);
        expect(store.state.maximized).toBe("sidebar");
        expect(store.state.field.queue).toBe(0);
        expect(await read(storage, USER)).toBe("missing");
        store.actions.apply((doc) => insertTab(doc, {panel: INITIAL_EDITOR_PANEL, tab: editorTab("t1")}));
        expect(store.state.maximized).toBe("sidebar");
        store.actions.setPartHidden("auxiliarybar", true);
        expect(store.state.maximized).toBe("sidebar");
        store.actions.apply((doc) => {
            const target = {kind: "split", panel: "auxiliarybar", edge: "bottom"} as const;
            return moveFirstTabToEdge(doc, target);
        });
        expect(store.state.maximized).toBeNull();
    });

    it("具名面板的可见：隐藏、拖到零、被盖住、放不下被收走都不算，收成标题行算", async () => {
        const {store} = await open();
        expect(store.actions.partVisible("panel")).toBe(true);
        store.actions.setCollapsed("panel", true);
        expect(store.actions.partVisible("panel")).toBe(true);
        store.actions.setCollapsed("sidebar", true);
        expect(store.actions.partVisible("sidebar")).toBe(false);
        store.actions.setCollapsed("sidebar", false);
        store.actions.toggleMaximized("sidebar");
        expect(store.actions.partVisible("auxiliarybar")).toBe(false);
        expect(store.actions.partVisible("sidebar")).toBe(true);
        store.actions.toggleMaximized("sidebar");
        store.actions.acceptExtent({width: 500, height: 800});
        expect(store.state.collapse.removed.has("auxiliarybar")).toBe(true);
        expect(store.actions.partVisible("auxiliarybar")).toBe(false);
        store.actions.setPartHidden("sidebar", true);
        expect(store.actions.partVisible("sidebar")).toBe(false);
        expect(store.actions.partVisible("statusbar")).toBe(true);
    });

    it("放不下只改呈现：不写文档；放大回来；把最大化的面板收走时退出最大化", async () => {
        const {store} = await open();
        const before = store.state.doc;
        store.actions.toggleMaximized("auxiliarybar");
        store.actions.acceptExtent({width: 500, height: 800});
        expect(store.state.projection.input.kind).toBe("branch");
        expect(JSON.stringify(store.state.projection.input)).not.toContain("auxiliarybar");
        expect(store.state.doc).toBe(before);
        expect(store.state.field.queue).toBe(0);
        expect(store.state.maximized).toBeNull();
        store.actions.acceptExtent({width: 1440, height: 900});
        expect(JSON.stringify(store.state.projection.input)).toContain("auxiliarybar");
    });

    it("结构操作之前把呈现尺寸写回意图；手势落账立刻存，收起状态来自手势", async () => {
        const {store, storage} = await open();
        store.actions.acceptExtent({width: 1440, height: 900});
        // 吸收余量的节点：呈现尺寸就是这一刻的份额。保留像素的节点见下面“被压缩的尺寸不是意图”。
        store.actions.acceptPresented({g0: {width: 611, height: 600}});
        store.actions.setCollapsed("panel", true);
        expect(sizeIn(store.state.doc, "g0").width).toBe(611);
        store.actions.commitGesture({sidebar: {width: 222, height: 878}}, {auxiliarybar: true});
        await settled(store);
        const saved = await savedDoc(storage, USER);
        expect(sizeIn(saved, "sidebar").width).toBe(222);
        expect(saved.panels.auxiliarybar?.collapsed).toBe(true);
    });

    it("手势把面板收成标题行：呈现的高度是标题行，不是意图，展开回到原来的高度（输出 8、12）", async () => {
        const {store, storage} = await open();
        const before = sizeIn(store.actions.document(), "panel").height;
        store.actions.commitGesture({panel: {width: 600, height: PANEL_HEAD_HEIGHT}}, {panel: true});
        await settled(store);
        const saved = await savedDoc(storage, USER);
        expect(saved.panels.panel?.collapsed).toBe(true);
        expect(sizeIn(saved, "panel").height).toBe(before);
        // 拉回时呈现的高度才是新的意图。
        store.actions.commitGesture({panel: {width: 600, height: 260}}, {panel: false});
        expect(sizeIn(store.actions.document(), "panel").height).toBe(260);
    });

    it("放不下时被压缩的尺寸不是意图：切标签、别处的手势都不写，这块自己被拖了才写（输出 8；验收 6）", async () => {
        const {store} = await open();
        const widths = () => [sizeIn(store.actions.document(), "sidebar").width, sizeIn(store.actions.document(), "auxiliarybar").width];
        const before = widths();
        const squeezed = {sidebar: {width: 160, height: 700}, auxiliarybar: {width: 160, height: 700}, g0: {width: 300, height: 500}, panel: {width: 300, height: 200}};
        store.actions.acceptPresented(squeezed);
        store.actions.setCollapsed("panel", false);
        store.actions.activate("view:test.side");
        expect(widths()).toEqual(before);
        // 拖面板的高度：侧栏、右栏这次没动，还是压缩的结果。
        store.actions.commitGesture({...squeezed, g0: {width: 300, height: 400}, panel: {width: 300, height: 300}}, {});
        expect(widths()).toEqual(before);
        expect(sizeIn(store.actions.document(), "panel").height).toBe(300);
        // 拖侧栏的边界：写。
        store.actions.commitGesture({...squeezed, sidebar: {width: 200, height: 700}, g0: {width: 260, height: 400}, panel: {width: 260, height: 300}}, {});
        expect(sizeIn(store.actions.document(), "sidebar").width).toBe(200);
    });

    it("最大化的面板被搬空、或要显示被它盖住的面板：退出最大化，不把工作台留在全都看不见的样子（输出 13）", async () => {
        const {store} = await open();
        store.actions.toggleMaximized("sidebar");
        expect(store.state.maximized).toBe("sidebar");
        expect(store.actions.moveView("test.side", "auxiliarybar").ok).toBe(true);
        expect(store.state.doc.panels.sidebar?.hidden).toBe(true);
        expect(store.state.maximized).toBeNull();
        expect(store.actions.partVisible("auxiliarybar")).toBe(true);

        store.actions.toggleMaximized("auxiliarybar");
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
