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
