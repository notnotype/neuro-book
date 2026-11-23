/**
 * 组件里的实时布局拖动会话：同 `useDragSession`，根出现时建（`createLiveDragSession`），根换了先销毁旧的再建新的，根没了或作用域结束时销毁。
 * 引擎的状态接成只读的 `shallowRef`：`NestedGrid` 的 `lifted`、`dragging` 直接用。
 *
 * - `createOptions(live, root)` 每在一个根上建会话时调一次，之后不再读；要随状态变的写成回调里现读的值。
 * - 卸载只 `dispose`：会话收场经 `onActiveChange(false)` 结束引擎，不另调 `end`。
 */

import {computed, shallowRef, watch} from "vue";
import type {ComputedRef, Ref, ShallowRef} from "vue";

import type {DragState} from "../drag-gesture";
import {IDLE_STATE} from "../live-drag";
import type {LiveDrag, LiveDragState} from "../live-drag";
import type {DragSession} from "./drag-session";
import {createLiveDragSession} from "./live-drag-session";
import type {LiveDragSessionOptions} from "./live-drag-session";

/** @experimental 1.0 之前签名会变。 */
export interface LiveDragSessionRefs<S, D> {
    /** 会话的状态（拿起、悬停的落点）；没在拖时是 null。 */
    readonly state: ComputedRef<DragState<S, D> | null>;
    /** 引擎的可见状态；没在实时布局时是空闲的那份。 */
    readonly liveState: Readonly<ShallowRef<LiveDragState>>;
    /** `NestedGrid` 的 `lifted`。 */
    readonly lifted: ComputedRef<{readonly key: string} | null>;
    /** `NestedGrid` 的 `dragging`：会话在拖（不论走不走实时布局）。 */
    readonly dragging: ComputedRef<boolean>;
}

/** @experimental 1.0 之前签名会变。 */
export function useLiveDragSession<S, D, R = never, L = S, G = unknown>(
    root: Readonly<Ref<HTMLElement | null>>,
    createOptions: (live: LiveDrag<L, D, G>, root: HTMLElement) => LiveDragSessionOptions<S, D, R, L, G>,
): LiveDragSessionRefs<S, D> {
    const session = shallowRef<DragSession<S, D> | null>(null);
    const liveState = shallowRef<LiveDragState>(IDLE_STATE);
    watch(root, (element, _previous, onCleanup) => {
        if (element === null) return;
        const created = createLiveDragSession<S, D, R, L, G>(element, (engine) => {
            const options = createOptions(engine, element);
            return {
                ...options,
                changed: (state) => {
                    liveState.value = state;
                    options.changed?.(state);
                },
            };
        });
        session.value = created.session;
        onCleanup(() => {
            created.dispose();
            if (session.value === created.session) {
                session.value = null;
                liveState.value = IDLE_STATE;
            }
        });
    }, {immediate: true});
    const state = computed(() => session.value?.state.value ?? null);
    return {
        state,
        liveState,
        lifted: computed(() => liveState.value.lifted),
        dragging: computed(() => state.value !== null),
    };
}
