import {describe, expect, test} from "bun:test";
import {findTab, floatTab, moveTabToStrip, openPanelAtEdge, setActiveContainer, setFloatRect} from "@notnotype/nb-layout";
import type {GridExtent, LayoutDoc} from "@notnotype/nb-layout";

import {workbenchText} from "../../shared/text";
import {defaultLayoutDoc} from "./default-tree";
import {effectiveVisibleTabs, layoutContents, layoutStructureKey, moveTargetsOf, panelTitle, sidebarColumnPanels, toolEntryIntent} from "./layout-present";
import {createLayoutPolicy, PANEL_HEAD_HEIGHT} from "./layout-constraints";
import type {ViewCatalog} from "../views/registry";

const CATALOG: ViewCatalog = new Map([
    ["files", {title: {"zh-CN": "文件", "en-US": "Files"}, icon: "i-a", location: "sidebar", layout: "scroll"}],
    ["outline", {title: {"zh-CN": "大纲", "en-US": "Outline"}, icon: "i-b", location: "sidebar", layout: "scroll"}],
    ["chat", {title: {"zh-CN": "对话", "en-US": "Chat"}, icon: "i-c", location: "auxiliarybar", layout: "fill"}],
    ["output", {title: {"zh-CN": "输出", "en-US": "Output"}, icon: "i-d", location: "panel", layout: "scroll"}],
]);

/** 四个视图都没写容器：各在自己的隐式容器里，侧栏的当前容器是“文件”那个，“大纲”那个没显示。 */
const doc = (): LayoutDoc => defaultLayoutDoc(CATALOG);
/** 视图所在的分节。 */
const sectionOf = (current: LayoutDoc, viewId: string): string => {
    const found = findTab(current, `view:${viewId}`);
    if (found === null) throw new Error(`文档里没有 ${viewId}`);
    return found.panel;
};
const FILES = sectionOf(doc(), "files");
const OUTLINE = sectionOf(doc(), "outline");
const CHAT = sectionOf(doc(), "chat");
const OUTPUT = sectionOf(doc(), "output");
const ROOMY: GridExtent = {width: 300, height: 400};
const SIZES = {[FILES]: ROOMY, [OUTLINE]: ROOMY, [CHAT]: ROOMY, [OUTPUT]: ROOMY, g0: ROOMY};
const FACTS = {sizes: SIZES, preview: null, removed: new Set<string>(), maximized: null};

function withPanel(base: LayoutDoc, id: string, patch: Partial<LayoutDoc["panels"][string]>): LayoutDoc {
    return {...base, panels: {...base.panels, [id]: {...base.panels[id], ...patch} as LayoutDoc["panels"][string]}};
}

describe("内容项", () => {
    test("工具视图一个标签一项，只有活动标签是 active；锚没有内容项；编辑组一块面板一项", () => {
        // 区域里一个分节一个标签；几个标签的工具面板只有浮动窗。
        const floated = floatTab(doc(), {tab: "view:files", rect: {x: 0, y: 0, width: 300, height: 200}}, createLayoutPolicy());
        if (!floated.ok) throw new Error(floated.detail);
        const float = sectionOf(floated.doc, "files");
        const joined = moveTabToStrip(floated.doc, {tab: "view:outline", panel: float, index: 1, activate: false}, createLayoutPolicy());
        if (!joined.ok) throw new Error(joined.detail);
        const contents = layoutContents(joined.doc);
        expect(contents.filter((item) => item.leaf === float).map((item) => [item.key, item.active, item.insetTop])).toEqual([
            ["view:files", true, PANEL_HEAD_HEIGHT],
            ["view:outline", false, PANEL_HEAD_HEIGHT],
        ]);
        expect(contents.filter((item) => item.leaf === CHAT).map((item) => [item.key, item.active, item.insetTop])).toEqual([["view:chat", true, PANEL_HEAD_HEIGHT]]);
        expect(contents.filter((item) => ["sidebar", "auxiliarybar", "panel"].includes(item.leaf))).toEqual([]);
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

describe("浮动窗", () => {
    const floated = (): LayoutDoc => {
        const result = floatTab(doc(), {tab: "view:output", rect: {x: 0, y: 0, width: 300, height: 200}}, createLayoutPolicy());
        if (!result.ok) throw new Error(result.detail);
        return result.doc;
    };
    const panelOf = (current: LayoutDoc): string => current.floats[0]?.panel ?? "";

    test("活动标签可见：不在呈现尺寸里也算，别的面板最大化时也算", () => {
        const current = floated();
        expect(effectiveVisibleTabs(current, {sizes: {}, preview: null, removed: new Set(), maximized: null}).has("view:output")).toBe(true);
        expect(effectiveVisibleTabs(current, {sizes: {}, preview: null, removed: new Set(), maximized: "g0"}).has("view:output")).toBe(true);
    });

    test("结构键含窗：开一个窗拖动就取消；只改矩形不算", () => {
        const current = floated();
        expect(layoutStructureKey(current)).not.toBe(layoutStructureKey(doc()));
        const moved = setFloatRect(current, {panel: panelOf(current), rect: {x: 50, y: 50, width: 300, height: 200}});
        expect(moved.ok && layoutStructureKey(moved.doc)).toBe(layoutStructureKey(current));
    });

    test("浮动的编辑组写“浮动编辑区”，不写序号；树里的序号不算它", () => {
        const base = doc();
        const withTabs: LayoutDoc = {...base, panels: {...base.panels, g0: {role: "editor", tabs: [{kind: "tab", type: "editor", tabId: "x"}, {kind: "tab", type: "editor", tabId: "y"}], active: "tab:x"}}};
        const result = floatTab(withTabs, {tab: "tab:y", rect: {x: 0, y: 0, width: 300, height: 200}}, createLayoutPolicy());
        if (!result.ok) throw new Error(result.detail);
        expect(panelTitle(result.doc, CATALOG, panelOf(result.doc))).toEqual(workbenchText("viewCommands.parts.editorFloat"));
        expect(panelTitle(result.doc, CATALOG, "g0")).toEqual(workbenchText("viewCommands.parts.editor"));
    });
});

describe("有效可见", () => {
    test("区域里只有当前容器的分节可见，别的容器的不算；切换容器之后反过来（输出 17、42）", () => {
        const visible = effectiveVisibleTabs(doc(), FACTS);
        expect(visible.has("view:files")).toBe(true);
        expect(visible.has("view:outline")).toBe(false);
        expect(visible.has("view:chat")).toBe(true);
        const switched = setActiveContainer(doc(), "sidebar", "view:outline");
        if (!switched.ok) throw new Error(switched.detail);
        const after = effectiveVisibleTabs(switched.doc, FACTS);
        expect(after.has("view:files")).toBe(false);
        expect(after.has("view:outline")).toBe(true);
    });

    test("区域隐藏、区域拖到零、分节收起、放不下被收走、被最大化盖住都不算", () => {
        expect(effectiveVisibleTabs(withPanel(doc(), "sidebar", {hidden: true}), FACTS).has("view:files")).toBe(false);
        expect(effectiveVisibleTabs(withPanel(doc(), "sidebar", {collapsed: true}), FACTS).has("view:files")).toBe(false);
        // “大纲”换进“文件”的容器：侧栏显示两个分节，“文件”收成标题行就不可见。
        const paired = withPanel(doc(), OUTLINE, {container: doc().panels[FILES]?.container as string});
        expect(effectiveVisibleTabs(paired, FACTS).has("view:files")).toBe(true);
        expect(effectiveVisibleTabs(withPanel(paired, FILES, {collapsed: true}), FACTS).has("view:files")).toBe(false);
        // 区域只显示它一个分节时收不成标题行（输出 11）：记录里留着 `collapsed` 也照常可见。
        expect(effectiveVisibleTabs(withPanel(doc(), FILES, {collapsed: true}), FACTS).has("view:files")).toBe(true);
        expect(effectiveVisibleTabs(doc(), {...FACTS, removed: new Set([FILES])}).has("view:files")).toBe(false);
        const covered = effectiveVisibleTabs(doc(), {...FACTS, maximized: OUTPUT});
        expect([...covered]).toEqual(["view:output"]);
    });

    test("收成标题行的尺寸没有内容的地方：不可见；拉回时按拖动中的几何", () => {
        const collapsed = withPanel(doc(), FILES, {collapsed: true});
        const sizes = {...SIZES, [FILES]: {width: 300, height: PANEL_HEAD_HEIGHT}};
        expect(effectiveVisibleTabs(collapsed, {...FACTS, sizes}).has("view:files")).toBe(false);
        // 拉到正好一行头：内容还没地方。
        expect(effectiveVisibleTabs(collapsed, {...FACTS, sizes, preview: sizes}).has("view:files")).toBe(false);
        const pulled = {...sizes, [FILES]: {width: 300, height: 120}};
        expect(effectiveVisibleTabs(collapsed, {...FACTS, sizes, preview: pulled}).has("view:files")).toBe(true);
    });

    test("区域从零拉回时按拖动中的几何：还没松手，内容就出现（输出 12）", () => {
        const zeroed = withPanel(doc(), "sidebar", {collapsed: true});
        const sizes = {...SIZES, [FILES]: {width: 0, height: 400}};
        expect(effectiveVisibleTabs(zeroed, {...FACTS, sizes, preview: sizes}).has("view:files")).toBe(false);
        expect(effectiveVisibleTabs(zeroed, {...FACTS, sizes, preview: {...sizes, [FILES]: {width: 200, height: 400}}}).has("view:files")).toBe(true);
    });

    test("手势预览不改已经可见的面板：往零拖过阈值时还算可见", () => {
        const zeroed = {...SIZES, [FILES]: {width: 0, height: 400}};
        expect(effectiveVisibleTabs(doc(), {...FACTS, preview: zeroed}).has("view:files")).toBe(true);
    });

    test("最大化的面板收起过也算可见：盖在上面，内容有地方", () => {
        const collapsed = withPanel(doc(), FILES, {collapsed: true});
        expect(effectiveVisibleTabs(collapsed, {...FACTS, maximized: FILES}).has("view:files")).toBe(true);
    });
});

describe("活动栏条目", () => {
    const facts = (visible: ReadonlyArray<string>) => ({visible: new Set(visible)});

    test("不可见显示，可见的隐藏：隐藏的是它所在的区域，条目给出视图所在的分节", () => {
        expect(toolEntryIntent(doc(), "outline", facts(["view:files"]))).toEqual({kind: "reveal", panel: OUTLINE});
        expect(toolEntryIntent(doc(), "files", facts(["view:files"]))).toEqual({kind: "hide", panel: FILES});
    });

    test("不在区域里的面板没有隐藏，是收起", () => {
        // 这一列里没有具名面板：它不是哪个区域。
        const base = doc();
        const {name: _name, entries: _entries, activeContainer: _active, ...anonymous} = base.panels.sidebar as NonNullable<LayoutDoc["panels"][string]>;
        const moved: LayoutDoc = {...base, panels: {...base.panels, sidebar: anonymous}};
        expect(toolEntryIntent(moved, "files", facts(["view:files"]))).toEqual({kind: "collapse", panel: FILES});
    });

    test("目录里有、树上没有的视图什么都不做", () => {
        expect(toolEntryIntent(doc(), "missing", facts([]))).toEqual({kind: "none"});
    });

    test("侧栏这一列：各个容器的分节，按树序；锚不在里面；侧栏一个视图都没有时是空的", () => {
        expect(sidebarColumnPanels(doc())).toEqual([FILES, OUTLINE]);
        const split = openPanelAtEdge(doc(), {id: "x", panel: {role: "tool", tabs: [{kind: "view", viewId: "extra"}], active: "view:extra", container: "view:files"}, target: {kind: "split", panel: FILES, edge: "top"}}, createLayoutPolicy());
        if (!split.ok) throw new Error(split.detail);
        expect(sidebarColumnPanels(split.doc)).toEqual(["x", FILES, OUTLINE]);
        expect(sidebarColumnPanels(defaultLayoutDoc(new Map()))).toEqual([]);
    });
});

describe("移动到的目标", () => {
    test("放进去的目标是别的区域；新面板只挨着显示着的分节：编辑组、锚、没显示的分节旁边都不是目标", () => {
        const targets = moveTargetsOf(doc(), "outline") ?? [];
        expect(targets.filter((target) => target.kind === "panel")).toEqual([{kind: "panel", panel: "panel"}, {kind: "panel", panel: "auxiliarybar"}]);
        expect(targets.filter((target) => target.kind === "new-panel")).toEqual([{kind: "new-panel", nextTo: FILES}, {kind: "new-panel", nextTo: OUTPUT}, {kind: "new-panel", nextTo: CHAT}]);
    });
});
