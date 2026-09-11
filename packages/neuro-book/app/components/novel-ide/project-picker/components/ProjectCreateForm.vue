<script setup lang="ts">
import {ref, watch, nextTick} from "vue";
import {Button, DialogWindow, FormInput, FormTextarea} from "@notnotype/nb-ui/components";

const props = withDefaults(defineProps<{
    isOpen: boolean;
    isCreating?: boolean;
    recoveryNotice?: string;
    recoveryError?: string;
    teleportTarget?: string | boolean;
}>(), {
    isCreating: false,
    recoveryNotice: "",
    recoveryError: "",
    teleportTarget: "body",
});

const emit = defineEmits<{
    (e: "cancel"): void;
    (e: "submit", payload: {title: string; summary: string}): void;
    (e: "retry-recovery"): void;
}>();

const {t} = useI18n();

const title = ref(t("ide.bookshelf.defaultTitle"));
const summary = ref("");
const titleInputRef = ref<{focus: () => void; select?: () => void} | null>(null);

watch(() => props.isOpen, async (open) => {
    if (open) {
        title.value = t("ide.bookshelf.defaultTitle");
        summary.value = "";
        await nextTick();
        titleInputRef.value?.focus();
    }
});

function handleCancel(): void {
    if (props.isCreating || props.recoveryError) return;
    emit("cancel");
}

function handleSubmit(): void {
    if (props.isCreating || props.recoveryError) return;
    emit("submit", {
        title: title.value.trim() || t("ide.bookshelf.defaultTitle"),
        summary: summary.value.trim(),
    });
}
</script>

<template>
    <DialogWindow
        :model-value="props.isOpen"
        :title="t('ide.bookshelf.createBook')"
        :width="540"
        :min-width="360"
        :min-height="240"
        resizable
        :busy="props.isCreating"
        :teleport-target="props.teleportTarget"
        body-class="p-5"
        @update:model-value="!$event && handleCancel()"
    >
        <div data-project-create-form class="space-y-4">
            <!-- 恢复通知 -->
            <div
                v-if="recoveryNotice"
                class="rounded-[var(--radius-control)] border border-[var(--status-warning-border,var(--status-warning))] bg-[color-mix(in_srgb,var(--status-warning)_8%,transparent)] px-3 py-2 text-sm text-[var(--status-warning)]"
                role="status"
            >
                {{ recoveryNotice }}
            </div>

            <!-- 恢复重试报错 -->
            <div
                v-if="recoveryError"
                class="space-y-2 rounded-[var(--radius-control)] border border-[var(--status-danger-border,var(--status-danger))] bg-[color-mix(in_srgb,var(--status-danger)_8%,transparent)] px-3 py-2 text-sm text-[var(--status-danger)]"
                role="alert"
            >
                <p>{{ recoveryError }}</p>
                <Button
                    size="sm"
                    variant="danger"
                    icon-class="i-lucide-refresh-cw"
                    :disabled="isCreating"
                    @click="emit('retry-recovery')"
                >
                    {{ t("ide.picker.mutationRecoveryRetry") }}
                </Button>
            </div>

            <form id="create-project-form" class="space-y-4" @submit.prevent="handleSubmit">
                <label for="create-book-title" class="block text-xs text-[var(--text-secondary)]">
                    <span class="mb-1.5 block font-medium">{{ t("ide.bookshelf.bookTitle") }}</span>
                    <FormInput
                        id="create-book-title"
                        ref="titleInputRef"
                        v-model="title"
                        :maxlength="120"
                        :disabled="isCreating || Boolean(recoveryError)"
                        autofocus
                    />
                </label>
                <label for="create-book-summary" class="block text-xs text-[var(--text-secondary)]">
                    <span class="mb-1.5 block font-medium">{{ t("ide.bookshelf.summary") }}</span>
                    <FormTextarea
                        id="create-book-summary"
                        v-model="summary"
                        :rows="3"
                        :maxlength="2000"
                        :disabled="isCreating || Boolean(recoveryError)"
                    />
                </label>
            </form>
        </div>

        <template #footer>
            <Button
                type="button"
                variant="secondary"
                size="sm"
                :disabled="isCreating || Boolean(recoveryError)"
                @click="handleCancel"
            >
                {{ t("ide.bookshelf.cancel") }}
            </Button>
            <Button
                type="submit"
                form="create-project-form"
                variant="primary"
                size="sm"
                :icon-class="isCreating ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-check'"
                :disabled="isCreating || Boolean(recoveryError) || !title.trim()"
                :loading="isCreating"
            >
                {{ isCreating ? t("ide.bookshelf.creating") : t("ide.bookshelf.create") }}
            </Button>
        </template>
    </DialogWindow>
</template>
