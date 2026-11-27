/**
 * 一块面板的取数（t10 计划 3.5“没有数据与加载中”）：发请求、记下结果，超过 200 毫秒还没回来才显示加载。重取（换时间范围、
 * 点重试）时上一份数据留着，页面在它上面盖一层淡遮罩；后发的请求先回来时，先发的那个的结果丢掉。
 *
 * 状态由面板组件（`DashboardPanel.vue`）画成四种：加载、没有数据、出错、有数据。
 */

import {onBeforeUnmount, shallowRef} from "vue";
import type {Ref} from "vue";

import type {SiteClock} from "../../../host/clock";
import type {Failure, Result} from "../../../http/core";

/** 取数超过这么久才显示加载，免得快的请求闪一下（ui-development-spec 4.1，与账号页同一个数）。 */
export const LOADING_DELAY_MS = 200;

export interface PanelData<T> {
    /** 最近一次取到的数据；还没取到过、或最近一次失败时为 `undefined`。 */
    readonly value: Readonly<Ref<T | undefined>>;
    /** 最近一次失败，页面要显示的；统一处理接管了的失败（`handled`）不在这里，那时页面正要被带走。 */
    readonly failure: Readonly<Ref<Failure | undefined>>;
    /** 有请求在路上。 */
    readonly pending: Readonly<Ref<boolean>>;
    /** 有请求在路上，且已超过 `LOADING_DELAY_MS`。 */
    readonly slow: Readonly<Ref<boolean>>;
    /** 再取一次。 */
    reload(): void;
}

/** 在组件的 `setup` 里调用；立即取第一次，卸载后到的结果不再写回。 */
export function usePanelData<T>(load: () => Promise<Result<T>>, clock: SiteClock): PanelData<T> {
    const value = shallowRef<T>();
    const failure = shallowRef<Failure>();
    const pending = shallowRef(false);
    const slow = shallowRef(false);
    // 每次发请求加一；结果回来时与它比，不等就是被更晚的请求取代了或已卸载。
    let generation = 0;
    let stopDelay: (() => void) | undefined;

    function settle(): void {
        stopDelay?.();
        stopDelay = undefined;
        pending.value = false;
        slow.value = false;
    }

    function reload(): void {
        const current = ++generation;
        stopDelay?.();
        pending.value = true;
        slow.value = false;
        stopDelay = clock.every(LOADING_DELAY_MS, () => {
            stopDelay?.();
            stopDelay = undefined;
            slow.value = true;
        });
        void load().then((result) => {
            if (current !== generation) return;
            settle();
            if (result.ok) {
                value.value = result.value;
                failure.value = undefined;
                return;
            }
            const handled = result.failure.kind === "code" && result.failure.handled === true;
            value.value = undefined;
            failure.value = handled ? undefined : result.failure;
        });
    }

    onBeforeUnmount(() => {
        generation += 1;
        settle();
    });

    reload();
    return {value, failure, pending, slow, reload};
}
