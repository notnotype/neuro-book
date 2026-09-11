<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {IconButton, Button, Badge} from "@notnotype/nb-ui/components";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import type {ProjectPickerRecoveryEntry} from "nbook/app/utils/project-picker-recovery";

const props = defineProps<{
    project: ProjectMetadataDto;
    tags?: readonly string[];
    deleteBusy?: boolean;
    deleteRecovery?: ProjectPickerRecoveryEntry;
    coverRefreshVersion?: number;
    failedCover?: boolean;
    resolveCoverUrl?: (projectRoot: string) => string;
    formatDate?: (dateString?: string | null) => string;
}>();

const emit = defineEmits<{
    (e: "open", projectRoot: string): void;
    (e: "delete", project: ProjectMetadataDto): void;
    (e: "retry-delete-recovery", projectRoot: string): void;
    (e: "open-cover-dialog", project: ProjectMetadataDto): void;
    (e: "cover-error", projectRoot: string): void;
}>();

const {t} = useI18n();

const isImageFailed = ref(false);

watch(() => [props.project.cover, props.project.projectRoot, props.coverRefreshVersion], () => {
    isImageFailed.value = false;
});

function handleImageError(): void {
    isImageFailed.value = true;
    emit("cover-error", props.project.projectRoot);
}

const coverSrc = computed(() => {
    if (!props.project.cover || props.failedCover) return "";
    if (props.resolveCoverUrl) {
        return props.resolveCoverUrl(props.project.projectRoot);
    }
    const query = new URLSearchParams({projectRoot: props.project.projectRoot, preset: "project-cover"});
    if (props.coverRefreshVersion !== undefined) {
        query.set("refresh", String(props.coverRefreshVersion));
    }
    return `/api/projects/cover?${query.toString()}`;
});

const formattedUpdatedTime = computed(() => {
    if (props.formatDate) {
        return props.formatDate(props.project.manifestUpdatedAt);
    }
    if (!props.project.manifestUpdatedAt) return "";
    const date = new Date(props.project.manifestUpdatedAt);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
});
</script>

<template>
    <article
        class="project-card-root group relative min-w-0"
        data-project-card
        :data-project-root="project.projectRoot"
    >
        <button
            type="button"
            class="project-card-button block w-full text-left outline-none cursor-pointer focus-visible:outline-none select-none"
            :aria-label="t('ide.picker.openProject', {title: project.title})"
            @click="emit('open', project.projectRoot)"
        >
            <!-- 书封：真实图片失败或未配置时回退到排版封面 -->
            <span
                class="project-cover relative block aspect-[2/3] overflow-hidden rounded-[var(--radius-panel,6px)] border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm"
            >
                <img
                    v-if="coverSrc && !isImageFailed"
                    :key="`${project.projectRoot}:${String(coverRefreshVersion ?? 0)}`"
                    class="h-full w-full object-cover"
                    :src="coverSrc"
                    :alt="t('ide.picker.coverAlt', {title: project.title})"
                    loading="lazy"
                    decoding="async"
                    @error="handleImageError"
                >
                <span
                    v-else
                    class="project-cover-fallback absolute inset-0 flex flex-col items-center justify-between overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[color-mix(in_srgb,var(--bg-panel)_85%,var(--accent-main)_15%)] to-[var(--bg-panel)] px-2.5 py-4 sm:px-4 sm:py-6 text-center select-none"
                >
                    <span class="flex w-full items-center gap-1.5 sm:gap-2 text-[10px] font-medium text-[var(--text-muted)]">
                        <span class="h-px flex-1 bg-[var(--border-color)]"></span>
                        <span class="i-lucide-feather h-3 w-3 sm:h-3.5 sm:w-3.5 text-[var(--accent-text)]"></span>
                        <span class="h-px flex-1 bg-[var(--border-color)]"></span>
                    </span>
                    <span class="line-clamp-4 break-words font-serif text-xs font-bold leading-4.5 text-[var(--text-main)] sm:text-base sm:leading-6 sm:text-lg sm:leading-7">
                        {{ project.title }}
                    </span>
                    <span class="h-0.5 w-6 sm:h-1 sm:w-9 rounded-full bg-[var(--accent-main)] opacity-75"></span>
                </span>
                <span class="project-cover-spine absolute inset-y-0 left-0 w-1.5 sm:w-2 border-r border-[var(--border-color)]"></span>
                <span class="project-cover-page absolute inset-y-2 right-0 w-0.5 sm:w-1 border-l border-[var(--border-color)]"></span>
            </span>
            <span class="project-shelf-board block h-1.5 sm:h-2" aria-hidden="true"></span>

            <!-- 书名与元数据 -->
            <span class="mt-2 sm:mt-3 block min-w-0">
                <span class="line-clamp-2 break-words font-serif text-sm font-bold leading-5 text-[var(--text-main)] sm:text-base">
                    {{ project.title }}
                </span>

                <!-- 题材/标签徽章（消费 nb-ui Badge） -->
                <span v-if="tags && tags.length > 0" class="mt-1.5 flex flex-wrap gap-1">
                    <Badge
                        v-for="tag in tags"
                        :key="tag"
                        size="sm"
                        variant="soft"
                        tone="neutral"
                        class="text-[10px]"
                    >
                        {{ tag }}
                    </Badge>
                </span>

                <span
                    v-if="project.summary"
                    class="mt-1 sm:mt-1.5 line-clamp-2 break-words text-[11px] leading-4 text-[var(--text-secondary)] sm:text-xs sm:leading-5"
                >
                    {{ project.summary }}
                </span>
                <span
                    v-if="formattedUpdatedTime"
                    class="mt-1.5 sm:mt-2 flex min-w-0 items-center gap-1 sm:gap-1.5 text-[10px] sm:text-[11px] text-[var(--text-muted)]"
                    :title="t('ide.picker.manifestUpdatedAtTitle', {time: formattedUpdatedTime})"
                >
                    <span class="i-lucide-clock-3 h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0"></span>
                    <span class="truncate">{{ t("ide.picker.manifestUpdatedAt", {time: formattedUpdatedTime}) }}</span>
                </span>
            </span>
        </button>

        <!-- 封面与删除操作栏（悬浮显现，移动端常驻；基于 :hover 与 :focus-visible） -->
        <div
            class="project-card-actions absolute right-1.5 top-1.5 sm:right-2 sm:top-2 z-10 flex gap-1 sm:gap-1.5 rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--bg-panel)_85%,transparent)] backdrop-blur-sm p-0.5 sm:p-1 shadow-sm border border-[var(--border-color)]"
        >
            <IconButton
                size="sm"
                variant="secondary"
                icon-class="i-lucide-image-plus"
                :title="t('ide.picker.setCover')"
                :aria-label="t('ide.picker.setCover')"
                @click.stop="emit('open-cover-dialog', project)"
            />
            <IconButton
                size="sm"
                variant="danger"
                :icon-class="deleteBusy ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-trash-2'"
                :title="t('ide.bookshelf.deleteBook')"
                :aria-label="t('ide.bookshelf.deleteBook')"
                :disabled="deleteBusy || Boolean(deleteRecovery)"
                @click.stop="emit('delete', project)"
            />
        </div>

        <!-- 删除恢复报错 -->
        <div
            v-if="deleteRecovery"
            class="mt-3 space-y-2 rounded-[var(--radius-control)] border border-[var(--status-danger-border,var(--status-danger))] bg-[color-mix(in_srgb,var(--status-danger)_8%,transparent)] px-3 py-2 text-xs text-[var(--status-danger)]"
            role="alert"
        >
            <p>{{ deleteRecovery.error || t("ide.picker.deleteRecoveryRequired") }}</p>
            <Button
                size="sm"
                variant="danger"
                icon-class="i-lucide-refresh-cw"
                :disabled="deleteBusy"
                @click.stop="emit('retry-delete-recovery', project.projectRoot)"
            >
                {{ t("ide.picker.mutationRecoveryRetry") }}
            </Button>
        </div>
    </article>
</template>

<style scoped>
.project-card-root {
    isolation: isolate;
}

.project-cover {
    transition: transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
                box-shadow 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
                border-color 160ms ease;
    will-change: transform;
}

@media (hover: hover) {
    .project-card-root:hover .project-cover {
        transform: translateY(-3px);
        box-shadow: 0 8px 18px -4px color-mix(in srgb, var(--shadow-color, black) 12%, transparent);
        border-color: color-mix(in srgb, var(--accent-main) 30%, var(--border-color));
    }
}

.project-card-button:focus-visible .project-cover {
    outline: 2px solid var(--accent-main);
    outline-offset: 2px;
}

.project-card-root:active .project-cover {
    transform: translateY(0) scale(0.985);
    box-shadow: 0 2px 6px -1px color-mix(in srgb, var(--shadow-color, black) 8%, transparent);
    transition-duration: 80ms;
}

/* 操作栏展示逻辑：移动端常驻展示；桌面端悬停展示，或获得键盘焦点(:focus-visible)时展示 */
@media (min-width: 640px) {
    .project-card-actions {
        opacity: 0;
        pointer-events: none;
        transition: opacity 160ms ease;
    }

    .project-card-root:hover .project-card-actions,
    .project-card-actions:focus-within,
    .project-card-root:has(:focus-visible) .project-card-actions {
        opacity: 1;
        pointer-events: auto;
    }
}
</style>
