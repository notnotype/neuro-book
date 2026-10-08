import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import {Type} from "typebox";

import type {DisplayText} from "nbook/shared/localized-text";
import {defineSetting} from "nbook/shared/settings";

/**
 * `nbook.workbench` 对其它插件公开的合同：页面贡献点 `workbench.pages` 与它的声明、命令面板的选择服务。
 * 其它插件在运行时只引用本文件（docs/adr/0025-service-keys-by-id.md）；页面实现与窗口根这类依赖 Vue 的
 * 浏览器合同在 `web/contracts.ts`。
 */

/** 贡献点 id。 */
export const WORKBENCH_PAGES_POINT = "workbench.pages";

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

/** 选择的结果在浮层关闭完成（焦点已归还）后才给出；当前页面没有命令面板时为 `unavailable`。 */
export type QuickPickResult =
    | {readonly kind: "item"; readonly id: string}
    | {readonly kind: "text"; readonly text: string}
    | {readonly kind: "cancelled"}
    | {readonly kind: "unavailable"; readonly reason: string};

export interface QuickPick {
    pick(request: QuickPickRequest): Promise<QuickPickResult>;
}

/** 工作台提供的选择服务；需要它的插件在入口依赖里声明。 */
export const quickPickKey: ServiceKey<QuickPick> = defineServiceKey<QuickPick>("nbook.workbench/quick-pick");

/** 产品主题包（docs/specs/theme/system.md）；两层都允许，项目可以给自己定一套。 */
export const themeSetting = defineSetting({
    plugin: "nbook.workbench",
    name: "theme",
    schema: Type.Union([Type.Literal("nbook"), Type.Literal("macos")]),
    default: "nbook",
    title: {"zh-CN": "主题", "en-US": "Theme"},
});

/** 明暗；`system` 跟随系统，配色取主题包的 `defaultColorway[明暗]`。 */
export const appearanceSetting = defineSetting({
    plugin: "nbook.workbench",
    name: "appearance",
    schema: Type.Union([Type.Literal("light"), Type.Literal("dark"), Type.Literal("system")]),
    default: "light",
    title: {"zh-CN": "明暗", "en-US": "Appearance"},
});
