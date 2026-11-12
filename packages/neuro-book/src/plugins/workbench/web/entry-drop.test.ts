/**
 * 活动栏上段的落点（docs/specs/ui/workbench-layout.md 输出 28、45、46）。
 */
import {describe, expect, it} from "bun:test";

import {isPanelShown, regionNodeOf, setPanelCollapsed, setPanelHidden} from "@notnotype/nb-layout";
import type {LayoutDoc, LayoutResult} from "@notnotype/nb-layout";

import type {ViewDeclaration, ViewLocation} from "../shared/views";
import {applyEntryDrop, barSpotAt, barStopsOf, entryDropAt} from "./entry-drop";
import type {BarEntryRect, EntryDropAction, WorkbenchDragSource} from "./entry-drop";
import {regionContainers, viewSection} from "./state/containers";
import type {ContainerCatalog} from "./state/containers";
import {defaultLayoutDoc} from "./state/default-tree";
import {createLayoutPolicy} from "./state/layout-constraints";
import type {ViewCatalog} from "./views/registry";

const POLICY = createLayoutPolicy();
const VIEW = (title: string, location: ViewLocation, over: Partial<ViewDeclaration> = {}): ViewDeclaration => ({title: {"zh-CN": title, "en-US": title}, icon: `i-${title}`, location, layout: "scroll", ...over});
const PROJECT = "acme.project";
const CONTAINERS: ContainerCatalog = new Map([[PROJECT, {title: {"zh-CN": "项目", "en-US": "Project"}, icon: "i-project", location: "sidebar", order: 0}]]);
/** 侧栏：“项目”（文件、大纲，当前容器）、“搜索”、“书签”；右栏：对话。 */
const VIEWS: ViewCatalog = new Map([
    ["files", VIEW("文件", "sidebar", {container: PROJECT, order: 1})],
    ["outline", VIEW("大纲", "sidebar", {container: PROJECT, order: 2})],
    ["search", VIEW("搜索", "sidebar", {order: 5})],
    ["marks", VIEW("书签", "sidebar", {order: 6})],
    ["chat", VIEW("对话", "auxiliarybar")],
]);
const SEARCH = "view:search";
const MARKS = "view:marks";
const NEW = "custom:new";

const doc = (): LayoutDoc => defaultLayoutDoc(VIEWS, CONTAINERS);
function must(result: LayoutResult): LayoutDoc {
    if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
    return result.doc;
}
const tab = (viewId: string): WorkbenchDragSource => ({kind: "tab", tab: `view:${viewId}`});
const anchorOf = (current: LayoutDoc): string => regionNodeOf(current, "sidebar")?.anchor ?? "";
const sidebar = (current: LayoutDoc) => current.panels[anchorOf(current)];
const shownIds = (current: LayoutDoc): ReadonlyArray<string> => regionContainers(current, "sidebar").map((container) => container.id);
const drop = (current: LayoutDoc, source: WorkbenchDragSource, action: EntryDropAction, commit: boolean): LayoutDoc => must(applyEntryDrop(current, source, action, POLICY, {commit}));
const shownView = (current: LayoutDoc, viewId: string): boolean => {
    const section = viewSection(current, viewId);
    return section !== null && isPanelShown(current, section.panel);
};

describe("指针在活动栏上段的哪（输出 45）", () => {
    /** 两个 38px 的入口，中间隔 4px。 */
    const ENTRIES: ReadonlyArray<BarEntryRect> = [{container: "A", top: 0, bottom: 38}, {container: "B", top: 42, bottom: 80}];

    it("入口中间那一段是入口上，上下两头和入口之间的间距是空位；最后一个下面是最后", () => {
        expect(barSpotAt(ENTRIES, 19, {entries: true})).toEqual({kind: "entry", container: "A"});
        expect(barSpotAt(ENTRIES, 61, {entries: true})).toEqual({kind: "entry", container: "B"});
        expect(barSpotAt(ENTRIES, 3, {entries: true})).toEqual({kind: "gap", before: "A"});
        expect(barSpotAt(ENTRIES, 35, {entries: true})).toEqual({kind: "gap", before: "B"});
        expect(barSpotAt(ENTRIES, 40, {entries: true})).toEqual({kind: "gap", before: "B"});
        expect(barSpotAt(ENTRIES, 78, {entries: true})).toEqual({kind: "gap", before: null});
        expect(barSpotAt(ENTRIES, 300, {entries: true})).toEqual({kind: "gap", before: null});
    });

    it("只换序时入口上也是空位，按入口的中线分上下", () => {
        expect(barSpotAt(ENTRIES, 10, {entries: false})).toEqual({kind: "gap", before: "A"});
        expect(barSpotAt(ENTRIES, 25, {entries: false})).toEqual({kind: "gap", before: "B"});
    });

    it("键盘的停靠点放回去，每个空位、每个入口各一个", () => {
        const spots = barStopsOf(ENTRIES, 400, {entries: true}).map((y) => JSON.stringify(barSpotAt(ENTRIES, y, {entries: true})));
        expect(spots).toEqual([{kind: "gap", before: "A"}, {kind: "entry", container: "A"}, {kind: "gap", before: "B"}, {kind: "entry", container: "B"}, {kind: "gap", before: null}].map((spot) => JSON.stringify(spot)));
        expect(barStopsOf(ENTRIES, 400, {entries: false}).map((y) => barSpotAt(ENTRIES, y, {entries: false}))).toEqual([{kind: "gap", before: "A"}, {kind: "gap", before: "B"}, {kind: "gap", before: null}]);
    });
});

describe("落点是什么（输出 45、46）", () => {
    it("入口之间新建容器；来源是侧栏里一个容器唯一的视图时只给这个容器换位置；入口上是并入", () => {
        const current = doc();
        expect(entryDropAt(current, tab("files"), {kind: "gap", before: SEARCH}, NEW)).toEqual({kind: "new-container", container: NEW, before: SEARCH});
        expect(entryDropAt(current, tab("chat"), {kind: "gap", before: null}, NEW)).toEqual({kind: "new-container", container: NEW, before: null});
        expect(entryDropAt(current, tab("search"), {kind: "gap", before: PROJECT}, NEW)).toEqual({kind: "move-entry", container: SEARCH, before: PROJECT});
        expect(entryDropAt(current, tab("files"), {kind: "entry", container: SEARCH}, NEW)).toEqual({kind: "join-container", container: SEARCH});
    });

    it("拖含几个视图的入口：只在入口之间，入口上没有落点；整个浮动窗不进活动栏", () => {
        const source: WorkbenchDragSource = {kind: "container", container: PROJECT};
        expect(entryDropAt(doc(), source, {kind: "gap", before: null}, NEW)).toEqual({kind: "move-entry", container: PROJECT, before: null});
        expect(entryDropAt(doc(), source, {kind: "entry", container: SEARCH}, NEW)).toBeNull();
        expect(entryDropAt(doc(), {kind: "panel", panel: "x"}, {kind: "gap", before: null}, NEW)).toBeNull();
    });
});

describe("放下与预览（输出 38、45）", () => {
    it("新建容器：放下时侧栏切到它，入口排在落下的空位；视图是它唯一的分节", () => {
        const after = drop(doc(), tab("files"), {kind: "new-container", container: NEW, before: SEARCH}, true);
        expect(shownIds(after)).toEqual([PROJECT, NEW, SEARCH, MARKS]);
        expect(sidebar(after)?.activeContainer).toBe(NEW);
        expect(viewSection(after, "files")?.container).toBe(NEW);
        expect(shownView(after, "files")).toBe(true);
        expect(shownView(after, "outline")).toBe(false);
    });

    it("预览里不切：入口已经排好，侧栏还是原来的容器，少了被拖走的那个视图", () => {
        const preview = drop(doc(), tab("files"), {kind: "new-container", container: NEW, before: SEARCH}, false);
        expect(shownIds(preview)).toEqual([PROJECT, NEW, SEARCH, MARKS]);
        expect(sidebar(preview)?.activeContainer).toBe(PROJECT);
        expect(shownView(preview, "files")).toBe(false);
        expect(shownView(preview, "outline")).toBe(true);
    });

    it("侧栏隐藏或拖到零时，放下在同一次写入里展开；预览里不展开", () => {
        const hidden = must(setPanelHidden(doc(), anchorOf(doc()), true));
        const folded = must(setPanelCollapsed(hidden, anchorOf(hidden), true));
        const after = drop(folded, tab("chat"), {kind: "new-container", container: NEW, before: null}, true);
        expect(sidebar(after)?.activeContainer).toBe(NEW);
        expect([sidebar(after)?.hidden, sidebar(after)?.collapsed]).not.toContain(true);
        expect(sidebar(drop(folded, tab("chat"), {kind: "new-container", container: NEW, before: null}, false))).toMatchObject({hidden: true, collapsed: true});
    });

    it("并入：成为那个容器最后一个分节，放下才切到它", () => {
        const after = drop(doc(), tab("chat"), {kind: "join-container", container: PROJECT}, true);
        const members = regionContainers(after, "sidebar").find((container) => container.id === PROJECT)?.views;
        expect(members).toEqual(["files", "outline", "chat"]);
        const preview = drop(doc(), tab("chat"), {kind: "join-container", container: SEARCH}, false);
        expect(sidebar(preview)?.activeContainer).toBe(PROJECT);
        expect(regionContainers(preview, "sidebar").find((container) => container.id === SEARCH)?.views).toEqual(["search", "chat"]);
        expect(sidebar(drop(doc(), tab("chat"), {kind: "join-container", container: SEARCH}, true))?.activeContainer).toBe(SEARCH);
    });

    it("换序只改入口顺序：容器、显隐、当前容器都不变", () => {
        const after = drop(doc(), tab("search"), {kind: "move-entry", container: SEARCH, before: PROJECT}, true);
        expect(shownIds(after)).toEqual([SEARCH, PROJECT, MARKS]);
        expect(sidebar(after)?.activeContainer).toBe(PROJECT);
        expect(viewSection(after, "search")?.container).toBe(SEARCH);
        const multi = drop(doc(), {kind: "container", container: PROJECT}, {kind: "move-entry", container: PROJECT, before: null}, true);
        expect(shownIds(multi)).toEqual([SEARCH, MARKS, PROJECT]);
    });

    it("原处返回原文档（输出 28）：自己的入口上、紧挨着它的两个空位", () => {
        const current = doc();
        expect(drop(current, tab("search"), {kind: "join-container", container: SEARCH}, true)).toBe(current);
        expect(drop(current, tab("search"), {kind: "move-entry", container: SEARCH, before: SEARCH}, true)).toBe(current);
        expect(drop(current, tab("search"), {kind: "move-entry", container: SEARCH, before: MARKS}, true)).toBe(current);
        expect(drop(current, {kind: "container", container: MARKS}, {kind: "move-entry", container: MARKS, before: null}, true)).toBe(current);
        // 它已经是那个容器最后一个分节、容器又是当前的：只切换的话什么都没变。
        expect(drop(current, tab("outline"), {kind: "join-container", container: PROJECT}, true)).toBe(current);
    });
});
