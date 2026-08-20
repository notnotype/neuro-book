<script setup lang="ts">
import {ref, useAttrs} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import Dropdown from "nbook/app/components/common/Dropdown.vue";
import Tooltip from "nbook/app/components/common/Tooltip.vue";
import DiffWorkbenchDialog from "nbook/app/components/common/diff/DiffWorkbenchDialog.vue";
import type {DiffWorkbenchActionPayload, DiffWorkbenchDocument} from "nbook/app/components/common/diff/diff-workbench.types";
import type {DropdownItem} from "nbook/app/components/common/dropdown.types";
import WorkspaceFilePanel from "nbook/app/components/novel-ide/workspace/WorkspaceFilePanel.vue";
import WorkspaceCharacterPanel from "nbook/app/components/novel-ide/workspace/WorkspaceCharacterPanel.vue";
import NovelPlotPanel from "nbook/app/components/novel-ide/plot/NovelPlotPanel.vue";
import type { NovelIdeTab } from "nbook/app/components/novel-ide/mock-data";
import {useNotification} from "nbook/app/composables/useNotification";
import {useResizablePanel} from "nbook/app/composables/useResizablePanel";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {
    UserAssetsAssetSyncWarningDto,
    UserAssetsProfileSyncWarningDto,
    UserAssetsSyncConflictDetailDto,
    UserAssetsSyncResultDto,
} from "nbook/shared/dto/user-assets-sync.dto";

const MIN_PANEL_WIDTH = 280;
const MAX_PANEL_WIDTH = 560;

const props = defineProps<{
    activeTab: NovelIdeTab | null;
    userAssetsMode?: boolean;
    width: number;
    workspaceTitle: string;
    workspaceItems: DropdownItem[];
}>();

defineOptions({
    inheritAttrs: false,
});

const emit = defineEmits<{
    (e: "update:width", value: number): void;
    (e: "close"): void;
    (e: "openWorldEngine"): void;
    (e: "openHome"): void;
    (e: "switchWorkspace", value: string): void;
}>();

const {t} = useI18n();
const titleMap = computed<Record<NovelIdeTab, string>>(() => ({
    files: t("ide.toolPanel.files"),
    characters: t("ide.toolPanel.characters"),
    plot: t("ide.toolPanel.plot"),
}));
const displayTitle = computed(() => props.userAssetsMode ? t("ide.toolPanel.userAssets") : titleMap.value[props.activeTab ?? "files"]);

const novelIdeStore = useNovelIdeStore();
const notification = useNotification();
const attrs = useAttrs();
const downloadingWorkspace = ref(false);
const uploadingSingleFile = ref(false);
const uploadingProject = ref(false);
const syncingAssets = ref(false);
const downloadConfirmOpen = ref(false);
const syncWarningsOpen = ref(false);
const syncConflictDiffOpen = ref(false);
const syncConflictLoading = ref(false);
const lastSyncWarnings = ref<UserAssetsSyncWarningItem[]>([]);
const syncConflictDocument = ref<DiffWorkbenchDocument | null>(null);
const syncConflictSubtitle = ref("");
const singleFileInputRef = ref<HTMLInputElement | null>(null);
const projectDirectoryInputRef = ref<HTMLInputElement | null>(null);
const projectZipInputRef = ref<HTMLInputElement | null>(null);
const resizeHandleRef = ref<HTMLElement | null>(null);
const downloadTargetLabel = computed(() => props.userAssetsMode ? "Workspace Root .nbook" : "Project Workspace");
const downloadButtonTitle = computed(() => props.userAssetsMode ? t("ide.toolPanel.downloadWorkspaceRoot") : t("ide.toolPanel.downloadProjectWorkspace"));
const {isResizing, panelStyle} = useResizablePanel(resizeHandleRef, {
    size: computed(() => props.width),
    minSize: MIN_PANEL_WIDTH,
    maxSize: MAX_PANEL_WIDTH,
    edge: "right",
    enabled: computed(() => Boolean(props.activeTab)),
    syncDuringResize: true,
    onResize: (width) => emit("update:width", width),
});
const projectUploadItems = computed<DropdownItem[]>(() => [
    {label: t("ide.toolPanel.uploadDirectory"), value: "directory", iconClass: "i-lucide-folder-up"},
    {label: t("ide.toolPanel.uploadZip"), value: "zip", iconClass: "i-lucide-file-archive"},
]);

type UserAssetsSyncWarningItem = {
    id: string;
    kind: "profile" | "asset";
    title: string;
    path: string;
    message: string;
    profile?: UserAssetsProfileSyncWarningDto;
    asset?: UserAssetsAssetSyncWarningDto;
};

/**
 * 打开下载确认框。
 */
function openDownloadConfirm(): void {
    if (downloadingWorkspace.value) {
        return;
    }
    downloadConfirmOpen.value = true;
}

/**
 * 确认后保存未落盘内容并下载当前挂载目标。
 */
async function confirmDownloadWorkspace(): Promise<void> {
    if (downloadingWorkspace.value) {
        return;
    }

    downloadingWorkspace.value = true;
    try {
        downloadConfirmOpen.value = false;
        const filename = await novelIdeStore.downloadCurrentWorkspace();
        notification.success(t("ide.toolPanel.downloadStarted", {filename}));
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("ide.toolPanel.downloadFailed", {target: downloadTargetLabel.value})));
    } finally {
        downloadingWorkspace.value = false;
    }
}

/**
 * 打开单文件上传选择器。
 */
function openSingleFileUpload(): void {
    if (uploadingSingleFile.value) {
        return;
    }
    singleFileInputRef.value?.click();
}

/**
 * 打开 Project 文件夹上传选择器。
 */
function openProjectDirectoryUpload(): void {
    if (uploadingProject.value) {
        return;
    }
    projectDirectoryInputRef.value?.click();
}

/**
 * 打开 Project zip 上传选择器。
 */
function openProjectZipUpload(): void {
    if (uploadingProject.value) {
        return;
    }
    projectZipInputRef.value?.click();
}

function selectProjectUploadMode(mode: string): void {
    if (mode === "zip") {
        openProjectZipUpload();
        return;
    }
    openProjectDirectoryUpload();
}

/**
 * 上传单个文件到 upload/。
 */
async function handleSingleFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file || uploadingSingleFile.value) {
        return;
    }

    uploadingSingleFile.value = true;
    try {
        const result = await novelIdeStore.uploadFileToUploadFolder(file);
        notification.success(formatUploadResult(result, t("ide.toolPanel.uploadedSingleFile")));
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("ide.toolPanel.uploadSingleFailed")));
    } finally {
        uploadingSingleFile.value = false;
    }
}

/**
 * 上传浏览器选择的 Project 文件夹。
 */
async function handleProjectDirectorySelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (!files.length || uploadingProject.value) {
        return;
    }

    uploadingProject.value = true;
    try {
        const result = await novelIdeStore.uploadProjectFiles(files);
        notification.success(formatUploadResult(result, t("ide.toolPanel.projectDirectoryUploaded")));
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("ide.toolPanel.projectDirectoryUploadFailed")));
    } finally {
        uploadingProject.value = false;
    }
}

/**
 * 上传 Project zip 压缩包。
 */
async function handleProjectZipSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file || uploadingProject.value) {
        return;
    }

    uploadingProject.value = true;
    try {
        const result = await novelIdeStore.uploadProjectZip(file);
        notification.success(formatUploadResult(result, t("ide.toolPanel.projectZipUploaded")));
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("ide.toolPanel.projectZipUploadFailed")));
    } finally {
        uploadingProject.value = false;
    }
}

function formatUploadResult(result: {written: number; skipped: number}, fallback: string): string {
    if (!result.written && !result.skipped) {
        return fallback;
    }
    return t("ide.toolPanel.uploadResult", {written: result.written, skipped: result.skipped});
}

function buildSyncWarningItems(result: UserAssetsSyncResultDto): UserAssetsSyncWarningItem[] {
    const profileItems = (result.profileWarnings ?? []).map((warning) => ({
        id: `profile:${warning.fileName}`,
        kind: "profile" as const,
        title: `Profile: ${warning.profileKey}`,
        path: warning.fileName,
        message: warning.message,
        profile: warning,
    }));
    const assetItems = (result.assetWarnings ?? []).map((warning) => ({
        id: `asset:${warning.assetPath}`,
        kind: "asset" as const,
        title: "Agent Asset",
        path: warning.assetPath,
        message: warning.message,
        asset: warning,
    }));
    return [...profileItems, ...assetItems];
}

function formatSyncResult(result: UserAssetsSyncResultDto): string {
    const updatedProfiles = result.updatedProfiles ?? 0;
    const updatedAssets = result.updatedAssets ?? 0;
    const chunks = [t("ide.toolPanel.syncCopied", {count: result.copied}), t("ide.toolPanel.syncSkipped", {count: result.skipped})];
    if (updatedProfiles) {
        chunks.push(t("ide.toolPanel.syncProfiles", {count: updatedProfiles}));
    }
    if (updatedAssets) {
        chunks.push(t("ide.toolPanel.syncAssets", {count: updatedAssets}));
    }
    return `${chunks.join("，")}。`;
}

function toSyncConflictDocument(detail: UserAssetsSyncConflictDetailDto): DiffWorkbenchDocument {
    const path = detail.fileName ?? detail.assetPath ?? detail.label;
    return {
        id: `user-assets-sync:${detail.kind}:${path}:${detail.systemSha256}:${detail.userSha256}`,
        title: detail.kind === "profile" ? t("ide.toolPanel.conflictProfileTitle", {label: detail.label}) : t("ide.toolPanel.conflictAssetTitle", {label: detail.label}),
        path,
        language: detail.language,
        diffable: detail.diffable,
        unavailableReason: detail.reason,
        notice: detail.diffable ? undefined : t("ide.toolPanel.conflictNotice"),
        metadata: {
            currentBytes: detail.userBytes,
            incomingBytes: detail.systemBytes,
            currentSha256: detail.userSha256 || undefined,
            incomingSha256: detail.systemSha256 || undefined,
        },
        baseContent: detail.baseContent,
        currentContent: detail.userContent,
        incomingContent: detail.systemContent,
        resultContent: detail.userContent,
        currentLabel: t("ide.toolPanel.currentLabel"),
        incomingLabel: t("ide.toolPanel.incomingLabel"),
        baseLabel: t("ide.toolPanel.baseLabel"),
        resultLabel: t("ide.toolPanel.resultLabel"),
    };
}

/**
 * 从系统 assets 补齐用户 assets 缺失文件。
 */
async function syncSystemAssets(): Promise<void> {
    if (syncingAssets.value || !props.userAssetsMode) {
        return;
    }
    syncingAssets.value = true;
    try {
        const result = await novelIdeStore.syncUserAssetsFromSystem();
        lastSyncWarnings.value = buildSyncWarningItems(result);
        if (lastSyncWarnings.value.length) {
            syncWarningsOpen.value = true;
            notification.warning(t("ide.toolPanel.syncWarningMessage", {count: lastSyncWarnings.value.length}), {
                title: t("ide.toolPanel.syncWarningTitle"),
                autoClose: false,
            });
            return;
        }
        notification.success(formatSyncResult(result), {title: t("ide.toolPanel.syncSuccessTitle")});
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("ide.toolPanel.syncFailed")));
    } finally {
        syncingAssets.value = false;
    }
}

async function openSyncWarningDiff(item: UserAssetsSyncWarningItem): Promise<void> {
    if (syncConflictLoading.value) {
        return;
    }
    syncConflictLoading.value = true;
    try {
        const detail = await novelIdeStore.fetchUserAssetsSyncConflictDetail(item.kind === "profile"
            ? {kind: "profile", fileName: item.profile?.fileName ?? item.path}
            : {kind: "asset", assetPath: item.asset?.assetPath ?? item.path});
        syncConflictDocument.value = toSyncConflictDocument(detail);
        syncConflictSubtitle.value = item.message;
        syncConflictDiffOpen.value = true;
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("ide.toolPanel.diffLoadFailed")));
    } finally {
        syncConflictLoading.value = false;
    }
}

function handleSyncDiffAction(payload: DiffWorkbenchActionPayload): void {
    if (payload.actionId === "cancel") {
        syncConflictDiffOpen.value = false;
    }
}

</script>

<template>
    <!-- 左侧工具窗 -->
    <div class="contents">
        <aside v-if="activeTab" v-bind="attrs" class="relative z-10 flex shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-panel)]" :class="isResizing ? 'select-none transition-none' : ''" :style="panelStyle">
            <!-- 宽度拖拽手柄 -->
            <div ref="resizeHandleRef" class="group absolute -right-1 top-0 z-30 h-full w-2 cursor-col-resize">
                <div class="ml-0.5 h-full w-[2px] bg-[var(--accent-main)] opacity-0 transition-all duration-150 group-hover:opacity-100" :class="isResizing ? 'opacity-100 shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-main)_28%,transparent)]' : ''"></div>
            </div>

            <div class="shrink-0 border-b border-[var(--border-color)]">
                <div v-if="!props.userAssetsMode" class="flex h-9 items-center gap-1 border-b border-[var(--border-color)] px-2">
                    <Tooltip :text="t('ide.header.bookshelfTitle')" placement="bottom">
                        <button type="button" class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('openHome')">
                            <span class="i-lucide-library h-4 w-4"></span>
                        </button>
                    </Tooltip>
                    <Dropdown
                        v-if="!props.userAssetsMode"
                        class="min-w-0 flex-1"
                        :items="props.workspaceItems"
                        menu-class="left-0 top-full mt-1 w-full"
                        menu-max-height="min(360px, calc(100vh - 96px))"
                        compact
                        @select="emit('switchWorkspace', $event)"
                    >
                        <button type="button" class="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="props.workspaceTitle">
                            <span class="i-lucide-book-open h-3.5 w-3.5 shrink-0"></span>
                            <span class="min-w-0 flex-1 truncate">{{ props.workspaceTitle }}</span>
                            <span class="i-lucide-chevron-down h-3.5 w-3.5 shrink-0"></span>
                        </button>
                    </Dropdown>

                </div>

                <div class="flex items-center justify-between px-3 py-2">
                    <span class="text-[11px] font-medium tracking-[0.24em] text-[var(--text-secondary)]">
                        {{ displayTitle }}
                    </span>

                    <div class="flex items-center gap-0.5">
                        <input ref="singleFileInputRef" class="hidden" type="file" @change="(event) => void handleSingleFileSelected(event)">
                        <input ref="projectDirectoryInputRef" class="hidden" type="file" multiple webkitdirectory @change="(event) => void handleProjectDirectorySelected(event)">
                        <input ref="projectZipInputRef" class="hidden" type="file" accept=".zip,application/zip" @change="(event) => void handleProjectZipSelected(event)">

                        <Tooltip :text="t('ide.toolPanel.uploadSingleTitle')" placement="bottom">
                            <button class="rounded-2 p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="uploadingSingleFile" @click="openSingleFileUpload">
                                <span :class="uploadingSingleFile ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-file-up'" class="h-4 w-4"></span>
                            </button>
                        </Tooltip>
                        <Tooltip :text="t('ide.toolPanel.uploadProjectTitle')" placement="bottom">
                            <Dropdown root-class="relative inline-flex items-center" :items="projectUploadItems" menu-class="right-0 top-full mt-1 w-36" @select="selectProjectUploadMode">
                                <button class="rounded-2 p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="uploadingProject">
                                    <span :class="uploadingProject ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-folder-up'" class="h-4 w-4"></span>
                                </button>
                            </Dropdown>
                        </Tooltip>
                        <Tooltip :text="downloadButtonTitle" placement="bottom">
                            <button class="rounded-2 p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="downloadingWorkspace" @click="openDownloadConfirm">
                                <span :class="downloadingWorkspace ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-download'" class="h-4 w-4"></span>
                            </button>
                        </Tooltip>
                        <Tooltip v-if="props.userAssetsMode" :text="t('ide.toolPanel.syncAssetsTitle')" placement="bottom">
                            <button class="rounded-2 p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="syncingAssets" @click="void syncSystemAssets()">
                                <span :class="syncingAssets ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-folder-sync'" class="h-4 w-4"></span>
                            </button>
                        </Tooltip>
                        <Tooltip v-if="props.userAssetsMode && lastSyncWarnings.length" :text="t('ide.toolPanel.viewSyncConflicts')" placement="bottom">
                            <button class="rounded-2 p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="syncWarningsOpen = true">
                                <span class="i-lucide-triangle-alert h-4 w-4"></span>
                            </button>
                        </Tooltip>
                        <Tooltip :text="t('ide.toolPanel.collapsePanel')" placement="bottom">
                            <button class="rounded-2 p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('close')">
                                <span class="i-lucide-minus h-4 w-4"></span>
                            </button>
                        </Tooltip>
                    </div>
                </div>
            </div>

            <div class="contain-layout-paint min-h-0 flex-1 overflow-hidden" :class="isResizing ? 'pointer-events-none select-none' : ''">
                <WorkspaceFilePanel v-if="activeTab === 'files'" />

                <WorkspaceCharacterPanel v-else-if="activeTab === 'characters' && !props.userAssetsMode" />

                <NovelPlotPanel v-else-if="activeTab === 'plot' && !props.userAssetsMode" @open-world-engine="emit('openWorldEngine')" />
            </div>
        </aside>

        <Dialog v-model="downloadConfirmOpen" :title="t('ide.toolPanel.downloadTitle', {target: downloadTargetLabel})" width="420px" show-cancel :busy="downloadingWorkspace" @confirm="confirmDownloadWorkspace">
            <p>{{ t("ide.toolPanel.downloadConfirm", {target: downloadTargetLabel}) }}</p>
            <p v-if="!props.userAssetsMode" class="mt-3 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-sm leading-5 text-[var(--status-warning)]">{{ t("ide.toolPanel.downloadProjectHistoryWarning") }}</p>
        </Dialog>

        <Dialog v-model="syncWarningsOpen" :title="t('ide.toolPanel.syncDetailsTitle')" width="620px" :show-footer="false">
            <div class="space-y-3">
                <p class="m-0 text-sm text-[var(--text-secondary)]">{{ t("ide.toolPanel.syncDetailsDescription") }}</p>
                <div class="max-h-[52vh] space-y-2 overflow-auto pr-1">
                    <button
                        v-for="item in lastSyncWarnings"
                        :key="item.id"
                        type="button"
                        class="w-full rounded-2 border border-[var(--border-color)] bg-[var(--bg-input)] p-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
                        :disabled="syncConflictLoading"
                        @click="void openSyncWarningDiff(item)"
                    >
                        <div class="flex items-center justify-between gap-3">
                            <span class="min-w-0 truncate text-sm font-medium text-[var(--text-main)]">{{ item.title }}</span>
                            <span class="shrink-0 rounded-2 bg-[var(--bg-panel)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">{{ item.kind }}</span>
                        </div>
                        <div class="mt-1 truncate font-mono text-xs text-[var(--text-muted)]">{{ item.path }}</div>
                        <div class="mt-2 text-xs text-[var(--text-secondary)]">{{ item.message }}</div>
                    </button>
                </div>
            </div>
        </Dialog>

        <DiffWorkbenchDialog
            v-model="syncConflictDiffOpen"
            :document="syncConflictDocument"
            :title="t('ide.toolPanel.userOverrideDiff')"
            :subtitle="syncConflictSubtitle"
            :available-modes="['diff']"
            initial-mode="diff"
            :merge-readonly="true"
            :actions="[{id: 'cancel', label: t('ide.toolPanel.close')}]"
            @action="handleSyncDiffAction"
        />
    </div>
</template>
