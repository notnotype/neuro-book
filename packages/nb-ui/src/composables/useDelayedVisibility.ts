import {getCurrentScope, onScopeDispose, readonly, ref, watch} from "vue";
import type {Ref, WatchSource} from "vue";

/**
 * 加载指示该不该画出来（前端规范“加载与流畅性”第 7 条，设计语言“反馈与等待”第 2 条）。
 *
 * - `source` 变真后等 `delay` 才显示：读得快的请求什么都不出现。
 * - 一旦显示，至少停留 `minVisible` 再隐藏：300ms 左右的请求不闪一下就没了。
 * - `delay` 之内 `source` 变回假，始终不显示。
 *
 * 时间经 `timers` 注入，测试传手动的实现；缺省用全局的计时器。
 */
export interface VisibilityTimers {
    now(): number;
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}

export interface DelayedVisibilityOptions {
    /** 出现前的延时，毫秒。 */
    delay?: number;
    /** 出现后至少停留，毫秒。 */
    minVisible?: number;
    timers?: VisibilityTimers;
}

export const LOADING_SHOW_DELAY_MS = 200;
export const LOADING_MIN_VISIBLE_MS = 400;

const GLOBAL_TIMERS: VisibilityTimers = {
    now: () => performance.now(),
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export function useDelayedVisibility(source: WatchSource<boolean>, options: DelayedVisibilityOptions = {}): Readonly<Ref<boolean>> {
    const delay = options.delay ?? LOADING_SHOW_DELAY_MS;
    const minVisible = options.minVisible ?? LOADING_MIN_VISIBLE_MS;
    const timers = options.timers ?? GLOBAL_TIMERS;
    const visible = ref(false);
    let shownAt = 0;
    // 同一时刻至多一个待办：要么等着出现，要么等着停够了再隐藏。
    let pending: unknown = undefined;

    const cancel = (): void => {
        if (pending !== undefined) timers.clearTimeout(pending);
        pending = undefined;
    };
    const show = (): void => {
        pending = undefined;
        visible.value = true;
        shownAt = timers.now();
    };
    const hide = (): void => {
        pending = undefined;
        visible.value = false;
    };

    watch(source, (busy) => {
        cancel();
        if (busy) {
            // 正在停留期里又忙起来：接着显示，不重新计延时。
            if (!visible.value) pending = timers.setTimeout(show, delay);
            return;
        }
        if (!visible.value) return;
        const rest = minVisible - (timers.now() - shownAt);
        if (rest <= 0) hide();
        else pending = timers.setTimeout(hide, rest);
    }, {immediate: true});

    if (getCurrentScope() !== undefined) onScopeDispose(cancel);
    return readonly(visible);
}
