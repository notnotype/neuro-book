/**
 * 组件里用读取层（`world.ts`）：输入随组件的状态变（换位置、换分页）时换一个读取，旧的在新的读到（或读失败）之前接着显示，
 * 之后才释放，换位置时页面不闪成加载占位（docs/specs/canon/author-ui.md 输出 26）。输入为 null 时不读、不占着读取。作用域
 * 结束时释放。没释放的读取在每次世界变化后都会被读取层重读，所以句柄一刻也不多留。
 */

import {computed, effectScope, onScopeDispose, shallowRef, watch} from "vue";
import type {ComputedRef, EffectScope} from "vue";

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

/**
 * 视图停放时（输入变成 null，读取已释放）接着给最后读到的：屏幕上的行不消失、滚动位置还在；回到前台时先显示它，同时重读
 * （docs/specs/canon/author-ui.md 输出 26）。重读的结果到了（或读失败）就换上。给出的留着的结果标 `stale`：它不一定是现在的。
 * 只给停放的视图用：输入因为别的原因变成 null（例如条目被删了）时不该留着旧的。
 */
export function useKeptRead<S extends {readonly data: unknown; readonly error: unknown; readonly stale: boolean}>(read: () => S | null): ComputedRef<S | null> {
    const last = shallowRef<S | null>(null);
    watch(read, (value) => {
        if (value !== null && value.data !== undefined) last.value = value;
    }, {immediate: true});
    return computed(() => {
        const value = read();
        if (value !== null && (value.data !== undefined || value.error !== null)) return value;
        return last.value === null ? value : {...last.value, stale: true};
    });
}

/**
 * 一组同一方法的读取，按键各一个（回执页里每个被改的条目一个 `entry`，每条剧情变更一个 `object`）：键还在时它的读取跟着输入
 * 换（同 `useWorldRead`，换的期间显示旧的），键没了释放它的读取。`inputs` 给出此刻要的键与输入；结果按键查，还没读到的键
 * 查不到或 `data` 为 undefined。
 */
export function useWorldReads<M extends ReadMethod>(world: CanonWorld, method: M, inputs: () => ReadonlyMap<string, CanonInput<M>>): ComputedRef<ReadonlyMap<string, ReadState<CanonOutputs[M]>>> {
    const reads = shallowRef<ReadonlyMap<string, ComputedRef<ReadState<CanonOutputs[M]> | null>>>(new Map());
    const scopes = new Map<string, EffectScope>();
    const sync = (keys: readonly string[]): void => {
        const next = new Map<string, ComputedRef<ReadState<CanonOutputs[M]> | null>>();
        for (const [key, scope] of scopes) {
            if (keys.includes(key)) continue;
            scope.stop();
            scopes.delete(key);
        }
        for (const key of keys) {
            const known = reads.value.get(key);
            if (known !== undefined) {
                next.set(key, known);
                continue;
            }
            const scope = effectScope(true);
            const read = scope.run(() => useWorldRead(world, method, () => inputs().get(key) ?? null))!;
            scopes.set(key, scope);
            next.set(key, read);
        }
        reads.value = next;
    };
    watch(() => [...inputs().keys()].join("\u0000"), () => sync([...inputs().keys()]), {immediate: true});
    onScopeDispose(() => {
        for (const scope of scopes.values()) scope.stop();
        scopes.clear();
    });
    return computed(() => {
        const result = new Map<string, ReadState<CanonOutputs[M]>>();
        for (const [key, read] of reads.value) {
            const state = read.value;
            if (state !== null) result.set(key, state);
        }
        return result;
    });
}
