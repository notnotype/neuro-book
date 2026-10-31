/**
 * 日志存储的端口。产品用会话目录里的 JSONL（`kernel/log/`），测试缺省用每次读写都做 JSON 往返的内存存储。
 * 落盘格式、批的完整性、锁与修复见 docs/specs/harness/session.md。
 */

import type {JsonValue} from "./basics.js";
import type {StorageError} from "./codes.js";
import type {LogEvent, SessionHeader} from "./events.js";

export type StorageResult<T> = {readonly ok: true; readonly value: T} | {readonly ok: false; readonly code: StorageError; readonly detail?: Readonly<Record<string, JsonValue>>};

/** 会话列表用的小索引；`list` 只读它，崩溃后到下次打开之前可能略旧。 */
export interface SessionIndexEntry {
    readonly id: string;
    readonly profile: string;
    readonly project?: string;
    readonly title: string | null;
    readonly archived: boolean;
    readonly createdAt: number;
    readonly lastActivityAt: number;
    readonly turns: number;
    readonly throughSeq: number;
}

/** 打开会话得到的句柄：持锁，持有读回的全部事件。 */
export interface LogHandle {
    readonly header: SessionHeader;
    readonly events: readonly LogEvent[];
    /** 打开时截掉的不完整尾部（另存为 `session.jsonl.tail-<时刻>`）；没有为 null。 */
    readonly truncatedTail: {readonly bytes: number; readonly savedAs: string} | null;
    /** 写失败过：之后的写入都得 `log-broken`。 */
    readonly broken: boolean;
}

export interface LogStore {
    create(header: SessionHeader): Promise<StorageResult<LogHandle>>;
    /** 取锁 → 截掉不完整的尾部 → 校验 → 读回大块内容。 */
    open(id: string): Promise<StorageResult<LogHandle>>;
    /** 一个写入批：一次写入后同步到盘。失败时句柄进损坏状态，结果对调用方不确定，重开以文件为准。 */
    append(handle: LogHandle, batch: readonly LogEvent[]): Promise<StorageResult<void>>;
    list(filter?: {readonly project?: string; readonly archived?: boolean}): Promise<StorageResult<readonly SessionIndexEntry[]>>;
    /** 复制 `from` 会话里到 `leaf` 为止的当前路径（连同引用的大块内容）成新会话，头里记来源。 */
    fork(from: {readonly session: string; readonly leaf: string | null}, header: SessionHeader): Promise<StorageResult<LogHandle>>;
    /** 释放锁。句柄已坏时只做清理。 */
    close(handle: LogHandle): Promise<void>;
}
