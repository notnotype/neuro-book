/**
 * 居中类浮层（对话框、抽屉、快速输入）的传送目标。缺省传送到 `body`；宿主可以在组件树上给一个更近的目标，例如
 * 组件 Lab 的画布：浮层落进画布、按画布居中，手机画布上看到的就是手机宽度下的浮层。组件自己的 `teleportTarget`
 * 写明了就以它为准。
 *
 * 目标是选择器，渲染时才查：宿主提供的目标元素要等宿主挂载后才在文档里；查不到时回退 `body`，否则 Teleport 会
 * 静默不渲染整块浮层。所以返回函数而不是 computed，computed 会把挂载前查到的结果缓存下来。
 *
 * 浮层的尺寸用容器单位（`cqw`、`cqh`）：宿主把目标设成尺寸容器时按目标的大小算；没有容器时这两个单位等于视口单位。
 */

import {hasInjectionContext, inject, provide} from "vue";
import type {InjectionKey} from "vue";

export const NB_TELEPORT_TARGET: InjectionKey<string> = Symbol("nb-teleport-target");

/** 宿主在自己的组件树上改写居中类浮层的缺省目标；值是选择器。 */
export function provideTeleportTarget(selector: string): void {
    provide(NB_TELEPORT_TARGET, selector);
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
