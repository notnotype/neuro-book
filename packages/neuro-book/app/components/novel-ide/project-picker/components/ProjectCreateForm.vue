<script setup lang="ts">
import {ref, watch, nextTick} from "vue";
import {Button, FormInput, FormTextarea} from "@notnotype/nb-ui/components";

const props = defineProps<{
    isOpen: boolean;
    isCreating?: boolean;
    recoveryNotice?: string;
    recoveryError?: string;
}>();

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
    <form
        v-if="isOpen"
        class="rounded-[var(--radius-panel,8px)] border border-[var(--accent-main)] bg-[var(--bg-panel)] p-4 sm:p-5 shadow-sm transition-[border-color,box-shadow] [transition-duration:var(--motion-fast)]"
        data-project-create-form
        @keydown.esc.stop.prevent="handleCancel"
        @submit.prevent="handleSubmit"
    >
        <div class="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-main)]">
            <span class="i-lucide-book-plus h-4 w-4 text-[var(--accent-main)]"></span>
            {{ t("ide.bookshelf.createBook") }}
        </div>

        <!-- 恢复通知 -->
        <div
            v-if="recoveryNotice"
            class="mb-4 rounded-[var(--radius-control)] border border-[var(--status-warning-border,var(--status-warning))] bg-[color-mix(in_srgb,var(--status-warning)_8%,transparent)] px-3 py-2 text-sm text-[var(--status-warning)]"
            role="status"
        >
            {{ recoveryNotice }}
        </div>

        <!-- 恢复重试报错 -->
        <div
            v-if="recoveryError"
            class="mb-4 space-y-2 rounded-[var(--radius-control)] border border-[var(--status-danger-border,var(--status-danger))] bg-[color-mix(in_srgb,var(--status-danger)_8%,transparent)] px-3 py-2 text-sm text-[var(--status-danger)]"
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

        <div class="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_auto] lg:items-end">
            <label class="block text-xs text-[var(--text-secondary)]">
                <span class="mb-1.5 block font-medium">{{ t("ide.bookshelf.bookTitle") }}</span>
                <FormInput
                    ref="titleInputRef"
                    v-model="title"
                    :maxlength="120"
                    :disabled="isCreating || Boolean(recoveryError)"
                    autofocus
                />
            </label>
            <label class="block text-xs text-[var(--text-secondary)]">
                <span class="mb-1.5 block font-medium">{{ t("ide.bookshelf.summary") }}</span>
                <FormTextarea
                    v-model="summary"
                    :rows="2"
                    :maxlength="2000"
                    :disabled="isCreating || Boolean(recoveryError)"
                />
            </label>
            <div class="grid grid-cols-2 gap-2 lg:flex">
                <Button
                    type="button"
                    variant="secondary"
                    icon-class="i-lucide-x"
                    :disabled="isCreating || Boolean(recoveryError)"
                    @click="handleCancel"
                >
                    {{ t("ide.bookshelf.cancel") }}
                </Button>
                <Button
                    type="submit"
                    variant="primary"
                    :icon-class="isCreating ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-check'"
                    :disabled="isCreating || Boolean(recoveryError)"
                    :loading="isCreating"
                >
                    {{ isCreating ? t("ide.bookshelf.creating") : t("ide.bookshelf.create") }}
                </Button>
            </div>
        </div>
    </form>
</template>
