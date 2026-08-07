<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useDialog } from "nbook/app/composables/useDialog";
import { useNotification } from "nbook/app/composables/useNotification";
import { useNovelIdeStore } from "nbook/app/stores/novel-ide";
import { useAgentSessionApi } from "nbook/app/composables/useAgentSessionApi";
import { resolveApiErrorMessage } from "nbook/app/utils/api-error";
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
import {formatTimestamp} from "nbook/app/components/novel-ide/agent/agent-message";
import Dialog from "nbook/app/components/common/Dialog.vue";
import OriginalImagePreviewDialog from "nbook/app/components/common/OriginalImagePreviewDialog.vue";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import type {AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import {canonicalImageMime, isUnspecifiedImageMime} from "nbook/shared/media/raster-image";

/**
 * 未选择 Project 时的首页项目选择界面。
 *
 * 负责列出、新建、删除与封面管理；进入 Project 由宿主页面（index.vue）通过路由完成，
 * 因此这里不感知 URL 形态；选择界面允许「零项目」空态存在。
 */

const emit = defineEmits<{
    (e: "open", projectRoot: string): void;
    (e: "open-user-assets"): void;
}>();

const { confirm } = useDialog();
const notification = useNotification();
const sessionApi = useAgentSessionApi();
const novelIdeStore = useNovelIdeStore();
const { novels } = storeToRefs(novelIdeStore);
const {
    loadProjects: refreshProjects,
    createProject,
    deleteProject,
    forgetProject,
    updateProjectCover,
} = novelIdeStore;
const { t, locale } = useI18n();

const isLoading = ref(true);
const loadError = ref("");
const isCreating = ref(false);
const isCreateFormOpen = ref(false);
const createTitle = ref(t("ide.bookshelf.defaultTitle"));
const createSummary = ref("");
const createRecoveryNotice = ref("");
const createTitleInput = ref<HTMLInputElement | null>(null);
const pickerRecoveries = ref<ProjectPickerRecoveryState>(emptyProjectPickerRecovery());
const deleteBusyRoots = ref<Set<string>>(new Set());
const failedCoverRoots = ref<Set<string>>(new Set());
const coverRefreshVersions = ref<Record<string, number>>({});
const coverDialogOpen = ref(false);
const coverDialogProject = ref<ProjectMetadataDto | null>(null);
const coverFile = ref<File | null>(null);
const coverPreviewUrl = ref("");
const coverError = ref("");
const coverBusy = ref(false);
const coverInput = ref<HTMLInputElement | null>(null);
const coverRecoveries = ref<ProjectCoverRecoveryState>(new Map());
const coverRecoveryNotice = ref("");
const originalPreviewOpen = ref(false);
const originalPreviewUrl = ref("");
const originalPreviewAlt = ref("");
const originalPreviewName = ref("");
const recoveryExpanded = ref(false);
const recoveryLoading = ref(false);
const recoveryLoaded = ref(false);
const recoveryError = ref("");
const recoverySessions = ref<AgentSessionSummaryDto[]>([]);
const recoveryOffset = ref(0);
const recoveryHasMore = ref(false);
const recoveryTotal = ref(0);
const recoveryTargets = ref<Record<number, string>>(Object.create(null) as Record<number, string>);
const recoveryActionId = ref<number | null>(null);
let recoveryAttempt = 0;
const RECOVERY_PAGE_SIZE = 20;
const currentCoverRecovery = computed(() => {
    const projectRoot = coverDialogProject.value?.projectRoot;
    return projectRoot ? coverRecoveries.value.get(projectRoot) : undefined;
});
const coverNeedsRefresh = computed(() => currentCoverRecovery.value !== undefined);
const createRecovery = computed(() => pickerRecoveries.value.create);
const dateFormatter = computed(() => new Intl.DateTimeFormat(locale.value, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
}));

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
const recoverSession = async (session: AgentSessionSummaryDto, workspaceRoot: boolean): Promise<void> => {
    const target = recoveryTargets.value[session.sessionId] ?? "";
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
        const nextTargets = {...recoveryTargets.value};
        delete nextTargets[session.sessionId];
        recoveryTargets.value = nextTargets;
        notification.success("会话归属已确认", {title: "会话可以继续使用"});
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "确认会话归属失败"), {title: "确认失败"});
    } finally {
        recoveryActionId.value = null;
    }
};

/**
 * 打开就地新建表单。
 */
const openCreateForm = async (): Promise<void> => {
    isCreateFormOpen.value = true;
    createRecoveryNotice.value = "";
    createTitle.value = t("ide.bookshelf.defaultTitle");
    createSummary.value = "";
    await nextTick();
    createTitleInput.value?.select();
};

/**
 * 取消就地新建。
 */
const cancelCreateForm = (): void => {
    if (isCreating.value || createRecovery.value) return;
    isCreateFormOpen.value = false;
    createTitle.value = t("ide.bookshelf.defaultTitle");
    createSummary.value = "";
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

/**
 * 新建 Project 并立刻打开。
 */
const handleCreateNovel = async (): Promise<void> => {
    if (createRecovery.value) return;
    const title = createTitle.value.trim();
    if (!title) {
        notification.warning(t("ide.bookshelf.emptyTitleError"));
        return;
    }

    try {
        isCreating.value = true;
        createRecoveryNotice.value = "";
        const projectRoot = await createProject(title, createSummary.value.trim());
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
            notification.error(resolveApiErrorMessage(error, t("ide.bookshelf.createOrSwitchFailed")), {title: t("ide.bookshelf.createOrSwitchFailed")});
        }
    } finally {
        isCreating.value = false;
    }
};

/**
 * 删除 Project；选择界面下没有已打开 Project，无需处理未保存修改。
 */
const handleDeleteNovel = async (projectRoot: string, title: string): Promise<void> => {
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
            notification.error(resolveApiErrorMessage(error, t("ide.bookshelf.deleteFailed")), {title: t("ide.bookshelf.deleteFailed")});
        }
    } finally {
        deleteBusyRoots.value = new Set([...deleteBusyRoots.value].filter((root) => root !== projectRoot));
    }
};

/**
 * 卡片上的更新时间。
 */
const formatDate = (dateString?: string): string => {
    if (!dateString) {
        return "";
    }
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    return dateFormatter.value.format(date);
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
    resetCoverSelection();
    coverDialogProject.value = project;
    coverError.value = "";
    coverRecoveryNotice.value = "";
    coverDialogOpen.value = true;
};

/** 清空本地待上传文件并释放浏览器 blob URL。 */
const resetCoverSelection = (): void => {
    coverFile.value = null;
    if (coverPreviewUrl.value) {
        URL.revokeObjectURL(coverPreviewUrl.value);
        coverPreviewUrl.value = "";
    }
};

/** 关闭封面设置并释放本地预览 URL。 */
const closeCoverDialog = (): void => {
    if (coverBusy.value) {
        return;
    }
    coverDialogOpen.value = false;
    coverDialogProject.value = null;
    coverError.value = "";
    coverRecoveryNotice.value = "";
    resetCoverSelection();
};

/** Dialog 的遮罩、Esc 与标题栏关闭统一经过资源和恢复状态清理。 */
const updateCoverDialogOpen = (open: boolean): void => {
    if (!open) {
        closeCoverDialog();
    }
};

/** 校验本地封面选择并建立只在 Dialog 内使用的预览 URL。 */
const selectCoverFile = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    coverError.value = "";
    coverRecoveryNotice.value = "";
    if (!file) {
        return;
    }
    const declaredMime = canonicalImageMime(file.type);
    if (!isUnspecifiedImageMime(file.type) && (declaredMime === null || declaredMime === "image/gif")) {
        coverError.value = t("ide.picker.coverTypeUnsupported");
        return;
    }
    if (file.size > 20 * 1024 * 1024) {
        coverError.value = t("ide.picker.coverTooLarge");
        return;
    }
    if (coverPreviewUrl.value) {
        URL.revokeObjectURL(coverPreviewUrl.value);
    }
    coverFile.value = file;
    coverPreviewUrl.value = URL.createObjectURL(file);
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
    resetCoverSelection();
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
        createTitle.value = t("ide.bookshelf.defaultTitle");
        createSummary.value = "";
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
    if (!recovery) {
        return;
    }
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
const uploadCover = async (): Promise<void> => {
    const project = coverDialogProject.value;
    const file = coverFile.value;
    if (!project || !file) {
        return;
    }
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
const clearCover = async (): Promise<void> => {
    const project = coverDialogProject.value;
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

/** 打开共享原图预览；本地待上传文件不会触发服务端请求。 */
const previewCoverOriginal = (): void => {
    const project = coverDialogProject.value;
    if (!project) {
        return;
    }
    const src = coverPreviewUrl.value || (project.cover ? projectOriginalCoverUrl(project.projectRoot) : "");
    if (!src) {
        return;
    }
    originalPreviewUrl.value = src;
    originalPreviewAlt.value = t("ide.picker.coverAlt", {title: project.title});
    originalPreviewName.value = coverFile.value?.name ?? "";
    originalPreviewOpen.value = true;
};

onBeforeUnmount(() => {
    if (coverPreviewUrl.value) {
        URL.revokeObjectURL(coverPreviewUrl.value);
    }
});
</script>

<template>
    <!-- 项目选择界面根容器 -->
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--bg-main)] text-[var(--text-main)]">
        <!-- 项目工作台主体 -->
        <main class="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-5 py-8 sm:px-6 sm:py-10 lg:px-8">
            <!-- 页面标题与主操作 -->
            <section class="flex flex-col gap-5 border-b border-[var(--border-color)] pb-7 sm:flex-row sm:items-end sm:justify-between">
                <div class="min-w-0">
                    <h1 class="font-serif text-2xl font-bold text-[var(--text-main)]">{{ t("ide.picker.title") }}</h1>
                    <p class="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{{ t("ide.picker.subtitle") }}</p>
                </div>
                <div class="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
                    <button type="button" class="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-4 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-main)]" @click="emit('open-user-assets')">
                        <span class="i-lucide-folder-cog h-4 w-4"></span>
                        {{ t("ide.picker.openUserAssets") }}
                    </button>
                    <button type="button" class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--accent-main)] px-4 text-sm font-medium text-[var(--text-inverse)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-main)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-main)] disabled:cursor-not-allowed disabled:opacity-60" :disabled="isLoading || Boolean(loadError) || isCreating" :aria-expanded="isCreateFormOpen" @click="void openCreateForm()">
                        <span class="i-lucide-book-plus h-4 w-4"></span>
                        {{ t("ide.bookshelf.createBook") }}
                    </button>
                </div>
            </section>

            <!-- 独立新建工具面板，避免改变项目网格单行高度。 -->
            <form v-if="isCreateFormOpen" class="rounded-lg border border-[var(--border-accent)] bg-[var(--bg-panel)] p-4 sm:p-5" @keydown.esc.stop.prevent="cancelCreateForm" @submit.prevent="void handleCreateNovel()">
                <div class="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-main)]">
                    <span class="i-lucide-book-plus h-4 w-4 text-[var(--accent-text)]"></span>
                    {{ t("ide.bookshelf.createBook") }}
                </div>
                <div v-if="createRecoveryNotice" class="mb-4 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-sm text-[var(--status-warning)]" role="status">{{ createRecoveryNotice }}</div>
                <div v-if="createRecovery" class="mb-4 space-y-2 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-sm text-[var(--status-danger)]" role="alert">
                    <p>{{ createRecovery.error || t("ide.picker.createRecoveryRequired") }}</p>
                    <button type="button" class="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--status-danger-border)] bg-[var(--bg-panel)] px-3 text-xs font-medium hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="isCreating" @click="void retryCreateRecovery()"><span class="i-lucide-refresh-cw h-3.5 w-3.5" :class="isCreating ? 'animate-spin' : ''"></span>{{ t("ide.picker.mutationRecoveryRetry") }}</button>
                </div>
                <div class="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_auto] lg:items-end">
                    <label class="block text-xs text-[var(--text-secondary)]">
                        <span class="mb-1.5 block">{{ t("ide.bookshelf.bookTitle") }}</span>
                        <input ref="createTitleInput" v-model="createTitle" class="h-10 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)]" maxlength="120" :disabled="isCreating || Boolean(createRecovery)" autofocus>
                    </label>
                    <label class="block text-xs text-[var(--text-secondary)]">
                        <span class="mb-1.5 block">{{ t("ide.bookshelf.summary") }}</span>
                        <textarea v-model="createSummary" class="h-20 w-full resize-none rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm leading-5 text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)] lg:h-10" maxlength="2000" :disabled="isCreating || Boolean(createRecovery)"></textarea>
                    </label>
                    <div class="grid grid-cols-2 gap-2 lg:flex">
                        <button type="button" class="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-60" :disabled="isCreating || Boolean(createRecovery)" @click="cancelCreateForm">
                            <span class="i-lucide-x h-4 w-4"></span>
                            {{ t("ide.bookshelf.cancel") }}
                        </button>
                        <button type="submit" class="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-[var(--accent-main)] px-4 text-sm font-medium text-[var(--text-inverse)] transition-opacity hover:opacity-90 disabled:opacity-60" :disabled="isCreating || Boolean(createRecovery)">
                            <span v-if="isCreating" class="i-lucide-loader-2 h-4 w-4 animate-spin"></span>
                            <span v-else class="i-lucide-check h-4 w-4"></span>
                            {{ isCreating ? t("ide.bookshelf.creating") : t("ide.bookshelf.create") }}
                        </button>
                    </div>
                </div>
            </form>

            <!-- 加载态：骨架尺寸与最终书封保持一致。 -->
            <section v-if="isLoading" role="status" aria-live="polite">
                <div class="mb-5 flex items-center justify-between gap-4">
                    <div class="h-5 w-24 animate-pulse rounded-md bg-[var(--bg-input)]"></div>
                    <span class="text-xs text-[var(--text-muted)]">{{ t("ide.picker.loading") }}</span>
                </div>
                <div class="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    <div v-for="index in 10" :key="index" class="min-w-0 animate-pulse">
                        <div class="aspect-[2/3] rounded-[4px] border border-[var(--border-color)] bg-[var(--bg-input)]"></div>
                        <div class="mt-4 h-4 w-4/5 rounded-md bg-[var(--bg-input)]"></div>
                        <div class="mt-2 h-3 w-1/2 rounded-md bg-[var(--bg-input)]"></div>
                        <div class="mt-3 h-3 w-2/3 rounded-md bg-[var(--bg-input)]"></div>
                    </div>
                </div>
            </section>

            <!-- 列表读取失败时保留错误详情与恢复入口。 -->
            <section v-else-if="loadError" class="flex min-h-[240px] flex-col items-center justify-center rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-6 py-10 text-center" role="alert">
                <span class="i-lucide-cloud-alert h-7 w-7 text-[var(--status-danger)]"></span>
                <h2 class="mt-4 text-base font-semibold text-[var(--text-main)]">{{ t("ide.picker.loadFailed") }}</h2>
                <p class="mt-2 max-w-[560px] break-words text-sm leading-6 text-[var(--text-secondary)]">{{ loadError }}</p>
                <button type="button" class="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--status-danger-border)] bg-[var(--bg-panel)] px-4 text-sm font-medium text-[var(--status-danger)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--status-danger)]" @click="void loadProjects()">
                    <span class="i-lucide-refresh-cw h-4 w-4"></span>
                    {{ t("ide.picker.retry") }}
                </button>
            </section>

            <!-- 零项目空态 -->
            <section v-else-if="novels.length === 0" class="flex min-h-[300px] flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--bg-subtle)] px-6 py-10 text-center">
                <div class="flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--accent-text)]">
                    <span class="i-lucide-book-open-text h-6 w-6"></span>
                </div>
                <h2 class="mt-4 text-base font-semibold text-[var(--text-main)]">{{ t("ide.picker.emptyTitle") }}</h2>
                <p class="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{{ t("ide.picker.empty") }}</p>
                <button type="button" class="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--accent-main)] px-4 text-sm font-medium text-[var(--text-inverse)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-main)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-main)]" @click="void openCreateForm()">
                    <span class="i-lucide-book-plus h-4 w-4"></span>
                    {{ t("ide.bookshelf.createBook") }}
                </button>
            </section>

            <!-- 最近项目 -->
            <section v-else>
                <div class="mb-5 flex items-center justify-between gap-4">
                    <h2 class="text-sm font-semibold text-[var(--text-main)]">{{ t("ide.picker.recentProjects") }}</h2>
                    <span class="text-xs text-[var(--text-muted)]">{{ t("ide.picker.projectCount", {count: novels.length}) }}</span>
                </div>
                <div class="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    <!-- 每本书以封面为主；打开按钮与删除按钮保持兄弟关系。 -->
                    <article v-for="novel in novels" :key="novel.projectRoot" class="group relative min-w-0">
                        <button type="button" class="block w-full text-left focus-visible:outline-none" :aria-label="t('ide.picker.openProject', {title: novel.title})" @click="emit('open', novel.projectRoot)">
                            <!-- 书封：真实图片失败或未配置时回退到排版封面。 -->
                            <span class="project-cover relative block aspect-[2/3] overflow-hidden rounded-[4px] border border-[var(--border-color)] bg-[var(--bg-panel)] transition-transform duration-200 group-hover:-translate-y-1 group-focus-within:-translate-y-1">
                                <img v-if="novel.cover && !failedCoverRoots.has(novel.projectRoot)" :key="`${novel.projectRoot}:${String(coverRefreshVersions[novel.projectRoot] ?? 0)}`" class="h-full w-full object-cover" :src="projectCoverUrl(novel.projectRoot)" :alt="t('ide.picker.coverAlt', {title: novel.title})" loading="lazy" decoding="async" @error="handleCoverError(novel.projectRoot)">
                                <span v-else class="project-cover-fallback absolute inset-0 flex flex-col items-center justify-between overflow-hidden px-4 py-6 text-center">
                                    <span class="flex w-full items-center gap-2 text-[10px] font-medium text-[var(--text-muted)]">
                                        <span class="h-px flex-1 bg-[var(--border-color)]"></span>
                                        <span class="i-lucide-feather h-3.5 w-3.5 text-[var(--accent-text)]"></span>
                                        <span class="h-px flex-1 bg-[var(--border-color)]"></span>
                                    </span>
                                    <span class="line-clamp-4 break-words font-serif text-lg font-bold leading-7 text-[var(--text-main)] sm:text-xl">{{ novel.title }}</span>
                                    <span class="h-1 w-9 bg-[var(--accent-main)]"></span>
                                </span>
                                <span class="project-cover-spine absolute inset-y-0 left-0 w-2 border-r border-[var(--border-color)]"></span>
                                <span class="project-cover-page absolute inset-y-2 right-0 w-1 border-l border-[var(--border-color)]"></span>
                            </span>
                            <span class="project-shelf-board block h-2" aria-hidden="true"></span>

                            <!-- 书名与辅助信息退到封面下方。 -->
                            <span class="mt-3 block min-w-0">
                                <span class="line-clamp-2 break-words font-serif text-base font-bold leading-5 text-[var(--text-main)]">{{ novel.title }}</span>
                                <span v-if="novel.summary" class="mt-1.5 line-clamp-2 break-words text-xs leading-5 text-[var(--text-secondary)]">{{ novel.summary }}</span>
                                <span v-if="formatDate(novel.manifestUpdatedAt)" class="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--text-muted)]" :title="t('ide.picker.manifestUpdatedAtTitle', {time: formatDate(novel.manifestUpdatedAt)})">
                                    <span class="i-lucide-clock-3 h-3.5 w-3.5 shrink-0"></span>
                                    <span class="truncate">{{ t("ide.picker.manifestUpdatedAt", {time: formatDate(novel.manifestUpdatedAt)}) }}</span>
                                </span>
                            </span>
                        </button>
                        <!-- 封面与删除控件是打开按钮的兄弟节点，避免嵌套交互元素。 -->
                        <div class="project-card-actions absolute right-2 top-2 z-10 flex gap-1.5 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                            <button type="button" class="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-muted)] transition-colors hover:border-[var(--border-accent)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)] focus-visible:border-[var(--border-accent)] focus-visible:text-[var(--accent-text)] focus-visible:outline-none" :title="t('ide.picker.setCover')" :aria-label="t('ide.picker.setCover')" @click="openCoverDialog(novel)">
                                <span class="i-lucide-image-plus h-4 w-4"></span>
                            </button>
                            <button type="button" class="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-muted)] transition-colors hover:border-[var(--status-danger-border)] hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)] focus-visible:border-[var(--status-danger-border)] focus-visible:bg-[var(--status-danger-bg)] focus-visible:text-[var(--status-danger)] focus-visible:outline-none disabled:opacity-50" :title="t('ide.bookshelf.deleteBook')" :aria-label="t('ide.bookshelf.deleteBook')" :disabled="deleteBusyRoots.has(novel.projectRoot) || Boolean(deleteRecoveryFor(novel.projectRoot))" @click="void handleDeleteNovel(novel.projectRoot, novel.title)">
                                <span :class="deleteBusyRoots.has(novel.projectRoot) ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-trash-2'" class="h-4 w-4"></span>
                            </button>
                        </div>
                        <div v-if="deleteRecoveryFor(novel.projectRoot)" class="mt-3 space-y-2 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-xs text-[var(--status-danger)]" role="alert">
                            <p>{{ deleteRecoveryFor(novel.projectRoot)?.error || t("ide.picker.deleteRecoveryRequired") }}</p>
                            <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--status-danger-border)] bg-[var(--bg-panel)] px-2.5 font-medium disabled:opacity-50" :disabled="deleteBusyRoots.has(novel.projectRoot)" @click="void retryDeleteRecovery(novel.projectRoot)"><span class="i-lucide-refresh-cw h-3.5 w-3.5" :class="deleteBusyRoots.has(novel.projectRoot) ? 'animate-spin' : ''"></span>{{ t("ide.picker.mutationRecoveryRetry") }}</button>
                        </div>
                    </article>
                </div>
            </section>

            <!-- Session v2 恢复入口：默认折叠，展开后才请求需要人工确认的分页数据。 -->
            <section class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)]">
                <button type="button" class="flex w-full items-center justify-between gap-4 px-4 py-3 text-left sm:px-5" :aria-expanded="recoveryExpanded" @click="void toggleRecovery()">
                    <span class="min-w-0">
                        <span class="flex items-center gap-2 text-sm font-semibold text-[var(--text-main)]">
                            <span class="i-lucide-message-square-warning h-4 w-4 text-[var(--status-warning)]"></span>
                            {{ t("ide.picker.recoveryTitle") }}
                            <span v-if="recoveryLoaded" class="rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-0.5 text-[10px] font-normal text-[var(--text-muted)]">{{ t("ide.picker.recoveryCount", {count: recoveryTotal}) }}</span>
                        </span>
                        <span class="mt-1 block text-xs leading-5 text-[var(--text-secondary)]">{{ t("ide.picker.recoverySummary") }}</span>
                    </span>
                    <span class="i-lucide-chevron-down h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform" :class="recoveryExpanded ? 'rotate-180' : ''"></span>
                </button>

                <div v-if="recoveryExpanded" class="border-t border-[var(--border-color)] px-4 py-4 sm:px-5">
                    <div v-if="recoveryLoading && !recoveryLoaded" class="flex items-center justify-center gap-2 py-8 text-sm text-[var(--text-muted)]" role="status">
                        <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                        {{ t("ide.picker.loading") }}
                    </div>
                    <div v-else-if="recoveryError" class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-3 text-sm text-[var(--status-danger)]">
                        <p>{{ recoveryError }}</p>
                        <button type="button" class="mt-3 rounded-md border border-[var(--status-danger-border)] bg-[var(--bg-panel)] px-3 py-1.5 text-xs" @click="void loadRecoverySessions(0, false)">{{ t("ide.picker.recoveryRetry") }}</button>
                    </div>
                    <div v-else-if="recoverySessions.length === 0" class="py-8 text-center text-sm text-[var(--text-muted)]">{{ t("ide.picker.recoveryEmpty") }}</div>
                    <div v-else class="space-y-3">
                        <article v-for="session in recoverySessions" :key="session.sessionId" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-main)] p-3">
                            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <div class="min-w-0">
                                    <h3 class="truncate text-sm font-medium text-[var(--text-main)]">{{ session.title || "Session " + session.sessionId }}</h3>
                                    <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
                                        <span>{{ session.profileKey }}</span>
                                        <span>{{ formatTimestamp(session.updatedAt) }}</span>
                                        <span class="text-[var(--status-warning)]">{{ t("ide.picker.recoveryReason") }}</span>
                                    </div>
                                </div>
                                <div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                                    <select v-model="recoveryTargets[session.sessionId]" class="h-9 min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs text-[var(--text-main)] sm:w-[240px]" :disabled="recoveryActionId === session.sessionId">
                                        <option value="">{{ t("ide.picker.recoveryProject") }}</option>
                                        <option v-for="novel in novels" :key="novel.projectRoot" :value="novel.projectRoot">{{ novel.title }} · {{ novel.projectRoot }}</option>
                                    </select>
                                    <button type="button" class="h-9 rounded-md bg-[var(--accent-main)] px-3 text-xs font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="recoveryActionId === session.sessionId || !recoveryTargets[session.sessionId]" @click="void recoverSession(session, false)">{{ t("ide.picker.recoveryConfirm") }}</button>
                                    <button type="button" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="recoveryActionId === session.sessionId" @click="void recoverSession(session, true)">{{ t("ide.picker.recoveryWorkspaceRoot") }}</button>
                                </div>
                            </div>
                        </article>
                        <button v-if="recoveryHasMore" type="button" class="mx-auto flex h-9 items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-4 text-xs text-[var(--text-secondary)] disabled:opacity-50" :disabled="recoveryLoading" @click="void loadRecoverySessions(recoveryOffset, true)">
                            <span v-if="recoveryLoading" class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                            {{ t("ide.picker.recoveryLoadMore") }}
                        </button>
                    </div>
                </div>
            </section>
        </main>

        <!-- Project 封面设置：只负责上传、替换与清除，不扩展成综合编辑器。 -->
        <Dialog :model-value="coverDialogOpen" size="md" :title="t('ide.picker.coverDialogTitle')" :busy="coverBusy" :show-footer="false" overlay-type="opaque" @request-close="closeCoverDialog" @update:model-value="updateCoverDialogOpen">
            <div v-if="coverDialogProject" class="space-y-4">
                <button v-if="coverPreviewUrl || coverDialogProject.cover" type="button" class="mx-auto block w-full max-w-[240px] focus-visible:outline-none" :aria-label="t('ide.imagePreview.openOriginal')" @click="previewCoverOriginal">
                    <span class="relative block aspect-[2/3] overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] focus-visible:ring-2 focus-visible:ring-[var(--accent-main)]">
                        <img :src="coverPreviewUrl || projectCoverUrl(coverDialogProject.projectRoot)" :alt="t('ide.picker.coverAlt', {title: coverDialogProject.title})" class="h-full w-full object-cover" decoding="async">
                        <span class="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-main)]">
                            <span class="i-lucide-maximize-2 h-4 w-4"></span>
                        </span>
                    </span>
                </button>
                <div v-else class="mx-auto flex aspect-[2/3] w-full max-w-[240px] flex-col items-center justify-center gap-3 rounded-md border border-dashed border-[var(--border-color)] bg-[var(--bg-subtle)] text-[var(--text-muted)]">
                    <span class="i-lucide-image h-8 w-8"></span>
                    <span class="text-sm">{{ t("ide.picker.coverEmpty") }}</span>
                </div>

                <input ref="coverInput" type="file" class="hidden" accept="image/png,image/jpeg,image/webp" :disabled="coverBusy || coverNeedsRefresh" @change="selectCoverFile">
                <div class="flex flex-wrap items-center justify-center gap-2">
                    <button type="button" class="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="coverBusy || coverNeedsRefresh" @click="coverInput?.click()">
                        <span class="i-lucide-folder-open h-4 w-4"></span>
                        {{ coverDialogProject.cover ? t("ide.picker.replaceCover") : t("ide.picker.chooseCover") }}
                    </button>
                    <button v-if="coverDialogProject.cover" type="button" class="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 text-sm text-[var(--status-danger)] hover:opacity-85 disabled:opacity-50" :disabled="coverBusy || coverNeedsRefresh" @click="void clearCover()">
                        <span class="i-lucide-trash-2 h-4 w-4"></span>
                        {{ t("ide.picker.clearCover") }}
                    </button>
                </div>

                <p class="text-center text-xs leading-5 text-[var(--text-muted)]">{{ t("ide.picker.coverRequirements") }}</p>
                <div v-if="coverRecoveryNotice" class="rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-sm text-[var(--status-warning)]" role="status">{{ coverRecoveryNotice }}</div>
                <div v-if="coverNeedsRefresh" class="space-y-2 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-sm text-[var(--status-danger)]" role="alert">
                    <p>{{ currentCoverRecovery?.error || t("ide.picker.coverRecoveryRequired") }}</p>
                    <button type="button" class="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--status-danger-border)] bg-[var(--bg-panel)] px-3 text-xs font-medium hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="coverBusy" @click="void refreshCoverMutationState(coverDialogProject.projectRoot)"><span class="i-lucide-refresh-cw h-3.5 w-3.5" :class="coverBusy ? 'animate-spin' : ''"></span>{{ t("ide.picker.coverRecoveryRetry") }}</button>
                </div>
                <div v-if="coverError" class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-sm text-[var(--status-danger)]" role="alert">{{ coverError }}</div>

                <div class="flex items-center justify-end gap-2 border-t border-[var(--border-color)] pt-4">
                    <button type="button" class="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-4 text-sm text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="coverBusy" @click="closeCoverDialog">{{ t("common.cancel") }}</button>
                    <button type="button" class="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--accent-main)] px-4 text-sm font-medium text-[var(--text-inverse)] hover:opacity-90 disabled:opacity-50" :disabled="coverBusy || coverNeedsRefresh || !coverFile" @click="void uploadCover()">
                        <span v-if="coverBusy" class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                        <span v-else class="i-lucide-upload h-4 w-4"></span>
                        {{ t("ide.picker.saveCover") }}
                    </button>
                </div>
            </div>
        </Dialog>

        <OriginalImagePreviewDialog v-model="originalPreviewOpen" :src="originalPreviewUrl" :alt="originalPreviewAlt" :download-name="originalPreviewName" />
    </div>
</template>

<style scoped>
.project-cover {
    box-shadow:
        0 2px 0 color-mix(in srgb, var(--border-strong) 72%, transparent),
        0 12px 24px color-mix(in srgb, var(--shadow-color) 13%, transparent);
}

button:focus-visible > .project-cover {
    border-color: var(--accent-main);
    box-shadow:
        0 0 0 2px var(--bg-main),
        0 0 0 4px var(--accent-main),
        0 12px 24px color-mix(in srgb, var(--shadow-color) 13%, transparent);
}

.project-cover-fallback {
    background-color: var(--bg-panel);
}

.project-cover-fallback::before,
.project-cover-fallback::after {
    position: absolute;
    right: 14%;
    left: 14%;
    height: 1px;
    content: "";
    background-color: var(--border-color);
}

.project-cover-fallback::before {
    top: 24%;
}

.project-cover-fallback::after {
    bottom: 24%;
}

.project-cover-fallback > * {
    position: relative;
    z-index: 1;
}

.project-cover-spine {
    background-color: color-mix(in srgb, var(--accent-bg) 58%, var(--bg-panel));
}

.project-cover-page {
    background-color: color-mix(in srgb, var(--bg-input) 72%, var(--bg-panel));
}

.project-shelf-board {
    margin-right: -4px;
    margin-left: -4px;
    border-top: 1px solid var(--border-strong);
    border-radius: 0 0 3px 3px;
    background-color: color-mix(in srgb, var(--bg-sidebar) 78%, var(--bg-panel));
    box-shadow: 0 5px 8px color-mix(in srgb, var(--shadow-color) 10%, transparent);
}

@media (hover: none) {
    .project-card-actions {
        opacity: 1;
    }
}
</style>
