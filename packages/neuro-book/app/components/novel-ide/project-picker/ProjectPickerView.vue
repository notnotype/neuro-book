<script setup lang="ts">
import {ref, computed} from "vue";
import {Button, Spinner} from "@notnotype/nb-ui/components";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import type {AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import OriginalImagePreviewDialog from "nbook/app/components/common/OriginalImagePreviewDialog.vue";
import ProjectCard from "./components/ProjectCard.vue";
import ProjectCreateForm from "./components/ProjectCreateForm.vue";
import ProjectCoverDialog from "./components/ProjectCoverDialog.vue";
import type {
    ProjectPickerCreatePayload,
    ProjectPickerRecoverSessionPayload,
    ProjectPickerViewProps,
} from "./ProjectPickerView.types";

const props = withDefaults(defineProps<ProjectPickerViewProps>(), {
    projects: () => [],
    isLoading: false,
    loadError: "",
    isCreating: false,
    isCreateFormOpen: false,
    createRecoveryNotice: "",
    deleteBusyRoots: () => new Set<string>(),
    failedCoverRoots: () => new Set<string>(),
    recoveryExpanded: false,
    recoveryLoading: false,
    recoveryLoaded: false,
    recoveryError: "",
    recoverySessions: () => [],
    recoveryTotal: 0,
    recoveryHasMore: false,
    recoveryActionId: null,
    teleportTarget: "body",
});

const emit = defineEmits<{
    (e: "open", projectRoot: string): void;
    (e: "open-user-assets"): void;
    (e: "open-create-form"): void;
    (e: "cancel-create-form"): void;
    (e: "create", payload: ProjectPickerCreatePayload): void;
    (e: "retry-create-recovery"): void;
    (e: "delete", project: ProjectMetadataDto): void;
    (e: "retry-delete-recovery", projectRoot: string): void;
    (e: "retry-load"): void;
    (e: "toggle-recovery"): void;
    (e: "load-more-recovery"): void;
    (e: "retry-recovery"): void;
    (e: "recover-session", payload: ProjectPickerRecoverSessionPayload): void;
    (e: "open-cover-dialog", project: ProjectMetadataDto): void;
    (e: "close-cover-dialog"): void;
    (e: "upload-cover", payload: {project: ProjectMetadataDto; file: File}): void;
    (e: "clear-cover", project: ProjectMetadataDto): void;
    (e: "retry-cover-recovery", projectRoot: string): void;
    (e: "cover-error", projectRoot: string): void;
    (e: "update:coverDialogOpen", value: boolean): void;
    (e: "update:coverDialogProject", value: ProjectMetadataDto | null): void;
}>();

const {t, locale} = useI18n();

const internalCoverDialogOpen = ref(false);
const internalCoverDialogProject = ref<ProjectMetadataDto | null>(null);

const activeCoverDialogOpen = computed({
    get: () => (props.coverDialogOpen !== undefined ? props.coverDialogOpen : internalCoverDialogOpen.value),
    set: (val: boolean) => {
        internalCoverDialogOpen.value = val;
        emit("update:coverDialogOpen", val);
        if (!val) {
            emit("close-cover-dialog");
        }
    },
});

const activeCoverProject = computed({
    get: () => (props.coverDialogProject !== undefined ? props.coverDialogProject : internalCoverDialogProject.value),
    set: (val: ProjectMetadataDto | null) => {
        internalCoverDialogProject.value = val;
        emit("update:coverDialogProject", val);
    },
});

const activeCoverBusy = computed(() => props.coverBusy ?? false);

const originalPreviewOpen = ref(false);
const originalPreviewUrl = ref("");
const originalPreviewAlt = ref("");
const originalPreviewName = ref("");

const dateFormatter = computed(() => new Intl.DateTimeFormat(locale.value, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
}));

function formatDate(dateString?: string | null): string {
    if (!dateString) return "";
    const date = new Date(dateString);
    return Number.isNaN(date.getTime()) ? "" : dateFormatter.value.format(date);
}

function deleteRecoveryFor(projectRoot: string) {
    return props.pickerRecoveries?.deletes.get(projectRoot);
}

const currentCoverRecovery = computed(() => {
    const projectRoot = activeCoverProject.value?.projectRoot;
    return projectRoot ? props.coverRecoveries?.get(projectRoot) : undefined;
});

function handleOpenCoverDialog(project: ProjectMetadataDto): void {
    activeCoverProject.value = project;
    activeCoverDialogOpen.value = true;
    emit("open-cover-dialog", project);
}

function defaultCoverUrl(projectRoot: string): string {
    return `/api/projects/cover?${new URLSearchParams({projectRoot, preset: "project-cover"}).toString()}`;
}

function handlePreviewOriginal(): void {
    const project = activeCoverProject.value;
    if (!project) return;
    const src = props.resolveOriginalCoverUrl
        ? props.resolveOriginalCoverUrl(project.projectRoot)
        : `/api/projects/cover?${new URLSearchParams({projectRoot: project.projectRoot}).toString()}`;
    originalPreviewUrl.value = src;
    originalPreviewAlt.value = t("ide.picker.coverAlt", {title: project.title});
    originalPreviewName.value = `${project.title}-cover`;
    originalPreviewOpen.value = true;
}

function handleUploadCover(file: File): void {
    if (!activeCoverProject.value) return;
    emit("upload-cover", {project: activeCoverProject.value, file});
}

function handleClearCover(): void {
    if (!activeCoverProject.value) return;
    emit("clear-cover", activeCoverProject.value);
}

function handleRetryCoverRecovery(): void {
    if (!activeCoverProject.value) return;
    emit("retry-cover-recovery", activeCoverProject.value.projectRoot);
}
</script>

<template>
    <div class="project-picker-view flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--bg-main)] text-[var(--text-main)]" data-project-picker-view>
        <main class="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-5 py-8 sm:px-6 sm:py-10 lg:px-8">
            <!-- 页面标题与主操作 -->
            <section class="flex flex-col gap-5 border-b border-[var(--border-color)] pb-7 sm:flex-row sm:items-end sm:justify-between">
                <div class="min-w-0">
                    <h1 class="font-serif text-2xl font-bold text-[var(--text-main)] tracking-tight">
                        {{ t("ide.picker.title") }}
                    </h1>
                    <p class="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                        {{ t("ide.picker.subtitle") }}
                    </p>
                </div>
                <div class="flex w-full shrink-0 flex-col gap-2.5 sm:w-auto sm:flex-row">
                    <Button
                        type="button"
                        variant="secondary"
                        icon-class="i-lucide-folder-cog"
                        @click="emit('open-user-assets')"
                    >
                        {{ t("ide.picker.openUserAssets") }}
                    </Button>
                    <Button
                        type="button"
                        variant="primary"
                        icon-class="i-lucide-book-plus"
                        :disabled="isLoading || Boolean(loadError) || isCreating"
                        @click="emit('open-create-form')"
                    >
                        {{ t("ide.bookshelf.createBook") }}
                    </Button>
                </div>
            </section>

            <!-- 新建书籍 Dialog -->
            <ProjectCreateForm
                :is-open="isCreateFormOpen"
                :is-creating="isCreating"
                :recovery-notice="createRecoveryNotice"
                :recovery-error="createRecovery?.error"
                :teleport-target="teleportTarget"
                @cancel="emit('cancel-create-form')"
                @submit="emit('create', $event)"
                @retry-recovery="emit('retry-create-recovery')"
            />

            <!-- 加载态：占满区域，符合 ui-development-spec §4.1 规范 -->
            <section
                v-if="isLoading"
                class="flex min-h-[320px] flex-col items-center justify-center gap-3 py-16 text-center"
                role="status"
                aria-live="polite"
                aria-busy="true"
            >
                <Spinner size="lg" />
                <span class="text-sm text-[var(--text-secondary)]">{{ t("ide.picker.loading") }}</span>
            </section>

            <!-- 错误态：一屏独立展示（图标 + 标题 + 详情 + 重试动作） -->
            <section
                v-else-if="loadError"
                class="flex min-h-[280px] flex-col items-center justify-center rounded-[var(--radius-panel,8px)] border border-[var(--status-danger-border,var(--status-danger))] bg-[color-mix(in_srgb,var(--status-danger)_6%,transparent)] px-6 py-12 text-center"
                role="alert"
            >
                <span class="i-lucide-cloud-alert h-8 w-8 text-[var(--status-danger)]" aria-hidden="true"></span>
                <h2 class="mt-4 text-base font-semibold text-[var(--text-main)]">{{ t("ide.picker.loadFailed") }}</h2>
                <p class="mt-2 max-w-[560px] break-words text-sm leading-6 text-[var(--text-secondary)]">{{ loadError }}</p>
                <Button
                    type="button"
                    variant="danger"
                    icon-class="i-lucide-refresh-cw"
                    class="mt-6"
                    @click="emit('retry-load')"
                >
                    {{ t("ide.picker.retry") }}
                </Button>
            </section>

            <!-- 零项目空态 -->
            <section
                v-else-if="projects.length === 0"
                class="flex min-h-[320px] flex-col items-center justify-center rounded-[var(--radius-panel,8px)] border border-dashed border-[var(--border-color)] bg-[color-mix(in_srgb,var(--bg-panel)_40%,transparent)] px-6 py-14 text-center"
            >
                <div class="flex h-12 w-12 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--accent-main)] shadow-sm">
                    <span class="i-lucide-book-open-text h-6 w-6"></span>
                </div>
                <h2 class="mt-4 text-base font-semibold text-[var(--text-main)]">{{ t("ide.picker.emptyTitle") }}</h2>
                <p class="mt-2 max-w-[420px] text-sm leading-6 text-[var(--text-secondary)]">{{ t("ide.picker.empty") }}</p>
                <Button
                    type="button"
                    variant="primary"
                    icon-class="i-lucide-book-plus"
                    class="mt-6"
                    @click="emit('open-create-form')"
                >
                    {{ t("ide.bookshelf.createBook") }}
                </Button>
            </section>

            <!-- 最近项目网格 -->
            <section v-else>
                <div class="mb-5 flex items-center justify-between gap-4">
                    <h2 class="text-sm font-semibold text-[var(--text-main)]">{{ t("ide.picker.recentProjects") }}</h2>
                    <span class="text-xs text-[var(--text-muted)] font-mono">{{ t("ide.picker.projectCount", {count: projects.length}) }}</span>
                </div>
                <div class="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    <ProjectCard
                        v-for="project in projects"
                        :key="project.projectRoot"
                        :project="project"
                        :delete-busy="deleteBusyRoots.has(project.projectRoot)"
                        :delete-recovery="deleteRecoveryFor(project.projectRoot)"
                        :cover-refresh-version="coverRefreshVersions?.[project.projectRoot]"
                        :failed-cover="failedCoverRoots.has(project.projectRoot)"
                        :resolve-cover-url="resolveCoverUrl"
                        :format-date="formatDate"
                        @open="emit('open', $event)"
                        @delete="emit('delete', $event)"
                        @retry-delete-recovery="emit('retry-delete-recovery', $event)"
                        @open-cover-dialog="handleOpenCoverDialog"
                        @cover-error="emit('cover-error', $event)"
                    />
                </div>
            </section>
        </main>

        <!-- 封面管理 Dialog -->
        <ProjectCoverDialog
            v-model="activeCoverDialogOpen"
            :project="activeCoverProject"
            :busy="activeCoverBusy"
            :api-error="coverError"
            :recovery-notice="coverRecoveryNotice || (currentCoverRecovery ? t('ide.picker.coverUnknownRefreshed') : '')"
            :recovery-error="currentCoverRecovery?.error"
            :cover-url="activeCoverProject ? (resolveCoverUrl ? resolveCoverUrl(activeCoverProject.projectRoot) : defaultCoverUrl(activeCoverProject.projectRoot)) : ''"
            @upload="handleUploadCover"
            @clear="handleClearCover"
            @retry-recovery="handleRetryCoverRecovery"
            @preview-original="handlePreviewOriginal"
        />

        <!-- 原图预览 Dialog -->
        <OriginalImagePreviewDialog
            v-model="originalPreviewOpen"
            :src="originalPreviewUrl"
            :alt="originalPreviewAlt"
            :download-name="originalPreviewName"
        />
    </div>
</template>
