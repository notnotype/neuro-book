/**
 * 视图容器的求值（docs/specs/ui/workbench-layout.md 输出 4、40、41、43；docs/specs/workbench/views.md 输出 15、16）。
 */
import {describe, expect, it} from "bun:test";

import {floatTab, moveTabToEdge, openPanelAtEdge, removeTab, setActiveContainer, setPanelCollapsed, setPanelHidden, validateLayoutDoc} from "@notnotype/nb-layout";
import type {LayoutDoc, LayoutResult, PanelName} from "@notnotype/nb-layout";

import type {ViewDeclaration, ViewLocation} from "../../shared/views";
import type {ViewCatalog} from "../views/registry";
import {containerLabel, containerRegion, regionContainers, sectionLanding, settleContainers, unresolvedContainerRefs, viewHome, viewSection} from "./containers";
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
    if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
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
