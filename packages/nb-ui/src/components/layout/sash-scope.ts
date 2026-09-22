import {inject, type InjectionKey} from "vue";
import type {SashGestureScope} from "../../composables/useSashGesture";

/**
 * 一个公开 Grid（或一个独立 `Splitter`）只有一份手势 scope。后代分隔线把自己注册进来，
 * 输入仲裁完全按 DOM 冒泡：命中内层 scope 的按下在内层处理并阻止冒泡，外层不重复开始手势。
 *
 * 模块级只保存这个注入键本身——不保存任何 window 全局拖动状态，因此同页多个 Grid 互不干扰。
 */
export const SASH_GESTURE_SCOPE_KEY: InjectionKey<SashGestureScope> = Symbol("nb-ui.sash-gesture-scope");

/** 最近一层 scope；不在任何 Grid / 独立 Splitter 内时为 null。 */
export function useSashScope(): SashGestureScope | null {
    return inject(SASH_GESTURE_SCOPE_KEY, null);
}
