import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

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

/** 产品主题包（docs/specs/theme/system.md）；两层都允许，项目可以给自己定一套。 */
export const themeSetting = defineSetting({
    plugin: "nbook.workbench",
    name: "theme",
    schema: Type.Union([Type.Literal("nbook"), Type.Literal("macos")]),
    default: "nbook",
    description: workbenchText("settings.theme.description"),
    section: "nbook.appearance",
    group: "ui",
    order: 10,
    choices: [
        {value: "nbook"},
        {value: "macos"},
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
