/**
 * 探针共用的存储替身：真实传输合同 + 内存记录，只换掉 HTTP。
 *
 * 与作者聚焦测试的做法一致（真实记录会话 + 内存传输），但多两个故障注入点，
 * 用来复现作者测试没有覆盖的失败路径：回读失败、并发第二次迁移、删除失败。
 */
import type {StorageActionRequest, StorageActionResponse} from "nbook/shared/storage/action";
import type {StorageCredential, StorageReadResult} from "nbook/shared/storage/contract";
import {openStorageOwnerHandle} from "nbook/app/utils/storage/owner-handle";
import {StorageAdapterError, type StorageValueTransport} from "nbook/app/utils/storage/value-transport";
import type {WorkbenchStorageAdapters} from "nbook/app/utils/workbench/storage-context";
import type {LegacyValueReading, LegacyValueStore} from "nbook/app/utils/workbench/legacy-record-migration";

export const CLIENT_CREDENTIAL = "0123456789abcdef".repeat(4);

export type StoredRecord = {value: unknown; revision: string; schemaVersion: number};

export type Harness = {
    readonly records: Map<string, StoredRecord>;
    readonly saves: {key: string; value: unknown}[];
    readonly adapters: WorkbenchStorageAdapters;
    /** 让后续读取全部停在闸上；返回放行函数。 */
    holdReads(): () => void;
    /** 从这一刻起，保存成功后的回读抛错（模拟回读失败）。 */
    failReadsAfterSave(): void;
    write(key: string, value: unknown, schemaVersion?: number): void;
    recordOf(key: string): unknown;
    saveCount(key: string): number;
};

export function storageHarness(): Harness {
    const records = new Map<string, StoredRecord>();
    const saves: {key: string; value: unknown}[] = [];
    const gate: {current: Promise<void>; release: () => void} = {current: Promise.resolve(), release: () => undefined};
    let failReadAfterSave = false;
    let savedSinceRead = 0;
    let sequence = 0;
    const credential = (revision: string | null): StorageCredential => ({revision, partitionGeneration: 1});

    const transport: StorageValueTransport = {
        async send(action: StorageActionRequest): Promise<StorageActionResponse> {
            if (action.kind === "bind") {
                return {kind: "bind", binding: {local: 1, shared: 1}};
            }
            const key = `${action.owner}/${action.key}/${action.resource ?? ""}`;
            if (action.kind === "read") {
                if (failReadAfterSave && savedSinceRead > 0) {
                    throw new StorageAdapterError({
                        code: "STORAGE_IO",
                        status: 500,
                        message: "回读失败（注入）",
                        committed: null,
                    });
                }
                await gate.current;
                const record = records.get(key);
                if (record === undefined) {
                    return {kind: "read", result: {kind: "missing", credential: credential(null)}};
                }
                return {
                    kind: "read",
                    result: {
                        kind: "value",
                        value: record.value,
                        schemaVersion: record.schemaVersion,
                        credential: credential(record.revision),
                    },
                };
            }
            if (action.kind === "save") {
                const record = records.get(key);
                if ((record?.revision ?? null) !== action.expected.revision) {
                    throw new StorageAdapterError({
                        code: "STORAGE_REVISION_CONFLICT",
                        status: 409,
                        message: "记录已被其它窗口改写",
                        committed: false,
                    });
                }
                records.set(key, {
                    value: action.value,
                    revision: `revision-${++sequence}`,
                    schemaVersion: action.schemaVersion,
                });
                saves.push({key, value: action.value});
                savedSinceRead += 1;
                return {kind: "save", credential: credential(`revision-${sequence}`)};
            }
            throw new Error(`探针未实现动作：${action.kind}`);
        },
    };

    const adapters: WorkbenchStorageAdapters = {
        openUserContext: async () => ({
            status: "ready",
            session: {scope: "user", contextId: "user".padEnd(64, "u"), clientCredential: CLIENT_CREDENTIAL},
        }),
        openProjectContext: async () => ({
            status: "unavailable",
            reason: "target-invalid",
            diagnosis: "探针不涉及 Project Storage",
            code: null,
            statusCode: null,
        }),
        openOwnerHandle: async (options) => openStorageOwnerHandle({
            ...options,
            transport,
            subscribe: {intervalMs: 60_000, maxBackoffMs: 120_000},
        }),
        closeContext: async () => undefined,
    };

    return {
        records,
        saves,
        adapters,
        holdReads(): () => void {
            const {promise, resolve} = Promise.withResolvers<void>();
            gate.current = promise;
            gate.release = resolve;
            savedSinceRead = 0;
            return resolve;
        },
        failReadsAfterSave(): void {
            failReadAfterSave = true;
        },
        write(key: string, value: unknown, schemaVersion = 1): void {
            records.set(key, {value, revision: `revision-${++sequence}`, schemaVersion});
        },
        recordOf(key: string): unknown {
            return records.get(key)?.value;
        },
        saveCount(key: string): number {
            return saves.filter((entry) => entry.key === key).length;
        },
    };
}

export type LegacyFake = LegacyValueStore & {readonly remaining: string | null};

/** 旧键替身：`remove()` 是否成功可控（默认成功并确认键已不存在）。 */
export function legacyStore(initial: string | null, removeSucceeds = true): LegacyFake {
    let raw = initial;
    return {
        get remaining(): string | null {
            return raw;
        },
        read(): LegacyValueReading {
            return raw === null ? {kind: "absent"} : {kind: "value", raw};
        },
        remove(): boolean {
            if (raw === null) {
                return true;
            }
            if (!removeSucceeds) {
                return false;
            }
            raw = null;
            return true;
        },
    };
}

/** 只推进微任务直到条件成立（链路全是 Promise，不依赖真实时间）。 */
export async function flushUntil(condition: () => boolean, rounds = 2000): Promise<void> {
    for (let step = 0; step < rounds && !condition(); step += 1) {
        await Promise.resolve();
    }
    if (!condition()) {
        throw new Error("等待条件成立失败（微任务已推进到底）");
    }
}

/** 只推进微任务，不等任何条件。 */
export async function flushMicrotasks(rounds = 64): Promise<void> {
    for (let round = 0; round < rounds; round += 1) {
        await Promise.resolve();
    }
}

/** 记录里本不存在的 `StorageReadResult` 形状，供需要时构造。 */
export type ReadResult<T> = StorageReadResult<T>;
