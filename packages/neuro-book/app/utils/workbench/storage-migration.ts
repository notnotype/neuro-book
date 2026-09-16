/**
 * 旧 `novel.ide.local` 三字段的迁移适配器：原件保护、data 备份、逐项条件导入与状态观察。
 *
 * 顺序与失败语义依据 [迁移合同](../../../../../packages/neuro-book/docs/migrations/storage-state.md)：
 *
 * 1. **暂存阶段（启动必须等待）**：把完整旧桶原始字符串固化到浏览器专用暂存并回读核验，
 *    随后安装写回门禁——三字段固定为捕获值（缺失保持缺失），只有原件无法保留时冻结整桶。
 *    这一阶段不联网：后端不可达不能扩大为整桶不可持久化。
 * 2. **导入阶段（后台）**：身份可持久恢复后把原件按块存入 `workbench.migration` 的 data 备份边界并核验，
 *    再逐字段校验源值、逐目标条件初始化，最后登记完成标记。中断后重启按进度续跑，
 *    已有记录、墓碑与未知高版本不被旧值覆盖。
 *
 * 读分类与条件写了什么、失败属于哪一类（后端不可达 / 身份不可恢复 / 暂存失败 / 备份失败 / 导入失败）
 * 都通过快照对外暴露，供后续切片做加载与"未保存"反馈；本模块不 import Vue/Pinia，不读文件。
 */

import {
    closeStorageContext,
    openStorageUserContext,
    type StorageAccessSession,
    type StorageUserContextOpenResult,
} from "nbook/app/utils/storage/host-context-client";
import {isStorageAdapterError, type StorageAdapterError} from "nbook/app/utils/storage/value-transport";
import {openStorageOwnerHandle, type StorageOwnerHandle, type StorageOwnerHandleOptions} from "nbook/app/utils/storage/owner-handle";
import type {StorageCredential, StorageReadResult} from "nbook/shared/storage/contract";
import type {DefinedStorageState} from "nbook/shared/storage/definition";
import {
    WORKBENCH_MIGRATION_CHUNK_BYTES,
    WORKBENCH_MIGRATION_FIELDS,
    WORKBENCH_MIGRATION_OWNER,
    WORKBENCH_MIGRATION_SOURCE,
    WORKBENCH_MIGRATION_VERSION,
    defineWorkbenchMigrationChunkState,
    defineWorkbenchMigrationCompletionState,
    defineWorkbenchMigrationOriginalState,
    defineWorkbenchMigrationProgressState,
    workbenchMigrationChunkResource,
    type WorkbenchMigrationCompletionRecord,
    type WorkbenchMigrationFieldId,
    type WorkbenchMigrationOriginalRecord,
    type WorkbenchMigrationOutcome,
    type WorkbenchMigrationProgressRecord,
    type WorkbenchMigrationTargetProgress,
} from "nbook/shared/storage/workbench-migration";
import {
    WORKBENCH_LAYOUT_OWNER,
    WORKBENCH_SURFACE_IDS,
    defineWorkbenchShelfModeState,
    defineWorkbenchSurfaceSizesState,
    isWorkbenchPanelWidth,
    isWorkbenchShelfMode,
    type WorkbenchSurfaceSizes,
} from "nbook/shared/storage/workbench-state";
import {
    createIndexedDbLegacyBucketStaging,
    installLegacyBucketWriterPolicy,
    readLegacyBucketFieldValues,
    measureLegacyOriginal,
    splitLegacyOriginalChunks,
    type LegacyBucketFieldValues,
    type LegacyBucketStaging,
    type LegacyOriginalRecord,
    type LegacyStagingFailureReason,
} from "nbook/app/utils/workbench/storage-migration-legacy-bucket";

/** 迁移阶段：`staged` 表示原件已固化并已安装写回门禁，导入仍在后台。 */
export type StorageMigrationPhase = "idle" | "staging" | "staged" | "running" | "complete" | "blocked";

/** 阻断原因：分类之间不得混淆，消费者的提示与重试入口按它分派。 */
export type StorageMigrationBlockReason =
    /** 浏览器原件暂存失败或超限：整桶冻结，偏好仅内存生效。 */
    | "original-staging-failed"
    /** 客户端身份不可持久恢复：不开始导入、不清源、不登记完成。 */
    | "identity-unrecoverable"
    /** 后端不可达或访问上下文签发失败：保留暂存与源字段，未迁字段 writer 不受影响。 */
    | "backend-unreachable"
    /** data 原件备份失败：保留浏览器暂存与源字段。 */
    | "backup-failed"
    /** 目标写入或进度登记失败：保留源与已完成进度。 */
    | "import-failed"
    /** 进度元数据读不出来：不能当作"尚未迁移"继续。 */
    | "progress-unreadable"
    /** 进度元数据损坏或高版本：禁止普通覆盖。 */
    | "progress-unprotected"
    /** 完成标记读不出来：不能当作"尚未迁移"。 */
    | "completion-unreadable"
    /** 完成标记损坏、高版本或属于其它迁移版本/来源：不覆盖也不改写。 */
    | "completion-unprotected";

/** 单个源字段的对外结果；`outcome` 为 null 表示本次尚未处理该字段。 */
export type StorageMigrationFieldReport = {
    readonly field: WorkbenchMigrationFieldId;
    readonly outcome: WorkbenchMigrationOutcome | null;
    readonly diagnosis: string | null;
};

/** 迁移状态快照；订阅者拿到的都是不可变副本。 */
export type StorageMigrationSnapshot = {
    readonly phase: StorageMigrationPhase;
    readonly blocked: StorageMigrationBlockReason | null;
    readonly diagnosis: string | null;
    /** 阻断后是否可以显式重试（`false` 表示重跑不会改变结果，例如完成标记属于其它版本）。 */
    readonly retryable: boolean;
    /** 旧桶写回门禁：`pinned` 三字段按捕获值固定，`locked` 整桶冻结。 */
    readonly bucket: "inactive" | "pinned" | "locked";
    /** 已固化的原件摘要；旧桶不存在时为 null。 */
    readonly original: {readonly byteLength: number; readonly digest: string; readonly capturedAt: string} | null;
    /** data 原件备份状态。 */
    readonly backup: "none" | "saved" | "failed";
    readonly fields: readonly StorageMigrationFieldReport[];
};

export type StorageMigrationAdapters = {
    readonly openUserContext: () => Promise<StorageUserContextOpenResult>;
    readonly openOwnerHandle: (input: StorageOwnerHandleOptions) => Promise<StorageOwnerHandle>;
    readonly closeContext: (session: StorageAccessSession) => Promise<void>;
};

export type StorageMigrationOptions = {
    readonly staging?: LegacyBucketStaging;
    readonly adapters?: Partial<StorageMigrationAdapters>;
    readonly now?: () => string;
    /** 目标定义；默认取产品定义，测试可注入自己的实例。 */
    readonly definitions?: {
        readonly surfaceSizes?: DefinedStorageState<WorkbenchSurfaceSizes>;
        readonly shelfMode?: DefinedStorageState<string>;
    };
};

export type StorageMigrationController = {
    /** 暂存阶段完成的信号；启动接线等待它，之后才允许应用挂载。 */
    readonly staged: Promise<StorageMigrationSnapshot>;
    /** 整个导入流程结束（完成或阻断）的信号。 */
    readonly settled: Promise<StorageMigrationSnapshot>;
    start(): Promise<StorageMigrationSnapshot>;
    /** 显式重试：暂存与导入都可重入，已完成的进度与目标不会被重复写入。 */
    retry(): Promise<StorageMigrationSnapshot>;
    snapshot(): StorageMigrationSnapshot;
    subscribe(listener: (snapshot: StorageMigrationSnapshot) => void): () => void;
};

/** 一个目标记录：目标 id 稳定，字段是它承载的源字段。 */
type MigrationTarget = {
    readonly id: string;
    readonly definition: DefinedStorageState<unknown>;
    readonly resource: string | undefined;
    readonly fields: readonly WorkbenchMigrationFieldId[];
    /** 目标缺失时用合法源值构造初值；`null` 表示本次没有可写字段。 */
    readonly compose: (values: LegacyBucketFieldValues) => MigrationComposition;
};

type MigrationComposition = {
    readonly value: unknown | null;
    readonly invalid: Partial<Record<WorkbenchMigrationFieldId, string>>;
};

/** 已有的目标记录给出的共同结论；`null` 表示记录缺失，可以条件初始化。 */
type ExistingTargetOutcome = "already-present" | "tombstoned" | "protected";

/** 汇总同一字段在多个目标上的结论时使用的优先级：写入过的事实优先。 */
const OUTCOME_PRIORITY: readonly WorkbenchMigrationOutcome[] = [
    "imported", "already-present", "tombstoned", "protected", "invalid-source", "source-missing",
];

const defaultAdapters: StorageMigrationAdapters = {
    openUserContext: openStorageUserContext,
    openOwnerHandle: openStorageOwnerHandle,
    closeContext: closeStorageContext,
};

class MigrationStepFailure extends Error {
    constructor(readonly reason: StorageMigrationBlockReason, diagnosis: string) {
        super(diagnosis);
        this.name = "MigrationStepFailure";
    }
}

/**
 * 建立一次迁移适配器。
 *
 * 控制器本身不持有 Storage 会话：每次运行自己签发并释放一份 user 访问，
 * 因此后端不可达只影响这一次运行，不影响未迁字段的旧 writer。
 */
export function createStorageMigration(options: StorageMigrationOptions = {}): StorageMigrationController {
    const staging = options.staging ?? createIndexedDbLegacyBucketStaging();
    const adapters: StorageMigrationAdapters = {...defaultAdapters, ...options.adapters};
    const now = options.now ?? (() => new Date().toISOString());
    const originalState = defineWorkbenchMigrationOriginalState() as DefinedStorageState<unknown>;
    const chunkState = defineWorkbenchMigrationChunkState() as DefinedStorageState<unknown>;
    const progressState = defineWorkbenchMigrationProgressState() as DefinedStorageState<unknown>;
    const completionState = defineWorkbenchMigrationCompletionState() as DefinedStorageState<unknown>;
    const targets = productTargets(options.definitions);

    const listeners = new Set<(snapshot: StorageMigrationSnapshot) => void>();
    const staged = Promise.withResolvers<StorageMigrationSnapshot>();
    const settled = Promise.withResolvers<StorageMigrationSnapshot>();
    // 订阅者可能只在失败后才观察；预先登记 handler，避免无人处理的拒绝。
    void settled.promise.catch(() => undefined);

    let state: StorageMigrationSnapshot = {
        phase: "idle",
        blocked: null,
        diagnosis: null,
        retryable: false,
        bucket: "inactive",
        original: null,
        backup: "none",
        fields: WORKBENCH_MIGRATION_FIELDS.map((field) => ({field, outcome: null, diagnosis: null})),
    };
    let sourceValues: LegacyBucketFieldValues = {};
    let stagedOriginal: LegacyOriginalRecord | null = null;
    let running: Promise<StorageMigrationSnapshot> | null = null;

    const publish = (patch: Partial<StorageMigrationSnapshot>, outcomes?: readonly WorkbenchMigrationTargetProgress[]): void => {
        state = {
            ...state,
            ...patch,
            fields: outcomes === undefined ? state.fields : mergeFieldReports(state.fields, outcomes),
        };
        for (const listener of listeners) {
            try {
                listener(state);
            } catch {
                // 一个消费者异常不能阻断迁移本身。
            }
        }
    };

    const stagePhase = async (): Promise<boolean> => {
        publish({phase: "staging"});
        const result = await staging.ensure();
        if (result.status === "failed") {
            const reason = describeStagingFailure(result.reason);
            // 只有无法先保留原件时才冻结整桶：保留完整旧桶，偏好仅内存生效，并给出重试入口。
            installLegacyBucketWriterPolicy({mode: "locked", reason: result.diagnosis});
            publish({
                phase: "blocked",
                blocked: "original-staging-failed",
                diagnosis: `${reason}：${result.diagnosis}`,
                retryable: true,
                bucket: "locked",
            });
            return false;
        }
        stagedOriginal = result.original;
        sourceValues = readLegacyBucketFieldValues(result.original?.raw ?? null);
        // 暂存核验成功后立即固定三个源字段：之后任何旧 writer 写回都只能是捕获值。
        installLegacyBucketWriterPolicy({mode: "pinned", fields: sourceValues});
        publish({
            phase: "staged",
            blocked: null,
            diagnosis: null,
            retryable: false,
            bucket: "pinned",
            original: result.original === null ? null : {
                byteLength: result.original.byteLength,
                digest: result.original.digest,
                capturedAt: result.original.capturedAt,
            },
        });
        return true;
    };

    const run = (): Promise<StorageMigrationSnapshot> => {
        if (running !== null) {
            return running;
        }
        running = execute().finally(() => {
            running = null;
        });
        return running;
    };

    const execute = async (): Promise<StorageMigrationSnapshot> => {
        let stagedOk = false;
        try {
            stagedOk = await stagePhase();
        } catch (error) {
            // 暂存本身抛错时无法确认原件已保留：按"无法先保留原件"处理，冻结整桶并保留重试。
            installLegacyBucketWriterPolicy({mode: "locked", reason: describeError(error)});
            publish({
                phase: "blocked",
                blocked: "original-staging-failed",
                diagnosis: `浏览器暂存异常：${describeError(error)}`,
                retryable: true,
                bucket: "locked",
            });
        }
        staged.resolve(state);
        if (!stagedOk) {
            settled.resolve(state);
            return state;
        }
        publish({phase: "running"});
        try {
            await importPhase();
        } catch (error) {
            publish({phase: "blocked", blocked: "backend-unreachable", diagnosis: describeError(error), retryable: true});
        }
        settled.resolve(state);
        return state;
    };

    const importPhase = async (): Promise<void> => {
        let opened: StorageUserContextOpenResult;
        try {
            opened = await adapters.openUserContext();
        } catch (error) {
            publish({phase: "blocked", blocked: "backend-unreachable", diagnosis: describeError(error), retryable: true});
            return;
        }
        if (opened.status !== "ready") {
            publish({
                phase: "blocked",
                blocked: opened.reason === "identity-unrecoverable" ? "identity-unrecoverable" : "backend-unreachable",
                diagnosis: opened.diagnosis,
                retryable: true,
            });
            return;
        }
        const session = opened.session;
        let handle: StorageOwnerHandle | null = null;
        let layoutHandle: StorageOwnerHandle | null = null;
        try {
            // 两个 owner 各自的句柄：备份边界由 `workbench.migration` 拥有，迁移目标由 `workbench.layout` 拥有，
            // 一个句柄只能访问自己 owner 的定义（owner-handle 在本地就拒绝跨 owner 访问）。
            handle = await adapters.openOwnerHandle({session, owner: WORKBENCH_MIGRATION_OWNER});
            layoutHandle = await adapters.openOwnerHandle({session, owner: WORKBENCH_LAYOUT_OWNER});
            const outcome = await runImport(handle, layoutHandle);
            if (outcome.kind === "complete") {
                publish({phase: "complete", blocked: null, diagnosis: null, retryable: false});
            } else {
                publish({
                    phase: "blocked",
                    blocked: outcome.reason,
                    diagnosis: outcome.diagnosis,
                    retryable: outcome.retryable,
                    backup: outcome.backupFailed ? "failed" : state.backup,
                });
            }
        } catch (error) {
            publish({
                phase: "blocked",
                blocked: error instanceof MigrationStepFailure ? error.reason : "backend-unreachable",
                diagnosis: describeError(error),
                retryable: true,
            });
        } finally {
            if (layoutHandle !== null) {
                await layoutHandle.release().catch(() => undefined);
            }
            if (handle !== null) {
                await handle.release().catch(() => undefined);
            }
            await adapters.closeContext(session).catch(() => undefined);
        }
    };

    async function runImport(handle: StorageOwnerHandle, layout: StorageOwnerHandle): Promise<ImportOutcome> {
        // 完成标记先读：读取失败不能被当作"尚未迁移"，否则会重复导入并覆盖用户之后的调整。
        const completionRead = await readStep(handle, completionState, undefined, "completion-unreadable");
        if (completionRead.kind === "failed") {
            return {kind: "blocked", reason: completionRead.reason, diagnosis: completionRead.diagnosis, retryable: true};
        }
        if (completionRead.result.kind === "unsupported-version" || completionRead.result.kind === "corrupt") {
            return {
                kind: "blocked",
                reason: "completion-unprotected",
                diagnosis: completionRead.result.diagnosis,
                retryable: false,
            };
        }
        if (completionRead.result.kind === "value") {
            const completion = completionRead.result.value as WorkbenchMigrationCompletionRecord;
            if (completion.source === WORKBENCH_MIGRATION_SOURCE && completion.version === WORKBENCH_MIGRATION_VERSION) {
                publish({}, completion.entries.map((entry) => ({
                    target: entry.target,
                    field: entry.field,
                    outcome: entry.outcome,
                    at: completion.completedAt,
                    revision: null,
                    diagnosis: null,
                })));
                return {kind: "complete"};
            }
            // 其它客户端或源版本不能改写完成标记；本版本只读取，不覆盖。
            return {
                kind: "blocked",
                reason: "completion-unprotected",
                diagnosis: "完成标记属于其它迁移版本或来源，本版本不读取也不覆盖",
                retryable: false,
            };
        }

        const progressRead = await readStep(handle, progressState, undefined, "progress-unreadable");
        if (progressRead.kind === "failed") {
            return {kind: "blocked", reason: progressRead.reason, diagnosis: progressRead.diagnosis, retryable: true};
        }
        if (progressRead.result.kind === "unsupported-version" || progressRead.result.kind === "corrupt") {
            return {kind: "blocked", reason: "progress-unprotected", diagnosis: progressRead.result.diagnosis, retryable: false};
        }
        const tracker = createProgressTracker(handle, progressState, now);
        if (progressRead.result.kind === "value") {
            const stored = progressRead.result.value as WorkbenchMigrationProgressRecord;
            if (stored.source !== WORKBENCH_MIGRATION_SOURCE || stored.version !== WORKBENCH_MIGRATION_VERSION) {
                // 其它客户端或源版本的进度不能当作本次迁移的进度续跑。
                return {
                    kind: "blocked",
                    reason: "progress-unprotected",
                    diagnosis: "进度属于其它迁移版本或来源，本版本不读取也不覆盖",
                    retryable: false,
                };
            }
            tracker.adopt(stored, progressRead.result.credential);
        } else {
            tracker.adopt({source: WORKBENCH_MIGRATION_SOURCE, version: WORKBENCH_MIGRATION_VERSION, updatedAt: "", entries: []}, progressRead.result.credential);
        }
        publish({}, tracker.entries());

        if (stagedOriginal !== null) {
            try {
                await ensureOriginalBackup(handle);
            } catch (error) {
                return {
                    kind: "blocked",
                    reason: "backup-failed",
                    diagnosis: describeError(error),
                    retryable: true,
                    backupFailed: true,
                };
            }
            publish({backup: "saved"});
        }

        for (const target of targets) {
            try {
                await importTarget(layout, target, tracker);
            } catch (error) {
                // 已确认写入的目标已经登记进度：失败保留源与进度，下次只续跑未完成项。
                publish({}, tracker.entries());
                return {
                    kind: "blocked",
                    reason: error instanceof MigrationStepFailure ? error.reason : "import-failed",
                    diagnosis: describeError(error),
                    retryable: true,
                };
            }
            publish({}, tracker.entries());
        }

        try {
            await writeCompletion(handle, tracker);
        } catch (error) {
            return {kind: "blocked", reason: "import-failed", diagnosis: describeError(error), retryable: true};
        }
        publish({}, tracker.entries());
        return {kind: "complete"};
    }

    /** 逐目标读取分类 → 条件初始化 → 登记进度；冲突后重读，绝不用源覆盖已有目标。 */
    async function importTarget(handle: StorageOwnerHandle, target: MigrationTarget, tracker: ProgressTracker): Promise<void> {
        const pending = target.fields.filter((field) => !tracker.has(target.id, field));
        if (pending.length === 0) {
            return;
        }
        const read = await handle.read(target.definition, target.resource === undefined ? {} : {resource: target.resource});
        const existing = classifyExistingTarget(read);
        if (existing !== null) {
            await tracker.record(pending.map((field) => entry(target, field, existing, now(), null, null)));
            return;
        }
        const composed = target.compose(sourceValues);
        const entries: WorkbenchMigrationTargetProgress[] = pending.map((field) => {
            const diagnosis = composed.invalid[field];
            if (diagnosis !== undefined) {
                return entry(target, field, "invalid-source", now(), null, diagnosis);
            }
            // 源里没有该字段：使用产品默认，不落盘；有合法值且本次记录缺失：随本次写入一起初始化。
            return Object.hasOwn(sourceValues, field)
                ? entry(target, field, "imported", now(), null, null)
                : entry(target, field, "source-missing", now(), null, null);
        });
        if (composed.value === null) {
            await tracker.record(entries);
            return;
        }
        let credential: StorageCredential;
        try {
            credential = await handle.save(target.definition, {
                expected: requireConditionalCredential(read),
                value: composed.value,
                ...(target.resource === undefined ? {} : {resource: target.resource}),
            });
        } catch (error) {
            if (!isRevisionConflict(error)) {
                throw error;
            }
            // 另一个标签页先写入了同一目标：按目标权威值记录，不覆盖，也不再重放本次初值。
            const reread = await handle.read(target.definition, target.resource === undefined ? {} : {resource: target.resource});
            const existingAfterConflict = classifyExistingTarget(reread) ?? "already-present";
            await tracker.record(pending.map((field) => entry(target, field, existingAfterConflict, now(), null, null)));
            return;
        }
        await tracker.record(entries.map((item) => (item.outcome === "imported" ? {...item, revision: credential.revision} : item)));
    }

    /** data 原件备份：先写块、最后写清单；写完立刻按摘要重新拼接核验。 */
    async function ensureOriginalBackup(handle: StorageOwnerHandle): Promise<void> {
        const original = stagedOriginal;
        if (original === null) {
            return;
        }
        const chunks = splitLegacyOriginalChunks(original.raw);
        const manifestRead = await handle.read(originalState);
        if (manifestRead.kind === "unsupported-version" || manifestRead.kind === "corrupt") {
            throw new MigrationStepFailure("backup-failed", `data 原件清单不可用：${manifestRead.diagnosis}`);
        }
        if (manifestRead.kind === "value") {
            const manifest = manifestRead.value as WorkbenchMigrationOriginalRecord;
            if (manifest.source !== WORKBENCH_MIGRATION_SOURCE || manifest.version !== WORKBENCH_MIGRATION_VERSION
                || manifest.digest !== original.digest || manifest.byteLength !== original.byteLength
                || manifest.chunkCount !== chunks.length || manifest.capturedAt !== original.capturedAt) {
                throw new MigrationStepFailure("backup-failed", "data 原件清单与浏览器暂存不一致，本版本不覆盖也不复用");
            }
            return;
        }
        for (const [index, text] of chunks.entries()) {
            await ensureBackupChunk(handle, index, text);
        }
        const manifest: WorkbenchMigrationOriginalRecord = {
            source: WORKBENCH_MIGRATION_SOURCE,
            version: WORKBENCH_MIGRATION_VERSION,
            capturedAt: original.capturedAt,
            byteLength: original.byteLength,
            digest: original.digest,
            chunkCount: chunks.length,
            chunkBytes: WORKBENCH_MIGRATION_CHUNK_BYTES,
        };
        try {
            await handle.save(originalState, {expected: requireConditionalCredential(manifestRead), value: manifest});
        } catch (error) {
            if (!isRevisionConflict(error)) {
                throw error;
            }
            const reread = await handle.read(originalState);
            if (reread.kind !== "value" || (reread.value as WorkbenchMigrationOriginalRecord).digest !== original.digest) {
                throw new MigrationStepFailure("backup-failed", "data 原件清单被其它标签页改写且内容不一致");
            }
            return;
        }
        await verifyOriginalBackup(handle, manifest);
    }

    async function ensureBackupChunk(handle: StorageOwnerHandle, index: number, text: string): Promise<void> {
        const resource = workbenchMigrationChunkResource(index);
        const read = await handle.read(chunkState, {resource});
        if (read.kind === "value") {
            if (read.value === text) {
                return;
            }
            // 自己写的块内容不符（截断等）：按读到的 revision 条件重写，仍保留诊断原件。
            await handle.save(chunkState, {expected: read.credential, value: text, resource});
            return;
        }
        if (read.kind === "unsupported-version" || read.kind === "corrupt") {
            await handle.repair(chunkState, {expected: read.repair, value: text, resource});
            return;
        }
        await handle.save(chunkState, {expected: read.credential, value: text, resource});
    }

    /** 核验备份：逐块读回拼接后与浏览器暂存的原件比较摘要与字节数。 */
    async function verifyOriginalBackup(handle: StorageOwnerHandle, manifest: WorkbenchMigrationOriginalRecord): Promise<void> {
        const parts: string[] = [];
        for (let index = 0; index < manifest.chunkCount; index += 1) {
            const resource = workbenchMigrationChunkResource(index);
            const read = await handle.read(chunkState, {resource});
            if (read.kind !== "value" || typeof read.value !== "string") {
                throw new MigrationStepFailure("backup-failed", `data 原件分块 ${resource} 写入后不可读`);
            }
            parts.push(read.value);
        }
        const joined = parts.join("");
        const measured = measureLegacyOriginal(joined);
        if (measured.byteLength !== manifest.byteLength || measured.digest !== manifest.digest) {
            throw new MigrationStepFailure("backup-failed", "data 原件备份回读核验失败，保留浏览器暂存与源字段");
        }
    }

    async function writeCompletion(handle: StorageOwnerHandle, tracker: ProgressTracker): Promise<void> {
        const read = await handle.read(completionState);
        if (read.kind === "value" || read.kind === "unsupported-version" || read.kind === "corrupt") {
            // 完成标记只写一次；已有标记（含其它版本或损坏）一律不改写。
            return;
        }
        const record: WorkbenchMigrationCompletionRecord = {
            source: WORKBENCH_MIGRATION_SOURCE,
            version: WORKBENCH_MIGRATION_VERSION,
            completedAt: now(),
            originalDigest: stagedOriginal?.digest ?? "",
            entries: tracker.entries().map((item) => ({target: item.target, field: item.field, outcome: item.outcome})),
        };
        try {
            await handle.save(completionState, {expected: requireConditionalCredential(read), value: record});
        } catch (error) {
            if (!isRevisionConflict(error)) {
                throw error;
            }
            // 另一个标签页已完成同一迁移：读取它的标记，不覆盖。
        }
    }

    async function readStep<T>(
        handle: StorageOwnerHandle,
        definition: DefinedStorageState<T>,
        resource: string | undefined,
        reason: StorageMigrationBlockReason,
    ): Promise<{readonly kind: "ok"; readonly result: StorageReadResult<T>} | {readonly kind: "failed"; readonly reason: StorageMigrationBlockReason; readonly diagnosis: string}> {
        try {
            return {kind: "ok", result: await handle.read(definition, resource === undefined ? {} : {resource})};
        } catch (error) {
            return {kind: "failed", reason, diagnosis: describeError(error)};
        }
    }

    return {
        staged: staged.promise,
        settled: settled.promise,
        start: run,
        retry: () => (state.phase === "complete" ? Promise.resolve(state) : run()),
        snapshot: () => state,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

type ImportOutcome =
    | {readonly kind: "complete"}
    | {
        readonly kind: "blocked";
        readonly reason: StorageMigrationBlockReason;
        readonly diagnosis: string;
        readonly retryable: boolean;
        readonly backupFailed?: boolean;
    };

type ProgressTracker = {
    readonly has: (target: string, field: WorkbenchMigrationFieldId) => boolean;
    readonly record: (entries: readonly WorkbenchMigrationTargetProgress[]) => Promise<void>;
    readonly adopt: (record: WorkbenchMigrationProgressRecord, credential: StorageCredential) => void;
    readonly entries: () => readonly WorkbenchMigrationTargetProgress[];
};

/** 进度登记：只增不改；另一个标签页并发写入时合并后只再提交一次。 */
function createProgressTracker(
    handle: StorageOwnerHandle,
    definition: DefinedStorageState<unknown>,
    now: () => string,
): ProgressTracker {
    const entries = new Map<string, WorkbenchMigrationTargetProgress>();
    const keyOf = (target: string, field: WorkbenchMigrationFieldId): string => `${target}\u0000${field}`;
    let credential: StorageCredential = {revision: null, partitionGeneration: 1};
    const list = (): readonly WorkbenchMigrationTargetProgress[] => [...entries.values()];
    const build = (): WorkbenchMigrationProgressRecord => ({
        source: WORKBENCH_MIGRATION_SOURCE,
        version: WORKBENCH_MIGRATION_VERSION,
        updatedAt: now(),
        entries: list(),
    });
    return {
        has: (target, field) => entries.has(keyOf(target, field)),
        adopt(record, next) {
            for (const item of record.entries) {
                entries.set(keyOf(item.target, item.field), item);
            }
            credential = next;
        },
        entries: list,
        async record(added) {
            for (const item of added) {
                entries.set(keyOf(item.target, item.field), item);
            }
            try {
                credential = await handle.save(definition, {expected: credential, value: build()});
                return;
            } catch (error) {
                if (!isRevisionConflict(error)) {
                    throw error;
                }
            }
            const reread = await handle.read(definition);
            if (reread.kind === "unsupported-version" || reread.kind === "corrupt") {
                throw new MigrationStepFailure("import-failed", `迁移进度无法登记：${reread.diagnosis}`);
            }
            if (reread.kind === "legacy-value") {
                throw new MigrationStepFailure("import-failed", "迁移进度记录版本低于当前定义，本版本不合并");
            }
            if (reread.kind === "value") {
                for (const item of (reread.value as WorkbenchMigrationProgressRecord).entries) {
                    const key = keyOf(item.target, item.field);
                    if (!entries.has(key)) {
                        entries.set(key, item);
                    }
                }
            }
            credential = reread.credential;
            credential = await handle.save(definition, {expected: credential, value: build()});
        },
    };
}

/** 产品目标表：同一合法旧值初始化两个已列出的显式 user 工作面；书架模式是 user/local 单例。 */
function productTargets(definitions: StorageMigrationOptions["definitions"]): readonly MigrationTarget[] {
    const surfaceSizes = (definitions?.surfaceSizes ?? defineWorkbenchSurfaceSizesState()) as DefinedStorageState<unknown>;
    const shelfMode = (definitions?.shelfMode ?? defineWorkbenchShelfModeState()) as unknown as DefinedStorageState<unknown>;
    return [
        ...WORKBENCH_SURFACE_IDS.map((surface): MigrationTarget => ({
            id: `surface:${surface}`,
            definition: surfaceSizes,
            resource: surface,
            fields: ["leftPanelWidth", "agentPanelWidth"],
            compose: composeSurfaceSizes,
        })),
        {
            id: "shelf-mode",
            definition: shelfMode,
            resource: undefined,
            fields: ["projectPickerLayoutMode"],
            compose: composeShelfMode,
        },
    ];
}

/** 目标缺失时按合法源字段合成尺寸初值；缺省字段不写默认值，非法字段只记诊断。 */
function composeSurfaceSizes(values: LegacyBucketFieldValues): MigrationComposition {
    const value: {leftPanelWidth?: number; agentPanelWidth?: number} = {};
    const invalid: Partial<Record<WorkbenchMigrationFieldId, string>> = {};
    for (const field of ["leftPanelWidth", "agentPanelWidth"] as const) {
        if (!Object.hasOwn(values, field)) {
            continue;
        }
        const candidate = values[field];
        if (isWorkbenchPanelWidth(candidate)) {
            value[field] = candidate;
        } else {
            invalid[field] = `源字段 ${field} 不是合法宽度：${describeValue(candidate)}`;
        }
    }
    return {value: Object.keys(value).length === 0 ? null : value, invalid};
}

function composeShelfMode(values: LegacyBucketFieldValues): MigrationComposition {
    if (!Object.hasOwn(values, "projectPickerLayoutMode")) {
        return {value: null, invalid: {}};
    }
    const candidate = values["projectPickerLayoutMode"];
    if (isWorkbenchShelfMode(candidate)) {
        return {value: candidate, invalid: {}};
    }
    return {
        value: null,
        invalid: {projectPickerLayoutMode: `源字段不是合法书架模式：${describeValue(candidate)}`},
    };
}

/** 已有目标的共同结论；`missing` 才允许条件初始化，`deleted` 是用户重置形成的墓碑。 */
function classifyExistingTarget(read: StorageReadResult<unknown>): ExistingTargetOutcome | null {
    switch (read.kind) {
        case "value":
        case "legacy-value":
            return "already-present";
        case "deleted":
            return "tombstoned";
        case "unsupported-version":
        case "corrupt":
            return "protected";
        case "missing":
            return null;
    }
}

function entry(
    target: MigrationTarget,
    field: WorkbenchMigrationFieldId,
    outcome: WorkbenchMigrationOutcome,
    at: string,
    revision: string | null,
    diagnosis: string | null,
): WorkbenchMigrationTargetProgress {
    return {target: target.id, field, outcome, at, revision, diagnosis};
}

/** 目标写入必须用读取返回的条件凭据；只有缺失/删除记录可以继续条件写。 */
function requireConditionalCredential(read: StorageReadResult<unknown>): StorageCredential {
    if (read.kind === "value" || read.kind === "legacy-value" || read.kind === "missing" || read.kind === "deleted") {
        return read.credential;
    }
    throw new MigrationStepFailure("import-failed", `记录不可写：${read.diagnosis}`);
}

function isRevisionConflict(error: unknown): error is StorageAdapterError {
    return isStorageAdapterError(error) && error.code === "STORAGE_REVISION_CONFLICT";
}

function mergeFieldReports(
    reports: readonly StorageMigrationFieldReport[],
    outcomes: readonly WorkbenchMigrationTargetProgress[],
): readonly StorageMigrationFieldReport[] {
    return reports.map((report) => {
        const matching = outcomes.filter((item) => item.field === report.field);
        if (matching.length === 0) {
            return report;
        }
        let best: WorkbenchMigrationTargetProgress | null = null;
        for (const item of matching) {
            if (best === null || OUTCOME_PRIORITY.indexOf(item.outcome) < OUTCOME_PRIORITY.indexOf(best.outcome)) {
                best = item;
            }
        }
        const diagnosis = matching.find((item) => item.diagnosis !== null)?.diagnosis ?? null;
        return {field: report.field, outcome: best?.outcome ?? report.outcome, diagnosis};
    });
}

function describeStagingFailure(reason: LegacyStagingFailureReason): string {
    switch (reason) {
        case "unavailable":
            return "浏览器暂存不可用";
        case "blocked":
            return "浏览器暂存被其它标签页阻塞";
        case "write-failed":
            return "浏览器暂存写入失败";
        case "read-failed":
            return "浏览器暂存读取失败";
        case "readback-mismatch":
            return "浏览器暂存回读核验失败";
        case "invalid-record":
            return "浏览器暂存记录无效";
        case "oversize":
            return "旧桶原件超过暂存上限";
        case "conflict":
            return "浏览器暂存属于其它迁移版本";
    }
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function describeValue(value: unknown): string {
    if (typeof value === "string") {
        return `"${value.length > 40 ? `${value.slice(0, 40)}…` : value}"`;
    }
    if (value === null) {
        return "null";
    }
    return typeof value;
}

let singleton: StorageMigrationController | null = null;

/** 启动接线与消费者共用的模块单例；第一次取用时建立，但不自动运行。 */
export function storageMigrationController(): StorageMigrationController {
    singleton ??= createStorageMigration();
    return singleton;
}

/** 当前迁移快照；供加载与"未保存"反馈读取，不触发运行。 */
export function storageMigrationSnapshot(): StorageMigrationSnapshot {
    return storageMigrationController().snapshot();
}

export function subscribeStorageMigration(listener: (snapshot: StorageMigrationSnapshot) => void): () => void {
    return storageMigrationController().subscribe(listener);
}
