/**
 * 探针 01 —— 试图证伪的声明：
 *
 *   1) `user-record-session.ts` 的 `commit()`：「首读门禁：等首次读取分类完成再提交，
 *      用户的调整不因为"还在读"被丢掉。」
 *   2) `persistence.md`「布局投影与保存反馈」第 1 条：「初次加载可以显示产品默认布局，
 *      **尺寸调整控件在读取就绪前不可用**」。
 *
 * 证伪方式：把首次读取停在闸上，用**读取未完成时对外显示的值**（产品默认）算出本次意图，
 * 再按组件里的真实写法提交——看已确认记录是"被保住"还是"被静默覆盖"。
 *
 * 实测结论：门禁只挡「读之前写盘」，不挡「用默认显示算出来的意图」；读取完成后这条意图
 * 会把已确认记录整体覆盖。文件面板不消费 `loading`（`WorkspaceFilePanel.vue` 只用
 * `expandedPaths`/`notice`/`commit`/`retry`/`abandon`），因此控件在读取就绪前是可用的。
 */
import {effectScope} from "vue";
import {describe, expect, it} from "vitest";
import {useWorkbenchFileTreeExpandedPaths} from "nbook/app/utils/workbench/files-view-session";
import {
    useCreateProjectWindowSize,
    useSettingsWindowSize,
} from "nbook/app/utils/workbench/window-size-session";
import {
    WORKBENCH_FILES_OWNER,
    WORKBENCH_FILE_TREE_EXPANDED_PATHS_KEY,
} from "nbook/shared/storage/workbench-files";
import {WORKBENCH_LAYOUT_OWNER} from "nbook/shared/storage/workbench-state";
import {
    WORKBENCH_SETTINGS_WINDOW_SIZE_KEY,
    WORKBENCH_SETTINGS_WINDOW_DEFAULT_SIZE,
} from "nbook/shared/storage/workbench-window-sizes";
import {flushMicrotasks, flushUntil, legacyStore, storageHarness} from "./harness";

const FILES_RECORD_KEY = `${WORKBENCH_FILES_OWNER}/${WORKBENCH_FILE_TREE_EXPANDED_PATHS_KEY}/`;
const SETTINGS_RECORD_KEY = `${WORKBENCH_LAYOUT_OWNER}/${WORKBENCH_SETTINGS_WINDOW_SIZE_KEY}/`;

describe("探针 01：首读门禁只挡写入，不挡用默认显示算出来的意图", () => {
    it("files 展开项：读取未完成时的树手势把已确认展开项覆盖成一个路径", async () => {
        const harness = storageHarness();
        harness.write(FILES_RECORD_KEY, {paths: ["manuscript/", "manuscript/vol-1"]});
        const release = harness.holdReads();
        const scope = effectScope();
        const record = scope.run(() => useWorkbenchFileTreeExpandedPaths({
            adapters: harness.adapters,
            legacy: legacyStore(null),
        }))!;

        await flushMicrotasks();
        // 前提（作者自己的首读门禁用例也断言了同一件事）：读取未完成时对外显示的是产品默认值。
        expect(record.loading.value).toBe(true);
        expect(record.expandedPaths.value).toEqual([]);

        // 复刻 `WorkspaceFileTree.vue:98-104`（把整份 props.expandedPaths 加上新路径后 emit）
        // 与 `WorkspaceFilePanel.vue:52-54`（setter 直接 commit 整份数组）。
        const intentFromUi = [...record.expandedPaths.value, "lorebook/"];
        const committed = record.commit(intentFromUi);
        release();
        await committed;

        const stored = harness.recordOf(FILES_RECORD_KEY);
        // eslint-disable-next-line no-console
        console.log("[probe-01/files] 读取中显示 =", JSON.stringify([]),
            "| 界面意图 =", JSON.stringify(intentFromUi),
            "| 落盘记录 =", JSON.stringify(stored));

        expect(record.loading.value).toBe(false);
        // 实测：已确认的两条展开项在这一次提交后消失（若门禁按声明生效，这里应仍是三条的并集）。
        expect(stored).toEqual({paths: ["lorebook/"]});
        scope.stop();
    });

    it("设置窗口尺寸：读取未完成时的一次拖动把已确认尺寸覆盖成「默认 + 拖量」", async () => {
        const harness = storageHarness();
        harness.write(SETTINGS_RECORD_KEY, {width: 1000, height: 700});
        const release = harness.holdReads();
        const scope = effectScope();
        const record = scope.run(() => useSettingsWindowSize({
            adapters: harness.adapters,
            legacy: legacyStore(null),
        }))!;

        await flushMicrotasks();
        expect(record.loading.value).toBe(true);
        // 读取就绪前控件若可用，用户看到的是产品默认尺寸（1120×640），拖出来的值以它为基准。
        expect(record.size.value).toEqual(WORKBENCH_SETTINGS_WINDOW_DEFAULT_SIZE);

        // 复刻 `NovelIdeSettingsDialog.vue` 的 `@update:width → commit({...显示的尺寸, width})`。
        const committed = record.commit({...record.size.value, width: 1200});
        release();
        await committed;

        const stored = harness.recordOf(SETTINGS_RECORD_KEY);
        // eslint-disable-next-line no-console
        console.log("[probe-01/settings] 读取中显示 =", JSON.stringify(WORKBENCH_SETTINGS_WINDOW_DEFAULT_SIZE),
            "| 落盘记录 =", JSON.stringify(stored));

        // 实测：记录里的 height 700 被产品默认 640 顶掉（对话框重开时高度会跟着变）。
        expect(stored).toEqual({width: 1200, height: 640});
        scope.stop();
    });

    it("对照组：读取完成后同样的手势不会丢已确认值（说明差异只来自读取窗口）", async () => {
        const harness = storageHarness();
        harness.write(FILES_RECORD_KEY, {paths: ["manuscript/", "manuscript/vol-1"]});
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

    it("对照组的另一面：新建作品对话框在读取窗口里的同一手势同样覆盖已确认尺寸", async () => {
        const createProjectRecordKey = `${WORKBENCH_LAYOUT_OWNER}/create-project-dialog-size/`;
        const harness = storageHarness();
        harness.write(createProjectRecordKey, {width: 640, height: 400});
        const release = harness.holdReads();
        const scope = effectScope();
        const record = scope.run(() => useCreateProjectWindowSize({
            adapters: harness.adapters,
            legacy: legacyStore(null),
        }))!;

        await flushMicrotasks();
        expect(record.loading.value).toBe(true);
        const committed = record.commit({...record.size.value, width: 700});
        release();
        await committed;

        expect(harness.recordOf(createProjectRecordKey)).toEqual({width: 700, height: 360});
        scope.stop();
    });
});
