/**
 * 组件里用读取层（`world.ts`）：输入随组件的状态变（换位置、换分页）时换一个读取，旧的在新的读到之前接着显示，读到了才释放，
 * 换位置时页面不闪成加载占位（docs/specs/canon/author-ui.md 输出 26）。输入为 null 时不读。作用域结束时释放。
 */

import {computed, onScopeDispose, shallowRef, watch} from "vue";
import type {ComputedRef} from "vue";

import type {CanonInput, CanonMethod, CanonOutputs} from "../shared/contracts";
import type {CanonWorld, ListHandle, ListMethod, ListState, ReadHandle, ReadState, WriteMethod} from "./world";

type ReadMethod = Exclude<CanonMethod, WriteMethod | ListMethod>;

interface Held<H> {
    readonly handle: H;
    readonly key: string;
}

/** 换读取的共同部分：`current` 是最新的，`previous` 是它读到之前还在显示的那个。 */
function useSwitching<H extends {release(): void; readonly state: {readonly value: {readonly loading: boolean}}}>(open: () => {key: string; open: () => H} | null) {
    const current = shallowRef<Held<H> | null>(null);
    const previous = shallowRef<Held<H> | null>(null);
    const dropPrevious = (): void => {
        previous.value?.handle.release();
        previous.value = null;
    };
    watch(() => open()?.key ?? null, (key) => {
        if (key === current.value?.key) return;
        dropPrevious();
        const next = open();
        // 当前的还没读到就被换掉，它不值得留着显示，直接释放。
        if (current.value !== null && current.value.handle.state.value.loading) current.value.handle.release();
        else previous.value = current.value;
        current.value = next === null ? null : {key: next.key, handle: next.open()};
    }, {immediate: true});
    // 新的读到了，旧的就不再显示。
    watch(() => current.value?.handle.state.value.loading, (loading) => {
        if (loading === false) dropPrevious();
    });
    onScopeDispose(() => {
        dropPrevious();
        current.value?.handle.release();
        current.value = null;
    });
    /** 要显示的那个：最新的读到了就是它，没读到时是旧的（没有旧的也是它，显示加载占位）。 */
    const shown = computed(() => (current.value !== null && current.value.handle.state.value.loading && previous.value !== null ? previous.value : current.value));
    return {current, shown};
}

export function useWorldRead<M extends ReadMethod>(world: CanonWorld, method: M, input: () => CanonInput<M> | null): ComputedRef<ReadState<CanonOutputs[M]> | null> {
    const {shown} = useSwitching<ReadHandle<CanonOutputs[M]>>(() => {
        const given = input();
        return given === null ? null : {key: JSON.stringify(given), open: () => world.read(method, given)};
    });
    return computed(() => shown.value?.handle.state.value ?? null);
}

export function useWorldList<M extends ListMethod>(world: CanonWorld, method: M, input: () => Omit<CanonInput<M>, "cursor" | "limit"> | null, pageSize?: number): {readonly state: ComputedRef<ListState<M> | null>; more(): void} {
    const {current, shown} = useSwitching<ListHandle<M>>(() => {
        const given = input();
        return given === null ? null : {key: JSON.stringify(given), open: () => world.list(method, given, pageSize)};
    });
    return {
        state: computed(() => shown.value?.handle.state.value ?? null),
        more: () => void current.value?.handle.more(),
    };
}
