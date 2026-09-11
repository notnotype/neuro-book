<script setup lang="ts">
import {computed} from "vue";
import {IconButton, Button} from "@notnotype/nb-ui/components";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import type {ProjectPickerRecoveryEntry} from "nbook/app/utils/project-picker-recovery";

const props = defineProps<{
    project: ProjectMetadataDto;
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
    <article class="group relative min-w-0" data-project-card :data-project-root="project.projectRoot">
        <button
            type="button"
            class="block w-full text-left outline-none cursor-pointer focus-visible:outline-none"
            :aria-label="t('ide.picker.openProject', {title: project.title})"
            @click="emit('open', project.projectRoot)"
        >
            <!-- 书封：真实图片失败或未配置时回退到排版封面 -->
            <span
                class="project-cover relative block aspect-[2/3] overflow-hidden rounded-[var(--radius-panel,6px)] border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm transition-[transform,box-shadow] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] group-hover:-translate-y-1 group-hover:shadow-md group-focus-within:-translate-y-1 group-focus-visible:ring-2 group-focus-visible:ring-[var(--accent-main)] group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-[var(--bg-main)]"
            >
                <img
                    v-if="coverSrc"
                    :key="`${project.projectRoot}:${String(coverRefreshVersion ?? 0)}`"
                    class="h-full w-full object-cover"
                    :src="coverSrc"
                    :alt="t('ide.picker.coverAlt', {title: project.title})"
                    loading="lazy"
                    decoding="async"
                    @error="emit('cover-error', project.projectRoot)"
                >
                <span
                    v-else
                    class="project-cover-fallback absolute inset-0 flex flex-col items-center justify-between overflow-hidden px-4 py-6 text-center select-none"
                >
                    <span class="flex w-full items-center gap-2 text-[10px] font-medium text-[var(--text-muted)]">
                        <span class="h-px flex-1 bg-[var(--border-color)]"></span>
                        <span class="i-lucide-feather h-3.5 w-3.5 text-[var(--accent-text)]"></span>
                        <span class="h-px flex-1 bg-[var(--border-color)]"></span>
                    </span>
                    <span class="line-clamp-4 break-words font-serif text-lg font-bold leading-7 text-[var(--text-main)] sm:text-xl">
                        {{ project.title }}
                    </span>
                    <span class="h-1 w-9 rounded-full bg-[var(--accent-main)]"></span>
                </span>
                <span class="project-cover-spine absolute inset-y-0 left-0 w-2 border-r border-[var(--border-color)]"></span>
                <span class="project-cover-page absolute inset-y-2 right-0 w-1 border-l border-[var(--border-color)]"></span>
            </span>
            <span class="project-shelf-board block h-2" aria-hidden="true"></span>

            <!-- 书名与元数据 -->
            <span class="mt-3 block min-w-0">
                <span class="line-clamp-2 break-words font-serif text-base font-bold leading-5 text-[var(--text-main)]">
                    {{ project.title }}
                </span>
                <span
                    v-if="project.summary"
                    class="mt-1.5 line-clamp-2 break-words text-xs leading-5 text-[var(--text-secondary)]"
                >
                    {{ project.summary }}
                </span>
                <span
                    v-if="formattedUpdatedTime"
                    class="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--text-muted)]"
                    :title="t('ide.picker.manifestUpdatedAtTitle', {time: formattedUpdatedTime})"
                >
                    <span class="i-lucide-clock-3 h-3.5 w-3.5 shrink-0"></span>
                    <span class="truncate">{{ t("ide.picker.manifestUpdatedAt", {time: formattedUpdatedTime}) }}</span>
                </span>
            </span>
        </button>

        <!-- 封面与删除操作栏（悬浮显现） -->
        <div
            class="project-card-actions absolute right-2 top-2 z-10 flex gap-1.5 rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--bg-panel)_85%,transparent)] backdrop-blur-sm p-1 shadow-sm border border-[var(--border-color)] transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
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
