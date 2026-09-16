/**
 * 探针 2（Q3，R1 追加复核）——试图证伪的声明：
 * "续跑（含完成标记命中）必须读回既有分块核验原件副本；自动路径发现不一致按 backup-failed 阻断且不改写副本；
 *  只有显式 retry() 才从浏览器暂存重写不一致分块；清单缺失且迁移未完成时仍自动续跑补写。"
 *
 * 做法：真实隔离根 + 真实 HTTP，每次"重启"都是新建的迁移控制器；损坏用**产品的写/删动作**制造。
 * 断言不只看最终字节，更看"这次运行对备份边界做了什么动作"（读=核验，写=改写副本）。
 */
import {writeFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";
import {
    WORKBENCH_MIGRATION_CHUNK_KEY,
    WORKBENCH_MIGRATION_COMPLETION_KEY,
    WORKBENCH_MIGRATION_ORIGINAL_KEY,
    WORKBENCH_MIGRATION_OWNER,
    workbenchMigrationChunkResource,
} from "nbook/shared/storage/workbench-migration";
import {measureLegacyOriginal, splitLegacyOriginalChunks} from "nbook/app/utils/workbench/storage-migration-legacy-bucket";
import {createMigrationHarness, type MigrationHarness} from "./probe-harness";

/** 约 1.8 MiB 的合法旧桶 JSON：切成多块，块内容各不相同，含中文与 emoji。 */
const BUCKET = JSON.stringify({
    leftPanelWidth: 427,
    agentPanelWidth: 488,
    projectPickerLayoutMode: "compact",
    activeLeftTab: "outline",
    filler: "filler-段-😀".repeat(120_000),
});

const CHUNK_BYTES = 384 * 1024;

async function chunkText(harness: MigrationHarness, index: number): Promise<string | null> {
    const read = await harness.read(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_CHUNK_KEY, workbenchMigrationChunkResource(index));
    return read.kind === "value" ? read.value as string : null;
}

async function joinedBackup(harness: MigrationHarness, chunkCount: number): Promise<string> {
    const parts: string[] = [];
    for (let index = 0; index < chunkCount; index += 1) {
        parts.push((await chunkText(harness, index)) ?? "<缺块>");
    }
    return parts.join("");
}

/** 备份边界上的动作：读=核验，写=改写副本。 */
function backupActionsSince(harness: MigrationHarness, mark: number): readonly string[] {
    return harness.actions
        .slice(mark)
        .filter((item) => item.owner === WORKBENCH_MIGRATION_OWNER
            && (item.key === WORKBENCH_MIGRATION_ORIGINAL_KEY || item.key === WORKBENCH_MIGRATION_CHUNK_KEY))
        .map((item) => `${item.kind}:${item.key}/${item.resource ?? ""}`);
}

async function overwriteChunk(harness: MigrationHarness, index: number, text: string): Promise<void> {
    const resource = workbenchMigrationChunkResource(index);
    const read = await harness.read(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_CHUNK_KEY, resource);
    if (read.kind !== "value") throw new Error(`块 ${resource} 不是值记录：${read.kind}`);
    await harness.act({
        kind: "save",
        owner: WORKBENCH_MIGRATION_OWNER,
        key: WORKBENCH_MIGRATION_CHUNK_KEY,
        resource,
        schemaVersion: 1,
        expected: read.credential,
        value: text,
    });
}

/** 直接把记录文件写成不可解析内容：模拟磁盘损坏（产品的写动作会校验值，写不进坏值）。 */
async function corruptChunkFile(harness: MigrationHarness, index: number): Promise<void> {
    const target = await harness.recordPath(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_CHUNK_KEY, workbenchMigrationChunkResource(index));
    await writeFile(target, "{ not a storage record\n", "utf8");
}

async function dropRecord(harness: MigrationHarness, key: string, resource?: string): Promise<void> {
    const read = await harness.read(WORKBENCH_MIGRATION_OWNER, key, resource);
    await harness.act({
        kind: "remove", owner: WORKBENCH_MIGRATION_OWNER, key,
        ...(resource === undefined ? {} : {resource}), schemaVersion: 1, expected: read.credential,
    });
    await harness.act({
        kind: "reclaim", owner: WORKBENCH_MIGRATION_OWNER, key,
        ...(resource === undefined ? {} : {resource}), schemaVersion: 1,
        targets: [resource === undefined ? {} : {resource}],
    });
}

describe("探针 2：续跑核验与显式修复（R1）", () => {
    it("续跑只读核验；截断/错序/缺块/墓碑按 backup-failed 阻断且不改写；显式 retry() 才修复", async () => {
        const harness = await createMigrationHarness();
        try {
            const chunks = splitLegacyOriginalChunks(BUCKET, CHUNK_BYTES);
            expect(chunks.length).toBeGreaterThanOrEqual(3);

            const first = harness.controller(BUCKET);
            await first.start();
            expect(first.snapshot()).toMatchObject({phase: "complete", backup: "saved"});
            expect(await joinedBackup(harness, chunks.length)).toBe(BUCKET);

            // 完成标记存在时的重启：必须**读**分块核验（这是 R1 的核心），且**不写**任何东西。
            const healthyMark = harness.mark();
            const healthy = harness.controller(BUCKET);
            await healthy.start();
            expect(healthy.snapshot()).toMatchObject({phase: "complete", blocked: null, backup: "saved"});
            const healthyActions = backupActionsSince(harness, healthyMark);
            expect(healthyActions.filter((item) => item.startsWith("read:"))).toContain(`read:${WORKBENCH_MIGRATION_CHUNK_KEY}/chunk-000`);
            expect(healthyActions.filter((item) => !item.startsWith("read:"))).toEqual([]);

            // 四类损坏 × 自动路径：必须阻断、必须不改写。
            const damaged: readonly {
                readonly label: string;
                readonly apply: () => Promise<void>;
                readonly expectUnchanged: () => Promise<void>;
                readonly expectDiagnosis: string;
            }[] = [
                {
                    label: "截断",
                    expectDiagnosis: "chunk-000",
                    apply: async () => { await overwriteChunk(harness, 0, chunks[0]!.slice(0, 16)); },
                    expectUnchanged: async () => expect(await chunkText(harness, 0)).toBe(chunks[0]!.slice(0, 16)),
                },
                {
                    label: "顺序错乱",
                    expectDiagnosis: "顺序错乱",
                    apply: async () => { await overwriteChunk(harness, 0, chunks[1]!); },
                    expectUnchanged: async () => expect(await chunkText(harness, 0)).toBe(chunks[1]!),
                },
                {
                    label: "缺块",
                    expectDiagnosis: "chunk-002",
                    apply: async () => { await dropRecord(harness, WORKBENCH_MIGRATION_CHUNK_KEY, workbenchMigrationChunkResource(2)); },
                    expectUnchanged: async () => expect(await chunkText(harness, 2)).toBeNull(),
                },
                {
                    label: "记录损坏（磁盘内容不可解析）",
                    expectDiagnosis: "chunk-000",
                    apply: async () => { await corruptChunkFile(harness, 0); },
                    expectUnchanged: async () => {
                        const read = await harness.read(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_CHUNK_KEY, workbenchMigrationChunkResource(0));
                        expect(read.kind).toBe("corrupt");
                    },
                },
                {
                    label: "墓碑（删除标记）",
                    expectDiagnosis: "chunk-001",
                    apply: async () => {
                        const read = await harness.read(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_CHUNK_KEY, workbenchMigrationChunkResource(1));
                        await harness.act({
                            kind: "remove", owner: WORKBENCH_MIGRATION_OWNER, key: WORKBENCH_MIGRATION_CHUNK_KEY,
                            resource: workbenchMigrationChunkResource(1), schemaVersion: 1, expected: read.credential,
                        });
                    },
                    expectUnchanged: async () => {
                        const read = await harness.read(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_CHUNK_KEY, workbenchMigrationChunkResource(1));
                        expect(read.kind).toBe("deleted");
                    },
                },
            ];

            for (const damage of damaged) {
                await damage.apply();
                const mark = harness.mark();
                const run = harness.controller(BUCKET);
                await run.start();

                const snapshot = run.snapshot();
                expect(`${damage.label}:${snapshot.phase}:${String(snapshot.blocked)}`).toBe(`${damage.label}:blocked:backup-failed`);
                expect(snapshot.retryable).toBe(true);
                expect(snapshot.diagnosis ?? "").toContain(damage.expectDiagnosis);
                // 自动路径不改写副本：备份边界上不能出现任何写动作。
                expect(backupActionsSince(harness, mark).filter((item) => !item.startsWith("read:"))).toEqual([]);
                await damage.expectUnchanged();
            }

            // 显式 retry()（用户选择的修复动作）：重写不一致分块并重新核验。
            const repaired = harness.controller(BUCKET);
            await repaired.start();
            expect(repaired.snapshot()).toMatchObject({phase: "blocked", blocked: "backup-failed"});
            const repairMark = harness.mark();
            await repaired.retry();

            expect(repaired.snapshot()).toMatchObject({phase: "complete", blocked: null, backup: "saved"});
            expect(backupActionsSince(harness, repairMark).filter((item) => !item.startsWith("read:")).length).toBeGreaterThan(0);
            expect(await joinedBackup(harness, chunks.length)).toBe(BUCKET);
            expect(measureLegacyOriginal(await joinedBackup(harness, chunks.length)).digest).toBe(measureLegacyOriginal(BUCKET).digest);
        } finally {
            await harness.close();
        }
    });

    it("在途运行中到达的一次 retry() 会等它收口后按修复模式跑（且只修一次）", async () => {
        const harness = await createMigrationHarness();
        try {
            const raw = JSON.stringify({leftPanelWidth: 427, filler: "q".repeat(600_000)});
            const chunks = splitLegacyOriginalChunks(raw, CHUNK_BYTES);
            const first = harness.controller(raw);
            await first.start();
            await overwriteChunk(harness, 0, "broken");
            const damageMark = harness.mark();

            // 用读取闸门把自动运行卡在"在途"状态：此时派发一次 retry()，模拟用户的一次点击。
            const migration = harness.controller(raw);
            const release = harness.holdNextRead(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_COMPLETION_KEY);
            const auto = migration.start();
            const retried = migration.retry();
            release();
            await auto;

            // 自动路径先按"只报告不修复"收口，副本仍是坏的。
            expect(migration.snapshot()).toMatchObject({phase: "blocked", blocked: "backup-failed"});
            expect(await chunkText(harness, 0)).toBe("broken");

            await retried;

            expect(migration.snapshot()).toMatchObject({phase: "complete", blocked: null, backup: "saved"});
            expect(await chunkText(harness, 0)).toBe(chunks[0]);
            expect(await joinedBackup(harness, chunks.length)).toBe(raw);
            // 只修一次：损坏之后 chunk-000 上的写动作恰好 1 次（这一点击既没被当成重复调用丢掉，也没跑两遍）。
            expect(harness.writesSince(damageMark).filter((item) => item.owner === WORKBENCH_MIGRATION_OWNER
                && item.key === WORKBENCH_MIGRATION_CHUNK_KEY && item.resource === "chunk-000")).toHaveLength(1);
            expect(harness.count("save", WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_COMPLETION_KEY)).toBe(1);
        } finally {
            await harness.close();
        }
    });

    it("清单缺失：未完成时自动续跑补写，已完成时不重建且如实报 none", async () => {
        const harness = await createMigrationHarness();
        try {
            j: {
                // 未完成路径：清单写入失败 ⇒ 块已写、清单缺失、无完成标记。
                const raw = JSON.stringify({leftPanelWidth: 427, filler: "auto".repeat(200_000)});
                const chunkCount = splitLegacyOriginalChunks(raw, CHUNK_BYTES).length;
                harness.failNextSave({owner: WORKBENCH_MIGRATION_OWNER, key: WORKBENCH_MIGRATION_ORIGINAL_KEY, times: 1});
                const interrupted = harness.controller(raw);
                await interrupted.start();
                expect(interrupted.snapshot()).toMatchObject({phase: "blocked", blocked: "backup-failed"});
                expect(await harness.recordText(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_ORIGINAL_KEY)).toBeNull();

                // 重启（新控制器）应当**自动**续跑补齐，不需要显式 retry。
                const resumed = harness.controller(raw);
                await resumed.start();
                expect(resumed.snapshot()).toMatchObject({phase: "complete", blocked: null, backup: "saved"});
                expect(await joinedBackup(harness, chunkCount)).toBe(raw);
                break j;
            }
        } finally {
            await harness.close();
        }

        const completed = await createMigrationHarness();
        try {
            const raw = JSON.stringify({leftPanelWidth: 427, filler: "done".repeat(100_000)});
            const chunkCount = splitLegacyOriginalChunks(raw, CHUNK_BYTES).length;
            const first = completed.controller(raw);
            await first.start();
            expect(first.snapshot()).toMatchObject({phase: "complete", backup: "saved"});

            await dropRecord(completed, WORKBENCH_MIGRATION_ORIGINAL_KEY);
            const mark = completed.mark();
            const afterLoss = completed.controller(raw);
            await afterLoss.start();

            // 已完成的迁移不重建被删掉的备份：如实报 none，且不写任何记录。
            expect(afterLoss.snapshot()).toMatchObject({phase: "complete", blocked: null, backup: "none"});
            expect(backupActionsSince(completed, mark).filter((item) => !item.startsWith("read:"))).toEqual([]);
            expect(await completed.recordText(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_ORIGINAL_KEY)).toBeNull();
            expect(await chunkText(completed, 0)).toBe(splitLegacyOriginalChunks(raw, CHUNK_BYTES)[0]);
            expect(chunkCount).toBeGreaterThan(1);

            // 完成态下 retry() 是空操作：没有恢复路径（记录在案，见 review.md 观察）。
            const retryMark = completed.mark();
            await afterLoss.retry();
            expect(completed.actions.slice(retryMark)).toEqual([]);
        } finally {
            await completed.close();
        }
    });
});
