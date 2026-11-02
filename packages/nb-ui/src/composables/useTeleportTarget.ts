/**
 * 居中类浮层（对话框、抽屉、快速输入）与由 reka Popper 定位的浮层（`SuggestionMenu`）的传送目标。缺省传送到
 * `body`；宿主可以在组件树上给一个更近的目标，例如组件 Lab 的画布：浮层落进画布、按画布居中，手机画布上看到的就是
 * 手机宽度下的浮层。组件自己的 `teleportTarget` 写明了就以它为准。
 *
 * 按视口坐标手算 `position: fixed` 位置的浮层（`ContextMenu`、`Menubar` 的级联面板）不用它：Lab 的目标带
 * `contain: layout`，会成为 fixed 后代的包含块，菜单会偏一个画布原点。
 *
 * 目标是选择器，渲染时才查：宿主提供的目标元素要等宿主挂载后才在文档里；查不到时回退 `body`，否则 Teleport 会
 * 静默不渲染整块浮层。所以返回函数而不是 computed，computed 会把挂载前查到的结果缓存下来。
 *
 * 浮层的尺寸用容器单位（`cqw`、`cqh`）：宿主把目标设成尺寸容器时按目标的大小算；没有容器时按小视口单位（`svw`、`svh`）
 * 算，桌面上与视口单位相同，移动浏览器按地址栏展开时的可见区算（比 `vh` 保守，浮层不会伸到地址栏后面）。
 */

import {hasInjectionContext, inject, provide} from "vue";
import type {InjectionKey} from "vue";

export const NB_TELEPORT_TARGET: InjectionKey<string> = Symbol("nb-teleport-target");
export const NB_TELEPORT_CONTAINED: InjectionKey<boolean> = Symbol("nb-teleport-contained");

/**
 * 宿主在自己的组件树上改写居中类浮层的缺省目标；值是选择器。`contained` 为真时（组件 Lab 的画布），模态浮层只在目标里
 * 画遮罩、居中，不锁整页：不让页面其余部分失去指针与焦点、不被设为 aria-hidden，宿主自己的控件（Lab 的检视栏）照常可用。
 */
export function provideTeleportTarget(selector: string, options: {readonly contained?: boolean} = {}): void {
    provide(NB_TELEPORT_TARGET, selector);
    provide(NB_TELEPORT_CONTAINED, options.contained === true);
}

/** 宿主是否要求模态浮层只占目标、不锁整页（见 provideTeleportTarget）。 */
export function useTeleportContained(): boolean {
    return hasInjectionContext() ? inject(NB_TELEPORT_CONTAINED, false) : false;
}

/** 浮层渲染时调用返回的函数，拿到这一刻的目标：显式指定的、宿主提供的，或 `body`。 */
export function useTeleportTarget(explicit: () => string | undefined): () => string {
    const provided = hasInjectionContext() ? inject(NB_TELEPORT_TARGET, null) : null;
    return () => {
        const wanted = explicit() ?? provided ?? "body";
        if (typeof document === "undefined" || wanted === "body") return wanted;
        return document.querySelector(wanted) === null ? "body" : wanted;
    };
}
