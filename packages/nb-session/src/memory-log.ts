import {materializeEntry, type SessionEntry, type SessionEntryInput} from "./entries.js";

/** 一次 `read` 的窗口参数。 */
export interface SessionReadOptions {
    readonly sinceSeq?: number;
    readonly limit?: number;
}

/**
 * 一个会话的 append-only 日志。实现保证：同一实例内 `append` 串行、`seq` 从 1 单调递增、
 * 批次内 `at` 单调不减；`read` 只返回可解析的前缀（中断尾会被截断）。
 */
export interface SessionLog {
    readonly sessionId: string;
    append(inputs: readonly SessionEntryInput[]): Promise<readonly SessionEntry[]>;
    read(options?: SessionReadOptions): Promise<readonly SessionEntry[]>;
    tail(): Promise<SessionEntry | null>;
    /** 中断尾修复：截掉损坏尾部并报告丢弃的字节数；无损坏时返回 0。 */
    repair(): Promise<{readonly droppedBytes: number}>;
}

/** 把 `now()` 的结果钳制到不早于上一次，保证 `at` 在同一批次内单调不减。 */
export function makeClock(now?: () => Date): () => string {
    const read = now ?? (() => new Date());
    let previous = Number.NEGATIVE_INFINITY;
    return () => {
        const current = read().getTime();
        const value = current > previous ? current : previous;
        previous = value;
        return new Date(value).toISOString();
    };
}

/** 同一实例内串行执行，前一个任务失败也不阻塞后续任务。 */
export function makeQueue(): <T>(task: () => T | Promise<T>) => Promise<T> {
    let tail: Promise<unknown> = Promise.resolve();
    return <T>(task: () => T | Promise<T>): Promise<T> => {
        const next = tail.then(task, task);
        tail = next.then(
            () => undefined,
            () => undefined,
        );
        return next;
    };
}

/** 按 `sinceSeq`/`limit` 过滤。 */
export function windowEntries(entries: readonly SessionEntry[], options?: SessionReadOptions): readonly SessionEntry[] {
    const sinceSeq = options?.sinceSeq ?? 0;
    const limit = options?.limit ?? Number.POSITIVE_INFINITY;
    const filtered = entries.filter((entry) => entry.seq > sinceSeq);
    return Number.isFinite(limit) ? filtered.slice(0, limit) : filtered;
}

export function createMemorySessionLog(options: {readonly sessionId: string; readonly now?: () => Date}): SessionLog {
    const clock = makeClock(options.now);
    const run = makeQueue();
    const entries: SessionEntry[] = [];

    return {
        sessionId: options.sessionId,
        append(inputs) {
            return run(() => {
                const startSeq = entries.length + 1;
                const stamped = inputs.map((input: SessionEntryInput, index: number) => materializeEntry(input, startSeq + index, clock()));
                entries.push(...stamped);
                return stamped;
            });
        },
        read(readOptions) {
            return run(() => windowEntries(entries, readOptions));
        },
        tail() {
            return run(() => entries[entries.length - 1] ?? null);
        },
        repair() {
            return run(() => ({droppedBytes: 0}));
        },
    };
}
