import type {MaybeRefOrGetter} from "vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {WorkspaceHistoryInboxDto, WorkspaceHistoryInboxGroupDto} from "nbook/shared/dto/workspace-history.dto";

type WorkspaceHistoryInboxState = {
    projectRoot: string | null;
    revision: number;
    groups: WorkspaceHistoryInboxGroupDto[];
    loading: boolean;
    loaded: boolean;
    error: string | null;
    requestId: number;
};

/**
 * Header Dialog 与 Agent Composer 共用的文件变更收件箱状态。
 */
export function useWorkspaceHistoryInbox(
    projectRoot: MaybeRefOrGetter<string | null>,
    enabled: MaybeRefOrGetter<boolean> = true,
) {
    const state = useState<WorkspaceHistoryInboxState>("workspace-history-inbox", () => ({
        projectRoot: null,
        revision: 0,
        groups: [],
        loading: false,
        loaded: false,
        error: null,
        requestId: 0,
    }));

    /** 拉取当前 Project 的待审文件分组；请求返回时会丢弃已切项目的旧响应。 */
    async function load(): Promise<void> {
        if (!toValue(enabled)) {
            return;
        }
        const target = toValue(projectRoot);
        const requestId = state.value.requestId + 1;
        state.value.requestId = requestId;
        state.value.projectRoot = target;
        state.value.error = null;
        state.value.loaded = false;
        if (!target) {
            state.value.revision = 0;
            state.value.groups = [];
            state.value.loading = false;
            return;
        }
        state.value.loading = true;
        try {
            const dto = await $fetch<WorkspaceHistoryInboxDto>("/api/workspace-history/inbox", {
                query: {projectRoot: target},
            });
            if (state.value.requestId !== requestId || state.value.projectRoot !== target) {
                return;
            }
            state.value.revision = dto.revision;
            state.value.groups = dto.groups;
            state.value.loaded = true;
        } catch (cause) {
            if (state.value.requestId !== requestId || state.value.projectRoot !== target) {
                return;
            }
            state.value.revision = 0;
            state.value.groups = [];
            state.value.error = resolveApiErrorMessage(cause, "加载文件变更失败");
            state.value.loaded = true;
        } finally {
            if (state.value.requestId === requestId) {
                state.value.loading = false;
            }
        }
    }

    watch([() => toValue(projectRoot), () => toValue(enabled)] as const, ([target, active], [previousTarget, previousActive]) => {
        if (!active) {
            return;
        }
        if (state.value.projectRoot === target && (state.value.loading || state.value.loaded || (target === previousTarget && active === previousActive))) {
            return;
        }
        state.value.projectRoot = target;
        state.value.revision = 0;
        state.value.groups = [];
        state.value.loaded = false;
        state.value.error = null;
        void load();
    }, {immediate: true});

    return {
        revision: computed(() => state.value.revision),
        groups: computed(() => state.value.groups),
        loading: computed(() => state.value.loading),
        error: computed(() => state.value.error),
        load,
    };
}
