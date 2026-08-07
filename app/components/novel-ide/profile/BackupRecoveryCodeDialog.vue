<script setup lang="ts">
import Dialog from "nbook/app/components/common/Dialog.vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {
    PassportBackupKeyExportDto,
    PassportBackupKeyPrepareDto,
    PassportBackupKeyringDto,
} from "nbook/shared/dto/passport.dto";

type DialogMode = "prepare" | "import" | "export";

const props = withDefaults(defineProps<{
    modelValue: boolean;
    mode: DialogMode;
    /** import/export 的目标 keyId；prepare 时为空。 */
    keyId?: string;
    /** prepare 是否由主动轮换触发。 */
    rotation?: boolean;
}>(), {
    keyId: "",
    rotation: false,
});

const emit = defineEmits<{
    (event: "update:modelValue", value: boolean): void;
    (event: "confirmed", keyId: string): void;
    (event: "imported", keyId: string): void;
    (event: "cancelled"): void;
}>();

const {t} = useI18n();
const busy = ref(false);
const error = ref("");
const recoveryCode = ref("");
const shownKeyId = ref("");
const importedCode = ref("");
const password = ref("");
const deliverySucceeded = ref(false);
const acknowledged = ref(false);
const deliveryMessage = ref("");
let initializationId = 0;

const title = computed(() => {
    if (props.mode === "import") {
        return t("ide.profile.keys.importTitle");
    }
    if (props.mode === "export") {
        return t("ide.profile.keys.exportTitle");
    }
    return props.rotation
        ? t("ide.profile.keys.rotateTitle")
        : t("ide.profile.keys.prepareTitle");
});

const canConfirmPreparedKey = computed(() => deliverySucceeded.value && acknowledged.value && Boolean(recoveryCode.value));

/**
 * 每次打开时清空只属于本次交互的状态；prepare 会从服务端复用 pending key。
 */
async function initialize(): Promise<void> {
    const currentId = ++initializationId;
    error.value = "";
    recoveryCode.value = "";
    shownKeyId.value = props.keyId;
    importedCode.value = "";
    password.value = "";
    deliverySucceeded.value = false;
    acknowledged.value = false;
    deliveryMessage.value = "";
    if (props.mode !== "prepare") {
        return;
    }

    busy.value = true;
    try {
        const prepared = await $fetch<PassportBackupKeyPrepareDto>("/api/passport/backup-keys/prepare", {method: "POST"});
        if (currentId !== initializationId || !props.modelValue) {
            return;
        }
        recoveryCode.value = prepared.recoveryCode;
        shownKeyId.value = prepared.key.keyId;
    } catch (requestError) {
        if (currentId === initializationId) {
            error.value = resolveApiErrorMessage(requestError, t("ide.profile.keys.prepareFailed"));
        }
    } finally {
        if (currentId === initializationId) {
            busy.value = false;
        }
    }
}

/**
 * 关闭 Dialog。pending key 留在 keyring，下一次打开会继续展示同一恢复码。
 */
function close(): void {
    if (busy.value) {
        return;
    }
    initializationId += 1;
    emit("cancelled");
    emit("update:modelValue", false);
}

/**
 * 复制成功后才把“已保存”通道标记为可确认；失败只在 Dialog 内提示。
 */
async function copyRecoveryCode(): Promise<void> {
    error.value = "";
    try {
        if (!navigator.clipboard?.writeText) {
            throw new Error("clipboard_unavailable");
        }
        await navigator.clipboard.writeText(recoveryCode.value);
        deliverySucceeded.value = true;
        deliveryMessage.value = t("ide.profile.keys.copied");
    } catch {
        error.value = t("ide.profile.keys.copyFailed");
    }
}

/**
 * 下载纯文本恢复码文件；创建下载动作成功后标记第二条保存通道。
 */
function downloadRecoveryCode(): void {
    error.value = "";
    try {
        const content = [
            "NeuroBook Backup Recovery Code",
            `keyId: ${shownKeyId.value}`,
            "",
            recoveryCode.value,
            "",
            t("ide.profile.keys.fileWarning"),
        ].join("\n");
        const url = URL.createObjectURL(new Blob([content], {type: "text/plain;charset=utf-8"}));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `neurobook-backup-recovery-${shownKeyId.value}.txt`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        deliverySucceeded.value = true;
        deliveryMessage.value = t("ide.profile.keys.downloaded");
    } catch {
        error.value = t("ide.profile.keys.downloadFailed");
    }
}

/**
 * 只有保存动作成功且用户明确确认后，才激活 pending key。
 */
async function confirmPreparedKey(): Promise<void> {
    if (!canConfirmPreparedKey.value) {
        return;
    }
    busy.value = true;
    error.value = "";
    try {
        await $fetch<PassportBackupKeyringDto>("/api/passport/backup-keys/confirm", {
            method: "POST",
            body: {keyId: shownKeyId.value},
        });
        emit("confirmed", shownKeyId.value);
        emit("update:modelValue", false);
    } catch (requestError) {
        error.value = resolveApiErrorMessage(requestError, t("ide.profile.keys.confirmFailed"));
    } finally {
        busy.value = false;
    }
}

/**
 * 导入恢复码，并确认它确实对应当前待恢复备份的 keyId。
 */
async function importRecoveryCode(): Promise<void> {
    if (!importedCode.value.trim()) {
        return;
    }
    busy.value = true;
    error.value = "";
    try {
        const status = await $fetch<PassportBackupKeyringDto>("/api/passport/backup-keys/import", {
            method: "POST",
            body: {recoveryCode: importedCode.value},
        });
        const importedKeyId = props.keyId || status.keys.at(-1)?.keyId || "";
        if (props.keyId && !status.keys.some((key) => key.keyId === props.keyId)) {
            error.value = t("ide.profile.keys.importMismatch", {keyId: props.keyId});
            return;
        }
        importedCode.value = "";
        emit("imported", importedKeyId);
        emit("update:modelValue", false);
    } catch (requestError) {
        error.value = resolveApiErrorMessage(requestError, t("ide.profile.keys.importFailed"));
    } finally {
        busy.value = false;
    }
}

/**
 * 复验当前账号密码后显示指定历史或 active key 的恢复码。
 */
async function exportRecoveryCode(): Promise<void> {
    if (!password.value) {
        return;
    }
    busy.value = true;
    error.value = "";
    try {
        const exported = await $fetch<PassportBackupKeyExportDto>("/api/passport/backup-keys/export", {
            method: "POST",
            body: {keyId: props.keyId, password: password.value},
        });
        password.value = "";
        shownKeyId.value = exported.keyId;
        recoveryCode.value = exported.recoveryCode;
        deliverySucceeded.value = false;
        acknowledged.value = false;
        deliveryMessage.value = "";
    } catch (requestError) {
        error.value = resolveApiErrorMessage(requestError, t("ide.profile.keys.exportFailed"));
    } finally {
        busy.value = false;
    }
}

watch(() => props.modelValue, (visible) => {
    if (visible) {
        void initialize();
    }
});
</script>

<template>
    <!-- 云备份恢复码独立模态框：完整恢复码只在这里出现。 -->
    <Dialog :model-value="modelValue" size="lg" :title="title" :busy="busy" :close-on-overlay="false" overlay-type="opaque" @request-close="close">
        <template v-if="mode === 'prepare'">
            <div class="flex gap-3 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-3 text-[var(--status-danger)]">
                <span class="i-lucide-triangle-alert mt-0.5 h-5 w-5 shrink-0"></span>
                <div class="space-y-1">
                    <p class="text-sm font-semibold">{{ t("ide.profile.keys.lossWarningTitle") }}</p>
                    <p class="text-xs leading-relaxed">{{ t("ide.profile.keys.lossWarning") }}</p>
                </div>
            </div>
            <div v-if="recoveryCode" class="space-y-3">
                <div class="space-y-1">
                    <span class="text-xs text-[var(--text-muted)]">keyId</span>
                    <p class="font-mono text-xs text-[var(--text-secondary)]">{{ shownKeyId }}</p>
                </div>
                <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3 font-mono text-sm leading-relaxed text-[var(--text-main)] [overflow-wrap:anywhere]">{{ recoveryCode }}</div>
                <div class="flex flex-wrap gap-2">
                    <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-xs text-[var(--text-main)] hover:bg-[var(--bg-hover)]" @click="copyRecoveryCode">
                        <span class="i-lucide-copy h-3.5 w-3.5"></span>{{ t("ide.profile.keys.copy") }}
                    </button>
                    <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-xs text-[var(--text-main)] hover:bg-[var(--bg-hover)]" @click="downloadRecoveryCode">
                        <span class="i-lucide-download h-3.5 w-3.5"></span>{{ t("ide.profile.keys.download") }}
                    </button>
                </div>
                <p v-if="deliveryMessage" class="text-xs text-[var(--status-success)]">{{ deliveryMessage }}</p>
                <label class="flex items-start gap-2 text-xs" :class="deliverySucceeded ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)]'">
                    <input v-model="acknowledged" type="checkbox" class="mt-0.5 accent-[var(--accent-main)]" :disabled="!deliverySucceeded" />
                    <span>{{ t("ide.profile.keys.savedElsewhere") }}</span>
                </label>
            </div>
            <div v-else-if="busy" class="flex min-h-28 items-center justify-center"><span class="i-lucide-loader-2 h-5 w-5 animate-spin"></span></div>
        </template>

        <template v-else-if="mode === 'import'">
            <p class="text-xs">{{ t("ide.profile.keys.importDescription", {keyId}) }}</p>
            <textarea v-model="importedCode" rows="4" autocomplete="off" spellcheck="false" class="w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3 font-mono text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" :placeholder="t('ide.profile.keys.importPlaceholder')"></textarea>
        </template>

        <template v-else>
            <div v-if="!recoveryCode" class="space-y-3">
                <p class="text-xs">{{ t("ide.profile.keys.exportDescription", {keyId}) }}</p>
                <input v-model="password" type="password" autocomplete="current-password" class="h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" :placeholder="t('ide.profile.keys.passwordPlaceholder')" @keyup.enter="exportRecoveryCode" />
            </div>
            <div v-else class="space-y-3">
                <div class="flex gap-2 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-3 text-xs text-[var(--status-warning)]">
                    <span class="i-lucide-key-round mt-0.5 h-4 w-4 shrink-0"></span>{{ t("ide.profile.keys.exportSaveReminder") }}
                </div>
                <p class="font-mono text-xs text-[var(--text-muted)]">keyId: {{ shownKeyId }}</p>
                <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3 font-mono text-sm leading-relaxed text-[var(--text-main)] [overflow-wrap:anywhere]">{{ recoveryCode }}</div>
                <div class="flex flex-wrap gap-2">
                    <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-xs text-[var(--text-main)] hover:bg-[var(--bg-hover)]" @click="copyRecoveryCode"><span class="i-lucide-copy h-3.5 w-3.5"></span>{{ t("ide.profile.keys.copy") }}</button>
                    <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-xs text-[var(--text-main)] hover:bg-[var(--bg-hover)]" @click="downloadRecoveryCode"><span class="i-lucide-download h-3.5 w-3.5"></span>{{ t("ide.profile.keys.download") }}</button>
                </div>
                <p v-if="deliveryMessage" class="text-xs text-[var(--status-success)]">{{ deliveryMessage }}</p>
            </div>
        </template>

        <p v-if="error" class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-xs text-[var(--status-danger)]">{{ error }}</p>

        <template #footer>
            <button type="button" class="inline-flex h-8 items-center justify-center rounded-md border border-[var(--border-color)] px-4 text-xs text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="busy" @click="close">{{ t("common.cancel") }}</button>
            <button v-if="mode === 'prepare'" type="button" class="inline-flex h-8 items-center justify-center rounded-md bg-[var(--accent-main)] px-4 text-xs font-medium text-[var(--text-inverse)] disabled:opacity-40" :disabled="busy || !canConfirmPreparedKey" @click="confirmPreparedKey">{{ t("ide.profile.keys.confirmAndContinue") }}</button>
            <button v-else-if="mode === 'import'" type="button" class="inline-flex h-8 items-center justify-center rounded-md bg-[var(--accent-main)] px-4 text-xs font-medium text-[var(--text-inverse)] disabled:opacity-40" :disabled="busy || !importedCode.trim()" @click="importRecoveryCode">{{ t("ide.profile.keys.importAction") }}</button>
            <button v-else-if="!recoveryCode" type="button" class="inline-flex h-8 items-center justify-center rounded-md bg-[var(--accent-main)] px-4 text-xs font-medium text-[var(--text-inverse)] disabled:opacity-40" :disabled="busy || !password" @click="exportRecoveryCode">{{ t("ide.profile.keys.verifyAndShow") }}</button>
            <button v-else type="button" class="inline-flex h-8 items-center justify-center rounded-md bg-[var(--accent-main)] px-4 text-xs font-medium text-[var(--text-inverse)]" @click="close">{{ t("common.done") }}</button>
        </template>
    </Dialog>
</template>
