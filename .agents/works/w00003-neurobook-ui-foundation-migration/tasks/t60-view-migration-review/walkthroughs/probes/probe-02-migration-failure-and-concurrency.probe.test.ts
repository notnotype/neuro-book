/**
 * 探针 02 —— 试图证伪的声明（`legacy-record-migration.ts` 模块头与 `t56` 自述）：
 *
 *   「读旧键 → 记录缺失时条件初始化 → **回读验证一致** → 删除旧键……任何一步失败都保留旧键
 *    并留下可见诊断」；以及 7 类失败（不可读 / 不可解析 / 记录不可写或损坏 / 迁移未确认 /
 *    回读失败 / 回读不一致 / 删除失败）都保留旧键。
 *
 * 四组攻击面：回读抛错、删除失败、同一会话内的并发第二次迁移、两个会话同时迁移。
 * 结论见每条用例末尾的 console.log 与断言。
 */
import {effectScope} from "vue";
import {describe, expect, it} from "vitest";
import {
    useWorkbenchFileTreeExpandedPaths,
    type WorkbenchFileTreeExpandedPathsConsumer,
} from "nbook/app/utils/workbench/files-view-session";
import {
    WORKBENCH_FILES_OWNER,
    WORKBENCH_FILE_TREE_EXPANDED_PATHS_KEY,
} from "nbook/shared/storage/workbench-files";
import type {WorkbenchStorageAdapters} from "nbook/app/utils/workbench/storage-context";
import {flushMicrotasks, flushUntil, legacyStore, storageHarness, type Harness} from "./harness";

const RECORD_KEY = `${WORKBENCH_FILES_OWNER}/${WORKBENCH_FILE_TREE_EXPANDED_PATHS_KEY}/`;
const LEGACY_RAW = JSON.stringify(["manuscript/", "lorebook/"]);

function openRecord(
    harness: Harness,
    legacy: ReturnType<typeof legacyStore>,
): {record: WorkbenchFileTreeExpandedPathsConsumer; stop: () => void} {
    const scope = effectScope();
    const record = scope.run(() => useWorkbenchFileTreeExpandedPaths({
        adapters: harness.adapters as WorkbenchStorageAdapters,
        legacy,
    }))!;
    return {record, stop: () => scope.stop()};
}

describe("探针 02：旧键删除门禁与并发迁移", () => {
    it("回读抛错：旧键保留、诊断可重试、记录已写入", async () => {
        const harness = storageHarness();
        harness.failReadsAfterSave();
        const legacy = legacyStore(LEGACY_RAW);
        const opened = openRecord(harness, legacy);

        await flushUntil(() => opened.record.notice.value !== null);
        // eslint-disable-next-line no-console
        console.log("[probe-02/readback-throw] 旧键剩余 =", JSON.stringify(legacy.remaining),
            "| 落盘 =", JSON.stringify(harness.recordOf(RECORD_KEY)),
            "| 诊断 =", JSON.stringify(opened.record.notice.value));

        expect(harness.recordOf(RECORD_KEY)).toEqual({paths: ["manuscript/", "lorebook/"]});
        expect(legacy.remaining).toBe(LEGACY_RAW);
        expect(opened.record.notice.value?.retryable).toBe(true);
        expect(opened.record.notice.value?.diagnosis).toContain("回读失败");
        opened.stop();
    });

    it("删除失败：旧键保留、诊断可重试；可删除后重试收尾", async () => {
        const harness = storageHarness();
        const legacy = legacyStore(LEGACY_RAW, false);
        const opened = openRecord(harness, legacy);

        await flushUntil(() => opened.record.notice.value !== null);
        // eslint-disable-next-line no-console
        console.log("[probe-02/remove-fail] 旧键剩余 =", JSON.stringify(legacy.remaining),
            "| 落盘 =", JSON.stringify(harness.recordOf(RECORD_KEY)),
            "| 诊断 =", JSON.stringify(opened.record.notice.value));

        expect(legacy.remaining).toBe(LEGACY_RAW);
        expect(opened.record.notice.value?.diagnosis).toContain("删除失败");
        expect(opened.record.notice.value?.retryable).toBe(true);
        opened.stop();
    });

    it("同一会话的并发第二次迁移：保存次数与旧键去留", async () => {
        const harness = storageHarness();
        const release = harness.holdReads();
        const legacy = legacyStore(LEGACY_RAW);
        const opened = openRecord(harness, legacy);
        await flushMicrotasks();

        // 首次读取还没分类时连点两次「重试」（两次 retry 都会各自跑一遍迁移链路）。
        const first = opened.record.retry();
        const second = opened.record.retry();
        release();
        await Promise.all([first, second]);
        await flushUntil(() => legacy.remaining === null);

        // eslint-disable-next-line no-console
        console.log("[probe-02/double-retry] 落盘次数 =", harness.saveCount(RECORD_KEY),
            "| 落盘 =", JSON.stringify(harness.recordOf(RECORD_KEY)),
            "| 旧键剩余 =", JSON.stringify(legacy.remaining),
            "| 诊断 =", JSON.stringify(opened.record.notice.value));

        expect(harness.recordOf(RECORD_KEY)).toEqual({paths: ["manuscript/", "lorebook/"]});
        expect(legacy.remaining).toBeNull();
        opened.stop();
    });

    it("两个会话同时迁移同一条记录：记录值不被空值/半值覆盖", async () => {
        const harness = storageHarness();
        const release = harness.holdReads();
        const first = legacyStore(LEGACY_RAW);
        const second = legacyStore(LEGACY_RAW);
        const left = openRecord(harness, first);
        const right = openRecord(harness, second);
        await flushMicrotasks();

        release();
        await flushUntil(() => first.remaining === null && second.remaining === null);

        // eslint-disable-next-line no-console
        console.log("[probe-02/two-sessions] 落盘次数 =", harness.saveCount(RECORD_KEY),
            "| 落盘 =", JSON.stringify(harness.recordOf(RECORD_KEY)),
            "| 两个旧键 =", JSON.stringify([first.remaining, second.remaining]),
            "| 诊断 =", JSON.stringify([left.record.notice.value, right.record.notice.value]));

        expect(harness.recordOf(RECORD_KEY)).toEqual({paths: ["manuscript/", "lorebook/"]});
        left.stop();
        right.stop();
    });

    it("声明面的边界：记录已确认时只删旧键，不比对旧值（故意不覆盖）", async () => {
        const harness = storageHarness();
        harness.write(RECORD_KEY, {paths: ["world-engine/"]});
        const legacy = legacyStore(LEGACY_RAW);
        const opened = openRecord(harness, legacy);

        await flushUntil(() => legacy.remaining === null);
        // eslint-disable-next-line no-console
        console.log("[probe-02/authoritative-record] 落盘次数 =", harness.saveCount(RECORD_KEY),
            "| 记录 =", JSON.stringify(harness.recordOf(RECORD_KEY)),
            "| 旧键剩余 =", JSON.stringify(legacy.remaining));

        expect(harness.saveCount(RECORD_KEY)).toBe(0);
        expect(harness.recordOf(RECORD_KEY)).toEqual({paths: ["world-engine/"]});
        opened.stop();
    });
});
