/**
 * 宿主提供给插件的本地能力（docs/adr/0026-plugin-definitions-as-constants.md）：插件要宿主的东西时，在入口的
 * `dependencies` 里声明这里的键，不经工厂参数。和项目有关的能力（`projectsKey`、`windowProjectKey`、
 * `currentProjectKey`）在 `projects.ts`。
 */

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {EntryRef, EntryState} from "@notnotype/nb-runtime/plugins";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

/** 服务端的状态根。宿主拥有根的位置，根下的布局归各插件（例如 Storage 的 `storage/user.sqlite`）。 */
export interface StateRoot {
    /** 宿主已解析的绝对路径（不保证是 realpath）；首次启动时目录可能还不存在，用到的插件自己建。 */
    readonly path: string;
}

/** 服务端宿主提供；状态根不发给浏览器。 */
export const stateRootKey: ServiceKey<StateRoot> = defineServiceKey<StateRoot>("nbook/state-root");

/** 本窗口的整页导航。 */
export interface WindowNavigation {
    /** 整页加载到 `href`（生产是 `location.assign`）。 */
    navigateDocument(href: string): void;
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
}

/** 一份没保存的正文：文件地址与正文。 */
export interface RescuedText {
    readonly path: string;
    readonly text: string;
}

/**
 * 终态时的抢救（docs/specs/runtime/browser-host.md 的“失败呈现”）：插件登记提供者，宿主转入服务端已重启、项目已关闭或
 * 版本不一致的终态时，在停止插件之前同步调用它们，把未保存的正文列在终态页上。提供者必须同步返回，不能依赖远程调用。
 */
export interface WindowRescue {
    register(provider: () => ReadonlyArray<RescuedText>): () => void;
}

export const windowRescueKey: ServiceKey<WindowRescue> = defineServiceKey<WindowRescue>("nbook/window-rescue");

/** 浏览器宿主提供给本窗口的插件。 */
export const windowPluginsKey: ServiceKey<WindowPlugins> = defineServiceKey<WindowPlugins>("nbook/window-plugins");
