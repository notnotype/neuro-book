import type {Component, Ref} from "vue";

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {WorkbenchPageDeclaration} from "../shared/contracts";
import type {ViewLocation} from "../shared/views";

/**
 * `nbook.workbench` 的浏览器合同里依赖 Vue 的部分：页面与视图贡献的实现、`ViewContext`，以及交给窗口宿主的页面表。
 * 贡献点 id、页面与视图的声明、选择服务在 `shared/`，别的插件引用那里。
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

/** 视图贡献的实现（docs/specs/workbench/views.md）：只取得组件定义，实例由工作台创建；首次有效可见时才调用。 */
export interface ViewImplementation {
    load(): Promise<Component>;
}

/**
 * 状态栏与标题栏条目的实现（docs/specs/ui/workbench-shell.md 外壳四输出 33）：都在外壳渲染时响应式读取，数据由贡献方
 * 从自己的状态算出。显示与否只由声明的 `when` 决定，`text()` 不承担隐藏。
 */
export interface ItemImplementation {
    text(): string;
    tooltip?(): string;
    state?(): "normal" | "warning" | "error";
}

/** 编辑器槽贡献的实现：外壳挂编辑器槽时才加载组件。 */
export interface EditorAreaImplementation {
    load(): Promise<Component>;
}

/** 无项目首页贡献的实现（`shared/home.ts`）：没有绑定项目的窗口渲染 `/` 时才加载组件；每次渲染经当前句柄取。 */
export interface WorkbenchHomeImplementation {
    load(): Promise<Component>;
}

/** 编辑器槽的组件经只读的 `context` 属性收到它。 */
export interface EditorAreaContext {
    /** 编辑器槽有效可见；面板最大化时为假（内容停放、不卸载）。 */
    readonly visible: Readonly<Ref<boolean>>;
}

/** 视图组件经只读的 `context` 属性收到它。 */
export interface ViewContext {
    readonly id: string;
    /** 视图代际：工作台每为这个视图创建一个新实例加一，工作台存活期内不复用。 */
    readonly generation: number;
    /** 有效可见；停放、收起与加载中都不算。 */
    readonly visible: Readonly<Ref<boolean>>;
    readonly location: Readonly<Ref<ViewLocation>>;
}
