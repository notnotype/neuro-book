import type {Component, Ref} from "vue";

import type {LayoutDropAction} from "@notnotype/nb-layout";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";
import type {Text} from "@notnotype/nb-ui/text";

import type {CatppuccinIcon} from "nbook/ui/file-icons/catppuccin";

import type {WorkbenchPageDeclaration} from "../shared/contracts";

/** 按平台写出快捷键（标题栏的命令搜索与菜单用的同一写法）：贡献界面的插件显示命令的快捷键时用它。 */
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
 * 从自己的状态算出。显示与否只由声明的 `when` 决定，`text()` 不承担隐藏。`text()`、`tooltip()` 返回文字值，外壳在渲染时
 * 按当前语言翻译：返回固定的文字引用，切换语言后条目照样换文字。引用要带命名空间（`pluginText` 绑定插件 id）。
 */
export interface ItemImplementation {
    text(): Text;
    tooltip?(): Text;
    state?(): "normal" | "warning" | "error";
}

/**
 * 活动栏底部条目的实现（docs/specs/ui/workbench-shell.md 输出 40）：条目是纯声明，没有要实现的东西；内核要求入口贡献都
 * 给出实现，交空对象，外壳不读它。
 */
export type ActivityBarItemImplementation = Readonly<Record<string, never>>;

/**
 * 页面浮层的实现（输出 41）：只取得组件定义，工作台在页面根上挂一份；组件不收属性，要的数据由贡献方在 `load()` 里绑好。
 * 加载失败或渲染出错只影响这一个浮层。
 */
export interface WorkbenchOverlayImplementation {
    load(): Promise<Component>;
}

/**
 * 编辑器标签的拖动（docs/specs/ui/workbench-layout.md 输出 24 到 32）：手势和落点规则是工作台的，编辑器标签和工具视图一样靠 DOM 标记起拖（`data-panel-tab` 写标签键），插入位按 `TabStrip` 的标记量。
 * 放下不直接改布局：要先结算视图的输入、合并同一标签，再经 `editorPanelsKey` 改结构。
 */
export interface EditorTabDrag {
    /** 结构键里编辑器的部分（固定状态、多行设置）：起拖后它变了，整场取消。 */
    structure(): string;
    /** 拖影。 */
    ghost(tabId: string): {readonly label: string; readonly fileIcon: CatppuccinIcon | null} | null;
    /** `part` 是标签条的分区（固定、普通）：同一个位置可能分属两边。 */
    /** `keyboard`：键盘放下，手势会把焦点还给标签。 */
    drop(tabId: string, action: LayoutDropAction, part: string | undefined, keyboard: boolean): void;
}

/** 编辑器槽的内容（docs/specs/ui/workbench-layout.md“边界与兼容”）。 */
export interface EditorAreaParts {
    /** 区级的东西（关闭询问、标签的拖动）：无布局，外壳挂一次，属性见 `EditorAreaHostProps`。 */
    readonly host: Component;
    /** 一个标签的内容：编辑组每个标签一个，空的编辑组一个，属性 `panelId`、`tabId`（空的编辑组是 null）与 `context`。标签移到别的组时不重建，`panelId` 跟着变。 */
    readonly group: Component;
    /** 一个编辑组的头（标签条、标题动作、提示条）：画在外框里，属性 `panelId`。不给时没有头，内容占满这块面板。 */
    readonly head?: Component;
}

export interface EditorAreaHostProps {
    /** 挂上时交出标签的拖动，卸载时交 null。不交的话编辑器标签不起拖。 */
    readonly attachTabDrag: (drag: EditorTabDrag | null) => void;
}

/** 编辑器槽贡献的实现：外壳挂编辑器槽时才加载组件。 */
export interface EditorAreaImplementation {
    load(): Promise<EditorAreaParts>;
}

/** 无项目首页贡献的实现（`shared/home.ts`）：没有绑定项目的窗口渲染 `/` 时才加载组件；每次渲染经当前句柄取。 */
export interface WorkbenchHomeImplementation {
    load(): Promise<Component>;
}

/** 编辑组的组件经只读的 `context` 属性收到它。 */
export interface EditorAreaContext {
    /** 这个编辑组有效可见；别的面板最大化时为假（内容停放、不卸载）。 */
    readonly visible: Readonly<Ref<boolean>>;
}

/** 视图组件经只读的 `context` 属性收到它。 */
export interface ViewContext {
    readonly id: string;
    /** 视图代际：工作台每为这个视图创建一个新实例加一，工作台存活期内不复用。 */
    readonly generation: number;
    /** 有效可见；停放、收起与加载中都不算。 */
    readonly visible: Readonly<Ref<boolean>>;
    /** 视图在哪个具名面板；无名面板是 null（docs/specs/ui/workbench-layout.md“边界与兼容”）。 */
    readonly location: Readonly<Ref<ViewLocation | null>>;
}
