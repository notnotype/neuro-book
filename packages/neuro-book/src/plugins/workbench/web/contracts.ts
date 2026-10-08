import type {Component} from "vue";

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {WorkbenchPageDeclaration} from "../shared/contracts";

/**
 * `nbook.workbench` 的浏览器合同里依赖 Vue 的部分：页面贡献的实现，以及交给窗口宿主的页面表。贡献点 id、页面声明
 * 与选择服务在 `shared/contracts.ts`，别的插件引用那里。
 */

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
