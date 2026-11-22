/**
 * 服务核心读写配置的接口：应用把自己的设置服务适配成它（每个应用的设置存储不同）。注释里的语义是合同，`./testing` 的
 * `runModelsConfigStoreContract` 逐条核对；包里对内存实现跑一遍，应用对自己的适配器加真实的设置存储再跑一遍。
 */

import type {CompactionSetting} from "../config/compaction";
import type {RolesConfig, StoredProvider} from "../config/shapes";

/**
 * 一次写入的结果。`conflict`：可写那一层的当前值不是 `expect` 给的（可以带说明）；`invalid-value`：值不符合形状；其余失败带
 * 存储自己的码（例如 `unavailable`、`layer-invalid`），服务原样转给设置页。
 */
export type SlotWriteResult =
    | {readonly ok: true}
    | {readonly ok: false; readonly code: "conflict"; readonly detail?: string}
    | {readonly ok: false; readonly code: "invalid-value"; readonly detail: string}
    | {readonly ok: false; readonly code: string; readonly detail: string};

/** 可写那一层的情况：`value` 为 undefined 表示这层没有这个键（服务用缺省值合并）。 */
export type SlotLayer<T> = {readonly status: "ok"; readonly value: T | undefined} | {readonly status: "unavailable" | "invalid"};

/** 一个整份读写的配置项。 */
export interface ConfigSlot<T> {
    /** 当前有效值；同步、不失败。值可能是冻结的，要改先拷贝。 */
    read(): T;
    /** 可写那一层的情况。值可能是冻结的，要改先拷贝。 */
    editable(): SlotLayer<T>;
    /**
     * 整份写入可写那一层。`expect.value` 与这一层的当前值按规范化后的值比较（对象的键序不算），不等得 `conflict`、不写；
     * `expect.value` 为 undefined 表示期望这一层没有这个键。交回 `ok` 之后 `read()` 立刻读到新值。
     */
    write(next: T, expect: {readonly value: T | undefined}): Promise<SlotWriteResult>;
}

/** 有效值变化的配置项。 */
export type ConfigKey = "providers" | "roles" | "compaction";

export interface ModelsConfigStore {
    /** 设置里存着的值：新旧两种形状都可能出现，读的人先归一（`normalizeProviders`）。 */
    readonly providers: ConfigSlot<StoredProvider[]>;
    readonly roles: ConfigSlot<RolesConfig>;
    /** 全局的压缩触发点；服务不写它。 */
    compaction(): CompactionSetting;
    /** 流的两个时限（秒，0 表示不限）；每次请求现读，服务不写它们。 */
    stream(): {readonly firstEventTimeoutSeconds: number; readonly idleTimeoutSeconds: number};
    /**
     * 有效值变化时调用，带变化的键；只通知订阅之后的变化，不在 `onChange` 返回之前调用；返回取消函数，取消后不再调用。
     * 自己的写入也要通知（服务的快照与解析缓存只在这时作废）；别处的写入同样通知：写入因别处改过而得 `conflict` 之后，
     * 存储要经这里送来那次变化，服务最多等 1 秒再重读重试，不送就每次冲突都等满。
     */
    onChange(listener: (changed: ReadonlySet<ConfigKey>) => void): () => void;
}
