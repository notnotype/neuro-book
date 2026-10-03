<script setup lang="ts">
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import BackupRecoveryCodeDialog from "nbook/app/components/novel-ide/profile/BackupRecoveryCodeDialog.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {usePassportLink} from "nbook/app/composables/usePassportLink";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {OFFICIAL_PASSPORT_SITE_URL} from "nbook/shared/passport/passport-constants";
import type {
    PassportBackupKeyringDto,
    PassportBackupListDto,
    PassportJobDto,
    PassportStatusDto,
} from "nbook/shared/dto/passport.dto";

// NeuroBook 官网账号 Profile：设备码关联 + 云备份/恢复管理。

const notification = useNotification();
const {t} = useI18n();

// ---- 关联状态 ----
const status = ref<PassportStatusDto | null>(null); // 为空表示尚未加载完成
const statusLoading = ref(false);
const statusError = ref("");

// ---- 取消关联两步确认 ----
const confirmUnlink = ref(false);
const unlinkBusy = ref(false);

// ---- 云备份 ----
const backups = ref<PassportBackupListDto | null>(null);
const backupsLoading = ref(false);
const backupsError = ref("");
const backupComment = ref("");
const backupKeys = ref<PassportBackupKeyringDto | null>(null);
const keyDialogOpen = ref(false);
const keyDialogMode = ref<"prepare" | "import" | "export">("prepare");
const keyDialogKeyId = ref("");
const keyDialogRotation = ref(false);
const backupAfterKeyConfirm = ref(false);
const restoreAfterKeyImport = ref<number | null>(null);
const activeJob = ref<PassportJobDto | null>(null); // 进行中或刚结束的后台任务
let jobTimer: ReturnType<typeof setTimeout> | null = null;
const confirmRestoreId = ref<number | null>(null);
const confirmDeleteId = ref<number | null>(null);
// 恢复完成后的指引卡片（保留展示直到用户关闭）
const restoreResult = ref<{restoreDir: string; fileCount: number; appVersion: string} | null>(null);

const {
    session: linkSession,
    phase: linkPhase,
    failure: linkFailure,
    busy: linkBusy,
    checking: linkChecking,
    start: startLink,
    retry: retryLink,
    cancel: cancelLink,
} = usePassportLink({
    onLinked(linkedStatus) {
        status.value = linkedStatus;
        notification.success(t("ide.profile.linkSuccess"));
        void loadBackups();
        void loadBackupKeys();
    },
    onStartError(error) {
        notification.error(resolveApiErrorMessage(error, t("ide.profile.linkStartFailed")));
    },
});

const usagePercent = computed(() => {
    const quota = backups.value?.quota;
    if (!quota || quota.maxBytes <= 0) {
        return 0;
    }
    return Math.min(100, Math.round((quota.usedBytes / quota.maxBytes) * 100));
});

/**
 * 识别 409 passport_unlinked：凭据已失效，清空关联态并提示重新关联。
 */
function isUnlinkedError(error: unknown): boolean {
    const data = (error as {data?: {data?: {code?: string}}})?.data?.data;
    return data?.code === "passport_unlinked";
}

/**
 * 读取关联状态；已关联时顺带刷新备份列表。
 */
async function loadStatus(): Promise<void> {
    statusLoading.value = true;
    statusError.value = "";
    status.value = null;
    try {
        status.value = await $fetch<PassportStatusDto>("/api/passport/status");
        if (status.value.linked) {
            void loadBackups();
            void loadBackupKeys();
        }
    } catch (error) {
        statusError.value = resolveApiErrorMessage(error, t("ide.profile.loadFailed"));
    } finally {
        statusLoading.value = false;
    }
}

/**
 * 读取本地 keyring 的非敏感元数据。
 */
async function loadBackupKeys(): Promise<boolean> {
    try {
        backupKeys.value = await $fetch<PassportBackupKeyringDto>("/api/passport/backup-keys");
        return true;
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("ide.profile.keys.loadFailed")));
        return false;
    }
}

/**
 * 取消关联（两步确认）：通知官方站吊销并删除本地凭据。
 */
async function unlink(): Promise<void> {
    if (!confirmUnlink.value) {
        confirmUnlink.value = true;
        return;
    }
    unlinkBusy.value = true;
    try {
        await $fetch("/api/passport/unlink", {method: "POST"});
        confirmUnlink.value = false;
        backups.value = null;
        restoreResult.value = null;
        notification.success(t("ide.profile.unlinkSuccess"));
        await loadStatus();
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("ide.profile.unlinkFailed")));
    } finally {
        unlinkBusy.value = false;
    }
}

/**
 * 读取云备份列表与配额。
 */
async function loadBackups(): Promise<void> {
    backupsLoading.value = true;
    backupsError.value = "";
    try {
        backups.value = await $fetch<PassportBackupListDto>("/api/passport/backups");
    } catch (error) {
        if (isUnlinkedError(error)) {
            await loadStatus();
            notification.error(t("ide.profile.relinkRequired"));
            return;
        }
        backupsError.value = resolveApiErrorMessage(error, t("ide.profile.backupListFailed"));
    } finally {
        backupsLoading.value = false;
    }
}

/**
 * 发起云备份；首次使用必须先完成恢复码保存确认。
 */
async function startBackup(): Promise<void> {
    if (!backupKeys.value && !await loadBackupKeys()) {
        return;
    }
    if (!backupKeys.value?.activeKeyId) {
        backupAfterKeyConfirm.value = true;
        openKeyDialog("prepare");
        return;
    }
    await executeBackup();
}

/**
 * 在 active key 已确认后启动真正的备份任务。
 */
async function executeBackup(): Promise<void> {
    try {
        const {jobId} = await $fetch<{jobId: string}>("/api/passport/backups", {
            method: "POST",
            body: {comment: backupComment.value},
        });
        backupComment.value = "";
        restoreResult.value = null;
        await pollJob(jobId);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("ide.profile.backupStartFailed")));
    }
}

/**
 * 发起恢复后台任务（两步确认）。
 */
async function startRestore(backupId: number): Promise<void> {
    const backup = backups.value?.items.find((item) => item.id === backupId);
    if (!backup) {
        return;
    }
    if (!backupKeys.value && !await loadBackupKeys()) {
        return;
    }
    if (!backupKeys.value?.keys.some((key) => key.keyId === backup.keyId)) {
        restoreAfterKeyImport.value = backupId;
        openKeyDialog("import", backup.keyId);
        return;
    }
    if (confirmRestoreId.value !== backupId) {
        confirmRestoreId.value = backupId;
        confirmDeleteId.value = null;
        return;
    }
    confirmRestoreId.value = null;
    try {
        const {jobId} = await $fetch<{jobId: string}>(`/api/passport/backups/${backupId}/restore`, {method: "POST"});
        restoreResult.value = null;
        await pollJob(jobId);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("ide.profile.restoreStartFailed")));
    }
}

/**
 * 打开密钥专用 Dialog，完整恢复码不会进入设置面板或通知。
 */
function openKeyDialog(mode: "prepare" | "import" | "export", keyId = "", rotation = false): void {
    keyDialogMode.value = mode;
    keyDialogKeyId.value = keyId;
    keyDialogRotation.value = rotation;
    keyDialogOpen.value = true;
}

/**
 * 用户确认保存恢复码后刷新状态；首次备份从这里继续。
 */
async function handleKeyConfirmed(): Promise<void> {
    const shouldStartBackup = backupAfterKeyConfirm.value;
    backupAfterKeyConfirm.value = false;
    await loadBackupKeys();
    notification.success(t("ide.profile.keys.confirmed"));
    if (shouldStartBackup) {
        await executeBackup();
    }
}

/**
 * 导入目标 key 后保留原有恢复二次确认，不自动开始数据恢复。
 */
async function handleKeyImported(): Promise<void> {
    const backupId = restoreAfterKeyImport.value;
    restoreAfterKeyImport.value = null;
    await loadBackupKeys();
    notification.success(t("ide.profile.keys.imported"));
    if (backupId !== null) {
        confirmRestoreId.value = backupId;
        confirmDeleteId.value = null;
    }
}

/**
 * 取消密钥 Dialog 时清理等待中的业务动作，pending key 本身由服务端保留。
 */
function handleKeyDialogCancelled(): void {
    backupAfterKeyConfirm.value = false;
    restoreAfterKeyImport.value = null;
}

/**
 * 轮询后台任务直到结束。
 */
async function pollJob(jobId: string): Promise<void> {
    clearJobTimer();
    try {
        const job = await $fetch<PassportJobDto>(`/api/passport/backups/jobs/${jobId}`);
        activeJob.value = job;
        if (job.state === "running") {
            jobTimer = setTimeout(() => void pollJob(jobId), 1000);
            return;
        }
        if (job.state === "done") {
            if (job.kind === "backup") {
                notification.success(t("ide.profile.backupDone"));
            }
            if (job.kind === "restore" && job.restore) {
                restoreResult.value = job.restore;
            }
            void loadBackups();
        }
        if (job.state === "error" && isUnlinkedErrorMessage(job.error)) {
            await loadStatus();
        }
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("ide.profile.jobPollFailed")));
        activeJob.value = null;
    }
}

/**
 * 后台任务错误信息里辨认「未关联」：任务内部无法抛 HTTP 409，只能靠文案兜底刷新状态。
 */
function isUnlinkedErrorMessage(message: string | null): boolean {
    return message !== null && message.includes("重新关联");
}

function clearJobTimer(): void {
    if (jobTimer !== null) {
        clearTimeout(jobTimer);
        jobTimer = null;
    }
}

/**
 * 删除云端备份（两步确认）。
 */
async function removeBackup(backupId: number): Promise<void> {
    if (confirmDeleteId.value !== backupId) {
        confirmDeleteId.value = backupId;
        confirmRestoreId.value = null;
        return;
    }
    confirmDeleteId.value = null;
    try {
        await $fetch(`/api/passport/backups/${backupId}`, {method: "DELETE"});
        notification.success(t("ide.profile.deleteDone"));
        void loadBackups();
    } catch (error) {
        if (isUnlinkedError(error)) {
            await loadStatus();
            notification.error(t("ide.profile.relinkRequired"));
            return;
        }
        notification.error(resolveApiErrorMessage(error, t("ide.profile.deleteFailed")));
    }
}

/** 任务进度文案 */
const jobProgressText = computed(() => {
    const job = activeJob.value;
    if (!job || job.state !== "running") {
        return "";
    }
    const progress = job.progress;
    if (!progress) {
        return t("ide.profile.jobPreparing");
    }
    const phaseText = t(`ide.profile.phase.${progress.phase}`);
    if (progress.phase === "packing") {
        return `${phaseText} ${progress.done}/${progress.total ?? "?"}`;
    }
    if ((progress.phase === "downloading" || progress.phase === "verifying") && progress.total) {
        return `${phaseText} ${formatBytes(progress.done)}/${formatBytes(progress.total)}`;
    }
    if (progress.phase === "unpacking") {
        return `${phaseText} ${progress.done}`;
    }
    return phaseText;
});

/** 字节数人性化展示 */
function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    const units = ["KiB", "MiB", "GiB"];
    let value = bytes;
    let unit = "B";
    for (const next of units) {
        if (value < 1024) {
            break;
        }
        value /= 1024;
        unit = next;
    }
    return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}

function formatTime(iso: string | null): string {
    if (!iso) {
        return "-";
    }
    return new Date(iso).toLocaleString(undefined, {dateStyle: "short", timeStyle: "short"});
}

onMounted(() => void loadStatus());
onBeforeUnmount(() => {
    clearJobTimer();
});
</script>

<template>
    <!-- NeuroBook 官网账号 Profile -->
    <div class="space-y-4 pt-1">
        <div class="max-w-xl">
            <h3 class="text-base font-semibold text-[var(--text-main)]">{{ t("ide.profile.title") }}</h3>
            <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ t("ide.profile.description") }}</p>
        </div>

        <div v-if="statusLoading && !status" class="flex min-h-[160px] items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)]">
            <span class="i-lucide-loader-2 h-6 w-6 animate-spin text-[var(--text-muted)]"></span>
        </div>

        <div v-else-if="statusError" class="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-5 text-center">
            <span class="i-lucide-circle-alert h-6 w-6 text-[var(--status-danger)]"></span>
            <p class="max-w-lg text-xs text-[var(--status-danger)]">{{ statusError }}</p>
            <button type="button" class="inline-flex items-center gap-1.5 rounded-md border border-[var(--status-danger-border)] px-3 py-1.5 text-xs font-medium text-[var(--status-danger)] transition-colors hover:bg-[var(--bg-hover)]" @click="void loadStatus()">
                <span class="i-lucide-refresh-cw h-3.5 w-3.5"></span>{{ t("ide.profile.retry") }}
            </button>
        </div>

        <template v-else-if="status">
            <!-- 关联卡片 -->
            <section class="rounded-xl border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] bg-opacity-20 p-5 shadow-sm">
                <!-- 已关联 -->
                <template v-if="status.linked">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="flex min-w-0 items-start gap-3">
                            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-bg)] text-[var(--accent-text)]">
                                <span class="i-lucide-user-round-check h-4 w-4"></span>
                            </div>
                            <div class="min-w-0">
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="text-sm font-semibold text-[var(--text-main)]">{{ status.account?.displayName || status.account?.username }}</span>
                                    <span class="text-xs text-[var(--text-muted)]">@{{ status.account?.username }}</span>
                                </div>
                                <p class="mt-1 truncate text-xs text-[var(--text-secondary)]">{{ OFFICIAL_PASSPORT_SITE_URL }} · {{ t("ide.profile.linkedAt") }} {{ formatTime(status.linkedAt) }}</p>
                                <div class="mt-1.5 flex flex-wrap gap-1.5">
                                    <span v-for="scope in status.scopes" :key="scope" class="rounded-full border border-[var(--border-color)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">{{ scope }}</span>
                                </div>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <a :href="`${OFFICIAL_PASSPORT_SITE_URL}/me?tab=account`" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                                <span class="i-lucide-external-link h-3.5 w-3.5"></span>{{ t("ide.profile.editProfile") }}
                            </a>
                            <button v-if="confirmUnlink" type="button" class="rounded-md border border-[var(--border-color)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="confirmUnlink = false">{{ t("common.cancel") }}</button>
                            <button type="button" class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium" :class="confirmUnlink ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'" :disabled="unlinkBusy" @click="unlink">
                                <span class="i-lucide-unlink h-3.5 w-3.5"></span>{{ confirmUnlink ? t("ide.profile.unlinkConfirm") : t("ide.profile.unlink") }}
                            </button>
                        </div>
                    </div>
                </template>

                <!-- 关联进行中：展示 userCode 与批准页链接 -->
                <template v-else-if="linkSession && (linkPhase === 'waiting' || linkPhase === 'retryable_error')">
                    <div class="flex flex-col items-center gap-3 py-4 text-center">
                        <p class="text-sm text-[var(--text-secondary)]">{{ t("ide.profile.waitingHint") }}</p>
                        <div class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-6 py-3 font-mono text-2xl font-bold tracking-widest text-[var(--text-main)]">{{ linkSession.userCode }}</div>
                        <a :href="linkSession.verificationUriComplete" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 text-sm text-[var(--accent-text)] hover:underline">
                            <span class="i-lucide-external-link h-3.5 w-3.5"></span>{{ t("ide.profile.openApprovePage") }}
                        </a>
                        <div v-if="linkPhase === 'waiting'" class="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                            <span class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>{{ t("ide.profile.waitingApproval") }}
                        </div>
                        <p v-else class="text-xs text-[var(--status-warning)]">{{ t("ide.profile.linkPollPaused") }}</p>
                        <div class="flex flex-wrap items-center justify-center gap-2">
                            <button v-if="linkPhase === 'retryable_error'" type="button" class="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="linkChecking" @click="retryLink">
                                <span :class="linkChecking ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-refresh-cw'" class="h-3.5 w-3.5"></span>{{ t("ide.profile.linkCheckAgain") }}
                            </button>
                            <button v-if="linkPhase === 'retryable_error'" type="button" class="rounded-md border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="startLink">{{ t("ide.profile.linkRestart") }}</button>
                            <button type="button" class="text-xs text-[var(--text-muted)] hover:underline" @click="cancelLink">{{ t("common.cancel") }}</button>
                        </div>
                    </div>
                </template>

                <!-- 关联提交失败：设备码不再重试，避免重复兑换一次性授权 -->
                <template v-else-if="linkPhase === 'failed' && linkFailure">
                    <div class="flex flex-col items-center gap-3 py-4 text-center">
                        <span class="i-lucide-circle-alert h-8 w-8 text-[var(--status-danger)]"></span>
                        <p class="max-w-xl text-sm text-[var(--text-main)]">{{ linkFailure.reason === "credential_persist_failed" ? t("ide.profile.linkPersistFailed") : t("ide.profile.linkExchangeInvalid") }}</p>
                        <a v-if="linkFailure.reason === 'credential_persist_failed' && linkFailure.remoteAuthorization === 'unknown'" :href="`${OFFICIAL_PASSPORT_SITE_URL}/me?tab=instances`" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 text-xs text-[var(--accent-text)] hover:underline">
                            <span class="i-lucide-external-link h-3.5 w-3.5"></span>{{ t("ide.profile.manageAuthorizations") }}
                        </a>
                        <button type="button" class="rounded-md border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="startLink">{{ t("ide.profile.linkRestart") }}</button>
                    </div>
                </template>

                <!-- 关联终态：过期 / 被拒绝 -->
                <template v-else-if="linkPhase === 'expired' || linkPhase === 'denied'">
                    <div class="flex flex-col items-center gap-2 py-4 text-center">
                        <span class="i-lucide-alert-circle h-8 w-8 text-[var(--status-danger)]"></span>
                        <p class="text-sm text-[var(--text-main)]">{{ linkPhase === "expired" ? t("ide.profile.linkExpired") : t("ide.profile.linkDenied") }}</p>
                        <button type="button" class="rounded-md border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="cancelLink">{{ t("ide.profile.backToStart") }}</button>
                    </div>
                </template>

                <!-- 未关联 -->
                <template v-else>
                    <div class="flex flex-col gap-3">
                        <p class="text-xs text-[var(--text-secondary)]">{{ t("ide.profile.unlinkedHint") }}</p>
                        <div>
                            <button type="button" class="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-main)] px-3 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50" :disabled="linkBusy" @click="startLink">
                                <span :class="linkBusy ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-link'" class="h-3.5 w-3.5"></span>{{ t("ide.profile.linkAction") }}
                            </button>
                        </div>
                    </div>
                </template>
            </section>

            <!-- 云备份区（已关联时显示） -->
            <section v-if="status.linked" class="rounded-xl border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] bg-opacity-20 p-5 shadow-sm">
                <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div class="flex items-center gap-2">
                        <span class="flex h-5 w-5 items-center justify-center rounded bg-[var(--accent-bg)] text-[var(--accent-text)]">
                            <span class="i-lucide-cloud-upload h-3.5 w-3.5"></span>
                        </span>
                        <h4 class="text-xs font-bold tracking-wider text-[var(--text-main)]">{{ t("ide.profile.backupTitle") }}</h4>
                    </div>
                    <div class="flex items-center gap-2">
                        <FormInput v-model="backupComment" class="w-48" :placeholder="t('ide.profile.commentPlaceholder')" />
                        <button type="button" class="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-main)] px-3 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50" :disabled="activeJob?.state === 'running'" @click="startBackup">
                            <span class="i-lucide-cloud-upload h-3.5 w-3.5"></span>{{ t("ide.profile.backupNow") }}
                        </button>
                    </div>
                </div>
                <p class="mb-3 text-xs text-[var(--text-secondary)]">{{ t("ide.profile.backupDescription") }}</p>

                <!-- 本地备份密钥管理：这里只显示 keyId，完整恢复码由独立 Dialog 承载。 -->
                <div class="mb-4 space-y-2 border-y border-[var(--border-color)] py-3">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <p class="text-xs font-semibold text-[var(--text-main)]">{{ t("ide.profile.keys.sectionTitle") }}</p>
                            <p class="mt-0.5 text-[11px] text-[var(--text-muted)]">{{ t("ide.profile.keys.sectionDescription") }}</p>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] px-2.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="openKeyDialog('import')">
                                <span class="i-lucide-key-round h-3 w-3"></span>{{ t("ide.profile.keys.importAction") }}
                            </button>
                            <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] px-2.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="openKeyDialog('prepare', '', Boolean(backupKeys?.activeKeyId))">
                                <span class="i-lucide-refresh-cw h-3 w-3"></span>{{ backupKeys?.activeKeyId ? t("ide.profile.keys.rotateAction") : t("ide.profile.keys.setupAction") }}
                            </button>
                        </div>
                    </div>
                    <div v-if="backupKeys?.keys.length" class="space-y-1">
                        <div v-for="key in backupKeys.keys" :key="key.keyId" class="flex min-w-0 items-center gap-2 text-[11px]">
                            <span class="font-mono text-[var(--text-secondary)]">{{ key.keyId }}</span>
                            <span class="rounded px-1.5 py-0.5" :class="key.state === 'active' ? 'bg-[var(--status-success-bg)] text-[var(--status-success)]' : key.state === 'pending' ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)]' : 'bg-[var(--bg-input)] text-[var(--text-muted)]'">{{ t(`ide.profile.keys.state.${key.state}`) }}</span>
                            <span class="flex-1"></span>
                            <button v-if="key.state !== 'pending'" type="button" class="inline-flex h-6 items-center gap-1 px-1.5 text-[var(--accent-text)] hover:underline" @click="openKeyDialog('export', key.keyId)">
                                <span class="i-lucide-download h-3 w-3"></span>{{ t("ide.profile.keys.exportAction") }}
                            </button>
                        </div>
                    </div>
                    <p v-else class="text-[11px] text-[var(--status-warning)]">{{ t("ide.profile.keys.notConfigured") }}</p>
                </div>

                <!-- 任务进度 / 结果 -->
                <div v-if="activeJob?.state === 'running'" class="mb-3 flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                    <span class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>{{ jobProgressText }}
                </div>
                <div v-else-if="activeJob?.state === 'error'" class="mb-3 flex items-start gap-2 rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-xs text-[var(--status-danger)]">
                    <span class="i-lucide-alert-circle mt-0.5 h-3.5 w-3.5 shrink-0"></span>{{ activeJob.error }}
                </div>
                <div v-if="activeJob && activeJob.warnings.length > 0" class="mb-3 rounded-lg border border-[var(--status-warning-border,var(--border-color))] bg-[var(--bg-panel)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                    <p v-for="warning in activeJob.warnings" :key="warning">{{ warning }}</p>
                </div>

                <!-- 恢复完成指引 -->
                <div v-if="restoreResult" class="mb-3 rounded-lg border border-[var(--accent-main)] bg-[var(--bg-panel)] p-4 text-xs">
                    <div class="mb-2 flex items-center justify-between gap-2">
                        <p class="flex items-center gap-1.5 font-semibold text-[var(--text-main)]"><span class="i-lucide-check-circle-2 h-4 w-4 text-[var(--status-success)]"></span>{{ t("ide.profile.restoreDoneTitle") }}</p>
                        <button type="button" class="text-[var(--text-muted)] hover:text-[var(--text-main)]" @click="restoreResult = null"><span class="i-lucide-x h-3.5 w-3.5"></span></button>
                    </div>
                    <p class="text-[var(--text-secondary)]">{{ t("ide.profile.restoreDoneDir") }}</p>
                    <p class="mt-1 break-all rounded bg-[var(--bg-input)] px-2 py-1 font-mono text-[var(--text-main)]">{{ restoreResult.restoreDir }}</p>
                    <ol class="mt-2 list-decimal space-y-1 pl-5 text-[var(--text-secondary)]">
                        <li>{{ t("ide.profile.restoreStep1") }}</li>
                        <li>{{ t("ide.profile.restoreStep2") }}</li>
                        <li>{{ t("ide.profile.restoreStep3") }}</li>
                    </ol>
                    <p class="mt-2 text-[var(--status-danger)]">{{ t("ide.profile.restoreSecretsWarning") }}</p>
                </div>

                <!-- 配额用量 -->
                <div v-if="backups" class="mb-3 flex flex-col gap-1.5">
                    <div class="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                        <span>{{ t("ide.profile.quotaUsage") }}</span>
                        <span>{{ formatBytes(backups.quota.usedBytes) }} / {{ formatBytes(backups.quota.maxBytes) }} · {{ backups.quota.count }}/{{ backups.quota.maxCount }}</span>
                    </div>
                    <div class="h-1.5 overflow-hidden rounded-full bg-[var(--bg-input)]">
                        <div class="h-full rounded-full bg-[var(--accent-main)] transition-all" :style="{width: `${usagePercent}%`}"></div>
                    </div>
                </div>

                <div v-if="backupsError" class="mb-3 text-xs text-[var(--status-danger)]">{{ backupsError }}</div>
                <div v-if="backupsLoading && !backups" class="flex justify-center py-4"><span class="i-lucide-loader-2 h-5 w-5 animate-spin text-[var(--text-muted)]"></span></div>

                <!-- 备份列表 -->
                <p v-if="backups && backups.items.length === 0" class="py-2 text-center text-xs text-[var(--text-muted)]">{{ t("ide.profile.noBackups") }}</p>
                <ul v-else-if="backups" class="flex flex-col gap-2">
                    <li v-for="backup in backups.items" :key="backup.id" class="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2 text-xs">
                        <span class="i-lucide-archive h-3.5 w-3.5 shrink-0 text-[var(--accent-text)]"></span>
                        <span class="font-medium text-[var(--text-main)]">{{ backup.instanceLabel }}</span>
                        <span class="text-[var(--text-muted)]">{{ formatBytes(backup.fileSize) }} · v{{ backup.appVersion }} · {{ formatTime(backup.createdAt) }}</span>
                        <span class="font-mono text-[10px] text-[var(--text-muted)]">keyId {{ backup.keyId }}</span>
                        <span v-if="backup.comment" class="truncate text-[var(--text-secondary)]">{{ backup.comment }}</span>
                        <span class="flex-1"></span>
                        <button type="button" class="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium" :class="confirmRestoreId === backup.id ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'" :disabled="activeJob?.state === 'running'" @click="startRestore(backup.id)">
                            <span class="i-lucide-history h-3 w-3"></span>{{ confirmRestoreId === backup.id ? t("ide.profile.restoreConfirm") : t("ide.profile.restore") }}
                        </button>
                        <button type="button" class="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium" :class="confirmDeleteId === backup.id ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'" @click="removeBackup(backup.id)">
                            <span class="i-lucide-trash-2 h-3 w-3"></span>{{ confirmDeleteId === backup.id ? t("ide.profile.deleteConfirm") : t("ide.profile.delete") }}
                        </button>
                    </li>
                </ul>
            </section>
        </template>

        <BackupRecoveryCodeDialog
            v-model="keyDialogOpen"
            :mode="keyDialogMode"
            :key-id="keyDialogKeyId"
            :rotation="keyDialogRotation"
            @confirmed="handleKeyConfirmed"
            @imported="handleKeyImported"
            @cancelled="handleKeyDialogCancelled"
        />
    </div>
</template>
