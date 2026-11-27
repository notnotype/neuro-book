/** 工作台的界面目录（docs/specs/workbench/views.md 输出 23）：用真实的默认布局与容器函数拼，断言别的插件读到的投影。 */

import {describe, expect, it} from "bun:test";

import type {ContributionDescriptor} from "@notnotype/nb-runtime/plugins";
import {floatTab, removeTab} from "@notnotype/nb-workbench-layout";
import type {LayoutDoc} from "@notnotype/nb-workbench-layout";

import {resolverFor} from "nbook/shared/localized-text";

import type {ActivityBarItemDeclaration} from "../shared/items";
import type {ViewTitleItemDeclaration} from "../shared/menus";
import type {ViewDeclaration, ViewLocation} from "../shared/views";
import {workbenchTestText} from "../testing/text";
import {createWorkbenchCatalog} from "./catalog";
import type {ContainerCatalog} from "./state/containers";
import {defaultLayoutDoc} from "./state/default-tree";
import {createLayoutPolicy} from "./state/layout-constraints";
import type {ViewCatalog} from "./views/registry";

const both = (zh: string, en: string) => ({"zh-CN": zh, "en-US": en});
const VIEW = (title: string, en: string, location: ViewLocation, over: Partial<ViewDeclaration> = {}): ViewDeclaration => ({title: both(title, en), icon: `i-${en}`, location, layout: "scroll", ...over});

const PROJECT = "acme.project";
const CONTAINERS: ContainerCatalog = new Map([[PROJECT, {title: both("项目", "Project"), icon: "i-project", location: "sidebar", order: 0}]]);
/** “项目”容器在侧栏装着文件与会话；搜索自己一个容器；对话在右栏。文件的标题栏一个按钮、一个收进“⋯”。 */
const VIEWS: ViewCatalog = new Map([
    ["files", VIEW("文件", "Files", "sidebar", {container: PROJECT, order: 1, actions: [
        {command: "acme.files.new", icon: "i-plus", title: both("新建", "New")},
        {command: "acme.files.refresh", icon: "i-refresh", title: both("刷新", "Refresh"), placement: "menu"},
    ]})],
    ["sessions", VIEW("会话", "Sessions", "sidebar", {container: PROJECT, order: 2})],
    ["search", VIEW("搜索", "Search", "sidebar", {order: 5})],
    ["chat", VIEW("对话", "Chat", "auxiliarybar")],
]);

const descriptor = <T>(id: string, declaration: T): ContributionDescriptor<T> => ({id, plugin: "acme", declaration}) as ContributionDescriptor<T>;
const ACTIVITY = [
    descriptor<ActivityBarItemDeclaration>("acme.settings", {title: both("设置", "Settings"), icon: "i-gear", order: 9, command: {id: "acme.settings.open"}}),
    descriptor<ActivityBarItemDeclaration>("acme.profile", {title: both("个人资料", "Profile"), icon: "i-user", order: 8}),
];
const VIEW_TITLE = [
    descriptor<ViewTitleItemDeclaration>("acme.more.pin", {view: "files", command: "acme.more.pin", section: "main", icon: "i-pin"}),
    descriptor<ViewTitleItemDeclaration>("acme.more.hidden", {view: "files", command: "acme.more.hidden", section: "main", placement: "menu"}),
];

function catalog(doc: LayoutDoc | null, locale = "zh-CN") {
    return createWorkbenchCatalog({
        document: () => doc,
        views: VIEWS,
        containers: CONTAINERS,
        activityItems: ACTIVITY,
        viewTitleItems: VIEW_TITLE,
        text: resolverFor(() => locale, workbenchTestText(locale)),
    }).read();
}

describe("工作台的界面目录（views.md 输出 23）", () => {
    it("视图带标题、所在容器与标题栏上画成按钮的命令：自己的在前、别的插件贡献的在后，收进“⋯”的不算", () => {
        const view = catalog(defaultLayoutDoc(VIEWS, CONTAINERS));
        expect(view.views.find((entry) => entry.id === "files")).toEqual({id: "files", title: "文件", container: PROJECT, placed: true, actions: ["acme.files.new", "acme.more.pin"]});
        expect(view.views.find((entry) => entry.id === "chat")?.actions).toEqual([]);
    });

    it("标题栏上的按钮同外壳一样至多 8 个：再多的进“⋯”，不列", () => {
        const extra = Array.from({length: 9}, (_, index) => descriptor<ViewTitleItemDeclaration>(`acme.extra.${String(index)}`, {view: "files", command: `acme.extra.${String(index)}`, section: "main", icon: "i-x"}));
        const view = createWorkbenchCatalog({document: () => defaultLayoutDoc(VIEWS, CONTAINERS), views: VIEWS, containers: CONTAINERS, activityItems: ACTIVITY, viewTitleItems: [...VIEW_TITLE, ...extra], text: resolverFor(() => "zh-CN", workbenchTestText("zh-CN"))}).read();
        expect(view.views.find((entry) => entry.id === "files")?.actions).toEqual(["acme.files.new", "acme.more.pin", ...Array.from({length: 6}, (_, index) => `acme.extra.${String(index)}`)]);
    });

    it("容器按区域与入口的先后，带标题与成员视图；多个视图的容器列出每一个", () => {
        const doc = defaultLayoutDoc(VIEWS, CONTAINERS);
        const view = catalog(doc);
        const project = view.containers.find((container) => container.id === PROJECT);
        expect(project).toEqual({id: PROJECT, title: "项目", region: "sidebar", views: ["files", "sessions"]});
        const search = view.views.find((entry) => entry.id === "search")!.container;
        expect(view.containers.find((container) => container.id === search)).toMatchObject({title: "搜索", region: "sidebar", views: ["search"]});
        expect(view.containers.find((container) => container.views.includes("chat"))?.region).toBe("auxiliarybar");
    });

    it("活动栏项带标题与命令，占位项没有命令；文字按读的那一刻的界面语言", () => {
        expect(catalog(null).activityItems).toEqual([{id: "acme.settings", title: "设置", command: "acme.settings.open"}, {id: "acme.profile", title: "个人资料", command: null}]);
        expect(catalog(null, "en-US").activityItems[0]?.title).toBe("Settings");
    });

    it("布局还没建出来时视图没有容器、目录里没有容器；视图浮出去后不在任何容器里", () => {
        const empty = catalog(null);
        expect(empty.containers).toEqual([]);
        expect(empty.views.every((entry) => entry.container === null && !entry.placed)).toBe(true);

        const floated = floatTab(defaultLayoutDoc(VIEWS, CONTAINERS), {tab: "view:chat", rect: {x: 40, y: 40, width: 320, height: 240}}, createLayoutPolicy());
        if (!floated.ok) throw new Error(`浮出对话视图失败：${floated.message}`);
        // 浮动的仍在布局里；关掉的不在。
        expect(catalog(floated.doc).views.find((entry) => entry.id === "chat")).toMatchObject({container: null, placed: true});
        const closed = removeTab(defaultLayoutDoc(VIEWS, CONTAINERS), "view:chat");
        if (!closed.ok) throw new Error(`关掉对话视图失败：${closed.message}`);
        expect(catalog(closed.doc).views.find((entry) => entry.id === "chat")).toMatchObject({container: null, placed: false});
    });
});
