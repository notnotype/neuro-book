/**
 * 组件里的拖动会话（Spec `ui/layout-drag` 输出 18、19）：根出现时建会话，根换了先销毁旧的再建新的，根没了或所在的作用域
 * 结束时销毁。三处调用方（Explorer 的树、Lab 的拖动场景、可排序列表）原来各写一遍挂载时建、卸载时销毁。
 *
 * - 时序：根已有值时在调用时立即建；模板 ref 的根在组件挂载后的那次刷新里才有，挂载回调里 `session` 还是 null。
 * - `createOptions(root)` 每在一个根上建会话时调一次，会话建好后不再读，所以它不被追踪：`autoScroll`、`keyboard`、`scroll`、
 *   `config` 在建时定死；要随状态变的东西写成回调里现读的值，`autoScroll.containers` 每次现调，取 `v-if`、`v-for` 后面的模板 ref
 *   也读得到当时的值。
 * - `createOptions` 抛错照 Vue 的规则交给应用的错误处理，这个根上没有会话。
 */

import {computed, shallowRef, watch} from "vue";
import type {ComputedRef, Ref, ShallowRef} from "vue";

import type {DragState} from "../drag-gesture";
import {createDragSession} from "./drag-session";
import type {DragSession, DragSessionOptions} from "./drag-session";

/** @experimental */
export type DragSessionHandle<S, D> = {
    /** 当前根上的会话；没有根时是 null。 */
    readonly session: Readonly<ShallowRef<DragSession<S, D> | null>>;
    /** 会话的状态（拿起、悬停的落点）；没有会话或没在拖时是 null。 */
    readonly state: ComputedRef<DragState<S, D> | null>;
};

/** @experimental */
export function useDragSession<S, D, R = never>(
    root: Readonly<Ref<HTMLElement | null>>,
    createOptions: (root: HTMLElement) => Omit<DragSessionOptions<S, D, R>, "root">,
): DragSessionHandle<S, D> {
    const session = shallowRef<DragSession<S, D> | null>(null);
    // 侦听的清理在换根与作用域结束时都会调，销毁走同一处。
    watch(root, (element, _previous, onCleanup) => {
        if (element === null) return;
        const created = createDragSession<S, D, R>({...createOptions(element), root: element});
        session.value = created;
        onCleanup(() => {
            created.dispose();
            if (session.value === created) session.value = null;
        });
    }, {immediate: true});
    const state = computed(() => session.value?.state.value ?? null);
    return {session, state};
}
