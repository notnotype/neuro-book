import {onScopeDispose, ref} from "vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {
    WorkspaceHistoryDiffRequestGuard,
    type WorkspaceHistoryDiffRequestIdentity,
    type WorkspaceHistoryDiffRequestState,
} from "nbook/app/utils/workspace-history-diff-request";
import type {WorkspaceHistoryDiffDto} from "nbook/shared/dto/workspace-history.dto";

/**
 * 为单个 UI 宿主提供版本化 Workspace History diff 请求、缓存与逐文件状态。
 */
export function useWorkspaceHistoryDiffRequests() {
    const guard = new WorkspaceHistoryDiffRequestGuard<WorkspaceHistoryDiffDto>();
    const version = ref(0);

    /** 读取指定版本键的展示状态。 */
    function state(identity: WorkspaceHistoryDiffRequestIdentity): WorkspaceHistoryDiffRequestState<WorkspaceHistoryDiffDto> {
        void version.value;
        return guard.state(identity);
    }

    /** 按版本键读取安全 diff；已有结果时直接复用。 */
    async function load(identity: WorkspaceHistoryDiffRequestIdentity, fallback: string): Promise<WorkspaceHistoryDiffDto | null> {
        const cached = guard.cached(identity);
        if (cached) {
            return cached;
        }
        const request = guard.begin(identity);
        version.value += 1;
        try {
            const result = await $fetch<WorkspaceHistoryDiffDto>("/api/workspace-history/diff", {
                query: identity,
                signal: request.controller.signal,
            });
            if (guard.resolve(request, result)) {
                version.value += 1;
                return result;
            }
        } catch (cause) {
            if (guard.reject(request, resolveApiErrorMessage(cause, fallback))) {
                version.value += 1;
            }
        }
        return null;
    }

    /** 中止当前宿主的全部 diff 请求并清空旧版本缓存。 */
    function invalidate(): void {
        guard.invalidate();
        version.value += 1;
    }

    onScopeDispose(invalidate);

    return {state, load, invalidate};
}
