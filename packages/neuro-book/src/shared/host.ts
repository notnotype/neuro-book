/**
 * 宿主提供给插件的本地能力（docs/adr/0026-plugin-definitions-as-constants.md）：插件要宿主的东西时，在入口的
 * `dependencies` 里声明这里的键，不经工厂参数。和项目有关的能力（`projectsKey`、`windowProjectKey`、
 * `currentProjectKey`）在 `projects.ts`。
 */

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {EntryRef, EntryState} from "@notnotype/nb-runtime/plugins";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {PluginProblem} from "nbook/plugin-platform/shared/types";
import type {DisplayText} from "nbook/shared/localized-text";

/** 服务端的状态根。宿主拥有根的位置，根下的布局归各插件（例如 Storage 的 `storage/user.sqlite`）。 */
export interface StateRoot {
    /** 宿主已解析的绝对路径（不保证是 realpath）；首次启动时目录可能还不存在，用到的插件自己建。 */
    readonly path: string;
}

/** 服务端宿主提供；状态根不发给浏览器。 */
export const stateRootKey: ServiceKey<StateRoot> = defineServiceKey<StateRoot>("nbook/state-root");

/**
 * 服务端进程启动时的环境（`env:<变量名>` 只认它，docs/specs/models/service.md 输出 1）：任何导入 OMP 的模块求值之前拍下的
 * `process.env`，之后进程里再改的不算。只在服务端提供，不发给浏览器。
 */
export interface StartupEnvironment {
    readonly env: Readonly<Record<string, string | undefined>>;
}

export const startupEnvKey: ServiceKey<StartupEnvironment> = defineServiceKey<StartupEnvironment>("nbook/startup-env");

/**
 * 服务端进程所属用户的目录（docs/specs/runtime/projects.md 输出第 19 条）：`~` 按 `home` 展开；缺省作品目录建在
 * `documents`（解析不到系统文档目录时为 null，退到 `home`）下。只在服务端提供。
 */
export interface UserDirectories {
    readonly home: string;
    readonly documents: string | null;
}

export const userDirectoriesKey: ServiceKey<UserDirectories> = defineServiceKey<UserDirectories>("nbook/user-directories");

/**
 * 本窗口的整页导航（docs/specs/runtime/browser-host.md 启动序列第 5 步）。三者都只发出请求：页面已有的离开保护
 * （编辑器的 beforeunload）照常生效，用户取消时什么都不变。
 */
export interface WindowNavigation {
    /** 整页加载到 `href`（生产是 `location.assign`）。 */
    navigateDocument(href: string): void;
    /** 重新载入当前文档，地址不变（生产是 `location.reload`）。 */
    reloadDocument(): void;
    /** 在新标签页打开外部地址；浏览器拦截了弹出窗口时为 `blocked`。 */
    openExternal(href: string): "opened" | "blocked";
    /** 当前文档的地址（生产是 `location.href`）；一次性的地址参数（例如继续写作的 `open`、`at`）从这里读。 */
    currentUrl(): string;
    /** 不导航地替换地址栏（生产是 `history.replaceState`）：读过一次性参数后去掉它们。 */
    replaceUrl(href: string): void;
}

/** 浏览器宿主提供给本窗口的插件。 */
export const windowNavigationKey: ServiceKey<WindowNavigation> = defineServiceKey<WindowNavigation>("nbook/window-navigation");

/**
 * 宿主的时钟：插件的计时、合并与截止经它（例如配置文件变化后的合并重读）。三个宿主都提供系统时钟；测试场地换成
 * `ManualClock`，不用固定等待。
 */
export const clockKey: ServiceKey<RuntimeClock> = defineServiceKey<RuntimeClock>("nbook/clock");

/** 本窗口远程服务链路的在线状态。首连成功之前是 `offline`；服务端换进程、项目代次结束这类终态之后窗口整体失效。 */
export type WindowConnectionState = "online" | "offline";

export interface WindowConnection {
    state(): WindowConnectionState;
    /** 状态变化时调用；返回取消函数。监听抛错只记诊断，不影响其它监听与链路。 */
    onChange(listener: (state: WindowConnectionState) => void): () => void;
}

/** 浏览器宿主提供给本窗口的插件；建立失败的远程订阅不会被内核重建，插件据此在回到在线时重新订阅。 */
export const windowConnectionKey: ServiceKey<WindowConnection> = defineServiceKey<WindowConnection>("nbook/window-connection");

/** `WindowPlugins.retry` 的结果：恢复并重新激活了，或为什么没有。 */
export type WindowPluginRetry =
    | {readonly status: "activated"}
    | {readonly status: "not-failed"}
    | {readonly status: "failed"; readonly reason: string};

/**
 * 本窗口的插件入口状态（docs/specs/workbench/views.md 输出 8）：工作台据此原位显示视图所属入口的受阻、失败与停止，并对
 * 激活失败的入口提供“重试”。插件管理实现后这些职责并入它的服务。
 */
export interface WindowPlugins {
    /** 入口当前状态；未登记、或运行实例还没建立时为 null。 */
    entryState(ref: EntryRef): EntryState | null;
    /** 入口状态可能变了（激活开始、失败、停止、恢复）时调用；返回取消函数。监听抛错只记诊断。 */
    onChange(listener: () => void): () => void;
    /** 只对激活失败的入口：恢复后重新激活。 */
    retry(ref: EntryRef): Promise<WindowPluginRetry>;
    /** 入口声明的激活事件；未登记、或运行实例还没建立时为 null。按需激活前用它判断某个入口会不会被这个事件激活。 */
    activationEvents(ref: EntryRef): ReadonlyArray<string> | null;
    /** 本窗口此刻的插件问题（入口激活失败、受阻、被拒的贡献、没取到的消息目录），插件页用；运行实例还没建立时只有目录问题。 */
    problems(): ReadonlyArray<PluginProblem>;
}

/** 一份没保存的正文：文件地址与正文。 */
export interface RescuedText {
    readonly path: string;
    readonly text: string;
    /**
     * 这份正文与用户看到的不完全一样时的说明（例如有一块只留下了文字）；没有为 undefined。文字值：终态页经窗口的翻译端口
     * 翻译，插件的目录在终态时仍登记着。
     */
    readonly note?: DisplayText;
}

/**
 * 终态时的抢救（docs/specs/runtime/browser-host.md 的“失败呈现”）：插件登记提供者，宿主转入服务端已重启、项目已关闭或
 * 版本不一致的终态时，在停止插件之前同步调用它们，把未保存的正文列在终态页上。提供者必须同步返回，不能依赖远程调用。
 */
export interface WindowRescue {
    register(provider: () => ReadonlyArray<RescuedText>): () => void;
}

export const windowRescueKey: ServiceKey<WindowRescue> = defineServiceKey<WindowRescue>("nbook/window-rescue");

/** 插件的静态文件（docs/specs/theme/skins.md）：内置的随前端构建，第三方的经插件文件端点；不认识的插件或路径为 null。 */
export interface WindowPluginFiles {
    fileUrl(plugin: string, path: string): string | null;
}

export const windowPluginFilesKey: ServiceKey<WindowPluginFiles> = defineServiceKey<WindowPluginFiles>("nbook/window-plugin-files");

/** 浏览器宿主提供给本窗口的插件。 */
export const windowPluginsKey: ServiceKey<WindowPlugins> = defineServiceKey<WindowPlugins>("nbook/window-plugins");
