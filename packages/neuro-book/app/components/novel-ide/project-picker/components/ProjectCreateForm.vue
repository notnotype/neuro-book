<script setup lang="ts">
import {ref, nextTick} from "vue";
import {Button, FormInput, FormTextarea, Spinner} from "@notnotype/nb-ui/components";

const props = withDefaults(defineProps<{
    isCreating?: boolean;
    recoveryNotice?: string;
    recoveryError?: string;
    initialTitle?: string;
    initialSummary?: string;
}>(), {
    isCreating: false,
    recoveryNotice: "",
    recoveryError: "",
    initialTitle: "",
    initialSummary: "",
});

const emit = defineEmits<{
    (e: "submit", payload: {title: string; summary: string}): void;
    (e: "retry-recovery"): void;
}>();

const {t} = useI18n();

const title = ref(props.initialTitle || t("ide.bookshelf.defaultTitle"));
const summary = ref(props.initialSummary || "");
const titleInputRef = ref<{focus: () => void; select?: () => void} | null>(null);

function focusTitle(): void {
    titleInputRef.value?.focus();
}

function reset(): void {
    title.value = t("ide.bookshelf.defaultTitle");
    summary.value = "";
    nextTick(() => {
        focusTitle();
    });
}

function handleSubmit(): void {
    if (props.isCreating || props.recoveryError) return;
    emit("submit", {
        title: title.value.trim() || t("ide.bookshelf.defaultTitle"),
        summary: summary.value.trim(),
    });
}

defineExpose({
    title,
    summary,
    focusTitle,
    reset,
});
</script>

<template>
    <div data-project-create-form class="space-y-4">
        <!-- 创建中状态：内聚于表单组件内部，满足 ui-development-spec §4.1 规范（占满区域、居中、零布局抖动） -->
        <div
            v-if="isCreating"
            class="flex min-h-[190px] flex-col items-center justify-center gap-3 py-8 text-center"
            role="status"
            aria-live="polite"
            aria-busy="true"
        >
            <Spinner size="lg" />
            <div class="space-y-1">
                <h4 class="text-sm font-semibold text-[var(--text-main)]">{{ t("ide.bookshelf.creating") }}...</h4>
                <p class="text-xs text-[var(--text-secondary)]">正在初始化作品目录与元数据...</p>
            </div>
        </div>

        <template v-else>
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
                    <span class="mb-1.5 flex items-center justify-between font-medium">
                        <span>{{ t("ide.bookshelf.bookTitle") }}</span>
                        <span class="text-[11px] text-[var(--text-muted)] font-mono">{{ title.length }}/120</span>
                    </span>
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
                    <span class="mb-1.5 flex items-center justify-between font-medium">
                        <span>{{ t("ide.bookshelf.summary") }}</span>
                        <span class="text-[11px] text-[var(--text-muted)] font-mono">{{ summary.length }}/2000</span>
                    </span>
                    <FormTextarea
                        id="create-book-summary"
                        v-model="summary"
                        :rows="3"
                        :maxlength="2000"
                        :disabled="isCreating || Boolean(recoveryError)"
                    />
                </label>
            </form>
        </template>
    </div>
</template>
