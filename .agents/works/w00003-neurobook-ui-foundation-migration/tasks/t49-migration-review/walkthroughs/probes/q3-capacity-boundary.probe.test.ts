/**
 * 探针 5（Q3 边界，R3 追加复核）——试图证伪的声明：
 * "容量口径闭合：写入前按记录文件字节预检，放不进声明分区的原件给 backup-capacity-exceeded（retryable:false）、
 *  不写半份备份、不冻结整桶；估算函数是不小于真实记录文件字节的上界，常规 8 MiB 原件仍落在 9 MiB 声明内。"
 *
 * 三条独立证据：
 *  1. 估算上界差分：对一批含转义/代理对/控制字符的值，比较 `estimateWorkbenchMigrationRecordBytes` 与
 *     产品自己的 `serializeStorageRecord` 真实字节；
 *  2. 真实闭合：在真实隔离根上跑一份**接近上限的常规旧桶**，比对"投影 ≤ 声明分区"与"磁盘实际记录字节 ≤ 9 MiB"；
 *  3. 超容原件：真实宿主上的分类、可重试性、"不写半份"与"不冻结整桶"。
 */
import {describe, expect, it} from "vitest";
import type {StorageJsonValue} from "nbook/shared/storage/bounded-json";
import {STORAGE_MAX_VALUE_BYTES} from "nbook/shared/storage/contract";
import {
    WORKBENCH_MIGRATION_CHUNK_BYTES,
    WORKBENCH_MIGRATION_METADATA_RESERVE_BYTES,
    WORKBENCH_MIGRATION_ORIGINAL_KEY,
    WORKBENCH_MIGRATION_ORIGINAL_LIMIT_BYTES,
    WORKBENCH_MIGRATION_OWNER,
    WORKBENCH_MIGRATION_PARTITION_BYTES,
    WORKBENCH_MIGRATION_CHUNK_KEY,
    estimateWorkbenchMigrationRecordBytes,
    type WorkbenchMigrationOriginalRecord,
} from "nbook/shared/storage/workbench-migration";
import {serializeStorageRecord} from "nbook/server/storage/record-codec";
import {
    LEGACY_BUCKET_ORIGINAL_LIMIT_BYTES,
    legacyBucketWriterPolicy,
    measureLegacyOriginal,
    splitLegacyOriginalChunks,
} from "nbook/app/utils/workbench/storage-migration-legacy-bucket";
import {createMigrationHarness} from "./probe-harness";

/** 产品自己的记录编码器算出的记录文件字节数。 */
function recordFileBytes(value: StorageJsonValue): number {
    return Buffer.byteLength(serializeStorageRecord({
        kind: "value",
        revision: "0".repeat(36),
        schemaVersion: 1,
        value,
    }), "utf8");
}

/** 备份投影：与 `assertBackupFitsPartition` 同一口径。 */
function projectedBackupBytes(raw: string): number {
    const chunks = splitLegacyOriginalChunks(raw, WORKBENCH_MIGRATION_CHUNK_BYTES);
    const manifest: WorkbenchMigrationOriginalRecord = {
        source: "novel.ide.local",
        version: 1,
        capturedAt: "2026-09-16T00:00:00.000Z",
        byteLength: measureLegacyOriginal(raw).byteLength,
        digest: measureLegacyOriginal(raw).digest,
        chunkCount: chunks.length,
        chunkBytes: WORKBENCH_MIGRATION_CHUNK_BYTES,
    };
    return WORKBENCH_MIGRATION_METADATA_RESERVE_BYTES
        + estimateWorkbenchMigrationRecordBytes(manifest)
        + chunks.reduce((total, chunk) => total + estimateWorkbenchMigrationRecordBytes(chunk), 0);
}

describe("探针 5：容量口径与估算上界（R3）", () => {
    it("估算值不小于真实记录文件字节（含转义、代理对、控制字符）", () => {
        const samples: StorageJsonValue[] = [
            "",
            "plain ascii",
            "\"".repeat(10_000),
            "\\\\".repeat(10_000),
            "\u0001\u0002\u0003\u007f".repeat(5_000),
            "\n\t\r".repeat(5_000),
            "\ud800".repeat(2_000),
            "😀中文混排 mixed".repeat(5_000),
            "\"]}\\{\\\"quote-heavy".repeat(5_000),
            {leftPanelWidth: 427, agentPanelWidth: 488, nested: {filler: "\"x\"".repeat(2_000)}},
            0,
            null,
            false,
            ["a".repeat(1_000), "b".repeat(1_000)],
        ];
        for (const sample of samples) {
            const actual = recordFileBytes(sample);
            const estimated = estimateWorkbenchMigrationRecordBytes(sample);
            expect({actual, estimated, ok: estimated >= actual}).toMatchObject({ok: true});
        }
    });

    it("常规 8 MiB 级旧桶：投影与磁盘实际都在 9 MiB 声明内，迁移走完并核验通过", async () => {
        // 常规配置文本 + 约 6% 转义字符（引号/反斜杠在记录文件里会翻倍）。
        const filler = ("a".repeat(16) + "\"" + "b".repeat(16) + "\\").repeat(218_000);
        const raw = JSON.stringify({
            leftPanelWidth: 427,
            agentPanelWidth: 488,
            projectPickerLayoutMode: "compact",
            activeLeftTab: "outline",
            markdownEditorPreferences: {filler},
        });
        const byteLength = measureLegacyOriginal(raw).byteLength;
        expect(byteLength).toBeGreaterThan(WORKBENCH_MIGRATION_ORIGINAL_LIMIT_BYTES * 0.85);
        expect(byteLength).toBeLessThanOrEqual(LEGACY_BUCKET_ORIGINAL_LIMIT_BYTES);
        const chunks = splitLegacyOriginalChunks(raw, WORKBENCH_MIGRATION_CHUNK_BYTES);
        expect(chunks.length).toBeGreaterThan(10);
        expect(chunks.every((chunk) => recordFileBytes(chunk) <= STORAGE_MAX_VALUE_BYTES)).toBe(true);

        const projected = projectedBackupBytes(raw);
        expect(projected).toBeLessThanOrEqual(WORKBENCH_MIGRATION_PARTITION_BYTES);

        const harness = await createMigrationHarness();
        try {
            const migration = harness.controller(raw);
            await migration.start();
            expect(migration.snapshot()).toMatchObject({phase: "complete", blocked: null, backup: "saved"});

            // 磁盘上的真实记录字节：既不越声明分区，也不超过投影（投影是上界）。
            const actual = await harness.partitionRecordBytes(WORKBENCH_MIGRATION_OWNER);
            expect(actual).toBeLessThanOrEqual(WORKBENCH_MIGRATION_PARTITION_BYTES);
            expect(actual).toBeLessThanOrEqual(projected);

            // 分块拼回原件（含多字节字符跨块）。
            const parts: string[] = [];
            for (let index = 0; index < chunks.length; index += 1) {
                const read = await harness.read(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_CHUNK_KEY, `chunk-${String(index).padStart(3, "0")}`);
                expect(read.kind).toBe("value");
                parts.push(read.value as string);
            }
            expect(parts.join("")).toBe(raw);
            expect(await harness.recordText(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_ORIGINAL_KEY)).not.toBeNull();
        } finally {
            await harness.close();
        }
    });

    it("超容原件：容量分类、不可重试、不写半份、不冻结整桶", async () => {
        const harness = await createMigrationHarness();
        try {
            // 暂存接受（UTF-8 字节在上限内），但记录文件口径放不进声明分区。
            const raw = "\"".repeat(5 * 1024 * 1024);
            expect(measureLegacyOriginal(raw).byteLength).toBe(5 * 1024 * 1024);
            expect(projectedBackupBytes(raw)).toBeGreaterThan(WORKBENCH_MIGRATION_PARTITION_BYTES);

            const mark = harness.mark();
            const migration = harness.controller(raw);
            await migration.start();

            expect(migration.snapshot()).toMatchObject({
                phase: "blocked",
                blocked: "backup-capacity-exceeded",
                retryable: false,
                backup: "failed",
                bucket: "pinned",
            });
            expect(migration.snapshot().diagnosis).toContain("超过备份分区声明");

            // 不写半份备份：备份边界上一个写动作都没有。
            const writes = harness.writesSince(mark).filter((item) => item.owner === WORKBENCH_MIGRATION_OWNER);
            expect(writes).toEqual([]);
            // 不冻结整桶：未迁字段 writer 继续工作（原件仍在浏览器暂存）。
            expect(legacyBucketWriterPolicy().mode).toBe("pinned");

            // 重启与显式重试都得到同一分类，且仍不写：这不是瞬时故障。
            const restarted = harness.controller(raw);
            await restarted.start();
            expect(restarted.snapshot()).toMatchObject({blocked: "backup-capacity-exceeded", retryable: false});
            const retryMark = harness.mark();
            await restarted.retry();
            expect(restarted.snapshot()).toMatchObject({blocked: "backup-capacity-exceeded", retryable: false});
            expect(harness.writesSince(retryMark).filter((item) => item.owner === WORKBENCH_MIGRATION_OWNER)).toEqual([]);
        } finally {
            await harness.close();
        }
    });
});
