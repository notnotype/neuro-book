import {afterEach, describe, expect, it} from "vitest";
import type {StorageActionRequest, StorageActionResponse} from "nbook/shared/storage/action";
import type {StorageCredential, StorageReadResult} from "nbook/shared/storage/contract";
import {
    WORKBENCH_MIGRATION_CHUNK_KEY,
    WORKBENCH_MIGRATION_COMPLETION_KEY,
    WORKBENCH_MIGRATION_ORIGINAL_KEY,
    WORKBENCH_MIGRATION_OWNER,
    WORKBENCH_MIGRATION_PROGRESS_KEY,
    workbenchMigrationChunkResource,
    type WorkbenchMigrationCompletionRecord,
    type WorkbenchMigrationOriginalRecord,
    type WorkbenchMigrationProgressRecord,
} from "nbook/shared/storage/workbench-migration";
import {
    WORKBENCH_LAYOUT_OWNER,
    WORKBENCH_SHELF_MODE_KEY,
    WORKBENCH_SURFACE_SIZES_KEY,
    type WorkbenchSurfaceSizes,
} from "nbook/shared/storage/workbench-state";
import {openStorageOwnerHandle} from "nbook/app/utils/storage/owner-handle";
import type {StorageUserContextOpenResult} from "nbook/app/utils/storage/host-context-client";
import {StorageAdapterError, type StorageValueTransport} from "nbook/app/utils/storage/value-transport";
import {
    createStorageMigration,
    type StorageMigrationAdapters,
    type StorageMigrationController,
} from "nbook/app/utils/workbench/storage-migration";
import {
    installLegacyBucketWriterPolicy,
    legacyBucketSerializer,
    legacyBucketWriterPolicy,
    measureLegacyOriginal,
    type LegacyBucketStaging,
    type LegacyStagingFailureReason,
    type LegacyStagingResult,
} from "nbook/app/utils/workbench/storage-migration-legacy-bucket";

const BUCKET = JSON.stringify({
    leftPanelWidth: 427,
    agentPanelWidth: 488,
    projectPickerLayoutMode: "compact",
    activeLeftTab: "outline",
});

type StoredRecord = {value: unknown; revision: string; schemaVersion: number; deleted: boolean};

type Harness = {
    readonly records: Map<string, StoredRecord>;
    readonly actions: StorageActionRequest[];
    readonly adapters: StorageMigrationAdapters;
    readonly saveCount: (owner: string, key: string, resource?: string) => number;
    readonly readCount: (owner: string, key: string, resource?: string) => number;
    seed(owner: string, key: string, value: unknown, options?: {resource?: string; schemaVersion?: number; deleted?: boolean}): void;
    setContextResult(result: StorageUserContextOpenResult): void;
    failNextSave(owner: string, key: string, times: number): void;
    throwNextRead(owner: string, key: string, times: number): void;
    /** 在真实条件写之前模拟另一个标签页先写入同一记录。 */
    raceBeforeSave(owner: string, key: string, value: unknown, options?: {resource?: string}): void;
    /** 挂起下一次匹配的读取；返回释放函数（用于制造"运行仍在途"的时序）。 */
    holdNextRead(owner: string, key: string): () => void;
};

const CLIENT_CREDENTIAL = "0".repeat(64);

function credential(revision: string | null): StorageCredential {
    return {revision, partitionGeneration: 1};
}

/** 内存记录存储 + 真实 owner adapter 的注入传输；条件写按 revision 冲突。 */
function createHarness(): Harness {
    const records = new Map<string, StoredRecord>();
    const actions: StorageActionRequest[] = [];
    const saves = new Map<string, number>();
    const reads = new Map<string, number>();
    const failures = new Map<string, number>();
    const readFailures = new Map<string, number>();
    const races = new Map<string, {value: unknown; resource?: string}>();
    const readGates = new Map<string, Promise<void>>();
    let sequence = 0;
    let contextResult: StorageUserContextOpenResult = {
        status: "ready",
        session: {scope: "user", contextId: "context".padEnd(64, "c"), clientCredential: CLIENT_CREDENTIAL},
    };
    const keyOf = (owner: string, key: string, resource?: string): string => `${owner}/${key}/${resource ?? ""}`;

    const transport: StorageValueTransport = {
        async send(action: StorageActionRequest): Promise<StorageActionResponse> {
            actions.push(action);
            if (action.kind === "bind") {
                return {kind: "bind", binding: {local: 1, shared: 1}};
            }
            const key = keyOf(action.owner, action.key, "resource" in action ? action.resource : undefined);
            if (action.kind === "read") {
                reads.set(key, (reads.get(key) ?? 0) + 1);
                const gate = readGates.get(key);
                if (gate !== undefined) {
                    readGates.delete(key);
                    await gate;
                }
                const remaining = readFailures.get(key) ?? 0;
                if (remaining > 0) {
                    readFailures.set(key, remaining - 1);
                    throw new StorageAdapterError({code: null, status: null, message: "注入的读取失败", committed: null});
                }
                return {kind: "read", result: readRecord(records.get(key))};
            }
            const race = races.get(key);
            if (race !== undefined) {
                races.delete(key);
                records.set(key, {value: race.value, revision: `r${String(++sequence)}`, schemaVersion: action.schemaVersion, deleted: false});
            }
            const pendingFailure = failures.get(key) ?? 0;
            if (pendingFailure > 0) {
                failures.set(key, pendingFailure - 1);
                throw new StorageAdapterError({code: null, status: 500, message: "注入的写入失败", committed: null});
            }
            if (action.kind === "save") {
                saves.set(key, (saves.get(key) ?? 0) + 1);
                const current = records.get(key);
                const currentRevision = current === undefined || current.deleted ? null : current.revision;
                if (currentRevision !== action.expected.revision) {
                    throw new StorageAdapterError({code: "STORAGE_REVISION_CONFLICT", status: 409, message: "记录已被其它窗口改写", committed: false});
                }
                const revision = `r${String(++sequence)}`;
                records.set(key, {value: action.value, revision, schemaVersion: action.schemaVersion, deleted: false});
                return {kind: "save", credential: credential(revision)};
            }
            if (action.kind === "repair") {
                saves.set(key, (saves.get(key) ?? 0) + 1);
                const revision = `r${String(++sequence)}`;
                records.set(key, {value: action.value, revision, schemaVersion: action.schemaVersion, deleted: false});
                return {kind: "repair", credential: credential(revision)};
            }
            throw new Error(`测试未实现动作：${action.kind}`);
        },
    };

    return {
        records,
        actions,
        adapters: {
            openUserContext: async () => contextResult,
            openOwnerHandle: (input) => openStorageOwnerHandle({
                ...input,
                transport,
                subscribe: {intervalMs: 60_000, maxBackoffMs: 120_000},
            }),
            closeContext: async () => undefined,
        },
        saveCount: (owner, key, resource) => saves.get(keyOf(owner, key, resource)) ?? 0,
        readCount: (owner, key, resource) => reads.get(keyOf(owner, key, resource)) ?? 0,
        seed(owner, key, value, options = {}) {
            records.set(keyOf(owner, key, options.resource), {
                value,
                revision: `r${String(++sequence)}`,
                schemaVersion: options.schemaVersion ?? 1,
                deleted: options.deleted ?? false,
            });
        },
        setContextResult(result) {
            contextResult = result;
        },
        failNextSave(owner, key, times) {
            failures.set(keyOf(owner, key), times);
        },
        throwNextRead(owner, key, times) {
            readFailures.set(keyOf(owner, key), times);
        },
        raceBeforeSave(owner, key, value, options = {}) {
            races.set(keyOf(owner, key, options.resource), {value});
        },
        holdNextRead(owner, key) {
            const {promise, resolve} = Promise.withResolvers<void>();
            readGates.set(keyOf(owner, key), promise);
            return resolve;
        },
    };
}

function readRecord(record: StoredRecord | undefined): StorageReadResult<unknown> {
    if (record === undefined) {
        return {kind: "missing", credential: credential(null)};
    }
    if (record.deleted) {
        return {kind: "deleted", credential: credential(record.revision)};
    }
    if (record.schemaVersion > 1) {
        return {
            kind: "unsupported-version",
            wrapperVersion: null,
            schemaVersion: record.schemaVersion,
            diagnosis: "记录版本高于当前支持版本",
            repair: {partitionGeneration: 1, contentFingerprint: "seed"},
        };
    }
    return {kind: "value", value: record.value, schemaVersion: record.schemaVersion, credential: credential(record.revision)};
}

type StagingStub = LegacyBucketStaging & {
    readonly state: {raw: string | null; failure: LegacyStagingFailureReason | null; calls: number};
};

/** 浏览器暂存替身：产品实现另行覆盖；这里只决定"暂存给出什么原件/什么失败"。 */
function stagingStub(raw: string | null, failure: LegacyStagingFailureReason | null = null): StagingStub {
    const state = {raw, failure, calls: 0};
    return {
        state,
        async ensure(): Promise<LegacyStagingResult> {
            state.calls += 1;
            if (state.failure !== null) {
                return {status: "failed", reason: state.failure, diagnosis: `注入的暂存失败：${state.failure}`};
            }
            if (state.raw === null) {
                return {status: "original", original: null};
            }
            const measured = measureLegacyOriginal(state.raw);
            return {
                status: "original",
                original: {
                    source: "novel.ide.local",
                    version: 1,
                    capturedAt: "2026-09-16T00:00:00.000Z",
                    byteLength: measured.byteLength,
                    digest: measured.digest,
                    raw: state.raw,
                },
            };
        },
    };
}

function controller(harness: Harness, staging: StagingStub): StorageMigrationController {
    return createStorageMigration({staging, adapters: harness.adapters, now: () => "2026-09-16T00:00:00.000Z"});
}

const surfaceKey = (surface: string): [string, string, string] => [WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_SIZES_KEY, surface];
const shelfRecord = (harness: Harness): string | undefined =>
    harness.records.get(`${WORKBENCH_LAYOUT_OWNER}/${WORKBENCH_SHELF_MODE_KEY}/`)?.value as string | undefined;
const surfaceValue = (harness: Harness, surface: string): WorkbenchSurfaceSizes | undefined =>
    harness.records.get(`${WORKBENCH_LAYOUT_OWNER}/${WORKBENCH_SURFACE_SIZES_KEY}/${surface}`)?.value as WorkbenchSurfaceSizes | undefined;
const progressRecord = (harness: Harness): WorkbenchMigrationProgressRecord | undefined =>
    harness.records.get(`${WORKBENCH_MIGRATION_OWNER}/${WORKBENCH_MIGRATION_PROGRESS_KEY}/`)?.value as WorkbenchMigrationProgressRecord | undefined;
const completionRecord = (harness: Harness): WorkbenchMigrationCompletionRecord | undefined =>
    harness.records.get(`${WORKBENCH_MIGRATION_OWNER}/${WORKBENCH_MIGRATION_COMPLETION_KEY}/`)?.value as WorkbenchMigrationCompletionRecord | undefined;

const chunkKey = (index: number): string => `${WORKBENCH_MIGRATION_OWNER}/${WORKBENCH_MIGRATION_CHUNK_KEY}/${workbenchMigrationChunkResource(index)}`;

const chunkText = (harness: Harness, index: number): string | undefined =>
    harness.records.get(chunkKey(index))?.value as string | undefined;

/** 模拟"另一个写入者（或磁盘损坏）改掉了备份分块"：保留记录、换一个 revision。 */
function corruptChunk(harness: Harness, index: number, value: string): void {
    harness.records.set(chunkKey(index), {value, revision: `corrupt-${String(index)}`, schemaVersion: 1, deleted: false});
}

function backupText(harness: Harness): string {
    const manifest = harness.records.get(`${WORKBENCH_MIGRATION_OWNER}/${WORKBENCH_MIGRATION_ORIGINAL_KEY}/`)?.value as WorkbenchMigrationOriginalRecord;
    const parts: string[] = [];
    for (let index = 0; index < manifest.chunkCount; index += 1) {
        parts.push(harness.records.get(`${WORKBENCH_MIGRATION_OWNER}/${WORKBENCH_MIGRATION_CHUNK_KEY}/${workbenchMigrationChunkResource(index)}`)?.value as string);
    }
    return parts.join("");
}

afterEach(() => {
    installLegacyBucketWriterPolicy({mode: "inactive"});
});

describe("迁移启动门禁", () => {
    it("暂存成功后固定三字段：未迁字段继续写回，源字段只写捕获值", async () => {
        const harness = createHarness();
        const staging = stagingStub(BUCKET);
        const migration = controller(harness, staging);

        await migration.start();

        expect(migration.snapshot()).toMatchObject({phase: "complete", blocked: null, backup: "saved", bucket: "pinned"});
        expect(staging.state.calls).toBe(1);
        expect(legacyBucketWriterPolicy()).toEqual({
            mode: "pinned",
            fields: {leftPanelWidth: 427, agentPanelWidth: 488, projectPickerLayoutMode: "compact"},
        });
        // 运行期的新尺寸与书架意图不回写源字段，未迁字段照旧保存。
        const written = legacyBucketSerializer.serialize({
            leftPanelWidth: 999,
            agentPanelWidth: 1000,
            projectPickerLayoutMode: "editorial",
            agentSessionPanelWidth: 300,
        });
        expect(JSON.parse(written)).toEqual({
            leftPanelWidth: 427,
            agentPanelWidth: 488,
            projectPickerLayoutMode: "compact",
            agentSessionPanelWidth: 300,
        });
    });

    it("暂存核验失败时冻结整桶并给出可重试状态，重试成功后恢复固定", async () => {
        const harness = createHarness();
        const staging = stagingStub(BUCKET, "readback-mismatch");
        const migration = controller(harness, staging);

        await migration.start();

        const blocked = migration.snapshot();
        expect(blocked).toMatchObject({phase: "blocked", blocked: "original-staging-failed", retryable: true, bucket: "locked"});
        expect(blocked.diagnosis).toContain("回读核验失败");
        expect(legacyBucketWriterPolicy().mode).toBe("locked");
        // 整桶冻结：没有原件就没有导入，也没有任何 data 访问。
        expect(harness.actions).toHaveLength(0);

        staging.state.failure = null;
        await migration.retry();

        expect(migration.snapshot()).toMatchObject({phase: "complete", bucket: "pinned", blocked: null});
        expect(legacyBucketWriterPolicy().mode).toBe("pinned");
    });

    it("后端不可达时保留暂存与源字段，未迁字段 writer 不受影响", async () => {
        const harness = createHarness();
        harness.setContextResult({status: "unavailable", reason: "backend-unreachable", diagnosis: "无法初始化 Storage 访问上下文", code: null, statusCode: null});
        const migration = controller(harness, stagingStub(BUCKET));

        await migration.start();

        expect(migration.snapshot()).toMatchObject({phase: "blocked", blocked: "backend-unreachable", retryable: true, bucket: "pinned"});
        expect(harness.actions).toHaveLength(0);
        expect(legacyBucketWriterPolicy().mode).toBe("pinned");
    });
});

describe("data 原件备份与逐项导入", () => {
    it("正常旧值：两个工作面与书架各自条件初始化，备份与进度/完成标记齐全", async () => {
        const harness = createHarness();
        const migration = controller(harness, stagingStub(BUCKET));

        await migration.start();

        expect(surfaceValue(harness, "idle")).toEqual({leftPanelWidth: 427, agentPanelWidth: 488});
        expect(surfaceValue(harness, "user-assets")).toEqual({leftPanelWidth: 427, agentPanelWidth: 488});
        expect(shelfRecord(harness)).toBe("compact");
        // 旧全局尺寸不复制给每个 Project：本次没有 project scope 访问。
        expect(harness.actions.some((action) => "owner" in action && action.owner === WORKBENCH_LAYOUT_OWNER && "key" in action && action.key === "layout")).toBe(false);

        expect(backupText(harness)).toBe(BUCKET);
        const manifest = harness.records.get(`${WORKBENCH_MIGRATION_OWNER}/${WORKBENCH_MIGRATION_ORIGINAL_KEY}/`)?.value as WorkbenchMigrationOriginalRecord;
        expect(manifest).toMatchObject({
            source: "novel.ide.local",
            version: 1,
            byteLength: measureLegacyOriginal(BUCKET).byteLength,
            digest: measureLegacyOriginal(BUCKET).digest,
            chunkCount: 1,
        });

        const progress = progressRecord(harness);
        expect(progress?.entries).toHaveLength(5);
        expect(progress?.entries.every((item) => item.outcome === "imported")).toBe(true);
        expect(migration.snapshot().fields.map((field) => field.outcome))
            .toEqual(["imported", "imported", "imported"]);
        expect(completionRecord(harness)).toMatchObject({source: "novel.ide.local", version: 1, entries: expect.any(Array)});
        expect(completionRecord(harness)?.entries).toHaveLength(5);
    });

    it("缺失字段使用产品默认且不落盘，完成标记仍登记", async () => {
        const harness = createHarness();
        const raw = JSON.stringify({leftPanelWidth: 512});
        const migration = controller(harness, stagingStub(raw));

        await migration.start();

        expect(surfaceValue(harness, "idle")).toEqual({leftPanelWidth: 512});
        expect(shelfRecord(harness)).toBeUndefined();
        expect(migration.snapshot()).toMatchObject({phase: "complete"});
        const outcomes = new Map(migration.snapshot().fields.map((field) => [field.field, field.outcome]));
        expect(outcomes.get("leftPanelWidth")).toBe("imported");
        expect(outcomes.get("agentPanelWidth")).toBe("source-missing");
        expect(outcomes.get("projectPickerLayoutMode")).toBe("source-missing");
    });

    it("完整旧 JSON 损坏时保留原始暂存、其它字段用默认并正常保存", async () => {
        const harness = createHarness();
        const raw = "{\"leftPanelWidth\":427,";
        const migration = controller(harness, stagingStub(raw));

        await migration.start();

        expect(migration.snapshot()).toMatchObject({phase: "complete", bucket: "pinned"});
        // 原始损坏串仍在浏览器暂存里（stagingStub 保留原文），data 备份也保存同一个原文。
        expect(backupText(harness)).toBe(raw);
        // 三字段按"原件不可解析 ⇒ 都缺失"固定：写回不会再产生这三个键。
        expect(JSON.parse(legacyBucketSerializer.serialize({leftPanelWidth: 999, agentSessionPanelWidth: 300})))
            .toEqual({agentSessionPanelWidth: 300});
        expect(migration.snapshot().fields.every((field) => field.outcome === "source-missing")).toBe(true);
    });

    it("非法字段只记诊断并保留原件，不写目标记录", async () => {
        const harness = createHarness();
        const raw = JSON.stringify({leftPanelWidth: "wide", agentPanelWidth: -5, projectPickerLayoutMode: "magazine"});
        const migration = controller(harness, stagingStub(raw));

        await migration.start();

        expect(migration.snapshot()).toMatchObject({phase: "complete"});
        expect(migration.snapshot().fields.every((field) => field.outcome === "invalid-source")).toBe(true);
        expect(migration.snapshot().fields.every((field) => (field.diagnosis ?? "").includes("不是合法"))).toBe(true);
        expect(harness.saveCount(...surfaceKey("idle"))).toBe(0);
        expect(harness.saveCount(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SHELF_MODE_KEY)).toBe(0);
        // "保留原件"：源字段的非法值原样留在旧桶里，不被默认值覆盖。
        expect(JSON.parse(legacyBucketSerializer.serialize({leftPanelWidth: "wide", agentPanelWidth: -5, projectPickerLayoutMode: "magazine"})))
            .toEqual({leftPanelWidth: "wide", agentPanelWidth: -5, projectPickerLayoutMode: "magazine"});
    });

    it("已有目标按目标权威值恢复，不用源覆盖", async () => {
        const harness = createHarness();
        harness.seed(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_SIZES_KEY, {leftPanelWidth: 300, agentPanelWidth: 320}, {resource: "idle"});
        const migration = controller(harness, stagingStub(BUCKET));

        await migration.start();

        expect(surfaceValue(harness, "idle")).toEqual({leftPanelWidth: 300, agentPanelWidth: 320});
        expect(harness.saveCount(...surfaceKey("idle"))).toBe(0);
        expect(surfaceValue(harness, "user-assets")).toEqual({leftPanelWidth: 427, agentPanelWidth: 488});
        const progress = progressRecord(harness);
        expect(progress?.entries.filter((item) => item.target === "surface:idle").map((item) => item.outcome))
            .toEqual(["already-present", "already-present"]);
    });

    it("墓碑目标（用户重置）不再重新导入", async () => {
        const harness = createHarness();
        harness.seed(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_SIZES_KEY, {leftPanelWidth: 300}, {resource: "user-assets", deleted: true});
        const migration = controller(harness, stagingStub(BUCKET));

        await migration.start();

        expect(harness.saveCount(...surfaceKey("user-assets"))).toBe(0);
        expect(harness.records.get(`${WORKBENCH_LAYOUT_OWNER}/${WORKBENCH_SURFACE_SIZES_KEY}/user-assets`)?.deleted).toBe(true);
        const progress = progressRecord(harness);
        expect(progress?.entries.filter((item) => item.target === "surface:user-assets").map((item) => item.outcome))
            .toEqual(["tombstoned", "tombstoned"]);
    });

    it("未知高版本目标保留原件、禁止普通保存", async () => {
        const harness = createHarness();
        harness.seed(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SHELF_MODE_KEY, "editorial", {schemaVersion: 2});
        const migration = controller(harness, stagingStub(BUCKET));

        await migration.start();

        expect(harness.saveCount(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SHELF_MODE_KEY)).toBe(0);
        expect(harness.records.get(`${WORKBENCH_LAYOUT_OWNER}/${WORKBENCH_SHELF_MODE_KEY}/`)?.value).toBe("editorial");
        expect(migration.snapshot().fields.find((field) => field.field === "projectPickerLayoutMode")?.outcome).toBe("protected");
    });
});

describe("中断续跑", () => {
    it("原件备份写入中断：保留暂存与源字段，重试后只补未完成项", async () => {
        const harness = createHarness();
        harness.failNextSave(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_ORIGINAL_KEY, 1);
        const staging = stagingStub(BUCKET);
        const migration = controller(harness, staging);

        await migration.start();

        expect(migration.snapshot()).toMatchObject({phase: "blocked", blocked: "backup-failed", retryable: true, backup: "failed"});
        expect(migration.snapshot().original?.digest).toBe(measureLegacyOriginal(BUCKET).digest);
        expect(harness.saveCount(...surfaceKey("idle"))).toBe(0);

        await migration.retry();

        expect(migration.snapshot()).toMatchObject({phase: "complete", backup: "saved"});
        expect(backupText(harness)).toBe(BUCKET);
        expect(surfaceValue(harness, "idle")).toEqual({leftPanelWidth: 427, agentPanelWidth: 488});
    });

    it("目标写入中断：已完成目标不重复写入，重试只续跑未完成项", async () => {
        const harness = createHarness();
        harness.failNextSave(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SHELF_MODE_KEY, 1);
        const migration = controller(harness, stagingStub(BUCKET));

        await migration.start();

        expect(migration.snapshot()).toMatchObject({phase: "blocked", blocked: "import-failed", retryable: true});
        expect(harness.saveCount(...surfaceKey("idle"))).toBe(1);
        expect(surfaceValue(harness, "idle")).toEqual({leftPanelWidth: 427, agentPanelWidth: 488});
        expect(shelfRecord(harness)).toBeUndefined();
        expect(progressRecord(harness)?.entries).toHaveLength(4);

        await migration.retry();

        expect(migration.snapshot()).toMatchObject({phase: "complete"});
        expect(shelfRecord(harness)).toBe("compact");
        expect(harness.saveCount(...surfaceKey("idle"))).toBe(1);
        expect(harness.saveCount(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SHELF_MODE_KEY)).toBe(1);
        expect(progressRecord(harness)?.entries).toHaveLength(5);
    });

    it("进度登记中断：目标只写入一次，重试按目标权威值补记进度", async () => {
        const harness = createHarness();
        harness.failNextSave(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_PROGRESS_KEY, 1);
        const migration = controller(harness, stagingStub(BUCKET));

        await migration.start();

        expect(migration.snapshot()).toMatchObject({phase: "blocked", blocked: "import-failed", retryable: true});
        expect(harness.saveCount(...surfaceKey("idle"))).toBe(1);
        expect(progressRecord(harness)).toBeUndefined();

        await migration.retry();

        expect(migration.snapshot()).toMatchObject({phase: "complete"});
        expect(harness.saveCount(...surfaceKey("idle"))).toBe(1);
        expect(progressRecord(harness)?.entries).toHaveLength(5);
        expect(progressRecord(harness)?.entries.filter((item) => item.target === "surface:idle").map((item) => item.outcome))
            .toEqual(["already-present", "already-present"]);
    });

    it("完成标记写入中断：全部目标已写入，重试只补完成标记", async () => {
        const harness = createHarness();
        harness.failNextSave(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_COMPLETION_KEY, 1);
        const migration = controller(harness, stagingStub(BUCKET));

        await migration.start();

        expect(migration.snapshot()).toMatchObject({phase: "blocked", blocked: "import-failed", retryable: true});
        expect(completionRecord(harness)).toBeUndefined();
        expect(progressRecord(harness)?.entries).toHaveLength(5);

        await migration.retry();

        expect(migration.snapshot()).toMatchObject({phase: "complete"});
        expect(completionRecord(harness)?.entries).toHaveLength(5);
        expect(harness.saveCount(...surfaceKey("idle"))).toBe(1);
        expect(harness.saveCount(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SHELF_MODE_KEY)).toBe(1);
    });
});

describe("原件的续跑核验与容量口径", () => {
    it("续跑读回既有分块并保持完整副本（只读不写）", async () => {
        const harness = createHarness();
        const raw = JSON.stringify({leftPanelWidth: 427, filler: "x".repeat(500_000)});
        const staging = stagingStub(raw);
        const first = controller(harness, staging);
        await first.start();
        expect(first.snapshot()).toMatchObject({phase: "complete", backup: "saved"});
        const chunkCount = (harness.records.get(`${WORKBENCH_MIGRATION_OWNER}/${WORKBENCH_MIGRATION_ORIGINAL_KEY}/`)?.value as WorkbenchMigrationOriginalRecord).chunkCount;
        expect(chunkCount).toBeGreaterThan(1);
        const readsBefore = harness.readCount(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_CHUNK_KEY, workbenchMigrationChunkResource(0));
        const writesBefore = harness.saveCount(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_CHUNK_KEY, workbenchMigrationChunkResource(0));

        // 新控制器 = 重启或新标签页：完成标记命中也要重新核验副本。
        const second = controller(harness, staging);
        await second.start();

        expect(second.snapshot()).toMatchObject({phase: "complete", blocked: null, backup: "saved"});
        expect(harness.readCount(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_CHUNK_KEY, workbenchMigrationChunkResource(0)))
            .toBeGreaterThan(readsBefore);
        expect(harness.saveCount(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_CHUNK_KEY, workbenchMigrationChunkResource(0)))
            .toBe(writesBefore);
        expect(backupText(harness)).toBe(raw);
    });

    it("续跑发现分块被截断/顺序错乱/缺块：按 backup-failed 阻断且不改写副本", async () => {
        const harness = createHarness();
        const raw = JSON.stringify({leftPanelWidth: 427, filler: "y".repeat(500_000)});
        const staging = stagingStub(raw);
        const first = controller(harness, staging);
        await first.start();
        const original = chunkText(harness, 0) ?? "";
        const next = chunkText(harness, 1) ?? "";
        expect(original.length).toBeGreaterThan(16);

        // 截断：内容变化 → 逐块比对直接指认。
        corruptChunk(harness, 0, original.slice(0, 16));
        const truncated = controller(harness, staging);
        await truncated.start();
        expect(truncated.snapshot()).toMatchObject({phase: "blocked", blocked: "backup-failed", retryable: true, backup: "failed"});
        expect(truncated.snapshot().diagnosis).toContain(workbenchMigrationChunkResource(0));
        expect(chunkText(harness, 0)).toBe(original.slice(0, 16));

        // 顺序错乱：把 chunk-001 的文本放进 chunk-000。
        corruptChunk(harness, 0, next);
        const swapped = controller(harness, staging);
        await swapped.start();
        expect(swapped.snapshot()).toMatchObject({phase: "blocked", blocked: "backup-failed"});
        expect(swapped.snapshot().diagnosis).toContain("顺序错乱");

        // 缺块：整条记录被回收。
        harness.records.delete(chunkKey(1));
        const missing = controller(harness, staging);
        await missing.start();
        expect(missing.snapshot()).toMatchObject({phase: "blocked", blocked: "backup-failed"});
        expect(missing.snapshot().diagnosis).toContain("记录缺失");
    });

    it("显式重试才从浏览器暂存重写不一致的分块并完成", async () => {
        const harness = createHarness();
        const raw = JSON.stringify({leftPanelWidth: 427, filler: "z".repeat(500_000)});
        const staging = stagingStub(raw);
        const first = controller(harness, staging);
        await first.start();
        const expected = chunkText(harness, 0) ?? "";
        corruptChunk(harness, 0, "broken");
        harness.records.delete(chunkKey(1));

        const migration = controller(harness, staging);
        await migration.start();
        expect(migration.snapshot()).toMatchObject({phase: "blocked", blocked: "backup-failed"});
        expect(chunkText(harness, 0)).toBe("broken");

        await migration.retry();

        expect(migration.snapshot()).toMatchObject({phase: "complete", blocked: null, backup: "saved"});
        expect(chunkText(harness, 0)).toBe(expected);
        expect(backupText(harness)).toBe(raw);
    });

    it("在途运行时到达的显式重试会等它收口后按修复模式继续", async () => {
        const harness = createHarness();
        const raw = JSON.stringify({leftPanelWidth: 427, filler: "q".repeat(500_000)});
        const staging = stagingStub(raw);
        const first = controller(harness, staging);
        await first.start();
        const expected = chunkText(harness, 0) ?? "";
        corruptChunk(harness, 0, "broken");

        const migration = controller(harness, staging);
        const release = harness.holdNextRead(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_COMPLETION_KEY);
        const auto = migration.start();
        const retried = migration.retry();
        release();
        await auto;
        // 自动路径先按"只报告不修复"收口。
        expect(migration.snapshot()).toMatchObject({phase: "blocked", blocked: "backup-failed"});
        expect(chunkText(harness, 0)).toBe("broken");

        await retried;

        expect(migration.snapshot()).toMatchObject({phase: "complete", blocked: null, backup: "saved"});
        expect(chunkText(harness, 0)).toBe(expected);
        expect(backupText(harness)).toBe(raw);
    });

    it("原件转义后超过备份分区容量：容量分类阻断、不写半份备份、重试不改变", async () => {
        const harness = createHarness();
        // 原文全是最需要转义的字符（每个 `"` 在记录文件里占两字节）：暂存接受，但备份分区放不下。
        const raw = '"'.repeat(5 * 1024 * 1024);
        const staging = stagingStub(raw);
        const migration = controller(harness, staging);

        await migration.start();

        expect(migration.snapshot()).toMatchObject({
            phase: "blocked",
            blocked: "backup-capacity-exceeded",
            retryable: false,
            backup: "failed",
            bucket: "pinned",
        });
        expect(migration.snapshot().diagnosis).toContain("超过备份分区声明");
        // 不写半份备份，也不冻结整桶：原件仍在浏览器暂存里，未迁字段 writer 不受影响。
        expect(harness.saveCount(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_CHUNK_KEY, workbenchMigrationChunkResource(0))).toBe(0);
        expect(harness.saveCount(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_ORIGINAL_KEY)).toBe(0);
        expect(legacyBucketWriterPolicy().mode).toBe("pinned");

        // 新的控制器（重启）得到同一分类：这不是瞬时故障，重试不会改变。
        const restarted = controller(harness, staging);
        await restarted.start();
        expect(restarted.snapshot()).toMatchObject({blocked: "backup-capacity-exceeded", retryable: false});
    });
});

describe("并发与身份", () => {
    it("另一标签页先写入同一目标时冲突后重读，不用源覆盖", async () => {
        const harness = createHarness();
        harness.raceBeforeSave(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_SIZES_KEY, {leftPanelWidth: 300, agentPanelWidth: 320}, {resource: "idle"});
        const migration = controller(harness, stagingStub(BUCKET));

        await migration.start();

        expect(migration.snapshot()).toMatchObject({phase: "complete"});
        expect(surfaceValue(harness, "idle")).toEqual({leftPanelWidth: 300, agentPanelWidth: 320});
        const progress = progressRecord(harness);
        expect(progress?.entries.filter((item) => item.target === "surface:idle").map((item) => item.outcome))
            .toEqual(["already-present", "already-present"]);
    });

    it("第二个标签页读取同一完成标记，不重复导入也不改写标记", async () => {
        const harness = createHarness();
        const staging = stagingStub(BUCKET);
        const first = controller(harness, staging);
        await first.start();
        const marker = harness.records.get(`${WORKBENCH_MIGRATION_OWNER}/${WORKBENCH_MIGRATION_COMPLETION_KEY}/`)?.value;

        const second = controller(harness, staging);
        await second.start();

        expect(second.snapshot()).toMatchObject({phase: "complete"});
        expect(harness.saveCount(...surfaceKey("idle"))).toBe(1);
        expect(harness.saveCount(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_COMPLETION_KEY)).toBe(1);
        expect(harness.records.get(`${WORKBENCH_MIGRATION_OWNER}/${WORKBENCH_MIGRATION_COMPLETION_KEY}/`)?.value).toBe(marker);
        expect(staging.state.calls).toBe(2);
    });

    it("身份不可持久恢复时不开始导入、不清源；恢复稳定身份后只导入一次", async () => {
        const harness = createHarness();
        const unavailable: StorageUserContextOpenResult = {
            status: "unavailable",
            reason: "identity-unrecoverable",
            diagnosis: "当前宿主不能持久保存客户端身份",
            code: null,
            statusCode: null,
        };
        harness.setContextResult(unavailable);
        const staging = stagingStub(BUCKET);
        const migration = controller(harness, staging);

        // 刷新两次：都不产生导入，也没有任何 data 访问。
        await migration.start();
        await migration.retry();
        expect(migration.snapshot()).toMatchObject({phase: "blocked", blocked: "identity-unrecoverable", retryable: true});
        expect(harness.actions).toHaveLength(0);
        expect(harness.saveCount(...surfaceKey("idle"))).toBe(0);
        expect(completionRecord(harness)).toBeUndefined();

        harness.setContextResult({
            status: "ready",
            session: {scope: "user", contextId: "context".padEnd(64, "c"), clientCredential: CLIENT_CREDENTIAL},
        });
        await migration.retry();
        expect(migration.snapshot()).toMatchObject({phase: "complete"});
        expect(harness.saveCount(...surfaceKey("idle"))).toBe(1);

        // 之后即使再次运行（新控制器 = 重启），完成标记让本次迁移不再重新导入。
        const restarted = controller(harness, staging);
        await restarted.start();
        expect(restarted.snapshot()).toMatchObject({phase: "complete"});
        expect(harness.saveCount(...surfaceKey("idle"))).toBe(1);
    });

    it("完成后目标被重置并回收墓碑，旧值也不会重新迁入", async () => {
        const harness = createHarness();
        const staging = stagingStub(BUCKET);
        const migration = controller(harness, staging);
        await migration.start();
        expect(harness.saveCount(...surfaceKey("idle"))).toBe(1);

        // 用户重置形成墓碑，随后按 owner 维护回收墓碑（记录回到"从未创建"）。
        harness.seed(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_SIZES_KEY, undefined, {resource: "idle", deleted: true});
        harness.records.delete(`${WORKBENCH_LAYOUT_OWNER}/${WORKBENCH_SURFACE_SIZES_KEY}/idle`);

        // 新控制器 = 重启/新标签页：走真正的续跑路径，而不是完成态下的空 retry()。
        const restarted = controller(harness, staging);
        await restarted.start();

        expect(harness.saveCount(...surfaceKey("idle"))).toBe(1);
        expect(surfaceValue(harness, "idle")).toBeUndefined();
        expect(restarted.snapshot()).toMatchObject({phase: "complete"});
    });

    it("完成标记读取失败不得当作尚未迁移", async () => {
        const harness = createHarness();
        harness.throwNextRead(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_COMPLETION_KEY, 1);
        const migration = controller(harness, stagingStub(BUCKET));

        await migration.start();

        expect(migration.snapshot()).toMatchObject({phase: "blocked", blocked: "completion-unreadable", retryable: true});
        expect(harness.readCount(...surfaceKey("idle"))).toBe(0);
        expect(harness.saveCount(...surfaceKey("idle"))).toBe(0);

        await migration.retry();
        expect(migration.snapshot()).toMatchObject({phase: "complete"});
    });

    it("进度元数据读取失败不得继续按未迁移处理", async () => {
        const harness = createHarness();
        harness.throwNextRead(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_PROGRESS_KEY, 1);
        const migration = controller(harness, stagingStub(BUCKET));

        await migration.start();

        expect(migration.snapshot()).toMatchObject({phase: "blocked", blocked: "progress-unreadable", retryable: true});
        expect(harness.saveCount(...surfaceKey("idle"))).toBe(0);
    });

    it("完成标记属于其它版本时不改写也不当作已完成", async () => {
        const harness = createHarness();
        harness.seed(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_COMPLETION_KEY, {
            source: "novel.ide.local",
            version: 99,
            completedAt: "2026-01-01T00:00:00.000Z",
            originalDigest: "other",
            entries: [],
        });
        const marker = harness.records.get(`${WORKBENCH_MIGRATION_OWNER}/${WORKBENCH_MIGRATION_COMPLETION_KEY}/`)?.value;
        const migration = controller(harness, stagingStub(BUCKET));

        await migration.start();

        expect(migration.snapshot()).toMatchObject({phase: "blocked", blocked: "completion-unprotected", retryable: false});
        expect(harness.records.get(`${WORKBENCH_MIGRATION_OWNER}/${WORKBENCH_MIGRATION_COMPLETION_KEY}/`)?.value).toBe(marker);
        expect(harness.saveCount(...surfaceKey("idle"))).toBe(0);
    });

    it("暂存失败与后端不可达、身份不可恢复互相可区分", async () => {
        const stagingFailure = createHarness();
        const frozen = controller(stagingFailure, stagingStub(BUCKET, "unavailable"));
        await frozen.start();
        expect(frozen.snapshot().blocked).toBe("original-staging-failed");

        const backend = createHarness();
        backend.setContextResult({status: "unavailable", reason: "backend-unreachable", diagnosis: "后端不可达", code: null, statusCode: null});
        const unreachable = controller(backend, stagingStub(BUCKET));
        await unreachable.start();
        expect(unreachable.snapshot().blocked).toBe("backend-unreachable");

        const identity = createHarness();
        identity.setContextResult({status: "unavailable", reason: "identity-unrecoverable", diagnosis: "身份不可恢复", code: null, statusCode: null});
        const unrecoverable = controller(identity, stagingStub(BUCKET));
        await unrecoverable.start();
        expect(unrecoverable.snapshot().blocked).toBe("identity-unrecoverable");
    });
});
