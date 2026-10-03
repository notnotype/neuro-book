import type {ComputedRef} from "vue";
import {computed, ref} from "vue";
import {useDetailUndoHistory} from "nbook/app/composables/useDetailUndoHistory";

export interface UseDetailSessionOptions {
    historyKey: ComputedRef<string>;
    createSnapshot: () => string;
    applySnapshot: (snapshot: string) => void;
}

/**
 * detail quick-edit 共用会话。
 *
 * 只负责三件事：
 * - 跟踪最近一次成功保存快照
 * - 管理基于 store 的本地 undo 栈
 * - 暴露统一的 dirty / undo / markSaved 语义
 */
export function useDetailSession(options: UseDetailSessionOptions) {
    const savedSnapshot = ref("");
    const history = useDetailUndoHistory(options.historyKey);

    /**
     * 当前草稿是否偏离最近一次成功保存快照。
     */
    const isDirty = computed(() => options.createSnapshot() !== savedSnapshot.value);

    /**
     * 服务端值同步到本地后，刷新保存基线。
     */
    function applyServerValue(snapshot = options.createSnapshot()): void {
        savedSnapshot.value = snapshot;
        history.syncHistory();
    }

    /**
     * 当前实体被清空时，重置整段会话。
     */
    function resetSession(): void {
        savedSnapshot.value = "";
        history.resetHistory();
    }

    /**
     * 在提交前把最近一次已保存快照压入 undo 栈。
     */
    function pushUndo(): void {
        history.pushHistory(savedSnapshot.value);
    }

    /**
     * 标记当前草稿已成功保存。
     */
    function markSaved(snapshot = options.createSnapshot()): void {
        savedSnapshot.value = snapshot;
    }

    /**
     * 回退到上一条本地草稿。
     */
    function undo(): void {
        const previousSnapshot = history.popHistory();
        if (!previousSnapshot) {
            return;
        }

        options.applySnapshot(previousSnapshot);
    }

    return {
        savedSnapshot,
        isDirty,
        canUndo: history.canRollback,
        applyServerValue,
        resetSession,
        pushUndo,
        markSaved,
        undo,
    };
}
