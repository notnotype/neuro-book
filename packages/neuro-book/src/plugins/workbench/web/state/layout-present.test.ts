import {describe, expect, test} from "bun:test";
import {openPanelAtEdge} from "@notnotype/nb-layout";
import type {GridExtent, LayoutDoc} from "@notnotype/nb-layout";

import {workbenchText} from "../../shared/text";
import {defaultLayoutDoc} from "./default-tree";
import {effectiveVisibleTabs, layoutContents, moveTargetsOf, panelTitle, sidebarColumnPanels, toolEntryIntent} from "./layout-present";
import {createLayoutPolicy, PANEL_HEAD_HEIGHT} from "./layout-constraints";
import type {ViewCatalog} from "../views/registry";

const CATALOG: ViewCatalog = new Map([
    ["files", {title: {"zh-CN": "文件", "en-US": "Files"}, icon: "i-a", location: "sidebar", layout: "scroll"}],
    ["outline", {title: {"zh-CN": "大纲", "en-US": "Outline"}, icon: "i-b", location: "sidebar", layout: "scroll"}],
    ["chat", {title: {"zh-CN": "对话", "en-US": "Chat"}, icon: "i-c", location: "auxiliarybar", layout: "fill"}],
    ["output", {title: {"zh-CN": "输出", "en-US": "Output"}, icon: "i-d", location: "panel", layout: "scroll"}],
]);

const doc = (): LayoutDoc => defaultLayoutDoc(CATALOG);
const ROOMY: GridExtent = {width: 300, height: 400};
const SIZES = {sidebar: ROOMY, auxiliarybar: ROOMY, panel: ROOMY, g0: ROOMY};
const FACTS = {sizes: SIZES, preview: null, removed: new Set<string>(), maximized: null};

function withPanel(base: LayoutDoc, id: string, patch: Partial<LayoutDoc["panels"][string]>): LayoutDoc {
    return {...base, panels: {...base.panels, [id]: {...base.panels[id], ...patch} as LayoutDoc["panels"][string]}};
}

describe("内容项", () => {
    test("工具视图一个标签一项，只有活动标签是 active；编辑组一块面板一项", () => {
        const contents = layoutContents(doc());
        expect(contents.filter((item) => item.leaf === "sidebar").map((item) => [item.key, item.active, item.insetTop])).toEqual([
            ["view:files", true, PANEL_HEAD_HEIGHT],
            ["view:outline", false, PANEL_HEAD_HEIGHT],
        ]);
        expect(contents.filter((item) => item.leaf === "g0")).toEqual([{key: "editor:g0", leaf: "g0", insetTop: 0, active: true}]);
    });

    test("有标签的编辑组每个标签一项，活动标签的那项活动，上边让出这组的头", () => {
        const base = doc();
        const group = base.panels.g0;
        if (group === undefined) throw new Error("默认树没有 g0");
        const withTabs: LayoutDoc = {...base, panels: {...base.panels, g0: {...group, tabs: [{kind: "tab", type: "editor", tabId: "a"}, {kind: "tab", type: "editor", tabId: "b"}], active: "tab:b"}}};
        expect(layoutContents(withTabs, () => 34).filter((item) => item.leaf === "g0")).toEqual([
            {key: "tab:a", leaf: "g0", insetTop: 34, active: false},
            {key: "tab:b", leaf: "g0", insetTop: 34, active: true},
        ]);
    });
});

describe("面板写给人看的名字", () => {
    test("一块编辑组写“编辑区”；几块时按树序写序号，不然“移动到”的目标分不出来", () => {
        expect(panelTitle(doc(), CATALOG, "g0")).toEqual(workbenchText("viewCommands.parts.editor"));
        const split = openPanelAtEdge(doc(), {id: "g1", panel: {role: "editor", tabs: [], active: null}, target: {kind: "split", panel: "g0", edge: "left"}}, createLayoutPolicy());
        if (!split.ok) throw new Error(split.detail);
        expect(panelTitle(split.doc, CATALOG, "g1")).toEqual(workbenchText("viewCommands.parts.editorAt", {index: 1}));
        expect(panelTitle(split.doc, CATALOG, "g0")).toEqual(workbenchText("viewCommands.parts.editorAt", {index: 2}));
    });
});

describe("有效可见", () => {
    test("只有活动标签可见，切走的不算", () => {
        const visible = effectiveVisibleTabs(doc(), FACTS);
        expect(visible.has("view:files")).toBe(true);
        expect(visible.has("view:outline")).toBe(false);
        expect(visible.has("view:chat")).toBe(true);
    });

    test("隐藏、收起、放不下被收走、被最大化盖住都不算", () => {
        expect(effectiveVisibleTabs(withPanel(doc(), "sidebar", {hidden: true}), FACTS).has("view:files")).toBe(false);
        expect(effectiveVisibleTabs(withPanel(doc(), "sidebar", {collapsed: true}), FACTS).has("view:files")).toBe(false);
        expect(effectiveVisibleTabs(doc(), {...FACTS, removed: new Set(["sidebar"])}).has("view:files")).toBe(false);
        const covered = effectiveVisibleTabs(doc(), {...FACTS, maximized: "panel"});
        expect([...covered]).toEqual(["view:output"]);
    });

    test("收成标题行的尺寸没有内容的地方：不可见；拉回时按拖动中的几何", () => {
        const collapsed = withPanel(doc(), "panel", {collapsed: true});
        const sizes = {...SIZES, panel: {width: 600, height: PANEL_HEAD_HEIGHT}};
        expect(effectiveVisibleTabs(collapsed, {...FACTS, sizes}).has("view:output")).toBe(false);
        // 拉到正好一行头：内容还没地方。
        expect(effectiveVisibleTabs(collapsed, {...FACTS, sizes, preview: sizes}).has("view:output")).toBe(false);
        const pulled = {...sizes, panel: {width: 600, height: 120}};
        expect(effectiveVisibleTabs(collapsed, {...FACTS, sizes, preview: pulled}).has("view:output")).toBe(true);
    });

    test("手势预览不改已经可见的面板：往零拖过阈值时还算可见", () => {
        const zeroed = {...SIZES, sidebar: {width: 0, height: 400}};
        expect(effectiveVisibleTabs(doc(), {...FACTS, preview: zeroed}).has("view:files")).toBe(true);
    });

    test("最大化的面板收起过也算可见：盖在上面，内容有地方", () => {
        const collapsed = withPanel(doc(), "panel", {collapsed: true});
        expect(effectiveVisibleTabs(collapsed, {...FACTS, maximized: "panel"}).has("view:output")).toBe(true);
    });
});

describe("活动栏条目", () => {
    const facts = (visible: ReadonlyArray<string>) => ({visible: new Set(visible)});

    test("不可见显示，可见的具名面板隐藏", () => {
        expect(toolEntryIntent(doc(), "outline", facts(["view:files"]))).toEqual({kind: "reveal", panel: "sidebar"});
        expect(toolEntryIntent(doc(), "files", facts(["view:files"]))).toEqual({kind: "hide", panel: "sidebar"});
    });

    test("无名面板没有隐藏，是收起", () => {
        const base = doc();
        const {name: _name, ...anonymous} = base.panels.sidebar as NonNullable<LayoutDoc["panels"][string]>;
        const moved: LayoutDoc = {...base, panels: {...base.panels, sidebar: anonymous}};
        expect(toolEntryIntent(moved, "files", facts(["view:files"]))).toEqual({kind: "collapse", panel: "sidebar"});
    });

    test("目录里有、树上没有的视图什么都不做", () => {
        expect(toolEntryIntent(doc(), "missing", facts([]))).toEqual({kind: "none"});
    });

    test("侧栏这一列：没分时是它自己，分了是这一列的全部，按树序", () => {
        expect(sidebarColumnPanels(doc())).toEqual(["sidebar"]);
        const split = openPanelAtEdge(doc(), {id: "x", panel: {role: "tool", tabs: [], active: null}, target: {kind: "split", panel: "sidebar", edge: "top"}}, createLayoutPolicy());
        if (!split.ok) throw new Error(split.detail);
        expect(sidebarColumnPanels(split.doc)).toEqual(["x", "sidebar"]);
    });
});

describe("移动到的目标", () => {
    test("新面板只挨着工具面板：编辑组旁边不是目标", () => {
        const targets = moveTargetsOf(doc(), "outline") ?? [];
        expect(targets.some((target) => target.kind === "new-panel" && target.nextTo === "g0")).toBe(false);
        expect(targets).toContainEqual({kind: "new-panel", nextTo: "sidebar"});
        expect(targets).toContainEqual({kind: "panel", panel: "auxiliarybar"});
        expect(targets.some((target) => target.kind === "panel" && target.panel === "g0")).toBe(false);
    });
});
