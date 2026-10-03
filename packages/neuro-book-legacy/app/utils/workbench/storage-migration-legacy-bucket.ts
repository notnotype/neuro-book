/**
 * 旧 `novel.ide.local` 桶的原件暂存与迁移期写回门禁（浏览器侧）。
 *
 * 职责依据 [迁移合同](../../../../../packages/neuro-book/docs/migrations/storage-state.md)「启动顺序与单写者」：
 *
 * - **暂存**：在旧 Pinia 持久化插件可能重写 `novel.ide.local` 之前，把完整原始字符串（**未解析**）
 *   写入专用浏览器暂存并回读核验；暂存带版本、来源、字节数与摘要，原始值上限 8 MiB。
 *   多标签创建暂存与"转换旧 writer"共享初始化互斥：读取与写入放在同一个 IndexedDB `readwrite`
 *   事务里，同源重叠事务由浏览器串行化，因此原件已存在时不会被后续旧桶覆盖。
 *   localStorage 装不下 8 MiB 原件，也不提供这个原子性，因此不做降级。
 * - **门禁**：暂存核验成功后，写回只把三个源字段固定为**捕获值**（原本缺失的保持缺失），
 *   不接受运行期的尺寸或书架意图回写源字段；只有无法先保留原件时才冻结整桶
 *   （`setItem` 被拒绝，偏好仅内存生效），并保留完整旧桶。
 *
 * 本模块是纯模块：不 import Vue/Pinia，不自己开 Storage 会话；旧桶介质与暂存介质都可注入。
 */

import {
    WORKBENCH_MIGRATION_CHUNK_BYTES,
    WORKBENCH_MIGRATION_ORIGINAL_LIMIT_BYTES,
    WORKBENCH_MIGRATION_SOURCE,
    WORKBENCH_MIGRATION_VERSION,
} from "nbook/shared/storage/workbench-migration";

/** 旧桶键；迁移合同唯一的源。 */
export const LEGACY_BUCKET_KEY = "novel.ide.local";

/** 本次迁移的三个源字段；与旧桶 `pick` 中的同名键一一对应。 */
export const LEGACY_BUCKET_FIELDS = ["leftPanelWidth", "agentPanelWidth", "projectPickerLayoutMode"] as const;
export type LegacyBucketField = (typeof LEGACY_BUCKET_FIELDS)[number];

/** 原件原始字符串上限 8 MiB（UTF-8 字节）。 */
export const LEGACY_BUCKET_ORIGINAL_LIMIT_BYTES = WORKBENCH_MIGRATION_ORIGINAL_LIMIT_BYTES;

/** 满足 persist 契约的同步介质形状。 */
export type LegacyBucketStorage = {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
};

/** 三个源字段的捕获值；键缺失表示原件里没有该字段。 */
export type LegacyBucketFieldValues = Partial<Record<LegacyBucketField, unknown>>;

/**
 * 写回门禁策略。
 *
 * - `inactive`：插件尚未暂存（或宿主没有旧桶介质），保持旧 writer 原行为；
 * - `pinned`：三字段固定为捕获值，其它字段继续由原 writer 管理；
 * - `locked`：无法先保留原件，整桶冻结，`setItem` 一律拒绝（偏好仅内存生效）。
 */
export type LegacyBucketWriterPolicy =
    | {readonly mode: "inactive"}
    | {readonly mode: "pinned"; readonly fields: LegacyBucketFieldValues}
    | {readonly mode: "locked"; readonly reason: string};

let writerPolicy: LegacyBucketWriterPolicy = {mode: "inactive"};

/** 安装写回门禁；由启动接线在暂存结束（成功或失败）后调用。 */
export function installLegacyBucketWriterPolicy(policy: LegacyBucketWriterPolicy): void {
    writerPolicy = policy;
}

export function legacyBucketWriterPolicy(): LegacyBucketWriterPolicy {
    return writerPolicy;
}

/**
 * 迁移期结束时退役门禁（t48 在从旧 `pick` 移除三个源字段、解除 serializer 后调用）。
 *
 * 退役后旧桶写回回到默认行为：本模块不再替旧 writer 决定这三个键的内容。
 * 完成迁移前**不要**调用它——固定值正是"旧 writer 不是这三个字段 authority"的表达。
 */
export function retireLegacyBucketWriterPolicy(): void {
    writerPolicy = {mode: "inactive"};
}

/** 默认介质：当前宿主的 localStorage；不可用时按"没有旧桶"处理，不制造 fallback 介质。 */
export function resolveLegacyBucketStorage(): LegacyBucketStorage | null {
    const candidate: unknown = (globalThis as {localStorage?: unknown}).localStorage;
    if (typeof candidate !== "object" || candidate === null) {
        return null;
    }
    const storage = candidate as {readonly getItem?: unknown; readonly setItem?: unknown};
    return typeof storage.getItem === "function" && typeof storage.setItem === "function"
        ? candidate as LegacyBucketStorage
        : null;
}

export function readLegacyBucketRaw(storage: LegacyBucketStorage | null = resolveLegacyBucketStorage()): string | null {
    if (storage === null) {
        return null;
    }
    try {
        return storage.getItem(LEGACY_BUCKET_KEY);
    } catch {
        // 介质被浏览器拒绝（隐私模式、被禁用）：按"没有旧桶"处理，由调用方区分状态。
        return null;
    }
}

/** 原件字节数与摘要；同一份实现同时用于浏览器暂存与 data 备份核验。 */
export type LegacyOriginalMeasurement = {readonly byteLength: number; readonly digest: string};

/**
 * 计算原件的 UTF-8 字节数与非加密摘要。
 *
 * 摘要只用于检出截断与错配：HTTP 部署没有安全上下文，不能依赖 SubtleCrypto。
 */
export function measureLegacyOriginal(raw: string): LegacyOriginalMeasurement {
    const bytes = new TextEncoder().encode(raw);
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (const byte of bytes) {
        first = Math.imul(first ^ byte, 0x01000193) >>> 0;
        second = Math.imul(second ^ byte, 0x85ebca6b) >>> 0;
    }
    return {
        byteLength: bytes.byteLength,
        digest: `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`,
    };
}

/**
 * 按 UTF-8 字节预算切分原文。
 *
 * 切点不落在代理对中间：拼回后与原文逐字符相同，因此核验只需要比较整体摘要与字节数。
 */
export function splitLegacyOriginalChunks(raw: string, budget = WORKBENCH_MIGRATION_CHUNK_BYTES): readonly string[] {
    const chunks: string[] = [];
    let start = 0;
    let cursor = 0;
    let used = 0;
    while (cursor < raw.length) {
        const point = raw.codePointAt(cursor) ?? 0;
        const width = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
        if (used + width > budget && cursor > start) {
            chunks.push(raw.slice(start, cursor));
            start = cursor;
            used = 0;
        }
        used += width;
        cursor += point > 0xffff ? 2 : 1;
    }
    chunks.push(raw.slice(start));
    return chunks;
}

/** 逐字段读取原件的三个源字段；损坏或非对象 JSON 一律按"三字段都缺失"处理，不抛出。 */
export function readLegacyBucketFieldValues(raw: string | null): LegacyBucketFieldValues {
    const values: LegacyBucketFieldValues = {};
    if (raw === null || raw.length === 0) {
        return values;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return values;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return values;
    }
    const record = parsed as Record<string, unknown>;
    for (const field of LEGACY_BUCKET_FIELDS) {
        if (Object.hasOwn(record, field)) {
            values[field] = record[field];
        }
    }
    return values;
}

/**
 * 已退役的运行期 fields：`activeLeftTab`（旧的活动左侧页签）。
 *
 * 它不再有运行期的读者与写者（`pick` 里没有它，store 也不暴露同名状态），但它**不是**本迁移的三源
 * 字段：本迁移没有决定怎么处置它，所以任何整键重写都不许顺手把它删掉。做法是"原件保留"——
 * `deserialize` 捕获原件里的原值（原件没有这个键就不捕获），`serialize` 在输出缺这个键时原样合成：
 * 不制造缺省值，也不改写它的值（未知值照原样留着）。
 */
export const LEGACY_BUCKET_RETIRED_FIELDS = ["activeLeftTab"] as const;
export type LegacyBucketRetiredField = (typeof LEGACY_BUCKET_RETIRED_FIELDS)[number];

/** 上一次读到的原件里退役字段的原值；与 `deserialize` 成对使用（读写同一份旧桶）。 */
let retiredFieldSnapshot: Record<string, unknown> = {};

/**
 * 迁移期的序列化器：只重写三个源字段，并原样合成退役字段。
 *
 * 传入的是 `pick` 过滤后的状态；输出把三个源字段替换成捕获值，原本缺失的保持缺失，
 * 运行期的尺寸与书架意图不会成为旧桶里的新值。
 */
export const legacyBucketSerializer = {
    serialize(state: unknown): string {
        const policy = writerPolicy;
        const picked = typeof state === "object" && state !== null && !Array.isArray(state)
            ? state as Record<string, unknown>
            : {};
        const output: Record<string, unknown> = {};
        if (policy.mode !== "pinned") {
            Object.assign(output, picked);
        } else {
            for (const [key, value] of Object.entries(picked)) {
                if (!(LEGACY_BUCKET_FIELDS as readonly string[]).includes(key)) {
                    output[key] = value;
                }
            }
            for (const field of LEGACY_BUCKET_FIELDS) {
                if (Object.hasOwn(policy.fields, field)) {
                    output[field] = policy.fields[field];
                }
            }
        }
        for (const [key, value] of Object.entries(retiredFieldSnapshot)) {
            if (!Object.hasOwn(output, key)) {
                output[key] = value;
            }
        }
        return JSON.stringify(output);
    },
    deserialize(raw: string): Record<string, unknown> {
        const parsed: unknown = JSON.parse(raw);
        // 非对象 JSON 与旧 writer 的默认行为等价：hydrate 之后 store 仍是各自默认值。
        const record = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
        // 退役字段只做原件保留：捕获后从水合结果里摘掉——store 已经没有对应状态，
        // 让它们进 pinia state 只会多出一个没人读的键。
        retiredFieldSnapshot = {};
        for (const field of LEGACY_BUCKET_RETIRED_FIELDS) {
            if (Object.hasOwn(record, field)) {
                retiredFieldSnapshot[field] = record[field];
                delete record[field];
            }
        }
        return record;
    },
};

/**
 * 迁移期的旧桶介质：读始终直通，写按门禁策略裁决。
 *
 * 冻结整桶时写入被拒绝；persist 的 `setItem` 异常由插件自身捕获，因此这里只负责表达事实，
 * 用户可见提示与重试入口由迁移状态（`storage-migration.ts`）暴露。
 */
export function legacyBucketStorage(options: {readonly storage?: LegacyBucketStorage | null} = {}): LegacyBucketStorage {
    // 介质按调用解析，不在构造时捕获：store 定义在模块求值时就建立 persist 配置，
    // 而 localStorage 到那时可能还不存在（SSR/测试宿主）；Nuxt 自带的存储助手同样是每次调用才读全局。
    const resolve = (): LegacyBucketStorage | null =>
        options.storage === undefined ? resolveLegacyBucketStorage() : options.storage;
    return {
        getItem(key) {
            return resolve()?.getItem(key) ?? null;
        },
        setItem(key, value) {
            const policy = writerPolicy;
            if (policy.mode === "locked") {
                throw new Error(`novel.ide.local 已冻结，不重写旧桶：${policy.reason}`);
            }
            resolve()?.setItem(key, value);
        },
    };
}

/** 暂存失败原因：分类必须能区分宿主能力缺失、被阻塞、事务失败、回读不一致与越界。 */
export type LegacyStagingFailureReason =
    | "unavailable"
    | "blocked"
    | "write-failed"
    | "read-failed"
    | "readback-mismatch"
    | "invalid-record"
    | "oversize"
    | "conflict";

/** 暂存结果的成功形态；`original` 为 null 表示旧桶不存在，没有原件需要保护。 */
type StagingOriginalOutcome = {readonly status: "original"; readonly original: LegacyOriginalRecord | null};

/** 已核验的浏览器原件暂存。 */
export type LegacyOriginalRecord = {
    readonly source: string;
    readonly version: number;
    readonly capturedAt: string;
    readonly byteLength: number;
    readonly digest: string;
    readonly raw: string;
};

/**
 * 暂存结果；`original` 为 `null` 表示旧桶不存在（或为空），没有原件需要保护。
 */
export type LegacyStagingResult =
    | {readonly status: "original"; readonly original: LegacyOriginalRecord | null}
    | {readonly status: "failed"; readonly reason: LegacyStagingFailureReason; readonly diagnosis: string};

/** 暂存接缝：产品实现是 IndexedDB；测试与隔离宿主可注入自己的实现。 */
export type LegacyBucketStaging = {
    /** 确保原件已固化并回读核验；已存在时原样带回，不覆盖。 */
    ensure(): Promise<LegacyStagingResult>;
};

const STAGING_DATABASE = "nbook.storage-migration";
const STAGING_DATABASE_VERSION = 1;
const STAGING_STORE = "original";
const STAGING_RECORD = "legacy-original";

/** 暂存失效的统一形状。 */
type StagingFailure = {readonly status: "failed"; readonly reason: LegacyStagingFailureReason; readonly diagnosis: string};

export type IndexedDbLegacyStagingOptions = {
    readonly indexedDB?: IDBFactory | null;
    /** 读取旧桶原始字符串；默认读当前宿主 localStorage。 */
    readonly readBucket?: () => string | null;
    readonly now?: () => string;
    readonly source?: string;
    readonly version?: number;
};

/**
 * 建立 IndexedDB 暂存。
 *
 * 事务顺序：`readwrite` 事务内"读已有记录 → （缺失时）读取旧桶、写记录"；
 * 事务提交后再开一个事务回读核验。因此两个标签页同时暂存时后到者只会读到同一份原件。
 */
export function createIndexedDbLegacyBucketStaging(options: IndexedDbLegacyStagingOptions = {}): LegacyBucketStaging {
    const source = options.source ?? WORKBENCH_MIGRATION_SOURCE;
    const version = options.version ?? WORKBENCH_MIGRATION_VERSION;
    const readBucket = options.readBucket ?? (() => readLegacyBucketRaw());
    const now = options.now ?? (() => new Date().toISOString());
    return {
        async ensure(): Promise<LegacyStagingResult> {
            const factory = resolveIndexedDb(options.indexedDB);
            if (isStagingFailure(factory)) {
                return factory;
            }
            const created = await mutateOriginal<StagingOriginalOutcome>(factory, (store, decide, abort) => {
                const request = store.get(STAGING_RECORD);
                request.onsuccess = () => {
                    const stored: unknown = request.result;
                    if (stored !== undefined) {
                        const existing = readStoredOriginal(stored, source, version);
                        if (isStagingFailure(existing)) {
                            abort(existing);
                            return;
                        }
                        decide({status: "original", original: existing.original});
                        return;
                    }
                    let raw: string | null;
                    try {
                        raw = readBucket();
                    } catch (error) {
                        abort(failure("read-failed", describeError(error)));
                        return;
                    }
                    if (raw === null || raw.length === 0) {
                        // 旧桶不存在或为空：没有原件需要保护，不写暂存记录（后续启动会再次确认同一事实）。
                        decide({status: "original", original: null});
                        return;
                    }
                    const measured = measureLegacyOriginal(raw);
                    if (measured.byteLength > LEGACY_BUCKET_ORIGINAL_LIMIT_BYTES) {
                        abort(failure("oversize", `旧桶原件 ${String(measured.byteLength)} 字节超过 ${String(LEGACY_BUCKET_ORIGINAL_LIMIT_BYTES)} 字节上限`));
                        return;
                    }
                    const record: LegacyOriginalRecord = {
                        source,
                        version,
                        capturedAt: now(),
                        byteLength: measured.byteLength,
                        digest: measured.digest,
                        raw,
                    };
                    try {
                        store.put(record, STAGING_RECORD);
                    } catch (error) {
                        abort(failure("write-failed", describeError(error)));
                        return;
                    }
                    decide({status: "original", original: record});
                };
            });
            if (isStagingFailure(created) || created.original === null) {
                return created;
            }
            const verified = await readOriginal(factory);
            if (isStagingFailure(verified)) {
                return verified;
            }
            if (verified.original === null || !sameOriginal(verified.original, created.original)) {
                return failure("readback-mismatch", "暂存写入后回读的内容与写入值不一致");
            }
            return verified;
        },
    };
}

function failure(reason: LegacyStagingFailureReason, diagnosis: string): StagingFailure {
    return {status: "failed", reason, diagnosis};
}

/** 暂存失败与成功结果的最外层区分；成功结果也有 `status`，不能用字段存在性判断。 */
function isStagingFailure(value: unknown): value is StagingFailure {
    return typeof value === "object" && value !== null && (value as {status?: unknown}).status === "failed";
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function sameOriginal(left: LegacyOriginalRecord, right: LegacyOriginalRecord): boolean {
    return left.byteLength === right.byteLength && left.digest === right.digest && left.raw.length === right.raw.length;
}

/** 解析暂存记录并核对自洽（形状 + 摘要 + 字节数）；不判断归属。 */
function parseStoredOriginal(stored: unknown): {readonly original: LegacyOriginalRecord} | StagingFailure {
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
        return failure("invalid-record", "浏览器暂存记录不是本合同的原件形状");
    }
    const record = stored as Record<string, unknown>;
    const raw: unknown = record.raw;
    const byteLength: unknown = record.byteLength;
    const digest: unknown = record.digest;
    const capturedAt: unknown = record.capturedAt;
    const source: unknown = record.source;
    const version: unknown = record.version;
    if (typeof raw !== "string" || typeof capturedAt !== "string"
        || typeof byteLength !== "number" || typeof digest !== "string"
        || typeof source !== "string" || typeof version !== "number") {
        return failure("invalid-record", "浏览器暂存记录字段不完整");
    }
    const measured = measureLegacyOriginal(raw);
    if (measured.byteLength !== byteLength || measured.digest !== digest) {
        return failure("invalid-record", "浏览器暂存记录与自身摘要不一致，不当作原件使用");
    }
    return {original: {source, version, capturedAt, byteLength, digest, raw}};
}

/** 校验暂存记录归属；不是本迁移的版本与来源按冲突报告，绝不当成原件使用或覆盖。 */
function readStoredOriginal(stored: unknown, source: string, version: number): {readonly original: LegacyOriginalRecord} | StagingFailure {
    const parsed = parseStoredOriginal(stored);
    if (isStagingFailure(parsed)) {
        return parsed;
    }
    if (parsed.original.source !== source || parsed.original.version !== version) {
        return failure("conflict", `浏览器暂存属于其它迁移版本（${parsed.original.source} v${String(parsed.original.version)}），不覆盖也不复用`);
    }
    return parsed;
}

function resolveIndexedDb(candidate: IDBFactory | null | undefined): IDBFactory | StagingFailure {
    let resolved: unknown;
    try {
        resolved = candidate === undefined ? (globalThis as {indexedDB?: unknown}).indexedDB : candidate;
    } catch {
        return failure("unavailable", "当前宿主拒绝访问 IndexedDB，无法固化旧桶原件");
    }
    if (typeof resolved !== "object" || resolved === null || typeof (resolved as {open?: unknown}).open !== "function") {
        return failure("unavailable", "当前宿主没有可用的 IndexedDB，无法固化旧桶原件");
    }
    return resolved as IDBFactory;
}

type StagingTransactionOutcome<TResult> = TResult | StagingFailure;

function mutateOriginal<TResult>(
    factory: IDBFactory,
    build: (store: IDBObjectStore, decide: (value: TResult) => void, abort: (failure: StagingFailure) => void) => void,
): Promise<StagingTransactionOutcome<TResult>> {
    return runStagingTransaction(factory, "readwrite", build);
}

function readOriginal(factory: IDBFactory): Promise<StagingOriginalOutcome | StagingFailure> {
    return runStagingTransaction(factory, "readonly", (store, decide, abort) => {
        const request = store.get(STAGING_RECORD);
        request.onsuccess = () => {
            const stored: unknown = request.result;
            if (stored === undefined) {
                decide({status: "original", original: null});
                return;
            }
            const parsed = parseStoredOriginal(stored);
            if (isStagingFailure(parsed)) {
                // 回读阶段刚写入过一份校验通过的原件：此时任何不一致都是回读核验失败，不是"记录本来就坏"。
                abort(failure("readback-mismatch", parsed.diagnosis));
                return;
            }
            decide({status: "original", original: parsed.original});
        };
    });
}

/**
 * 打开连接执行一次事务。
 *
 * 与 `client-identity.ts` 同一套取舍：不缓存连接（低频操作，缓存反而要处理被升级关闭的连接），
 * 只把事务提交后的结果当成事实。
 */
function runStagingTransaction<TResult>(
    factory: IDBFactory,
    mode: IDBTransactionMode,
    build: (store: IDBObjectStore, decide: (value: TResult) => void, abort: (failure: StagingFailure) => void) => void,
): Promise<StagingTransactionOutcome<TResult>> {
    const {promise, resolve} = Promise.withResolvers<StagingTransactionOutcome<TResult>>();
    const settle = (result: StagingTransactionOutcome<TResult>): void => resolve(result);
    let request: IDBOpenDBRequest;
    try {
        request = factory.open(STAGING_DATABASE, STAGING_DATABASE_VERSION);
    } catch (error) {
        return Promise.resolve(failure("unavailable", describeError(error)));
    }
    let settled = false;
    request.onupgradeneeded = () => {
        const created = request.result;
        if (!created.objectStoreNames.contains(STAGING_STORE)) {
            created.createObjectStore(STAGING_STORE);
        }
    };
    request.onsuccess = () => {
        const connection = request.result;
        if (settled) {
            connection.close();
            return;
        }
        connection.onversionchange = () => connection.close();
        let decided: {readonly value: TResult} | null = null;
        let finished = false;
        const finish = (result: StagingTransactionOutcome<TResult>) => {
            if (finished) return;
            finished = true;
            settled = true;
            connection.close();
            settle(result);
        };
        let transaction: IDBTransaction;
        try {
            transaction = connection.transaction(STAGING_STORE, mode);
        } catch (error) {
            finish(failure("read-failed", describeError(error)));
            return;
        }
        let failureReason: StagingFailure | null = null;
        transaction.oncomplete = () => finish(decided === null ? failure("write-failed", "暂存事务完成但没有提交结果") : decided.value);
        transaction.onerror = () => {
            failureReason ??= failure("write-failed", describeError(transaction.error));
        };
        transaction.onabort = () => finish(failureReason ?? failure("write-failed", describeError(transaction.error)));
        const abort = (reason: StagingFailure): void => {
            failureReason = reason;
            try {
                transaction.abort();
            } catch {
                finish(reason);
            }
        };
        try {
            build(transaction.objectStore(STAGING_STORE), (value) => {
                decided = {value};
            }, abort);
        } catch (error) {
            abort(failure("write-failed", describeError(error)));
        }
    };
    request.onerror = () => {
        settled = true;
        settle(failure("read-failed", describeError(request.error)));
    };
    request.onblocked = () => {
        settled = true;
        settle(failure("blocked", "浏览器暂存数据库被其它标签页阻塞"));
    };
    return promise;
}
