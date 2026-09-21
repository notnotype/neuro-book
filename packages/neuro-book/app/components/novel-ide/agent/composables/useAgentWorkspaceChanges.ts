import {computed, ref, watch, type ComputedRef, type Ref} from "vue";
import {resolveApiErrorMessage, resolveApiErrorStatus} from "nbook/app/utils/api-error";
import {useWorkspaceHistoryDiffRequests} from "nbook/app/composables/useWorkspaceHistoryDiffRequests";
import {useWorkspaceHistoryInbox} from "nbook/app/composables/useWorkspaceHistoryInbox";
import {useNotification} from "nbook/app/composables/useNotification";
import type {WorkspaceHistoryDiffRequestIdentity, WorkspaceHistoryDiffRequestState} from "nbook/app/utils/workspace-history-diff-request";
import type {WorkspaceHistoryDiffDto, WorkspaceHistoryInboxGroupDto} from "nbook/shared/dto/workspace-history.dto";

export type WorkspaceHistoryDiffState = WorkspaceHistoryDiffRequestState<WorkspaceHistoryDiffDto>;

export interface UseAgentWorkspaceChangesOptions {
    projectRoot: Ref<string | null> | ComputedRef<string | null>;
    active: Ref<boolean> | ComputedRef<boolean>;
    refreshKey?: Ref<string | number> | ComputedRef<string | number>;
}

export function useAgentWorkspaceChanges(options: UseAgentWorkspaceChangesOptions) {
    const {revision, groups, loading, error, load} = useWorkspaceHistoryInbox(options.projectRoot, options.active);
    const diffRequests = useWorkspaceHistoryDiffRequests();
    const {t} = useI18n();
    const notification = useNotification();

    const expanded = ref(false);
    const selectedPath = ref<string | null>(null);
    const busyPath = ref<string | null>(null);
    const acceptingAll = ref(false);

    /** 构造当前 Project 下一个 group 的版本化 inline diff 身份。 */
    function diffIdentity(group: WorkspaceHistoryInboxGroupDto): WorkspaceHistoryDiffRequestIdentity {
        return {
            projectRoot: options.projectRoot.value ?? "",
            path: group.path,
            revision: group.revision,
            mode: "inline",
        };
    }

    /** 读取一个 group 当前 revision 的 diff state。 */
    function diffStateFor(group: WorkspaceHistoryInboxGroupDto): WorkspaceHistoryDiffState {
        return diffRequests.state(diffIdentity(group));
    }

    /** 选择文件并按需加载服务端安全 inline diff。 */
    async function selectGroup(group: WorkspaceHistoryInboxGroupDto): Promise<void> {
        if (!options.projectRoot.value) {
            return;
        }
        if (selectedPath.value === group.path) {
            selectedPath.value = null;
            return;
        }
        selectedPath.value = group.path;
        await diffRequests.load(diffIdentity(group), t("agent.workspaceChanges.diffLoadFailed"));
    }

    /** 接受单个文件的全部待审变更并刷新共用 inbox。 */
    async function acceptGroup(group: WorkspaceHistoryInboxGroupDto): Promise<void> {
        const root = options.projectRoot.value;
        if (!root || busyPath.value || acceptingAll.value) {
            return;
        }
        busyPath.value = group.path;
        try {
            await $fetch("/api/workspace-history/accept", {
                method: "POST",
                body: {projectRoot: root, path: group.path, revision: group.revision},
            });
            if (selectedPath.value === group.path) {
                selectedPath.value = null;
            }
            notification.success(t("agent.workspaceChanges.acceptSuccess", {path: group.path}));
            await refreshInbox();
        } catch (cause) {
            if (await refreshAfterStale(cause)) {
                return;
            }
            notification.error(resolveApiErrorMessage(cause, t("agent.workspaceChanges.acceptFailed")));
        } finally {
            busyPath.value = null;
        }
    }

    /** 接受服务端当前 inbox 的全部文件变更。 */
    async function acceptAll(): Promise<void> {
        const root = options.projectRoot.value;
        if (!root || acceptingAll.value || busyPath.value || groups.value.length === 0) {
            return;
        }
        acceptingAll.value = true;
        try {
            const result = await $fetch<{success: true; accepted: number}>("/api/workspace-history/accept-all", {
                method: "POST",
                body: {projectRoot: root, revision: revision.value},
            });
            selectedPath.value = null;
            notification.success(t("agent.workspaceChanges.acceptAllSuccess", {count: result.accepted}));
            await refreshInbox();
        } catch (cause) {
            if (await refreshAfterStale(cause)) {
                return;
            }
            notification.error(resolveApiErrorMessage(cause, t("agent.workspaceChanges.acceptFailed")));
        } finally {
            acceptingAll.value = false;
        }
    }

    /** Inbox 刷新前中止全部旧 diff，刷新后清理已消失的选择。 */
    async function refreshInbox(): Promise<void> {
        diffRequests.invalidate();
        await load();
        if (selectedPath.value && !groups.value.some((group) => group.path === selectedPath.value)) {
            selectedPath.value = null;
        }
    }

    /** 412 表示用户审查的 revision 已过期：不执行原动作，提示并刷新。 */
    async function refreshAfterStale(cause: unknown): Promise<boolean> {
        if (resolveApiErrorStatus(cause) !== 412) {
            return false;
        }
        notification.warning(t("agent.workspaceChanges.stale"));
        await refreshInbox();
        return true;
    }

    if (options.refreshKey) {
        watch(options.refreshKey, () => {
            if (options.active.value) {
                void refreshInbox();
            }
        });
    }

    watch(options.active, (active) => {
        if (!active) {
            diffRequests.invalidate();
        }
    });

    watch(options.projectRoot, () => {
        diffRequests.invalidate();
        selectedPath.value = null;
        expanded.value = false;
    });

    watch(revision, () => {
        diffRequests.invalidate();
    });

    return {
        groups,
        loading,
        error,
        revision,
        expanded,
        selectedPath,
        busyPath,
        acceptingAll,
        diffStateFor,
        selectGroup,
        acceptGroup,
        acceptAll,
        refreshInbox,
    };
}
