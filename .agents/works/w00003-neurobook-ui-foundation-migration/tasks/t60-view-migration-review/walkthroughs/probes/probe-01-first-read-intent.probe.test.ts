/**
 * 探针 01（返工后重写）—— 试图证伪的声明：
 *
 *   1) `user-record-session.ts` 的 `commit`：「首读门禁：读到分类之前不接受提交」，
 *      且**不排队重放**（返工前它 `await open()` 后重放，正是覆盖机制）。
 *   2) `WorkspaceFilePanel.vue`：「读取就绪前不渲染树（调整控件不可用）」。
 *   3) `persistence.md`「布局投影与保存反馈」第 1 条：「尺寸调整控件在读取就绪前不可用」。
 *
 * 本文件在 `c2152f83` 上**证伪成功**（当时落盘被覆盖成 `{"paths":["lorebook/"]}` /
 * `{"width":1200,"height":640}`）；返工后改成钉住修复后的期望：窗口内提交被拒绝、记录原值不变、
 * 就绪后提交才落盘。另外新增一例针对返工引入的新路径：句柄不可用时 `commit` 既不再重连、
 * 也把更准确的诊断顶掉（见 F4）。
 */
import {effectScope} from "vue";
import {describe, expect, it} from "vitest";
import {useWorkbenchFileTreeExpandedPaths} from "nbook/app/utils/workbench/files-view-session";
import {useSettingsWindowSize} from "nbook/app/utils/workbench/window-size-session";
import {
    WORKBENCH_FILES_OWNER,
    WORKBENCH_FILE_TREE_EXPANDED_PATHS_KEY,
} from "nbook/shared/storage/workbench-files";
import {WORKBENCH_LAYOUT_OWNER} from "nbook/shared/storage/workbench-state";
import {WORKBENCH_SETTINGS_WINDOW_SIZE_KEY} from "nbook/shared/storage/workbench-window-sizes";
import {flushMicrotasks, flushUntil, legacyStore, storageHarness} from "./harness";

const FILES_RECORD_KEY = `${WORKBENCH_FILES_OWNER}/${WORKBENCH_FILE_TREE_EXPANDED_PATHS_KEY}/`;
const SETTINGS_RECORD_KEY = `${WORKBENCH_LAYOUT_OWNER}/${WORKBENCH_SETTINGS_WINDOW_SIZE_KEY}/`;
const CONFIRMED_PATHS = {paths: ["manuscript/", "manuscript/vol-1"]};

describe("探针 01：首读门禁在窗口内拒绝提交、就绪后放行", () => {
    it("files 展开项：窗口内的树手势被拒绝，已确认展开项不被覆盖（返工前此处被覆盖）", async () => {
        const harness = storageHarness();
        harness.write(FILES_RECORD_KEY, CONFIRMED_PATHS);
        const release = harness.holdReads();
        const scope = effectScope();
        const record = scope.run(() => useWorkbenchFileTreeExpandedPaths({
            adapters: harness.adapters,
            legacy: legacyStore(null),
        }))!;

        await flushUntil(() => record.loading.value);
        // 前提：读取未完成时对外显示的是产品默认值（界面正是因此不渲染树）。
        expect(record.expandedPaths.value).toEqual([]);

        // 复刻 `WorkspaceFileTree.vue:98-104` 的手势意图 + `WorkspaceFilePanel.vue:52-54` 的提交。
        const intentFromUi = [...record.expandedPaths.value, "lorebook/"];
        await record.commit(intentFromUi);
        await flushMicrotasks();

        // eslint-disable-next-line no-console
        console.log("[probe-01/files-window] 提交被拒 | 落盘次数 =", harness.saveCount(FILES_RECORD_KEY),
            "| 显示 =", JSON.stringify(record.expandedPaths.value),
            "| 诊断 =", JSON.stringify(record.notice.value));

        expect(harness.saveCount(FILES_RECORD_KEY)).toBe(0);
        expect(record.expandedPaths.value).toEqual([]);
        expect(record.notice.value?.diagnosis).toContain("没完成首次读取");
        expect(record.notice.value?.retryable).toBe(false);

        release();
        await flushUntil(() => !record.loading.value);
        // 拒绝重放：已确认的两条展开项仍在（这正是修复要保的东西）。
        expect(record.expandedPaths.value).toEqual(["manuscript/", "manuscript/vol-1"]);
        expect(harness.recordOf(FILES_RECORD_KEY)).toEqual(CONFIRMED_PATHS);
        scope.stop();
    });

    it("files 展开项：读取就绪后的同一手势落盘为并集（对照，说明差异只来自读取窗口）", async () => {
        const harness = storageHarness();
        harness.write(FILES_RECORD_KEY, CONFIRMED_PATHS);
        const scope = effectScope();
        const record = scope.run(() => useWorkbenchFileTreeExpandedPaths({
            adapters: harness.adapters,
            legacy: legacyStore(null),
        }))!;

        await flushUntil(() => !record.loading.value);
        expect(record.expandedPaths.value).toEqual(["manuscript/", "manuscript/vol-1"]);
        await record.commit([...record.expandedPaths.value, "lorebook/"]);
        expect(harness.recordOf(FILES_RECORD_KEY))
            .toEqual({paths: ["manuscript/", "manuscript/vol-1", "lorebook/"]});
        scope.stop();
    });

    it("设置窗口尺寸：窗口内的一次拖动被拒绝，已确认尺寸不变（返工前 height 被顶成默认 640）", async () => {
        const harness = storageHarness();
        harness.write(SETTINGS_RECORD_KEY, {width: 1000, height: 700});
        const release = harness.holdReads();
        const scope = effectScope();
        const record = scope.run(() => useSettingsWindowSize({
            adapters: harness.adapters,
            legacy: legacyStore(null),
        }))!;

        await flushUntil(() => record.loading.value);
        await record.commit({...record.size.value, width: 1200});
        await flushMicrotasks();

        // eslint-disable-next-line no-console
        console.log("[probe-01/settings-window] 提交被拒 | 落盘次数 =", harness.saveCount(SETTINGS_RECORD_KEY),
            "| 记录 =", JSON.stringify(harness.recordOf(SETTINGS_RECORD_KEY)));

        expect(harness.saveCount(SETTINGS_RECORD_KEY)).toBe(0);
        expect(harness.recordOf(SETTINGS_RECORD_KEY)).toEqual({width: 1000, height: 700});

        release();
        await flushUntil(() => !record.loading.value);
        expect(record.size.value).toEqual({width: 1000, height: 700});
        await record.commit({...record.size.value, width: 1200});
        expect(harness.recordOf(SETTINGS_RECORD_KEY)).toEqual({width: 1200, height: 700});
        scope.stop();
    });

    it("F4 复核：句柄不可用时保留准确诊断与可达重试，手势顺带重连（返工后又修）", async () => {
        const harness = storageHarness();
        harness.failUserContext("Storage 宿主暂不可达（cold start）");
        harness.write(FILES_RECORD_KEY, CONFIRMED_PATHS);
        const scope = effectScope();
        const record = scope.run(() => useWorkbenchFileTreeExpandedPaths({
            adapters: harness.adapters,
            legacy: legacyStore(null),
        }))!;

        await flushUntil(() => !record.loading.value);
        // 冷启动失败：会话没建起来、显示产品默认、诊断来自 open()，且「重试」按钮可达
        // （三个消费端都按 retryable 决定是否渲染按钮）。
        expect(record.notice.value?.diagnosis).toContain("cold start");
        expect(record.notice.value?.retryable).toBe(true);

        // 后端仍不可达时的一次手势：不写盘，也不把准确诊断顶成门禁文案。
        await record.commit([...record.expandedPaths.value, "lorebook/"]);
        await flushMicrotasks();

        // eslint-disable-next-line no-console
        console.log("[probe-01/owner-down] 诊断 =", JSON.stringify(record.notice.value),
            "| 落盘次数 =", harness.saveCount(FILES_RECORD_KEY),
            "| 显示 =", JSON.stringify(record.expandedPaths.value));

        expect(harness.saveCount(FILES_RECORD_KEY)).toBe(0);
        expect(record.notice.value?.diagnosis ?? "").toContain("cold start");
        expect(record.notice.value?.diagnosis ?? "").not.toContain("没完成首次读取");
        expect(record.notice.value?.retryable).toBe(true);

        // 后端恢复：同一手势顺带重连，记录随即读到——会话内恢复，不必刷新页面。
        harness.recoverUserContext();
        await record.commit([...record.expandedPaths.value, "lorebook/"]);
        await flushUntil(() => record.expandedPaths.value.length === 2);
        expect(record.expandedPaths.value).toEqual(["manuscript/", "manuscript/vol-1"]);

        await record.commit([...record.expandedPaths.value, "lorebook/"]);
        // eslint-disable-next-line no-console
        console.log("[probe-01/owner-recovered] 记录 =", JSON.stringify(harness.recordOf(FILES_RECORD_KEY)));
        expect(harness.recordOf(FILES_RECORD_KEY))
            .toEqual({paths: ["manuscript/", "manuscript/vol-1", "lorebook/"]});
        scope.stop();
    });
});
