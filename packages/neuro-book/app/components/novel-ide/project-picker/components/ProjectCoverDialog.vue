<script setup lang="ts">
import {ref, watch, onBeforeUnmount} from "vue";
import {Dialog, Button} from "@notnotype/nb-ui/components";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import {canonicalImageMime, isUnspecifiedImageMime} from "nbook/shared/media/raster-image";

const props = defineProps<{
    modelValue: boolean;
    project: ProjectMetadataDto | null;
    busy?: boolean;
    recoveryNotice?: string;
    recoveryError?: string;
    coverUrl?: string;
    apiError?: string;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "upload", file: File): void;
    (e: "clear"): void;
    (e: "retry-recovery"): void;
    (e: "preview-original"): void;
}>();

const {t} = useI18n();

const selectedFile = ref<File | null>(null);
const previewUrl = ref("");
const errorMessage = ref("");
const fileInputRef = ref<HTMLInputElement | null>(null);

function resetSelection(): void {
    selectedFile.value = null;
    if (previewUrl.value) {
        URL.revokeObjectURL(previewUrl.value);
        previewUrl.value = "";
    }
    errorMessage.value = "";
}

watch(() => props.modelValue, (open) => {
    if (!open) {
        resetSelection();
    }
});

onBeforeUnmount(() => {
    resetSelection();
});

function handleFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    errorMessage.value = "";
    if (!file) return;

    const declaredMime = canonicalImageMime(file.type);
    if (!isUnspecifiedImageMime(file.type) && (declaredMime === null || declaredMime === "image/gif")) {
        errorMessage.value = t("ide.picker.coverTypeUnsupported");
        return;
    }
    if (file.size > 20 * 1024 * 1024) {
        errorMessage.value = t("ide.picker.coverTooLarge");
        return;
    }

    if (previewUrl.value) {
        URL.revokeObjectURL(previewUrl.value);
    }
    selectedFile.value = file;
    previewUrl.value = URL.createObjectURL(file);
}

function handleUpload(): void {
    if (!selectedFile.value || props.busy) return;
    emit("upload", selectedFile.value);
}

function handleClear(): void {
    if (props.busy) return;
    emit("clear");
}
</script>

<template>
    <Dialog
        :model-value="modelValue"
        size="md"
        :title="t('ide.picker.coverDialogTitle')"
        :busy="busy"
        :show-footer="false"
        closable
        overlay-type="opaque"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <div v-if="project" class="space-y-4" data-project-cover-dialog>
            <button
                v-if="previewUrl || coverUrl"
                type="button"
                class="mx-auto block w-full max-w-[240px] outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent-main)]"
                :aria-label="t('ide.imagePreview.openOriginal')"
                @click="emit('preview-original')"
            >
                <span class="relative block aspect-[2/3] overflow-hidden rounded-[var(--radius-panel,6px)] border border-[var(--border-color)] bg-[var(--bg-input)]">
                    <img
                        :src="previewUrl || coverUrl"
                        :alt="t('ide.picker.coverAlt', {title: project.title})"
                        class="h-full w-full object-cover"
                        decoding="async"
                    >
                    <span class="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-main)] shadow-sm">
                        <span class="i-lucide-maximize-2 h-4 w-4"></span>
                    </span>
                </span>
            </button>
            <div
                v-else
                class="mx-auto flex aspect-[2/3] w-full max-w-[240px] flex-col items-center justify-center gap-3 rounded-[var(--radius-panel,6px)] border border-dashed border-[var(--border-color)] bg-[var(--bg-subtle)] text-[var(--text-muted)]"
            >
                <span class="i-lucide-image h-8 w-8"></span>
                <span class="text-xs">{{ t("ide.picker.coverEmpty") }}</span>
            </div>

            <p class="text-center text-xs leading-5 text-[var(--text-muted)]">
                {{ t("ide.picker.coverRequirements") }}
            </p>

            <div
                v-if="recoveryNotice"
                class="rounded-[var(--radius-control)] border border-[var(--status-warning-border,var(--status-warning))] bg-[color-mix(in_srgb,var(--status-warning)_8%,transparent)] px-3 py-2 text-xs text-[var(--status-warning)]"
                role="status"
            >
                {{ recoveryNotice }}
            </div>
            <div
                v-if="recoveryError"
                class="space-y-2 rounded-[var(--radius-control)] border border-[var(--status-danger-border,var(--status-danger))] bg-[color-mix(in_srgb,var(--status-danger)_8%,transparent)] px-3 py-2 text-xs text-[var(--status-danger)]"
                role="alert"
            >
                <p>{{ recoveryError }}</p>
                <Button size="sm" variant="danger" icon-class="i-lucide-refresh-cw" :disabled="busy" @click="emit('retry-recovery')">
                    {{ t("ide.picker.mutationRecoveryRetry") }}
                </Button>
            </div>
            <div
                v-if="apiError || errorMessage"
                class="rounded-[var(--radius-control)] border border-[var(--status-danger-border,var(--status-danger))] bg-[color-mix(in_srgb,var(--status-danger)_8%,transparent)] px-3 py-2 text-xs text-[var(--status-danger)]"
                role="alert"
            >
                {{ apiError || errorMessage }}
            </div>

            <input
                ref="fileInputRef"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/avif"
                class="hidden"
                :aria-label="t('ide.picker.chooseCover')"
                @change="handleFileChange"
            >

            <div class="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
                <Button
                    v-if="project.cover"
                    variant="danger"
                    size="sm"
                    icon-class="i-lucide-trash-2"
                    :disabled="busy || Boolean(recoveryError)"
                    @click="handleClear"
                >
                    {{ t("ide.picker.clearCover") }}
                </Button>
                <Button
                    v-if="selectedFile"
                    variant="secondary"
                    size="sm"
                    icon-class="i-lucide-x"
                    :disabled="busy || Boolean(recoveryError)"
                    @click="resetSelection"
                >
                    {{ t("common.cancel") }}
                </Button>
                <Button
                    variant="secondary"
                    size="sm"
                    icon-class="i-lucide-upload"
                    :disabled="busy || Boolean(recoveryError)"
                    @click="fileInputRef?.click()"
                >
                    {{ selectedFile || project.cover ? t("ide.picker.replaceCover") : t("ide.picker.chooseCover") }}
                </Button>
                <Button
                    v-if="selectedFile"
                    variant="primary"
                    size="sm"
                    icon-class="i-lucide-check"
                    :disabled="busy || Boolean(recoveryError)"
                    :loading="busy"
                    @click="handleUpload"
                >
                    {{ t("ide.picker.saveCover") }}
                </Button>
            </div>
        </div>
    </Dialog>
</template>
