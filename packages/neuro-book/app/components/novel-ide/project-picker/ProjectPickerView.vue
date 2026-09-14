<script setup lang="ts">
import {ref, computed, watch} from "vue";
import {Button, SegmentedControl, Spinner} from "@notnotype/nb-ui/components";
import type {SegmentedControlOption, SegmentedControlValue} from "@notnotype/nb-ui/components";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import type {AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import OriginalImagePreviewDialog from "nbook/app/components/common/OriginalImagePreviewDialog.vue";
import ProjectCard from "./components/ProjectCard.vue";
import ProjectPickerClassicCompactView from "./components/ProjectPickerClassicCompactView.vue";
import ProjectPickerClassicEditorialView from "./components/ProjectPickerClassicEditorialView.vue";
import ProjectCreateDialog from "./components/ProjectCreateDialog.vue";
import ProjectCoverDialog from "./components/ProjectCoverDialog.vue";
import ProjectPickerHeader from "./components/ProjectPickerHeader.vue";
import ProjectPickerEmptyState from "./components/ProjectPickerEmptyState.vue";
import type {
    ProjectPickerCreatePayload,
    ProjectPickerLayoutMode,
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
    teleportTarget: ".novel-ide-theme",
    layoutMode: "grid",
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
    (e: "update:layoutMode", value: ProjectPickerLayoutMode): void;
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

function normalizeLayoutMode(mode?: string): ProjectPickerLayoutMode {
    if (mode === "compact" || mode === "classic-compact") return "compact";
    if (mode === "editorial" || mode === "classic-editorial") return "editorial";
    return "grid";
}

const currentLayout = ref<ProjectPickerLayoutMode>(normalizeLayoutMode(props.layoutMode));

watch(() => props.layoutMode, (val) => {
    if (val) {
        currentLayout.value = normalizeLayoutMode(val);
    }
});

function handleLayoutChange(value: SegmentedControlValue): void {
    const next = normalizeLayoutMode(String(value));
    currentLayout.value = next;
    emit("update:layoutMode", next);
}

const layoutOptions: SegmentedControlOption[] = [
    {value: "grid", label: "经典网格"},
    {value: "compact", label: "密集列表"},
    {value: "editorial", label: "宽幅图文"},
];

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

function getTagsForProject(project: ProjectMetadataDto): readonly string[] | undefined {
    if (props.projectTags) {
        if (typeof props.projectTags === "function") {
            return props.projectTags(project);
        }
        const mapped = props.projectTags[project.projectRoot];
        if (mapped) return mapped;
    }
    if ("tags" in project && Array.isArray((project as {tags?: readonly string[]}).tags)) {
        return (project as {tags?: readonly string[]}).tags;
    }
    return undefined;
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
    <div class="project-picker-view flex min-h-0 flex-1 flex-col overflow-y-auto text-[var(--text-main)]" data-project-picker-view>
        <main class="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-10 lg:px-8">
            <!-- 页面标题与主操作 -->
            <ProjectPickerHeader
                :is-loading="isLoading"
                :has-load-error="Boolean(loadError)"
                :is-creating="isCreating"
                @open-user-assets="emit('open-user-assets')"
                @create-book="emit('open-create-form')"
            />

            <!-- 新建书籍 Dialog -->
            <ProjectCreateDialog
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
            <ProjectPickerEmptyState
                v-else-if="projects.length === 0"
                @create-book="emit('open-create-form')"
            />

            <!-- 最近项目网格与高级视图 -->
            <section v-else class="space-y-6">
                <div class="flex flex-wrap items-center justify-between gap-4">
                    <div class="flex items-center gap-3">
                        <h2 class="text-sm font-semibold text-[var(--text-main)]">{{ t("ide.picker.recentProjects") }}</h2>
                        <span class="text-xs text-[var(--text-muted)] font-mono">{{ t("ide.picker.projectCount", {count: projects.length}) }}</span>
                    </div>

                    <!-- 布局体验自由切换 -->
                    <div class="flex items-center gap-2">
                        <span class="text-xs text-[var(--text-muted)] hidden sm:inline">展示形态：</span>
                        <SegmentedControl
                            :model-value="currentLayout"
                            :options="layoutOptions"
                            size="sm"
                            tone="accent"
                            @update:model-value="handleLayoutChange"
                        />
                    </div>
                </div>

                <!-- 视图一：密集列表 · 生产力工作台 -->
                <slot
                    v-if="currentLayout === 'compact'"
                    name="compact"
                    :projects="projects"
                    :open="(r: string) => emit('open', r)"
                    :delete-project="(p: ProjectMetadataDto) => emit('delete', p)"
                >
                    <ProjectPickerClassicCompactView
                        :projects="projects"
                        :project-tags="props.projectTags"
                        :delete-busy-roots="deleteBusyRoots"
                        :failed-cover-roots="failedCoverRoots"
                        :cover-refresh-versions="coverRefreshVersions"
                        :picker-recoveries="pickerRecoveries"
                        :resolve-cover-url="resolveCoverUrl"
                        :format-date="formatDate"
                        @open="emit('open', $event)"
                        @delete="emit('delete', $event)"
                        @retry-delete-recovery="emit('retry-delete-recovery', $event)"
                        @open-cover-dialog="handleOpenCoverDialog"
                        @cover-error="emit('cover-error', $event)"
                        @create-book="emit('open-create-form')"
                    />
                </slot>

                <!-- 视图二：宽幅图文 · 杂志对开卡片 -->
                <slot
                    v-else-if="currentLayout === 'editorial'"
                    name="editorial"
                    :projects="projects"
                    :open="(r: string) => emit('open', r)"
                    :delete-project="(p: ProjectMetadataDto) => emit('delete', p)"
                >
                    <ProjectPickerClassicEditorialView
                        :projects="projects"
                        :project-tags="props.projectTags"
                        :delete-busy-roots="deleteBusyRoots"
                        :failed-cover-roots="failedCoverRoots"
                        :cover-refresh-versions="coverRefreshVersions"
                        :picker-recoveries="pickerRecoveries"
                        :resolve-cover-url="resolveCoverUrl"
                        :format-date="formatDate"
                        @open="emit('open', $event)"
                        @delete="emit('delete', $event)"
                        @retry-delete-recovery="emit('retry-delete-recovery', $event)"
                        @open-cover-dialog="handleOpenCoverDialog"
                        @cover-error="emit('cover-error', $event)"
                        @create-book="emit('open-create-form')"
                    />
                </slot>

                <!-- 视图三：经典网格 · 书架陈列 -->
                <slot
                    v-else
                    name="grid"
                    :projects="projects"
                    :open="(r: string) => emit('open', r)"
                    :delete-project="(p: ProjectMetadataDto) => emit('delete', p)"
                >
                    <div class="picker-bookshelf-grid">
                        <ProjectCard
                            v-for="project in projects"
                            :key="project.projectRoot"
                            :project="project"
                            :tags="getTagsForProject(project)"
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
                </slot>
            </section>
        </main>

        <!-- 封面管理 Dialog -->
        <ProjectCoverDialog
            v-model="activeCoverDialogOpen"
            :project="activeCoverProject"
            :busy="activeCoverBusy"
            :teleport-target="teleportTarget"
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
            :teleport-target="teleportTarget"
        />
    </div>
</template>

<style scoped>
.project-picker-view {
    container-type: inline-size;
}

.picker-bookshelf-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 0.875rem;
    row-gap: 1.5rem;
}

@container (min-width: 580px) {
    .picker-bookshelf-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        column-gap: 1.25rem;
        row-gap: 2rem;
    }
}

@container (min-width: 820px) {
    .picker-bookshelf-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
    }
}

@container (min-width: 1060px) {
    .picker-bookshelf-grid {
        grid-template-columns: repeat(5, minmax(0, 1fr));
        column-gap: 1.5rem;
        row-gap: 2.25rem;
    }
}
</style>
