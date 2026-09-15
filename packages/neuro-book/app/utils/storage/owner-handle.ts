/**
 * 浏览器侧的 owner 句柄：值语义、调用顺序、状态观察与释放。
 *
 * 消费者只看到核心结果语义（读取分类、条件凭据、订阅快照），不知道 H3、磁盘或 IndexedDB 的实现。
 * 句柄不拥有访问上下文：它共享宿主签发的 session，只释放自己的订阅与在途队列，
 * 因此释放一个句柄或标签不会撤销同身份的另一个访问。绑定的分区代次在句柄建立时固定；
 * 上下文或代次永久失效后不再自动重签发，调用方必须显式重新初始化。
 */

import type {StorageAddress, StorageCredential, StoragePartitionBinding, StorageReadResult, StorageReclaimResult, StorageRepairCredential} from "nbook/shared/storage/contract";
import type {DefinedStorageState} from "nbook/shared/storage/definition";
import {captureStorageJsonValue} from "nbook/shared/storage/bounded-json";
import {STORAGE_MAX_VALUE_BYTES} from "nbook/shared/storage/contract";
import type {StorageActionKind, StorageActionRequest, StorageActionResponse} from "nbook/shared/storage/action";
import type {StorageUserContextSession} from "nbook/app/utils/storage/host-context-client";
import {
    createStorageHttpTransport,
    isStorageAdapterError,
    projectStorageAdapterFailure,
    StorageAdapterError,
    type StorageValueTransport,
} from "nbook/app/utils/storage/value-transport";

/** 订阅的默认串行观察间隔与退避上限；外部提交靠定期观察发现。 */
export const STORAGE_SUBSCRIBE_INTERVAL_MS = 500;
export const STORAGE_SUBSCRIBE_MAX_BACKOFF_MS = 8_000;

/** 单个句柄同时活动的订阅上限；每条订阅只有一条串行读取链，因此同时最多一份在途读取。 */
export const STORAGE_SUBSCRIBE_LIMIT = 16;

/**
 * 永久失效：句柄绑定的访问或分区代次已被撤销，重新初始化前不能继续读写。
 *
 * 条件冲突、容量与 I/O 失败只影响单次动作，不在此列。
 */
const TERMINAL_STORAGE_CODES: Record<string, true> = {
    STORAGE_CONTEXT_INVALID: true,
    STORAGE_CLIENT_CREDENTIAL_INVALID: true,
    STORAGE_CREDENTIAL_STALE: true,
    STORAGE_HANDLE_CLOSED: true,
    STORAGE_SERVICE_CLOSED: true,
};

export type StorageOwnerHandleOptions = {
    readonly session: StorageUserContextSession;
    readonly owner: string;
    /** 传输替换接缝；默认是宿主 HTTP 动作入口。 */
    readonly transport?: StorageValueTransport;
    readonly subscribe?: {
        readonly intervalMs?: number;
        readonly maxBackoffMs?: number;
    };
};

export type StorageOwnerReadOptions = {readonly resource?: string};
export type StorageOwnerSaveInput<T> = {readonly expected: StorageCredential; readonly value: T; readonly resource?: string};
export type StorageOwnerConditionalInput = {readonly expected: StorageCredential; readonly resource?: string};
export type StorageOwnerMigrateInput<T> = {readonly expected: StorageCredential; readonly value?: T; readonly resource?: string};
export type StorageOwnerRepairInput<T> = {readonly expected: StorageRepairCredential; readonly value: T; readonly resource?: string};
export type StorageOwnerReclaimInput = {readonly targets: readonly StorageAddress[]};

/** 订阅句柄；`snapshot` 是建立订阅时的初始快照，后续变化经 `onUpdate` 报告。 */
export type StorageOwnerSubscription<T> = {
    readonly snapshot: StorageReadResult<T>;
    refresh(): Promise<StorageReadResult<T>>;
    close(): Promise<void>;
};

export type StorageOwnerSubscribeOptions<T> = {
    readonly resource?: string;
    readonly onUpdate?: (snapshot: StorageReadResult<T>) => void;
    /** 读取故障与订阅终止的可见通道；观察者异常不影响已提交事实。 */
    readonly onError?: (error: unknown) => void;
};

export type StorageOwnerHandle = {
    readonly owner: string;
    readonly binding: StoragePartitionBinding;
    read<T>(definition: DefinedStorageState<T>, options?: StorageOwnerReadOptions): Promise<StorageReadResult<T>>;
    save<T>(definition: DefinedStorageState<T>, input: StorageOwnerSaveInput<T>): Promise<StorageCredential>;
    remove(definition: DefinedStorageState<unknown>, input: StorageOwnerConditionalInput): Promise<StorageCredential>;
    migrate<T>(definition: DefinedStorageState<T>, input: StorageOwnerMigrateInput<T>): Promise<StorageCredential>;
    repair<T>(definition: DefinedStorageState<T>, input: StorageOwnerRepairInput<T>): Promise<StorageCredential>;
    reclaim(definition: DefinedStorageState<unknown>, input: StorageOwnerReclaimInput): Promise<StorageReclaimResult>;
    subscribe<T>(definition: DefinedStorageState<T>, options?: StorageOwnerSubscribeOptions<T>): Promise<StorageOwnerSubscription<T>>;
    release(): Promise<void>;
};

type ReadEntry = {
    readonly definition: DefinedStorageState<unknown>;
    readonly resource: string | undefined;
    readonly key: string;
    onUpdate: ((snapshot: StorageReadResult<unknown>) => void) | undefined;
    onError: ((error: unknown) => void) | undefined;
    closed: boolean;
    dirty: boolean;
    backoffMs: number;
    timer: ReturnType<typeof setTimeout> | null;
    tail: Promise<void>;
    closing: Promise<void> | null;
    lastKey: string | null;
    readonly abort: AbortController;
};

/** 建立句柄：先由服务端打开受信 owner 并捕获分区代次，之后每个动作都携带这份绑定。 */
export async function openStorageOwnerHandle(input: StorageOwnerHandleOptions): Promise<StorageOwnerHandle> {
    const owner = input.owner;
    const transport = input.transport ?? createStorageHttpTransport({session: input.session});
    const intervalMs = input.subscribe?.intervalMs ?? STORAGE_SUBSCRIBE_INTERVAL_MS;
    const maxBackoffMs = input.subscribe?.maxBackoffMs ?? STORAGE_SUBSCRIBE_MAX_BACKOFF_MS;
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 10 || !Number.isSafeInteger(maxBackoffMs)
        || maxBackoffMs < intervalMs || maxBackoffMs > 2_147_483_647) {
        throw new StorageAdapterError({code: "STORAGE_REQUEST_INVALID", status: null, message: "Storage 观察间隔必须为至少 10ms 的安全整数，退避上限不得小于间隔或超过计时器上限", committed: false});
    }
    const binding = await requestPartitionBinding(transport, owner);
    let released = false;
    let closing: Promise<void> | null = null;
    let invalid: StorageAdapterError | null = null;
    const reading = new Set<Promise<unknown>>();
    const readAbort = new AbortController();
    const writes = new Map<string, Promise<unknown>>();
    const subscriptions = new Set<ReadEntry>();

    const closedError = (message: string): StorageAdapterError =>
        new StorageAdapterError({code: "STORAGE_HANDLE_CLOSED", status: null, message, committed: false});

    /** 只拒绝新调用；已接纳的排空不受影响。 */
    const assertAcceptable = (): void => {
        if (released) throw closedError("Storage 句柄已释放，不能接受新调用");
        if (invalid !== null) throw invalid;
    };

    const assertOwner = (definition: DefinedStorageState<unknown>): void => {
        if (definition.owner !== owner) {
            throw new StorageAdapterError({
                code: "STORAGE_CONTEXT_INVALID",
                status: null,
                message: `Storage 句柄绑定 owner ${owner}，不能访问 ${definition.owner}`,
                committed: false,
            });
        }
    };

    const send = async <TKind extends StorageActionKind>(
        action: StorageActionRequest,
        expectedKind: TKind,
        signal?: AbortSignal,
    ): Promise<Extract<StorageActionResponse, {kind: TKind}>> => {
        if (invalid !== null) throw invalid;
        let response: StorageActionResponse;
        try {
            response = await transport.send(action, {signal});
        } catch (error) {
            const failure = isStorageAdapterError(error) ? error : new StorageAdapterError(projectStorageAdapterFailure(error));
            if (isAccessFailure(failure)) invalid ??= failure;
            throw failure;
        }
        if (response.kind !== expectedKind) {
            throw new StorageAdapterError({
                code: null,
                status: null,
                message: `Storage 动作响应类型与请求不一致：${response.kind}`,
                committed: null,
            });
        }
        return response as Extract<StorageActionResponse, {kind: TKind}>;
    };

    /** 每条记录的 mutation 按调用顺序发送；失败不永久堵塞该记录的后续意图。 */
    const enqueue = <TResult>(key: string, operation: () => Promise<TResult>): Promise<TResult> => {
        const pending = (writes.get(key) ?? Promise.resolve()).then(operation);
        const tail = pending.then(() => undefined, () => undefined);
        writes.set(key, tail);
        void tail.then(() => {
            if (writes.get(key) === tail) writes.delete(key);
        });
        return pending;
    };

    const read = async <T>(definition: DefinedStorageState<T>, options: StorageOwnerReadOptions = {}): Promise<StorageReadResult<T>> => {
        assertAcceptable();
        assertOwner(definition);
        return await sendRead(definition, options.resource);
    };

    /** 释放可取消只读请求，但仍等它们收口；写入只排空，避免把中止误报为未保存。 */
    const sendRead = <T>(definition: DefinedStorageState<T>, resource: string | undefined, signal = readAbort.signal): Promise<StorageReadResult<T>> => {
        const pending = send({kind: "read", owner: definition.owner, key: definition.key, schemaVersion: definition.schemaVersion, resource, binding}, "read", signal)
            .then((response) => validateSnapshot(definition, response.result));
        reading.add(pending);
        void pending.then(() => reading.delete(pending), () => reading.delete(pending));
        return pending;
    };

    const save = async <T>(definition: DefinedStorageState<T>, saveInput: StorageOwnerSaveInput<T>): Promise<StorageCredential> => {
        assertAcceptable();
        assertOwner(definition);
        // 值在接纳边界捕获：调用方之后改写原对象不改变已提交请求。
        const captured = {expected: captureCredential(saveInput.expected), value: captureValue(saveInput.value), resource: saveInput.resource};
        const key = recordKey(definition, saveInput.resource);
        return await enqueue(key, async () => {
            const response = await send({kind: "save", owner: definition.owner, key: definition.key, schemaVersion: definition.schemaVersion, ...captured, binding}, "save");
            notify(key);
            return response.credential;
        });
    };

    const remove = async (definition: DefinedStorageState<unknown>, removeInput: StorageOwnerConditionalInput): Promise<StorageCredential> => {
        assertAcceptable();
        assertOwner(definition);
        const captured = {expected: captureCredential(removeInput.expected), resource: removeInput.resource};
        const key = recordKey(definition, removeInput.resource);
        return await enqueue(key, async () => {
            const response = await send({kind: "remove", owner: definition.owner, key: definition.key, schemaVersion: definition.schemaVersion, ...captured, binding}, "remove");
            notify(key);
            return response.credential;
        });
    };

    const migrate = async <T>(definition: DefinedStorageState<T>, migrateInput: StorageOwnerMigrateInput<T>): Promise<StorageCredential> => {
        assertAcceptable();
        assertOwner(definition);
        const captured = {
            expected: captureCredential(migrateInput.expected),
            value: migrateInput.value === undefined ? undefined : captureValue(migrateInput.value),
            resource: migrateInput.resource,
        };
        const key = recordKey(definition, migrateInput.resource);
        return await enqueue(key, async () => {
            const response = await send({kind: "migrate", owner: definition.owner, key: definition.key, schemaVersion: definition.schemaVersion, ...captured, binding}, "migrate");
            notify(key);
            return response.credential;
        });
    };

    const repair = async <T>(definition: DefinedStorageState<T>, repairInput: StorageOwnerRepairInput<T>): Promise<StorageCredential> => {
        assertAcceptable();
        assertOwner(definition);
        const captured = {
            expected: {partitionGeneration: repairInput.expected.partitionGeneration, contentFingerprint: repairInput.expected.contentFingerprint},
            value: captureValue(repairInput.value),
            resource: repairInput.resource,
        };
        const key = recordKey(definition, repairInput.resource);
        return await enqueue(key, async () => {
            const response = await send({kind: "repair", owner: definition.owner, key: definition.key, schemaVersion: definition.schemaVersion, ...captured, binding}, "repair");
            notify(key);
            return response.credential;
        });
    };

    const reclaim = async (definition: DefinedStorageState<unknown>, reclaimInput: StorageOwnerReclaimInput): Promise<StorageReclaimResult> => {
        assertAcceptable();
        assertOwner(definition);
        const targets = reclaimInput.targets.map((target) => (target.resource === undefined ? {} : {resource: target.resource}));
        const key = recordKey(definition, undefined);
        return await enqueue(key, async () => {
            const response = await send({kind: "reclaim", owner: definition.owner, key: definition.key, schemaVersion: definition.schemaVersion, targets, binding}, "reclaim");
            return response.result;
        });
    };

    const subscribe = async <T>(
        definition: DefinedStorageState<T>,
        options: StorageOwnerSubscribeOptions<T> = {},
    ): Promise<StorageOwnerSubscription<T>> => {
        assertAcceptable();
        assertOwner(definition);
        if (subscriptions.size >= STORAGE_SUBSCRIBE_LIMIT) {
            throw new StorageAdapterError({
                code: "STORAGE_CONTEXT_LIMIT",
                status: null,
                message: `Storage 单个句柄最多同时观察 ${String(STORAGE_SUBSCRIBE_LIMIT)} 条记录`,
                committed: false,
            });
        }
        const entry: ReadEntry = {
            definition,
            resource: options.resource,
            key: recordKey(definition, options.resource),
            onUpdate: options.onUpdate as ((snapshot: StorageReadResult<unknown>) => void) | undefined,
            onError: options.onError,
            closed: false,
            dirty: false,
            backoffMs: intervalMs,
            timer: null,
            tail: Promise.resolve(),
            closing: null,
            lastKey: null,
            abort: new AbortController(),
        };
        subscriptions.add(entry);
        try {
            const snapshot = await enqueueRead(entry, false);
            if (entry.closed || released) throw closedError("Storage 订阅在初始化期间已关闭");
            // 初始快照已经交付给调用方，后续变化才开始经 onUpdate 投递。
            schedule(entry, entry.dirty ? 0 : intervalMs);
            return {
                snapshot: snapshot as StorageReadResult<T>,
                refresh: () => enqueueRead(entry, true) as Promise<StorageReadResult<T>>,
                close: () => closeEntry(entry),
            };
        } catch (error) {
            await closeEntry(entry);
            throw error;
        }
    };

    /** 取消与释放：停止调度、等待在途读取收口，之后不再投递任何快照。 */
    const closeEntry = (entry: ReadEntry): Promise<void> => {
        if (entry.closing !== null) return entry.closing;
        entry.closed = true;
        entry.abort.abort();
        if (entry.timer !== null) clearTimeout(entry.timer);
        entry.timer = null;
        entry.closing = entry.tail.then(() => {
            subscriptions.delete(entry);
        });
        return entry.closing;
    };

    /** 每条订阅只有一条串行读取链；关闭后不再发布，迟到结果不能覆盖较新的快照。 */
    const enqueueRead = (entry: ReadEntry, publish: boolean): Promise<StorageReadResult<unknown>> => {
        const reading = entry.tail.then(async () => {
            if (entry.closed) throw closedError("Storage 订阅已关闭");
            entry.dirty = false;
            const snapshot = await sendRead(entry.definition, entry.resource, entry.abort.signal);
            if (entry.closed) throw closedError("Storage 订阅已关闭");
            const key = snapshotKey(snapshot);
            if (!entry.closed && entry.lastKey !== key) {
                entry.lastKey = key;
                if (publish) emit(entry, snapshot);
            }
            return snapshot;
        });
        entry.tail = reading.then(() => undefined, () => undefined);
        return reading;
    };

    const schedule = (entry: ReadEntry, delay: number): void => {
        if (entry.closed || entry.timer !== null) return;
        entry.timer = setTimeout(() => {
            entry.timer = null;
            void enqueueRead(entry, true).then(
                () => { entry.backoffMs = intervalMs; },
                (error: unknown) => {
                    report(entry, error);
                    // 访问或代次失效终止该订阅；网络故障退避后继续观察。
                    if (isTerminalFailure(error)) {
                        void closeEntry(entry);
                        return;
                    }
                    entry.backoffMs = Math.min(entry.backoffMs * 2, maxBackoffMs);
                },
            ).finally(() => {
                schedule(entry, entry.dirty ? 0 : entry.backoffMs);
            });
        }, delay);
        entry.timer.unref?.();
    };

    /** 本进程提交触发同记录订阅的立即重读；外部提交仍由定期观察发现。 */
    const notify = (key: string): void => {
        for (const entry of subscriptions) {
            if (entry.closed || entry.key !== key) continue;
            entry.dirty = true;
            if (entry.timer === null) continue;
            clearTimeout(entry.timer);
            entry.timer = null;
            schedule(entry, 0);
        }
    };

    const emit = (entry: ReadEntry, snapshot: StorageReadResult<unknown>): void => {
        try {
            entry.onUpdate?.(snapshot);
        } catch (error) {
            report(entry, error);
        }
    };

    const report = (entry: ReadEntry, error: unknown): void => {
        try {
            entry.onError?.(error);
        } catch {
            // 观察者自己的错误处理器抛错不能变成适配器的未处理 rejection。
        }
    };

    return {
        owner,
        binding,
        read,
        save,
        remove,
        migrate,
        repair,
        reclaim,
        subscribe,
        release() {
            if (closing !== null) return closing;
            released = true;
            readAbort.abort();
            closing = Promise.allSettled([
                ...[...subscriptions].map((entry) => closeEntry(entry)),
                ...reading,
                ...writes.values(),
            ]).then(() => undefined);
            return closing;
        },
    };
}

/** 每条记录的 mutation 顺序键；不同记录之间不互相阻塞。 */
function recordKey(definition: DefinedStorageState<unknown>, resource: string | undefined): string {
    return `${definition.key}\u0000${resource ?? ""}`;
}

async function requestPartitionBinding(transport: StorageValueTransport, owner: string): Promise<StoragePartitionBinding> {
    const response = await transport.send({kind: "bind", owner});
    if (response.kind !== "bind") {
        throw new StorageAdapterError({code: null, status: null, message: "Storage 绑定响应与本合同不一致", committed: null});
    }
    return Object.freeze({local: response.binding.local, shared: response.binding.shared});
}

/** 条件凭据在接纳边界捕获，避免调用方在 await 期间改写对象影响条件写。 */
function captureCredential(credential: StorageCredential): StorageCredential {
    return {revision: credential.revision, partitionGeneration: credential.partitionGeneration};
}

/**
 * 值在接纳边界深拷贝并冻结为有限有界 JSON。
 *
 * 上限用合同的硬上限而不是定义声明的容量：单条容量的判定权在服务端注册定义，适配器只保证
 * 请求是可传输的 JSON，不替 owner 决定某个值是否超限。
 */
function captureValue(value: unknown): unknown {
    const captured = captureStorageJsonValue(value, STORAGE_MAX_VALUE_BYTES);
    if (captured.ok) return captured.value;
    throw new StorageAdapterError(captured.kind === "oversize"
        ? {
            code: "STORAGE_VALUE_TOO_LARGE",
            status: null,
            message: `Storage 值 ${String(captured.bytes)} 字节超过单条硬上限 ${String(captured.maxBytes)} 字节`,
            committed: false,
        }
        : {
            code: "STORAGE_VALUE_INVALID",
            status: null,
            message: `Storage 值不是有限有界 JSON：${captured.reason}`,
            committed: false,
        });
}

function isTerminalFailure(error: unknown): boolean {
    return isStorageAdapterError(error) && (isAccessFailure(error) || error.code === "STORAGE_SCHEMA_MISMATCH");
}

function isAccessFailure(error: StorageAdapterError): boolean {
    return error.status === 401 || error.status === 403
        || (error.code !== null && TERMINAL_STORAGE_CODES[error.code] === true);
}

/** 当前值必须按调用方定义验证；旧值只捕获 JSON，不能套用当前 schema。 */
function validateSnapshot<T>(definition: DefinedStorageState<T>, result: StorageReadResult<unknown>): StorageReadResult<T> {
    if (result.kind !== "value" && result.kind !== "legacy-value") return result;
    const captured = captureStorageJsonValue(result.value, STORAGE_MAX_VALUE_BYTES);
    if (!captured.ok) throw new StorageAdapterError({code: null, status: null, message: "Storage 响应值不是有限有界 JSON", committed: null});
    if (result.kind === "legacy-value") {
        if (result.schemaVersion >= definition.schemaVersion) throw new StorageAdapterError({code: "STORAGE_SCHEMA_MISMATCH", status: null, message: "Storage 旧值版本与消费定义不一致", committed: null});
        return {...result, value: captured.value};
    }
    if (result.schemaVersion !== definition.schemaVersion) throw new StorageAdapterError({code: "STORAGE_SCHEMA_MISMATCH", status: null, message: "Storage 响应版本与消费定义不一致", committed: null});
    if (!definition.validate(captured.value)) throw new StorageAdapterError({code: "STORAGE_VALUE_INVALID", status: null, message: "Storage 响应值未通过消费定义校验", committed: null});
    return {...result, value: captured.value};
}

/** 订阅去重用状态身份；监听器改写收到的对象不改变后续判定。 */
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
