/**
 * 视图容器的求值（docs/specs/ui/workbench-layout.md 输出 4、40、41、43；docs/specs/workbench/views.md 输出 15、16）。
 */
import {describe, expect, it} from "bun:test";

import {floatTab, isPanelShown, isSectionCollapsed, moveTabToEdge, openPanelAtEdge, removeTab, setActiveContainer, setPanelCollapsed, setPanelHidden, setSiblingShares, validateLayoutDoc} from "@notnotype/nb-workbench-layout";
import type {LayoutDoc, LayoutResult, PanelName} from "@notnotype/nb-workbench-layout";

import type {ViewDeclaration, ViewLocation} from "../../shared/views";
import type {ViewCatalog} from "../views/registry";
import {canResetContainer, containerHomeRegion, containerLabel, containerMoveTargets, containerRegion, moveContainerTo, regionContainers, sectionLanding, settleContainers, unresolvedContainerRefs, viewHome, viewSection} from "./containers";
import type {ContainerCatalog} from "./containers";
import {defaultLayoutDoc} from "./default-tree";
import {createLayoutPolicy} from "./layout-constraints";

const POLICY = createLayoutPolicy();
const VIEW = (title: string, location: ViewLocation, over: Partial<ViewDeclaration> = {}): ViewDeclaration => ({title: {"zh-CN": title, "en-US": title}, icon: `i-${title}`, location, layout: "scroll", ...over});

const PROJECT = "acme.project";
const CONTAINERS: ContainerCatalog = new Map([[PROJECT, {title: {"zh-CN": "项目", "en-US": "Project"}, icon: "i-project", location: "sidebar", order: 0}]]);
/**
 * “项目”容器在侧栏，装着文件与会话（会话自己写的位置是底部面板，不起作用）；搜索没写容器；幽灵写的容器没有声明；对话在右栏。底部面板一个容器都没有。
 */
const VIEWS: ViewCatalog = new Map([
    ["files", VIEW("文件", "sidebar", {container: PROJECT, order: 1})],
    ["sessions", VIEW("会话", "panel", {container: PROJECT, order: 2})],
    ["search", VIEW("搜索", "sidebar", {order: 5})],
    ["ghost", VIEW("幽灵", "sidebar", {container: "acme.missing", order: 9})],
    ["chat", VIEW("对话", "auxiliarybar")],
]);

const doc = (): LayoutDoc => defaultLayoutDoc(VIEWS, CONTAINERS);
function must(result: LayoutResult): LayoutDoc {
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    return result.doc;
}
const idsIn = (current: LayoutDoc, region: PanelName): ReadonlyArray<string> => regionContainers(current, region).map((container) => container.id);
/** 把视图放成 `container` 在这个区域里的最后一个分节，再归整。 */
function place(current: LayoutDoc, viewId: string, region: PanelName, container: string): LayoutDoc {
    const target = sectionLanding(current, region, container);
    if (target === null) throw new Error(`${region} 不用容器`);
    return settleContainers(must(moveTabToEdge(current, {tab: `view:${viewId}`, target, container}, POLICY)));
}
/** 关掉视图的分节，再归整。 */
const close = (current: LayoutDoc, viewId: string): LayoutDoc => settleContainers(must(removeTab(current, `view:${viewId}`)));

describe("视图该进哪个容器（views.md 输出 16）", () => {
    it("写了容器且容器有声明：进它，去的区域与入口的先后看容器的声明", () => {
        expect(viewHome("sessions", VIEWS, CONTAINERS)).toEqual({container: PROJECT, location: "sidebar", order: 0, key: PROJECT});
    });

    it("没写容器：自己的隐式容器 `view:<视图 id>`，区域与先后看视图的声明", () => {
        expect(viewHome("search", VIEWS, CONTAINERS)).toEqual({container: "view:search", location: "sidebar", order: 5, key: "search"});
    });

    it("写的容器没有已接受的声明：落回隐式容器，并列在待诊断的清单里；视图自己没有声明时没有去处", () => {
        expect(viewHome("ghost", VIEWS, CONTAINERS)).toEqual({container: "view:ghost", location: "sidebar", order: 9, key: "ghost"});
        expect(unresolvedContainerRefs(VIEWS, CONTAINERS)).toEqual([{viewId: "ghost", container: "acme.missing"}]);
        expect(viewHome("nowhere", VIEWS, CONTAINERS)).toBeNull();
    });
});

describe("区域里出现的容器（输出 41）", () => {
    it("按锚的入口顺序，成员按分节的先后；没有容器的区域是空的", () => {
        expect(regionContainers(doc(), "sidebar").map((container) => [container.id, container.views])).toEqual([
            [PROJECT, ["files", "sessions"]],
            ["view:search", ["search"]],
            ["view:ghost", ["ghost"]],
        ]);
        expect(regionContainers(doc(), "auxiliarybar").map((container) => [container.id, container.views])).toEqual([["view:chat", ["chat"]]]);
        expect(regionContainers(doc(), "panel")).toEqual([]);
    });

    it("容器出不出现只看此刻的成员：成员都走了入口消失，声明的容器与隐式容器的位置留着，成员回来入口回到原处", () => {
        const emptied = place(place(doc(), "files", "sidebar", "view:search"), "sessions", "sidebar", "view:search");
        expect(idsIn(emptied, "sidebar")).toEqual(["view:search", "view:ghost"]);
        expect(regionContainers(emptied, "sidebar")[0]?.views).toEqual(["search", "files", "sessions"]);
        const back = place(emptied, "files", "sidebar", PROJECT);
        expect(idsIn(back, "sidebar")).toEqual([PROJECT, "view:search", "view:ghost"]);
    });

    it("视图在哪个分节、哪个区域、哪个容器；浮出去的不在任何区域里", () => {
        const current = doc();
        expect(viewSection(current, "sessions")).toMatchObject({region: "sidebar", container: PROJECT, viewId: "sessions"});
        expect(containerRegion(current, PROJECT)).toBe("sidebar");
        expect(containerRegion(current, "view:chat")).toBe("auxiliarybar");
        expect(containerRegion(current, "acme.missing")).toBeNull();
        const floated = must(floatTab(current, {tab: "view:chat", rect: {x: 0, y: 0, width: 300, height: 200}}, POLICY));
        expect(viewSection(floated, "chat")).toBeNull();
        expect(containerRegion(settleContainers(floated), "view:chat")).toBeNull();
    });
});

describe("容器的标题与图标（输出 41）", () => {
    const labelOf = (current: LayoutDoc, id: string, views: ViewCatalog = VIEWS, containers: ContainerCatalog = CONTAINERS) => {
        const container = regionContainers(current, "sidebar").find((candidate) => candidate.id === id);
        if (container === undefined) throw new Error(`侧栏里没有 ${id}`);
        return containerLabel(container, views, containers);
    };

    it("声明的容器用声明的；隐式容器取成员视图的", () => {
        expect(labelOf(doc(), PROJECT)).toEqual({title: {"zh-CN": "项目", "en-US": "Project"}, icon: "i-project"});
        expect(labelOf(doc(), "view:search")).toEqual({title: {"zh-CN": "搜索", "en-US": "搜索"}, icon: "i-搜索"});
    });

    it("容器自己的声明不在了：同隐式容器，取第一个成员视图的，跳过声明不在的视图", () => {
        expect(labelOf(doc(), PROJECT, VIEWS, new Map())).toEqual({title: {"zh-CN": "文件", "en-US": "文件"}, icon: "i-文件"});
        const withoutFiles = new Map([...VIEWS].filter(([id]) => id !== "files"));
        expect(labelOf(doc(), PROJECT, withoutFiles, new Map())).toEqual({title: {"zh-CN": "会话", "en-US": "会话"}, icon: "i-会话"});
    });

    it("成员的声明都不在：写第一个成员的视图 id，没有图标可取", () => {
        expect(labelOf(doc(), PROJECT, new Map(), new Map())).toEqual({title: "files", icon: null});
    });

    it("用户拖出来的容器：取第一个成员视图的", () => {
        const custom = place(doc(), "sessions", "sidebar", "custom:one");
        expect(labelOf(custom, "custom:one")).toEqual({title: {"zh-CN": "会话", "en-US": "会话"}, icon: "i-会话"});
    });
});

describe("往容器里放分节的落点（输出 4、23）", () => {
    it("容器有成员：成为它最后一个分节，侧栏、右栏往下放，底部面板往右放", () => {
        const current = doc();
        const last = viewSection(current, "sessions")?.panel;
        expect(sectionLanding(current, "sidebar", PROJECT)).toEqual({kind: "split", panel: last ?? "", edge: "bottom"});
        const moved = place(current, "chat", "sidebar", PROJECT);
        expect(regionContainers(moved, "sidebar")[0]?.views).toEqual(["files", "sessions", "chat"]);
        const inPanel = place(current, "chat", "panel", "view:chat");
        expect(sectionLanding(inPanel, "panel", "view:chat")).toEqual({kind: "split", panel: viewSection(inPanel, "chat")?.panel ?? "", edge: "right"});
    });

    it("容器在这个区域里还没有成员：挂在锚后面，别的容器的分节尺寸不变", () => {
        const current = doc();
        expect(sectionLanding(current, "sidebar", "custom:new")).toEqual({kind: "split", panel: "sidebar", edge: "bottom"});
        const sizes = (of: LayoutDoc) => JSON.stringify(regionContainers(of, "sidebar").filter((container) => container.id !== "custom:new").flatMap((container) => container.sections).map((id) => sizeOf(of, id)));
        const moved = place(current, "chat", "sidebar", "custom:new");
        expect(sizes(moved)).toBe(sizes(current));
        expect(validateLayoutDoc(moved).ok).toBe(true);
    });
});

describe("结构操作之后的归整（输出 41、43）", () => {
    it("新出现的容器排到入口顺序的最后；没有要改的时返回原对象", () => {
        const current = doc();
        expect(settleContainers(current)).toBe(current);
        const target = sectionLanding(current, "sidebar", "custom:new");
        if (target === null) throw new Error("侧栏不用容器");
        const opened = must(openPanelAtEdge(current, {id: "x", panel: {role: "tool", tabs: [{kind: "view", viewId: "extra"}], active: "view:extra", container: "custom:new"}, target}, POLICY));
        expect(opened.panels.sidebar?.entries).toEqual([PROJECT, "view:search", "view:ghost"]);
        const settled = settleContainers(opened);
        expect(settled.panels.sidebar?.entries).toEqual([PROJECT, "view:search", "view:ghost", "custom:new"]);
        // 入口多了一个，当前容器不换。
        expect(settled.panels.sidebar?.activeContainer).toBe(PROJECT);
        expect(settleContainers(settled)).toBe(settled);
    });

    it("当前容器空了：切到入口顺序里它前面最近的有成员的容器", () => {
        const onGhost = must(setActiveContainer(doc(), "sidebar", "view:ghost"));
        expect(close(onGhost, "ghost").panels.sidebar?.activeContainer).toBe("view:search");
        // 前面那个已经空了时再往前找。
        expect(close(close(onGhost, "search"), "ghost").panels.sidebar?.activeContainer).toBe(PROJECT);
    });

    it("当前容器空了、前面没有容器：切到后面最近的", () => {
        const emptied = close(close(doc(), "files"), "sessions");
        expect(emptied.panels.sidebar?.activeContainer).toBe("view:search");
        expect(idsIn(emptied, "sidebar")).toEqual(["view:search", "view:ghost"]);
    });

    it("不是当前容器的容器空了：当前容器不换", () => {
        expect(close(doc(), "search").panels.sidebar?.activeContainer).toBe(PROJECT);
    });

    it("这样切过去不改区域的隐藏：隐藏着的还隐藏着", () => {
        const hidden = must(setPanelHidden(doc(), "sidebar", true));
        const emptied = close(close(hidden, "files"), "sessions");
        expect(emptied.panels.sidebar).toMatchObject({hidden: true, activeContainer: "view:search"});
    });

    it("区域里一个容器都没有了：锚隐藏，没有当前容器；别的区域不变", () => {
        const current = doc();
        const emptied = close(current, "chat");
        expect(emptied.panels.auxiliarybar).toMatchObject({hidden: true, activeContainer: null});
        expect(emptied.panels.sidebar).toEqual(current.panels.sidebar);
        expect(validateLayoutDoc(emptied).ok).toBe(true);
    });

    it("用户拖出来的容器空了就不再存在：id 从入口顺序里删掉；它是当前容器时先切走", () => {
        const custom = must(setActiveContainer(place(doc(), "sessions", "sidebar", "custom:one"), "sidebar", "custom:one"));
        expect(custom.panels.sidebar?.entries).toEqual([PROJECT, "view:search", "view:ghost", "custom:one"]);
        const back = place(custom, "sessions", "sidebar", PROJECT);
        expect(back.panels.sidebar?.entries).toEqual([PROJECT, "view:search", "view:ghost"]);
        expect(back.panels.sidebar?.activeContainer).toBe("view:ghost");
    });

    it("区域原来没有容器：第一个进来的成为当前容器，区域的隐藏不变", () => {
        const current = doc();
        expect(current.panels.panel).toMatchObject({hidden: true, entries: [], activeContainer: null});
        const moved = place(current, "chat", "panel", "view:chat");
        expect(moved.panels.panel).toMatchObject({hidden: true, entries: ["view:chat"], activeContainer: "view:chat"});
    });

    it("换当前容器同时清掉区域的拖到零（输出 42）", () => {
        const zeroed = must(setPanelCollapsed(doc(), "sidebar", true));
        const emptied = close(close(zeroed, "files"), "sessions");
        expect(emptied.panels.sidebar?.collapsed).toBeUndefined();
    });
});

describe("整个容器搬到另一个区域（输出 44）", () => {
    const sectionOf = (current: LayoutDoc, viewId: string): string => {
        const section = viewSection(current, viewId);
        if (section === null) throw new Error(`${viewId} 不在区域里`);
        return section.panel;
    };
    const axisOf = (current: LayoutDoc, viewId: string, axis: "width" | "height"): number => (sizeOf(current, sectionOf(current, viewId)) as {width: number; height: number})[axis];
    /** “项目”容器三个分节（文件、会话、搜索），高度之比 1:3:4，会话收成标题行。 */
    const prepared = (): LayoutDoc => {
        const three = place(doc(), "search", "sidebar", PROJECT);
        const shared = must(setSiblingShares(three, [{node: sectionOf(three, "files"), share: 1}, {node: sectionOf(three, "sessions"), share: 3}, {node: sectionOf(three, "search"), share: 4}]));
        return must(setPanelCollapsed(shared, sectionOf(shared, "sessions"), true));
    };
    const move = (current: LayoutDoc, container: string, region: PanelName): LayoutDoc => settleContainers(must(moveContainerTo(current, container, region, POLICY)));

    it("搬到右栏：分节的先后、高度之比、收成标题行都带着；入口排到右栏入口顺序的最后，右栏切到它", () => {
        const before = prepared();
        const moved = move(before, PROJECT, "auxiliarybar");
        expect(regionContainers(moved, "auxiliarybar").map((container) => [container.id, container.views])).toEqual([["view:chat", ["chat"]], [PROJECT, ["files", "sessions", "search"]]]);
        expect(moved.panels.auxiliarybar).toMatchObject({entries: ["view:chat", PROJECT], activeContainer: PROJECT});
        const heights = ["files", "sessions", "search"].map((viewId) => axisOf(moved, viewId, "height"));
        expect((heights[1] as number) / (heights[0] as number)).toBeCloseTo(3, 5);
        expect((heights[2] as number) / (heights[0] as number)).toBeCloseTo(4, 5);
        expect(["files", "sessions", "search"].map((viewId) => isSectionCollapsed(moved, sectionOf(moved, viewId)))).toEqual([false, true, false]);
        // 分节还是原来那几块面板：内容跟着面板走，不重建。
        expect(["files", "sessions", "search"].map((viewId) => sectionOf(moved, viewId))).toEqual(["files", "sessions", "search"].map((viewId) => sectionOf(before, viewId)));
        expect(validateLayoutDoc(moved).ok).toBe(true);
    });

    it("来源区域：切到入口顺序里相邻的容器；别的容器的分节尺寸不变；声明的容器的入口位置留着", () => {
        const before = prepared();
        const ghost = sizeOf(before, sectionOf(before, "ghost"));
        const moved = move(before, PROJECT, "auxiliarybar");
        expect(idsIn(moved, "sidebar")).toEqual(["view:ghost"]);
        expect(moved.panels.sidebar).toMatchObject({entries: [PROJECT, "view:search", "view:ghost"], activeContainer: "view:ghost"});
        expect(sizeOf(moved, sectionOf(moved, "ghost"))).toEqual(ghost);
    });

    it("目标区域隐藏着、拖到零：同一次显示出来", () => {
        const hidden = must(setPanelHidden(prepared(), "auxiliarybar", true));
        const fromHidden = move(hidden, PROJECT, "auxiliarybar");
        expect(fromHidden.panels.auxiliarybar?.hidden).toBeUndefined();
        expect(isPanelShown(fromHidden, sectionOf(fromHidden, "files"))).toBe(true);
        const zeroed = must(setPanelCollapsed(prepared(), "auxiliarybar", true));
        expect(move(zeroed, PROJECT, "auxiliarybar").panels.auxiliarybar?.collapsed).toBeUndefined();
    });

    it("搬进底部面板：方向变了，分节平分；收成标题行的展开（底部面板的分节不折叠）", () => {
        const moved = move(prepared(), PROJECT, "panel");
        expect(regionContainers(moved, "panel").map((container) => [container.id, container.views])).toEqual([[PROJECT, ["files", "sessions", "search"]]]);
        expect(moved.panels.panel).toMatchObject({entries: [PROJECT], activeContainer: PROJECT});
        expect(moved.panels.panel?.hidden).toBeUndefined();
        const widths = ["files", "sessions", "search"].map((viewId) => axisOf(moved, viewId, "width"));
        expect((widths[1] as number) / (widths[0] as number)).toBeCloseTo(1, 5);
        expect((widths[2] as number) / (widths[0] as number)).toBeCloseTo(1, 5);
        expect(moved.panels[sectionOf(moved, "sessions")]?.collapsed).toBeUndefined();
    });

    it("搬回待过的区域：入口不回原来的位置，排到入口顺序的最后；比例与收成标题行还在", () => {
        const back = move(move(prepared(), PROJECT, "auxiliarybar"), PROJECT, "sidebar");
        expect(back.panels.sidebar).toMatchObject({entries: ["view:search", "view:ghost", PROJECT], activeContainer: PROJECT});
        expect(idsIn(back, "sidebar")).toEqual(["view:ghost", PROJECT]);
        expect(axisOf(back, "sessions", "height") / axisOf(back, "files", "height")).toBeCloseTo(3, 5);
        expect(isSectionCollapsed(back, sectionOf(back, "sessions"))).toBe(true);
        expect(back.panels.auxiliarybar).toMatchObject({activeContainer: "view:chat"});
    });

    it("只含一个分节的容器：搬过去就是那一个分节，记录里的收起意图带着（它独自显示时按没收起算）", () => {
        const folded: LayoutDoc = {...doc(), panels: {...doc().panels, [sectionOf(doc(), "search")]: {...doc().panels[sectionOf(doc(), "search")] as LayoutDoc["panels"][string], collapsed: true}}};
        const moved = move(folded, "view:search", "auxiliarybar");
        expect(moved.panels.auxiliarybar).toMatchObject({entries: ["view:chat", "view:search"], activeContainer: "view:search"});
        expect(moved.panels[sectionOf(moved, "search")]?.collapsed).toBe(true);
        expect(isSectionCollapsed(moved, sectionOf(moved, "search"))).toBe(false);
    });

    it("容器已经在那个区域：原对象；容器没有成员：not-found", () => {
        const current = doc();
        expect(must(moveContainerTo(current, PROJECT, "sidebar", POLICY))).toBe(current);
        expect(moveContainerTo(current, "custom:nobody", "panel", POLICY)).toMatchObject({ok: false, code: "not-found"});
    });
});

describe("容器声明的区域与“重置”（输出 44）", () => {
    it("声明的容器看容器的 location，隐式容器看它那个视图的；用户拖出来的容器、声明不在了的都没有", () => {
        expect(containerHomeRegion(PROJECT, VIEWS, CONTAINERS)).toBe("sidebar");
        expect(containerHomeRegion("view:chat", VIEWS, CONTAINERS)).toBe("auxiliarybar");
        // 会话写了容器，它的隐式容器只在“声明的容器被别处占着”时才用得上；声明的区域照样看视图自己写的。
        expect(containerHomeRegion("view:sessions", VIEWS, CONTAINERS)).toBe("panel");
        expect(containerHomeRegion("custom:one", VIEWS, CONTAINERS)).toBeNull();
        expect(containerHomeRegion(PROJECT, VIEWS, new Map())).toBeNull();
        expect(containerHomeRegion("view:gone", VIEWS, CONTAINERS)).toBeNull();
    });

    it("“移到”是容器此刻所在区域之外的两个，按侧栏、右栏、底部面板的先后；没有成员时没有", () => {
        const current = doc();
        expect(containerMoveTargets(current, PROJECT)).toEqual(["auxiliarybar", "panel"]);
        expect(containerMoveTargets(settleContainers(must(moveContainerTo(current, PROJECT, "auxiliarybar", POLICY))), PROJECT)).toEqual(["sidebar", "panel"]);
        expect(containerMoveTargets(settleContainers(must(moveContainerTo(current, PROJECT, "panel", POLICY))), PROJECT)).toEqual(["sidebar", "auxiliarybar"]);
        expect(containerMoveTargets(current, "view:nobody")).toEqual([]);
    });

    it("容器不在声明的区域时才有“重置”；已经在那里、没有声明的区域、没有成员时都没有", () => {
        const current = doc();
        expect(canResetContainer(current, PROJECT, VIEWS, CONTAINERS)).toBe(false);
        const away = settleContainers(must(moveContainerTo(current, PROJECT, "auxiliarybar", POLICY)));
        expect(canResetContainer(away, PROJECT, VIEWS, CONTAINERS)).toBe(true);
        expect(canResetContainer(away, "view:chat", VIEWS, CONTAINERS)).toBe(false);
        const custom = place(current, "sessions", "panel", "custom:one");
        expect(canResetContainer(custom, "custom:one", VIEWS, CONTAINERS)).toBe(false);
        expect(canResetContainer(current, "view:nobody", VIEWS, CONTAINERS)).toBe(false);
    });
});

function sizeOf(current: LayoutDoc, id: string): unknown {
    const walk = (node: LayoutDoc["tree"]["root"]): unknown => {
        if (node.id === id) return node.size;
        if (node.kind === "leaf") return null;
        for (const child of node.children) {
            const found = walk(child);
            if (found !== null) return found;
        }
        return null;
    };
    return walk(current.tree.root);
}
