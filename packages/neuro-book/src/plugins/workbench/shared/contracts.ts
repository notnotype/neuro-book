import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {Ref} from "@vue/reactivity";
import {defineDropKind} from "@notnotype/nb-layout";
import type {GridDropPoint} from "@notnotype/nb-layout";
import type {LayoutDropAction, LayoutEdge, LayoutEdgeTarget, LayoutFloatRect} from "@notnotype/nb-workbench-layout";

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

export {OPEN_VIEW_COMMAND, PROJECT_VIEW_CONTAINER, WORKBENCH_VIEW_CONTAINERS_POINT, WORKBENCH_VIEWS_POINT} from "./views";
export type {ViewContainerDeclaration, ViewDeclaration, ViewLocation} from "./views";
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

/** 工作台目录里的一个视图（`WorkbenchCatalogView`）。 */
export interface WorkbenchCatalogEntryView {
    readonly id: string;
    readonly title: string;
    /** 此刻所在的容器；浮动或不在布局里时是 null。 */
    readonly container: string | null;
    /** 标题栏上画成按钮的命令：视图自己声明的与别的插件贡献的，按声明的先后；收进“⋯”的不算。 */
    readonly actions: ReadonlyArray<string>;
}

/** 工作台目录里一个有入口的视图容器（`WorkbenchCatalogView`）。 */
export interface WorkbenchCatalogContainer {
    readonly id: string;
    readonly title: string;
    /** 入口在哪个区域：侧栏的在活动栏上，右栏、底部面板的在各自的入口条上。 */
    readonly region: string;
    /** 成员视图，按分节的先后。 */
    readonly views: ReadonlyArray<string>;
}

/** 工作台目录里的一个活动栏项（`WorkbenchCatalogView`）。 */
export interface WorkbenchCatalogActivityItem {
    readonly id: string;
    readonly title: string;
    /** 点它执行的命令；占位项是 null。 */
    readonly command: string | null;
}

/**
 * 工作台的界面目录（docs/specs/workbench/views.md 输出 23）：视图在哪、入口在哪、标题栏与活动栏上有哪些命令。按读的那一刻的
 * 布局；布局还没建出来（外壳没挂载过）时视图没有容器、没有容器。文字按读的那一刻的界面语言。只读。
 */
export interface WorkbenchCatalogView {
    readonly views: ReadonlyArray<WorkbenchCatalogEntryView>;
    readonly containers: ReadonlyArray<WorkbenchCatalogContainer>;
    readonly activityItems: ReadonlyArray<WorkbenchCatalogActivityItem>;
}

export interface WorkbenchCatalog {
    read(): WorkbenchCatalogView;
}

export const workbenchCatalogKey: ServiceKey<WorkbenchCatalog> = defineServiceKey<WorkbenchCatalog>("nbook.workbench/catalog");

/** 命令面板的匹配与打分（views.md 输出 23）：别的插件给自己的候选排序时用同一份，结果与用户在命令面板里搜到的一致。 */
export {matchCommandText} from "./command-query";
export type {TextMatch as CommandTextMatch} from "./command-query";

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
    /** 常驻：不自动消失。缺省 error 色调、带动作与带详情的通知常驻，其余按色调自动消失；明确给的值优先。 */
    readonly sticky?: boolean;
    /**
     * 开发诊断原文，放进“详情”对话框（ADR 0034：诊断原文只进详情，不当主文案）。是字符串、不是 `DisplayText`：原文不翻译。
     * 必须已脱敏、有界（载体最多留 8000 字，超出截断并注明）；空串与全空白等于没有。`update` 里给空串清除详情。
     */
    readonly detail?: string;
    /** 发出方已经截过原文时给 true：对话框照样注明“已截断”（载体只能从长度看出自己截没截）。只随 `detail` 一起生效。 */
    readonly detailTruncated?: boolean;
    /**
     * 用户关掉了这条（输出 18）：弹出的关闭、中心的“移除”或“全部清除”，先到的那次调用一次。点动作、`dismiss`、按时消失本身、
     * 中心挤出都不调用。发出时定下，`update` 不能换。
     */
    readonly onClose?: () => void;
}

/** 已发出的通知：改进度、文字、色调与常驻，或移除。 */
export interface NotificationHandle {
    readonly id: string;
    update(patch: Partial<Omit<NotificationInput, "onClose">>): void;
    dismiss(): void;
}

export interface Notifications {
    notify(input: NotificationInput): NotificationHandle;
}

/** 工作台提供的通知服务（本窗口一份队列，视口挂在页面根上）；需要它的插件在入口依赖里声明。 */
export const notificationsKey: ServiceKey<Notifications> = defineServiceKey<Notifications>("nbook.workbench/notifications");

export {WORKBENCH_THEMES_POINT} from "./themes";

/** 入口计数的写法（活动栏、区域入口条的角标）；别的插件画同一种角标时用它。 */
export {entryCountText} from "./entry-count";
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

/**
 * 实时布局下卡片什么时候缩小（docs/specs/ui/workbench-layout.md“实时布局”）：一离开标签条就缩，或离开来源面板才缩。只有用户层，理由同上。
 */
export const dragCardShrinkSetting = defineSetting({
    plugin: "nbook.workbench",
    name: "dragCardShrink",
    schema: Type.Union([Type.Literal("strip"), Type.Literal("panel")]),
    default: "strip",
    layers: ["user"],
    section: "nbook.appearance",
    group: "ui",
    order: 42,
    choices: [
        {value: "strip", title: workbenchText("settings.dragCardShrink.choices.strip.title")},
        {value: "panel", title: workbenchText("settings.dragCardShrink.choices.panel.title")},
    ],
});

/**
 * 实时布局下拖动的卡片多久写一次尺寸（docs/specs/ui/workbench-layout.md“实时布局”）：卡片里的内容按卡片大小排版，尺寸每写一次就重排一次；位置照旧每帧跟手。
 * 只管拖动的卡片，不管开关面板的布局过渡。只有用户层，理由同上。
 */
export const dragCardRefreshSetting = defineSetting({
    plugin: "nbook.workbench",
    name: "dragCardRefresh",
    schema: Type.Union([Type.Literal("display"), Type.Literal("60"), Type.Literal("30")]),
    default: "display",
    description: workbenchText("settings.dragCardRefresh.description"),
    layers: ["user"],
    section: "nbook.appearance",
    group: "ui",
    order: 43,
    choices: [
        {value: "display", title: workbenchText("settings.dragCardRefresh.choices.display.title")},
        {value: "60", title: workbenchText("settings.dragCardRefresh.choices.60.title")},
        {value: "30", title: workbenchText("settings.dragCardRefresh.choices.30.title")},
    ],
});

/**
 * 拖到四周时怎么分（docs/specs/ui/workbench-layout.md 输出 27）：只分本窗口，或同方向的窗口一起分。只有用户层，理由同上。
 */
export const dropSplitSetting = defineSetting({
    plugin: "nbook.workbench",
    name: "dropSplit",
    schema: Type.Union([Type.Literal("half"), Type.Literal("shared")]),
    default: "half",
    layers: ["user"],
    section: "nbook.appearance",
    group: "ui",
    order: 45,
    choices: [
        {value: "half", title: workbenchText("settings.dropSplit.choices.half.title")},
        {value: "shared", title: workbenchText("settings.dropSplit.choices.shared.title")},
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
    /** 在外缘目标开一块空面板（两块之间、拆一块），同样不改活动面板。 */
    openAt(target: LayoutEdgeTarget): string | null;
    /** 开一个空的浮动窗，同样不改活动面板。窗数到上限时是 null。 */
    openFloat(rect: LayoutFloatRect): string | null;
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

/** 布局文档里编辑器标签的键：和 nb-workbench-layout 的 `tabKey` 同一写法（`editor-panels.test.ts` 核对）。标签的 DOM 上写它（`data-panel-tab`），工作台的拖动才认得。 */
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

/**
 * 文件能落到的地方（docs/specs/ui/workbench-layout.md 输出 39、docs/specs/workbench/files-explorer.md“拖到编辑区”）：资源树的拖动会话在树外问工作台。`shared/` 要过服务端类型检查，这里不写 DOM 类型。
 */
export interface WorkbenchFileDrop {
    readonly action: LayoutDropAction;
    /** 编辑组标签条的分区。 */
    readonly part?: string;
    /** 比较键：`float` 的矩形每帧变，不算。 */
    readonly key: string;
    /** 拖影上的字（放在这里、拆到这一边、浮动打开……）。 */
    readonly label: string;
}

export interface WorkbenchFileDropHost {
    /** 指针下文件能落到哪；`top` 是指针处最上层的元素，窗口外是 null。 */
    resolve(point: GridDropPoint, top: unknown): WorkbenchFileDrop | null;
    /** 反馈归外壳画（矩形、插入线、分区与读屏）：拖动方只报这一刻的落点，它要的是 `resolve` 给的那个对象。 */
    show(drop: WorkbenchFileDrop | null): void;
    /** 在落点打开这些地址。 */
    commit(drop: WorkbenchFileDrop, addresses: ReadonlyArray<string>): void;
}

/** 外壳根登记的落点：被传送出去的菜单、对话框不在外壳根里，往上找不到它。 */
export const WORKBENCH_FILE_DROP = defineDropKind<WorkbenchFileDropHost>("nbook.workbench.file");

// ─── 视图的标题区（docs/specs/workbench/views.md 输出 19）─────────────────────────────────────────

/**
 * 内置视图申请接管面板头标题区的标记：`const view: ViewImplementation & ViewHeadOptIn = {load, [VIEW_HEAD]: true}`，再经
 * `viewHeadOf(context)` 取这一代实例的标题区。放在共用合同里，是因为别的插件在运行时只能引对方的 `shared/contracts.ts`
 * （ADR 0025）。符号与取法都不经插件 SDK 导出（`src/sdk/workbench.ts`），第三方拿不到，标题区只给内置视图；有第二个用户时再考虑公开。
 */
export const VIEW_HEAD: unique symbol = Symbol("nbook.workbench/view-head");

export interface ViewHeadOptIn {
    readonly [VIEW_HEAD]: true;
}

/**
 * 内置视图声明在浮动窗里自绘整个头（docs/specs/workbench/views.md 输出 19 的“自绘头”）：`band` 是视图画在内容顶上的那一条头有多高（CSS px），
 * 工作台把视图动作与框架按钮竖直居中盖在这一条的右端，别的视图拖到这一条上是添加到最后。只和 `VIEW_HEAD` 一起读：自绘时视图从 `ViewHead.ownHead` 得知。
 */
export const VIEW_OWN_HEAD: unique symbol = Symbol("nbook.workbench/view-own-head");

export interface ViewOwnHeadOptIn {
    readonly [VIEW_OWN_HEAD]: {readonly band: number};
}

/**
 * 面板头给视图的几个位置，都是工作台渲染的元素，视图只往里送内容，不改它们的属性。共用合同不带 DOM 类型，这里写成 `object`：
 * 视图在自己的组件里用 `instanceof HTMLElement` 取（类型守卫，不是断言）。
 */
export interface ViewHeadSlots {
    readonly start: object;
    /** 在标题按钮里面：只放文字与图标，不放可交互的元素。 */
    readonly title: object;
    readonly end: object;
    /** 标题按钮本身：浮层锚在它上面，关掉后焦点回到它。 */
    readonly handle: object;
}

/**
 * 视图这一代实例的标题区。视图在自己的组件树里画头，用 `Teleport` 送进这些位置：头与视图共用状态、注入与错误边界，
 * 头渲染出错时实例变成 `render-failed`，面板头退回只写声明标题；标题按钮始终由工作台渲染，拖动、键盘拿起与右键菜单都不经过视图。
 * 实例换代时工作台给新的一份，旧的那份不再收到位置与按下。
 */
export interface ViewHead {
    /** 面板头此刻给视图的位置；为 null 时视图在自己的内容里画头。 */
    readonly slots: Readonly<Ref<ViewHeadSlots | null>>;
    /** 面板展开时按标题按钮（点击、回车）调它；面板收起时工作台只展开、不调。返回取消订阅。 */
    onTitlePress(listener: () => void): () => void;
    /** 标题按钮弹出的东西开着没有；null 是不弹出东西。视图写，工作台写到按钮的 `aria-haspopup`、`aria-expanded`。 */
    readonly titlePopup: Ref<{readonly expanded: boolean} | null>;
    /**
     * 视图此刻要不要接管标题区，缺省 true。视图写 false 时面板头按普通画法（标题、计数、点标题照常折叠），`slots` 交回 null，视图在自己的内容里
     * 画头；写回 true 又接管。给按自己的宽窄换版式的视图用（消息视图宽版时头画在聊天区上方）。要在 `setup` 里同步写初值，免得首帧接管、再翻回去。
     */
    readonly claim: Ref<boolean>;
    /**
     * 此刻在自绘整个头没有（工作台写，视图只读）：实现声明了 `VIEW_OWN_HEAD`、在只有它一个标签的浮动窗里时为 true，这时没有面板头，`slots` 是 null，
     * 视图把头画在内容顶上、给可拖的元素写 `data-window-drag`，右端按 CSS 变量 `--workbench-own-head-inset-end` 留出工作台盖上来的按钮。
     */
    readonly ownHead: Readonly<Ref<boolean>>;
}

/** 以上下文为键：视图手里只有 `context`，不另开一条注入通道。 */
const viewHeads = new WeakMap<object, ViewHead>();

/** 视图取自己这一代的标题区；没申请（或不是工作台建的上下文）时是 null。 */
export function viewHeadOf(context: object): ViewHead | null {
    return viewHeads.get(context) ?? null;
}

/** 只给工作台：为申请了的实例的这一代上下文挂上标题区（`web/views/view-head.ts`）。 */
export function attachViewHead(context: object, head: ViewHead): void {
    viewHeads.set(context, head);
}
