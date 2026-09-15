/**
 * 一个实际分区的记录读写 authority。
 *
 * 每次 mutation 都在同一把分区锁内完成“读记录 → 校验凭据 → 校验值 → 容量检查 → 原子替换”，
 * 因此两个进程不可能用同一个旧 revision 分别成功；读取不加锁，但固定先读代次再读记录，
 * 让 (generation, revision) 组合在回收窗口内只会失败关闭，不会复活已回收的删除标记。
 */

import {randomUUID} from "node:crypto";
import {readdir, stat} from "node:fs/promises";
import path from "node:path";
import {
    type StorageCredential,
    type StorageLimits,
    type StorageReadResult,
    type StorageReclaimOutcome,
    type StorageReclaimResult,
    type StorageRepairCredential,
} from "nbook/shared/storage/contract";
import {captureStorageJsonValue, type StorageJsonCapture, type StorageJsonValue} from "nbook/shared/storage/bounded-json";
import {
    StorageCredentialStaleError,
    StorageIoError,
    StorageLockUnavailableError,
    StoragePartitionInvalidError,
    StorageQuotaExceededError,
    StorageRepairConflictError,
    StorageRevisionConflictError,
    StorageValueInvalidError,
    StorageWriteBlockedError,
    isStorageDomainError,
} from "nbook/shared/storage/storage-errors";
import {
    isStorageRecordFileName,
    parseStorageRecord,
    serializeStorageRecord,
    STORAGE_RECORD_WRAPPER_MAX_BYTES,
} from "nbook/server/storage/record-codec";
import {
    quarantineStorageRecord,
    readStorageRecordFile,
    removeStorageRecordFile,
    sweepStorageTempFiles,
    writeStorageRecordFile,
    type StorageRecordFileOptions,
} from "nbook/server/storage/record-file";
import {
    assertStoragePartitionContained,
    assertStorageTargetContained,
    assertStorageRootIdentity,
    type StorageRootIdentity,
    storageRecordFileName,
    type StoragePartitionPaths,
} from "nbook/server/storage/storage-address";
import {StoragePartitionLock, type StorageLockHandle} from "nbook/server/storage/partition-lock";
import {captureStorageValue} from "nbook/server/storage/storage-value";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

/** 分区维护元数据的封装标识；与记录文件分开，不参与记录容量统计。 */
export const STORAGE_PARTITION_META_SCHEMA = "nbook.storage-partition/v1" as const;

/** 分区初始代次；显式回收会持久化更高代次使全部旧凭据失效。 */
export const STORAGE_INITIAL_GENERATION = 1;

/** 维护元数据（分区元数据、身份域）的读取上限；它们只含少量固定字段。 */
export const STORAGE_META_MAX_BYTES = 64 * 1024;

/** 超过原件保留上限时拒绝修复，保持原地址和禁止普通覆盖的状态。 */
export const STORAGE_QUARANTINE_MAX_COPY_BYTES = 1024 * 1024 + STORAGE_RECORD_WRAPPER_MAX_BYTES;

/** 一次操作使用的注册策略；校验与容量来自注册定义，不由调用方临时提供。 */
export type StorageRecordPolicy = {
    readonly key: string;
    readonly resource?: string;
    readonly schemaVersion: number;
    readonly validate: (value: unknown) => boolean;
    readonly limits: StorageLimits;
};

/** 句柄对某个分区代次的捕获；null 表示该句柄还没访问过这个分区。 */
export type StorageGenerationBox = {
    value: number | null;
};

/** 单个记录文件在锁内解析后的状态。 */
type RecordState =
    | {
        readonly kind: "value";
        readonly revision: string;
        readonly schemaVersion: number;
        readonly value: unknown;
        readonly bytes: number;
        readonly fingerprint: string;
    }
    | {readonly kind: "deleted"; readonly revision: string; readonly bytes: number}
    | {readonly kind: "missing"; readonly revision: null; readonly bytes: 0}
    | {
        readonly kind: "broken";
        readonly reason: "corrupt" | "unsupported-version";
        readonly diagnosis: string;
        readonly bytes: number;
        readonly fingerprint: string;
        readonly wrapperVersion: number | null;
        readonly schemaVersion: number | null;
    };

type MutationContext = {
    generation: number;
    readonly lock: StorageLockHandle;
    committed: boolean;
};

type PartitionTotals = {
    readonly records: number;
    readonly bytes: number;
};

/** 被替换记录的当前占用；`exists` 决定投影条数是否先减一。 */
type ExistingRecordSize = {
    readonly exists: boolean;
    readonly bytes: number;
};

export type StoragePartitionStoreOptions = Pick<StorageRecordFileOptions, "replace" | "retryDelaysMs">;

export class StoragePartitionStore {
    private readonly partition: StoragePartitionPaths;
    private readonly lock: StoragePartitionLock;
    private readonly fileOptions: StorageRecordFileOptions;
    private readonly rootIdentity: StorageRootIdentity | undefined;

    constructor(partition: StoragePartitionPaths, lock: StoragePartitionLock, options: StoragePartitionStoreOptions = {}, rootIdentity?: StorageRootIdentity) {
        this.partition = partition;
        this.lock = lock;
        this.fileOptions = options;
        this.rootIdentity = rootIdentity;
    }

    /** 初始化只读取维护代次，不创建默认值或记录文件。 */
    async bindGeneration(generation: StorageGenerationBox): Promise<void> {
        await this.assertContained(this.partition.directory);
        this.assertHandleGeneration(generation, await this.readGeneration());
    }

    /** 读取分类；缺失不创建文件，损坏与更高版本带修复凭据返回。 */
    async read(policy: StorageRecordPolicy, generation: StorageGenerationBox): Promise<StorageReadResult<unknown>> {
        await this.assertContained(this.recordPath(policy));
        // 代次固定先于记录读取：这样 (generation, revision) 组合不会把回收前的墓碑 revision
        // 配上新代次，条件写入因此只会在窗口内失败关闭。
        const currentGeneration = await this.readGeneration();
        this.assertHandleGeneration(generation, currentGeneration);
        const state = await this.readRecordState(policy);
        return this.projectReadResult(policy, state, currentGeneration);
    }

    /** 输入值已由 StorageHandle 在接纳边界捕获并校验；本层只在锁内检查磁盘条件和容量。 */
    async save(
        policy: StorageRecordPolicy,
        generation: StorageGenerationBox,
        input: {readonly expected: StorageCredential; readonly value: StorageJsonValue},
    ): Promise<StorageCredential> {
        const expected = captureCredential(input.expected);
        const value = input.value;
        return this.mutate(generation, async (context) => {
            const state = await this.readRecordState(policy);
            this.assertSaveableWithoutLegacy(policy, state);
            this.assertCondition(expected, state.revision, context.generation);
            const record = {
                kind: "value" as const,
                revision: randomUUID(),
                schemaVersion: policy.schemaVersion,
                value,
            };
            await this.commitRecord(policy, serializeStorageRecord(record), context, {exists: state.kind !== "missing", bytes: state.bytes});
            return {revision: record.revision, partitionGeneration: context.generation};
        });
    }

    /** 条件删除；总是形成带新 revision 的删除标记，缺失记录也落盘以阻止删除前的写复活数据。 */
    async remove(
        policy: StorageRecordPolicy,
        generation: StorageGenerationBox,
        input: {readonly expected: StorageCredential},
    ): Promise<StorageCredential> {
        const expected = captureCredential(input.expected);
        return this.mutate(generation, async (context) => {
            const state = await this.readRecordState(policy);
            this.assertSaveableWithoutLegacy(policy, state);
            this.assertCondition(expected, state.revision, context.generation);
            if (state.kind === "deleted") {
                return {revision: state.revision, partitionGeneration: context.generation};
            }
            const record = {kind: "deleted" as const, revision: randomUUID()};
            await this.commitRecord(policy, serializeStorageRecord(record), context, {exists: state.kind !== "missing", bytes: state.bytes});
            return {revision: record.revision, partitionGeneration: context.generation};
        });
    }

    /**
     * 显式迁移：把旧 schemaVersion 的值升级为当前版本，并把原件保留在隔离区。
     *
     * 普通保存不允许覆盖待迁移旧值，迁移必须带原 revision 条件，并在提交前保存原件副本，
     * 因此失败不会让旧格式记录失去原件保护。
     */
    async migrate(
        policy: StorageRecordPolicy,
        generation: StorageGenerationBox,
        input: {readonly expected: StorageCredential; readonly value?: StorageJsonValue; readonly migrate?: (value: unknown, fromVersion: number) => unknown},
    ): Promise<StorageCredential> {
        const expected = captureCredential(input.expected);
        const providedValue = input.value;
        const migrate = input.migrate;
        return this.mutate(generation, async (context) => {
            const state = await this.readRecordState(policy);
            this.assertSaveable(state);
            if (state.kind !== "value" || state.schemaVersion >= policy.schemaVersion) {
                throw new StorageWriteBlockedError("no-value-record", "迁移只作用于 schemaVersion 低于当前定义的值记录");
            }
            this.assertCondition(expected, state.revision, context.generation);
            const migrated = providedValue !== undefined
                ? providedValue
                : captureStorageValue(this.runMigration(policy, state, migrate), policy);
            const record = {
                kind: "value" as const,
                revision: randomUUID(),
                schemaVersion: policy.schemaVersion,
                value: migrated,
            };
            await this.assertContained(this.partition.quarantineDirectory);
            await quarantineStorageRecord({
                target: this.recordPath(policy),
                quarantineDirectory: this.partition.quarantineDirectory,
                fingerprint: state.fingerprint,
                maxCopyBytes: STORAGE_QUARANTINE_MAX_COPY_BYTES,
                ...this.fileOptions,
                beforeWrite: () => this.assertMutationHealthy(context, this.partition.quarantineDirectory),
            });
            context.lock.assertHealthy();
            await this.commitRecord(policy, serializeStorageRecord(record), context, {exists: true, bytes: state.bytes});
            return {revision: record.revision, partitionGeneration: context.generation};
        });
    }

    /** 显式修复/重置：凭据绑定原始文件内容，原件先保存副本再替换。 */
    async repair(
        policy: StorageRecordPolicy,
        generation: StorageGenerationBox,
        input: {readonly expected: StorageRepairCredential; readonly value: StorageJsonValue},
    ): Promise<StorageCredential> {
        const expected = {...input.expected};
        const value = input.value;
        return this.mutate(generation, async (context) => {
            if (expected.partitionGeneration !== context.generation) {
                throw new StorageCredentialStaleError("credential", expected.partitionGeneration, context.generation);
            }
            const recordPath = this.recordPath(policy);
            await this.assertContained(recordPath);
            const outcome = await readStorageRecordFile(recordPath, policy.limits.maxValueBytes + STORAGE_RECORD_WRAPPER_MAX_BYTES);
            if (outcome.kind === "missing") throw new StorageRepairConflictError(expected.contentFingerprint, null);
            if (outcome.kind === "unreadable") throw new StorageIoError("read", recordPath, outcome.diagnosis);
            const fingerprint = outcome.fingerprint;
            if (fingerprint !== expected.contentFingerprint) {
                throw new StorageRepairConflictError(expected.contentFingerprint, fingerprint);
            }
            const previous = {exists: true, bytes: outcome.bytes};
            const record = {
                kind: "value" as const,
                revision: randomUUID(),
                schemaVersion: policy.schemaVersion,
                value,
            };
            await this.assertContained(this.partition.quarantineDirectory);
            await quarantineStorageRecord({
                    target: recordPath,
                    quarantineDirectory: this.partition.quarantineDirectory,
                    fingerprint,
                    maxCopyBytes: STORAGE_QUARANTINE_MAX_COPY_BYTES,
                    ...this.fileOptions,
                    beforeWrite: () => this.assertMutationHealthy(context, this.partition.quarantineDirectory),
            });
            context.lock.assertHealthy();
            await this.commitRecord(policy, serializeStorageRecord(record), context, previous);
            return {revision: record.revision, partitionGeneration: context.generation};
        });
    }

    /**
     * 显式墓碑回收。
     *
     * 同一临界区先持久化更高分区代次，再删除选定墓碑：旧句柄、旧条件凭据与修复凭据随之失效，
     * 中断最多留下未清完的墓碑。活值与未列出的记录保持不变。
     */
    async reclaim(
        policies: readonly StorageRecordPolicy[],
        generation: StorageGenerationBox,
    ): Promise<StorageReclaimResult> {
        return this.mutate(generation, async (context) => {
            const nextGeneration = context.generation + 1;
            if (!Number.isSafeInteger(nextGeneration)) throw new StoragePartitionInvalidError("分区代次已达安全整数上限");
            await this.writeGeneration(nextGeneration, context.lock);
            context.committed = true;
            context.lock.assertHealthy();
            const outcomes: StorageReclaimOutcome[] = [];
            for (const policy of policies) {
                outcomes.push(await this.reclaimRecord(policy, context));
                context.lock.assertHealthy();
            }
            await sweepStorageTempFiles(this.partition.recordsDirectory, () => this.assertMutationHealthy(context, this.partition.recordsDirectory));
            await sweepStorageTempFiles(this.partition.quarantineDirectory, () => this.assertMutationHealthy(context, this.partition.quarantineDirectory));
            return {partitionGeneration: nextGeneration, outcomes};
        });
    }

    /** 回收单个目标；非墓碑保持原样并报告原因。 */
    private async reclaimRecord(policy: StorageRecordPolicy, context: MutationContext): Promise<StorageReclaimOutcome> {
        const address = policy.resource === undefined ? {} : {resource: policy.resource};
        let state: RecordState;
        try {
            state = await this.readRecordState(policy);
        } catch (error) {
            const diagnosis = error instanceof Error ? error.message : String(error);
            return {address, outcome: "retained", reason: "io-failure", diagnosis};
        }
        if (state.kind !== "deleted") {
            const reason = state.kind === "missing" ? "missing" : state.kind === "value" ? "live" : "broken";
            return {address, outcome: "retained", reason};
        }
        await this.assertMutationHealthy(context, this.recordPath(policy));
        await removeStorageRecordFile(this.recordPath(policy));
        return {address, outcome: "reclaimed"};
    }

    /**
     * 共用 mutation 骨架。
     *
     * 取得锁之后的全部步骤（含代次解析与句柄代次校验）都在同一收口路径里，任何失败都会释放锁；
     * 动作失败优先报告，锁释放未确认只影响锁卫生，由 stale 协议在过期后接管，并如实带上提交状态。
     */
    private async mutate<TResult>(
        generation: StorageGenerationBox,
        action: (context: MutationContext) => Promise<TResult>,
    ): Promise<TResult> {
        await assertStoragePartitionContained(this.partition);
        const lock = await this.lock.acquire(this.partition.lockPath);
        const context: MutationContext = {generation: STORAGE_INITIAL_GENERATION, lock, committed: false};
        const outcome = await (async () => {
            lock.assertHealthy();
            context.generation = await this.ensureGeneration(lock, generation);
            await sweepStorageTempFiles(this.partition.directory, () => this.assertMutationHealthy(context, this.partition.directory));
            await sweepStorageTempFiles(this.partition.recordsDirectory, () => this.assertMutationHealthy(context, this.partition.recordsDirectory));
            return await action(context);
        })().then(
            (value) => ({ok: true as const, value}),
            (error: unknown) => ({ok: false as const, error}),
        );
        const releaseFailure = await lock.release().then(() => null, (error: unknown) => error);
        if (!outcome.ok) {
            if (isStorageDomainError(outcome.error) && outcome.error instanceof StorageLockUnavailableError) {
                throw new StorageLockUnavailableError(outcome.error.reason, context.committed, {cause: outcome.error});
            }
            throw outcome.error;
        }
        if (releaseFailure !== null) {
            throw new StorageLockUnavailableError("release", context.committed, {cause: releaseFailure});
        }
        return outcome.value;
    }

    /** 容量检查与原子替换；提交成功后标记 committed，供释放失败时如实报告。 */
    private async commitRecord(
        policy: StorageRecordPolicy,
        content: string,
        context: MutationContext,
        existing: ExistingRecordSize,
    ): Promise<void> {
        const bytes = Buffer.byteLength(content, "utf8");
        const totals = await this.measurePartition();
        const projected: PartitionTotals = {
            records: totals.records - (existing.exists ? 1 : 0) + 1,
            bytes: totals.bytes - existing.bytes + bytes,
        };
        this.assertQuota(policy.limits, totals, projected);
        context.lock.assertHealthy();
        const target = this.recordPath(policy);
        await this.assertContained(target);
        await writeStorageRecordFile({target, content, ...this.fileOptions, beforeWrite: () => this.assertMutationHealthy(context, target)});
        context.committed = true;
        context.lock.assertHealthy();
    }

    /** 读取代次；缺失元数据按初始代次解释，读取不创建文件。 */
    private async readGeneration(): Promise<number> {
        return (await this.readGenerationState()) ?? STORAGE_INITIAL_GENERATION;
    }

    /** 读取代次；null 表示元数据文件缺失。 */
    private async readGenerationState(): Promise<number | null> {
        const meta = this.partition.metaPath;
        await this.assertContained(meta);
        const outcome = await readStorageRecordFile(meta, STORAGE_META_MAX_BYTES);
        if (outcome.kind === "missing") {
            return null;
        }
        if (outcome.kind !== "text") {
            throw new StoragePartitionInvalidError(outcome.kind === "unreadable" ? outcome.diagnosis : "分区元数据超过读取上限");
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(outcome.raw);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new StoragePartitionInvalidError(`分区元数据不是合法 JSON：${message}`);
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new StoragePartitionInvalidError("分区元数据必须是 JSON 对象");
        }
        const metaValue = parsed as Record<string, unknown>;
        if (metaValue.schema !== STORAGE_PARTITION_META_SCHEMA) {
            throw new StoragePartitionInvalidError(`分区元数据封装不受支持：${String(metaValue.schema)}`);
        }
        const generation = metaValue.generation;
        if (typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 1) {
            throw new StoragePartitionInvalidError(`分区代次非法：${String(generation)}`);
        }
        return generation;
    }

    /** mutation 起点：首次 mutation 创建必要分区元数据，缺失记录的读取路径不写默认值。 */
    private async ensureGeneration(lock: StorageLockHandle, generation: StorageGenerationBox): Promise<number> {
        const existing = await this.readGenerationState();
        this.assertHandleGeneration(generation, existing ?? STORAGE_INITIAL_GENERATION);
        if (existing !== null) {
            return existing;
        }
        await this.writeGeneration(STORAGE_INITIAL_GENERATION, lock);
        return STORAGE_INITIAL_GENERATION;
    }

    private async writeGeneration(generation: number, lock: StorageLockHandle): Promise<void> {
        const content = `${JSON.stringify({schema: STORAGE_PARTITION_META_SCHEMA, generation})}\n`;
        await writeStorageRecordFile({target: this.partition.metaPath, content, ...this.fileOptions, beforeWrite: async () => {
            await this.assertContained(this.partition.metaPath);
            lock.assertHealthy();
        }});
    }

    /** 句柄绑定的代次必须与当前代次一致；显式回收后旧句柄须重新初始化。 */
    private assertHandleGeneration(box: StorageGenerationBox, currentGeneration: number): void {
        if (box.value === null) {
            box.value = currentGeneration;
            return;
        }
        if (box.value !== currentGeneration) {
            throw new StorageCredentialStaleError("handle", box.value, currentGeneration);
        }
    }

    /** 条件凭据必须同时绑定当前分区代次与当前 revision。 */
    private assertCondition(expected: StorageCredential, revision: string | null, generation: number): void {
        if (expected.partitionGeneration !== generation) {
            throw new StorageCredentialStaleError("credential", expected.partitionGeneration, generation);
        }
        if (expected.revision !== revision) {
            throw new StorageRevisionConflictError(expected.revision, revision);
        }
    }

    /** 普通保存只接受值记录与删除标记；损坏、未知版本与待迁移旧值都必须走显式修复/迁移。 */
    private assertSaveable(state: RecordState): asserts state is Exclude<RecordState, {kind: "broken"}> {
        if (state.kind === "broken") {
            throw new StorageWriteBlockedError(state.reason, state.diagnosis);
        }
    }

    /** 保存路径额外拒绝待迁移旧值：覆盖它会让旧格式失去原件保护。 */
    private assertSaveableWithoutLegacy(policy: StorageRecordPolicy, state: RecordState): asserts state is Exclude<RecordState, {kind: "broken"}> {
        this.assertSaveable(state);
        if (state.kind === "value" && state.schemaVersion < policy.schemaVersion) {
            throw new StorageWriteBlockedError(
                "legacy-value",
                `记录仍是 schemaVersion ${String(state.schemaVersion)}，请走显式迁移`,
            );
        }
    }

    private runMigration(
        policy: StorageRecordPolicy,
        state: Extract<RecordState, {kind: "value"}>,
        migrate: ((value: unknown, fromVersion: number) => unknown) | undefined,
    ): unknown {
        if (migrate === undefined) {
            throw new StorageValueInvalidError("migrate", `Storage 定义未提供迁移函数：${policy.key}`);
        }
        return migrate(state.value, state.schemaVersion);
    }

    /** 只允许不增加占用的更新越过已满分区，使删除与显式回收能在容量满时继续减少占用。 */
    private assertQuota(limits: StorageLimits, current: PartitionTotals, projected: PartitionTotals): void {
        if (projected.records <= current.records && projected.bytes <= current.bytes) {
            return;
        }
        if (projected.records > limits.maxRecords) {
            throw new StorageQuotaExceededError("records", projected.records, limits.maxRecords);
        }
        if (projected.bytes > limits.maxPartitionBytes) {
            throw new StorageQuotaExceededError("bytes", projected.bytes, limits.maxPartitionBytes);
        }
    }

    /** 分区实际占用：只统计正式记录文件，忽略临时文件、隔离件与维护元数据。 */
    private async measurePartition(): Promise<PartitionTotals> {
        const entries = await readdir(this.partition.recordsDirectory, {withFileTypes: true}).catch((error: unknown) => {
            if (isMissingPathError(error)) {
                return [];
            }
            throw new StorageIoError("read", this.partition.recordsDirectory, describe(error), {cause: error});
        });
        const names = entries
            .filter((entry) => entry.isFile() && isStorageRecordFileName(entry.name))
            .map((entry) => entry.name);
        const sizes = await Promise.all(names.map(async (name) => {
            const target = path.join(this.partition.recordsDirectory, name);
            try {
                return (await stat(target)).size;
            } catch (error) {
                throw new StorageIoError("stat", target, describe(error), {cause: error});
            }
        }));
        return {records: names.length, bytes: sizes.reduce((total, size) => total + size, 0)};
    }

    /** 单条读取上限：定义声明的值上限加上封装字段预算。 */
    private recordReadLimit(policy: StorageRecordPolicy): number {
        return policy.limits.maxValueBytes + STORAGE_RECORD_WRAPPER_MAX_BYTES;
    }

    private async readRecordState(policy: StorageRecordPolicy): Promise<RecordState> {
        await this.assertContained(this.recordPath(policy));
        const outcome = await readStorageRecordFile(this.recordPath(policy), this.recordReadLimit(policy));
        if (outcome.kind === "missing") {
            return {kind: "missing", revision: null, bytes: 0};
        }
        if (outcome.kind === "unreadable") throw new StorageIoError("read", this.recordPath(policy), outcome.diagnosis);
        if (outcome.kind === "oversized") {
            return {
                kind: "broken",
                reason: "corrupt",
                diagnosis: "记录文件超过读取上限",
                bytes: outcome.bytes,
                fingerprint: outcome.fingerprint,
                wrapperVersion: null,
                schemaVersion: null,
            };
        }
        const bytes = outcome.bytes;
        const parsed = parseStorageRecord(outcome.raw);
        switch (parsed.kind) {
            case "deleted":
                return {kind: "deleted", revision: parsed.revision, bytes};
            case "corrupt":
                return {
                    kind: "broken",
                    reason: "corrupt",
                    diagnosis: parsed.diagnosis,
                    bytes,
                    fingerprint: outcome.fingerprint,
                    wrapperVersion: null,
                    schemaVersion: null,
                };
            case "unsupported-version":
                return {
                    kind: "broken",
                    reason: "unsupported-version",
                    diagnosis: parsed.diagnosis,
                    bytes,
                    fingerprint: outcome.fingerprint,
                    wrapperVersion: parsed.wrapperVersion,
                    schemaVersion: parsed.schemaVersion,
                };
            case "value": {
                if (parsed.schemaVersion > policy.schemaVersion) {
                    return {
                        kind: "broken",
                        reason: "unsupported-version",
                        diagnosis: `记录 schemaVersion ${String(parsed.schemaVersion)} 高于当前 ${String(policy.schemaVersion)}`,
                        bytes,
                        fingerprint: outcome.fingerprint,
                        wrapperVersion: null,
                        schemaVersion: parsed.schemaVersion,
                    };
                }
                const captured = this.inspectStoredValue(policy, parsed.value, parsed.schemaVersion);
                if (!captured.ok) {
                    return {
                        kind: "broken",
                        reason: "corrupt",
                        diagnosis: captured.kind === "invalid" ? captured.reason : `记录值超过上限 ${String(captured.maxBytes)} 字节`,
                        bytes,
                        fingerprint: outcome.fingerprint,
                        wrapperVersion: null,
                        schemaVersion: parsed.schemaVersion,
                    };
                }
                return {
                    kind: "value",
                    revision: parsed.revision,
                    schemaVersion: parsed.schemaVersion,
                    value: captured.value,
                    bytes,
                    fingerprint: outcome.fingerprint,
                };
            }
        }
    }

    /**
     * 已确认值与待迁移旧值都要先通过有限有界 JSON 与体积检查。
     *
     * 这是格式层检查，不随 schemaVersion 改变；旧格式只在“值语义”上跳过当前校验规则，
     * 不能让手工文件里的 `1e999` 之类非有限数字进入投影。
     */
    private inspectStoredValue(policy: StorageRecordPolicy, value: unknown, schemaVersion: number): StorageJsonCapture {
        const inspection = captureStorageJsonValue(value, policy.limits.maxValueBytes);
        if (!inspection.ok) {
            return inspection;
        }
        if (schemaVersion === policy.schemaVersion && !policy.validate(inspection.value)) {
            return {ok: false, kind: "invalid", reason: "值未通过注册校验"};
        }
        return inspection;
    }

    private projectReadResult(
        policy: StorageRecordPolicy,
        state: RecordState,
        generation: number,
    ): StorageReadResult<unknown> {
        switch (state.kind) {
            case "missing":
                return {kind: "missing", credential: {revision: null, partitionGeneration: generation}};
            case "deleted":
                return {kind: "deleted", credential: {revision: state.revision, partitionGeneration: generation}};
            case "value": {
                const credential: StorageCredential = {revision: state.revision, partitionGeneration: generation};
                return state.schemaVersion === policy.schemaVersion
                    ? {kind: "value", value: state.value, schemaVersion: state.schemaVersion, credential}
                    : {kind: "legacy-value", value: state.value, schemaVersion: state.schemaVersion, credential};
            }
            case "broken": {
                const repair = {
                    partitionGeneration: generation,
                    contentFingerprint: state.fingerprint,
                };
                return state.reason === "corrupt"
                    ? {kind: "corrupt", diagnosis: state.diagnosis, repair}
                    : {
                        kind: "unsupported-version",
                        wrapperVersion: state.wrapperVersion,
                        schemaVersion: state.schemaVersion,
                        diagnosis: state.diagnosis,
                        repair,
                    };
            }
        }
    }

    private recordPath(policy: StorageRecordPolicy): AbsoluteFsPath {
        return absoluteFsPath(path.join(
            this.partition.recordsDirectory,
            storageRecordFileName(policy.key, policy.resource),
        ));
    }

    /** 逐目标检查真实路径仍在存储根内，覆盖 records/quarantine 等中间目录被替换成联接的情况。 */
    private async assertContained(target: AbsoluteFsPath): Promise<void> {
        if (this.rootIdentity !== undefined) await assertStorageRootIdentity(this.partition.root, this.rootIdentity);
        await assertStorageTargetContained(this.partition.root, target);
    }

    private async assertMutationHealthy(context: MutationContext, target: AbsoluteFsPath): Promise<void> {
        await this.assertContained(target);
        context.lock.assertHealthy();
    }
}

/** 接受操作时捕获凭据字段，避免 caller 在 await 期间改写对象影响条件写。 */
function captureCredential(credential: StorageCredential): StorageCredential {
    return {revision: credential.revision, partitionGeneration: credential.partitionGeneration};
}

function isMissingPathError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
