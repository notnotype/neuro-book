import {describe, expect, it} from "vitest";
import type {StorageMigrationController, StorageMigrationSnapshot} from "nbook/app/utils/workbench/storage-migration";
import {
    installLegacyBucketWriterPolicy,
    legacyBucketWriterPolicy,
} from "nbook/app/utils/workbench/storage-migration-legacy-bucket";

/**
 * 旧桶写回门禁的退役判据与触发（迁移合同「启动顺序」第 2/5 步）。
 *
 * 退役只能在原件确实安全保留之后发生：此刻三个源值还躺在 `novel.ide.local` 里，
 * 任何整键重写都会把它们抹掉（`pick` 已移除三个字段，保留侧全靠门禁的序列化器）。
 */

const {retireLegacyBucketWriterWhenPreserved, shouldRetireLegacyBucketWriter} = await import("nbook/app/utils/workbench/legacy-bucket-retirement");

function snapshot(overrides: Partial<StorageMigrationSnapshot>): StorageMigrationSnapshot {
    return {
        phase: "running",
        blocked: null,
        diagnosis: null,
        retryable: false,
        bucket: "pinned",
        original: null,
        backup: "none",
        fields: [],
        ...overrides,
    };
}

const ORIGINAL = {byteLength: 128, digest: "seed", capturedAt: "2026-09-16T00:00:00.000Z"};

/** 只记录订阅与快照的替身控制器：退役逻辑本身不关心迁移怎么跑。 */
function fakeController(initial: StorageMigrationSnapshot): {
    controller: StorageMigrationController;
    publish(snapshot: StorageMigrationSnapshot): void;
    readonly listeners: number;
} {
    const listeners = new Set<(snapshot: StorageMigrationSnapshot) => void>();
    let current = initial;
    return {
        controller: {
            staged: Promise.resolve(current),
            settled: Promise.resolve(current),
            async start() {
                return current;
            },
            async retry() {
                return current;
            },
            snapshot: () => current,
            subscribe(listener) {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
        },
        publish(next) {
            current = next;
            for (const listener of [...listeners]) {
                listener(next);
            }
        },
        get listeners() {
            return listeners.size;
        },
    };
}

describe("旧桶写回门禁的退役判据", () => {
    it("原件已暂存且 data 备份落盘、或迁移已 complete 时才退役", () => {
        expect(shouldRetireLegacyBucketWriter(snapshot({phase: "complete", original: ORIGINAL, backup: "saved"}))).toBe(true);
        expect(shouldRetireLegacyBucketWriter(snapshot({phase: "running", original: ORIGINAL, backup: "saved"}))).toBe(true);
        // 暂存完成但备份还没落盘：源值只在内嵌暂存里，旧桶仍要保留。
        expect(shouldRetireLegacyBucketWriter(snapshot({phase: "running", original: ORIGINAL, backup: "none"}))).toBe(false);
        expect(shouldRetireLegacyBucketWriter(snapshot({phase: "blocked", blocked: "backup-failed", original: ORIGINAL, backup: "failed"}))).toBe(false);
        // 暂存失败：源值只在旧桶里，门禁必须继续冻结/补齐。
        expect(shouldRetireLegacyBucketWriter(snapshot({
            phase: "blocked",
            blocked: "original-staging-failed",
            original: null,
            backup: "none",
            bucket: "locked",
        }))).toBe(false);
        expect(shouldRetireLegacyBucketWriter(snapshot({phase: "blocked", blocked: "backend-unreachable", original: ORIGINAL, backup: "none"}))).toBe(false);
    });

    it("启动接线只退役一次：满足判据后解除订阅，后续快照不再触发", () => {
        installLegacyBucketWriterPolicy({mode: "pinned", fields: {leftPanelWidth: 427}});
        const fake = fakeController(snapshot({phase: "running", original: ORIGINAL, backup: "none"}));
        retireLegacyBucketWriterWhenPreserved(fake.controller);

        // 备份未落盘：门禁保持 pinned，源值仍由序列化器补齐。
        expect(legacyBucketWriterPolicy()).toEqual({mode: "pinned", fields: {leftPanelWidth: 427}});
        expect(fake.listeners).toBe(1);

        fake.publish(snapshot({phase: "running", original: ORIGINAL, backup: "saved"}));
        expect(legacyBucketWriterPolicy()).toEqual({mode: "inactive"});
        expect(fake.listeners).toBe(0);
    });

    it("构造时已满足判据（例如迁移早已完成）也立即退役", () => {
        installLegacyBucketWriterPolicy({mode: "pinned", fields: {leftPanelWidth: 427}});
        const fake = fakeController(snapshot({phase: "complete", original: ORIGINAL, backup: "saved"}));

        retireLegacyBucketWriterWhenPreserved(fake.controller);

        expect(legacyBucketWriterPolicy()).toEqual({mode: "inactive"});
        expect(fake.listeners).toBe(0);
    });
});
