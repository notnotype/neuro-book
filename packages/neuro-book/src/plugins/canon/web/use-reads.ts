/**
 * 组件里用读取层（`world.ts`）：输入随组件的状态变（换位置、换分页）时换一个读取，旧的在新的读到（或读失败）之前接着显示，
 * 之后才释放，换位置时页面不闪成加载占位（docs/specs/canon/author-ui.md 输出 26）。输入为 null 时不读、不占着读取。作用域
 * 结束时释放。没释放的读取在每次世界变化后都会被读取层重读，所以句柄一刻也不多留。
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

/**
 * 换读取的共同部分：`current` 是最新的，`previous` 是它读到（或读失败）之前还在显示的那个。任何时候至多留着这两个句柄：
 * 新的读到了，旧的立刻释放；还没读到又换了，释放那个没读到的，接着显示原来的旧的；输入变成 null，两个都释放。
 */
function useSwitching<H extends {release(): void; readonly state: {readonly value: {readonly loading: boolean}}}>(open: () => {key: string; open: () => H} | null) {
    const current = shallowRef<Held<H> | null>(null);
    const previous = shallowRef<Held<H> | null>(null);
    const settled = (held: Held<H> | null): boolean => held !== null && !held.handle.state.value.loading;
    const dropPrevious = (): void => {
        previous.value?.handle.release();
        previous.value = null;
    };
    watch(() => open()?.key ?? null, (key) => {
        if (key === current.value?.key) return;
        const next = open();
        if (next === null) {
            dropPrevious();
            current.value?.handle.release();
            current.value = null;
            return;
        }
        if (settled(current.value)) {
            dropPrevious();
            previous.value = current.value;
        } else {
            // 当前的还没读到就被换掉：它没显示过，直接释放；屏幕上的是更早那个，留着。
            current.value?.handle.release();
        }
        current.value = {key: next.key, handle: next.open()};
        // 读取层里还留着结果的输入，一换上就读到了。
        if (settled(current.value)) dropPrevious();
    }, {immediate: true});
    watch(() => settled(current.value), (done) => {
        if (done) dropPrevious();
    });
    onScopeDispose(() => {
        dropPrevious();
        current.value?.handle.release();
        current.value = null;
    });
    /** 要显示的那个：最新的读到了就是它，没读到时是旧的（没有旧的也是它，显示加载占位）。 */
    const shown = computed(() => (current.value !== null && !settled(current.value) && previous.value !== null ? previous.value : current.value));
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
