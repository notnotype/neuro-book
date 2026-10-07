import type {Component} from "vue";

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

/**
 * `nbook.workbench` 对其它插件与宿主公开的浏览器合同：窗口挂载的页面表，以及贡献页面的贡献点 `workbench.pages`。
 * 其它插件只以 `import type` 引用这里，贡献点 id 写成同一个字面量（类型检查保证一致）。
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

/** 页面贡献的实现：导航到该页时才加载组件，页面代码不进首屏。 */
export interface WorkbenchPageImplementation {
    load(): Promise<Component>;
}

export interface WorkbenchPage extends WorkbenchPageDeclaration, WorkbenchPageImplementation {}

/** 工作台交给窗口的根：窗口在 `nbook.workbench` 激活、解析到它之后才挂载界面。 */
export interface WorkbenchRoot {
    /** 当前的页面表：工作台自己的 `/` 加上已发布的页面贡献。 */
    pages(): ReadonlyArray<WorkbenchPage>;
}

export const workbenchRootKey: ServiceKey<WorkbenchRoot> = defineServiceKey<WorkbenchRoot>("nbook.workbench/root");

/** 选择模式的一项候选。 */
export interface QuickPickItem {
    readonly id: string;
    readonly label: string;
    /** 第二行的说明（例如项目目录路径）。 */
    readonly detail?: string;
}

/**
 * 命令发起的一次候选选择（workbench.quick-open 的选择模式）：在命令面板的同一浮层里列出候选，用户选一项、
 * 提交输入的文字或取消。只有一步，不是向导。
 */
export interface QuickPickRequest {
    readonly title: string;
    readonly placeholder: string;
    readonly items: ReadonlyArray<QuickPickItem>;
    /** 给了它时，输入的文字本身也可以提交：候选末尾多一项，文案由它给出。 */
    readonly text?: {readonly label: (text: string) => string};
    /** 没有候选时的空态文案。 */
    readonly empty?: string;
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

/** 工作台提供的选择服务；需要它的插件在入口依赖里声明，服务键由装配者交给插件工厂。 */
export const quickPickKey: ServiceKey<QuickPick> = defineServiceKey<QuickPick>("nbook.workbench/quick-pick");
