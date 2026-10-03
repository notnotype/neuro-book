import {
    retireLegacyBucketWriterPolicy,
} from "nbook/app/utils/workbench/storage-migration-legacy-bucket";
import type {StorageMigrationController, StorageMigrationSnapshot} from "nbook/app/utils/workbench/storage-migration";

/**
 * 旧桶写回门禁的退役判据与触发（迁移合同「启动顺序」第 2/5 步）。
 *
 * 三个源字段已退出 `novel.ide.local` 的 `pick`，但**保留侧仍在服役**：原件未安全保留时，
 * 这些值只存在于旧桶里，序列化器必须继续替旧 writer 补齐它们。退役（解除 serializer 与门禁）
 * 只能在原件确实安全保留之后发生——由启动接线订阅迁移快照触发。
 */

/**
 * 退役判据：旧桶原件已安全保留。
 *
 * - `phase === "complete"`：整条迁移流程已完成（目标已处理、完成标记已写）；
 * - `original !== null && backup === "saved"`：浏览器暂存已固化原件且 data 原件备份已落盘并通过核验。
 *
 * 暂存失败（`original-staging-failed`）或后端不可达（备份未落盘）时不满足：此刻源值只在旧桶里，
 * 门禁必须继续冻结/补齐，任何整键重写都不能抹掉它们。
 */
export function shouldRetireLegacyBucketWriter(snapshot: StorageMigrationSnapshot): boolean {
    if (snapshot.phase === "complete") {
        return true;
    }
    return snapshot.original !== null && snapshot.backup === "saved";
}

/** 订阅迁移快照，第一次满足判据时退役写回门禁并退订（每个应用生命周期只发生一次）。 */
export function retireLegacyBucketWriterWhenPreserved(migration: StorageMigrationController): void {
    let unsubscribe: (() => void) | null = null;
    let retired = false;
    const attempt = (snapshot: StorageMigrationSnapshot): void => {
        if (retired || !shouldRetireLegacyBucketWriter(snapshot)) {
            return;
        }
        retired = true;
        unsubscribe?.();
        retireLegacyBucketWriterPolicy();
    };
    unsubscribe = migration.subscribe(attempt);
    attempt(migration.snapshot());
}
