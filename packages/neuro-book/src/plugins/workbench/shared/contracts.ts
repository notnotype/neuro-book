import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {Ref} from "@vue/reactivity";
import type {LayoutEdge, LayoutEdgeTarget, LayoutFloatRect} from "@notnotype/nb-layout";

import {Type} from "typebox";

import type {DisplayText} from "nbook/shared/localized-text";
import {defineSetting} from "nbook/shared/settings";

import {workbenchText} from "./text";

/**
 * `nbook.workbench` 对其它插件公开的合同：页面贡献点 `workbench.pages` 与它的声明、视图贡献点 `workbench.views` 与它的
 * 声明（定义在 `views.ts`）、编辑器槽贡献点 `workbench.editor-area` 与它的声明、命令面板的选择服务、通知服务。
 * 其它插件在运行时只引用本文件（docs/adr/0025-service-keys-by-id.md）；页面实现与窗口根这类依赖 Vue 的
 * 浏览器合同在 `web/contracts.ts`。
 */

export {WORKBENCH_VIEWS_POINT} from "./views";
export type {ViewDeclaration, ViewLocation} from "./views";
// 条目贡献点（状态栏、标题栏、活动栏底部）、页面浮层与无项目首页贡献点：定义与校验在各自的模块，其它插件只从这里引用（跨插件运行时导入只能指向 shared/contracts）。
export {WORKBENCH_ACTIVITYBAR_ITEMS_POINT, WORKBENCH_STATUSBAR_ITEMS_POINT, WORKBENCH_TITLEBAR_ITEMS_POINT} from "./items";
export type {ActivityBarItemDeclaration, ItemDeclaration} from "./items";
export {WORKBENCH_OVERLAYS_POINT} from "./overlays";
export type {OverlayDeclaration} from "./overlays";
export {WORKBENCH_HOME_POINT, WORKBENCH_PATH} from "./home";
export type {HomeDeclaration} from "./home";
export {WORKBENCH_TITLEBAR_MENU_POINT, WORKBENCH_VIEW_TITLE_POINT} from "./menus";
export type {TitlebarMenuGroup, TitlebarMenuItemDeclaration, ViewTitleItemDeclaration} from "./menus";

/** 贡献点 id。 */
export const WORKBENCH_PAGES_POINT = "workbench.pages";

/**
 * 编辑器槽的贡献点（docs/specs/ui/workbench-shell.md 非目标第一条）：外壳的编辑器槽挂 `order` 最小的一个贡献；
 * 工作台不认识编辑器插件，依赖方向是“编辑器插件 → 工作台”。
 */
export const WORKBENCH_EDITOR_AREA_POINT = "workbench.editor-area";

export interface EditorAreaDeclaration {
    /** 几个提供者同时在时取最小的；相同时按贡献 id。 */
    readonly order: number;
}

/** 页面贡献的声明：登记时校验，路径在页面表里唯一。 */
export interface WorkbenchPageDeclaration {
    /** 静态路径，小写字母、数字与连字符的段，例如 `/lab`；`/` 是工作台自己的页面，`/api`、`/assets` 留给宿主。 */
    readonly path: string;
    /** 文档标题。 */
    readonly title: string;
    /**
     * 离开本页去别的路径时整页加载，而不是在同一个文档里切换。用于会改写文档级状态（`<html>` 上的主题、全局监听）
     * 且不保证离开时全部复原的页面，例如 Lab。
     */
    readonly reloadOnLeave?: boolean;
}

/** 选择模式的一项候选。文字显示时才按当前语言取（`DisplayText`），面板开着时切换语言随之换文字。 */
export interface QuickPickItem {
    readonly id: string;
    readonly label: DisplayText;
    /** 第二行的说明（例如项目目录路径）。 */
    readonly detail?: DisplayText;
}

/**
 * 命令发起的一次候选选择（workbench.quick-open 的选择模式）：在命令面板的同一浮层里列出候选，用户选一项、
 * 提交输入的文字或取消。只有一步，不是向导。
 */
export interface QuickPickRequest {
    readonly title: DisplayText;
    readonly placeholder: DisplayText;
    readonly items: ReadonlyArray<QuickPickItem>;
    /** 给了它时，输入的文字本身也可以提交：候选末尾多一项，文案由它给出。 */
    readonly text?: {readonly label: (text: string) => DisplayText};
    /** 没有候选时的空态文案。 */
    readonly empty?: DisplayText;
}

/**
 * 选择的结果在浮层关闭完成（焦点已归还）后才给出；当前页面没有命令面板时为 `unavailable`，`reason` 是文字值，命令把它原样
 * 交进自己的失败结果，显示的一方再翻。
 */
export type QuickPickResult =
    | {readonly kind: "item"; readonly id: string}
    | {readonly kind: "text"; readonly text: string}
    | {readonly kind: "cancelled"}
    | {readonly kind: "unavailable"; readonly reason: DisplayText};

export interface QuickPick {
    pick(request: QuickPickRequest): Promise<QuickPickResult>;
}

/** 工作台提供的选择服务；需要它的插件在入口依赖里声明。 */
export const quickPickKey: ServiceKey<QuickPick> = defineServiceKey<QuickPick>("nbook.workbench/quick-pick");

export type NotificationTone = "info" | "success" | "warning" | "error";

/**
 * 一条通知（docs/specs/workbench/notifications.md）。标题说发生了什么，正文说原因与现在显示的是什么，动作说能做什么。
 * 文字是文字值（`DisplayText`）：交文字引用或语言映射，视口显示时才按当前语言翻，切换语言后已显示的通知随之换文字；
 * 字符串原样显示。不要先折成字符串再交进来。
 */
export interface NotificationInput {
    readonly tone?: NotificationTone;
    readonly title?: DisplayText;
    readonly message: DisplayText;
    /** 动作按钮；点了之后通知移除。 */
    readonly action?: {readonly label: DisplayText; readonly run: () => void};
    /** 进度（0 到 100）；null 为不确定进度；不给就没有进度条。 */
    readonly progress?: number | null;
    /** 常驻：不自动消失。缺省 error 色调与带动作的通知常驻，其余按色调自动消失。 */
    readonly sticky?: boolean;
}

/** 已发出的通知：改进度、文字、色调与常驻，或移除。 */
export interface NotificationHandle {
    readonly id: string;
    update(patch: Partial<NotificationInput>): void;
    dismiss(): void;
}

export interface Notifications {
    notify(input: NotificationInput): NotificationHandle;
}

/** 工作台提供的通知服务（本窗口一份队列，视口挂在页面根上）；需要它的插件在入口依赖里声明。 */
export const notificationsKey: ServiceKey<Notifications> = defineServiceKey<Notifications>("nbook.workbench/notifications");

export {WORKBENCH_THEMES_POINT} from "./themes";
export type {ThemeDeclaration} from "./themes";

/** 选项提供者（`settings.choices`），工作台的浏览器入口贡献。 */
export const THEME_CHOICES_PROVIDER = "nbook.workbench.themes";

/** 产品主题（docs/specs/theme/skins.md）；值是 `workbench.themes` 的贡献 id，可以是插件给的，所以不列枚举。两层都允许，项目可以给自己定一套。 */
export const themeSetting = defineSetting({
    plugin: "nbook.workbench",
    name: "theme",
    schema: Type.String({minLength: 1}),
    default: "nbook",
    description: workbenchText("settings.theme.description"),
    section: "nbook.appearance",
    group: "ui",
    order: 10,
    choices: {from: THEME_CHOICES_PROVIDER},
});

/**
 * 拖动时把落点分区画出来（docs/specs/ui/workbench-layout.md“落点分区”）。只有用户层：这是个人的操作习惯，项目文件不该替人改。
 */
export const dropSectorsSetting = defineSetting({
    plugin: "nbook.workbench",
    name: "dropSectors",
    schema: Type.Boolean(),
    default: true,
    description: workbenchText("settings.dropSectors.description"),
    layers: ["user"],
    section: "nbook.appearance",
    group: "ui",
    order: 30,
});

/**
 * 拖动的手感（docs/specs/ui/workbench-layout.md“实时布局”）：实时布局是卡片跟手、邻居真实让位；落点指示是布局不动、只画结果。只有用户层，理由同上。
 */
export const dragFeelSetting = defineSetting({
    plugin: "nbook.workbench",
    name: "dragFeel",
    schema: Type.Union([Type.Literal("live"), Type.Literal("indicator")]),
    default: "live",
    layers: ["user"],
    section: "nbook.appearance",
    group: "ui",
    order: 40,
    choices: [
        {value: "live", title: workbenchText("settings.dragFeel.choices.live.title")},
        {value: "indicator", title: workbenchText("settings.dragFeel.choices.indicator.title")},
    ],
});

/** 明暗；`system` 跟随系统，配色取主题包的 `defaultColorway[明暗]`。 */
export const appearanceSetting = defineSetting({
    plugin: "nbook.workbench",
    name: "appearance",
    schema: Type.Union([Type.Literal("light"), Type.Literal("dark"), Type.Literal("system")]),
    default: "light",
    section: "nbook.appearance",
    group: "ui",
    order: 20,
    choices: [
        {value: "light"},
        {value: "dark"},
        {value: "system"},
    ],
});

// ── 编辑组的结构（docs/specs/ui/workbench-layout.md 输出 33），实现在 `editor-panels.ts` ──

export interface PanelEntry {
    readonly id: string;
    readonly tabs: ReadonlyArray<string>;
    /** 活动标签的 id；空面板为 null。 */
    readonly active: string | null;
    readonly floating: boolean;
}

export interface PanelTabs {
    /** 编辑组，按树序，浮动的排在后面。 */
    readonly panels: Readonly<Ref<ReadonlyArray<PanelEntry>>>;
    /** 画出来的编辑组：拖动中可能是实时布局的预览。只有头读它，结构操作都按 `panels`。 */
    readonly shownPanels: Readonly<Ref<ReadonlyArray<PanelEntry>>>;
    /** 插到 `index`，成为活动标签，面板成为活动面板。 */
    insert(panel: string, tabId: string, index: number): boolean;
    /** 就地换成另一个标签；原来的是活动标签时新的也是。 */
    replace(tabId: string, next: string): boolean;
    /** 拿掉：活动标签被拿掉时换到右边的（没有时左边）；面板空了且还有别的编辑组时面板随之移除，活动面板换到相邻的。 */
    remove(tabId: string): boolean;
    /** 成为活动标签，面板成为活动面板。 */
    activate(tabId: string): boolean;
    /**
     * 移到 `panel` 的 `index`（摘掉来源之前的插入位，和拖动时看到的位置一致）。缺省成为活动标签、面板成为活动面板；`activate: false` 只换位置。来源面板空了同 `remove`。
     */
    move(tabId: string, panel: string, index: number, options?: {readonly activate?: boolean}): boolean;
    /**
     * 移到外缘（输出 27）：只有这一个标签的面板是同一块面板移动，返回它自己的 id，内容不重建；否则拆出新面板。放下去和现在一样时返回 null。不改活动面板，调用方决定。
     */
    moveToEdge(tabId: string, target: LayoutEdgeTarget): string | null;
    /** 浮出来（docs/specs/ui/workbench-layout.md 输出 39）：新的浮动编辑组，成为活动面板，返回它的 id。放不下（窗数到上限）时是 null。 */
    float(tabId: string, rect: LayoutFloatRect): string | null;
}

export interface PanelTree {
    /** 活动面板：最近获得焦点或执行过打开的那块。 */
    readonly current: Readonly<Ref<string>>;
    setCurrent(panel: string): boolean;
    /** 拆这一块，在它的一边开一块空面板（新块取它的一半），返回新面板的 id。不改活动面板：打开时才切过去。 */
    openAtEdge(panel: string, edge: LayoutEdge): string | null;
    /** 右侧相邻的编辑组：只在编辑组里找，工具面板跳过；右边是一列时取最上面的。没有为 null；只查不建。 */
    rightOf(panel: string): string | null;
}

export interface EditorPanels {
    readonly tabs: PanelTabs;
    readonly tree: PanelTree;
}

/**
 * 布局存盘前的关卡。`pass` 每次保存都走，写不下去就返回假，不自己重试：失败要等用户在状态栏点“重试”（`recover`），否则一次断线就是无间隔的重试循环。
 */
export interface EditorSaveGate {
    pass(): Promise<boolean>;
    recover(): Promise<boolean>;
}

/** 布局文档里编辑器标签的键：和 nb-layout 的 `tabKey` 同一写法（`editor-panels.test.ts` 核对）。标签的 DOM 上写它（`data-panel-tab`），工作台的拖动才认得。 */
export const editorTabKey = (tabId: string): string => `tab:${tabId}`;

/** 编辑器要的工作台服务：结构操作，加上“文档读到了没有”与存盘前的关卡。 */
export interface EditorPanelsService extends EditorPanels {
    /** 布局文档读完了；在此之前结构操作没有文档可改。 */
    readonly ready: Readonly<Ref<boolean>>;
    /** 存盘前的关卡（“副作用与数据”）：先写 `editor.tabs`，它失败时布局不写。 */
    acceptSaveGate(gate: EditorSaveGate | null): void;
    /** 让布局现在走一次保存（连同关卡）。 */
    flush(): void;
}

export const editorPanelsKey: ServiceKey<EditorPanelsService> = defineServiceKey<EditorPanelsService>("nbook.workbench/editor-panels");
