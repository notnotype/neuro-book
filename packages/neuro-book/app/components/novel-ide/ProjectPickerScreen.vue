<script setup lang="ts">
import {ref, computed, onMounted} from "vue";
import {storeToRefs} from "pinia";
import {useDialog} from "nbook/app/composables/useDialog";
import {useNotification} from "nbook/app/composables/useNotification";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {useAgentSessionApi} from "nbook/app/composables/useAgentSessionApi";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {
    resolveProjectMutationCommitState,
} from "nbook/app/utils/project-mutation-error";
import {
    reduceProjectCoverRecovery,
    settleProjectCoverRecoverySnapshot,
    type ProjectCoverRecoveryState,
} from "nbook/app/utils/project-cover-recovery";
import {
    beginProjectPickerRecovery,
    emptyProjectPickerRecovery,
    failProjectPickerRecovery,
    settleProjectPickerRecoverySnapshot,
    type ProjectPickerRecoveryEntry,
    type ProjectPickerRecoveryState,
    type ProjectPickerRecoveryTarget,
} from "nbook/app/utils/project-picker-recovery";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import type {AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import ProjectPickerView from "./project-picker/ProjectPickerView.vue";
import type {
    ProjectPickerCreatePayload,
    ProjectPickerRecoverSessionPayload,
} from "./project-picker/ProjectPickerView.types";

/**
 * 未选择 Project 时的首页项目选择界面 Controller。
 *
 * 负责列出、新建、删除与封面管理的状态机、API 交互与 Pinia Store 绑定；
 * 展示与交互委托给纯受控视图 ProjectPickerView。
 */

const emit = defineEmits<{
    (e: "open", projectRoot: string): void;
    (e: "open-user-assets"): void;
}>();

const {confirm} = useDialog();
const notification = useNotification();
const sessionApi = useAgentSessionApi();
const novelIdeStore = useNovelIdeStore();
const {novels, projectPickerLayoutMode} = storeToRefs(novelIdeStore);
const {
    loadProjects: refreshProjects,
    createProject,
    deleteProject,
    forgetProject,
    updateProjectCover,
} = novelIdeStore;
const {t} = useI18n();

const isLoading = ref(true);
const loadError = ref("");
const isCreating = ref(false);
const isCreateFormOpen = ref(false);
const createRecoveryNotice = ref("");
const pickerRecoveries = ref<ProjectPickerRecoveryState>(emptyProjectPickerRecovery());
const deleteBusyRoots = ref<Set<string>>(new Set());
const failedCoverRoots = ref<Set<string>>(new Set());
const coverRefreshVersions = ref<Record<string, number>>({});
const coverDialogOpen = ref(false);
const coverDialogProject = ref<ProjectMetadataDto | null>(null);
const coverError = ref("");
const coverBusy = ref(false);
const coverRecoveries = ref<ProjectCoverRecoveryState>(new Map());
const coverRecoveryNotice = ref("");
const recoveryExpanded = ref(false);
const recoveryLoading = ref(false);
const recoveryLoaded = ref(false);
const recoveryError = ref("");
const recoverySessions = ref<AgentSessionSummaryDto[]>([]);
const recoveryOffset = ref(0);
const recoveryHasMore = ref(false);
const recoveryTotal = ref(0);
const recoveryActionId = ref<number | null>(null);
let recoveryAttempt = 0;
const RECOVERY_PAGE_SIZE = 20;

const currentCoverRecovery = computed(() => {
    const projectRoot = coverDialogProject.value?.projectRoot;
    return projectRoot ? coverRecoveries.value.get(projectRoot) : undefined;
});
const coverNeedsRefresh = computed(() => currentCoverRecovery.value !== undefined);
const createRecovery = computed(() => pickerRecoveries.value.create);

/** 生成组件生命周期内不复用的恢复 attempt。 */
const nextRecoveryAttempt = (): number => {
    recoveryAttempt += 1;
    return recoveryAttempt;
};

/** 读取指定 Project 的删除恢复记录。 */
const deleteRecoveryFor = (projectRoot: string): ProjectPickerRecoveryEntry | undefined => (
    pickerRecoveries.value.deletes.get(projectRoot)
);

/** 读取 Project 列表，并为首页提供可恢复的局部错误态。 */
const loadProjects = async (): Promise<void> => {
    isLoading.value = true;
    loadError.value = "";
    const focusedProjectRoot = coverDialogProject.value?.projectRoot;
    const capturedCoverRecoveries = coverRecoveries.value;
    const capturedPickerRecoveries = pickerRecoveries.value;
    try {
        const snapshot = await refreshProjects();
        settleCoverRecoverySnapshot(snapshot.projects, capturedCoverRecoveries, focusedProjectRoot);
        settlePickerRecoverySnapshot(snapshot.projects, capturedPickerRecoveries);
    } catch (error) {
        loadError.value = resolveApiErrorMessage(error, t("ide.picker.loadFailed"));
    } finally {
        isLoading.value = false;
    }
};

onMounted(() => {
    void loadProjects();
});

/** 首次展开才读取待确认 Session；后续分页沿用服务端 offset/limit 协议。 */
const toggleRecovery = async (): Promise<void> => {
    recoveryExpanded.value = !recoveryExpanded.value;
    if (recoveryExpanded.value && !recoveryLoaded.value) {
        await loadRecoverySessions(0, false);
    }
};

/** 读取一页 migration recovery Session；不一次加载整个 Session Store。 */
const loadRecoverySessions = async (offset: number, append: boolean): Promise<void> => {
    recoveryLoading.value = true;
    recoveryError.value = "";
    try {
        const page = await sessionApi.listSessions({
            scope: "all",
            recovery: "required",
            offset,
            limit: RECOVERY_PAGE_SIZE,
        });
        if (append) {
            const knownSessionIds = new Set(recoverySessions.value.map((session) => session.sessionId));
            recoverySessions.value = [
                ...recoverySessions.value,
                ...page.items.filter((session) => !knownSessionIds.has(session.sessionId)),
            ];
        } else {
            recoverySessions.value = page.items;
        }
        recoveryOffset.value = page.nextOffset ?? offset + page.items.length;
        recoveryHasMore.value = page.hasMore;
        recoveryTotal.value = page.total;
        recoveryLoaded.value = true;
    } catch (error) {
        recoveryError.value = resolveApiErrorMessage(error, "读取需要确认的会话失败");
    } finally {
        recoveryLoading.value = false;
    }
};

/** 把 Session 绑定到选定 Project，或明确清除为 Workspace Root Session。 */
const recoverSession = async (payload: ProjectPickerRecoverSessionPayload): Promise<void> => {
    const {session, targetProjectRoot} = payload;
    const workspaceRoot = targetProjectRoot === null;
    const target = targetProjectRoot ?? "";
    if (!workspaceRoot && !target) {
        notification.warning("请先选择 Session 所属的 Project", {title: "需要选择 Project"});
        return;
    }
    recoveryActionId.value = session.sessionId;
    try {
        await sessionApi.updateSessionCurrentProject(session.sessionId, {
            projectRoot: workspaceRoot ? null : target,
        });
        recoverySessions.value = recoverySessions.value.filter((item) => item.sessionId !== session.sessionId);
        recoveryOffset.value = Math.max(0, recoveryOffset.value - 1);
        recoveryTotal.value = Math.max(0, recoveryTotal.value - 1);
        notification.success("会话归属已确认", {title: "会话可以继续使用"});
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "确认会话归属失败"), {title: "确认失败"});
    } finally {
        recoveryActionId.value = null;
    }
};

/** 打开就地新建表单。 */
const openCreateForm = (): void => {
    isCreateFormOpen.value = true;
    createRecoveryNotice.value = "";
};

/** 取消就地新建。 */
const cancelCreateForm = (): void => {
    if (isCreating.value || createRecovery.value) return;
    isCreateFormOpen.value = false;
};

/** 用一次完整 Catalog snapshot 同时结算 Picker 与封面恢复记录。 */
const refreshPickerMutationState = async (
    target: ProjectPickerRecoveryTarget,
    attempt: number,
): Promise<void> => {
    const capturedCoverRecoveries = coverRecoveries.value;
    const capturedPickerRecoveries = pickerRecoveries.value;
    try {
        const snapshot = await refreshProjects();
        settleCoverRecoverySnapshot(
            snapshot.projects,
            capturedCoverRecoveries,
            coverDialogProject.value?.projectRoot,
        );
        settlePickerRecoverySnapshot(snapshot.projects, capturedPickerRecoveries);
    } catch (error) {
        pickerRecoveries.value = failProjectPickerRecovery(
            pickerRecoveries.value,
            target,
            attempt,
            resolveApiErrorMessage(error, t("ide.picker.mutationRecoveryRefreshFailed")),
        );
    }
};

/** 重试 create 的事实刷新，不重放创建请求。 */
const retryCreateRecovery = async (): Promise<void> => {
    const recovery = createRecovery.value;
    if (!recovery || isCreating.value) return;
    isCreating.value = true;
    try {
        await refreshPickerMutationState({kind: "create"}, recovery.attempt);
    } finally {
        isCreating.value = false;
    }
};

/** 重试指定 Project 的删除事实刷新，不重放删除请求。 */
const retryDeleteRecovery = async (projectRoot: string): Promise<void> => {
    const recovery = deleteRecoveryFor(projectRoot);
    if (!recovery || deleteBusyRoots.value.has(projectRoot)) return;
    deleteBusyRoots.value = new Set([...deleteBusyRoots.value, projectRoot]);
    try {
        await refreshPickerMutationState({kind: "delete", projectRoot}, recovery.attempt);
    } finally {
        deleteBusyRoots.value = new Set([...deleteBusyRoots.value].filter((root) => root !== projectRoot));
    }
};

/** 新建 Project 并立刻打开。 */
const handleCreateNovel = async (payload: ProjectPickerCreatePayload): Promise<void> => {
    if (createRecovery.value) return;
    const title = payload.title.trim();
    if (!title) {
        notification.warning(t("ide.bookshelf.emptyTitleError"));
        return;
    }

    try {
        isCreating.value = true;
        createRecoveryNotice.value = "";
        const projectRoot = await createProject(title, payload.summary.trim());
        isCreateFormOpen.value = false;
        emit("open", projectRoot);
    } catch (error) {
        const commitState = resolveProjectMutationCommitState(error, "create");
        if (commitState === true || commitState === "unknown") {
            const attempt = nextRecoveryAttempt();
            pickerRecoveries.value = beginProjectPickerRecovery(
                pickerRecoveries.value,
                {kind: "create"},
                {attempt, commitState},
            );
            await refreshPickerMutationState({kind: "create"}, attempt);
        } else {
            notification.error(resolveApiErrorMessage(error, t("ide.bookshelf.createOrSwitchFailed")), {
                title: t("ide.bookshelf.createOrSwitchFailed"),
            });
        }
    } finally {
        isCreating.value = false;
    }
};

/** 删除 Project；选择界面下没有已打开 Project，无需处理未保存修改。 */
const handleDeleteNovel = async (project: ProjectMetadataDto): Promise<void> => {
    const {projectRoot, title} = project;
    if (deleteRecoveryFor(projectRoot) || deleteBusyRoots.value.has(projectRoot)) return;
    if (!await confirm(t("ide.bookshelf.deleteConfirm", {title}))) {
        return;
    }
    deleteBusyRoots.value = new Set([...deleteBusyRoots.value, projectRoot]);
    try {
        await deleteProject(projectRoot);
    } catch (error) {
        const commitState = resolveProjectMutationCommitState(error, "delete");
        if (commitState === true || commitState === "unknown") {
            const attempt = nextRecoveryAttempt();
            pickerRecoveries.value = beginProjectPickerRecovery(
                pickerRecoveries.value,
                {kind: "delete", projectRoot},
                {attempt, commitState},
            );
            await refreshPickerMutationState({kind: "delete", projectRoot}, attempt);
        } else {
            notification.error(resolveApiErrorMessage(error, t("ide.bookshelf.deleteFailed")), {
                title: t("ide.bookshelf.deleteFailed"),
            });
        }
    } finally {
        deleteBusyRoots.value = new Set([...deleteBusyRoots.value].filter((root) => root !== projectRoot));
    }
};

/** 构造只携带 Project identity 的封面地址，文件路径始终由服务端 manifest 决定。 */
const projectCoverUrl = (projectRoot: string): string => {
    const query = new URLSearchParams({projectRoot, preset: "project-cover"});
    const refreshVersion = coverRefreshVersions.value[projectRoot];
    if (refreshVersion !== undefined) {
        query.set("refresh", String(refreshVersion));
    }
    return `/api/projects/cover?${query.toString()}`;
};

/** 构造点击预览后才会请求的原图地址。 */
const projectOriginalCoverUrl = (projectRoot: string): string => {
    return `/api/projects/cover?${new URLSearchParams({projectRoot}).toString()}`;
};

/** 图片加载失败后保持本地回退，避免浏览器重复请求同一失效封面。 */
const handleCoverError = (projectRoot: string): void => {
    failedCoverRoots.value = new Set([...failedCoverRoots.value, projectRoot]);
};

/** 打开单一职责的封面设置 Dialog。 */
const openCoverDialog = (project: ProjectMetadataDto): void => {
    coverDialogProject.value = project;
    coverError.value = "";
    coverRecoveryNotice.value = "";
    coverDialogOpen.value = true;
};

/** 关闭封面设置。 */
const closeCoverDialog = (): void => {
    if (coverBusy.value) return;
    coverDialogOpen.value = false;
    coverDialogProject.value = null;
    coverError.value = "";
    coverRecoveryNotice.value = "";
};

/** Store 已发布 metadata 后，只更新封面图片的局部加载状态。 */
const applyCoverMutationResult = (project: ProjectMetadataDto): void => {
    failedCoverRoots.value = new Set([...failedCoverRoots.value].filter((root) => root !== project.projectRoot));
    coverRefreshVersions.value = {
        ...coverRefreshVersions.value,
        [project.projectRoot]: (coverRefreshVersions.value[project.projectRoot] ?? 0) + 1,
    };
};

/**
 * 使用一次完整 Project snapshot 解除所有封面恢复门禁，并让相关封面 URL 全部失效。
 * focusedProjectRoot 只用于更新发起刷新时仍然打开的 Dialog，避免异步结果串到其它 Project。
 */
const settleCoverRecoverySnapshot = (
    list: readonly ProjectMetadataDto[],
    capturedState: ProjectCoverRecoveryState,
    focusedProjectRoot?: string,
): void => {
    const settlement = settleProjectCoverRecoverySnapshot({
        state: coverRecoveries.value,
        capturedState,
        projects: list,
        requestedProjectRoot: focusedProjectRoot,
        activeProjectRoot: coverDialogProject.value?.projectRoot,
    });
    coverRecoveries.value = settlement.state;
    failedCoverRoots.value = new Set();
    if (settlement.cacheBustRoots.length > 0) {
        const nextVersions = {...coverRefreshVersions.value};
        for (const projectRoot of settlement.cacheBustRoots) {
            nextVersions[projectRoot] = (nextVersions[projectRoot] ?? 0) + 1;
        }
        coverRefreshVersions.value = nextVersions;
    }
    if (settlement.focused.kind === "none") {
        return;
    }
    if (settlement.focused.kind === "missing") {
        closeCoverDialog();
        notification.warning(t("ide.picker.coverProjectMissing"));
        return;
    }
    const project = settlement.focused.project;
    coverDialogProject.value = project;
    if (settlement.focused.kind === "committed") {
        closeCoverDialog();
        notification.warning(t("ide.picker.coverCommittedWarning"));
        return;
    }
    coverRecoveryNotice.value = t("ide.picker.coverUnknownRefreshed");
};

/** 应用 create/delete 恢复结算副作用；纯状态判断全部由 helper 完成。 */
const settlePickerRecoverySnapshot = (
    list: readonly ProjectMetadataDto[],
    capturedState: ProjectPickerRecoveryState,
): void => {
    const settlement = settleProjectPickerRecoverySnapshot({
        state: pickerRecoveries.value,
        capturedState,
        projects: list,
    });
    pickerRecoveries.value = settlement.state;
    if (settlement.create === "committed") {
        isCreateFormOpen.value = false;
        createRecoveryNotice.value = "";
        notification.warning(t("ide.picker.createCommittedRefreshed"));
    } else if (settlement.create === "unknown") {
        isCreateFormOpen.value = true;
        createRecoveryNotice.value = t("ide.picker.createUnknownRefreshed");
    }
    for (const deleted of settlement.deletes) {
        if (deleted.outcome === "missing") {
            forgetProject(deleted.projectRoot);
            notification.success(t("ide.picker.deleteRecoveredMissing"));
        } else {
            notification.warning(t("ide.picker.deleteRecoveredPresent"));
        }
    }
};

/**
 * 重新读取服务端 Project snapshot，解除 committed true/unknown 的重试门禁。
 * 刷新失败时保留门禁，避免用户继续基于旧 metadata 修改同一封面。
 */
const refreshCoverMutationState = async (projectRoot: string): Promise<void> => {
    const recovery = coverRecoveries.value.get(projectRoot);
    if (!recovery) return;
    const capturedCoverRecoveries = coverRecoveries.value;
    const capturedPickerRecoveries = pickerRecoveries.value;
    coverBusy.value = true;
    try {
        const snapshot = await refreshProjects();
        coverBusy.value = false;
        settleCoverRecoverySnapshot(snapshot.projects, capturedCoverRecoveries, projectRoot);
        settlePickerRecoverySnapshot(snapshot.projects, capturedPickerRecoveries);
    } catch (error) {
        coverRecoveries.value = reduceProjectCoverRecovery(coverRecoveries.value, {
            type: "failure",
            projectRoot,
            attempt: recovery.attempt,
            error: resolveApiErrorMessage(error, t("ide.picker.coverRecoveryRefreshFailed")),
        });
    } finally {
        coverBusy.value = false;
    }
};

/** 按公开 committed 状态决定普通报错或先刷新事实。 */
const handleCoverMutationError = async (error: unknown, fallback: string, projectRoot: string): Promise<void> => {
    const commitState = resolveProjectMutationCommitState(error, "cover-update");
    if (commitState === true || commitState === "unknown") {
        const attempt = nextRecoveryAttempt();
        coverRecoveries.value = reduceProjectCoverRecovery(coverRecoveries.value, {
            type: "begin",
            projectRoot,
            attempt,
            commitState,
        });
        coverError.value = "";
        await refreshCoverMutationState(projectRoot);
        return;
    }
    coverError.value = resolveApiErrorMessage(error, fallback);
    coverBusy.value = false;
};

/** 上传原始 bytes；目标路径完全由服务端内容寻址策略决定。 */
const handleUploadCover = async ({project, file}: {project: ProjectMetadataDto; file: File}): Promise<void> => {
    coverBusy.value = true;
    coverError.value = "";
    coverRecoveryNotice.value = "";
    try {
        const updated = await updateProjectCover(project.projectRoot, file);
        applyCoverMutationResult(updated);
        coverBusy.value = false;
        closeCoverDialog();
    } catch (error) {
        await handleCoverMutationError(error, t("ide.picker.coverUploadFailed"), project.projectRoot);
    }
};

/** 用户确认后清除 manifest 引用；服务端只清理应用托管原图。 */
const handleClearCover = async (project: ProjectMetadataDto): Promise<void> => {
    if (!project?.cover || !await confirm(t("ide.picker.coverClearConfirm", {title: project.title}))) {
        return;
    }
    coverBusy.value = true;
    coverError.value = "";
    coverRecoveryNotice.value = "";
    try {
        const updated = await updateProjectCover(project.projectRoot, null);
        applyCoverMutationResult(updated);
        coverBusy.value = false;
        closeCoverDialog();
    } catch (error) {
        await handleCoverMutationError(error, t("ide.picker.coverClearFailed"), project.projectRoot);
    }
};
</script>

<template>
    <!-- loading="lazy" decoding="async" delegated to ProjectCard.vue -->
    <ProjectPickerView
        :projects="novels"
        :layout-mode="projectPickerLayoutMode"
        :is-loading="isLoading"
        :load-error="loadError"
        :is-creating="isCreating"
        :is-create-form-open="isCreateFormOpen"
        :create-recovery-notice="createRecoveryNotice"
        :create-recovery="createRecovery"
        :delete-busy-roots="deleteBusyRoots"
        :picker-recoveries="pickerRecoveries"
        :cover-recoveries="coverRecoveries"
        :cover-refresh-versions="coverRefreshVersions"
        :failed-cover-roots="failedCoverRoots"
        :recovery-expanded="recoveryExpanded"
        :recovery-loading="recoveryLoading"
        :recovery-loaded="recoveryLoaded"
        :recovery-error="recoveryError"
        :recovery-sessions="recoverySessions"
        :recovery-total="recoveryTotal"
        :recovery-has-more="recoveryHasMore"
        :recovery-action-id="recoveryActionId"
        :resolve-cover-url="projectCoverUrl"
        :resolve-original-cover-url="projectOriginalCoverUrl"
        :cover-dialog-open="coverDialogOpen"
        :cover-dialog-project="coverDialogProject"
        :cover-busy="coverBusy"
        :cover-error="coverError"
        :cover-recovery-notice="coverRecoveryNotice"
        @update:layout-mode="projectPickerLayoutMode = $event"
        @update:cover-dialog-open="coverDialogOpen = $event"
        @update:cover-dialog-project="coverDialogProject = $event"
        @open="emit('open', $event)"
        @open-user-assets="emit('open-user-assets')"
        @open-create-form="openCreateForm"
        @cancel-create-form="cancelCreateForm"
        @create="handleCreateNovel"
        @retry-create-recovery="retryCreateRecovery"
        @delete="handleDeleteNovel"
        @retry-delete-recovery="retryDeleteRecovery"
        @retry-load="loadProjects"
        @toggle-recovery="toggleRecovery"
        @load-more-recovery="loadRecoverySessions(recoveryOffset, true)"
        @retry-recovery="loadRecoverySessions(0, false)"
        @recover-session="recoverSession"
        @open-cover-dialog="openCoverDialog"
        @close-cover-dialog="closeCoverDialog"
        @upload-cover="handleUploadCover"
        @clear-cover="handleClearCover"
        @retry-cover-recovery="refreshCoverMutationState"
        @cover-error="handleCoverError"
    />
</template>
