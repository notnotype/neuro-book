/**
 * 窗口里的一份世界读取层：界面不散着调世界客户端，都经它读写（docs/specs/canon/author-ui.md 输出 26、27、29）。
 *
 * 失效按“代”算：世界版本前进、正文变了、归纳补算完、章表或登记的类型变了、重连后可能漏了事件，都让代加一；每个读取记着
 * 自己是哪一代读的，比当前代旧就要重读。只重读有人在用的读取（界面组件挂着的）；没人用的留着旧结果，下次有人用时先给
 * 旧结果、同时重读。这样“只重读前台可见的”靠组件的挂载与卸载自然成立：页面标签不在前台时组件已经卸载。
 *
 * 重读一轮一轮地做：一轮开始前让出一次微任务，同一轮里到的几件事只算一次；一轮里所有要重读的一起发出，都回来以后在同一个
 * 同步段里一起换上，同一个页面的几个读取不会一个新一个旧。轮次进行中又失效了的，下一轮再读，直到没有要读的。
 *
 * 本窗口写入成功时，先把已知版本抬到返回的版本并把可见的读取重读完，再把结果交回调用方；随后到的 `changed` 事件版本
 * 不比已知的新，不再重读。
 *
 * 订阅在第一次读取之前建立；订阅被提供方结束（项目实例停止）以后连接是 `ended`，已读的内容留着，`retry()` 重新订阅。
 */

import {shallowRef} from "vue";
import type {ShallowRef} from "vue";

import type {CanonClient, CanonEvent, CanonFailure, CanonInput, CanonMethod, CanonOutputs, CanonResult, CanonStatus} from "../shared/contracts";

/** 没人用的读取最多留这么多个，多了丢最久没用的（计划 t31“关键设计 三”）。 */
export const KEEP_UNUSED = 64;
/** 列表重读时一次最多读的条数（合同的 `limit` 上限）。 */
const LIST_LIMIT_MAX = 500;

export type WorldConnection = "connecting" | "online" | "ended" | "no-project";

export interface ReadState<T> {
    /** 最近一次读成功的结果；重读期间与重读失败后仍是它。 */
    readonly data: T | undefined;
    /** 最近一次读取的失败；读成功时清掉。 */
    readonly error: CanonFailure | null;
    /** 还没有读到过（第一次读取期间显示加载占位）。 */
    readonly loading: boolean;
}

export interface ReadHandle<T> {
    readonly state: Readonly<ShallowRef<ReadState<T>>>;
    /** 不再用这个读取；同一个读取的每次 `read` 各释放一次。 */
    release(): void;
}

/** 分页的读取方法：输入有 `cursor`、`limit`，结果有 `items` 与下一页的 `cursor`。 */
export type ListMethod = "tree" | "origins" | "changes" | "tellings" | "presence" | "pending" | "decisions" | "suggestions" | "revisions";
type ListItem<M extends ListMethod> = CanonOutputs[M]["items"][number];

export interface ListState<M extends ListMethod> extends ReadState<CanonOutputs[M]> {
    /** 到目前读过的各页的项，按顺序接起来。 */
    readonly items: readonly ListItem<M>[];
    /** 后面还有页。 */
    readonly more: boolean;
}

export interface ListHandle<M extends ListMethod> {
    readonly state: Readonly<ShallowRef<ListState<M>>>;
    /** 读下一页；游标过期时按已读的条数从头重读，再接着读下一页。 */
    more(): Promise<void>;
    release(): void;
}

/** 写入方法：输入都带请求 id（`publish` 的在 `request` 里）。 */
export type WriteMethod = "publish" | "editInPlace" | "recordDelta" | "recordNote" | "revert";

export interface CanonWorld {
    readonly connection: Readonly<ShallowRef<WorldConnection>>;
    /** 世界的状态（版本、可写与否、谁在独占）；还没读到时为 `undefined`。 */
    readonly status: Readonly<ShallowRef<ReadState<CanonStatus>>>;
    read<M extends Exclude<CanonMethod, WriteMethod | ListMethod>>(method: M, input: CanonInput<M>): ReadHandle<CanonOutputs[M]>;
    list<M extends ListMethod>(method: M, input: Omit<CanonInput<M>, "cursor" | "limit">, pageSize?: number): ListHandle<M>;
    /**
     * 写入。成功时可见的读取已经按返回的版本重读完。断线使结局不明（`unknown-outcome`）时按请求 id 查结局：写进去了就用
     * 同一个请求 id 重发，拿回第一次的结果（canon.revisions 输出 24）；没写进去得到 `write-failed`；查不到仍是 `unknown-outcome`，
     * 调用方可以再调一次（同一个输入、同一个请求 id）。
     */
    write<M extends WriteMethod>(method: M, input: CanonInput<M>): Promise<CanonResult<CanonOutputs[M]>>;
    /** 订阅被结束以后重新订阅；成功后内容按当前版本重读。 */
    retry(): Promise<void>;
    dispose(): void;
}

interface Slot {
    readonly key: string;
    users: number;
    /** 结果是哪一代读的；-1 是还没读过。 */
    generation: number;
    /** 正在读：这一轮读完之前不再发。 */
    busy: boolean;
    /** 最后一次被释放的先后，用来丢最久没用的。 */
    released: number;
    /** 发出这个读取，返回换上结果的函数（不换就什么也不做）。 */
    load(): Promise<() => void>;
}

const keyOf = (method: string, input: unknown): string => `${method}:${stableKey(input)}`;

/** 输入的键：对象按键名排序，同一个输入不论键的先后都是同一个键；值为 `undefined` 的键与不写相同。 */
function stableKey(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([name, item]) => `${JSON.stringify(name)}:${stableKey(item)}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "undefined";
}

const requestIdOf = (method: WriteMethod, input: unknown): string => {
    const holder = (method === "publish" ? (input as {request: unknown}).request : input) as {requestId: string};
    return holder.requestId;
};

export function createCanonWorld(client: CanonClient): CanonWorld {
    const connection = shallowRef<WorldConnection>("connecting");
    const slots = new Map<string, Slot>();
    let generation = 0;
    let known = -1;
    let releases = 0;
    let running: Promise<void> | null = null;
    let subscription: {release(): void} | null = null;
    let disposed = false;

    const invalidate = (): void => {
        generation += 1;
        void run();
    };

    const onEvent = (event: CanonEvent): void => {
        switch (event.kind) {
            case "changed":
                if (event.version > known) {
                    known = event.version;
                    invalidate();
                }
                return;
            case "textChanged":
            case "reduced":
            case "inputChanged":
            case "resync":
                invalidate();
                return;
            case "exclusive":
                // 独占不改版本，只有状态要重读。
                statusSlot.generation = -1;
                void run();
                return;
            case "ended":
                connection.value = "ended";
                subscription = null;
                return;
        }
    };

    const subscribe = async (): Promise<void> => {
        const result = await client.subscribe(onEvent);
        if (disposed) {
            if (result.ok) result.value.release();
            return;
        }
        if (!result.ok) {
            connection.value = result.failure.code === "no-project" ? "no-project" : "ended";
            return;
        }
        subscription = result.value;
        connection.value = "online";
        invalidate();
    };

    /** 做重读，直到有人用的读取都是当前代的。判断“没有要读的了”与清掉 `running` 在同一个同步段里，中间来的失效不会漏。 */
    const run = (): Promise<void> => {
        running ??= (async () => {
            for (;;) {
                await Promise.resolve();
                const due = connection.value === "online" ? [...slots.values()].filter((slot) => slot.users > 0 && !slot.busy && slot.generation < generation) : [];
                if (due.length === 0) {
                    running = null;
                    return;
                }
                const round = generation;
                for (const slot of due) slot.busy = true;
                const commits = await Promise.all(due.map((slot) => slot.load()));
                for (const [index, slot] of due.entries()) {
                    slot.busy = false;
                    slot.generation = round;
                    commits[index]!();
                }
            }
        })();
        return running;
    };

    const prune = (): void => {
        const unused = [...slots.values()].filter((slot) => slot.users === 0 && slot !== statusSlot).sort((a, b) => a.released - b.released);
        for (const slot of unused.slice(0, Math.max(0, unused.length - KEEP_UNUSED))) slots.delete(slot.key);
    };

    const acquire = (slot: Slot): void => {
        slot.users += 1;
        if (slot.generation < generation) void run();
    };

    const releaseOf = (slot: Slot): (() => void) => {
        let released = false;
        return () => {
            if (released) return;
            released = true;
            slot.users -= 1;
            if (slot.users === 0) {
                slot.released = ++releases;
                prune();
            }
        };
    };

    const readSlot = <T>(key: string, fetch: () => Promise<CanonResult<T>>, onValue?: (value: T) => void): {slot: Slot; state: ShallowRef<ReadState<T>>} => {
        const existing = slots.get(key) as (Slot & {state: ShallowRef<ReadState<T>>}) | undefined;
        if (existing !== undefined) return {slot: existing, state: existing.state};
        const state = shallowRef<ReadState<T>>({data: undefined, error: null, loading: true});
        const slot: Slot & {state: ShallowRef<ReadState<T>>} = {
            key,
            users: 0,
            generation: -1,
            busy: false,
            released: 0,
            state,
            load: async () => {
                const result = await fetch();
                return () => {
                    if (result.ok) {
                        onValue?.(result.value);
                        state.value = {data: result.value, error: null, loading: false};
                    } else {
                        state.value = {...state.value, error: result.failure, loading: false};
                    }
                };
            },
        };
        slots.set(key, slot);
        return {slot, state};
    };

    // 状态一直有人用：版本、可写与否、独占都从它来。
    const {slot: statusSlot, state: status} = readSlot<CanonStatus>("status:{}", () => client.call("status", {}), (value) => {
        if (value.version > known) known = value.version;
    });
    statusSlot.users = 1;

    const read = <M extends Exclude<CanonMethod, WriteMethod | ListMethod>>(method: M, input: CanonInput<M>): ReadHandle<CanonOutputs[M]> => {
        const {slot, state} = readSlot<CanonOutputs[M]>(keyOf(method, input), () => client.call(method, input));
        acquire(slot);
        return {state, release: releaseOf(slot)};
    };

    const list = <M extends ListMethod>(method: M, input: Omit<CanonInput<M>, "cursor" | "limit">, pageSize = 50): ListHandle<M> => {
        const key = keyOf(method, {...input, pageSize});
        type Out = CanonOutputs[M];
        const existing = slots.get(key) as (Slot & {list: ListHandle<M>["state"] & ShallowRef<ListState<M>>; next(): Promise<void>}) | undefined;
        if (existing !== undefined) {
            acquire(existing);
            return {state: existing.list, more: () => existing.next(), release: releaseOf(existing)};
        }
        const state = shallowRef<ListState<M>>({data: undefined, error: null, loading: true, items: [], more: false});
        const call = (cursor: string | undefined, limit: number) => client.call(method, {...input, ...(cursor === undefined ? {} : {cursor}), limit} as CanonInput<M>) as Promise<CanonResult<Out>>;
        /** 从头读，条数是已读的条数（至少一页）：重读与游标过期后都这样，作者翻到哪里还在哪里。 */
        const fromStart = async (): Promise<() => void> => {
            const limit = Math.min(LIST_LIMIT_MAX, Math.max(pageSize, state.value.items.length));
            const result = await call(undefined, limit);
            return () => {
                if (result.ok) state.value = {data: result.value, error: null, loading: false, items: result.value.items as readonly ListItem<M>[], more: result.value.cursor !== undefined};
                // 同普通读取：失败也算读过一次（不再是加载占位），读到过的项留着。
                else state.value = {...state.value, error: result.failure, loading: false};
            };
        };
        const slot: Slot & {list: ShallowRef<ListState<M>>; next(): Promise<void>} = {
            key,
            users: 0,
            generation: -1,
            busy: false,
            released: 0,
            list: state,
            load: fromStart,
            next: async () => {
                const cursor = state.value.data?.cursor;
                if (cursor === undefined || slot.busy) return;
                slot.busy = true;
                try {
                    const result = await call(cursor, pageSize);
                    if (result.ok) {
                        state.value = {data: result.value, error: null, loading: false, items: [...state.value.items, ...(result.value.items as readonly ListItem<M>[])], more: result.value.cursor !== undefined};
                    } else if (result.failure.code === "cursor-stale") {
                        (await fromStart())();
                        slot.generation = generation;
                    } else {
                        state.value = {...state.value, error: result.failure};
                    }
                } finally {
                    slot.busy = false;
                }
            },
        };
        slots.set(key, slot);
        acquire(slot);
        return {state, more: () => slot.next(), release: releaseOf(slot)};
    };

    const write = async <M extends WriteMethod>(method: M, input: CanonInput<M>): Promise<CanonResult<CanonOutputs[M]>> => {
        const send = () => client.call(method, input) as Promise<CanonResult<CanonOutputs[M]>>;
        let result = await send();
        if (!result.ok && result.failure.code === "unknown-outcome") {
            const outcome = await client.call("outcome", {requestId: requestIdOf(method, input)});
            if (!outcome.ok) return result;
            if (!outcome.value.published) return {ok: false, failure: {code: "write-failed", after: "unknown-outcome"}};
            result = await send();
        }
        if (result.ok) {
            const version = (result.value as {version: number}).version;
            if (version > known) {
                known = version;
                generation += 1;
            }
            await run();
        }
        return result;
    };

    void subscribe();

    return {
        connection,
        status,
        read,
        list,
        write,
        retry: async () => {
            if (connection.value !== "ended" || disposed) return;
            connection.value = "connecting";
            await subscribe();
            await run();
        },
        dispose: () => {
            disposed = true;
            subscription?.release();
            subscription = null;
            slots.clear();
        },
    };
}
