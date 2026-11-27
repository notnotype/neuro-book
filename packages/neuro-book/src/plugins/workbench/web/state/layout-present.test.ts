import {describe, expect, test} from "bun:test";
import {findTab, floatTab, moveTabToEdge, moveTabToStrip, openPanelAtEdge, setActiveContainer, setFloatRect, setPanelCollapsed, setPanelHidden} from "@notnotype/nb-workbench-layout";
import type {GridExtent} from "@notnotype/nb-layout";
import type {LayoutDoc} from "@notnotype/nb-workbench-layout";

import {workbenchText} from "../../shared/text";
import {defaultLayoutDoc} from "./default-tree";
import {moveContainerTo, sectionLanding, settleContainers} from "./containers";
import type {ContainerCatalog} from "./containers";
import type {VisibilityFacts} from "./layout-present";
import {effectiveVisibleTabs, focusLandings, isSoleWindow, layoutContents, layoutStructureKey, moveTargetsOf, panelTitle, regionEntries, regionEntryIntent, regionVisible, titleOnlyPanels} from "./layout-present";
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
        if (!floated.ok) throw new Error(floated.message);
        const float = sectionOf(floated.doc, "files");
        const joined = moveTabToStrip(floated.doc, {tab: "view:outline", panel: float, index: 1, activate: false}, createLayoutPolicy());
        if (!joined.ok) throw new Error(joined.message);
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

    test("画成并成一行的分节：头在入口条里，内容从叶的上边开始；别的照旧让出头（输出 47）", () => {
        const contents = layoutContents(doc(), () => 0, new Set([CHAT]));
        expect(contents.filter((item) => item.leaf === CHAT).map((item) => item.insetTop)).toEqual([0]);
        expect(contents.filter((item) => item.leaf === FILES).map((item) => item.insetTop)).toEqual([PANEL_HEAD_HEIGHT]);
    });
});

describe("面板写给人看的名字", () => {
    test("一块编辑组写“编辑区”；几块时按树序写序号，不然“移动到”的目标分不出来", () => {
        expect(panelTitle(doc(), CATALOG, "g0")).toEqual(workbenchText("viewCommands.parts.editor"));
        const split = openPanelAtEdge(doc(), {id: "g1", panel: {role: "editor", tabs: [], active: null}, target: {kind: "split", panel: "g0", edge: "left"}}, createLayoutPolicy());
        if (!split.ok) throw new Error(split.message);
        expect(panelTitle(split.doc, CATALOG, "g1")).toEqual(workbenchText("viewCommands.parts.editorAt", {index: 1}));
        expect(panelTitle(split.doc, CATALOG, "g0")).toEqual(workbenchText("viewCommands.parts.editorAt", {index: 2}));
    });
});

describe("浮动窗", () => {
    const floated = (): LayoutDoc => {
        const result = floatTab(doc(), {tab: "view:output", rect: {x: 0, y: 0, width: 300, height: 200}}, createLayoutPolicy());
        if (!result.ok) throw new Error(result.message);
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

    test("结构键含各区域的当前容器（输出 32）：命令切走容器，拖动就取消；只是拖到零、隐藏不算", () => {
        const base = doc();
        const anchor = Object.keys(base.panels).find((id) => base.panels[id]?.name === "sidebar") ?? "";
        const switched = setActiveContainer(base, anchor, "view:outline");
        expect(switched.ok && layoutStructureKey(switched.doc)).not.toBe(layoutStructureKey(base));
        const folded = setPanelCollapsed(base, anchor, true);
        expect(folded.ok && layoutStructureKey(folded.doc)).toBe(layoutStructureKey(base));
        const hidden = setPanelHidden(base, anchor, true);
        expect(hidden.ok && layoutStructureKey(hidden.doc)).toBe(layoutStructureKey(base));
    });

    test("独占一个窗：浮动着且只有一个标签才算；停靠的、有几个标签的、找不到标签的都不算", () => {
        const current = floated();
        expect(isSoleWindow(current, panelOf(current))).toBe(true);
        expect(isSoleWindow(current, OUTLINE)).toBe(false);
        expect(isSoleWindow(current, null)).toBe(false);
        expect(isSoleWindow(current, undefined)).toBe(false);
        const joined = moveTabToStrip(current, {tab: "view:outline", panel: panelOf(current), index: 1, activate: false}, createLayoutPolicy());
        if (!joined.ok) throw new Error(joined.message);
        expect(isSoleWindow(joined.doc, panelOf(current))).toBe(false);
    });

    test("浮动的编辑组写“浮动编辑区”，不写序号；树里的序号不算它", () => {
        const base = doc();
        const withTabs: LayoutDoc = {...base, panels: {...base.panels, g0: {role: "editor", tabs: [{kind: "tab", type: "editor", tabId: "x"}, {kind: "tab", type: "editor", tabId: "y"}], active: "tab:x"}}};
        const result = floatTab(withTabs, {tab: "tab:y", rect: {x: 0, y: 0, width: 300, height: 200}}, createLayoutPolicy());
        if (!result.ok) throw new Error(result.message);
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
        if (!switched.ok) throw new Error(switched.message);
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

    test("垫底的分节（全部收起时最后一节，外框拉到了底，输出 11）：已提交与预览里都不算拉出来，别的手势的预览不让它的内容露出来", () => {
        // “大纲”换进“文件”的容器：侧栏两节，都收起时“文件”在后面垫底。
        const paired = withPanel(doc(), OUTLINE, {container: doc().panels[FILES]?.container as string, collapsed: true});
        const collapsed = withPanel(paired, FILES, {collapsed: true});
        const tall = {...SIZES, [FILES]: {width: 300, height: 600}};
        expect(effectiveVisibleTabs(collapsed, {...FACTS, sizes: tall}).has("view:files")).toBe(false);
        expect(effectiveVisibleTabs(collapsed, {...FACTS, sizes: tall, preview: tall, fillers: new Set([FILES])}).has("view:files")).toBe(false);
        // 不是垫底的、预览里真被拉开的照旧算拉出来（上一条）。
        expect(effectiveVisibleTabs(collapsed, {...FACTS, sizes: tall, preview: tall}).has("view:files")).toBe(true);
    });

    test("并成一行的分节叶里没有头：比一行头矮也有地方放内容（输出 47）", () => {
        const short = {...SIZES, [CHAT]: {width: 300, height: 20}};
        expect(effectiveVisibleTabs(doc(), {...FACTS, sizes: short}).has("view:chat")).toBe(false);
        expect(effectiveVisibleTabs(doc(), {...FACTS, sizes: short, merged: new Set([CHAT])}).has("view:chat")).toBe(true);
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

describe("活动栏的入口（输出 22、41）", () => {
    const POLICY = createLayoutPolicy();
    const must = (result: ReturnType<typeof setPanelHidden>): LayoutDoc => {
        if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
        return result.doc;
    };
    const GROUP = "acme.group";
    const GROUPS: ContainerCatalog = new Map([[GROUP, {title: {"zh-CN": "项目", "en-US": "Project"}, icon: "i-group", location: "sidebar", order: 0}]]);
    /** “文件”“大纲”写了同一个声明的容器。 */
    const GROUPED: ViewCatalog = new Map([...CATALOG].map(([id, view]) => [id, id === "files" || id === "outline" ? {...view, container: GROUP} : view]));

    test("一个容器一项，按入口顺序；侧栏的当前容器标出来；别的区域的容器不列", () => {
        expect(regionEntries(doc(), "sidebar", CATALOG).map((entry) => [entry.id, entry.views, entry.current])).toEqual([["view:files", ["files"], true], ["view:outline", ["outline"], false]]);
        expect(regionEntries(doc(), "sidebar", CATALOG).map((entry) => entry.label)).toEqual([{title: {"zh-CN": "文件", "en-US": "Files"}, icon: "i-a"}, {title: {"zh-CN": "大纲", "en-US": "Outline"}, icon: "i-b"}]);
    });

    test("声明的容器装着几个视图：只有一项，名称与图标用容器声明的，成员按分节的先后", () => {
        const entries = regionEntries(defaultLayoutDoc(GROUPED, GROUPS), "sidebar", GROUPED, GROUPS);
        expect(entries).toEqual([{id: GROUP, label: {title: {"zh-CN": "项目", "en-US": "Project"}, icon: "i-group"}, views: ["files", "outline"], current: true}]);
    });

    test("成员是声明消失的视图：照样有入口，名称写视图 id，没有图标可取", () => {
        expect(regionEntries(doc(), "sidebar", new Map()).map((entry) => [entry.id, entry.label])).toEqual([["view:files", {title: "files", icon: null}], ["view:outline", {title: "outline", icon: null}]]);
    });

    test("右栏、底部面板同样一个容器一项，标出各自的当前容器（输出 47）", () => {
        expect(regionEntries(doc(), "auxiliarybar", CATALOG).map((entry) => [entry.id, entry.current])).toEqual([["view:chat", true]]);
        expect(regionEntries(doc(), "panel", CATALOG).map((entry) => [entry.id, entry.current])).toEqual([["view:output", true]]);
        const away = settleContainers(must(moveContainerTo(doc(), "view:files", "auxiliarybar", POLICY)));
        expect(regionEntries(away, "auxiliarybar", CATALOG).map((entry) => [entry.id, entry.current])).toEqual([["view:chat", false], ["view:files", true]]);
    });

    test("容器搬到右栏后不在活动栏里，搬回来排在最后；侧栏一个容器都没有时是空的", () => {
        const away = settleContainers(must(moveContainerTo(doc(), "view:files", "auxiliarybar", POLICY)));
        expect(regionEntries(away, "sidebar", CATALOG).map((entry) => [entry.id, entry.current])).toEqual([["view:outline", true]]);
        const back = settleContainers(must(moveContainerTo(away, "view:files", "sidebar", POLICY)));
        expect(regionEntries(back, "sidebar", CATALOG).map((entry) => [entry.id, entry.current])).toEqual([["view:outline", false], ["view:files", true]]);
        expect(regionEntries(defaultLayoutDoc(new Map()), "sidebar", new Map())).toEqual([]);
    });

    describe("点了做什么", () => {
        test("不是当前容器：切到它，不管侧栏此刻可不可见", () => {
            expect(regionEntryIntent(doc(), "sidebar", "view:outline", {regionVisible: true})).toEqual({kind: "show", container: "view:outline"});
            expect(regionEntryIntent(doc(), "sidebar", "view:outline", {regionVisible: false})).toEqual({kind: "show", container: "view:outline"});
        });

        test("是当前容器：侧栏可见就隐藏侧栏，不可见（隐藏着、拖到零）就展开", () => {
            expect(regionEntryIntent(doc(), "sidebar", "view:files", {regionVisible: true})).toEqual({kind: "hide"});
            expect(regionEntryIntent(doc(), "sidebar", "view:files", {regionVisible: false})).toEqual({kind: "show", container: "view:files"});
        });

        test("右栏、底部面板一样：是当前容器且区域可见就隐藏，否则切到它并展开", () => {
            expect(regionEntryIntent(doc(), "auxiliarybar", "view:chat", {regionVisible: true})).toEqual({kind: "hide"});
            expect(regionEntryIntent(doc(), "auxiliarybar", "view:chat", {regionVisible: false})).toEqual({kind: "show", container: "view:chat"});
            expect(regionEntryIntent(doc(), "panel", "view:chat", {regionVisible: true})).toEqual({kind: "none"});
        });

        test("不在侧栏里的容器（在别的区域、没有成员）什么都不做", () => {
            expect(regionEntryIntent(doc(), "sidebar", "view:chat", {regionVisible: true})).toEqual({kind: "none"});
            expect(regionEntryIntent(doc(), "sidebar", "custom:nobody", {regionVisible: true})).toEqual({kind: "none"});
        });
    });

    describe("侧栏可见（按下态与点击问的是它）", () => {
        const NONE = {removed: new Set<string>(), maximized: null};
        const visibleOf = (current: LayoutDoc, facts: VisibilityFacts = FACTS) => effectiveVisibleTabs(current, facts);

        test("占着地方就算；分节收成标题行也算", () => {
            expect(regionVisible(doc(), "sidebar", NONE, visibleOf(doc()))).toBe(true);
            // 两个分节都收成标题行：没有一个视图有效可见，侧栏照样占着地方。
            const two = settleContainers(must(moveTabToEdge(doc(), {tab: "view:outline", target: sectionLanding(doc(), "sidebar", "view:files")!, container: "view:files"}, POLICY)));
            const folded = must(setPanelCollapsed(must(setPanelCollapsed(two, FILES, true)), OUTLINE, true));
            expect(visibleOf(folded).has("view:files")).toBe(false);
            expect(regionVisible(folded, "sidebar", NONE, visibleOf(folded))).toBe(true);
        });

        test("隐藏、拖到零、被别的面板最大化盖住、显示着的分节都被收走：不算", () => {
            const hidden = must(setPanelHidden(doc(), "sidebar", true));
            expect(regionVisible(hidden, "sidebar", NONE, visibleOf(hidden))).toBe(false);
            const zeroed = must(setPanelCollapsed(doc(), "sidebar", true));
            expect(regionVisible(zeroed, "sidebar", NONE, visibleOf(zeroed))).toBe(false);
            expect(regionVisible(doc(), "sidebar", {...NONE, maximized: CHAT}, visibleOf(doc(), {...FACTS, maximized: CHAT}))).toBe(false);
            expect(regionVisible(doc(), "sidebar", {...NONE, maximized: FILES}, visibleOf(doc(), {...FACTS, maximized: FILES}))).toBe(true);
            const removed = new Set([FILES]);
            expect(regionVisible(doc(), "sidebar", {...NONE, removed}, visibleOf(doc(), {...FACTS, removed}))).toBe(false);
        });

        test("右栏同样：隐藏了不算，显示着算（输出 47 的按下态）", () => {
            expect(regionVisible(doc(), "auxiliarybar", NONE, visibleOf(doc()))).toBe(true);
            const hidden = must(setPanelHidden(doc(), "auxiliarybar", true));
            expect(regionVisible(hidden, "auxiliarybar", NONE, visibleOf(hidden))).toBe(false);
        });

        test("从零拉回来：文档里还记着拖到零，内容已经按拖动中的几何可见，就算可见", () => {
            const zeroed = must(setPanelCollapsed(doc(), "sidebar", true));
            const sizes = {...SIZES, [FILES]: {width: 0, height: 400}};
            const pulling = visibleOf(zeroed, {...FACTS, sizes, preview: {...sizes, [FILES]: {width: 200, height: 400}}});
            expect(regionVisible(zeroed, "sidebar", NONE, pulling)).toBe(true);
        });
    });
});

describe("头只写标题的面板（输出 20）", () => {
    test("区域里的分节恰一个标签，都只写标题，活动栏隐藏时也一样；几个标签的浮动窗画标签条；编辑组不在里面", () => {
        const base = doc();
        expect([FILES, OUTLINE, CHAT, OUTPUT].every((id) => titleOnlyPanels(base).has(id))).toBe(true);
        expect(titleOnlyPanels(base).has("g0")).toBe(false);
        const barHidden: LayoutDoc = {...base, hiddenBars: ["activitybar"]};
        expect([FILES, OUTLINE].every((id) => titleOnlyPanels(barHidden).has(id))).toBe(true);
        const floated = floatTab(base, {tab: "view:files", rect: {x: 0, y: 0, width: 300, height: 200}}, createLayoutPolicy());
        if (!floated.ok) throw new Error(floated.message);
        const float = floated.doc.floats[0]?.panel ?? "";
        const merged = moveTabToStrip(floated.doc, {tab: "view:outline", panel: float, index: 1}, createLayoutPolicy());
        if (!merged.ok) throw new Error(merged.message);
        expect(titleOnlyPanels(floated.doc).has(float)).toBe(true);
        expect(titleOnlyPanels(merged.doc).has(float)).toBe(false);
    });
});

describe("焦点所在的面板看不见之后的落点（输出 16、42）", () => {
    const must = (result: ReturnType<typeof setPanelHidden>): LayoutDoc => {
        if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
        return result.doc;
    };

    test("面板还显示着（内容被停放）：它头上的标签，再是它那个容器的入口（侧栏的在活动栏，右栏的在右轨）", () => {
        expect(focusLandings(doc(), FILES)).toEqual([{kind: "tab", panel: FILES}, {kind: "entry", container: "view:files"}]);
        expect(focusLandings(doc(), CHAT)).toEqual([{kind: "tab", panel: CHAT}, {kind: "entry", container: "view:chat"}]);
    });

    test("切走了容器、区域还显示着：新容器的第一个分节，再是活动栏里原来那个容器的入口", () => {
        const switched = must(setActiveContainer(doc(), "sidebar", "view:outline"));
        expect(focusLandings(switched, FILES)).toEqual([{kind: "section", panel: OUTLINE}, {kind: "entry", container: "view:files"}]);
    });

    test("区域隐藏了：侧栏、右栏的去侧轨上它那个容器的入口；底部面板的入口条跟着缩没了，没有落点", () => {
        expect(focusLandings(must(setPanelHidden(doc(), "sidebar", true)), FILES)).toEqual([{kind: "entry", container: "view:files"}]);
        expect(focusLandings(must(setPanelHidden(doc(), "auxiliarybar", true)), CHAT)).toEqual([{kind: "entry", container: "view:chat"}]);
        expect(focusLandings(must(setPanelHidden(doc(), "panel", true)), OUTPUT)).toEqual([]);
    });

    test("切走容器的同时区域也隐藏了：不去新容器的分节（它也看不见）", () => {
        const switched = must(setPanelHidden(must(setActiveContainer(doc(), "sidebar", "view:outline")), "sidebar", true));
        expect(focusLandings(switched, FILES)).toEqual([{kind: "entry", container: "view:files"}]);
    });

    test("文档里没有这块面板、编辑组：没有落点", () => {
        expect(focusLandings(doc(), "nope")).toEqual([]);
        expect(focusLandings(doc(), "g0")).toEqual([{kind: "tab", panel: "g0"}]);
    });
});

describe("移动到的目标（输出 23、41）", () => {
    const policy = createLayoutPolicy();
    const rows = (targets: ReturnType<typeof moveTargetsOf>) => (targets ?? []).map((target) => (target.kind === "container" ? [target.kind, target.container, target.region, target.label.title] : target.kind === "new-container" ? [target.kind, target.region] : [target.kind, target.container]));
    const FRESH = [["new-container", "sidebar"], ["new-container", "auxiliarybar"], ["new-container", "panel"]];

    test("别的容器按区域、入口顺序列出，写容器的标题，不列视图自己所在的容器；然后是三个区域的新容器；在声明的容器里时没有“重置位置”", () => {
        expect(rows(moveTargetsOf(doc(), "outline", CATALOG))).toEqual([
            ["container", "view:files", "sidebar", {"zh-CN": "文件", "en-US": "Files"}],
            ["container", "view:chat", "auxiliarybar", {"zh-CN": "对话", "en-US": "Chat"}],
            ["container", "view:output", "panel", {"zh-CN": "输出", "en-US": "Output"}],
            ...FRESH,
        ]);
        expect(moveTargetsOf(doc(), "nowhere", CATALOG)).toBeNull();
    });

    test("不在声明的容器里：另有“重置位置”，回到那个容器；没有成员的容器不是目标；声明的容器写声明的标题", () => {
        const moved = moveTabToEdge(doc(), {tab: "view:outline", target: sectionLanding(doc(), "auxiliarybar", "view:chat")!, container: "view:chat"}, policy);
        if (!moved.ok) throw new Error(moved.message);
        const settled = settleContainers(moved.doc);
        expect(rows(moveTargetsOf(settled, "outline", CATALOG))).toEqual([
            ["container", "view:files", "sidebar", {"zh-CN": "文件", "en-US": "Files"}],
            ["container", "view:output", "panel", {"zh-CN": "输出", "en-US": "Output"}],
            ...FRESH,
            ["reset", "view:outline"],
        ]);

        const group = "acme.group";
        const groups: ContainerCatalog = new Map([[group, {title: {"zh-CN": "项目", "en-US": "Project"}, icon: "i-group", location: "sidebar", order: 0}]]);
        const grouped: ViewCatalog = new Map([...CATALOG].map(([id, view]) => [id, id === "files" || id === "outline" ? {...view, container: group} : view]));
        expect(rows(moveTargetsOf(defaultLayoutDoc(grouped, groups), "chat", grouped, groups)).slice(0, 2)).toEqual([
            ["container", group, "sidebar", {"zh-CN": "项目", "en-US": "Project"}],
            ["container", "view:output", "panel", {"zh-CN": "输出", "en-US": "Output"}],
        ]);
    });
});
