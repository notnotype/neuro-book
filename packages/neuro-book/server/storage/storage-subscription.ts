/**
 * 生命周期拥有的 Storage 观察器。
 *
 * 本进程提交触发即时观察；有界频率的轮询覆盖进程外原子替换。每个订阅只有一个串行读取队列，
 * 初始快照先返回再投递更新，关闭停止调度并排空已接纳读取。这里只报告当前状态，允许合并中间值。
 */
import type {StorageReadResult} from "nbook/shared/storage/contract";
import {isStorageDomainError, StorageHandleClosedError, StorageServiceClosedError} from "nbook/shared/storage/storage-errors";

export type StorageSubscriptionTarget = {
    readonly identity: string;
    readonly owner: string;
    readonly read: () => Promise<StorageReadResult<unknown>>;
};

export type StorageSubscriptionListener = {
    readonly onUpdate?: (snapshot: StorageReadResult<unknown>) => void;
    readonly onError?: (error: unknown) => void;
};

export type StorageSubscription<T> = {
    readonly snapshot: StorageReadResult<T>;
    refresh(): Promise<StorageReadResult<T>>;
    close(): Promise<void>;
};

type Entry = StorageSubscriptionTarget & StorageSubscriptionListener & {
    lastKey: string | null;
    started: boolean;
    dirty: boolean;
    background: boolean;
    closed: boolean;
    reason: "released" | "service-closed";
    timer: ReturnType<typeof setTimeout> | null;
    tail: Promise<void>;
    closing: Promise<void> | null;
};

export class StorageSubscriptionHub {
    private readonly entriesByIdentity = new Map<string, Set<Entry>>();
    private readonly pollIntervalMs: number;
    private closing: Promise<void> | null = null;

    constructor(options: {readonly pollIntervalMs?: number} = {}) {
        this.pollIntervalMs = options.pollIntervalMs ?? 500;
        if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 10) {
            throw new RangeError("Storage 观察间隔至少为 10ms");
        }
    }

    async open<T>(target: StorageSubscriptionTarget, listener: StorageSubscriptionListener): Promise<StorageSubscription<T>> {
        if (this.closing !== null) throw new StorageServiceClosedError();
        const entry: Entry = {
            ...target, ...listener, lastKey: null, started: false, dirty: false, background: false,
            closed: false, reason: "released", timer: null, tail: Promise.resolve(), closing: null,
        };
        const entries = this.entriesByIdentity.get(target.identity) ?? new Set<Entry>();
        entries.add(entry);
        this.entriesByIdentity.set(target.identity, entries);
        try {
            const snapshot = await this.enqueue(entry, false);
            entry.started = true;
            // 下一事件循环才开始投递，调用方可先安装初始 snapshot；期间通知记在 dirty 中。
            this.arm(entry, entry.dirty ? 0 : this.pollIntervalMs);
            return {
                snapshot: snapshot as StorageReadResult<T>,
                refresh: () => this.enqueue(entry, true) as Promise<StorageReadResult<T>>,
                close: () => this.closeEntry(entry),
            };
        } catch (error) {
            await this.closeEntry(entry);
            throw error;
        }
    }

    notify(identity: string): void {
        for (const entry of this.entriesByIdentity.get(identity) ?? []) {
            entry.dirty = true;
            if (entry.started) this.arm(entry, 0);
        }
    }

    /** 回收改变整个实际分区的代次；所有键的旧订阅都需要观察失效。 */
    notifyPartition(partitionIdentity: string): void {
        for (const identity of this.entriesByIdentity.keys()) {
            if (identity.startsWith(partitionIdentity + "\u0000")) this.notify(identity);
        }
    }

    closeAll(): Promise<void> {
        this.closing ??= Promise.all(
            [...this.entriesByIdentity.values()].flatMap((entries) => [...entries].map((entry) => this.closeEntry(entry, "service-closed"))),
        ).then(() => undefined);
        return this.closing;
    }

    private enqueue(entry: Entry, publish: boolean): Promise<StorageReadResult<unknown>> {
        if (entry.closed) return Promise.reject(new StorageHandleClosedError(entry.owner, entry.reason));
        const reading = entry.tail.then(async () => {
            if (entry.closed && publish) throw new StorageHandleClosedError(entry.owner, entry.reason);
            const snapshot = await entry.read();
            const key = snapshotKey(snapshot);
            if (!entry.closed && entry.lastKey !== key) {
                entry.lastKey = key;
                if (publish) this.emit(entry, snapshot);
            }
            return snapshot;
        });
        entry.tail = reading.then(() => undefined, () => undefined);
        return reading;
    }

    private arm(entry: Entry, delay: number): void {
        if (entry.closed || !entry.started || entry.background) return;
        if (entry.timer !== null) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
            entry.timer = null;
            entry.dirty = false;
            entry.background = true;
            void this.enqueue(entry, true).catch((error: unknown) => {
                if (!entry.closed) this.report(entry, error);
                if (isStorageDomainError(error, "STORAGE_CREDENTIAL_STALE")
                    || isStorageDomainError(error, "STORAGE_HANDLE_CLOSED")) {
                    void this.closeEntry(entry);
                }
            }).finally(() => {
                entry.background = false;
                this.arm(entry, entry.dirty ? 0 : this.pollIntervalMs);
            });
        }, delay);
        entry.timer.unref();
    }

    private emit(entry: Entry, snapshot: StorageReadResult<unknown>): void {
        try { entry.onUpdate?.(snapshot); } catch (error) { this.report(entry, error); }
    }

    private report(entry: Entry, error: unknown): void {
        try { entry.onError?.(error); } catch {
            // 观察者的错误处理器也由观察者拥有，不能把它的异常变成服务的未处理 rejection。
        }
    }

    private closeEntry(entry: Entry, reason: "released" | "service-closed" = "released"): Promise<void> {
        if (entry.closing !== null) return entry.closing;
        entry.closed = true;
        entry.reason = reason;
        if (entry.timer !== null) clearTimeout(entry.timer);
        entry.timer = null;
        entry.closing = entry.tail.then(() => {
            const entries = this.entriesByIdentity.get(entry.identity);
            entries?.delete(entry);
            if (entries?.size === 0) this.entriesByIdentity.delete(entry.identity);
        });
        return entry.closing;
    }
}

/** 保存不可变的状态身份，监听器修改收到的对象不会改变后续去重结果。 */
function snapshotKey(snapshot: StorageReadResult<unknown>): string {
    switch (snapshot.kind) {
        case "value":
        case "legacy-value":
        case "missing":
        case "deleted":
            return JSON.stringify([snapshot.kind, snapshot.credential.partitionGeneration, snapshot.credential.revision]);
        case "corrupt":
        case "unsupported-version":
            return JSON.stringify([snapshot.kind, snapshot.repair.partitionGeneration, snapshot.repair.contentFingerprint]);
    }
}
