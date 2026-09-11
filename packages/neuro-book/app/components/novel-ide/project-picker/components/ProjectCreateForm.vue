<script setup lang="ts">
import {ref, computed, nextTick} from "vue";
import {Button, FormInput, FormTextarea, Spinner} from "@notnotype/nb-ui/components";
import ProjectCreateCoverPreview from "./ProjectCreateCoverPreview.vue";

const props = withDefaults(defineProps<{
    isCreating?: boolean;
    recoveryNotice?: string;
    recoveryError?: string;
    initialTitle?: string;
    initialSummary?: string;
    initialGenre?: string;
}>(), {
    isCreating: false,
    recoveryNotice: "",
    recoveryError: "",
    initialTitle: "",
    initialSummary: "",
    initialGenre: "general",
});

const emit = defineEmits<{
    (e: "submit", payload: {title: string; summary: string; genre?: string}): void;
    (e: "retry-recovery"): void;
}>();

const {t} = useI18n();

const title = ref(props.initialTitle || t("ide.bookshelf.defaultTitle"));
const summary = ref(props.initialSummary || "");
const genre = ref(props.initialGenre || "general");
const titleInputRef = ref<{focus: () => void; select?: () => void} | null>(null);

const genreOptions = computed(() => [
    {id: "general", label: t("ide.picker.genres.general")},
    {id: "xuanhuan", label: t("ide.picker.genres.xuanhuan")},
    {id: "scifi", label: t("ide.picker.genres.scifi")},
    {id: "urban", label: t("ide.picker.genres.urban")},
    {id: "mystery", label: t("ide.picker.genres.mystery")},
    {id: "world", label: t("ide.picker.genres.world")},
]);

function focusTitle(): void {
    titleInputRef.value?.focus();
}

function reset(): void {
    title.value = t("ide.bookshelf.defaultTitle");
    summary.value = "";
    genre.value = "general";
    nextTick(() => {
        focusTitle();
    });
}

function handleSubmit(): void {
    if (props.isCreating || props.recoveryError) return;
    emit("submit", {
        title: title.value.trim() || t("ide.bookshelf.defaultTitle"),
        summary: summary.value.trim(),
        genre: genre.value,
    });
}

defineExpose({
    title,
    summary,
    genre,
    focusTitle,
    reset,
});
</script>

<template>
    <div data-project-create-form class="project-create-form-root space-y-4">
        <!-- 创建中状态：内聚于表单组件内部，满足 ui-development-spec §4.1 规范（占满区域、居中、零布局抖动） -->
        <div
            v-if="isCreating"
            class="flex min-h-[260px] flex-col items-center justify-center gap-3 py-8 text-center"
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
                <!-- 双栏联动布局：基于 @container 自适应，容器 <480px 垂直堆叠，>=480px 左右双栏 -->
                <div class="create-form-layout">
                    <!-- 左侧 / 移动端顶部：拟真书封预览 -->
                    <div class="flex shrink-0 justify-center sm:pt-1">
                        <ProjectCreateCoverPreview :title="title" :genre="genre" />
                    </div>

                    <!-- 右侧输入表单 -->
                    <div class="min-w-0 flex-1 space-y-3.5">
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

                        <!-- 题材选择胶囊 -->
                        <div class="space-y-1.5">
                            <span class="block text-xs font-medium text-[var(--text-secondary)]">
                                {{ t("ide.picker.genreSelect") }}
                            </span>
                            <div class="flex flex-wrap gap-1.5">
                                <button
                                    v-for="opt in genreOptions"
                                    :key="opt.id"
                                    type="button"
                                    class="rounded-[var(--radius-control)] border px-2 py-0.5 text-xs transition-colors cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-main)]"
                                    :class="genre === opt.id
                                        ? 'border-[var(--accent-main)] bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] font-medium text-[var(--text-main)]'
                                        : 'border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-muted)] hover:border-[var(--border-hover)] hover:text-[var(--text-main)]'"
                                    :disabled="isCreating || Boolean(recoveryError)"
                                    @click="genre = opt.id"
                                >
                                    {{ opt.label }}
                                </button>
                            </div>
                        </div>

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
                    </div>
                </div>
            </form>
        </template>
    </div>
</template>

<style scoped>
.project-create-form-root {
    container-type: inline-size;
}

.create-form-layout {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
}

@container (min-width: 480px) {
    .create-form-layout {
        flex-direction: row;
        align-items: flex-start;
    }
}
</style>
