import {storeToRefs} from "pinia";
import {computed, onScopeDispose, ref, watch, type Ref} from "vue";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useNotification} from "nbook/app/composables/useNotification";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {ConfigEditorSnapshotDto, ConfigWorkspaceQueryDto} from "nbook/shared/dto/config.dto";

/** 首屏加载占位的出现延时：读得快时不该闪一下。 */
const BLOCKING_LOADING_DELAY_MS = 200;

export type SettingsSnapshot = {
    /** 最近一次成功读取的编辑快照；重取期间保留旧值，内容因此不会闪空。 */
    snapshot: Ref<ConfigEditorSnapshotDto | null>;
    /** 请求进行中（首次加载或作用域变更后的重取）。 */
    loading: Ref<boolean>;
    /**
     * 值得整屏加载占位的情况：还没有任何内容可显示，且已经等过一小段时间。
     * 有内容时的重取只该显示细进度条（见 `refreshing`）。
     */
    blockingLoading: Ref<boolean>;
    /** 有内容可显示时的后台重取。 */
    refreshing: Ref<boolean>;
    /**
     * 非空表示读取失败。只在没有内容可显示时给出——有旧内容时保留内容 + 系统通知，
     * 不必把整屏换成错误页。
     */
    loadError: Ref<string>;
    reload: () => Promise<void>;
};

/**
 * 设置页面共用的编辑快照来源。
 *
 * 只在 `enabled` 为真时取数（弹窗关闭、只读作用域都不发请求）；写回成功会 `bumpConfigRevision`，
 * 因此同一作用域内的写回会自动触发一次重取，把后端合并结果回声给草稿。
 */
export function useSettingsSnapshot(options: {
    enabled: () => boolean;
    targetQuery: () => ConfigWorkspaceQueryDto;
    /** 后端没有给出可读原因时用的本地化兜底文案（调用方传 `t(...)`）。 */
    fallbackErrorMessage: string;
}): SettingsSnapshot {
    const configApi = useConfigApi();
    const notification = useNotification();
    const {configRevision} = storeToRefs(useNovelIdeStore());
    const snapshot = ref<ConfigEditorSnapshotDto | null>(null);
    const loading = ref(false);
    const blockingLoading = ref(false);
    const loadError = ref("");
    const refreshing = computed(() => loading.value && snapshot.value !== null);
    let requestId = 0;
    let blockingTimer: ReturnType<typeof setTimeout> | null = null;

    function clearBlockingTimer(): void {
        if (blockingTimer !== null) {
            clearTimeout(blockingTimer);
            blockingTimer = null;
        }
    }

    async function reload(): Promise<void> {
        if (!options.enabled()) {
            return;
        }
        const id = ++requestId;
        loading.value = true;
        // 只有当此刻确实没有内容时，才可能升级成整屏加载占位；延时是为了避开「读得快」的闪。
        if (snapshot.value === null) {
            clearBlockingTimer();
            blockingTimer = setTimeout(() => {
                blockingTimer = null;
                if (id === requestId && loading.value && snapshot.value === null) {
                    blockingLoading.value = true;
                }
            }, BLOCKING_LOADING_DELAY_MS);
        }
        try {
            const next = await configApi.editorSnapshot(options.targetQuery());
            if (id !== requestId) {
                return;
            }
            snapshot.value = next;
            loadError.value = "";
        } catch (error) {
            if (id !== requestId || !options.enabled()) {
                return;
            }
            const message = resolveApiErrorMessage(error, options.fallbackErrorMessage);
            notification.error(message);
            // 有旧内容就留着：作用域切换失败时，用户看到的仍是上一份可用配置。
            if (snapshot.value === null) {
                loadError.value = message;
            }
        } finally {
            if (id === requestId) {
                loading.value = false;
                blockingLoading.value = false;
                clearBlockingTimer();
            }
        }
    }

    watch([
        () => options.enabled(),
        () => JSON.stringify(options.targetQuery()),
        configRevision,
    ], ([enabled]) => {
        if (!enabled) {
            loading.value = false;
            blockingLoading.value = false;
            clearBlockingTimer();
            return;
        }
        void reload();
    }, {immediate: true});

    onScopeDispose(clearBlockingTimer);

    return {snapshot, loading, blockingLoading, refreshing, loadError, reload};
}
