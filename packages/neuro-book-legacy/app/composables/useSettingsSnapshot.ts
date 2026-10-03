import {storeToRefs} from "pinia";
import {onScopeDispose, ref, watch, type Ref} from "vue";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useNotification} from "nbook/app/composables/useNotification";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {ConfigEditorSnapshotDto, ConfigWorkspaceQueryDto} from "nbook/shared/dto/config.dto";

export type SettingsSnapshot = {
    /** 最近一次成功读取的编辑快照；重取期间保留旧值。 */
    snapshot: Ref<ConfigEditorSnapshotDto | null>;
    /** 请求进行中（首次加载或作用域变更后的重取）。 */
    loading: Ref<boolean>;
    /**
     * 非空表示读取失败。只在没有内容可显示时给出——有旧内容时保留内容 + 系统通知，
     * 不必把整屏换成错误页。
     */
    loadError: Ref<string>;
    reload: () => Promise<void>;
};

/**
 * 把一个「正在忙」的信号延后一小段时间再对外呈现。
 *
 * 加载占位统一由外壳画，而「要不要显示」必须看延时：读得快时什么都不出现才不会闪一下。
 * 组合出来的忙信号（快照 + 区段自带取数）也走这里，保证判据只有一条。
 */
export function useDelayedFlag(source: () => boolean, delayMs: number): Ref<boolean> {
    const visible = ref(false);
    let timer: ReturnType<typeof setTimeout> | null = null;

    function clear(): void {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    }

    watch(source, (busy) => {
        clear();
        if (!busy) {
            visible.value = false;
            return;
        }
        timer = setTimeout(() => {
            timer = null;
            if (source()) {
                visible.value = true;
            }
        }, delayMs);
    }, {immediate: true});

    onScopeDispose(clear);

    return visible as Ref<boolean>;
}

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
    const loadError = ref("");
    let requestId = 0;

    async function reload(): Promise<void> {
        if (!options.enabled()) {
            return;
        }
        const id = ++requestId;
        loading.value = true;
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
            return;
        }
        void reload();
    }, {immediate: true});

    return {snapshot, loading, loadError, reload};
}
