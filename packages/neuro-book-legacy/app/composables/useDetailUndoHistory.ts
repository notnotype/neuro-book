import type {ComputedRef} from "vue";
import {computed, ref} from "vue";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";

/**
 * detail 面板本地回退历史的最小封装。
 *
 * 只负责：
 * - 读取当前实体的 undo 栈
 * - 推入 / 弹出快照
 * - 在切换到新实体时清理新实体已有的历史残留
 */
export function useDetailUndoHistory(historyKey: ComputedRef<string>) {
    const novelIdeStore = useNovelIdeStore();
    const syncedHistoryKey = ref("");

    /**
     * 当前实体是否还有可回退的快照。
     */
    const canRollback = computed(() => historyKey.value
        ? novelIdeStore.getDetailUndoStack(historyKey.value).length > 0
        : false);

    /**
     * 推入一条本地快照。
     */
    const pushHistory = (snapshot: string): void => {
        if (!historyKey.value || !snapshot) {
            return;
        }

        novelIdeStore.pushDetailUndoSnapshot(historyKey.value, snapshot);
    };

    /**
     * 弹出一条本地快照。
     */
    const popHistory = (): string | null => {
        if (!historyKey.value) {
            return null;
        }

        return novelIdeStore.popDetailUndoSnapshot(historyKey.value);
    };

    /**
     * 当前实体被清空时，重置绑定和历史。
     */
    const resetHistory = (): void => {
        if (historyKey.value) {
            novelIdeStore.clearDetailUndoStack(historyKey.value);
        }

        syncedHistoryKey.value = "";
    };

    /**
     * 同步当前历史 key。
     * 当切到新实体时，清掉这个实体残留的旧历史。
     */
    const syncHistory = (): void => {
        if (!historyKey.value) {
            syncedHistoryKey.value = "";
            return;
        }

        if (historyKey.value !== syncedHistoryKey.value) {
            novelIdeStore.clearDetailUndoStack(historyKey.value);
        }

        syncedHistoryKey.value = historyKey.value;
    };

    return {
        canRollback,
        popHistory,
        pushHistory,
        resetHistory,
        syncHistory,
    };
}
